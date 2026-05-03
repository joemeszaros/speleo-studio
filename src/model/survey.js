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

import { Polar } from '../model.js';
import { degreesToRads, sanitizeName, convertLengthToMeters } from '../utils/utils.js';

const DEFAULT_UNITS = { length: 'meters', angle: 'degrees' };

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

class StationComment {
  constructor(name, comment) {
    this.name = name;
    this.comment = comment;
  }

  getEmptyFields() {
    return ['name', 'comment']
      .filter((f) => this[f] === undefined || this[f] === null);
  }

  toExport() {
    return {
      name    : this.name,
      comment : this.comment
    };
  }

  static fromPure(pure) {
    return Object.assign(new StationComment(), pure);
  }
}

class StationDimension {

  static LRUD_FIELDS = ['left', 'right', 'up', 'down'];

  constructor(name, left, right, up, down) {
    this.name = name;
    this.left = left;
    this.right = right;
    this.up = up;
    this.down = down;
  }

  getEmptyFields() {
    const empty = [];
    if (this.name === undefined || this.name === null || this.name === '') {
      empty.push('name');
    }
    const allMissing = StationDimension.LRUD_FIELDS.every(
      (f) => StationDimension.isMissingValue(this[f])
    );
    if (allMissing) empty.push('values');
    return empty;
  }

  // True when a raw field value (number, string, undefined, null, or NaN) carries
  // no usable LRUD measurement.
  static isMissingValue(value) {
    return (
      value === undefined ||
      value === null ||
      value === '' ||
      (typeof value === 'number' && isNaN(value))
    );
  }

  // Validates a single raw L/R/U/D field value (string or number) and returns
  // a problem code, or null if the value is valid (or missing, which is allowed).
  // Codes: 'notNumeric' | 'negative'.
  static validateValue(value) {
    if (StationDimension.isMissingValue(value)) return null;
    const num = typeof value === 'number' ? value : parseFloat(value);
    if (isNaN(num)) return 'notNumeric';
    if (num < 0) return 'negative';
    return null;
  }

  // Returns structured validation errors for this StationDimension's L/R/U/D values:
  // an array of { type, field } objects. Callers (editors / importers) format the
  // user-facing message themselves so this class doesn't depend on a particular
  // i18n key set.
  validate() {
    const errors = [];
    StationDimension.LRUD_FIELDS.forEach((f) => {
      const code = StationDimension.validateValue(this[f]);
      if (code) errors.push({ type: code, field: f });
    });
    return errors;
  }

  toExport() {
    const out = { name: this.name };
    StationDimension.LRUD_FIELDS.forEach((f) => {
      if (this[f] !== undefined && this[f] !== null && !(typeof this[f] === 'number' && isNaN(this[f]))) {
        out[f] = this[f];
      }
    });
    return out;
  }

  static fromPure(pure) {
    return Object.assign(new StationDimension(), pure);
  }
}

class Shot {
  static export_fields = ['type', 'from', 'to', 'length', 'azimuth', 'clino', 'comment'];

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

  toPolar() {
    return new Polar(this.length, degreesToRads(this.azimuth), degreesToRads(this.clino));
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

  isValid(units) {
    return this.validate(undefined, units).length === 0;
  }

  validate(i18n, units) {
    const angleUnit = units?.angle ?? DEFAULT_UNITS.angle;
    const azimuthMax = angleUnit === 'grads' ? 400 : 360;
    const clinoMax = angleUnit === 'grads' ? 100 : 90;

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

    if (!isValidFloat(this.length)) {
      errors.push(t('validation.shot.invalidLength'));
    }

    if (isValidFloat(this.clino) && (this.clino > clinoMax || this.clino < -clinoMax)) {
      errors.push(t('validation.shot.invalidClino', { max: clinoMax }));
    }

    if (isValidFloat(this.azimuth) && (this.azimuth > azimuthMax || this.azimuth < -azimuthMax)) {
      errors.push(t('validation.shot.invalidAzimuth', { max: azimuthMax }));
    }

    ['length', 'azimuth', 'clino'].forEach((f) => {
      if (!isValidFloat(this[f])) {
        errors.push(t('validation.shot.invalidDecimal', { field: f, value: this[f], type: typeof this[f] }));
      }
    });

    return errors;

  }

  getEmptyFields() {
    return Shot.export_fields
      .filter((f) => f !== 'to' && f !== 'comment')
      .filter((f) => this[f] === undefined || this[f] === null);
  }

  isComplete() {
    return this.getEmptyFields().length === 0;
  }

  toExport() {
    let newShot = {};
    Shot.export_fields.forEach((fName) => {
      if (this[fName] !== undefined && this[fName] !== null) {
        newShot[fName] = this[fName];
      }
    });
    return newShot;
  }
}

class ShotWithSurvey {
  constructor(shot, survey) {
    this.shot = shot;
    this.survey = survey;
  }

}

class SurveyStation {

