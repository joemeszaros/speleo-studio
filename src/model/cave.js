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

import { Vector, SectionAttribute, ComponentAttribute, StationAttribute } from '../model.js';
import { GeoData } from './geo.js';
import { Survey, SurveyAlias, StationComment } from './survey.js';

class CaveCycle {

  pathSet;

  constructor(id, path, distance = 0) {
    this.id = id;
    this.path = path;
    this.distance = distance;
    this.pathSet = new Set(path);
  }
}

class CaveAttributes {

  constructor(stationAttributes = [], sectionAttributes = [], componentAttributes = [], schemaVersion) {
    this.stationAttributes = stationAttributes;
    this.sectionAttributes = sectionAttributes;
    this.componentAttributes = componentAttributes;
    this.schemaVersion = schemaVersion;
  }

  toExport() {
    return {
      sectionAttributes   : this.sectionAttributes.map((sa) => sa.toExport()),
      componentAttributes : this.componentAttributes.map((ca) => ca.toExport()),
      stationAttributes   : this.stationAttributes.map((sa) => sa.toExport()),
      schemaVersion       : this.schemaVersion
    };
  }

  static fromPure(pure, attributeDefs) {
    if (pure.schemaVersion === undefined || pure.schemaVersion === '1.0.0') {
      pure.schemaVersion = attributeDefs.schemaVersion;
    } else if (pure.schemaVersion > attributeDefs.schemaVersion) {
      throw new Error(
        `Schema version of stored attributes${pure.schemaVersion} is greater than the current version ${attributeDefs.schemaVersion}`
      );
    }

    //based on pure.schemaVersion we may need to migrate the attributes to the new format
    pure.sectionAttributes =
      pure.sectionAttributes === undefined
        ? []
        : pure.sectionAttributes.map((sa) => SectionAttribute.fromPure(sa, attributeDefs, pure.schemaVersion));
    pure.componentAttributes =
      pure.componentAttributes === undefined
        ? []
        : pure.componentAttributes.map((ca) => ComponentAttribute.fromPure(ca, attributeDefs, pure.schemaVersion));
    pure.stationAttributes =
      pure.stationAttributes === undefined
        ? []
        : pure.stationAttributes.map((sa) => StationAttribute.fromPure(sa, attributeDefs, pure.schemaVersion));

    pure.schemaVersion = attributeDefs.schemaVersion;
    return Object.assign(new CaveAttributes(), pure);
  }
}

class CaveComponent {

  constructor(start, termination = [], path = [], distance = 0) {
    this.start = start;
    this.termination = termination;
    this.path = path;
    this.distance = distance;
  }

  isComplete() {
    return this.getEmptyFields().length === 0;
  }

  getEmptyFields() {
    return ['start', 'termination', 'path', 'distance']
      .filter((f) => this[f] === undefined || this[f] === null);
  }

  isValid() {
    return this.validate().length === 0;
  }

  validate(i18n) {

    const t = i18n === undefined ? (s) => s : (key, params) => i18n.t(key, params);

    const isValidFloat = (f) => {
      return typeof f === 'number' && f !== Infinity && !isNaN(f);
    };

    const errors = [];
    if (!(typeof this.start === 'string' && this.start.length > 0)) {
      errors.push(t('validation.caveSectionOrComponent.fromInvalid', { from: this.start, type: typeof this.start }));
    }

    if (Array.isArray(this.termination)) {
      this.termination.forEach((term) => {
        if (!(typeof term === 'string' && term.length > 0)) {
          errors.push(
            t('validation.caveSectionOrComponent.terminationInvalid', { termination: term, type: typeof term })
          );
        }
      });
    } else {
      errors.push(t('validation.caveSectionOrComponent.terminationNotArray', { termination: this.termination }));
    }

    if (!isValidFloat(this.distance)) {
      errors.push(
        t('validation.caveSectionOrComponent.distanceInvalid', { distance: this.distance, type: typeof this.distance })
      );
    }

    if (!Array.isArray(this.path)) {
      errors.push(t('validation.caveSectionOrComponent.pathNotArray', { path: this.path }));
    } else if (this.path.length === 0) {
      errors.push(t('validation.caveSectionOrComponent.pathEmpty'));
    }

    if (isValidFloat(this.distance) && this.distance <= 0) {
      errors.push(t('validation.caveSectionOrComponent.distanceGreaterThanZero'));
    }
    return errors;
  }

  toExport() {
    return {
      start       : this.start,
      termination : this.termination
    };
  }

