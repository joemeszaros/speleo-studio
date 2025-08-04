import { Vector, StationAttribute } from '../model.js';
import { StationCoordinates } from './geo.js';

/**
 * Enum for Shot types
 */
class ShotType {
  static CENTER = 'center';
  static SPLAY = 'splay';
  static AUXILIARY = 'auxiliary';

  static values() {
    return [ShotType.CENTER, ShotType.SPLAY, ShotType.AUXILIARY];
  }

  static isValid(type) {
    return ShotType.values().includes(type);
  }
}

class Shot {
  export_fields = ['id', 'type', 'from', 'to', 'length', 'azimuth', 'clino', 'comment'];

  constructor(id, type, from, to, length, azimuth, clino, comment) {
    this.id = id;
    this.type = type;
    this.from = from;
    this.to = to;
    this.length = length;
    this.azimuth = azimuth;
    this.clino = clino;
    this.comment = comment;
    this.processed = false;
  }

  isSplay() {
    return this.type === ShotType.SPLAY;
  }

  isCenter() {
    return this.type === ShotType.CENTER;
  }

  isAuxiliary() {
    return this.type === ShotType.AUXILIARY;
  }

  isValid() {
    return this.validate().length === 0;
  }

  validate() {
    const isValidFloat = (f) => {
      return typeof f === 'number' && f !== Infinity && !isNaN(f);
    };

    const errors = [];
    if (!(typeof this.id === 'number' && this.id == parseInt(this.id, 10))) {
      errors.push(`Id (${this.id}, type=${typeof this.id}) is not valid integer number`);
    }
    if (!(typeof this.type === 'string' && ShotType.isValid(this.type))) {
      errors.push(`Type (${this.type}) is not a valid shot type`);
    }
    if (!(typeof this.from === 'string' && this.from.length > 0)) {
      errors.push(`From (${this.from}, type=${typeof this.from}) is not a string or empty`);
    } else if (typeof this.to === 'string' && this.to.length > 0) {
      if (this.from === this.to) {
        errors.push(`From (${this.from}) and to (${this.to}) cannot be the same`);
      }
    }

    if (isValidFloat(this.length) && this.length <= 0) {
      errors.push(`Length must be greater than 0`);
    }

    if (isValidFloat(this.clino) && (this.clino > 90 || this.clino < -90)) {
      errors.push(`Clino should be between -90 and 90.`);
    }

    if (isValidFloat(this.azimuth) && (this.azimuth > 360 || this.clino < -360)) {
      errors.push(`Azimuth should be between -360 and 360.`);
    }

    ['length', 'azimuth', 'clino'].forEach((f) => {
      if (!isValidFloat(this[f])) {
        errors.push(`${f} (${this[f]}, type=${typeof this[f]}) is not a valid decimal number`);
      }
    });

    return errors;

  }

  getEmptyFields() {
    return this.export_fields
      .filter((f) => f !== 'to' && f !== 'comment')
      .filter((f) => this[f] === undefined || this[f] === null);
  }

  isComplete() {
    return this.getEmptyFields().length === 0;
  }

  toExport() {
    let newShot = {};
    this.export_fields.forEach((fName) => {
      newShot[fName] = this[fName];
    });
    return newShot;
  }
}

class SurveyStation {

  /**
   *
   * @param {string} type - the type of the station, could be center and splay
   * @param {Vector} position - the 3D vector representing the position of the station
   * @param {Survey} survey - the survey that this station belongs to
   */
  constructor(type, position, coordinates, survey) {
    this.type = type;
    this.position = position;
    this.coordinates = coordinates;
    this.survey = survey;
  }

  isCenter() {
    return this.type === ShotType.CENTER;
  }

  isSplay() {
    return this.type === ShotType.SPLAY;
  }

  isAuxiliary() {
    return this.type === ShotType.AUXILIARY;
  }

  toExport() {
    return {
      type     : this.type,
      position : this.position.toExport(),
      eov      : this.coordinates.toExport()
    };
  }

  static fromPure(pure) {
    pure.position = Vector.fromPure(pure.position);
    pure.coordinates = StationCoordinates.fromPure(pure.coordinates);
    return Object.assign(new SurveyStation(), pure);
  }
}

class SurveyTeamMember {
  constructor(name, role) {
    this.name = name;
    this.role = role;
  }
}

