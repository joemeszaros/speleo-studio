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
import { Survey, SurveyAlias, SurveyStation, StationComment, StationDimension, DEFAULT_UNITS } from './survey.js';
import { sanitizeName, convertLengthToMeters } from '../utils/utils.js';

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

export class DriveCaveMetadata {
  constructor(id, name, revision, app) {
    this.id = id;
    this.name = name;
    this.revision = revision;
    this.app = app;
  }

  toExport() {
    return {
      id       : this.id,
      name     : this.name,
      revision : this.revision,
      app      : this.app
    };
  }

  static fromPure(pure) {
    return Object.assign(new DriveCaveMetadata(), pure);
  }

}

class Cave {
  /**
   *
   * @param {string} name - The name of the cave
   * @param {CaveMetadata} metadata - Additional information about the cave, like the settlement
   * @param {Map<string, SurveyStation>} stations - The merged map of all survey stations
   * @param {Survey[]} surveys - The surveys associated to a cave
   * @param {Cave[]} children - Nested sub-caves. Therion/Survex nest surveys arbitrarily deep; the
   *        whole connected network is stored as one root Cave, and the nesting is preserved as a tree
   *        of child Caves. A Survey is always a leaf (shot data) and can never contain a Cave.
   *        `geoData` lives on the root cave only; `aliases`/`stations`/`stationComments`/
   *        `stationDimensions`/`attributes` are owned per cave at the level they were declared.
   * @param {SurveyAlias[]} - Mapping of connection point between surveys
   * @param {CaveAttributes} attributes - The attributes of the cave (sections and components)
   * @param {StationComment[]} stationComments - Comments for stations in this cave
   * @param {StationDimension[]} stationDimensions - LRUD passage dimensions for stations in this cave
   * @param {boolean} visible - The visibility property of a cave
   * @param {boolean} readOnly - When true the cave is visualization-only: its station positions are
   *        the source of truth (not rebuilt from shots) and editing is locked. Used for Survex .3d imports.
   */
  constructor(
    name,
    metadata,
    geoData,
    stations = new Map(),
    surveys = [],
    children = [],
    aliases = [],
    attributes = new CaveAttributes(),
    stationComments = [],
    stationDimensions = [],
    visible = true,
    readOnly = false
  ) {
    this.id = Cave.generateId();
    this.revision = 1;
    this.name = sanitizeName(name);
    this.metadata = metadata;
    this.geoData = geoData;
    this.stations = stations;
    this.surveys = surveys;
    this.children = children;
    this.aliases = aliases;
    this.attributes = attributes;
    this.stationComments = stationComments;
    this.stationDimensions = stationDimensions;
    this.visible = visible;
    this.readOnly = readOnly;
    this.version = 1;
  }

  static generateId() {
    return 'cave_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
  }

  // ─── Tree traversal / aggregation ──────────────────────────────────────────────
  // A Cave may contain child Caves (Therion/Survex nesting). The helpers below let
  // callers treat the whole subtree uniformly. For a flat cave (no children) they
  // degrade to the cave's own data, so existing 2-level behavior is unchanged.

  /**
   * Depth-first walk over this cave and all descendant caves.
   * @param {(cave: Cave, path: string[]) => void} cb - called for each cave with the
   *        array of cave names from the root to that cave (inclusive).
   */
  walk(cb, path = [this.name]) {
    cb(this, path);
    for (const child of this.children) {
      child.walk(cb, [...path, child.name]);
    }
  }

  /** True when this cave nests sub-caves. */
  hasChildren() {
    return this.children.length > 0;
  }

  /** All Survey objects across this cave and its descendants. */
  getAllSurveys() {
    if (!this.hasChildren()) return this.surveys;
    const result = [];
    this.walk((cave) => result.push(...cave.surveys));
    return result;
  }

  /**
   * All surveys across the subtree with their unique full path (cave-name chain plus
   * survey name, joined by '/'). Used as a stable identity for scene keys and tree nodes.
   * @returns {{ survey: Survey, cave: Cave, path: string }[]}
   */
  getAllSurveysWithPath() {
    const result = [];
    this.walk((cave, path) => {
      for (const s of cave.surveys) {
        result.push({ survey: s, cave, path: [...path, s.name].join('/') });
      }
    });
    return result;
  }

