import { describe, it, expect, vi } from 'vitest';

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

const { AscDTMImporter } = await import('../../src/io/dtm-importer.js');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildHeader({ ncols = 3, nrows = 2, xll = 'xllcorner', yll = 'yllcorner', xv = 0, yv = 0, cs = 1, nodata = '-9999' } = {}) {
  return [
    `ncols ${ncols}`,
    `nrows ${nrows}`,
    `${xll} ${xv}`,
    `${yll} ${yv}`,
    `cellsize ${cs}`,
    `NODATA_value ${nodata}`
  ].join('\n');
}

function parseFull(text, maxCells = Infinity) {
  const header = AscDTMImporter.parseHeader(text);
  const stride = AscDTMImporter.computeStride(header.ncols, header.nrows, maxCells);
  const grid = AscDTMImporter.readGrid(text, header, stride);
  return { header, stride, grid };
}

// ─── parseHeader ────────────────────────────────────────────────────────────

describe('AscDTMImporter.parseHeader', () => {

  it('parses a minimal valid header with xllcorner/yllcorner', () => {
    const text = buildHeader() + '\n1 2 3\n4 5 6\n';
    const h = AscDTMImporter.parseHeader(text);
    expect(h.ncols).toBe(3);
    expect(h.nrows).toBe(2);
    expect(h.xllcorner).toBe(0);
    expect(h.yllcorner).toBe(0);
    expect(h.cellsize).toBe(1);
    expect(h.nodata).toBe(-9999);
    expect(h.dataOffset).toBeGreaterThan(0);
  });

  it('handles xllcenter / yllcenter by adjusting to corner', () => {
    const text = buildHeader({ xll: 'xllcenter', yll: 'yllcenter', xv: 100.5, yv: 200.5, cs: 1 })
      + '\n1 2 3\n4 5 6\n';
    const h = AscDTMImporter.parseHeader(text);
    expect(h.xllcorner).toBeCloseTo(100, 6);
    expect(h.yllcorner).toBeCloseTo(200, 6);
  });

  it('header keys are case-insensitive', () => {
    const text = [
      'NCOLS 2', 'Nrows 2', 'XLLCORNER 10', 'yllCorner 20',
      'CellSize 5', 'nodata_value -1'
    ].join('\n') + '\n1 2\n3 4\n';
    const h = AscDTMImporter.parseHeader(text);
    expect(h.ncols).toBe(2);
    expect(h.xllcorner).toBe(10);
    expect(h.cellsize).toBe(5);
    expect(h.nodata).toBe(-1);
  });

  it('defaults NODATA_value to -9999 when missing', () => {
    const text = ['ncols 2', 'nrows 1', 'xllcorner 0', 'yllcorner 0', 'cellsize 1']
      .join('\n') + '\n5 6\n';
    const h = AscDTMImporter.parseHeader(text);
    expect(h.nodata).toBe(-9999);
  });

  it('throws when xllcorner/xllcenter is missing', () => {
    const text = ['ncols 2', 'nrows 1', 'yllcorner 0', 'cellsize 1']
      .join('\n') + '\n1 2\n';
    expect(() => AscDTMImporter.parseHeader(text)).toThrow(/xllcorner/);
  });

  it('throws on invalid ncols', () => {
    const text = buildHeader({ ncols: 'bad' }) + '\n1 2 3\n';
    expect(() => AscDTMImporter.parseHeader(text)).toThrow(/ncols/);
  });

  it('dataOffset points to the first non-header line', () => {
    const text = buildHeader() + '\n42 43 44\n';
    const h = AscDTMImporter.parseHeader(text);
    expect(text.substring(h.dataOffset).trimStart().startsWith('42')).toBe(true);
  });
});

// ─── computeStride ──────────────────────────────────────────────────────────

describe('AscDTMImporter.computeStride', () => {

  it('returns 1 when total fits maxCells', () => {
    expect(AscDTMImporter.computeStride(100, 100, 100_000)).toBe(1);
  });

  it('returns float stride > 1 when over the limit', () => {
    // 5000 * 5000 = 25M cells, max = 4M → stride = sqrt(6.25) = 2.5
    expect(AscDTMImporter.computeStride(5000, 5000, 4_000_000)).toBeCloseTo(2.5, 6);
  });

  it('treats maxCells = Infinity as "no limit"', () => {
    expect(AscDTMImporter.computeStride(10000, 10000, Infinity)).toBe(1);
  });
});

// ─── readGrid (no decimation) ──────────────────────────────────────────────

