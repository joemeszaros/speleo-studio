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
    this._batchTotal = 0;
    this._batchDone = 0;
  }

  /**
   * Begin a batch of N items. The progress bar will scale sub-item progress
   * to the overall batch (e.g. item 3/8 at 50% shows as ~31% of the batch).
   * @param {number} total - Total number of items in the batch
   */
  beginBatch(total) {
    this._batchTotal = Number.isFinite(total) && total > 0 ? total : 0;
    this._batchDone = 0;
    if (this._batchTotal > 0) this.updateProgress(0);
  }

  /**
   * Mark one batch item as done. Bar jumps to the next item's starting value.
   */
  advanceBatch() {
    if (this._batchTotal <= 0) return;
    this._batchDone = Math.min(this._batchDone + 1, this._batchTotal);
    this.updateProgress(0);
  }

  /** End the current batch and clear state. */
  endBatch() {
    this._batchTotal = 0;
    this._batchDone = 0;
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
        <div class="loading-progress" style="visibility: hidden;">
          <div class="loading-progress-fill"></div>
        </div>
      </div>`;
    this.element.style.display = 'block';
    document.body.appendChild(this.element);
  }

  /**
   * Update the message text on the currently visible overlay.
   * @param {string} message - The new message to display
   */
  updateMessage(message) {
    if (!this.element) return;
    const msgEl = this.element.querySelector('.loading-message');
    if (msgEl) msgEl.textContent = message;
  }

  /**
   * Update the progress bar. Reveals the bar on first call.
   * @param {number} percent - 0..100. Omitted/non-numeric leaves the bar unchanged
   *   so a missing percent on one progress event doesn't make the bar flicker.
   */
  updateProgress(percent) {
    if (!this.element) return;
    if (typeof percent !== 'number' || !Number.isFinite(percent)) return;
    const bar = this.element.querySelector('.loading-progress');
    const fill = this.element.querySelector('.loading-progress-fill');
    if (!bar || !fill) return;
    const clamped = Math.max(0, Math.min(100, percent));
    // If a batch is active, map the per-item percent to the overall batch span.
    const display = this._batchTotal > 0
      ? ((this._batchDone + clamped / 100) / this._batchTotal) * 100
      : clamped;
    bar.style.visibility = 'visible';
    fill.style.width = `${display}%`;
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
    this.endBatch();
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
    // Wait for a real paint cycle so the overlay is on screen before heavy
    // synchronous work (OBJ/PLY parsing) blocks the main thread.
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 0))));
    try {
      return await fn();
    } finally {
      this.hide();
    }
  }
}
