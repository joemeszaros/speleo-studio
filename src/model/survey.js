import { Vector } from '../model.js';
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

  validate(i18n) {
    const isValidFloat = (f) => {
      return typeof f === 'number' && f !== Infinity && !isNaN(f);
    };
    // when someone calls .isValid() we do not need to make the translations
    const t = (key, params) => {
      if (i18n) {
        return i18n.t(key, params);
      } else {
        return key;
      }
    };

    const errors = [];
    if (!(typeof this.id === 'number' && this.id == parseInt(this.id, 10))) {
      errors.push(t('validation.shot.invalidId', { id: this.id, type: typeof this.id }));
    }
    if (!(typeof this.type === 'string' && ShotType.isValid(this.type))) {
      errors.push(t('validation.shot.invalidShotType', { type: this.type }));
    }
    if (!(typeof this.from === 'string' && this.from.length > 0)) {
      errors.push(t('validation.shot.invalidFrom', { from: this.from, type: typeof this.from }));
    } else if (typeof this.to === 'string' && this.to.length > 0) {
      if (this.from === this.to) {
        errors.push(t('validation.shot.invalidFromTo', { from: this.from, to: this.to }));
      }
    }

    if (isValidFloat(this.length) && this.length <= 0) {
      errors.push(t('validation.shot.invalidLength'));
    }

    if (isValidFloat(this.clino) && (this.clino > 90 || this.clino < -90)) {
      errors.push(t('validation.shot.invalidClino'));
    }

    if (isValidFloat(this.azimuth) && (this.azimuth > 360 || this.clino < -360)) {
      errors.push(t('validation.shot.invalidAzimuth'));
    }

    ['length', 'azimuth', 'clino'].forEach((f) => {
      if (!isValidFloat(this[f])) {
        errors.push(t('validation.shot.invalidDecimal', { field: f, value: this[f], type: typeof this[f] }));
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
      if (this[fName] !== undefined && this[fName] !== null) {
        newShot[fName] = this[fName];
      }
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

  toExport() {
    return {
      name : this.name,
      role : this.role
    };
  }

  static fromPure(pure) {
    return Object.assign(new SurveyTeamMember(), pure);
  }
}

class SurveyTeam {
  constructor(name, members = []) {
    this.name = name;
    this.members = members;
  }

  toExport() {
    return {
      name    : this.name,
      members : this.members?.map((m) => m.toExport())
    };
  }

  static fromPure(pure) {
    pure.members = pure.members !== undefined ? pure.members.map((m) => SurveyTeamMember.fromPure(m)) : [];
    return Object.assign(new SurveyTeam(), pure);
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

  toExport() {
    return {
      date        : this.date?.getTime(),
      declination : this.declination,
      convergence : this.convergence,
      team        : this.team?.toExport(),
      instruments : this.instruments?.map((i) => i.toExport())
    };
  }

  static fromPure(pure) {
    pure.date = new Date(pure.date); // unix epoch in millis
    pure.team = SurveyTeam.fromPure(pure.team);
    pure.instruments =
      pure.instruments !== undefined ? pure.instruments.map((i) => Object.assign(new SurveyInstrument(), i)) : [];
    return Object.assign(new SurveyMetadata(), pure);
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
   */
  constructor(
    name,
    visible = true,
    metadata = undefined,
    start = undefined,
    shots = [],
    orphanShotIds = new Set(),
    duplicateShotIds = new Set()
  ) {
    this.name = name;
    this.visible = visible;
    this.metadata = metadata;
    this.start = start;
    this.shots = shots;
    this.orphanShotIds = orphanShotIds;
    this.duplicateShotIds = duplicateShotIds;
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
   * @param {Array[StationAttribute]} stationAttributes - Array of station attributes to search through
   * @param {Map} stations - Map of station names to station objects
   * @param {string} name - The name an attribute, see attribute definitons for more information.
   * @returns {Array[Array[Vector, Object]]>} - Attribute params with 3D position
   */
  //TODO: maybe this is not used
  getAttributesWithPositionsByName(stationAttributes, stations, name) {
    return (
      stationAttributes
        .filter((sa) => sa.attribute.name === name)
        .map((sa) => {
          const pos = stations.get(sa.name).position;
          return [pos, sa.attribute];

        })
    );
  }

  toExport() {
    return {
      name     : this.name,
      start    : this.start,
      metadata : this.metadata?.toExport(),
      shots    : this.shots.map((s) => s.toExport())
    };
  }

  static fromPure(pure) {
    pure.shots = pure.shots.map((s) => Object.assign(new Shot(), s));
    pure.metadata = pure.metadata !== undefined ? SurveyMetadata.fromPure(pure.metadata) : undefined;
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

  isEqual(other) {
    return this.from === other.from && this.to === other.to;
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
