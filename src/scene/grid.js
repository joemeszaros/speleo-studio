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

import { GridHelper } from '../utils/grid.js';

class Grid {

  constructor(options, scene, material) {
    this.options = options;
    this.scene = scene;
    this.material = material;
    this.grid = new GridHelper(100, 100, this.options.scene.grid.step, this.material);
    this.grid.name = 'grid helper';
    this.grid.visible = this.options.scene.grid.mode !== 'hidden';
    this.grid.layers.set(1);
    this.scene.addObjectToScene(this.grid);

  }

  adjust(boundingBox) {
    this.adjustSize(boundingBox);
    this.adjustPosition(this.options.scene.grid.mode);
  }

  adjustSize(boundingBox) {
    const [width, height] = boundingBox.getSize(new THREE.Vector3());
    this.grid.geometry.dispose();
    this.grid.material.dispose();
    this.scene.removeObjectFromScene(this.grid);
    this.grid = new GridHelper(width, height, this.options.scene.grid.step, this.material);
    this.grid.layers.set(1);
    this.center = boundingBox.getCenter(new THREE.Vector3());
    this.minZ = Math.min(boundingBox.min.z, boundingBox.max.z);
    this.maxZ = Math.max(boundingBox.min.z, boundingBox.max.z);
    this.scene.addObjectToScene(this.grid);
  }

  adjustPosition(mode) {

    if (this.center === undefined) return;
    if (mode === 'top') {
      this.grid.position.set(this.center.x, this.center.y, this.maxZ);
    } else if (mode === 'bottom') {
      this.grid.position.set(this.center.x, this.center.y, this.minZ);
    }
  }

  roll() {
    const oldMode = this.options.scene.grid.mode;
    let newMode;
    const choices = ['top', 'bottom', 'hidden'];
    const index = choices.indexOf(oldMode);
    if (index >= 0 && index < choices.length - 1) {
      newMode = choices[index + 1];
    } else {
      newMode = choices[0];
    }
    this.options.scene.grid.mode = newMode;

    switch (newMode) {
      case 'top':
      case 'bottom':
        this.grid.visible = true;
        this.adjustPosition(newMode);
        break;
      case 'hidden':
        this.grid.visible = false;
        break;
    }
    this.scene.view.renderView();

  }

  refreshGrid(boundingBox) {
    if (this.center) {
      this.adjustSize(boundingBox);
      this.adjustPosition(this.options.scene.grid.mode);
    }
    this.scene.view.renderView();
  }
}

export { Grid };
