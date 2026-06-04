import { vi, describe, it, expect } from 'vitest';

vi.mock('../../src/i18n/i18n.js', () => ({ i18n: { t: (key) => key } }));

const { SurveyHelper } = await import('../../src/survey.js');
const { Survey, Shot, ShotType, SurveyAlias } = await import('../../src/model/survey.js');
const { Cave } = await import('../../src/model/cave.js');
const { Color } = await import('../../src/model.js');

// Builds a survey of straight center shots from a list of [from, to, length, azimuth, clino].
function makeSurvey(name, surveyPath, rows, start) {
  const shots = rows.map(([from, to, len, az, cl], i) => new Shot(i + 1, ShotType.CENTER, from, to, len, az, cl));
  const s = new Survey(name, true, undefined, start, shots);
  s.surveyPath = surveyPath;
  return s;
}

describe('SurveyHelper.calculateCaveStations (fixpoint connection)', () => {
  it('connects equate-linked surveys regardless of their order', () => {
    // Three surveys, each numbered from 1, joined in a chain by equates:
    //   A.2 == B.1 , B.2 == C.1
    // Station numbers are reused across surveys, so they must stay distinct (qualified)
    // and only connect through the equates.
    const A = makeSurvey('A', 'A', [['1', '2', 10, 0, 0]], '1');
    const B = makeSurvey('B', 'B', [['1', '2', 10, 90, 0]]);
    const C = makeSurvey('C', 'C', [['1', '2', 10, 180, 0]]);

    const aliases = [
      new SurveyAlias('2@A', '1@B'),
      new SurveyAlias('2@B', '1@C')
    ];

    // Deliberately worst-case order: C before B before A, so a single ordered pass could
    // not place C (its partner B isn't placed yet) — the fixpoint must.
    const stations = SurveyHelper.calculateCaveStations([C, B, A], aliases, null);

    // Exactly 4 distinct physical stations: A1, A2≡B1, B2≡C1, C2. Each equated junction is stored
    // under ONE representative key (which side that is depends on the deterministic origin), so we
    // assert the count rather than specific key names — the key invariant is "no wrong collapse
    // and no duplicate junction".
    expect(stations.size).toBe(4);
    expect(A.isolated).toBe(false);
    expect(B.isolated).toBe(false);
    expect(C.isolated).toBe(false);
    expect([A, B, C].reduce((n, s) => n + s.orphanShotIds.size, 0)).toBe(0);

    // The origin survey is chosen deterministically (smallest surveyPath = 'A'), so '1@A' is the
    // anchored seed; the other surveys' reused "1" stations merge into their equated junctions
    // rather than collapsing onto A's "1".
    expect(stations.has('1@A')).toBe(true);
    // Every shot endpoint resolves to a placed station (the network is fully connected).
    const placedKeys = new Set(stations.keys());
    [A, B, C].forEach((s) => {
      s.validShots.forEach((sh) => {
        const fromKey = s.getFromStationName(sh).includes('@') ? s.getFromStationName(sh) : s.qualify(s.getFromStationName(sh));
        const toKey = s.getToStationName(sh).includes('@') ? s.getToStationName(sh) : s.qualify(s.getToStationName(sh));
        expect(placedKeys.has(fromKey)).toBe(true);
        expect(placedKeys.has(toKey)).toBe(true);
      });
    });
  });

  it('places a single survey starting at the origin (no fix, no aliases)', () => {
    const A = makeSurvey('A', 'A', [['1', '2', 10, 0, 0], ['2', '3', 5, 90, 0]], '1');
    const stations = SurveyHelper.calculateCaveStations([A], [], null);
    expect(stations.size).toBe(3);
    expect(A.isolated).toBe(false);
  });

  it('leaves a genuinely disconnected survey isolated without affecting the rest', () => {
    const A = makeSurvey('A', 'A', [['1', '2', 10, 0, 0]], '1');
    const lonely = makeSurvey('X', 'X', [['1', '2', 10, 0, 0]]); // no equate into it
    const stations = SurveyHelper.calculateCaveStations([A, lonely], [], null);
    expect(A.isolated).toBe(false);
    expect(lonely.isolated).toBe(true);
    expect(stations.has('1@A')).toBe(true);
  });

  it('connects a survey equated to a junction that is itself an alias (multi-hop chain)', () => {
    // A is seeded. B attaches via B.1 == A.2 (so the physical junction is stored under A.2's
    // key; B.1 is NOT a separate key). C then equates C.1 == B.1 — referencing a name that
    // only exists as an alias. The solver must follow the equate group transitively to find
    // the placed station, or C would be wrongly left isolated.
    const A = makeSurvey('A', 'A', [['1', '2', 10, 0, 0]], '1');
    const B = makeSurvey('B', 'B', [['1', '2', 10, 90, 0]]);
    const C = makeSurvey('C', 'C', [['1', '2', 10, 180, 0]]);
    const aliases = [new SurveyAlias('1@B', '2@A'), new SurveyAlias('1@C', '1@B')];
    const stations = SurveyHelper.calculateCaveStations([A, B, C], aliases, null);
    expect(A.isolated).toBe(false);
    expect(B.isolated).toBe(false);
    expect(C.isolated).toBe(false);
    expect([A, B, C].reduce((n, s) => n + s.orphanShotIds.size, 0)).toBe(0);
    // No double-counting: the map holds one object per physical station (A1, A2≡B1≡C1, B2, C2).
    const unique = new Set([...stations.values()]);
    expect(unique.size).toBe(stations.size);
  });

  it('connects a long equate chain whose seed is at the far end, in shuffled order', () => {
    // s0..s5 each A→B; equate s(i).2 == s(i+1).1. Only s0 is seeded (at origin). Processing
    // them in reverse order must still place all via the fixpoint + transitive aliases.
    const surveys = [];
    for (let i = 0; i < 6; i++) surveys.push(makeSurvey('s' + i, 's' + i, [['1', '2', 10, 90, 0]], i === 0 ? '1' : undefined));
    const aliases = [];
    for (let i = 0; i < 5; i++) aliases.push(new SurveyAlias('2@s' + i, '1@s' + (i + 1)));
    const stations = SurveyHelper.calculateCaveStations([...surveys].reverse(), aliases, null);
    expect(surveys.every((s) => !s.isolated)).toBe(true);
    expect(stations.size).toBe(7); // 6 surveys × (start + 1) − 5 shared junctions = 7
  });
});

