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

  distanceTo(v) {
    const dx = this.x - v.x,
      dy = this.y - v.y,
      de = this.elevation - v.elevation;
    return Math.sqrt(dx * dx + dy * dy + de * de);
  }

  validate() {

    const errors = [];

    const isValidFloat = (f) => {
      return typeof f === 'number' && f !== Infinity && !isNaN(f);
    };

    ['x', 'y', 'elevation'].forEach((coord) => {
      if (!isValidFloat(this[coord])) {
        errors.push(`Coordinate ${coord}: '${this[coord]}'is not a valid float number`);
      }
    });

    if (this.x > 400_000 || this.x < 0) {
      errors.push(`X coordinate '${this.x}' is out of bounds (0-400000)`);
    }

    if (this.y < 400_000) {
      errors.push(`Y coordinate '${this.y}' is out of bounds (400000-)`);
    }

    if (this.elevation < -3000 || this.elevation > 5000) {
      //GO GO cave explorers for deep and high caves!
      errors.push(`Z coordinate '${this.elevation}' is out of bounds`);
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

  isEqual(other) {
    return this.lat === other.lat && this.lon === other.lon;
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
    pure.coordinate = EOVCoordinateWithElevation.fromPure(pure.coordinate);
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

  isEqual(other) {
    return this.coordinateSystem === other.coordinateSystem &&
      this.coordinates.length === other.coordinates.length &&
      this.coordinates.every((c, i) => c.isEqual(other.coordinates[i]));
  }

  toExport() {
    return {
      coordinateSystem : this.coordinateSystem,
      coordinates      : this.coordinates.map((c) => c.toExport())
    };
  }

  static fromPure(pure) {
    pure.coordinates = pure.coordinates.map((c) => StationWithCoordinate.fromPure(c));
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
