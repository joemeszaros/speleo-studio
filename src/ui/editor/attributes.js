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

import { SectionAttribute, ComponentAttribute, StationAttribute } from '../../model.js';
import { ShotType } from '../../model/survey.js';
import { CaveSection, CaveComponent } from '../../model/cave.js';
import { SectionHelper } from '../../section.js';
import { randomAlphaNumbericString } from '../../utils/utils.js';
import { wm } from '../window.js';
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
    wm.makeFloatingPanel(
      this.panel,
      (contentElmnt, close) => this.buildPanel(contentElmnt, close),
      () => {
        return this.getTitle();
      },
      true,
      true,
      this.options.ui.editor.attributes,
      () => {
        this.closeEditor();
      },
      (_newWidth, newHeight) => {
        const h = this.panel.offsetHeight - 100;
        this.table.setHeight(h);
      },
      () => this.table.redraw()
    );
  }

  buildPanel(contentElmnt, close) {

    this.setupButtons(contentElmnt, close);
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

    const visibleButtons = IconBar.getVisibleButtons(
      () => this.showAllAttributes(),
      () => this.hideAllAttributes()
    );
    visibleButtons.forEach((button) => this.iconBar.addButton(button));

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
      height                    : this.options.ui.editor.attributes.height - 36 - 48 - 5, // header + iconbar
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

    // custom editing on keydown didn't work for format column
    // so we do not allow custom editing of the format column but we need the left right arrow key fix
    this.setupCustomEditMode([]);
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
        // Replace the attribute editor with the add new attribute interface
        const panel = attributeNode.parentNode;
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
          if (!selectedOption) return;
          const originalName = selectedOption.getAttribute('originalName');
          const aName = input.value;
          if (aNamesWithIds.find((a) => a.name === aName)) {
            const newAttribute = this.attributeDefs.createByName(originalName)();
            attributes.push(newAttribute);
            // Replace the add section with the new attribute editor
            const newAttributeNode = this.getAttributeEditorDiv(newAttribute, attributes, 0, i18n);
            panel.replaceChild(newAttributeNode, add);
          } else if (aName === '') {
            this.showAlert(i18n.t('ui.editors.attributes.errors.noNameSelected'));
          } else {
            this.showAlert(i18n.t('ui.editors.attributes.errors.noAttributeWithName', { name: aName }));
          }
        };

        panel.replaceChild(add, attributeNode);
      }
    };

    attributeNode.appendChild(name);
    const paramNames = Object.keys(a.params);
    var paramIndex = 0;
    paramNames.forEach((paramName) => {
      const value = a[paramName] === undefined ? '' : a[paramName];
      const paramDef = a.params[paramName];
      const { errors } = a.validateFieldValue(paramName, value, true, true); // validate as string, skip empty check, no localization
      let underScoreClass;
      const requiredField = paramDef.required ?? false;
      if (errors.length > 0) {
        underScoreClass = 'invalidInput';
      } else if (requiredField) {
        underScoreClass = 'requiredInput';
      } else {
        underScoreClass = 'optionalInput';
      }

      const classes = [underScoreClass];
      if (['int', 'float'].includes(paramDef.type)) {
        classes.push('shortInput');
      } else if (paramDef.type === 'string') {
        if (paramDef.values?.length > 0) {
          //classes.push('shortInput');
        } else {
          classes.push('mediumInput');
        }
      }

      let datalist;
      if ((paramDef.values ?? []).length > 0) {
        datalist = U.node`<datalist id="paramValues-${paramName}-${index}">${paramDef.values.map((n) => '<option value="' + n + '">').join('')}</datalist>`;
      }
      const inputType = datalist === undefined ? 'text' : 'search';
      const list = datalist === undefined ? '' : `list="paramValues-${paramName}-${index}"`;
      const param = U.node`<input placeholder="${i18n.t(`attributes.params.${paramName}`)}" type="${inputType}" ${list} class="${classes.join(' ')}" id="${paramName}-${index}" value="${value}">`;
      param.onchange = (e) => {
        this.attributesModified = true;
        let newValue = e.target.value === '' ? undefined : e.target.value;
        newValue = newValue?.replace(/\t/g, ''); //replace tab characters
        const { errors, reasons } = a.validateFieldValue(paramName, newValue, true, false, i18n);
        if (errors.length > 0) {
          param.classList.remove('requiredInput');
          param.classList.add('invalidInput');
          if (reasons.has('typeMismatch')) {
            a[paramName] = newValue;
          } else {
            a.setParamFromString(paramName, newValue);
          }
        } else {
          param.classList.remove('invalidInput');
          param.classList.add(requiredField ? 'requiredInput' : 'optionalInput');
          if (newValue !== undefined) {
            a.setParamFromString(paramName, newValue);
          }
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
    const attributes = extractor(cell.getData()).map((a) => a.clone());

    const panel = U.node`<div tabindex="0" id="attributes-editor" class="attributes-editor"></div>`;

    // Add close button in top right corner
    const closeButton = U.node`<span class="close-button">&times;</span>`;
    closeButton.onclick = () => {
      if (extraValidators(attributes) === true) {
        const toSuccess = mutator(attributes);
        success(toSuccess);
      }
    };
    panel.appendChild(closeButton);

    panel.addEventListener('keydown', (e) => {
      if (e.keyCode === 9) {
        e.stopPropagation(); // when a user clicks or tabs out of a cell the edit is cancelled and and the user is navigated to the next row
        this.table.dispatch('cell-value-changed', this);
      }
      if (e.key === 'Escape') {
        if (extraValidators(attributes) === true) {
          const toSuccess = mutator(attributes);
          success(toSuccess);
        }
      }
    });

    // Only show the first attribute (single attribute editing)
    if (attributes.length > 0) {
      const attributeNode = this.getAttributeEditorDiv(attributes[0], attributes, 0, i18n);
      panel.appendChild(attributeNode);
    } else {
      // If no attribute exists, show add attribute functionality
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
        if (!selectedOption) return;
        const originalName = selectedOption.getAttribute('originalName');
        const aName = input.value;
        if (aNamesWithIds.find((a) => a.name === aName)) {
          const newAttribute = this.attributeDefs.createByName(originalName)();
          attributes.push(newAttribute);
          // Replace the add section with the new attribute editor
          const attributeNode = this.getAttributeEditorDiv(newAttribute, attributes, 0, i18n);
          panel.replaceChild(attributeNode, add);
        } else if (aName === '') {
          this.showAlert(i18n.t('ui.editors.attributes.errors.noNameSelected'));
        } else {
          this.showAlert(i18n.t('ui.editors.attributes.errors.noAttributeWithName', { name: aName }));
        }
      };

      panel.appendChild(add);
    }

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

  nonSplayStationNames() {
    return [...this.cave.stations.entries()]
      .filter(([_, s]) => s.type != ShotType.SPLAY)
      .map(([name, _]) => name);
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

    const updateInterpolated = (cell) => {
      const data = cell.getData();
      if (data.attribute !== undefined && data.format) {
        const localized = data.attribute.localize(i18n);
        const formattedAttribute = U.interpolate(data.format, localized);
        data.interpolated = formattedAttribute;
        cell.getRow().update(data);
      }
    };

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
        cellClick        : (ev, cell) => this.toggleVisibility(ev, cell),
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
        formatter        : this.baseTableFunctions.floatFormatter('0'),
        bottomCalc       : this.baseTableFunctions.sumDistance
      },
      {
        title            : i18n.t('ui.editors.attributes.columns.attribute'),
        field            : 'attribute',
        headerFilterFunc : this.baseTableFunctions.attributesHeaderFilter,
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
        accessorDownload : (value) =>
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
          ),
        cellEdited: updateInterpolated
      },
      {
        title  : i18n.t('ui.editors.attributes.columns.format'),
        field  : 'format',
        editor : (cell, onRendered, success) => {
          const data = cell.getData();
          const editor = document.createElement('input');
          editor.setAttribute('type', 'text');

          if (data.attribute && data.format) {
            const localized = data.attribute.localizeFormatString(data.format, i18n);
            editor.value = localized;
          } else if (data.format && data.format.length > 0) {
            editor.value = data.format;
          } else {
            editor.value = '';
          }

          onRendered(function () {
            editor.focus();
            editor.style.css = '100%';
          });

          function successFunc() {
            success(editor.value); // after this mutator will deLocalize the value
          }
          editor.addEventListener('change', successFunc);
          editor.addEventListener('blur', successFunc);
          return editor;
        },
        cellEdited : updateInterpolated,
        formatter  : (cell) => {
          const data = cell.getData();
          if (data.attribute && data.format && data.format.length > 0) {
            const result = data.attribute.localizeFormatString(data.format, i18n);
            return result;
          } else if (data.format && data.format.length > 0) {
            return data.format;
          } else {
            return '';
          }
        },
        mutator : (value, data) => {
          if (data.attribute && value && value.length > 0) {
            const result = data.attribute.deLocalizeFormatString(value, i18n);
            return result;
          } else {
            return value;
          }
        }
      },
      {
        title  : i18n.t('ui.editors.attributes.columns.interpolated'),
        field  : 'interpolated',
        editor : false
      }
    ];
  }

  showAllAttributes() {
    const toShow = this.table.getData().filter((r) => r.visible === false && r.status === 'ok');
    if (toShow.length > 0) {
      toShow.forEach((r) => {
        this.showAttribute(r);
      });
      this.table.updateData(
        toShow.map((t) => {
          return { id: t.id, visible: true };
        })
      );
    }
  }

  hideAllAttributes() {
    const toHide = this.table.getData().filter((r) => r.visible === true);
    if (toHide.length > 0) {
      toHide.forEach((r) => {
        this.hideAttribute(r);
      });
      this.table.updateData(
        toHide.map((t) => {
          return { id: t.id, visible: false };
        })
      );
    }
  }

}

