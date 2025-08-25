import { SectionAttribute, ComponentAttribute, StationAttribute } from '../../model.js';
import { CaveSection, CaveComponent } from '../../model/cave.js';
import { SectionHelper } from '../../section.js';
import { randomAlphaNumbericString } from '../../utils/utils.js';
import { makeFloatingPanel } from '../popups.js';
import { i18n } from '../../i18n/i18n.js';
import { IconBar } from './iconbar.js';
import { Editor } from './base.js';
import * as U from '../../utils/utils.js';

class BaseAttributeEditor extends Editor {

  constructor(db, options, cave, scene, attributeDefs, panel) {
    super(panel, scene, cave, attributeDefs);
    this.db = db;
    this.options = options;
    this.attributeDefs = attributeDefs;
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
        this.showAlert(
          `${i18n.t('ui.editors.common.error.invalidRows', { nrRows: badRows.length })}<br>${i18n.t('ui.editors.common.error.checkWarningIcon')}`
        );
      }
    }
  }

  setupPanel() {
    this.buildPanel();
    document.addEventListener('languageChanged', () => this.buildPanel());
  }

  buildPanel() {
    const contentElmnt = makeFloatingPanel(
      this.panel,
      this.title,
      true,
      true,
      this.options.ui.editor.attributes,
      () => {
        document.removeEventListener('languageChanged', () => this.setupPanel());
        this.closeEditor();
      },
      (_newWidth, newHeight) => {
        const h = this.panel.offsetHeight - 100;
        this.table.setHeight(h);
      },
      () => this.table.redraw()
    );
    this.setupButtons(contentElmnt);
    this.setupTable(contentElmnt);
  }

  setupCommonButtons(contentElmnt) {
    // Create iconbar with common buttons
    this.iconBar = new IconBar(contentElmnt);

    // Add common buttons (undo, redo, add row, delete row)
    const commonButtons = IconBar.getCommonButtons(() => this.table, {
      getEmptyRow : () => this.getEmptyRow()
    });
    commonButtons.forEach((button) => this.iconBar.addButton(button));

    // Add export button
    const exportButton = IconBar.getExportButton(() => this.table, this.cave.name + ' - attributes.csv');
    exportButton.forEach((button) => this.iconBar.addButton(button));

  }

  setupTable(contentElmnt) {

    const tableDiv = document.createElement('div');
    tableDiv.setAttribute('id', 'sectionattributes');
    contentElmnt.appendChild(tableDiv);

    const columns = this.getColumns();

    // eslint-disable-next-line no-undef
    this.table = new Tabulator('#sectionattributes', {
      history                   : true, //enable undo and redo
      height                    : this.options.ui.editor.attributes.height - 36 - 48, // header + iconbar
      autoResize                : false,
      data                      : this.getTableData(),
      layout                    : 'fitColumns',
      validationMode            : 'highlight',
      //enable range selection
      selectableRange           : 1,
      selectableRangeColumns    : true,
      selectableRangeRows       : true,
      selectableRangeClearCells : true,

      movableRows : true,

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

    // Prevent range selection keyboard events when editing cells
    let isEditing = false;

    this.table.on('cellEditing', () => {
      isEditing = true;
    });

    this.table.on('cellEdited', () => {
      isEditing = false;
    });

    this.table.on('cellEditCancelled', () => {
      isEditing = false;
    });

    // Add event listener to prevent arrow key events from reaching range selection when editing
    this.table.element.addEventListener(
      'keydown',
      (e) => {
        if (isEditing && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
          // Stop the event from reaching Tabulator's keyboard binding system
          e.stopImmediatePropagation();
        }
      },
      true
    ); // Use capture phase to intercept before Tabulator

  }

  getAttributeEditorDiv(a, attributes, index, i18n) {
    const attributeNode = U.node`<div class="attribute-editor" id="attribute-editor-${index}"></div>`;
    //const warning = U.node`<div class="warning" id="attribute-editor-${index}-warning">hel</div>`;
    //attributeNode.appendChild(warning);
    //warning.style.display = 'none'; TODO: somehow show the warning div
    const name = U.node`<span>${i18n.t(`attributes.names.${a.name}`)}(</span>`;
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
      const errors = a.validateFieldValue(paramName, value, true, true); // validate as string, skip empty check, no localization
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
      const param = U.node`<input placeholder="${i18n.t(`attributes.params.${paramName}`)}" type="${inputType}" ${list} class="${classes.join(' ')}" id="${paramName}-${index}" value="${value}">`;
      param.onchange = (e) => {
        this.attributesModified = true;
        const newValue = e.target.value === '' ? undefined : e.target.value;
        const errors = a.validateFieldValue(paramName, newValue, true, false, i18n);
        if (errors.length > 0) {
          param.classList.remove('requiredInput');
          param.classList.add('invalidInput');
          a[paramName] = newValue; // set the invalid value
          this.showAlert(
            i18n.t('common.invalid') + ` '${i18n.t(`attributes.params.${paramName}`)}': ${errors.join('<br>')}`
          );
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

  attributesEditor(cell, onRendered, success, extractor, mutator, extraValidators, i18n) {
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
      const attributeNode = this.getAttributeEditorDiv(a, attributes, index, i18n);
      panel.appendChild(attributeNode);
      index += 1;
    });

    const aNamesWithIds = this.attributeDefs.getLocalizedAttributeNamesWitdId(i18n);
    const options = aNamesWithIds
      .map((n) => `<option id="${n.id}" originalName="${n.originalName}" value="${n.name}">`)
      .join('');

    const add = U.node`<div>
       <label>${i18n.t('ui.editors.attributes.newAttribute')}: </label>
       <input placeholder="${i18n.t('ui.editors.attributes.placeHolderName')}" type="search" class="longInput requiredInput" list="attributeNames" id="new-attribute-value">
       <datalist id="attributeNames">${options}</datalist>
       <span class="add-row"></span>
    </div>`;
    const addButton = add.querySelector('.add-row');
    addButton.onclick = () => {
      const input = add.querySelector('#new-attribute-value');
      const selectedOption = add.querySelector(`#attributeNames option[value="${input.value}"]`);
      const originalName = selectedOption.getAttribute('originalName');
      const aName = input.value;
      if (aNamesWithIds.find((a) => a.name === aName)) {
        const newAttribute = this.attributeDefs.createByName(originalName)();
        const attributeNode = this.getAttributeEditorDiv(newAttribute, attributes, index, i18n);
        panel.insertBefore(attributeNode, add);
        attributes.push(newAttribute);
        input.value = '';
      } else if (aName === '') {
        this.showAlert(i18n.t('ui.editors.attributes.errors.noNameSelected'));
      } else {
        this.showAlert(i18n.t('ui.editors.attributes.errors.noAttributeWithName', { name: aName }));
      }
    };

    panel.appendChild(add);

    return panel;
  }

  getAttributeErrors(row, i18n) {
    const errors = [];

    row.attributes.forEach((a) => {
      const paramErrors = a.validate();
      paramErrors.forEach((error, paramName) => {
        errors.push(i18n.t('ui.editors.attributes.errors.invalidAttribute', { attribute: a.name, paramName, error }));
      });
    });

    return errors;
  }

  tableFunctions = {

    checkAttributesLength : (attributes) => {
      if (attributes.length > 1) {
        this.showAlert(
          i18n.t('ui.editors.attributes.errors.onlyOneAttributeAllowed', { nrAttributes: attributes.length - 1 })
        );
        return false;
      } else {
        return true;
      }
    }
  };

}

class FragmentAttributeEditor extends BaseAttributeEditor {

  constructor(db, options, cave, scene, attributeDefs, panel) {
    super(db, options, cave, scene, attributeDefs, panel);
  }

  getColumns() {
    return [
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
        title             : i18n.t('ui.editors.attributes.columns.color'),
        field             : 'color',
        formatter         : this.baseTableFunctions.colorIcon,
        accessorClipboard : (color) => color,
        mutatorClipboard  : (v) => v,
        width             : 45,
        cellClick         : (_e, cell) => this.baseTableFunctions.changeColor(_e, cell)
      },
      {
        title            : i18n.t('ui.editors.attributes.columns.distance'),
        field            : 'distance',
        editor           : false,
        mutatorClipboard : this.baseTableFunctions.floatAccessor,
        formatter        : this.baseTableFunctions.floatFormatter('0')
      },
      {
        title            : i18n.t('ui.editors.attributes.columns.attribute'),
        field            : 'attribute',
        headerFilterFunc : this.baseTableFunctions.attributeHeaderFilter,
        headerFilter     : 'input',
        formatter        : (cell) =>
          this.baseTableFunctions.atrributesFormatter(
            cell,
            (cv) => (cv.attribute === undefined ? [] : [cv.attribute]),
            i18n
          ),
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
            this.tableFunctions.checkAttributesLength,
            i18n
          )
      },
      {
        title  : i18n.t('ui.editors.attributes.columns.format'),
        field  : 'format',
        editor : 'input'
      }
    ];
  }
}
class ComponentAttributeEditor extends FragmentAttributeEditor {

