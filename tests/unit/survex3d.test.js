import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Mocks (must precede dynamic imports) ────────────────────────────────────

vi.mock('../../src/i18n/i18n.js', () => ({
  i18n : { t: (key, params) => (params ? `${key} ${JSON.stringify(params)}` : key) }
}));

vi.mock('../../src/ui/popups.js', () => ({
  showErrorPanel   : vi.fn(),
  showWarningPanel : vi.fn(),
  showInfoPanel    : vi.fn()
}));

vi.mock('../../src/ui/coordinate-system-dialog.js', () => ({
  CoordinateSystemDialog : class {
    async show() {
      return { coordinateSystem: undefined, coordinates: [] };
    }
  }
}));

vi.mock('../../src/utils/global-coordinate-normalizer.js', () => ({
  globalNormalizer : {
    isInitialized          : () => false,
    initializeGlobalOrigin : vi.fn(),
    getNormalizedVector    : (c) => c
  }
}));

vi.mock('../../src/model/geo.js', async () => {
  const actual = await vi.importActual('../../src/model/geo.js');
  const origUTM = actual.UTMCoordinateWithElevation;
  class UTMCoordWithNorm extends origUTM {
    toNormalizedVector() {
      const { Vector } = require('../../src/model.js');
      return new Vector(this.easting, this.northing, this.elevation);
    }
  }
  return { ...actual, UTMCoordinateWithElevation: UTMCoordWithNorm };
});

const { Survex3dImporter, parse3d, parseCrs } = await import('../../src/io/survex3d-importer.js');

function makeImporter() {
  return new Survex3dImporter(null, null, null, null);
}

