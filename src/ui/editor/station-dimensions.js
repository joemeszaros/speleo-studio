/*
 * Copyright 2026 Joe Meszaros
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
import { ShotType, StationDimension } from '../../model/survey.js';
import { IconBar } from './iconbar.js';

class StationDimensionsEditor extends BaseEditor {

  constructor(options, cave, panel) {
    super(panel);
    this.options = options;
    this.cave = cave;
    this.modified = false;
  }

  setupPanel() {
    // Defensive default in case the saved config predates this editor.
    if (!this.options.ui.editor.stationDimensions) {
      this.options.ui.editor.stationDimensions = { height: 320, width: 700, columnWidths: {} };
    }
    wm.makeFloatingPanel(
      this.panel,
      (contentElmnt, close) => this.build(contentElmnt, close),
      () => i18n.t('ui.editors.stationDimensions.title', { name: this.cave.name }),
      true,
      true,
      this.options.ui.editor.stationDimensions,
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

    const dimensionsButtons = IconBar.getStationDimensionsButtons(
      () => this.validateDimensions(),
      () => this.updateDimensions(),
      () => this.cancelDimensions(close)
    );
    dimensionsButtons.forEach((button) => this.iconBar.addButton(button));

    const exportButton = IconBar.getExportButton(() => this.table, this.cave.name + ' - station-dimensions.csv');
    exportButton.forEach((button) => this.iconBar.addButton(button));
  }

  getTableData() {
    const rowsToBe = this.cave.stationDimensions.map((sd) => ({
      id      : U.randomAlphaNumbericString(4),
      status  : 'ok',
      message : i18n.t('ui.editors.base.status.ok'),
      station : sd.name,
      left    : sd.left,
      right   : sd.right,
      up      : sd.up,
      down    : sd.down
    }));

    const rowsToUpdate = this.getValidationUpdates(rowsToBe);
    rowsToUpdate.forEach((u) => (rowsToBe[rowsToBe.findIndex((r) => r.id === u.id)] = u));

    return rowsToBe;
  }

  getNewStationDimensions() {
    const num = (v) => {
      if (StationDimension.isMissingValue(v)) return undefined;
      const n = typeof v === 'number' ? v : parseFloat(v);
      return isNaN(n) ? undefined : n;
    };
    return this.table
      .getData()
      .map((r) => new StationDimension(r.station, num(r.left), num(r.right), num(r.up), num(r.down)));
  }

  getEmptyRow() {
    return {
      id      : U.randomAlphaNumbericString(4),
      status  : 'incomplete',
      message : i18n.t('ui.editors.base.message.incomplete'),
      station : undefined,
      left    : undefined,
      right   : undefined,
      up      : undefined,
      down    : undefined
    };
  }

  validateDimensions() {
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
    const existingStationIds = new Set();
    const stationNames = new Set([...this.cave.stations.keys()]);

    const errorMessages = {
      notNumeric : (field) =>
        i18n.t('ui.editors.stationDimensions.message.notNumeric', {
          field : i18n.t('ui.editors.stationDimensions.columns.' + field)
        }),
      negative : (field) =>
        i18n.t('ui.editors.stationDimensions.message.negativeValue', {
          field : i18n.t('ui.editors.stationDimensions.columns.' + field)
        })
    };

    data.forEach((r) => {
      // Build a transient StationDimension carrying raw row values so we can
      // delegate emptiness/value checks to the model and avoid duplicating
      // them here.
      const sd = new StationDimension(r.station, r.left, r.right, r.up, r.down);
      const incompleteFields = sd.getEmptyFields();
      const validationErrors = sd.validate().map(({ type, field }) => errorMessages[type](field));

      if (r.station && !stationNames.has(r.station)) {
        validationErrors.push(i18n.t('ui.editors.stationDimensions.message.stationNotFound', { station: r.station }));
      }
      if (r.station && existingStationIds.has(r.station)) {
        validationErrors.push(
          i18n.t('ui.editors.stationDimensions.message.duplicateStationDimension', { station: r.station })
        );
      }
      if (r.station) existingStationIds.add(r.station);

      let newStatus = 'ok';
      let newMessage;
      if (validationErrors.length > 0) {
        newStatus = 'invalid';
        newMessage = validationErrors.join('; ');
      } else if (incompleteFields.length > 0) {
        const translatedFields = incompleteFields.map((f) => i18n.t('ui.editors.stationDimensions.columns.' + f));
        newStatus = 'incomplete';
        newMessage = i18n.t('ui.editors.stationDimensions.message.missingFields', {
          fields : translatedFields.join(',')
        });
      }

      if (newStatus !== r.status || (newStatus !== 'ok' && newMessage !== r.message)) {
        rowsToUpdated.push({ ...r, status: newStatus, message: newMessage });
      }
    });
    return rowsToUpdated;
  }

  cancelDimensions(wmCloseFn) {
    this.modified = false;
    wmCloseFn();
  }

  updateDimensions() {
    if (this.modified) {
      this.validateDimensions();
      this.cave.stationDimensions = this.getNewStationDimensions();
      this.modified = false;
      this.#emitDimensionsChanged();
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

    const nonSplayStationNames = [...this.cave.stations.entries()]
      .filter(([_, s]) => s.type != ShotType.SPLAY)
      .map(([name, _]) => name);

    const lrudTitle = (key) => i18n.t('ui.editors.stationDimensions.columns.' + key);

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
        bottomCalc         : countBadRows,
        headerFilter       : 'list',
        headerFilterParams : { valuesLookup: true, clearable: true }
      },
      {
        title        : i18n.t('ui.editors.stationDimensions.station'),
        field        : 'station',
        width        : 200,
        editor       : 'list',
        editorParams : { values: [...nonSplayStationNames], autocomplete: true, freetext: true },
        headerFilter : 'input',
        bottomCalc   : 'count'
      },
      {
        title  : lrudTitle('left'),
        field  : 'left',
        width  : 100,
        editor : 'input'
      },
      {
        title  : lrudTitle('right'),
        field  : 'right',
        width  : 100,
        editor : 'input'
      },
      {
        title  : lrudTitle('up'),
        field  : 'up',
        width  : 100,
        editor : 'input'
      },
      {
        title  : lrudTitle('down'),
        field  : 'down',
        width  : 100,
        editor : 'input'
      }
    ];
  }

  setupTable(contentElmnt) {
    const tableContainer = U.node`<div id="station-dimensions-table"></div>`;
    contentElmnt.appendChild(tableContainer);

    // eslint-disable-next-line no-undef
    this.table = new Tabulator(tableContainer, {
      data                      : this.getTableData(),
      history                   : true,
      height                    : this.options.ui.editor.stationDimensions.height - 36 - 48 - 5,
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
        // Always set explicitly so transitioning back to 'ok' clears a previously-set color.
        row.getElement().style.backgroundColor = rowData.status === 'invalid' ? '#b99922' : '';
      }
    });

    this.table.on('dataChanged', () => {
      this.modified = true;
    });

    this.table.on('rowMoved', () => {
      this.modified = true;
    });

    this.setupCustomEditMode(['left', 'right', 'up', 'down']);

    this.table.on('columnResized', (column) => {
      const field = column.getField();
      if (field) {
        const width = column.getWidth();
        if (!this.options.ui.editor.stationDimensions.columnWidths) {
          this.options.ui.editor.stationDimensions.columnWidths = {};
        }
        const columnWidths = { ...this.options.ui.editor.stationDimensions.columnWidths };
        columnWidths[field] = width;
        this.options.ui.editor.stationDimensions.columnWidths = columnWidths;
      }
    });

    this.table.on('tableBuilt', () => {
      if (this.options.ui.editor.stationDimensions.columnWidths) {
        const savedWidths = this.options.ui.editor.stationDimensions.columnWidths;
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
    this.updateDimensions();
    super.closeEditor();
  }

  #emitDimensionsChanged() {
    document.dispatchEvent(new CustomEvent('stationDimensionsChanged', { detail: { cave: this.cave } }));
  }
}

export { StationDimensionsEditor };
