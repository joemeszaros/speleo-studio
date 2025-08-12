import * as U from '../../utils/utils.js';
import { AttributesDefinitions } from '../../attributes.js';
import { Color } from '../../model.js';
import { SectionHelper } from '../../section.js';
import { CaveSection, CaveComponent } from '../../model/cave.js';

class BaseEditor {
  constructor(panel) {
    this.panel = panel;
  }

  show() {
    this.panel.style.display = 'block';
  }

  closeEditor() {
    this.closed = true;

    if (this.table !== undefined) {
      this.table.destroy();
      this.table = undefined;
    }

    this.panel.style.display = 'none';
  }

  renderListEditor({
    container,
    items,
    fields,
    nodes,
    onAdd,
    onRemove,
    onChange,
    addButtonLabel = 'Add',
    rowStyle = ''
  }) {
    container.innerHTML = '';
    items.forEach((item, idx) => {
      const row = U.node`<div class="list-row" style="display: flex; gap: 8px; align-items: center; margin-bottom: 4px;${rowStyle}"></div>`;
      fields.forEach((f) => {
        const input = U.node`<input type="${f.type}" placeholder="${f.placeholder}" value="${item[f.key]}" ${f.required ? 'required' : ''} ${f.step ? 'step="' + f.step + '"' : ''} style="width: ${f.width || '100px'};">`;
        input.onchange = (e) => onChange(idx, f.key, e.target.value);
        row.appendChild(input);
      });

      nodes.forEach((n) => {
        const el = U.node(n.node);
        el.value = item[n.key];
        el.onchange = (e) => onChange(idx, n.key, e.target.value);
        row.appendChild(el);
      });

      const removeBtn = U.node`<button type="button">Remove</button>`;
      removeBtn.onclick = (e) => {
        e.preventDefault();
        onRemove(idx);
      };
      row.appendChild(removeBtn);
      container.appendChild(row);
    });
    const addBtn = U.node`<button type="button">${addButtonLabel}</button>`;
    addBtn.onclick = (e) => {
      e.preventDefault();
      onAdd();
    };
    container.appendChild(addBtn);
  }
}

class Editor extends BaseEditor {
  constructor(panel, scene, cave, attributeDefs) {
    super(panel);
    this.scene = scene;
    this.cave = cave;
    this.attributeDefs = attributeDefs;
    this.closed = false;
    this.attributesModified = false;
  }

  showAlert(msg, timeoutSec = 5, postAction = () => {}) {
    if (this.table === undefined) return;
    this.table.alert(msg);
    setTimeout(() => {
      this.table.clearAlert();
      postAction();
    }, timeoutSec * 1000);
  }

