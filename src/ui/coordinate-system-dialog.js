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
import { EOVCoordinateSystem, UTMCoordinateSystem } from '../model/geo.js';

export class CoordinateSystemDialog {
  constructor() {
    this.dialog = null;
    this.resolve = null;
    this.reject = null;
  }

  /**
   * Show coordinate system selection dialog
   * @param {Object} options - Dialog options
   * @param {string} options.title - Dialog title
   * @param {string} options.message - Dialog message
   * @param {Object} options.coordinates - Sample coordinates to help user choose
   * @returns {Promise<CoordinateSystem>} Promise that resolves with selected coordinate system
   */
  show(caveName, startPointCoordinates) {
    return new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
      this.createDialog(caveName, startPointCoordinates);
    });
  }

  createDialog(caveName, startPointCoordinates) {
    // Create dialog container
    this.dialog = document.createElement('div');
    this.dialog.className = 'coordinate-system-dialog';
    this.dialog.innerHTML = `
      <div class="coordinate-system-container coordinate-system-content">
        
          <p class="about-description">${i18n.t('ui.panels.coordinateSystem.message')}</p>

          <p>${i18n.t('ui.panels.coordinateSystem.startPointCoordinates')}: ${caveName} - (${startPointCoordinates.join(', ')})</p>
          <div class="settings-group">
            <div class="settings-group-title">
              <span>${i18n.t('ui.panels.coordinateSystem.selection')}</span>
            </div>
            <div class="settings-group-content">
              <div class="settings-item">
                <label>
                  <input type="radio" name="coordinateSystem" value="eov" checked class="settings-input">
                  <span class="settings-checkbox-label">
                    <strong>${i18n.t('ui.panels.coordinateSystem.eov.title')}</strong><br>
                    <small>${i18n.t('ui.panels.coordinateSystem.eov.description')}</small>
                  </span>
                </label>
              </div>
              <div class="settings-item">
                <label>
                  <input type="radio" name="coordinateSystem" value="utm" class="settings-input">
                  <span class="settings-checkbox-label">
                    <strong>${i18n.t('ui.panels.coordinateSystem.utm.title')}</strong><br>
                    <small>${i18n.t('ui.panels.coordinateSystem.utm.description')}</small>
                  </span>
                </label>
              </div>
              <div class="settings-subgroup" id="utm-options" style="display: none;">
                <div class="settings-subgroup-title">
                  <span>${i18n.t('ui.panels.coordinateSystem.utm.title')} ${i18n.t('ui.panels.coordinateSystem.utm.zone')}</span>
                </div>
                <div class="settings-subgroup-content">
                  <div class="settings-item">
                    <label class="settings-label">${i18n.t('ui.panels.coordinateSystem.utm.zone')}:</label>
                    <input type="number" id="utm-zone" min="1" max="60" value="33" class="settings-input" required>
                  </div>
                  <div class="settings-item">
                    <label class="settings-label">${i18n.t('ui.panels.coordinateSystem.utm.hemisphere')}:</label>
                    <select id="utm-hemisphere" class="settings-input" required>
                      <option value="N">${i18n.t('ui.panels.coordinateSystem.utm.northern')}</option>
                      <option value="S">${i18n.t('ui.panels.coordinateSystem.utm.southern')}</option>
                    </select>
                  </div>
                </div>
              </div>
              <div class="settings-item">
                <label>
                  <input type="radio" name="coordinateSystem" value="none" class="settings-input">
                  <span class="settings-checkbox-label">
                    <strong>${i18n.t('ui.panels.coordinateSystem.none.title')}</strong><br>
                    <small>${i18n.t('ui.panels.coordinateSystem.none.description')}</small>
                  </span>
                </label>
              </div>              
            </div>
          </div>
          <div class="config-buttons-container">
            <button type="button" class="settings-button" id="coordinate-system-cancel">${i18n.t('common.cancel')}</button>
            <button type="button" class="settings-button" id="coordinate-system-ok">${i18n.t('common.ok')}</button>
          </div>
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
    this.dialog.querySelector('#coordinate-system-cancel').addEventListener('click', () => {
      this.cancel();
    });

    // OK button
    this.dialog.querySelector('#coordinate-system-ok').addEventListener('click', () => {
      this.handleOk();
    });

    // Coordinate system selection change
    this.dialog.querySelectorAll('input[name="coordinateSystem"]').forEach((radio) => {
      radio.addEventListener('change', (e) => {
        this.handleCoordinateSystemChange(e.target.value);
      });
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

  handleCoordinateSystemChange(value) {
    const utmOptions = this.dialog.querySelector('#utm-options');
    if (value === 'utm') {
      utmOptions.style.display = 'block';
    } else {
      utmOptions.style.display = 'none';
    }
  }

  handleOk() {
    const selectedSystem = this.dialog.querySelector('input[name="coordinateSystem"]:checked').value;

    let coordinateSystem;
    if (selectedSystem === 'eov') {
      coordinateSystem = new EOVCoordinateSystem();
    } else if (selectedSystem === 'utm') {
      const zone = parseInt(this.dialog.querySelector('#utm-zone').value);
      const hemisphere = this.dialog.querySelector('#utm-hemisphere').value;
      switch (hemisphere) {
        case 'N':
          coordinateSystem = new UTMCoordinateSystem(zone, true);
          break;
        case 'S':
          coordinateSystem = new UTMCoordinateSystem(zone, false);
          break;
        default:
          throw new Error(i18n.t('ui.panels.coordinateSystem.invalidHemisphere'));
      }
    } else if (selectedSystem === 'none') {
      coordinateSystem = undefined;
    }
    console.log(`🧭 Selected coordinate system: ${coordinateSystem?.toString() ?? 'none'}`);

    this.hide();
    if (this.resolve) {
      this.resolve(coordinateSystem);
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
      this.reject(new Error(i18n.t('ui.panels.coordinateSystem.cancelled')));
    }
  }
}
