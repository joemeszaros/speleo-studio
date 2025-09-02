import * as THREE from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { TextSprite } from './textsprite.js';
import { showWarningPanel } from '../ui/popups.js';
import { ViewHelper } from '../utils/viewhelper.js';
import { formatDistance } from '../utils/utils.js';
import { ProfileViewControl, PlanViewControl, SpatialViewControl } from './control.js';

class View {

  constructor(name, camera, domElement, scene, dpi = 96, ratioIndicatorWidth = 200) {
    this.name = name;
    this.camera = camera;
    this.domElement = domElement;
    this.scene = scene;
    this.dpi = dpi;
    this.isInteracting = false;

    this.ratioIndicator = this.#createRatioIndicator(ratioIndicatorWidth);
    this.ratioIndicator.visible = false;
    scene.sprites3DGroup.add(this.ratioIndicator);
    this.ratioIndicator.onclick = () => {
      this.#setRatio();
    };

    this.ratioText = this.#createRatioText();
    this.ratioText.sprite.visible = false;
    const ratioTextSprite = this.ratioText.getSprite();
    scene.sprites3DGroup.add(ratioTextSprite);
    ratioTextSprite.onclick = () => {
      this.#setRatio();
    };

    this.spriteCamera = new THREE.OrthographicCamera(
      -scene.width / 2,
      scene.width / 2,
      scene.height / 2,
      -scene.height / 2,
      0,
      10
    );
    this.spriteCamera.position.z = 1;

  }