  /**
   * Returns the chain of names from this cave down to (and including) the given survey:
   * [topCave, ...subCaves, survey]. Used for breadcrumbs (cave → … → survey). Returns just
   * the survey name if it is not found in the subtree.
   */
  getSurveyNamePath(survey) {
    let found = null;
    this.walk((cave, path) => {
      if (!found && cave.surveys.includes(survey)) found = [...path, survey.name];
    });
    return found ?? [survey.name];
  }

  /**
   * The chain of cave nodes from this cave down to the one that DIRECTLY owns `survey`
   * (inclusive), or an empty array if the survey is not in this subtree. Used for per-cave
   * coloring: the nearest ancestor with a color wins, so a sub-cave color overrides the top
   * cave's and an uncolored sub-cave inherits the color from above.
   */
  getCaveChain(survey) {
    let result = [];
    const recurse = (cave, acc) => {
      if (result.length > 0) return;
      const next = [...acc, cave];
      if (cave.surveys.includes(survey)) {
        result = next;
        return;
      }
      cave.children.forEach((child) => recurse(child, next));
    };
    recurse(this, []);
    return result;
  }

  /** Merged Map of every station across the subtree (station names are globally unique). */
  getAllStations() {
    if (!this.hasChildren()) return this.stations;
    const merged = new Map();
    this.walk((cave) => {
      for (const [name, st] of cave.stations) merged.set(name, st);
    });
    return merged;
  }

  /** All aliases (equate connections) across the subtree. */
  getAllAliases() {
    if (!this.hasChildren()) return this.aliases;
    const result = [];
    this.walk((cave) => result.push(...cave.aliases));
    return result;
  }

  /**
   * Find a cave node by its path (array of names, or '/'-joined string). The first
   * segment must match this cave's name. Returns undefined if not found.
   */
  findCaveByPath(path) {
    const parts = Array.isArray(path) ? path : String(path).split('/');
    if (parts.length === 0 || parts[0] !== this.name) return undefined;
    let node = this;
    for (let i = 1; i < parts.length; i++) {
      node = node.children.find((c) => c.name === parts[i]);
      if (!node) return undefined;
    }
    return node;
  }

  /** Find a leaf Survey by its full path (the path produced by getAllSurveysWithPath). */
  findSurveyByPath(path) {
    const parts = Array.isArray(path) ? path : String(path).split('/');
    if (parts.length < 2) return undefined;
    const cave = this.findCaveByPath(parts.slice(0, -1));
    if (!cave) return undefined;
    const surveyName = parts[parts.length - 1];
    return cave.surveys.find((s) => s.name === surveyName);
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
    const surveys = this.getAllSurveys();
    if (surveys.length === 0) {
      return undefined;
    }
    return surveys[0].start;
  }

  getFirstStation() {
    const surveys = this.getAllSurveys();
    if (surveys.length === 0) {
      return undefined;
    }
    // Station map keys are survey-qualified (`name@surveyPath`) for multi-level caves; qualify the
    // start name with its owning survey (no-op for single-survey/legacy caves). Without this the
    // lookup misses on nested systems and depth/height collapse to 0.
    const first = surveys[0];
    return this.getAllStations().get(first.qualify(first.start));
  }

