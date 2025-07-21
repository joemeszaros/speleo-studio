import { OPTIONS } from '../../config.js';
import { Declination } from '../../utils/geo.js';
import { BaseEditor, Editor } from './base.js';
import { SurveyMetadata } from '../../model/survey.js';
import { Shot, StationAttribute } from '../../model.js';
import { showErrorPanel, makeMovable } from '../../ui/popups.js';
import * as U from '../../utils/utils.js';

class SurveyEditor extends Editor {

  constructor(cave, survey, scene, attributeDefs, panel) {
    super(panel, scene, cave, attributeDefs);
    this.survey = survey;
    this.table = undefined;
    this.surveyModified = false;
    document.addEventListener('surveyRecalculated', (e) => this.onSurveyRecalculated(e));
    this.options = OPTIONS;
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
        comment    : sh.comment,
        type       : sh.type,
        status     : 'ok',
        message    : 'No errors',
        attributes : stationAttributes,
        x          : toStation?.position?.x,
        y          : toStation?.position?.y,
        z          : toStation?.position?.z,
        eovy       : toStation?.coordinates?.eov?.y,
        eovx       : toStation?.coordinates?.eov?.x,
        eove       : toStation?.coordinates?.eov?.elevation,
        wgslat     : toStation?.coordinates?.wgs?.lat,
        wgslon     : toStation?.coordinates?.wgs?.lon
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
    const data = this.table.getData();
    const id = data.length === 0 ? 0 : Math.max(...data.map((r) => r.id));

    return {
      id         : id + 1,
      from       : undefined,
      to         : undefined,
      length     : undefined,
      azimuth    : undefined,
      clino      : undefined,
      type       : 'center',
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
    makeMovable(
      this.panel,
      `Survey editor: ${this.survey.name}`,
      true,
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
      },
      {
        id    : 'export-to-csv',
        text  : 'Export to CSV',
        click : () => this.table.download('csv', this.cave.name + ' - ' + this.survey.name + '.csv', { delimiter: ';' })
      },
      { break: true },
      { id: 'undo', text: 'Undo', click: () => this.table.undo() },
      { id: 'redo', text: 'Redo', click: () => this.table.redo() },
      { break: true },
      {
        id    : 'eov-toggle',
        text  : 'Toggle XYZ',
        click : () => {
          this.table.toggleColumn('x');
          this.table.toggleColumn('y');
          this.table.toggleColumn('z');
        }
      },
      {
        id    : 'eov-toggle',
        text  : 'Toggle EOV',
        click : () => {
          this.table.toggleColumn('eovy');
          this.table.toggleColumn('eovx');
          this.table.toggleColumn('eove');
        }
      },
      {
        id    : 'wgs-toggle',
        text  : 'Toggle WGS84',
        click : () => {
          this.table.toggleColumn('wgslat');
          this.table.toggleColumn('wgslon');
        }
      },
      {
        id    : 'comment-toggle',
        text  : 'Toggle comment',
        click : () => {
          this.table.toggleColumn('comment');
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

    const columns = [
      {
        width             : 25,
        title             : '',
        field             : 'status',
        editor            : false,
        download          : false,
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
        title        : 'Splay type',
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
      }
    ];
    const coordinateColumns = [
      { field: 'x', title: 'X' },
      { field: 'y', title: 'Y' },
      { field: 'z', title: 'Z' },
      { field: 'eovy', title: 'EOV Y', visible: false },
      { field: 'eovx', title: 'EOV X', visible: false },
      { field: 'eove', title: 'EOV Z', visible: false },
      { field: 'wgslat', title: 'Lat', visible: false, decimals: 6 },
      { field: 'wgslon', title: 'Lon', visible: false, decimals: 6 }
    ];

    coordinateColumns.forEach((c) => {
      columns.push({
        title            : c.title,
        field            : c.field,
        mutatorClipboard : this.baseTableFunctions.floatAccessor,
        formatter        : this.baseTableFunctions.floatFormatter('', c.decimals),
        editor           : false,
        visible          : c.visible
      });
    });

    columns.push({
      title              : 'Attributes',
      field              : 'attributes',
      visible            : true,
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
    });
    columns.push({
      title        : 'Comment',
      field        : 'comment',
      editor       : true,
      headerFilter : 'input'
    });

    // eslint-disable-next-line no-undef
    this.table = new Tabulator('#surveydata', {
      history                   : true, //enable undo and redo
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

      // pagination
      pagination             : true,
      paginationSize         : this.options.tabulator.paginationSize, // From config.js
      paginationSizeSelector : [this.options.tabulator.paginationSize, 10, 25, 50, 100], // optional: shows the dropdown to select page size
      paginationCounter      : 'rows', // optional: shows the current page size

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
        } else if (rowData.status === 'invalid') {
          row.getElement().style.backgroundColor = '#b99922';
        }

        // we do not set a new background for incomplete rows
      },
      columnDefaults : {
        headerSort     : false,
        headerHozAlign : 'center',
        resizable      : 'header'
      },
      columns : columns
    });

    this.table.on('dataChanged', () => {
      console.log(' data changed ');
      this.surveyModified = true;
    });

  }
}

class SurveySheetEditor extends BaseEditor {

