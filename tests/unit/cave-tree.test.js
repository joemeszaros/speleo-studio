import { vi, describe, it, expect } from 'vitest';

// model.js pulls in heavy deps via the barrel; the model classes themselves are pure.
vi.mock('../../src/i18n/i18n.js', () => ({ i18n: { t: (k) => k } }));

const { Cave, CaveAttributes } = await import('../../src/model/cave.js');
const { Survey, Shot, ShotType, SurveyAlias, SurveyStation, StationComment, StationDimension } = await import(
  '../../src/model/survey.js'
);
const { Vector } = await import('../../src/model.js');
const { Database } = await import('../../src/db.js');

// Minimal attribute defs for Cave.fromPure (no stored attributes in these fixtures).
const ATTR_DEFS = { schemaVersion: '1.0.0' };

function survey(name, surveyPath, shotRows = [['1', '2', 10, 0, 0]]) {
  const shots = shotRows.map(([f, t, l, a, c], i) => new Shot(i + 1, ShotType.CENTER, f, t, l, a, c));
  const s = new Survey(name, true, undefined, shotRows[0]?.[0], shots);
  s.surveyPath = surveyPath;
  return s;
}

// Builds: root "Sys" with a leaf survey "trunk", a child cave "A" (surveys p1, p2),
// and a grandchild cave "A/B" (survey deep).
function buildTree() {
  const root = new Cave('Sys');
  root.surveys.push(survey('trunk', 'sys.trunk'));

  const a = new Cave('A');
  a.surveys.push(survey('p1', 'sys.a.p1'), survey('p2', 'sys.a.p2'));
  a.aliases.push(new SurveyAlias('2@sys.a.p1', '1@sys.a.p2'));

  const b = new Cave('B');
  b.surveys.push(survey('deep', 'sys.a.b.deep'));

  a.children.push(b);
  root.children.push(a);
  root.aliases.push(new SurveyAlias('2@sys.trunk', '1@sys.a.p1'));
  return { root, a, b };
}