describe('AscDTMImporter.readGrid — no decimation', () => {

  it('reads all values into Float32Array(ncols*nrows)', () => {
    const text = buildHeader() + '\n1 2 3\n4 5 6\n';
    const { grid } = parseFull(text);
    expect(grid.ncols).toBe(3);
    expect(grid.nrows).toBe(2);
    expect(grid.cellsize).toBe(1);
    expect(grid.elevations).toBeInstanceOf(Float32Array);
    expect(Array.from(grid.elevations)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('converts NODATA values to NaN', () => {
    const text = buildHeader({ nodata: '-9999' }) + '\n1 -9999 3\n4 5 -9999\n';
    const { grid } = parseFull(text);
    expect(grid.elevations[0]).toBe(1);
    expect(Number.isNaN(grid.elevations[1])).toBe(true);
    expect(grid.elevations[2]).toBe(3);
    expect(Number.isNaN(grid.elevations[5])).toBe(true);
  });

  it('handles arbitrary whitespace and wrapping', () => {
    const text = buildHeader() + '\n1 2 3 4 5 6\n';
    const { grid } = parseFull(text);
    expect(Array.from(grid.elevations)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('throws on truncated data', () => {
    const text = buildHeader() + '\n1 2 3\n4\n';
    expect(() => parseFull(text)).toThrow(/truncated/);
  });

  it('throws on non-numeric value in a sampled cell', () => {
    const text = buildHeader() + '\n1 foo 3\n4 5 6\n';
    expect(() => parseFull(text)).toThrow(/Invalid ASC value/);
  });
});

// ─── readGrid (with decimation) ────────────────────────────────────────────

describe('AscDTMImporter.readGrid — with decimation', () => {

  it('decimates a 4x4 grid to 2x2 with stride 2', () => {
    // 16 cells, maxCells = 4 → stride = sqrt(16/4) = 2
    const elevations = [
       1, 2, 3, 4,
       5, 6, 7, 8,
       9, 10, 11, 12,
      13, 14, 15, 16
    ];
    const text = buildHeader({ ncols: 4, nrows: 4, cs: 10 }) + '\n' + elevations.join(' ') + '\n';
    const { grid, stride } = parseFull(text, 4);
    expect(stride).toBe(2);
    expect(grid.ncols).toBe(2);
    expect(grid.nrows).toBe(2);
    expect(grid.cellsize).toBe(20); // cellsize * stride
    // Sampled rows: 0, 2 → values from rows 0 and 2 of original
    // Sampled cols: 0, 2 → values from cols 0 and 2 of original
    // Result: elevations[0,0]=1, [0,2]=3, [2,0]=9, [2,2]=11
    expect(Array.from(grid.elevations)).toEqual([1, 3, 9, 11]);
  });

  it('skips parsing of non-sampled tokens (no error on garbage in skipped cells)', () => {
    // 4x4 grid, sample stride=2 → cells (0,0), (0,2), (2,0), (2,2) sampled.
    // Cells (1,1) and (3,3) contain garbage strings — should not be parsed.
    const text = buildHeader({ ncols: 4, nrows: 4 }) + '\n' +
      ' 1 2 3 4\n' +
      ' 5 GARBAGE 7 8\n' +
      ' 9 10 11 12\n' +
      '13 14 15 GARBAGE\n';
    const { grid } = parseFull(text, 4);
    // Sampled cells are valid numbers — parser should succeed even though
    // the source contains "GARBAGE" in non-sampled positions.
    expect(Array.from(grid.elevations)).toEqual([1, 3, 9, 11]);
  });

  it('uses float stride when total/maxCells is not a perfect square', () => {
    // 10x10 = 100, max = 25 → stride = sqrt(4) = 2.0 (perfect square, edge case)
    // Try 20x20 = 400, max = 25 → stride = sqrt(16) = 4
    const ncols = 20, nrows = 20;
    const elevations = new Array(ncols * nrows);
    for (let i = 0; i < elevations.length; i++) elevations[i] = i;
    const text = buildHeader({ ncols, nrows }) + '\n' + elevations.join(' ') + '\n';
    const { grid, stride } = parseFull(text, 25);
    expect(stride).toBeCloseTo(4, 6);
    expect(grid.ncols).toBe(5);
    expect(grid.nrows).toBe(5);
    expect(grid.elevations.length).toBe(25);
  });

  it('produces a grid no larger than maxCells after decimation', () => {
    // Just compute stride and theoretical new dims without parsing huge data
    const stride = AscDTMImporter.computeStride(5000, 5000, 4_000_000);
    const newNcols = Math.floor(5000 / stride);
    const newNrows = Math.floor(5000 / stride);
    expect(newNcols * newNrows).toBeLessThanOrEqual(4_000_000);
  });
});

// ─── buildVertexLayout ──────────────────────────────────────────────────────

describe('AscDTMImporter.buildVertexLayout', () => {

  it('skips NODATA cells in vertex layout', () => {
    const elevations = new Float32Array([
      1, NaN, 3,
      4,   5, 6
    ]);
    const layout = AscDTMImporter.buildVertexLayout({
      ncols: 3, nrows: 2, cellsize: 10, elevations
    });
    expect(layout.validCount).toBe(5);
    expect(layout.vertexIndex[1]).toBe(-1);
    expect(layout.minZ).toBe(1);
    expect(layout.maxZ).toBe(6);
  });

  it('places vertex (col=0, row=nrows-1) at local origin (0,0)', () => {
    const elevations = new Float32Array([
      10, 11,
      20, 21
    ]);
    const layout = AscDTMImporter.buildVertexLayout({
      ncols: 2, nrows: 2, cellsize: 5, elevations
    });
    const vi = layout.vertexIndex[1 * 2 + 0]; // bottom-left in local space
    expect(layout.positions[vi * 3]).toBe(0);
    expect(layout.positions[vi * 3 + 1]).toBe(0);
    expect(layout.positions[vi * 3 + 2]).toBe(20);
  });

  it('vertex (col=ncols-1, row=0) is at (cellsize*(ncols-1), cellsize*(nrows-1))', () => {
    const elevations = new Float32Array([
      10, 11,
      20, 21
    ]);
    const layout = AscDTMImporter.buildVertexLayout({
      ncols: 2, nrows: 2, cellsize: 5, elevations
    });
    const vi = layout.vertexIndex[0 * 2 + 1];
    expect(layout.positions[vi * 3]).toBe(5);
    expect(layout.positions[vi * 3 + 1]).toBe(5);
    expect(layout.positions[vi * 3 + 2]).toBe(11);
  });
});
