class Vector {

  constructor(x, y, z) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  add(v) {
    return new Vector(this.x + v.x, this.y + v.y, this.z + v.z);
  }

  sub(v) {
    return new Vector(this.x - v.x, this.y - v.y, this.z - v.z);
  }

  mul(d) {
    return new Vector(this.x * d, this.y * d, this.z * d);
  }

  distanceTo(v) {
    const dx = this.x - v.x,
      dy = this.y - v.y,
      dz = this.z - v.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  toExport() {
    return {
      x : this.x,
      y : this.y,
      z : this.z
    };
  }

  static fromPure(pure) {
    return Object.assign(new Vector(), pure);
  }
}

class Color {

  constructor(r, g, b) {
    if (typeof r === 'number' && g === undefined && b === undefined) {
      this._hex = Math.floor(r);
      this.r = ((this._hex >> 16) & 255) / 255;
      this.g = ((this._hex >> 8) & 255) / 255;
      this.b = (this._hex & 255) / 255;
    } else if (typeof r === 'string' && r.startsWith('#') && g === undefined && b === undefined) {
      this._hex = parseInt(r.substring(1), 16);
      this.r = ((this._hex >> 16) & 255) / 255;
      this.g = ((this._hex >> 8) & 255) / 255;
      this.b = (this._hex & 255) / 255;
    } else {
      this.r = r;
      this.g = g;
      this.b = b;
      this._hex = (1 << 24) + (r << 16) + (g << 8) + b;
    }
  }

  hex() {
    return this._hex;
  }

  hexString() {
    return '#'.concat(('000000' + this._hex.toString(16)).slice(-6));
  }

  add(c) {
    return new Color(this.r + c.r, this.g + c.g, this.b + c.b);
  }

  sub(c) {
    return new Color(this.r - c.r, this.g - c.g, this.b - c.b);
  }

  mul(d) {
    return new Color(this.r * d, this.g * d, this.b * d);
  }
}

class Shot {
  export_fields = ['id', 'type', 'from', 'to', 'length', 'azimuth', 'clino'];

  constructor(id, type, from, to, length, azimuth, clino) {
    this.id = id;
    this.type = type;
    this.from = from;
    this.to = to;
    this.length = length;
    this.azimuth = azimuth;
    this.clino = clino;
    this.processed = false;
  }

  isSplay() {
    return this.type === 'splay';
  }

