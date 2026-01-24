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

import { wm } from '../window.js';
import { node } from '../../utils/utils.js';
import { i18n } from '../../i18n/i18n.js';

export class RoseDiagramTool {

  constructor(db, panel = '#tool-panel') {
    this.db = db;
    this.panel = document.querySelector(panel);
    this.panel.style.width = '450px';

    // Default settings
    this.binCount = 36; // Number of direction bins (36 = 10° each)
    this.selectedCave = null;
    this.diagramSize = 350;
    this.diagramPadding = 50;
  }

  show() {
    wm.makeFloatingPanel(
      this.panel,
      (contentElmnt) => this.build(contentElmnt),
      'ui.panels.roseDiagram.title',
      true,
      true,
      { width: 450, height: 520 },
      () => {
        // Cleanup when panel is closed
      }
    );
  }

  /**
   * Get all centerline shots from a cave
   * @param {string} caveName - Name of the cave
   * @returns {Array} Array of shots with azimuth and length
   */
  getCenterlineShots(caveName) {
    const cave = this.db.getCave(caveName);
    if (!cave) return [];

    const shots = [];
    cave.surveys.forEach((survey) => {
      // Skip isolated surveys
      if (survey.isolated === true) return;

      survey.validShots.forEach((shot) => {
        if (
          shot.isCenter() &&
          survey.visible === true &&
          shot.azimuth !== undefined &&
          shot.azimuth !== null &&
          shot.length !== undefined &&
          shot.length !== null &&
          !isNaN(shot.azimuth) &&
          !isNaN(shot.length) &&
          shot.length > 0
        ) {
          shots.push({
            azimuth : shot.azimuth,
            length  : shot.length
          });
        }
      });
    });
    return shots;
  }

  /**
   * Bin the shots by azimuth direction, weighted by length
   * @param {Array} shots - Array of shots with azimuth and length
   * @param {number} binCount - Number of bins
   * @returns {Array} Array of bin values (cumulative length per bin)
   */
  calculateBins(shots, binCount) {
    const binSize = 360 / binCount;
    const bins = new Array(binCount).fill(0);
    let totalLength = 0;

    shots.forEach((shot) => {
      // Normalize azimuth to 0-360
      let azimuth = shot.azimuth % 360;
      if (azimuth < 0) azimuth += 360;

      // Calculate bin index
      const binIndex = Math.floor(azimuth / binSize) % binCount;
      bins[binIndex] += shot.length;
      totalLength += shot.length;
    });

    return { bins, totalLength };
  }

  /**
   * Generate SVG path for a rose diagram petal
   * @param {number} startAngle - Start angle in degrees
   * @param {number} endAngle - End angle in degrees
   * @param {number} radius - Radius of the petal
   * @param {number} centerX - X coordinate of center
   * @param {number} centerY - Y coordinate of center
   * @returns {string} SVG path string
   */
  generatePetalPath(startAngle, endAngle, radius, centerX, centerY) {
    // Convert to radians, adjusting for SVG coordinate system (0° is up, clockwise)
    const startRad = ((startAngle - 90) * Math.PI) / 180;
    const endRad = ((endAngle - 90) * Math.PI) / 180;

    const x1 = centerX + radius * Math.cos(startRad);
    const y1 = centerY + radius * Math.sin(startRad);
    const x2 = centerX + radius * Math.cos(endRad);
    const y2 = centerY + radius * Math.sin(endRad);

    // Use arc for the outer edge
    const largeArcFlag = endAngle - startAngle > 180 ? 1 : 0;

    return `M ${centerX} ${centerY} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${x2} ${y2} Z`;
  }

