import { BaseEditor } from './base.js';
import { wm } from '../window.js';
import * as U from '../../utils/utils.js';
import { i18n } from '../../i18n/i18n.js';
import { StationComment } from '../../model/survey.js';
import { IconBar } from './iconbar.js';

class StationCommentsEditor extends BaseEditor {

  constructor(options, cave, panel) {
    super(panel);
    this.options = options;
    this.cave = cave;
    this.modified = false;
  }

  setupPanel() {
    wm.makeFloatingPanel(
      this.panel,
      (contentElmnt) => this.build(contentElmnt),
      () => i18n.t('ui.editors.stationComments.title', { name: this.cave.name }),
      true,
      true,
      this.options.ui.editor.survey,
      () => {
        this.closeEditor();
      },
      () => {
        if (this.table) {
          this.table.redraw(true);
        }
      },
      () => {
        if (this.table) {
          this.table.redraw(true);
        }
      }
    );
  }

  build(contentElmnt) {
    this.setupButtons(contentElmnt);
    this.setupTable(contentElmnt);
  }

  setupButtons(contentElmnt) {
    this.iconBar = new IconBar(contentElmnt);

    // Add common buttons (undo, redo, add row, delete row)
    const commonButtons = IconBar.getCommonButtons(() => this.table, {
      getEmptyRow : () => this.getEmptyRow()
    });
    commonButtons.forEach((button) => this.iconBar.addButton(button));
    const commentsButtons = IconBar.getStationCommentsButtons(
      () => this.validateComments(),
      () => this.updateComments()
    );
    commentsButtons.forEach((button) => this.iconBar.addButton(button));
  }

  getTableData() {
    const rowsToBe = this.cave.stationComments.map((sc) => ({
      id      : U.randomAlphaNumbericString(4),
      status  : 'ok',
      message : i18n.t('ui.editors.base.status.ok'),
      station : sc.name,
      comment : sc.comment
    }));

    const rowsToUpdate = this.getValidationUpdates(rowsToBe);
    rowsToUpdate.forEach((u) => (rowsToBe[rowsToBe.findIndex((r) => r.id === u.id)] = u));

    return rowsToBe;
  }

  getNewStationComments() {
    return this.table.getData().map((r) => new StationComment(r.station, r.comment));
  }

  getEmptyRow() {
    return {
      id      : U.randomAlphaNumbericString(4),
      status  : 'incomplete',
      message : i18n.t('ui.editors.base.message.incomplete'),
      station : undefined,
      comment : undefined
    };
  }

  validateComments() {
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
    const existingCommentIds = new Set();

    data.forEach((r) => {
      const comment = new StationComment(r.station, r.comment);
      const emptyFields = comment.getEmptyFields();
      const oldStatus = r.status;
      let validationErrors = [];
      if (emptyFields.length > 0) {
        const translatedFields = emptyFields.map((f) => i18n.t('ui.editors.stationComments.columns.' + f));
        const newRow = { ...r };
        newRow.status = 'incomplete';
        newRow.message = i18n.t('ui.editors.stationComments.message.missingFields', {
          fields : translatedFields.join(',')
        });
        rowsToUpdated.push(newRow);
      } else {
        if (r.station) {
          if (existingCommentIds.has(r.station)) {
            const newRow = { ...r };
            newRow.status = 'invalid';
            newRow.message = i18n.t('ui.editors.stationComments.message.duplicateStationComment', {
              station : r.station
            });
            rowsToUpdated.push(newRow);
            validationErrors.push(
              i18n.t('ui.editors.stationComments.message.duplicateStationComment', { station: r.station })
            );
          }
        }
      }

      existingCommentIds.add(r.station);

      if (['invalid', 'incomplete'].includes(oldStatus) && emptyFields.length === 0 && validationErrors.length === 0) {
        const newRow = { ...r };
        newRow.status = 'ok';
        newRow.message = undefined;
        rowsToUpdated.push(newRow);
      }

    });
    return rowsToUpdated;
  }

  updateComments() {

    if (this.modified) {

      this.cave.stationComments = this.getNewStationComments();
      this.modified = false;
      this.#emitSurveyCommentsChanged();
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
        title        : i18n.t('ui.editors.stationComments.station'),
        field        : 'station',
        width        : 200,
        editor       : 'list',
        editorParams : { values: [...this.cave.stations.keys()], autocomplete: true },
        validator    : ['required'],
        headerFilter : 'input',
        bottomCalc   : 'count'
      },
      {
        title        : i18n.t('ui.editors.stationComments.comment'),
        field        : 'comment',
        headerFilter : true,
        editor       : 'input'
      }
    ];
  }

  setupTable(contentElmnt) {

    // Create table container
    const tableContainer = U.node`<div id="station-comments-table"></div>`;
    contentElmnt.appendChild(tableContainer);

    this.table = new Tabulator(tableContainer, {
      data                      : this.getTableData(),
      history                   : true, //enable undo and redo
      height                    : this.options.ui.editor.survey.height - 36 - 48, // header + iconbar
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
        resizable : false,
        frozen    : true,
        editor    : false
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

  }

  closeEditor() {
    this.updateComments();

    super.closeEditor();
  }

  #emitSurveyCommentsChanged() {
    document.dispatchEvent(new CustomEvent('surveyCommentsChanged', { detail: { cave: this.cave } }));
  }
}

export { StationCommentsEditor };