  constructor(db, options, cave, scene, attributeDefs, panel) {
    super(db, options, cave, scene, attributeDefs, panel);
    this.title = i18n.t('ui.editors.componentAttributes.title', { name: this.cave.name });

    document.addEventListener('languageChanged', () => {
      this.title = i18n.t('ui.editors.componentAttributes.title', { name: this.cave.name });
    });
  }

  closeEditor() {
    this.setCaveComponentAttributes();
    super.closeEditor();
  }

  setupButtons(contentElmnt) {
    super.setupCommonButtons(contentElmnt); // sets this.iconbar
    const specificButtons = IconBar.getAttributesButtons(
      () => this.validateRows(),
      () => this.setCaveComponentAttributes()
    );
    specificButtons.forEach((button) => this.iconBar.addButton(button));
  }

  setCaveComponentAttributes() {
    const newAttributes = this.getNewComponentAttributes();
    const oldAttributes = this.cave.attributes.componentAttributes;
    const isEqual =
      newAttributes.length === oldAttributes.length &&
      newAttributes.every((element, index) => element.isEqual(oldAttributes[index]));

    if (!isEqual) {
      this.cave.attributes.componentAttributes = newAttributes;
      this.#emitComponentAttributesChanged();
    }
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
      newRow.message = i18n.t('ui.editors.attributes.status.incomplete', { fields: emptyFields.join(',') });
    } else {
      const errors = sa.validate(i18n);
      if (errors.length > 0) {
        validationErrors.push(...errors);
        newRow = { ...r };
        newRow.status = 'invalid';
        newRow.message = i18n.t('ui.editors.attributes.status.invalid', { errors: errors.join('<br>') });
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
      message     : i18n.t('ui.editors.attributes.status.new')
    };

  }