  #createRatioText() {
    //https://discourse.threejs.org/t/how-to-update-text-in-real-time/39050/12
    const position = new THREE.Vector3(0, -this.scene.height / 2 + 40, 1);
    return new TextSprite(
      '0',
      position,
      { size: 35, family: 'Helvetica Neue', strokeColor: 'black' },
      0.5,
      'ratio text'
    );
  }

  #createRatioIndicator(width) {
    const map = new THREE.TextureLoader().load('images/ratio.png');
    map.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.SpriteMaterial({ map: map, color: 0xffffff });
    const sprite = new THREE.Sprite(material);
    sprite.center.set(0.5, 0.5);
    sprite.scale.set(width, (width / 755) * 36, 1); // 755 is the width of the image, 36 is the height of the image
    sprite.position.set(0, -this.scene.height / 2 + 20, 1); // bottom right
    sprite.width = width; // custom property
    sprite.name = 'ratio ruler';
    return sprite;
  }

  #setRatio() {
    const ratioRaw = prompt('Enter the ratio value', this.ratio);
    if (ratioRaw === null) return;
    if (!Number.isInteger(Number.parseInt(ratioRaw, 10))) {
      showWarningPanel(`Ratio '${ratioRaw}' is not an integer`);
      return;
    }
    const ratioValue = Number.parseInt(ratioRaw);
    if (ratioValue <= 0) {
      showWarningPanel('Ratio must be a positive number');
      return;
    } else {
      const cmInPixels = this.dpi / 2.54;
      const screenInCentimeters = window.screen.width / cmInPixels;
      const ratioWithoutZoom = (this.camera.width * 100) / screenInCentimeters;
      const zoomLevel = ratioWithoutZoom / ratioValue;
      //const level = this.camera.width / (ratioValue * (this.scene.width / this.ratioIndicator.width));
      this.zoomCameraTo(zoomLevel);
    }
  }

  onDPIChange(dpi) {
    const fac = this.dpi / dpi;
    this.dpi = dpi;
    this.zoomCameraTo(this.control.zoom * fac);
  }

  onZoomLevelChange(level) {
    const cmInPixels = this.dpi / 2.54;
    const worldWidthInMeters = this.camera.width / level;
    const indicatorWidthInMeters = worldWidthInMeters / (this.scene.width / this.ratioIndicator.width);
    const screenInCentimeters = window.screen.width / cmInPixels;
    this.ratio = Math.floor((worldWidthInMeters * 100) / screenInCentimeters);
    const ratioText = `${formatDistance(indicatorWidthInMeters)} - M 1:${this.ratio}`;
    this.ratioText.update(`${ratioText}`);
  }

  onResize(width, height) {

    if (this.camera.isOrthographicCamera) {
      const aspect = width / height;
      this.camera.left = this.camera.bottom * aspect;
      this.camera.right = this.camera.top * aspect;
      this.camera.width = Math.abs(this.camera.left) + Math.abs(this.camera.right); // left is a negative number
      this.camera.updateProjectionMatrix();
    }

    this.ratioText.getSprite().position.set(0, -this.scene.height / 2 + 45, 1);
    this.ratioIndicator.position.set(0, -this.scene.height / 2 + 20, 1);
    this.spriteCamera.left = -width / 2;
    this.spriteCamera.right = width / 2;
    this.spriteCamera.top = height / 2;
    this.spriteCamera.bottom = -height / 2;
    this.spriteCamera.updateProjectionMatrix();
    this.onZoomLevelChange(this.control.zoom);

  }

  addListener(name, handler) {
    this.domElement.addEventListener(name, (e) => {
      if (this.enabled) {
        handler(e);
      }
    });
  }

  fitScreen(boundingBox) {
    if (boundingBox === undefined) return;
    const rotation = new THREE.Matrix4().extractRotation(this.camera.matrix);
    boundingBox.applyMatrix4(rotation); // this is a side effect if fitScreen() is called multiple times
    const width = boundingBox.max.x - boundingBox.min.x;
    const height = boundingBox.max.y - boundingBox.min.y;
    const zoomLevel = Math.min(this.camera.width / width, this.camera.height / height); // camera width and height in world units
    const zoomChanged = this.control.zoom !== zoomLevel;
    this.control.setZoomLevel(zoomLevel);

    if (zoomChanged) {
      this.updateOverviewCameraZoom(boundingBox);
      if (this.frustumFrame) this.updateFrustumFrame();
      this.onZoomLevelChange(zoomLevel);
      this.renderView();
    }
  }

  panCameraTo(position) {
    const pos = position.clone();
    const dir = this.camera.position.clone().sub(this.target);
    const camPos = pos.clone().add(dir);
    this.target.copy(pos);
    this.control.target.copy(pos);
    this.camera.position.copy(camPos);
    this.camera.updateProjectionMatrix();
    this.renderView();
  }

  zoomCameraTo(level) {
    if (level >= 0.1) {
      this.control.setZoomLevel(level);
      this.onZoomLevelChange(level);
      this.renderView();
    }
  }

  zoomIn() {
    this.zoomCameraTo(this.control.zoom * 1.2);
  }

  zoomOut() {
    this.zoomCameraTo(this.control.zoom / 1.2);
  }

  updateOverviewCameraZoom(boundingBox) {
    if (boundingBox === undefined) return;
    const [width, height] = boundingBox.getSize(new THREE.Vector3());
    const diagonal = Math.sqrt(Math.pow(width, 2) + Math.pow(height, 2));
    const zoomLevel = Math.min(
      this.overviewCamera.width / diagonal,
      this.overviewCamera.width / width,
      this.overviewCamera.height / height
    ); // camera width and height in world units
    this.overviewCamera.zoom = zoomLevel;
    this.overviewCamera.updateProjectionMatrix();
  }

  updateFrustumFrame() {
    const segments = this.#getFrustumFrame();
    this.frustumFrame.geometry.setPositions(segments);
  }

  createFrustumFrame() {
    const segments = this.#getFrustumFrame();
    const geometry = new LineSegmentsGeometry();
    geometry.setPositions(segments);
    const material = new LineMaterial({
      color        : 0xffffff,
      linewidth    : 1,
      worldUnits   : false,
      vertexColors : false
    });
    this.frustumFrame = new LineSegments2(geometry, material);
    this.frustumFrame.layers.set(31);
    this.scene.threejsScene.add(this.frustumFrame);
  }

  #getFrustumFrame() {
    const unproject = (x, y, z, camera) => {
      return new THREE.Vector3(x, y, z).unproject(camera);
    };

    const _camera = new THREE.Camera();
    _camera.projectionMatrixInverse.copy(this.camera.projectionMatrixInverse);
    _camera.matrixWorld.copy(this.camera.matrixWorld);
    const bottomLeft = unproject(-1, -1, 0.5, _camera); // z = 0.5 means middle between far and near planes
    const topLeft = unproject(-1, 1, 0.5, _camera);
    const topRight = unproject(1, 1, 0.5, _camera);
    const bottomRight = unproject(1, -1, 0.5, _camera);

    const segments = [];
    segments.push(bottomLeft.x, bottomLeft.y, bottomLeft.z, topLeft.x, topLeft.y, topLeft.z);
    segments.push(topLeft.x, topLeft.y, topLeft.z, topRight.x, topRight.y, topRight.z);
    segments.push(topRight.x, topRight.y, topRight.z, bottomRight.x, bottomRight.y, bottomRight.z);
    segments.push(bottomRight.x, bottomRight.y, bottomRight.z, bottomLeft.x, bottomLeft.y, bottomLeft.z);
    return segments;
  }

  renderView() {
    this.scene.renderScene(this.camera, this.overviewCamera, this.spriteCamera);
  }

  // eslint-disable-next-line no-unused-vars
  animate(delta) {

  }

  addEventListener(type, listener) {
    if (!this.listeners) this.listeners = new Map();
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }

  removeEventListener(type, listener) {
    if (this.listeners && this.listeners.has(type)) {
      this.listeners.get(type).splice(this.listeners.get(type).indexOf(listener), 1);
    }
  }
  dispatchEvent(type, params) {
    if (this.listeners && this.listeners.has(type)) {
      this.listeners.get(type).forEach((listener) => listener(params));
    }
  }

  activate(boundingBox) {
    this.enabled = true;

    if (this.initiated === false) {
      this.target = boundingBox?.getCenter(new THREE.Vector3()) ?? new THREE.Vector3(0, 0, 0);
      this.adjustCamera(boundingBox);
      if (this.frustumFrame === undefined) this.createFrustumFrame();
      this.fitScreen(boundingBox);
      this.initiated = true;
    }

    if (this.initiated) {
      this.frustumFrame.visible = true;
      this.ratioIndicator.visible = true;
      this.ratioText.sprite.visible = true;
    }

    this.dispatchEvent('viewActivated', { name: this.name });
  }

  deactivate() {
    if (this.initiated) {
      this.ratioIndicator.visible = false;
      this.ratioText.sprite.visible = false;
      this.frustumFrame.visible = false;
    }

    this.enabled = false;
  }

  static updateCameraFrustum(camera, frustumSize, aspectRatio, near = null, far = null) {
    const halfWidth = (frustumSize * aspectRatio) / 2;
    const halfHeight = frustumSize / 2;

    camera.left = -halfWidth;
    camera.right = halfWidth;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;

    if (near === null) {
      near = 0;
    }

    if (far === null) {
      far = frustumSize * 10; // 10x the frustum size for good depth range
    }

    camera.near = -1000;
    camera.far = far;

    // Update custom properties
    camera.width = frustumSize * aspectRatio;
    camera.height = frustumSize;

    camera.updateProjectionMatrix();
  }

  static createOrthoCamera(aspect, frustrum = 100) {
    const camera = new THREE.OrthographicCamera(
      (frustrum * aspect) / -2,
      (frustrum * aspect) / 2,
      frustrum / 2,
      frustrum / -2,
      0, // Near plane
      frustrum * 10 // Far plane: 10x the frustum size for good depth range
    );

    camera.width = frustrum * aspect; // custom property
    camera.height = frustrum; // custom property
    camera.layers.enable(0);
    camera.layers.enable(1);
    camera.layers.disable(31);
    return camera;
  }

}