describe('SurveyHelper.recalculateCave (solve + distribute into nested cave nodes)', () => {
  it('distributes each survey\'s stations into its OWNING cave node and merges via getAllStations', () => {
    // Nested cave: root "sys" with sub-caves A (survey p) and B (survey q), joined by an equate.
    const root = new Cave('sys');
    const A = new Cave('A');
    const B = new Cave('B');
    const p = makeSurvey('p', 'sys.A', [['1', '2', 10, 0, 0]], '1'); // seeded at origin
    const q = makeSurvey('q', 'sys.B', [['1', '2', 10, 90, 0]]); // attaches via the equate
    A.surveys.push(p);
    B.surveys.push(q);
    root.children.push(A, B);
    root.aliases.push(new SurveyAlias('2@sys.A', '1@sys.B'));

    const merged = SurveyHelper.recalculateCave(root);

    // Both surveys placed and connected (q only via the equate).
    expect(p.isolated).toBe(false);
    expect(q.isolated).toBe(false);
    // Stations land in the OWNING sub-cave node's map, not the root's.
    expect(A.stations.has('1@sys.A')).toBe(true);
    expect(A.stations.has('2@sys.A')).toBe(true);
    expect(B.stations.has('2@sys.B')).toBe(true);
    expect(root.stations.size).toBe(0); // root owns no surveys → no stations of its own
    // The merged view sees the whole network; equated junction stored once.
    expect(root.getAllStations().size).toBe(A.stations.size + B.stations.size);
    // recalculateCave returns the merged station map it distributed.
    expect(merged.size).toBe(root.getAllStations().size);
    expect(merged.has('2@sys.A')).toBe(true);
  });
});