class SurveyTeam {
  constructor(name, members = []) {
    this.name = name;
    this.members = members;
  }
}

class SurveyInstrument {
  constructor(name, value) {
    this.name = name;
    this.value = value;
  }
}

class SurveyMetadata {

  constructor(date, declination, convergence, team, instruments = []) {
    this.date = date;
    this.declination = declination;
    this.convergence = convergence;
    this.team = team;
    this.instruments = instruments;
  }
}

class Survey {

  /**
   *
   * @param {string} name - The name of the Survey
   * @param {boolean} visible
   * @param {string} - The start point of the whole survey that was explicitly specified for a survey
   * @param {Array[Shot]} shots - An array of shots holding the measurements for this Survey
   * @param {Array[Number]} orphanShotIds - An array of orphan shots that are disconnected (from and/or to is unknown)
   * @param {Array[Object]} attributes - Extra attributes (e.g. tectonics information) associated to this Survey
   */
  constructor(
    name,
    visible = true,
    metadata = undefined,
    start = undefined,
    shots = [],
    orphanShotIds = new Set(),
    attributes = []
  ) {
    this.name = name;
    this.visible = visible;
    this.metadata = metadata;
    this.start = start;
    this.shots = shots;
    this.orphanShotIds = orphanShotIds;
    this.attributes = attributes;
    this.isolated = false;
    this.validShots = this.getValidShots();
    this.invalidShotIds = this.getInvalidShotIds();
  }

  getSplayStationName(id) {
    return `splay-${id}@${this.name}`;
  }

  getAuxiliaryStationName(id) {
    return `auxiliary-${id}@${this.name}`;
  }

  getFromStationName(shot) {
    return shot.fromAlias !== undefined ? shot.fromAlias : shot.from;
  }

  getToStationName(shot) {
    if (shot.isSplay()) {
      return this.getSplayStationName(shot.id);
    } else if (shot.toAlias !== undefined) {
      return shot.toAlias;
    } else {
      return shot.to;
    }
  }

  updateShots(shots) {
    this.shots = shots;
    this.validShots = this.getValidShots();
    this.invalidShotIds = this.getInvalidShotIds();
  }

  getValidShots() {
    return this.shots.filter((sh) => sh.isComplete() && sh.isValid());
  }

  getInvalidShotIds() {
    return new Set(this.shots.filter((sh) => !sh.isComplete() || !sh.isValid()).map((sh) => sh.id));
  }

  /**
   * Returns all the attributes with the given name for all stations
   *
   * @param {string} name - The name an attribute, see attribute definitons for more information.
   * @returns {Array[Array[Vector, Object]]>} - Attribute params with 3D position
   */
  getAttributesWithPositionsByName(stations, name) {
    return (
      this.attributes
        .filter((sa) => sa.attribute.name === name)
        .map((sa) => {
          const pos = stations.get(sa.name).position;
          return [pos, sa.attribute];

        })
    );
  }

  toExport() {
    return {
      name       : this.name,
      start      : this.start,
      attributes : this.attributes.map((sta) => sta.toExport()),
      shots      : this.shots.map((s) => s.toExport())
    };
  }

  static fromPure(pure, attributeDefs) {
    pure.attributes = pure.attributes
      .map((a) => new StationAttribute(a.name, attributeDefs.createFromPure(a.attribute)));
    pure.shots = pure.shots.map((s) => Object.assign(new Shot(), s));
    const survey = Object.assign(new Survey(), pure);
    survey.validShots = survey.getValidShots();
    survey.invalidShotIds = survey.getInvalidShotIds();
    return survey;
  }

}

class SurveyAlias {
  constructor(from, to) {
    this.from = from;
    this.to = to;
  }

  contains(n) {
    return this.from === n || this.to === n;
  }

  getPair(n) {
    if (this.from === n) {
      return this.to;
    } else if (this.to === n) {
      return this.from;
    } else {
      return undefined;
    }
  }

  toExport() {
    return {
      from : this.from,
      to   : this.to
    };
  }

  static fromPure(pure) {
    return Object.assign(new SurveyAlias(), pure);
  }
}

export {
  ShotType,
  Shot,
  SurveyStation,
  SurveyTeamMember,
  SurveyTeam,
  SurveyInstrument,
  SurveyMetadata,
  Survey,
  SurveyAlias
};