  getTableData() {

    const rows = this.cave.attributes.componentAttributes.map((r) => {
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
        message     : i18n.t('ui.editors.attributes.status.ok')
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
        success(value.split(',').filter((f) => f.length > 0));
      }

      editor.addEventListener('change', successFunc);
      editor.addEventListener('blur', successFunc);

      //return the editor element
      return editor;
    };

    const specificColumns = [
      {
        title        : i18n.t('ui.editors.attributes.columns.start'),
        field        : 'start',
        editor       : 'list',
        editorParams : { values: [...this.cave.stations.keys()], autocomplete: true },
        validator    : ['required'],
        headerFilter : 'input',
        cellEdited   : this.functions.startOrTerminationEdited
      },
      {
        title            : i18n.t('ui.editors.attributes.columns.termination'),
        field            : 'termination',
        editor           : editor,
        mutatorClipboard : (value) => {
          return value.split(',').filter((f) => f.length > 0);
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

    const baseColumns = [...super.getColumns()];
    baseColumns.splice(3, 0, ...specificColumns);
    return baseColumns;

  }

  functions = {
    toggleVisibility : (ev, cell) => {
      const data = cell.getData();
      if (data.status !== 'ok' && !data.visible) {
        this.showAlert(i18n.t('ui.editors.componentAttributes.errors.componentAttributeMissingArguments'));
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
          i18n.t('ui.editors.componentAttributes.errors.unableToTraverseGraph', {
            from     : data.from,
            oldValue : cell.getOldValue()
          }),
          () => {
            cell.setValue(cell.getOldValue());
          }
        );

      }

    }
  };

  #emitComponentAttributesChanged() {
    const event = new CustomEvent('componentAttributesChanged', {
      detail : {
        cave : this.cave
      }
    });
    document.dispatchEvent(event);
  }

}

class SectionAttributeEditor extends FragmentAttributeEditor {

  constructor(db, options, cave, scene, attributeDefs, panel) {
    super(db, options, cave, scene, attributeDefs, panel);
    this.title = i18n.t('ui.editors.sectionAttributes.title', { name: this.cave.name });

    document.addEventListener('languageChanged', () => {
      this.title = i18n.t('ui.editors.sectionAttributes.title', { name: this.cave.name });
    });

  }

  closeEditor() {
    this.setCaveSectionAttributes();
    super.closeEditor();
  }

  setupButtons(contentElmnt) {
    super.setupCommonButtons(contentElmnt); // sets this.iconbar
    const specificButtons = IconBar.getAttributesButtons(
      () => this.validateRows(),
      () => this.setCaveSectionAttributes()
    );
    specificButtons.forEach((button) => this.iconBar.addButton(button));
  }