class SpatialView extends View {

  constructor(scene, domElement, viewHelperDomElement) {
    super('spatialView', View.createOrthoCamera(scene.width / scene.height), domElement, scene);

    this.overviewCamera = View.createOrthoCamera(1);
    this.overviewCamera.layers.disable(1);
    this.overviewCamera.layers.enable(31);

    this.control = new SpatialViewControl(this.camera, this.domElement);

    this.control.addEventListener('start', () => {
      this.isInteracting = true;
    });
    this.control.addEventListener('end', () => {
      this.onControlOperationEnd();
    });

    this.control.addEventListener('orbitSet', (e) => {
      this.onOrbitAdjustment(e);
    });
    this.control.addEventListener('orbitChange', (e) => {
      this.onOrbitAdjustment(e);
    });

    this.viewHelper = new ViewHelper(this.camera, this.domElement, {
      labelX : 'x',
      labelY : 'y',
      labelZ : 'z',
      font   : '28px Arial',
      color  : 'black',
      radius : 18
    });

    this.viewHelperDomElement = viewHelperDomElement;

    this.viewHelperDomElement.addEventListener('pointerup', (event) => {
      event.stopPropagation();
      this.viewHelper.handleClick(event);
    });

    this.viewHelperDomElement.addEventListener('pointerdown', function (event) {
      event.stopPropagation();
    });

    this.animatedPreviously = false;

    this.enabled = false;
    this.control.enabled = false;
    this.initiated = false;
  }

