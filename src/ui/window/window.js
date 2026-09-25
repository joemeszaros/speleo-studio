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

import { node } from '../../utils/utils.js';
import { i18n } from '../../i18n/i18n.js';
import { ListenerBag } from './listener-bag.js';
import { getUsableBounds } from './viewport-bounds.js';
import { sanitize, clampSize, fingerprint } from './geometry.js';
import { windowManager, WindowManager } from './manager.js';

/**
 * A single floating window.
 *
 * The element is created here and removed on close, which is what makes the lifetime tractable:
 * every listener attached to anything inside the window dies with the element, and the bag takes
 * care of the rest (document, window, observers, timers).
 *
 *   const win = new Window({ key: 'editor.survey', title: () => '...', variant: 'editor' });
 *   win.open((content) => this.buildPanel(content));
 */
class Window {

  /**
   * Which edges a resize handle moves, and in which direction. A negative factor means dragging
   * towards positive screen coordinates makes the window smaller, which is what the north and west
   * handles do while their opposite edge stays put.
   */
  static #RESIZE_HANDLES = {
    n  : { width: 0, height: -1, movesTop: true, movesLeft: false },
    s  : { width: 0, height: 1, movesTop: false, movesLeft: false },
    e  : { width: 1, height: 0, movesTop: false, movesLeft: false },
    w  : { width: -1, height: 0, movesTop: false, movesLeft: true },
    ne : { width: 1, height: -1, movesTop: true, movesLeft: false },
    nw : { width: -1, height: -1, movesTop: true, movesLeft: true },
    se : { width: 1, height: 1, movesTop: false, movesLeft: false },
    sw : { width: -1, height: 1, movesTop: false, movesLeft: true }
  };

  /** How far a second window of the same kind is nudged clear of the first. */
  static #CASCADE_STEP = 28;

  static #slug(value) {
    return String(value)
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase();
  }

  /**
   * @param {Object} params
   * @param {string} params.key               geometry key, e.g. 'editor.survey'
   * @param {string} [params.instanceId]      discriminator when siblings can be open at once
   * @param {string|Function} params.title    i18n key, or a function returning the title
   * @param {string} [params.variant]         adds the class `popup--<variant>`
   * @param {boolean} [params.resizable=true]
   * @param {boolean} [params.minimizable=true]
   * @param {{width: number, height: number}} [params.defaultSize]
   * @param {boolean} [params.persistGeometry=false]
   * @param {{x: number, y: number}} [params.at]  preferred position, clamped like any other
   * @param {Function} [params.onClose]       (content, saveOnExit) => void
   * @param {Function} [params.onResize]      (width, height) => void
   */
  constructor({
    key,
    instanceId,
    title,
    variant,
    resizable = true,
    minimizable = true,
    defaultSize = {},
    persistGeometry = false,
    at,
    onClose,
    onResize
  }) {
    if (!key) throw new Error('A Window needs a key');

    this.key = key;
    this.instanceId = instanceId;
    this.id = WindowManager.idOf(key, instanceId);
    this.title = title;
    this.variant = variant;
    this.resizable = resizable;
    this.minimizable = minimizable;
    this.defaultSize = defaultSize;
    this.persistGeometry = persistGeometry;
    this.at = at;
    this.onCloseFn = onClose;
    this.onResizeFn = onResize;

    this.bag = new ListenerBag();
    this.opened = false;
    this.closed = false;

    // Instance state, never persisted, gone the moment this window closes. The old manager kept
    // it in a Map keyed by DOM id that close() never cleared, so a window closed while minimized
    // reopened believing it was still minimized and silently refused to resize.
    this.minimized = false;
    this.restoreHeight = undefined;

    // Offset applied so this window does not land exactly on a sibling. Taken back off again
    // when the geometry is persisted, so repeatedly opening and closing siblings cannot make
    // the remembered position drift across the screen.
    this.cascadeOffset = 0;
    this.movedByUser = false;
  }

  // ── lifecycle ───────────────────────────────────────────────────────────────

  /**
   * Build the frame, let the caller fill the content, place it and show it.
   * @param {Function} buildFn (content, close) => void
   */
  open(buildFn) {
    if (this.opened) throw new Error(`Window ${this.id} is already open`);
    this.opened = true;

    const existing = windowManager.get(this.key, this.instanceId);
    if (existing !== undefined && existing !== this) existing.close();

    this.#rememberFocus();
    this.#buildFrame();
    windowManager.register(this);

    // Size before filling: a Tabulator table asked for height 100% needs its container to already
    // have a definite height, otherwise it initialises at zero rows.
    this.applyStoredGeometry();

    buildFn?.(this.content, (saveOnExit) => this.close(saveOnExit));

    this.element.focus({ preventScroll: true });

    return this;
  }

  close(saveOnExit = true) {
    if (this.closed || !this.opened) return;
    this.closed = true;

    this.#commitGeometry();

    try {
      this.onCloseFn?.(this.content, saveOnExit);
    } catch (error) {
      console.error(`Window ${this.id} close handler failed`, error);
    }

    this.bag.dispose();
    this.element.remove();
    windowManager.forget(this);
    this.#restoreFocus();
  }

  focus() {
    windowManager.activate(this);
    this.element.focus({ preventScroll: true });
  }

  setTitle(title) {
    if (title !== undefined) this.title = title;
    this.titleElement.textContent = this.#resolveTitle();
  }

  #resolveTitle() {
    return typeof this.title === 'function' ? this.title() : i18n.t(this.title);
  }

  /** The title as it currently reads, for listing this window elsewhere. */
  get titleText() {
    return this.titleElement?.textContent ?? this.#resolveTitle();
  }

  // ── frame ───────────────────────────────────────────────────────────────────

  /** The title bar, its buttons and the resize handles: everything around the content. */
  #buildFrame() {
    const domId = this.#chooseDomId();
    const titleId = `${domId}-title`;

    this.element = node`<div class="popup" id="${domId}" role="dialog" aria-labelledby="${titleId}" tabindex="-1"></div>`;
    this.element.dataset.windowKey = this.key;
    if (this.instanceId !== undefined) this.element.dataset.windowInstance = String(this.instanceId);
    if (this.variant) this.element.classList.add(`popup--${this.variant}`);

    const header = node`<div class="popup-header"></div>`;
    this.titleElement = node`<h2 class="popup-title" id="${titleId}"></h2>`;
    this.titleElement.textContent = this.#resolveTitle();
    header.appendChild(this.titleElement);

    if (this.minimizable) {
      this.minimizeButton = node`<button type="button" class="minimize" aria-expanded="true"></button>`;
      this.minimizeButton.setAttribute('aria-label', i18n.t('ui.window.minimize'));
      this.minimizeButton.setAttribute('aria-controls', `${domId}-content`);
      this.bag.on(this.minimizeButton, 'click', () => this.toggleMinimize());
      header.appendChild(this.minimizeButton);
    }

    this.closeButton = node`<button type="button" class="close"></button>`;
    this.closeButton.setAttribute('aria-label', i18n.t('ui.window.close'));
    this.bag.on(this.closeButton, 'click', () => this.close());
    header.appendChild(this.closeButton);

    this.header = header;
    this.element.appendChild(header);

    this.content = node`<div class="popup-content-div" id="${domId}-content"></div>`;
    this.element.appendChild(this.content);

    if (this.resizable) {
      Object.keys(Window.#RESIZE_HANDLES).forEach((direction) => {
        const handle = node`<div class="popup-resizer popup-resizer--${direction}"></div>`;
        handle.dataset.direction = direction;
        this.element.appendChild(handle);
        this.#bindResize(handle, direction);
      });
    }

    this.#bindDrag(header);

    // Capture phase, so Tabulator's own handlers cannot swallow the activation, and pointerdown
    // rather than click, so a drag starts with the window already on top.
    this.bag.on(this.element, 'pointerdown', () => windowManager.activate(this), { capture: true, passive: true });

    // The manager re-evaluates the title and rebuilds the content on a language change, which is
    // why individual editors must not subscribe to languageChanged themselves.
    this.bag.onDoc('languageChanged', () => this.#onLanguageChanged());

    if (this.onResizeFn) {
      this.bag.observe(
        new ResizeObserver(() => {
          const rect = this.content.getBoundingClientRect();
          this.onResizeFn(rect.width, rect.height);
        }),
        this.content
      );
    }
  }

  /**
   * A stable element id derived from what the window is, not from the order it opened in.
   * Address a window by `[data-window-key]` (plus `[data-window-instance]` when several of a kind
   * can be open) rather than by this.
   */
  #chooseDomId() {
    return `win-${Window.#slug(this.key)}${this.instanceId ? `-${Window.#slug(this.instanceId)}` : ''}`;
  }

  #onLanguageChanged() {
    this.setTitle();
    if (this.minimizeButton) this.minimizeButton.setAttribute('aria-label', i18n.t('ui.window.minimize'));
    this.closeButton.setAttribute('aria-label', i18n.t('ui.window.close'));
    if (this.rebuildFn) {
      this.content.replaceChildren();
      this.rebuildFn(this.content, (saveOnExit) => this.close(saveOnExit));
    }
  }

  /**
   * Register the builder that should run again when the language changes. Editors that can be
   * cheaply rebuilt pass their build function here; the rest just retitle.
   */
  rebuildOnLanguageChange(buildFn) {
    this.rebuildFn = buildFn;
    return this;
  }

  // ── geometry ────────────────────────────────────────────────────────────────

  /**
   * Position and size the window from what was persisted, falling back to the default size and a
   * centred position. Everything goes through the sanitizer, so nothing stored can put the window
   * somewhere it cannot be reached from.
   */
  applyStoredGeometry({ ignoreStored = false } = {}) {
    const bounds = getUsableBounds();
    const stored = ignoreStored || !this.persistGeometry ? undefined : windowManager.readGeometry(this.key);
    const preferred = stored ?? (this.at ? { x: this.at.x, y: this.at.y } : undefined);
    let geometry = sanitize(preferred, bounds, this.defaultSize);

    // Geometry is remembered per key, so without this every survey editor would open in exactly
    // the same place and the second one would look like nothing had happened. A window opened at
    // an explicit anchor (the info panels, next to the cursor) is already where it belongs.
    this.cascadeOffset = 0;
    if (this.at === undefined) {
      const siblings = windowManager.siblingCount(this.key, this);
      if (siblings > 0) {
        // Wrap rather than run off the edge, so the cascade never needs clamping back onto its
        // own starting point.
        const room = Math.min(bounds.right - bounds.left - geometry.w, bounds.bottom - bounds.top - geometry.h);
        const steps = Math.max(1, Math.floor(room / Window.#CASCADE_STEP));
        this.cascadeOffset = Window.#CASCADE_STEP * (((siblings - 1) % steps) + 1);
        geometry = sanitize(
          { ...geometry, x: geometry.x + this.cascadeOffset, y: geometry.y + this.cascadeOffset },
          bounds,
          this.defaultSize
        );
      }
    }

    this.#apply(geometry, bounds);
  }

  /**
   * Re-run the sanitizer against a changed usable area, keeping the current position and size as
   * the preference. Called by the manager on resize and on sidebar changes.
   */
  refit(bounds = getUsableBounds()) {
    if (this.closed) return;
    const rect = this.element.getBoundingClientRect();
    const height = this.minimized ? (this.restoreHeight ?? rect.height) : rect.height;
    this.#apply(sanitize({ x: rect.left, y: rect.top, w: rect.width, h: height }, bounds, this.defaultSize), bounds);
  }

  #apply(geometry, bounds = getUsableBounds()) {
    const style = this.element.style;
    style.left = `${geometry.x}px`;
    style.top = `${geometry.y}px`;
    style.width = `${geometry.w}px`;

    // A single clamping authority: the sanitizer. The stylesheet must not also cap the size.
    style.maxWidth = `${Math.max(1, bounds.right - bounds.left)}px`;
    style.maxHeight = `${Math.max(1, bounds.bottom - bounds.top)}px`;

    if (this.minimized) {
      this.restoreHeight = geometry.h;
    } else {
      style.height = `${geometry.h}px`;
    }
  }

  getGeometry() {
    const rect = this.element.getBoundingClientRect();
    return {
      x : Math.round(rect.left),
      y : Math.round(rect.top),
      w : Math.round(rect.width),
      h : Math.round(this.minimized ? (this.restoreHeight ?? rect.height) : rect.height)
    };
  }

  /**
   * The only place geometry is persisted, and it reads the element rather than any scratch value
   * left over from a gesture. That is deliberate: the old manager saved the running totals of its
   * resize loop, which were still zero when a handle was clicked without being dragged, and wrote
   * that 0/0 straight into the config.
   */
  #commitGeometry() {
    if (!this.persistGeometry || !this.element) return;
    const bounds = getUsableBounds();
    const geometry = this.getGeometry();

    // A window the user never moved is still sitting on its cascade offset, which belongs to
    // this window rather than to the key. Persisting it would walk the remembered position a
    // little further every time siblings are opened and closed.
    if (!this.movedByUser && this.cascadeOffset !== 0) {
      geometry.x -= this.cascadeOffset;
      geometry.y -= this.cascadeOffset;
    }

    windowManager.writeGeometry(this.key, { ...geometry, ...fingerprint(bounds) });
  }

  // ── minimize ────────────────────────────────────────────────────────────────

  toggleMinimize() {
    if (!this.minimizable) return;

    if (!this.minimized) {
      this.restoreHeight = this.element.getBoundingClientRect().height;
      this.minimized = true;
      this.element.classList.add('minimized');
      // The height is released to the stylesheet so the window collapses onto its header.
      this.element.style.height = '';
    } else {
      this.minimized = false;
      this.element.classList.remove('minimized');
      if (this.restoreHeight !== undefined) this.element.style.height = `${this.restoreHeight}px`;
    }

    this.minimizeButton?.setAttribute('aria-expanded', String(!this.minimized));
    this.refit();
  }

  // ── gestures ────────────────────────────────────────────────────────────────

  /**
   * Pointer events with pointer capture. Nothing is attached to document, so a gesture cannot
   * outlive the window and cannot clobber another component's handlers the way the old
   * document.onmousemove assignment did.
   */
  #bindGesture(handle, onStart, onMove) {
    const pointerDown = (event) => {
      if (event.button !== 0) return;

      const start = onStart(event);
      if (!start) return;

      try {
        handle.setPointerCapture(event.pointerId);
      } catch {
        // Capture is an optimisation, not a requirement: without it a gesture can still be
        // tracked, it just stops following the pointer once it leaves the handle.
      }
      this.element.classList.add('dragging');

      let frame = 0;
      let pending = null;

      const flush = () => {
        frame = 0;
        if (pending === null) return;
        const delta = pending;
        pending = null;
        onMove(start, delta);
      };

      const pointerMove = (moveEvent) => {
        if (moveEvent.pointerId !== event.pointerId) return;
        pending = { dx: moveEvent.clientX - event.clientX, dy: moveEvent.clientY - event.clientY };
        if (!frame) frame = requestAnimationFrame(flush);
      };

      const finish = (endEvent) => {
        if (endEvent && endEvent.pointerId !== event.pointerId) return;
        if (frame) {
          cancelAnimationFrame(frame);
          frame = 0;
        }
        flush(); // never drop the last move
        handle.removeEventListener('pointermove', pointerMove);
        handle.removeEventListener('pointerup', finish);
        handle.removeEventListener('pointercancel', finish);
        handle.removeEventListener('lostpointercapture', finish);
        this.element.classList.remove('dragging');
        this.movedByUser = true;
        this.#commitGeometry();
      };

      handle.addEventListener('pointermove', pointerMove);
      handle.addEventListener('pointerup', finish);
      handle.addEventListener('pointercancel', finish);
      handle.addEventListener('lostpointercapture', finish);

      event.preventDefault();
    };

    this.bag.on(handle, 'pointerdown', pointerDown);
  }

  #bindDrag(header) {
    this.#bindGesture(
      header,
      (event) => {
        // Let the header's buttons behave like buttons.
        if (event.target instanceof Element && event.target.closest('button') !== null) return null;
        const rect = this.element.getBoundingClientRect();
        return { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
      },
      (start, { dx, dy }) => {
        const bounds = getUsableBounds();
        const height = this.minimized ? (this.restoreHeight ?? start.h) : start.h;
        this.#apply(
          sanitize({ x: start.x + dx, y: start.y + dy, w: start.w, h: height }, bounds, this.defaultSize),
          bounds
        );
      }
    );
  }

  #bindResize(handle, direction) {
    const axis = Window.#RESIZE_HANDLES[direction];

    this.#bindGesture(
      handle,
      () => {
        if (this.minimized) return null;
        const rect = this.element.getBoundingClientRect();
        return { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
      },
      (start, { dx, dy }) => {
        const bounds = getUsableBounds();
        const size = clampSize(start.w + axis.width * dx, start.h + axis.height * dy, bounds);
        // Move the origin by exactly as much as the size actually changed, so hitting the minimum
        // pins the opposite edge instead of sliding the whole window along.
        const x = axis.movesLeft ? start.x + (start.w - size.w) : start.x;
        const y = axis.movesTop ? start.y + (start.h - size.h) : start.y;
        this.#apply(sanitize({ x, y, w: size.w, h: size.h }, bounds, this.defaultSize), bounds);
      }
    );
  }

  // ── focus ───────────────────────────────────────────────────────────────────

  #rememberFocus() {
    this.previousFocus = document.activeElement;
  }

  #restoreFocus() {
    const previous = this.previousFocus;
    this.previousFocus = undefined;
    if (previous instanceof HTMLElement && previous.isConnected) {
      previous.focus({ preventScroll: true });
    }
  }
}

export { Window };
