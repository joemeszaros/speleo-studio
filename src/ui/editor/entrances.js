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
import { ShotType } from '../../model/survey.js';
import { IconBar } from './iconbar.js';

/**
 * Table editor for cave entrance stations. Entrances are stored on the cave as an array of
 * station keys matching `cave.getAllStations()` keys (survey-qualified for multi-survey caves,
 * bare otherwise). Each row holds one entrance station.
 */
class EntrancesEditor extends BaseEditor {

  constructor(options, cave, panel) {
    super(panel);
    this.options = options;
    this.cave = cave;
    this.modified = false;
    // `ui.editor.entrances` was added after this config existed, so an older persisted config
    // won't have it — fall back to a default so the floating panel and table can size themselves.
    if (!this.options.ui.editor.entrances) {
      this.options.ui.editor.entrances = { height: 300, width: 500, columnWidths: {} };
    }
  }

  setupPanel() {
    wm.makeFloatingPanel(
      this.panel,
      (contentElmnt, close) => this.build(contentElmnt, close),
      () => i18n.t('ui.editors.entrances.title', { name: this.cave.name }),
      true,
      true,
      this.options.ui.editor.entrances,
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
    const commonButtons = IconBar.getCommonButtons(() => this.table, {
      getEmptyRow            : () => this.getEmptyRow(),
      rowCountInputContainer : rcIC
    });
    commonButtons.forEach((button) => this.iconBar.addButton(button));
    this.iconBar.addRowCountInput(rcIC);
    this.iconBar.addButton(IconBar.getDeleteButton(() => this.table));

    const entranceButtons = IconBar.getEntrancesButtons(
      () => this.validateEntrances(),
      () => this.updateEntrances(),
      () => this.cancelEntrances(close)
    );
    entranceButtons.forEach((button) => this.iconBar.addButton(button));

    const exportButton = IconBar.getExportButton(() => this.table, this.cave.name + ' - entrances.csv');
    exportButton.forEach((button) => this.iconBar.addButton(button));
  }

  getTableData() {
    const rowsToBe = this.cave.entrances.map((station) => ({
      id      : U.randomAlphaNumbericString(4),
      status  : 'ok',
      message : i18n.t('ui.editors.base.status.ok'),
      station : station
    }));

    const rowsToUpdate = this.getValidationUpdates(rowsToBe);
    rowsToUpdate.forEach((u) => (rowsToBe[rowsToBe.findIndex((r) => r.id === u.id)] = u));

    return rowsToBe;
  }

  getNewEntrances() {
    return this.table
      .getData()
      .map((r) => r.station)
      .filter((s) => s !== undefined && s !== null && s !== '');
  }

  getEmptyRow() {
    return {
      id      : U.randomAlphaNumbericString(4),
      status  : 'incomplete',
      message : i18n.t('ui.editors.base.message.incomplete'),
      station : undefined
    };
  }

  validateEntrances() {
    const data = this.table.getData();
    const rowsToUpdated = this.getValidationUpdates(data);
    if (rowsToUpdated.length > 0) {
      this.table.updateData(rowsToUpdated);
      const badRowIds = rowsToUpdated
        .filter((r) => ['invalid', 'incomplete'].includes(r.status))
        .map((r) => `station: ${r.station ?? ''}`);
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
    const seenStations = new Set();

    data.forEach((r) => {
      const oldStatus = r.status;
      const missing = r.station === undefined || r.station === null || r.station === '';
      let isDuplicate = false;

      if (missing) {
        const newRow = { ...r };
        newRow.status = 'incomplete';
        newRow.message = i18n.t('ui.editors.entrances.message.missingFields', {
          fields : i18n.t('ui.editors.entrances.columns.station')
        });
        rowsToUpdated.push(newRow);
      } else if (seenStations.has(r.station)) {
        isDuplicate = true;
        const newRow = { ...r };
        newRow.status = 'invalid';
        newRow.message = i18n.t('ui.editors.entrances.message.duplicateEntrance', { station: r.station });
        rowsToUpdated.push(newRow);
      }

      if (!missing) seenStations.add(r.station);

      if (['invalid', 'incomplete'].includes(oldStatus) && !missing && !isDuplicate) {
        const newRow = { ...r };
        newRow.status = 'ok';
        newRow.message = undefined;
        rowsToUpdated.push(newRow);
      }
    });
    return rowsToUpdated;
  }

  cancelEntrances(wmCloseFn) {
    this.modified = false;
    wmCloseFn(); // window manager close function to remove the window from the active window list
  }

  updateEntrances() {
    if (this.modified) {
      this.validateEntrances();
      this.cave.entrances = this.getNewEntrances();
      this.modified = false;
      this.#emitEntrancesChanged();
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

    // Entrance keys match the station map keys (survey-qualified for multi-survey caves), so list
    // the full keys; exclude splay stations which can't be entrances.
    const stationNames = [
      ...new Set(
        [...this.cave.getAllStations().entries()]
          .filter(([, s]) => s.type !== ShotType.SPLAY)
          .map(([name]) => name)
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
        title        : i18n.t('ui.editors.entrances.station'),
        field        : 'station',
        editor       : 'list',
        editorParams : { values: [...stationNames], autocomplete: true },
        validator    : ['required'],
        headerFilter : 'input',
        bottomCalc   : 'count'
      }
    ];
  }

  setupTable(contentElmnt) {
    const tableContainer = U.node`<div id="entrances-table"></div>`;
    contentElmnt.appendChild(tableContainer);

    // eslint-disable-next-line no-undef
    this.table = new Tabulator(tableContainer, {
      data                      : this.getTableData(),
      history                   : true, //enable undo and redo
      height                    : this.options.ui.editor.entrances.height - 36 - 48 - 5, // header + iconbar
      layout                    : 'fitDataStretch',
      columns                   : this.getColumns(),
      selectableRange           : 1,
      selectableRangeColumns    : true,
      selectableRangeRows       : true,
      selectableRangeClearCells : true,

      movableRows : true,

      editTriggerEvent : 'dblclick',

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

    // Listen for column resize events and save widths
    this.table.on('columnResized', (column) => {
      const field = column.getField();
      if (field) {
        const width = column.getWidth();
        if (!this.options.ui.editor.entrances.columnWidths) {
          this.options.ui.editor.entrances.columnWidths = {};
        }
        const columnWidths = { ...this.options.ui.editor.entrances.columnWidths };
        columnWidths[field] = width;
        this.options.ui.editor.entrances.columnWidths = columnWidths;
      }
    });

    // Restore column widths after table is fully built
    this.table.on('tableBuilt', () => {
      if (this.options.ui.editor.entrances.columnWidths) {
        const savedWidths = this.options.ui.editor.entrances.columnWidths;
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
    this.updateEntrances();
    super.closeEditor();
  }

  #emitEntrancesChanged() {
    document.dispatchEvent(new CustomEvent('entrancesChanged', { detail: { cave: this.cave } }));
  }
}

export { EntrancesEditor };
