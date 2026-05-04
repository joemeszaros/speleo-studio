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
 * Dialog asking how to render a DTM raster: as a triangle mesh or as a point cloud.
 * Returns 'mesh', 'pointcloud', or null (cancelled).
 */
export class AscRenderModeDialog {
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
        <p class="about-description">${i18n.t('ui.dialogs.ascRenderMode.message')}</p>
        <div class="config-buttons-container">
          <button type="button" class="settings-button" id="asc-mode-mesh">${i18n.t('ui.dialogs.ascRenderMode.mesh')}</button>
          <button type="button" class="settings-button" id="asc-mode-points">${i18n.t('ui.dialogs.ascRenderMode.pointCloud')}</button>
        </div>
      </div>
    `;

    this.setupEventListeners();
    document.body.appendChild(this.dialog);
    this.dialog.style.display = 'block';
    this.dialog.querySelector('#asc-mode-mesh').focus();
  }

  setupEventListeners() {
    this.dialog.querySelector('#asc-mode-mesh').addEventListener('click', () => {
      this.resolveAndClose('mesh');
    });

    this.dialog.querySelector('#asc-mode-points').addEventListener('click', () => {
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
