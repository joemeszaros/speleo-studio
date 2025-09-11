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
    const commentsButtons = IconBar.getStationCommentsButtons(() => this.updateComments());
    commentsButtons.forEach((button) => this.iconBar.addButton(button));
  }

  getTableData() {
    return this.cave.stationComments.map((sc) => ({
      station : sc.name,
      comment : sc.comment
    }));
  }

  getNewStationComments() {
    return this.table.getData().map((r) => new StationComment(r.station, r.comment));
  }

  getEmptyRow() {
    return {
      station : '',
      comment : ''
    };
  }

  updateComments() {

    if (this.modified) {

      this.cave.stationComments = this.getNewStationComments();
      this.modified = false;
      this.#emitSurveyCommentsChanged();
    }

  }

  getColumns() {
    return [
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
