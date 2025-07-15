import { CaveSection, CaveComponent } from './model/cave.js';

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

  neg() {
    return new Vector(-this.x, -this.y, -this.z);
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

export { Vector, Color, Shot, StationAttribute, SectionAttribute, ComponentAttribute, Surface };
