import * as THREE from 'three';

import { GridHelper } from '../utils/grid.js';

class Grid {

  constructor(options, scene) {
    this.options = options;
    this.scene = scene;
    this.grid = new GridHelper(100, 100, this.options.scene.grid.step, 0.4);
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
    this.grid = new GridHelper(width, height, this.options.scene.grid.step, 0.4);
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
    const config = this.options.scene.grid.mode;

    const choices = ['top', 'bottom', 'hidden'];
    const index = choices.indexOf(config);
    if (index >= 0 && index < choices.length - 1) {
      this.options.scene.grid.mode = choices[index + 1];
    } else {
      this.options.scene.grid.mode = choices[0];
    }

    switch (config) {
      case 'top':
      case 'bottom':
        this.grid.visible = true;
        this.adjustPosition(config);
        break;
      case 'hidden':
        this.grid.visible = false;
        break;
    }
    this.scene.view.renderView();

  }

  refreshGrid() {
    if (this.center) {
      this.adjustSize(this.boundingBox);
      this.adjustPosition(this.options.scene.grid.mode);
    }
    this.scene.view.renderView();
  }
}

export { Grid };
