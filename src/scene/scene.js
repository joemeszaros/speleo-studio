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
import { Grid } from './grid.js';
import { SpeleoScene } from './cosmos/speleo.js';
import { StartPointScene } from './cosmos/start-point.js';
import { ModelScene } from './cosmos/model.js';
import { PointScene } from './cosmos/points.js';
import { SegmentScene } from './cosmos/segments.js';
import { AttributesScene } from './cosmos/attributes.js';
import { SpatialView, PlanView, ProfileView } from './views.js';
import { TextSprite } from './textsprite.js';
import { ImageCache } from '../utils/image-cache.js';

class SceneOverview {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: false });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(container.offsetWidth, container.offsetHeight);
    this.domElement = this.renderer.domElement; // auto generate canvas
    container.appendChild(this.domElement);
    this.width = container.offsetWidth;
    this.height = container.offsetHeight;
  }

}

class MyScene {

  /**
   * A class that creates the 3D scene that makes user interactions and scene modifications (camera position, add/remove 3D objects) possible
   *
   * @param {Map<String, Map>} options - The project options
   * @param {Database} db - The database of the application, containing caves and other infomations
   * @param {*} - Collection of line and geometry materials
   */
  constructor(options, db, materials, font, container, overview) {
    this.options = options;
    this.db = db;
    this.mats = materials.materials;
    this.materials = materials;

    this.sprites3DGroup = new THREE.Group();
    this.sprites3DGroup.name = 'sprites';
    this.stationFont = font;

    // Camera tracking for optimized billboarding
    this.lastCameraPosition = new THREE.Vector3();
    this.lastCameraQuaternion = new THREE.Quaternion();
    this.framesSinceLastBillboardUpdate = 0;
    this.billboardUpdateThreshold = 2; // Update every 2 frames when camera moves
    this.cameraMovementThreshold = 0.1; // Minimum camera movement to trigger update

    this.container = container;
    this.sceneRenderer = new THREE.WebGLRenderer({ antialias: true });
    this.sceneRenderer.name = 'sceneRenderer';
    this.sceneRenderer.setPixelRatio(window.devicePixelRatio);
    this.sceneRenderer.setSize(container.offsetWidth, container.offsetHeight);
    this.sceneRenderer.autoClear = false; // To allow render overlay on top of normal scene
    this.sceneRenderer.setAnimationLoop(() => this.animate());
    this._insideAnimateLoop = false; // true while animate() is executing
    this._pendingRender = false; // a renderView() call was deferred during this tick
    this._rendererSize = new THREE.Vector2(); // reused each frame to avoid allocation
    this._lastLODUpdate = 0; // timestamp of last LOD update — used to throttle during interaction
    this._lodThrottleMs = 33; // throttle LOD updates to ~30Hz during interaction (control events fire ~60Hz)

    this.clock = new THREE.Clock(); // only used for animations
    this.domElement = this.sceneRenderer.domElement; // auto generate canvas
    container.appendChild(this.domElement);
    this.width = container.offsetWidth;
    this.height = container.offsetHeight;

    this.overview = overview;

    this.spriteScene = new THREE.Scene();
    this.spriteScene.name = 'sprite scene';
    this.spriteScene.add(this.sprites3DGroup);

    this.threejsScene = new THREE.Scene();
    this.threejsScene.name = 'main scene';
    this.threejsScene.background = new THREE.Color(this.options.scene.background.color);

    // Add lights for 3D models with textures/materials
    this.setupLights();

    this.speleo = new SpeleoScene(db, options, materials, this);
    this.startPoint = new StartPointScene(options, materials, this);
    this.models = new ModelScene(this);
    this.segments = new SegmentScene(options, this);
    this.points = new PointScene(options, materials, this);
    this.imageCache = new ImageCache();
    this.attributes = new AttributesScene(options, materials, this, this.imageCache);

    this.views = new Map([
      ['plan', new PlanView(this, this.domElement)],
      ['profile', new ProfileView(this, this.domElement)],
      ['spatial', new SpatialView(this, this.domElement)]
    ]);

    this.grid = new Grid(this.options, this, this.mats.grid);

    this.view = this.views.get('spatial');
    this.view.activate(this.computeBoundingBox());
    this.view.updateRationSprites(this.view.control.zoom);

    // Initialize camera tracking for billboard optimization
    this.#initializeCameraTracking();

    window.addEventListener('resize', () => this.onWindowResize());
    document.addEventListener('viewport-resized', () => this.onViewportResized());
  }

  setBackground(val) {
    this.threejsScene.background = new THREE.Color(val);
    this.view.renderView();
  }

