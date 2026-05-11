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

const { XyzImporter } = await import('../../src/io/xyz-importer.js');
const { DTMImporterBase } = await import('../../src/io/dtm-importer.js');

const fixturesDir = resolve('tests/fixtures');

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a column-major XYZ string from a 2D elevations array.
 * elevations[row][col], with row 0 = north. File order: outer = column ascending,
 * inner = Y descending (so file lists Y_MAX first within each column).
 */
function buildColMajorXyz(xMin, yMin, step, elevations) {
  const nrows = elevations.length;
  const ncols = elevations[0].length;
  const yMax = yMin + (nrows - 1) * step;
  const lines = [];
  for (let c = 0; c < ncols; c++) {
    const x = xMin + c * step;
    for (let r = 0; r < nrows; r++) {
      // file row 0 = max Y (north), internal row 0 = north → same r
      const y = yMax - r * step;
      lines.push(`${x} ${y} ${elevations[r][c]}`);
    }
  }
  return lines.join('\n') + '\n';
}

function buildRowMajorXyz(xMin, yMin, step, elevations) {
  const nrows = elevations.length;
  const ncols = elevations[0].length;
  const yMax = yMin + (nrows - 1) * step;
  const lines = [];
  for (let r = 0; r < nrows; r++) {
    const y = yMax - r * step;
    for (let c = 0; c < ncols; c++) {
      const x = xMin + c * step;
      lines.push(`${x} ${y} ${elevations[r][c]}`);
    }
  }
  return lines.join('\n') + '\n';
}

// ─── detectGridXyz ──────────────────────────────────────────────────────────

describe('XyzImporter.detectGridXyz', () => {

  it('detects column-major grid (Y descending, X ascending)', () => {
    const elev = [
      [1, 2, 3],
      [4, 5, 6]
    ];
    const text = buildColMajorXyz(100, 50, 10, elev);
    const d = XyzImporter.detectGridXyz(text);
    expect(d).not.toBeNull();
    expect(d.layout).toBe('col-major');
    expect(d.ncols).toBe(3);
    expect(d.nrows).toBe(2);
    expect(d.xMin).toBe(100);
    expect(d.yMin).toBe(50);
    expect(d.xStep).toBe(10);
    expect(d.yStep).toBe(-10);
    expect(d.totalLines).toBe(6);
  });

  it('detects row-major grid', () => {
    const elev = [
      [1, 2, 3],
      [4, 5, 6]
    ];
    const text = buildRowMajorXyz(100, 50, 10, elev);
    const d = XyzImporter.detectGridXyz(text);
    expect(d).not.toBeNull();
    expect(d.layout).toBe('row-major');
    expect(d.ncols).toBe(3);
    expect(d.nrows).toBe(2);
    expect(d.xStep).toBe(10);
    expect(d.yStep).toBe(-10);
  });

  it('skips leading comment lines and blank lines', () => {
    const elev = [
      [1, 2],
      [3, 4]
    ];
    const grid = buildColMajorXyz(0, 0, 1, elev);
    const text = '# header comment\n\n# second comment\n' + grid;
    const d = XyzImporter.detectGridXyz(text);
    expect(d).not.toBeNull();
    expect(d.ncols).toBe(2);
    expect(d.nrows).toBe(2);
  });

  it('returns null when totalLines not a multiple of inner dim', () => {
    // 5 lines = prime, inner=2 → not divisible → null
    const text = '0 0 1\n0 1 2\n1 0 3\n1 1 4\n2 0 5\n';
    const d = XyzImporter.detectGridXyz(text);
    expect(d).toBeNull();
  });

  it('returns null for scattered random data', () => {
    let seed = 1;
    const rand = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    const lines = [];
    for (let i = 0; i < 100; i++) {
      lines.push(`${rand() * 100} ${rand() * 100} ${rand() * 30}`);
    }
    const text = lines.join('\n') + '\n';
    const d = XyzImporter.detectGridXyz(text);
    expect(d).toBeNull();
  });

  it('reads sample-dtm.xyz fixture as 10×10 column-major grid', () => {
    const text = readFileSync(resolve(fixturesDir, 'sample-dtm.xyz'), 'utf8');
    const d = XyzImporter.detectGridXyz(text);
    expect(d).not.toBeNull();
    expect(d.ncols).toBe(10);
    expect(d.nrows).toBe(10);
    expect(d.layout).toBe('col-major');
    expect(d.xMin).toBe(650000);
    expect(d.yMin).toBe(240000);
    expect(d.xStep).toBe(20);
    expect(d.yStep).toBe(-20);
  });
});

// ─── readGridXyz ────────────────────────────────────────────────────────────

