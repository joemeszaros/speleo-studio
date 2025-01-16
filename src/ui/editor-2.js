import * as U from '../utils/utils.js';
import {
  CaveMetadata,
  Color,
  StationAttribute,
  CaveSection,
  CaveComponent,
  SectionAttribute,
  ComponentAttribute,
  Shot
} from '../model.js';
import { AttributesDefinitions } from '../attributes.js';
import { SectionHelper } from '../section.js';
import { randomAlphaNumbericString } from '../utils/utils.js';
import { makeMoveableDraggable, showErrorPanel } from './popups.js';

class Editor {

  constructor(panel, scene, cave, attributeDefs) {
    this.panel = panel;
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
        this.dispatch('cell-value-changed', this);
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

    floatFormatter : (defaultValue = '0') => {
      return (cell) => {
        if (cell.getValue() !== undefined) {
          return cell.getValue().toFixed(2);
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

}

class CaveEditor extends Editor {

  constructor(db, options, cave, scene, attributeDefs, panel) {
    super(panel, scene, cave, attributeDefs);
    this.db = db;
    this.options = options;
    this.graph = undefined; // sort of a lazy val
  }

  #emitCaveRenamed(oldName, cave) {
    const event = new CustomEvent('caveRenamed', {
      detail : {
        oldName : oldName,
        cave    : cave
      }
    });
    document.dispatchEvent(event);
  }

  setupPanel() {
    this.panel.innerHTML = '';
    makeMoveableDraggable(
      this.panel,
      `Cave sheet editor: ${this.cave.name}`,
      () => this.closeEditor(),
      () => {},
      () => {}
    );
    this.#setupEditor();
    this.#setupStats();
  }

  #setupEditor() {
    const editorFields = U.node`<div class="editor"></div>`;

    [
      { label: 'Name', id: 'name', field: 'name', type: 'text' },
      { label: 'Settlement', id: 'settlement', fieldSource: 'metadata', field: 'settlement', type: 'text' },
      { label: 'Cataster code', id: 'cataster-code', fieldSource: 'metadata', field: 'catasterCode', type: 'text' },
      {
        label       : 'Date',
        id          : 'date',
        fieldSource : 'metadata',
        field       : 'date',
        type        : 'date',
        parser      : (value) => new Date(value),
        formatter   : (value) => U.formatDateISO(value) // yyyy-mm-dd
      }

    ].forEach((i) => {
      let value = '';
      if (i.fieldSource !== undefined && i.fieldSource === 'metadata' && this.cave.metaData !== undefined) {
        value = this.cave.metaData[i.field];
        if (value !== undefined && i.formatter !== undefined) {
          value = i.formatter(value);
        }
      } else if (i.id === 'name') {
        value = this.cave[i.field];
      }
      const label = U.node`<label for="${i.id}">${i.label}: <input type="${i.type}" id="${i.id}" value="${value}"></label>`;
      label.childNodes[1].onchange = (e) => {
        const newValue = e.target.value;
        if (i.fieldSource === 'metadata') {
          const parser = i.parser === undefined ? (v) => v : i.parser;
          if (this.cave.metaData === undefined) {
            this.cave.metaData = new CaveMetadata();
          }
          this.cave.metaData[i.field] = parser(newValue);
        }

        if (i.id === 'name') {
          if (this.db.getCave(newValue) !== undefined) {
            showErrorPanel(`Cave with name ${newValue} alreay exists, cannot rename!`);
            e.target.value = this.cave.name;
          } else {
            const oldName = this.cave.name;
            this.db.renameCave(oldName, newValue);
            this.#emitCaveRenamed(oldName, this.cave);
          }
        }

      };
      editorFields.appendChild(label);

    });

    this.panel.appendChild(editorFields);

    this.panel.appendChild(U.node`<hr/>`);
  }

  #setupStats() {
    const statFields = U.node`<div class="cave-stats"></div>`;
    const stats = this.cave.getStats();

    [
      { id: 'stations', label: 'Stations', field: 'stations', formatter: (v) => v },
      { id: 'surveys', label: 'Surveys', field: 'surveys', formatter: (v) => v },
      { id: 'isolated', label: 'Isolated surveys', field: 'isolated', formatter: (v) => v },
      { id: 'attributes', label: 'Station attributes', field: 'attributes', formatter: (v) => v },
      { break: true },
      { id: 'length', label: 'Length', field: 'length', formatter: (v) => v.toFixed(2) },
      { id: 'orphanLength', label: 'Length (orphan)', field: 'orphanLength', formatter: (v) => v.toFixed(2) },
      { break: true },
      { id: 'depth', label: 'Depth', field: 'depth', formatter: (v) => v.toFixed(2) },
      { id: 'height', label: 'Height', field: 'height', formatter: (v) => v.toFixed(2) },
      { id: 'vertical', label: 'Vertical extent', field: 'vertical', formatter: (v) => v.toFixed(2) },
      {
        id        : 'vertiicalWithSplays',
        label     : 'Vertical extent (splays)',
        field     : 'vertiicalWithSplays',
        formatter : (v) => v.toFixed(2)
      }

    ].forEach((s) => {
      let node;
      if (s.break) {
        node = U.node`<br>`;
      } else {
        const value = s.formatter(stats[s.field]);
        node = U.node`<span id="${s.id}">${s.label} : ${value}</span>"`;
      }
      statFields.appendChild(node);
    });
    this.panel.appendChild(statFields);

    this.panel.appendChild(U.node`<hr/>`);
  }
}

class FragmentAttributeEditor extends CaveEditor {

