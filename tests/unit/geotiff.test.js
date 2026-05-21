import { describe, it, expect, vi, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ─── Mocks (must come before dynamic imports) ────────────────────────────────

vi.mock('../../src/i18n/i18n.js', () => ({
  i18n : { t: (key, _params) => key }
}));

vi.mock('../../src/ui/popups.js', () => ({
  showErrorPanel   : vi.fn(),
  showWarningPanel : vi.fn(),
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

// Minimal Three.js surface. The tests don't actually render — they just need
// the importer to construct without exploding.
vi.mock('three', () => {
  class BufferGeometry {
    constructor() { this.attributes = {}; }
    setAttribute(name, attr) { this.attributes[name] = attr; }
    setIndex(idx) { this.index = idx; }
    computeVertexNormals() {}
    computeBoundingBox() {
      this.boundingBox = { getCenter: () => ({ x: 0, y: 0, z: 0 }) };
    }
    computeBoundingSphere() {}
  }
  return {
    BufferGeometry,
    BufferAttribute  : class { constructor(array, itemSize) { this.array = array; this.count = array.length / itemSize; } },
    MeshPhongMaterial: class {},
    MeshBasicMaterial: class { constructor(opts = {}) { Object.assign(this, opts); } },
    DataTexture      : class { constructor(data, w, h) { this.image = { data, width: w, height: h }; } },
    Mesh             : class { constructor(geometry, material) { this.geometry = geometry; this.material = material; } },
    Vector3          : class { constructor() { this.x = this.y = this.z = 0; } },
    PointsMaterial   : class {},
    Points           : class { type = 'Points'; },
    DoubleSide       : 2,
    ClampToEdgeWrapping     : 1,
    LinearFilter            : 2,
    LinearMipMapLinearFilter: 3,
    SRGBColorSpace          : 'srgb',
    RGBAFormat              : 1023,
    UnsignedByteType        : 1009
  };
});

vi.mock('three/addons/loaders/PLYLoader.js', () => ({ PLYLoader: class {} }));
vi.mock('three/addons/loaders/OBJLoader.js', () => ({ OBJLoader: class {} }));

// Bridge: production uses the UMD bundle via window.GeoTIFF. Tests use the
// npm package and put it on globalThis before importing the importer.
beforeAll(async () => {
  const geotiff = await import('geotiff');
  globalThis.window = globalThis;
  globalThis.GeoTIFF = geotiff;
});

// ─── Dynamic imports (after mocks) ───────────────────────────────────────────

const { GeoTiffImporter } = await import('../../src/io/geotiff-importer.js');
const { WebMercatorConverter } = await import('../../src/utils/geo.js');

const fixturesDir = resolve('tests/fixtures');
const realWorldFixturesDir = resolve(fixturesDir, 'real-world-geotiff');

// ─── resolvePlacement ──────────────────────────────────────────────────────

describe('GeoTiffImporter.resolvePlacement', () => {

  it('maps EPSG:23700 (EOV) to a geoData with EOVCoordinateSystem', () => {
    const r = GeoTiffImporter.resolvePlacement({ ProjectedCSTypeGeoKey: 23700 }, 650000, 240000);
    expect(r).not.toBeNull();
    expect(r.geoData).toBeDefined();
    expect(r.geoData.coordinateSystem.epsgId).toBe(23700);
    const c = r.geoData.coordinates[0].coordinate;
    expect(c.y).toBe(650000); // EOV.y = east
    expect(c.x).toBe(240000); // EOV.x = north
  });

  it('maps EPSG:32634 to UTM zone 34 north', () => {
    const r = GeoTiffImporter.resolvePlacement({ ProjectedCSTypeGeoKey: 32634 }, 500000, 5000000);
    expect(r.geoData.coordinateSystem.zoneNum).toBe(34);
    expect(r.geoData.coordinateSystem.northern).toBe(true);
    const c = r.geoData.coordinates[0].coordinate;
    expect(c.easting).toBe(500000);
    expect(c.northing).toBe(5000000);
  });

  it('maps EPSG:32733 to UTM zone 33 south', () => {
    const r = GeoTiffImporter.resolvePlacement({ ProjectedCSTypeGeoKey: 32733 }, 500000, 8000000);
    expect(r.geoData.coordinateSystem.zoneNum).toBe(33);
    expect(r.geoData.coordinateSystem.northern).toBe(false);
  });

  it('maps EPSG:3857 (Web Mercator) to embeddedCoords WGS84 (lat/lon)', () => {
    // Use the beach photo's corner: (510135, 6890946) → ~(52.499°N, 4.582°E)
    const r = GeoTiffImporter.resolvePlacement({ ProjectedCSTypeGeoKey: 3857 }, 510135, 6890946);
    expect(r.embeddedCoords).toBeDefined();
    expect(r.embeddedCoords.latitude).toBeCloseTo(52.499, 2);
    expect(r.embeddedCoords.longitude).toBeCloseTo(4.582, 2);
    expect(r.embeddedCoords.elevation).toBe(0);
  });

  it('maps EPSG:4326 (WGS84 geographic) to embeddedCoords directly', () => {
    const r = GeoTiffImporter.resolvePlacement({ GeographicTypeGeoKey: 4326 }, 19.0, 47.5);
    expect(r.embeddedCoords).toEqual({ latitude: 47.5, longitude: 19.0, elevation: 0 });
  });

  it('returns null for unknown EPSG codes', () => {
    expect(GeoTiffImporter.resolvePlacement({ ProjectedCSTypeGeoKey: 31370 }, 0, 0)).toBeNull();
  });

  it('returns null when no CS is declared', () => {
    expect(GeoTiffImporter.resolvePlacement({}, 0, 0)).toBeNull();
  });
});

// ─── WebMercatorConverter ──────────────────────────────────────────────────

describe('WebMercatorConverter.toLatLon', () => {

  it('origin maps to (0°, 0°)', () => {
    const { latitude, longitude } = WebMercatorConverter.toLatLon(0, 0);
    expect(latitude).toBeCloseTo(0, 9);
    expect(longitude).toBeCloseTo(0, 9);
  });

  it('beach corner (~510135, 6890946) ≈ (52.499°N, 4.582°E)', () => {
    const { latitude, longitude } = WebMercatorConverter.toLatLon(510135, 6890946);
    expect(latitude).toBeCloseTo(52.499, 2);
    expect(longitude).toBeCloseTo(4.582, 2);
  });
});

// ─── isRgbPhoto detection ──────────────────────────────────────────────────

describe('GeoTiffImporter.isRgbPhoto', () => {

  function fakeImage({ samplesPerPixel, bps, photometric }) {
    return {
      getSamplesPerPixel: () => samplesPerPixel,
      fileDirectory     : {
        BitsPerSample            : bps,
        PhotometricInterpretation: photometric
      }
    };
  }

  it('detects 3-band 8-bit RGB as a photo', () => {
    expect(GeoTiffImporter.isRgbPhoto(fakeImage({ samplesPerPixel: 3, bps: [8, 8, 8], photometric: 2 }))).toBe(true);
  });

  it('detects 4-band 8-bit RGBA as a photo', () => {
    expect(GeoTiffImporter.isRgbPhoto(fakeImage({ samplesPerPixel: 4, bps: [8, 8, 8, 8], photometric: 2 }))).toBe(true);
  });

  it('rejects single-band Float32 DTM', () => {
    expect(GeoTiffImporter.isRgbPhoto(fakeImage({ samplesPerPixel: 1, bps: [32], photometric: 1 }))).toBe(false);
  });

  it('rejects multi-band 16-bit data (multispectral, not an RGB photo)', () => {
    expect(GeoTiffImporter.isRgbPhoto(fakeImage({ samplesPerPixel: 4, bps: [16, 16, 16, 16], photometric: 2 }))).toBe(false);
  });

  it('rejects grayscale 8-bit (could be a DEM)', () => {
    expect(GeoTiffImporter.isRgbPhoto(fakeImage({ samplesPerPixel: 1, bps: [8], photometric: 1 }))).toBe(false);
  });
});

// ─── End-to-end with the generated DTM fixture ──────────────────────────────

describe('GeoTiffImporter — DTM fixture round-trip', () => {

  function loadFixture(name) {
    const buf = readFileSync(resolve(fixturesDir, name));
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  }

  function makeImporter() {
    return new GeoTiffImporter(null, {
      scene: { models: { dtmMaxCells: 4_000_000, pointSize: 2 } }
    }, null, null);
  }

  it('reads dimensions, origin, resolution, and resolves EOV geoData', async () => {
    const ab = loadFixture('sample-dtm-eov.tif');
    const importer = makeImporter();
    let captured = null;
    await importer.importData(ab, async (model) => {
      captured = {
        modelType   : model.constructor.name,
        modelKind   : model.modelKind,
        firstPoint  : model.firstPointCoords,
        geoDataEpsg : model.geoData?.coordinateSystem?.epsgId,
        geoY        : model.geoData?.coordinates?.[0]?.coordinate?.y,
        geoX        : model.geoData?.coordinates?.[0]?.coordinate?.x
      };
    }, 'sample-dtm-eov.tif', null, null, { renderMode: 'mesh' });

    expect(captured.modelType).toBe('Mesh3D');
    expect(captured.modelKind).toBe('dtm');
    expect(captured.geoDataEpsg).toBe(23700);
    expect(captured.geoY).toBe(650000);
    expect(captured.geoX).toBe(240000);
    expect(captured.firstPoint[0]).toBe(650000);
    expect(captured.firstPoint[1]).toBe(240000);
  });
});

// ─── End-to-end with the generated orthophoto fixtures ─────────────────────

describe('GeoTiffImporter — orthophoto fixture round-trip', () => {

  function loadFixture(name) {
    const buf = readFileSync(resolve(fixturesDir, name));
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  }

  function makeImporter() {
    return new GeoTiffImporter(null, {
      scene: { models: { dtmMaxCells: 4_000_000, pointSize: 2 } }
    }, null, null);
  }

  it('routes EOV RGB GeoTIFF as orthophoto with embedded texture and geoData', async () => {
    const ab = loadFixture('sample-orthophoto-eov.tif');
    const importer = makeImporter();
    let captured = null;
    await importer.importData(ab, async (model, obj) => {
      captured = {
        modelKind   : model.modelKind,
        geoDataEpsg : model.geoData?.coordinateSystem?.epsgId,
        firstPoint  : model.firstPointCoords,
        hasTexture  : !!model.orthoMetadata?.texture,
        widthMeters : model.orthoMetadata?.widthMeters,
        heightMeters: model.orthoMetadata?.heightMeters,
        materialType: obj.material?.constructor?.name,
        hasMap      : !!obj.material?.map
      };
    }, 'sample-orthophoto-eov.tif', null, null, { renderMode: 'mesh' });

    expect(captured.modelKind).toBe('orthophoto');
    expect(captured.geoDataEpsg).toBe(23700);
    expect(captured.firstPoint).toEqual([650000, 240000, 0]);
    expect(captured.widthMeters).toBe(1000);   // 100 cols × 10 m
    expect(captured.heightMeters).toBe(1000);  // 100 rows × 10 m
    expect(captured.hasTexture).toBe(true);
    expect(captured.materialType).toBe('MeshBasicMaterial');
    expect(captured.hasMap).toBe(true);
  });

  it('routes Web Mercator (EPSG:3857) RGB GeoTIFF as orthophoto with embeddedCoords', async () => {
    const ab = loadFixture('sample-orthophoto-mercator.tif');
    const importer = makeImporter();
    let captured = null;
    await importer.importData(ab, async (model) => {
      captured = {
        modelKind     : model.modelKind,
        embeddedCoords: model.embeddedCoords,
        hasGeoData    : !!model.geoData
      };
    }, 'sample-orthophoto-mercator.tif', null, null, { renderMode: 'mesh' });

    expect(captured.modelKind).toBe('orthophoto');
    // Fixture is centered at (4.587°E, 52.498°N). embeddedCoords is the
    // lower-left corner, which is ~500m south-west of center → still close.
    expect(captured.embeddedCoords.latitude).toBeCloseTo(52.493, 2);
    expect(captured.embeddedCoords.longitude).toBeCloseTo(4.580, 2);
    expect(captured.hasGeoData).toBe(false); // Web Mercator → main.js converts via embeddedCoords
  });
});

// ─── End-to-end with small real-world WGS84 GeoTIFF fixtures ───────────────

describe('GeoTiffImporter — real-world WGS84 GeoTIFF pair', () => {

  function loadRealWorldFixture(name) {
    const buf = readFileSync(resolve(realWorldFixturesDir, name));
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  }

  function makeImporter() {
    return new GeoTiffImporter(null, {
      scene: { models: { dtmMaxCells: 4_000_000, pointSize: 2 } }
    }, null, null);
  }

  it('imports matching Denver DEM and orthophoto with the same WGS84 anchor and meter-scale footprint', async () => {
    const importer = makeImporter();
    let dtm = null;
    let ortho = null;

    await importer.importData(
      loadRealWorldFixture('denver-wgs84-dtm.tif'),
      async (model, obj) => {
        const positions = obj.geometry.attributes.position.array;
        let maxX = -Infinity, maxY = -Infinity;
        for (let i = 0; i < positions.length; i += 3) {
          maxX = Math.max(maxX, positions[i]);
          maxY = Math.max(maxY, positions[i + 1]);
        }
        dtm = {
          modelKind     : model.modelKind,
          embeddedCoords: model.embeddedCoords,
          firstPoint    : model.firstPointCoords,
          maxX,
          maxY
        };
      },
      'denver-wgs84-dtm.tif',
      null,
      null,
      { renderMode: 'mesh' }
    );

    await importer.importData(
      loadRealWorldFixture('denver-wgs84-orthophoto.tif'),
      async (model) => {
        ortho = {
          modelKind     : model.modelKind,
          embeddedCoords: model.embeddedCoords,
          widthMeters   : model.orthoMetadata?.widthMeters,
          heightMeters  : model.orthoMetadata?.heightMeters,
          hasTexture    : !!model.orthoMetadata?.texture,
          hasAlpha      : model.orthoMetadata?.hasAlpha
        };
      },
      'denver-wgs84-orthophoto.tif',
      null,
      null,
      { renderMode: 'mesh' }
    );

    expect(dtm.modelKind).toBe('dtm');
    expect(ortho.modelKind).toBe('orthophoto');

    expect(dtm.embeddedCoords).toEqual({ latitude: 39.739, longitude: -105, elevation: 0 });
    expect(ortho.embeddedCoords).toEqual(dtm.embeddedCoords);

    expect(ortho.widthMeters).toBeCloseTo(256.8, 1);
    expect(ortho.heightMeters).toBeCloseTo(334.0, 1);
    expect(dtm.maxX).toBeCloseTo(ortho.widthMeters * 255 / 256, 1);
    expect(dtm.maxY).toBeCloseTo(ortho.heightMeters * 255 / 256, 1);

    expect(dtm.firstPoint[0]).toBe(-105);
    expect(dtm.firstPoint[1]).toBe(39.739);
    expect(ortho.hasTexture).toBe(true);
    expect(ortho.hasAlpha).toBe(true);
  });
});
