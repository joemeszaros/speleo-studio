import * as THREE from 'three';

import { GridHelper } from '../utils/grid.js';
import { Options } from '../config.js';

class Grid {

  constructor(options, scene) {
    this.options = options;
    this.scene = scene;
    this.grid = new GridHelper(100, 100, 10, 0.4);
    this.grid.name = 'grid helper';
    this.grid.visible = this.options.scene.grid.mode !== 'hidden';
    this.grid.layers.set(1);
    this.scene.threejsScene.add(this.grid);

  }

  adjust(boundingBox) {
    this.adjustSize(boundingBox);
    this.adjustPosition(this.options.scene.grid.mode);
  }

  adjustSize(boundingBox) {
    const [width, height] = boundingBox.getSize(new THREE.Vector3());
    this.grid.geometry.dispose();
    this.grid.material.dispose();
    this.scene.threejsScene.remove(this.grid);
    this.grid = new GridHelper(width, height, 10, 0.4);
    this.grid.layers.set(1);
    this.grid.boundingBox = boundingBox; // custom property
    this.scene.threejsScene.add(this.grid);
  }

  adjustPosition(mode) {
    const boundingBox = this.grid.boundingBox;
    if (boundingBox === undefined) return;
    const center = boundingBox.getCenter(new THREE.Vector3());
    const minZ = Math.min(boundingBox.min.z, boundingBox.max.z);
    const maxZ = Math.max(boundingBox.min.z, boundingBox.max.z);
    if (mode === 'top') {
      this.grid.position.set(center.x, center.y, maxZ);
    } else if (mode === 'bottom') {
      this.grid.position.set(center.x, center.y, minZ);
    }
  }

  roll() {
    const config = this.options.scene.grid.mode;
    Options.rotateOptionChoice(config);
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

    // Save configuration after changing grid mode
    if (this.scene.saveConfig) {
      this.scene.saveConfig();
    }
  }
}

export { Grid };
