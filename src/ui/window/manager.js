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

import { ListenerBag } from './listener-bag.js';
import { getUsableBounds } from './viewport-bounds.js';

/**
 * Owns everything that is shared between floating windows: the layer they live in, the stacking
 * order, which one is active, the application wide shortcuts and the persisted geometry.
 *
 * Individual windows are instances of Window (window.js); they register themselves here when they
 * open and drop out when they close.
 */
class WindowManager {

  static #LAYER_ID = 'window-layer';

  /**
   * Windows stack from here upwards. The layer is an isolated stacking context, so this counter
   * can climb for as long as the session lasts without ever escaping the layer.
   */
  static #BASE_Z_INDEX = 10;

  constructor() {
    this.windows = new Map();
    this.layer = undefined;
    this.options = undefined;

    this.active = undefined;

    this.bag = new ListenerBag();
    this.viewportListeners = new Set();
    this.zIndex = WindowManager.#BASE_Z_INDEX;
    this.initialized = false;
  }

  /**
   * Called once, from main.js, after the config proxy exists.
   * @param {Object} params
   * @param {Object} params.options  the watched config object
   * @param {HTMLElement} [params.layer]  the container windows are appended to; found by id when
   *        not given, which is what every caller wants
   */
  init({ options, layer }) {
    this.options = options;
    this.layer = layer ?? document.getElementById(WindowManager.#LAYER_ID);
    this.initialized = true;

    this.bag.onDoc('keydown', (event) => this.#onKeyDown(event));

    // Both a real window resize and a sidebar collapse change the usable area.
    this.bag.on(window, 'resize', () => this.#scheduleViewportSync());
    this.bag.onDoc('viewport-resized', () => this.#scheduleViewportSync());

    // The sidebar animates its width, so its final size is only known once the transition ends.
    const sidebar = document.getElementById('sidebar-container');
    this.bag.on(sidebar, 'transitionend', (event) => {
      if (event.propertyName === 'width') this.#scheduleViewportSync();
    });

    // Belt and braces. position:fixed plus overflow:clip should make it impossible for a window to
    // scroll the viewport, but a silently scrolled viewport has no scrollbar to scroll back with,
    // which is how the application became unusable in the first place. Shout if it ever happens.
    this.bag.on(
      document,
      'scroll',
      () => {
        const root = document.documentElement;
        if (root.scrollTop || root.scrollLeft) {
          console.warn(`Viewport scrolled to ${root.scrollLeft}/${root.scrollTop}, resetting`);
          root.scrollTop = 0;
          root.scrollLeft = 0;
        }
      },
      { capture: true, passive: true }
    );
  }

  #requireLayer() {
    if (this.layer) return this.layer;

    console.error('WindowManager.init() was never called, falling back to document.body');
    this.layer = document.body;
    return this.layer;
  }

  // ── window registry ─────────────────────────────────────────────────────────

  /**
   * Identity of a window: its logical key, plus an instance discriminator when several windows of
   * the same kind can be open at once (one survey editor per survey, for instance).
   */
  static idOf(key, instanceId) {
    return instanceId === undefined || instanceId === null || instanceId === '' ? key : `${key}::${instanceId}`;
  }

  get(key, instanceId) {
    return this.windows.get(WindowManager.idOf(key, instanceId));
  }

  /**
   * How many windows of this key are already open. A new one cascades clear of them, because
   * geometry is remembered per key and siblings would otherwise land exactly on top of each
   * other, making it look as though nothing had opened.
   */
  siblingCount(key, exclude) {
    let count = 0;
    this.windows.forEach((win) => {
      if (win.key === key && win !== exclude) count++;
    });
    return count;
  }

  register(win) {
    this.#requireLayer().appendChild(win.element);
    this.windows.set(win.id, win);
    this.activate(win);
  }

  forget(win) {
    this.windows.delete(win.id);
    if (this.active === win) {
      this.active = undefined;
      // Hand focus to whatever is now on top, so Ctrl+W keeps working without a click.
      const next = [...this.windows.values()].sort(
        (a, b) => Number(a.element.style.zIndex || 0) - Number(b.element.style.zIndex || 0)
      );
      if (next.length > 0) this.activate(next[next.length - 1]);
    }
    if (this.windows.size === 0) this.zIndex = WindowManager.#BASE_Z_INDEX;
  }

  closeAll() {
    [...this.windows.values()].forEach((win) => win.close());
  }

  // ── stacking ────────────────────────────────────────────────────────────────

  /**
   * The single authority on z order. Nothing else may write zIndex on a window.
   */
  activate(win) {
    if (this.active === win) return;
    this.active?.element.classList.remove('active');
    win.element.style.zIndex = String(++this.zIndex);
    win.element.classList.add('active');
    this.active = win;
    document.dispatchEvent(new CustomEvent('windowActivated', { detail: { key: win.key, id: win.id } }));
  }

  // ── geometry persistence ────────────────────────────────────────────────────

  /**
   * Geometry is stored per logical key, not per instance: every survey editor shares one
   * remembered size, which is what users expect and what stops one editor inheriting another's.
   */
  readGeometry(key) {
    return this.options?.ui?.windows?.[key];
  }

  writeGeometry(key, geometry) {
    if (!this.options?.ui) return;
    if (this.options.ui.windows === undefined) this.options.ui.windows = {};
    // One assignment, therefore one config save. Never call this from a pointermove frame: every
    // proxy set serialises the whole config into localStorage.
    this.options.ui.windows[key] = geometry;
  }

  /**
   * Escape hatch for a layout that has gone wrong: forget every remembered position and size and
   * re-centre whatever is currently open.
   */
  resetLayout() {
    if (this.options?.ui) {
      // A fresh object rather than deleting keys: the config proxy traps set, not deleteProperty,
      // so per-key deletion would never be persisted.
      this.options.ui.windows = {};
    }
    this.windows.forEach((win) => win.applyStoredGeometry({ ignoreStored: true }));
  }

  // ── viewport changes ────────────────────────────────────────────────────────

  /**
   * Anything that needs to react to the usable area changing can subscribe here rather than
   * adding another window resize listener of its own.
   */
  onViewportChange(listener) {
    this.viewportListeners.add(listener);
    return () => this.viewportListeners.delete(listener);
  }

  #scheduleViewportSync() {
    if (this.viewportSyncHandle) return;
    this.viewportSyncHandle = requestAnimationFrame(() => {
      this.viewportSyncHandle = undefined;
      const bounds = getUsableBounds();
      this.windows.forEach((win) => win.refit(bounds));
      this.viewportListeners.forEach((listener) => {
        try {
          listener(bounds);
        } catch (error) {
          console.warn('viewport change listener failed', error);
        }
      });
    });
  }

  // ── shortcuts ───────────────────────────────────────────────────────────────

  #onKeyDown(event) {
    if (event.key === 'w' && event.ctrlKey && this.active) {
      event.preventDefault();
      this.active.close();
      return;
    }

    // Escape closes the window only when the focus is on its frame. Tabulator binds Escape to
    // cancelling a cell edit, and a global Escape would throw that edit away.
    if (event.key === 'Escape' && this.active) {
      const target = event.target;
      if (!(target instanceof Element) || !this.active.element.contains(target)) return;
      if (target === this.active.element || target.closest('.popup-header') !== null) {
        event.preventDefault();
        this.active.close();
      }
    }
  }
}

const windowManager = new WindowManager();

export { windowManager, WindowManager };
