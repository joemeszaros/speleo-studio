import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ─── Mocks (must come before dynamic imports) ────────────────────────────────

vi.mock('../../src/i18n/i18n.js', () => ({
  i18n: { t: (key, _params) => key }
}));

vi.mock('../../src/ui/popups.js', () => ({
  showErrorPanel  : vi.fn(),
  showWarningPanel: vi.fn(),
  showInfoPanel   : vi.fn(),
}));

vi.mock('../../src/ui/coordinate-system-dialog.js', () => ({
  CoordinateSystemDialog: class {
    async show() { return { coordinateSystem: undefined, coordinates: [] }; }
  }
}));

vi.mock('../../src/utils/global-coordinate-normalizer.js', () => ({
  globalNormalizer: {
    isInitialized         : () => false,
    initializeGlobalOrigin: vi.fn(),
    getNormalizedVector   : (c) => c,
  }
}));

// Provide a minimal toNormalizedVector on UTMCoordinateWithElevation
vi.mock('../../src/model/geo.js', async () => {
  const actual = await vi.importActual('../../src/model/geo.js');

  // Patch toNormalizedVector if missing (test environment has no globalNormalizer)
  const origUTM = actual.UTMCoordinateWithElevation;
  class UTMCoordWithNorm extends origUTM {
    toNormalizedVector() {
      const { Vector } = require('../../src/model.js');
      return new Vector(this.easting, this.northing, this.elevation);
    }
  }

  return { ...actual, UTMCoordinateWithElevation: UTMCoordWithNorm };
});

vi.mock('../../src/model.js', async () => {
  const actual = await vi.importActual('../../src/model.js');
  return actual;
});

// ─── Dynamic imports (after mocks) ───────────────────────────────────────────

const { TherionImporter } = await import('../../src/io/therion-importer.js');
const { findRootFiles, chooseRootImports } = await import('../../src/io/cave-survey-helpers.js');

