import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';

import { SimpleOrbitControl, COORDINATE_INDEX } from '../utils/orbitcontrol.js';
import { TextSprite } from './textsprite.js';
import { showWarningPanel } from '../ui/popups.js';
import { get3DCoordsStr } from '../utils/utils.js';
import { ViewHelper } from '../utils/viewhelper.js';

class View {

  constructor(camera, domElement, scene) {
    this.camera = camera;
    this.domElement = domElement;
    this.scene = scene;
  }

  onResize(width, height) {
    if (this.camera.isOrthographicCamera) {
      const aspect = width / height;
      this.camera.left = this.camera.bottom * aspect;
      this.camera.right = this.camera.top * aspect;
      this.camera.width = Math.abs(this.camera.left) + Math.abs(this.camera.right); // left is a negative number
      this.camera.updateProjectionMatrix();
    }
  }

  addListener(name, handler) {
    this.domElement.addEventListener(name, (e) => {
      if (this.enabled) {
        handler(e);
      }
    });
  }

  static createOrthoCamera(aspect, frustrum = 100) {
    const camera = new THREE.OrthographicCamera(
      (frustrum * aspect) / -2,
      (frustrum * aspect) / 2,
      frustrum / 2,
      frustrum / -2,
      -1000,
      3000
    );

    camera.width = frustrum * aspect; // custom property
    camera.height = frustrum; // custom property
    camera.layers.enable(0);
    camera.layers.enable(1);
    camera.layers.disable(31);
    return camera;
  }

  fitScreen(boundingBox, update = false) {
    if (boundingBox === undefined) return;
    const boundingBoxCenter = boundingBox.getCenter(new THREE.Vector3());
    const rotation = new THREE.Matrix4().extractRotation(this.camera.matrix);
    boundingBox.applyMatrix4(rotation);
    const width = boundingBox.max.x - boundingBox.min.x;
    const height = boundingBox.max.y - boundingBox.min.y;
    const zoomLevel = Math.min(this.camera.width / width, this.camera.height / height); // camera width and height in world units
    const zoomChanged = this.camera.zoom !== zoomLevel;
    this.camera.zoom = zoomLevel;

    const offset = boundingBoxCenter.clone().sub(this.target);
    if (update || offset.length() > 0) {
      const oldPosition = this.camera.position.clone();
      const newCameraPosition = oldPosition.add(offset);
      this.target.copy(boundingBoxCenter);
      this.camera.position.copy(newCameraPosition);
      this.camera.lookAt(this.target);
      this.control.target = this.target;
      if (this.viewHelper !== undefined) {
        this.viewHelper.center = this.target;
      }

      const camDirection = this.camera.position.clone().sub(this.control.target);
      this.overviewCamera.position.copy(this.target.clone().add(camDirection));
      this.overviewCamera.rotation.copy(this.camera.rotation);
    }

    if (update || zoomChanged || offset.length > 0) {
      this.camera.updateProjectionMatrix(); //lookat or zoom
      this.updateOverviewCameraZoom(boundingBox);
      this.updateFrustumFrame();
      this.onZoomLevelChange(zoomLevel);
      this.renderView();
    }
  }

  panCameraTo(position) {
    const pos = position.clone();
    const dir = this.camera.position.clone().sub(this.target);
    const camPos = pos.clone().add(dir);
    this.target.copy(pos);
    this.camera.position.copy(camPos);
    this.camera.updateProjectionMatrix();
    this.renderView();
  }

  zoomCameraTo(level) {
    if (level >= 0.1) {
      this.camera.zoom = level;
      this.camera.updateProjectionMatrix();
      this.renderView();
    }
  }

  zoomIn() {
    this.zoomCameraTo(this.camera.zoom * 1.2);
  }

  zoomOut() {
    this.zoomCameraTo(this.camera.zoom / 1.2);
  }

  onZoomLevelChange() {
    //TODO: update text labels in footer
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

  activate() {
    this.enabled = true;
    const boundingBox = this.scene.computeBoundingBox();

    if (this.initiated === false) {

      this.target = boundingBox?.getCenter(new THREE.Vector3()) ?? new THREE.Vector3(0, 0, 0);
      const cameraPos = this.getCameraRelativePosition(this.target);
      this.camera.position.copy(cameraPos.clone());
      this.overviewCamera.position.copy(cameraPos.clone());
      this.camera.lookAt(this.target);
      this.overviewCamera.lookAt(this.target);
      this.createFrustumFrame();
      this.fitScreen(boundingBox, true);
      this.onZoomLevelChange(this.camera.zoom);
      this.initiated = true;
    }

    if (this.initiated) {
      this.frustumFrame.visible = true;
    }

    this.renderView();
  }

  deactivate() {
    if (this.initiated) {
      this.frustumFrame.visible = false;
    }

    this.enabled = false;
  }

}

class SpatialView extends View {

