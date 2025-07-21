import * as U from '../../utils/utils.js';
import { CaveMetadata, Cave } from '../../model/cave.js';
import { makeMovable, showErrorPanel } from '../popups.js';
import { Editor } from './base.js';
import { GeoData, EOVCoordinateWithElevation, CoordinateSytem, StationWithCoordinate } from '../../model/geo.js';

class CaveEditor extends Editor {
  constructor(db, options, cave, scene, attributeDefs, panel) {
    super(panel, scene, cave, attributeDefs);
    this.db = db;
    this.options = options;
    this.graph = undefined; // sort of a lazy val
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
      `Cave sheet editor: ${this.cave.name}`,
      false,
      () => this.closeEditor(),
      () => {},
      () => {}
    );
    this.#setupEditor();
    this.#setupStats();
  }

  #setupEditor() {
    const editorFields = U.node`<div class="editor"></div>`;

    [
      { label: 'Name', id: 'name', field: 'name', type: 'text' },
      { label: 'Settlement', id: 'settlement', fieldSource: 'metadata', field: 'settlement', type: 'text' },
      { label: 'Cataster code', id: 'cataster-code', fieldSource: 'metadata', field: 'catasterCode', type: 'text' },
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
      let value = '';
      if (i.fieldSource !== undefined && i.fieldSource === 'metadata' && this.cave.metaData !== undefined) {
        value = this.cave.metaData[i.field];
        if (value !== undefined && i.formatter !== undefined) {
          value = i.formatter(value);
        }
      } else if (i.id === 'name') {
        value = this.cave[i.field];
      }
      const label = U.node`<label for="${i.id}">${i.label}: <input type="${i.type}" id="${i.id}" value="${value}"></label>`;
      label.childNodes[1].onchange = (e) => {
        const newValue = e.target.value;
        if (i.fieldSource === 'metadata') {
          const parser = i.parser === undefined ? (v) => v : i.parser;
          if (this.cave.metaData === undefined) {
            this.cave.metaData = new CaveMetadata();
          }
          this.cave.metaData[i.field] = parser(newValue);
        }

        if (i.id === 'name') {
          if (this.db.getCave(newValue) !== undefined) {
            showErrorPanel(`Cave with name ${newValue} alreay exists, cannot rename!`);
            e.target.value = this.cave.name;
          } else {
            const oldName = this.cave.name;
            this.db.renameCave(oldName, newValue);
            this.#emitCaveRenamed(oldName, this.cave);
          }
        }
      };
      editorFields.appendChild(label);
    });

    this.panel.appendChild(editorFields);
    this.panel.appendChild(U.node`<hr/>`);
  }

  #setupStats() {
    const statFields = U.node`<div class="cave-stats"></div>`;
    const stats = this.cave.getStats();

    [
      { id: 'stations', label: 'Stations', field: 'stations', formatter: (v) => v },
      { id: 'surveys', label: 'Surveys', field: 'surveys', formatter: (v) => v },
      { id: 'isolated', label: 'Isolated surveys', field: 'isolated', formatter: (v) => v },
      { id: 'attributes', label: 'Station attributes', field: 'attributes', formatter: (v) => v },
      { break: true },
      { id: 'length', label: 'Length', field: 'length', formatter: (v) => v.toFixed(2) },
      { id: 'orphanLength', label: 'Length (orphan)', field: 'orphanLength', formatter: (v) => v.toFixed(2) },
      { id: 'invalidLength', label: 'Length (invalid)', field: 'invalidLength', formatter: (v) => v.toFixed(2) },
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
        const value = s.formatter(stats[s.field]);
        node = U.node`<span id="${s.id}">${s.label} : ${value}</span>"`;
      }
      statFields.appendChild(node);
    });
    this.panel.appendChild(statFields);
    this.panel.appendChild(U.node`<hr/>`);
  }
}

class NewCaveEditor {
  constructor({ onCreate, onCancel, panel }) {
    this.onCreate = onCreate;
    this.onCancel = onCancel;
    this.panel = panel;
    this.caveData = {
      name     : '',
      metaData : {
        settlement   : '',
        catasterCode : '',
        date         : ''
      },
      coordinates : [] // List of {stationName, y, x, elevation}
    };
  }

  show() {
    this.panel.innerHTML = '';
    makeMovable(
      this.panel,
      'Create New Cave',
      false,
      () => this.close(),
      () => {},
      () => {}
    );
    this.#setupForm();
    this.panel.style.display = 'block';
  }

  close() {
    this.panel.style.display = 'none';
    if (this.onCancel) this.onCancel();
  }

