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

import { Color } from '../model.js';

/**
 * Interpolate a color at `value` along a sorted array of gradient stops.
 * @param {number} value - Value in the same units as each stop's key
 * @param {Array<Object>} sortedStops - Sorted gradient stops [{depth, color}, ...]
 * @param {string} valueKey - Property name for the stop value ('depth')
 * @returns {Color}
 */
function interpolateGradientColor(value, sortedStops, valueKey = 'depth') {
  if (sortedStops.length === 0) return new Color('#ffffff');
  if (sortedStops.length === 1) return new Color(sortedStops[0].color);

  let lower = sortedStops[0];
  let upper = sortedStops[sortedStops.length - 1];

  for (let i = 0; i < sortedStops.length - 1; i++) {
    if (value >= sortedStops[i][valueKey] && value <= sortedStops[i + 1][valueKey]) {
      lower = sortedStops[i];
      upper = sortedStops[i + 1];
      break;
    }
  }

  if (value <= lower[valueKey]) return new Color(lower.color);
  if (value >= upper[valueKey]) return new Color(upper.color);

  const range = upper[valueKey] - lower[valueKey];
  const factor = range === 0 ? 0 : (value - lower[valueKey]) / range;
  const startColor = new Color(lower.color);
  const endColor = new Color(upper.color);
  const colorDiff = endColor.sub(startColor);
  return startColor.add(colorDiff.mul(factor));
}

/**
 * Helper class for point cloud operations.
 */
class PointCloudHelper {

  /**
   * Generates multi-stop gradient colors based on Z-height for point cloud visualization.
   * @param {Array} points - The points of the point cloud [{x,y,z}, ...]
   * @param {Array} gradientColors - Sorted gradient stops [{depth:0-100, color:'#hex'}, ...]
   * @param {number} [minZ] - Global min world Z for normalization (uses own range if omitted)
   * @param {number} [maxZ] - Global max world Z for normalization (uses own range if omitted)
   * @param {number} [offsetZ=0] - World Z offset to add to each point's local Z
   * @returns {Array} Flat array of RGB float values (0-1)
   */
  static getColorGradientsMultiColor(points, gradientColors, minZ, maxZ, offsetZ = 0) {
    const sortedColors = [...gradientColors].sort((a, b) => a.depth - b.depth);

    let computedMinZ = minZ;
    let computedMaxZ = maxZ;
    if (computedMinZ === undefined || computedMaxZ === undefined) {
      computedMinZ = points[0].z + offsetZ;
      computedMaxZ = computedMinZ;
      for (const point of points) {
        const wz = point.z + offsetZ;
        if (wz > computedMaxZ) computedMaxZ = wz;
        if (wz < computedMinZ) computedMinZ = wz;
      }
    }

    const diffZ = computedMaxZ - computedMinZ;
    const colors = [];

    for (const point of points) {
      const worldZ = point.z + offsetZ;
      const depth = diffZ === 0 ? 0 : ((computedMaxZ - worldZ) / diffZ) * 100;
      const c = interpolateGradientColor(depth, sortedColors, 'depth');
      colors.push(c.r, c.g, c.b);
    }
    return colors;
  }

  /**
   * @deprecated Use getColorGradientsMultiColor instead.
   */
  static getColorGradients(points, colorConfig) {
    if (colorConfig.gradientColors) {
      return PointCloudHelper.getColorGradientsMultiColor(points, colorConfig.gradientColors);
    }
    // Legacy 2-stop support
    const startColor = new Color(colorConfig.start);
    const endColor = new Color(colorConfig.end);
    const diff = endColor.sub(startColor);
    let minZ = points[0].z;
    let maxZ = minZ;
    for (const point of points) {
      if (point.z > maxZ) maxZ = point.z;
      if (point.z < minZ) minZ = point.z;
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

export { PointCloudHelper, interpolateGradientColor };
