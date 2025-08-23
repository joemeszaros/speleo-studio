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
