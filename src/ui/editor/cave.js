import * as U from '../../utils/utils.js';
import { CaveMetadata, Cave } from '../../model/cave.js';
import { wm } from '../window.js';
import { showErrorPanel } from '../popups.js';
import { Editor } from './base.js';
import { GeoData, EOVCoordinateWithElevation, CoordinateSytem, StationWithCoordinate } from '../../model/geo.js';
import { SurveyAlias, ShotType } from '../../model/survey.js';
import { i18n } from '../../i18n/i18n.js';

class CaveEditor extends Editor {
  constructor(db, options, cave, scene, panel) {
    super(panel, scene, cave, undefined); // no attributes thus attributeDefs is undefined
    this.db = db;
    this.options = options;
    this.graph = undefined; // sort of a lazy val
    document.addEventListener('languageChanged', () => this.setupPanel());
  }

  #emitCaveAdded() {
    const event = new CustomEvent('caveAdded', {
      detail : {
        cave : this.cave
      }
    });
    document.dispatchEvent(event);
  }

  #emitCaveRenamed(oldName, cave) {
    const event = new CustomEvent('caveRenamed', {
      detail : {
        oldName : oldName,
        cave    : cave
      }
    });
    document.dispatchEvent(event);
  }

  setupPanel() {
    wm.makeFloatingPanel(
      this.panel,
      (contentElmnt) => this.build(contentElmnt),
      () => i18n.t('ui.editors.caveSheet.title', { name: this.cave?.name ?? i18n.t('ui.editors.caveSheet.titleNew') }),
      false,
      false,
      {},
      () => this.closeEditor()
    );

  }

  build(contentElmnt) {
    this.#setupEditor(contentElmnt);
    this.#setupStats(contentElmnt);

  }

  #setupEditor(contentElmnt) {
    this.caveHasChanged = false;
    this.metadataHasChanged = false;

    this.caveData = {
      name     : this.cave?.name ?? '',
      metadata : {
        settlement   : this.cave?.metadata?.settlement ?? '',
        catasterCode : this.cave?.metadata?.catasterCode ?? '',
        date         : this.cave?.metadata?.date ? U.formatDateISO(this.cave.metadata.date) : '',
        country      : this.cave?.metadata?.country ?? '',
        region       : this.cave?.metadata?.region ?? '',
        creator      : this.cave?.metadata?.creator ?? ''

      },
      coordinates :
        this.cave?.geoData?.coordinates.map((c) => {
          return {
            name      : c.name,
            y         : c.coordinate.y,
            x         : c.coordinate.x,
            elevation : c.coordinate.elevation
          };
        }) ?? [],
      aliases:
        this.cave?.aliases?.map((a) => {
          return {
            from : a.from,
            to   : a.to
          };
        }) ?? []

    };

    const form = U.node`<form class="editor"></form>`;

    // Create 2-column layout
    const formGrid = U.node`<div class="sheet-editor-grid"></div>`;
    form.appendChild(formGrid);

    // Column 1: Name and Settlement
    const column1 = U.node`<div class="sheet-editor-column"></div>`;
    formGrid.appendChild(column1);

    // Column 2: Cataster Code and Date
    const column2 = U.node`<div class="sheet-editor-column"></div>`;
    formGrid.appendChild(column2);

    // Helper function to create form field
    const createField = (f, container) => {
      const value = f.id === 'name' ? this.caveData.name : (this.caveData.metadata[f.id] ?? '');
      const input = U.node`<input type="${f.type}" id="${f.id}" name="${f.id}" value="${value}" ${f.required ? 'required' : ''}>`;
      input.oninput = (e) => {
        if (f.id === 'name') {
          if (this.caveData.name !== e.target.value) {
            this.caveHasChanged = true;
          }
          this.caveData.name = e.target.value;
        } else {
          if (this.caveData.metadata[f.id] === undefined) {
            this.metadataHasChanged = true;
            this.caveHasChanged = true;
          } else if (this.caveData.metadata[f.id] !== e.target.value) {
            this.metadataHasChanged = true;
            this.caveHasChanged = true;
          }
          this.caveData.metadata[f.id] = e.target.value;
        }
      };
      const label = U.node`<label class="sheet-editor-label" for="${f.id}">${f.label}: </label>`;
      const fieldContainer = U.node`<div class="sheet-editor-field"></div>`;
      fieldContainer.appendChild(label);
      fieldContainer.appendChild(input);
      container.appendChild(fieldContainer);
    };

    // Column 1: Name and Settlement
    createField(
      {
        label    : i18n.t('ui.editors.caveSheet.fields.name'),
        id       : 'name',
        type     : 'text',
        required : true
      },
      column1
    );

    // Column 2: Cataster Code and Date
    createField(
      {
        label    : i18n.t('ui.editors.caveSheet.fields.catasterCode'),
        id       : 'catasterCode',
        type     : 'text',
        required : true
      },
      column1
    );

    createField(
      {
        label    : i18n.t('ui.editors.caveSheet.fields.date'),
        id       : 'date',
        type     : 'date',
        required : true
      },
      column1
    );

    createField(
      {
        label    : i18n.t('ui.editors.caveSheet.fields.creator'),
        id       : 'creator',
        type     : 'text',
        required : true
      },
      column1
    );

    createField(
      {
        label    : i18n.t('ui.editors.caveSheet.fields.country'),
        id       : 'country',
        type     : 'text',
        required : false
      },
      column2
    );

    createField(
      {
        label    : i18n.t('ui.editors.caveSheet.fields.region'),
        id       : 'region',
        type     : 'text',
        required : false
      },
      column2
    );

    createField(
      {
        label    : i18n.t('ui.editors.caveSheet.fields.settlement'),
        id       : 'settlement',
        type     : 'text',
        required : false
      },
      column2
    );

    const coordsDiv = U.node`<div class="coords-section"><b>${i18n.t('ui.editors.caveSheet.fields.eovCoordinates')}:</b><br/><br/></div>`;
    this.coordsList = U.node`<div class="coords-list"></div>`;
    coordsDiv.appendChild(this.coordsList);
    form.appendChild(coordsDiv);
    this.renderCoords();

    const getStationOptions = () => {
      if (this.cave === undefined) {
        return '';
      }
      const stationNames = this.db.getStationNames(this.caveData.name, (s) => s.type !== ShotType.SPLAY);
      return stationNames
        .map((name) => `<option station="${name}" value="${name}">`)
        .join('');
    };

    this.aliasesDiv = U.node`<div class="aliases-section"><b>${i18n.t('ui.editors.caveSheet.fields.surveyAliases')}:</b><br/><br/></div>`;
    this.aliasesList = U.node`<div class="aliases-list" style="display: inline-block;"></div>`;
    const dataList = U.node`<datalist id="station-names">${getStationOptions()}</datalist>`;
    this.aliasesDiv.appendChild(this.aliasesList);
    this.aliasesDiv.appendChild(dataList);
    form.appendChild(this.aliasesDiv);
    this.renderAliases();

    const saveBtn = U.node`<button type="submit">${i18n.t('common.save')}</button>`;
    const cancelBtn = U.node`<button type="button">${i18n.t('common.cancel')}</button>`;
    cancelBtn.onclick = (e) => {
      e.preventDefault();
      this.closeEditor();
    };
    form.appendChild(saveBtn);
    form.appendChild(cancelBtn);

    form.onsubmit = (e) => {
      e.preventDefault();

      if (this.caveHasChanged) {

        const nameHasChanged = this.caveData.name !== this.cave?.name;
        if (
          this.db.getCave(this.caveData.name) !== undefined &&
          nameHasChanged &&
          this.caveData.name !== this.cave?.name
        ) {
          showErrorPanel(i18n.t('ui.editors.caveSheet.messages.caveNameAlreadyExists', { name: this.caveData.name }));
        }

        const caveMetadata = new CaveMetadata(
          this.caveData.metadata.country,
          this.caveData.metadata.region,
          this.caveData.metadata.settlement,
          this.caveData.metadata.catasterCode,
          new Date(this.caveData.metadata.date),
          this.caveData.metadata.creator
        );
        let geoData;
        if (this.caveData.coordinates.length > 0) {
          geoData = undefined;
        } else {
          geoData = new GeoData(
            CoordinateSytem.EOV,
            this.caveData.coordinates.map(
              (c) =>
                new StationWithCoordinate(
                  c.name,
                  new EOVCoordinateWithElevation(U.parseMyFloat(c.y), U.parseMyFloat(c.x), U.parseMyFloat(c.elevation))
                )
            )
          );
        }

        // validate coordinates
        let errors = [];
        geoData.coordinates.forEach((coord) => {
          const coordErrors = coord.coordinate.validate();
          if (coordErrors.length > 0) {
            errors.push(...coordErrors);
          }
          if (coord.name == undefined || coord.name.trim() === '') {
            errors.push(i18n.t('ui.editors.caveSheet.errors.emptyStationName', { name: coord.name }));
          }
        });
        if (errors.length > 0) {
          showErrorPanel(i18n.t('ui.editors.caveSheet.errors.invalidCoordinates') + '<br>' + errors.join('<br><br>'));
          return;
        }

        const aliases = this.caveData.aliases.map((a) => new SurveyAlias(a.from, a.to));

        errors = [];
        aliases.forEach((a) => {

          if (a.from === a.to && a.from !== undefined && a.from !== '') {
            errors.push(i18n.t('ui.editors.caveSheet.errors.aliasFromToSame', { from: a.from, to: a.to }));
          }

        });

        if (errors.length > 0) {
          errors = [...new Set(errors)];
          showErrorPanel(i18n.t('ui.editors.caveSheet.errors.invalidAliases') + '<br>' + errors.join('<br>'));
          return;
        }

        if (this.cave === undefined) {
          this.cave = new Cave(this.caveData.name, caveMetadata, geoData);
          this.cave.aliases = aliases;
          this.#emitCaveAdded();

        } else {
          if (nameHasChanged) {
            const oldName = this.cave.name;
            this.db.renameCave(oldName, this.caveData.name);
            this.#emitCaveRenamed(oldName, this.cave);
          }

          const aliasesHasChanged =
            this.cave.aliases.length !== aliases.length || this.cave.aliases.some((a, i) => !a.isEqual(aliases[i]));

          this.cave.aliases = aliases;

          const oldGeoData = this.cave.geoData;
          this.cave.metadata = caveMetadata;
          this.cave.geoData = geoData;

          // deleting an eov coordinate will change the survey data
          // an alias can change survey data
          if (
            this.metadataHasChanged ||
            ((aliasesHasChanged || !this.cave.geoData.isEqual(oldGeoData)) && this.cave.surveys.length > 0)
          ) {
            const reasons = [];
            if (this.metadataHasChanged) {
              reasons.push('metadata');
            }
            if (aliasesHasChanged) {
              reasons.push('alias');
            }
            if (this.cave.geoData && !this.cave.geoData.isEqual(oldGeoData)) {
              reasons.push('geodata');
            }
            document.dispatchEvent(
              new CustomEvent('surveyChanged', {
                detail : {
                  reasons : reasons,
                  cave    : this.cave,
                  survey  : this.cave.surveys[0]
                }
              })
            );
          }

        }
      }
      this.closeEditor();

    };
    contentElmnt.appendChild(form);
  }

  renderAliases() {
    this.renderListEditor({
      container : this.aliasesList,
      items     : this.caveData.aliases,
      fields    : [],
      nodes     : [
        {
          key  : 'from',
          node : '<input required placeholder="From" type="search" list="station-names" id="station-alias-from" style="width: 100px;"/>'
        },
        {
          key  : 'to',
          node : '<input required placeholder="To" type="search" list="station-names" id="station-alias-to" style="width: 100px;"/>'
        }
      ],
      onAdd : () => {
        this.caveData.aliases.push({ from: '', to: '' });
        this.renderAliases();
        this.caveHasChanged = true;
      },
      onRemove : (idx) => {
        this.caveData.aliases.splice(idx, 1);
        this.renderAliases();
        this.caveHasChanged = true;
      },
      onChange : (idx, key, value) => {

        if (this.caveData.aliases[idx][key] !== value) {
          this.caveHasChanged = true;
        }
        this.caveData.aliases[idx][key] = value;
      },
      addButtonLabel : i18n.t('ui.editors.caveSheet.buttons.addAlias')
    });
  }

  renderCoords() {
    this.renderListEditor({
      container : this.coordsList,
      items     : this.caveData.coordinates,
      fields    : [
        {
          key         : 'name',
          placeholder : i18n.t('ui.editors.caveSheet.fields.stationName'),
          type        : 'text',
          width       : '120px',
          required    : true
        },
        {
          key         : 'y',
          placeholder : i18n.t('ui.editors.caveSheet.fields.eovy'),
          type        : 'number',
          step        : '0.01',
          width       : '100px',
          required    : true
        },
        {
          key         : 'x',
          placeholder : i18n.t('ui.editors.caveSheet.fields.eovx'),
          type        : 'number',
          step        : '0.01',
          width       : '100px',
          required    : true
        },
        {
          key         : 'elevation',
          placeholder : i18n.t('ui.editors.caveSheet.fields.eovelevation'),
          type        : 'number',
          step        : '0.01',
          width       : '100px',
          required    : true
        }
      ],
      nodes : [],
      onAdd : () => {
        this.caveData.coordinates.push({ name: '', y: '', x: '', elevation: '' });
        this.renderCoords();
        this.caveHasChanged = true;
      },
      onRemove : (idx) => {
        this.caveData.coordinates.splice(idx, 1);
        this.renderCoords();
        this.caveHasChanged = true;
      },
      onChange : (idx, key, value) => {
        if (this.caveData.coordinates[idx][key] !== value) {
          this.caveHasChanged = true;
        }
        this.caveData.coordinates[idx][key] = value;
      },
      addButtonLabel : i18n.t('ui.editors.caveSheet.buttons.addCoordinate')
    });
  }

  #setupStats(contentElmnt) {
    const statFields = U.node`<div class="cave-stats"></div>`;
    const stats = this.cave?.getStats();

    [
      {
        id        : 'length',
        label     : i18n.t('ui.editors.caveSheet.stats.length'),
        field     : 'length',
        bold      : true,
        formatter : (v) => v.toFixed(2) + ' m'
      },
      {
        id        : 'depth',
        label     : i18n.t('ui.editors.caveSheet.stats.depth'),
        field     : 'depth',
        bold      : true,
        formatter : (v) => v.toFixed(2) + ' m'
      },
      {
        id        : 'height',
        label     : i18n.t('ui.editors.caveSheet.stats.height'),
        field     : 'height',
        bold      : true,
        formatter : (v) => v.toFixed(2) + ' m'
      },
      {
        id        : 'vertical',
        label     : i18n.t('ui.editors.caveSheet.stats.vertical'),
        field     : 'vertical',
        bold      : true,
        formatter : (v) => v.toFixed(2) + ' m'
      },

      { break: true },
      { break: true },

      { id: 'stations', label: i18n.t('ui.editors.caveSheet.stats.stations'), field: 'stations', formatter: (v) => v },
      { id: 'surveys', label: i18n.t('ui.editors.caveSheet.stats.surveys'), field: 'surveys', formatter: (v) => v },
      { id: 'splays', label: i18n.t('ui.editors.caveSheet.stats.splays'), field: 'splays', formatter: (v) => v },
      { id: 'isolated', label: i18n.t('ui.editors.caveSheet.stats.isolated'), field: 'isolated', formatter: (v) => v },
      { break: true },
      {
        id        : 'stationAttributes',
        label     : i18n.t('ui.editors.caveSheet.stats.stationAttributes'),
        field     : 'stationAttributes',
        formatter : (v) => v
      },
      {
        id        : 'sectionAttributes',
        label     : i18n.t('ui.editors.caveSheet.stats.sectionAttributes'),
        field     : 'sectionAttributes',
        formatter : (v) => v
      },
      {
        id        : 'componentAttributes',
        label     : i18n.t('ui.editors.caveSheet.stats.componentAttributes'),
        field     : 'componentAttributes',
        formatter : (v) => v
      },
      { break: true },
      {
        id        : 'orphanLength',
        label     : i18n.t('ui.editors.caveSheet.stats.orphanLength'),
        field     : 'orphanLength',
        formatter : (v) => v.toFixed(2) + ' m'
      },
      {
        id        : 'invalidLength',
        label     : i18n.t('ui.editors.caveSheet.stats.invalidLength'),
        field     : 'invalidLength',
        formatter : (v) => v.toFixed(2) + ' m'
      },
      {
        id        : 'auxiliaryLength',
        label     : i18n.t('ui.editors.caveSheet.stats.auxiliaryLength'),
        field     : 'auxiliaryLength',
        formatter : (v) => v.toFixed(2) + ' m'
      },
      { break: true },
      {
        id        : 'minZ',
        label     : i18n.t('ui.editors.caveSheet.stats.minZ'),
        field     : 'minZ',
        formatter : (v) => v.toFixed(2) + ' m'
      },
      {
        id        : 'maxZ',
        label     : i18n.t('ui.editors.caveSheet.stats.maxZ'),
        field     : 'maxZ',
        formatter : (v) => v.toFixed(2) + ' m'
      },
      {
        id        : 'vertiicalWithSplays',
        label     : i18n.t('ui.editors.caveSheet.stats.verticalWithSplays'),
        field     : 'vertiicalWithSplays',
        formatter : (v) => v.toFixed(2) + ' m'
      }
    ].forEach((s) => {
      let node;
      if (s.break) {
        node = U.node`<br>`;
      } else {
        const value = s.formatter(stats?.[s.field] ?? 0);
        node = U.node`<span style="${s.bold ? 'font-weight: bold;' : ''}">${s.label} : ${value}</span>"`;
      }
      statFields.appendChild(node);
    });
    contentElmnt.appendChild(statFields);
    contentElmnt.appendChild(U.node`<hr/>`);
  }
}

export { CaveEditor };