  /**
   * Draw the rose diagram as SVG
   * @param {Array} bins - Array of bin values
   * @param {HTMLElement} container - Container element for the SVG
   */
  drawDiagram(bins, totalLength, container) {
    const size = this.diagramSize;
    const padding = this.diagramPadding;
    const centerX = size / 2;
    const centerY = size / 2;
    const maxRadius = size / 2 - padding;

    // Find max bin value for scaling
    const maxBin = Math.max(...bins, 1);

    // Clear container
    container.innerHTML = '';

    // Create SVG element
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', size);
    svg.setAttribute('height', size);
    svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
    svg.style.backgroundColor = '#1a1a2e';
    svg.style.borderRadius = '8px';

    // Draw concentric circles for reference with percentage labels
    const circleCount = 4;
    for (let i = 1; i <= circleCount; i++) {
      const r = (maxRadius * i) / circleCount;
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', centerX);
      circle.setAttribute('cy', centerY);
      circle.setAttribute('r', r);
      circle.setAttribute('fill', 'none');
      circle.setAttribute('stroke', '#333355');
      circle.setAttribute('stroke-width', '1');
      circle.setAttribute('stroke-dasharray', '3,3');
      svg.appendChild(circle);

      // Add percentage and length labels on the NE diagonal (45°)
      const lengthValue = (maxBin * i) / circleCount;
      const labelRad = ((45 - 90) * Math.PI) / 180; // 45° position (NE)
      const labelX = centerX + r * Math.cos(labelRad) + 5;
      const labelY = centerY + r * Math.sin(labelRad) - 3;

      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', labelX);
      label.setAttribute('y', labelY);
      label.setAttribute('fill', '#666688');
      label.setAttribute('font-size', '9');
      label.setAttribute('font-family', 'sans-serif');
      label.textContent = `${lengthValue.toFixed(0)}m`;
      svg.appendChild(label);
    }

    // Draw direction lines every 30 degrees
    const directions = [
      { angle: 0, label: 'N', isCardinal: true },
      { angle: 30, label: '30°', isCardinal: false },
      { angle: 60, label: '60°', isCardinal: false },
      { angle: 90, label: 'E', isCardinal: true },
      { angle: 120, label: '120°', isCardinal: false },
      { angle: 150, label: '150°', isCardinal: false },
      { angle: 180, label: 'S', isCardinal: true },
      { angle: 210, label: '210°', isCardinal: false },
      { angle: 240, label: '240°', isCardinal: false },
      { angle: 270, label: 'W', isCardinal: true },
      { angle: 300, label: '300°', isCardinal: false },
      { angle: 330, label: '330°', isCardinal: false }
    ];

    directions.forEach(({ angle, label, isCardinal }) => {
      const rad = ((angle - 90) * Math.PI) / 180;
      const labelDistance = isCardinal ? maxRadius + 18 : maxRadius + 14;
      const x = centerX + labelDistance * Math.cos(rad);
      const y = centerY + labelDistance * Math.sin(rad);

      // Draw line
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', centerX);
      line.setAttribute('y1', centerY);
      line.setAttribute('x2', centerX + maxRadius * Math.cos(rad));
      line.setAttribute('y2', centerY + maxRadius * Math.sin(rad));
      line.setAttribute('stroke', isCardinal ? '#555577' : '#333355');
      line.setAttribute('stroke-width', isCardinal ? '1' : '0.5');
      line.setAttribute('stroke-dasharray', isCardinal ? 'none' : '2,2');
      svg.appendChild(line);

      // Draw label
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', x);
      text.setAttribute('y', y);
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('dominant-baseline', 'middle');
      text.setAttribute('fill', isCardinal ? '#aaaacc' : '#777799');
      text.setAttribute('font-size', isCardinal ? '14' : '10');
      text.setAttribute('font-weight', isCardinal ? 'bold' : 'normal');
      text.textContent = label;
      svg.appendChild(text);
    });

    // Draw petals
    const binSize = 360 / bins.length;
    const colorStart = '#4a9eff'; // Blue
    const colorEnd = '#ff4a9e'; // Pink

    bins.forEach((value, i) => {
      if (value > 0) {
        const startAngle = i * binSize;
        const endAngle = (i + 1) * binSize;
        const radius = (value / maxBin) * maxRadius;

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', this.generatePetalPath(startAngle, endAngle, radius, centerX, centerY));

        // Color gradient based on azimuth
        const t = i / bins.length;
        const color = this.interpolateColor(colorStart, colorEnd, t);
        path.setAttribute('fill', color);
        path.setAttribute('fill-opacity', '0.7');
        path.setAttribute('stroke', '#ffffff');
        path.setAttribute('stroke-width', '1');
        path.setAttribute('stroke-opacity', '1');

        // Add tooltip
        const lengthValue = value.toFixed(2);
        const direction = `${startAngle.toFixed(0)}°-${endAngle.toFixed(0)}°`;
        const pct = (value / totalLength) * 100;
        path.innerHTML = `<title>${direction}: ${lengthValue}m (${pct.toFixed(0)}%)</title>`;

        svg.appendChild(path);
      }
    });

    // Draw center point
    const centerDot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    centerDot.setAttribute('cx', centerX);
    centerDot.setAttribute('cy', centerY);
    centerDot.setAttribute('r', 4);
    centerDot.setAttribute('fill', '#ffffff');
    svg.appendChild(centerDot);

    container.appendChild(svg);
  }