  constructor(db, options, cave, scene, attributeDefs, panel) {
    super(db, options, cave, scene, attributeDefs, panel);
  }

  getValidationUpdates(data) {
    const rowsToUpdated = [];

    data.forEach((r) => {
      const newRow = this.getValidationUpdate(r);
      if (newRow !== undefined) {
        rowsToUpdated.push(newRow);
      }
    });
    return rowsToUpdated;
  }

  validateRows(showAlert = true) {
    const data = this.table.getData();
    const rowsToUpdated = this.getValidationUpdates(data);
    if (rowsToUpdated.length > 0) {
      this.table.updateData(rowsToUpdated);
      const badRows = rowsToUpdated
        .filter((r) => ['invalid', 'incomplete'].includes(r.status));
      if (badRows.length > 0 && showAlert) {
        this.showAlert(`${badRows.length} row(s) are invalid.<br>Click on the warning icon for details.`, 4);
      }
    }
  }

  setupPanel() {
    this.panel.innerHTML = '';
    makeMoveableDraggable(
      this.panel,
      this.title,
      () => this.closeEditor(),
      (_newWidth, newHeight) => this.table.setHeight(newHeight - 140),
      () => this.table.redraw()
    );
    this.#setupButtons();
    this.#setupTable();
  }

  #setupButtons() {
    [
      { id: 'clear-filter', text: 'Clear filters', click: () => this.table.clearFilter() },
      { break: true },
      { id: 'validate-rows', text: 'Validate rows', click: () => this.validateRows() },
      { id: 'update-section-attributes', text: 'Update attributes', click: () => this.setCaveSectionAttributes() },
      { id: 'add-row', text: 'Add row to bottom', click: () => this.table.addRow(this.getEmptyRow()) },
      {
        id    : 'delete-row',
        text  : 'Delete active rows',
        click : () => {
          var ranges = this.table.getRanges();
          ranges.forEach((r) => {
            const rows = r.getRows();
            rows.forEach((r) => r.delete());
            r.remove();
          });
        }
      }
    ].forEach((b) => {
      if (b.break === true) {
        this.panel.appendChild(document.createElement('br'));
      } else {
        const button = U.node`<button id="${b.id}">${b.text}</button>`;
        button.onclick = b.click;
        this.panel.appendChild(button);
      }
    });
  }

  #setupTable() {

    const tableDiv = document.createElement('div');
    tableDiv.setAttribute('id', 'sectionattributes');
    this.panel.appendChild(tableDiv);

    const columns = [
      {
        width      : 25,
        title      : '',
        field      : 'status',
        editor     : false,
        formatter  : this.baseTableFunctions.statusIcon,
        clickPopup : function (x, cell) {
          const message = cell.getData().message;
          return message === undefined ? 'No errors' : message;
        },
        validator  : ['required'],
        bottomCalc : this.baseTableFunctions.countBadRows
      },

      {
        width            : 25,
        field            : 'visible',
        formatter        : 'tickCross',
        cellClick        : this.functions.toggleVisibility,
        mutatorClipboard : (str) => (str === 'true' ? true : false) //TODO:better parser here that considers other values (like 0, 1)
      },
      {
        title             : 'Color',
        field             : 'color',
        formatter         : this.baseTableFunctions.colorIcon,
        accessorClipboard : (color) => color.hexString(),
        mutatorClipboard  : (hex) => new Color(hex),
        width             : 45,
        cellClick         : (_e, cell) => this.baseTableFunctions.changeColor(_e, cell)
      },
      {
        title            : 'Distance',
        field            : 'distance',
        editor           : false,
        mutatorClipboard : this.baseTableFunctions.floatAccessor,
        formatter        : this.baseTableFunctions.floatFormatter('0')
      },
      {
        title            : 'Attribute',
        field            : 'attribute',
        headerFilterFunc : this.baseTableFunctions.attributeHeaderFilter,
        headerFilter     : 'input',
        formatter        : (cell) =>
          this.baseTableFunctions.atrributesFormatter(cell, (cv) => (cv.attribute === undefined ? [] : [cv.attribute])),
        accessorClipboard : (value) =>
          this.baseTableFunctions.attributesToClipboard(value, (attribute) =>
            attribute === undefined ? undefined : [attribute]
          ),
        mutatorClipboard   : (value) => this.baseTableFunctions.attributesFromClipboard(value, (attrs) => attrs[0]),
        formatterClipboard : (cell) =>
          this.baseTableFunctions.clipboardFormatter(cell, (cv) => (cv.attribute === undefined ? [] : [cv.attribute])),

        editor : (cell, onRendered, success) =>
          this.attributesEditor(
            cell,
            onRendered,
            success,
            (cv) => (cv.attribute === undefined ? [] : [cv.attribute]),
            (attrs) => {
              return attrs.lenth === 0 ? undefined : attrs[0];
            },
            this.tableFunctions.checkAttributesLength
          )
      },
      {
        title  : 'Format',
        field  : 'format',
        editor : 'input'
      }
    ];