describe('XyzImporter.readGridXyz', () => {

  it('reads elevations into Float32Array with row 0 = north', () => {
    // elev[row][col] where row 0 = north (high Y)
    const elev = [
      [1, 2, 3],
      [4, 5, 6]
    ];
    const text = buildColMajorXyz(100, 50, 10, elev);
    const d = XyzImporter.detectGridXyz(text);
    const grid = XyzImporter.readGridXyz(text, d, 1);
    expect(grid.ncols).toBe(3);
    expect(grid.nrows).toBe(2);
    expect(grid.cellsizeX).toBe(10);
    expect(grid.cellsizeY).toBe(10);
    expect(Array.from(grid.elevations)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('row-major layout produces same internal representation', () => {
    const elev = [
      [1, 2, 3],
      [4, 5, 6]
    ];
    const text = buildRowMajorXyz(100, 50, 10, elev);
    const d = XyzImporter.detectGridXyz(text);
    const grid = XyzImporter.readGridXyz(text, d, 1);
    expect(Array.from(grid.elevations)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('converts NODATA (-9999) to NaN', () => {
    const elev = [
      [10, -9999],
      [-9999, 40]
    ];
    const text = buildColMajorXyz(0, 0, 1, elev);
    const d = XyzImporter.detectGridXyz(text);
    const grid = XyzImporter.readGridXyz(text, d, 1);
    expect(grid.elevations[0]).toBe(10);
    expect(Number.isNaN(grid.elevations[1])).toBe(true);
    expect(Number.isNaN(grid.elevations[2])).toBe(true);
    expect(grid.elevations[3]).toBe(40);
  });

  it('decimates with stride 2', () => {
    // 4×4 column-major grid
    const elev = [
      [1, 2, 3, 4],
      [5, 6, 7, 8],
      [9, 10, 11, 12],
      [13, 14, 15, 16]
    ];
    const text = buildColMajorXyz(0, 0, 1, elev);
    const d = XyzImporter.detectGridXyz(text);
    const grid = XyzImporter.readGridXyz(text, d, 2);
    expect(grid.ncols).toBe(2);
    expect(grid.nrows).toBe(2);
    expect(grid.cellsizeX).toBe(2);
    expect(grid.cellsizeY).toBe(2);
    // Sampled cells in 4×4: rows 0,2; cols 0,2 → values [1,3,9,11]
    expect(Array.from(grid.elevations)).toEqual([1, 3, 9, 11]);
  });

  it('skips Z parseFloat on non-sampled cells (garbage tolerant)', () => {
    // 4×4 column-major grid where non-sampled cells contain garbage Z.
    // If our streaming code parseFloat'd everything, this would throw.
    const xMin = 0, yMin = 0, step = 1, ncols = 4, nrows = 4;
    const yMax = yMin + (nrows - 1) * step;
    const sampledRowSet = new Set([0, 2]);
    const sampledColSet = new Set([0, 2]);
    const lines = [];
    for (let c = 0; c < ncols; c++) {
      const x = xMin + c * step;
      for (let r = 0; r < nrows; r++) {
        const y = yMax - r * step;
        const sampled = sampledRowSet.has(r) && sampledColSet.has(c);
        lines.push(`${x} ${y} ${sampled ? r * 10 + c : 'GARBAGE'}`);
      }
    }
    const text = lines.join('\n') + '\n';
    const d = XyzImporter.detectGridXyz(text);
    const grid = XyzImporter.readGridXyz(text, d, 2);
    // Sampled values: r0/c0=0, r0/c2=2, r2/c0=20, r2/c2=22
    expect(Array.from(grid.elevations)).toEqual([0, 2, 20, 22]);
  });
});

// ─── readScatteredXyz ───────────────────────────────────────────────────────

describe('XyzImporter.readScatteredXyz', () => {

  it('reads all points and computes bounds', () => {
    const text = '1 2 3\n4 5 6\n7 8 9\n';
    const r = XyzImporter.readScatteredXyz(text);
    expect(r.pointCount).toBe(3);
    expect(Array.from(r.positions)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(r.bounds.min).toEqual([1, 2, 3]);
    expect(r.bounds.max).toEqual([7, 8, 9]);
  });

  it('strips comment + blank lines from count', () => {
    const text = '# a comment\n\n1 2 3\n# another\n4 5 6\n';
    const r = XyzImporter.readScatteredXyz(text);
    expect(r.pointCount).toBe(2);
  });

  it('reads the sample-points.xyz fixture', () => {
    const text = readFileSync(resolve(fixturesDir, 'sample-points.xyz'), 'utf8');
    const r = XyzImporter.readScatteredXyz(text);
    expect(r.pointCount).toBe(1000);
    expect(r.positions.length).toBe(3000);
    expect(r.bounds.min[0]).toBeGreaterThanOrEqual(650000);
    expect(r.bounds.max[0]).toBeLessThan(650300);
  });

  it('throws on an empty file', () => {
    expect(() => XyzImporter.readScatteredXyz('\n\n# only comments\n')).toThrow(/empty/);
  });
});

// ─── Decimation math via base class ─────────────────────────────────────────

describe('DTMImporterBase.computeStride applied to XYZ dims', () => {

  it('returns 1 when total fits maxCells', () => {
    expect(DTMImporterBase.computeStride(100, 100, 100_000)).toBe(1);
  });

  it('returns float stride for the real-file size (2700×2700, max 4M)', () => {
    const stride = DTMImporterBase.computeStride(2700, 2700, 4_000_000);
    expect(stride).toBeGreaterThan(1);
    expect(stride).toBeLessThan(2);
    const newDim = Math.floor(2700 / stride);
    expect(newDim * newDim).toBeLessThanOrEqual(4_000_000);
  });
});