describe('Cave tree traversal helpers', () => {
  it('hasChildren reflects nesting', () => {
    const { root, a, b } = buildTree();
    expect(root.hasChildren()).toBe(true);
    expect(a.hasChildren()).toBe(true);
    expect(b.hasChildren()).toBe(false);
  });

  it('getAllSurveys returns the whole subtree, depth-first', () => {
    const { root, a } = buildTree();
    expect(root.getAllSurveys().map((s) => s.name)).toEqual(['trunk', 'p1', 'p2', 'deep']);
    expect(a.getAllSurveys().map((s) => s.name)).toEqual(['p1', 'p2', 'deep']);
  });

  it('getAllSurveys on a flat cave returns its own surveys array (identity)', () => {
    const flat = new Cave('Flat');
    flat.surveys.push(survey('only', undefined));
    expect(flat.getAllSurveys()).toBe(flat.surveys);
  });

  it('getAllSurveysWithPath builds a unique slash path per survey', () => {
    const { root } = buildTree();
    const paths = root.getAllSurveysWithPath().map((x) => x.path).sort();
    expect(paths).toEqual(['Sys/A/B/deep', 'Sys/A/p1', 'Sys/A/p2', 'Sys/trunk']);
  });

  it('getAllAliases aggregates equates from every cave node', () => {
    const { root } = buildTree();
    expect(root.getAllAliases()).toHaveLength(2); // root + cave A
  });

  it('walk visits every cave with its name path', () => {
    const { root } = buildTree();
    const seen = [];
    root.walk((cave, path) => seen.push(path.join('/')));
    expect(seen).toEqual(['Sys', 'Sys/A', 'Sys/A/B']);
  });

  it('findCaveByPath resolves nested caves and rejects bad paths', () => {
    const { root, a, b } = buildTree();
    expect(root.findCaveByPath('Sys')).toBe(root);
    expect(root.findCaveByPath('Sys/A')).toBe(a);
    expect(root.findCaveByPath('Sys/A/B')).toBe(b);
    expect(root.findCaveByPath('Sys/Nope')).toBeUndefined();
    expect(root.findCaveByPath('Wrong/A')).toBeUndefined();
  });

  it('findSurveyByPath resolves a leaf survey by its full path', () => {
    const { root } = buildTree();
    expect(root.findSurveyByPath('Sys/A/p2')?.name).toBe('p2');
    expect(root.findSurveyByPath('Sys/A/B/deep')?.name).toBe('deep');
    expect(root.findSurveyByPath('Sys/trunk')?.name).toBe('trunk');
    expect(root.findSurveyByPath('Sys/A/missing')).toBeUndefined();
  });

  it('getSurveyNamePath returns the full cave→…→survey chain (for breadcrumbs)', () => {
    const { root } = buildTree();
    const deep = root.findSurveyByPath('Sys/A/B/deep');
    expect(root.getSurveyNamePath(deep)).toEqual(['Sys', 'A', 'B', 'deep']);
    const p1 = root.findSurveyByPath('Sys/A/p1');
    expect(root.getSurveyNamePath(p1)).toEqual(['Sys', 'A', 'p1']);
    const trunk = root.findSurveyByPath('Sys/trunk');
    expect(root.getSurveyNamePath(trunk)).toEqual(['Sys', 'trunk']);
  });

  it('db.renameSurvey renames a survey inside a SUB-cave (not just the top-level cave)', () => {
    // Regression: renameSurvey looked the survey up via the top-level `caves` map by cave.name,
    // so passing a nested sub-cave (as the survey-sheet editor does) missed and threw.
    const { root, a } = buildTree(); // root "Sys"; sub-cave A owns surveys p1, p2
    const db = new Database();
    db.addCave(root);

    db.renameSurvey(a, 'p1', 'p1renamed'); // a is a SUB-cave, not in db.caves
    expect(a.surveys.find((s) => s.name === 'p1renamed')).toBeTruthy();
    expect(a.surveys.find((s) => s.name === 'p1')).toBeUndefined();

    // Duplicate name within the cave is still rejected.
    expect(() => db.renameSurvey(a, 'p2', 'p1renamed')).toThrow();
    // Unknown survey still rejected.
    expect(() => db.renameSurvey(a, 'nope', 'x')).toThrow();
  });

  it('getCaveChain returns the root→owner cave node chain (for per-cave coloring)', () => {
    const { root, a, b } = buildTree();
    const deep = root.findSurveyByPath('Sys/A/B/deep');
    expect(root.getCaveChain(deep)).toEqual([root, a, b]);
    const p1 = root.findSurveyByPath('Sys/A/p1');
    expect(root.getCaveChain(p1)).toEqual([root, a]);
    const trunk = root.findSurveyByPath('Sys/trunk');
    expect(root.getCaveChain(trunk)).toEqual([root]);
    // Per-cave color = nearest colored ancestor in the chain (sub-cave overrides the top cave).
    root.color = '#111111';
    b.color = '#222222';
    const nearest = (s) => [...root.getCaveChain(s)].reverse().find((c) => c.color !== undefined);
    expect(nearest(deep)).toBe(b); // sub-cave B color wins for the deep survey
    expect(nearest(p1)).toBe(root); // A has no color → inherits the top cave's
  });

  it('getAllStations merges each cave node station map', () => {
    const { root, a, b } = buildTree();
    root.stations.set('2@sys.trunk', new SurveyStation(ShotType.CENTER, new Vector(0, 0, 0)));
    a.stations.set('1@sys.a.p1', new SurveyStation(ShotType.CENTER, new Vector(1, 0, 0)));
    b.stations.set('1@sys.a.b.deep', new SurveyStation(ShotType.CENTER, new Vector(2, 0, 0)));
    const merged = root.getAllStations();
    expect(merged.size).toBe(3);
    expect(merged.has('2@sys.trunk')).toBe(true);
    expect(merged.has('1@sys.a.b.deep')).toBe(true);
    // a sub-cave only sees its own subtree
    expect(a.getAllStations().size).toBe(2);
  });
});