    columns.splice(3, 0, ...this.getColumns());

    this.table = new Tabulator('#sectionattributes', {
      height                    : this.panel.style.height - 140,
      autoResize                : false,
      data                      : this.getTableData(),
      layout                    : 'fitColumns',
      validationMode            : 'highlight',
      //enable range selection
      selectableRange           : 1,
      selectableRangeColumns    : true,
      selectableRangeRows       : true,
      selectableRangeClearCells : true,

      //change edit trigger mode to make cell navigation smoother
      editTriggerEvent : 'dblclick',

      //configure clipboard to allow copy and paste of range format data
      clipboard           : true,
      clipboardCopyStyled : false,
      clipboardCopyConfig : {
        rowHeaders    : false,
        columnHeaders : false,
        columnCalcs   : false,
        formatCells   : false //show raw cell values without formatter
      },
      clipboardCopyRowRange : 'range',
      clipboardPasteParser  : 'range',
      clipboardPasteAction  : 'range',
      rowContextMenu        : this.baseTableFunctions.getContextMenu(),
      rowHeader             : {
        formatter : 'rownum',
        hozAlign  : 'center',
        resizable : false,
        frozen    : true,
        editor    : false
      },
      rowFormatter : function (row) {
        const rowData = row.getData();

        if (rowData.status === 'ok') {
          row.getElement().style.backgroundColor = '';
        } else {
          //invalid, incomplete
          row.getElement().style.backgroundColor = '#b99922';
        }
      },
      addRowPos      : 'bottom',
      columnDefaults : {
        headerSort     : false,
        headerHozAlign : 'center',
        resizable      : 'header'
      },
      columns : columns
    });

    this.table.on('cellEdited', (cell) => {
      const data = cell.getData();
      const invalidRow = this.getValidationUpdate(data);
      if (invalidRow !== undefined) {
        data.status = invalidRow.status;
        data.message = invalidRow.message;
        cell.getRow().reformat();
      }
    });

  }

  tableFunctions = {

    checkAttributesLength : (attributes) => {
      if (attributes.length > 1) {
        this.showAlert(`Only a single attribute is allowed here!<br>Delete ${attributes.length - 1} attribute(s)`);
        return false;
      } else {
        return true;
      }
    }
  };

}

class ComponentAttributeEditor extends FragmentAttributeEditor {

  constructor(db, options, cave, scene, attributeDefs, panel) {
    super(db, options, cave, scene, attributeDefs, panel);
    this.title = `Component  attribute editor: ${this.cave.name}`;
  }

  closeEditor() {
    this.setCaveComponentAttributes();
    super.closeEditor();
  }

  setCaveComponentAttributes() {
    this.cave.componentAttributes = this.getNewComponentAttributes();
  }

  getNewComponentAttributes() {
    return this.table
      .getData()
      .map(
        (r) =>
          new ComponentAttribute(
            r.id,
            new CaveComponent(r.start, r.termination, r.path, r.distance),
            r.attribute,
            r.format,
            r.color,
            r.visible
          )
      );
  }

  getValidationUpdate(r) {
    let newRow;
    const sa = new ComponentAttribute(
      r.id,
      new CaveComponent(r.start, r.termination, r.path, r.distance),
      r.attribute,
      r.format,
      r.color,
      r.visible
    );
    const emptyFields = sa.getEmptyFields();
    emptyFields.push(...sa.component.getEmptyFields().filter((f) => f !== 'path'));
    const oldStatus = r.status;
    let validationErrors = [];
    if (emptyFields.length > 0) {
      newRow = { ...r };
      newRow.status = 'incomplete';
      newRow.message = `Row has missing fields: ${emptyFields.join(',')}`;
    } else {
      const errors = sa.validate();
      if (errors.length > 0) {
        newRow = { ...r };
        newRow.status = 'invalid';
        newRow.message = `Row is invalid: <br>${errors.join('<br>')}`;
      }
    }
    if (['invalid', 'incomplete'].includes(oldStatus) && emptyFields.length === 0 && validationErrors.length === 0) {
      newRow = { ...r };
      newRow.status = 'ok';
      newRow.message = undefined;
    }

    return newRow;
  }

  getEmptyRow() {
    return {
      id          : randomAlphaNumbericString(6),
      visible     : false,
      color       : this.options.scene.sectionAttributes.color,
      start       : undefined,
      termination : undefined,
      path        : undefined,
      distance    : undefined,
      attribute   : undefined,
      format      : '${name}',
      status      : 'incomplete',
      message     : 'New row'
    };

  }

