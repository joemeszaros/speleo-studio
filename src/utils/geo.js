import { degreesToRads, radsToDegrees } from './utils.js';

class MeridianConvergence {

  static EARTH_RADIUS = 6379296.41898993;

  /**
   * Get the meridian convergence at a given EOV coordinate.
   * This is the angle between the meridian and the north direction.
   * To understand the meridian convergence, see: https://jerrymahun.com/index.php/home/open-access/32-vi-directions/265-chapter-c-meridian-conversion?start=3
   * A Hungarian explanation: http://geopont.elte.hu/tajfutas/magyar/tajolo/01-2/eszak2.htm
   * @param {*} y
   * @param {*} x
   * @returns
   */
  static getConvergence(y, x) {
    let convergence =
      (Math.atan(
        (Math.cosh((x - 200000) / MeridianConvergence.EARTH_RADIUS) *
          Math.sin((y - 650000) / MeridianConvergence.EARTH_RADIUS)) /
          (1 / Math.tan(0.82205) -
            Math.sinh((x - 200000) / MeridianConvergence.EARTH_RADIUS) *
              Math.cos((y - 650000) / MeridianConvergence.EARTH_RADIUS))
      ) *
        180) /
      Math.PI;
    return convergence;
  }

}

class Declination {

  static async getDeclination(lat, long, date, timeoutInMs = 3000) {
    const url = 'https://www.ngdc.noaa.gov/geomag-web/calculators/calculateDeclination';
    const params = new URLSearchParams();
    params.append('lat1', lat);
    params.append('lon1', long);
    params.append('resultFormat', 'json');
    params.append('startMonth', date.getMonth() + 1);
    params.append('startDay', date.getDate());
    params.append('startYear', date.getFullYear());
    params.append('model', 'IGRF');
    params.append('key', 'zNEw7');
    console.log(params);
    const start = Date.now();
    const response = await fetch(`${url}?${params}`, { signal: AbortSignal.timeout(timeoutInMs) });
    console.log(`Request took ${Date.now() - start}ms`);

    if (!response.ok) {
      throw new Error(`Response status: ${response.status}`);
    }

    return response.json().then((json) => json.result[0].declination);
  }
}

/**
 * This class is used to transform EOV coordinates to WGS84 coordinates.
 * It uses the Bursa-Wolf transformation formula.
 * It is based on the following sources:
 * - https://github.com/dojerz/Eov2Wgs84
 * - https://sas2.elte.hu/tg/bajnok.htm
 * The algorithm was initally implemented in Excel (https://sas2.elte.hu/tg/bajnok25.xls)
 * by Gabor Timar at ELTE and later ported to C# by Peter Toth.
 *
 * Accuracy: The procedure for transformations between base surfaces includes the Bursa-Wolf transformation;
 * its accuracy is about 3 meters for conversions involving the stereographic projection, and better than
 * 1 meter in all other cases.
 *
 * The transformation is fairly precice.
 * EOV coordinates for Laci cave: 644741, 255551
 * This function gives implementation: 47.64378573513598, 18.97744998587031
 * ERDA.hu reference:                  47.643785,         18.977448 (17 cm difference)
 * PROJ library:                       47.6437852,        18.9774482 (13 cm difference)
 *
 * Links:
 *  - Proj transformation https://epsg.io/transform#s_srs=23700&t_srs=4326&ops=1242&x=644741.0000000&y=255551.0000000
 *  - ERDA.hu reference https://magyarorszag.erda.hu/
 */

class EOVToWGS84Transformer {

  static FROMhd72TOwgs84_p2 = [6378160, 6356774.516, 6378137, 6356752.3142];
  static FROMwgs84TOhd72_p2 = [6378137, 6356752.3142, 6378160, 6356774.516];
  static FROMhd72TOwgs84_p3 = [52.684, -71.194, -13.975, 0.312, 0.1063, 0.3729, 0.0000010191];

  constructor() {}

  eovTOwgs84(a, b) {
    let hd72_a = this.eovTOhd72(a, b);
    let wgsCoord = this.bursa_wolf(
      hd72_a,
      EOVToWGS84Transformer.FROMhd72TOwgs84_p2,
      EOVToWGS84Transformer.FROMhd72TOwgs84_p3
    );
    return wgsCoord;
  }

