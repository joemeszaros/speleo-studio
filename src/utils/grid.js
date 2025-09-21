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

class GridHelper extends THREE.LineSegments {

  constructor(width = 100, height = 10, step = 10, opacity = 1.0) {

    const halfWidth = width / 2;
    const halfHeight = height / 2;
    let divisions = height / step;

    const vertices = [];

    vertices.push(-halfWidth, -halfHeight, 0, halfWidth, -halfHeight, 0);
    vertices.push(-halfWidth, halfHeight, 0, halfWidth, halfHeight, 0);
    vertices.push(-halfWidth, -halfHeight, 0, -halfWidth, halfHeight, 0);
    vertices.push(halfWidth, -halfHeight, 0, halfWidth, halfHeight, 0);

    for (let i = 0, k = -halfHeight; i <= divisions; i++, k += step) {
      vertices.push(-halfWidth, k, 0, halfWidth, k, 0);
    }
    divisions = width / step;

    for (let i = 0, k = -halfWidth; i <= divisions; i++, k += step) {
      vertices.push(k, -halfHeight, 0, k, halfHeight, 0);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));

    const matetrial = new THREE.LineBasicMaterial({
      color        : 0xffffff,
      vertexColors : false,
      transparent  : true,
      opacity      : opacity
    });

    super(geometry, matetrial);

    this.type = 'GridHelper';

  }

  dispose() {

    this.geometry.dispose();
    this.material.dispose();

  }

}

export { GridHelper };
