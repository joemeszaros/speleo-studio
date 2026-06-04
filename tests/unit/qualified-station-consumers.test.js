import { vi, describe, it, expect, beforeAll } from 'vitest';

// These tests guard the consumers of the station map for MULTI-SURVEY caves, where map keys
// are survey-qualified (`station@surveyPath`). Bare-name lookups in these consumers silently
// dropped data (section graph / shortest-path) or crashed (DXF export) — see codex review.

vi.mock('../../src/i18n/i18n.js', () => ({ i18n: { t: (k) => k } }));
vi.mock('../../src/ui/popups.js', () => ({ showErrorPanel: vi.fn(), showWarningPanel: vi.fn(), showInfoPanel: vi.fn() }));
// export.js imports window.js, which instantiates a WindowManager that touches `document`
// at module load. Stub it so the pure Exporter methods can be tested headlessly.
vi.mock('../../src/ui/window.js', () => ({ wm: { makeFloatingPanel: vi.fn() }, WindowManager: class {} }));
vi.mock('../../src/ui/coordinate-system-dialog.js', () => ({
  CoordinateSystemDialog: class { async show() { return { coordinateSystem: undefined, coordinates: [] }; } }
}));
vi.mock('../../src/utils/global-coordinate-normalizer.js', () => ({
  globalNormalizer: { isInitialized: () => false, initializeGlobalOrigin: vi.fn(), getNormalizedVector: (c) => c }
}));
vi.mock('../../src/model/geo.js', async () => {
  const actual = await vi.importActual('../../src/model/geo.js');
  class U extends actual.UTMCoordinateWithElevation {
    toNormalizedVector() { const { Vector } = require('../../src/model.js'); return new Vector(this.easting, this.northing, this.elevation); }
  }
  return { ...actual, UTMCoordinateWithElevation: U };
});

const { TherionImporter } = await import('../../src/io/therion-importer.js');
const { SectionHelper } = await import('../../src/section.js');
const { SurveyHelper } = await import('../../src/survey.js');
const { Exporter } = await import('../../src/io/export.js');

// A connected cave with three equate-linked sub-surveys, each numbered from 1 (so station
// names are reused → qualified keys). 1@beta == 3@alpha, 1@gamma == 3@beta.
const TH = `
survey sys -title "Sys"
  survey alpha
    centreline
      data normal from to length compass clino
      1 2 5 0 0
      2 3 5 0 0
    endcentreline
  endsurvey alpha
  survey beta
    centreline
      data normal from to length compass clino
      1 2 5 90 0
      2 3 5 90 0
    endcentreline
  endsurvey beta
  survey gamma
    centreline
      data normal from to length compass clino
      1 2 5 180 0
    endcentreline
  endsurvey gamma
  equate 3@alpha 1@beta
  equate 3@beta 1@gamma
endsurvey sys
`;

let cave;
beforeAll(async () => {
  cave = await new TherionImporter(null, null, null, null).getCave(new Map([['sys.th', TH]]));
});

describe('SectionHelper.getGraph on a multi-survey cave', () => {
  it('builds edges using qualified keys (graph is connected, not near-empty)', () => {
    const g = SectionHelper.getGraph(cave);
    const stations = cave.getAllStations();
    // Every placed center station is a vertex.
    expect(g.adjacencyList.size).toBe(stations.size);
    // Edges actually exist: total center shots ≈ 5; every shot endpoint resolved.
    let edgeCount = 0;
    for (const nbrs of g.adjacencyList.values()) edgeCount += nbrs.length;
    expect(edgeCount).toBeGreaterThan(0);
    // A shortest path across the equate chain (alpha → gamma) must exist and be finite.
    const startKey = [...stations.keys()].find((k) => k.startsWith('1@') && k.includes('alpha'));
    const endKey = [...stations.keys()].find((k) => k.includes('gamma'));
    const traverse = g.traverse(startKey);
    expect(traverse.distances.get(endKey)).toBeLessThan(Infinity);
  });
});

