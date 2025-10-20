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

export class EncodingSelectionDialog {
  constructor() {
    this.dialog = null;
    this.resolve = null;
    this.reject = null;
  }

  /**
   * Show encoding selection dialog
   * @param {string} fileName - Name of the file being imported
   * @returns {Promise<string>} Promise that resolves with selected encoding
   */
  show(fileName) {
    return new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
      this.createDialog(fileName);
    });
  }

  createDialog(fileName) {
    // Create dialog container
    this.dialog = document.createElement('div');
    this.dialog.className = 'dialog-overlay';
    this.dialog.innerHTML = `
      <div class="dialog-container dialog-content">
        
          <p class="about-description">${i18n.t('ui.panels.encodingSelection.message')}</p>

          <p><strong>${fileName}</strong></p>
         
          <div class="settings-group">
            <div class="settings-group-title">
              <span>${i18n.t('ui.panels.encodingSelection.title')}</span>
            </div>
            <div class="settings-group-content">
              <div class="settings-item">
                <label>
                  <input type="radio" name="encoding" value="utf8" class="settings-input">
                  <span class="settings-checkbox-label">
                    <strong>${i18n.t('ui.panels.encodingSelection.utf8.title')}</strong><br>
                    <small>${i18n.t('ui.panels.encodingSelection.utf8.description')}</small>
                  </span>
                </label>
              </div>
              <div class="settings-item">
                <label>
                  <input type="radio" name="encoding" value="iso_8859-2" checked class="settings-input">
                  <span class="settings-checkbox-label">
                    <strong>${i18n.t('ui.panels.encodingSelection.iso8859.title')}</strong><br>
                    <small>${i18n.t('ui.panels.encodingSelection.iso8859.description')}</small>
                  </span>
                </label>
              </div>
            </div>
          </div>
          <div class="config-buttons-container">
            <button type="button" class="settings-button" id="encoding-selection-ok">${i18n.t('common.ok')}</button>
            <button type="button" class="settings-button" id="encoding-selection-cancel">${i18n.t('common.cancel')}</button>
          </div>
        </div>
      </div>
    `;

    // Add event listeners
    this.setupEventListeners();

    // Show dialog
    document.body.appendChild(this.dialog);
    this.dialog.style.display = 'block';
    this.dialog.querySelector('.dialog-container').focus();
  }

  setupEventListeners() {

    // Cancel button
    this.dialog.querySelector('#encoding-selection-cancel').addEventListener('click', () => {
      this.cancel();
      this.hide();
    });

    // OK button
    this.dialog.querySelector('#encoding-selection-ok').addEventListener('click', () => {
      this.handleOk();
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

  handleOk() {
    const selectedEncoding = this.dialog.querySelector('input[name="encoding"]:checked').value;

    console.log(`📄 Selected encoding: ${selectedEncoding}`);

    this.hide();

    if (this.resolve) {
      this.resolve(selectedEncoding);
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
      this.reject(new Error(i18n.t('ui.panels.encodingSelection.cancelled')));
    }
  }
}
