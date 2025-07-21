import * as U from '../../utils/utils.js';
import { CaveMetadata } from '../../model/cave.js';
import { makeMovable, showErrorPanel } from '../popups.js';
import { Editor } from './base.js';

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

export { CaveEditor };
