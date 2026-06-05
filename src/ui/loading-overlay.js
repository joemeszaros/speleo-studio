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
   * Show the loading overlay with a message. The element is appended synchronously, so callers
   * that don't care about timing can ignore the return value. The returned promise resolves once
   * the overlay has actually been painted to the screen (spinner + backdrop blur and all), so a
   * caller can `await overlay.show(...)` before blocking the main thread with heavy work.
   * @param {string} message - The message to display
   * @returns {Promise<void>} resolves after the overlay is on screen
   */
  show(message = '') {
    if (this.active) return Promise.resolve();
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

    return this.#whenPainted();
  }

  /**
   * Resolve after the overlay's first real paint. A requestAnimationFrame callback runs just
   * before a paint, so waiting two frames guarantees the frame carrying our newly-appended
   * element (and its backdrop blur) has been composited; the trailing setTimeout yields a
   * macrotask so that paint is flushed before we resolve.
   * @returns {Promise<void>}
   */
  #whenPainted() {
    return new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 0)))
    );
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
    // Wait for the overlay to paint before heavy synchronous work (OBJ/PLY parsing) blocks the
    // main thread, otherwise it would never appear.
    await this.show(message);
    try {
      return await fn();
    } finally {
      this.hide();
    }
  }

  /**
   * Like {@link guard}, but the overlay only appears if the operation is still
   * running after `delayMs`. Fast operations finish before the timer fires and
   * never flash an overlay; slow ones (e.g. a large multi-cave system) get one.
   * Relies on `fn` yielding to the event loop (await points) so the overlay can
   * paint once shown.
   * @param {string} message - The message to display if the overlay appears
   * @param {Function} fn - Async function to execute
   * @param {number} delayMs - How long to wait before showing the overlay
   * @returns {Promise<*>} The result of fn
   */
  async guardDeferred(message, fn, delayMs = 1000) {
    // An overlay is already showing — don't take ownership of it, just run.
    if (this.active) return await fn();
    let done = false;
    let shown = false;
    let timer = null;
    const tryShow = () => {
      if (done) return;
      // Cave import shows interactive coordinate/encoding dialogs; don't cover one
      // the user is filling in (it shares our z-index). Re-check shortly instead.
      if (document.querySelector('.dialog-overlay')) {
        timer = setTimeout(tryShow, 300);
        return;
      }
      shown = true;
      this.show(message);
    };
    timer = setTimeout(tryShow, delayMs);
    try {
      return await fn();
    } finally {
      done = true;
      if (timer) clearTimeout(timer);
      if (shown) this.hide();
    }
  }

  /**
   * Deferred reveal for long, mostly-synchronous work where a timer can't help — the main
   * thread is blocked, so {@link guardDeferred}'s setTimeout wouldn't fire until the work is
   * already done. Instead the caller polls.
   *
   * Returns `{ tick, done }`:
   *   - `await tick()` periodically from the work loop. It reveals the overlay exactly once,
   *     the first time `delayMs` has elapsed, and waits for a single paint so the overlay is
   *     actually on screen. Before the threshold and after the reveal it is a no-op, so the
   *     work stays fully synchronous (no repeated repaints / backdrop-blur recomputation).
   *   - `done()` in a `finally`. Hides the overlay only if this session showed it.
   *
   * @param {string} message - Message shown if/when the overlay appears
   * @param {number} delayMs - Reveal the overlay only once the work runs past this
   * @returns {{ tick: () => Promise<void>, done: () => void }}
   */
  deferredReveal(message, delayMs = 1000) {
    const start = performance.now();
    let shown = false;
    const tick = async () => {
      if (shown || this.active || performance.now() - start <= delayMs) return;
      if (document.querySelector('.dialog-overlay')) return; // don't cover an open dialog — retry next tick
      // await: let the overlay paint before the remaining synchronous work blocks the main thread.
      await this.show(message);
      shown = true;
    };
    const done = () => { if (shown) this.hide(); };
    return { tick, done };
  }
}