  setCaveSectionAttributes() {
    const newAttributes = this.getNewSectionAttributes();
    const oldAttributes = this.cave.attributes.sectionAttributes;
    const isEqual =
      newAttributes.length === oldAttributes.length &&
      newAttributes.every((element, index) => element.isEqual(oldAttributes[index]));

    if (!isEqual) {
      this.cave.attributes.sectionAttributes = newAttributes;
      this.#emitSectionAttributesChanged();
    }
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
      newRow.message = i18n.t('ui.editors.attributes.status.incomplete', { fields: emptyFields.join(',') });
    } else {
      const errors = sa.validate(i18n);
      if (errors.length > 0) {
        validationErrors.push(...errors);
        newRow = { ...r };
        newRow.status = 'invalid';
        newRow.message = i18n.t('ui.editors.attributes.status.invalid', { errors: errors.join('<br>') });
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
      message   : i18n.t('ui.editors.attributes.status.new')
    };

  }

  getTableData() {

    const rows = this.cave.attributes.sectionAttributes.map((r) => {
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
        message   : i18n.t('ui.editors.attributes.status.ok')
      };
    });

    const rowsToUpdate = this.getValidationUpdates(rows);
    rowsToUpdate.forEach((u) => (rows[rows.findIndex((r) => r.id === u.id)] = u));

    return rows;
  }

  getColumns() {
    const specificColumns = [
      {
        title        : i18n.t('common.from'),
        field        : 'from',
        editor       : 'list',
        editorParams : { values: [...this.cave.stations.keys()], autocomplete: true },
        validator    : ['required'],
        headerFilter : 'input',
        cellEdited   : this.functions.fromOrToEdited
      },
      {
        title        : i18n.t('common.to'),
        field        : 'to',
        editor       : 'list',
        editorParams : { values: [...this.cave.stations.keys()], autocomplete: true },
        validator    : ['required'],
        headerFilter : 'input',
        cellEdited   : this.functions.fromOrToEdited
      }
    ];

    const baseColumns = [...super.getColumns()];
    baseColumns.splice(3, 0, ...specificColumns);
    return baseColumns;
  }

  functions = {

    toggleVisibility : (ev, cell) => {
      const data = cell.getData();
      if (data.status !== 'ok' && !data.visible) {
        this.showAlert(i18n.t('ui.editors.sectionAttributes.errors.sectionAttributeMissingArguments'));
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
            i18n.t('ui.editors.sectionAttributes.errors.unableToFindPath', {
              from     : data.from,
              to       : data.to,
              oldValue : cell.getOldValue()
            }),
            () => {
              cell.setValue(cell.getOldValue());
            }
          );

        }
      }
    }
  };

  #emitSectionAttributesChanged() {
    const event = new CustomEvent('sectionAttributesChanged', {
      detail : {
        cave : this.cave
      }
    });
    document.dispatchEvent(event);
  }

}

class StationAttributeEditor extends BaseAttributeEditor {

  constructor(db, options, cave, scene, attributeDefs, panel) {
    super(db, options, cave, scene, attributeDefs, panel);
    this.title = i18n.t('ui.editors.stationAttributes.title', { name: this.cave.name });

    document.addEventListener('languageChanged', () => {
      this.title = i18n.t('ui.editors.stationAttributes.title', { name: this.cave.name });
    });
  }

  closeEditor() {
    this.setCaveStationAttributes();
    super.closeEditor();
  }

  setupButtons(contentElmnt) {
    super.setupCommonButtons(contentElmnt); // sets this.iconbar
    const specificButtons = IconBar.getAttributesButtons(
      () => this.validateRows(),
      () => this.setCaveStationAttributes()
    );
    specificButtons.forEach((button) => this.iconBar.addButton(button));
  }