  eovTOhd72(b, a) {
    let x = (180 * 3600) / Math.PI;
    let c = 1.0007197049;
    let d = 19.048571778;
    let e = (d * Math.PI) / 180;
    let f = 47.1;
    let g = (f * Math.PI) / 180;
    let h = 6379296.419;
    let i = 47 + 7.0 / 60.0 + 20.0578 / 3600.0;
    let j = (i * Math.PI) / 180;
    let k = a - 200000;
    let l = b - 650000;

    let m = 2.0 * (Math.atan(Math.exp(k / h)) - Math.PI / 4.0);
    let n = l / h;
    let o = 47.0 + 1.0 / 6.0;
    let p = Math.asin(Math.cos(g) * Math.sin(m) + Math.sin(g) * Math.cos(m) * Math.cos(n));
    let q = Math.asin((Math.sin(n) * Math.cos(m)) / Math.cos(p));
    //let r = 0.822824894115397;
    let s = (p - j) * x;
    let t = (o * Math.PI) / 180;
    let u = 6378160;
    let v = 6356774.516;

    let w = ((u * u - v * v) * Math.cos(t) * Math.cos(t)) / v / v;
    let y = Math.pow(1 + w, 0.5);

    let z = (1.5 * w * Math.tan(t)) / x;
    let aa = (0.5 * w * (-1 + Math.tan(t) * Math.tan(t) - w + 5 * w * Math.tan(t) * Math.tan(t))) / y / x / x;
    let ab = t + (s * y) / x - (s * s * z) / x + (s * s * s * aa) / x;
    let ac = e + q / c;

    let ad = (ab * 180) / Math.PI;
    let ae = (ac * 180) / Math.PI;

    return [ad, ae, 0];
  }

  bursa_wolf(p1, p2, p3) {
    let fi_deg = p1[0];
    let la_deg = p1[1];
    let h = p1[2];

    let a1 = p2[0];
    let b1 = p2[1];
    let a2 = p2[2];
    let b2 = p2[3];

    let dX = p3[0];
    let dY = p3[1];
    let dZ = p3[2];
    let eX = p3[3];
    let eY = p3[4];
    let eZ = p3[5];
    let k = p3[6];

    let f = (a1 - b1) / a1;
    let e2 = 2 * f - f * f;
    let fi = (fi_deg * Math.PI) / 180;
    let la = (la_deg * Math.PI) / 180;
    let N = a1 / Math.pow(1 - e2 * Math.sin(fi) * Math.sin(fi), 0.5);
    let X = (N + h) * Math.cos(fi) * Math.cos(la);
    let Y = (N + h) * Math.cos(fi) * Math.sin(la);
    let Z = (N * (1 - e2) + h) * Math.sin(fi);
    let Xv = dX + (1 + k) * (X + degreesToRads(eZ / 3600) * Y - degreesToRads(eY / 3600) * Z);
    let Yv = dY + (1 + k) * (-X * degreesToRads(eZ / 3600) + Y + Z * degreesToRads(eX / 3600));
    let Zv = dZ + (1 + k) * (X * degreesToRads(eY / 3600) - Y * degreesToRads(eX / 3600) + Z);

    let f2 = (a2 - b2) / a2;
    let e22 = 2 * f2 - f2 * f2;
    let ev2 = (a2 * a2 - b2 * b2) / b2 / b2;
    let P = Math.pow(Xv * Xv + Yv * Yv, 0.5);
    let theta = Math.atan2(Zv * a2, P * b2);
    let FI2 = Math.atan2(
      Zv + ev2 * b2 * Math.sin(theta) * Math.sin(theta) * Math.sin(theta),
      P - e22 * a2 * Math.cos(theta) * Math.cos(theta) * Math.cos(theta)
    );
    let LA2 = Math.atan2(Yv, Xv);
    let N2 = a2 / Math.pow(1 - e22 * Math.sin(FI2) * Math.sin(FI2), 0.5);
    let fi2 = radsToDegrees(FI2);
    let la2 = radsToDegrees(LA2);
    let h2 = P / Math.cos(FI2) - N2;

    return [fi2, la2, h2];
  }

  negal(arr) {
    let ret_a = [];
    for (let item of arr) {
      ret_a.push(item * -1);
    }
    return ret_a;
  }
}

export { Declination, EOVToWGS84Transformer, MeridianConvergence };