  constructor(scene, domElement, viewHelperDomElement) {
    super(View.createOrthoCamera(scene.width / scene.height), domElement, scene);

    this.overviewCamera = View.createOrthoCamera(1);
    this.overviewCamera.layers.disable(1);
    this.overviewCamera.layers.enable(31);

    this.control = new OrbitControls(this.camera, this.domElement);
    this.control.update();
    this.control.addEventListener('end', () => {
      const newpos = this.camera.position.clone().sub(this.control.target);
      this.overviewCamera.position.copy(this.target.clone().add(newpos));
      this.overviewCamera.rotation.copy(this.camera.rotation);
      this.overviewCamera.updateProjectionMatrix();
      this.updateFrustumFrame();
      this.renderView();
    });
    this.control.addEventListener('change', () => {
      this.renderView();
    });

    this.viewHelper = new ViewHelper(this.camera, this.domElement, new THREE.Vector3(0, 0, 0));
    this.viewHelper.setLabels('x', 'y', 'z');
    this.viewHelper.setLabelStyle('28px Arial', 'black', 18);

    function getSpriteMaterial(color, radius = 18) {
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;

      const context = canvas.getContext('2d');
      context.beginPath();
      context.arc(32, 32, radius, 0, 2 * Math.PI);
      context.closePath();
      context.fillStyle = color;
      context.fill();

      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      return new THREE.SpriteMaterial({ map: texture, toneMapped: false });
    }
    const colorMap = new Map([
      ['negX', '#ff4466'],
      ['negY', '#88ff44'],
      ['negZ', '#4488ff']
    ]);

    this.viewHelper.children.forEach((ah) => {
      if (colorMap.has(ah.userData.type)) {
        const mat = getSpriteMaterial(colorMap.get(ah.userData.type));
        ah.material = mat;
        ah.material.opacity = 0.4;
      }
    });
    viewHelperDomElement.addEventListener('pointerup', (event) => {
      event.stopPropagation();
      this.viewHelper.handleClick(event);

    });

    viewHelperDomElement.addEventListener('pointerdown', function (event) {
      event.stopPropagation();
    });
    this.animatedPreviously = false;

    this.enabled = false;
    this.control.enabled = false;
    this.initiated = false;
  }

  getCameraRelativePosition(target) {
    return new THREE.Vector3(target.x, target.y, target.z + 100);
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

      this.control.target = center;
      this.target = center;
      this.control.update();

      const newpos = this.camera.position.clone().sub(this.control.target);
      this.overviewCamera.position.copy(this.target.clone().add(newpos));
      this.overviewCamera.lookAt(this.target);
      this.overviewCamera.updateProjectionMatrix();
      this.renderView();

      this.animatedPreviously = false;
    }
  }

  activate() {
    super.activate();
    this.control.enabled = true;
  }

  deactivate() {
    super.deactivate();
    this.control.enabled = false;
  }
}

class PlanView extends View {

  constructor(scene, domElement, ratioIndicatorWidth = 200, compassSize = 100) {
    super(View.createOrthoCamera(scene.width / scene.height), domElement, scene);

    this.spriteCamera = new THREE.OrthographicCamera( //TODO: standardize ortho camera creation (static methon in view)
      -scene.width / 2,
      scene.width / 2,
      scene.height / 2,
      -scene.height / 2,
      0,
      10
    );
    this.spriteCamera.position.z = 1;

    this.overviewCamera = View.createOrthoCamera(1);
    this.overviewCamera.layers.disable(1);
    this.overviewCamera.layers.enable(31);

    this.control = new SimpleOrbitControl(this.camera, domElement, COORDINATE_INDEX.Z);

    this.compass = this.#createCompass(compassSize);
    scene.sprites3DGroup.add(this.compass);

    this.ratio = this.#createRatioIndicator(ratioIndicatorWidth);
    scene.sprites3DGroup.add(this.ratio);
    this.ratio.onclick = () => {
      this.#setRatio();
    };

    this.ratioText = this.#createRatioText();
    const ratioTextSprite = this.ratioText.getSprite();
    scene.sprites3DGroup.add(ratioTextSprite);
    ratioTextSprite.onclick = () => {
      this.#setRatio();
    };

    this.initiated = false;
    this.enabled = false;
    this.addListener('orbitChange', (e) => this.#handleControlChange(e));
    this.addListener('pointermove', (e) => this.control.onMove(e));
    this.addListener('pointerdown', (e) => this.control.onDown(e));
    this.addListener('pointerup', () => this.control.onUp());
    this.addListener('wheel', (e) => this.control.onWheel(e));
  }

  #setRatio() {
    const ratioRaw = prompt('Enter the ratio values');
    if (!Number.isInteger(Number.parseInt(ratioRaw, 10))) {
      showWarningPanel(`Ratio '${ratioRaw}' is not an integer`);
      return;
    }
    const ratioValue = Number.parseInt(ratioRaw);
    if (ratioValue <= 0) {
      showWarningPanel('Ratio must be a positive number');
      return;
    } else {
      const level = this.camera.width / (ratioValue * (this.scene.width / this.ratio.width));
      this.control.setZoomLevel(level);
    }
  }

