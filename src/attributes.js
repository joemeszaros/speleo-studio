import { falsy, parseMyFloat, isFloatStr } from './utils/utils.js';

const attributeDefintions = {
  verion : '1.0',
  types  : [
    {
      id   : 1,
      name : 'geology'
    },
    {
      id   : 2,
      name : 'equipment'
    },
    {
      id   : 3,
      name : 'metadata'
    }
  ],
  definitions : [
    {
      id       : 1,
      category : 1,
      name     : 'speleotheme',
      params   : {
        type : {
          required : true,
          type     : 'string',
          values   : ['dripstone', 'mammilary']
        },
        description : {
          type : 'string'
        }
      }
    },
    {
      id       : 2,
      category : 1,
      name     : 'bedding',
      params   : {
        azimuth : {
          type     : 'float',
          required : true
        },
        dip : {
          type       : 'float',
          required   : true,
          validators : {
            min : -90.0,
            max : 90.0
          }
        },
        width : {
          type : 'int'
        },
        height : {
          type : 'int'
        }
      }
    },
    {
      id       : 3,
      category : 1,
      name     : 'fault',
      params   : {
        azimuth : {
          type : 'float'
        },
        dip : {
          type : 'float'
        },
        width : {
          type : 'int'
        },
        height : {
          type : 'int'
        }
      }
    },
    {
      id       : 4,
      category : 2,
      name     : 'rope',
      params   : {
        type : {
          type : 'string'
        }
      }
    },
    {
      id       : 14,
      category : 2,
      name     : 'co',
      params   : {
        value : {
          type : 'int'
        }
      }
    },
    {
      id     : 5,
      type   : 3,
      name   : 'label',
      params : {
        value : {
          type : 'string'
        }
      }
    },
    {
      id       : 14,
      category : 3,
      name     : 'exploration',
      params   : {
        year : {
          type     : 'int',
          required : true
        },
        month : {
          type       : 'int',
          validators : {
            min : 1,
            max : 12
          }
        },
        day : {
          type       : 'int',
          validators : {
            min : 1,
            max : 31
          }
        }
      }
    }
  ]
};

class AttributesDefinitions {

  attributesPattern = /((?<name>[A-Za-z]+)(\((?<params>[A-Za-z0-9., ":{}]+)\))?)/g;

  constructor(attributeDefintions) {
    this.defs = attributeDefintions;
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

  getAttributesFromString(str) {
    const attrs = [];
    const errors = [];

    for (const match of str.matchAll(this.attributesPattern)) {
      const n = match.groups.name;
      const a = this.createByName(n);
      if (a !== undefined) {
        const params = match.groups.params.split(',');
        attrs.push(a(...params));
      } else {
        errors.push(`Cannot find attribute by name '${n}'.`);
      }
    }
    return { errors: errors, attributes: attrs };
  }

  static getAttributesAsString(attrs) {
    return attrs
      .map((a) => {
        const paramNames = Object.keys(a.params);
        const paramValues = paramNames.map((n) => a[n]).join(',');
        return `${a.name}(${paramValues})`;
      })
      .join('|');
  }

}

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
        this[paramName] = str;
        break;
      case 'float':
        this[paramName] = parseMyFloat(str);
        break;
      case 'int':
        this[paramName] = parseInt(str, 10);
        break;
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
          throw new Error(`Not supported data type ${dataType}`);
      }

    });
    return this;
  }

  validateFieldValue(paramName, value, validateAsString = false, skipEmptyCheck = false) {

    const runFieldValidators = (paramDef, v) => {
      const e = [];

      if (paramDef.validators !== undefined && !falsy(v)) {

        if ('min' in paramDef.validators && v < paramDef.validators['min']) {
          e.push(`Value should not be less than ${paramDef.validators['min']} `);
        }

        if ('max' in paramDef.validators && v > paramDef.validators['max']) {
          e.push(`Value should not be greater than ${paramDef.validators['max']} `);
        }
      }
      return e;
    };

    const paramDef = this.params[paramName];
    const errors = [];

    if (!skipEmptyCheck && (paramDef.required ?? false) && falsy(value)) {
      errors.push('Required value is empty');
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
          errors.push(`Value '${value}' is a ${typeof value} and not ${paramDef.type}`);
        } else {
          if (paramDef.type === 'int' && !Number.isInteger(value)) {
            errors.push(`Value '${value}' is not a valid integer`);
          }

          if (paramDef.type === 'float' && (isNaN(value) || Infinity === value || -Infinity === value)) {
            errors.push(`Value is NaN or Infinity`);
          }

          errors.push(...runFieldValidators(paramDef, value));
        }

      } else {
        if (!falsy(value)) {
          let validForType, parsedValue;
          switch (paramDef.type) {
            case 'int':
              if (!Number.isInteger(parseInt(value, 10))) {
                errors.push(`Value '${value}' is not a valid integer`);
              } else {
                validForType = true;
                parsedValue = parseInt(value, 10);
              }
              break;
            case 'float':
              if (!isFloatStr(value)) {
                errors.push(`Value '${value}' is not a valid float`);
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
            errors.push(...runFieldValidators(paramDef, parsedValue));
          }
        }
      }

      if (paramDef.type === 'string') {
        if ((paramDef.values?.length ?? 0) > 0 && !paramDef.values.includes(value)) {
          errors.push(`Value is not one of ${paramDef.values.join(', ')}`);
        }
      }

    }
    return errors;

  }

  validate(validateAsString = false) {
    const errors = new Map();

    this.paramNames.forEach((n) => {
      const fieldErrors = this.validateFieldValue(n, this[n], validateAsString);
      if (fieldErrors.length > 0) {
        errors.set(n, fieldErrors);
      }

    });
    return errors;
  }

  isValid() {
    return this.validate().size === 0;
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

export { attributeDefintions, AttributesDefinitions };
