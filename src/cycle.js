import * as U from './utils/utils.js';
import { SectionHelper } from './section.js';
import { makeFloatingPanel } from './ui/popups.js';
import { Color } from './model.js';
import { CaveCycle } from './model/cave.js';

class CyclePanel {

  constructor(options, panel, scene, cave) {
    this.options = options;
    this.panel = panel;
    this.scene = scene;
    this.cave = cave;
  }

  show() {
    this.panel.style.display = 'block';
  }

  closeEditor() {

    this.closed = true;

    if (this.table !== undefined) {
      this.hideAllCycles();
      this.table.destroy();
      this.table = undefined;
    }
  }

  setupPanel() {
    const contentElmnt = makeFloatingPanel(
      this.panel,
      `Cycles: ${this.cave.name}`,
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
    this.#setupButtons(contentElmnt);
    this.#setupTable(contentElmnt);
  }

  #setupButtons(contentElmnt) {
    [
      { id: 'show-all', text: 'Show all', click: () => this.showAllCycles() },
      { id: 'hide-all', text: 'Hide all', click: () => this.hideAllCycles() }

    ].forEach((b) => {
      const button = U.node`<button id="${b.id}">${b.text}</button>`;
      button.onclick = b.click;
      contentElmnt.appendChild(button);
    });
  }

  #getTableData() {
    const palette = ['#118B50', '#F26B0F', '#c92435'];
    const g = SectionHelper.getGraph(this.cave);
    return SectionHelper.getCycles(g).map((c) => {
      return {
        id       : c.id,
        path     : c.path,
        distance : c.distance,
        color    : new Color(palette[Math.floor(Math.random() * palette.length)]),
        visible  : false
      };

    });
  }

  #getColumns() {
    return [
      {
        width            : 25,
        field            : 'visible',
        formatter        : 'tickCross',
        cellClick        : this.functions.toggleVisibility,
        mutatorClipboard : (str) => (str === 'true' ? true : false) //TODO:better parser here that considers other values (like 0, 1)
      },
      {
        title             : 'Color',
        field             : 'color',
        formatter         : this.functions.colorIcon,
        accessorClipboard : (color) => color.hexString(),
        mutatorClipboard  : (hex) => new Color(hex),
        width             : 45,
        cellClick         : (_e, cell) => this.functions.changeColor(_e, cell)
      },
      {
        title        : 'Path',
        field        : 'path',
        headerFilter : 'input',
        formatter    : (cell) => U.fitString(cell.getValue().join(','), 100)
      },
      {
        title : 'Distance',
        field : 'distance'
      }
    ];
  }

  #setupTable(contentElmnt) {
    contentElmnt.appendChild(U.node`<div id="cycle-table"></div>`);
    // eslint-disable-next-line no-undef
    this.table = new Tabulator('#cycle-table', {
      height       : this.options.ui.editor.cycles.height - 30,
      data         : this.#getTableData(),
      layout       : 'fitDataStretch',
      reactiveData : true,
      rowHeader    : {
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
      columns : this.#getColumns()
    });
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
    this.scene.showSegments(
      data.id,
      SectionHelper.getCycleSegments(new CaveCycle(data.id, data.path, data.distance), this.cave.stations),
      data.color,
      this.cave.name
    );
  }

  hideCycle(id) {
    this.scene.disposeSegments(id);
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
      const color = data.color.hexString();
      const style = `style="background: ${color}"`;
      return `<input type="color" id="color-picker-${data.id}" value="${color}"><label id="color-picker-${data.id}-label" for="color-picker-${data.id}" ${style}></label>`;
    },
    changeColor : (e, cell) => {
      if (e.target.tagName === 'INPUT') {
        e.target.oninput = (e2) => {
          const newColor = e2.target.value;
          const data = cell.getData();
          data.color = new Color(newColor);
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
