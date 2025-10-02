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

import { falsy, parseMyFloat, isFloatStr } from './utils/utils.js';
import { i18n } from './i18n/i18n.js';

export class AttributesDefinitions {

  attributesPattern = /((?<name>[A-Za-z0-9]+)(\((?<params>[^()]+)\))?)/g;

  constructor(attributeDefintions) {
    attributeDefintions.definitions = AttributesDefinitions.resolveReferences(attributeDefintions);
    this.defs = attributeDefintions;
    this.schemaVersion = attributeDefintions.version;
  }

  static resolveReferences(attributeDefintions) {
    return attributeDefintions.definitions.map((d) => {
      return {
        ...d,
        params : Object.fromEntries(
          Object.entries(d.params).map(([k, v]) => [k, v.ref ? attributeDefintions.references[v.ref] : v])
        )
      };
    });
  }

  #getDefiniton(predicate) {
    return this.defs.definitions.find(predicate);
  }
  createById(id) {
    const def = this.#getDefiniton((x) => x.id === id);

    if (def !== undefined) {
      return new Attribute(def).setValues;
    } else {
      return undefined;
    }
  }

  createByName(name) {
    const def = this.#getDefiniton((d) => d.name === name);
    if (def !== undefined) {
      const a = new Attribute(def);
      return function (...varargs) {
        a.setValues(...varargs);
        return a;
      };
    } else {
      return undefined;
    }
  }

  createFromPure(attribute) {
    const def = this.#getDefiniton((d) => d.name === attribute.name);
    const newAttribute = new Attribute(def);
    const paramNames = Object.keys(def.params);
    paramNames.forEach((pName) => {
      newAttribute[pName] = attribute[pName];
    });
    return newAttribute;
  }

  tranformPureAttributes(attributes) {
    return attributes.map((a) => {
      this.createFromPure(a);
    });

  }

  getAttributeNames() {
    return this.defs.definitions.map((d) => d.name);
  }

  getLocalizedAttributeNamesWitdId(i18n) {
    return this.defs.definitions.map((d) => ({
      id           : d.id,
      name         : i18n.t(`attributes.names.${d.name}`),
      originalName : d.name
    }));
  }

  getAttributesFromString(str) {
    const attrs = [];
    const errors = [];

    for (const match of str.matchAll(this.attributesPattern)) {
      const n = match.groups.name;
      const a = this.createByName(n);
      if (a !== undefined) {
        const params = match.groups.params.split('◌̦');
        attrs.push(a(...params));
      } else {
        errors.push(i18n.t('validation.attributes.fromStringNotFound', { name: n }));
      }
    }
    return { errors: errors, attributes: attrs };
  }

  static getAttributesAsString(attrs, i18n, delimiter = '◌̦') {
    return attrs
      .map((a) => {
        const nameOrTranslated = i18n === undefined ? a.name : i18n.t(`attributes.names.${a.name}`);
        const paramNames = Object.keys(a.params);
        const paramValues = paramNames
          .map((n) =>
            i18n === undefined || a[n] === undefined || (a.params[n].values?.length ?? 0) === 0
              ? a[n]
              : i18n.t(`attributes.values.${a[n]}`)
          ).join(delimiter);
        return `${nameOrTranslated}(${paramValues})`;
      })
      .join('|');
  }

}

export class MigrationSupportV4 {

  static migrate(attribute) {
    if (attribute.name === 'co') {
      attribute.name = 'co2';
    }
    if (attribute.name === 'speleothem') {
      attribute.name = 'other_speleothem';
    }

    if (attribute.name === 'bat' && ['few', 'several', 'many', 'colony'].includes(attribute.population)) {
      switch (attribute.population) {
        case 'few':
          attribute.population = '1-2';
          break;
        case 'several':
          attribute.population = '3-10';
          break;
        case 'many':
          attribute.population = '10-100';
          break;
        case 'colony':
          attribute.population = '100+';
          break;
      }
    }
    return attribute;
  }

}

// not exporter, created by AttributesDefinitions
class Attribute {

  paramNames;

