import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks (must come before dynamic imports) ────────────────────────────────

vi.mock('../../src/i18n/i18n.js', () => ({
  i18n : { t: (key, params) => ({ key, params }) }
}));

const showWarningPanel = vi.fn();
vi.mock('../../src/ui/popups.js', () => ({
  showErrorPanel   : vi.fn(),
  showWarningPanel : (...args) => showWarningPanel(...args),
  showInfoPanel    : vi.fn()
}));

vi.mock('../../src/ui/coordinate-system-dialog.js', () => ({
  CoordinateSystemDialog : class { async show() { return {}; } }
}));

vi.mock('../../src/ui/encoding-selection-dialog.js', () => ({
  EncodingSelectionDialog : class { async show() { return { encoding: 'utf8' }; } }
}));

vi.mock('../../src/utils/global-coordinate-normalizer.js', () => ({
  globalNormalizer : {
    isInitialized          : () => false,
    initializeGlobalOrigin : vi.fn(),
    getNormalizedVector    : (c) => c
  }
}));

vi.mock('three', () => ({}));
vi.mock('three/addons/loaders/PLYLoader.js', () => ({ PLYLoader: class {} }));
vi.mock('three/addons/loaders/OBJLoader.js', () => ({ OBJLoader: class {} }));

// ─── Dynamic imports (after mocks) ───────────────────────────────────────────

const { DTMImporterBase } = await import('../../src/io/dtm-importer.js');
const {
  GeoData,
  StationWithCoordinate,
  UTMCoordinateSystem,
  EOVCoordinateSystem,
  UTMCoordinateWithElevation,
  EOVCoordinateWithElevation,
  CoordinateSystemType
} = await import('../../src/model/geo.js');

// ─── Fixtures modelled on the Montenegro report ──────────────────────────────
//
// Ketlyuku_Jeges.cave has its entrance fix point at UTM34 319509 / 4696310 /
// 1360 m. Part_Surface.xyz is a 69×60 grid at 20 m spacing whose SW corner is
// 319333 / 4698968 — i.e. correct UTM34, but cut ~2.7 km north of the cave.

const UTM34 = new UTMCoordinateSystem(34, true);

const caveAt = (cs, east, north, elevation = 1360) => ({
  name    : 'Ketlyuku_Jeges',
  geoData : new GeoData(cs, [
    new StationWithCoordinate(
      'entrance',
      cs.type === CoordinateSystemType.EOV
        ? new EOVCoordinateWithElevation(east, north, elevation)
        : new UTMCoordinateWithElevation(east, north, elevation)
    )
  ])
});

const makeImporter = (caves = [], cavesMaxDistance = 10000) =>
  new DTMImporterBase(
    { getAllCaves: () => caves, getAllModels: () => [] },
    { import: { cavesMaxDistance } },
    null,
    null
  );

// 69×60 grid at 20 m spacing → spans 1360 m east, 1180 m north.
const grid = { ncols: 69, nrows: 60, cellsizeX: 20, cellsizeY: 20 };

const projectedHeader = (xllcorner, yllcorner) => ({
  xllcorner,
  yllcorner,
  headerCRS : 'projected'
});

// Footprint centred on the cave, so the cave falls inside it.
const overlappingHeader = () => projectedHeader(319509 - 680, 4696310 - 590);

beforeEach(() => showWarningPanel.mockClear());

