import { vi, describe, it, expect, beforeEach } from 'vitest';

// model.js pulls heavy deps via the barrel; the model classes themselves are pure.
vi.mock('../../src/i18n/i18n.js', () => ({ i18n: { t: (k) => k } }));

const { ColorModeHelper } = await import('../../src/scene/colormode.js');
const { Cave } = await import('../../src/model/cave.js');
const { Survey } = await import('../../src/model/survey.js');

// Sentinel default materials (what lines fall back to when no cave/survey color applies — the
// regression: per-cave mode used these for everything because sub-cave colors were ignored).
const DEFAULT = { centerLine: 'DEFAULT_CENTER', splay: 'DEFAULT_SPLAY', auxiliary: 'DEFAULT_AUX', fallback: 'FALLBACK' };

// A scene "entry" for one survey: line objects with a no-op geometry and an assignable material.
const makeEntry = () => ({
  centerLines : { geometry: { setColors: vi.fn() }, material: null },
  splays      : { geometry: { setColors: vi.fn() }, material: null },
  auxiliaries : { geometry: { setColors: vi.fn() }, material: null }
});

// Materials helper mock: getOrAddCave / getOrAddSurvey return tagged objects so we can assert
// which color source was used for each survey's lines.
const makeMaterials = () => ({
  materials : {
    segments  : { centerLine: DEFAULT.centerLine, splay: DEFAULT.splay, auxiliary: DEFAULT.auxiliary, fallback: DEFAULT.fallback },
    whiteLine : new Map([['center', 'WL'], ['splay', 'WL'], ['auxiliary', 'WL']])
  },
  getOrAddCave   : (name, color, type) => ({ kind: 'cave', name, color, type }),
  getOrAddSurvey : (cName, sName, color, type) => ({ kind: 'survey', cName, sName, color, type }),
  getCave        : () => undefined,
  getSurvey      : () => undefined,
  clearCave      : vi.fn(),
  clearSurvey    : vi.fn()
});

const options = {
  scene : {
    centerLines  : { segments: { width: 1, opacity: 1 } },
    splays       : { segments: { width: 1, opacity: 1 } },
    auxiliaries  : { segments: { width: 1, opacity: 1 } }
  }
};

// Top cave "Top" with a directly-owned survey (trunk) and two sub-caves (SubColored, SubPlain),
// each owning one survey. Mirrors a multi-level system like Migovec.
let top, subColored, subPlain, trunk, s1, s2, caveObjects, materials, db;
beforeEach(() => {
  top = new Cave('Top');
  trunk = new Survey('trunk');
  top.surveys.push(trunk);

  subColored = new Cave('SubColored');
  s1 = new Survey('s1');
  subColored.surveys.push(s1);
  subColored.color = '#abcdef'; // the user-set sub-cave color

  subPlain = new Cave('SubPlain');
  s2 = new Survey('s2');
  subPlain.surveys.push(s2);

  top.children.push(subColored, subPlain);

  caveObjects = new Map([['Top', new Map([[trunk.id, makeEntry()], [s1.id, makeEntry()], [s2.id, makeEntry()]])]]);
  materials = makeMaterials();
  db = {
    getCave        : () => top,
    getSurveyById  : (_cName, id) => top.getAllSurveys().find((s) => s.id === id)
  };
});

const entryOf = (survey) => caveObjects.get('Top').get(survey.id);

describe('ColorModeHelper percave on a multi-level cave', () => {
  it('colors a survey by its OWNING sub-cave color (the bug: sub-cave colors were ignored)', () => {
    new ColorModeHelper(db, options, caveObjects, materials).setColorMode('percave');

    const m = entryOf(s1).centerLines.material;
    expect(m.kind).toBe('cave');
    expect(m.name).toBe('SubColored');
    expect(m.color).toBe('#abcdef'); // <-- previously fell through to DEFAULT.centerLine (red)
    // splays/auxiliaries use the same sub-cave color.
    expect(entryOf(s1).splays.material.color).toBe('#abcdef');
    expect(entryOf(s1).auxiliaries.material.color).toBe('#abcdef');
  });

  it('uses the default material when neither the survey, its sub-cave, nor any ancestor has a color', () => {
    new ColorModeHelper(db, options, caveObjects, materials).setColorMode('percave');
    // SubPlain and Top both have no color → default (not a crash, not the sub-cave color).
    expect(entryOf(s2).centerLines.material).toBe(DEFAULT.centerLine);
    expect(entryOf(trunk).centerLines.material).toBe(DEFAULT.centerLine);
  });

  it('an uncolored sub-cave inherits the nearest colored ancestor (top cave) color', () => {
    top.color = '#101010';
    new ColorModeHelper(db, options, caveObjects, materials).setColorMode('percave');
    // s2's SubPlain has no color → inherits Top's.
    const m = entryOf(s2).centerLines.material;
    expect(m.kind).toBe('cave');
    expect(m.name).toBe('Top');
    expect(m.color).toBe('#101010');
    // s1's SubColored color still overrides the top.
    expect(entryOf(s1).centerLines.material.color).toBe('#abcdef');
  });

  it('an explicit survey color overrides the per-cave color', () => {
    s1.color = '#00ff00';
    new ColorModeHelper(db, options, caveObjects, materials).setColorMode('percave');
    const m = entryOf(s1).centerLines.material;
    expect(m.kind).toBe('survey');
    expect(m.color).toBe('#00ff00');
  });
});
