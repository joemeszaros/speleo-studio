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

import { i18n } from '../i18n/i18n.js';
import { showErrorPanel } from './popups.js';

export class WGS84Dialog {
  constructor() {
    this.dialog = null;
    this.resolve = null;
    this.reject = null;
  }

  /**
   * Show WGS84 coordinate input dialog
   * @returns {Promise<{latitude: number, longitude: number}>} Promise that resolves with coordinates in decimal degrees
   */
  show() {
    return new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
      this.createDialog();
    });
  }

  createDialog() {
    // Create dialog container
    this.dialog = document.createElement('div');
    this.dialog.className = 'coordinate-system-dialog';
    const doubleQuote = '"';
    this.dialog.innerHTML = `
      <div class="coordinate-system-container coordinate-system-content">
        <h3>${i18n.t('ui.panels.wgs84.title')}</h3>

        <div class="settings-group">
          <div class="settings-group-title">
            <span>${i18n.t('ui.panels.wgs84.format')}</span>
          </div>
          <div class="settings-group-content">
            <div class="settings-item">
              <label>
                <input type="radio" name="coordinateFormat" value="dd" checked class="settings-input">
                <span class="settings-checkbox-label">
                  <strong>${i18n.t('ui.panels.wgs84.decimalDegrees')}</strong><br>
                  <small>${i18n.t('ui.panels.wgs84.ddDescription')}</small>
                </span>
              </label>
            </div>
            <div class="settings-item">
              <label>
                <input type="radio" name="coordinateFormat" value="dms" class="settings-input">
                <span class="settings-checkbox-label">
                  <strong>${i18n.t('ui.panels.wgs84.degreesMinutesSeconds')}</strong><br>
                  <small>${i18n.t('ui.panels.wgs84.dmsDescription')}</small>
                </span>
              </label>
            </div>
          </div>
        </div>

        <div class="settings-group" id="dd-inputs">
          <div class="settings-group-title">
            <span>${i18n.t('ui.panels.wgs84.decimalDegrees')}</span>
          </div>
          <div class="settings-group-content">
            <div class="settings-item">
              <label class="settings-label">${i18n.t('ui.panels.wgs84.latitude')}:</label>
              <input type="number" id="lat-dd" step="any" min="-90" max="90" class="settings-input" placeholder="47.123456">
            </div>
            <div class="settings-item">
              <label class="settings-label">${i18n.t('ui.panels.wgs84.longitude')}:</label>
              <input type="number" id="lon-dd" step="any" min="-180" max="180" class="settings-input" placeholder="19.123456">
            </div>
          </div>
        </div>

        <div class="settings-group" id="dms-inputs" style="display: none;">
          <div class="settings-group-title">
            <span>${i18n.t('ui.panels.wgs84.degreesMinutesSeconds')}</span>
          </div>
          <div class="settings-group-content">
            <div class="settings-item">
              <label class="settings-label">${i18n.t('ui.panels.wgs84.latitude')}:</label>
              <input type="text" id="lat-dms" class="settings-input" placeholder="47°2'34.55&quot;N">
            </div>
            <div class="settings-item">
              <label class="settings-label">${i18n.t('ui.panels.wgs84.longitude')}:</label>
              <input type="text" id="lon-dms" class="settings-input" placeholder="19°1'23.45&quot;E">
            </div>
          </div>
        </div>

        <div class="config-buttons-container">
          <button type="button" class="settings-button" id="wgs84-cancel">${i18n.t('common.cancel')}</button>
          <button type="button" class="settings-button" id="wgs84-ok">${i18n.t('common.ok')}</button>
        </div>
      </div>
    `;

    // Add event listeners
    this.setupEventListeners();

    // Show dialog
    document.body.appendChild(this.dialog);
    this.dialog.style.display = 'block';
    this.dialog.querySelector('.coordinate-system-container').focus();
  }

  setupEventListeners() {
    // Cancel button
    this.dialog.querySelector('#wgs84-cancel').addEventListener('click', () => {
      this.cancel();
      this.hide();
    });

    // OK button
    this.dialog.querySelector('#wgs84-ok').addEventListener('click', () => {
      this.handleOk();
    });

    // Format selection change
    this.dialog.querySelectorAll('input[name="coordinateFormat"]').forEach((radio) => {
      radio.addEventListener('change', (e) => {
        this.handleFormatChange(e.target.value);
      });
    });

    // Auto-convert DD to DMS when DD input changes
    this.dialog.querySelector('#lat-dd').addEventListener('input', () => {
      this.convertDDToDMS('lat');
    });

    this.dialog.querySelector('#lon-dd').addEventListener('input', () => {
      this.convertDDToDMS('lon');
    });

    // Auto-convert DMS to DD when DMS inputs change
    this.dialog.querySelector('#lat-dms').addEventListener('input', () => {
      this.convertDMSToDD('lat');
    });

    this.dialog.querySelector('#lon-dms').addEventListener('input', () => {
      this.convertDMSToDD('lon');
    });

    // Close on overlay click
    this.dialog.addEventListener('click', (e) => {
      if (e.target === this.dialog) {
        this.hide();
      }
    });

    // Close on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.dialog) {
        this.hide();
      }
    });
  }

  /**
   * Handle format selection change
   * @param {string} format - 'dd' or 'dms'
   */
  handleFormatChange(format) {
    const ddInputs = this.dialog.querySelector('#dd-inputs');
    const dmsInputs = this.dialog.querySelector('#dms-inputs');

    if (format === 'dd') {
      ddInputs.style.display = 'block';
      dmsInputs.style.display = 'none';
    } else {
      ddInputs.style.display = 'none';
      dmsInputs.style.display = 'block';
    }
  }

  /**
   * Convert decimal degrees to degrees/minutes/seconds
   * @param {string} coord - 'lat' or 'lon'
   */
  convertDDToDMS(coord) {
    const ddInput = this.dialog.querySelector(`#${coord}-dd`);
    const ddValue = parseFloat(ddInput.value);

    if (isNaN(ddValue)) return;

    const absValue = Math.abs(ddValue);
    const degrees = Math.floor(absValue);
    const minutesFloat = (absValue - degrees) * 60;
    const minutes = Math.floor(minutesFloat);
    const seconds = (minutesFloat - minutes) * 60;

    // Determine hemisphere
    let hemisphere;
    if (coord === 'lat') {
      hemisphere = ddValue >= 0 ? 'N' : 'S';
    } else {
      hemisphere = ddValue >= 0 ? 'E' : 'W';
    }

    // Format as DMS string
    const dmsString = `${degrees}°${minutes}'${seconds.toFixed(3)}"${hemisphere}`;

    // Update DMS input
    this.dialog.querySelector(`#${coord}-dms`).value = dmsString;
  }

  /**
   * Parse DMS string to decimal degrees
   * @param {string} dmsString - DMS string like "47°7'24.44"N"
   * @returns {Object} {degrees: number, minutes: number, seconds: number, hemisphere: string}
   */
  parseDMSString(dmsString) {
    // Remove extra spaces and normalize
    const normalized = dmsString.trim().replace(/\s+/g, ' ');

    // Match patterns like: 47°7'24.44"N or 47°7'24"N or 47°7'N
    const dmsPattern = /^(\d+(?:\.\d+)?)°(\d+(?:\.\d+)?)'(?:(\d+(?:\.\d+)?)")?([NSEW])$/i;
    const match = normalized.match(dmsPattern);

    if (!match) {
      throw new Error(i18n.t('ui.panels.wgs84.invalidDMSFormat'));
    }

    const degrees = parseFloat(match[1]);
    const minutes = parseFloat(match[2]);
    const seconds = match[3] ? parseFloat(match[3]) : 0;
    const hemisphere = match[4].toUpperCase();

    return { degrees, minutes, seconds, hemisphere };
  }

  /**
   * Convert degrees/minutes/seconds to decimal degrees
   * @param {string} coord - 'lat' or 'lon'
   */
  convertDMSToDD(coord) {
    const dmsInput = this.dialog.querySelector(`#${coord}-dms`);
    const dmsString = dmsInput.value.trim();

    if (!dmsString) return;

    try {
      const { degrees, minutes, seconds, hemisphere } = this.parseDMSString(dmsString);

      // Convert to decimal degrees
      let dd = degrees + minutes / 60 + seconds / 3600;

      // Apply hemisphere sign
      if (coord === 'lat' && hemisphere === 'S') {
        dd = -dd;
      } else if (coord === 'lon' && hemisphere === 'W') {
        dd = -dd;
      }

      // Update DD input
      this.dialog.querySelector(`#${coord}-dd`).value = dd.toFixed(6);
    } catch (error) {
      // Don't update DD input if DMS parsing fails
      console.warn(`Failed to parse DMS for ${coord}:`, error.message);
    }
  }

  handleOk() {
    const selectedFormat = this.dialog.querySelector('input[name="coordinateFormat"]:checked').value;
    let latDD, lonDD;

    if (selectedFormat === 'dd') {
      // Get values from DD inputs
      latDD = parseFloat(this.dialog.querySelector('#lat-dd').value);
      lonDD = parseFloat(this.dialog.querySelector('#lon-dd').value);
    } else {
      // Get values from DMS inputs and convert to DD
      try {
        const latDMS = this.dialog.querySelector('#lat-dms').value.trim();
        const lonDMS = this.dialog.querySelector('#lon-dms').value.trim();

        if (!latDMS || !lonDMS) {
          alert(i18n.t('ui.panels.wgs84.invalidCoordinates'));
          return;
        }

        const latParsed = this.parseDMSString(latDMS);
        const lonParsed = this.parseDMSString(lonDMS);

        // Convert to decimal degrees
        latDD = latParsed.degrees + latParsed.minutes / 60 + latParsed.seconds / 3600;
        lonDD = lonParsed.degrees + lonParsed.minutes / 60 + lonParsed.seconds / 3600;

        // Apply hemisphere sign
        if (latParsed.hemisphere === 'S') latDD = -latDD;
        if (lonParsed.hemisphere === 'W') lonDD = -lonDD;
      } catch {
        showErrorPanel(i18n.t('ui.panels.wgs84.invalidDMSFormat'));
        return;
      }
    }

    // Validate coordinates
    if (isNaN(latDD) || isNaN(lonDD)) {
      showErrorPanel(i18n.t('ui.panels.wgs84.invalidCoordinates'));
      return;
    }

    if (latDD < -90 || latDD > 90) {
      showErrorPanel(i18n.t('ui.panels.wgs84.latitudeOutOfRange'));
      return;
    }

    if (lonDD < -180 || lonDD > 180) {
      showErrorPanel(i18n.t('ui.panels.wgs84.longitudeOutOfRange'));
      return;
    }

    this.hide();

    if (this.resolve) {
      this.resolve({ latitude: latDD, longitude: lonDD });
    }
  }

  hide() {
    if (this.dialog) {
      document.body.removeChild(this.dialog);
      this.dialog = null;
    }
  }

  cancel() {
    if (this.reject) {
      this.reject(new Error(i18n.t('ui.panels.wgs84.cancelled')));
    }
  }
}
