import * as U from '../../utils/utils.js';
import { Color, SectionAttribute, ComponentAttribute } from '../../model.js';
import { CaveSection, CaveComponent } from '../../model/cave.js';
import { SectionHelper } from '../../section.js';
import { randomAlphaNumbericString } from '../../utils/utils.js';
import { makeMovable } from '../popups.js';
import { CaveEditor } from './cave.js';

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
    makeMovable(
      this.panel,
      this.title,
      true,
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

    // eslint-disable-next-line no-undef
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

export { SectionAttributeEditor, ComponentAttributeEditor };
