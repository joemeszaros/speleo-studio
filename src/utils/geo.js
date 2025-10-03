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

import { degreesToRads, radsToDegrees } from './utils.js';
import { CoordinateSystemType } from '../model/geo.js';
import { i18n } from '../i18n/i18n.js';

class MeridianConvergence {

  static EARTH_RADIUS = 6379296.41898993;

  /**
   * Get the meridian convergence at a given EOV coordinate.
   * This is the angle between the meridian and the north direction.
   * To understand the meridian convergence, see: https://jerrymahun.com/index.php/home/open-access/32-vi-directions/265-chapter-c-meridian-conversion?start=3
   * A Hungarian explanation: http://geopont.elte.hu/tajfutas/magyar/tajolo/01-2/eszak2.htm
   * For future calculation: https://citeseerx.ist.psu.edu/document?repid=rep1&type=pdf&doi=d471b57777352afe669ef17eb122986eb231a2cb
   * @param {*} y EOV y coordinate
   * @param {*} x EOV x coordinate
   * @returns
   */
  static getEOVConvergence(y, x) {
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

  static centralMeridianDeg(zone) {
    return 6 * zone - 183; // degrees
  }

  /**
   * Get the meridian convergence at a given UTM coordinate.
   *
   * There is an other formualate expressed on the wiki page: https://en.wikipedia.org/wiki/Transverse_Mercator_projection#Convergence
   * convergence = (Math.atan(Math.tanh(E / (a * k0)) * Math.tan(N / (a * k0))) * 180) / Math.PI;
   *
   * but I decided to use this formula because it is equivalent to the values I have found on:
   *  - https://geodesyapps.ga.gov.au/grid-to-geographic
   *  - https://twcc.fr/
   *
   * For a random Hungarian position (47.646821, 19.02363) or (351570.942, 5278939.251, 34T) the value is -1.4608.
   * The other implementation gives -1.45208.
   */
  static getUTMConvergence(easting, northing, zone, northern = true) {

    const { latitude, longitude } = UTMConverter.toLatLon(easting, northing, zone, undefined, northern);
    const phi = degreesToRads(latitude);
    const lon0 = degreesToRads(this.centralMeridianDeg(zone));
    const lam = degreesToRads(longitude);
    const dlam = lam - lon0;

    // Spherical formula (commonly used; good to <~ a few arc-seconds for most cases)
    const gammaRad = Math.atan(Math.tan(dlam) * Math.sin(phi));
    return radsToDegrees(gammaRad); // degrees, positive east of true north
  }
}

class Declination {

