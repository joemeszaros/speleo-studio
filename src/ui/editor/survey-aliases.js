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

import { BaseEditor } from './base.js';
import { wm } from '../window.js';
import * as U from '../../utils/utils.js';
import { i18n } from '../../i18n/i18n.js';
import { ShotType, SurveyAlias } from '../../model/survey.js';
import { IconBar } from './iconbar.js';

class SurveyAliasesEditor extends BaseEditor {

  constructor(options, cave, panel) {
    super(panel);
    this.options = options;
    this.cave = cave;
    this.modified = false;
  }

  setupPanel() {
    wm.makeFloatingPanel(
      this.panel,
      (contentElmnt, close) => this.build(contentElmnt, close),
      () => i18n.t('ui.editors.surveyAliases.title', { name: this.cave.name }),
      true,
      true,
      this.options.ui.editor.surveyAliases,
      () => {
        this.closeEditor();
      },
      () => {
        const h = this.panel.offsetHeight - 100;
        this.table.setHeight(h);
      },
      () => {
        if (this.table) {
          this.table.redraw(true);
        }
      }
    );
  }

  build(contentElmnt, close) {
    this.setupButtons(contentElmnt, close);
    this.setupTable(contentElmnt);
  }

  setupButtons(contentElmnt, close) {
    this.iconBar = new IconBar(contentElmnt);

    const rcIC = this.iconBar.getRowCountInputContainer();
    // Add common buttons (undo, redo, add row, delete row)
    const commonButtons = IconBar.getCommonButtons(() => this.table, {
      getEmptyRow            : () => this.getEmptyRow(),
      rowCountInputContainer : rcIC
    });
    commonButtons.forEach((button) => this.iconBar.addButton(button));
    this.iconBar.addRowCountInput(rcIC);
    this.iconBar.addButton(IconBar.getDeleteButton(() => this.table));

    const aliasesButtons = IconBar.getSurveyAliasesButtons(
      () => this.validateAliases(),
      () => this.updateAliases(),
      () => this.cancelAliases(close)
    );
    aliasesButtons.forEach((button) => this.iconBar.addButton(button));

    const exportButton = IconBar.getExportButton(() => this.table, this.cave.name + ' - survey-aliases.csv');
    exportButton.forEach((button) => this.iconBar.addButton(button));
  }

  getTableData() {
    const rowsToBe = this.cave.aliases.map((a) => ({
      id     : U.randomAlphaNumbericString(4),
      status : 'ok',
      from   : a.from,
      to     : a.to
    }));

    const rowsToUpdate = this.getValidationUpdates(rowsToBe);
    rowsToUpdate.forEach((u) => (rowsToBe[rowsToBe.findIndex((r) => r.id === u.id)] = u));

    return rowsToBe;
  }

  getNewAliases() {
    return this.table.getData().map((r) => new SurveyAlias(r.from, r.to));
  }

  getEmptyRow() {
    return {
      id     : U.randomAlphaNumbericString(4),
      status : 'incomplete',
      from   : undefined,
      to     : undefined
    };
  }

  validateAliases() {
    const data = this.table.getData();
    const rowsToUpdated = this.getValidationUpdates(data);
    if (rowsToUpdated.length > 0) {
      this.table.updateData(rowsToUpdated);
      const badRowIds = rowsToUpdated
        .filter((r) => ['invalid', 'incomplete'].includes(r.status))
        .map((r) => `${r.from ?? ''} -> ${r.to ?? ''}`);
      if (badRowIds.length > 0) {
        this.showAlert(
          i18n.t('ui.editors.base.message.invalidRowWithIds', {
            nrBadRows : badRowIds.length,
            badRowIds : badRowIds.slice(0, 15).join(', ')
          }) +
            '<br>' +
            i18n.t('ui.editors.common.error.checkWarningIcon')
        );
      }
    }
  }

  getValidationUpdates(data) {
    const rowsToUpdated = [];
    const existingPairs = new Set();

    data.forEach((r) => {
      const alias = new SurveyAlias(r.from, r.to);
      const emptyFields = alias.getEmptyFields();
      const oldStatus = r.status;
      let validationErrors = [];
      if (emptyFields.length > 0) {
        const translatedFields = emptyFields.map((f) => i18n.t('ui.editors.surveyAliases.columns.' + f));
        const newRow = { ...r };
        newRow.status = 'incomplete';
        newRow.message = i18n.t('ui.editors.surveyAliases.message.missingFields', {
          fields : translatedFields.join(',')
        });
        rowsToUpdated.push(newRow);
      } else if (r.from === r.to) {
        const newRow = { ...r };
        newRow.status = 'invalid';
        newRow.message = i18n.t('ui.editors.surveyAliases.message.fromToSame', { from: r.from, to: r.to });
        rowsToUpdated.push(newRow);
        validationErrors.push(newRow.message);
      } else {
        // An alias is an undirected equate, so treat from->to and to->from as the same pair.
        const key = [r.from, r.to].sort().join('\u0000');
        if (existingPairs.has(key)) {
          const newRow = { ...r };
          newRow.status = 'invalid';
          newRow.message = i18n.t('ui.editors.surveyAliases.message.duplicateAlias', { from: r.from, to: r.to });
          rowsToUpdated.push(newRow);
          validationErrors.push(newRow.message);
        }
        existingPairs.add(key);
      }

      if (['invalid', 'incomplete'].includes(oldStatus) && emptyFields.length === 0 && validationErrors.length === 0) {
        const newRow = { ...r };
        newRow.status = 'ok';
        newRow.message = undefined;
        rowsToUpdated.push(newRow);
      }

    });
    return rowsToUpdated;
  }