function readFixture(name) {
  const buf = readFileSync(resolve(__dirname, '../fixtures', name));
  // Convert Node Buffer to a tight ArrayBuffer slice (avoids the shared-pool issue).
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

describe('Survex3dImporter', () => {

  describe('parseCrs', () => {
    it('recognises EPSG UTM north codes', () => {
      expect(parseCrs('EPSG:32633')).toEqual({ type: 'utm', zone: 33, northern: true });
    });
    it('recognises EPSG UTM south codes', () => {
      expect(parseCrs('EPSG:32733')).toEqual({ type: 'utm', zone: 33, northern: false });
    });
    it('recognises EOV (EPSG:23700)', () => {
      expect(parseCrs('EPSG:23700')).toEqual({ type: 'eov' });
    });
    it('recognises +init=epsg:NNNNN form', () => {
      expect(parseCrs('+init=epsg:32634')).toEqual({ type: 'utm', zone: 34, northern: true });
    });
    it('recognises +proj=utm +zone=N PROJ4 form', () => {
      expect(parseCrs('+proj=utm +zone=33 +datum=WGS84')).toEqual({ type: 'utm', zone: 33, northern: true });
    });
    it('recognises +proj=utm with +south', () => {
      expect(parseCrs('+proj=utm +zone=33 +south +datum=WGS84')).toEqual({ type: 'utm', zone: 33, northern: false });
    });
    it('returns null for unknown CRS', () => {
      expect(parseCrs('something unknown')).toBeNull();
      expect(parseCrs(null)).toBeNull();
      expect(parseCrs('')).toBeNull();
    });
  });

  describe('parse3d (binary parser)', () => {
    it('rejects non-Survex files', () => {
      const bad = new TextEncoder().encode('Not a Survex file\n');
      expect(() => parse3d(bad.buffer.slice(bad.byteOffset, bad.byteOffset + bad.byteLength)))
        .toThrow(/survex3dBadMagic/);
    });

    it('parses concorde.3d header and body', () => {
      const buf = readFixture('concorde.3d');
      const r = parse3d(buf);
      expect(r.version).toBe('v8');
      expect(r.title).toBe('concorde');
      expect(r.crs).toBeNull();
      // concorde survey has 6 stations (1-6) plus the equated spaceodessey.1.
      // Labels record at least one name per coordinate.
      expect(r.labels.size).toBeGreaterThanOrEqual(6);
      // 5 cave legs from concorde.svx: 1-2, 2-3, 3-4, 4-5, 6-5.
      const caveLegs = r.legs.filter((l) => l.type === 'cave');
      expect(caveLegs.length).toBeGreaterThanOrEqual(5);
    });

    it('parses Belladonna.3d (v8) header and produces legs', () => {
      const buf = readFixture('Belladonna.3d');
      const r = parse3d(buf);
      expect(r.version).toBe('v8');
      expect(r.title).toBe('Belladonna');
      expect(r.legs.length).toBeGreaterThan(0);
      expect(r.labels.size).toBeGreaterThan(0);
    });
  });

  describe('end-to-end cave assembly', () => {
    it('builds a Cave from concorde.3d with expected station / shot counts', async () => {
      const buf = readFixture('concorde.3d');
      const cave = await makeImporter().getCave(buf, 'concorde.3d');
      expect(cave).toBeTruthy();
      expect(cave.name).toBe('concorde');
      expect(cave.surveys).toHaveLength(1);
      const survey = cave.surveys[0];
      // At least the 5 center shots from concorde.svx.
      const centers = survey.shots.filter((s) => s.isCenter());
      expect(centers.length).toBeGreaterThanOrEqual(5);
      // Station map should contain at least 6 stations.
      expect(cave.stations.size).toBeGreaterThanOrEqual(6);
    });

    it('imported .3d caves are read-only (visualization-only)', async () => {
      const cave = await makeImporter().getCave(readFixture('concorde.3d'), 'concorde.3d');
      expect(cave.readOnly).toBe(true);
    });

    it('stations are built directly with absolute positions (no chain reconstruction)', async () => {
      // The importer builds every station's position straight from the .3d coords —
      // no traversal. Each center station already has a position, and the geometry
      // matches: the 6→5 leg is 2.70 m, so |pos(6) - pos(5)| ≈ 2.70.
      const cave = await makeImporter().getCave(readFixture('concorde.3d'), 'concorde.3d');
      const s5 = cave.stations.get('5');
      const s6 = cave.stations.get('6');
      expect(s5?.position).toBeTruthy();
      expect(s6?.position).toBeTruthy();
      const dx = s6.position.x - s5.position.x;
      const dy = s6.position.y - s5.position.y;
      const dz = s6.position.z - s5.position.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      expect(dist).toBeCloseTo(2.7, 1);
    });

    it('station names are shortened to the shortest unique dotted suffix', async () => {
      const cave = await makeImporter().getCave(readFixture('concorde.3d'), 'concorde.3d');
      // 6 canonical stations all named "concorde.N" — each suffix "1"…"6" is globally
      // unique among canonicals, so we keep just the bare id.
      const names = [...cave.stations.keys()].sort();
      expect(names).toEqual(['1', '2', '3', '4', '5', '6']);
    });

    it('back-calculated polar values reproduce the input distances (Concorde leg 6→5)', async () => {
      // concorde.svx: shot 6→5 was 2.70 m, compass 192, clino -12.
      const buf = readFixture('concorde.3d');
      const cave = await makeImporter().getCave(buf, 'concorde.3d');
      const survey = cave.surveys[0];
      // Find a shot of about 2.70 m length and verify azimuth/clino match (within rounding).
      const match = survey.shots.find(
        (s) => Math.abs(s.length - 2.7) < 0.05 && Math.abs(s.azimuth - 192) < 2 && Math.abs(s.clino - -12) < 2
      );
      expect(match).toBeTruthy();
    });

    it('builds a Cave from Belladonna.3d with splay shots', async () => {
      const buf = readFixture('Belladonna.3d');
      const cave = await makeImporter().getCave(buf, 'Belladonna.3d');
      expect(cave).toBeTruthy();
      expect(cave.name).toBe('Belladonna');
      const shots = cave.surveys[0].shots;
      expect(shots.length).toBeGreaterThan(0);
      // Belladonna.svx is mostly splays (~48 per the source) — verify they made it through.
      const splays = shots.filter((s) => s.isSplay());
      expect(splays.length).toBeGreaterThan(0);
      // Splays have no `to` station.
      splays.forEach((s) => expect(s.to).toBeUndefined());
    });

    it('cross-survey equate (concorde.6 ≡ spaceodessey.1) becomes a SurveyAlias', async () => {
      const buf = readFixture('concorde.3d');
      const cave = await makeImporter().getCave(buf, 'concorde.3d');
      // The .svx had `*equate spaceodessey.1 concorde.6` — both labels share the same coord
      // in the .3d. After common-prefix stripping the "concorde." root, station 6 becomes
      // just "6", while "spaceodessey.1" stays full (different prefix).
      expect(cave.aliases.length).toBeGreaterThan(0);
      const flat = cave.aliases.map((a) => [a.from, a.to].sort().join('='));
      expect(flat.some((e) => e === '6=spaceodessey.1')).toBe(true);
    });

    it('survey is named after the file title', async () => {
      const cave = await makeImporter().getCave(readFixture('concorde.3d'), 'concorde.3d');
      expect(cave.surveys[0].name).toBe('concorde');
    });

    it('no CRS in header → cave has no geoData', async () => {
      const cave = await makeImporter().getCave(readFixture('concorde.3d'), 'concorde.3d');
      expect(cave.geoData).toBeNull();
    });

    it('SurveyMetadata.convergence stays null (azimuths are already grid-derived)', async () => {
      // .3d coords are projected, so atan2(dx, dy) is already a grid bearing — applying
      // meridian convergence would rotate the reconstructed centerline away from the
      // original .3d positions. Verify convergence is left null even for georeferenced files.
      const cave = await makeImporter().getCave(readFixture('concorde.3d'), 'concorde.3d');
      for (const s of cave.surveys) expect(s.metadata.convergence).toBeNull();
    });

    it('XSECT records (from *data passage in source) become cave.stationDimensions', async () => {
      // concorde.svx ends with:
      //   *data passage station left right up down
      //   1   4.0 4.0 40.0  0.5
      //   5   4.0 4.0 20.0 30.0
      //   6   1.0 1.0  1.0  1.0
      // The .3d encodes those as XSECT records; after LCP stripping the "concorde." root,
      // station names become "1", "5", "6".
      const cave = await makeImporter().getCave(readFixture('concorde.3d'), 'concorde.3d');
      const dims = cave.stationDimensions;
      expect(dims).toHaveLength(3);

      expect(dims.find((d) => d.name === '1')).toMatchObject({ left: 4, right: 4, up: 40, down: 0.5 });
      expect(dims.find((d) => d.name === '5')).toMatchObject({ left: 4, right: 4, up: 20, down: 30 });
      expect(dims.find((d) => d.name === '6')).toMatchObject({ left: 1, right: 1, up: 1, down: 1 });
    });
  });

  describe('synthetic .3d binaries', () => {
    // Helper to build a minimal v8 .3d ArrayBuffer with explicit commands.
    function buildV8({ title = 't', crs = '', commands = [] } = {}) {
      const enc = new TextEncoder();
      const header = enc.encode(`Survex 3D Image File\nv8\n${title}${crs ? '\0' + crs : ''}\n@0\n`);
      const fileFlags = new Uint8Array([0]);
      const cmds = new Uint8Array(commands);
      const total = new Uint8Array(header.length + 1 + cmds.length);
      total.set(header, 0);
      total.set(fileFlags, header.length);
      total.set(cmds, header.length + 1);
      return total.buffer.slice(0);
    }

    // 12-byte little-endian Int32 coord triple (x, y, z in metres → x*100 etc).
    function coords(x, y, z) {
      const buf = new ArrayBuffer(12);
      const v = new DataView(buf);
      v.setInt32(0, Math.round(x * 100), true);
      v.setInt32(4, Math.round(y * 100), true);
      v.setInt32(8, Math.round(z * 100), true);
      return Array.from(new Uint8Array(buf));
    }

    it('rejects an unsupported version', () => {
      const enc = new TextEncoder();
      const bad = enc.encode('Survex 3D Image File\nv99\nbad\n@0\n');
      expect(() => parse3d(bad.buffer.slice(bad.byteOffset, bad.byteOffset + bad.byteLength)))
        .toThrow(/survex3dUnsupportedVersion/);
    });

    it('parses CRS from header with null separator', () => {
      const buf = buildV8({ title: 'mycave', crs: 'EPSG:32633', commands: [] });
      const r = parse3d(buf);
      expect(r.title).toBe('mycave');
      expect(r.crs).toBe('EPSG:32633');
    });

    it('MOVE + LINE produces one cave leg with correct displacement', () => {
      // MOVE to (0,0,0); LINE with label "s.a" to (1,0,0); LINE no-label-change to (2,0,0).
      const commands = [
        0x0f,
        ...coords(0, 0, 0),
        0x40,
        0x03,
        ...[...new TextEncoder().encode('s.a')],
        ...coords(1, 0, 0),
        0x60,
        ...coords(2, 0, 0) // 0x60: LINE with no-label-change (0x20 bit) + cave (flags 0x07=0)
      ];
      const buf = buildV8({ commands });
      const r = parse3d(buf);
      expect(r.legs).toHaveLength(2);
      expect(r.legs.every((l) => l.type === 'cave')).toBe(true);
      // Positions decode as expected.
      const xs = [...r.positions.values()].map((p) => p.x).sort((a, b) => a - b);
      expect(xs).toEqual([0, 1, 2]);
    });

    it('LINE with splay flag (0x04) produces a splay leg', () => {
      // 0x64 = LINE | no-label-change (0x20) | splay (0x04). No label byte follows.
      const commands = [0x0f, ...coords(0, 0, 0), 0x64, ...coords(1, 0, 0)];
      const r = parse3d(buildV8({ commands }));
      expect(r.legs).toHaveLength(1);
      expect(r.legs[0].type).toBe('splay');
    });

    it('LINE with surface (0x01) and duplicate (0x02) flags are tagged', () => {
      // Use the no-label-change variant (0x20 bit set) to skip label encoding bytes.
      // 0x61 = LINE | no-label-change | surface; 0x62 = LINE | no-label-change | duplicate.
      const commands = [0x0f, ...coords(0, 0, 0), 0x61, ...coords(1, 0, 0), 0x62, ...coords(2, 0, 0)];
      const r = parse3d(buildV8({ commands }));
      expect(r.legs.map((l) => l.type)).toEqual(['surface', 'dup']);
    });

    it('LABEL records a station name and links it to its coordinate', () => {
      // MOVE; LINE-cave with label "s.x" to (1,0,0); LABEL "s.y" replaces and tags coord (1,0,0).
      // Reusing the same coord triple lets us verify name attachment.
      const enc = new TextEncoder();
      const xBytes = [...enc.encode('s.x')];
      const commands = [
        0x0f,
        ...coords(0, 0, 0),
        0x40,
        0x03,
        ...xBytes,
        ...coords(1, 0, 0),
        // 0x82 = LABEL + underground bit. Label change: del=3, add=3 → "s.x" → "" → "s.y".
        0x82,
        0x33,
        ...enc.encode('s.y'),
        ...coords(1, 0, 0)
      ];
      const r = parse3d(buildV8({ commands }));
      // Coord (1,0,0) should now have a label "s.y".
      const labelArrays = [...r.labels.values()];
      const allNames = labelArrays.flat();
      expect(allNames).toContain('s.y');
    });

    it('shortest-unique-suffix shortening keeps just enough hierarchy to stay unique', async () => {
      // Build a synthetic .3d with three labelled stations: two share the bare id "5"
      // (so they must keep one parent segment) and one is unambiguous.
      // Each LABEL has to be attached to a coord that an actual leg references,
      // otherwise the station never makes it into cave.stations.
      const enc = new TextEncoder();
      const lblA = [...enc.encode('a.b.5')];
      const lblB = [...enc.encode('a.c.5')];
      const lblC = [...enc.encode('a.b.6')];
      const commands = [
        // MOVE to (0,0,0); two LINEs (no label change, cave) to (2,0,0) then (3,0,0).
        0x0f,
        ...coords(0, 0, 0),
        0x60,
        ...coords(2, 0, 0),
        0x60,
        ...coords(3, 0, 0),
        // Now label each of the three coords. 0x82 = LABEL + underground flag.
        // v8 label-change byte: high nibble del, low nibble add.
        0x82,
        lblA.length,
        ...lblA,
        ...coords(0, 0, 0), // 0x05  add 5
        0x82,
        (5 << 4) | lblB.length,
        ...lblB,
        ...coords(2, 0, 0), // 0x55  del 5 / add 5
        0x82,
        (5 << 4) | lblC.length,
        ...lblC,
        ...coords(3, 0, 0) // 0x55  del 5 / add 5
      ];
      const cave = await makeImporter().getCave(buildV8({ commands }), 'syn.3d');
      const names = [...cave.stations.keys()];
      // a.b.5 and a.c.5 both keep "b.5" / "c.5" because bare "5" collides.
      // a.b.6 keeps just "6" — globally unique.
      expect(names).toContain('b.5');
      expect(names).toContain('c.5');
      expect(names).toContain('6');
    });

    it("each survey gets its own projected startCoord (not the anchor station's)", async () => {
      // Synthetic UTM .3d with two surveys at very different coordinates. The anchor
      // (first labeled station) lives in survey "a"; survey "b"'s start station must
      // record its own projected coord, not the anchor's, so its WGS84 derivation is
      // correct downstream.
      const enc = new TextEncoder();
      const lblA1 = [...enc.encode('a.1')];
      const lblB1 = [...enc.encode('b.1')];
      const commands = [
        // Survey "a": MOVE to UTM (500000, 4000000, 100); LINE to (500010, 4000000, 100).
        0x0f,
        ...coords(500000, 4000000, 100),
        0x40,
        0x01,
        ...enc.encode('a'),
        ...coords(500010, 4000000, 100),
        // Survey "b": MOVE to (600000, 4100000, 200); LINE to (600010, 4100000, 200).
        0x0f,
        ...coords(600000, 4100000, 200),
        0x40,
        0x11,
        ...enc.encode('b'),
        ...coords(600010, 4100000, 200), // del 1 add 1
        // LABEL stations after the legs. Current label state is "b" (from the last LINE),
        // so the first LABEL drops that 1 char then adds "a.1"; the next drops "a.1" (3)
        // and adds "b.1" (3).
        0x82,
        (1 << 4) | lblA1.length,
        ...lblA1,
        ...coords(500000, 4000000, 100), // 0x13
        0x82,
        (3 << 4) | lblB1.length,
        ...lblB1,
        ...coords(600000, 4100000, 200) // 0x33
      ];
      const cave = await makeImporter().getCave(buildV8({ title: 'syn', crs: 'EPSG:32633', commands }), 'syn.3d');
      // Verify by station-name set; shortening keeps both at "a.1"/"b.1" since bare
      // "1" collides between the two surveys.
      expect([...cave.stations.keys()]).toEqual(expect.arrayContaining(['a.1', 'b.1']));
      const aStart = cave.stations.get('a.1');
      const bStart = cave.stations.get('b.1');
      // Both surveys' starts should have a projected coord at their own .3d position,
      // not at the anchor's. The bug Codex flagged would have given bStart the
      // anchor's easting (500000) instead of 600000.
      expect(aStart.coordinates.projected.easting).toBeCloseTo(500000, 0);
      expect(bStart.coordinates.projected.easting).toBeCloseTo(600000, 0);
      expect(bStart.coordinates.projected.northing).toBeCloseTo(4100000, 0);
      expect(bStart.coordinates.projected.elevation).toBeCloseTo(200, 0);
    });

    it('toExport → fromPure restores stations directly, with zero recalculation', async () => {
      // .3d caves persist their (pre-solved) station map and reload it verbatim — they
      // are NOT rebuilt from shots, which is what previously left disconnected
      // components isolated. Two surveys sharing a coord via *equate exercise the
      // multi-survey path.
      const enc = new TextEncoder();
      const lblA1 = [...enc.encode('a.1')];
      const lblA2 = [...enc.encode('a.2')];
      const lblB0 = [...enc.encode('b.0')]; // same coord as a.2 (equate)
      const lblB1 = [...enc.encode('b.1')];
      const commands = [
        // Survey "a": (0,0,0) → (10,0,0)
        0x0f,
        ...coords(0, 0, 0),
        0x40,
        0x01,
        ...enc.encode('a'),
        ...coords(10, 0, 0),
        // Survey "b": starts at coord (10,0,0) (same as a.2!), then → (10,10,0)
        0x0f,
        ...coords(10, 0, 0),
        0x40,
        0x11,
        ...enc.encode('b'),
        ...coords(10, 10, 0),
        // Label coords. Current label is "b" after last LINE.
        0x82,
        (1 << 4) | lblA1.length,
        ...lblA1,
        ...coords(0, 0, 0), // a.1 at origin
        0x82,
        (3 << 4) | lblA2.length,
        ...lblA2,
        ...coords(10, 0, 0), // a.2 at (10,0,0)
        0x82,
        (3 << 4) | lblB0.length,
        ...lblB0,
        ...coords(10, 0, 0), // b.0 = a.2 (equate)
        0x82,
        (3 << 4) | lblB1.length,
        ...lblB1,
        ...coords(10, 10, 0) // b.1 at (10,10,0)
      ];
      const cave = await makeImporter().getCave(buildV8({ commands }), 'chain.3d');
      expect(cave.surveys).toHaveLength(2);
      expect(cave.readOnly).toBe(true);
      // Equate produced an alias since both labels share the same coord.
      expect(cave.aliases.length).toBeGreaterThan(0);

      // Capture the original station positions for comparison after reload.
      const originalPositions = new Map([...cave.stations.entries()].map(([name, st]) => [name, { ...st.position }]));
      expect(originalPositions.size).toBeGreaterThan(0);

      // Round-trip through toExport / fromPure — the real reload path. No recalc.
      const { Cave } = await import('../../src/model/cave.js');
      const exported = JSON.parse(JSON.stringify(cave.toExport()));
      // The serialized cave must carry both the read-only flag and its station map.
      expect(exported.readOnly).toBe(true);
      expect(Array.isArray(exported.stations)).toBe(true);
      // Grab the serialized 'a.1' entry before fromPure (which turns stations into a Map).
      const exportedA1 = exported.stations.find(([name]) => name === 'a.1')[1];

      const restored = Cave.fromPure(exported, { schemaVersion: 1 });
      expect(restored.readOnly).toBe(true);

      // Every station is restored with its exact position — no chaining, no isolation.
      expect(restored.stations.size).toBe(originalPositions.size);
      for (const [name, pos] of originalPositions) {
        const st = restored.stations.get(name);
        expect(st).toBeTruthy();
        expect(st.position.x).toBeCloseTo(pos.x, 6);
        expect(st.position.y).toBeCloseTo(pos.y, 6);
        expect(st.position.z).toBeCloseTo(pos.z, 6);
      }

      // Station survey back-references are re-linked to the restored survey objects.
      const a1 = restored.stations.get('a.1');
      expect(restored.surveys).toContain(a1.survey);

      // `local` is not persisted (it duplicates `position`); it's reconstructed on load
      // so the station-details panel still has it. This is a non-georeferenced cave, so
      // the whole `coordinates` object is dropped from the export.
      expect(exportedA1.coordinates).toBeUndefined();
      expect(a1.coordinates.local).toBeTruthy();
      expect(a1.coordinates.local.x).toBeCloseTo(a1.position.x, 6);
      expect(a1.coordinates.local.y).toBeCloseTo(a1.position.y, 6);
      expect(a1.coordinates.local.z).toBeCloseTo(a1.position.z, 6);
    });

    it('multiple LINE labels produce multiple Surveys (one per surveyPath)', async () => {
      // Two MOVE-LINE runs with different LINE labels → two distinct surveys.
      // Survey "a": MOVE to (0,0,0); LINE "a" to (1,0,0); LINE "a" (no change) to (2,0,0).
      // Survey "b": MOVE to (10,0,0); LINE "b" to (11,0,0).
      const enc = new TextEncoder();
      const commands = [
        // Run 1: label "a"
        0x0f,
        ...coords(0, 0, 0),
        0x40,
        0x01,
        ...enc.encode('a'),
        ...coords(1, 0, 0), // LINE flags=0, label "a"
        0x60,
        ...coords(2, 0, 0), // LINE no-label-change
        // Run 2: MOVE somewhere else, then LINE "b"
        0x0f,
        ...coords(10, 0, 0),
        // del=1 (drop "a"), add=1 ("b") → label becomes "b"
        0x40,
        0x11,
        ...enc.encode('b'),
        ...coords(11, 0, 0)
      ];
      const cave = await makeImporter().getCave(buildV8({ commands }), 'multi.3d');
      expect(cave.surveys).toHaveLength(2);
      const names = cave.surveys.map((s) => s.name).sort();
      expect(names).toEqual(['a', 'b']);
      const a = cave.surveys.find((s) => s.name === 'a');
      const b = cave.surveys.find((s) => s.name === 'b');
      expect(a.shots).toHaveLength(2);
      expect(b.shots).toHaveLength(1);
    });

    it('surface and duplicate legs are dropped from the final Survey shots', async () => {
      // One cave leg + one surface leg + one duplicate leg.
      const commands = [
        0x0f,
        ...coords(0, 0, 0),
        0x60,
        ...coords(1, 0, 0), // cave (no-label-change)
        0x61,
        ...coords(2, 0, 0), // surface
        0x62,
        ...coords(3, 0, 0) // duplicate
      ];
      const cave = await makeImporter().getCave(buildV8({ commands }), 'syn.3d');
      const shots = cave.surveys[0].shots;
      // Only the cave leg survives — surface/dup were filtered in assembleCave.
      expect(shots).toHaveLength(1);
      expect(shots[0].isCenter()).toBe(true);
    });
  });
});