  getStats() {
    var length = 0;
    var orphanLength = 0;
    var auxiliaryLength = 0;
    var invalidLength = 0;
    var isolated = 0;
    var surveys = 0;
    var splays = 0;

    this.getAllSurveys().forEach((survey) => {
      surveys += 1;

      if (survey.isolated === true) {
        isolated += 1;
      }
      const lengthUnit = survey.units?.length ?? DEFAULT_UNITS.length;
      survey.shots.forEach((shot) => {

        if (shot.length === undefined || shot.length === null || shot.length.isNaN || typeof shot.length !== 'number') {
          return;
        }

        const lenM = convertLengthToMeters(shot.length, lengthUnit);

        if (survey.orphanShotIds.has(shot.id)) {
          orphanLength += lenM;
        }
        if (survey.invalidShotIds.has(shot.id)) {
          invalidLength += lenM;
        }

        if (shot.isAuxiliary()) {
          auxiliaryLength += lenM;
        } else if (shot.isCenter()) {
          length += lenM;
        }

        if (shot.isSplay()) {
          splays += 1;
        }

      });
    });
    const stations = [...this.getAllStations().values()];

    // Attribute / comment / dimension counts aggregate across the whole subtree
    // (each cave node owns its own).
    var stationAttributes = 0, sectionAttributes = 0, componentAttributes = 0;
    var stationComments = 0, stationDimensions = 0;
    var subCaves = 0;
    this.walk((c) => {
      if (c !== this) subCaves += 1; // every descendant cave (self excluded)
      stationAttributes += c.attributes.stationAttributes.length;
      sectionAttributes += c.attributes.sectionAttributes.length;
      componentAttributes += c.attributes.componentAttributes.length;
      stationComments += c.stationComments.length;
      stationDimensions += c.stationDimensions.length;
    });

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
      stationAttributes   : stationAttributes,
      sectionAttributes   : sectionAttributes,
      componentAttributes : componentAttributes,
      stationComments     : stationComments,
      stationDimensions   : stationDimensions,
      subCaves            : subCaves,
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
    const exported = {
      id                : this.id,
      version           : this.version,
      revision          : this.revision,
      name              : this.name,
      metadata          : this?.metadata?.toExport(),
      geoData           : this?.geoData?.toExport(),
      aliases           : this.aliases.map((a) => a.toExport()),
      attributes        : this.attributes.toExport(),
      stationComments   : this.stationComments.map((sc) => sc.toExport()),
      stationDimensions : this.stationDimensions.map((sd) => sd.toExport()),
      surveys           : this.surveys.map((s) => s.toExport())
    };

    // Nested sub-caves (Therion/Survex hierarchy). Omitted entirely for flat caves so
    // existing 2-level exports are byte-for-byte unchanged.
    if (this.hasChildren()) {
      exported.children = this.children.map((c) => c.toExport());
    }

    // User-assigned cave color (used by the 'percave' color mode, incl. per sub-cave). Persisted
    // so it survives reload; omitted when unset to keep exports clean. Restored via fromPure's
    // Object.assign(new Cave(), pure).
    if (this.color !== undefined) {
      exported.color = this.color;
    }

    // Source provenance (where the cave came from), kept so a future Therion/Survex
    // exporter can reconstruct the file/folder layout. Optional, unused by features.
    if (this.source !== undefined) {
      exported.source = { ...this.source };
    }

    // Read-only caves can't rebuild station positions from shots (the .3d centerline
    // has disconnected components), so persist the station map directly. Normal caves
    // keep omitting it — they reconstruct on load.
    if (this.readOnly) {
      exported.readOnly = true;
      exported.stations = [...this.stations.entries()].map(([name, st]) => [name, st.toExport()]);
    }

    return exported;
  }

  static fromPure(pure, attributeDefs) {
    if (pure.metadata !== undefined) {
      pure.metadata = CaveMetadata.fromPure(pure.metadata);
    }

    if (pure.version === undefined) {
      pure.version = 1;
    }

    if (pure.revision === undefined) {
      pure.revision = 1;
    }
    pure.name = sanitizeName(pure.name);
    pure.geoData = pure.geoData === undefined ? undefined : GeoData.fromPure(pure.geoData);
    pure.surveys = pure.surveys.map((s, index) => {
      const survey = Survey.fromPure(s);
      // Clear start station for non-first surveys
      if (index > 0) {
        survey.start = undefined;
      }
      return survey;
    });
    pure.aliases = pure.aliases === undefined ? [] : pure.aliases.map((a) => SurveyAlias.fromPure(a));
    pure.startPosition = Vector.fromPure(pure.startPosition);

    pure.attributes = CaveAttributes.fromPure(pure.attributes, attributeDefs);
    pure.stationComments =
      pure.stationComments !== undefined ? pure.stationComments.map((sc) => StationComment.fromPure(sc)) : [];
    pure.stationDimensions =
      pure.stationDimensions !== undefined ? pure.stationDimensions.map((sd) => StationDimension.fromPure(sd)) : [];

    // Recurse into nested sub-caves. Absent for flat caves (-> empty children array).
    pure.children = Array.isArray(pure.children)
      ? pure.children.map((c) => Cave.fromPure(c, attributeDefs))
      : [];

    // Read-only caves persist their station map; rebuild it here and re-link each
    // station's `survey` back-reference by name. Normal caves leave stations empty
    // (they are reconstructed from shots by recalculateCave).
    pure.readOnly = pure.readOnly === true;
    if (pure.readOnly && Array.isArray(pure.stations)) {
      const surveysByName = new Map(pure.surveys.map((s) => [s.name, s]));
      pure.stations = new Map(pure.stations.map(([name, st]) => [name, SurveyStation.fromPure(st, surveysByName)]));
    } else {
      pure.stations = new Map();
    }

    const cave = Object.assign(new Cave(), pure);
    return cave;
  }
}

export { CaveCycle, CaveAttributes, CaveComponent, CaveSection, CaveMetadata, Cave };
