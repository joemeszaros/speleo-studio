import * as U from '../../utils/utils.js';
import { CaveMetadata, Cave } from '../../model/cave.js';
import { makeMovable, showErrorPanel } from '../popups.js';
import { Editor } from './base.js';
import { GeoData, EOVCoordinateWithElevation, CoordinateSytem, StationWithCoordinate } from '../../model/geo.js';
import { SurveyAlias } from '../../model/survey.js';

class CaveEditor extends Editor {
  constructor(db, options, cave, scene, attributeDefs, panel) {
    super(panel, scene, cave, attributeDefs);
    this.db = db;
    this.options = options;
    this.graph = undefined; // sort of a lazy val
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
    this.panel.innerHTML = '';
    makeMovable(
      this.panel,
      `Cave sheet editor: ${this.cave?.name ?? 'New cave'}`,
      false,
      () => this.closeEditor(),
      () => {},
      () => {}
    );
    this.#setupEditor();
    this.#setupStats();
  }

  #setupEditor() {
    this.caveHasChanged = false;

    this.caveData = {
      name     : this.cave?.name ?? '',
      metadata : {
        settlement   : this.cave?.metadata?.settlement ?? '',
        catasterCode : this.cave?.metadata?.catasterCode ?? '',
        date         : this.cave?.metadata?.date ? U.formatDateISO(this.cave.metadata.date) : ''
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
    const fields = [
      { label: 'Name', id: 'name', type: 'text', required: true },
      { label: 'Settlement', id: 'settlement', type: 'text', required: true },
      { label: 'Cataster code', id: 'catasterCode', type: 'text', required: true },
      { label: 'Date', id: 'date', type: 'date', required: true }
    ];
    fields.forEach((f) => {
      const value = f.id === 'name' ? this.caveData.name : this.caveData.metadata[f.id];
      const input = U.node`<input type="${f.type}" id="${f.id}" name="${f.id}" value="${value}" ${f.required ? 'required' : ''}>`;
      input.oninput = (e) => {
        if (f.id === 'name') {
          if (this.caveData.name !== e.target.value) {
            this.caveHasChanged = true;
          }

          this.caveData.name = e.target.value;
        } else {
          if (this.caveData.metadata[f.id] !== e.target.value) {
            this.caveHasChanged = true;
          }
          this.caveData.metadata[f.id] = e.target.value;
        }
      };
      const label = U.node`<label for="${f.id}">${f.label}: </label>`;
      label.appendChild(input);
      form.appendChild(label);
    });
    form.appendChild(U.node`<br/>`);
    form.appendChild(U.node`<br/>`);

    const coordsDiv = U.node`<div class="coords-section"><b>EOV coordinates:</b><br/><br/></div>`;
    this.coordsList = U.node`<div class="coords-list"></div>`;
    coordsDiv.appendChild(this.coordsList);
    form.appendChild(coordsDiv);
    this.renderCoords();

    const getStationOptions = () => {
      const stationNames = this.db.getStationNames(this.caveData.name);
      return stationNames
        .map((name) => `<option station="${name}" value="${name}">`)
        .join('');
    };

    this.aliasesDiv = U.node`<div class="aliases-section"><b>Survey aliases:</b><br/><br/></div>`;
    this.aliasesList = U.node`<div class="aliases-list" style="display: inline-block;"></div>`;
    const dataList = U.node`<datalist id="station-names">${getStationOptions()}</datalist>`;
    this.aliasesDiv.appendChild(this.aliasesList);
    this.aliasesDiv.appendChild(dataList);
    form.appendChild(this.aliasesDiv);
    this.renderAliases();

    const saveBtn = U.node`<button type="submit">Save</button>`;
    const cancelBtn = U.node`<button type="button">Cancel</button>`;
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
          showErrorPanel(`Cave with name ${this.caveData.name} alreay exists, cannot rename or add!`);
        }

        const caveMetadata = new CaveMetadata(
          this.caveData.metadata.settlement,
          this.caveData.metadata.catasterCode,
          new Date(this.caveData.metadata.date)
        );
        const geoData = new GeoData(
          CoordinateSytem.EOV,
          this.caveData.coordinates.map(
            (c) =>
              new StationWithCoordinate(
                c.name,
                new EOVCoordinateWithElevation(U.parseMyFloat(c.y), U.parseMyFloat(c.x), U.parseMyFloat(c.elevation))
              )
          )
        );

        // validate coordinates
        let errors = [];
        geoData.coordinates.forEach((coord) => {
          const coordErrors = coord.coordinate.validate();
          if (coordErrors.length > 0) {
            errors.push(...coordErrors);
          }
          if (coord.name == undefined || coord.name.trim() === '') {
            errors.push(`Station '${coord.name}' is empty`);
          }
        });
        if (errors.length > 0) {
          showErrorPanel('Invalid coordinates:<br>' + errors.join('<br><br>'));
          return;
        }

        const aliases = this.caveData.aliases.map((a) => new SurveyAlias(a.from, a.to));

        errors = [];
        aliases.forEach((a) => {

          if (a.from === a.to && a.from !== undefined && a.from !== '') {
            errors.push(`Alias from and to cannot be the same: ${a.from} -> ${a.to}`);
          }

        });

        if (errors.length > 0) {
          errors = [...new Set(errors)];
          showErrorPanel('Invalid aliases:<br>' + errors.join('<br>'));
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

          this.cave.aliases = aliases;

          const oldGeoData = this.cave.geoData;
          this.cave.metadata = caveMetadata;
          this.cave.geoData = geoData;

          // deleting an eov coordinate will change the survey data
          if (!this.cave.geoData.isEqual(oldGeoData) && this.cave.surveys.length > 0) {
            document.dispatchEvent(
              new CustomEvent('surveyChanged', {
                detail : {
                  cave   : this.cave,
                  survey : this.cave.surveys[0]
                }
              })
            );
          }

        }
      }
      this.closeEditor();

    };
    this.panel.appendChild(form);
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
      addButtonLabel : 'Add alias'
    });
  }

  renderCoords() {
    this.renderListEditor({
      container : this.coordsList,
      items     : this.caveData.coordinates,
      fields    : [
        { key: 'name', placeholder: 'Station name', type: 'text', width: '120px', required: true },
        { key: 'y', placeholder: 'Y coordinate', type: 'number', step: '0.01', width: '100px', required: true },
        { key: 'x', placeholder: 'X coordinate', type: 'number', step: '0.01', width: '100px', required: true },
        { key: 'elevation', placeholder: 'Elevation', type: 'number', step: '0.01', width: '100px', required: true }
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
      addButtonLabel : 'Add coordinate'
    });
  }

  #setupStats() {
    const statFields = U.node`<div class="cave-stats"></div>`;
    const stats = this.cave?.getStats();

    [
      { id: 'stations', label: 'Stations', field: 'stations', formatter: (v) => v },
      { id: 'surveys', label: 'Surveys', field: 'surveys', formatter: (v) => v },
      { id: 'isolated', label: 'Isolated surveys', field: 'isolated', formatter: (v) => v },
      { id: 'attributes', label: 'Station attributes', field: 'attributes', formatter: (v) => v },
      { break: true },
      { id: 'length', label: 'Length', field: 'length', formatter: (v) => v.toFixed(2) },
      { id: 'orphanLength', label: 'Length (orphan)', field: 'orphanLength', formatter: (v) => v.toFixed(2) },
      { id: 'invalidLength', label: 'Length (invalid)', field: 'invalidLength', formatter: (v) => v.toFixed(2) },
      { id: 'auxiliaryLength', label: 'Length (auxiliary)', field: 'auxiliaryLength', formatter: (v) => v.toFixed(2) },
      { break: true },
      { id: 'depth', label: 'Depth', field: 'depth', formatter: (v) => v.toFixed(2) },
      { id: 'height', label: 'Height', field: 'height', formatter: (v) => v.toFixed(2) },
      { id: 'vertical', label: 'Vertical extent', field: 'vertical', formatter: (v) => v.toFixed(2) },
      {
        id        : 'vertiicalWithSplays',
        label     : 'Vertical extent (splays)',
        field     : 'vertiicalWithSplays',
        formatter : (v) => v.toFixed(2)
      }
    ].forEach((s) => {
      let node;
      if (s.break) {
        node = U.node`<br>`;
      } else {
        const value = s.formatter(stats?.[s.field] ?? 0);
        node = U.node`<span id="${s.id}">${s.label} : ${value}</span>"`;
      }
      statFields.appendChild(node);
    });
    this.panel.appendChild(statFields);
    this.panel.appendChild(U.node`<hr/>`);
  }
}

export { CaveEditor };