  onOrbitAdjustment(e) {
    if (e.type === 'zoom') {
      this.onZoomLevelChange(e.level);
      this.updateFrustumFrame();
    }
    //render for rotate and pan also
    this.renderView();
  }

  onControlOperationEnd() {
    const newpos = this.camera.position.clone().sub(this.control.target);
    this.overviewCamera.position.copy(this.target.clone().add(newpos));
    this.overviewCamera.rotation.copy(this.camera.rotation);
    this.overviewCamera.updateProjectionMatrix();
    if (this.frustumFrame) this.updateFrustumFrame();
    this.renderView();
    this.onZoomLevelChange(this.control.zoom);
    this.isInteracting = false;
  }

  getViewSettings(boundingBox) {
    if (!boundingBox) {
      return { distance: 100, frustumSize: 120 };
    }

    const size = boundingBox.getSize(new THREE.Vector3());
    // For spatial view, we need to consider all three dimensions
    const maxDimension = Math.max(size.x, size.y, size.z);
    const padding = 1.4; // 40% padding for 3D view
    const frustumSize = maxDimension * padding;
    const minFrustumSize = 120;
    const finalFrustumSize = Math.max(frustumSize, minFrustumSize);
    const distance = Math.max((maxDimension / 2) * 1.2, 100); // At least 200m from center

    return {
      distance,
      frustumSize : finalFrustumSize,
      center      : boundingBox.getCenter(new THREE.Vector3())
    };
  }

  adjustCamera(boundingBox) {
    const settings = this.getViewSettings(boundingBox);

    View.updateCameraFrustum(this.camera, settings.frustumSize, this.scene.width / this.scene.height);
    View.updateCameraFrustum(this.overviewCamera, settings.frustumSize, 1);

    this.control.setTarget(this.target);
    // wihtout the Math.PI / 2 - 0.0001 Firefox renders the initial view 90 degree clockwise
    // the first rotation fixes the view but I rather decided to apply this delta
    this.control.setCameraOrientation(settings.distance, Math.PI, Math.PI / 2 - 0.001); // looking down from above

    // Update camera position
    this.control.updateCameraPosition();

    // Update overview camera to match
    this.overviewCamera.position.copy(this.camera.position);
    this.overviewCamera.lookAt(this.target);
    this.overviewCamera.updateProjectionMatrix();
  }

  renderView() {
    this.scene.renderScene(this.camera, this.overviewCamera, this.spriteCamera, this.viewHelper);
  }

  animate(delta) {

    if (this.viewHelper.animating === true) {
      this.viewHelper.update(delta);
      this.renderView();
      this.animatedPreviously = true;
    } else if (this.animatedPreviously === true) {
      const center = this.camera
        .getWorldDirection(new THREE.Vector3())
        .multiplyScalar(100)
        .add(this.camera.position.clone());

      this.control.setTarget(center);
      this.target = center;

      // Update camera position to maintain distance and orientation
      this.control.updateCameraPosition();

      const newpos = this.camera.position.clone().sub(this.control.target);
      this.overviewCamera.position.copy(this.target.clone().add(newpos));
      this.overviewCamera.lookAt(this.target);
      this.overviewCamera.updateProjectionMatrix();
      this.renderView();

      this.animatedPreviously = false;
    }
  }

  activate(boundingBox) {
    super.activate(boundingBox);
    this.control.enabled = true;
    this.viewHelperDomElement.style.display = 'block';
    this.renderView();
  }

  deactivate() {
    super.deactivate();
    this.viewHelperDomElement.style.display = 'none';
    this.control.enabled = false;
  }
}

class PlanView extends View {