  getColumns() {
    return [
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
        mutatorClipboard : (str) => (str === 'true' ? true : false)
      },
      {
        title        : i18n.t('ui.editors.stationAttributes.columns.station'),
        field        : 'station',
        editor       : 'list',
        editorParams : { values: [...this.cave.stations.keys()], autocomplete: true },
        validator    : ['required'],
        headerFilter : 'input',
        cellEdited   : this.functions.stationEdited
      },
      {
        title        : i18n.t('ui.editors.stationAttributes.columns.survey'),
        field        : 'survey',
        editor       : false,
        headerFilter : 'input'
      },
      {
        title            : i18n.t('ui.editors.attributes.columns.attribute'),
        field            : 'attribute',
        headerFilterFunc : this.baseTableFunctions.attributeHeaderFilter,
        headerFilter     : 'input',
        formatter        : (cell) =>
          this.baseTableFunctions.atrributesFormatter(
            cell,
            (cv) => (cv.attribute === undefined ? [] : [cv.attribute]),
            i18n
          ),
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
            this.tableFunctions.checkAttributesLength,
            i18n
          )
      }
    ];
  }

  tableFunctions = {

    checkAttributesLength : (attributes) => {
      if (attributes.length > 1) {
        this.showAlert(
          i18n.t('ui.editors.attributes.errors.onlyOneAttributeAllowed', { nrAttributes: attributes.length - 1 })
        );
        return false;
      } else {
        return true;
      }
    }
  };

  setCaveStationAttributes() {
    const newAttributes = this.getNewStationAttributes();
    const oldAttributes = this.cave.attributes.stationAttributes;
    const isEqual =
      newAttributes.length === oldAttributes.length &&
      newAttributes.every((element, index) => this.isStationAttributeEqual(element, oldAttributes[index]));

    if (!isEqual) {
      this.cave.attributes.stationAttributes = newAttributes;
      this.#emitStationAttributesChanged();
    }
  }

  isStationAttributeEqual(a, b) {
    if (!a || !b) return false;
    return a.isEqual(b);
  }

  getNewStationAttributes() {
    return this.table
      .getData()
      .map((r) => new StationAttribute(r.id, r.station, r.attribute));
  }

  getValidationUpdate(r) {
    let newRow;
    const sa = new StationAttribute(r.id, r.station, r.attribute);
    const emptyFields = sa.getEmptyFields();
    const oldStatus = r.status;
    let validationErrors = [];
    if (emptyFields.length > 0) {
      newRow = { ...r };
      newRow.status = 'incomplete';
      newRow.message = i18n.t('ui.editors.attributes.status.incomplete', { fields: emptyFields.join(',') });
    } else {
      const errors = sa.validate(i18n);
      if (errors.length > 0) {
        validationErrors.push(...errors);
        newRow = { ...r };
        newRow.status = 'invalid';
        newRow.message = i18n.t('ui.editors.attributes.status.invalid', { errors: errors.join('<br>') });
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
      station   : undefined,
      survey    : undefined,
      attribute : undefined,
      status    : 'incomplete',
      message   : i18n.t('ui.editors.attributes.status.new')
    };
  }

  getTableData() {
    const rows = this.cave.attributes.stationAttributes.map((r) => {
      const station = this.cave.stations.get(r.name);
      return {
        id        : r.id,
        visible   : false, // Station attributes don't have visibility by default
        station   : r.name,
        survey    : station ? station.survey.name : undefined,
        attribute : r.attribute,
        status    : 'ok',
        message   : i18n.t('ui.editors.attributes.status.ok')
      };
    });

    const rowsToUpdate = this.getValidationUpdates(rows);
    rowsToUpdate.forEach((u) => (rows[rows.findIndex((r) => r.id === u.id)] = u));

    return rows;
  }

  functions = {
    toggleVisibility : (ev, cell) => {
      const data = cell.getData();
      if (data.status !== 'ok' && !data.visible) {
        this.showAlert(i18n.t('ui.editors.stationAttributes.errors.stationAttributeMissingArguments'));
        return;
      }

      cell.setValue(!cell.getValue());

      if (cell.getValue() === true) {
        const station = this.cave.stations.get(data.station);
        if (data.attribute && data.attribute.name) {
          if (['bedding', 'fault'].includes(data.attribute.name)) {
            this.scene.showPlaneFor(data.id, station, data.attribute);
          } else {
            this.scene.showIconFor(data.id, station, data.attribute);
          }
        }
      } else {
        if (data.attribute && data.attribute.name) {
          if (['bedding', 'fault'].includes(data.attribute.name)) {
            this.scene.disposePlaneFor(data.id);
          } else {
            this.scene.disposeIconFor(data.id);
          }
        }
      }
    },
    stationEdited : (cell) => {
      const data = cell.getData();
      const station = this.cave.stations.get(data.station);
      if (station) {
        data.survey = station.survey.name;
        cell.getRow().update(data);
      }
    }
  };

  #emitStationAttributesChanged() {
    const event = new CustomEvent('stationAttributesChanged', {
      detail : {
        cave : this.cave
      }
    });
    document.dispatchEvent(event);
  }

}

export { SectionAttributeEditor, ComponentAttributeEditor, StationAttributeEditor };