describe('Exporter.exportDXF on a multi-survey cave', () => {
  it('does not crash and emits LINE entities for the qualified-key stations', () => {
    const written = [];
    const origBlob = global.Blob, origURL = global.URL, origDoc = global.document;
    global.Blob = class { constructor(parts) { written.push(parts.join ? parts.join('') : String(parts)); } };
    global.URL = { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} };
    global.document = { createElement: () => ({ click() {}, set href(_) {}, set download(_) {} }) };
    try {
      expect(() => Exporter.exportDXF(new Map([[cave.name, cave]]), 'out')).not.toThrow();
    } finally {
      global.Blob = origBlob; global.URL = origURL; global.document = origDoc;
    }
    const dxf = written.join('');
    // 5 center legs → 5 LINE entities; crashing on undefined .position would have thrown.
    const lineCount = (dxf.match(/\nLINE\n/g) || dxf.match(/LINE/g) || []).length;
    expect(lineCount).toBeGreaterThanOrEqual(5);
  });

  it('emits each station label ONCE, not once per survey (no O(surveys×stations) blowup)', () => {
    // Regression: the station-label loop was nested inside the per-survey loop, re-emitting the
    // whole network station map once per survey. On large systems this overflowed the lines array
    // (RangeError: Invalid array length). With 3 surveys the duplication would 3× the TEXT count.
    const written = [];
    const origBlob = global.Blob, origURL = global.URL, origDoc = global.document;
    global.Blob = class { constructor(parts) { written.push(parts.join ? parts.join('') : String(parts)); } };
    global.URL = { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} };
    global.document = { createElement: () => ({ click() {}, set href(_) {}, set download(_) {} }) };
    try {
      Exporter.exportDXF(new Map([[cave.name, cave]]), 'out');
    } finally {
      global.Blob = origBlob; global.URL = origURL; global.document = origDoc;
    }
    const dxf = written.join('');
    const stationCount = cave.getAllStations().size;
    const textCount = (dxf.match(/\nTEXT\n/g) || []).length;
    // One TEXT label per station — not stationCount × surveyCount.
    expect(textCount).toBe(stationCount);
  });
});

describe('SVG export escapes XML-special characters in names', () => {
  it('escapeXml encodes < > & " \' so cave names with Therion markup stay valid XML', () => {
    // Real migovec cave names contain raw markup like `<lang:en>…` and `…<br>Cad. number`.
    // Injected unescaped into SVG id/data-name/text these broke the XML (Firefox parse error).
    const raw = '<lang:en>Coincidence Cave<lang:sl> & "x" \'y\'';
    const escaped = Exporter.escapeXml(raw);
    // No bare XML-special characters remain (these are what broke the SVG).
    expect(escaped).not.toMatch(/[<>]/);
    expect(escaped).not.toMatch(/&(?!(amp|lt|gt|quot|apos);)/);
    expect(escaped).toContain('&lt;lang:en&gt;');
    expect(escaped).toContain('&amp;');
    // Round-trips back to the original text (no data loss).
    const decoded = escaped
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'").replace(/&amp;/g, '&');
    expect(decoded).toBe(raw);
  });
});

describe('Station hover / details lookup on a multi-survey cave', () => {
  it('exposes the BARE station name and finds the touching shots in the owning survey', async () => {
    const { bareStationName } = await import('../../src/utils/utils.js');
    // Reproduce what raycasting+detail-panel do: take a station map entry (qualified key for
    // a multi-survey cave), expose the bare name, and find shots scoped to its OWN survey.
    const entry = [...cave.getAllStations().entries()].find(([k]) => k.includes('@') && k.startsWith('2@'));
    expect(entry).toBeTruthy(); // keys really are qualified here
    const [key, station] = entry;

    const displayName = bareStationName(key);
    expect(displayName).toBe('2'); // bare, not "2@sys.alpha"
    expect(displayName.includes('@')).toBe(false);

    // Shots touching this station, scoped to the station's own survey (bare comparison).
    const survey = station.survey;
    const shots = survey.shots.filter(
      (sh) => (sh.isCenter() && sh.from === displayName) || survey.getToStationName(sh) === displayName
    );
    expect(shots.length).toBeGreaterThan(0); // the regression: qualified name matched 0 shots
  });
});