  static async getDeclination(cache, lat, long, date, timeoutInMs = 3000) {
    // First, try to get from cache if available
    try {
      const cachedDeclination = await cache.get(lat, long, date);
      if (cachedDeclination !== null) {
        return cachedDeclination;
      }
    } catch (error) {
      console.warn('Failed to read from declination cache:', error);
      // Continue with API call if cache fails
    }

    // If not in cache, make API call
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

    const start = Date.now();
    console.log(`Fetching NOAA declination API: ${url}?${params}`);
    const response = await fetch(`${url}?${params}`, { signal: AbortSignal.timeout(timeoutInMs) });
    console.log(`Request took ${Date.now() - start}ms`);

    if (!response.ok) {
      throw new Error(i18n.t('errors.utils.geo.responseStatusError', { status: response.status }));
    }

    const declination = await response.json().then((json) => json.result[0].declination);

    // Cache the result for future use if cache is available

    try {
      await cache.set(lat, long, date, declination);
    } catch (error) {
      console.warn('Failed to cache declination value:', error);
      // Don't throw error - caching failure shouldn't break the main functionality
    }

    return declination;
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
 * This function gives:                47.64378573513598, 18.97744998587031
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

  static eovTOwgs84(a, b) {
    let hd72_a = this.eovTOhd72(a, b);
    let wgsCoord = this.bursa_wolf(
      hd72_a,
      EOVToWGS84Transformer.FROMhd72TOwgs84_p2,
      EOVToWGS84Transformer.FROMhd72TOwgs84_p3
    );
    return wgsCoord;
  }

  static eovTOhd72(b, a) {
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

  static bursa_wolf(p1, p2, p3) {
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

}

class WGS84Converter {
  static toLatLon(coordinate, coordinateSystem) {
    if (coordinateSystem.type === CoordinateSystemType.EOV) {
      const [lat, lon] = EOVToWGS84Transformer.eovTOwgs84(coordinate.y, coordinate.x);
      return { latitude: lat, longitude: lon };
    } else if (coordinateSystem.type === CoordinateSystemType.UTM) {
      return UTMConverter.toLatLon(
        coordinate.easting,
        coordinate.northing,
        coordinateSystem.zoneNum,
        undefined,
        coordinateSystem.northern
      );
    }
  }
}

/**
 * Calculates strike and dip of a plane from 3 3D coordinates.
 * This is commonly used in structural geology and 3D modeling.
 *
 * Strike: The direction of the horizontal line in the plane (0-360° from North)
 * Dip: The angle between the plane and horizontal (0-90°)
 *
 * @param {Vector} point1 - Vector object representing first point
 * @param {Vector} point2 - Vector object representing second point
 * @param {Vector} point3 - Vector object representing third point
 * @returns {Object} Object containing strike and dip in degrees
 */
class StrikeDipCalculator {

  /**
   * Calculate strike and dip from 3 3D points
   * @param {Vector} point1 - Vector object
   * @param {Vector} point2 - Vector object
   * @param {Vector} point3 - Vector object
   * @returns {Object} {strike: number, dip: number, normal: Vector} in degrees
   */
  static calculateStrikeDip(point1, point2, point3) {
    // Calculate two vectors in the plane using Vector operations
    const v1 = point2.sub(point1);
    const v2 = point3.sub(point1);

    // Calculate normal vector using cross product
    const normal = v1.cross(v2);

    // Normalize the normal vector
    const normalizedNormal = normal.normalize();

    // Calculate strike (direction of horizontal line in plane)
    // Strike is perpendicular to the normal vector's horizontal projection
    const strike = Math.atan2(-normalizedNormal.y, normalizedNormal.x);

    // Convert to degrees and adjust to geological convention (0-360° from North)
    let strikeDegrees = radsToDegrees(strike);
    if (strikeDegrees < 0) {
      strikeDegrees += 360;
    }

    // Calculate dip (angle between plane and horizontal)
    // Dip is the angle between the normal vector and vertical
    const dip = Math.acos(Math.abs(normalizedNormal.z));
    const dipDegrees = radsToDegrees(dip);

    return {
      strike : strikeDegrees,
      dip    : dipDegrees,
      normal : normalizedNormal
    };
  }

  /**
   * Validate that three points define a valid plane
   * @param {Vector} point1 - Vector object
   * @param {Vector} point2 - Vector object
   * @param {Vector} point3 - Vector object
   * @returns {boolean} True if points define a valid plane
   */
  static isValidPlane(point1, point2, point3) {
    // Check if points are collinear (would result in zero normal vector)
    const v1 = point2.sub(point1);
    const v2 = point3.sub(point1);
    const normal = v1.cross(v2);

    const magnitude = normal.magnitude();

    // If magnitude is very small, points are collinear or coincident
    return magnitude > 1e-10;
  }
}

/**
 * UTMConverter is a class that converts between latitude/longitude and UTM coordinates.
 * It is based on the following sources:
 *  - https://www.ccgalberta.com/ccgresources/report11/2009-410_converting_latlon_to_utm.pdf
 *  - https://github.com/Turbo87/utm
 *  - https://en.wikipedia.org/wiki/Universal_Transverse_Mercator_coordinate_system
 */
class UTMConverter {

  static K0 = 0.9996;

  static E = 0.00669438;
  static E2 = Math.pow(this.E, 2);
  static E3 = Math.pow(this.E, 3);
  static E_P2 = this.E / (1 - this.E);

  static SQRT_E = Math.sqrt(1 - this.E);
  static _E = (1 - this.SQRT_E) / (1 + this.SQRT_E);
  static _E2 = Math.pow(this._E, 2);
  static _E3 = Math.pow(this._E, 3);
  static _E4 = Math.pow(this._E, 4);
  static _E5 = Math.pow(this._E, 5);

  static M1 = 1 - this.E / 4 - (3 * this.E2) / 64 - (5 * this.E3) / 256;
  static M2 = (3 * this.E) / 8 + (3 * this.E2) / 32 + (45 * this.E3) / 1024;
  static M3 = (15 * this.E2) / 256 + (45 * this.E3) / 1024;
  static M4 = (35 * this.E3) / 3072;

  static P2 = (3 / 2) * this._E - (27 / 32) * this._E3 + (269 / 512) * this._E5;
  static P3 = (21 / 16) * this._E2 - (55 / 32) * this._E4;
  static P4 = (151 / 96) * this._E3 - (417 / 128) * this._E5;
  static P5 = (1097 / 512) * this._E4;

  static R = 6378137;

  static _5e5 = 500000;
  static _1e5 = 1e5;
  static _1e6 = 1e6;
  static _1e7 = 1e7;

  static ZONE_LETTERS = 'CDEFGHJKLMNPQRSTUVWXX';

  static #toZoneLetter(latitude) {
    const { ZONE_LETTERS } = this;
    if (-80 <= latitude && latitude <= 84) {
      return ZONE_LETTERS.charAt(Math.floor((latitude + 80) / 8));
    } else {
      return null;
    }
  }

  static #toZoneNumber(latitude, longitude) {
    if (56 <= latitude && latitude < 64 && 3 <= longitude && longitude < 12) return 32;

    if (72 <= latitude && latitude <= 84 && longitude >= 0) {
      if (longitude < 9) return 31;
      if (longitude < 21) return 33;
      if (longitude < 33) return 35;
      if (longitude < 42) return 37;
    }

    return Math.floor((longitude + 180) / 6) + 1;
  }

  static #toCentralLongitude(zoneNum) {
    return (zoneNum - 1) * 6 - 180 + 3;
  }