  constructor(scene, domElement, compassSize = 100) {
    super('planView', View.createOrthoCamera(scene.width / scene.height), domElement, scene);

    this.overviewCamera = View.createOrthoCamera(1);
    this.overviewCamera.layers.disable(1);
    this.overviewCamera.layers.enable(31);

    this.control = new PlanViewControl(this.camera, domElement);

    this.compass = this.#createCompass(compassSize);
    this.compass.visible = false;
    scene.sprites3DGroup.add(this.compass);

    // Add rotation text display above compass
    this.rotationText = this.#createRotationText();
    this.rotationText.name = 'rotation text';
    this.rotationText.sprite.visible = false;
    const rotationTextSprite = this.rotationText.getSprite();
    scene.sprites3DGroup.add(rotationTextSprite);
    rotationTextSprite.onclick = () => {
      this.#setRotation();
    };

    this.initiated = false;
    this.enabled = false;

    // Set up custom plan view control event listeners
    this.control.addEventListener('start', () => {
      this.isInteracting = true;
    });

    this.control.addEventListener('end', (params) => {
      this.onControlOperationEnd(params);
    });

    this.control.addEventListener('orbitChange', (e) => {
      this.onOrbitAdjustment(e);
    });

    this.control.addEventListener('orbitSet', (e) => {
      this.onOrbitAdjustment(e);
    });
  }

  onOrbitAdjustment(e) {
    if (e.type === 'rotate') {
      // Update compass rotation
      this.compass.material.rotation = -e.rotation;
      // Update rotation text during rotation
      this.#updateRotationText();
    } else if (e.type === 'zoom') {
      this.onZoomLevelChange(e.level);
      this.updateFrustumFrame();
    }
    //render for rotate and pan also
    this.renderView();
  }

  onControlOperationEnd(params) {
    this.isInteracting = false;

    if (params.type === 'rotate') {
      this.overviewCamera.rotation.z = this.camera.rotation.z;
      this.overviewCamera.updateProjectionMatrix();
      this.updateFrustumFrame();
      // Update rotation text when rotation ends
      this.#updateRotationText();
    } else if (params.type === 'pan') {
      this.updateFrustumFrame();
    }
    this.renderView();
  }

  getViewSettings(boundingBox) {
    if (!boundingBox) {
      return { distance: 100, frustumSize: 120 };
    }

    const size = boundingBox.getSize(new THREE.Vector3());
    const maxDimension = Math.max(size.x, size.y);
    const padding = 1.2; // 20% padding
    const frustumSize = maxDimension * padding;
    const minFrustumSize = 100;
    const finalFrustumSize = Math.max(frustumSize, minFrustumSize);
    // For plan view, camera is above the cave looking down
    const maxZ = boundingBox.max.z;
    const minDistance = 50; // Minimum distance from cave surface
    const distance = Math.max(maxZ + minDistance, 100); // At least 100m above

    return {
      distance,
      frustumSize : finalFrustumSize
    };
  }

  adjustCamera(boundingBox) {
    const settings = this.getViewSettings(boundingBox);

    View.updateCameraFrustum(this.camera, settings.frustumSize, this.scene.width / this.scene.height);
    View.updateCameraFrustum(this.overviewCamera, settings.frustumSize, 1);

    this.control.setTarget(this.target);
    this.control.setHeight(settings.distance);
    this.control.updateCameraPosition();
    this.overviewCamera.position.copy(this.control.getCameraPosition());
    this.overviewCamera.lookAt(this.target);
    this.overviewCamera.updateProjectionMatrix();
  }

  onResize(width, height) {
    super.onResize(width, height);
    this.compass.position.set(width / 2 - 60, -height / 2 + 60, 1); // bottom right
    this.rotationText.sprite.position.set(width / 2 - 60, -height / 2 + 120, 1); // above compass
  }