  getAttributeEditorDiv(a, attributes, index) {
    const attributeNode = U.node`<div class="attribute-editor" id="attribute-editor-${index}"></div>`;
    //const warning = U.node`<div class="warning" id="attribute-editor-${index}-warning">hel</div>`;
    //attributeNode.appendChild(warning);
    //warning.style.display = 'none'; TODO: somehow show the warning div
    const name = U.node`<span>${a.name}(</span>`;
    const del = U.node`<span class="delete-row">`;
    del.onclick = () => {
      const indexToDelete = attributes.indexOf(a);
      if (indexToDelete !== -1) {
        attributes.splice(indexToDelete, 1);
        attributeNode.parentNode.removeChild(attributeNode); // funny self destruction :-)
      }
    };

    attributeNode.appendChild(name);
    const paramNames = Object.keys(a.params);
    var paramIndex = 0;
    paramNames.forEach((paramName) => {
      const value = a[paramName] === undefined ? '' : a[paramName];
      const paramDef = a.params[paramName];
      const errors = a.validateFieldValue(paramName, value, true, true); // validate as string, skip empty check
      let underScoreClass;
      const requiredField = paramDef.required ?? false;
      if (errors.length > 0) {
        underScoreClass = 'invalidInput';
      } else if (requiredField) {
        underScoreClass = 'requiredInput';
      } else {
        underScoreClass = 'optionalInput';
      }
      const classes = [['int', 'float'].includes(paramDef.type) ? 'shortInput' : 'longInput', underScoreClass];

      let datalist;
      if ((paramDef.values ?? []).length > 0) {
        datalist = U.node`<datalist id="paramValues-${paramName}-${index}">${paramDef.values.map((n) => '<option value="' + n + '">').join('')}</datalist>`;
      }
      const inputType = datalist === undefined ? 'text' : 'search';
      const list = datalist === undefined ? '' : `list="paramValues-${paramName}-${index}"`;
      const param = U.node`<input placeholder="${paramName}" type="${inputType}" ${list} class="${classes.join(' ')}" id="${paramName}-${index}" value="${value}">`;
      param.onchange = (e) => {
        this.attributesModified = true;
        const newValue = e.target.value === '' ? undefined : e.target.value;
        const errors = a.validateFieldValue(paramName, newValue, true);
        if (errors.length > 0) {
          param.classList.remove('requiredInput');
          param.classList.add('invalidInput');
          a[paramName] = newValue; // set the invalid value
          this.showAlert(`Invalid '${paramName}': ${errors.join('<br>')}`);
        } else {
          param.classList.remove('invalidInput');
          param.classList.add(requiredField ? 'requiredInput' : 'optionalInput');
          a.setParamFromString(paramName, newValue);
        }
      };
      if (paramIndex !== 0) {
        attributeNode.appendChild(document.createTextNode(','));
      }
      attributeNode.appendChild(param);
      if (datalist !== undefined) {
        attributeNode.appendChild(datalist);
      }
      paramIndex += 1;
    });
    attributeNode.appendChild(document.createTextNode(')'));
    attributeNode.appendChild(del);
    return attributeNode;
  }

  attributesEditor(cell, onRendered, success, extractor, mutator, extraValidators) {
    const attributes = extractor(cell.getData());

    const panel = U.node`<div tabindex="0" id="attributes-editor" class="attributes-editor"></div>`;
    panel.addEventListener('keydown', (e) => {
      if (e.keyCode === 9) {
        e.stopPropagation(); // when a user clicks or tabs out of a cell the edit is cancelled and and the user is navigated to the next row
        this.table.dispatch('cell-value-changed', this);
      }
      if (e.key === 'Escape') {
        if (extraValidators(attributes) === true) {
          const cloned = attributes.map((a) => a.clone()); // we need to clone the attribute otherwise tabulator won't detect a change (this.value ===  value) in setValueProcessData(value, mutate, force) internal
          const toSuccess = mutator(cloned);
          success(toSuccess);
        }
      }
    });

    var index = 0;
    attributes.forEach((a) => {
      const attributeNode = this.getAttributeEditorDiv(a, attributes, index);
      panel.appendChild(attributeNode);
      index += 1;
    });

    const aNames = this.attributeDefs.getAttributeNames();
    const options = aNames.map((n) => `<option value="${n}">`).join('');

    const add = U.node`<div><label>New attribute: </label><input placeholder="attribute name" type="search" class="longInput requiredInput" list="attributeNames" id="new-attribute-value"><datalist id="attributeNames">${options}</datalist><span class="add-row"></span></div>`;
    add.childNodes[3].onclick = () => {
      const input = add.querySelector('#new-attribute-value');
      const aName = input.value;
      if (aNames.includes(aName)) {
        const newAttribute = this.attributeDefs.createByName(input.value)();
        const attributeNode = this.getAttributeEditorDiv(newAttribute, attributes, index);
        panel.insertBefore(attributeNode, add);
        attributes.push(newAttribute);
        input.value = '';
      } else if (aName === '') {
        this.showAlert(`No attribute name is selected`);
      } else {
        this.showAlert(`Cannot find attribute with name '${aName}'`);
      }
    };

    panel.appendChild(add);

    return panel;
  }

  getAttributeErrors(row) {
    const errors = [];

    row.attributes.forEach((a) => {
      const paramErrors = a.validate();
      paramErrors.forEach((error, paramName) => {
        errors.push(`Invalid attribute '${a.name}' field ${paramName}: ${error}`);
      });
    });

    return errors;
  }

