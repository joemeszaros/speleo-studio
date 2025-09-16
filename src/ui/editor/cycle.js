import * as U from '../../utils/utils.js';
import { SectionHelper } from '../../section.js';
import { wm } from '../window.js';
import { Polar } from '../../model.js';
import { CaveCycle } from '../../model/cave.js';
import { CycleUtil } from '../../utils/cycle.js';
import { IconBar } from './iconbar.js';
import { i18n } from '../../i18n/i18n.js';

class CyclePanel {

  constructor(options, panel, scene, cave) {
    this.options = options;
    this.panel = panel;
    this.scene = scene;
    this.cave = cave;
    //surveyChanged is not used here, because the whole cave needs to be recalculated to show all the loops and loop errors in the table
    document.addEventListener('caveRecalculated', (e) => this.onCaveRecalculated(e));
  }

  onCaveRecalculated(e) {
    const cave = e.detail.cave;
    if (this.table !== undefined && this.cave.name === cave.name) {
      const tableRows = this.#getTableData();
      this.table.replaceData(tableRows);
    }
  }

  show() {
    this.panel.style.display = 'block';
  }

  closeEditor() {

    this.closed = true;

    if (this.table !== undefined) {
      this.hideAllCycles();
      this.hideAllDeviatingShots();
      this.table.destroy();
      this.table = undefined;
    }
  }

  setupPanel() {
    wm.makeFloatingPanel(
      this.panel,
      (contentElmnt) => this.build(contentElmnt),
      () => i18n.t('ui.editors.cycles.title', { name: this.cave.name }),
      true,
      true,
      this.options.ui.editor.cycles,
      () => this.closeEditor(),
      (_newWidth, newHeight) => {
        const h = this.panel.offsetHeight - 100;
        this.table.setHeight(h);
      },
      () => this.table.redraw()
    );

  }

  build(contentElmnt) {
    this.#setupButtons(contentElmnt);
    this.#setupTable(contentElmnt);
  }

  #setupButtons(contentElmnt) {

    // Create iconbar with common buttons
    this.iconBar = new IconBar(contentElmnt);

