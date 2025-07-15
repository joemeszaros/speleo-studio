import { Vector, Shot, StationAttribute } from '../model.js';
import { StationCoordinates } from './geo.js';

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
    return this.type === 'center';
  }

  isSplay() {
    return this.type === 'splay';
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

  constructor(date, declination, team, instruments = []) {
    this.date = date;
    this.declination = declination;
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

export { SurveyStation, SurveyTeamMember, SurveyTeam, SurveyInstrument, SurveyMetadata, Survey, SurveyAlias };
