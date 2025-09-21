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

    this.speleo = new SpeleoScene(db, options, materials, this);
    this.startPoint = new StartPointScene(options, materials, this);
    this.models = new ModelScene(this);
    this.segments = new SegmentScene(options, this);
    this.points = new PointScene(options, materials, this);
    this.attributes = new AttributesScene(options, materials, this);

    this.views = new Map([
      ['plan', new PlanView(this, this.domElement)],
      ['profile', new ProfileView(this, this.domElement)],
      ['spatial', new SpatialView(this, this.domElement)]
    ]);

    this.grid = new Grid(this.options, this);

    this.boundingBox = undefined;

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
    this.view.renderView();
  }

  computeBoundingBox() {
    //FIXME: incorporate surface
    return this.speleo.computeBoundingBox();
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

  animate() {
    const delta = this.clock.getDelta();
    this.view.animate(delta);
  }

  onRotate() {
    this.attributes.repositionPlaneLabels();
  }

  renderScene(camera, overViewCamera, spriteCamera, helper) {
    this.attributes.sectionAttributes?.forEach((e) => {
      const pos = e.center.clone();
      pos.z = pos.z + 100;
      e.text.lookAt(pos);
    });

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

    if (overViewCamera !== undefined) {
      this.overview.renderer.render(this.threejsScene, overViewCamera);
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

  addSpriteLabel(label, position, size, color, strokeColor) {
    const font = {
      size  : size * 30, // magic number to match mesh based label size (with the scale factor of 0.2)
      color : color,
      name  : 'Arial'
    };

    if (strokeColor) {
      font.strokeColor = strokeColor;
    }

    return new TextSprite(label, position, font, 0.03, `station-label-${label}`);
  }

  toggleCameraTargetVisibility(visible) {
    this.points.cameraTarget.visible = visible;
  }

  renameCave(oldName, newName) {
    this.speleo.renameCave(oldName, newName);
    this.attributes.renameCaveTo(newName);
    this.points.renameCave(oldName, newName);
    this.materials.renameCave(oldName, newName);
  }

  disposeCave(caveName) {
    this.startPoint.removeStartingPoint(caveName);
    this.speleo.disposeCave(caveName);
    this.attributes.disposeSectionAttributes(caveName);
  }

}

export { MyScene, SceneOverview };
