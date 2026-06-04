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

import { Polar, Vector } from '../model.js';
import { StationCoordinates } from './geo.js';
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
    const allMissing = StationDimension.LRUD_FIELDS.every((f) => StationDimension.isMissingValue(this[f]));
    if (allMissing) empty.push('values');
    return empty;
  }

  // True when a raw field value (number, string, undefined, null, or NaN) carries
  // no usable LRUD measurement.
  static isMissingValue(value) {
    return value === undefined || value === null || value === '' || (typeof value === 'number' && isNaN(value));
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

  // Stations are normally rebuilt from shots and never persisted. Read-only caves
  // (e.g. imported from Survex .3d) are the exception: their absolute positions are
  // the source of truth, so we serialize them directly. The `survey` back-reference
  // is stored as the survey name and re-linked on load; `shots` (edit-time loop
  // closure only) is left empty.
  toExport() {
    const exported = {
      type     : this.type,
      position : this.position?.toExport(),
      survey   : this.survey?.name
    };
    // `coordinates.local` is intentionally not persisted — it equals `position` for
    // these caves and is reconstructed on load. Only emit `coordinates` when it
    // carries georeferencing (projected / wgs); for non-georeferenced caves it's
    // dropped entirely to keep large station maps compact.
    const coords = this.coordinates;
    if (coords !== undefined && (coords.projected !== undefined || coords.wgs !== undefined)) {
      exported.coordinates = coords.toExport();
    }
    return exported;
  }

  static fromPure(pure, surveysByName) {
    const position = pure.position !== undefined ? Vector.fromPure(pure.position) : undefined;
    let coordinates = StationCoordinates.fromPure(pure.coordinates);
    // Reconstruct the (un-persisted) local coordinate from the position. They are the
    // same for a cave that owns the global origin; the station-details panel reads it.
    if (position !== undefined) {
      if (coordinates === undefined) {
        coordinates = new StationCoordinates(position.clone(), undefined, undefined);
      } else if (coordinates.local === undefined) {
        coordinates.local = position.clone();
      }
    }
    const survey = surveysByName !== undefined ? surveysByName.get(pure.survey) : undefined;
    return new SurveyStation(pure.type, position, coordinates, survey, []);
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
  static generateId() {
    return 'survey_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
  }

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
    // Stable, unique, runtime identity. Survey names are NOT unique across (or even
    // within) a nested cave tree, so the scene/explorer key surveys by this id.
    // Not persisted — regenerated on load (the scene is rebuilt each session).
    this.id = Survey.generateId();
    this.name = sanitizeName(name);
    this.visible = visible;
    this.metadata = metadata;
    this.start = start;
    this.shots = shots;
    this.orphanShotIds = orphanShotIds;
    this.duplicateShotIds = duplicateShotIds;
    this.units = units ?? { ...DEFAULT_UNITS };
    this.isolated = false;
    // The survey's dot-separated path within its (possibly nested) source file
    // (outermost-first, e.g. `system_migovec.m2m16m18.M18.gallery`). Used ONLY to qualify
    // station names inside the position solver so that station numbers reused across
    // surveys (every Therion survey numbers from 1) don't collide. Stays undefined for
    // legacy caves and single-survey caves, in which case the solver keys by bare names —
    // identical to the old behavior. Shot from/to and all displayed names remain bare.
    this.surveyPath = undefined;
    this.validShots = this.getValidShots();
    this.invalidShotIds = this.getInvalidShotIds();
  }

  // Qualifies a bare station name with this survey's path so it is unique across the
  // connected network during position calculation. Returns the bare name unchanged when
  // there is no surveyPath (legacy/single-survey caves) or the name is already qualified.
  qualify(name) {
    if (this.surveyPath === undefined || name === undefined || name === null) return name;
    // Names that already contain '@' are pre-qualified (generated splay/aux names and
    // resolved equate-alias partners that live in another survey) — they must pass through
    // unchanged so their lookup still resolves. Bare shot names get this survey's path.
    if (typeof name === 'string' && name.includes('@')) return name;
    return `${name}@${this.surveyPath}`;
  }

  // Splay/auxiliary endpoints are not referenced by other shots, so their station names
  // only need to be unique. Key them by the survey's unique id (not its name) — survey
  // names are not unique across a nested cave tree, which would otherwise collide.
  getSplayStationName(id) {
    return `splay-${id}@${this.id}`;
  }

  getAuxiliaryStationName(id) {
    return `auxiliary-${id}@${this.id}`;
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
    // '@' is reserved internally as the survey-qualifier separator (`name@surveyPath`).
    // Strip it from any user-typed station name so a typed `5@foo` can't corrupt the
    // station-key scheme or be mistaken for a cross-survey reference. (Imported names are
    // already '@'-free.) Dots are allowed and left untouched.
    for (const sh of shots) {
      if (typeof sh.from === 'string' && sh.from.includes('@')) sh.from = sh.from.slice(0, sh.from.indexOf('@'));
      if (typeof sh.to === 'string' && sh.to.includes('@')) sh.to = sh.to.slice(0, sh.to.indexOf('@'));
    }
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
    const exported = {
      name       : this.name,
      start      : this.start,
      metadata   : this.metadata?.toExport(),
      units      : { ...this.units },
      surveyPath : this.surveyPath,
      shots      : this.shots.map((s) => s.toExport())
    };
    if (this.color !== undefined) {
      exported.color = this.color;
    }
    return exported;
  }

  static fromPure(pure) {
    pure.name = sanitizeName(pure.name);
    pure.shots = pure.shots.map((s, index) => Object.assign(new Shot(index + 1), s));
    pure.metadata = pure.metadata !== undefined ? SurveyMetadata.fromPure(pure.metadata) : undefined;
    pure.units = pure.units ?? { ...DEFAULT_UNITS };
    const survey = Object.assign(new Survey(), pure);
    survey.surveyPath = pure.surveyPath; // undefined for legacy caves → bare keying
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
