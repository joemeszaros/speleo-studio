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
 * Dialog that lets the user choose which master file(s) to import when a directory /
 * multi-file selection contains several candidate masters (each describing overlapping
 * caves). Multi-select: the top-ranked candidate is pre-checked, but the user can pick
 * one variant or several genuinely-different caves in one action.
 *
 * `candidates` is `[{ key, fileCount, title }]` (as produced by `findRootFiles`).
 * Returns `Promise<string[] | null>` — the chosen textMap keys, or `null` if cancelled.
 */
export class RootFileSelectionDialog {
  constructor() {
    this.dialog = null;
    this.resolve = null;
    this.keydownHandler = null;
  }

  show(candidates) {
    return new Promise((resolve) => {
      this.resolve = resolve;
      this.createDialog(candidates);
    });
  }

  createDialog(candidates) {
    const escapeHtml = (s) =>
      String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    // Type icons mirror the explorer / models tree (📷 orthophoto, 🏔 DTM, 🗿 model). The
    // localized type name is shown as a tooltip on hover.
    const TYPE_ICONS = { cave: '♎', model: '🗿', dtm: '🏔', orthophoto: '📷' };

    const items = candidates
      .map((c, idx) => {
        // One line: a type icon (cave / model / dtm / orthophoto), the human-readable name (the
        // file's `*title`, else its basename), the full path, and — only when it pulls in
        // others — the recursive file count.
        const name = c.title || c.key.split('/').pop();
        const type =
          c.type && TYPE_ICONS[c.type]
            ? `<span class="root-file-type" title="${escapeHtml(i18n.t('ui.panels.rootFileSelection.types.' + c.type))}">${TYPE_ICONS[c.type]}</span>`
            : '';
        const files =
          c.fileCount > 0
            ? `<small>· ${i18n.t('ui.panels.rootFileSelection.files', { count: c.fileCount })}</small>`
            : '';
        return `
          <div class="settings-item">
            <label>
              <input type="checkbox" name="root-file" value="${idx}" checked class="settings-input">
              <span class="settings-checkbox-label">
                ${type}
                <strong>${escapeHtml(name)}</strong>
                <small class="root-file-path">${escapeHtml(c.key)}</small>
                ${files}
              </span>
            </label>
          </div>`;
      })
      .join('');

    this.dialog = document.createElement('div');
    this.dialog.className = 'dialog-overlay';
    this.dialog.innerHTML = `
      <div class="dialog-container dialog-content root-file-dialog">
        <p class="about-description">${i18n.t('ui.panels.rootFileSelection.message')}</p>
        <div class="settings-group">
          <div class="settings-group-title">
            <span>${i18n.t('ui.panels.rootFileSelection.title')}</span>
          </div>
          <div class="settings-group-content">
            ${items}
          </div>
        </div>
        <div class="config-buttons-container">
          <button type="button" class="settings-button" id="root-file-ok">${i18n.t('ui.panels.rootFileSelection.importSelected')}</button>
          <button type="button" class="settings-button" id="root-file-cancel">${i18n.t('common.cancel')}</button>
        </div>
      </div>
    `;

    this.candidates = candidates;
    this.setupEventListeners();
    document.body.appendChild(this.dialog);
    this.dialog.style.display = 'block';
    this.updateOkState();
    this.dialog.querySelector('#root-file-ok').focus();
  }

  setupEventListeners() {
    this.dialog.querySelectorAll('input[name="root-file"]').forEach((cb) => {
      cb.addEventListener('change', () => this.updateOkState());
    });

    this.dialog.querySelector('#root-file-ok').addEventListener('click', () => {
      const keys = [...this.dialog.querySelectorAll('input[name="root-file"]:checked')].map(
        (cb) => this.candidates[+cb.value].key
      );
      if (keys.length > 0) this.resolveAndClose(keys);
    });

    this.dialog.querySelector('#root-file-cancel').addEventListener('click', () => {
      this.resolveAndClose(null);
    });

    this.dialog.addEventListener('click', (e) => {
      if (e.target === this.dialog) this.resolveAndClose(null);
    });

    this.keydownHandler = (e) => {
      if (e.key === 'Escape' && this.dialog) this.resolveAndClose(null);
    };
    document.addEventListener('keydown', this.keydownHandler);
  }

  // Disable "Import selected" when nothing is checked.
  updateOkState() {
    const anyChecked = this.dialog.querySelector('input[name="root-file"]:checked') !== null;
    this.dialog.querySelector('#root-file-ok').disabled = !anyChecked;
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