  constructor(definition) {
    Object.assign(this, definition);
    this.paramNames = Object.keys(definition.params);
  }

  setParamFromString(paramName, str) {
    const paramDef = this.params[paramName];
    switch (paramDef.type) {
      case 'string':
        this[paramName] = str.replace(/\t/g, '');
        break;
      case 'float':
        this[paramName] = parseMyFloat(str);
        break;
      case 'int':
        this[paramName] = parseInt(str, 10);
        break;
      default:
        throw new Error(i18n.t('errors.attributes.unsupportedDataType', { dataType: paramDef.type }));
    }
  }

  setValues(...varargs) {
    Array.from(varargs.entries()).forEach(([index, value]) => {
      const pName = this.paramNames[index];
      const dataType = this.params[pName].type;
      switch (dataType) {
        case 'float':
          this[pName] = parseFloat(value);
          break;
        case 'int':
          this[pName] = parseInt(value);
          break;
        case 'string':
          this[pName] = value;
          break;
        default:
          throw new Error(i18n.t('errors.attributes.unsupportedDataType', { dataType }));
      }

    });
    return this;
  }

  validateFieldValue(paramName, value, validateAsString = false, skipEmptyCheck = false, i18n) {

    const t = i18n === undefined ? (msg) => msg : (key, params) => i18n.t(key, params);

    const runFieldValidators = (paramDef, v) => {
      const e = [];

      if (paramDef.validators !== undefined && !falsy(v)) {

        if ('min' in paramDef.validators && v < paramDef.validators['min']) {
          e.push(t('validation.attribute.valueMin', { min: paramDef.validators['min'] }));
        }

        if ('max' in paramDef.validators && v > paramDef.validators['max']) {
          e.push(t('validation.attribute.valueMax', { max: paramDef.validators['max'] }));
        }
      }
      return e;
    };

    const paramDef = this.params[paramName];
    const errors = [];
    const reasons = new Set();

    if (!skipEmptyCheck && (paramDef.required ?? false) && falsy(value)) {
      errors.push(t('validation.attribute.required'));
    }
    if (value !== undefined) {

      if (!validateAsString) {
        let typeMatch;
        switch (paramDef.type + '-' + typeof value) {
          case 'string-string':
          case 'int-number':
          case 'float-number':
            typeMatch = true;
            break;
          default:
            typeMatch = false;
            break;
        }

        if (!typeMatch) {
          errors.push(
            t('validation.attribute.typeMismatch', { value, type: typeof value, expectedType: paramDef.type })
          );
          reasons.add('typeMismatch');
        } else {
          if (paramDef.type === 'int' && !Number.isInteger(value)) {
            errors.push(t('validation.attribute.notInteger', { value }));
            reasons.add('typeMismatch');
          }

          if (paramDef.type === 'float' && (isNaN(value) || Infinity === value || -Infinity === value)) {
            errors.push(t('validation.attribute.nanOrInfinity'));
            reasons.add('typeMismatch');
          }

          const fieldErrors = runFieldValidators(paramDef, value);
          if (fieldErrors.length > 0) {
            reasons.add('fieldValidators');
            errors.push(...fieldErrors);
          }

        }

      } else {
        if (!falsy(value)) {
          let validForType, parsedValue;
          switch (paramDef.type) {
            case 'int':
              if (!Number.isInteger(parseInt(value, 10))) {
                errors.push(t('validation.attribute.notInteger', { value }));
                reasons.add('typeMismatch');
              } else {
                validForType = true;
                parsedValue = parseInt(value, 10);
              }
              break;
            case 'float':
              if (!isFloatStr(value)) {
                errors.push(t('validation.attribute.notFloat', { value }));
                reasons.add('typeMismatch');
              } else {
                validForType = true;
                parsedValue = parseMyFloat(value);
              }
              break;
            case 'string':
              validForType = true;
              parsedValue = value;
              break;
          }

          if (validForType) {

            const fieldErrors = runFieldValidators(paramDef, parsedValue);
            if (fieldErrors.length > 0) {
              reasons.add('fieldValidators');
              errors.push(...fieldErrors);
            }
          }
        }
      }

      if (paramDef.type === 'int' && !reasons.has('typeMismatch') && (paramDef.range?.length ?? 0) > 0) {
        const intValue = typeof value === 'number' ? value : parseInt(value, 10);
        if (!paramDef.range.includes(intValue)) {
          errors.push(t('validation.attribute.notInRange', { value, range: paramDef.range.join(',') }));
          reasons.add('rangeMismatch');
        }
      }

      if (paramDef.type === 'string') {
        if ((paramDef.values?.length ?? 0) > 0 && !paramDef.values.includes(value)) {
          errors.push(t('validation.attribute.notOneOf', { value, values: paramDef.values.join(', ') }));
          reasons.add('valuesMismatch');
        }
      }

    }
    return { errors, reasons };

  }

