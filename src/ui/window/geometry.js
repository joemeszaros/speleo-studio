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
 * Pure geometry maths for floating windows. Deliberately free of any DOM access so that the rules
 * that keep a window reachable can be unit tested without a layout engine.
 *
 * A "bounds" is the rectangle left free by the navbar, the footer and the sidebar, in viewport
 * CSS pixels: { top, bottom, left, right }. See viewport-bounds.js for how it is measured.
 */

const MIN_WIDTH = 280;
const MIN_HEIGHT = 140;

// How much of the title bar must stay inside the bounds, on every side. A window can hang off the
// edge, but never so far that there is nothing left to grab.
const TITLEBAR_KEEP = 40;

const finite = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
const positive = (value) => {
  const n = finite(value);
  return n !== undefined && n > 0 ? n : undefined;
};

/**
 * The screen fingerprint stored alongside a geometry, so that a later restore can tell whether the
 * window it was saved on is the window it is being restored into.
 */
function fingerprint(bounds) {
  return {
    vw : Math.round(Math.max(0, bounds.right - bounds.left)),
    vh : Math.round(Math.max(0, bounds.bottom - bounds.top))
  };
}

/**
 * Turn an untrusted stored geometry into one that is guaranteed usable.
 *
 * Guarantees, in this order of precedence:
 *   - w and h are finite integers, greater than zero and never larger than the bounds
 *   - y is never above bounds.top, so the navbar can never be covered
 *   - at least TITLEBAR_KEEP pixels of the title bar remain inside the bounds on every side
 *   - a window that fits is placed fully inside the bounds
 *   - sanitize(sanitize(g)) === sanitize(g)
 *
 * @param {Object|undefined} stored      untrusted {x, y, w, h, vw, vh}, straight from localStorage
 * @param {Object} bounds                {top, bottom, left, right}
 * @param {Object} [defaultSize]         {width, height} used when nothing valid is stored
 * @returns {{x: number, y: number, w: number, h: number, refitted: boolean}}
 */
function sanitize(stored, bounds, defaultSize = {}) {
  const availWidth = Math.max(0, bounds.right - bounds.left);
  const availHeight = Math.max(0, bounds.bottom - bounds.top);

  // 1. Reject NaN, zero, negative and non finite. A resize handle click used to persist 0/0 here.
  let width = positive(stored?.w) ?? positive(defaultSize.width) ?? MIN_WIDTH;
  let height = positive(stored?.h) ?? positive(defaultSize.height) ?? MIN_HEIGHT;
  let x = finite(stored?.x);
  let y = finite(stored?.y);

  // 2. Screen fingerprint. When the usable area is not the one this geometry was saved on, refit
  //    proportionally instead of restoring verbatim. Only ever shrink: growing a window just
  //    because the user moved to a larger monitor is not what anyone expects.
  const vw = positive(stored?.vw);
  const vh = positive(stored?.vh);
  let refitted = false;

  if (vw !== undefined && vh !== undefined && (vw !== availWidth || vh !== availHeight)) {
    refitted = true;
    const scaleX = availWidth / vw;
    const scaleY = availHeight / vh;
    const scale = Math.min(1, scaleX, scaleY);
    width *= scale;
    height *= scale;
    if (x !== undefined) x = bounds.left + (x - bounds.left) * scaleX;
    if (y !== undefined) y = bounds.top + (y - bounds.top) * scaleY;
  }

  // 3. Clamp the size. The order matters: the min() against the available space comes LAST, so
  //    "larger than the viewport" is not a representable outcome. The old constrainPanelSize did
  //    max(minWidth, available - 20) and could therefore return more than the viewport held.
  width = Math.min(Math.max(Math.round(width), MIN_WIDTH), Math.max(1, availWidth));
  height = Math.min(Math.max(Math.round(height), MIN_HEIGHT), Math.max(1, availHeight));

  // 4. No stored position means centre it in the usable area.
  if (x === undefined) x = bounds.left + (availWidth - width) / 2;
  if (y === undefined) y = bounds.top + (availHeight - height) / 2;

  // 5. Keep the title bar grabbable. The max() is last on both axes so it wins on a tiny viewport.
  x = Math.min(x, bounds.right - TITLEBAR_KEEP);
  x = Math.max(x, bounds.left - width + TITLEBAR_KEEP);
  y = Math.min(y, bounds.bottom - TITLEBAR_KEEP);
  y = Math.max(y, bounds.top);

  // 6. If it fits at all, put it fully on screen.
  if (width <= availWidth) x = Math.min(Math.max(x, bounds.left), bounds.right - width);
  if (height <= availHeight) y = Math.min(Math.max(y, bounds.top), bounds.bottom - height);

  return { x: Math.round(x), y: Math.round(y), w: width, h: height, refitted };
}

/**
 * Clamp a size to the bounds without touching the position. Used while a resize gesture is in
 * flight, where the origin is worked out by the caller from which handle is being dragged.
 */
function clampSize(width, height, bounds) {
  return {
    w : Math.min(Math.max(Math.round(width), MIN_WIDTH), Math.max(1, bounds.right - bounds.left)),
    h : Math.min(Math.max(Math.round(height), MIN_HEIGHT), Math.max(1, bounds.bottom - bounds.top))
  };
}

/**
 * Push an already sized rectangle fully inside the bounds when it fits, otherwise pin it to the
 * top left. For transient things that are positioned rather than dragged: context menus, tooltips.
 */
function clampRect(rect, bounds) {
  const x =
    rect.width <= bounds.right - bounds.left
      ? Math.min(Math.max(rect.x, bounds.left), bounds.right - rect.width)
      : bounds.left;
  const y =
    rect.height <= bounds.bottom - bounds.top
      ? Math.min(Math.max(rect.y, bounds.top), bounds.bottom - rect.height)
      : bounds.top;
  return { x: Math.round(x), y: Math.round(y) };
}

export { sanitize, clampSize, clampRect, fingerprint, MIN_WIDTH, MIN_HEIGHT, TITLEBAR_KEEP };
