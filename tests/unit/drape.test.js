import { describe, it, expect, vi, beforeAll } from 'vitest';

// Bridge: production uses the UMD bundle via window.GeoTIFF. Tests use the
// npm package and put it on globalThis before importing the scene.
beforeAll(async () => {
  globalThis.window = globalThis;
});

// Minimal THREE.js mock — we only need BufferAttribute-like positions and
// BufferAttribute construction for the UV array. computeDrapeUVs is pure
// math; no Three internals are touched.
vi.mock('three', () => ({
  BufferAttribute: class { constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; this.count = array.length / itemSize; } },
  Box3           : class {},
  Vector3        : class {},
  Mesh           : class {},
  MeshBasicMaterial: class {},
  DoubleSide     : 2
}));

// Mock other dependencies the importer chain pulls in
vi.mock('../../src/i18n/i18n.js', () => ({ i18n: { t: (k) => k } }));
vi.mock('../../src/ui/popups.js', () => ({
  showErrorPanel: vi.fn(), showWarningPanel: vi.fn(), showInfoPanel: vi.fn()
}));

const { ModelScene } = await import('../../src/scene/cosmos/model.js');

// ─── computeDrapeUVs — pure math, no Three.js scene needed ─────────────────

describe('ModelScene.computeDrapeUVs', () => {

  /**
   * Build a tiny "positions BufferAttribute" stand-in: an array of vertices
   * indexable via getX/getY/count, matching what THREE.BufferAttribute
   * exposes.
   */
  function positionsFor(vertices) {
    return {
      count: vertices.length,
      getX : (i) => vertices[i][0],
      getY : (i) => vertices[i][1]
    };
  }

  it('maps a DTM whose extent exactly matches the orthophoto to UVs (0..1)', () => {
    // DTM at world (1000, 2000), local extent 0..500 × 0..500
    // Orthophoto at world (1000, 2000), 500m × 500m
    const positions = positionsFor([
      [0, 0],     // lower-left  → UV (0, 0)
      [500, 0],   // lower-right → UV (1, 0)
      [500, 500], // upper-right → UV (1, 1)
      [0, 500]    // upper-left  → UV (0, 1)
    ]);
    const uvs = ModelScene.computeDrapeUVs(
      positions,
      { x: 1000, y: 2000 },              // DTM world offset
      { x: 1000, y: 2000 },              // orthophoto world origin
      { width: 500, height: 500 }
    );
    expect(Array.from(uvs)).toEqual([
      0, 0,
      1, 0,
      1, 1,
      0, 1
    ]);
  });

  it('returns un-clamped UVs for vertices outside the orthophoto footprint', () => {
    // Vertices outside [0,1] are essential: the photo-overlay fragment
    // shader uses the out-of-range values to discard fragments outside the
    // photo's actual coverage. If we clamped here, triangles entirely
    // outside the photo would see in-range UVs and sample the photo's
    // edge color across the whole DTM (the original "grey surface" bug).
    const positions = positionsFor([
      [-100, -100],   // way outside, lower-left of photo
      [600, 600],     // way outside, upper-right of photo
      [250, 250]      // inside (center)
    ]);
    const uvs = ModelScene.computeDrapeUVs(
      positions,
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { width: 500, height: 500 }
    );
    expect(uvs[0]).toBeCloseTo(-0.2); expect(uvs[1]).toBeCloseTo(-0.2); // outside, negative
    expect(uvs[2]).toBeCloseTo(1.2);  expect(uvs[3]).toBeCloseTo(1.2);  // outside, > 1
    expect(uvs[4]).toBeCloseTo(0.5);  expect(uvs[5]).toBeCloseTo(0.5);  // inside, fractional
  });

  it('handles offset DTM correctly (world XY = local + dtmOffset)', () => {
    // DTM at world (5000, 5000), local 0..1000
    // Photo at world (5000, 5000), 1000×1000
    const positions = positionsFor([
      [0, 0],
      [500, 1000],
      [1000, 1000]
    ]);
    const uvs = ModelScene.computeDrapeUVs(
      positions,
      { x: 5000, y: 5000 },
      { x: 5000, y: 5000 },
      { width: 1000, height: 1000 }
    );
    expect(uvs[0]).toBeCloseTo(0);   expect(uvs[1]).toBeCloseTo(0);
    expect(uvs[2]).toBeCloseTo(0.5); expect(uvs[3]).toBeCloseTo(1);
    expect(uvs[4]).toBeCloseTo(1);   expect(uvs[5]).toBeCloseTo(1);
  });

  it('partial overlap — vertices inside the photo get fractional UVs, others go out of range', () => {
    // Photo covers the LEFT HALF of the DTM
    const positions = positionsFor([
      [0, 0],      // inside photo → (0, 0)
      [500, 500],  // inside photo upper-right → (1, 1)
      [600, 0],    // just outside east edge → u=1.2
      [1000, 0]    // way outside east → u=2.0
    ]);
    const uvs = ModelScene.computeDrapeUVs(
      positions,
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { width: 500, height: 500 }
    );
    expect(uvs[0]).toBe(0);          expect(uvs[1]).toBe(0);
    expect(uvs[2]).toBe(1);          expect(uvs[3]).toBe(1);
    expect(uvs[4]).toBeCloseTo(1.2); expect(uvs[5]).toBe(0);
    expect(uvs[6]).toBeCloseTo(2.0); expect(uvs[7]).toBe(0);
  });

  it('returns one (u, v) pair per vertex', () => {
    const positions = positionsFor([
      [0, 0], [10, 10], [20, 20], [30, 30], [40, 40]
    ]);
    const uvs = ModelScene.computeDrapeUVs(
      positions,
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { width: 40, height: 40 }
    );
    expect(uvs.length).toBe(10);
  });
});