  static toLatLon(easting, northing, zoneNum, zoneLetter, northern) {

    const { ZONE_LETTERS, K0, R, M1, P2, P3, P4, P5, E, _E, E_P2, _5e5, _1e5, _1e6, _1e7 } = this;

    if (!zoneLetter && northern === undefined) {
      throw new Error(i18n.t('errors.utils.geo.utmZoneOrNorthernNeeded'));
    } else if (zoneLetter && northern !== undefined) {
      throw new Error(i18n.t('errors.utils.geo.utmZoneOrNorthernBothSet'));
    }

    if (easting < _1e5 || _1e6 <= easting) {
      throw new RangeError(i18n.t('errors.utils.geo.eastingOutOfRange'));
    }
    if (northing < 0 || northing > _1e7) {
      throw new RangeError(i18n.t('errors.utils.geo.northingOutOfRange'));
    }

    if (zoneNum < 1 || zoneNum > 60) {
      throw new RangeError(i18n.t('errors.utils.geo.zoneNumberOutOfRange'));
    }
    if (zoneLetter) {
      zoneLetter = zoneLetter.toUpperCase();
      if (zoneLetter.length !== 1 || ZONE_LETTERS.indexOf(zoneLetter) === -1) {
        throw new RangeError(i18n.t('errors.utils.geo.zoneLetterOutOfRange'));
      }
      northern = zoneLetter >= 'N';
    }

    var x = easting - _5e5;
    var y = northing;

    if (!northern) y -= _1e7;

    var m = y / K0;
    var mu = m / (R * M1);

    var pRad = mu + P2 * Math.sin(2 * mu) + P3 * Math.sin(4 * mu) + P4 * Math.sin(6 * mu) + P5 * Math.sin(8 * mu);

    var pSin = Math.sin(pRad);
    var pSin2 = Math.pow(pSin, 2);

    var pCos = Math.cos(pRad);

    var pTan = Math.tan(pRad);
    var pTan2 = Math.pow(pTan, 2);
    var pTan4 = Math.pow(pTan, 4);

    var epSin = 1 - E * pSin2;
    var epSinSqrt = Math.sqrt(epSin);

    var n = R / epSinSqrt;
    var r = (1 - E) / epSin;

    var c = _E * pCos * pCos;
    var c2 = c * c;

    var d = x / (n * K0);
    var d2 = Math.pow(d, 2);
    var d3 = Math.pow(d, 3);
    var d4 = Math.pow(d, 4);
    var d5 = Math.pow(d, 5);
    var d6 = Math.pow(d, 6);

    var latitude =
      pRad -
      (pTan / r) * (d2 / 2 - (d4 / 24) * (5 + 3 * pTan2 + 10 * c - 4 * c2 - 9 * E_P2)) +
      (d6 / 720) * (61 + 90 * pTan2 + 298 * c + 45 * pTan4 - 252 * E_P2 - 3 * c2);
    var longitude =
      (d - (d3 / 6) * (1 + 2 * pTan2 + c) + (d5 / 120) * (5 - 2 * c + 28 * pTan2 - 3 * c2 + 8 * E_P2 + 24 * pTan4)) /
      pCos;

    return {
      latitude  : radsToDegrees(latitude),
      longitude : radsToDegrees(longitude) + this.#toCentralLongitude(zoneNum)
    };
  }

