import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

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

const { TherionImporter } = await import('../../src/io/therion-importer.js');
const { SurvexImporter }  = await import('../../src/io/survex-importer.js');

function makeTh() { return new TherionImporter(null, null, null, null); }
function makeSv() { return new SurvexImporter(null, null, null, null); }

describe('LRUD parsing smoke', () => {
  it('Therion: single-line data with LRUD populates cave.stationDimensions', async () => {
    const th = `
survey test -title "Test"
  centreline
    data normal from to length compass clino left right up down
    1 2 10.0 135.0 -15.0 1.0 1.5 2.0 0.5
    2 3  8.0  90.0   0.0 0.8 0.9 2.5 1.0
    3 4  5.0   0.0   0.0 -   -   -   -
  endcentreline
endsurvey test
`;
    const cave = await makeTh().getCave(new Map([['t.th', th]]));
    expect(cave).toBeTruthy();
    const dims = cave.stationDimensions;
    expect(dims.length).toBe(2);
    const d1 = dims.find((d) => d.name === '1');
    const d2 = dims.find((d) => d.name === '2');
    expect(d1).toMatchObject({ left: 1.0, right: 1.5, up: 2.0, down: 0.5 });
    expect(d2).toMatchObject({ left: 0.8, right: 0.9, up: 2.5, down: 1.0 });
    // station 3 had all-dashes — no record
    expect(dims.find((d) => d.name === '3')).toBeUndefined();
  });

  it('Therion: drops negative values', async () => {
    const th = `
survey neg
  centreline
    data normal from to length compass clino left right up down
    1 2 10.0 135.0 -15.0 1.0 -1.0 2.0 -1.0
  endcentreline
endsurvey neg
`;
    const cave = await makeTh().getCave(new Map([['n.th', th]]));
    const d = cave.stationDimensions.find((sd) => sd.name === '1');
    expect(d.left).toBe(1.0);
    expect(d.right).toBeUndefined();
    expect(d.up).toBe(2.0);
    expect(d.down).toBeUndefined();
  });

  it('Survex: *data normal with LRUD populates cave.stationDimensions', async () => {
    const sv = `
*begin sx
*data normal from to tape compass clino left right up down
1 2 10.0 135.0 -15.0 1.2 1.4 2.1 0.4
2 3  8.0  90.0   0.0 0.6 0.7 2.3 0.9
*end sx
`;
    const cave = await makeSv().getCave(new Map([['s.svx', sv]]));
    expect(cave).toBeTruthy();
    const d1 = cave.stationDimensions.find((sd) => sd.name === '1');
    expect(d1).toMatchObject({ left: 1.2, right: 1.4, up: 2.1, down: 0.4 });
  });

  it('Therion: data dimensions populates cave.stationDimensions per station', async () => {
    const th = `
survey dim
  centreline
    data normal from to length compass clino
    0 1 1.37 92.0 1.4
    1 2 0.68 150.1 64.6

    units left right up down meter
    data dimensions station left right up down
    0 0.17 0.35 3.00 4.00
    1 0.07 0.36 0.35 0.29
    2 1.20 0.38 1.45 0.00
  endcentreline
endsurvey dim
`;
    const cave = await makeTh().getCave(new Map([['d.th', th]]));
    expect(cave).toBeTruthy();
    const dims = cave.stationDimensions;

    const d0 = dims.find((d) => d.name === '0');
    expect(d0).toMatchObject({ left: 0.17, right: 0.35, up: 3.00, down: 4.00 });

    const d1 = dims.find((d) => d.name === '1');
    expect(d1).toMatchObject({ left: 0.07, right: 0.36, up: 0.35, down: 0.29 });

    // Station 2: down=0.00 dropped as missing
    const d2 = dims.find((d) => d.name === '2');
    expect(d2.left).toBeCloseTo(1.20, 4);
    expect(d2.right).toBeCloseTo(0.38, 4);
    expect(d2.up).toBeCloseTo(1.45, 4);
    expect(d2.down).toBeUndefined();
  });

  it('Therion: per-column units override applies to data dimensions', async () => {
    const th = `
survey du
  centreline
    data normal from to length compass clino
    0 1 1.0 0 0
    units left feet
    data dimensions station left right up down
    1 1.0 2.0 3.0 4.0
  endcentreline
endsurvey du
`;
    const cave = await makeTh().getCave(new Map([['du.th', th]]));
    const d1 = cave.stationDimensions.find((d) => d.name === '1');
    expect(d1.left).toBeCloseTo(1.0 * 0.3048, 4);  // feet → meters
    expect(d1.right).toBeCloseTo(2.0, 4);
    expect(d1.up).toBeCloseTo(3.0, 4);
    expect(d1.down).toBeCloseTo(4.0, 4);
  });

  it('Therion: data dimensions wins over inline data normal LRUD for the same station', async () => {
    const th = `
survey pp
  centreline
    data normal from to length compass clino left right up down
    1 2 10 0 0  9.0 9.0 9.0 9.0
    data dimensions station left right up down
    1  1.0 2.0 3.0 4.0
  endcentreline
endsurvey pp
`;
    const cave = await makeTh().getCave(new Map([['p.th', th]]));
    const d1 = cave.stationDimensions.find((d) => d.name === '1');
    expect(d1).toMatchObject({ left: 1.0, right: 2.0, up: 3.0, down: 4.0 });
  });

  it('Survex: *data passage populates cave.stationDimensions per station', async () => {
    const sv = `
*begin concorde
*data normal from to tape compass clino
1 2 14.33 0 90
2 3 18.05 0 90
3 4 20.58 0 90
4 5 13.81 0 90
6 5 2.70 192 -12

*data passage station left right up down
1   4.0 4.0 40.0  0.5
5   4.0 4.0 20.0  30.0
6   1.0 1.0 1.0  1.0
*end concorde
`;
    const cave = await makeSv().getCave(new Map([['c.svx', sv]]));
    expect(cave).toBeTruthy();
    const dims = cave.stationDimensions;
    expect(dims).toHaveLength(3);
    const d1 = dims.find((d) => d.name === '1');
    const d5 = dims.find((d) => d.name === '5');
    const d6 = dims.find((d) => d.name === '6');
    expect(d1).toMatchObject({ left: 4.0, right: 4.0, up: 40.0, down: 0.5 });
    expect(d5).toMatchObject({ left: 4.0, right: 4.0, up: 20.0, down: 30.0 });
    expect(d6).toMatchObject({ left: 1.0, right: 1.0, up: 1.0, down: 1.0 });
  });

  it('Survex: *data passage drops missing/non-positive values', async () => {
    const sv = `
*begin px
*data normal from to tape compass clino
1 2 10 0 0
*data passage station left right up down
1  2.0 -1.0 0  3.0
2  -   -   -  -
*end px
`;
    const cave = await makeSv().getCave(new Map([['p.svx', sv]]));
    const d1 = cave.stationDimensions.find((d) => d.name === '1');
    expect(d1.left).toBe(2.0);
    expect(d1.right).toBeUndefined();
    expect(d1.up).toBeUndefined();
    expect(d1.down).toBe(3.0);
    // station 2 had all-missing — no record
    expect(cave.stationDimensions.find((d) => d.name === '2')).toBeUndefined();
  });

  it('Survex: per-column *units overrides apply to *data passage values', async () => {
    // 0.07 feet ≈ 0.0213 meters, 1.20 feet ≈ 0.3658 meters — but only `left` is feet here
    const sv = `
*begin uu
*data normal from to tape compass clino
0 1 1.0 0 0
*units left feet
*units right meter
*units up meter
*units down meter
*data passage station left right up down
1  0.07 0.36 0.35 0.29
0  0.17 0.35 3.00 4.00
*end uu
`;
    const cave = await makeSv().getCave(new Map([['u.svx', sv]]));
    const d1 = cave.stationDimensions.find((d) => d.name === '1');
    expect(d1.left).toBeCloseTo(0.07 * 0.3048, 4);   // feet → meters
    expect(d1.right).toBeCloseTo(0.36, 4);            // meters unchanged
    expect(d1.up).toBeCloseTo(0.35, 4);
    expect(d1.down).toBeCloseTo(0.29, 4);
    const d0 = cave.stationDimensions.find((d) => d.name === '0');
    expect(d0.left).toBeCloseTo(0.17 * 0.3048, 4);
  });

  it('Survex: idokapu fixture — *units left feet before *data passage converts to meters', async () => {
    const sv = readFileSync(
      resolve(__dirname, '../fixtures/sample-passage-mixed-units.svx'),
      'utf-8'
    );
    const cave = await makeSv().getCave(new Map([['sample-passage-mixed-units.svx', sv]]));
    expect(cave).toBeTruthy();

    // Station 1: left=0.07 feet → ~0.02134 m; right/up/down already in meters
    const d1 = cave.stationDimensions.find((d) => d.name === '1');
    expect(d1).toBeTruthy();
    expect(d1.left).toBeCloseTo(0.07 * 0.3048, 4);
    expect(d1.right).toBeCloseTo(0.36, 4);
    expect(d1.up).toBeCloseTo(0.35, 4);
    expect(d1.down).toBeCloseTo(0.29, 4);

    // Station 2: down=0.00 dropped as missing; left=1.20 feet → ~0.36576 m
    const d2 = cave.stationDimensions.find((d) => d.name === '2');
    expect(d2.left).toBeCloseTo(1.20 * 0.3048, 4);
    expect(d2.right).toBeCloseTo(0.38, 4);
    expect(d2.up).toBeCloseTo(1.45, 4);
    expect(d2.down).toBeUndefined();

    // Station 0: regular conversion; up/down preserved
    const d0 = cave.stationDimensions.find((d) => d.name === '0');
    expect(d0.left).toBeCloseTo(0.17 * 0.3048, 4);
    expect(d0.up).toBeCloseTo(3.00, 4);
    expect(d0.down).toBeCloseTo(4.00, 4);

    // Station 10: all zeros — should produce no record at all
    expect(cave.stationDimensions.find((d) => d.name === '10')).toBeUndefined();
  });

  it('Survex: multi-quantity *units (left right up down feet) applies to all', async () => {
    const sv = `
*begin mu
*data normal from to tape compass clino
0 1 1.0 0 0
*units left right up down feet
*data passage station left right up down
1  1.0 2.0 3.0 4.0
*end mu
`;
    const cave = await makeSv().getCave(new Map([['m.svx', sv]]));
    const d1 = cave.stationDimensions.find((d) => d.name === '1');
    expect(d1.left).toBeCloseTo(1.0 * 0.3048, 4);
    expect(d1.right).toBeCloseTo(2.0 * 0.3048, 4);
    expect(d1.up).toBeCloseTo(3.0 * 0.3048, 4);
    expect(d1.down).toBeCloseTo(4.0 * 0.3048, 4);
  });

  it('Survex: *data passage takes precedence over shot-derived LRUD', async () => {
    const sv = `
*begin pp
*data normal from to tape compass clino left right up down
1 2 10 0 0  9.0 9.0 9.0 9.0
*data passage station left right up down
1  1.0 2.0 3.0 4.0
*end pp
`;
    const cave = await makeSv().getCave(new Map([['pp.svx', sv]]));
    const d1 = cave.stationDimensions.find((d) => d.name === '1');
    expect(d1).toMatchObject({ left: 1.0, right: 2.0, up: 3.0, down: 4.0 });
  });

  it('Cave round-trip: stationDimensions survive toExport/fromPure', async () => {
    const th = `
survey rt
  centreline
    data normal from to length compass clino left right up down
    1 2 10.0 135.0 -15.0 1.0 1.5 2.0 0.5
  endcentreline
endsurvey rt
`;
    const cave = await makeTh().getCave(new Map([['rt.th', th]]));
    const exported = cave.toExport();
    expect(exported.stationDimensions).toEqual([{ name: '1', left: 1, right: 1.5, up: 2, down: 0.5 }]);
    const { Cave } = await import('../../src/model/cave.js');
    const attributeDefs = { schemaVersion: 1 };
    const restored = Cave.fromPure(JSON.parse(JSON.stringify(exported)), attributeDefs);
    expect(restored.stationDimensions.length).toBe(1);
    expect(restored.stationDimensions[0].name).toBe('1');
    expect(restored.stationDimensions[0].left).toBe(1.0);
  });

  it('Cave.fromPure backward compat: missing stationDimensions defaults to []', async () => {
    const { Cave } = await import('../../src/model/cave.js');
    const pure = {
      name             : 'old-cave',
      surveys          : [],
      aliases          : [],
      attributes       : { stationAttributes: [], sectionAttributes: [], componentAttributes: [], schemaVersion: 1 },
      stationComments  : [],
      version          : 1,
      revision         : 1,
    };
    const cave = Cave.fromPure(pure, { schemaVersion: 1 });
    expect(cave.stationDimensions).toEqual([]);
  });
});