// Mirror of THERION_OPTS (module-private in therion-importer.js) for the root-file tests.
const THERION_OPTS = {
  commentChar    : '#',
  stripStarPrefix: false,
  includeKeyword : 'input',
  countPattern   : /^\s*input\b/gim,
  skipExtensions : ['.th2', '.thm'],
  defaultExt     : '.th'
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fixturesDir = resolve('tests/fixtures');

function readFixture(name) {
  return readFileSync(resolve(fixturesDir, name), 'utf-8');
}

function makeImporter() {
  return new TherionImporter(null, null, null, null);
}

function textMap(...pairs) {
  return new Map(pairs);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('TherionImporter', () => {

  describe('tokenizer (#tokenizeLine via getCave)', () => {
    it('parses a minimal single-survey file into a Cave', async () => {
      const th = `
survey test -title "Test Cave"
  centreline
    data normal from to length compass clino
    1 2 10.0 135.0 -15.0
    2 3  8.0  90.0   0.0
  endcentreline
endsurvey test
`;
      const importer = makeImporter();
      const cave = await importer.getCave(textMap(['test.th', th]));

      expect(cave).toBeTruthy();
      expect(cave.name).toBe('Test Cave');
      expect(cave.surveys).toHaveLength(1);
      const survey = cave.surveys[0];
      expect(survey.shots).toHaveLength(2);
      expect(survey.shots[0].from).toBe('1');
      expect(survey.shots[0].to).toBe('2');
      expect(survey.shots[0].length).toBeCloseTo(10.0);
      expect(survey.shots[0].azimuth).toBeCloseTo(135.0);
      expect(survey.shots[0].clino).toBeCloseTo(-15.0);
    });

    it('strips # comments', async () => {
      const th = `
survey cave # this is a comment
  centreline
    data normal from to length compass clino # columns
    1 2 5.0 0.0 0.0 # inline comment
  endcentreline
endsurvey
`;
      const cave = await makeImporter().getCave(textMap(['cave.th', th]));
      expect(cave.surveys[0].shots).toHaveLength(1);
    });

    it('handles quoted strings with spaces', async () => {
      const th = `
survey test -title "My Test Cave"
  centreline
    team "Joe Speleo" surveyor "Jane Speleo" compass
    data normal from to length compass clino
    1 2 5.0 0.0 0.0
  endcentreline
endsurvey
`;
      const cave = await makeImporter().getCave(textMap(['test.th', th]));
      expect(cave.name).toBe('My Test Cave');
      const meta = cave.surveys[0].metadata;
      expect(meta.team.members).toHaveLength(2);
      expect(meta.team.members[0].name).toBe('Joe Speleo');
      expect(meta.team.members[1].name).toBe('Jane Speleo');
    });
  });

  describe('shot types', () => {
    it('recognises splay shots with "." as to station', async () => {
      const th = `
survey cave
  centreline
    data normal from to length compass clino
    1 2 10.0 135.0 -15.0
    1 .  3.0  45.0   0.0
  endcentreline
endsurvey
`;
      const { ShotType } = await import('../../src/model/survey.js');
      const cave = await makeImporter().getCave(textMap(['cave.th', th]));
      const shots = cave.surveys[0].shots;
      expect(shots[0].type).toBe(ShotType.CENTER);
      expect(shots[1].type).toBe(ShotType.SPLAY);
      expect(shots[1].to).toBeUndefined();
    });

    it('recognises splay shots via "flags splay"', async () => {
      const th = `
survey cave
  centreline
    data normal from to length compass clino
    1 2 10.0 135.0 -15.0
    flags splay
    2 3  3.0  90.0   0.0
    flags not splay
    2 4 8.0 270.0 0.0
  endcentreline
endsurvey
`;
      const { ShotType } = await import('../../src/model/survey.js');
      const cave = await makeImporter().getCave(textMap(['cave.th', th]));
      const shots = cave.surveys[0].shots;
      expect(shots[0].type).toBe(ShotType.CENTER);
      expect(shots[1].type).toBe(ShotType.SPLAY);
      expect(shots[2].type).toBe(ShotType.CENTER);
    });
  });

  describe('data column ordering', () => {
    it('supports compass-before-length ordering', async () => {
      const th = `
survey cave
  centreline
    data normal from to compass clino length
    1 2 135.0 -15.0 10.0
  endcentreline
endsurvey
`;
      const cave = await makeImporter().getCave(textMap(['cave.th', th]));
      const shot = cave.surveys[0].shots[0];
      expect(shot.length).toBeCloseTo(10.0);
      expect(shot.azimuth).toBeCloseTo(135.0);
      expect(shot.clino).toBeCloseTo(-15.0);
    });

    it('handles "up" and "down" clino values', async () => {
      const th = `
survey cave
  centreline
    data normal from to length compass clino
    1 2 5.0 -   up
    2 3 3.0 - down
  endcentreline
endsurvey
`;
      const cave = await makeImporter().getCave(textMap(['cave.th', th]));
      const shots = cave.surveys[0].shots;
      expect(shots[0].clino).toBe(90);
      expect(shots[1].clino).toBe(-90);
    });
  });

  describe('unit preservation', () => {
    it('preserves feet length unit on the survey and keeps shot values in feet', async () => {
      const th = `
survey cave
  centreline
    units length feet
    data normal from to length compass clino
    1 2 32.808 135.0 0.0
  endcentreline
endsurvey
`;
      const cave = await makeImporter().getCave(textMap(['cave.th', th]));
      expect(cave.surveys[0].units).toEqual({ length: 'feet', angle: 'degrees' });
      expect(cave.surveys[0].shots[0].length).toBeCloseTo(32.808, 3);
    });

    it('preserves grads angle unit when both compass and clino are grads', async () => {
      const th = `
survey cave
  centreline
    units compass grads
    units clino grads
    data normal from to length compass clino
    1 2 10.0 200.0 -22.222
  endcentreline
endsurvey
`;
      const cave = await makeImporter().getCave(textMap(['cave.th', th]));
      const survey = cave.surveys[0];
      expect(survey.units).toEqual({ length: 'meters', angle: 'grads' });
      const shot = survey.shots[0];
      expect(shot.azimuth).toBeCloseTo(200.0, 3);
      expect(shot.clino).toBeCloseTo(-22.222, 3);
    });

    it('defaults to meters/degrees when no units directive is given', async () => {
      const th = `
survey cave
  centreline
    data normal from to length compass clino
    1 2 10.0 90.0 0.0
  endcentreline
endsurvey
`;
      const cave = await makeImporter().getCave(textMap(['cave.th', th]));
      expect(cave.surveys[0].units).toEqual({ length: 'meters', angle: 'degrees' });
    });

    it('falls back to degrees when only compass is grads (compass and clino disagree)', async () => {
      // Speleo Studio survey units have a single angle entry — if compass and clino
      // use different units we cannot preserve, so we fall back to degrees.
      const th = `
survey cave
  centreline
    units compass grads
    data normal from to length compass clino
    1 2 10.0 200.0 -20.0
  endcentreline
endsurvey
`;
      const cave = await makeImporter().getCave(textMap(['cave.th', th]));
      const shot = cave.surveys[0].shots[0];
      expect(cave.surveys[0].units).toEqual({ length: 'meters', angle: 'degrees' });
      expect(shot.azimuth).toBeCloseTo(180.0, 1); // 200 grads → 180°
      expect(shot.clino).toBeCloseTo(-20.0, 1);
    });
  });

  describe('multiple data format declarations', () => {
    it('uses the latest data declaration for subsequent rows', async () => {
      const th = `
survey cave
  centreline
    data normal from to length compass clino
    1 2 10.0 135.0 -15.0
    data normal from to compass clino length
    2 3 90.0 0.0 8.0
  endcentreline
endsurvey
`;
      const cave = await makeImporter().getCave(textMap(['cave.th', th]));
      const shots = cave.surveys[0].shots;
      expect(shots[0].length).toBeCloseTo(10.0);
      expect(shots[0].azimuth).toBeCloseTo(135.0);
      expect(shots[1].length).toBeCloseTo(8.0);
      expect(shots[1].azimuth).toBeCloseTo(90.0);
    });
  });

  describe('nested surveys and equate', () => {
    it('flattens nested surveys with dot-path names', async () => {
      const th = `
survey outer -title "Outer"
  survey inner -title "Inner Passage"
    centreline
      data normal from to length compass clino
      1 2 5.0 0.0 0.0
    endcentreline
  endsurvey inner
endsurvey outer
`;
      const cave = await makeImporter().getCave(textMap(['outer.th', th]));
      expect(cave.surveys).toHaveLength(1);
      // Survey name comes from inner title since it differs from name
      expect(cave.surveys[0].name).toBe('Inner Passage');
    });

    it('builds a nested Cave tree from multi-level surveys', async () => {
      const th = `
survey sys -title "System"
  survey caveA
    survey passage1
      centreline
        data normal from to length compass clino
        10 11 5.0 0.0 0.0
        11 12 4.0 90.0 0.0
      endcentreline
    endsurvey passage1
    survey passage2
      centreline
        data normal from to length compass clino
        20 21 6.0 90.0 0.0
      endcentreline
    endsurvey passage2
  endsurvey caveA
  survey caveB
    centreline
      data normal from to length compass clino
      30 31 7.0 180.0 0.0
    endcentreline
  endsurvey caveB
  equate 31@caveB 10@passage1
  equate 12@passage1 20@passage2
endsurvey sys
`;
      const cave = await makeImporter().getCave(textMap(['sys.th', th]));
      // Root keeps the file-level title and holds caveB (a leaf survey) + caveA (a sub-cave)
      expect(cave.name).toBe('System');
      expect(cave.children).toHaveLength(1);
      expect(cave.children[0].name).toBe('caveA');
      // caveB is a leaf survey directly under the root
      expect(cave.surveys.map((s) => s.name)).toContain('caveB');
      // caveA contains the two passage surveys (named by their leaf segment)
      const caveA = cave.children[0];
      expect(caveA.surveys.map((s) => s.name).sort()).toEqual(['passage1', 'passage2']);
      // getAllSurveys aggregates the whole subtree
      expect(cave.getAllSurveys()).toHaveLength(3);
      // stations are distributed per cave; the merged map spans the network
      expect(cave.getAllStations().size).toBeGreaterThan(0);
      expect(caveA.stations.size).toBeGreaterThan(0);
    });

    it('connects equate-linked sub-surveys that reuse the same station numbers', async () => {
      // Three sub-surveys each numbered from 1 (as real Therion surveys are), joined by
      // equates. The qualified-name solver must keep the reused numbers distinct AND place
      // every survey via the equate cascade — no collisions, no orphans, no isolation.
      const th = `
survey sys -title "Reuse"
  survey alpha
    centreline
      data normal from to length compass clino
      1 2 5.0 0.0 0.0
      2 3 5.0 0.0 0.0
    endcentreline
  endsurvey alpha
  survey beta
    centreline
      data normal from to length compass clino
      1 2 5.0 90.0 0.0
      2 3 5.0 90.0 0.0
    endcentreline
  endsurvey beta
  survey gamma
    centreline
      data normal from to length compass clino
      1 2 5.0 180.0 0.0
    endcentreline
  endsurvey gamma
  equate 3@alpha 1@beta
  equate 3@beta 1@gamma
endsurvey sys
`;
      const cave = await makeImporter().getCave(textMap(['sys.th', th]));
      const surveys = cave.getAllSurveys();
      expect(surveys).toHaveLength(3);
      // Every survey is placed (connected through the equate chain).
      expect(surveys.filter((s) => s.isolated)).toHaveLength(0);
      expect(surveys.reduce((n, s) => n + s.orphanShotIds.size, 0)).toBe(0);
      // Reused station number "2" is NOT collapsed across surveys — each is a distinct
      // qualified key (the bug that previously merged all surveys onto ~one point).
      const keys = [...cave.getAllStations().keys()];
      expect(keys).toEqual(expect.arrayContaining(['2@sys.alpha', '2@sys.beta', '2@sys.gamma']));
      // No double-counting: one station object per physical point.
      const objs = new Set([...cave.getAllStations().values()]);
      expect(objs.size).toBe(cave.getAllStations().size);
    });

    it('seeds a connected survey from each of multiple fixes in one cave', async () => {
      // One connected cave (the two sub-surveys are joined by an equate) with TWO fixes in
      // a shared CS. Both fixes must land in geoData and seed placement — the multi-fix path
      // that previously only kept the first fix (leaving most of the network unseeded).
      const th = `
survey region -title "Region"
  cs UTM33N
  survey caveX
    centreline
      fix 1 400000 5000000 1000
      data normal from to length compass clino
      1 2 10.0 0.0 0.0
    endcentreline
  endsurvey caveX
  survey caveY
    centreline
      fix 1 400500 5000000 1000
      data normal from to length compass clino
      1 2 10.0 90.0 0.0
    endcentreline
  endsurvey caveY
  equate 2@caveX 2@caveY
endsurvey region
`;
      const cave = await makeImporter().getCave(textMap(['region.th', th]));
      // Equates make it one connected cave; both fixes are captured and everything placed.
      expect(cave.getAllSurveys().filter((s) => s.isolated)).toHaveLength(0);
      expect(cave.geoData?.coordinates?.length).toBe(2);
    });

    it('splits a pure grouping of independent caves (no equates) into separate caves', async () => {
      // Same as above but WITHOUT the connecting equate: `region` only groups two
      // unconnected caves, so they import as separate top-level caves.
      const th = `
survey region -title "Region"
  cs UTM33N
  survey caveX
    centreline
      fix 1 400000 5000000 1000
      data normal from to length compass clino
      1 2 10.0 0.0 0.0
    endcentreline
  endsurvey caveX
  survey caveY
    centreline
      fix 1 400500 5000000 1000
      data normal from to length compass clino
      1 2 10.0 90.0 0.0
    endcentreline
  endsurvey caveY
endsurvey region
`;
      const caves = await makeImporter().getCaves(textMap(['region.th', th]));
      expect(caves.map((c) => c.name).sort()).toEqual(['caveX', 'caveY']);
      caves.forEach((c) => expect(c.getAllSurveys().filter((s) => s.isolated)).toHaveLength(0));
    });

    it('creates SurveyAlias from equate', async () => {
      const th = `
survey cave
  centreline
    data normal from to length compass clino
    1 2 10.0 135.0 -15.0
    2 3  8.0  90.0   0.0
  endcentreline
  survey branch
    centreline
      data normal from to length compass clino
      1 2 5.0 180.0 -5.0
    endcentreline
  endsurvey branch
  equate 3@cave 1@branch
endsurvey cave
`;
      const cave = await makeImporter().getCave(textMap(['cave.th', th]));
      expect(cave.surveys).toHaveLength(2);
      expect(cave.aliases).toHaveLength(1);
      // This cave has multiple surveys, so station names are survey-qualified internally
      // (`station@surveyPath`) to keep reused numbers distinct. The equate resolves to the
      // fully-qualified endpoints.
      expect(cave.aliases[0].from).toBe('3@cave');
      expect(cave.aliases[0].to).toBe('1@cave.branch');
    });
  });

  describe('coordinate system and fix', () => {
    it('parses cs UTM34 and fix to create GeoData', async () => {
      const th = `
survey cave
  centreline
    cs UTM34
    fix 1 485000.0 5078000.0 1200.0
    data normal from to length compass clino
    1 2 10.0 135.0 0.0
  endcentreline
endsurvey
`;
      const cave = await makeImporter().getCave(textMap(['cave.th', th]));
      expect(cave.geoData).toBeTruthy();
      expect(cave.geoData.coordinateSystem.zoneNum).toBe(34);
      expect(cave.geoData.coordinateSystem.northern).toBe(true);
      const coord = cave.geoData.coordinates[0];
      expect(coord.name).toBe('1');
      expect(coord.coordinate.easting).toBeCloseTo(485000);
      expect(coord.coordinate.northing).toBeCloseTo(5078000);
    });

    it('parses EPSG:32633 as UTM zone 33 northern', async () => {
      const th = `
survey cave
  centreline
    cs EPSG:32633
    fix 1 500000.0 5000000.0 800.0
    data normal from to length compass clino
    1 2 10.0 0.0 0.0
  endcentreline
endsurvey
`;
      const cave = await makeImporter().getCave(textMap(['cave.th', th]));
      expect(cave.geoData.coordinateSystem.zoneNum).toBe(33);
      expect(cave.geoData.coordinateSystem.northern).toBe(true);
    });
  });

  describe('multi-file (input resolution)', () => {
    it('imports two files together resolving input directive', async () => {
      const main = readFixture('sample-therion.th');
      const sub  = readFixture('sample-therion-sub.th');

      const cave = await makeImporter().getCave(
        textMap(['sample-therion.th', main], ['sample-therion-sub.th', sub])
      );

      expect(cave.name).toBe('Sample Cave');
      expect(cave.surveys).toHaveLength(2);
      // The equate should produce one alias connecting the two surveys
      expect(cave.aliases.length).toBeGreaterThanOrEqual(1);
    });

    it('single-file import of file without input still works', async () => {
      const sub = readFixture('sample-therion-sub.th');
      const cave = await makeImporter().getCave(textMap(['sample-therion-sub.th', sub]));
      expect(cave.surveys).toHaveLength(1);
      expect(cave.surveys[0].shots.length).toBeGreaterThan(0);
    });

    it('resolves relative input paths across folders (directory import)', async () => {
      // textMap keyed by relative paths, as a directory pick produces. The root inputs
      // sub-files in a sibling folder; one omits the .th extension.
      const root = `
survey sys -title "Sys"
  input ./caves/a.th
  input ./caves/b
endsurvey
`;
      const a = 'survey a\n centreline\n  data normal from to length compass clino\n  1 2 5 0 0\n endcentreline\nendsurvey';
      const b = 'survey b\n centreline\n  data normal from to length compass clino\n  1 2 5 90 0\n endcentreline\nendsurvey';
      // `sys` only groups two unconnected caves (no equates), so they import as two
      // separate top-level caves — and the cross-folder relative includes must resolve.
      const caves = await makeImporter().getCaves(
        textMap(['proj/sys.th', root], ['proj/caves/a.th', a], ['proj/caves/b.th', b])
      );
      expect(caves.map((c) => c.name).sort()).toEqual(['a', 'b']);
    });

    it('root file detection picks file with most input lines', async () => {
      const root = `
survey cave
  input branch1.th
  input branch2.th
endsurvey
`;
      const branch = `
survey branch1
  centreline
    data normal from to length compass clino
    1 2 5.0 0.0 0.0
  endcentreline
endsurvey
`;
      const branch2 = `
survey branch2
  centreline
    data normal from to length compass clino
    3 4 5.0 90.0 0.0
  endcentreline
endsurvey
`;
      // `cave` only groups two unconnected branches, so they import as two separate caves.
      const caves = await makeImporter().getCaves(
        textMap(['root.th', root], ['branch1.th', branch], ['branch2.th', branch2])
      );
      expect(caves.map((c) => c.name).sort()).toEqual(['branch1', 'branch2']);
    });

    it('picks the correct root when two files share a basename in different folders', async () => {
      // Real-world case (System Migovec ubend): the root `ubend/ubend.th` inputs
      // `2000/ubend/ubend.th` — both basename `ubend.th`. Basename-only exclusion wrongly
      // dropped the real root; full-path resolution must keep it so the tree is parsed.
      const root = `
survey ubend -title "U-bend"
  input "2000/ubend/ubend.th"
endsurvey
`;
      const inner = `
survey ubend_inner
  centreline
    data normal from to length compass clino
    1 2 5.0 0.0 0.0
  endcentreline
endsurvey
`;
      const cave = await makeImporter().getCave(
        textMap(['ubend/ubend.th', root], ['ubend/2000/ubend/ubend.th', inner])
      );
      expect(cave.name).toBe('U-bend');
      expect(cave.getAllSurveys().length).toBe(1);
      expect(cave.getAllSurveys()[0].shots.length).toBe(1);
    });
  });

  describe('default data format', () => {
    it('parses centreline shots with no explicit "data" command (Therion default)', async () => {
      // Older Therion surveys omit the `data` command and rely on the default
      // `data normal from to length compass clino`. Such shots must still parse.
      const th = `
survey cave
  centreline
    units length meters
    1 2 3.90 328 -7
    2 3 1.58 335 -1
  endcentreline
endsurvey
`;
      const cave = await makeImporter().getCave(textMap(['cave.th', th]));
      const shots = cave.surveys[0].shots;
      expect(shots).toHaveLength(2);
      expect(shots[0].from).toBe('1');
      expect(shots[0].to).toBe('2');
      expect(shots[0].length).toBeCloseTo(3.90);
      expect(shots[0].azimuth).toBeCloseTo(328);
      expect(shots[0].clino).toBeCloseTo(-7);
    });
  });

  describe('declination', () => {
    it('applies declination to survey metadata', async () => {
      const th = `
survey cave
  centreline
    declination 5.5 degrees
    data normal from to length compass clino
    1 2 10.0 135.0 0.0
  endcentreline
endsurvey
`;
      const cave = await makeImporter().getCave(textMap(['cave.th', th]));
      expect(cave.surveys[0].metadata.declination).toBeCloseTo(5.5);
    });

    it('treats "declination auto" as 0', async () => {
      const th = `
survey cave
  centreline
    declination auto
    data normal from to length compass clino
    1 2 10.0 135.0 0.0
  endcentreline
endsurvey
`;
      const cave = await makeImporter().getCave(textMap(['cave.th', th]));
      expect(cave.surveys[0].metadata.declination).toBe(0);
    });
  });

  describe('calibration', () => {
    it('adds compass calibration offset to azimuth', async () => {
      const th = `
survey cave
  centreline
    calibrate compass 3.0
    data normal from to length compass clino
    1 2 10.0 100.0 0.0
  endcentreline
endsurvey
`;
      const cave = await makeImporter().getCave(textMap(['cave.th', th]));
      expect(cave.surveys[0].shots[0].azimuth).toBeCloseTo(103.0);
    });
  });

  describe('error handling', () => {
    it('throws when file has no centreline data', async () => {
      const th = `
survey cave
  # no centreline here
endsurvey
`;
      await expect(makeImporter().getCave(textMap(['cave.th', th])))
        .rejects.toThrow();
    });

    it('ignores centrelines with no shots', async () => {
      const th = `
survey cave
  centreline
    # no data declaration
  endcentreline
  centreline
    data normal from to length compass clino
    1 2 5.0 0.0 0.0
  endcentreline
endsurvey
`;
      const cave = await makeImporter().getCave(textMap(['cave.th', th]));
      expect(cave.surveys).toHaveLength(1);
    });

    it('throws therionMissingInputFiles when root file has only unresolved inputs', async () => {
      const th = `
survey cave
  input sub1.th
  input sub2.th
endsurvey
`;
      await expect(makeImporter().getCave(textMap(['cave.th', th])))
        .rejects.toThrow('errors.import.therionMissingInputFiles');
    });
  });

  describe('centreline merging', () => {
    it('merges multiple centreline blocks from the same survey into one Survey', async () => {
      const th = `
survey cave
  centreline
    data normal from to length compass clino
    1 2 5.0 0.0 0.0
  endcentreline
  centreline
    data normal from to length compass clino
    2 3 8.0 90.0 0.0
  endcentreline
endsurvey
`;
      const cave = await makeImporter().getCave(textMap(['cave.th', th]));
      expect(cave.surveys).toHaveLength(1);
      expect(cave.surveys[0].shots).toHaveLength(2);
      expect(cave.surveys[0].shots[0].length).toBeCloseTo(5.0);
      expect(cave.surveys[0].shots[1].length).toBeCloseTo(8.0);
    });

    it('merges cs/fix from a metadata-only centreline with shots from another', async () => {
      const th = `
survey cave
  centreline
    data normal from to length compass clino
    1 2 10.0 0.0 0.0
  endcentreline
  centreline
    cs UTM34
    fix 1 485000.0 5078000.0 300.0
  endcentreline
endsurvey
`;
      const cave = await makeImporter().getCave(textMap(['cave.th', th]));
      expect(cave.surveys).toHaveLength(1);
      expect(cave.surveys[0].shots).toHaveLength(1);
      expect(cave.geoData).toBeTruthy();
      expect(cave.geoData.coordinateSystem.zoneNum).toBe(34);
    });
  });

  describe('EOV coordinate system', () => {
    it('parses EPSG:23700 as EOV and creates correct GeoData', async () => {
      const th = `
survey cave
  centreline
    cs EPSG:23700
    fix 1 767224.04 307420.44 327.15
    data normal from to length compass clino
    1 2 10.0 0.0 0.0
  endcentreline
endsurvey
`;
      const cave = await makeImporter().getCave(textMap(['cave.th', th]));
      expect(cave.geoData).toBeTruthy();
      expect(cave.geoData.coordinateSystem.type).toBe('eov');
      const coord = cave.geoData.coordinates[0];
      expect(coord.coordinate.y).toBeCloseTo(767224.04);
      expect(coord.coordinate.x).toBeCloseTo(307420.44);
      expect(coord.coordinate.elevation).toBeCloseTo(327.15);
    });
  });

  describe('alternative spellings', () => {
    it('accepts "centerline" / "endcentraline" spelling variants', async () => {
      const th = `
survey cave
  centerline
    data normal from to length compass clino
    1 2 5.0 45.0 -10.0
  endcentraline
endsurvey
`;
      const cave = await makeImporter().getCave(textMap(['cave.th', th]));
      expect(cave.surveys[0].shots).toHaveLength(1);
      expect(cave.surveys[0].shots[0].azimuth).toBeCloseTo(45.0);
    });
  });

  describe('station names', () => {
    it('handles station names containing forward slashes', async () => {
      const th = `
survey cave
  centreline
    data normal from to length compass clino
    1019 1019/1  3.74 329 -9
    1019/1 1019/2 4.38 295  3.75
  endcentreline
endsurvey
`;
      const cave = await makeImporter().getCave(textMap(['cave.th', th]));
      const shots = cave.surveys[0].shots;
      expect(shots).toHaveLength(2);
      expect(shots[0].from).toBe('1019');
      expect(shots[0].to).toBe('1019/1');
      expect(shots[1].from).toBe('1019/1');
      expect(shots[1].to).toBe('1019/2');
    });

    it('strips @survey qualifier from station names', async () => {
      const th = `
survey cave
  centreline
    data normal from to length compass clino
    1 2 5.0 0.0 0.0
  endcentreline
endsurvey
`;
      const cave = await makeImporter().getCave(textMap(['cave.th', th]));
      expect(cave.surveys[0].shots[0].from).toBe('1');
      expect(cave.surveys[0].shots[0].to).toBe('2');
    });
  });

  describe('data columns', () => {
    it('ignores columns after ignoreall', async () => {
      const th = `
survey cave
  centreline
    data normal from to length compass clino ignoreall
    1 2 10.0 135.0 -15.0 extra junk ignored
  endcentreline
endsurvey
`;
      const cave = await makeImporter().getCave(textMap(['cave.th', th]));
      const shot = cave.surveys[0].shots[0];
      expect(shot.length).toBeCloseTo(10.0);
      expect(shot.azimuth).toBeCloseTo(135.0);
      expect(shot.clino).toBeCloseTo(-15.0);
    });

    it('converts percent clino to degrees', async () => {
      const th = `
survey cave
  centreline
    units clino percent
    data normal from to length compass clino
    1 2 10.0 0.0 100
  endcentreline
endsurvey
`;
      const cave = await makeImporter().getCave(textMap(['cave.th', th]));
      expect(cave.surveys[0].shots[0].clino).toBeCloseTo(45.0, 0);
    });

    it('treats compass "-" as azimuth 0 for vertical shots', async () => {
      const th = `
survey cave
  centreline
    data normal from to length compass clino
    1 2 5.0 - 90
    2 3 3.0 - -90
  endcentreline
endsurvey
`;
      const cave = await makeImporter().getCave(textMap(['cave.th', th]));
      expect(cave.surveys[0].shots[0].azimuth).toBe(0);
      expect(cave.surveys[0].shots[0].clino).toBe(90);
      expect(cave.surveys[0].shots[1].azimuth).toBe(0);
      expect(cave.surveys[0].shots[1].clino).toBe(-90);
    });
  });

  describe('calibration', () => {
    it('adds clino calibration offset to clino', async () => {
      const th = `
survey cave
  centreline
    calibrate clino -2.0
    data normal from to length compass clino
    1 2 10.0 100.0 20.0
  endcentreline
endsurvey
`;
      const cave = await makeImporter().getCave(textMap(['cave.th', th]));
      expect(cave.surveys[0].shots[0].clino).toBeCloseTo(18.0);
    });

    it('applies both compass and clino calibration independently', async () => {
      const th = `
survey cave
  centreline
    calibrate compass 5.0
    calibrate clino 1.5
    data normal from to length compass clino
    1 2 10.0 90.0 10.0
  endcentreline
endsurvey
`;
      const cave = await makeImporter().getCave(textMap(['cave.th', th]));
      expect(cave.surveys[0].shots[0].azimuth).toBeCloseTo(95.0);
      expect(cave.surveys[0].shots[0].clino).toBeCloseTo(11.5);
    });

    it('applies scale factor: corrected = (measured + offset) * scale', async () => {
      const th = `
survey cave
  centreline
    calibrate compass 2.0 0.5
    calibrate clino 0.0 2.0
    data normal from to length compass clino
    1 2 10.0 90.0 10.0
  endcentreline
endsurvey
`;
      // compass: (90 + 2) * 0.5 = 46.0
      // clino:   (10 + 0) * 2.0 = 20.0
      const cave = await makeImporter().getCave(textMap(['cave.th', th]));
      expect(cave.surveys[0].shots[0].azimuth).toBeCloseTo(46.0);
      expect(cave.surveys[0].shots[0].clino).toBeCloseTo(20.0);
    });

    it('defaults scale to 1.0 when not specified', async () => {
      const th = `
survey cave
  centreline
    calibrate compass 5.0
    data normal from to length compass clino
    1 2 10.0 90.0 0.0
  endcentreline
endsurvey
`;
      const cave = await makeImporter().getCave(textMap(['cave.th', th]));
      expect(cave.surveys[0].shots[0].azimuth).toBeCloseTo(95.0);
    });
  });

  describe('line continuation', () => {
    it('joins backslash-continued lines into one token sequence', async () => {
      const th = `
survey cave
  centreline
    data normal from to \
length compass clino
    1 2 7.5 270.0 5.0
  endcentreline
endsurvey
`;
      const cave = await makeImporter().getCave(textMap(['cave.th', th]));
      const shot = cave.surveys[0].shots[0];
      expect(shot.length).toBeCloseTo(7.5);
      expect(shot.azimuth).toBeCloseTo(270.0);
    });
  });

  describe('station-names command', () => {
    it('adds prefix and suffix to station names in shot rows', async () => {
      const th = `
survey cave
  centreline
    station-names p_ _s
    data normal from to length compass clino
    1 2 5.0 90.0 0.0
    2 3 3.0 180.0 0.0
  endcentreline
endsurvey
`;
      const cave = await makeImporter().getCave(textMap(['cave.th', th]));
      const shots = cave.surveys[0].shots;
      expect(shots[0].from).toBe('p_1_s');
      expect(shots[0].to).toBe('p_2_s');
      expect(shots[1].from).toBe('p_2_s');
      expect(shots[1].to).toBe('p_3_s');
    });

    it('applies prefix only when suffix is -', async () => {
      const th = `
survey cave
  centreline
    station-names pre_ -
    data normal from to length compass clino
    1 2 5.0 90.0 0.0
  endcentreline
endsurvey
`;
      const cave = await makeImporter().getCave(textMap(['cave.th', th]));
      expect(cave.surveys[0].shots[0].from).toBe('pre_1');
      expect(cave.surveys[0].shots[0].to).toBe('pre_2');
    });

    it('applies suffix only when prefix is -', async () => {
      const th = `
survey cave
  centreline
    station-names - _end
    data normal from to length compass clino
    1 2 5.0 90.0 0.0
  endcentreline
endsurvey
`;
      const cave = await makeImporter().getCave(textMap(['cave.th', th]));
      expect(cave.surveys[0].shots[0].from).toBe('1_end');
      expect(cave.surveys[0].shots[0].to).toBe('2_end');
    });

    it('resets prefix/suffix with - -', async () => {
      const th = `
survey cave
  centreline
    station-names p_ _s
    data normal from to length compass clino
    1 2 5.0 90.0 0.0
    station-names - -
    2 3 3.0 180.0 0.0
  endcentreline
endsurvey
`;
      const cave = await makeImporter().getCave(textMap(['cave.th', th]));
      const shots = cave.surveys[0].shots;
      expect(shots[0].from).toBe('p_1_s');
      expect(shots[0].to).toBe('p_2_s');
      expect(shots[1].from).toBe('2');
      expect(shots[1].to).toBe('3');
    });

    it('applies prefix/suffix to fix station names', async () => {
      const th = `
survey cave
  centreline
    cs UTM34
    station-names p_ _s
    fix 0 650000 200000 350
    data normal from to length compass clino
    0 1 5.0 90.0 0.0
  endcentreline
endsurvey
`;
      const cave = await makeImporter().getCave(textMap(['cave.th', th]));
      expect(cave.geoData.coordinates[0].name).toBe('p_0_s');
    });
  });

  describe('survey-level keywords', () => {
    it('ignores "join" directives at survey level without error', async () => {
      const th = `
survey cave
  centreline
    data normal from to length compass clino
    1 2 5.0 0.0 0.0
  endcentreline
  join s1@cave s2@cave
endsurvey
`;
      const cave = await makeImporter().getCave(textMap(['cave.th', th]));
      expect(cave.surveys[0].shots).toHaveLength(1);
    });

    it('ignores "surface" block inside survey', async () => {
      const th = `
survey cave
  centreline
    data normal from to length compass clino
    1 2 5.0 0.0 0.0
  endcentreline
  surface
    cs EPSG:23700
    grid 0 0 10 10 2 2
    100 200
    300 400
  endsurface
endsurvey
`;
      const cave = await makeImporter().getCave(textMap(['cave.th', th]));
      expect(cave.surveys[0].shots).toHaveLength(1);
    });

    it('handles equate with three operands creating two aliases', async () => {
      const th = `
survey outer
  survey a
    centreline
      data normal from to length compass clino
      1 2 5.0 0.0 0.0
    endcentreline
  endsurvey a
  survey b
    centreline
      data normal from to length compass clino
      1 2 5.0 90.0 0.0
    endcentreline
  endsurvey b
  survey c
    centreline
      data normal from to length compass clino
      1 2 5.0 180.0 0.0
    endcentreline
  endsurvey c
  equate 2@a 1@b 1@c
endsurvey outer
`;
      const cave = await makeImporter().getCave(textMap(['outer.th', th]));
      expect(cave.surveys).toHaveLength(3);
      expect(cave.aliases).toHaveLength(2);
    });
  });

  describe('tab-separated data', () => {
    it('parses data rows separated by tabs', async () => {
      const th = 'survey cave\n\tcenterline\n\t\tdata normal from to length compass clino\n\t\t1\t2\t12.5\t180.0\t-5.0\n\tendcenterline\nendsurvey\n';
      const cave = await makeImporter().getCave(textMap(['cave.th', th]));
      const shot = cave.surveys[0].shots[0];
      expect(shot.length).toBeCloseTo(12.5);
      expect(shot.azimuth).toBeCloseTo(180.0);
      expect(shot.clino).toBeCloseTo(-5.0);
    });

    it('handles mixed tab and space indentation', async () => {
      const th = `
survey cave
\tcentreline
\t\tdata normal from to length compass clino
\t\t1 2 3.0 90.0 0.0
\tendcentreline
endsurvey
`;
      const cave = await makeImporter().getCave(textMap(['cave.th', th]));
      expect(cave.surveys[0].shots).toHaveLength(1);
    });
  });

  describe('input file filtering', () => {
    it('does not warn about .thm files in unresolved inputs', async () => {
      const { showInfoPanel } = await import('../../src/ui/popups.js');
      vi.clearAllMocks();
      const th = `
survey cave
  input style.thm
  centreline
    data normal from to length compass clino
    1 2 5.0 0.0 0.0
  endcentreline
endsurvey
`;
      await makeImporter().getCave(textMap(['cave.th', th]));
      const calls = showInfoPanel.mock.calls;
      const warnedAboutThm = calls.some(([msg]) => msg.includes('style.thm'));
      expect(warnedAboutThm).toBe(false);
    });

    it('does not warn about .th2 files in unresolved inputs', async () => {
      const { showInfoPanel } = await import('../../src/ui/popups.js');
      vi.clearAllMocks();
      const th = `
survey cave
  input drawing.th2
  centreline
    data normal from to length compass clino
    1 2 5.0 0.0 0.0
  endcentreline
endsurvey
`;
      await makeImporter().getCave(textMap(['cave.th', th]));
      const calls = showInfoPanel.mock.calls;
      const warnedAboutTh2 = calls.some(([msg]) => msg.includes('drawing.th2'));
      expect(warnedAboutTh2).toBe(false);
    });
  });

  // ─── station command ──────────────────────────────────────────────────────────

  describe('station command', () => {
    it('assigns comment to shot.comment for a non-start station', async () => {
      const th = `
survey cave
  centreline
    data normal from to length compass clino
    1 2 5.0 90.0 0.0
    2 3 3.0 180.0 0.0
    station 2 "Junction point"
  endcentreline
endsurvey
`;
      const cave = await makeImporter().getCave(textMap(['cave.th', th]));
      const shots = cave.surveys[0].shots;
      // comment goes on the shot departing FROM station 2
      const shot = shots.find((s) => s.from === '2');
      expect(shot?.comment).toBe('Junction point');
      expect(cave.stationComments).toHaveLength(0);
    });

    it('places start station comment in cave.stationComments', async () => {
      const th = `
survey cave
  centreline
    data normal from to length compass clino
    1 2 5.0 90.0 0.0
    station 1 "Entrance"
  endcentreline
endsurvey
`;
      const cave = await makeImporter().getCave(textMap(['cave.th', th]));
      expect(cave.stationComments).toHaveLength(1);
      expect(cave.stationComments[0].name).toBe('1');
      expect(cave.stationComments[0].comment).toBe('Entrance');
      const shots = cave.surveys[0].shots;
      expect(shots[0].comment).toBeUndefined();
    });

    it('places second comment for same station in cave.stationComments', async () => {
      const th = `
survey cave
  centreline
    data normal from to length compass clino
    1 2 5.0 90.0 0.0
    2 3 3.0 180.0 0.0
    station 2 "First comment"
    station 2 "Second comment"
  endcentreline
endsurvey
`;
      const cave = await makeImporter().getCave(textMap(['cave.th', th]));
      const shots = cave.surveys[0].shots;
      // first comment → shot departing FROM station 2
      const shot = shots.find((s) => s.from === '2');
      expect(shot?.comment).toBe('First comment');
      expect(cave.stationComments).toHaveLength(1);
      expect(cave.stationComments[0].name).toBe('2');
      expect(cave.stationComments[0].comment).toBe('Second comment');
    });

    it('places comment in cave.stationComments when no shot departs from that station', async () => {
      const th = `
survey cave
  centreline
    data normal from to length compass clino
    1 2 5.0 90.0 0.0
    station 2 "Terminal point" continuation
  endcentreline
endsurvey
`;
      // station 2 is only a `to` station; no shot departs from it → falls back to cave.stationComments
      const cave = await makeImporter().getCave(textMap(['cave.th', th]));
      expect(cave.stationComments).toHaveLength(1);
      expect(cave.stationComments[0].name).toBe('2');
      expect(cave.stationComments[0].comment).toBe('Terminal point');
    });

    it('places comment for station with no matching shot in cave.stationComments', async () => {
      const th = `
survey cave
  centreline
    data normal from to length compass clino
    1 2 5.0 90.0 0.0
    station 99 "Orphan station"
  endcentreline
endsurvey
`;
      const cave = await makeImporter().getCave(textMap(['cave.th', th]));
      expect(cave.stationComments).toHaveLength(1);
      expect(cave.stationComments[0].name).toBe('99');
      expect(cave.stationComments[0].comment).toBe('Orphan station');
    });

    it('handles multiple stations with comments', async () => {
      const th = `
survey cave
  centreline
    data normal from to length compass clino
    1 2 5.0 90.0 0.0
    2 3 3.0 180.0 0.0
    station 2 "Middle"
    station 3 "End"
  endcentreline
endsurvey
`;
      const cave = await makeImporter().getCave(textMap(['cave.th', th]));
      const shots = cave.surveys[0].shots;
      // station 2 comment → shot departing from 2 (shot 2→3)
      const shot2 = shots.find((s) => s.from === '2');
      expect(shot2?.comment).toBe('Middle');
      // station 3 has no departing shot → cave.stationComments
      expect(cave.stationComments).toHaveLength(1);
      expect(cave.stationComments[0].name).toBe('3');
      expect(cave.stationComments[0].comment).toBe('End');
    });
  });

  // ─── declination command ──────────────────────────────────────────────────────

  describe('declination command', () => {
    it('parses declination in degrees (no unit)', async () => {
      const th = `
survey cave
  centreline
    declination 3.5
    data normal from to length compass clino
    1 2 5.0 90.0 0.0
  endcentreline
endsurvey
`;
      const cave = await makeImporter().getCave(textMap(['cave.th', th]));
      expect(cave.surveys[0].metadata.declination).toBeCloseTo(3.5);
    });

    it('parses declination in degrees (explicit unit)', async () => {
      const th = `
survey cave
  centreline
    declination 3.5 degrees
    data normal from to length compass clino
    1 2 5.0 90.0 0.0
  endcentreline
endsurvey
`;
      const cave = await makeImporter().getCave(textMap(['cave.th', th]));
      expect(cave.surveys[0].metadata.declination).toBeCloseTo(3.5);
    });

    it('parses declination in grads', async () => {
      const th = `
survey cave
  centreline
    declination 4.0 grads
    data normal from to length compass clino
    1 2 5.0 90.0 0.0
  endcentreline
endsurvey
`;
      const cave = await makeImporter().getCave(textMap(['cave.th', th]));
      expect(cave.surveys[0].metadata.declination).toBeCloseTo(3.6);
    });

    it('parses declination in minutes', async () => {
      const th = `
survey cave
  centreline
    declination 210 minutes
    data normal from to length compass clino
    1 2 5.0 90.0 0.0
  endcentreline
endsurvey
`;
      const cave = await makeImporter().getCave(textMap(['cave.th', th]));
      expect(cave.surveys[0].metadata.declination).toBeCloseTo(3.5);
    });

    it('warns and skips centreline when declination appears after shots', async () => {
      const { showWarningPanel } = await import('../../src/ui/popups.js');
      vi.clearAllMocks();
      const th = `
survey cave
  centreline
    data normal from to length compass clino
    1 2 5.0 90.0 0.0
    declination 3.5
  endcentreline
endsurvey
`;
      await expect(makeImporter().getCave(textMap(['cave.th', th]))).rejects.toThrow();
      const warned = showWarningPanel.mock.calls.some(([msg]) =>
        msg.includes('errors.import.therionDeclinationAfterShots')
      );
      expect(warned).toBe(true);
    });

    it('does not warn when declination appears before shots', async () => {
      const { showWarningPanel } = await import('../../src/ui/popups.js');
      vi.clearAllMocks();
      const th = `
survey cave
  centreline
    declination 3.5
    data normal from to length compass clino
    1 2 5.0 90.0 0.0
  endcentreline
endsurvey
`;
      await makeImporter().getCave(textMap(['cave.th', th]));
      const warned = showWarningPanel.mock.calls.some(([msg]) =>
        msg.includes('errors.import.therionDeclinationAfterShots')
      );
      expect(warned).toBe(false);
    });
  });

  describe('master file chooser (directory / multi-file import)', () => {
    // Two genuinely independent masters, each `input`-ing its own pair of sub-caves.
    const acave = (n) =>
      `survey acave${n}\n  centreline\n    data normal from to length compass clino\n    1 2 1${n} 90 0\n  endcentreline\nendsurvey\n`;
    const bcave = (n) =>
      `survey bcave${n}\n  centreline\n    data normal from to length compass clino\n    1 2 1${n} 90 0\n  endcentreline\nendsurvey\n`;
    const twoMasterMap = () =>
      textMap(
        ['A.th', `input a1\ninput a2\n`],
        ['B.th', `input b1\ninput b2\n`],
        ['a1.th', acave(1)],
        ['a2.th', acave(2)],
        ['b1.th', bcave(1)],
        ['b2.th', bcave(2)]
      );

    it('findRootFiles returns multiple ranked candidates for two unconnected masters', () => {
      const cands = findRootFiles(twoMasterMap(), THERION_OPTS);
      const keys = cands.map((c) => c.key).sort();
      expect(keys).toEqual(['A.th', 'B.th']);
      expect(cands.every((c) => c.fileCount === 2)).toBe(true);
    });

    it('findRootFiles returns a single candidate for a normal single-master map', () => {
      const map = textMap(['main.th', `input sub\n`], ['sub.th', acave(1)]);
      const cands = findRootFiles(map, THERION_OPTS);
      expect(cands.map((c) => c.key)).toEqual(['main.th']);
    });

    it('getCaves(textMap, root) imports only the chosen master\'s input tree', async () => {
      const caves = await makeImporter().getCaves(twoMasterMap(), 'A.th');
      const names = caves.map((c) => c.name).sort();
      expect(names).toEqual(['acave1', 'acave2']);
      expect(caves.some((c) => c.name.startsWith('b'))).toBe(false);
    });

    it('chooseRootImports returns the single key without a dialog when unambiguous', async () => {
      const map = textMap(['main.th', `input sub\n`], ['sub.th', acave(1)]);
      const dialog = { show: vi.fn() };
      const roots = await chooseRootImports(map, THERION_OPTS, dialog);
      expect(roots).toEqual(['main.th']);
      expect(dialog.show).not.toHaveBeenCalled();
    });

    it('chooseRootImports shows the dialog and returns the chosen keys when ambiguous', async () => {
      const dialog = { show: vi.fn(async () => ['A.th']) };
      const roots = await chooseRootImports(twoMasterMap(), THERION_OPTS, dialog);
      expect(dialog.show).toHaveBeenCalledOnce();
      expect(roots).toEqual(['A.th']);
    });

    it('importFiles imports only the dialog-selected master; nothing on cancel', async () => {
      vi.stubGlobal('FileReader', FakeFileReader);
      try {
        const importer = makeImporter();
        importer.rootFileDialog = { show: async () => ['A.th'] };
        const loaded = [];
        await importer.importFiles(blobMap(twoMasterMap()), (cave) => loaded.push(cave));
        expect(loaded.map((c) => c.name).sort()).toEqual(['acave1', 'acave2']);

        const cancelImporter = makeImporter();
        cancelImporter.rootFileDialog = { show: async () => null };
        const cancelled = [];
        await cancelImporter.importFiles(blobMap(twoMasterMap()), (cave) => cancelled.push(cave));
        expect(cancelled).toEqual([]);
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });
});

// Minimal FileReader polyfill (node test env has none) — backs importFiles' detectEncoding /
// readFileAsText, which read Blob contents as text. Encoding is ignored (ASCII test data).
class FakeFileReader {
  readAsText(blob) {
    Promise.resolve(blob.text()).then(
      (text) => this.onload?.({ target: { result: text } }),
      (err) => this.onerror?.(err)
    );
  }
}

// Turn a Map<name, text> into the Map<name, Blob> shape importFiles expects.
function blobMap(map) {
  const out = new Map();
  for (const [name, text] of map) out.set(name, new Blob([text]));
  return out;
}