  static fromLatLon(latitude, longitude) {
    if (latitude > 84 || latitude < -80) {
      throw new RangeError(i18n.t('errors.utils.geo.latitudeOutOfRange'));
    }
    if (longitude > 180 || longitude < -180) {
      throw new RangeError(i18n.t('errors.utils.geo.longitudeOutOfRange'));
    }

    const { R, E, E_P2, M1, M2, M3, M4, K0, _1e7, _5e5 } = UTMConverter;

    var latRad = degreesToRads(latitude);
    var latSin = Math.sin(latRad);
    var latCos = Math.cos(latRad);

    var latTan = Math.tan(latRad);
    var latTan2 = Math.pow(latTan, 2);
    var latTan4 = Math.pow(latTan, 4);

    var zoneNum = this.#toZoneNumber(latitude, longitude);

    var zoneLetter = this.#toZoneLetter(latitude);

    var lonRad = degreesToRads(longitude);
    var centralLon = this.#toCentralLongitude(zoneNum);
    var centralLonRad = degreesToRads(centralLon);

    var n = R / Math.sqrt(1 - E * latSin * latSin);
    var c = E_P2 * latCos * latCos;

    var a = latCos * (lonRad - centralLonRad);
    var a2 = Math.pow(a, 2);
    var a3 = Math.pow(a, 3);
    var a4 = Math.pow(a, 4);
    var a5 = Math.pow(a, 5);
    var a6 = Math.pow(a, 6);

    var m = R * (M1 * latRad - M2 * Math.sin(2 * latRad) + M3 * Math.sin(4 * latRad) - M4 * Math.sin(6 * latRad));
    var easting =
      K0 * n * (a + (a3 / 6) * (1 - latTan2 + c) + (a5 / 120) * (5 - 18 * latTan2 + latTan4 + 72 * c - 58 * E_P2)) +
      _5e5;
    var northing =
      K0 *
      (m +
        n *
          latTan *
          (a2 / 2 +
            (a4 / 24) * (5 - latTan2 + 9 * c + 4 * c * c) +
            (a6 / 720) * (61 - 58 * latTan2 + latTan4 + 600 * c - 330 * E_P2)));

    if (latitude < 0) northing += _1e7;

    return {
      easting    : easting,
      northing   : northing,
      zoneNum    : zoneNum,
      zoneLetter : zoneLetter
    };
  }

}

export { Declination, EOVToWGS84Transformer, MeridianConvergence, StrikeDipCalculator, UTMConverter, WGS84Converter };
