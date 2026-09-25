import { describe, it, expect } from 'vitest';

import { sanitize, clampSize, clampRect, fingerprint, MIN_WIDTH, MIN_HEIGHT, TITLEBAR_KEEP } from '../../src/ui/window/geometry.js';

// A typical usable area: 1440x900 viewport, 48px navbar, 30px footer, 350px sidebar on the right.
const BOUNDS = { top: 48, bottom: 870, left: 0, right: 1090 };
const DEFAULT_SIZE = { width: 700, height: 300 };

const availWidth = (b) => b.right - b.left;
const availHeight = (b) => b.bottom - b.top;

/** Every guarantee the rest of the window manager is allowed to rely on. */
function expectUsable(result, bounds = BOUNDS) {
  expect(Number.isInteger(result.w)).toBe(true);
  expect(Number.isInteger(result.h)).toBe(true);
  expect(Number.isInteger(result.x)).toBe(true);
  expect(Number.isInteger(result.y)).toBe(true);

  expect(result.w).toBeGreaterThan(0);
  expect(result.h).toBeGreaterThan(0);
  expect(result.w).toBeLessThanOrEqual(Math.max(1, availWidth(bounds)));
  expect(result.h).toBeLessThanOrEqual(Math.max(1, availHeight(bounds)));

  // The navbar is never covered.
  expect(result.y).toBeGreaterThanOrEqual(bounds.top);

  // At least TITLEBAR_KEEP pixels of the title bar remain inside the bounds horizontally, and the
  // top edge stays above the bottom of the usable area.
  expect(result.x + result.w).toBeGreaterThanOrEqual(bounds.left + TITLEBAR_KEEP);
  expect(result.x).toBeLessThanOrEqual(bounds.right - TITLEBAR_KEEP);
  expect(result.y).toBeLessThanOrEqual(bounds.bottom - Math.min(TITLEBAR_KEEP, availHeight(bounds)));
}

describe('sanitize rejects unusable stored sizes', () => {
  // The exact shape a click-without-drag on a resize handle used to persist.
  it('falls back to the default size for 0/0', () => {
    const result = sanitize({ w: 0, h: 0 }, BOUNDS, DEFAULT_SIZE);
    expect(result.w).toBe(700);
    expect(result.h).toBe(300);
    expectUsable(result);
  });

  it.each([
    ['NaN', { w: NaN, h: NaN, x: NaN, y: NaN }],
    ['negative', { w: -100, h: -100, x: -100, y: -100 }],
    ['Infinity', { w: Infinity, h: Infinity }],
    ['-Infinity', { w: -Infinity, h: -Infinity }],
    ['strings', { w: '700', h: '300' }],
    ['null', { w: null, h: null }],
    ['missing', {}],
    ['undefined', undefined]
  ])('falls back to the default size for %s', (_label, stored) => {
    const result = sanitize(stored, BOUNDS, DEFAULT_SIZE);
    expect(result.w).toBe(700);
    expect(result.h).toBe(300);
    expectUsable(result);
  });

  it('uses the module minimums when there is no default size either', () => {
    const result = sanitize({ w: 0, h: 0 }, BOUNDS, {});
    expect(result.w).toBe(MIN_WIDTH);
    expect(result.h).toBe(MIN_HEIGHT);
  });

  it('never returns less than the minimum size', () => {
    const result = sanitize({ w: 10, h: 10 }, BOUNDS, DEFAULT_SIZE);
    expect(result.w).toBe(MIN_WIDTH);
    expect(result.h).toBe(MIN_HEIGHT);
  });
});

describe('sanitize clamps to the usable area', () => {
  it('shrinks a window larger than the bounds', () => {
    const result = sanitize({ w: 5000, h: 5000 }, BOUNDS, DEFAULT_SIZE);
    expect(result.w).toBe(availWidth(BOUNDS));
    expect(result.h).toBe(availHeight(BOUNDS));
    expectUsable(result);
  });

  // The old constrainPanelSize did max(minWidth, available - 20) and could return more than the
  // viewport held. The min() against the available space has to come last.
  it('lets the viewport win over the minimum size on a tiny screen', () => {
    const tiny = { top: 48, bottom: 200, left: 0, right: 200 };
    const result = sanitize({ w: 700, h: 300 }, tiny, DEFAULT_SIZE);
    expect(result.w).toBeLessThanOrEqual(availWidth(tiny));
    expect(result.h).toBeLessThanOrEqual(availHeight(tiny));
    expectUsable(result, tiny);
  });

  it('survives a degenerate zero-sized bounds', () => {
    const degenerate = { top: 48, bottom: 48, left: 0, right: 0 };
    const result = sanitize({ w: 700, h: 300 }, degenerate, DEFAULT_SIZE);
    expect(result.w).toBeGreaterThan(0);
    expect(result.h).toBeGreaterThan(0);
    expect(Number.isFinite(result.x)).toBe(true);
    expect(Number.isFinite(result.y)).toBe(true);
  });
});

