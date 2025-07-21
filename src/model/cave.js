import { Vector } from '../model.js';
import { GeoData } from './geo.js';
import { Survey, SurveyAlias } from './survey.js';
import { SectionAttribute, ComponentAttribute } from '../model.js';

class CaveCycle {

  pathSet;

  constructor(id, path, distance = 0) {
    this.id = id;
    this.path = path;
    this.distance = distance;
    this.pathSet = new Set(path);
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

  validate() {
    const isValidFloat = (f) => {
      return typeof f === 'number' && f !== Infinity && !isNaN(f);
    };

    const errors = [];
    if (!(typeof this.start === 'string' && this.start.length > 0)) {
      errors.push(`From (${this.from}, type=${typeof this.start}) is not a string or empty`);
    }

    if (Array.isArray(this.termination)) {
      this.termination.forEach((t) => {
        if (!(typeof t === 'string' && t.length > 0)) {
          errors.push(`Termination node (${t}, type=${typeof t}) is not a string or empty`);
        }
      });
    } else {
      errors.push(`Termination nodes '${this.termination}' is not an array`);
    }

    if (!isValidFloat(this.distance)) {
      errors.push(`Distance (${this.distance}, type=${typeof this.distance}) is not a valid decimal number`);
    }

    if (!Array.isArray(this.path)) {
      errors.push(`Path (${this.path}) is not an array`);
    } else if (this.path.length === 0) {
      errors.push(`Path should not be an empty array`);
    }

    if (isValidFloat(this.distance) && this.distance <= 0) {
      errors.push(`Distance must be greater than 0`);
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

  validate() {
    const isValidFloat = (f) => {
      return typeof f === 'number' && f !== Infinity && !isNaN(f);
    };

    const errors = [];
    if (!(typeof this.from === 'string' && this.from.length > 0)) {
      errors.push(`From (${this.from}, type=${typeof this.from}) is not a string or empty`);
    }

    if (!(typeof this.to === 'string' && this.to.length > 0)) {
      errors.push(`To (${this.to}, type=${typeof this.to}) is not a string or empty`);
    }

    if (this.from === this.to) {
      errors.push(`From (${this.from}) and to (${this.to}) cannot be the same`);
    }

    if (!isValidFloat(this.distance)) {
      errors.push(`Distance (${this.distance}, type=${typeof this.distance}) is not a valid decimal number`);
    }

    if (!Array.isArray(this.path)) {
      errors.push(`Path (${this.path}) is not an array`);
    } else if (this.path.length === 0) {
      errors.push(`Path should not be an empty array`);
    }

    if (isValidFloat(this.distance) && this.distance <= 0) {
      errors.push(`Distance must be greater than 0`);
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

  constructor(settlement, catasterCode, date, creator) {
    this.settlement = settlement;
    this.catasterCode = catasterCode;
    this.date = date;
    this.creator = creator;
  }

  toExport() {
    return {
      settlement   : this.settlement,
      catasterCode : this.catasterCode,
      date         : this.date.getTime()
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
   * @param {CaveMetadata} metaData - Additional information about the cave, like the settlement
   * @param {Map<string, SurveyStation>} stations - The merged map of all survey stations
   * @param {Survey[]} surveys - The surveys associated to a cave
   * @param {SurveyAlias[]} - Mapping of connection point between surveys
   * @param {boolean} visible - The visibility property of a cave
   */
  constructor(
    name,
    metaData,
    geoData,
    stations = new Map(),
    surveys = [],
    aliases = [],
    sectionAttributes = [],
    componentAttributes = [],
    visible = true
  ) {
    this.name = name;
    this.metaData = metaData;
    this.geoData = geoData;
    this.stations = stations;
    this.surveys = surveys;
    this.aliases = aliases;
    this.sectionAttributes = sectionAttributes;
    this.componentAttributes = componentAttributes;
    this.visible = visible;
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

  getStats() {
    var length = 0;
    var orphanLength = 0;
    var invalidLength = 0;
    var isolated = 0;
    var surveys = 0;
    var attributes = 0;

    this.surveys.forEach((survey) => {
      surveys += 1;
      attributes += survey.attributes.length;

      if (survey.isolated === true) {
        isolated += 1;
      }
      survey.shots.forEach((shot) => {

        if (survey.orphanShotIds.has(shot.id)) {
          orphanLength += shot.length;
        }
        if (survey.invalidShotIds.has(shot.id)) {
          invalidLength += shot.length;
        }
        length += shot.length;

      });
    });
    const stations = [...this.stations.values()];
    var minZ = 0,
      maxZ = 0,
      minZSplay = 0,
      maxZSplay = 0;

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

    const verticalSplays = maxZSplay - minZSplay;

    return {
      stations            : stations.filter((ss) => ss.isCenter()).length,
      attributes          : attributes,
      surveys             : surveys,
      isolated            : isolated,
      length              : length,
      orphanLength        : orphanLength,
      invalidLength       : invalidLength,
      depth               : minZ,
      height              : maxZ,
      vertical            : maxZ - minZ,
      vertiicalWithSplays : isNaN(verticalSplays) ? 0 : verticalSplays
    };
  }

  toExport() {
    return {
      name                : this.name,
      metaData            : this.metaData.toExport(),
      geoData             : this.geoData.toExport(),
      aliases             : this.aliases.map((a) => a.toExport()),
      sectionAttributes   : this.sectionAttributes.map((sa) => sa.toExport()),
      componentAttributes : this.componentAttributes.map((ca) => ca.toExport()),
      surveys             : this.surveys.map((s) => s.toExport())
    };
  }

  static fromPure(pure, attributeDefs) {
    if (pure.metaData !== undefined) {
      pure.metaData = CaveMetadata.fromPure(pure.metaData);
    }
    pure.geoData = pure.geoData === undefined ? [] : GeoData.fromPure(pure.geoData);
    pure.surveys = pure.surveys.map((s) => Survey.fromPure(s, attributeDefs));
    pure.aliases = pure.aliases === undefined ? [] : pure.aliases.map((a) => SurveyAlias.fromPure(a));
    pure.startPosition = Vector.fromPure(pure.startPosition);
    pure.sectionAttributes =
      pure.sectionAttributes === undefined
        ? []
        : pure.sectionAttributes.map((sa) => SectionAttribute.fromPure(sa, attributeDefs));
    pure.componentAttributes =
      pure.componentAttributes === undefined
        ? []
        : pure.componentAttributes.map((ca) => ComponentAttribute.fromPure(ca, attributeDefs));
    return Object.assign(new Cave(), pure);
  }
}

export { CaveCycle, CaveComponent, CaveSection, CaveMetadata, Cave };
