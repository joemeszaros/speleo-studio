import { describe, it, expect, vi } from 'vitest';
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

vi.mock('three', () => ({}));
vi.mock('three/addons/loaders/PLYLoader.js', () => ({ PLYLoader: class {} }));
vi.mock('three/addons/loaders/OBJLoader.js', () => ({ OBJLoader: class {} }));

// ─── Dynamic imports (after mocks) ───────────────────────────────────────────

const { HgtDTMImporter, DTMImporterBase } = await import('../../src/io/dtm-importer.js');

const fixturesDir = resolve('tests/fixtures');

// ─── parseFilename ──────────────────────────────────────────────────────────

describe('HgtDTMImporter.parseFilename', () => {

  it('parses N47E019.hgt', () => {
    expect(HgtDTMImporter.parseFilename('N47E019.hgt')).toEqual({ latMin: 47, lonMin: 19 });
  });

  it('parses lowercase n47e019.hgt', () => {
    expect(HgtDTMImporter.parseFilename('n47e019.hgt')).toEqual({ latMin: 47, lonMin: 19 });
  });

  it('parses S05W034.hgt (southern + western hemisphere)', () => {
    expect(HgtDTMImporter.parseFilename('S05W034.hgt')).toEqual({ latMin: -5, lonMin: -34 });
  });

  it('strips path prefix', () => {
    expect(HgtDTMImporter.parseFilename('/some/path/N47E019.hgt')).toEqual({ latMin: 47, lonMin: 19 });
  });

  it('handles SRTMGL1 naming variant', () => {
    expect(HgtDTMImporter.parseFilename('N47E019.SRTMGL1.hgt')).toEqual({ latMin: 47, lonMin: 19 });
  });

  it('handles 1-digit lat / 1-digit lon', () => {
    expect(HgtDTMImporter.parseFilename('N5E9.hgt')).toEqual({ latMin: 5, lonMin: 9 });
  });

  it('throws when filename contains no coordinate code', () => {
    expect(() => HgtDTMImporter.parseFilename('terrain.hgt')).toThrow(/N\/S/);
  });
});

// ─── detectDim ──────────────────────────────────────────────────────────────

describe('HgtDTMImporter.detectDim', () => {

  it('recognizes SRTM3 file size', () => {
    expect(HgtDTMImporter.detectDim(2884802)).toBe(1201);
  });

  it('recognizes SRTM1 file size', () => {
    expect(HgtDTMImporter.detectDim(25934402)).toBe(3601);
  });

  it('accepts arbitrary square sizes (test fixture 121²)', () => {
    expect(HgtDTMImporter.detectDim(121 * 121 * 2)).toBe(121);
  });

  it('rejects odd byte lengths', () => {
    expect(() => HgtDTMImporter.detectDim(123)).toThrow();
  });

  it('rejects non-square sizes', () => {
    expect(() => HgtDTMImporter.detectDim(2 * (123 * 124))).toThrow();
  });
});

// ─── readGrid ────────────────────────────────────────────────────────────────

function buildHgtBuffer(dim, valueAt) {
  const buf = new ArrayBuffer(dim * dim * 2);
  const view = new DataView(buf);
  for (let r = 0; r < dim; r++) {
    for (let c = 0; c < dim; c++) {
      view.setInt16((r * dim + c) * 2, valueAt(r, c), false); // big-endian
    }
  }
  return buf;
}

describe('HgtDTMImporter.readGrid — no decimation', () => {

  it('reads big-endian int16 values into Float32Array', () => {
    const buf = buildHgtBuffer(2, (r, c) => r * 10 + c);
    const grid = HgtDTMImporter.readGrid(buf, 2, 1);
    expect(grid.ncols).toBe(2);
    expect(grid.nrows).toBe(2);
    expect(grid.elevations).toBeInstanceOf(Float32Array);
    expect(Array.from(grid.elevations)).toEqual([0, 1, 10, 11]);
  });

  it('converts NODATA (-32768) to NaN', () => {
    const buf = buildHgtBuffer(2, (r, c) => (r === 0 && c === 1) ? -32768 : 5);
    const grid = HgtDTMImporter.readGrid(buf, 2, 1);
    expect(grid.elevations[0]).toBe(5);
    expect(Number.isNaN(grid.elevations[1])).toBe(true);
    expect(grid.elevations[2]).toBe(5);
  });

  it('preserves negative elevations (below sea level)', () => {
    const buf = buildHgtBuffer(2, () => -50);
    const grid = HgtDTMImporter.readGrid(buf, 2, 1);
    expect(Array.from(grid.elevations)).toEqual([-50, -50, -50, -50]);
  });
});

describe('HgtDTMImporter.readGrid — with decimation', () => {

  it('decimates a 4×4 grid to 2×2 with stride 2', () => {
    // Grid:  0  1  2  3
    //        4  5  6  7
    //        8  9 10 11
    //       12 13 14 15
    // Stride 2 samples rows 0,2 and cols 0,2 → values [0, 2, 8, 10]
    const buf = buildHgtBuffer(4, (r, c) => r * 4 + c);
    const grid = HgtDTMImporter.readGrid(buf, 4, 2);
    expect(grid.ncols).toBe(2);
    expect(grid.nrows).toBe(2);
    expect(Array.from(grid.elevations)).toEqual([0, 2, 8, 10]);
  });

  it('handles NODATA in sampled cells', () => {
    const buf = buildHgtBuffer(4, (r, c) => (r === 2 && c === 2) ? -32768 : 1);
    const grid = HgtDTMImporter.readGrid(buf, 4, 2);
    // Sampled cells: (0,0), (0,2), (2,0), (2,2) — last one is NODATA
    expect(Number.isNaN(grid.elevations[3])).toBe(true);
    expect(grid.elevations[0]).toBe(1);
    expect(grid.elevations[1]).toBe(1);
    expect(grid.elevations[2]).toBe(1);
  });

  it('produces a grid no larger than maxCells via computeStride', () => {
    const stride = DTMImporterBase.computeStride(3601, 3601, 4_000_000);
    expect(stride).toBeGreaterThan(1);
    const newDim = Math.floor(3601 / stride);
    expect(newDim * newDim).toBeLessThanOrEqual(4_000_000);
  });
});

// ─── End-to-end with the generated fixture ─────────────────────────────────

describe('HgtDTMImporter — fixture round-trip', () => {

  it('reads the 121x121 fixture file with correct dim + NODATA', () => {
    const file = readFileSync(resolve(fixturesDir, 'N47E019.hgt'));
    const buf = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);

    expect(HgtDTMImporter.detectDim(buf.byteLength)).toBe(121);

    const grid = HgtDTMImporter.readGrid(buf, 121, 1);
    expect(grid.ncols).toBe(121);
    expect(grid.nrows).toBe(121);
    // NODATA patch at rows 60..70, cols 60..70 → NaN
    expect(Number.isNaN(grid.elevations[60 * 121 + 60])).toBe(true);
    expect(Number.isNaN(grid.elevations[65 * 121 + 65])).toBe(true);
    expect(Number.isNaN(grid.elevations[70 * 121 + 70])).toBe(true);
    // Cells outside the patch should be finite
    expect(Number.isFinite(grid.elevations[0])).toBe(true);
    expect(Number.isFinite(grid.elevations[120 * 121 + 120])).toBe(true);
  });
});