    const cycleButtons = IconBar.getCycleButtons(
      () => this.showAllCycles(),
      () => this.hideAllCycles(),
      () => this.showAllDeviatingShots(),
      () => this.hideAllDeviatingShots()
    );
    cycleButtons.forEach((button) => this.iconBar.addButton(button));
  }

  #getTableData() {
    const palette = ['#f49b0d', '#0092ff', '#c92435', '#5bd825', '#820eef', '#fc03d7'];
    const g = SectionHelper.getGraph(this.cave);
    return SectionHelper.getCycles(g).map((c) => {

      const loopError = CycleUtil.calculateCycleError([...c.path, c.path[0]], this.cave.stations);

      return {
        id              : c.id,
        path            : c.path,
        distance        : c.distance,
        color           : palette[Math.floor(Math.random() * palette.length)],
        visible         : false,
        error           : loopError,
        errorDistance   : loopError.error.distance,
        errorAzimuth    : U.radsToDegrees(loopError.error.azimuth),
        errorClino      : U.radsToDegrees(loopError.error.clino),
        errorPercentage : (loopError.error.distance / loopError.totalLength) * 100
      };

    });
  }

  #getColumns() {

    const sumErrorDistance = (_values, data) => {
      return data.reduce((sum, v) => sum + (v.errorDistance || 0), 0).toFixed(2);
    };
    return [
      {
        width            : 25,
        field            : 'visible',
        formatter        : 'tickCross',
        cellClick        : this.functions.toggleVisibility,
        mutatorClipboard : (str) => (str === 'true' ? true : false), //TODO:better parser here that considers other values (like 0, 1)
        bottomCalc       : 'count'
      },
      {
        title      : i18n.t('ui.editors.cycles.columns.color'),
        field      : 'color',
        formatter  : this.functions.colorIcon,
        width      : 45,
        cellClick  : (_e, cell) => this.functions.changeColor(_e, cell),
        bottomCalc : 'count'
      },
      {
        title     : i18n.t('ui.editors.cycles.columns.distance'),
        field     : 'distance',
        formatter : (cell) => cell.getValue().toFixed(3)
      },
      {
        title      : i18n.t('ui.editors.cycles.columns.errorDistance'),
        field      : 'errorDistance',
        formatter  : (cell) => cell.getValue().toFixed(3),
        bottomCalc : sumErrorDistance
      },
      {
        title     : i18n.t('ui.editors.cycles.columns.errorAzimuth'),
        field     : 'errorAzimuth',
        formatter : (cell) => cell.getValue().toFixed(3)
      },
      {
        title     : i18n.t('ui.editors.cycles.columns.errorClino'),
        field     : 'errorClino',
        formatter : (cell) => cell.getValue().toFixed(3)
      },
      {
        title     : i18n.t('ui.editors.cycles.columns.errorPercentage'),
        field     : 'errorPercentage',
        formatter : (cell) => cell.getValue().toFixed(2) + ' %',
        sorter    : 'number'
      },
      {
        title        : i18n.t('ui.editors.cycles.columns.path'),
        field        : 'path',
        headerFilter : 'input',
        formatter    : (cell) => U.fitString(cell.getValue().join(','), 100)
      }

    ];
  }

  getCycleContextMenu() {
    return [
      {
        label  : i18n.t('ui.editors.cycles.contextMenu.propagateLoopClosureError'),
        action : (e, row) => {
          this.propagateLoopClosureError(row.getData());
        }
      },
      {
        label  : i18n.t('ui.editors.cycles.contextMenu.adjustLoopDeviationShots'),
        action : (e, row) => {
          this.adjustLoopDeviationShots(row.getData());
        }
      }
    ];
  }

  #setupTable(contentElmnt) {
    contentElmnt.appendChild(U.node`<div id="cycle-table"></div>`);
    // eslint-disable-next-line no-undef
    this.table = new Tabulator('#cycle-table', {
      height         : this.options.ui.editor.cycles.height - 36 - 48 - 5, // header + iconbar
      data           : this.#getTableData(),
      layout         : 'fitDataStretch',
      reactiveData   : false,
      rowContextMenu : this.getCycleContextMenu(),
      rowHeader      : {
        formatter : 'rownum',
        hozAlign  : 'center',
        resizable : false,
        frozen    : true,
        editor    : false
      },
      columnDefaults : {
        headerSort     : true,
        headerHozAlign : 'center',
        resizable      : 'header'
      },
      columns : this.#getColumns()
    });
  }

  propagateLoopClosureError(data) {
    const loopError = data.error;
    const path = [...data.path, data.path[0]];
    const stations = this.cave.stations;
    if (CycleUtil.propagateError(path, stations, loopError.error, loopError.totalLength)) {
      // we don't know which surveys are affected, so we just use the first one, if someone implements an optimization in survey calculation
      // and only recalculates surveys after the affected survey
      this.#emitSurveyChanged(this.cave.surveys[0]);
    }
  }

  adjustLoopDeviationShots(data) {
    const path = [...data.path, data.path[0]];
    const deviationShots = CycleUtil.findLoopDeviationShots(path, this.cave.stations);
    if (deviationShots.length > 0 && CycleUtil.adjustShots(deviationShots)) {
      this.#emitSurveyChanged(this.cave.surveys[0]);
    }
  }

  #emitSurveyChanged(survey) {
    const event = new CustomEvent('surveyChanged', {
      detail : {
        reasons : ['cycles'],
        cave    : this.cave,
        survey  : survey
      }
    });
    document.dispatchEvent(event);
  }

  showAllCycles() {
    const toShow = this.table.getData().filter((r) => r.visible === false);
    if (toShow.length > 0) {
      toShow.forEach((r) => {
        this.showCycle(r);
      });
      this.table.updateData(
        toShow.map((t) => {
          return { id: t.id, visible: true };
        })
      );
    }
  }

  hideAllCycles() {
    const toHide = this.table.getData().filter((r) => r.visible === true);
    if (toHide.length > 0) {
      toHide.forEach((r) => {
        this.hideCycle(r.id);
      });
      this.table.updateData(
        toHide.map((t) => {
          return { id: t.id, visible: false };
        })
      );
    }
  }

  showCycle(data) {
    this.scene.segments.showSegmentsTube(
      data.id,
      `cycle-${data.id}`,
      SectionHelper.getCycleSegments(new CaveCycle(data.id, data.path, data.distance), this.cave.stations),
      data.color,
      this.cave.name
    );
  }

  hideCycle(id) {
    this.scene.segments.disposeSegmentsTube(id);
  }

  showAllDeviatingShots() {
    this.table.getData().forEach((r) => {
      this.showDeviatingShots([...r.path, r.path[0]], r.id);
    });
  }

  showDeviatingShots(path, id) {
    const deviationShots = CycleUtil.findLoopDeviationShots(path, this.cave.stations);
    if (deviationShots.length > 0) {
      const segments = [];
      deviationShots.forEach((s) => {
        if (s.diff.length() > 0.1) {
          const from = this.cave.stations.get(s.shot.from);
          const fromPos = from.position;
          const toPos = from.position.add(
            new Polar(
              s.diff.length(),
              U.degreesToRads(s.shot.azimuth + s.declination + s.convergence),
              U.degreesToRads(s.shot.clino)
            ).toVector()
          );
          if (fromPos !== undefined && toPos !== undefined) {
            segments.push(fromPos.x, fromPos.y, fromPos.z, toPos.x, toPos.y, toPos.z);
          }
        }
      });
      this.scene.segments.showSegments(
        `deviating-shots-${id}`,
        `deviating-shots-${id}`,
        segments,
        '#ff0000',
        this.cave.name
      );
    }
  }

  hideAllDeviatingShots() {
    this.table.getData().forEach((r) => {
      this.scene.segments.disposeSegments(`deviating-shots-${r.id}`);
    });
  }

  functions = {
    toggleVisibility : (ev, cell) => {
      const data = cell.getData();
      cell.setValue(!cell.getValue());

      if (cell.getValue() === true) {
        this.showCycle(data);
      } else {
        this.hideCycle(data.id);
      }
    },
    colorIcon : (cell) => {
      const data = cell.getData();
      const color = data.color;
      const style = `style="background: ${color}"`;
      return `<input type="color" id="color-picker-${data.id}" value="${color}"><label id="color-picker-${data.id}-label" for="color-picker-${data.id}" ${style}></label>`;
    },
    changeColor : (e, cell) => {
      if (e.target.tagName === 'INPUT') {
        e.target.oninput = (e2) => {
          const newColor = e2.target.value;
          const data = cell.getData();
          data.color = newColor;
          if (data.visible) {
            this.hideCycle(data.id);
            this.showCycle(data);
          }
          const label = document.getElementById(e.target.id + '-label');
          label.style.background = newColor;
        };
      }
    }
  };

}

export { CyclePanel };