  validate(validateAsString = false, i18n) {
    const errorMap = new Map();

    this.paramNames.forEach((n) => {
      const { errors } = this.validateFieldValue(n, this[n], validateAsString, false, i18n);
      if (errors.length > 0) {
        errorMap.set(n, errors);
      }

    });
    return errorMap;
  }

  isValid() {
    return this.validate().size === 0;
  }

  #getFormatVariables(formatString) {
    const formatVariables = [];
    const formatVariablePattern = /\$\{([^{}]+)\}/g;
    let match;
    let guardIndex = 100;
    while ((match = formatVariablePattern.exec(formatString)) !== null) {
      formatVariables.push(match[1]);
      guardIndex--; //prevent infnitie loop for whatever reason
      if (guardIndex === 0) {
        break;
      }
    }
    return formatVariables;
  }

  // converts "${name}-${year}" to "${név}-${év}"
  localizeFormatString(formatString, i18n) {
    if (!formatString || formatString.length === 0) {
      return formatString;
    }
    const formatVariables = this.#getFormatVariables(formatString);
    const nameLocalized = i18n.t(`attributes.name`);

    return formatVariables.reduce((acc, v) => {
      if (v === 'name') {
        return acc.replace(`${v}`, nameLocalized);
      } else {
        let l = i18n.t(`attributes.params.${v}`);
        if (l.startsWith('attributes.params.')) {
          // not found in translations
          l = v;
        }

        return acc.replace(v, l);
      }
    }, formatString);
  }

  // converts "${név}-${év}" to "${name}-${year}"
  deLocalizeFormatString(formatString, i18n) {
    if (!formatString || formatString.length === 0) {
      return formatString;
    }
    const formatVariables = this.#getFormatVariables(formatString);
    const nameLocalized = i18n.t(`attributes.name`);

    return formatVariables.reduce((acc, v) => {
      if (v === nameLocalized) {
        return acc.replace(`${v}`, 'name');
      } else {
        const key = i18n.lookupKey(`attributes.params`, v);
        const l = key ?? v;
        return acc.replace(v, l);
      }
    }, formatString);
  }

  localize(i18n) {
    const localized = {};
    localized.name = i18n.t(`attributes.names.${this.name}`);
    this.paramNames.forEach((n) => {
      if (this.params[n].values && this.params[n].values.length > 0 && this.params[n].values.includes(this[n])) {
        const localizedParamValue = i18n.t(`attributes.values.${this[n]}`);
        localized[n] = localizedParamValue.startsWith('attributes.values') ? this[n] : localizedParamValue;
      } else {
        localized[n] = this[n];
      }
    });
    return localized;
  }

  clone() {
    const definition = {
      id       : this.id,
      category : this.category,
      name     : this.name,
      params   : this.params
    };

    return Object.assign(new Attribute(definition), this);
  }

  isEqual(other) {
    return other !== undefined &&
      this.id === other.id &&
      this.name === other.name &&
      this.paramNames.every((n) => this[n] === other[n]);
  }

  toExport() {
    const a = {};
    a.id = this.id;
    a.name = this.name;
    this.paramNames.forEach((n) => {
      if (this[n] !== undefined) {
        a[n] = this[n];
      }
    });
    return a;
  }
}