  /**
   * Setup scene lights for 3D models with textures/materials
   */
  setupLights() {
    // Ambient light for overall illumination (so no part is completely dark)
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    ambientLight.name = 'ambientLight';
    this.threejsScene.add(ambientLight);

    // Directional light for shading on 3D models
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
    dirLight.name = 'directionalLight';
    dirLight.position.set(1, 1, 1);
    this.threejsScene.add(dirLight);

    // Secondary fill light from opposite direction to reduce harsh shadows
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.3);
    fillLight.name = 'fillLight';
    fillLight.position.set(-1, -0.5, -1);
    this.threejsScene.add(fillLight);
  }

  getBoundingClientRect() {
    return this.domElement.getBoundingClientRect();
  }

  onViewportResized() {
    this.onResize(this.container.offsetWidth, this.container.offsetHeight);
  }

  onWindowResize() {
    this.onResize(this.container.offsetWidth, this.container.offsetHeight);
  }

  onResize(newWidth, newHeigth) {
    this.width = newWidth;
    this.height = newHeigth;
    this.sceneRenderer.setSize(this.width, this.height);
    this.views.forEach((view) => view.onResize(this.width, this.height));
    this.updatePointCloudLOD();
    this.view.renderView();
    this.renderOverview(this.view.overviewCamera);
  }

  computeBoundingBox() {
    let boundingBox = this.speleo.computeBoundingBox();

    // Extend bounding box with visible 3D models only
    const group = this.models.get3DModelsGroup();
    if (group.children.length > 0) {
      const modelBox = new THREE.Box3();
      for (const child of group.children) {
        if (child.visible) {
          modelBox.expandByObject(child);
        }
      }
      if (boundingBox === undefined) {
        boundingBox = modelBox.isEmpty() ? undefined : modelBox;
      } else if (!modelBox.isEmpty()) {
        boundingBox.union(modelBox);
      }
    }

    return boundingBox;
  }

  changeView(viewName) {
    if (this.view !== this.views.get(viewName)) {
      this.view.deactivate();
      this.view = this.views.get(viewName);
      this.view.activate(this.computeBoundingBox());
      this.attributes.repositionPlaneLabels();
      // Reinitialize camera tracking for billboard optimization
      this.#initializeCameraTracking();
    }
  }

  /**
   * Update point cloud octree LOD visibility and budget allocation.
   * Called from onOrbitAdjustment (camera moved), updatePointBudget (budget changed),
   * and onResize (screen size changed). Not called every frame when scene is static.
   */
  updatePointCloudLOD() {
    const octrees = this.models?.pointCloudOctrees;
    if (!octrees?.length || !this.view.camera) return;

    // Throttle LOD updates during interaction: control events fire ~60Hz but a
    // walk over ~9k nodes isn't worth doing every event. Non-interactive calls
    // (onControlOperationEnd, onResize, updatePointBudget) always run — they
    // are the moments where "final" LOD quality matters.
    const now = performance.now();
    if (this.view.isInteracting && now - this._lastLODUpdate < this._lodThrottleMs) {
      return;
    }
    this._lastLODUpdate = now;

    const camera = this.view.camera;
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();

    // Halve the point budget during user interaction (rotate/pan/zoom) to keep
    // frames cheap. Full budget is restored when onControlOperationEnd runs another
    // updatePointCloudLOD() with isInteracting = false.
    const rawBudget = this.options.scene.models.pointBudget;
    const globalBudget = this.view.isInteracting ? Math.max(5000, Math.floor(rawBudget / 2)) : rawBudget;
    const renderer = this.sceneRenderer;
    const screenH = renderer.getSize(this._rendererSize).y;
    const tanHalfFov = Math.tan(((camera.fov || 60) * Math.PI) / 180 / 2);

    // Allocate budget proportionally to each octree's screen-space size (SSE of root).
    // Larger/closer octrees get more budget; small/distant ones get less.
    let totalWeight = 0;
    const weights = [];
    for (const octree of octrees) {
      const root = octree.nodes.get(0);
      if (!root || !octree.group.visible) { weights.push(0); continue; }
      const b = root.data.bbox;
      const dx = b.max[0] - b.min[0], dy = b.max[1] - b.min[1], dz = b.max[2] - b.min[2];
      const nodeSize = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const dist = Math.max(camera.position.distanceTo(octree.group.position), 0.1);
      const w = (nodeSize * screenH) / (dist * 2 * tanHalfFov);
      weights.push(w);
      totalWeight += w;
    }
    for (let i = 0; i < octrees.length; i++) {
      const share = totalWeight > 0 ? weights[i] / totalWeight : 1 / octrees.length;
      octrees[i].pointBudget = Math.max(5000, Math.floor(globalBudget * share));
      octrees[i].updateVisibility(camera, renderer, { skipCameraUpdate: true });
    }
  }

  animate() {
    // Mark that we're inside the rAF loop so renderView() defers instead of
    // rendering immediately. All deferred renders are coalesced into one at the end.
    this._insideAnimateLoop = true;
    this._pendingRender = false;
    try {
      const delta = this.clock.getDelta();
      this.view.animate(delta); // may call renderView() → sets _pendingRender
    } finally {
      this._insideAnimateLoop = false;
    }

    if (this._pendingRender) {
      this._pendingRender = false;
      this.view.renderView();
    }
  }

  onRotate() {
    this.attributes.repositionPlaneLabels();
    this.attributes.layoutStationAttributes();
  }

  renderScene(camera, spriteCamera, helper) {
    if (this.options.scene.stationLabels.show) {
      this.#updateStationLabelsBillboarding();
    }

    if (spriteCamera === undefined) {
      this.sceneRenderer.render(this.threejsScene, camera);
    } else {
      this.sceneRenderer.clear();
      this.sceneRenderer.render(this.threejsScene, camera);
      this.sceneRenderer.clearDepth();
      this.sceneRenderer.render(this.spriteScene, spriteCamera);
    }

    if (helper !== undefined) {
      helper.render(this.sceneRenderer);
    }
  }

  renderOverview(overviewCamera) {
    if (overviewCamera !== undefined) {
      this.overview.renderer.render(this.threejsScene, overviewCamera);
    }
  }

  #initializeCameraTracking() {
    if (this.view && this.view.camera) {
      this.lastCameraPosition.copy(this.view.camera.position);
      this.lastCameraQuaternion.copy(this.view.camera.quaternion);
    }
  }

  #hasCameraMoved() {
    const currentPosition = this.view.camera.position;
    const currentQuaternion = this.view.camera.quaternion;

    const positionDelta = currentPosition.distanceTo(this.lastCameraPosition);
    const rotationDelta = currentQuaternion.angleTo(this.lastCameraQuaternion);
    return positionDelta > this.cameraMovementThreshold || rotationDelta > this.cameraMovementThreshold;
  }

  /**
   * Optimized station labels billboarding update
   */
  #updateStationLabelsBillboarding() {
    this.framesSinceLastBillboardUpdate++;

    //Only check camera movement every few frames for performance
    if (this.framesSinceLastBillboardUpdate < this.billboardUpdateThreshold) {
      return;
    }

    // Check if camera has moved significantly
    if (!this.#hasCameraMoved()) {
      this.framesSinceLastBillboardUpdate = 0;
      return;
    }

    //FIXME: rotate if needed
    // const entries = []; //this.#getCaveObjectsFlattened();
    // entries.forEach((e) => {
    //   e.stationLabels.children.forEach((label) => {
    //     if (label.userData && label.userData.textSprite) {
    //       label.lookAt(this.view.camera.position);
    //     }
    //   });
    // });

    this.lastCameraPosition.copy(this.view.camera.position);
    this.lastCameraQuaternion.copy(this.view.camera.quaternion);
    this.framesSinceLastBillboardUpdate = 0;
  }

  addObjectToScene(object) {
    this.threejsScene.add(object);
  }

  removeObjectFromScene(object) {
    this.threejsScene.remove(object);
  }

  addLabel(label, position, size) {
    const textShape = this.stationFont.generateShapes(label, size);
    const textGeometry = new THREE.ShapeGeometry(textShape);
    textGeometry.computeBoundingBox();

    const xMid = -0.5 * (textGeometry.boundingBox.max.x - textGeometry.boundingBox.min.x);
    textGeometry.translate(xMid, 0, 0);

    const textMesh = new THREE.Mesh(textGeometry, this.mats.text);
    textMesh.lookAt(this.view.camera.position);
    textMesh.name = `label-${label}`;
    textMesh.position.x = position.x;
    textMesh.position.y = position.y;
    textMesh.position.z = position.z;
    return textMesh;
  }

  getSpriteLabel(label, position, size, color, strokeColor) {
    const font = {
      size  : size * 20, // magic number to match mesh based label size (with the scale factor of 0.2)
      color : color,
      name  : 'Helvetica Neue'
    };

    if (strokeColor) {
      font.strokeColor = strokeColor;
    }

    return new TextSprite(label, position, font, 0.05, `station-label-${label}`);
  }

  toggleCameraTargetVisibility(visible) {
    this.points.cameraTarget.visible = visible;
  }

  renameCave(oldName, newName) {
    this.speleo.renameCave(oldName, newName);
    this.attributes.renameCaveTo(newName);
    this.startPoint.renameCave(oldName, newName);
    this.materials.renameCave(oldName, newName);
  }

  disposeCave(caveName) {
    this.startPoint.removeStartingPoint(caveName);
    this.speleo.disposeCave(caveName);
    this.attributes.disposeSectionAttributes(caveName);
    this.attributes.diposeStationAttributes(caveName);
  }

}

export { MyScene, SceneOverview };