describe('DTMImporterBase.tryGeoreferenceFromHeader', () => {

  it('anchors the DTM at the header SW corner in the project CS', () => {
    const importer = makeImporter([caveAt(UTM34, 319509, 4696310)]);
    const model = { name: 'Part_Surface', modelKind: 'dtm' };

    expect(importer.tryGeoreferenceFromHeader(model, grid, overlappingHeader())).toBe(true);

    const coord = model.geoData.coordinates[0].coordinate;
    expect(model.geoData.coordinateSystem).toBe(UTM34);
    expect(coord.easting).toBe(319509 - 680);
    expect(coord.northing).toBe(4696310 - 590);
  });

  it('anchors at elevation 0 — vertex Z already carries absolute elevation', () => {
    // Regression: a non-zero anchor is added on top of the absolute vertex Z,
    // which floated the Montenegro terrain to 2217–2441 m instead of 857–1081.
    const importer = makeImporter([caveAt(UTM34, 319509, 4696310, 1360)]);
    const model = { name: 'Part_Surface', modelKind: 'dtm' };

    importer.tryGeoreferenceFromHeader(model, grid, overlappingHeader());

    expect(model.geoData.coordinates[0].coordinate.elevation).toBe(0);
  });

  it('places a same-CS tile that misses the cave, and warns about it', () => {
    // The real Part_Surface.xyz: right CS, wrong area — 2658 m north of the cave.
    const importer = makeImporter([caveAt(UTM34, 319509, 4696310)]);
    const model = { name: 'Part_Surface', modelKind: 'dtm' };

    expect(importer.tryGeoreferenceFromHeader(model, grid, projectedHeader(319333, 4698968))).toBe(true);
    expect(model.geoData.coordinates[0].coordinate.northing).toBe(4698968);

    expect(showWarningPanel).toHaveBeenCalledTimes(1);
    const { key, params } = showWarningPanel.mock.calls[0][0];
    expect(key).toBe('errors.import.dtmNoCaveOverlap');
    expect(params.name).toBe('Part_Surface');
    expect(params.distance).toBe(2658);
  });

  it('does not warn when a cave falls inside the footprint', () => {
    const importer = makeImporter([caveAt(UTM34, 319509, 4696310)]);
    const model = { name: 'Part_Surface', modelKind: 'dtm' };

    importer.tryGeoreferenceFromHeader(model, grid, overlappingHeader());

    expect(showWarningPanel).not.toHaveBeenCalled();
  });

  it('declines when the footprint lands beyond cavesMaxDistance (foreign CS)', () => {
    const importer = makeImporter([caveAt(UTM34, 319509, 4696310)]);
    const model = { name: 'Elsewhere', modelKind: 'dtm' };

    // EOV-looking numbers in a UTM project — hundreds of km away.
    expect(importer.tryGeoreferenceFromHeader(model, grid, projectedHeader(650000, 240000))).toBe(false);
    expect(model.geoData).toBeUndefined();
  });

  it('declines an HGT-style header, whose corner is lat/lon degrees', () => {
    const importer = makeImporter([caveAt(UTM34, 319509, 4696310)]);
    const model = { name: 'N42E019', modelKind: 'dtm' };

    expect(importer.tryGeoreferenceFromHeader(model, grid, { xllcorner: 19, yllcorner: 42 })).toBe(false);
    expect(model.geoData).toBeUndefined();
  });

  it('leaves an already-georeferenced model alone', () => {
    const importer = makeImporter([caveAt(UTM34, 319509, 4696310)]);
    const existing = new GeoData(UTM34, []);
    const model = { name: 'Part_Surface', modelKind: 'dtm', geoData: existing };

    expect(importer.tryGeoreferenceFromHeader(model, grid, overlappingHeader())).toBe(false);
    expect(model.geoData).toBe(existing);
  });

  it('declines when the project has no coordinate system yet', () => {
    const importer = makeImporter([]);
    const model = { name: 'Part_Surface', modelKind: 'dtm' };

    expect(importer.tryGeoreferenceFromHeader(model, grid, overlappingHeader())).toBe(false);
    expect(model.geoData).toBeUndefined();
  });

  it('trusts the header in a model-only project (CS from another model)', () => {
    const importer = new DTMImporterBase(
      {
        getAllCaves  : () => [],
        getAllModels : () => [{ name: 'other', geoData: new GeoData(UTM34, []) }]
      },
      { import: { cavesMaxDistance: 10000 } },
      null,
      null
    );
    const model = { name: 'Part_Surface', modelKind: 'dtm' };

    // No cave to sanity-check against, so the distance gate cannot reject it.
    expect(importer.tryGeoreferenceFromHeader(model, grid, projectedHeader(319333, 4698968))).toBe(true);
    expect(showWarningPanel).not.toHaveBeenCalled();
  });

  it('anchors an EOV project on the EOV axes (y = east, x = north)', () => {
    const eov = new EOVCoordinateSystem();
    const importer = makeImporter([caveAt(eov, 650000, 240000)]);
    const model = { name: 'Surface', modelKind: 'dtm' };

    expect(importer.tryGeoreferenceFromHeader(model, grid, projectedHeader(649320, 239410))).toBe(true);

    const coord = model.geoData.coordinates[0].coordinate;
    expect(coord.y).toBe(649320);
    expect(coord.x).toBe(239410);
    expect(coord.elevation).toBe(0);
  });

  it('folds the octree centering offset into the anchor', () => {
    // The octree worker subtracts the bbox centre from every vertex, and the
    // consumers *set* the group position from the anchor rather than adding
    // to it — so the offset has to live in the anchor or it is discarded.
    const importer = makeImporter([caveAt(UTM34, 319509, 4696310)]);
    const model = { name: 'Part_Surface', modelKind: 'dtm' };
    const header = projectedHeader(319333, 4698968);
    const offset = [680, 590, 969];

    importer.tryGeoreferenceFromHeader(model, grid, header, offset);

    const coord = model.geoData.coordinates[0].coordinate;
    expect(coord.easting).toBe(319333 + 680);
    expect(coord.northing).toBe(4698968 + 590);
    expect(coord.elevation).toBe(969);

    // Composition check: a vertex at local (0,0,857.2) — the SW corner at the
    // grid's lowest point — must render at its true absolute position.
    // rendered = (anchor - origin) + (local - offset)
    const originE = 319509, originN = 4696310, originZ = 1360;
    expect((coord.easting - originE) + (0 - offset[0])).toBe(319333 - originE);
    expect((coord.northing - originN) + (0 - offset[1])).toBe(4698968 - originN);
    expect((coord.elevation - originZ) + (857.2 - offset[2])).toBeCloseTo(857.2 - originZ, 6);
  });

  it('falls back to grid.cellsize when cellsizeX/Y are absent', () => {
    const importer = makeImporter([caveAt(UTM34, 319509, 4696310)]);
    const model = { name: 'Surface', modelKind: 'dtm' };
    const squareGrid = { ncols: 69, nrows: 60, cellsize: 20 };

    expect(importer.tryGeoreferenceFromHeader(model, squareGrid, overlappingHeader())).toBe(true);
    expect(showWarningPanel).not.toHaveBeenCalled();
  });
});

describe('GeoData.withZeroElevation', () => {

  it('zeroes elevation without mutating the original', () => {
    const original = new GeoData(UTM34, [
      new StationWithCoordinate('origin', new UTMCoordinateWithElevation(319509, 4696310, 1360))
    ]);

    const zeroed = original.withZeroElevation();

    expect(zeroed.coordinates[0].coordinate.elevation).toBe(0);
    expect(zeroed.coordinates[0].coordinate.easting).toBe(319509);
    expect(zeroed.coordinates[0].coordinate.northing).toBe(4696310);
    expect(original.coordinates[0].coordinate.elevation).toBe(1360);
  });

  it('preserves the EOV axes', () => {
    const original = new GeoData(new EOVCoordinateSystem(), [
      new StationWithCoordinate('origin', new EOVCoordinateWithElevation(650000, 240000, 500))
    ]);

    const zeroed = original.withZeroElevation();

    expect(zeroed.coordinates[0].coordinate.y).toBe(650000);
    expect(zeroed.coordinates[0].coordinate.x).toBe(240000);
    expect(zeroed.coordinates[0].coordinate.elevation).toBe(0);
  });
});
