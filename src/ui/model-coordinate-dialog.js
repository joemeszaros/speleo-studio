/*
 * Copyright 2026 Joe Meszaros
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

import { i18n } from '../i18n/i18n.js';
import { parseMyFloat } from '../utils/utils.js';

/**
 * Dialog for entering WGS84 coordinates (lat, lon, elevation) for a 3D model.
 * Returns { latitude, longitude, elevation } or null if skipped.
 */
export class ModelCoordinateDialog {
  constructor() {
    this.dialog = null;
    this.resolve = null;
  }

  /**
   * Show the coordinate input dialog
   * @param {string} modelName - Name of the model being imported
   * @param {{latitude: number, longitude: number, elevation: number}|null} embeddedCoords - Pre-filled coords from file
   * @returns {Promise<{latitude: number, longitude: number, elevation: number}|null>}
   */
  show(modelName, embeddedCoords = null) {
    return new Promise((resolve) => {
      this.resolve = resolve;
      this.createDialog(modelName, embeddedCoords);
    });
  }

  createDialog(modelName, embeddedCoords) {
    const latVal = embeddedCoords?.latitude ?? '';
    const lonVal = embeddedCoords?.longitude ?? '';
    const elevVal = embeddedCoords?.elevation ?? 0;

    this.dialog = document.createElement('div');
    this.dialog.className = 'dialog-overlay';
    this.dialog.innerHTML = `
      <div class="dialog-container dialog-content">
        <p class="about-description">${i18n.t('ui.dialogs.modelCoordinate.message')}</p>
        <p><strong>${modelName}</strong></p>

        <div class="settings-group">
          <div class="settings-group-title">
            <span>${i18n.t('ui.dialogs.modelCoordinate.wgs84Coordinates')}</span>
          </div>
          <div class="settings-group-content">
            <div class="settings-item">
              <label class="settings-label">${i18n.t('ui.panels.coordinateSystem.wgs84.latitude')}:</label>
              <input type="number" id="model-coord-lat" step="any" class="settings-input" placeholder="47.5" value="${latVal}">
            </div>
            <div class="settings-item">
              <label class="settings-label">${i18n.t('ui.panels.coordinateSystem.wgs84.longitude')}:</label>
              <input type="number" id="model-coord-lon" step="any" class="settings-input" placeholder="19.0" value="${lonVal}">
            </div>
            <div class="settings-item">
              <label class="settings-label">${i18n.t('ui.panels.coordinateSystem.elevation')}:</label>
              <input type="number" id="model-coord-elev" step="any" class="settings-input" placeholder="0" value="${elevVal}">
            </div>
          </div>
        </div>

        <div class="config-buttons-container">
          <button type="button" class="settings-button" id="model-coord-ok">${i18n.t('common.ok')}</button>
          <button type="button" class="settings-button" id="model-coord-skip">${i18n.t('common.skip')}</button>
        </div>
      </div>
    `;

    this.setupEventListeners();
    document.body.appendChild(this.dialog);
    this.dialog.style.display = 'block';
    this.dialog.querySelector('#model-coord-lat').focus();
  }

  setupEventListeners() {
    this.dialog.querySelector('#model-coord-ok').addEventListener('click', () => {
      this.handleOk();
    });

    this.dialog.querySelector('#model-coord-skip').addEventListener('click', () => {
      this.hide();
      if (this.resolve) this.resolve(null);
    });

    this.dialog.addEventListener('click', (e) => {
      if (e.target === this.dialog) {
        this.hide();
        if (this.resolve) this.resolve(null);
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.dialog) {
        this.hide();
        if (this.resolve) this.resolve(null);
      }
    });
  }

  handleOk() {
    const latitude = parseMyFloat(this.dialog.querySelector('#model-coord-lat').value);
    const longitude = parseMyFloat(this.dialog.querySelector('#model-coord-lon').value);
    const elevation = parseMyFloat(this.dialog.querySelector('#model-coord-elev').value);

    if (isNaN(latitude) || isNaN(longitude)) {
      // If no valid coordinates, treat as skip
      this.hide();
      if (this.resolve) this.resolve(null);
      return;
    }

    this.hide();
    if (this.resolve) {
      this.resolve({
        latitude,
        longitude,
        elevation : isNaN(elevation) ? 0 : elevation
      });
    }
  }

  hide() {
    if (this.dialog) {
      document.body.removeChild(this.dialog);
      this.dialog = null;
    }
  }
}
