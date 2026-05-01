// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Provide an in-memory localStorage shim for jsdom environments that ship without one.
if (typeof globalThis.localStorage === 'undefined' || typeof globalThis.localStorage.clear !== 'function') {
  const _store = new Map();
  globalThis.localStorage = {
    getItem    : (k) => (_store.has(k) ? _store.get(k) : null),
    setItem    : (k, v) => _store.set(k, String(v)),
    removeItem : (k) => _store.delete(k),
    clear      : () => _store.clear()
  };
}

// The popups module imports DOM and i18n modules; stub it for tests.
vi.mock('../../src/ui/popups.js', () => ({
  showErrorPanel   : () => {},
  showSuccessPanel : () => {},
  showInfoPanel    : () => {}
}));

vi.mock('../../src/i18n/i18n.js', () => ({
  i18n : { t: (key) => key }
}));

const { DEFAULT_OPTIONS, ObjectObserver, ConfigManager, ConfigChanges } = await import('../../src/config.js');

beforeEach(() => {
  // Each test starts with a clean localStorage.
  localStorage.clear();
});

// ── DEFAULT_OPTIONS shape ─────────────────────────────────────────────────────

describe('DEFAULT_OPTIONS', () => {
  it('has a top-level format section', () => {
    expect(DEFAULT_OPTIONS.format).toBeDefined();
    expect(typeof DEFAULT_OPTIONS.format).toBe('object');
  });

  it('has format.units with length and angle', () => {
    expect(DEFAULT_OPTIONS.format.units).toBeDefined();
    expect(DEFAULT_OPTIONS.format.units.length).toBe('meters');
    expect(DEFAULT_OPTIONS.format.units.angle).toBe('degrees');
  });

  it('has format.decimalSeparator defaulting to dot', () => {
    expect(DEFAULT_OPTIONS.format.decimalSeparator).toBe('.');
  });

  it('does NOT expose units at the top level (moved into format)', () => {
    expect(DEFAULT_OPTIONS.units).toBeUndefined();
  });
});

// ── fillWithNewDefaults migration ─────────────────────────────────────────────

describe('ConfigManager.fillWithNewDefaults', () => {
  function baseConfig() {
    // A minimal config that has all the other required sections so we can focus
    // on the format-related migration logic.
    return JSON.parse(JSON.stringify({
      ...DEFAULT_OPTIONS,
      format : undefined
    }));
  }

  it('adds the entire format section when missing', () => {
    const cfg = baseConfig();
    delete cfg.format;
    ConfigManager.fillWithNewDefaults(cfg);
    expect(cfg.format).toBeDefined();
    expect(cfg.format.units.length).toBe('meters');
    expect(cfg.format.units.angle).toBe('degrees');
    expect(cfg.format.decimalSeparator).toBe('.');
  });

  it('migrates an old top-level config.units into config.format.units', () => {
    const cfg = baseConfig();
    delete cfg.format;
    cfg.units = { length: 'feet', angle: 'grads' };
    ConfigManager.fillWithNewDefaults(cfg);
    expect(cfg.format.units.length).toBe('feet');
    expect(cfg.format.units.angle).toBe('grads');
    expect(cfg.format.decimalSeparator).toBe('.');
    expect(cfg.units).toBeUndefined(); // old top-level key cleaned up
  });

  it('adds missing length/angle inside an existing format.units', () => {
    const cfg = baseConfig();
    cfg.format = { units: { length: 'feet' }, decimalSeparator: '.' };
    ConfigManager.fillWithNewDefaults(cfg);
    expect(cfg.format.units.length).toBe('feet');
    expect(cfg.format.units.angle).toBe('degrees'); // backfilled
  });

  it('adds missing decimalSeparator inside an existing format', () => {
    const cfg = baseConfig();
    cfg.format = { units: { length: 'meters', angle: 'degrees' } };
    ConfigManager.fillWithNewDefaults(cfg);
    expect(cfg.format.decimalSeparator).toBe('.');
  });

  it('leaves an existing decimalSeparator alone', () => {
    const cfg = baseConfig();
    cfg.format = { units: { length: 'meters', angle: 'degrees' }, decimalSeparator: ',' };
    ConfigManager.fillWithNewDefaults(cfg);
    expect(cfg.format.decimalSeparator).toBe(',');
  });

  it('reconstructs format.units when the section exists but units is missing', () => {
    const cfg = baseConfig();
    cfg.format = { decimalSeparator: ',' };
    ConfigManager.fillWithNewDefaults(cfg);
    expect(cfg.format.units.length).toBe('meters');
    expect(cfg.format.units.angle).toBe('degrees');
    expect(cfg.format.decimalSeparator).toBe(',');
  });
});

// ── Event dispatch via the proxy ──────────────────────────────────────────────

describe('ConfigChanges event dispatch', () => {
  // ConfigChanges.onChange ends with ConfigManager.save which writes to localStorage —
  // benign in jsdom but let's silence the console.warn on failures.

  function makeWatched() {
    const cfg = JSON.parse(JSON.stringify(DEFAULT_OPTIONS));
    const observer = new ObjectObserver();
    const watched = observer.watchObject(cfg);
    // Stub scene + materials — these handlers are not exercised by format.* changes.
    const sceneStub = {
      view  : { renderView: () => {} },
      speleo: { setObjectsVisibility: () => {}, setObjectsOpacity: () => {} }
    };
    const materialsStub = { materials: {} };
    const changes = new ConfigChanges(watched, sceneStub, materialsStub);
    observer.watchChanges(changes.getOnChangeHandler());
    return { watched };
  }

  it('firing format.decimalSeparator dispatches decimalSeparatorChanged', () => {
    const { watched } = makeWatched();
    let sepFired = 0, unitsFired = 0;
    document.addEventListener('decimalSeparatorChanged', () => sepFired++);
    document.addEventListener('unitsChanged', () => unitsFired++);
    watched.format.decimalSeparator = ',';
    expect(sepFired).toBe(1);
    expect(unitsFired).toBe(0);
  });

  it('firing format.units.length dispatches unitsChanged but NOT decimalSeparatorChanged', () => {
    const { watched } = makeWatched();
    let sepFired = 0, unitsFired = 0;
    document.addEventListener('decimalSeparatorChanged', () => sepFired++);
    document.addEventListener('unitsChanged', () => unitsFired++);
    watched.format.units.length = 'feet';
    expect(unitsFired).toBe(1);
    expect(sepFired).toBe(0);
  });

  it('firing format.units.angle dispatches unitsChanged', () => {
    const { watched } = makeWatched();
    let unitsFired = 0;
    document.addEventListener('unitsChanged', () => unitsFired++);
    watched.format.units.angle = 'grads';
    expect(unitsFired).toBe(1);
  });

  it('setting decimalSeparator to the same value does not fire the event', () => {
    const { watched } = makeWatched();
    let sepFired = 0;
    document.addEventListener('decimalSeparatorChanged', () => sepFired++);
    watched.format.decimalSeparator = '.'; // already '.'
    expect(sepFired).toBe(0);
  });
});
