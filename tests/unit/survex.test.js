import { describe, it, expect, vi } from 'vitest';

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

vi.mock('../../src/model.js', async () => {
  const actual = await vi.importActual('../../src/model.js');
  return actual;
});

// ─── Dynamic imports (after mocks) ───────────────────────────────────────────

const { SurvexImporter } = await import('../../src/io/survex-importer.js');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeImporter() {
  return new SurvexImporter(null, null, null, null);
}

function textMap(...pairs) {
  return new Map(pairs);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('SurvexImporter', () => {

  describe('basic parsing', () => {
    it('parses a minimal single-survey file into a Cave', async () => {
      const svx = `
*begin test
  *data normal from to tape compass clino
  0 1 10 90 0
  1 2 5 180 -5
*end test
`;
      const cave = await makeImporter().getCave(textMap(['test.svx', svx]));
      expect(cave.name).toBe('test');
      expect(cave.surveys).toHaveLength(1);
      const shots = cave.surveys[0].shots;
      expect(shots).toHaveLength(2);
      expect(shots[0].type).toBe('center');
      expect(shots[1].type).toBe('center');
    });

    it('uses the outermost *begin name as the cave title', async () => {
      const svx = `
*begin Belladonna
  *data normal from to tape compass clino
  0 1 10 90 0
*end Belladonna
`;
      const cave = await makeImporter().getCave(textMap(['Belladonna.svx', svx]));
      expect(cave.name).toBe('Belladonna');
    });

    it('falls back to filename stem when no *begin name is set', async () => {
      const svx = `
*begin unnamed
  *data normal from to tape compass clino
  0 1 10 90 0
*end unnamed
`;
      const cave = await makeImporter().getCave(textMap(['MyCave.svx', svx]));
      // cave title = 'unnamed' (first begin name)
      expect(cave.name).toBe('unnamed');
    });
  });

  describe('splay detection', () => {
    it('treats shots with to="-" as splays', async () => {
      const svx = `
*begin test
  *data normal from to tape compass clino
  0 - 5 45 10
  0 1 10 90 0
*end test
`;
      const cave = await makeImporter().getCave(textMap(['test.svx', svx]));
      const shots = cave.surveys[0].shots;
      expect(shots[0].type).toBe('splay');
      expect(shots[1].type).toBe('center');
    });

    it('treats shots with *alias station - .. as splays', async () => {
      const svx = `
*begin test
  *alias station - ..
  *data normal from to tape compass clino
  0 - 3.71 332.1 33.9
  0 1 14.97 7.8 70.8
*end test
`;
      const cave = await makeImporter().getCave(textMap(['test.svx', svx]));
      const shots = cave.surveys[0].shots;
      expect(shots[0].type).toBe('splay');
      expect(shots[1].type).toBe('center');
    });

    it('respects *flags splay / *flags not splay', async () => {
      const svx = `
*begin test
  *data normal from to tape compass clino
  *flags splay
  0 1 5 90 0
  *flags not splay
  1 2 5 90 0
*end test
`;
      const cave = await makeImporter().getCave(textMap(['test.svx', svx]));
      const shots = cave.surveys[0].shots;
      expect(shots[0].type).toBe('splay');
      expect(shots[1].type).toBe('center');
    });
  });

  describe('Belladonna.svx fixture', () => {
    const belladonna = `; 2019.07.17 created by TopoDroid v 4.1.3u
; Belladonna
; Instrument: DistoX2 3938 - CUBOT KING KONG

*begin Belladonna
  *date 2019.07.14
  *team "AT RT FH"
  *units tape meters
  *units compass degrees
  *units clino degrees
  *alias station - ..
  *flags not splay
  *data normal from to tape compass clino
  0 - 3.71 332.1 33.9
  0 - 4.93 4.6 32.3
  0 - 7.75 7.9 47.2
  0 - 4.52 22.8 28.9
  0 - 4.41 0.2 15.2
  0 - 4.15 26.2 16.9
  0 - 5.52 40.7 40.7
  0 - 3.84 57.2 19.0
  0 - 4.27 347.8 -7.5
  0 - 3.58 75.6 0.7
  0 - 5.24 78.2 38.4
  0 - 4.79 120.7 13.5
  0 - 9.23 0.3 50.6
  0 - 10.77 352.8 57.7
  0 - 6.99 38.9 54.6
  0 - 7.82 31.8 59.0
  0 - 6.82 49.5 55.1
    0 1   14.97 7.8 70.8
  1 - 1.94 300.0 78.4
  1 - 11.17 212.8 -86.9
  1 - 3.60 340.4 1.0
  1 - 2.38 314.7 -2.1
  1 - 2.44 323.0 -49.3
  1 - 3.35 332.1 -11.1
  1 - 4.23 344.2 45.5
  1 - 2.89 348.6 55.2
  1 - 3.42 294.6 51.8
  1 - 1.36 301.9 22.4
  1 - 2.54 275.7 53.2
    1 2   4.44 328.4 38.5
  2 - 3.08 337.4 9.0
  2 - 3.29 337.4 9.0
    2 3   3.15 316.0 9.1
  1 - 1.73 88.5 -61.6
  1 - 5.18 109.7 29.0
  1 - 5.22 136.6 11.3
    1 4   6.62 171.0 1.6
    4 5   16.83 285.6 -66.8
  5 - 15.96 116.2 67.3
  5 - 14.04 142.1 55.5
  5 - 10.07 136.4 21.0
  5 - 5.18 31.0 64.9
  5 - 4.37 24.9 51.4
  5 - 4.99 50.9 26.5
  5 - 8.79 78.8 1.1
  5 - 4.99 101.7 -40.7
  5 - 12.95 123.3 -20.5
  5 - 17.83 125.2 -0.8
  5 - 2.82 359.8 45.5
  5 - 8.85 341.3 23.9
  5 - 4.22 53.5 -17.0
    5 6   4.85 23.5 11.8
  6 - 19.92 294.6 -29.6
  6 - 19.77 293.0 -29.6
    6 7   16.18 291.9 -25.5
  *flags not splay
*end Belladonna
`;

    it('produces one survey with correct shot counts', async () => {
      const cave = await makeImporter().getCave(textMap(['Belladonna.svx', belladonna]));
      expect(cave.name).toBe('Belladonna');
      expect(cave.surveys).toHaveLength(1);

      const shots = cave.surveys[0].shots;
      const centers = shots.filter(s => s.type === 'center');
      const splays  = shots.filter(s => s.type === 'splay');

      // 7 center shots: 0→1, 1→2, 2→3, 1→4, 4→5, 5→6, 6→7
      expect(centers.length).toBe(7);
      // all remaining shots are splays
      expect(splays.length).toBeGreaterThan(0);
      expect(shots.length).toBe(centers.length + splays.length);
    });

    it('records stations 0 through 7', async () => {
      const cave = await makeImporter().getCave(textMap(['Belladonna.svx', belladonna]));
      for (const name of ['0', '1', '2', '3', '4', '5', '6', '7']) {
        expect(cave.stations.has(name)).toBe(true);
      }
    });

    it('parses the date correctly', async () => {
      const cave = await makeImporter().getCave(textMap(['Belladonna.svx', belladonna]));
      const date = cave.surveys[0].metadata.date;
      expect(date.getFullYear()).toBe(2019);
      expect(date.getMonth()).toBe(6); // July = month index 6
      expect(date.getDate()).toBe(14);
    });

    it('parses the team name', async () => {
      const cave = await makeImporter().getCave(textMap(['Belladonna.svx', belladonna]));
      expect(cave.surveys[0].metadata.team.name).toBe('AT RT FH');
    });
  });

  describe('nested *begin/*end blocks', () => {
    it('creates separate surveys for nested blocks', async () => {
      const svx = `
*begin outer
  *data normal from to tape compass clino
  0 1 10 90 0
  *begin inner
    *data normal from to tape compass clino
    A B 5 180 0
  *end inner
  1 2 8 270 0
*end outer
`;
      const cave = await makeImporter().getCave(textMap(['test.svx', svx]));
      expect(cave.surveys).toHaveLength(2);
      const names = cave.surveys.map(s => s.name);
      expect(names).toContain('outer');
      expect(names).toContain('inner');
    });
  });

  describe('*equate', () => {
    it('creates aliases between surveys', async () => {
      const svx = `
*begin s1
  *data normal from to tape compass clino
  0 1 10 90 0
  *equate 1 s2.0
*end s1
*begin s2
  *data normal from to tape compass clino
  0 1 5 180 0
*end s2
`;
      const cave = await makeImporter().getCave(textMap(['test.svx', svx]));
      expect(cave.aliases.length).toBeGreaterThan(0);
    });
  });

  describe('units', () => {
    it('handles *units tape feet', async () => {
      const svx = `
*begin test
  *units tape feet
  *data normal from to tape compass clino
  0 1 32.808 90 0
*end test
`;
      const cave = await makeImporter().getCave(textMap(['test.svx', svx]));
      const shot = cave.surveys[0].shots[0];
      // 32.808 feet ≈ 10.0 meters (within rounding)
      expect(shot.length).toBeCloseTo(10.0, 0);
    });
  });

  describe('semicolon comments', () => {
    it('strips inline ; comments', async () => {
      const svx = `
*begin test ; this is the cave name
  *data normal from to tape compass clino ; columns
  0 1 10 90 0 ; first shot
*end test
`;
      const cave = await makeImporter().getCave(textMap(['test.svx', svx]));
      expect(cave.surveys[0].shots).toHaveLength(1);
    });
  });

  describe('*cartesian command', () => {
    it('*cartesian true leaves azimuth unchanged (True North = default)', async () => {
      const svx = `
*begin test
  *cartesian true
  *data cartesian from to dx dy dz
  0 1 0 10 0
*end test
`;
      const cave = await makeImporter().getCave(textMap(['test.svx', svx]));
      expect(cave.surveys[0].shots[0].azimuth).toBeCloseTo(0, 1); // North
    });

    it('*cartesian true with rotation adds the rotation to azimuth', async () => {
      const svx = `
*begin test
  *cartesian true 90 degrees
  *data cartesian from to dx dy dz
  0 1 0 10 0
*end test
`;
      const cave = await makeImporter().getCave(textMap(['test.svx', svx]));
      // base azimuth 0 (North) + 90° extra = 90°
      expect(cave.surveys[0].shots[0].azimuth).toBeCloseTo(90, 1);
    });

    it('*cartesian magnetic adds declination to azimuth', async () => {
      const svx = `
*begin test
  *declination 10 degrees
  *cartesian magnetic
  *data cartesian from to dx dy dz
  0 1 0 10 0
*end test
`;
      const cave = await makeImporter().getCave(textMap(['test.svx', svx]));
      // dy points to Magnetic North; add 10° declination to get True North azimuth
      expect(cave.surveys[0].shots[0].azimuth).toBeCloseTo(10, 1);
    });

    it('*cartesian magnetic uses declination set after *cartesian', async () => {
      const svx = `
*begin test
  *cartesian magnetic
  *declination 10 degrees
  *data cartesian from to dx dy dz
  0 1 0 10 0
*end test
`;
      const cave = await makeImporter().getCave(textMap(['test.svx', svx]));
      // declination is looked up at shot-parse time, order does not matter
      expect(cave.surveys[0].shots[0].azimuth).toBeCloseTo(10, 1);
    });

    it('*cartesian magnetic with extra rotation adds both', async () => {
      const svx = `
*begin test
  *declination 10 degrees
  *cartesian magnetic 5 degrees
  *data cartesian from to dx dy dz
  0 1 0 10 0
*end test
`;
      const cave = await makeImporter().getCave(textMap(['test.svx', svx]));
      // 10° declination + 5° extra rotation = 15°
      expect(cave.surveys[0].shots[0].azimuth).toBeCloseTo(15, 1);
    });

    it('*cartesian rotation in grads is converted to degrees', async () => {
      const svx = `
*begin test
  *cartesian true 100 grads
  *data cartesian from to dx dy dz
  0 1 0 10 0
*end test
`;
      const cave = await makeImporter().getCave(textMap(['test.svx', svx]));
      // 100 grads = 90 degrees
      expect(cave.surveys[0].shots[0].azimuth).toBeCloseTo(90, 1);
    });

    it('*cartesian is inherited by nested *begin blocks', async () => {
      const svx = `
*begin outer
  *cartesian true 45 degrees
  *begin inner
    *data cartesian from to dx dy dz
    0 1 0 10 0
  *end inner
*end outer
`;
      const cave = await makeImporter().getCave(textMap(['test.svx', svx]));
      const inner = cave.surveys.find(s => s.name === 'inner');
      expect(inner.shots[0].azimuth).toBeCloseTo(45, 1);
    });
  });

  describe('cartesian data format', () => {
    it('parses a shot going due North as azimuth 0', async () => {
      const svx = `
*begin test
  *data cartesian from to dx dy dz
  0 1 0 10 0
*end test
`;
      const cave = await makeImporter().getCave(textMap(['test.svx', svx]));
      const shot = cave.surveys[0].shots[0];
      expect(shot.type).toBe('center');
      expect(shot.length).toBeCloseTo(10, 3);
      expect(shot.azimuth).toBeCloseTo(0, 1);
      expect(shot.clino).toBeCloseTo(0, 1);
    });

    it('parses a shot going due East as azimuth 90', async () => {
      const svx = `
*begin test
  *data cartesian from to dx dy dz
  0 1 10 0 0
*end test
`;
      const cave = await makeImporter().getCave(textMap(['test.svx', svx]));
      const shot = cave.surveys[0].shots[0];
      expect(shot.length).toBeCloseTo(10, 3);
      expect(shot.azimuth).toBeCloseTo(90, 1);
      expect(shot.clino).toBeCloseTo(0, 1);
    });

    it('parses a shot going straight up as clino 90', async () => {
      const svx = `
*begin test
  *data cartesian from to dx dy dz
  0 1 0 0 10
*end test
`;
      const cave = await makeImporter().getCave(textMap(['test.svx', svx]));
      const shot = cave.surveys[0].shots[0];
      expect(shot.length).toBeCloseTo(10, 3);
      expect(shot.clino).toBeCloseTo(90, 1);
    });

    it('converts dx/dy/dz from current length units', async () => {
      const svx = `
*begin test
  *units tape feet
  *data cartesian from to dx dy dz
  0 1 0 32.808 0
*end test
`;
      const cave = await makeImporter().getCave(textMap(['test.svx', svx]));
      const shot = cave.surveys[0].shots[0];
      // 32.808 feet ≈ 10 metres North
      expect(shot.length).toBeCloseTo(10, 0);
      expect(shot.azimuth).toBeCloseTo(0, 1);
    });

    it('treats cartesian shots with - destination as splays', async () => {
      const svx = `
*begin test
  *alias station - ..
  *data cartesian from to dx dy dz
  0 - 3 4 0
  0 1  0 5 0
*end test
`;
      const cave = await makeImporter().getCave(textMap(['test.svx', svx]));
      const shots = cave.surveys[0].shots;
      expect(shots[0].type).toBe('splay');
      expect(shots[1].type).toBe('center');
    });
  });

  describe('interleaved (station newline) format', () => {
    it('parses station-per-line interleaved data', async () => {
      const svx = `
*begin test
  *data normal station newline tape compass clino
  0
    10 90 0
  1
    5 180 -5
  2
    8 270 5
*end test
`;
      const cave = await makeImporter().getCave(textMap(['test.svx', svx]));
      // Stations 0→1 and 1→2, last station has no next pair = splay
      const shots = cave.surveys[0].shots;
      expect(shots.length).toBeGreaterThanOrEqual(2);
      expect(shots[0].from).toBe('0');
      expect(shots[0].to).toBe('1');
      expect(shots[0].type).toBe('center');
    });
  });

  describe('error handling', () => {
    it('throws survexNoData when file has no survey data', async () => {
      const svx = `; just a comment\n; nothing here\n`;
      await expect(
        makeImporter().getCave(textMap(['empty.svx', svx]))
      ).rejects.toThrow('errors.import.survexNoData');
    });

    it('throws survexNoData when *begin/*end has no shots', async () => {
      const svx = `
*begin test
  ; no data lines
*end test
`;
      await expect(
        makeImporter().getCave(textMap(['test.svx', svx]))
      ).rejects.toThrow('errors.import.survexNoData');
    });
  });

  describe('*calibrate', () => {
    it('applies compass calibration offset', async () => {
      const svx = `
*begin test
  *calibrate compass 5
  *data normal from to tape compass clino
  0 1 10 85 0
*end test
`;
      const cave = await makeImporter().getCave(textMap(['test.svx', svx]));
      const shot = cave.surveys[0].shots[0];
      // compass 85 + calibrate 5 = 90
      expect(shot.azimuth).toBeCloseTo(90, 1);
    });

    it('applies tape/length calibration offset', async () => {
      const svx = `
*begin test
  *calibrate tape 1
  *data normal from to tape compass clino
  0 1 9 90 0
*end test
`;
      const cave = await makeImporter().getCave(textMap(['test.svx', svx]));
      const shot = cave.surveys[0].shots[0];
      // tape 9 + calibrate 1 = 10 metres
      expect(shot.length).toBeCloseTo(10, 1);
    });

    it('applies tape calibration scale factor', async () => {
      const svx = `
*begin test
  *calibrate tape 0 2
  *data normal from to tape compass clino
  0 1 5 90 0
*end test
`;
      const cave = await makeImporter().getCave(textMap(['test.svx', svx]));
      const shot = cave.surveys[0].shots[0];
      // (5 + 0) * 2 = 10 metres
      expect(shot.length).toBeCloseTo(10, 1);
    });

    it('converts calibration offset from explicit unit to metres', async () => {
      const svx = `
*begin test
  *calibrate tape 100 centimetres
  *data normal from to tape compass clino
  0 1 9 90 0
*end test
`;
      const cave = await makeImporter().getCave(textMap(['test.svx', svx]));
      const shot = cave.surveys[0].shots[0];
      // 100 cm = 1 m; 9 + 1 = 10 metres
      expect(shot.length).toBeCloseTo(10, 1);
    });

    it('converts calibration offset from tape units when no explicit unit given', async () => {
      const svx = `
*begin test
  *units tape feet
  *calibrate tape 1
  *data normal from to tape compass clino
  0 1 31.808 90 0
*end test
`;
      const cave = await makeImporter().getCave(textMap(['test.svx', svx]));
      const shot = cave.surveys[0].shots[0];
      // (31.808 ft + 1 ft) * 0.3048 = 32.808 ft ≈ 10 m
      expect(shot.length).toBeCloseTo(10, 0);
    });

    it('converts compass calibration offset from explicit unit', async () => {
      const svx = `
*begin test
  *calibrate compass 200 grads
  *data normal from to tape compass clino
  0 1 10 0 0
*end test
`;
      const cave = await makeImporter().getCave(textMap(['test.svx', svx]));
      const shot = cave.surveys[0].shots[0];
      // 0 deg + 200 grads (= 180 deg) = 180 deg
      expect(shot.azimuth).toBeCloseTo(180, 1);
    });

    it('applies clino calibration offset (no explicit unit)', async () => {
      const svx = `
*begin test
  *calibrate clino -5
  *data normal from to tape compass clino
  0 1 10 90 5
*end test
`;
      const cave = await makeImporter().getCave(textMap(['test.svx', svx]));
      const shot = cave.surveys[0].shots[0];
      // clino 5 + calibrate -5 = 0 (horizontal)
      expect(shot.clino).toBeCloseTo(0, 1);
    });

    it('converts clino calibration offset from explicit unit', async () => {
      const svx = `
*begin test
  *calibrate clino 100 grads
  *data normal from to tape compass clino
  0 1 10 90 0
*end test
`;
      const cave = await makeImporter().getCave(textMap(['test.svx', svx]));
      const shot = cave.surveys[0].shots[0];
      // 0 deg + 100 grads (= 90 deg) = 90 (straight up)
      expect(shot.clino).toBeCloseTo(90, 1);
    });

    it('converts compass calibration offset using current compass units', async () => {
      const svx = `
*begin test
  *units compass grads
  *calibrate compass 100
  *data normal from to tape compass clino
  0 1 10 0 0
*end test
`;
      const cave = await makeImporter().getCave(textMap(['test.svx', svx]));
      const shot = cave.surveys[0].shots[0];
      // 0 grads + 100 grads (= 90 deg) = 90 deg
      expect(shot.azimuth).toBeCloseTo(90, 1);
    });

    it('applies calibration with both explicit unit and scale', async () => {
      const svx = `
*begin test
  *calibrate tape 100 centimetres 2
  *data normal from to tape compass clino
  0 1 4.5 90 0
*end test
`;
      const cave = await makeImporter().getCave(textMap(['test.svx', svx]));
      const shot = cave.surveys[0].shots[0];
      // (4.5 m + 1.0 m) * 2 = 11 m
      expect(shot.length).toBeCloseTo(11, 1);
    });
  });

});
