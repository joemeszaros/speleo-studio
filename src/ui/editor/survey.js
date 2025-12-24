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

import { Editor } from './base.js';
import { wm } from '../window.js';
import { Shot, ShotType } from '../../model/survey.js';
import * as U from '../../utils/utils.js';
import { i18n } from '../../i18n/i18n.js';
import { IconBar } from './iconbar.js';
import { CoordinateSystemType } from '../../model/geo.js';

export class SurveyEditor extends Editor {

  constructor(options, cave, survey, scene, interactive, panel, unsavedChanges, attributeDefs) {
    super(panel, scene, cave, attributeDefs);
    this.interactive = interactive;
    this.options = options;
    this.survey = survey;
    this.table = undefined;
    this.surveyModified = false;
    this.unsavedChanges = unsavedChanges;
    // without any user integration the survey update button won't work
    if (this.unsavedChanges !== undefined) {
      this.surveyModified = true;
    }

    document.addEventListener('surveyRecalculated', (e) => this.onSurveyRecalculated(e));
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
          i18n.t('ui.editors.survey.errors.invalidShotIdsMismatch', {
            surveyIds : [...this.survey.invalidShotIds].join(','),
            rowIds    : invalidShotIdsArray.join(',')
          })
        );
      }
      if (invalidShotIds.size > 0 || survey.orphanShotIds.size > 0 || survey.duplicateShotIds.size > 0) {
        let invalidMessage = '';
        if (invalidShotIds.size > 0) {
          invalidMessage = i18n.t('ui.editors.base.message.invalidRowWithIds', {
            nrBadRows : invalidShotIds.size,
            badRowIds : invalidShotIdsArray.slice(0, 15).join(',')
          });
        }
        let orphanMessage = '';
        if (survey.orphanShotIds.size > 0) {
          const first15Ids = [...survey.orphanShotIds.values()].slice(0, 15);
          orphanMessage = i18n.t('ui.editors.survey.message.orphanRowWithIds', {
            nrOrphanRows : survey.orphanShotIds.size,
            orphanRowIds : first15Ids.join(',')
          });
        }
        let duplicateMessage = '';
        if (survey.duplicateShotIds.size > 0) {
          const first15Ids = [...survey.duplicateShotIds.values()].slice(0, 15);
          duplicateMessage = i18n.t('ui.editors.survey.message.duplicateRowWithIds', {
            nrDuplicateRows : survey.duplicateShotIds.size,
            duplicateRowIds : first15Ids.join(',')
          });
        }
        this.showAlert(
          `${invalidMessage}<br>${orphanMessage}<br>${duplicateMessage}<br>${i18n.t('ui.editors.common.error.checkWarningIcon')}`,
          7
        );
      }

      this.table.replaceData(tableRows);
    }
  }

  updateShots() {
    this.survey.updateShots(this.getNewShots());
  }

  getNewShots() {
    return this.table
      .getData()
      .map((r) => new Shot(r.id, r.type, r.from, r.to, r.length, r.azimuth, r.clino, r.comment));
  }

  validateSurvey(showAlert = true) {
    const data = this.table.getData();
    const rowsToUpdated = this.getValidationUpdates(data);
    if (rowsToUpdated.length > 0) {
      this.table.updateData(rowsToUpdated);
      const badRowIds = rowsToUpdated
        .filter((r) => ['invalid', 'incomplete'].includes(r.status))
        .map((r) => `id: ${r.id + 1} (${r.from} -> ${r.to})`);
      if (badRowIds.length > 0 && showAlert) {
        this.showAlert(
          i18n.t('ui.editors.survey.message.invalidRowWithIds', {
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

    data.forEach((r) => {
      const shot = new Shot(r.id, r.type, r.from, r.to, r.length, r.azimuth, r.clino);
      const emptyFields = shot.getEmptyFields();
      const oldStatus = r.status;
      let validationErrors = [];
      if (emptyFields.length > 0) {
        const newRow = { ...r };
        const translatedFields = emptyFields.map((f) => i18n.t('ui.editors.survey.columns.' + f));
        newRow.status = 'incomplete';
        newRow.message = i18n.t('ui.editors.survey.message.missingFields', { fields: translatedFields.join(',') });
        rowsToUpdated.push(newRow);
      } else {
        const shotErrors = shot.validate(i18n);
        validationErrors.push(...shotErrors);
        if (validationErrors.length > 0) {
          const status = 'invalid';
          const newRow = { ...r };
          newRow.status = status;
          newRow.message = i18n.t('ui.editors.base.status.invalid', { errors: validationErrors.join('<br>') });
          rowsToUpdated.push(newRow);
        }
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

  cancelSurvey(wmCloseFn) {
    this.surveyModified = false;
    this.unsavedChanges = undefined;
    wmCloseFn(); // this is the window manager close function to remove the window from the active window list
  }

  updateSurvey() {

    if (this.surveyModified) {

      this.updateShots();
      this.#emitSurveyChanged();
      this.surveyModified = false;
    }

    this.unsavedChanges = undefined;
    this.#emitSurveyDataUpdated();
  }

  closeEditor() {
    this.updateSurvey();
    super.closeEditor();
  }

  #getTableData(survey, stations) {

    if (this.unsavedChanges !== undefined) {
      return this.unsavedChanges;
    }

    // Helper function to get all attributes for the station
    const getAttributesForStation = (stationName) => {
      const attributes = [];

      if (!stationName) return attributes;

      // Get station attributes
      if (this.cave.attributes) {
        if (this.cave.attributes.stationAttributes) {
          this.cave.attributes.stationAttributes.forEach((sa) => {
            if (sa?.name === stationName && sa.attribute) {
              attributes.push(sa.attribute);
            }
          });
        }
        if (this.cave.attributes.componentAttributes) {
          this.cave.attributes.componentAttributes.forEach((ca) => {
            if (ca?.component?.path?.some((p) => p.from === stationName || p.to === stationName) && ca.attribute) {
              attributes.push(ca.attribute);
            }
          });
        }

        if (this.cave.attributes.sectionAttributes) {
          this.cave.attributes.sectionAttributes.forEach((sa) => {
            if (sa?.section?.path?.includes(stationName) && sa.attribute) {
              attributes.push(sa.attribute);
            }
          });
        }
      }
      return attributes;
    };

    const rows = survey.shots.map((sh) => {
      const toStation = stations.get(survey.getToStationName(sh));

      // Get attributes for both from and to stations
      const attributes = toStation ? getAttributesForStation(sh.to) : [];

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
        message    : i18n.t('ui.editors.base.status.ok'),
        attributes : attributes,
        x          : toStation?.position?.x,
        y          : toStation?.position?.y,
        z          : toStation?.position?.z,
        wgslat     : toStation?.coordinates?.wgs?.lat,
        wgslon     : toStation?.coordinates?.wgs?.lon
      };

      const projected = toStation?.coordinates?.projected;
      if (this.cave.geoData?.coordinateSystem?.type === CoordinateSystemType.EOV) {
        rowToBe.eovy = projected?.y;
        rowToBe.eovx = projected?.x;
        rowToBe.elevation = projected?.elevation;
      } else if (this.cave.geoData?.coordinateSystem?.type === CoordinateSystemType.UTM) {
        rowToBe.easting = projected?.easting;
        rowToBe.northing = projected?.northing;
        rowToBe.elevation = projected?.elevation;
      }

      return rowToBe;
    });

    survey.orphanShotIds.forEach((id) => {
      const row = rows[rows.findIndex((r) => r.id === id)];
      row.status = 'orphan';
      row.message = i18n.t('ui.editors.base.status.orphan');
    });
    survey.duplicateShotIds.forEach((id) => {
      const row = rows[rows.findIndex((r) => r.id === id)];
      row.status = 'duplicate';
      row.message = i18n.t('ui.editors.base.status.duplicate');
    });

    const rowsToUpdate = this.getValidationUpdates(rows);
    rowsToUpdate.forEach((u) => (rows[rows.findIndex((r) => r.id === u.id)] = u));

    return rows;
  }

  getEmptyRow() {
    const data = this.table.getData();
    const id = data.length === 0 ? 0 : Math.max(...data.map((r) => r.id));

    const row = {
      id         : id + 1,
      from       : undefined,
      to         : undefined,
      length     : undefined,
      azimuth    : undefined,
      clino      : undefined,
      type       : ShotType.CENTER,
      status     : 'incomplete',
      message    : i18n.t('ui.editors.base.message.incomplete'),
      attributes : [],
      x          : undefined,
      y          : undefined,
      z          : undefined,
      wgslat     : undefined,
      wgslon     : undefined
    };

    if (this.cave.geoData?.coordinateSystem?.type === CoordinateSystemType.EOV) {
      row.eovy = undefined;
      row.eovx = undefined;
      row.elevation = undefined;
    } else if (this.cave.geoData?.coordinateSystem?.type === CoordinateSystemType.UTM) {
      row.easting = undefined;
      row.northing = undefined;
      row.elevation = undefined;
    }

    return row;

  }

  invertRow(row) {
    const data = row.getData();

    // Swap from and to
    const tempFrom = data.from;
    data.from = data.to;
    data.to = tempFrom;

    // Invert azimuth (add 180 degrees and normalize to 0-360)
    if (data.azimuth !== undefined && data.azimuth !== null) {
      if (typeof data.azimuth === 'string') {
        data.azimuth = U.parseMyFloat(data.azimuth);
      }
      data.azimuth = (data.azimuth + 180) % 360;
      if (data.azimuth < 0) data.azimuth += 360;
      data.azimuth = U.roundToThreeDecimalPlaces(data.azimuth);
    }

    // Invert clino (negate the value)
    if (data.clino !== undefined && data.clino !== null) {
      if (typeof data.clino === 'string') {
        data.clino = U.parseMyFloat(data.clino);
      }
      data.clino = -data.clino;
      data.clino = U.roundToThreeDecimalPlaces(data.clino);
    }

    // Update the row data
    row.update(data);

  }

  getSurveyContextMenu() {
    return [
      ...this.baseTableFunctions.getContextMenu(),
      {
        label  : `<span class="invert-row"></span><span>${i18n.t('ui.editors.survey.menu.invertRow')}<span/>`,
        action : (e, row) => {
          this.invertRow(row);
        }
      },
      {
        label  : `<span class="locate-station"></span><span>${i18n.t('ui.editors.survey.menu.locateFrom')}<span/>`,
        action : (e, row) => {
          this.interactive.locateStation(this.cave.name, row.getData().from, false);
        }
      },
      {
        label  : `<span class="locate-station"></span><span>${i18n.t('ui.editors.survey.menu.locateTo')}<span/>`,
        action : (e, row) => {
          this.interactive.locateStation(this.cave.name, row.getData().to, false);
        }
      },
      {
        label  : `<span class="info-row"></span><span>${i18n.t('ui.editors.survey.menu.detailsFrom')}<span/>`,
        action : (e, row) => {
          const d = row.getData();
          const s = this.cave.stations.get(d.from);
          const station = {
            position : s.position,
            name     : d.from,
            meta     : {
              type        : s.type,
              survey      : this.survey,
              shots       : s.shots,
              cave        : this.cave,
              coordinates : s.coordinates
            }
          };
          this.interactive.showStationDetailsPanel(station, e.clientX, e.clientY);
        }
      },
      {
        label  : `<span class="info-row"></span><span>${i18n.t('ui.editors.survey.menu.detailsTo')}<span/>`,
        action : (e, row) => {
          const d = row.getData();
          const s = this.cave.stations.get(d.to);
          const station = {
            position : s.position,
            name     : d.to,
            meta     : {
              type        : s.type,
              survey      : this.survey,
              shots       : s.shots,
              cave        : this.cave,
              coordinates : s.coordinates
            }
          };
          this.interactive.showStationDetailsPanel(station, e.clientX, e.clientY);
        }
      },
      {
        label  : `<span class="prefix-station"></span><span>${i18n.t('ui.editors.survey.menu.prefixStations')}<span/>`,
        action : () => {
          const prefix = prompt(i18n.t('ui.editors.survey.menu.prefixStationsPrompt'));
          if (prefix) {
            this.surveyModified = true;
            const prefxied = this.table.getData().map((row) => {
              if (row.from) {
                row.from = prefix + row.from;
              }
              if (row.to) {
                row.to = prefix + row.to;
              }
              return row;
            });
            this.table.replaceData(prefxied);
          }
        }
      }
    ];
  }
  setupPanel() {
    //TODO: downsize if the table is too wide (settings > viewport)

    wm.makeFloatingPanel(
      this.panel,
      (contentElmnt, close) => this.buildPanel(contentElmnt, close),
      () => i18n.t('ui.editors.survey.title', { name: this.survey.name }),
      true,
      true,
      this.options.ui.editor.survey,
      () => {
        this.closeEditor();
      },
      () => {
        const h = this.panel.offsetHeight - 100;
        this.table.setHeight(h);
      },
      () => this.table.redraw()
    );
  }

  buildPanel(contentElmnt, close) {

    // Create iconbar with common buttons
    this.iconBar = new IconBar(contentElmnt);

    const rcIC = this.iconBar.getRowCountInputContainer();
    // Add common buttons (undo, redo, add row)
    const commonButtons = IconBar.getCommonButtons(() => this.table, {
      getEmptyRow            : () => this.getEmptyRow(),
      rowCountInputContainer : rcIC
    });
    commonButtons.forEach((button) => this.iconBar.addButton(button));

    this.iconBar.addRowCountInput(rcIC);
    this.iconBar.addButton(IconBar.getDeleteButton(() => this.table));

    // Add survey-specific buttons
    const surveyButtons = IconBar.getSurveyButtons(
      () => this.validateSurvey(),
      () => this.updateSurvey(),
      () => this.cancelSurvey(close)
    );
    surveyButtons.forEach((button) => this.iconBar.addButton(button));

    // Add column toggle button
    const columnToggleButton = IconBar.getColumnToggleButton();
    columnToggleButton.forEach((button) => this.iconBar.addButton(button));

    // Add export button
    const exportButton = IconBar.getExportButton(() => this.table, this.cave.name + ' - ' + this.survey.name + '.csv');
    exportButton.forEach((button) => this.iconBar.addButton(button));

    contentElmnt.appendChild(U.node`<div id="surveydata" class="popup-content"></div>`);

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
          return message === undefined ? i18n.t('ui.editors.base.status.ok') : message;
        },
        validator          : ['required'],
        bottomCalc         : this.baseTableFunctions.countBadRows,
        headerFilter       : 'list',
        headerFilterParams : { valuesLookup: true, clearable: true }
      },
      {
        width              : 25,
        title              : i18n.t('ui.editors.survey.columns.type'),
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
        title        : i18n.t('ui.editors.survey.columns.from'),
        field        : 'from',
        editor       : true,
        validator    : ['required'],
        headerFilter : 'input',
        bottomCalc   : countLines
      },
      {
        title        : i18n.t('ui.editors.survey.columns.to'),
        field        : 'to',
        editor       : true,
        validator    : ['required'],
        headerFilter : 'input'
      },
      {
        title        : i18n.t('ui.editors.survey.columns.length'),
        field        : 'length',
        editor       : true,
        headerFilter : 'input',
        accessor     : this.baseTableFunctions.floatAccessor,
        validator    : ['required', 'min:0', customValidator],
        bottomCalc   : sumCenterLines
      },
      {
        title        : i18n.t('ui.editors.survey.columns.azimuth'),
        field        : 'azimuth',
        editor       : true,
        headerFilter : 'input',
        accessor     : this.baseTableFunctions.floatAccessor,
        validator    : ['required', 'min:-360', 'max:360', customValidator]
      },
      {
        title        : i18n.t('ui.editors.survey.columns.clino'),
        field        : 'clino',
        editor       : true,
        headerFilter : 'input',
        accessor     : this.baseTableFunctions.floatAccessor,
        validator    : ['required', 'min:-90', 'max:90', customValidator]
      }
    ];
    const xyz = [
      { field: 'x', title: 'X' },
      { field: 'y', title: 'Y' },
      { field: 'z', title: 'Z' }
    ];

    const projected = [];

    if (this.cave.geoData?.coordinateSystem?.type === CoordinateSystemType.EOV) {
      projected.push({ field: 'eovy', title: 'EOV Y' });
      projected.push({ field: 'eovx', title: 'EOV X' });
      projected.push({ field: 'elevation', title: i18n.t('ui.editors.survey.columns.elevation') });
    } else if (this.cave.geoData?.coordinateSystem?.type === CoordinateSystemType.UTM) {
      projected.push({ field: 'easting', title: i18n.t('ui.editors.survey.columns.easting'), decimals: 3 });
      projected.push({ field: 'northing', title: i18n.t('ui.editors.survey.columns.northing'), decimals: 3 });
      projected.push({ field: 'elevation', title: i18n.t('ui.editors.survey.columns.elevation') });
    }

    const wgs = [
      { field: 'wgslat', title: 'Lat', decimals: 6 },
      { field: 'wgslon', title: 'Lon', decimals: 6 }
    ];

    const coordinateColumns = [...xyz, ...projected, ...wgs];

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
      title            : i18n.t('ui.editors.survey.columns.attributes'),
      field            : 'attributes',
      editor           : false,
      headerFilter     : 'input',
      headerFilterFunc : this.baseTableFunctions.attributesHeaderFilter,
      formatter        : (cell) =>
        this.baseTableFunctions.atrributesFormatter(
          cell,
          (cv) => (cv.attributes === undefined ? [] : cv.attributes),
          i18n
        ),
      accessorClipboard : (value) => this.baseTableFunctions.attributesToClipboard(value),
      accessorDownload  : (value) => this.baseTableFunctions.attributesToClipboard(value),
      mutatorClipboard  : (value) => this.baseTableFunctions.attributesFromClipboard(value)

    });

    columns.push({
      title        : i18n.t('ui.editors.survey.columns.comment'),
      field        : 'comment',
      editor       : true,
      headerFilter : 'input'
    });

    columns.forEach((c) => {
      c.visible = c.field === 'status' || this.options.ui.editor.survey.columns.includes(c.field);
    });

    // eslint-disable-next-line no-undef
    this.table = new Tabulator('#surveydata', {
      history                   : true, //enable undo and redo
      height                    : this.options.ui.editor.survey.height - 36 - 48 - 5, // header + iconbar
      data                      : this.#getTableData(this.survey, this.cave.stations),
      layout                    : 'fitDataStretch',
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
        formatCells   : true
      },
      clipboardCopyRowRange : 'range',
      clipboardPasteParser  : 'range',
      clipboardPasteAction  : 'range',

      rowContextMenu : this.getSurveyContextMenu(),
      rowHeader      : {
        formatter : 'rownum',
        hozAlign  : 'center',
        resizable : true,
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

    // Listen for column resize events and save widths
    this.table.on('columnResized', (column) => {
      const field = column.getField();
      if (field) {
        const width = column.getWidth();
        // Ensure columnWidths object exists
        if (!this.options.ui.editor.survey.columnWidths) {
          this.options.ui.editor.survey.columnWidths = {};
        }
        // Update the width and reassign to ensure proxy detects the change
        const columnWidths = { ...this.options.ui.editor.survey.columnWidths };
        columnWidths[field] = width;
        this.options.ui.editor.survey.columnWidths = columnWidths;
      }
    });

    // Restore column widths after table is fully built
    this.table.on('tableBuilt', () => {
      if (this.options.ui.editor.survey.columnWidths) {
        const savedWidths = this.options.ui.editor.survey.columnWidths;
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

    this.table.on('dataChanged', () => {
      console.log(' data changed ');
      this.surveyModified = true;
      this.#emitSurveyDataEdited();
    });

    this.table.on('rowMoved', () => {
      this.surveyModified = true;
      this.#emitSurveyDataEdited();
    });

    this.setupCustomEditMode(['from', 'to', 'length', 'azimuth', 'clino', 'comment']);

    contentElmnt.appendChild(this.#buildToggleColumnMenu(columns));

  }

  #emitSurveyDataUpdated() {
    const event = new CustomEvent('surveyDataUpdated', {
      detail : {
        survey : this.survey
      }
    });
    document.dispatchEvent(event);
  }

  #emitSurveyChanged() {
    const event = new CustomEvent('surveyChanged', {
      detail : {
        reasons : ['shots'],
        cave    : this.cave,
        survey  : this.survey
      }
    });
    document.dispatchEvent(event);
  }

  #emitSurveyDataEdited() {
    const event = new CustomEvent('surveyDataEdited', {
      detail : {
        survey : this.survey,
        cave   : this.cave,
        data   : this.table.getData()
      }
    });
    document.dispatchEvent(event);
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
            // columns.push(column.field) does not trigger a config change event
            const newColumns = [...this.options.ui.editor.survey.columns, column.field];
            this.options.ui.editor.survey.columns = newColumns;
          }
          icon.textContent = '☑';
        } else {
          if (this.options.ui.editor.survey.columns.includes(column.field)) {
            const newColumns = [...this.options.ui.editor.survey.columns.filter((c) => c !== column.field)];
            // direct splice does not trigger a config change event
            this.options.ui.editor.survey.columns = newColumns;
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
