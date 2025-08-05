import { Declination, MeridianConvergence } from '../../utils/geo.js';
import { BaseEditor, Editor } from './base.js';
import { SurveyMetadata, Survey, SurveyTeam, SurveyTeamMember, SurveyInstrument } from '../../model/survey.js';
import { showErrorPanel, makeMovable } from '../../ui/popups.js';
import { Shot, ShotType } from '../../model/survey.js';
import { StationAttribute } from '../../model.js';
import * as U from '../../utils/utils.js';

class SurveyEditor extends Editor {

  constructor(options, cave, survey, scene, attributeDefs, panel) {
    super(panel, scene, cave, attributeDefs);
    this.options = options;
    this.survey = survey;
    this.table = undefined;
    this.surveyModified = false;
    this.eovVisible = false;
    document.addEventListener('surveyRecalculated', (e) => this.onSurveyRecalculated(e));
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
      type       : ShotType.CENTER,
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
      (newWidth, _newHeight) => {
        const h = this.panel.offsetHeight - 100;
        //this.options.ui.editor.survey.height = h;
        //this.options.ui.editor.survey.width = newWidth;
        this.table.setHeight(h); // we cannot use newHeight, because it could be a higher value than max-height
      },

      (newWidth, _newHeight) => {
        const h = this.panel.offsetHeight - 100;
        this.options.ui.editor.survey.height = h;
        this.options.ui.editor.survey.width = newWidth;
        this.table.redraw();
      }
    );

    const iconBar = U.node`<div class="iconbar">`;
    this.panel.appendChild(iconBar);
    [
      { id: 'undo', icon: 'icons/undo.svg', tooltip: 'Undo', click: () => this.table.undo() },
      { id: 'redo', icon: 'icons/redo.svg', tooltip: 'Redo', click: () => this.table.redo() },
      {
        id      : 'add-row',
        icon    : 'icons/add_white.svg',
        tooltip : 'Add row end',
        click   : () => this.table.addRow(this.getEmptyRow())
      },
      {
        id      : 'delete-row',
        tooltip : 'Delete active rows',
        icon    : 'icons/trash_white.svg',
        click   : () => {
          var ranges = this.table.getRanges();
          ranges.forEach((r) => {
            const rows = r.getRows();
            rows.forEach((r) => r.delete());
            r.remove();
          });

        }
      },
      { separator: true },
      {
        id      : 'validate-shots',
        tooltip : 'Validate shots',
        icon    : 'icons/validate.svg',
        click   : () => this.validateSurvey()
      },
      { id: 'update-survey', tooltip: 'Update survey', icon: 'icons/update.svg', click: () => this.updateSurvey() },
      { separator: true },
      {
        id      : 'toggle-column',
        tooltip : 'Toggle columns',
        icon    : 'icons/hamburger.svg',
        click   : (e) => {
          const menuDiv = document.getElementById('toogle-column-visibility-menu');
          if (menuDiv.style.display === 'block') {
            menuDiv.style.display = 'none';
          } else {
            menuDiv.style.display = 'block';

            // Add click outside handler to close menu
            const closeMenu = (event) => {
              if (!menuDiv.contains(event.target) && !e.target.contains(event.target)) {
                menuDiv.style.display = 'none';
                document.removeEventListener('click', closeMenu);
              }
            };

            // Use setTimeout to prevent immediate closure
            setTimeout(() => {
              document.addEventListener('click', closeMenu);
            }, 100);
          }
        }
      },
      { separator: true },
      {
        id      : 'export-to-csv',
        tooltip : 'Export to CSV',
        icon    : 'icons/export.svg',
        click   : () => this.table.download('csv', this.cave.name + ' - ' + this.survey.name + '.csv', { delimiter: ';' })
      }

    ].forEach((b) => {
      let element;
      if (b.separator) {
        element = U.node`<span class="icon-separator"></span>`;
      } else {
        if (b.icon) {
          element = U.node`<a id="${b.id}" class="mytooltip"><img src="${b.icon}" alt="${b.id}" ${b.width ? `style="width:${b.width}px"` : ''}><span class="mytooltiptext">${b.tooltip}</span></a>`;
        } else {
          element = U.node`<button id="${b.id}">${b.text}</button>`;
        }
        element.onclick = (e) => {
          b.click(e);
        };
      }
      iconBar.appendChild(element);

    });