  static fromPure(pure) {
    return Object.assign(new CaveComponent(), pure);
  }

}

class CaveSection {

  constructor(from, to, path, distance) {
    this.from = from;
    this.to = to;
    this.path = path;
    this.distance = distance;
  }

  isComplete() {
    return this.getEmptyFields().length === 0;
  }

  getEmptyFields() {
    return ['from', 'to', 'path', 'distance']
      .filter((f) => this[f] === undefined || this[f] === null);
  }

  isValid() {
    return this.validate().length === 0;
  }

  validate(i18n) {

    const t = i18n === undefined ? (s) => s : (key, params) => i18n.t(key, params);

    const isValidFloat = (f) => {
      return typeof f === 'number' && f !== Infinity && !isNaN(f);
    };

    const errors = [];
    if (!(typeof this.from === 'string' && this.from.length > 0)) {
      errors.push(t('validation.caveSectionOrComponent.fromInvalid', { from: this.from, type: typeof this.from }));
    }

    if (!(typeof this.to === 'string' && this.to.length > 0)) {
      errors.push(t('validation.caveSectionOrComponent.toInvalid', { to: this.to, type: typeof this.to }));
    }

    if (this.from === this.to) {
      errors.push(t('validation.caveSectionOrComponent.fromToSame', { from: this.from, to: this.to }));
    }

    if (!isValidFloat(this.distance)) {
      errors.push(
        t('validation.caveSectionOrComponent.distanceInvalid', { distance: this.distance, type: typeof this.distance })
      );
    }

    if (!Array.isArray(this.path)) {
      errors.push(t('validation.caveSectionOrComponent.pathNotArray', { path: this.path }));
    } else if (this.path.length === 0) {
      errors.push(t('validation.caveSectionOrComponent.pathEmpty'));
    }

    if (isValidFloat(this.distance) && this.distance <= 0) {
      errors.push(t('validation.caveSectionOrComponent.distanceGreaterThanZero'));
    }
    return errors;
  }

  toExport() {
    return {
      from : this.from,
      to   : this.to
    };
  }

  static fromPure(pure) {
    return Object.assign(new CaveSection(), pure);
  }

}

class CaveMetadata {

  constructor(country, region, settlement, catasterCode, date, creator) {
    this.country = country;
    this.region = region;
    this.settlement = settlement;
    this.catasterCode = catasterCode;
    this.date = date;
    this.creator = creator;
  }

  toExport() {
    return {
      country      : this.country,
      region       : this.region,
      settlement   : this.settlement,
      catasterCode : this.catasterCode,
      date         : this.date.getTime(),
      creator      : this.creator
    };
  }

  static fromPure(pure) {
    pure.date = new Date(pure.date); // unix epoch in millis
    return Object.assign(new CaveMetadata(), pure);
  }
}

class Cave {
  /**
   *
   * @param {string} name - The name of the cave
   * @param {CaveMetadata} metadata - Additional information about the cave, like the settlement
   * @param {Map<string, SurveyStation>} stations - The merged map of all survey stations
   * @param {Survey[]} surveys - The surveys associated to a cave
   * @param {SurveyAlias[]} - Mapping of connection point between surveys
   * @param {CaveAttributes} attributes - The attributes of the cave (sections and components)
   * @param {StationComment[]} stationComments - Comments for stations in this cave
   * @param {boolean} visible - The visibility property of a cave
   */
  constructor(
    name,
    metadata,
    geoData,
    stations = new Map(),
    surveys = [],
    aliases = [],
    attributes = new CaveAttributes(),
    stationComments = [],
    visible = true
  ) {
    this.id = this.#generateId();
    this.revision = 1;
    this.name = name;
    this.metadata = metadata;
    this.geoData = geoData;
    this.stations = stations;
    this.surveys = surveys;
    this.aliases = aliases;
    this.attributes = attributes;
    this.stationComments = stationComments;
    this.visible = visible;
  }

