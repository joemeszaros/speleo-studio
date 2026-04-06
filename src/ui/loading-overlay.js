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

/**
 * Generic loading overlay for long-running operations.
 * Shows a spinner with a message. Prevents duplicate operations.
 *
 * Usage:
 *   const overlay = new LoadingOverlay();
 *   overlay.show('Exporting project...');
 *   try { await longOperation(); } finally { overlay.hide(); }
 *
 *   // Or use the guard helper:
 *   await overlay.guard('Exporting...', async () => { ... });
 */
export class LoadingOverlay {

  constructor() {
    this.element = null;
    this.active = false;
  }

  /**
   * Show the loading overlay with a message.
   * @param {string} message - The message to display
   */
  show(message = '') {
    if (this.active) return;
    this.active = true;

    this.element = document.createElement('div');
    this.element.className = 'loading-overlay';
    this.element.innerHTML = `
      <div class="loading-overlay-content">
        <div class="loading-spinner"></div>
        <div class="loading-message">${message}</div>
      </div>`;
    this.element.style.display = 'block';
    document.body.appendChild(this.element);
  }

  /**
   * Hide and remove the loading overlay.
   */
  hide() {
    if (this.element) {
      document.body.removeChild(this.element);
      this.element = null;
    }
    this.active = false;
  }

  /**
   * Returns true if the overlay is currently active.
   */
  isActive() {
    return this.active;
  }

  /**
   * Guard a long-running async operation with the overlay.
   * Prevents duplicate execution and ensures cleanup.
   * @param {string} message - The message to display
   * @param {Function} fn - Async function to execute
   * @returns {Promise<*>} The result of fn, or undefined if already active
   */
  async guard(message, fn) {
    if (this.active) return;
    this.show(message);
    try {
      return await fn();
    } finally {
      this.hide();
    }
  }
}