  #createCompass(size) {
    const map = new THREE.TextureLoader().load('images/compass.png');
    map.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.SpriteMaterial({ map: map });
    const sprite = new THREE.Sprite(material);
    sprite.center.set(0.5, 0.5);
    sprite.scale.set(size, size, 1);
    sprite.position.set(this.scene.width / 2 - 60, -this.scene.height / 2 + 60, 1); // bottom right
    sprite.name = 'compass';
    return sprite;
  }

  #createRotationText() {
    const position = new THREE.Vector3(this.scene.width / 2 - 60, -this.scene.height / 2 + 120, 1);
    return new TextSprite(
      '0°',
      position,
      { size: 24, family: 'Helvetica Neue', strokeColor: 'black', color: 'white' },
      0.5,
      'rotation text'
    );
  }

  #updateRotationText() {
    const rotationDegrees = ((this.camera.rotation.z * 180) / Math.PI).toFixed(1);
    this.rotationText.update(`N ${rotationDegrees}°`);
  }

  #setRotation() {
    const currentRotation = ((this.camera.rotation.z * 180) / Math.PI).toFixed(1);
    const rotationRaw = prompt('Enter rotation value in degrees', currentRotation);
    if (rotationRaw === null) return;

    const rotationValue = parseFloat(rotationRaw);
    if (isNaN(rotationValue)) {
      showWarningPanel(`Rotation '${rotationRaw}' is not a valid number`);
      return;
    }

    // Convert degrees to radians and set camera rotation
    const rotationRadians = (rotationValue * Math.PI) / 180;
    this.camera.rotation.z = rotationRadians;

    this.compass.material.rotation = -rotationRadians;
    this.overviewCamera.rotation.z = rotationRadians;
    this.overviewCamera.updateProjectionMatrix();
    this.#updateRotationText();

    // Update frustum frame and render
    this.updateFrustumFrame();
    this.renderView();

    // Dispatch rotation change event
    this.control.dispatchEvent('orbitChange', { type: 'rotate', rotation: rotationRadians });
  }

  activate(boundingBox) {
    super.activate(boundingBox);
    this.control.enabled = true;
    this.compass.visible = true;
    this.compass.material.rotation = 0;
    this.rotationText.sprite.visible = true;
    this.#updateRotationText();
    this.renderView();

  }

  deactivate() {
    super.deactivate();
    this.compass.visible = false;
    this.rotationText.sprite.visible = false;
    this.control.enabled = false;
  }
}

class ProfileView extends View {

  constructor(scene, domElement, verticalRatioIndicatorHeight = 300) {
    super('profileView', View.createOrthoCamera(scene.width / scene.height), domElement, scene);

    this.overviewCamera = View.createOrthoCamera(1);
    this.overviewCamera.layers.disable(1);
    this.overviewCamera.layers.enable(31);
    this.overviewCamera.up = new THREE.Vector3(0, 0, 1);

    // Custom profile view camera control - camera moves on X-Y circle around cave
    this.control = new ProfileViewControl(this.camera, this.domElement);

    // Add vertical ruler
    this.verticalRatioIndicatorHeight = verticalRatioIndicatorHeight;
    this.verticalRuler = this.#createVerticalRuler();
    this.verticalRuler.visible = false;
    scene.sprites3DGroup.add(this.verticalRuler);

    // Add vertical ratio text
    this.verticalRatioText = this.#createVerticalRatioText();
    this.verticalRatioText.sprite.visible = false;
    const verticalRatioTextSprite = this.verticalRatioText.getSprite();
    scene.sprites3DGroup.add(verticalRatioTextSprite);

    this.initiated = false;
    this.enabled = false;

    // Set up custom profile view control event listeners
    this.control.addEventListener('start', () => {
      this.isInteracting = true;
    });

    this.control.addEventListener('end', (params) => {
      this.onControlOperationEnd(params);
    });

    this.control.addEventListener('orbitChange', (e) => {
      this.onOrbitAdjustment(e);
    });

    this.control.addEventListener('orbitSet', (e) => {
      this.onOrbitAdjustment(e);
    });
  }

  onOrbitAdjustment(e) {
    if (e.type === 'zoom') {
      this.onZoomLevelChange(e.level);
      if (this.frustumFrame) this.updateFrustumFrame();
    }
    //render for rotate and pan also
    this.renderView();
  }

  onControlOperationEnd(params) {
    this.isInteracting = false;

    if (params.type === 'rotate') {
      const diff = this.control.getCameraPosition().sub(this.control.getTarget());
      this.overviewCamera.position.copy(this.target.clone().add(diff));
      this.overviewCamera.lookAt(this.target);
      this.overviewCamera.updateProjectionMatrix();
      if (this.frustumFrame) this.updateFrustumFrame();
    } else if (params.type === 'pan') {
      if (this.frustumFrame) this.updateFrustumFrame();
    }
    this.renderView();
  }

