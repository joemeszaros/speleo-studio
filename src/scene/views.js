import * as THREE from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { TextSprite } from './textsprite.js';
import { showWarningPanel } from '../ui/popups.js';
import { ViewHelper } from '../utils/viewhelper.js';
import { degreesToRads, formatDistance, radsToDegrees } from '../utils/utils.js';
import { ProfileViewControl, PlanViewControl, SpatialViewControl } from './control.js';

class View {

  // Dedicated ratio values commonly used in cave surveying
  static DEDICATED_RATIOS = [5, 10, 25, 50, 100, 200, 500, 1000, 2000, 5000, 10000];

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

    this.compass = this.#createCompass(100);
    this.compass.visible = false;
    scene.sprites3DGroup.add(this.compass);

    this.rotationText = this.#createRotationText();
    this.rotationText.name = `rotation text ${this.name}`;
    this.rotationText.sprite.visible = false;
    const rotationTextSprite = this.rotationText.getSprite();
    scene.sprites3DGroup.add(rotationTextSprite);
    rotationTextSprite.onclick = () => {
      this.setCompassRotation();
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

  recreateAllTextSprites() {

    let label = this.ratioText.label;
    let prevVisible = this.ratioText.sprite.visible;
    this.diposeSprite(this.ratioText.getSprite(), this.scene.sprites3DGroup);
    this.ratioText = this.#createRatioText(label);
    this.ratioText.sprite.visible = prevVisible;
    const ratioTextSprite = this.ratioText.getSprite();
    this.scene.sprites3DGroup.add(ratioTextSprite);
    ratioTextSprite.onclick = () => {
      this.#setRatio();
    };

    prevVisible = this.rotationText.sprite.visible;
    label = this.rotationText.label;
    this.diposeSprite(this.rotationText.getSprite(), this.scene.sprites3DGroup);
    this.rotationText = this.#createRotationText(label);
    this.rotationText.sprite.visible = prevVisible;
    const rotationTextSprite = this.rotationText.getSprite();
    this.scene.sprites3DGroup.add(rotationTextSprite);
    rotationTextSprite.onclick = () => {
      this.setCompassRotation();
    };

  }

  #createRatioText(text = '0') {
    //https://discourse.threejs.org/t/how-to-update-text-in-real-time/39050/12
    const position = new THREE.Vector3(0, -this.scene.height / 2 + 40, 1);
    return new TextSprite(
      text,
      position,
      {
        size        : 45,
        family      : 'Helvetica Neue',
        strokeColor : this.scene.options.scene.sprites3D.textStroke,
        color       : this.scene.options.scene.sprites3D.textColor
      },
      0.4,
      `ratio text ${this.name}`
    );
  }

