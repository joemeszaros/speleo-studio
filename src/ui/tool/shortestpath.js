import { wm } from '../window.js';
import { node } from '../../utils/utils.js';
import { SectionHelper } from '../../section.js';
import { i18n } from '../../i18n/i18n.js';

export class ShortestPathTool {

  constructor(db, scene, panel = '#tool-panel') {
    this.db = db;
    this.scene = scene;
    this.panel = document.querySelector(panel);
    this.panel.style.width = '300px';
  }

  show() {
    const segmentsId = 'shortest-path-segments';

    wm.makeFloatingPanel(
      this.panel,
      (contentElmt) => this.build(segmentsId, contentElmt),
      'ui.panels.shortestPath.title',
      false,
      false,
      {},
      () => {
        this.scene.disposeSegments(segmentsId);
      }
    );
  }

  build(segmentsId, contentElmnt) {

    const addStationSelectors = (caveName) => {
      const form = node`<form id="container-shortest-path"></form>`;
      const stNames = this.db.getStationNames(caveName);
      const options = stNames.map((n) => `<option value="${n}">`).join('');
      const datalist = node`<datalist id="stations">${options}</datalist>`;
      const button = node`<button type="submit">${i18n.t('ui.panels.shortestPath.find')}</button>`;
      const fromL = node`<label for="point-from">${i18n.t('common.from')}:<input required type="search" list="stations" id="point-from"></label>`;
      const toL = node`<label for="point-to">${i18n.t('common.to')}:<input required type="search" list="stations" id="point-to"></label>`;

      form.appendChild(datalist);
      form.appendChild(fromL);
      form.appendChild(toL);
      form.appendChild(button);
      contentElmnt.appendChild(form);

      form.onsubmit = (e) => {
        e.preventDefault();

        this.scene.disposeSegments(segmentsId);
        const cave = this.db.getCave(caveName);
        const g = SectionHelper.getGraph(cave);
        let label;
        const from = fromL.childNodes[1].value;
        const to = toL.childNodes[1].value;
        if (cave.stations.has(from) && cave.stations.has(to)) {
          const section = SectionHelper.getSection(g, from, to);
          if (section !== undefined) {
            const segments = SectionHelper.getSectionSegments(section, cave.stations);
            this.scene.showSegments(
              segmentsId,
              `shortest-path-${from}-${to}-${segmentsId}`,
              segments,
              this.options.scene.sectionAttributes.color,
              caveName
            );
            label = node`<div id="shortest-path-label">${i18n.t('ui.panels.shortestPath.from')}: ${from} ${i18n.t('ui.panels.shortestPath.to')}: ${to} ${i18n.t('ui.panels.shortestPath.length')}: ${section.distance.toFixed(2)}</div>`;
          } else {
            label = node`<div id="shortest-path-label">${i18n.t('ui.panels.shortestPath.cannotFindPath', { from, to })}</div>`;
          }
        } else {
          label = node`<div id="shortest-path-label">${i18n.t('ui.panels.shortestPath.cannotFindStations', { from, to })}</div>`;
        }
        contentElmnt.appendChild(label);

      };
    };

    const cNames = this.db.getAllCaveNames();
    if (cNames.length > 1) {
      const optionCaveNames = cNames.map((n) => `<option value="${n}">${n}</option>`).join('');
      const caveNamesL = node`<label for="cave-names">${i18n.t('common.cave')}: <select id="cave-names" name="cave-names">${optionCaveNames}</select></label>`;
      const caveNames = caveNamesL.childNodes[1];

      contentElmnt.appendChild(caveNamesL);

      caveNames.onchange = () => {
        const caveName = caveNames.options[caveNames.selectedIndex].text;
        const cont = contentElmnt.querySelector('#container-shortest-path');
        if (cont !== undefined) {
          contentElmnt.removeChild(cont);
        }
        contentElmnt.querySelectorAll('#shortest-path-label').forEach((e) => contentElmnt.removeChild(e));

        addStationSelectors(caveName);
      };
    }

    if (cNames.length > 0) {
      addStationSelectors(cNames[0]);
    }
  }
}
