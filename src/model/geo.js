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

class EOVCoordinateWithElevation extends EOVCoordinate {

  constructor(y, x, elevation) {
    super(y, x);
    this.elevation = elevation;
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

  subVector(v) {
    return new EOVCoordinateWithElevation(this.y - v.x, this.x - v.y, this.elevation - v.z);
  }

  isValid() {
    return this.validate().length === 0;
  }

  validate() {

    const errors = [];

    const isValidFloat = (f) => {
      return typeof f === 'number' && f !== Infinity && !isNaN(f);
    };

    [this.x, this.y, this.elevation].forEach((coord) => {
      if (!isValidFloat(coord)) {
        errors.push(`Coordinate '${coord}'is not a valid float number`);
      }
    });

    if (this.x > 400_000 || this.x < 0) {
      errors.push(`X coordinate '${this.x}' is out of bounds`);
    }

    if (this.y < 400_000) {
      errors.push(`Y coordinate '${this.y}' is out of bounds`);
    }

    if (this.elevation < -3000 || this.elevation > 5000) {
      //GO GO cave explorers for deep and high caves!
      errors.push(`Z coordinate '${this.elevation}' is out of bounds`);
    }
    return errors;
  }

  toExport() {
    return {
      y         : this.y,
      x         : this.x,
      elevation : this.elevation
    };
  }

  static fromPure(pure) {
    return Object.assign(new EOVCoordinateWithElevation(), pure);
  }
}

class WGS84Coordinate {
  constructor(lat, lon) {
    this.lat = lat;
    this.lon = lon;
  }
}

class StationWithCoordinate {
  constructor(name, coordinate) {
    this.name = name;
    this.coordinate = coordinate;
  }

  toExport() {
    return {
      name : this.name,
      eov  : this.coordinate.toExport()
    };
  }

  static fromPure(pure) {
    pure.eov = EOVCoordinateWithElevation.fromPure(pure.eov);
    return Object.assign(new StationWithCoordinate(), pure);
  }
}

class StationCoordinates {
  constructor(local, eov, wgs) {
    this.local = local;
    this.eov = eov;
    this.wgs = wgs;
  }
}

const CoordinateSytem = Object.freeze({
  EOV   : 'eov',
  WGS84 : 'wgs84'
});

class GeoData {
  constructor(coordinateSystem, coordinates = []) {
    this.coordinateSystem = coordinateSystem;
    this.coordinates = coordinates;
  }

  toExport() {
    return {
      coordinateSystem : this.coordinateSystem,
      coordinates      : this.coordinates.map((c) => c.toExport())
    };
  }

  static fromPure(pure) {
    return Object.assign(new GeoData(), pure);
  }
}

export {
  EOVCoordinateWithElevation,
  WGS84Coordinate,
  StationCoordinates,
  StationWithCoordinate,
  GeoData,
  CoordinateSytem
};