  getViewSettings(boundingBox) {
    if (!boundingBox) {
      return { distance: 100, frustumSize: 120 };
    }
    const size = boundingBox.getSize(new THREE.Vector3());
    // For profile view, we need to consider both X and Y dimensions
    // since the camera rotates around the cave in the X-Y plane
    const maxDimension = Math.max(size.x, size.y);
    const padding = 1.3; // 30% padding for profile view
    const frustumSize = maxDimension * padding;
    const minFrustumSize = 100;
    const finalFrustumSize = Math.max(frustumSize, minFrustumSize);

    // Calculate camera distance - should be outside bounding box
    // For profile view, camera moves in a circle around the cave
    const minDistance = 100; // Minimum distance from cave edge
    const distance = Math.max(maxDimension / 2 + minDistance, 300); // At least 300m from center

    return {
      distance,
      frustumSize : finalFrustumSize
    };
  }

  adjustCamera(boundingBox) {
    const settings = this.getViewSettings(boundingBox);
    View.updateCameraFrustum(this.camera, settings.frustumSize, this.scene.width / this.scene.height);
    View.updateCameraFrustum(this.overviewCamera, settings.frustumSize, 1);

    this.control.setTarget(this.target);
    this.control.setRadius(settings.distance);
    this.control.updateCameraPosition();
    const diff = this.control.getCameraPosition().sub(this.control.getTarget());
    this.overviewCamera.position.copy(this.target.clone().add(diff));
    this.overviewCamera.lookAt(this.target);
    this.overviewCamera.updateProjectionMatrix();
  }

  onResize(width, height) {

    this.verticalRuler.position.set(this.scene.width / 2 - 30, 0, 1);
    this.verticalRatioText.getSprite().position.set(this.scene.width / 2 - 80, 0, 1);
    super.onResize(width, height);
  }

  onZoomLevelChange(level) {
    super.onZoomLevelChange(level);
    const worldHeightInMeters = this.camera.height / level;
    const verticalIndicatorHeightInMeters =
      worldHeightInMeters / (this.scene.height / this.verticalRatioIndicatorHeight);
    this.verticalRatioText.update(`${formatDistance(verticalIndicatorHeightInMeters)}`);
  }

  #createVerticalRuler() {
    // Create a canvas to draw the vertical gradient ruler
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const width = 15;
    const height = this.verticalRatioIndicatorHeight;

    canvas.width = width;
    canvas.height = height;

    // Get gradient colors from config
    const gradientColors = this.scene.options.scene.caveLines.color.gradientColors;

    // Create vertical gradient
    const gradient = ctx.createLinearGradient(0, 0, 0, height);

    // Sort colors by depth and add to gradient
    const sortedColors = [...gradientColors].sort((a, b) => a.depth - b.depth);
    sortedColors.forEach((colorData, index) => {
      const stop = index / (sortedColors.length - 1);
      gradient.addColorStop(stop, colorData.color);
    });

    // Fill with gradient
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    // Add tick marks and labels
    ctx.fillStyle = '#ffffff';
    ctx.font = '10px Arial';
    ctx.textAlign = 'left';

    // Add tick marks every 50px
    for (let i = 0; i <= height; i += 50) {
      const y = height - i; // Invert Y so 0 is at bottom
      ctx.fillRect(0, y, width, 1);

      // Add depth label
      const depth = Math.round((i / height) * 100);
      ctx.fillText(`${depth}m`, width + 2, y + 3);
    }

    // Create texture from canvas
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;

    // Create sprite material and sprite
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
    const sprite = new THREE.Sprite(material);

    // Initial position will be set in onResize
    sprite.position.set(this.scene.width / 2 - 30, 0, 1);
    sprite.scale.set(width, height, 1);
    sprite.name = 'vertical ruler';

    return sprite;

  }

  #createVerticalRatioText() {
    // Create vertical ratio text similar to horizontal ratio text
    const position = new THREE.Vector3(this.scene.width / 2 - 80, 0, 1);
    return new TextSprite(
      '0',
      position,
      { size: 35, family: 'Helvetica Neue', strokeColor: 'black' },
      0.5,
      'vertical ratio text'
    );
  }

  activate(boundingBox) {
    super.activate(boundingBox);
    this.control.enabled = true;
    this.verticalRuler.visible = true;
    this.verticalRatioText.sprite.visible = true;
    this.renderView();
  }

  deactivate() {
    super.deactivate();
    this.control.enabled = false;
    this.verticalRuler.visible = false;
    this.verticalRatioText.sprite.visible = false;
  }
}

export { SpatialView, PlanView, ProfileView };