  #generateId() {
    return 'cave_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
  }

  validate() {
    const errors = [];
    if (!(typeof this.name === 'string' && this.name.trim().length > 0)) {
      errors.push(`Cave name ('${this.name}') is empty`);
    }

    return errors;
  }

  isValid() {
    return this.validate().length === 0;
  }

  hasSurvey(name) {
    return this.surveys.find((s) => s.name === name) !== undefined;
  }

  getFirstStationName() {
    if (this.surveys.length === 0) {
      return undefined;
    }
    return this.surveys[0].start;
  }

  getFirstStation() {
    if (this.surveys.length === 0) {
      return undefined;
    }
    return this.stations.get(this.surveys[0].start);
  }

  getStats() {
    var length = 0;
    var orphanLength = 0;
    var auxiliaryLength = 0;
    var invalidLength = 0;
    var isolated = 0;
    var surveys = 0;
    var splays = 0;

    this.surveys.forEach((survey) => {
      surveys += 1;

      if (survey.isolated === true) {
        isolated += 1;
      }
      survey.shots.forEach((shot) => {

        if (shot.length === undefined || shot.length === null || shot.length.isNaN || typeof shot.length !== 'number') {
          return;
        }

        if (survey.orphanShotIds.has(shot.id)) {
          orphanLength += shot.length;
        }
        if (survey.invalidShotIds.has(shot.id)) {
          invalidLength += shot.length;
        }

        if (shot.isAuxiliary()) {
          auxiliaryLength += shot.length;
        } else if (shot.isCenter()) {
          length += shot.length;
        }

        if (shot.isSplay()) {
          splays += 1;
        }

      });
    });
    const stations = [...this.stations.values()];
    var minZ = undefined,
      maxZ = undefined,
      minZSplay = undefined,
      maxZSplay = undefined;

    stations.forEach((ss) => {
      const zCoord = ss.position.z;

      if (ss.isCenter()) {
        if (zCoord < minZ || minZ === undefined) {
          minZ = zCoord;
        }
        if (zCoord > maxZ || maxZ === undefined) {
          maxZ = zCoord;
        }
      } else if (ss.isSplay()) {
        if (zCoord < minZSplay || minZSplay === undefined) {
          minZSplay = zCoord;
        }
        if (zCoord > maxZSplay || maxZSplay === undefined) {
          maxZSplay = zCoord;
        }

      }
    });

    const verticalSplays = Math.max(maxZSplay, maxZ) - Math.min(minZSplay, minZ);
    const firstStationZ = this.getFirstStation()?.position?.z;

    return {
      stations            : stations.filter((ss) => ss.isCenter()).length,
      stationAttributes   : this.attributes.stationAttributes.length,
      sectionAttributes   : this.attributes.sectionAttributes.length,
      componentAttributes : this.attributes.componentAttributes.length,
      surveys             : surveys,
      isolated            : isolated,
      splays              : splays,
      length              : length,
      orphanLength        : orphanLength,
      invalidLength       : invalidLength,
      auxiliaryLength     : auxiliaryLength,
      depth               : minZ === undefined || firstStationZ === undefined ? 0 : firstStationZ - minZ,
      height              : maxZ === undefined || firstStationZ === undefined ? 0 : maxZ - firstStationZ,
      vertical            : maxZ === undefined || minZ === undefined ? 0 : maxZ - minZ,
      vertiicalWithSplays : isNaN(verticalSplays) ? 0 : verticalSplays,
      minZ                : minZ === undefined ? 0 : minZ,
      maxZ                : maxZ === undefined ? 0 : maxZ
    };
  }

  toExport() {
    return {
      id              : this.id,
      revision        : this.revision,
      name            : this.name,
      metadata        : this?.metadata?.toExport(),
      geoData         : this?.geoData?.toExport(),
      aliases         : this.aliases.map((a) => a.toExport()),
      attributes      : this.attributes.toExport(),
      stationComments : this.stationComments.map((sc) => sc.toExport()),
      surveys         : this.surveys.map((s) => s.toExport())
    };
  }

  static fromPure(pure, attributeDefs) {
    if (pure.metadata !== undefined) {
      pure.metadata = CaveMetadata.fromPure(pure.metadata);
    }

    if (pure.revision === undefined) {
      pure.revision = 1;
    }
    pure.geoData = pure.geoData === undefined ? undefined : GeoData.fromPure(pure.geoData);
    pure.surveys = pure.surveys.map((s) => Survey.fromPure(s));
    pure.aliases = pure.aliases === undefined ? [] : pure.aliases.map((a) => SurveyAlias.fromPure(a));
    pure.startPosition = Vector.fromPure(pure.startPosition);

    pure.attributes = CaveAttributes.fromPure(pure.attributes, attributeDefs);
    pure.stationComments =
      pure.stationComments !== undefined ? pure.stationComments.map((sc) => StationComment.fromPure(sc)) : [];

    const cave = Object.assign(new Cave(), pure);
    return cave;
  }
}

export { CaveCycle, CaveAttributes, CaveComponent, CaveSection, CaveMetadata, Cave };
