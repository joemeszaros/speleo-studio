import { describe, it, expect, vi, afterEach } from 'vitest';

// popups.js assigns to `window` at module load (no-op in real browser) — mock it so importing
// the GeoTIFF importer doesn't require a DOM. i18n is only used for messages.
vi.mock('../../src/ui/popups.js', () => ({
  showErrorPanel   : vi.fn(),
  showWarningPanel : vi.fn(),
  showInfoPanel    : vi.fn(),
  showSuccessPanel : vi.fn()
}));
vi.mock('../../src/i18n/i18n.js', () => ({ i18n: { t: (k) => k } }));

const { GeoTiffImporter } = await import('../../src/io/geotiff-importer.js');

// Minimal fake of the geotiff.js library: fromBlob → tiff → getImage → the given header image.
function fakeGeoTIFF(image) {
  return { fromBlob: async () => ({ getImage: async () => image }) };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GeoTiffImporter.detectKind', () => {
  it('returns dtm when the GeoTIFF library is unavailable (no window)', async () => {
    expect(await GeoTiffImporter.detectKind({})).toBe('dtm');
  });

  it('detects an RGB orthophoto (≥3 samples, photometric RGB, 8-bit)', async () => {
    const image = {
      getSamplesPerPixel : () => 3,
      fileDirectory      : { PhotometricInterpretation: 2, BitsPerSample: [8, 8, 8] }
    };
    vi.stubGlobal('window', { GeoTIFF: fakeGeoTIFF(image) });
    expect(await GeoTiffImporter.detectKind({})).toBe('orthophoto');
  });

  it('detects a single-band elevation raster as dtm', async () => {
    const image = {
      getSamplesPerPixel : () => 1,
      fileDirectory      : { PhotometricInterpretation: 1, BitsPerSample: [32] }
    };
    vi.stubGlobal('window', { GeoTIFF: fakeGeoTIFF(image) });
    expect(await GeoTiffImporter.detectKind({})).toBe('dtm');
  });

  it('treats a 16-bit multi-band raster as dtm (not an 8-bit photo)', async () => {
    const image = {
      getSamplesPerPixel : () => 3,
      fileDirectory      : { PhotometricInterpretation: 2, BitsPerSample: [16, 16, 16] }
    };
    vi.stubGlobal('window', { GeoTIFF: fakeGeoTIFF(image) });
    expect(await GeoTiffImporter.detectKind({})).toBe('dtm');
  });

  it('falls back to dtm if the header read throws', async () => {
    vi.stubGlobal('window', {
      GeoTIFF : {
        fromBlob : async () => {
          throw new Error('corrupt');
        }
      }
    });
    expect(await GeoTiffImporter.detectKind({})).toBe('dtm');
  });
});