  #createRatioIndicator(width) {
    const map = new THREE.TextureLoader().load(
      'images/ratio.png',
      () => {
        // Force a render update when texture loads
        this.scene.view.renderView();

      },
      undefined,
      (error) => {
        console.error('Failed to load ratio indicator texture:', error);
      }
    );
    map.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.SpriteMaterial({ map: map, color: 0xffffff });
    const sprite = new THREE.Sprite(material);
    sprite.center.set(0.5, 0.5);
    sprite.scale.set(width, (width / 755) * 36, 1); // 755 is the width of the image, 36 is the height of the image
    sprite.position.set(0, -this.scene.height / 2 + 20, 1); // bottom right
    sprite.width = width; // custom property
    sprite.name = `ratio ruler ${this.name}`;
    return sprite;
  }

  #createCompass(size) {
    const map = new THREE.TextureLoader().load(
      'images/compass.png',
      () => {
        // Force a render update when texture loads
        this.scene.view.renderView();
      },
      undefined,
      (error) => {
        console.error('Failed to load compass texture:', error);
      }
    );
    map.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.SpriteMaterial({ map: map });
    const sprite = new THREE.Sprite(material);
    sprite.center.set(0.5, 0.5);
    sprite.scale.set(size, size, 1);
    sprite.position.set(this.scene.width / 2 - 60, -this.scene.height / 2 + 60, 1); // bottom right
    sprite.name = `compass ${this.name}`;
    return sprite;
  }

  #createRotationText(text = '0°') {
    const position = new THREE.Vector3(this.scene.width / 2 - 60, -this.scene.height / 2 + 120, 1);
    return new TextSprite(
      text,
      position,
      {
        size        : 45,
        family      : 'Helvetica Neue',
        strokeColor : this.scene.options.scene.sprites3D.textStroke,
        color       : this.scene.options.scene.sprites3D.textColor
      },
      0.4,
      `rotation text ${this.name}`
    );
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

  #roundToDedicatedRatio(ratio) {
    // Find the closest dedicated ratio
    let closest = View.DEDICATED_RATIOS[0];
    let minDiff = Math.abs(ratio - closest);

    for (const dedicated of View.DEDICATED_RATIOS) {
      const diff = Math.abs(ratio - dedicated);
      if (diff < minDiff) {
        minDiff = diff;
        closest = dedicated;
      }
    }

    return closest;
  }

  onZoomLevelChange(level) {
    this.updateRationSprites(level);
  }

  updateRationSprites(level) {
    const cmInPixels = this.dpi / 2.54;
    const worldWidthInMeters = this.camera.width / level;
    const screenInCentimeters = window.screen.width / cmInPixels;
    const rawRatio = (worldWidthInMeters * 100) / screenInCentimeters;

    const roundedRatio = this.#roundToDedicatedRatio(rawRatio);
    // Round to dedicated ratio
    this.ratio = rawRatio;

    // Calculate dynamic ruler width based on the rounded ratio
    // Target: ruler should represent a nice round distance (e.g., 1m, 5m, 10m, 50m, 100m)
    const targetRulerDistance = this.getTargetRulerDistance(roundedRatio);
    const rulerWidthInMeters = targetRulerDistance;
    const rulerWidthInPixels = (rulerWidthInMeters / worldWidthInMeters) * this.scene.width;

    this.ratioIndicator.width = Math.max(50, Math.min(400, rulerWidthInPixels)); // between 50-400px
    this.ratioIndicator.scale.set(this.ratioIndicator.width, 15, 1);

    const ratioText = `${formatDistance(rulerWidthInMeters)} - M 1:${Math.floor(this.ratio)}`;
    this.ratioText.update(`${ratioText}`);
  }

  getTargetRulerDistance(ratio) {
    // Map ratios to appropriate ruler distances
    const ratioToDistance = {
      5     : 1, // 1m for very detailed views
      10    : 1, // 1m for very detailed views
      25    : 5, // 5m for detailed views
      50    : 5, // 5m for detailed views
      100   : 10, // 10m for medium views
      200   : 20, // 20m for medium views
      500   : 50, // 50m for overview views
      1000  : 100, // 100m for overview views
      2000  : 200, // 200m for wide views
      5000  : 500, // 500m for very wide views
      10000 : 1000 // 1000m for extremely wide views
    };

    // Find the closest dedicated ratio
    let closest = View.DEDICATED_RATIOS[0];
    let minDiff = Math.abs(ratio - closest);

    for (const dedicated of View.DEDICATED_RATIOS) {
      const diff = Math.abs(ratio - dedicated);
      if (diff < minDiff) {
        minDiff = diff;
        closest = dedicated;
      }
    }

    return ratioToDistance[closest];
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

    // Update compass and rotation text positions
    this.compass.position.set(width / 2 - 60, -height / 2 + 60, 1);
    this.rotationText.sprite.position.set(width / 2 - 60, -height / 2 + 120, 1);

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

  diposeSprite(sprite, group) {
    group.remove(sprite);
    sprite.visible = false;
    sprite.material.map.dispose();
    sprite.geometry.dispose();
    sprite.material.dispose();
  }

  toggleSpriteVisibility(spriteType, visible) {
    switch (spriteType) {
      case 'ruler':
        this.ratioIndicator.visible = visible;
        this.ratioText.sprite.visible = visible;
        break;
      case 'compass':
        this.compass.visible = visible;
        this.rotationText.sprite.visible = visible;
        break;
    }
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
      this.ratioIndicator.visible = this.scene.options.scene.sprites3D.ruler.show;
      this.ratioText.sprite.visible = this.scene.options.scene.sprites3D.ruler.show;
      this.compass.visible = this.scene.options.scene.sprites3D.compass.show;
      this.rotationText.sprite.visible = this.scene.options.scene.sprites3D.compass.show;
    }

    this.dispatchEvent('viewActivated', { name: this.name });
  }

  deactivate() {
    if (this.initiated) {
      this.ratioIndicator.visible = false;
      this.ratioText.sprite.visible = false;
      this.compass.visible = false;
      this.rotationText.sprite.visible = false;
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

  constructor(scene, domElement) {
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

    this.viewHelper = new ViewHelper(this.camera, this.domElement, this.control, {
      labelX : 'x',
      labelY : 'y',
      labelZ : 'z',
      font   : '28px Arial',
      color  : 'black',
      radius : 18
    });

    // Add dip indicator (gyroscope-style)
    this.dipIndicator = this.#createDipIndicator(80);
    this.dipIndicator.visible = false;
    scene.sprites3DGroup.add(this.dipIndicator);

    // Add dip text display
    this.dipText = this.#createDipText();
    this.dipText.sprite.visible = false;
    const dipTextSprite = this.dipText.getSprite();
    scene.sprites3DGroup.add(dipTextSprite);

    this.animatedPreviously = false;

    this.enabled = false;
    this.control.enabled = false;
    this.initiated = false;
  }

  onOrbitAdjustment(e) {
    if (e.type === 'rotate') {
      //Update compass rotation based on camera azimuth
      let compassRotation = this.control.azimuth + Math.PI;
      if (compassRotation < 0) {
        compassRotation += 2 * Math.PI;
      }
      compassRotation = compassRotation % (2 * Math.PI);

      this.compass.material.rotation = compassRotation;
      this.#updateRotationText();
      this.#updateDipIndicator();
    } else if (e.type === 'zoom') {
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
    this.#updateDipIndicator();
    this.renderView();
    this.onZoomLevelChange(this.control.zoom);
    this.isInteracting = false;
  }

  onResize(width, height) {
    super.onResize(width, height);
    this.dipIndicator.position.set(width / 2 - 170, -height / 2 + 60, 1);
    this.dipText.sprite.position.set(width / 2 - 170, -height / 2 + 120, 1);
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

  #updateRotationText() {
    // For spatial view, calculate azimuth from camera position and target
    let compassRotation = 2 * Math.PI - this.compass.material.rotation;
    if (compassRotation === 2 * Math.PI) compassRotation = 0;
    this.rotationText.update(`N ${radsToDegrees(compassRotation).toFixed(1)}°`);
  }

  #createDipIndicator(size) {
    // Create a gyroscope-style dip indicator using a canvas
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const width = size;
    const height = size;

    canvas.width = width;
    canvas.height = height;

    // Draw the gyroscope background
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = size / 2 - 5;

    // Outer circle (background)
    ctx.fillStyle = '#2c3e50';
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
    ctx.fill();

    // Inner circle (foreground)
    ctx.fillStyle = '#34495e';
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius - 8, 0, 2 * Math.PI);
    ctx.fill();

    // Horizon line
    ctx.strokeStyle = '#ecf0f1';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(centerX - radius + 10, centerY);
    ctx.lineTo(centerX + radius - 10, centerY);
    ctx.stroke();

    // Center cross
    ctx.strokeStyle = '#ecf0f1';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(centerX - 8, centerY);
    ctx.lineTo(centerX + 8, centerY);
    ctx.moveTo(centerX, centerY - 8);
    ctx.lineTo(centerX, centerY + 8);
    ctx.stroke();

    // Create texture from canvas
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
    const sprite = new THREE.Sprite(material);

    // Store canvas and context references for later updates
    sprite.userData = { canvas, ctx, width, height };
    sprite.position.set(this.scene.width / 2 - 170, -this.scene.height / 2 + 60, 1); // bottom right
    sprite.scale.set(size, size, 1);
    sprite.name = 'dip indicator';

    return sprite;
  }

  #createDipText(text = '0°') {
    const position = new THREE.Vector3(this.scene.width / 2 - 170, -this.scene.height / 2 + 120, 1);
    return new TextSprite(
      text,
      position,
      {
        size        : 45,
        family      : 'Helvetica Neue',
        strokeColor : this.scene.options.scene.sprites3D?.textStroke ?? '#000000',
        color       : this.scene.options.scene.sprites3D?.textColor ?? '#ffffff'
      },
      0.4,
      'dip text'
    );
  }

  #updateDipIndicator() {
    const dipDegrees = radsToDegrees(this.control.clino);
    let rounded = Math.round(dipDegrees);
    if (rounded === 89) rounded = 90;
    if (rounded === -89) rounded = -90;
    this.dipText.update(`${rounded}°`);
    this.#updateGyroscopeVisual(this.control.clino, true);
  }

  #updateGyroscopeVisual(dipAngle) {
    // Get the context and dimensions from userData
    const { ctx, width, height } = this.dipIndicator.userData;

    // Clear the canvas
    ctx.clearRect(0, 0, width, height);

    const centerX = width / 2;
    const centerY = height / 2;
    const radius = width / 2 - 5;

    // Outer circle (background)
    ctx.fillStyle = '#2c3e50';
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.fill();

    // Inner circle (foreground)
    ctx.fillStyle = '#34495e';
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius - 8, 0, 2 * Math.PI);
    ctx.fill();

    // Calculate horizon line position based on dip angle
    // Map 0-90 degrees to 0-1 range for visual offset
    const normalizedAngle = dipAngle / (Math.PI / 2); // 0 to 1
    const maxOffset = radius - 10;
    const horizonOffset = normalizedAngle * maxOffset;
    const horizonY = centerY - horizonOffset;

    // Add angle markers for reference
    //ctx.strokeStyle = '#7f8c8d';
    ctx.font = '10px Arial';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';

    // Draw angle markers every 30 degrees
    const angles = [90];
    angles.forEach((angle) => {
      const normalizedMarkerAngle = angle / 90; // 0 to 1
      const markerOffset = normalizedMarkerAngle * maxOffset;
      const markerY = centerY + markerOffset;

      // Top markers (looking up)
      if (markerY > centerY - 5) {
        ctx.beginPath();
        ctx.moveTo(centerX - 5, markerY);
        //ctx.lineTo(centerX + 5, markerY);
        ctx.stroke();
        ctx.fillText(`${-angle}°`, centerX, markerY - 3);
      }

      // Bottom markers (looking down)
      const bottomMarkerY = centerY - markerOffset;
      if (bottomMarkerY < centerY + 5) {
        ctx.beginPath();
        ctx.moveTo(centerX - 5, bottomMarkerY);
        //ctx.lineTo(centerX + 5, bottomMarkerY);
        ctx.stroke();
        ctx.fillText(`${angle}°`, centerX, bottomMarkerY + 13);
      }
    });

    // Center cross
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(centerX - 5, centerY);
    ctx.lineTo(centerX + 5, centerY);
    ctx.moveTo(centerX, centerY - 5);
    ctx.lineTo(centerX, centerY + 5);
    ctx.stroke();

    // Draw horizon line
    ctx.strokeStyle = '#ff0000';
    ctx.lineWidth = 2;
    ctx.beginPath();
    const lineLength = 15 + radius * (1 - Math.abs(normalizedAngle));
    ctx.moveTo(centerX - lineLength + 5, horizonY);
    ctx.lineTo(centerX + lineLength - 5, horizonY);
    ctx.stroke();

    // Update the texture
    this.dipIndicator.material.map.needsUpdate = true;
  }
  recreateAllTextSprites() {

    super.recreateAllTextSprites();
    let label = this.dipText.label;
    let prevVisible = this.dipText.sprite.visible;
    this.diposeSprite(this.dipText.getSprite(), this.scene.sprites3DGroup);
    this.dipText = this.#createDipText(label);
    this.dipText.sprite.visible = prevVisible;
    const dipTextSprite = this.dipText.getSprite();
    this.scene.sprites3DGroup.add(dipTextSprite);
    dipTextSprite.onclick = () => {
      this.#updateDipIndicator();
    };
  }

  toggleSpriteVisibility(spriteType, visible) {
    super.toggleSpriteVisibility(spriteType, visible);

    switch (spriteType) {
      case 'dip':
        this.dipIndicator.visible = visible;
        this.dipText.sprite.visible = visible;
        break;
    }
  }

  setCompassRotation() {
    const currentAzimuth = 2 * Math.PI - (this.control.azimuth + Math.PI);
    const currentRotation = radsToDegrees(currentAzimuth).toFixed(1);
    const rotationRaw = prompt('Enter rotation value in degrees', currentRotation);
    if (rotationRaw === null) return;

    const rotationValue = parseFloat(rotationRaw);
    if (isNaN(rotationValue)) {
      showWarningPanel(`Rotation '${rotationRaw}' is not a valid number`);
      return;
    }

    let rotationRadians = 2 * Math.PI - (degreesToRads(rotationValue) + Math.PI);
    if (rotationRadians < 0) rotationRadians += 2 * Math.PI;

    this.control.setCameraOrientation(this.control.distance, rotationRadians, this.control.clino);

    this.updateFrustumFrame();
    this.renderView();

    this.control.dispatchEvent('orbitChange', { type: 'rotate', azimuth: rotationRadians });
  }

  activate(boundingBox) {
    super.activate(boundingBox);
    this.dipIndicator.visible = this.scene.options.scene.sprites3D.dip.show;
    this.dipText.sprite.visible = this.scene.options.scene.sprites3D.dip.show;
    this.control.enabled = true;
    this.#updateRotationText();
    this.#updateDipIndicator();
    this.renderView();
  }

  deactivate() {
    super.deactivate();
    this.dipIndicator.visible = false;
    this.dipText.sprite.visible = false;
    this.control.enabled = false;
  }
}

