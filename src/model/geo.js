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

import { Vector } from '../model.js';

class EOVCoordinate {
  constructor(y, x) {
    this.y = y;
    this.x = x;
  }

  toExport() {
    return {
      y : this.y,
      x : this.x
    };
  }

  static fromPure(pure) {
    return Object.assign(new EOVCoordinate(), pure);
  }
}

class UTMCoordinate {
  constructor(easting, northing) {
    this.easting = easting;
    this.northing = northing;
  }

  toExport() {
    return {
      easting  : this.easting,
      northing : this.northing
    };
  }

  static fromPure(pure) {
    return Object.assign(new UTMCoordinate(), pure);
  }
}

class EOVCoordinateWithElevation extends EOVCoordinate {

  constructor(y, x, elevation) {
    super(y, x);
    this.elevation = elevation;
    this.type = CoordinateSystemType.EOV;
  }

  toVector() {
    return new Vector(this.y, this.x, this.elevation);
  }

  add(y, x, elevation) {
    return new EOVCoordinateWithElevation(this.y + y, this.x + x, this.elevation + elevation);
  }

  addVector(v) {
    return new EOVCoordinateWithElevation(this.y + v.x, this.x + v.y, this.elevation + v.z);
  }

  sub(y, x, elevation) {
    return new EOVCoordinateWithElevation(this.y - y, this.x - x, this.elevation - elevation);
  }

  isValid() {
    return this.validate().length === 0;
  }

  distanceTo(v) {
    const dx = this.x - v.x,
      dy = this.y - v.y,
      de = this.elevation - v.elevation;
    return Math.sqrt(dx * dx + dy * dy + de * de);
  }

  validate(i18n) {

    const errors = [];

    const isValidFloat = (f) => {
      return typeof f === 'number' && f !== Infinity && !isNaN(f);
    };

    const t = (key, params) => {
      if (i18n) {
        return i18n.t(key, params);
      } else {
        return key;
      }
    };

    ['x', 'y', 'elevation'].forEach((coord) => {
      if (!isValidFloat(this[coord])) {
        errors.push(t('validation.geo.invalidCoordinate', { coord: coord, thisCoord: this[coord] }));
      }
    });

    if (this.x > 400_000 || this.x < 0) {
      errors.push(t('validation.geo.outOfBounds', { XYZ: 'X', coord: this.x, bounds: '0 - 400 000' }));
    }

    if (this.y < 400_000 || this.y > 950_000) {
      errors.push(t('validation.geo.outOfBounds', { XYZ: 'Y', coord: this.y, bounds: '400 000 - 950 000' }));
    }

    if (this.elevation < -3000 || this.elevation > 5000) {
      //GO GO cave explorers for deep and high caves!
      errors.push(t('validation.geo.outOfBounds', { XYZ: 'Z', coord: this.elevation, bounds: '-3000 - +5000' }));
    }
    return errors;
  }

  isEqual(other) {
    return this.y === other.y && this.x === other.x && this.elevation === other.elevation;
  }

  toExport() {
    return {
      y         : this.y,
      x         : this.x,
      elevation : this.elevation,
      type      : this.type
    };
  }

  static fromPure(pure) {
    return Object.assign(new EOVCoordinateWithElevation(), pure);
  }
}

class UTMCoordinateWithElevation extends UTMCoordinate {
  constructor(easting, northing, elevation) {
    super(easting, northing);
    this.elevation = elevation;
    this.type = CoordinateSystemType.UTM;
  }

  addVector(v) {
    return new UTMCoordinateWithElevation(this.easting + v.x, this.northing + v.y, this.elevation + v.z);
  }

  toVector() {
    return new Vector(this.easting, this.northing, this.elevation);
  }

  distanceTo(v) {
    const de = this.easting - v.easting,
      dn = this.northing - v.northing,
      dz = this.elevation - v.elevation;
    return Math.sqrt(de * de + dn * dn + dz * dz);
  }

  isValid() {
    return this.validate().length === 0;
  }

  validate(i18n) {

    const errors = [];

    const isValidFloat = (f) => {
      return typeof f === 'number' && f !== Infinity && !isNaN(f);
    };

    const t = (key, params) => {
      if (i18n) {
        return i18n.t(key, params);
      } else {
        return key;
      }
    };

    ['easting', 'northing', 'elevation'].forEach((coord) => {
      if (!isValidFloat(this[coord])) {
        errors.push(t('validation.geo.invalidCoordinate', { coord: coord, thisCoord: this[coord] }));
      }
    });

    if (this.easting < 167_000 || this.easting > 883_000) {
      errors.push(
        t('validation.geo.outOfBounds', {
          XYZ    : i18n.t('validation.geo.easting'),
          coord  : this.easting,
          bounds : '167 000 - 883 000'
        })
      );
    }

    if (this.northing < 0 || this.northing > 1e7) {
      errors.push(
        t('validation.geo.outOfBounds', {
          XYZ    : i18n.t('validation.geo.northing'),
          coord  : this.northing,
          bounds : '0 - 10 000 000'
        })
      );
    }

    if (this.elevation < -3000 || this.elevation > 5000) {
      //GO GO cave explorers for deep and high caves!
      errors.push(t('validation.geo.outOfBounds', { XYZ: 'Z', coord: this.elevation, bounds: '-3000 - +5000' }));
    }
    return errors;
  }