    this.panel.appendChild(U.node`<div id="surveydata" class="popup-content"></div>`);

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
          sumLength += value.type === ShotType.CENTER ? U.parseMyFloat(value.length) : 0;
        }
      });

      return sumLength.toFixed(2);
    };

    const typeIcon = (cell) => {
      const data = cell.getData();
      if (data.type === ShotType.CENTER) {
        return '<div class="center-row"></div>';
      } else if (data.type === ShotType.SPLAY) {
        return '<div class="splay-row"></div>';
      } else if (data.type === ShotType.AUXILIARY) {
        return '<div class="auxiliary-row"></div>';
      }
    };

    const typeEdited = (cell) => {
      cell.getRow().reformat();
    };

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
        validator          : ['required'],
        bottomCalc         : this.baseTableFunctions.countBadRows,
        headerFilter       : 'list',
        headerFilterParams : { valuesLookup: true, clearable: true }
      },
      {
        width              : 25,
        title              : 'Type',
        field              : 'type',
        editor             : 'list',
        editorParams       : { values: [ShotType.CENTER, ShotType.SPLAY, ShotType.AUXILIARY] },
        formatter          : typeIcon,
        cellEdited         : typeEdited,
        validator          : ['required'],
        headerFilter       : true,
        headerFilterParams : { values: [ShotType.CENTER, ShotType.SPLAY, ShotType.AUXILIARY] }

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
      { field: 'eovy', title: 'EOV Y' },
      { field: 'eovx', title: 'EOV X' },
      { field: 'eove', title: 'EOV Z' },
      { field: 'wgslat', title: 'Lat', decimals: 6 },
      { field: 'wgslon', title: 'Lon', decimals: 6 }
    ];

    coordinateColumns.forEach((c) => {
      columns.push({
        title            : c.title,
        field            : c.field,
        mutatorClipboard : this.baseTableFunctions.floatAccessor,
        formatter        : this.baseTableFunctions.floatFormatter('', c.decimals),
        editor           : false
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
      accessorDownload   : (value) => this.baseTableFunctions.attributesToClipboard(value, (v) => v),
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

    columns.forEach((c) => {
      c.visible = c.field === 'status' || this.options.ui.editor.survey.columns.includes(c.field);
    });

    this.panel.style.width = this.options.ui.editor.survey.width + 'px';
    // eslint-disable-next-line no-undef
    this.table = new Tabulator('#surveydata', {
      history                   : true, //enable undo and redo
      height                    : this.options.ui.editor.survey.height,
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
      // pagination             : true,
      // paginationSize         : this.options.tabulator.paginationSize, // From config.js
      // paginationSizeSelector : [this.options.tabulator.paginationSize, 10, 25, 50, 100], // optional: shows the dropdown to select page size
      // paginationCounter      : 'rows', // optional: shows the current page size

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
          if (rowData.type === ShotType.SPLAY) {
            row.getElement().style.backgroundColor = '#6a9630';
          } else if (rowData.type === ShotType.AUXILIARY) {
            row.getElement().style.backgroundColor = '#1a0d3a';
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

    this.panel.appendChild(this.#buildToggleColumnMenu(columns));

  }

  #buildToggleColumnMenu(columns) {

    const menuDiv = U.node`<div id="toogle-column-visibility-menu"></div>`;

    for (let column of columns) {

      if (column.field === 'status' || column.field === '') {
        continue;
      }

      //create checkbox element using unicode characters
      let icon = document.createElement('span');
      icon.textContent = (column.visible ?? true) ? '☑' : '☐';
      icon.style.fontSize = '16px';

      //build label
      let label = document.createElement('span');
      let title = document.createElement('span');

      title.textContent = ' ' + column.title;

      label.appendChild(icon);
      label.appendChild(title);
      label.onclick = (e) => {

        //prevent menu closing
        e.stopPropagation();

        //toggle current column visibility
        this.table.toggleColumn(column.field);

        //change menu item icon based on current visibility
        const columnDef = this.table.getColumn(column.field);
        if (columnDef && columnDef.isVisible()) {
          if (!this.options.ui.editor.survey.columns.includes(column.field)) {
            this.options.ui.editor.survey.columns.push(column.field);
          }
          icon.textContent = '☑';
        } else {
          if (this.options.ui.editor.survey.columns.includes(column.field)) {
            this.options.ui.editor.survey.columns.splice(
              this.options.ui.editor.survey.columns.indexOf(column.field),
              1
            );
          }
          icon.textContent = '☐';
        }
      };
      const menuElementDiv = U.node`<div id="toogle-column-visibility-menu-element"></div>`;
      menuElementDiv.appendChild(label);
      menuDiv.appendChild(menuElementDiv);
    }

    return menuDiv;
  }
}

class SurveySheetEditor extends BaseEditor {

  constructor(db, cave, survey, panel) {
    super(panel);
    this.panel = panel;
    this.db = db;
    this.cave = cave;
    this.survey = survey;

    //this.renderMembers = this.renderMembers.bind(this);
    //this.renderInstruments = this.renderInstruments.bind(this);
  }

  setupPanel() {
    this.panel.innerHTML = '';
    makeMovable(
      this.panel,
      `Survey sheet editor: ${this.survey?.name || 'New survey'}`,
      false,
      () => this.closeEditor(),
      () => {},
      () => {}
    );
    this.#setupEditor();
  }

  #setupEditor() {

    this.formData = {
      name        : this.survey?.name || '',
      start       : this.survey?.start || '',
      date        : this.survey?.metadata?.date ? U.formatDateISO(this.survey.metadata.date) : '',
      declination : this.survey?.metadata?.declination || '',
      convergence : this.survey?.metadata?.convergence || '',
      team        : this.survey?.metadata?.team?.name || '',
      members     : (this.survey?.metadata?.team?.members || []).map((m) => ({ name: m.name, role: m.role })),
      instruments : (this.survey?.metadata?.instruments || []).map((i) => ({ name: i.name, value: i.value }))
    };

    const form = U.node`<form class="editor"></form>`;
    const fields = [
      { label: 'Survey Name', id: 'name', type: 'text', required: true },
      { label: 'Start Station', id: 'start', type: 'text' },
      { label: 'Date', id: 'date', type: 'date', required: true },
      { label: 'Declination', id: 'declination', type: 'number', step: 'any', required: true },
      { label: 'Team Name', id: 'team', type: 'text', required: true }
    ];

    this.surveyHasChanged = false;
    this.nameHasChanged = false;

    fields.forEach((f) => {
      let value = this.formData[f.id];
      if (value !== undefined && f.formatter !== undefined) {
        value = f.formatter(value);
      }
      const input = U.node`<input type="${f.type}" id="${f.id}" name="${f.id}" value="${value || ''}" ${f.required ? 'required' : ''} ${f.step ? 'step="' + f.step + '"' : ''}>`;
      input.oninput = (e) => {
        if (this.formData[f.id] !== e.target.value) {
          this.surveyHasChanged = true;
          if (f.id === 'name') {
            this.nameHasChanged = true;
          }
          this.formData[f.id] = e.target.value;
        }
      };
      const label = U.node`<label for="${f.id}">${f.label}: </label>`;
      label.appendChild(input);
      form.appendChild(label);
    });

    form.appendChild(U.node`<br/>`);
    form.appendChild(U.node`<br/>`);
    const columns = U.node`<div class="columns"></div>`;
    form.appendChild(columns);

    const membersDiv = U.node`<div class="team-members-section"><b>Team Members:</b><br/><br/></div>`;
    this.membersList = U.node`<div class="members-list"></div>`;
    membersDiv.appendChild(this.membersList);
    columns.appendChild(membersDiv);
    this.renderMembers();

    const instrumentsDiv = U.node`<div class="instruments-section"><b>Survey Instruments:</b><br/><br/></div>`;
    this.instrumentsList = U.node`<div class="instruments-list"></div>`;
    instrumentsDiv.appendChild(this.instrumentsList);
    columns.appendChild(instrumentsDiv);
    this.renderInstruments();

    const saveBtn = U.node`<button type="submit">Save</button>`;
    const cancelBtn = U.node`<button type="button">Cancel</button>`;
    cancelBtn.onclick = (e) => {
      e.preventDefault();
      this.closeEditor();
    };
    form.appendChild(saveBtn);
    form.appendChild(cancelBtn);

    form.appendChild(
      U.node`<p>Meridian convergence: ${this.survey?.metadata?.convergence?.toFixed(3) || 'Not available'}</p>`
    );
    const declinationText = U.node`<p id="declination-official">Declination: unavailable</p>`;
    form.appendChild(declinationText);

    const startOrFirstStation =
      this.cave.stations.get(this.survey?.start) ?? this.cave.stations.entries().next().value[1];
    const declinationPrefix = 'Declination at the given date for this geo location (from NOAA):';
    if (this.survey?.metadata?.declinationReal === undefined) {
      if (startOrFirstStation?.coordinates.wgs !== undefined) {
        Declination.getDeclination(
          startOrFirstStation.coordinates.wgs.lat,
          startOrFirstStation.coordinates.wgs.lon,
          this.survey.metadata.date
        ).then((declination) => {
          this.survey.metadata.declinationReal = declination;
          declinationText.textContent = `${declinationPrefix} ${declination.toFixed(3)}`;
        });
      } else {
        declinationText.textContent = `${declinationPrefix} No WGS84 coordinates`;
      }
    } else {
      declinationText.textContent = `${declinationPrefix} ${this.survey.metadata.declinationReal.toFixed(3)}`;
    }

    form.onsubmit = (e) => {
      e.preventDefault();

      const teamMembers = this.formData.members.map((m) => new SurveyTeamMember(m.name, m.role));
      const team = new SurveyTeam(this.formData.team, teamMembers);
      const instruments = this.formData.instruments.map((i) => new SurveyInstrument(i.name, i.value));
      const metadata = new SurveyMetadata(
        this.formData.date ? new Date(this.formData.date) : undefined,
        this.formData.declination ? parseFloat(this.formData.declination) : undefined,
        this.formData.convergence ? parseFloat(this.formData.convergence) : undefined,
        team,
        instruments
      );

      if (this.survey !== undefined && this.nameHasChanged && this.formData.name !== this.survey.name) {
        if (this.cave.surveys.find((s) => s.name === this.formData.name) !== undefined) {
          showErrorPanel(`Survey with name ${this.formData.name} alreay exists, cannot rename!`);
          return;
        } else {
          const oldName = this.survey.name;
          this.db.renameSurvey(this.cave, oldName, this.formData.name);
          this.#emitSurveyRenamed(this.cave, this.survey, oldName);
        }
      }

      if ((this.survey?.shots ?? []).length > 0) {
        const hasStart = this.survey.shots.find((s) => s.from === this.formData.start || s.to === this.formData.start);
        if (hasStart === undefined) {
          showErrorPanel(`Start station ${this.formData.start} not found in shots!`);
          return;
        }
      }

      if (this.survey === undefined) {
        // this is a new survey
        if (this.cave.surveys.size > 0) {
          // get convergence from first existing survey
          metadata.convergence = this.cave.surveys.entries().next().value[1].metadata.convergence;
        } else if (this.cave.geoData !== undefined && this.cave.geoData.coordinates.length > 0) {
          //get convergence based on the first fix point of the cave
          const fixPoint = this.cave.geoData.coordinates[0]; // this must be an eov coordinate
          metadata.convergence = MeridianConvergence.getConvergence(fixPoint.coordinate.y, fixPoint.coordinate.x);
        }
        this.survey = new Survey(this.formData.name, true, metadata, this.formData.start);
        this.#emitSurveyAdded();
      } else if (this.surveyHasChanged) {
        this.survey.metadata = metadata;
        this.survey.start = this.formData.start;
        this.#emitSurveyChanged();
      }
      //if (this.onSave) this.onSave(survey);
      this.closeEditor();
    };
    this.panel.appendChild(form);

  }

  renderMembers() {
    this.renderListEditor({
      container : this.membersList,
      items     : this.formData.members,
      fields    : [
        { key: 'name', placeholder: 'Name', type: 'text', width: '120px' },
        { key: 'role', placeholder: 'Role', type: 'text', width: '100px' }
      ],
      onAdd : () => {
        this.formData.members.push({ name: '', role: '' });
        this.renderMembers();
        this.surveyHasChanged = true;
      },
      onRemove : (idx) => {
        this.formData.members.splice(idx, 1);
        this.renderMembers();
        this.surveyHasChanged = true;
      },
      onChange : (idx, key, value) => {
        if (this.formData.members[idx][key] !== value) {
          this.surveyHasChanged = true;
        }
        this.formData.members[idx][key] = value;

      },
      addButtonLabel : 'Add member'
    });
  }

  renderInstruments() {
    this.renderListEditor({
      container : this.instrumentsList,
      items     : this.formData.instruments,
      fields    : [
        { key: 'name', placeholder: 'Instrument Name', type: 'text', width: '140px' },
        { key: 'value', placeholder: 'Value', type: 'text', width: '80px' }
      ],
      onAdd : () => {
        this.formData.instruments.push({ name: '', value: '' });
        this.renderInstruments();
        this.surveyHasChanged = true;
      },
      onRemove : (idx) => {
        this.formData.instruments.splice(idx, 1);
        this.renderInstruments();
        this.surveyHasChanged = true;
      },
      onChange : (idx, key, value) => {
        if (this.formData.instruments[idx][key] !== value) {
          this.surveyHasChanged = true;
        }
        this.formData.instruments[idx][key] = value;

      },
      addButtonLabel : 'Add instrument'
    });
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

  #emitSurveyAdded() {
    const event = new CustomEvent('surveyAdded', {
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
