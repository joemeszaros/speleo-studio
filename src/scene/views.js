/*
 * Copyright 2024 Joe Meszaros
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as THREE from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { TextSprite } from './textsprite.js';
import { showWarningPanel } from '../ui/popups.js';
import { ViewHelper } from '../utils/viewhelper.js';
import { degreesToRads, formatDistance, formatElevation, radsToDegrees } from '../utils/utils.js';
import {
  ProfileViewControl,
  PlanViewControl,
  SpatialOrthographicControl,
  SpatialPerspectiveControl
} from './control.js';
import { i18n } from '../i18n/i18n.js';
import { globalNormalizer } from '../utils/global-coordinate-normalizer.js';

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
    this.compass.onclick = () => {
      this.setCompassRotation();
    };

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
        size        : 19,
        family      : 'Helvetica Neue',
        strokeColor : this.scene.options.scene.sprites3D.textStroke,
        color       : this.scene.options.scene.sprites3D.textColor
      },
      1.0,
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
        size        : 19,
        family      : 'Helvetica Neue',
        strokeColor : this.scene.options.scene.sprites3D.textStroke,
        color       : this.scene.options.scene.sprites3D.textColor
      },
      1.0,
      `rotation text ${this.name}`
    );
  }

  #setRatio() {
    // Math.round() is used to avoid floating-point precision issues (e.g., 99.999... -> 100)
    const ratioRaw = prompt(i18n.t('errors.views.enterRatioValue'), Math.round(this.ratio));
    if (ratioRaw === null) return;
    if (!Number.isInteger(Number.parseInt(ratioRaw, 10))) {
      showWarningPanel(i18n.t('errors.views.ratioNotInteger', { ratio: ratioRaw }));
      return;
    }
    const ratioValue = Number.parseInt(ratioRaw);
    if (ratioValue <= 0) {
      showWarningPanel(i18n.t('errors.views.ratioMustBePositive'));
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

  roundToDedicatedRatio(ratio) {
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
    document.dispatchEvent(new CustomEvent('zoomLevelChanged', { detail: { level } }));
  }

  updateRationSprites(level) {
    const cmInPixels = this.dpi / 2.54;
    const worldWidthInMeters = this.camera.width / level;
    const screenInCentimeters = window.screen.width / cmInPixels;
    const rawRatio = (worldWidthInMeters * 100) / screenInCentimeters;

    const roundedRatio = this.roundToDedicatedRatio(rawRatio);
    // Round to dedicated ratio
    this.ratio = rawRatio;

    // Calculate dynamic ruler width based on the rounded ratio
    // Target: ruler should represent a nice round distance (e.g., 1m, 5m, 10m, 50m, 100m)
    const targetRulerDistance = this.getTargetRulerDistance(roundedRatio);
    const rulerWidthInMeters = targetRulerDistance;
    const rulerWidthInPixels = (rulerWidthInMeters / worldWidthInMeters) * this.scene.width;

    this.ratioIndicator.width = Math.max(50, Math.min(400, rulerWidthInPixels)); // between 50-400px
    this.ratioIndicator.scale.set(this.ratioIndicator.width, 15, 1);

    const ratioText = `${formatDistance(rulerWidthInMeters)} - M 1:${Math.round(this.ratio)}`;
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
    } else if (this.camera.isPerspectiveCamera) {
      this.camera.aspect = width / height;
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
    this.control.onResize();

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

    // Center the camera on the bounding box
    const center = boundingBox.getCenter(new THREE.Vector3());
    this.target.copy(center);
    this.control.setTarget(center);
    this.control.updateCameraPosition();

    const rotation = new THREE.Matrix4().extractRotation(this.camera.matrix);
    boundingBox.applyMatrix4(rotation); // this is a side effect if fitScreen() is called multiple times
    const width = boundingBox.max.x - boundingBox.min.x;
    const height = boundingBox.max.y - boundingBox.min.y;
    const zoomLevel = Math.min(this.camera.width / width, this.camera.height / height); // camera width and height in world units
    this.control.setZoomLevel(zoomLevel);

    this.updateOverviewCameraZoom(boundingBox);
    if (this.frustumFrame) this.updateFrustumFrame();
    this.onZoomLevelChange(zoomLevel);
    this.renderView();
  }

  panCameraTo(position) {
    const pos = position.clone();
    this.target.copy(pos);
    this.control.setTarget(pos);
    this.control.updateCameraPosition();
    this.renderView();
  }

  setOverviewCameraTo(position) {
    this.overviewCamera.position.copy(position);
    this.overviewCamera.lookAt(this.target);
    this.overviewCamera.updateProjectionMatrix();
    this.scene.renderOverview(this.overviewCamera);
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
    this.scene.renderOverview(this.overviewCamera);
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
      vertexColors : false,
      depthTest    : false,
      transparent  : true
    });
    this.frustumFrame = new LineSegments2(geometry, material);
    this.frustumFrame.layers.set(31);
    this.frustumFrame.renderOrder = 999;
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
    this.scene.renderScene(this.camera, this.spriteCamera);
    if (!this.isInteracting) {
      this.scene.renderOverview(this.overviewCamera);
    }
  }

  onOrbitAdjustment() {
    this.scene.updatePointCloudLOD();
    this.renderView();
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
      this.scene.points.setCameraTargetPosition(this.control.getTarget()); // we have just a single sphere for all views
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
    camera.layers.enable(2);
    camera.layers.disable(31);
    return camera;
  }

  // Perspective counterpart used by SpatialView when the user chooses
  // projection = 'perspective'. Near is small (0.05 m) so the camera can
  // cross a chamber wall without clipping it; far is generous for caves.
  static createPerspectiveCamera(aspect, fov = 60) {
    const camera = new THREE.PerspectiveCamera(fov, aspect, 0.05, 100000);
    camera.layers.enable(0);
    camera.layers.enable(1);
    camera.layers.enable(2);
    camera.layers.disable(31);
    // Custom width/height stubs so inherited ortho-centric code doesn't NaN when
    // called in perspective mode (ratio sprites are hidden anyway).
    camera.width = 1;
    camera.height = 1;
    return camera;
  }

}

class SpatialView extends View {

  constructor(scene, domElement) {
    // Pass the orthographic camera to super() — it is the default projection.
    // The perspective camera is created just below and swapped in by setProjection().
    super('spatialView', View.createOrthoCamera(scene.width / scene.height), domElement, scene);

    this.overviewCamera = View.createOrthoCamera(1);
    this.overviewCamera.layers.disable(1);
    this.overviewCamera.layers.enable(2);
    this.overviewCamera.layers.enable(31);

    // Both projections share the scene graph; only the main view camera and
    // its control swap when the user toggles projection. Overview camera stays
    // orthographic (bird's-eye map style is always parallel).
    this.orthoCamera = this.camera;
    this.perspectiveCamera = View.createPerspectiveCamera(scene.width / scene.height);

    this.orthoControl = new SpatialOrthographicControl(this.orthoCamera, this.domElement);
    this.perspectiveControl = new SpatialPerspectiveControl(this.perspectiveCamera, this.domElement);

    // Honor the saved projection preference. SpatialView.setProjection() is
    // also called again when the user changes it at runtime via config.
    const savedProjection = scene.options?.scene?.spatialView?.projection;
    if (savedProjection === 'perspective') {
      this.projection = 'perspective';
      this.camera = this.perspectiveCamera;
      this.control = this.perspectiveControl;
    } else {
      this.projection = 'ortho';
      this.control = this.orthoControl;
    }

    // Attach listeners to both controls; handlers guard on `this.control` so
    // only events from the currently active control drive view updates.
    // Listeners are tagged as internal so setProjection() can distinguish them
    // from listeners attached by external code (headlight, attributes, etc.)
    // when migrating those across a projection swap.
    for (const c of [this.orthoControl, this.perspectiveControl]) {
      const startHandler = () => {
        if (c === this.control) this.isInteracting = true;
      };
      const endHandler = () => {
        if (c === this.control) this.onControlOperationEnd();
      };
      const orbitSetHandler = (e) => {
        if (c === this.control) this.onOrbitAdjustment(e);
      };
      const orbitChangeHandler = (e) => {
        if (c === this.control) this.onOrbitAdjustment(e);
      };
      startHandler._svInternal = true;
      endHandler._svInternal = true;
      orbitSetHandler._svInternal = true;
      orbitChangeHandler._svInternal = true;
      c.addEventListener('start', startHandler);
      c.addEventListener('end', endHandler);
      c.addEventListener('orbitSet', orbitSetHandler);
      c.addEventListener('orbitChange', orbitChangeHandler);
    }

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
    this.dipIndicator.onclick = () => {
      this.setDip();
    };

    // Add dip text display
    this.dipText = this.#createDipText();
    this.dipText.sprite.visible = false;
    const dipTextSprite = this.dipText.getSprite();
    scene.sprites3DGroup.add(dipTextSprite);
    dipTextSprite.onclick = () => {
      this.setDip();
    };

    this.animatedPreviously = false;

    this.enabled = false;
    this.orthoControl.enabled = false;
    this.perspectiveControl.enabled = false;
    this.initiated = false;
  }

  /**
   * Switch between orthographic and perspective projection. Camera pose
   * (target, azimuth, clino, distance) is preserved across the swap — both
   * controls share the SpatialControlBase state, so we just copy it over.
   */
  setProjection(mode) {
    if (mode !== 'ortho' && mode !== 'perspective') {
      throw new Error(`Unknown spatial projection: ${mode}`);
    }
    if (mode === this.projection) return;

    const oldControl = this.control;
    const wasEnabled = oldControl.enabled;
    const target = oldControl.getTarget();
    const { distance, azimuth, clino } = oldControl.getCameraOrientation();

    oldControl.enabled = false;

    const newControl = mode === 'perspective' ? this.perspectiveControl : this.orthoControl;
    const newCamera = mode === 'perspective' ? this.perspectiveCamera : this.orthoCamera;

    // Migrate listeners that external code attached to the old control (e.g.
    // ModelScene's headlight, AttributesScene's draft rotations, RotationTool).
    // Those callers captured `view.control` once and wouldn't otherwise see
    // events from the new control. SpatialView's own listeners are already on
    // both controls (tagged ._svInternal) so they are skipped here.
    if (oldControl !== newControl && oldControl.listeners) {
      for (const [eventType, listeners] of oldControl.listeners.entries()) {
        const newListeners = newControl.listeners.get(eventType) ?? [];
        const keepOnOld = [];
        for (const l of listeners) {
          if (l._svInternal) {
            keepOnOld.push(l);
          } else if (!newListeners.includes(l)) {
            newListeners.push(l);
          }
        }
        oldControl.listeners.set(eventType, keepOnOld);
        newControl.listeners.set(eventType, newListeners);
      }
    }

    // Preserve visual scale across the swap so the scene doesn't appear to
    // zoom in or out when toggling projection. Ortho shows (camera.height/zoom)
    // worth of world; perspective shows 2·tan(fov/2)·distance at pivot depth.
    let transferDistance = distance;
    let transferZoom = oldControl.zoom;
    if (mode === 'perspective' && oldControl.camera.isOrthographicCamera) {
      const visibleWorldHeight = oldControl.camera.height / (oldControl.zoom || 1);
      const fovRad = (this.perspectiveCamera.fov * Math.PI) / 180;
      transferDistance = visibleWorldHeight / (2 * Math.tan(fovRad / 2));
      transferZoom = 1;
    } else if (mode === 'ortho' && oldControl.camera.isPerspectiveCamera) {
      const fovRad = (oldControl.camera.fov * Math.PI) / 180;
      const visibleWorldHeight = 2 * Math.tan(fovRad / 2) * Math.max(Math.abs(oldControl.distance), 0.1);
      transferZoom = this.orthoCamera.height / visibleWorldHeight;
    }

    this.camera = newCamera;
    this.control = newControl;
    this.projection = mode;

    this.control.target.copy(target);
    this.control.distance = transferDistance;
    this.control.azimuth = azimuth;
    this.control.clino = clino;
    if (mode === 'ortho') {
      this.control.setZoomLevel(transferZoom);
    }

    // Refresh aspect / frustum for the newly active camera before first render.
    this.onResize(this.scene.width, this.scene.height);

    this.control.updateCameraPosition();
    this.control.enabled = wasEnabled;

    // Ratio bar is orthography-only; compass stays useful in both modes.
    const rulerVisible = this.scene.options.scene.sprites3D.ruler.show;
    this.ratioIndicator.visible = mode === 'ortho' && rulerVisible;
    this.ratioText.sprite.visible = mode === 'ortho' && rulerVisible;

    // Re-point the in-scene view helper at the new camera/control.
    if (this.viewHelper && typeof this.viewHelper.updateCameraAndControl === 'function') {
      this.viewHelper.updateCameraAndControl(this.camera, this.control);
    }

    this.scene.points.setCameraTargetPosition(this.control.getTarget());
    if (this.frustumFrame) this.updateFrustumFrame();
    this.scene.updatePointCloudLOD();
    this.renderView();
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
      this.scene.onRotate();
    } else if (e.type === 'zoom') {
      this.onZoomLevelChange(e.level);
      this.updateFrustumFrame();
    } else if (e.type === 'dolly') {
      // Perspective wheel-dolly: camera translates, frustum corners move too.
      this.updateFrustumFrame();
    } else if (e.type === 'pan') {
      this.scene.points.setCameraTargetPosition(this.control.getTarget());
    }
    super.onOrbitAdjustment();
  }

  onControlOperationEnd() {
    this.isInteracting = false;
    const newpos = this.camera.position.clone().sub(this.control.target);
    this.overviewCamera.position.copy(this.target.clone().add(newpos));
    this.overviewCamera.rotation.copy(this.camera.rotation);
    this.overviewCamera.updateProjectionMatrix();
    if (this.frustumFrame) this.updateFrustumFrame();
    this.#updateDipIndicator();
    this.scene.updatePointCloudLOD();
    this.renderView();
    if (this.projection === 'ortho') {
      this.onZoomLevelChange(this.control.zoom);
    }
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

  adjustCamera(boundingBox, changeOrientation = true) {
    const settings = this.getViewSettings(boundingBox);

    // Always keep the ortho frustum and overview ortho up-to-date so the user
    // can toggle projection without needing to re-fit. Perspective camera only
    // needs its aspect refreshed.
    View.updateCameraFrustum(this.orthoCamera, settings.frustumSize, this.scene.width / this.scene.height);
    View.updateCameraFrustum(this.overviewCamera, settings.frustumSize, 1);
    this.perspectiveCamera.aspect = this.scene.width / this.scene.height;
    this.perspectiveCamera.updateProjectionMatrix();

    this.control.setTarget(this.target);
    this.scene.points.setCameraTargetPosition(this.control.getTarget());
    if (changeOrientation) {
      // wihtout the Math.PI / 2 - 0.0001 Firefox renders the initial view 90 degree clockwise
      // the first rotation fixes the view but I rather decided to apply this delta
      this.control.setCameraOrientation(settings.distance, Math.PI, Math.PI / 2 - 0.001); // looking down from above
    }

    // Update camera position
    this.control.updateCameraPosition();

    // Update overview camera to match
    this.setOverviewCameraTo(this.camera.position);
  }

  /**
   * Override the inherited fitScreen — in perspective mode the ortho zoom-level
   * formula is meaningless. Instead, compute a dolly distance that frames the
   * bounding box within the current FOV.
   */
  fitScreen(boundingBox) {
    if (this.projection !== 'perspective') {
      return super.fitScreen(boundingBox);
    }
    if (boundingBox === undefined) return;

    const center = boundingBox.getCenter(new THREE.Vector3());
    this.target.copy(center);
    this.control.setTarget(center);

    const size = boundingBox.getSize(new THREE.Vector3());
    const maxExtent = Math.max(size.x, size.y, size.z);
    const fovRad = (this.camera.fov * Math.PI) / 180;
    // Distance so the bounding sphere fits vertically, with a little padding.
    const distance = (maxExtent / 2 / Math.tan(fovRad / 2)) * 1.4;
    this.control.setDistance(distance);

    this.updateOverviewCameraZoom(boundingBox);
    if (this.frustumFrame) this.updateFrustumFrame();
    this.renderView();
  }

  // Perspective zoom = dolly one step. Orthographic falls through to super.
  zoomIn() {
    if (this.projection !== 'perspective') return super.zoomIn();
    this.#dollyBy(-1);
  }

  zoomOut() {
    if (this.projection !== 'perspective') return super.zoomOut();
    this.#dollyBy(+1);
  }

  zoomCameraTo(level) {
    if (this.projection === 'perspective') return; // ortho-zoom-level has no perspective equivalent
    super.zoomCameraTo(level);
  }

  onZoomLevelChange(level) {
    if (this.projection === 'perspective') return; // scale-bar math is ortho-only
    super.onZoomLevelChange(level);
  }

  #dollyBy(sign) {
    // Mirror SpatialPerspectiveControl.onWheel's stepping so button-zoom feels
    // identical to wheel-dolly.
    const step = Math.min(Math.max(Math.abs(this.control.distance) * 0.2, 0.1), 100);
    let newDistance = this.control.distance + sign * step;
    if (this.control.distance * newDistance <= 0) {
      newDistance = sign * 0.05;
    }
    this.control.setDistance(newDistance);
    if (this.frustumFrame) this.updateFrustumFrame();
    this.scene.updatePointCloudLOD();
    this.renderView();
  }

  renderView() {
    if (this.scene._insideAnimateLoop) {
      // Defer to end of the rAF tick — animate() will coalesce all requests into one render
      this.scene._pendingRender = true;
      return;
    }
    this.scene.renderScene(this.camera, this.spriteCamera, this.viewHelper);
    if (!this.isInteracting) {
      this.scene.renderOverview(this.overviewCamera);
    }
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
      this.setOverviewCameraTo(this.target.clone().add(newpos));
      this.renderView();

      this.animatedPreviously = false;
    }
  }

  setDip() {
    const currentDip = radsToDegrees(this.control.clino);
    const dipRaw = prompt(i18n.t('errors.views.enterDipValue'), Math.round(currentDip));
    if (dipRaw === null) return;

    //FIXME: shall we apply a little delta to the dip value it it's MATH.PI / 2 or -MATH.PI / 2
    const dipValue = parseFloat(dipRaw);
    if (isNaN(dipValue)) {
      showWarningPanel(i18n.t('errors.views.dipNotValid', { dip: dipRaw }));
      return;
    }

    this.control.setCameraOrientation(this.control.distance, this.control.azimuth, degreesToRads(dipValue));
    this.updateFrustumFrame();
    this.renderView();
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
        size        : 19,
        family      : 'Helvetica Neue',
        strokeColor : this.scene.options.scene.sprites3D?.textStroke ?? '#000000',
        color       : this.scene.options.scene.sprites3D?.textColor ?? '#ffffff'
      },
      1.0,
      'dip text'
    );
  }

  #updateDipIndicator() {
    const dipDegrees = radsToDegrees(this.control.clino);
    let rounded = Math.round(dipDegrees);
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
    const rotationRaw = prompt(i18n.t('errors.views.enterRotationValue'), currentRotation);
    if (rotationRaw === null) return;

    const rotationValue = parseFloat(rotationRaw);
    if (isNaN(rotationValue)) {
      showWarningPanel(i18n.t('errors.views.rotationNotValid', { rotation: rotationRaw }));
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
    if (this.projection === 'perspective') {
      // Scale-bar is meaningless in perspective — keep it hidden regardless of the ruler toggle.
      this.ratioIndicator.visible = false;
      this.ratioText.sprite.visible = false;
    }
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
    this.overviewCamera.layers.enable(2);
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
      this.scene.onRotate();
    } else if (e.type === 'zoom') {
      this.onZoomLevelChange(e.level);
      this.updateFrustumFrame();
    } else if (e.type === 'pan') {
      this.scene.points.setCameraTargetPosition(this.control.getTarget());
    }
    super.onOrbitAdjustment();
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
    this.scene.updatePointCloudLOD();
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
    this.setOverviewCameraTo(this.control.getCameraPosition());
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
    const rotationRaw = prompt(i18n.t('errors.views.enterRotationValue'), currentRotation);
    if (rotationRaw === null) return;

    const rotationValue = parseFloat(rotationRaw);
    if (isNaN(rotationValue)) {
      showWarningPanel(i18n.t('errors.views.rotationNotValid', { rotation: rotationRaw }));
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
    this.overviewCamera.layers.enable(2);
    this.overviewCamera.layers.enable(31);
    this.overviewCamera.up = new THREE.Vector3(0, 0, 1);

    // Custom profile view camera control - camera moves on X-Y circle around cave
    this.control = new ProfileViewControl(this.camera, this.domElement, Math.PI);

    // Add vertical ruler
    this.verticalRatioIndicatorHeight = verticalRatioIndicatorHeight;
    this.verticalRuler = this.#createVerticalRuler();
    this.verticalRuler.visible = false;
    scene.sprites3DGroup.add(this.verticalRuler);

    // Add vertical Z coordinate texts (max at top, min at bottom)
    this.verticalMaxZText = this.#createVerticalZText('max');
    this.verticalMaxZText.sprite.visible = false;
    const verticalMaxZTextSprite = this.verticalMaxZText.getSprite();
    scene.sprites3DGroup.add(verticalMaxZTextSprite);

    this.verticalMinZText = this.#createVerticalZText('min');
    this.verticalMinZText.sprite.visible = false;
    const verticalMinZTextSprite = this.verticalMinZText.getSprite();
    scene.sprites3DGroup.add(verticalMinZTextSprite);

    this.modelVerticalRuler = null;
    this.modelVerticalMaxZText = null;
    this.modelVerticalMinZText = null;
    this.caveRulerIcon = null;
    this.modelRulerIcon = null;

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
      this.scene.onRotate();
    } else if (e.type === 'zoom') {
      this.onZoomLevelChange(e.level);
      if (this.frustumFrame) this.updateFrustumFrame();
    } else if (e.type === 'pan') {
      this.scene.points.setCameraTargetPosition(this.control.getTarget());
    }
    super.onOrbitAdjustment();
  }

  onControlOperationEnd(params) {
    this.isInteracting = false;

    if (params.type === 'rotate') {
      const diff = this.control.getCameraPosition().sub(this.control.getTarget());
      this.setOverviewCameraTo(this.target.clone().add(diff));
      if (this.frustumFrame) this.updateFrustumFrame();
    } else if (params.type === 'pan') {
      if (this.frustumFrame) this.updateFrustumFrame();
    }
    this.scene.updatePointCloudLOD();
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
    this.setOverviewCameraTo(this.target.clone().add(diff));
  }

  onResize(width, height) {
    this.verticalRuler.position.set(this.scene.width / 2 - 30, 0, 1);

    if (this.verticalMaxZText && this.verticalMinZText) {
      this.#updateVerticalTextPositions();
    }

    if (this.modelVerticalRuler) {
      const modelX = this.scene.width / 2 - 60;
      this.modelVerticalRuler.position.x = modelX;
      if (this.modelVerticalMaxZText) this.modelVerticalMaxZText.sprite.position.x = modelX;
      if (this.modelVerticalMinZText) this.modelVerticalMinZText.sprite.position.x = modelX;
    }

    super.onResize(width, height);
  }

  onZoomLevelChange(level) {
    super.onZoomLevelChange(level);
    this.#updateVerticalRulers(level);
  }

  #updateVerticalRulers(level) {
    const worldHeightInMeters = this.camera.height / level;
    const pixelsPerMeter = this.scene.height / worldHeightInMeters;
    const elevOffset = globalNormalizer.globalOrigin?.elevation ?? 0;

    const haveCaves = this.scene.speleo.caveObjects.size > 0;
    const haveModels = this.scene.models.get3DModelsGroup().children.length > 0;
    const wantDual = haveCaves && haveModels;
    const isDual = this.modelVerticalRuler !== null;

    // Sync main ruler gradient (cave vs model colors)
    const wantCaveGradient = haveCaves || !haveModels;
    const mainIsCaveGradient = this.verticalRuler.userData.isCaveGradient ?? true;
    if (mainIsCaveGradient !== wantCaveGradient) {
      this.scene.sprites3DGroup.remove(this.verticalRuler);
      this.verticalRuler.material.dispose();
      const gradientColors = wantCaveGradient
        ? this.scene.options.scene.caveLines.color.gradientColors
        : this.scene.options.scene.models.color.gradientColors;
      this.verticalRuler = this.#createVerticalRulerSprite(gradientColors, this.scene.width / 2 - 30);
      this.verticalRuler.visible = this.scene.options.scene.sprites3D.ruler.show;
      this.verticalRuler.userData.isCaveGradient = wantCaveGradient;
      this.scene.sprites3DGroup.add(this.verticalRuler);
    }

    // Create model indicator when entering dual mode
    if (wantDual && !isDual) {
      const modelX = this.scene.width / 2 - 60;
      const rulerVisible = this.scene.options.scene.sprites3D.ruler.show;
      this.modelVerticalRuler = this.#createVerticalRulerSprite(
        this.scene.options.scene.models.color.gradientColors, modelX
      );
      this.modelVerticalRuler.visible = rulerVisible;
      this.scene.sprites3DGroup.add(this.modelVerticalRuler);

      this.modelVerticalMaxZText = this.#createVerticalZText('max', '0', modelX);
      this.modelVerticalMaxZText.sprite.visible = rulerVisible;
      this.scene.sprites3DGroup.add(this.modelVerticalMaxZText.getSprite());

      this.modelVerticalMinZText = this.#createVerticalZText('min', '0', modelX);
      this.modelVerticalMinZText.sprite.visible = rulerVisible;
      this.scene.sprites3DGroup.add(this.modelVerticalMinZText.getSprite());

      this.caveRulerIcon = this.#createRulerIcon('♎', this.scene.width / 2 - 30);
      this.caveRulerIcon.sprite.visible = rulerVisible;
      this.scene.sprites3DGroup.add(this.caveRulerIcon.getSprite());

      this.modelRulerIcon = this.#createRulerIcon('🌐', modelX);
      this.modelRulerIcon.sprite.visible = rulerVisible;
      this.scene.sprites3DGroup.add(this.modelRulerIcon.getSprite());
    }

    // Destroy model indicator when leaving dual mode
    if (!wantDual && isDual) {
      this.diposeSprite(this.modelVerticalRuler, this.scene.sprites3DGroup);
      this.diposeSprite(this.modelVerticalMaxZText.getSprite(), this.scene.sprites3DGroup);
      this.diposeSprite(this.modelVerticalMinZText.getSprite(), this.scene.sprites3DGroup);
      this.modelVerticalRuler = null;
      this.modelVerticalMaxZText = null;
      this.modelVerticalMinZText = null;

      this.diposeSprite(this.caveRulerIcon.getSprite(), this.scene.sprites3DGroup);
      this.diposeSprite(this.modelRulerIcon.getSprite(), this.scene.sprites3DGroup);
      this.caveRulerIcon = null;
      this.modelRulerIcon = null;
    }

    // Height is always driven by the same ratio-snapped distance as the horizontal ruler
    const targetRulerDistance = this.getTargetRulerDistance(this.ratio);
    const heightInPx = (targetRulerDistance / worldHeightInMeters) * this.scene.height;
    this.verticalRatioIndicatorHeight = Math.max(50, Math.min(600, heightInPx));

    const caveBBox  = haveCaves  ? this.scene.speleo.computeBoundingBox()  : null;
    const modelBBox = haveModels ? this.scene.computeModelsBoundingBox()   : null;

    // Update main (cave or models-only) indicator
    this.verticalRuler.scale.set(15, this.verticalRatioIndicatorHeight, 1);
    this.verticalRuler.position.set(this.scene.width / 2 - 30, 0, 1);
    if (haveCaves && caveBBox) {
      this.verticalMaxZText.update(formatElevation(caveBBox.max.z + elevOffset));
      this.verticalMinZText.update(formatElevation(caveBBox.min.z + elevOffset));
    } else if (haveModels && modelBBox) {
      this.verticalMaxZText.update(formatElevation(modelBBox.max.z + elevOffset));
      this.verticalMinZText.update(formatElevation(modelBBox.min.z + elevOffset));
    } else {
      this.verticalMaxZText.update(formatElevation(targetRulerDistance));
      this.verticalMinZText.update('0');
    }

    this.#updateVerticalTextPositions();

    // Update model indicator position and labels (dual mode) — placed at the same
    // Y position as the cave indicator, shifted left enough so labels don't overlap.
    if (wantDual && this.modelVerticalRuler && modelBBox) {
      const h = this.verticalRatioIndicatorHeight;

      // Update model labels first so their rendered widths are available
      this.modelVerticalMaxZText.update(formatElevation(modelBBox.max.z + elevOffset));
      this.modelVerticalMinZText.update(formatElevation(modelBBox.min.z + elevOffset));

      // Compute X so the widest model label clears the widest cave label by 5px
      const caveX = this.scene.width / 2 - 30;
      const caveLabelHalfW = Math.max(
        this.verticalMaxZText.sprite.scale.x,
        this.verticalMinZText.sprite.scale.x
      ) / 2;
      const modelLabelHalfW = Math.max(
        this.modelVerticalMaxZText.sprite.scale.x,
        this.modelVerticalMinZText.sprite.scale.x
      ) / 2;
      const modelX = caveX - caveLabelHalfW - 5 - modelLabelHalfW;

      this.modelVerticalRuler.scale.set(15, h, 1);
      this.modelVerticalRuler.position.set(modelX, 0, 1);
      this.modelVerticalMaxZText.sprite.position.set(modelX, h / 2 + 20, 1);
      this.modelVerticalMinZText.sprite.position.set(modelX, -h / 2 - 20, 1);

      if (this.caveRulerIcon) this.caveRulerIcon.sprite.position.set(caveX, h / 2 + 42, 1);
      if (this.modelRulerIcon) this.modelRulerIcon.sprite.position.set(modelX, h / 2 + 42, 1);
    }
  }

  #createRulerIcon(symbol, xPosition) {
    const position = new THREE.Vector3(xPosition, this.verticalRatioIndicatorHeight / 2 + 42, 1);
    return new TextSprite(
      symbol,
      position,
      {
        size        : 16,
        family      : 'Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji, sans-serif',
        color       : this.scene.options.scene.sprites3D.textColor,
        strokeColor : this.scene.options.scene.sprites3D.textStroke
      },
      1.0,
      `ruler icon`
    );
  }

  #createVerticalRulerSprite(gradientColors, xPosition) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const width = 15;
    const height = this.verticalRatioIndicatorHeight;

    canvas.width = width;
    canvas.height = height;

    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    const sortedColors = [...gradientColors].sort((a, b) => a.depth - b.depth);
    sortedColors.forEach((colorData, index) => {
      const stop = index / (sortedColors.length - 1);
      gradient.addColorStop(stop, colorData.color);
    });

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = '#ffffff';
    for (let i = 0; i <= height; i += 50) {
      ctx.fillRect(0, height - i, width, 1);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;

    const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
    const sprite = new THREE.Sprite(material);
    sprite.position.set(xPosition, 0, 1);
    sprite.scale.set(width, height, 1);
    sprite.name = 'vertical ruler';

    return sprite;
  }

  #createVerticalRuler() {
    return this.#createVerticalRulerSprite(
      this.scene.options.scene.caveLines.color.gradientColors,
      this.scene.width / 2 - 30
    );
  }

  #createVerticalZText(type, text = '0', xPosition = this.scene.width / 2 - 30) {
    const rulerHeight = this.verticalRatioIndicatorHeight;
    const rulerY = 0;
    const yPosition =
      type === 'max'
        ? rulerY + rulerHeight / 2 + 20
        : rulerY - rulerHeight / 2 - 20;

    const position = new THREE.Vector3(xPosition, yPosition, 1);
    return new TextSprite(
      text,
      position,
      {
        size        : 19,
        family      : 'Helvetica Neue',
        color       : this.scene.options.scene.sprites3D.textColor,
        strokeColor : this.scene.options.scene.sprites3D.textStroke
      },
      1.0,
      `vertical ${type} z text`
    );
  }

  #updateVerticalTextPositions() {
    // Update text positions based on current ruler height
    const rulerY = 0; // ruler center Y position
    const rulerHeight = this.verticalRatioIndicatorHeight;

    // Update max Z text position (top of ruler)
    const maxYPosition = rulerY + rulerHeight / 2 + 20;
    this.verticalMaxZText.sprite.position.y = maxYPosition;
    this.verticalMaxZText.sprite.position.x = this.scene.width / 2 - 30;

    // Update min Z text position (bottom of ruler)
    const minYPosition = rulerY - rulerHeight / 2 - 20;
    this.verticalMinZText.sprite.position.y = minYPosition;
    this.verticalMinZText.sprite.position.x = this.scene.width / 2 - 30;
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

    // Recreate cave max Z text
    let maxZLabel = this.verticalMaxZText.label;
    let maxZPrevVisible = this.verticalMaxZText.sprite.visible;
    this.diposeSprite(this.verticalMaxZText.getSprite(), this.scene.sprites3DGroup);
    this.verticalMaxZText = this.#createVerticalZText('max', maxZLabel);
    this.verticalMaxZText.sprite.visible = maxZPrevVisible;
    this.scene.sprites3DGroup.add(this.verticalMaxZText.getSprite());

    // Recreate cave min Z text
    let minZLabel = this.verticalMinZText.label;
    let minZPrevVisible = this.verticalMinZText.sprite.visible;
    this.diposeSprite(this.verticalMinZText.getSprite(), this.scene.sprites3DGroup);
    this.verticalMinZText = this.#createVerticalZText('min', minZLabel);
    this.verticalMinZText.sprite.visible = minZPrevVisible;
    this.scene.sprites3DGroup.add(this.verticalMinZText.getSprite());

    // Recreate model text sprites if in dual mode
    if (this.modelVerticalMaxZText) {
      const modelX = this.scene.width / 2 - 60;
      const modelMaxLabel = this.modelVerticalMaxZText.label;
      const modelMaxVisible = this.modelVerticalMaxZText.sprite.visible;
      this.diposeSprite(this.modelVerticalMaxZText.getSprite(), this.scene.sprites3DGroup);
      this.modelVerticalMaxZText = this.#createVerticalZText('max', modelMaxLabel, modelX);
      this.modelVerticalMaxZText.sprite.visible = modelMaxVisible;
      this.scene.sprites3DGroup.add(this.modelVerticalMaxZText.getSprite());
    }

    if (this.modelVerticalMinZText) {
      const modelX = this.scene.width / 2 - 60;
      const modelMinLabel = this.modelVerticalMinZText.label;
      const modelMinVisible = this.modelVerticalMinZText.sprite.visible;
      this.diposeSprite(this.modelVerticalMinZText.getSprite(), this.scene.sprites3DGroup);
      this.modelVerticalMinZText = this.#createVerticalZText('min', modelMinLabel, modelX);
      this.modelVerticalMinZText.sprite.visible = modelMinVisible;
      this.scene.sprites3DGroup.add(this.modelVerticalMinZText.getSprite());
    }

    if (this.caveRulerIcon) {
      const visible = this.caveRulerIcon.sprite.visible;
      this.diposeSprite(this.caveRulerIcon.getSprite(), this.scene.sprites3DGroup);
      this.caveRulerIcon = this.#createRulerIcon('♎', this.scene.width / 2 - 30);
      this.caveRulerIcon.sprite.visible = visible;
      this.scene.sprites3DGroup.add(this.caveRulerIcon.getSprite());
    }

    if (this.modelRulerIcon) {
      const visible = this.modelRulerIcon.sprite.visible;
      this.diposeSprite(this.modelRulerIcon.getSprite(), this.scene.sprites3DGroup);
      this.modelRulerIcon = this.#createRulerIcon('🌐', this.scene.width / 2 - 60);
      this.modelRulerIcon.sprite.visible = visible;
      this.scene.sprites3DGroup.add(this.modelRulerIcon.getSprite());
    }

    this.#updateRotationText();
    this.#updateVerticalRulers(this.control.zoom);
  }

  toggleSpriteVisibility(spriteType, visible) {
    super.toggleSpriteVisibility(spriteType, visible);

    switch (spriteType) {
      case 'ruler':
        this.verticalRuler.visible = visible;
        this.verticalMaxZText.sprite.visible = visible;
        this.verticalMinZText.sprite.visible = visible;
        if (this.modelVerticalRuler) this.modelVerticalRuler.visible = visible;
        if (this.modelVerticalMaxZText) this.modelVerticalMaxZText.sprite.visible = visible;
        if (this.modelVerticalMinZText) this.modelVerticalMinZText.sprite.visible = visible;
        if (this.caveRulerIcon) this.caveRulerIcon.sprite.visible = visible;
        if (this.modelRulerIcon) this.modelRulerIcon.sprite.visible = visible;
        break;
    }
  }

  setCompassRotation() {
    const currentRotation = ((this.control.angle * 180) / Math.PI).toFixed(1);
    const rotationRaw = prompt(i18n.t('errors.views.enterRotationValue'), currentRotation);
    if (rotationRaw === null) return;

    const rotationValue = parseFloat(rotationRaw);
    if (isNaN(rotationValue)) {
      showWarningPanel(i18n.t('errors.views.rotationNotValid', { rotation: rotationRaw }));
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

    const haveCaves = this.scene.speleo.caveObjects.size > 0;
    const haveModels = this.scene.models.get3DModelsGroup().children.length > 0;
    const wantCaveGradient = haveCaves || !haveModels;
    const rulerVisible = this.scene.options.scene.sprites3D.ruler.show;

    // Recreate main ruler with correct gradient colors
    if (this.verticalRuler) {
      this.scene.sprites3DGroup.remove(this.verticalRuler);
    }
    const mainGradientColors = wantCaveGradient
      ? this.scene.options.scene.caveLines.color.gradientColors
      : this.scene.options.scene.models.color.gradientColors;
    this.verticalRuler = this.#createVerticalRulerSprite(mainGradientColors, this.scene.width / 2 - 30);
    this.verticalRuler.visible = rulerVisible;
    this.verticalRuler.userData.isCaveGradient = wantCaveGradient;
    this.scene.sprites3DGroup.add(this.verticalRuler);

    // Dispose existing model indicator sprites and icons
    if (this.modelVerticalRuler) {
      this.diposeSprite(this.modelVerticalRuler, this.scene.sprites3DGroup);
      this.modelVerticalRuler = null;
    }
    if (this.modelVerticalMaxZText) {
      this.diposeSprite(this.modelVerticalMaxZText.getSprite(), this.scene.sprites3DGroup);
      this.modelVerticalMaxZText = null;
    }
    if (this.modelVerticalMinZText) {
      this.diposeSprite(this.modelVerticalMinZText.getSprite(), this.scene.sprites3DGroup);
      this.modelVerticalMinZText = null;
    }
    if (this.caveRulerIcon) {
      this.diposeSprite(this.caveRulerIcon.getSprite(), this.scene.sprites3DGroup);
      this.caveRulerIcon = null;
    }
    if (this.modelRulerIcon) {
      this.diposeSprite(this.modelRulerIcon.getSprite(), this.scene.sprites3DGroup);
      this.modelRulerIcon = null;
    }

    // Create model indicator and icons when both caves and models are present
    if (haveCaves && haveModels) {
      const modelX = this.scene.width / 2 - 60;
      this.modelVerticalRuler = this.#createVerticalRulerSprite(
        this.scene.options.scene.models.color.gradientColors, modelX
      );
      this.modelVerticalRuler.visible = rulerVisible;
      this.scene.sprites3DGroup.add(this.modelVerticalRuler);

      this.modelVerticalMaxZText = this.#createVerticalZText('max', '0', modelX);
      this.modelVerticalMaxZText.sprite.visible = rulerVisible;
      this.scene.sprites3DGroup.add(this.modelVerticalMaxZText.getSprite());

      this.modelVerticalMinZText = this.#createVerticalZText('min', '0', modelX);
      this.modelVerticalMinZText.sprite.visible = rulerVisible;
      this.scene.sprites3DGroup.add(this.modelVerticalMinZText.getSprite());

      this.caveRulerIcon = this.#createRulerIcon('♎', this.scene.width / 2 - 30);
      this.caveRulerIcon.sprite.visible = rulerVisible;
      this.scene.sprites3DGroup.add(this.caveRulerIcon.getSprite());

      this.modelRulerIcon = this.#createRulerIcon('🌐', modelX);
      this.modelRulerIcon.sprite.visible = rulerVisible;
      this.scene.sprites3DGroup.add(this.modelRulerIcon.getSprite());
    }

    this.verticalMaxZText.sprite.visible = rulerVisible;
    this.verticalMinZText.sprite.visible = rulerVisible;

    // Populate correct elevation values and positions for all indicators now
    // that all sprites exist (super.activate ran #updateVerticalRulers before
    // the model sprites were created, so we run it again here).
    this.#updateVerticalRulers(this.control.zoom);

    this.compass.material.rotation = -this.control.angle + Math.PI;
    this.#updateRotationText();
    this.renderView();
  }

  deactivate() {
    super.deactivate();
    this.control.enabled = false;
    this.verticalRuler.visible = false;
    this.verticalMaxZText.sprite.visible = false;
    this.verticalMinZText.sprite.visible = false;
    if (this.modelVerticalRuler) this.modelVerticalRuler.visible = false;
    if (this.modelVerticalMaxZText) this.modelVerticalMaxZText.sprite.visible = false;
    if (this.modelVerticalMinZText) this.modelVerticalMinZText.sprite.visible = false;
    if (this.caveRulerIcon) this.caveRulerIcon.sprite.visible = false;
    if (this.modelRulerIcon) this.modelRulerIcon.sprite.visible = false;
  }
}

export { SpatialView, PlanView, ProfileView };