describe('sanitize keeps the window reachable', () => {
  it('centres a window that has no stored position', () => {
    const result = sanitize({ w: 700, h: 300 }, BOUNDS, DEFAULT_SIZE);
    expect(result.x).toBe(Math.round(BOUNDS.left + (availWidth(BOUNDS) - 700) / 2));
    expect(result.y).toBe(Math.round(BOUNDS.top + (availHeight(BOUNDS) - 300) / 2));
  });

  it.each([
    ['far left', -9999],
    ['far right', 99999]
  ])('pulls a window back from %s', (_label, x) => {
    const result = sanitize({ w: 700, h: 300, x, y: 100 }, BOUNDS, DEFAULT_SIZE);
    expect(result.x).toBeGreaterThanOrEqual(BOUNDS.left);
    expect(result.x + result.w).toBeLessThanOrEqual(BOUNDS.right);
    expectUsable(result);
  });

  it('never places a window above the navbar', () => {
    const result = sanitize({ w: 700, h: 300, x: 100, y: -5000 }, BOUNDS, DEFAULT_SIZE);
    expect(result.y).toBe(BOUNDS.top);
  });

  it('never pushes the title bar below the footer', () => {
    const result = sanitize({ w: 700, h: 300, x: 100, y: 99999 }, BOUNDS, DEFAULT_SIZE);
    expect(result.y).toBeLessThanOrEqual(BOUNDS.bottom - TITLEBAR_KEEP);
    expectUsable(result);
  });

  it('keeps a grab handle on screen when the window is wider than the bounds', () => {
    const narrow = { top: 48, bottom: 600, left: 0, right: 300 };
    const result = sanitize({ w: 900, h: 300, x: -800, y: 100 }, narrow, DEFAULT_SIZE);
    expectUsable(result, narrow);
  });
});

describe('sanitize refits against the screen fingerprint', () => {
  it('shrinks proportionally when the usable area got smaller', () => {
    const stored = { w: 1000, h: 700, x: 40, y: 100, vw: 1090, vh: 822 };
    const smaller = { top: 48, bottom: 460, left: 0, right: 545 };
    const result = sanitize(stored, smaller, DEFAULT_SIZE);
    expect(result.refitted).toBe(true);
    expect(result.w).toBeLessThan(stored.w);
    expect(result.h).toBeLessThan(stored.h);
    expectUsable(result, smaller);
  });

  it('never grows a window just because the screen got bigger', () => {
    const stored = { w: 400, h: 250, x: 10, y: 60, vw: 545, vh: 412 };
    const bigger = { top: 48, bottom: 870, left: 0, right: 1090 };
    const result = sanitize(stored, bigger, DEFAULT_SIZE);
    expect(result.refitted).toBe(true);
    expect(result.w).toBe(400);
    expect(result.h).toBe(250);
  });

  it('does not refit when the fingerprint matches', () => {
    const stored = { w: 800, h: 400, x: 50, y: 80, ...fingerprint(BOUNDS) };
    const result = sanitize(stored, BOUNDS, DEFAULT_SIZE);
    expect(result.refitted).toBe(false);
    expect(result).toMatchObject({ w: 800, h: 400, x: 50, y: 80 });
  });

  it('skips the refit when the fingerprint is missing or unusable', () => {
    expect(sanitize({ w: 800, h: 400, vw: 0, vh: 0 }, BOUNDS, DEFAULT_SIZE).refitted).toBe(false);
    expect(sanitize({ w: 800, h: 400 }, BOUNDS, DEFAULT_SIZE).refitted).toBe(false);
  });
});

describe('sanitize is idempotent', () => {
  it.each([
    ['zeros', { w: 0, h: 0 }],
    ['oversized', { w: 5000, h: 5000, x: 9999, y: 9999 }],
    ['off screen', { w: 700, h: 300, x: -9999, y: -9999 }],
    ['refitted', { w: 1000, h: 700, x: 40, y: 100, vw: 1400, vh: 900 }],
    ['nothing', undefined]
  ])('for %s', (_label, stored) => {
    const once = sanitize(stored, BOUNDS, DEFAULT_SIZE);
    const twice = sanitize({ ...once, ...fingerprint(BOUNDS) }, BOUNDS, DEFAULT_SIZE);
    expect(twice.x).toBe(once.x);
    expect(twice.y).toBe(once.y);
    expect(twice.w).toBe(once.w);
    expect(twice.h).toBe(once.h);
  });
});

describe('fingerprint', () => {
  it('records the usable area, not the raw viewport', () => {
    expect(fingerprint(BOUNDS)).toEqual({ vw: 1090, vh: 822 });
  });
});

describe('clampSize', () => {
  it('honours the minimum and the bounds', () => {
    expect(clampSize(10, 10, BOUNDS)).toEqual({ w: MIN_WIDTH, h: MIN_HEIGHT });
    expect(clampSize(5000, 5000, BOUNDS)).toEqual({ w: 1090, h: 822 });
  });
});

describe('clampRect', () => {
  it('pulls a rectangle fully inside the bounds', () => {
    expect(clampRect({ x: 1200, y: 5000, width: 200, height: 100 }, BOUNDS)).toEqual({ x: 890, y: 770 });
  });

  it('pins to the top left when the rectangle does not fit', () => {
    expect(clampRect({ x: 500, y: 500, width: 5000, height: 5000 }, BOUNDS)).toEqual({ x: 0, y: 48 });
  });
});
