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

import { toAscii, textToIso88592Bytes, toPolygonDate, node } from '../utils/utils.js';
import { showErrorPanel } from '../ui/popups.js';
import { wm } from '../ui/window.js';
import { i18n } from '../i18n/i18n.js';
import * as THREE from 'three';
import { ShotType } from '../model/survey.js';
import { Color } from '../model.js';

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

  static exportPolygonCaves(caves, fileName) {
    caves.values().forEach((cave) => {
      Exporter.exportPolygon(cave, fileName);
    });
  }

  static exportSVG(caves, scene, fileName) {
    const view = scene.view;
    const camera = view.camera;
    const width = scene.width;
    const height = scene.height;

    // Helper function to project 3D point to 2D SVG coordinates
    const projectToSVG = (position) => {
      const vector = new THREE.Vector3(position.x, position.y, position.z);
      vector.project(camera);
      // Convert from normalized device coordinates (-1 to 1) to SVG coordinates (0 to width/height)
      const x = (vector.x * 0.5 + 0.5) * width;
      const y = (1 - (vector.y * 0.5 + 0.5)) * height; // Flip Y axis for SVG
      return { x, y };
    };

    // Get color for a line segment instance from the geometry, returns hex string
    const getInstanceColor = (lineSegments, instanceIndex) => {
      if (!lineSegments) {
        return '#ffffff';
      }

      // Check if geometry has color attributes (gradient mode)
      // LineSegmentsGeometry uses instanceColorStart and instanceColorEnd, not 'color'
      const colorStartAttribute = lineSegments.geometry.getAttribute('instanceColorStart');
      if (colorStartAttribute && colorStartAttribute.count > 0 && instanceIndex < colorStartAttribute.count) {
        // Gradient mode: get color from instanceColorStart
        // Each instance has RGB (3 values) but the start and color end buffers share the same InstancedInterleavedBuffer
        // and therefore we need to multiply by 6 and not 3
        const colorIndex = instanceIndex * 6;
        if (colorIndex + 2 < colorStartAttribute.array.length) {
          // Color values are in 0-1 range, convert to 0-255 for Color class
          const r = Math.max(0, Math.min(255, Math.round(colorStartAttribute.array[colorIndex] * 255)));
          const g = Math.max(0, Math.min(255, Math.round(colorStartAttribute.array[colorIndex + 1] * 255)));
          const b = Math.max(0, Math.min(255, Math.round(colorStartAttribute.array[colorIndex + 2] * 255)));
          return new Color(r, g, b).hexString();
        }
      } else {
        // Solid color mode: use material color
        if (lineSegments.material && lineSegments.material.color !== undefined) {
          const color = lineSegments.material.color;
          return '#' + color.getHexString();
        }
      }

      return '#ffffff';
    };

    // Export line segments from geometry
    const exportLineSegments = (lineSegments, layerId, layerName, strokeWidth) => {
      if (!lineSegments || !lineSegments.geometry) {
        return;
      }

      const geometry = lineSegments.geometry;
      const instanceStart = geometry.getAttribute('instanceStart');
      const instanceEnd = geometry.getAttribute('instanceEnd');

      if (!instanceStart || !instanceEnd) {
        return;
      }

      const instanceCount = geometry.instanceCount || instanceStart.count;
      svgParts.push(`<g id="${layerId}" data-name="${layerName}">`);

      for (let i = 0; i < instanceCount; i++) {
        // Get start and end positions
        const startX = instanceStart.getX(i);
        const startY = instanceStart.getY(i);
        const startZ = instanceStart.getZ(i);
        const endX = instanceEnd.getX(i);
        const endY = instanceEnd.getY(i);
        const endZ = instanceEnd.getZ(i);

        // Project to 2D
        const start2D = projectToSVG({ x: startX, y: startY, z: startZ });
        const end2D = projectToSVG({ x: endX, y: endY, z: endZ });

        // Get color for this instance
        const colorHex = getInstanceColor(lineSegments, i);

        svgParts.push(
          `<line x1="${start2D.x}" y1="${start2D.y}" x2="${end2D.x}" y2="${end2D.y}" stroke="${colorHex}" stroke-width="${strokeWidth}" />`
        );
      }

      svgParts.push('</g>');
    };

    const getLayerName = (name) => toAscii(name); //name.replace(/[^a-zA-Z0-9]/g, '_');

    // Get station sphere radius and color (for center line stations)
    const centerLineSpheresConfig = scene.options.scene.centerLines?.spheres;
    const stationRadius = centerLineSpheresConfig?.radius || 0.3;
    const stationColor = centerLineSpheresConfig?.color || '#ffff00';

    // Get station label config
    const stationLabelConfig = scene.options.scene.stationLabels;
    const showStationNames = stationLabelConfig?.show && stationLabelConfig.mode === 'name';

    // Get start point config
    const startPointConfig = scene.options.scene.startPoints;
    const startPointRadius = startPointConfig?.radius || 1;
    const startPointColor = startPointConfig?.color || '#ffff00';

    // Build SVG
    const svgParts = [];
    svgParts.push(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
    );
    svgParts.push('<defs>');
    svgParts.push('</defs>');

    // Process each visible cave
    caves.forEach((cave) => {
      if (!cave.visible) return;

      const caveLayerId = getLayerName(`${i18n.t('common.cave')}-${cave.name}`);
      svgParts.push(`<g id="${caveLayerId}" data-name="${cave.name}">`);

      // Process each visible survey in the cave
      cave.surveys.forEach((survey) => {
        if (!survey.visible) return;

        // Get the survey object from caveObjects
        const caveObject = scene.speleo.caveObjects.get(cave.name);
        if (!caveObject) {
          return;
        }

        const surveyObject = caveObject.get(survey.name);
        if (!surveyObject) {
          return;
        }

        const surveyLayerId = getLayerName(`${i18n.t('common.survey')}-${survey.name}`);
        svgParts.push(`<g id="${surveyLayerId}" data-name="${survey.name}">`);

        // Center lines layer - iterate through geometry positions
        if (
          surveyObject.centerLines &&
          surveyObject.centerLines.geometry.instanceCount > 0 &&
          surveyObject.centerLines.visible
        ) {
          const layerName = getLayerName(i18n.t('ui.settingsPanel.groups.centerLines'));
          exportLineSegments(surveyObject.centerLines, layerName, layerName, '1');
        }

        // Splays layer - iterate through geometry positions
        if (surveyObject.splays && surveyObject.splays.geometry.instanceCount > 0 && surveyObject.splays.visible) {
          const layerName = getLayerName(i18n.t('ui.settingsPanel.groups.splays'));
          exportLineSegments(surveyObject.splays, layerName, layerName, '0.5');
        }

        // Auxiliaries layer - iterate through geometry positions
        if (
          surveyObject.auxiliaries &&
          surveyObject.auxiliaries.geometry.instanceCount > 0 &&
          surveyObject.auxiliaries.visible
        ) {
          const layerName = getLayerName(i18n.t('ui.settingsPanel.groups.auxiliaryLines'));
          exportLineSegments(surveyObject.auxiliaries, layerName, layerName, '0.5');
        }

        // Station spheres layer
        const layerName = getLayerName(i18n.t('ui.settingsPanel.groups.centerStations'));
        svgParts.push(`<g id="${layerName}" data-name="${layerName}">`);
        cave.stations.forEach((station) => {
          if (station.survey.name === survey.name && station.type !== ShotType.SPLAY) {
            const pos2D = projectToSVG(station.position);
            svgParts.push(
              `<circle cx="${pos2D.x}" cy="${pos2D.y}" r="${stationRadius * 10}" fill="${stationColor}" stroke="none" />`
            );
          }
        });
        svgParts.push('</g>');

        // Station names layer
        if (showStationNames) {
          const layerName = getLayerName(i18n.t('ui.settingsPanel.groups.stationLabels'));
          svgParts.push(`<g id="${layerName}" data-name="${layerName}">`);
          cave.stations.forEach((station, stationName) => {
            if (station.survey.name === survey.name && station.type !== ShotType.SPLAY) {
              const pos2D = projectToSVG(station.position);
              const fontSize = 12;
              const offsetX = stationRadius * 10 + 5;
              svgParts.push(
                `<text x="${pos2D.x + offsetX}" y="${pos2D.y}" font-family="Arial, sans-serif" font-size="${fontSize}" fill="#000000">${stationName}</text>`
              );
            }
          });
          svgParts.push('</g>');
        }

        svgParts.push('</g>'); // Close survey layer
      });

      // Start point layer for the cave
      const firstStationName = cave.getFirstStationName();
      if (firstStationName) {
        const firstStation = cave.stations.get(firstStationName);
        if (firstStation) {
          const layerName = getLayerName(i18n.t('ui.settingsPanel.labels.startPoint'));
          svgParts.push(`<g id="${layerName}" data-name="${layerName}">`);
          const pos2D = projectToSVG(firstStation.position);
          svgParts.push(
            `<circle cx="${pos2D.x}" cy="${pos2D.y}" r="${startPointRadius * 10}" fill="${startPointColor}" stroke="none" />`
          );
          svgParts.push('</g>');
        }
      }

      svgParts.push('</g>'); // Close cave layer
    });

    svgParts.push('</svg>');

    const svgContent = svgParts.join('\n');
    const blob = new Blob([svgContent], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileName}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }

  static exportPolygon(cave, fileName) {
    const lines = [];

    lines.push('POLYGON Cave Surveying Software');
    lines.push('Polygon Program Version   = 2');
    lines.push('Polygon Data File Version = 1');
    lines.push('1998-2001 ===> Prepostffy Zsolt');
    lines.push('-------------------------------');
    lines.push('');

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
    a.download = `${fileName}-${cave.name}.cave`;
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
          Exporter.exportPolygonCaves(caves, filename);
          break;
        case 'svg':
          Exporter.exportSVG(caves, scene, filename);
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
              <option value="png">PNG ${i18n.t('ui.panels.export.image')}</option>
              <option value="dxf">DXF</option>
              <option value="polygon">Polygon (.cave)</option>
              <option value="svg">SVG</option>
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