  onZoomLevelChange(level) {
    const worldWidth = this.camera.width / level;
    const ratio = worldWidth / (this.scene.width / this.ratio.width);
    let ratioText;
    if (ratio <= 15) {
      ratioText = ratio.toFixed(1);
    } else {
      ratioText = Math.ceil(ratio);
    }
    this.ratioText.update(`${ratioText} m`);
  }

  zoomCameraTo(level) {
    super.zoomCameraTo(level);
    this.onZoomLevelChange(level);
  }

  #handleControlChange(e) {
    if (e.detail.reason === 'rotate') {
      const rotation = e.detail.value.rotation;
      this.compass.material.rotation = -rotation;
    }

    if (e.detail.reason === 'rotateEnd') {
      this.overviewCamera.rotation.z = this.camera.rotation.z;
      this.overviewCamera.updateProjectionMatrix();
      this.updateFrustumFrame();
    }

    if (e.detail.reason === 'zoom') {
      this.onZoomLevelChange(e.detail.value.level);
      this.updateFrustumFrame();
    }

    if (e.detail.reason === 'panEnd') {
      this.updateFrustumFrame();
    }

    this.renderView();
  }

  getCameraRelativePosition(target) {
    return new THREE.Vector3(target.x, target.y, target.z + 100);
  }

  onResize(width, height) {
    super.onResize(width, height);
    this.compass.position.set(width / 2 - 60, -height / 2 + 60, 1); // bottom right
    this.ratioText.getSprite().position.set(0, -this.scene.height / 2 + 45, 1);
    this.ratio.position.set(0, -this.scene.height / 2 + 20, 1);
    this.spriteCamera.left = -width / 2;
    this.spriteCamera.right = width / 2;
    this.spriteCamera.top = height / 2;
    this.spriteCamera.bottom = -height / 2;
    this.spriteCamera.updateProjectionMatrix();
    this.onZoomLevelChange(this.camera.zoom);

  }

  #createCompass(size) {
    const map = new THREE.TextureLoader().load('images/compass.png');
    map.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.SpriteMaterial({ map: map });
    const sprite = new THREE.Sprite(material);
    sprite.center.set(0.5, 0.5);
    sprite.scale.set(size, size, 1);
    sprite.position.set(this.scene.width / 2 - 60, -this.scene.height / 2 + 60, 1); // bottom right
    return sprite;
  }

  #createRatioText() {
    //https://discourse.threejs.org/t/how-to-update-text-in-real-time/39050/12
    const position = new THREE.Vector3(0, -this.scene.height / 2 + 40, 1);
    return new TextSprite('0', position, { size: 35, family: 'Helvetica Neue', strokeColor: 'black' }, 0.5);

  }

  #createRatioIndicator(width) {
    const map = new THREE.TextureLoader().load('images/ratio.png');
    map.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.SpriteMaterial({ map: map, color: 0xffffff });
    const sprite = new THREE.Sprite(material);
    sprite.center.set(0.5, 0.5);
    sprite.scale.set(width, (width / 755) * 36, 1);
    sprite.position.set(0, -this.scene.height / 2 + 20, 1); // bottom right
    sprite.width = width; // custom property
    return sprite;
  }
}

class ProfileView extends View {

  constructor(scene, domElement) {
    super(View.createOrthoCamera(scene.width / scene.height), domElement, scene);

    this.overviewCamera = View.createOrthoCamera(1);
    this.overviewCamera.layers.disable(1);
    this.overviewCamera.layers.enable(31);

    this.control = new SimpleOrbitControl(this.camera, domElement, COORDINATE_INDEX.Y);

    this.initiated = false;
    this.enabled = false;
    this.addListener('orbitChange', (e) => this.#handleControlChange(e));
    this.addListener('pointermove', (e) => this.control.onMove(e));
    this.addListener('pointerdown', (e) => this.control.onDown(e));
    this.addListener('pointerup', () => this.control.onUp());
    this.addListener('wheel', (e) => this.control.onWheel(e));
  }

  #handleControlChange(e) {

    if (e.detail.reason === 'rotateEnd') {
      this.overviewCamera.rotation.y = this.camera.rotation.y;
      this.overviewCamera.updateProjectionMatrix();
      this.updateFrustumFrame();
    }

    if (e.detail.reason === 'zoom') {
      this.updateFrustumFrame();
    }

    if (e.detail.reason === 'panEnd') {
      this.updateFrustumFrame();
    }

    this.renderView();
  }

  getCameraRelativePosition(target) {
    return new THREE.Vector3(target.x, target.y - 1, target.z);
  }

}

export { SpatialView, PlanView, ProfileView };