  isCenter() {
    return this.type === 'center';
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
    if (!(typeof this.type === 'string' && ['center', 'splay'].includes(this.type))) {
      errors.push(`Type (${this.type}) is not 'center' or 'splay'`);
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
      .filter((f) => f !== 'to')
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

class StationCoordinate {
  constructor(name, eov) {
    this.name = name;
    this.eov = eov;
  }

  toExport() {
    return {
      name : this.name,
      eov  : this.eov.toExport()
    };
  }

  static fromPure(pure) {
    pure.eov = EOVCoordinateWithElevation.fromPure(pure.eov);
    return Object.assign(new StationCoordinate(), pure);
  }
}

class StationCoordinates {
  constructor(local, eov) {
    this.local = local;
    this.eov = eov;
  }

}

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

class FragmentAttribute {

  constructor(id, attribute, format, color, visible) {
    this.id = id;
    this.attribute = attribute;
    this.format = format;
    this.color = color;
    this.visible = visible;
  }

  isComplete() {
    return this.getEmptyFields().length === 0;
  }

  getEmptyFields() {
    return this.fields
      .filter((f) => this[f] === undefined || this[f] === null);
  }

  isValid() {
    return this.validate().length === 0;
  }

  validate() {
    const errors = [];

    if (typeof this.visible !== 'boolean' && ![true, false].includes(this.visible)) {
      errors.push(`Visible '${this.visible}' is not a valid boolean`);
    }

    if (!(this.color instanceof Color)) {
      errors.push(`Color '${this.color}' is not a valid color`);
    }

    const paramErrors = this.attribute.validate();
    paramErrors.forEach((error, paramName) => {
      errors.push(`Invalid attribute '${this.attribute.name}' field ${paramName}: ${error}`);
    });
    return errors;

  }
}

class SectionAttribute extends FragmentAttribute {

  fields = ['id', 'section', 'attribute', 'color', 'visible'];

  constructor(id, section, attribute, format, color, visible = false) {
    super(id, attribute, format, color, visible);
    this.section = section;
  }

  isComplete() {
    return super.isComplete() && this.section.isComplete();
  }

  validate() {
    const errors = [];
    errors.push(...super.validate());
    this.section.validate().forEach((error) => {
      errors.push(`Invalid section: ${error}`);
    });
    return errors;
  }

  toExport() {
    return {
      id        : this.id,
      section   : this.section.toExport(),
      attribute : this.attribute.toExport(),
      format    : this.format,
      color     : this.color.hexString(),
      visible   : this.visible
    };
  }

  static fromPure(pure, attributeDefs) {
    pure.attribute = attributeDefs.createFromPure(pure.attribute);
    pure.color = new Color(pure.color);
    pure.section = CaveSection.fromPure(pure.section);
    return Object.assign(new SectionAttribute(), pure);
  }
}

class ComponentAttribute extends FragmentAttribute {

  fields = ['id', 'component', 'attribute', 'color', 'visible'];

  constructor(id, component, attribute, format, color, visible = false) {
    super(id, attribute, format, color, visible);
    this.component = component;
  }

  isComplete() {
    return super.isComplete() && this.component.isComplete();
  }

  validate() {
    const errors = [];
    errors.push(...super.validate());
    this.component.validate().forEach((error) => {
      errors.push(`Invalid component: ${error}`);
    });
    return errors;
  }

  toExport() {
    return {
      id        : this.id,
      component : this.component.toExport(),
      attribute : this.attribute.toExport(),
      format    : this.format,
      color     : this.color.hexString(),
      visible   : this.visible
    };
  }

  static fromPure(pure, attributeDefs) {
    pure.attribute = attributeDefs.createFromPure(pure.attribute);
    pure.color = new Color(pure.color);
    pure.component = CaveComponent.fromPure(pure.component);
    return Object.assign(new ComponentAttribute(), pure);
  }
}

class StationAttribute {

  constructor(name, attribute) {
    this.name = name;
    this.attribute = attribute;
  }

  toExport() {
    return {
      name      : this.name,
      attribute : this.attribute.toExport()
    };
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

class Surface {
  /**
   *
   * @param {string} name - The name of the surface
   * @param {Array[Vector]} points - The points that define the surface
   * @param {Vector} center - The center of the surface bounding box
   * @param {boolean} visible - The visibility property of the surface
   */
  constructor(name, points = [], center, visible = true) {
    this.name = name;
    this.points = points;
    this.center = center;
    this.visible = visible;
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
    coordinates,
    stations = new Map(),
    surveys = [],
    aliases = [],
    sectionAttributes = [],
    componentAttributes = [],
    visible = true
  ) {
    this.name = name;
    this.metaData = metaData;
    this.coordinates = coordinates;
    this.stations = stations;
    this.surveys = surveys;
    this.aliases = aliases;
    this.sectionAttributes = sectionAttributes;
    this.componentAttributes = componentAttributes;
    this.visible = visible;
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
    var minZ, maxZ, minZSplay, maxZSplay;

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
      coordinates         : this.coordinates.map((c) => c.toExport()),
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
    pure.coordinates = pure.coordinates === undefined ? [] : pure.coordinates.map((c) => StationCoordinate.fromPure(c));
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

export {
  Vector,
  Color,
  Shot,
  EOVCoordinateWithElevation,
  StationCoordinates,
  StationCoordinate,
  StationAttribute,
  CaveSection,
  CaveComponent,
  CaveCycle,
  SectionAttribute,
  ComponentAttribute,
  SurveyStation,
  SurveyTeamMember,
  SurveyTeam,
  SurveyInstrument,
  SurveyMetadata,
  Survey,
  SurveyAlias,
  Surface,
  CaveMetadata,
  Cave
};