class PlanView extends View {

  constructor(scene, domElement) {
    super('planView', View.createOrthoCamera(scene.width / scene.height), domElement, scene);

    this.overviewCamera = View.createOrthoCamera(1);
    this.overviewCamera.layers.disable(1);
    this.overviewCamera.layers.enable(31);

    this.control = new PlanViewControl(this.camera, domElement);

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
  }

  #updateRotationText() {
    const rotationDegrees = radsToDegrees(this.camera.rotation.z).toFixed(1);
    this.rotationText.update(`N ${rotationDegrees}°`);
  }

  setCompassRotation() {
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
    this.compass.material.rotation = 0;
    this.#updateRotationText();
    this.renderView();
  }

  deactivate() {
    super.deactivate();
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
    this.control = new ProfileViewControl(this.camera, this.domElement, Math.PI);

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
    if (e.type === 'rotate') {
      // Update compass rotation based on camera angle (opposite direction + 180° shift like plan view)
      this.compass.material.rotation = e.angle + Math.PI;
      // Update rotation text during rotation
      this.#updateRotationText();
    } else if (e.type === 'zoom') {
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
    this.#updateVerticalRuler(level);
  }

  #updateVerticalRuler(level) {
    const worldHeightInMeters = this.camera.height / level;
    // Use the same target distance as horizontal ruler for consistency
    const targetRulerDistance = this.getTargetRulerDistance(this.ratio);
    const verticalIndicatorHeightInMeters = targetRulerDistance;
    const verticalIndicatorHeightInPixels = (verticalIndicatorHeightInMeters / worldHeightInMeters) * this.scene.height;
    this.verticalRatioIndicatorHeight = Math.max(50, Math.min(600, verticalIndicatorHeightInPixels));
    this.verticalRuler.scale.set(15, this.verticalRatioIndicatorHeight, 1);
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

  #createVerticalRatioText(text = '0') {
    // Create vertical ratio text similar to horizontal ratio text
    const position = new THREE.Vector3(this.scene.width / 2 - 80, 0, 1);
    return new TextSprite(
      text,
      position,
      {
        size        : 35,
        family      : 'Helvetica Neue',
        color       : this.scene.options.scene.sprites3D.textColor,
        strokeColor : this.scene.options.scene.sprites3D.textStroke
      },
      0.5,
      'vertical ratio text'
    );
  }

  #updateRotationText() {
    // For profile view, use the camera angle from the control

    let compassRotation = 2 * Math.PI - this.compass.material.rotation;
    if (compassRotation < 0) compassRotation += 2 * Math.PI;
    if (compassRotation === 2 * Math.PI) compassRotation = 0; // show 0 not 360
    this.rotationText.update(`N ${radsToDegrees(compassRotation).toFixed(1)}°`);
  }

  recreateAllTextSprites() {
    super.recreateAllTextSprites();
    let label = this.verticalRatioText.label;
    let prevVisible = this.verticalRatioText.sprite.visible;
    this.diposeSprite(this.verticalRatioText.getSprite(), this.scene.sprites3DGroup);
    this.verticalRatioText = this.#createVerticalRatioText(label);
    this.verticalRatioText.sprite.visible = prevVisible;
    const verticalRatioTextSprite = this.verticalRatioText.getSprite();
    this.scene.sprites3DGroup.add(verticalRatioTextSprite);
    this.#updateRotationText();
    this.#updateVerticalRuler(this.control.zoom);
  }

  toggleSpriteVisibility(spriteType, visible) {
    super.toggleSpriteVisibility(spriteType, visible);

    switch (spriteType) {
      case 'ruler':
        this.verticalRuler.visible = visible;
        this.verticalRatioText.sprite.visible = visible;
        break;
    }
  }

  setCompassRotation() {
    const currentRotation = ((this.control.angle * 180) / Math.PI).toFixed(1);
    const rotationRaw = prompt('Enter rotation value in degrees', currentRotation);
    if (rotationRaw === null) return;

    const rotationValue = parseFloat(rotationRaw);
    if (isNaN(rotationValue)) {
      showWarningPanel(`Rotation '${rotationRaw}' is not a valid number`);
      return;
    }

    // Convert degrees to radians and set camera angle
    let rotationRadians = degreesToRads(rotationValue) + (Math.PI % (2 * Math.PI));
    if (rotationRadians < 0) rotationRadians += 2 * Math.PI;
    this.control.angle = rotationRadians;
    this.control.updateCameraPosition();

    // Update frustum frame and render
    this.updateFrustumFrame();
    this.renderView();

    // Dispatch rotation change event
    this.control.dispatchEvent('orbitChange', { type: 'rotate', angle: rotationRadians });
  }

  activate(boundingBox) {
    super.activate(boundingBox);
    this.control.enabled = true;
    this.verticalRuler.visible = this.scene.options.scene.sprites3D.ruler.show;
    this.verticalRatioText.sprite.visible = this.scene.options.scene.sprites3D.ruler.show;
    this.compass.material.rotation = -this.control.angle + Math.PI;
    this.#updateRotationText();
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
