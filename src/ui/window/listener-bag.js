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
 * Collects every subscription a component makes so that all of them can be undone with a single
 * call. Anything that is attached to a DOM node inside a window dies with that node when the
 * window is removed; this is for the rest: listeners on `document` / `window`, observers, timers
 * and the scene's own event emitters.
 *
 * Disposers run in reverse order of registration, each one guarded, so a single throwing disposer
 * cannot strand the others. `dispose()` is idempotent.
 */
class ListenerBag {

  #disposers = [];
  #disposed = false;

  /**
   * Add an event listener and remember how to remove it.
   * Works with anything exposing addEventListener/removeEventListener, including the scene's own
   * emitters in scene/control.js and scene/views.js.
   * @returns {Function} the handler, so it can be kept for other purposes
   */
  on(target, type, handler, options) {
    if (!target) return handler;
    target.addEventListener(type, handler, options);
    this.#disposers.push(() => target.removeEventListener(type, handler, options));
    return handler;
  }

  /**
   * Subscribe to the application wide event bus, which is plain `document` + CustomEvent.
   */
  onDoc(type, handler, options) {
    return this.on(document, type, handler, options);
  }

  /**
   * Register an arbitrary cleanup function.
   */
  add(disposer) {
    this.#disposers.push(disposer);
    return disposer;
  }

  /**
   * Start an observer (ResizeObserver, IntersectionObserver, MutationObserver) and disconnect it
   * on dispose.
   */
  observe(observer, target, options) {
    observer.observe(target, options);
    this.#disposers.push(() => observer.disconnect());
    return observer;
  }

  timeout(fn, ms) {
    const id = setTimeout(fn, ms);
    this.#disposers.push(() => clearTimeout(id));
    return id;
  }

  interval(fn, ms) {
    const id = setInterval(fn, ms);
    this.#disposers.push(() => clearInterval(id));
    return id;
  }

  raf(fn) {
    const id = requestAnimationFrame(fn);
    this.#disposers.push(() => cancelAnimationFrame(id));
    return id;
  }

  get disposed() {
    return this.#disposed;
  }

  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    for (let i = this.#disposers.length - 1; i >= 0; i--) {
      try {
        this.#disposers[i]();
      } catch (error) {
        console.warn('ListenerBag disposer failed', error);
      }
    }
    this.#disposers.length = 0;
  }
}

export { ListenerBag };