class ComponentAttributeEditor extends FragmentAttributeEditor {

  constructor(db, options, cave, scene, attributeDefs, panel) {
    super(db, options, cave, scene, attributeDefs, panel);
  }

  getTitle() {
    return i18n.t('ui.editors.componentAttributes.title', { name: this.cave.name });
  }

  closeEditor() {
    this.setCaveComponentAttributes();
    super.closeEditor();
  }

  setupButtons(contentElmnt, close) {
    super.setupCommonButtons(contentElmnt); // sets this.iconbar
    const specificButtons = IconBar.getAttributesButtons(
      () => this.validateRows(),
      () => this.setCaveComponentAttributes(),
      () => close()
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
      const translatedFields = emptyFields.map((f) => i18n.t('ui.editors.attributes.columns.' + f));
      newRow = { ...r };
      newRow.status = 'incomplete';
      newRow.message = i18n.t('ui.editors.base.status.incomplete', { fields: translatedFields.join(',') });
    } else if (
      r.start &&
      !this.cave.stations.has(r.start) &&
      (!r.termination || (r.termination && r.termination.every((t) => !this.cave.stations.has(t))))
    ) {
      newRow = { ...r };
      newRow.status = 'invalid';
      newRow.message = i18n.t('ui.editors.base.status.invalid', {
        errors : i18n.t('ui.editors.componentAttributes.errors.fromOrTerminationsNotFound')
      });
    } else {
      const errors = sa.validate(i18n);
      if (errors.length > 0) {
        validationErrors.push(...errors);
        newRow = { ...r };
        newRow.status = 'invalid';
        newRow.message = i18n.t('ui.editors.base.status.invalid', { errors: errors.join('<br>') });
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
      color       : this.options.scene.sections.color,
      start       : undefined,
      termination : undefined,
      path        : undefined,
      distance    : undefined,
      attribute   : undefined,
      format      : '${name}',
      status      : 'incomplete',
      message     : i18n.t('ui.editors.base.status.new')
    };

  }

  getTableData() {

    const rows = this.cave.attributes.componentAttributes.map((r) => {
      let interpolated;
      const format = r.format === undefined ? '${name}' : r.format;

      if (format && r.attribute) {
        const localized = r.attribute.localize(i18n);
        interpolated = U.interpolate(format, localized);

      }
      return {
        id           : r.id,
        visible      : r.visible,
        color        : r.color,
        start        : r.component.start,
        termination  : r.component.termination,
        path         : r.component.path, //hidden
        distance     : r.component.distance,
        attribute    : r.attribute,
        format       : format,
        interpolated : interpolated,
        status       : 'ok',
        message      : i18n.t('ui.editors.base.status.ok')
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
        success(
          value
            .split(',')
            .map((f) => f.trim())
            .filter((f) => f.length > 0)
        );
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
        editorParams : { values: this.nonSplayStationNames(), autocomplete: true },
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
        accessorDownload : (value) => {
          return value?.join(',') ?? '';
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

  showAttribute(r) {
    this.scene.attributes.showFragmentAttribute(
      r.id,
      SectionHelper.getComponentSegments(
        new CaveComponent(r.start, r.termination, r.path, r.distance),
        this.cave.stations
      ),
      r.attribute,
      r.format,
      r.color,
      this.cave.name
    );

  }

  hideAttribute(r) {
    this.scene.attributes.disposeSectionAttribute(r.id);
  }

  toggleVisibility(ev, cell) {
    const data = cell.getData();
    if (data.status !== 'ok' && !data.visible) {
      this.showAlert(i18n.t('ui.editors.componentAttributes.errors.componentAttributeMissingArguments'));
      return;
    }

    cell.setValue(!cell.getValue());

    if (cell.getValue() === true) {
      this.scene.attributes.showFragmentAttribute(
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
      this.scene.attributes.disposeSectionAttribute(data.id);
    }
  }

  functions = {
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
          this.scene.attributes.disposeSectionAttribute(data.id);
          this.scene.attributes.showFragmentAttribute(
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
  }

  getTitle() {
    return i18n.t('ui.editors.sectionAttributes.title', { name: this.cave.name });
  }

  closeEditor() {
    this.setCaveSectionAttributes();
    super.closeEditor();
  }

  setupButtons(contentElmnt, close) {
    super.setupCommonButtons(contentElmnt); // sets this.iconbar
    const specificButtons = IconBar.getAttributesButtons(
      () => this.validateRows(),
      () => this.setCaveSectionAttributes(),
      () => close()
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
      const translatedFields = emptyFields.map((f) => i18n.t('ui.editors.attributes.columns.' + f));
      newRow = { ...r };
      newRow.status = 'incomplete';
      newRow.message = i18n.t('ui.editors.base.status.incomplete', { fields: translatedFields.join(',') });
    } else if (r.from && r.to && (!this.cave.stations.has(r.from) || !this.cave.stations.has(r.to))) {
      newRow = { ...r };
      newRow.status = 'invalid';
      newRow.message = i18n.t('ui.editors.base.status.invalid', {
        errors : i18n.t('ui.editors.sectionAttributes.errors.fromOrToNotFound', { from: r.from, to: r.to })
      });
    } else {
      const errors = sa.validate(i18n);
      if (errors.length > 0) {
        validationErrors.push(...errors);
        newRow = { ...r };
        newRow.status = 'invalid';
        newRow.message = i18n.t('ui.editors.base.status.invalid', { errors: errors.join('<br>') });
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
      color     : this.options.scene.sections.color,
      from      : undefined,
      to        : undefined,
      path      : undefined,
      distance  : undefined,
      attribute : undefined,
      format    : '${name}',
      status    : 'incomplete',
      message   : i18n.t('ui.editors.base.status.new')
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
        message   : i18n.t('ui.editors.base.status.ok')
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
        editorParams : { values: this.nonSplayStationNames(), autocomplete: true },
        validator    : ['required'],
        headerFilter : 'input',
        cellEdited   : this.functions.fromOrToEdited
      },
      {
        title        : i18n.t('common.to'),
        field        : 'to',
        editor       : 'list',
        editorParams : { values: this.nonSplayStationNames(), autocomplete: true },
        validator    : ['required'],
        headerFilter : 'input',
        cellEdited   : this.functions.fromOrToEdited
      }
    ];

    const baseColumns = [...super.getColumns()];
    baseColumns.splice(3, 0, ...specificColumns);
    return baseColumns;
  }

  showAttribute(r) {
    this.scene.attributes.showFragmentAttribute(
      r.id,
      SectionHelper.getSectionSegments(new CaveSection(r.from, r.to, r.path, r.distance), this.cave.stations),
      r.attribute,
      r.format,
      r.color,
      this.cave.name
    );

  }

  hideAttribute(r) {
    this.scene.attributes.disposeSectionAttribute(r.id);
  }

  toggleVisibility(ev, cell) {
    const data = cell.getData();
    if (data.status !== 'ok' && !data.visible) {
      this.showAlert(i18n.t('ui.editors.sectionAttributes.errors.sectionAttributeMissingArguments'));
      return;
    }

    cell.setValue(!cell.getValue());

    if (cell.getValue() === true) {
      this.scene.attributes.showFragmentAttribute(
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
      this.scene.attributes.disposeSectionAttribute(data.id);
    }
  }

  functions = {

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
            this.scene.attributes.disposeSectionAttribute(data.id);
            this.scene.attributes.showFragmentAttribute(
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
  }

  getTitle() {
    return i18n.t('ui.editors.stationAttributes.title', { name: this.cave.name });
  }

  closeEditor() {
    this.setCaveStationAttributes();
    super.closeEditor();
  }

  setupButtons(contentElmnt, close) {
    super.setupCommonButtons(contentElmnt); // sets this.iconbar
    const specificButtons = IconBar.getAttributesButtons(
      () => this.validateRows(),
      () => this.setCaveStationAttributes(),
      () => close()
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
        cellClick        : (ev, cell) => this.toggleVisibility(ev, cell),
        mutatorClipboard : (str) => (str === 'true' ? true : false)
      },
      {
        title        : i18n.t('ui.editors.attributes.columns.station'),
        field        : 'station',
        editor       : 'list',
        editorParams : { values: this.nonSplayStationNames(), autocomplete: true },
        validator    : ['required'],
        headerFilter : 'input',
        cellEdited   : this.functions.stationEdited
      },
      {
        title        : i18n.t('ui.editors.attributes.columns.survey'),
        field        : 'survey',
        editor       : false,
        headerFilter : 'input'
      },
      {
        title            : i18n.t('ui.editors.attributes.columns.attribute'),
        field            : 'attribute',
        headerFilterFunc : this.baseTableFunctions.attributesHeaderFilter,
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
        mutatorClipboard : (value) => this.baseTableFunctions.attributesFromClipboard(value, (attrs) => attrs[0]),
        accessorDownload : (value) =>
          this.baseTableFunctions.attributesToClipboard(value, (attribute) =>
            attribute === undefined ? undefined : [attribute]
          ),
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

  showAllAttributes() {
    const toShow = this.table.getData().filter((r) => r.visible === false && r.status === 'ok');
    if (toShow.length > 0) {
      toShow.forEach((r) => {
        const station = this.cave.stations.get(r.station);
        this.scene.attributes.showStationAttribute(r.id, station, r.attribute);
      });
      this.table.updateData(
        toShow.map((t) => {
          return { id: t.id, visible: true };
        })
      );
    }

  }

  hideAllAttributes() {
    const toHide = this.table.getData().filter((r) => r.visible === true);
    if (toHide.length > 0) {
      toHide.forEach((r) => {
        this.scene.attributes.disposeStationAttribute(r.id, r.attribute);
      });
      this.table.updateData(
        toHide.map((t) => {
          return { id: t.id, visible: false };
        })
      );
    }
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
      newAttributes.every((element, index) => element.isEqual(oldAttributes[index]));

    if (!isEqual) {
      this.cave.attributes.stationAttributes = newAttributes;
      this.#emitStationAttributesChanged();
    }
  }

  getNewStationAttributes() {

    if (!this.table) return [];

    return this.table
      .getData()
      .map((r) => new StationAttribute(r.id, r.station, r.attribute, r.visible));
  }

  getValidationUpdate(r) {
    let newRow;
    const sa = new StationAttribute(r.id, r.station, r.attribute, r.visible);
    const emptyFields = sa.getEmptyFields();
    const oldStatus = r.status;
    let validationErrors = [];
    if (emptyFields.length > 0) {
      const translatedFields = emptyFields.map((f) => i18n.t('ui.editors.attributes.columns.' + f));
      newRow = { ...r };
      newRow.status = 'incomplete';
      newRow.message = i18n.t('ui.editors.base.status.incomplete', { fields: translatedFields.join(',') });
    } else if (r.station && !this.cave.stations.has(r.station)) {
      newRow = { ...r };
      newRow.status = 'invalid';
      newRow.message = i18n.t('ui.editors.base.status.invalid', {
        errors : i18n.t('ui.editors.stationAttributes.errors.stationNotFound', { station: r.station })
      });
    } else {
      const errors = sa.validate(i18n);
      if (errors.length > 0) {
        validationErrors.push(...errors);
        newRow = { ...r };
        newRow.status = 'invalid';
        newRow.message = i18n.t('ui.editors.base.status.invalid', { errors: errors.join('<br>') });
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
      message   : i18n.t('ui.editors.base.status.new')
    };
  }

  getTableData() {
    const rows = this.cave.attributes.stationAttributes.map((r) => {
      const station = this.cave.stations.get(r.name);
      return {
        id        : r.id,
        visible   : r.visible,
        station   : r.name,
        survey    : station ? station.survey.name : undefined,
        attribute : r.attribute,
        status    : 'ok',
        message   : i18n.t('ui.editors.base.status.ok')
      };
    });

    const rowsToUpdate = this.getValidationUpdates(rows);
    rowsToUpdate.forEach((u) => (rows[rows.findIndex((r) => r.id === u.id)] = u));

    return rows;
  }

  toggleVisibility(ev, cell) {
    const data = cell.getData();
    if (data.status !== 'ok' && !data.visible) {
      this.showAlert(i18n.t('ui.editors.stationAttributes.errors.stationAttributeMissingArguments'));
      return;
    }

    cell.setValue(!cell.getValue());

    if (cell.getValue() === true) {
      const station = this.cave.stations.get(data.station);
      if (data.attribute && data.attribute.name) {
        this.scene.attributes.showStationAttribute(data.id, station, data.attribute);
      }
    } else {
      if (data.attribute && data.attribute.name) {
        this.scene.attributes.disposeStationAttribute(data.id, data.attribute);
      }
    }
  }

  functions = {

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
