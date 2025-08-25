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

  dot(v) {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }

  cross(v) {
    return new Vector(this.y * v.z - this.z * v.y, this.z * v.x - this.x * v.z, this.x * v.y - this.y * v.x);
  }

  length() {
    return this.magnitude();
  }

  magnitude() {
    return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
  }

  normalize() {
    const mag = this.magnitude();
    if (mag === 0) return new Vector(0, 0, 0);
    return new Vector(this.x / mag, this.y / mag, this.z / mag);
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

class Polar {

  constructor(distance, azimuth, clino) {
    this.distance = distance;
    this.azimuth = azimuth;
    this.clino = clino;
  }

  inTolerance(other, tolerance) {
    return Math.abs(this.distance - other.distance) < tolerance * this.distance &&
      Math.abs(this.azimuth - other.azimuth) < tolerance * this.azimuth &&
      Math.abs(this.clino - other.clino) < tolerance * this.clino;
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

  validate(i18n) {

    const t = i18n === undefined ? (msg) => msg : (key, params) => i18n.t(key, params);

    const errors = [];

    if (typeof this.visible !== 'boolean' && ![true, false].includes(this.visible)) {
      errors.push(t('validation.fragmentAttribute.invalidVisible', { visible: this.visible }));
    }

    if (typeof this.color !== 'string' && !this.color.startsWith('#')) {
      errors.push(t('validation.fragmentAttribute.invalidColor', { color: this.color }));
    }

    const paramErrors = this.attribute.validate(false, i18n);
    paramErrors.forEach((error, paramName) => {
      const nameOrTranslated =
        i18n === undefined ? this.attribute.name : i18n.t(`attributes.names.${this.attribute.name}`);
      const paramNameOrTranslated = i18n === undefined ? paramName : i18n.t(`attributes.params.${paramName}`);
      errors.push(
        t('validation.fragmentAttribute.invalidAttribute', {
          attribute : nameOrTranslated,
          paramName : paramNameOrTranslated,
          error
        })
      );
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

  validate(i18n) {

    const t = i18n === undefined ? (msg) => msg : (key, params) => i18n.t(key, params);

    const errors = [];
    errors.push(...super.validate(i18n));
    this.section.validate(i18n).forEach((error) => {
      errors.push(t('validation.sectionAttribute.invalidSection', { error }));
    });
    return errors;
  }

  isEqual(other) {
    return this.id === other.id &&
      this.visible === other.visible &&
      this.color === other.color &&
      this.format === other.format &&
      ((this.attribute === undefined && other.attribute === undefined) ||
        (this.attribute !== undefined && this.attribute.isEqual(other.attribute))) &&
      this.section.from === other.section.from &&
      this.section.to === other.section.to;
  }

  toExport() {
    return {
      id        : this.id,
      section   : this.section.toExport(),
      attribute : this.attribute?.toExport(),
      format    : this.format,
      color     : this.color,
      visible   : this.visible
    };
  }

  static fromPure(pure, attributeDefs) {
    pure.attribute = pure.attribute === undefined ? undefined : attributeDefs.createFromPure(pure.attribute);
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

  validate(i18n) {

    const t = i18n === undefined ? (msg) => msg : (key, params) => i18n.t(key, params);

    const errors = [];
    errors.push(...super.validate(i18n));
    this.component.validate(i18n).forEach((error) => {
      errors.push(t('validation.componentAttribute.invalidComponent', { error }));
    });
    return errors;
  }

  isEqual(other) {
    return this.id === other.id &&
      this.visible === other.visible &&
      this.color === other.color &&
      this.format === other.format &&
      ((this.attribute === undefined && other.attribute === undefined) ||
        (this.attribute !== undefined && this.attribute.isEqual(other.attribute))) &&
      this.component.start === other.component.start &&
      this.component.termination.every((t, i) => t === other.component.termination[i]);
  }

  toExport() {
    return {
      id        : this.id,
      component : this.component.toExport(),
      attribute : this.attribute?.toExport(),
      format    : this.format,
      color     : this.color,
      visible   : this.visible
    };
  }

  static fromPure(pure, attributeDefs) {
    pure.attribute = pure.attribute === undefined ? undefined : attributeDefs.createFromPure(pure.attribute);
    pure.component = CaveComponent.fromPure(pure.component);
    return Object.assign(new ComponentAttribute(), pure);
  }
}

class StationAttribute {

  constructor(id, name, attribute) {
    this.id = id;
    this.name = name;
    this.attribute = attribute;
  }

  getEmptyFields() {
    const fields = [];
    if (!this.name || this.name.trim() === '') {
      fields.push('name');
    }
    if (!this.attribute) {
      fields.push('attribute');
    }
    return fields;
  }

  validate(i18n) {

    const t = i18n === undefined ? (msg) => msg : (key, params) => i18n.t(key, params);

    const errors = [];

    const paramErrors = this.attribute.validate(false, i18n);
    paramErrors.forEach((error, paramName) => {
      const nameOrTranslated =
        i18n === undefined ? this.attribute.name : i18n.t(`attributes.names.${this.attribute.name}`);
      const paramNameOrTranslated = i18n === undefined ? paramName : i18n.t(`attributes.params.${paramName}`);
      errors.push(
        t('validation.stationAttribute.invalidAttribute', {
          attribute : nameOrTranslated,
          paramName : paramNameOrTranslated,
          error
        })
      );
    });
    return errors;
  }

  isEqual(other) {
    if (!other) return false;
    return this.id === other.id &&
      this.name === other.name &&
      ((this.attribute === undefined && other.attribute === undefined) ||
        (this.attribute !== undefined && other.attribute !== undefined && this.attribute.isEqual(other.attribute)));
  }

  toExport() {
    return {
      id        : this.id,
      name      : this.name,
      attribute : this.attribute?.toExport()
    };
  }

  static fromPure(pure, attributeDefs) {
    pure.attribute = pure.attribute === undefined ? undefined : attributeDefs.createFromPure(pure.attribute);
    return Object.assign(new StationAttribute(), pure);
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

export { Vector, Polar, Color, StationAttribute, SectionAttribute, ComponentAttribute, Surface };