  getTableData() {

    const rows = this.cave.componentAttributes.map((r) => {
      return {
        id          : r.id,
        visible     : r.visible,
        color       : r.color,
        start       : r.component.start,
        termination : r.component.termination,
        path        : r.component.path, //hidden
        distance    : r.component.distance,
        attribute   : r.attribute,
        format      : r.format === undefined ? '${name}' : r.format,
        status      : 'ok',
        message     : 'No errors'
      };
    });

    const rowsToUpdate = this.getValidationUpdates(rows);
    rowsToUpdate.forEach((u) => (rows[rows.findIndex((r) => r.id === u.id)] = u));

    return rows;
  }

  getColumns() {

    const editor = (cell, onRendered, success) => {
      var editor = document.createElement('input');
      const data = cell.getData();

      editor.setAttribute('type', 'text');

      editor.style.padding = '0px';
      editor.style.width = '100%';
      editor.style.boxSizing = 'border-box';

      if (data !== undefined && data.termination !== undefined) {
        editor.value = data.termination.join(',');
      }

      //set focus on the select box when the editor is selected (timeout allows for editor to be added to DOM)
      onRendered(function () {
        editor.focus();
        editor.style.css = '100%';
      });

      //when the value has been set, trigger the cell to update
      function successFunc() {
        const value = editor.value;
        success(value.split(','));
      }

      editor.addEventListener('change', successFunc);
      editor.addEventListener('blur', successFunc);

      //return the editor element
      return editor;
    };

    return [
      {
        title        : 'Start',
        field        : 'start',
        editor       : 'list',
        editorParams : { values: [...this.cave.stations.keys()], autocomplete: true },
        validator    : ['required'],
        headerFilter : 'input',
        cellEdited   : this.functions.startOrTerminationEdited
      },
      {
        title            : 'Termination',
        field            : 'termination',
        editor           : editor,
        mutatorClipboard : (value) => {
          return value.split(',');
        },
        accessorClipboard : (value) => {
          return value.join(',');

        },
        formatterClipboard : (value) => {
          return value.join(',');

        },
        formatter    : 'array',
        validator    : ['required'],
        headerFilter : 'input',
        cellEdited   : this.functions.startOrTerminationEdited
      }
    ];

  }

  functions = {
    toggleVisibility : (ev, cell) => {
      const data = cell.getData();
      if (data.status !== 'ok') {
        this.showAlert('Component attribute has missing arguments or is invalid. <br>Cannot change visibility!', 4);
        return;
      }

      cell.setValue(!cell.getValue());

      if (cell.getValue() === true) {
        this.scene.showSectionAttribute(
          data.id,
          SectionHelper.getComponentSegments(
            new CaveComponent(data.start, data.termination, data.path, data.distance),
            this.cave.stations
          ),
          data.attribute,
          data.format,
          data.color,
          this.cave.name
        );
      } else {
        this.scene.disposeSectionAttribute(data.id);
      }
    },

    startOrTerminationEdited : (cell) => {
      const data = cell.getData();

      // new row
      if (data.start === undefined || data.termination === undefined) {
        return;
      }

      if (this.graph === undefined) {
        this.graph = SectionHelper.getGraph(this.cave);
      }
      const component = SectionHelper.getComponent(this.graph, data.start, data.termination);
      if (component !== undefined && component.distance !== 'Infinity') {
        data.start = component.start;
        data.termination = component.termination;
        data.path = component.path;
        data.distance = component.distance;
        cell.getRow().update(data);
        if (data.visible) {
          this.scene.disposeSectionAttribute(data.id);
          this.scene.showSectionAttribute(
            data.id,
            SectionHelper.getComponentSegments(component, this.cave.stations),
            data.attribute,
            data.format,
            data.color,
            this.cave.name
          );
        }
      } else {
        this.showAlert(
          `Unable to traverse graph from ${data.from}.<br>Restoring previous value (${cell.getOldValue()}).`,
          7,
          () => {
            cell.setValue(cell.getOldValue());
          }
        );

      }

    }
  };

}

class SectionAttributeEditor extends FragmentAttributeEditor {

  constructor(db, options, cave, scene, attributeDefs, panel) {
    super(db, options, cave, scene, attributeDefs, panel);
    this.title = `Section attribute editor: ${this.cave.name}`;

  }

  closeEditor() {
    this.setCaveSectionAttributes();
    super.closeEditor();
  }

  setCaveSectionAttributes() {
    this.cave.sectionAttributes = this.getNewSectionAttributes();
  }

  getNewSectionAttributes() {
    return this.table
      .getData()
      .map(
        (r) =>
          new SectionAttribute(
            r.id,
            new CaveSection(r.from, r.to, r.path, r.distance),
            r.attribute,
            r.format,
            r.color,
            r.visible
          )
      );
  }