  /**
   * Interpolate between two hex colors
   */
  interpolateColor(color1, color2, t) {
    const r1 = parseInt(color1.slice(1, 3), 16);
    const g1 = parseInt(color1.slice(3, 5), 16);
    const b1 = parseInt(color1.slice(5, 7), 16);
    const r2 = parseInt(color2.slice(1, 3), 16);
    const g2 = parseInt(color2.slice(3, 5), 16);
    const b2 = parseInt(color2.slice(5, 7), 16);

    const r = Math.round(r1 + (r2 - r1) * t);
    const g = Math.round(g1 + (g2 - g1) * t);
    const b = Math.round(b1 + (b2 - b1) * t);

    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }

  /**
   * Update the diagram based on current selection
   */
  updateDiagram(diagramContainer) {
    if (!this.selectedCave) {
      diagramContainer.innerHTML = `<div style="text-align: center; color: #888; padding: 50px;">${i18n.t('ui.panels.roseDiagram.selectCave')}</div>`;
      return;
    }

    const shots = this.getCenterlineShots(this.selectedCave);

    if (shots.length === 0) {
      diagramContainer.innerHTML = `<div style="text-align: center; color: #888; padding: 50px;">${i18n.t('ui.panels.roseDiagram.noData')}</div>`;
      return;
    }

    const { bins, totalLength } = this.calculateBins(shots, this.binCount);

    this.drawDiagram(bins, totalLength, diagramContainer);
  }

  build(contentElmnt) {
    const cNames = this.db.getAllCaveNames();

    // Build cave selector
    const optionCaveNames = cNames.map((n) => `<option value="${n}">${n}</option>`).join('');
    const caveSelector = node`
      <div class="rose-controls">
        <label for="rose-cave-select">${i18n.t('common.cave')}: 
          <select id="rose-cave-select" name="cave-names">
            <option value="">${i18n.t('ui.panels.roseDiagram.selectCave')}</option>
            ${optionCaveNames}
          </select>
        </label>
        <label for="rose-bin-count">${i18n.t('ui.panels.roseDiagram.binCount')}: 
          <select id="rose-bin-count" name="bin-count">
            <option value="8">8 (45°)</option>
            <option value="16">16 (22.5°)</option>
            <option value="24">24 (15°)</option>
            <option value="36" selected>36 (10°)</option>
            <option value="72">72 (5°)</option>
          </select>
        </label>
      </div>
    `;

    const diagramContainer = node`<div id="rose-diagram-container" style="display: flex; justify-content: center; margin: 10px 0;"></div>`;

    // Add styles
    const styles = document.createElement('style');
    styles.textContent = `
      .rose-controls {
        display: flex;
        gap: 15px;
        margin-bottom: 10px;
        flex-wrap: wrap;
      }
      .rose-controls label {
        display: flex;
        align-items: center;
        gap: 5px;
      }
      .rose-controls select {
        padding: 4px 8px;
        border-radius: 4px;
        border: 1px solid #555;
        background: #2a2a3e;
        color: #fff;
      }
      #rose-diagram-container svg {
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      }
    `;

    contentElmnt.appendChild(styles);
    contentElmnt.appendChild(caveSelector);
    contentElmnt.appendChild(diagramContainer);

    // Event handlers
    const caveSelect = caveSelector.querySelector('#rose-cave-select');
    const binSelect = caveSelector.querySelector('#rose-bin-count');

    caveSelect.onchange = () => {
      this.selectedCave = caveSelect.value || null;
      this.updateDiagram(diagramContainer);
    };

    binSelect.onchange = () => {
      this.binCount = parseInt(binSelect.value);
      this.updateDiagram(diagramContainer);
    };

    // Initialize with first cave if available
    if (cNames.length > 0) {
      this.selectedCave = cNames[0];
      caveSelect.value = cNames[0];
      this.updateDiagram(diagramContainer);
    } else {
      this.updateDiagram(diagramContainer);
    }
  }
}
