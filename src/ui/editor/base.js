import * as U from '../../utils/utils.js';
import { AttributesDefinitions } from '../../attributes.js';
import { SectionHelper } from '../../section.js';
import { CaveSection, CaveComponent } from '../../model/cave.js';
import { i18n } from '../../i18n/i18n.js';

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

  showAlert(msg, postAction = () => {}) {
    if (this.table === undefined) return;
    const closingButton = U.node`<button style="position: absolute; right: 4px; top: 4px; cursor: pointer; border: none; background: none; font-size: 1.5em; color: #666;">✕</button>`;
    closingButton.onclick = () => {
      this.table.clearAlert();
      postAction();
    };
    const div = U.node`<div style="position: relative; padding:10px;"><div style="margin-right: 30px;">${msg}</div></div>`;
    div.appendChild(closingButton);
    this.table.alert(div);
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
  constructor(panel, scene, cave) {
    super(panel);
    this.scene = scene;
    this.cave = cave;
    this.closed = false;
    this.attributesModified = false;
  }

  baseTableFunctions = {

    sumDistance : (_values, data) => {
      return data.reduce((sum, v) => sum + (v.distance || 0), 0).toFixed(2);
    },
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
      const color = data.color;
      const style = `style="background: ${color}"`;
      return `<input type="color" id="color-picker-${data.id}" value="${color}"><label id="color-picker-${data.id}-label" for="color-picker-${data.id}" ${style}></label>`;
    },
    changeColor : (e, cell) => {
      if (e.target.tagName === 'INPUT') {
        e.target.oninput = (e2) => {
          const newColor = e2.target.value;
          const data = cell.getData();
          data.color = newColor;
          if (data.visible) {
            this.scene.disposeSectionAttribute(data.id);
            this.scene.showFragmentAttribute(
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
    atrributesFormatter : (cell, extractor, i18n) => {
      const attrs = extractor(cell.getData());
      if (attrs === undefined) {
        return undefined;
      }

      if (Array.isArray(attrs) && attrs.length > 0) {
        return AttributesDefinitions.getAttributesAsString(attrs, i18n);
      } else {
        return undefined;
      }
    },
    attributesHeaderFilter : (headerValue, _rowValue, rowData) => {
      let attrs;
      if (rowData.attribute !== undefined) {
        attrs = [rowData.attribute];
      } else if (rowData.attributes !== undefined) {
        attrs = rowData.attributes;
      }
      if (attrs !== undefined && attrs && Array.isArray(attrs) && attrs.length > 0) {
        const formatted = AttributesDefinitions.getAttributesAsString(attrs, i18n);
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
        this.showAlert(result.errors.join('<br>'));
      } else if (result.attributes.length > 0) {
        return converter(result.attributes);
      }
    }

  };

}

export { BaseEditor, Editor };