  #setupForm() {
    const form = U.node`<form class="editor"></form>`;
    const fields = [
      { label: 'Name', id: 'name', type: 'text', required: true },
      { label: 'Settlement', id: 'settlement', type: 'text' },
      { label: 'Cataster code', id: 'catasterCode', type: 'text' },
      { label: 'Date', id: 'date', type: 'date' }
    ];
    fields.forEach((f) => {
      const input = U.node`<input type="${f.type}" id="${f.id}" name="${f.id}" ${f.required ? 'required' : ''}>`;
      input.oninput = (e) => {
        if (f.id === 'name') this.caveData.name = e.target.value;
        else this.caveData.metaData[f.id] = e.target.value;
      };
      const label = U.node`<label for="${f.id}">${f.label}: </label>`;
      label.appendChild(input);
      form.appendChild(label);
      form.appendChild(U.node`<br/>`);
    });

    // Coordinates section
    const coordsDiv = U.node`<div class="coords-section"><b>EOV Coordinates (Station Name, Y, X, Elevation):</b></div>`;
    const coordsList = U.node`<div class="coords-list"></div>`;
    coordsDiv.appendChild(coordsList);
    const addCoordBtn = U.node`<button type="button">Add coordinate</button>`;
    addCoordBtn.onclick = (e) => {
      e.preventDefault();
      this.caveData.coordinates.push({ stationName: '', y: '', x: '', elevation: '' });
      renderCoords();
    };
    coordsDiv.appendChild(addCoordBtn);
    form.appendChild(coordsDiv);

    const renderCoords = () => {
      coordsList.innerHTML = '';
      this.caveData.coordinates.forEach((coord, idx) => {
        const nameInput = U.node`<input type="text" placeholder="Station Name" value="${coord.stationName}">`;
        const yInput = U.node`<input type="number" step="any" placeholder="Y" value="${coord.y}">`;
        const xInput = U.node`<input type="number" step="any" placeholder="X" value="${coord.x}">`;
        const elevInput = U.node`<input type="number" step="any" placeholder="Elevation" value="${coord.elevation}">`;
        nameInput.oninput = (e) => {
          this.caveData.coordinates[idx].stationName = e.target.value;
        };
        yInput.oninput = (e) => {
          this.caveData.coordinates[idx].y = e.target.value;
        };
        xInput.oninput = (e) => {
          this.caveData.coordinates[idx].x = e.target.value;
        };
        elevInput.oninput = (e) => {
          this.caveData.coordinates[idx].elevation = e.target.value;
        };
        const removeBtn = U.node`<button type="button">Remove</button>`;
        removeBtn.onclick = (e) => {
          e.preventDefault();
          this.caveData.coordinates.splice(idx, 1);
          renderCoords();
        };
        // Render all fields in a single row
        const row = U.node`<div class="coord-row" style="display: flex; gap: 8px; align-items: center; margin-bottom: 4px;"></div>`;
        row.appendChild(nameInput);
        row.appendChild(yInput);
        row.appendChild(xInput);
        row.appendChild(elevInput);
        row.appendChild(removeBtn); // Ensure this is always appended and visible
        coordsList.appendChild(row);
      });
    };
    renderCoords();

    const submitBtn = U.node`<button type="submit">Create Cave</button>`;
    const cancelBtn = U.node`<button type="button">Cancel</button>`;
    cancelBtn.onclick = (e) => {
      e.preventDefault();
      this.close();
    };
    form.appendChild(submitBtn);
    form.appendChild(cancelBtn);
    form.onsubmit = (e) => {
      e.preventDefault();
      if (!this.caveData.name) {
        showErrorPanel('Cave name is required!');
        return;
      }
      // Validate coordinates
      const coords = this.caveData.coordinates
        .map((c) =>
          c.stationName && !isNaN(Number(c.y)) && !isNaN(Number(c.x)) && !isNaN(Number(c.elevation))
            ? new StationWithCoordinate(
                c.stationName,
                new EOVCoordinateWithElevation(Number(c.y), Number(c.x), Number(c.elevation))
              )
            : null
        )
        .filter((c) => c !== null);

      // Collect validation errors for all coordinates
      let errors = [];
      this.caveData.coordinates.forEach((c) => {

        const coord = new EOVCoordinateWithElevation(
          U.parseMyFloat(c.y),
          U.parseMyFloat(c.x),
          U.parseMyFloat(c.elevation)
        );
        const coordErrors = coord.validate();
        if (coordErrors.length > 0) {
          errors.push(...coordErrors);
        }
        if (c.stationName == undefined || c.stationName.trim() === '') {
          errors.push(`Station '${c.stationName}' is empty`);
        }
      });
      if (errors.length > 0) {
        showErrorPanel('Invalid coordinates:<br>' + errors.join('<br><br>'));
        return;
      }

      const geoData = new GeoData(CoordinateSytem.EOV, coords);
      if (this.onCreate) {
        const cave = new Cave(
          this.caveData.name,
          new CaveMetadata(
            this.caveData.metaData.settlement,
            this.caveData.metaData.catasterCode,
            this.caveData.metaData.date ? new Date(this.caveData.metaData.date) : undefined
          ),
          geoData
        );
        this.onCreate(cave);
        this.close();
      }
    };
    this.panel.appendChild(form);
  }
}

export { CaveEditor, NewCaveEditor };