  constructor(db, cave, survey, panel) {
    super(panel);
    this.panel = panel;
    this.db = db;
    this.cave = cave;
    this.survey = survey;
  }

  setupPanel() {
    this.panel.innerHTML = '';
    makeMovable(
      this.panel,
      `Survey sheet editor: ${this.survey.name}`,
      false,
      () => this.closeEditor(),
      () => {},
      () => {}
    );
    this.#setupEditor();
  }

  #setupEditor() {
    const editorFields = U.node`<div class="editor"></div>`;

    [
      { label: 'Name', id: 'name', field: 'name', type: 'text' },
      {
        label : 'Start station',
        id    : 'start',
        field : 'start',
        type  : 'text'
      },
      {
        label       : 'Declination',
        id          : 'declination',
        fieldSource : 'metadata',
        field       : 'declination',
        type        : 'text',
        parser      : (v) => U.parseMyFloat(v)
      },
      {
        label       : 'Mer. Convergence',
        id          : 'convergence',
        fieldSource : 'metadata',
        field       : 'convergence',
        type        : 'text',
        parser      : (v) => U.parseMyFloat(v),
        formatter   : (v) => v.toFixed(3),
        disabled    : true
      },
      {
        label : 'Declination (official)',
        id    : 'declination-official',
        type  : 'text',
        value : ''
      },
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
      let value = i.value;
      if (value === undefined) {
        if (i.fieldSource === 'metadata' && this.survey.metadata !== undefined) {
          value = this.survey.metadata[i.field];
          if (value !== undefined && i.formatter !== undefined) {
            value = i.formatter(value);
          }
        } else {
          if (i.formatter !== undefined) {
            value = i.formatter(this.survey[i.field]);
          } else {
            value = this.survey[i.field];
          }
        }
      }
      const label = U.node`<label for="${i.id}">${i.label}: <input type="${i.type}" id="${i.id}" value="${value}"></label>`;

      if (i.disabled === true) {
        label.childNodes[1].setAttribute('disabled', 'true');
      }

      label.childNodes[1].onchange = (e) => {
        const newValue = e.target.value;
        if (i.fieldSource === 'metadata') {
          const parser = i.parser === undefined ? (v) => v : i.parser;
          if (this.survey.metadata === undefined) {
            this.survey.metadata = new SurveyMetadata();
          }
          this.survey.metadata[i.field] = parser(newValue);
        }

        if (i.id === 'name') {
          if (this.cave.surveys.find((s) => s.name === newValue) !== undefined) {
            showErrorPanel(`Survey with name ${newValue} alreay exists, cannot rename!`);
            e.target.value = this.survey.name;
          } else {
            const oldName = this.survey.name;
            this.db.renameSurvey(this.cave, oldName, newValue);
            this.#emitSurveyRenamed(this.cave, this.survey, oldName);
          }
        } else if (i.id === 'declination') {
          this.#emitSurveyChanged();
        }

      };
      editorFields.appendChild(label);

    });

    const firstStation = this.cave.stations.get(this.survey.start);
    const declinationInput = editorFields.querySelector('#declination-official');
    declinationInput.setAttribute('disabled', 'true');

    if (this.survey.metadata.declinationReal === undefined) {
      if (firstStation.coordinates.wgs !== undefined) {
        Declination.getDeclination(
          firstStation.coordinates.wgs.lat,
          firstStation.coordinates.wgs.lon,
          this.survey.metadata.date
        ).then((declination) => {
          this.survey.metadata.declinationReal = declination;
          declinationInput.value = declination;
        });
      } else {
        declinationInput.value = 'No WGS84 coordinates';
      }
    } else {
      declinationInput.value = this.survey.metadata.declinationReal;
    }

    this.panel.appendChild(editorFields);

    this.panel.appendChild(U.node`<hr/>`);
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

  #emitSurveyRenamed(cave, survey, oldName) {
    const event = new CustomEvent('surveyRenamed', {
      detail : {
        oldName : oldName,
        cave    : cave,
        survey  : survey
      }
    });
    document.dispatchEvent(event);
  }

}

export { SurveyEditor, SurveySheetEditor };
