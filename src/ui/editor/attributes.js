import { SectionAttribute, ComponentAttribute } from '../../model.js';
import { CaveSection, CaveComponent } from '../../model/cave.js';
import { SectionHelper } from '../../section.js';
import { randomAlphaNumbericString } from '../../utils/utils.js';
import { makeMovable } from '../popups.js';
import { CaveEditor } from './cave.js';
import { i18n } from '../../i18n/i18n.js';
import { IconBar } from './iconbar.js';

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
    this.panel.innerHTML = '';
    makeMovable(
      this.panel,
      this.title,
      true,
      () => {
        document.removeEventListener('languageChanged', () => this.buildPanel());
        this.closeEditor();
      },
      (_newWidth, newHeight) => this.table.setHeight(newHeight - 140),
      () => this.table.redraw()
    );
    this.setupButtons();
    this.setupTable();
  }

  setupButtons() {
    // Create iconbar with common buttons
    this.iconBar = new IconBar(this.panel);

    // Add common buttons (undo, redo, add row, delete row)
    const commonButtons = IconBar.getCommonButtons(() => this.table, {
      getEmptyRow : () => this.getEmptyRow()
    });
    commonButtons.forEach((button) => this.iconBar.addButton(button));

    // Add separator
    //this.iconBar.addSeparator();

    const specificButtons = IconBar.getAttributesButtons(
      () => this.validateRows(),
      () => this.setCaveSectionAttributes()
    );
    specificButtons.forEach((button) => this.iconBar.addButton(button));

    //this.iconBar.addSeparator();

    // Add export button
    const exportButton = IconBar.getExportButton(() => this.table, this.cave.name + ' - attributes.csv');
    exportButton.forEach((button) => this.iconBar.addButton(button));

  }

  setupTable() {

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
        title  : i18n.t('ui.editors.attributes.columns.format'),
        field  : 'format',
        editor : 'input'
      }
    ];

    columns.splice(3, 0, ...this.getColumns());

    // eslint-disable-next-line no-undef
    this.table = new Tabulator('#sectionattributes', {
      history                   : true, //enable undo and redo
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

  setCaveComponentAttributes() {
    const newAttributes = this.getNewComponentAttributes();
    const oldAttributes = this.cave.componentAttributes;
    const isEqual =
      newAttributes.length === oldAttributes.length &&
      newAttributes.every((element, index) => element.isEqual(oldAttributes[index]));

    if (!isEqual) {
      this.cave.componentAttributes = newAttributes;
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

    return [
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

  setCaveSectionAttributes() {
    const newAttributes = this.getNewSectionAttributes();
    const oldAttributes = this.cave.sectionAttributes;
    const isEqual =
      newAttributes.length === oldAttributes.length &&
      newAttributes.every((element, index) => element.isEqual(oldAttributes[index]));

    if (!isEqual) {
      this.cave.sectionAttributes = newAttributes;
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
        message   : i18n.t('ui.editors.attributes.status.ok')
      };
    });

    const rowsToUpdate = this.getValidationUpdates(rows);
    rowsToUpdate.forEach((u) => (rows[rows.findIndex((r) => r.id === u.id)] = u));

    return rows;
  }

  getColumns() {
    return [
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

export { SectionAttributeEditor, ComponentAttributeEditor };
