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

import { toAscii, textToIso88592Bytes, toPolygonDate, node, formatDistance } from '../utils/utils.js';
import { showErrorPanel } from '../ui/popups.js';
import { wm } from '../ui/window.js';
import { i18n } from '../i18n/i18n.js';
import * as THREE from 'three';
import { ShotType } from '../model/survey.js';
import { Color } from '../model.js';
import { WGS84Converter } from '../utils/geo.js';

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

  static exportSVG(caves, scene, fileName, project = null) {
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

    // Check if a 3D point is within camera frustum
    const isPointInFrustum = (point) => {
      const vector = new THREE.Vector3(point.x, point.y, point.z);
      vector.project(camera);
      // Check if projected point is within normalized device coordinates (-1 to 1)
      // Also check if it's in front of the camera (z should be between -1 and 1 after projection)
      return vector.x >= -1 && vector.x <= 1 && vector.y >= -1 && vector.y <= 1 && vector.z >= -1 && vector.z <= 1;
    };

    // Check if a line segment is at least partially visible in the camera frustum
    const isSegmentVisible = (startPos, endPos) => {
      // Check if either endpoint is in frustum, or if the line intersects the frustum
      return isPointInFrustum(startPos) || isPointInFrustum(endPos);
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

        const startPos = { x: startX, y: startY, z: startZ };
        const endPos = { x: endX, y: endY, z: endZ };

        // Check if segment is visible in camera frustum
        if (!isSegmentVisible(startPos, endPos)) {
          continue; // Skip this segment if not visible
        }

        // Project to 2D
        const start2D = projectToSVG(startPos);
        const end2D = projectToSVG(endPos);

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

      // Get the cave object from caveObjects
      const caveObject = scene.speleo.caveObjects.get(cave.name);
      if (!caveObject) {
        return;
      }

      // Calculate distance from camera for each survey and sort by distance (farthest first)
      const surveysWithDistance = [];
      cave.surveys.forEach((survey) => {
        if (!survey.visible) return;

        const surveyObject = caveObject.get(survey.name);
        if (!surveyObject) {
          return;
        }

        // Calculate distance from camera to survey
        // Use the center of the survey's bounding box or first station position
        let surveyPosition = new THREE.Vector3(0, 0, 0);
        let hasPosition = false;

        // Try to get position from centerLines geometry bounding box
        if (surveyObject.centerLines && surveyObject.centerLines.geometry) {
          const geometry = surveyObject.centerLines.geometry;
          if (geometry.boundingBox) {
            geometry.computeBoundingBox();
            geometry.boundingBox.getCenter(surveyPosition);
            hasPosition = true;
          } else if (geometry.attributes.instanceStart && geometry.attributes.instanceStart.count > 0) {
            // Use first instance start position as fallback
            const instanceStart = geometry.attributes.instanceStart;
            surveyPosition.set(instanceStart.getX(0), instanceStart.getY(0), instanceStart.getZ(0));
            hasPosition = true;
          }
        }

        // Fallback to first station position if geometry doesn't have position
        if (!hasPosition) {
          const firstStationName = survey.start || (survey.shots.length > 0 ? survey.shots[0].from : null);
          if (firstStationName) {
            const firstStation = cave.stations.get(firstStationName);
            if (firstStation) {
              surveyPosition.copy(firstStation.position);
              hasPosition = true;
            }
          }
        }

        // Calculate distance from camera
        const cameraPosition = camera.position.clone();
        const distance = hasPosition ? cameraPosition.distanceTo(surveyPosition) : 0;

        surveysWithDistance.push({
          survey,
          surveyObject,
          distance
        });
      });

      // Sort by distance (farthest first, closest last - so closest renders on top)
      surveysWithDistance.sort((a, b) => b.distance - a.distance);

      // Process each visible survey in the cave (sorted by distance)
      surveysWithDistance.forEach(({ survey, surveyObject }) => {

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
        if (scene.options.scene.centerLines?.spheres?.show) {
          const layerName = getLayerName(i18n.t('ui.settingsPanel.groups.centerStations'));
          svgParts.push(`<g id="${layerName}" data-name="${layerName}">`);
          cave.stations.forEach((station) => {
            if (station.survey.name === survey.name && station.type !== ShotType.SPLAY) {
              // Check if station is visible in camera frustum
              if (!isPointInFrustum(station.position)) {
                return;
              }
              const pos2D = projectToSVG(station.position);
              svgParts.push(
                `<circle cx="${pos2D.x}" cy="${pos2D.y}" r="${stationRadius * 10}" fill="${stationColor}" stroke="none" />`
              );
            }
          });
          svgParts.push('</g>');
        }

        // Station names layer
        if (showStationNames) {
          const layerName = getLayerName(i18n.t('ui.settingsPanel.groups.stationLabels'));
          svgParts.push(`<g id="${layerName}" data-name="${layerName}">`);
          cave.stations.forEach((station, stationName) => {
            if (station.survey.name === survey.name && station.type !== ShotType.SPLAY) {
              // Check if station is visible in camera frustum
              if (!isPointInFrustum(station.position)) {
                return;
              }
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
          // Check if start point is visible in camera frustum
          if (isPointInFrustum(firstStation.position)) {
            const layerName = getLayerName(i18n.t('ui.settingsPanel.labels.startPoint'));
            svgParts.push(`<g id="${layerName}" data-name="${layerName}">`);
            const pos2D = projectToSVG(firstStation.position);
            svgParts.push(
              `<circle cx="${pos2D.x}" cy="${pos2D.y}" r="${startPointRadius * 10}" fill="${startPointColor}" stroke="none" />`
            );
            svgParts.push('</g>');
          }
        }
      }

      svgParts.push('</g>'); // Close cave layer
    });

    // Add ruler and ratio text at the bottom center
    const addRulerAndRatio = () => {
      const ratio = scene.view.ratio;
      const roundedRatio = scene.view.roundToDedicatedRatio(ratio);
      const targetRulerDistance = scene.view.getTargetRulerDistance(roundedRatio);
      const worldWidthInMeters = scene.view.camera.width / scene.view.control.getZoomLevel();
      const rulerWidthInPixels = (targetRulerDistance / worldWidthInMeters) * width;
      const rulerWidth = Math.max(50, Math.min(400, rulerWidthInPixels));

      // Position at bottom center
      const rulerY = height - 40;
      const rulerX = width / 2 - rulerWidth / 2;

      // Create ruler group
      const rulerGroupId = getLayerName(i18n.t('ui.settingsPanel.labels.ruler') || 'Ruler');
      svgParts.push(`<g id="${rulerGroupId}" data-name="Ruler">`);

      // Ruler line
      svgParts.push(
        `<line x1="${rulerX}" y1="${rulerY}" x2="${rulerX + rulerWidth}" y2="${rulerY}" stroke="#000000" stroke-width="2" />`
      );

      // Ruler tick marks (at start, middle, and end)
      const tickHeight = 8;
      svgParts.push(
        `<line x1="${rulerX}" y1="${rulerY - tickHeight / 2}" x2="${rulerX}" y2="${rulerY + tickHeight / 2}" stroke="#000000" stroke-width="2" />`
      );
      svgParts.push(
        `<line x1="${rulerX + rulerWidth / 2}" y1="${rulerY - tickHeight / 2}" x2="${rulerX + rulerWidth / 2}" y2="${rulerY + tickHeight / 2}" stroke="#000000" stroke-width="2" />`
      );
      svgParts.push(
        `<line x1="${rulerX + rulerWidth}" y1="${rulerY - tickHeight / 2}" x2="${rulerX + rulerWidth}" y2="${rulerY + tickHeight / 2}" stroke="#000000" stroke-width="2" />`
      );

      // Ratio text
      const ratioValue = `M 1:${Math.floor(ratio)}`;
      const ratioText = `${formatDistance(targetRulerDistance)} - ${ratioValue}`;
      const textY = rulerY - 15;
      const textX = rulerX + rulerWidth / 2;
      svgParts.push(
        `<text x="${textX}" y="${textY}" font-family="Arial, sans-serif" font-size="12" fill="#000000" text-anchor="middle">${ratioText}</text>`
      );

      svgParts.push('</g>');
    };

    addRulerAndRatio();

    // Add information panel at the bottom right corner
    const addInfoPanel = () => {
      // Get view name translation
      const viewNameMap = {
        spatialView : i18n.t('ui.panels.export.infoPanel.spatialView'),
        planView    : i18n.t('ui.panels.export.infoPanel.planView'),
        profileView : i18n.t('ui.panels.export.infoPanel.profileView')
      };
      const viewName = viewNameMap[view.name] || view.name;
      const ratio = scene.view.ratio;
      const ratioValue = `M 1:${Math.floor(ratio)}`;
      // Get export date
      const exportDate = new Date();
      const dateText = exportDate.toLocaleDateString();
      const timeText = exportDate.toLocaleTimeString();

      // Get cave name (use first visible cave or concatenate all)
      const visibleCaves = Array.from(caves.values()).filter((c) => c.visible);
      const caveName = visibleCaves.length === 1 ? visibleCaves[0].name : visibleCaves.map((c) => c.name).join(', ');

      // Get project name
      const projectName = project?.name || i18n.t('ui.footer.noProjectLoaded');

      // Panel dimensions and position
      const panelWidth = 250;
      // Calculate height: 6 items * (label + value + spacing) + top padding + bottom padding
      // Each item: lineHeight (label) + lineHeight (value) + 3 (spacing) = 43px
      // 6 items = 258px, plus top padding (30px) = 288px, round to 290px
      const panelHeight = 290;
      const panelX = width - panelWidth - 20;
      const panelY = height - panelHeight - 20;
      const padding = 10;
      const lineHeight = 18;
      const fontSize = 11;
      const labelFontSize = 10;
      const itemSpacing = 3;

      // Create info panel group
      const infoPanelGroupId = getLayerName('InfoPanel');
      svgParts.push(`<g id="${infoPanelGroupId}" data-name="Info Panel">`);

      // Panel background with frame
      svgParts.push(
        `<rect x="${panelX}" y="${panelY}" width="${panelWidth}" height="${panelHeight}" fill="#ffffff" stroke="#000000" stroke-width="1" />`
      );

      // Inner frame
      svgParts.push(
        `<rect x="${panelX + 2}" y="${panelY + 2}" width="${panelWidth - 4}" height="${panelHeight - 4}" fill="none" stroke="#000000" stroke-width="0.5" />`
      );

      let currentY = panelY + padding + lineHeight;

      // Helper function to add a label-value pair
      const addInfoField = (labelKey, value) => {
        svgParts.push(
          `<text x="${panelX + padding}" y="${currentY}" font-family="Arial, sans-serif" font-size="${labelFontSize}" fill="#666666" font-weight="bold">${i18n.t(labelKey)}:</text>`
        );
        currentY += lineHeight;
        svgParts.push(
          `<text x="${panelX + padding}" y="${currentY}" font-family="Arial, sans-serif" font-size="${fontSize}" fill="#000000">${value}</text>`
        );
        currentY += lineHeight + itemSpacing;
      };

      // Add all information fields
      addInfoField('ui.panels.export.infoPanel.caveName', caveName);
      addInfoField('ui.panels.export.infoPanel.ratio', ratioValue);
      addInfoField('ui.panels.export.infoPanel.exportDate', `${dateText} ${timeText}`);
      addInfoField('ui.panels.export.infoPanel.speleoStudio', i18n.t('ui.about.title'));
      addInfoField('ui.panels.export.infoPanel.projectName', projectName);
      addInfoField('ui.panels.export.infoPanel.viewName', viewName);

      svgParts.push('</g>');
    };

    addInfoPanel();

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

  /**
   * Export caves to KML (Keyhole Markup Language) format for use with Google Earth and other GIS software.
   * The KML file contains:
   * - Placemarks for each survey station with WGS84 coordinates
   * - LineStrings connecting stations according to survey shots
   * - Organized in folders by cave and survey
   *
   * @param {Map} caves - Map of cave objects to export
   * @param {string} fileName - Base filename for the export (without extension)
   */
  static exportKML(caves, fileName) {
    const lines = [];

    // XML declaration and KML root element
    lines.push('<?xml version="1.0" encoding="UTF-8"?>');
    lines.push('<kml xmlns="http://www.opengis.net/kml/2.2">');
    lines.push('<Document>');
    lines.push(`  <name>${this.escapeXml(fileName)}</name>`);
    lines.push('  <description>Cave survey data exported from Speleo Studio</description>');

    // Define styles for stations and centerlines
    lines.push('  <Style id="stationStyle">');
    lines.push('    <IconStyle>');
    lines.push('      <scale>0.6</scale>');
    lines.push('      <Icon>');
    lines.push('        <href>http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href>');
    lines.push('      </Icon>');
    lines.push('      <color>ff00ffff</color>');
    lines.push('    </IconStyle>');
    lines.push('    <LabelStyle>');
    lines.push('      <scale>0.7</scale>');
    lines.push('    </LabelStyle>');
    lines.push('  </Style>');

    lines.push('  <Style id="centerLineStyle">');
    lines.push('    <LineStyle>');
    lines.push('      <color>ff0000ff</color>');
    lines.push('      <width>2</width>');
    lines.push('    </LineStyle>');
    lines.push('  </Style>');

    lines.push('  <Style id="splayStyle">');
    lines.push('    <LineStyle>');
    lines.push('      <color>8000ff00</color>');
    lines.push('      <width>1</width>');
    lines.push('    </LineStyle>');
    lines.push('  </Style>');

    let hasGeoData = false;

    caves.values().forEach((cave) => {
      // Check if cave has geo data for coordinate conversion
      if (!cave.geoData || !cave.geoData.coordinateSystem || cave.geoData.coordinates.length === 0) {
        console.warn(`Cave "${cave.name}" has no geo data, skipping KML export for this cave`);
        return;
      }

      hasGeoData = true;

      // Build a map of station names to their WGS84 coordinates
      const stationCoords = new Map();
      const coordinateSystem = cave.geoData.coordinateSystem;

      // Get reference coordinate from geoData
      const refCoord = cave.geoData.coordinates[0];
      if (!refCoord) {
        console.warn(`Cave "${cave.name}" has no reference coordinate, skipping`);
        return;
      }

      // Calculate WGS84 coordinates for all stations
      cave.stations.forEach((station, stationName) => {
        // Calculate the projected coordinate by adding station position to reference
        const projectedCoord = refCoord.coordinate.addVector(station.position);

        try {
          const wgs84 = WGS84Converter.toLatLon(projectedCoord, coordinateSystem);
          stationCoords.set(stationName, {
            lat       : wgs84.latitude,
            lon       : wgs84.longitude,
            elevation : projectedCoord.elevation !== undefined ? projectedCoord.elevation : station.position.z
          });
        } catch (e) {
          console.warn(`Failed to convert coordinates for station "${stationName}": ${e.message}`);
        }
      });

      if (stationCoords.size === 0) {
        console.warn(`Cave "${cave.name}" has no valid station coordinates, skipping`);
        return;
      }

      // Create folder for cave
      lines.push(`  <Folder>`);
      lines.push(`    <name>${this.escapeXml(cave.name)}</name>`);

      if (cave.metadata) {
        const metaDesc = [];
        if (cave.metadata.settlement) metaDesc.push(`Settlement: ${cave.metadata.settlement}`);
        if (cave.metadata.catasterCode) metaDesc.push(`Cataster code: ${cave.metadata.catasterCode}`);
        if (cave.metadata.country) metaDesc.push(`Country: ${cave.metadata.country}`);
        if (cave.metadata.region) metaDesc.push(`Region: ${cave.metadata.region}`);
        if (metaDesc.length > 0) {
          lines.push(`    <description>${this.escapeXml(metaDesc.join('\n'))}</description>`);
        }
      }

      // Create subfolder for surveys (centerlines)
      lines.push('    <Folder>');
      lines.push(`      <name>${i18n.t('common.surveys')}</name>`);

      cave.surveys.forEach((survey) => {
        lines.push('      <Folder>');
        lines.push(`        <name>${this.escapeXml(survey.name)}</name>`);

        // Group shots by type
        const centerShots = survey.shots.filter((s) => s.isCenter());
        const splayShots = survey.shots.filter((s) => s.isSplay());

        // Export center line as connected LineString
        if (centerShots.length > 0) {
          lines.push('        <Placemark>');
          lines.push(`          <name>${i18n.t('ui.settingsPanel.groups.centerLines')}</name>`);
          lines.push('          <styleUrl>#centerLineStyle</styleUrl>');
          lines.push('          <MultiGeometry>');

          centerShots.forEach((shot) => {
            const fromCoord = stationCoords.get(survey.getFromStationName(shot));
            const toCoord = stationCoords.get(survey.getToStationName(shot));

            if (fromCoord && toCoord) {
              lines.push('            <LineString>');
              lines.push('              <altitudeMode>absolute</altitudeMode>');
              lines.push('              <coordinates>');
              lines.push(`                ${fromCoord.lon},${fromCoord.lat},${fromCoord.elevation}`);
              lines.push(`                ${toCoord.lon},${toCoord.lat},${toCoord.elevation}`);
              lines.push('              </coordinates>');
              lines.push('            </LineString>');
            }
          });

          lines.push('          </MultiGeometry>');
          lines.push('        </Placemark>');
        }

        // Export splays
        if (splayShots.length > 0) {
          lines.push('        <Placemark>');
          lines.push(`          <name>${i18n.t('ui.settingsPanel.groups.splays')}</name>`);
          lines.push('          <styleUrl>#splayStyle</styleUrl>');
          lines.push('          <MultiGeometry>');

          splayShots.forEach((shot) => {
            const fromCoord = stationCoords.get(survey.getFromStationName(shot));
            const toCoord = stationCoords.get(survey.getToStationName(shot));

            if (fromCoord && toCoord) {
              lines.push('            <LineString>');
              lines.push('              <altitudeMode>absolute</altitudeMode>');
              lines.push('              <coordinates>');
              lines.push(`                ${fromCoord.lon},${fromCoord.lat},${fromCoord.elevation}`);
              lines.push(`                ${toCoord.lon},${toCoord.lat},${toCoord.elevation}`);
              lines.push('              </coordinates>');
              lines.push('            </LineString>');
            } else {
              console.warn(`Failed to get coordinates for shot "${shot.id}": ${shot.from} or ${shot.to}`);
            }
          });

          lines.push('          </MultiGeometry>');
          lines.push('        </Placemark>');
        }

        lines.push('      </Folder>');
      });

      lines.push('    </Folder>');

      // Create subfolder for stations (hidden by default)
      lines.push('    <Folder>');
      lines.push(`      <name>${i18n.t('common.stations')}</name>`);
      lines.push('      <visibility>0</visibility>');

      stationCoords.forEach((coord, stationName) => {
        const station = cave.stations.get(stationName);
        // Skip splay stations in the stations folder
        if (station && station.type === ShotType.SPLAY) return;

        lines.push('      <Placemark>');
        lines.push(`        <name>${this.escapeXml(stationName)}</name>`);
        lines.push('        <styleUrl>#stationStyle</styleUrl>');
        lines.push('        <Point>');
        lines.push('          <altitudeMode>absolute</altitudeMode>');
        lines.push(`          <coordinates>${coord.lon},${coord.lat},${coord.elevation}</coordinates>`);
        lines.push('        </Point>');
        lines.push('      </Placemark>');
      });

      lines.push('    </Folder>');

      lines.push('  </Folder>');
    });

    lines.push('</Document>');
    lines.push('</kml>');

    if (!hasGeoData) {
      showErrorPanel(i18n.t('errors.export.noGeoDataForKml'));
      return;
    }

    const blob = new Blob([lines.join('\n')], { type: 'application/vnd.google-earth.kml+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileName}.kml`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * Escape special XML characters to prevent malformed KML output
   * @param {string} str - String to escape
   * @returns {string} Escaped string safe for XML
   */
  static escapeXml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  static executeExport(caves, scene, panel, project = null) {

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
          Exporter.exportSVG(caves, scene, filename, project);
          break;
        case 'kml':
          Exporter.exportKML(caves, filename);
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
              <option value="kml">KML</option>
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
    Exporter.executeExport(this.caves, this.scene, this.panel, this.project);
    this.close();
  }

}

export { Exporter, ExportWindow };
