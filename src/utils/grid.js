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

  constructor(width = 100, height = 10, step = 10, material) {

    // Frame is clipped to the exact bbox extent so it matches the bounding
    // box helper. Inner lines sit on integer multiples of step centered on
    // the origin; edge cells become slivers wherever the bbox isn't a
    // multiple of step.
    const halfWidth = width / 2;
    const halfHeight = height / 2;
    const eps = step * 1e-4;

    const vertices = [];

    vertices.push(-halfWidth, -halfHeight, 0, halfWidth, -halfHeight, 0);
    vertices.push(-halfWidth, halfHeight, 0, halfWidth, halfHeight, 0);
    vertices.push(-halfWidth, -halfHeight, 0, -halfWidth, halfHeight, 0);
    vertices.push(halfWidth, -halfHeight, 0, halfWidth, halfHeight, 0);

    const firstY = Math.ceil((-halfHeight + eps) / step) * step;
    for (let y = firstY; y < halfHeight - eps; y += step) {
      vertices.push(-halfWidth, y, 0, halfWidth, y, 0);
    }

    const firstX = Math.ceil((-halfWidth + eps) / step) * step;
    for (let x = firstX; x < halfWidth - eps; x += step) {
      vertices.push(x, -halfHeight, 0, x, halfHeight, 0);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));

    super(geometry, material);

    this.type = 'GridHelper';

  }

  dispose() {

    this.geometry.dispose();
    this.material.dispose();

  }

}

export { GridHelper };
