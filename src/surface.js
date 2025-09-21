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

import { Color } from './model.js';

class SurfaceHelper {

  static getColorGradients(points, colorConfig) {
    const startColor = new Color(colorConfig.start);
    const endColor = new Color(colorConfig.end);
    const diff = endColor.sub(startColor);
    var minZ = points[0].z;
    var maxZ = minZ;
    for (const point of points) {
      if (point.z > maxZ) {
        maxZ = point.z;
      }
      if (point.z < minZ) {
        minZ = point.z;
      }
    }

    const colors = [];

    points.forEach((point) => {
      const factor = (point.z - minZ) / (maxZ - minZ);
      const c = startColor.add(diff.mul(factor));
      colors.push(c.r, c.g, c.b);
    });
    return colors;
  }
}

export { SurfaceHelper };
