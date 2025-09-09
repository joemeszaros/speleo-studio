import { toAscii, textToIso88592Bytes, toPolygonDate, node } from '../utils/utils.js';
import { showErrorPanel } from '../ui/popups.js';
import { wm } from '../ui/window.js';
import { i18n } from '../i18n/i18n.js';

class Exporter {

  static exportObjectAsJson = (obj, filename) => {
    const blob = new Blob([JSON.stringify(obj, null, 2)], {
      type : 'application/json'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  static exportJSON(caves, fileName) {
    caves.forEach((cave) => {
      const exportData = cave.toExport();
      delete exportData.id; // id is not needed in the export
      Exporter.exportObjectAsJson(exportData, `${fileName}_${cave.name}`);
    });
  }

  static exportPNG(scene, fileName) {
    scene.view.renderView();
    //TODO: include compass and ratio
    const base64 = scene.domElement.toDataURL('image/png');
    let a = document.createElement('a'); // Create a temporary anchor.
    a.href = base64;
    a.download = `${fileName}.png`;
    a.click();
  }

  static exportDXF(caves, fileName) {
    const lines = [];
    var handle = 1;

    lines.push('  0');
    lines.push('SECTION');
    lines.push('  2');
    lines.push('ENTITIES');

    caves.values().forEach((cave) => {
      cave.surveys.forEach((survey) => {
        survey.shots.forEach((shot) => {

          const fromSt = cave.stations.get(shot.from);
          const toSt = cave.stations.get(shot.to);

          lines.push('  0');
          lines.push('LINE');
          lines.push('  5'); // hande id, sort of object identifier
          lines.push(handle++);
          lines.push('  8'); // layer name
          lines.push('POLYGON'); // layer name
          lines.push('  10'); // x coordinate
          lines.push(fromSt.position.x);
          lines.push('  20'); // y coordinate
          lines.push(fromSt.position.y);
          lines.push('  30'); // z coordinate
          lines.push(fromSt.position.z);
          lines.push('  11'); // x coordinate
          lines.push(toSt.position.x);
          lines.push('  21'); // y coordinate
          lines.push(toSt.position.y);
          lines.push('  31'); // z coordinate
          lines.push(toSt.position.z);

        });

        cave.stations.forEach((st, name) => {
          lines.push('  0');
          lines.push('TEXT');
          lines.push('  5'); // hande id, sort of object identifier
          lines.push(handle++);
          lines.push('  8'); // layer name
          lines.push('POINTNAME');
          lines.push('  10'); // x coordinate
          lines.push(st.position.x);
          lines.push('  20'); // y coordinate
          lines.push(st.position.y);
          lines.push('  30'); // z coordinate
          lines.push(st.position.z);
          lines.push('  40'); // height
          lines.push('0.5');
          lines.push('  1'); // text
          lines.push(toAscii(name));

          lines.push('  0');
          lines.push('CIRCLE');
          lines.push('  5');
          lines.push(handle++);
          lines.push('  8');
          lines.push('CIRCLES');
          lines.push('  10');
          lines.push(st.position.x);
          lines.push('  20');
          lines.push(st.position.y);
          lines.push('  30');
          lines.push(st.position.z);
          lines.push('  40');
          lines.push('0.2');
        });
      });
    });

    lines.push('  0');
    lines.push('ENDSEC');
    lines.push('  0');
    lines.push('EOF');

    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileName}.dxf`;
    a.click();
    URL.revokeObjectURL(url);
  }

  static exportPolygon(caves, fileName) {
    const lines = [];

    lines.push('POLYGON Cave Surveying Software');
    lines.push('Polygon Program Version   = 2');
    lines.push('Polygon Data File Version = 1');
    lines.push('1998-2001 ===> Prepostffy Zsolt');
    lines.push('-------------------------------');
    lines.push('');

    caves.values().forEach((cave) => {

      lines.push('*** Project ***');
      lines.push(`Project name: ${cave.name}`);
      lines.push(`Project place: ${cave?.metadata?.settlement ?? ''}`);
      lines.push(`Project code: ${cave?.metadata?.catasterCode ?? ''}`);
      lines.push(`Made by: ${cave?.metadata?.creator ?? ''}`);
      lines.push(`Made date: ${cave?.metadata?.date ? toPolygonDate(cave.metadata.date) : ''}`);
      lines.push('Last modi: 0');
      lines.push('AutoCorrect: 0');
      lines.push('AutoSize: 12,0');
      lines.push('');
      lines.push('*** Surveys ***');

      const aliasesMap = new Map(cave.aliases.map((a) => [a.to, a.from]));
      cave.surveys.forEach((survey) => {
        lines.push(`Survey name: ${survey.name}`);
        lines.push(`Survey team: ${survey?.metadata?.team?.name ?? ''}`);
        for (let i = 0; i < 5; i++) {
          lines.push(
            `${survey?.metadata?.team?.members[i]?.name ?? ''}	${survey?.metadata?.team?.members[i]?.role ?? ''}`
          );
        }
        lines.push(`Survey date: ${survey.metadata?.date ? toPolygonDate(survey.metadata.date) : ''}`);
        lines.push(`Declination: ${survey?.metadata?.declination ?? ''}`);
        lines.push('Instruments: ');
        // For the polygon fromat, there 3 lines are required, otherwise it will ignore the first 3 shots
        for (let i = 0; i < 3; i++) {
          lines.push(`${survey?.metadata?.instruments[i]?.name ?? ''}	${survey?.metadata?.instruments[i]?.value ?? ''}`);
        }
        lines.push(`Fix point: ${survey?.start ?? ''}`);
        const startSt = cave.stations.get(survey.start);
        lines.push(`${startSt?.position?.x ?? 0}	${startSt?.position?.y ?? 0}	${startSt?.position?.z ?? 0}	0	0	0	0`);
        lines.push('Survey data');
        lines.push('From	To	Length	Azimuth	Vertical	Label	Left	Right	Up	Down	Note');

        survey.shots
          .filter((sh) => sh.isCenter()) // do not save splays and auxiliary shots
          .forEach((shot) => {
            // if we import a survey to a cave from Topodroid, the shot comes with it's original name
            // we need to replace it with the alias name if it exists
            const from = aliasesMap.get(shot.from) ?? shot.from;
            const to = aliasesMap.get(shot.to) ?? shot.to;
            lines.push(
              [from, to, shot.length, shot.azimuth, shot.clino, '', '0', '0', '0', '0', shot.comment].join('\t')
            );

          });
        lines.push('');
      });
    });

    lines.push('End of survey data.');
    lines.push('');
    lines.push('*** Surface ***');
    lines.push('End of surface data.');
    lines.push('');
    lines.push('EOF.');

    // Convert string to ISO-8859-2 encoding
    const text = lines.join('\n');
    // it's funny but there is no textencoder for iso-8859-2 encoding so we need to convert it manually
    const iso88592Bytes = textToIso88592Bytes(text);
    const blob = new Blob([iso88592Bytes], { type: 'text/plain;charset=iso-8859-2' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileName}.cave`;
    a.click();
    URL.revokeObjectURL(url);
  }

  static executeExport(caves, scene, panel) {

    const formatSelect = panel.querySelector('#export-format');
    const filenameInput = panel.querySelector('#export-project-name');

    const format = formatSelect.value;
    const filename = filenameInput.value.trim();

    try {
      switch (format) {
        case 'json':
          Exporter.exportJSON(caves, filename);
          break;
        case 'png':
          Exporter.exportPNG(scene, filename);
          break;
        case 'dxf':
          Exporter.exportDXF(caves, filename);
          break;
        case 'polygon':
          Exporter.exportPolygon(caves, filename);
          break;
        default:
          throw new Error(i18n.t('ui.panels.export.unsupportedExportFormat', { format }));
      }
    } catch (error) {
      console.error('Export failed:', error);
      showErrorPanel(i18n.t('errors.export.exportFailed', { error: error.message }));
    }
  }
}

class ExportWindow {

  constructor(caves, project, scene, panel) {
    this.caves = caves;
    this.project = project;
    this.scene = scene;
    this.panel = panel;

    // Bind event handlers
    this.onExportSubmit = this.handleExportSubmit.bind(this);
  }

  show() {
    wm.makeFloatingPanel(
      this.panel,
      (contentElmnt, close) => this.build(contentElmnt, close),
      'common.export',
      false,
      false,
      {},
      () => {
        // Cleanup event listeners when panel is closed
        const form = this.panel.querySelector('form');
        if (form) {
          form.removeEventListener('submit', this.onExportSubmit);
        }
      }
    );
  }

  build(contentElmnt, close) {
    const form = node`
        <form class="popup-content">
          <div class="form-group">
            <label for="export-format">${i18n.t('ui.panels.export.format')}:</label>
            <select id="export-format">
              <option value="json">JSON</option>
              <option value="png">PNG Image</option>
              <option value="dxf">DXF</option>
              <option value="polygon">Polygon (.cave)</option>
            </select>
          </div>
          <div class="form-group">
            <label for="export-project-name">${i18n.t('ui.panels.export.baseName')}:</label>
            <input type="text" id="export-project-name" placeholder="${i18n.t('ui.panels.export.baseNamePlaceholder')}" />
          </div>
          <div class="popup-actions">
            <button class="btn btn-primary" type="submit">${i18n.t('common.export')}</button>
          </div>
        </form>
      `;
    contentElmnt.appendChild(form);
    form.addEventListener('submit', this.onExportSubmit);
    this.close = close;
    const projectNameInput = this.panel.querySelector('#export-project-name');
    // Set default filename
    projectNameInput.value = this.project?.name ?? 'cave-export';
  }

  handleExportSubmit(e) {
    e.preventDefault();
    Exporter.executeExport(this.caves, this.scene, this.panel);
    this.close();
  }

}

export { Exporter, ExportWindow };