  getValidationUpdate(r) {
    let newRow;
    const sa = new SectionAttribute(
      r.id,
      new CaveSection(r.from, r.to, r.path, r.distance),
      r.attribute,
      r.format,
      r.color,
      r.visible
    );
    const emptyFields = sa.getEmptyFields();
    emptyFields.push(...sa.section.getEmptyFields().filter((f) => f !== 'path'));
    const oldStatus = r.status;
    let validationErrors = [];
    if (emptyFields.length > 0) {
      newRow = { ...r };
      newRow.status = 'incomplete';
      newRow.message = `Row has missing fields: ${emptyFields.join(',')}`;
    } else {
      const errors = sa.validate();
      if (errors.length > 0) {
        newRow = { ...r };
        newRow.status = 'invalid';
        newRow.message = `Row is invalid: <br>${errors.join('<br>')}`;
      }
    }
    if (['invalid', 'incomplete'].includes(oldStatus) && emptyFields.length === 0 && validationErrors.length === 0) {
      newRow = { ...r };
      newRow.status = 'ok';
      newRow.message = undefined;
    }

    return newRow;
  }

  getEmptyRow() {
    return {
      id        : randomAlphaNumbericString(6),
      visible   : false,
      color     : this.options.scene.sectionAttributes.color,
      from      : undefined,
      to        : undefined,
      path      : undefined,
      distance  : undefined,
      attribute : undefined,
      format    : '${name}',
      status    : 'incomplete',
      message   : 'New row'
    };

  }

  getTableData() {

    const rows = this.cave.sectionAttributes.map((r) => {
      return {
        id        : r.id,
        visible   : r.visible,
        color     : r.color,
        from      : r.section.from,
        to        : r.section.to,
        path      : r.section.path, //hidden
        distance  : r.section.distance,
        attribute : r.attribute,
        format    : r.format === undefined ? '${name}' : r.format,
        status    : 'ok',
        message   : 'No errors'
      };
    });

    const rowsToUpdate = this.getValidationUpdates(rows);
    rowsToUpdate.forEach((u) => (rows[rows.findIndex((r) => r.id === u.id)] = u));

    return rows;
  }

  getColumns() {
    return [
      {
        title        : 'From',
        field        : 'from',
        editor       : 'list',
        editorParams : { values: [...this.cave.stations.keys()], autocomplete: true },
        validator    : ['required'],
        headerFilter : 'input',
        cellEdited   : this.functions.fromOrToEdited
      },
      {
        title        : 'To',
        field        : 'to',
        editor       : 'list',
        editorParams : { values: [...this.cave.stations.keys()], autocomplete: true },
        validator    : ['required'],
        headerFilter : 'input',
        cellEdited   : this.functions.fromOrToEdited
      }
    ];

  }

  functions = {

    toggleVisibility : (ev, cell) => {
      const data = cell.getData();
      if (data.status !== 'ok') {
        this.showAlert('Section attribute has missing arguments or is invalid. <br>Cannot change visibility!', 4);
        return;
      }

      cell.setValue(!cell.getValue());

      if (cell.getValue() === true) {
        this.scene.showSectionAttribute(
          data.id,
          SectionHelper.getSectionSegments(
            new CaveSection(data.from, data.to, data.path, data.distance),
            this.cave.stations
          ),
          data.attribute,
          data.format,
          data.color,
          this.cave.name
        );
      } else {
        this.scene.disposeSectionAttribute(data.id);
      }
    },
    fromOrToEdited : (cell) => {
      const data = cell.getData();

      // new row
      if (data.from === undefined || data.to === undefined) {
        return;
      }

      if (data.from !== data.to) {
        if (this.graph === undefined) {
          this.graph = SectionHelper.getGraph(this.cave);
        }
        const section = SectionHelper.getSection(this.graph, data.from, data.to);
        if (section !== undefined && section.distance !== 'Infinity') {
          data.from = section.from;
          data.to = section.to;
          data.path = section.path;
          data.distance = section.distance;
          cell.getRow().update(data);
          if (data.visible) {
            this.scene.disposeSectionAttribute(data.id);
            this.scene.showSectionAttribute(
              data.id,
              SectionHelper.getSectionSegments(section, this.cave.stations),
              data.attribute,
              data.format,
              data.color,
              this.cave.name
            );
          }
        } else {
          this.showAlert(
            `Unable to find path between ${data.from} -> ${data.to}.<br>Restoring previous value (${cell.getOldValue()}).`,
            7,
            () => {
              cell.setValue(cell.getOldValue());
            }
          );

        }
      } else {
        this.showAlert(
          `From and to cannot be the same (${data.from})!<br>Restoring previous value (${cell.getOldValue()}).`,
          6,
          () => {
            cell.setValue(cell.getOldValue());
          }
        );

      }
    }
  };

}

class SurveyEditor extends Editor {

  constructor(cave, survey, scene, attributeDefs, panel) {
    super(panel, scene, cave, attributeDefs);
    this.survey = survey;
    this.table = undefined;
    this.surveyModified = false;
    document.addEventListener('surveyRecalculated', (e) => this.onSurveyRecalculated(e));
  }