describe('Shortest path across a redundant equate (independently-anchored sub-caves)', () => {
  // Regression: a connected system often fixes one entrance PER sub-cave, so each sub-cave is
  // positioned from its OWN fix and the cross-sub-cave equate drives no shot placement. getGraph
  // built edges only from shots, so that equate produced no graph edge → the sub-caves landed in
  // separate components and shortest-path between them wrongly reported "no path / 0 m", even
  // though the cave is topologically connected. (Real case: Migovec vrtnarija ↔ primadona.)
  const TH = `
survey region -title "Region"
  cs UTM33N
  survey caveX
    centreline
      fix 1 400000 5000000 1000
      data normal from to length compass clino
      1 2 10.0 0.0 0.0
      2 3 10.0 0.0 0.0
    endcentreline
  endsurvey caveX
  survey caveY
    centreline
      fix 1 400500 5000000 1000
      data normal from to length compass clino
      1 2 10.0 90.0 0.0
      2 3 10.0 90.0 0.0
    endcentreline
  endsurvey caveY
  equate 3@caveX 3@caveY
endsurvey region
`;

  it('finds a path between the two equate-linked sub-caves', async () => {
    const region = await new TherionImporter(null, null, null, null).getCave(new Map([['region.th', TH]]));
    // One connected cave (both fixes captured, nothing isolated).
    expect(region.getAllSurveys().filter((s) => s.isolated)).toHaveLength(0);

    const keys = [...region.getAllStations().keys()];
    const startX = keys.find((k) => k.startsWith('1@') && k.includes('caveX'));
    const endY = keys.find((k) => k.startsWith('1@') && k.includes('caveY'));
    expect(startX && endY).toBeTruthy();

    const g = SectionHelper.getGraph(region);
    // The equate (3@caveX ≡ 3@caveY) must be a graph edge, so caveY is reachable from caveX.
    const traverse = g.traverse(startX);
    const d = traverse.distances.get(endY);
    expect(d).not.toBe('Infinity');
    expect(d).toBeLessThan(Infinity);

    // getSection returns a real section (not a fabricated 0 m one).
    const section = SectionHelper.getSection(g, startX, endY);
    expect(section).toBeTruthy();
    expect(section.distance).toBeGreaterThan(0);
  });

  it('getSection returns undefined (not a 0 m section) when there is genuinely no path', async () => {
    const { Graph } = await import('../../src/utils/graph.js');
    const g = new Graph();
    g.addVertex('a');
    g.addVertex('b'); // two vertices, no edge between them
    expect(SectionHelper.getSection(g, 'a', 'b')).toBeUndefined();
  });

  it('color-by-distance colors every placed segment across the redundant equate', async () => {
    // Same fragmentation cause as shortest-path: getColorGradientsByDistance builds its own
    // distance graph, so a sub-cave anchored by its own fix was unreachable from the start, got
    // no distance, and its segments got no color — leaving the color buffer SHORTER than the
    // position buffer ("vertex buffer is not big enough") so half the cave vanished on screen.
    const region = await new TherionImporter(null, null, null, null).getCave(new Map([['region.th', TH]]));
    const opts = {
      color : { mode: 'gradientByDistance', gradientColors: [{ depth: 0, color: { r: 0, g: 0, b: 1 } }, { depth: 100, color: { r: 1, g: 0, b: 0 } }] }
    };
    const colors = SurveyHelper.getColorGradientsByDistance(region, opts);
    const stations = region.getAllStations();
    region.getAllSurveys().forEach((s) => {
      const [centerSegments] = SurveyHelper.getSegments(s, stations);
      const c = colors.get(s.id);
      // Both sub-caves (incl. the one reached only across the equate) are placed AND colored.
      expect(centerSegments.length).toBeGreaterThan(0);
      // The color buffer must be exactly as long as the position buffer (else WebGL underruns).
      expect(c.center.length).toBe(centerSegments.length);
    });
  });
});