  cancelAliases(wmCloseFn) {
    this.modified = false;
    wmCloseFn(); // this is the window manager close function to remove the window from the active window list
  }

  updateAliases() {

    if (this.modified) {
      this.validateAliases();
      this.cave.aliases = this.getNewAliases();
      this.modified = false;
      this.#emitSurveyAliasesChanged();
    }

  }

  getColumns() {

    const statusIcon = (cell) => {
      const data = cell.getData();
      if (data.status === 'ok') {
        return '<div class="ok-row"></div>';
      } else {
        return '<div class="warning-row"></div>';
      }
    };
    const countBadRows = (_values, data) => {
      const cnt = data.filter((v) => v.status !== 'ok').length;
      return `${cnt}`;
    };

    const nonSplayStationNames = [
      ...new Set(
        [...this.cave.getAllStations().entries()]
          .filter(([_, s]) => s.type != ShotType.SPLAY)
          .map(([name, _]) => U.bareStationName(name))
      )
    ];

    return [
      {
        width             : 25,
        title             : '',
        field             : 'status',
        editor            : false,
        download          : false,
        accessorClipboard : (value) => value,
        formatter         : statusIcon,
        clickPopup        : function (x, cell) {
          const message = cell.getData().message;
          return message === undefined ? i18n.t('ui.editors.survey.status.ok') : message;
        },
        validator          : ['required'],
        bottomCalc         : countBadRows,
        headerFilter       : 'list',
        headerFilterParams : { valuesLookup: true, clearable: true }
      },
      {
        title        : i18n.t('ui.editors.surveyAliases.columns.from'),
        field        : 'from',
        width        : 200,
        editor       : 'list',
        editorParams : { values: [...nonSplayStationNames], autocomplete: true },
        validator    : ['required'],
        headerFilter : 'input',
        bottomCalc   : 'count'
      },
      {
        title        : i18n.t('ui.editors.surveyAliases.columns.to'),
        field        : 'to',
        width        : 200,
        editor       : 'list',
        editorParams : { values: [...nonSplayStationNames], autocomplete: true },
        validator    : ['required'],
        headerFilter : 'input'
      }
    ];
  }

  setupTable(contentElmnt) {

    // Create table container
    const tableContainer = U.node`<div id="survey-aliases-table"></div>`;
    contentElmnt.appendChild(tableContainer);

    // eslint-disable-next-line no-undef
    this.table = new Tabulator(tableContainer, {
      data                      : this.getTableData(),
      history                   : true, //enable undo and redo
      height                    : this.options.ui.editor.surveyAliases.height - 36 - 48 - 5, // header + iconbar
      layout                    : 'fitDataStretch',
      columns                   : this.getColumns(),
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
        formatCells   : false
      },
      clipboardCopyRowRange : 'range',
      clipboardPasteParser  : 'range',
      clipboardPasteAction  : 'range',
      rowHeader             : {
        formatter : 'rownum',
        hozAlign  : 'center',
        resizable : true,
        frozen    : true,
        editor    : false,
        width     : 50
      },
      columnDefaults : {
        headerSort     : false,
        headerHozAlign : 'center',
        resizable      : 'header'
      },
      rowFormatter : function (row) {
        const rowData = row.getData();

        if (rowData.status === 'invalid') {
          row.getElement().style.backgroundColor = '#b99922';
        }
      }

    });

    this.table.on('dataChanged', () => {
      this.modified = true;
    });

    this.table.on('rowMoved', () => {
      this.modified = true;
    });

    this.setupCustomEditMode(['from', 'to']);

    // Listen for column resize events and save widths
    this.table.on('columnResized', (column) => {
      const field = column.getField();
      if (field) {
        const width = column.getWidth();
        // Ensure columnWidths object exists
        if (!this.options.ui.editor.surveyAliases.columnWidths) {
          this.options.ui.editor.surveyAliases.columnWidths = {};
        }
        // Update the width and reassign to ensure proxy detects the change
        const columnWidths = { ...this.options.ui.editor.surveyAliases.columnWidths };
        columnWidths[field] = width;
        this.options.ui.editor.surveyAliases.columnWidths = columnWidths;
      }
    });

    // Restore column widths after table is fully built
    this.table.on('tableBuilt', () => {
      if (this.options.ui.editor.surveyAliases.columnWidths) {
        const savedWidths = this.options.ui.editor.surveyAliases.columnWidths;
        const columns = this.getColumns();
        columns.forEach((column) => {
          if (column.field && savedWidths[column.field] !== undefined) {
            const columnComponent = this.table.getColumn(column.field);
            if (columnComponent) {
              columnComponent.setWidth(savedWidths[column.field]);
            }
          }
        });
      }
    });

  }

  closeEditor() {
    this.updateAliases();
    super.closeEditor();
  }

  #emitSurveyAliasesChanged() {
    document.dispatchEvent(new CustomEvent('caveChanged', { detail: { cave: this.cave, reasons: ['alias'] } }));
  }
}

export { SurveyAliasesEditor };
