import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

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