  /**
   *
   * @param {string} type - the type of the station, could be center and splay
   * @param {Vector} position - the 3D vector representing the position of the station
   */
  constructor(type, position, coordinates, survey, shots = []) {
    this.type = type;
    this.position = position;
    this.coordinates = coordinates;
    this.survey = survey;
    this.shots = shots; // this is used in loop closure, contains the shots that connect to this station
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

  toExport() {
    return {
      name  : this.name,
      value : this.value
    };
  }

  static fromPure(pure) {
    return Object.assign(new SurveyInstrument(), pure);
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
    pure.team = pure.team !== undefined ? SurveyTeam.fromPure(pure.team) : undefined;
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
   * @param {Array[Number]} duplicateShotIds - An array of duplicate shots that are the same from/to stations
   */
  constructor(
    name,
    visible = true,
    metadata = undefined,
    start = undefined,
    shots = [],
    units = undefined,
    orphanShotIds = new Set(),
    duplicateShotIds = new Set()
  ) {
    this.name = sanitizeName(name);
    this.visible = visible;
    this.metadata = metadata;
    this.start = start;
    this.shots = shots;
    this.orphanShotIds = orphanShotIds;
    this.duplicateShotIds = duplicateShotIds;
    this.units = units ?? { ...DEFAULT_UNITS };
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
    //FIXME: it would be better to use units from config because error messages are not survey specific
    return this.shots.filter((sh) => sh.isComplete() && sh.isValid(this.units));
  }

  getInvalidShotIds() {
    return new Set(this.shots.filter((sh) => !sh.isComplete() || !sh.isValid(this.units)).map((sh) => sh.id));
  }

  getStats() {
    let length = 0;
    let orphanLength = 0;
    let auxiliaryLength = 0;
    let invalidLength = 0;
    let splays = 0;
    let shots = 0;

    const stationNames = new Set();

    const lengthUnit = this.units?.length ?? DEFAULT_UNITS.length;
    this.shots.forEach((shot) => {
      shots++;

      if (shot.from) stationNames.add(shot.from);
      if (shot.to && shot.isCenter()) stationNames.add(shot.to);

      if (shot.length === undefined || shot.length === null || isNaN(shot.length) || typeof shot.length !== 'number') {
        return;
      }

      const lenM = convertLengthToMeters(shot.length, lengthUnit);

      if (this.orphanShotIds.has(shot.id)) {
        orphanLength += lenM;
      }
      if (this.invalidShotIds.has(shot.id)) {
        invalidLength += lenM;
      }

      if (shot.isAuxiliary()) {
        auxiliaryLength += lenM;
      } else if (shot.isCenter()) {
        length += lenM;
      }

      if (shot.isSplay()) {
        splays++;
      }
    });

    return {
      length          : length,
      orphanLength    : orphanLength,
      auxiliaryLength : auxiliaryLength,
      invalidLength   : invalidLength,
      splays          : splays,
      shots           : shots,
      stations        : stationNames.size
    };
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
      units    : { ...this.units },
      shots    : this.shots.map((s) => s.toExport())
    };
  }

  static fromPure(pure) {
    pure.name = sanitizeName(pure.name);
    pure.shots = pure.shots.map((s, index) => Object.assign(new Shot(index + 1), s));
    pure.metadata = pure.metadata !== undefined ? SurveyMetadata.fromPure(pure.metadata) : undefined;
    pure.units = pure.units ?? { ...DEFAULT_UNITS };
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
  DEFAULT_UNITS,
  ShotType,
  Shot,
  StationComment,
  StationDimension,
  SurveyStation,
  ShotWithSurvey,
  SurveyTeamMember,
  SurveyTeam,
  SurveyInstrument,
  SurveyMetadata,
  Survey,
  SurveyAlias
};