describe('SurveyHelper.findAliasedStation (transitive equate resolution)', () => {
  const PLACED = { id: 'placed-station' };
  const stations = new Map([['3@A', PLACED]]); // only one name of the equate group is placed

  it('returns the station directly when the name itself is placed', () => {
    expect(SurveyHelper.findAliasedStation('3@A', [], stations)).toBe(PLACED);
  });

  it('follows a multi-hop equate chain (1@C == 1@B, 1@B == 3@A) to the placed station', () => {
    const aliases = [new SurveyAlias('3@A', '1@B'), new SurveyAlias('1@B', '1@C')];
    expect(SurveyHelper.findAliasedStation('1@C', aliases, stations)).toBe(PLACED); // 2 hops
    expect(SurveyHelper.findAliasedStation('1@B', aliases, stations)).toBe(PLACED); // 1 hop
  });

  it('returns undefined when no name in the equate group is placed', () => {
    const aliases = [new SurveyAlias('3@A', '1@B')];
    expect(SurveyHelper.findAliasedStation('9@Z', aliases, stations)).toBeUndefined();
  });

  it('terminates on cyclic equates (a==b, b==a) instead of looping forever', () => {
    const cyclic = [new SurveyAlias('a', 'b'), new SurveyAlias('b', 'a')];
    expect(SurveyHelper.findAliasedStation('a', cyclic, new Map())).toBeUndefined();
  });
});

describe('SurveyHelper.interpolateColorByValue', () => {
  const stops = [{ depth: 0, color: '#000000' }, { depth: 100, color: '#ffffff' }];

  it('returns the endpoint colors at the stops and interpolates in between', () => {
    expect(SurveyHelper.interpolateColorByValue(0, stops, 'depth').r).toBeCloseTo(0);
    expect(SurveyHelper.interpolateColorByValue(100, stops, 'depth').r).toBeCloseTo(1);
    expect(SurveyHelper.interpolateColorByValue(50, stops, 'depth').r).toBeCloseTo(0.5);
  });

  it('clamps to the nearest stop when the value is outside the range', () => {
    expect(SurveyHelper.interpolateColorByValue(-20, stops, 'depth').r).toBeCloseTo(0);
    expect(SurveyHelper.interpolateColorByValue(150, stops, 'depth').r).toBeCloseTo(1);
  });

  it('honours an alternate valueKey (distance)', () => {
    const dstops = [{ distance: 0, color: '#000000' }, { distance: 10, color: '#ffffff' }];
    expect(SurveyHelper.interpolateColorByValue(5, dstops, 'distance').r).toBeCloseTo(0.5);
  });

  it('requires at least two gradient stops', () => {
    expect(() => SurveyHelper.interpolateColorByValue(5, [{ depth: 0, color: '#000000' }])).toThrow();
  });
});

describe('SurveyHelper.getColorGradientsByDepthForCaves (depth color mode)', () => {
  it('produces a color for every placed segment (buffer length matches getSegments)', () => {
    // Nested cave with vertical relief (clino) so depth varies; the two sub-caves connect only
    // via an equate. Mirrors the distance-mode test: a missing color shortens the buffer below
    // the position buffer → WebGL "vertex buffer is not big enough".
    const root = new Cave('sys');
    const A = new Cave('A');
    const B = new Cave('B');
    const p = makeSurvey('p', 'sys.A', [['1', '2', 10, 0, -30], ['2', '3', 10, 0, -30]], '1');
    const q = makeSurvey('q', 'sys.B', [['1', '2', 10, 0, 30]]);
    A.surveys.push(p);
    B.surveys.push(q);
    root.children.push(A, B);
    root.aliases.push(new SurveyAlias('3@sys.A', '1@sys.B'));
    SurveyHelper.recalculateCave(root);

    const opts = { color: { gradientColors: [{ depth: 0, color: '#000000' }, { depth: 100, color: '#ffffff' }] } };
    const grads = SurveyHelper.getColorGradientsByDepthForCaves(new Map([[root.name, root]]), opts);
    const stations = root.getAllStations();

    [p, q].forEach((s) => {
      const [centerSegments] = SurveyHelper.getSegments(s, stations);
      const colors = grads.get(root.name).get(s.id);
      expect(centerSegments.length).toBeGreaterThan(0);
      expect(colors.center.length).toBe(centerSegments.length);
    });
  });
});
