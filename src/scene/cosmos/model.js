import * as THREE from 'three';
import * as U from '../../utils/utils.js';
import { i18n } from '../../i18n/i18n.js';

export class ModelScene {

  constructor(scene) {
    this.scene = scene;
    this.surfaceObjects = new Map();
    this.surfaceObject3DGroup = new THREE.Group();
    this.surfaceObject3DGroup.name = 'surface objects';
    scene.addObjectToScene(this.surfaceObject3DGroup);
  }

  getSurfaceObjects(cloud, colorGradients) {
    cloud.geometry.setAttribute('color', new THREE.Float32BufferAttribute(colorGradients, 3));
    cloud.name = `surface-${cloud.name}`;
    this.scene.view.renderView();

    return {
      id    : U.randomAlphaNumbericString(5),
      cloud : cloud
    };
  }

  addSurface(surface, entry) {
    this.surfaceObject3DGroup.add(entry.cloud);

    if (this.surfaceObjects.has(surface.name)) {
      throw new Error(i18n.t('errors.scene.surfaceObjectAlreadyAdded', { name: surface.name }));
    }
    this.surfaceObjects.set(surface.name, entry);
  }
}