  #emitSurveyChanged() {
    const event = new CustomEvent('surveyChanged', {
      detail : {
        cave   : this.cave,
        survey : this.survey
      }
    });
    document.dispatchEvent(event);
  }

  #emitAttribuesChanged() {
    const event = new CustomEvent('attributesChanged', {
      detail : {
        cave   : this.cave,
        survey : this.survey
      }
    });
    document.dispatchEvent(event);
  }

  onSurveyRecalculated(e) {
    const cave = e.detail.cave;
    const survey = e.detail.survey;

    if (this.table !== undefined && this.cave.name === cave.name && this.survey.name === survey.name) {
      const tableRows = this.#getTableData(this.survey, this.cave.stations);
      const invalidShotIdsArray = tableRows
        .filter((r) => ['invalid', 'invalidShot', 'incomplete'].includes(r.status))
        .map((x) => x.id);
      const invalidShotIds = new Set(invalidShotIdsArray);
      if (invalidShotIds.symmetricDifference(this.survey.invalidShotIds).size > 0) {
        throw new Error(
          `Invalid shot ids do not match for survey '${[...this.survey.invalidShotIds].join(',')}' and rows '${invalidShotIdsArray.join(',')}'`
        );
      }
      if (invalidShotIds.size > 0 || survey.orphanShotIds.size > 0) {
        let invalidMessage = '';
        if (invalidShotIds.size > 0) {
          invalidMessage = `${invalidShotIds.size} row(s) are invalid: ${invalidShotIdsArray.slice(0, 15).join(',')}<br>`;
        }
        let orphanMessage = '';
        if (survey.orphanShotIds.size > 0) {
          const first15Ids = [...survey.orphanShotIds.values()].slice(0, 15);
          orphanMessage = `${survey.orphanShotIds.size} row(s) are orphan: ${first15Ids.join(',')}<br>`;
        }
        this.showAlert(`${invalidMessage}${orphanMessage}Check warning icon for details.`, 7);
      }

      this.table.replaceData(tableRows);
    }
  }

  #getSurveyAttributesFromTable() {
    return this.table.getData()
      .filter((r) => r.attributes !== undefined && r.attributes.length > 0)
      .flatMap((row) => row.attributes.map((a) => new StationAttribute(row.to, a)));
  }

  updateShots() {
    this.survey.updateShots(this.getNewShots());
  }

  getNewShots() {
    return this.table.getData().map((r) => new Shot(r.id, r.type, r.from, r.to, r.length, r.azimuth, r.clino));
  }

  validateSurvey(showAlert = true) {
    const data = this.table.getData();
    const rowsToUpdated = this.getValidationUpdates(data);
    if (rowsToUpdated.length > 0) {
      this.table.updateData(rowsToUpdated);
      const badRowIds = rowsToUpdated
        .filter((r) => ['invalid', 'invalidAttributes', 'invalidShot', 'incomplete'].includes(r.status))
        .map((r) => r.id + 1);
      if (badRowIds.length > 0 && showAlert) {
        this.showAlert(
          `${badRowIds.length} row(s) with the following ids are invalid: ${badRowIds.slice(0, 15)}<br>Click on the warning icon for details.`,
          4
        );
      }
    }
  }

  getValidationUpdates(data) {
    const rowsToUpdated = [];

    data.forEach((r) => {
      const shot = new Shot(r.id, r.type, r.from, r.to, r.length, r.azimuth, r.clino);
      const emptyFields = shot.getEmptyFields();
      const oldStatus = r.status;
      let validationErrors = [];
      if (emptyFields.length > 0) {
        const newRow = { ...r };
        newRow.status = 'incomplete';
        newRow.message = `Row has missing fields: ${emptyFields.join(',')}`;
        rowsToUpdated.push(newRow);
      } else {
        const shotErrors = shot.validate();
        const attributeErrors = this.getAttributeErrors(r);
        validationErrors.push(...shotErrors);
        validationErrors.push(...attributeErrors);
        if (validationErrors.length > 0) {
          let status;
          if (attributeErrors.length > 0 && shotErrors.length === 0) {
            status = 'invalidAttributes';
          } else if (attributeErrors.length === 0 && shotErrors.length > 0) {
            status = 'invalidShot';
          } else {
            status = 'invalid'; // both shot and attributes are invalid
          }

          const newRow = { ...r };
          newRow.status = status;
          newRow.message = `Row is invalid: <br>${validationErrors.join('<br>')}`;
          rowsToUpdated.push(newRow);
        }
      }
      if (
        ['invalid', 'invalidAttributes', 'invalidShot', 'incomplete'].includes(oldStatus) &&
        emptyFields.length === 0 &&
        validationErrors.length === 0
      ) {
        const newRow = { ...r };
        newRow.status = 'ok';
        newRow.message = undefined;
        rowsToUpdated.push(newRow);
      }

    });
    return rowsToUpdated;
  }

  updateSurvey() {

    if (this.attributesModified || this.surveyModified) {

      const attributes = this.#getSurveyAttributesFromTable();
      this.survey.attributes = attributes;

      if (this.attributesModified && !this.surveyModified) {
        this.#emitAttribuesChanged();
        this.attributesModified = false;
      } else if (this.surveyModified) {
        this.updateShots();
        this.#emitSurveyChanged();
        this.surveyModified = false;
      }
    }
  }

  closeEditor() {
    this.updateSurvey();
    super.closeEditor();
  }

  #getTableData(survey, stations) {
    const rows = survey.shots.map((sh) => {
      const stationAttributes = survey.attributes
        .filter((a) => a.name === sh.to)
        .map((a) => a.attribute);
      const toStation = stations.get(survey.getToStationName(sh));

      const rowToBe = {
        id         : sh.id,
        from       : sh.from,
        to         : sh.to,
        length     : sh.length,
        azimuth    : sh.azimuth,
        clino      : sh.clino,
        type       : sh.type,
        status     : 'ok',
        message    : 'No errors',
        attributes : stationAttributes,
        x          : toStation?.position?.x,
        y          : toStation?.position?.y,
        z          : toStation?.position?.z
      };

      return rowToBe;
    });
    survey.orphanShotIds.forEach((id) => {
      const row = rows[rows.findIndex((r) => r.id === id)];
      row.status = 'orphan';
      row.message = 'Row is orphan';
    });
    const rowsToUpdate = this.getValidationUpdates(rows);
    rowsToUpdate.forEach((u) => (rows[rows.findIndex((r) => r.id === u.id)] = u));

    return rows;
  }

  getEmptyRow() {
    const id = Math.max(...this.table.getData().map((r) => r.id));

    return {
      id         : id + 1,
      from       : undefined,
      to         : undefined,
      length     : undefined,
      azimuth    : undefined,
      clino      : undefined,
      type       : undefined,
      status     : 'incomplete',
      message    : 'Shot is newly created',
      attributes : [],
      x          : undefined,
      y          : undefined,
      z          : undefined
    };

  }

  setupTable() {

    this.panel.innerHTML = '';
    makeMoveableDraggable(
      this.panel,
      `Survey editor: ${this.survey.name}`,
      () => this.closeEditor(),
      (_newWidth, newHeight) => this.table.setHeight(newHeight - 100),
      () => {
        this.table.redraw();
      }
    );

    [
      { id: 'centerlines', text: 'Hide splays', click: () => this.table.addFilter(showCenter) },
      { id: 'sumCenterLines', text: 'Show orphans', click: () => this.table.addFilter(showOrphans) },
      { id: 'hideorphan', text: 'Hide orphans', click: () => this.table.addFilter(hideOrphans) },
      { id: 'clear-filter', text: 'Clear filters', click: () => this.table.clearFilter() },
      { break: true },
      { id: 'validate-shots', text: 'Validate shots', click: () => this.validateSurvey() },
      { id: 'update-survey', text: 'Update survey', click: () => this.updateSurvey() },
      { id: 'add-row', text: 'Add row to bottom', click: () => this.table.addRow(this.getEmptyRow()) },
      {
        id    : 'delete-row',
        text  : 'Delete active rows',
        click : () => {
          var ranges = this.table.getRanges();
          ranges.forEach((r) => {
            const rows = r.getRows();
            rows.forEach((r) => r.delete());
            r.remove();
          });

        }
      }

    ].forEach((b) => {
      if (b.break === true) {
        this.panel.appendChild(document.createElement('br'));
      } else {
        const button = U.node`<button id="${b.id}">${b.text}</button>`;
        button.onclick = b.click;
        this.panel.appendChild(button);
      }
    });

    this.panel.appendChild(U.node`<div id="surveydata"></div>`);

    var isFloatNumber = function (_cell, value) {
      return U.isFloatStr(value);
    };

    const customValidator = {
      type : isFloatNumber
    };

    const countLines = function (_values, data) {
      return data.length;
    };

    const sumCenterLines = function (_values, data) {
      var sumLength = 0;
      data.forEach((value) => {
        if (value !== undefined && value.length !== undefined) {
          sumLength += value.type === 'center' ? U.parseMyFloat(value.length) : 0;
        }
      });

      return sumLength.toFixed(2);
    };

    const typeIcon = (cell) => {
      const data = cell.getData();
      if (data.type === 'center') {
        return '<div class="center-row"></div>';
      } else if (data.type === 'splay') {
        return '<div class="splay-row"></div>';
      }
    };

    const typeEdited = (cell) => {
      cell.getRow().reformat();
    };

    function showCenter(data) {
      return data.type === 'center';
    }

    function hideOrphans(data) {
      return data.status !== 'orphan';
    }

    function showOrphans(data) {
      return data.status === 'orphan';
    }

    this.table = new Tabulator('#surveydata', {
      height                    : 300,
      data                      : this.#getTableData(this.survey, this.cave.stations),
      layout                    : 'fitDataStretch',
      validationMode            : 'highlight',
      //enable range selection
      selectableRange           : 1,
      selectableRangeColumns    : true,
      selectableRangeRows       : true,
      selectableRangeClearCells : true,

      //change edit trigger mode to make cell navigation smoother
      editTriggerEvent : 'dblclick',

      //configure clipboard to allow copy and paste of range format data
      clipboard           : true,
      clipboardCopyStyled : false,
      clipboardCopyConfig : {
        rowHeaders    : false,
        columnHeaders : false,
        columnCalcs   : false,
        formatCells   : false
      },
      clipboardCopyRowRange : 'range',
      clipboardPasteParser  : 'range',
      clipboardPasteAction  : 'range',

      rowContextMenu : this.baseTableFunctions.getContextMenu(),
      rowHeader      : {
        formatter : 'rownum',
        hozAlign  : 'center',
        resizable : false,
        frozen    : true,
        editor    : false
      },
      rowFormatter : function (row) {
        const rowData = row.getData();

        if (rowData.status === 'orphan') {
          row.getElement().style.backgroundColor = '#7d4928';
        } else if (rowData.status === 'ok') {
          if (rowData.type === 'splay') {
            row.getElement().style.backgroundColor = '#012109';
          } else {
            row.getElement().style.backgroundColor = '';
          }
        } else {
          //invalid, incomplete
          row.getElement().style.backgroundColor = '#b99922';
        }
      },
      columnDefaults : {
        headerSort     : false,
        headerHozAlign : 'center',
        resizable      : 'header'
      },
      columns : [
        {
          width             : 25,
          title             : '',
          field             : 'status',
          editor            : false,
          accessorClipboard : (value) => value,
          formatter         : this.baseTableFunctions.statusIcon,
          clickPopup        : function (x, cell) {
            const message = cell.getData().message;
            return message === undefined ? 'No errors' : message;
          },
          validator  : ['required'],
          bottomCalc : this.baseTableFunctions.countBadRows
        },
        {
          width        : 25,
          title        : '',
          field        : 'type',
          editor       : 'list',
          editorParams : { values: ['center', 'splay'] },
          formatter    : typeIcon,
          cellEdited   : typeEdited,
          validator    : ['required']
        },
        {
          title        : 'From',
          field        : 'from',
          editor       : true,
          validator    : ['required'],
          headerFilter : 'input',
          bottomCalc   : countLines
        },
        {
          title        : 'To',
          field        : 'to',
          editor       : true,
          validator    : ['required'],
          headerFilter : 'input'
        },
        {
          title      : 'Length',
          field      : 'length',
          editor     : true,
          accessor   : this.baseTableFunctions.floatAccessor,
          validator  : ['required', 'min:0', customValidator],
          bottomCalc : sumCenterLines
        },
        {
          title     : 'Azimuth',
          field     : 'azimuth',
          editor    : true,
          accessor  : this.baseTableFunctions.floatAccessor,
          validator : ['required', 'min:-360', 'max:360', customValidator]
        },
        {
          title     : 'Clino',
          field     : 'clino',
          editor    : true,
          accessor  : this.baseTableFunctions.floatAccessor,
          validator : ['required', 'min:-90', 'max:90', customValidator]
        },
        {
          title            : 'X',
          field            : 'x',
          mutatorClipboard : this.baseTableFunctions.floatAccessor,
          formatter        : this.baseTableFunctions.floatFormatter(''),
          editor           : false
        },
        {
          title            : 'Y',
          field            : 'y',
          editor           : false,
          mutatorClipboard : this.baseTableFunctions.floatAccessor,
          formatter        : this.baseTableFunctions.floatFormatter('')
        },
        {
          title            : 'Z',
          field            : 'z',
          editor           : false,
          mutatorClipboard : this.baseTableFunctions.floatAccessor,
          formatter        : this.baseTableFunctions.floatFormatter('')
        },
        {
          title              : 'Attributes',
          field              : 'attributes',
          headerFilterFunc   : this.baseTableFunctions.attributeHeaderFilter,
          headerFilter       : 'input',
          formatter          : (cell) => this.baseTableFunctions.atrributesFormatter(cell, (cv) => cv.attributes),
          accessorClipboard  : (value) => this.baseTableFunctions.attributesToClipboard(value, (v) => v),
          mutatorClipboard   : (value) => this.baseTableFunctions.attributesFromClipboard(value, (attrs) => attrs),
          formatterClipboard : (cell) => this.baseTableFunctions.clipboardFormatter(cell, (v) => v.attributes),
          editor             : (cell, onRendered, success) =>
            this.attributesEditor(
              cell,
              onRendered,
              success,
              (cv) => cv.attributes,
              (attrs) => attrs,
              () => true
            )
        }

      ]
    });

    this.table.on('dataChanged', () => {
      console.log(' data changed ');
      this.surveyModified = true;
    });

  }
}

export { SurveyEditor, CaveEditor, SectionAttributeEditor, ComponentAttributeEditor };
