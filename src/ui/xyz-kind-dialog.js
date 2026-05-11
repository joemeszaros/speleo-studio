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

/**
 * Dialog asking how to interpret an XYZ file: as a Digital Terrain Model
 * (regular grid → mesh option) or as a scattered point cloud.
 * Returns 'dtm', 'pointcloud', or null (cancelled).
 */
export class XyzKindDialog {
  constructor() {
    this.dialog = null;
    this.resolve = null;
    this.keydownHandler = null;
  }

  show() {
    return new Promise((resolve) => {
      this.resolve = resolve;
      this.createDialog();
    });
  }

  createDialog() {
    this.dialog = document.createElement('div');
    this.dialog.className = 'dialog-overlay';
    this.dialog.innerHTML = `
      <div class="dialog-container dialog-content">
        <p class="about-description">${i18n.t('ui.dialogs.xyzKind.message')}</p>
        <div class="config-buttons-container">
          <button type="button" class="settings-button" id="xyz-kind-dtm">${i18n.t('ui.dialogs.xyzKind.dtm')}</button>
          <button type="button" class="settings-button" id="xyz-kind-points">${i18n.t('ui.dialogs.xyzKind.pointCloud')}</button>
        </div>
      </div>
    `;

    this.setupEventListeners();
    document.body.appendChild(this.dialog);
    this.dialog.style.display = 'block';
    this.dialog.querySelector('#xyz-kind-dtm').focus();
  }

  setupEventListeners() {
    this.dialog.querySelector('#xyz-kind-dtm').addEventListener('click', () => {
      this.resolveAndClose('dtm');
    });

    this.dialog.querySelector('#xyz-kind-points').addEventListener('click', () => {
      this.resolveAndClose('pointcloud');
    });

    this.dialog.addEventListener('click', (e) => {
      if (e.target === this.dialog) this.resolveAndClose(null);
    });

    this.keydownHandler = (e) => {
      if (e.key === 'Escape' && this.dialog) this.resolveAndClose(null);
    };
    document.addEventListener('keydown', this.keydownHandler);
  }

  resolveAndClose(value) {
    this.hide();
    if (this.resolve) {
      const r = this.resolve;
      this.resolve = null;
      r(value);
    }
  }

  hide() {
    if (this.keydownHandler) {
      document.removeEventListener('keydown', this.keydownHandler);
      this.keydownHandler = null;
    }
    if (this.dialog) {
      document.body.removeChild(this.dialog);
      this.dialog = null;
    }
  }
}