  toExport() {
    return {
      easting   : this.easting,
      northing  : this.northing,
      elevation : this.elevation,
      type      : this.type
    };
  }

  isEqual(other) {
    return other !== undefined &&
      this.easting === other.easting &&
      this.northing === other.northing &&
      this.elevation === other.elevation;
  }

  static fromPure(pure) {
    return Object.assign(new UTMCoordinateWithElevation(), pure);
  }

}

class WGS84Coordinate {
  constructor(lat, lon) {
    this.lat = lat;
    this.lon = lon;
  }

  isEqual(other) {
    return this.lat === other.lat && this.lon === other.lon;
  }
}

function deserializeCoordinate(pure) {
  if (pure.type === CoordinateSystemType.EOV) {
    return EOVCoordinateWithElevation.fromPure(pure);
  } else if (pure.type === CoordinateSystemType.UTM) {
    return UTMCoordinateWithElevation.fromPure(pure);
  }
}

class StationWithCoordinate {
  constructor(name, coordinate) {
    this.name = name;
    this.coordinate = coordinate;
  }

  isEqual(other) {
    return this.name === other.name && this.coordinate.isEqual(other.coordinate);
  }

  toExport() {
    return {
      name       : this.name,
      coordinate : this.coordinate.toExport()
    };
  }

  static fromPure(pure) {
    pure.coordinate = deserializeCoordinate(pure.coordinate);
    return Object.assign(new StationWithCoordinate(), pure);
  }
}

class StationCoordinates {
  constructor(local, projected, wgs) {
    this.local = local;
    this.projected = projected;
    this.wgs = wgs;
  }
}

const CoordinateSystemType = Object.freeze({
  EOV : 'eov',
  UTM : 'utm'
});

class CoordinateSystem {
  constructor(type, name, epsgId) {
    this.type = type;
    this.name = name;
    this.epsgId = epsgId;
  }

  toString() {
    return this.name;
  }

  toExport() {
    return {
      type   : this.type,
      epsgId : this.epsgId,
      name   : this.name
    };
  }

  isEqual(other) {
    return other !== undefined && this.type === other.type && this.epsgId === other.epsgId;
  }

}

class EOVCoordinateSystem extends CoordinateSystem {
  constructor() {
    super(CoordinateSystemType.EOV, 'Egységes országos vetület', 23700);
  }

  toString() {
    return 'EOV';
  }

  static fromPure() {
    return new EOVCoordinateSystem();
  }
}

class UTMCoordinateSystem extends CoordinateSystem {

  constructor(zoneNum, northern) {
    const epsgId = northern ? 32600 + zoneNum : 32700 + zoneNum;
    super(CoordinateSystemType.UTM, 'Universal Transverse Mercator', epsgId);
    this.zoneNum = zoneNum;
    this.northern = northern;
  }

  toString() {
    return `UTM ${this.zoneNum} (${this.northern ? 'N' : 'S'})`;
  }

  toExport() {
    return {
      type     : this.type,
      epsgId   : this.epsgId,
      name     : this.name,
      zoneNum  : this.zoneNum,
      northern : this.northern
    };
  }

  static fromPure(pure) {
    return new UTMCoordinateSystem(pure.zoneNum, pure.northern);
  }
}

function deserializeCoordinateSystem(pure) {

  switch (pure.type) {
    case CoordinateSystemType.EOV:
      return EOVCoordinateSystem.fromPure(pure);
    case CoordinateSystemType.UTM:
      return UTMCoordinateSystem.fromPure(pure);
  }
}

class GeoData {
  constructor(coordinateSystem, coordinates = []) {
    this.coordinateSystem = coordinateSystem;
    this.coordinates = coordinates;
  }

  isEqual(other) {
    return other !== undefined &&
      this.coordinateSystem.isEqual(other.coordinateSystem) &&
      this.coordinates.length === other.coordinates.length &&
      this.coordinates.every((c, i) => c.isEqual(other.coordinates[i]));
  }

  toExport() {
    return {
      coordinateSystem : this.coordinateSystem.toExport(),
      coordinates      : this.coordinates.map((c) => c.toExport())
    };
  }

  static fromPure(pure) {
    // we need to migrate, later we can delete this code section
    // there is no type in coordinates
    if (pure.coordinateSystem === CoordinateSystemType.EOV) {
      const coords = pure.coordinates.map(
        (c) =>
          new StationWithCoordinate(
            c.name,
            new EOVCoordinateWithElevation(c.coordinate.y, c.coordinate.x, c.coordinate.elevation)
          )
      );
      return new GeoData(new EOVCoordinateSystem(), coords);
    } else {
      if (pure.coordinateSystem) {
        pure.coordinateSystem = deserializeCoordinateSystem(pure.coordinateSystem);
      }
      pure.coordinates = pure.coordinates.map((c) => StationWithCoordinate.fromPure(c));
      return Object.assign(new GeoData(), pure);
    }
  }
}

export {
  EOVCoordinateWithElevation,
  UTMCoordinateWithElevation,
  WGS84Coordinate,
  StationCoordinates,
  StationWithCoordinate,
  GeoData,
  CoordinateSystem,
  EOVCoordinateSystem,
  UTMCoordinateSystem,
  CoordinateSystemType
};
