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

    // Disable frustum culling - required for large point clouds that may have
    // an incorrect bounding sphere calculated by Three.js
    // When Three.js calculates the bounding sphere for frustum culling on large
    // point clouds (especially after coordinate normalization), it can incorrectly
    // determine that the object is outside the camera's view frustum, causing it to not render.
    entry.cloud.frustumCulled = false;

    if (this.surfaceObjects.has(surface.name)) {
      throw new Error(i18n.t('errors.scene.surfaceObjectAlreadyAdded', { name: surface.name }));
    }
    this.surfaceObjects.set(surface.name, entry);

    // Force render to display the surface
    this.scene.view.renderView();
  }
}