describe('Cave serialization round-trip', () => {
  it('toExport/fromPure preserves the nested children structure', () => {
    const { root } = buildTree();
    const pure = JSON.parse(JSON.stringify(root.toExport()));
    const restored = Cave.fromPure(pure, ATTR_DEFS);

    expect(restored.name).toBe('Sys');
    expect(restored.children.map((c) => c.name)).toEqual(['A']);
    expect(restored.children[0].children.map((c) => c.name)).toEqual(['B']);
    expect(restored.getAllSurveys().map((s) => s.name)).toEqual(['trunk', 'p1', 'p2', 'deep']);
    // surveyPath round-trips so positions recompute correctly on reload
    expect(restored.findSurveyByPath('Sys/A/p1').surveyPath).toBe('sys.a.p1');
    // aliases preserved per node
    expect(restored.getAllAliases()).toHaveLength(2);
  });

  it('a flat cave exports with no children key and restores as a leaf', () => {
    const flat = new Cave('Flat');
    flat.surveys.push(survey('only', undefined));
    const exported = flat.toExport();
    expect(exported.children).toBeUndefined();
    const restored = Cave.fromPure(JSON.parse(JSON.stringify(exported)), ATTR_DEFS);
    expect(restored.hasChildren()).toBe(false);
    expect(restored.getAllSurveys()).toHaveLength(1);
  });

  it('round-trips optional source provenance', () => {
    const { root } = buildTree();
    root.source = { format: 'therion', file: 'sys.th', title: 'Sys' };
    const restored = Cave.fromPure(JSON.parse(JSON.stringify(root.toExport())), ATTR_DEFS);
    expect(restored.source).toEqual({ format: 'therion', file: 'sys.th', title: 'Sys' });
  });

  it('persists cave colors (top + sub-cave) and survey colors across toExport/fromPure', () => {
    const { root, a, b } = buildTree();
    root.color = '#112233';
    b.color = '#445566'; // a nested sub-cave color (the reported bug: lost on reload)
    root.findSurveyByPath('Sys/A/p1').color = '#778899';
    const restored = Cave.fromPure(JSON.parse(JSON.stringify(root.toExport())), ATTR_DEFS);
    expect(restored.color).toBe('#112233');
    expect(restored.findCaveByPath('Sys/A/B').color).toBe('#445566');
    expect(restored.findSurveyByPath('Sys/A/p1').color).toBe('#778899');
    // Uncolored nodes stay undefined (color is omitted from the export when unset).
    expect(restored.findCaveByPath('Sys/A').color).toBeUndefined();
    expect(restored.findSurveyByPath('Sys/A/p2').color).toBeUndefined();
  });
});

describe('Cave.getStats on a nested cave', () => {
  it('counts descendant caves as subCaves (self excluded)', () => {
    const { root, a, b } = buildTree();
    // Sys → A → B : two descendants of the root.
    expect(root.getStats().subCaves).toBe(2);
    expect(a.getStats().subCaves).toBe(1); // only B
    expect(b.getStats().subCaves).toBe(0); // leaf cave
  });

  it('a flat cave reports zero subCaves', () => {
    const flat = new Cave('Flat');
    flat.surveys.push(survey('only', undefined));
    expect(flat.getStats().subCaves).toBe(0);
  });

  it('computes non-zero depth/height by qualifying the first station name', () => {
    const { root } = buildTree();
    // First survey (depth-first) is the root's "trunk"; its start is "1". The station map keys
    // are survey-qualified, so getFirstStation must qualify "1" → "1@sys.trunk" to find z.
    // Regression: an unqualified lookup missed and collapsed depth/height to 0 (the Migovec bug).
    root.stations.set('1@sys.trunk', new SurveyStation(ShotType.CENTER, new Vector(0, 0, 0)));
    root.stations.set('2@sys.trunk', new SurveyStation(ShotType.CENTER, new Vector(0, 0, 5)));
    root.stations.set('x@sys.trunk', new SurveyStation(ShotType.CENTER, new Vector(0, 0, -10)));
    const stats = root.getStats();
    expect(stats.depth).toBe(10); // firstZ(0) - minZ(-10)
    expect(stats.height).toBe(5); // maxZ(5) - firstZ(0)
  });
});

describe('Survey.qualify (internal station-name qualification)', () => {
  it('qualifies bare names with surveyPath, passes through already-qualified and bare-when-no-path', () => {
    const s = new Survey('x');
    s.surveyPath = 'a.b';
    expect(s.qualify('5')).toBe('5@a.b');
    expect(s.qualify('5@other')).toBe('5@other'); // already qualified (alias partner / splay)
    const flat = new Survey('y'); // no surveyPath
    expect(flat.qualify('5')).toBe('5'); // single-survey/legacy cave keeps bare keys
  });

  it('splay/auxiliary station names key off the survey id (unique), not the name', () => {
    const s = new Survey('dup');
    expect(s.getSplayStationName(7)).toBe(`splay-7@${s.id}`);
    expect(s.getAuxiliaryStationName(3)).toBe(`auxiliary-3@${s.id}`);
  });
});