  baseTableFunctions = {
    statusIcon : (cell) => {
      const data = cell.getData();
      if (data.status === 'ok') {
        return '<div class="ok-row"></div>';
      } else {
        return '<div class="warning-row"></div>';
      }
    },
    countBadRows : (_values, data) => {
      const cnt = data.filter((v) => v.status !== 'ok').length;
      return `${cnt}`;
    },
    getContextMenu : () => {
      return [
        {
          label  : '<span class="delete-row"></span><span>Delete row<span/> ',
          action : function (e, row) {
            row.delete();
          }
        },
        {
          label  : '<span class="add-row"></span><span>Add row above<span/> ',
          action : (e, row) => {
            const newRow = this.getEmptyRow();
            row.getTable().addRow(newRow, true, row.getIndex());
          }
        },
        {
          label  : '<span class="add-row"></span><span>Add row below<span/> ',
          action : (e, row) => {
            const newRow = this.getEmptyRow();
            row.getTable().addRow(newRow, false, row.getIndex());
          }
        }
      ];
    },
    floatAccessor : (value) => {
      if (value === undefined) {
        return undefined;
      } else if (U.isFloatStr(value)) {
        return U.parseMyFloat(value);
      } else {
        return value;
      }
    },
    floatFormatter : (defaultValue = '0', decimals = 2) => {
      return (cell) => {
        if (cell.getValue() !== undefined) {
          return cell.getValue().toFixed(decimals);
        } else {
          return defaultValue;
        }
      };
    },
    colorIcon : (cell) => {
      const data = cell.getData();
      const color = data.color.hexString();
      const style = `style="background: ${color}"`;
      return `<input type="color" id="color-picker-${data.id}" value="${color}"><label id="color-picker-${data.id}-label" for="color-picker-${data.id}" ${style}></label>`;
    },
    changeColor : (e, cell) => {
      if (e.target.tagName === 'INPUT') {
        e.target.oninput = (e2) => {
          const newColor = e2.target.value;
          const data = cell.getData();
          data.color = new Color(newColor);
          if (data.visible) {
            this.scene.disposeSectionAttribute(data.id);
            this.scene.showSectionAttribute(
              data.id,
              data.start === undefined
                ? SectionHelper.getSectionSegments(
                    new CaveSection(data.from, data.to, data.path, data.distance),
                    this.cave.stations
                  )
                : SectionHelper.getComponentSegments(
                    new CaveComponent(data.start, data.termination, data.path, data.distance),
                    this.cave.stations
                  ),
              data.attribute,
              data.format,
              data.color,
              this.cave.name
            );
          }
          const label = document.getElementById(e.target.id + '-label');
          label.style.background = newColor;
        };
      }
    },
    atrributesFormatter : (cell, extractor) => {
      const attrs = extractor(cell.getData());
      if (attrs === undefined) {
        return undefined;
      }

      if (Array.isArray(attrs) && attrs.length > 0) {
        return AttributesDefinitions.getAttributesAsString(attrs);
      } else {
        return undefined;
      }
    },
    attributeHeaderFilter : (headerValue, _rowValue, rowData) => {
      let attrs;
      if (rowData.attribute !== undefined) {
        attrs = [rowData.attribute];
      } else if (rowData.attributes !== undefined) {
        attrs = rowData.attributes;
      }
      if (attrs !== undefined) {
        const formatted = AttributesDefinitions.getAttributesAsString(attrs);
        return formatted.includes(headerValue);
      } else {
        return false;
      }
    },
    attributesToClipboard : (value, extractor) => {
      const attributes = extractor(value);
      if (attributes !== undefined) {
        return AttributesDefinitions.getAttributesAsString(attributes);
      } else {
        return '';
      }
    },
    clipboardFormatter : (cell, extractor) => {
      const attrs = extractor(cell.getData());
      if (Array.isArray(attrs) && attrs.length > 0) {
        return AttributesDefinitions.getAttributesAsString(attrs);
      } else {
        return '';
      }
    },
    attributesFromClipboard : (value, converter) => {
      if (value === undefined || typeof value !== 'string' || value.length === 0) {
        return [];
      }
      const result = this.attributeDefs.getAttributesFromString(value);
      if (result.errors.length > 0) {
        this.showAlert(result.errors.join('<br>'), 6);
      } else if (result.attributes.length > 0) {
        return converter(result.attributes);
      }
    }
  };

}

export { BaseEditor, Editor };
