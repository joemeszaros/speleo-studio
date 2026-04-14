import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const fixturesDir = resolve('tests/fixtures');

/**
 * Read the synthetic LAS fixture as an ArrayBuffer.
 */
function loadLasFixture() {
  const buf = readFileSync(resolve(fixturesDir, 'sample-pointcloud.las'));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

/**
 * Minimal LAS header parser (mirrors the worker's parseLASHeader).
 * Duplicated here to unit-test the parsing logic independently.
 */
function parseLASHeader(arraybuffer) {
  function readAs(buf, Type, offset, count) {
    count = (count === undefined || count === 0 ? 1 : count);
    const sub = buf.slice(offset, offset + Type.BYTES_PER_ELEMENT * count);
    const r = new Type(sub);
    if (count === undefined || count === 1) return r[0];
    return Array.from(r);
  }

  const o = {};
  const sig = new Uint8Array(arraybuffer, 0, 4);
  o.signature = String.fromCharCode(sig[0], sig[1], sig[2], sig[3]);

  const ver = new Uint8Array(arraybuffer, 24, 2);
  o.versionMajor = ver[0];
  o.versionMinor = ver[1];

  o.pointsOffset = readAs(arraybuffer, Uint32Array, 32 * 3);
  const formatByte = readAs(arraybuffer, Uint8Array, 32 * 3 + 8);
  o.pointsStructSize = readAs(arraybuffer, Uint16Array, 32 * 3 + 8 + 1);
  o.isCompressed = ((formatByte & 0x80) >> 7 === 1) || ((formatByte & 0x40) >> 6 === 1);
  o.pointsFormatId = formatByte & 0x3f;
  o.pointsCount = readAs(arraybuffer, Uint32Array, 32 * 3 + 11);

  const start = 32 * 3 + 35;
  o.scale = readAs(arraybuffer, Float64Array, start, 3);
  o.offset = readAs(arraybuffer, Float64Array, start + 24, 3);

  const bounds = readAs(arraybuffer, Float64Array, start + 48, 6);
  o.maxs = [bounds[0], bounds[2], bounds[4]];
  o.mins = [bounds[1], bounds[3], bounds[5]];

  o.hasColor = [2, 3, 5, 7, 8, 10].includes(o.pointsFormatId);

  return o;
}

/**
 * Parse point data from uncompressed LAS (mirrors worker's parseLASPoints).
 */
function parseLASPoints(arraybuffer, header) {
  const view = new DataView(arraybuffer);
  const count = header.pointsCount;
  const positions = new Float32Array(count * 3);
  const colors = header.hasColor ? new Uint8Array(count * 3) : null;
  const recordSize = header.pointsStructSize;

  for (let i = 0; i < count; i++) {
    const base = header.pointsOffset + i * recordSize;
    const ix = view.getInt32(base, true);
    const iy = view.getInt32(base + 4, true);
    const iz = view.getInt32(base + 8, true);

    positions[i * 3] = ix * header.scale[0] + header.offset[0];
    positions[i * 3 + 1] = iy * header.scale[1] + header.offset[1];
    positions[i * 3 + 2] = iz * header.scale[2] + header.offset[2];

    if (colors) {
      colors[i * 3] = view.getUint16(base + 20, true) >> 8;
      colors[i * 3 + 1] = view.getUint16(base + 22, true) >> 8;
      colors[i * 3 + 2] = view.getUint16(base + 24, true) >> 8;
    }
  }

  return { positions, colors, pointCount: count };
}

// =============================================================================
// Tests
// =============================================================================

describe('LAS Header Parsing', () => {

  it('should parse LASF signature', () => {
    const buffer = loadLasFixture();
    const header = parseLASHeader(buffer);
    expect(header.signature).toBe('LASF');
  });

  it('should parse version 1.2', () => {
    const buffer = loadLasFixture();
    const header = parseLASHeader(buffer);
    expect(header.versionMajor).toBe(1);
    expect(header.versionMinor).toBe(2);
  });

  it('should parse point format 2 (with RGB)', () => {
    const buffer = loadLasFixture();
    const header = parseLASHeader(buffer);
    expect(header.pointsFormatId).toBe(2);
    expect(header.hasColor).toBe(true);
    expect(header.pointsStructSize).toBe(26);
  });

  it('should parse 100 points', () => {
    const buffer = loadLasFixture();
    const header = parseLASHeader(buffer);
    expect(header.pointsCount).toBe(100);
  });

  it('should detect uncompressed file', () => {
    const buffer = loadLasFixture();
    const header = parseLASHeader(buffer);
    expect(header.isCompressed).toBe(false);
  });

  it('should parse scale factors', () => {
    const buffer = loadLasFixture();
    const header = parseLASHeader(buffer);
    expect(header.scale[0]).toBeCloseTo(0.001, 6);
    expect(header.scale[1]).toBeCloseTo(0.001, 6);
    expect(header.scale[2]).toBeCloseTo(0.001, 6);
  });

  it('should parse offsets', () => {
    const buffer = loadLasFixture();
    const header = parseLASHeader(buffer);
    expect(header.offset[0]).toBeCloseTo(100.0, 3);
    expect(header.offset[1]).toBeCloseTo(200.0, 3);
    expect(header.offset[2]).toBeCloseTo(50.0, 3);
  });

  it('should parse bounding box', () => {
    const buffer = loadLasFixture();
    const header = parseLASHeader(buffer);
    // Points range: X 0-9, Y 0-9, Z roughly -2 to 5 (sine wave + linear)
    // Real coords: X 100-109, Y 200-209, Z ~48-55
    expect(header.mins[0]).toBeCloseTo(100.0, 1);
    expect(header.maxs[0]).toBeCloseTo(109.0, 1);
    expect(header.mins[1]).toBeCloseTo(200.0, 1);
    expect(header.maxs[1]).toBeCloseTo(209.0, 1);
    expect(header.mins[2]).toBeLessThan(header.maxs[2]);
  });

  it('should reject non-LAS data', () => {
    const garbage = new ArrayBuffer(512);
    const header = parseLASHeader(garbage);
    expect(header.signature).not.toBe('LASF');
  });
});

describe('LAS Point Decoding', () => {

  it('should decode correct number of points', () => {
    const buffer = loadLasFixture();
    const header = parseLASHeader(buffer);
    const result = parseLASPoints(buffer, header);
    expect(result.pointCount).toBe(100);
    expect(result.positions.length).toBe(300); // 100 * 3
  });

  it('should decode XYZ coordinates correctly', () => {
    const buffer = loadLasFixture();
    const header = parseLASHeader(buffer);
    const result = parseLASPoints(buffer, header);

    // First point: (0, 0, sin(0)*2 + 0*0.3) = (0, 0, 0) + offset (100, 200, 50)
    expect(result.positions[0]).toBeCloseTo(100.0, 2); // X
    expect(result.positions[1]).toBeCloseTo(200.0, 2); // Y
    expect(result.positions[2]).toBeCloseTo(50.0, 2);  // Z
  });

  it('should decode point at grid position (5, 5)', () => {
    const buffer = loadLasFixture();
    const header = parseLASHeader(buffer);
    const result = parseLASPoints(buffer, header);

    // Point at index 55 = (5, 5): x=5, y=5, z=sin(2.5)*2 + 5*0.3
    const idx = 55;
    const expectedZ = Math.sin(5 * 0.5) * 2.0 + 5 * 0.3;
    expect(result.positions[idx * 3]).toBeCloseTo(105.0, 2);
    expect(result.positions[idx * 3 + 1]).toBeCloseTo(205.0, 2);
    expect(result.positions[idx * 3 + 2]).toBeCloseTo(50.0 + expectedZ, 2);
  });

  it('should decode RGB colors', () => {
    const buffer = loadLasFixture();
    const header = parseLASHeader(buffer);
    const result = parseLASPoints(buffer, header);

    expect(result.colors).not.toBeNull();
    expect(result.colors.length).toBe(300); // 100 * 3

    // First point (0,0): R=0, G=0, B=low
    expect(result.colors[0]).toBe(0);   // R: i=0 → 0
    expect(result.colors[1]).toBe(0);   // G: j=0 → 0

    // Point (9,0) at index 90: R=max, G=0
    expect(result.colors[90 * 3]).toBe(255); // R: i=9 → 65535 >> 8 = 255
    expect(result.colors[90 * 3 + 1]).toBe(0); // G: j=0 → 0
  });

  it('should produce positions within expected bounds', () => {
    const buffer = loadLasFixture();
    const header = parseLASHeader(buffer);
    const result = parseLASPoints(buffer, header);

    for (let i = 0; i < result.pointCount; i++) {
      const x = result.positions[i * 3];
      const y = result.positions[i * 3 + 1];
      const z = result.positions[i * 3 + 2];
      expect(x).toBeGreaterThanOrEqual(99);
      expect(x).toBeLessThanOrEqual(110);
      expect(y).toBeGreaterThanOrEqual(199);
      expect(y).toBeLessThanOrEqual(210);
      expect(z).toBeGreaterThanOrEqual(45);
      expect(z).toBeLessThanOrEqual(60);
    }
  });
});

describe('Octree Construction', () => {

  /**
   * Simplified octree builder (mirrors worker's buildOctree logic)
   * for testing the algorithm independently of the Web Worker.
   */
  function buildOctree(positions, colors, pointCount) {
    const MAX_POINTS_PER_LEAF = 5000;
    const SUBSAMPLE_SIZE = 5000;

    // Compute bounds
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < pointCount; i++) {
      const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }

    // Make cube
    const maxSize = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
    const half = maxSize / 2 * 1.01;
    const bMin = [cx - half, cy - half, cz - half];
    const bMax = [cx + half, cy + half, cz + half];

    const nodes = [];
    let nextId = 0;

    function subdivide(indices, bboxMin, bboxMax, depth) {
      const nodeId = nextId++;
      const count = indices.length;

      if (count <= MAX_POINTS_PER_LEAF || depth >= 20) {
        const leafPos = new Float32Array(count * 3);
        const leafCol = colors ? new Uint8Array(count * 3) : null;
        for (let i = 0; i < count; i++) {
          const idx = indices[i];
          leafPos[i * 3] = positions[idx * 3];
          leafPos[i * 3 + 1] = positions[idx * 3 + 1];
          leafPos[i * 3 + 2] = positions[idx * 3 + 2];
          if (leafCol) {
            leafCol[i * 3] = colors[idx * 3];
            leafCol[i * 3 + 1] = colors[idx * 3 + 1];
            leafCol[i * 3 + 2] = colors[idx * 3 + 2];
          }
        }
        nodes.push({ id: nodeId, level: depth, isLeaf: true, pointCount: count, positions: leafPos, colors: leafCol, childIds: [-1,-1,-1,-1,-1,-1,-1,-1], bbox: { min: bboxMin, max: bboxMax } });
        return nodeId;
      }

      const midX = (bboxMin[0] + bboxMax[0]) / 2;
      const midY = (bboxMin[1] + bboxMax[1]) / 2;
      const midZ = (bboxMin[2] + bboxMax[2]) / 2;

      // Disjoint subsample
      const subsampleCount = Math.min(SUBSAMPLE_SIZE, count);
      const stride = Math.max(1, Math.floor(count / subsampleCount));
      const subsampledSet = new Set();
      const subPos = new Float32Array(subsampleCount * 3);
      const subCol = colors ? new Uint8Array(subsampleCount * 3) : null;
      for (let i = 0; i < subsampleCount; i++) {
        const pickIdx = Math.min(i * stride, count - 1);
        const srcIdx = indices[pickIdx];
        subPos[i * 3] = positions[srcIdx * 3];
        subPos[i * 3 + 1] = positions[srcIdx * 3 + 1];
        subPos[i * 3 + 2] = positions[srcIdx * 3 + 2];
        if (subCol) {
          subCol[i * 3] = colors[srcIdx * 3];
          subCol[i * 3 + 1] = colors[srcIdx * 3 + 1];
          subCol[i * 3 + 2] = colors[srcIdx * 3 + 2];
        }
        subsampledSet.add(pickIdx);
      }

      const octants = [[], [], [], [], [], [], [], []];
      for (let i = 0; i < count; i++) {
        if (subsampledSet.has(i)) continue;
        const idx = indices[i];
        let octant = 0;
        if (positions[idx * 3] >= midX) octant |= 1;
        if (positions[idx * 3 + 1] >= midY) octant |= 2;
        if (positions[idx * 3 + 2] >= midZ) octant |= 4;
        octants[octant].push(idx);
      }

      const node = { id: nodeId, level: depth, isLeaf: false, pointCount: subsampleCount, positions: subPos, colors: subCol, childIds: [-1,-1,-1,-1,-1,-1,-1,-1], bbox: { min: bboxMin, max: bboxMax } };
      nodes.push(node);

      const childBounds = [
        [bboxMin, [midX, midY, midZ]],
        [[midX, bboxMin[1], bboxMin[2]], [bboxMax[0], midY, midZ]],
        [[bboxMin[0], midY, bboxMin[2]], [midX, bboxMax[1], midZ]],
        [[midX, midY, bboxMin[2]], [bboxMax[0], bboxMax[1], midZ]],
        [[bboxMin[0], bboxMin[1], midZ], [midX, midY, bboxMax[2]]],
        [[midX, bboxMin[1], midZ], [bboxMax[0], midY, bboxMax[2]]],
        [[bboxMin[0], midY, midZ], [midX, bboxMax[1], bboxMax[2]]],
        [[midX, midY, midZ], [bboxMax[0], bboxMax[1], bboxMax[2]]]
      ];

      for (let o = 0; o < 8; o++) {
        if (octants[o].length > 0) {
          node.childIds[o] = subdivide(octants[o], childBounds[o][0], childBounds[o][1], depth + 1);
        }
      }

      return nodeId;
    }

    const allIndices = Array.from({ length: pointCount }, (_, i) => i);
    subdivide(allIndices, bMin, bMax, 0);
    return nodes;
  }

  it('should create at least one node for 100 points', () => {
    const buffer = loadLasFixture();
    const header = parseLASHeader(buffer);
    const result = parseLASPoints(buffer, header);
    const nodes = buildOctree(result.positions, result.colors, result.pointCount);
    expect(nodes.length).toBeGreaterThanOrEqual(1);
  });

  it('should create a leaf node for small point count (100 < 5000)', () => {
    const buffer = loadLasFixture();
    const header = parseLASHeader(buffer);
    const result = parseLASPoints(buffer, header);
    const nodes = buildOctree(result.positions, result.colors, result.pointCount);
    // 100 points < MAX_POINTS_PER_LEAF (5000), so root should be a leaf
    expect(nodes.length).toBe(1);
    expect(nodes[0].isLeaf).toBe(true);
    expect(nodes[0].pointCount).toBe(100);
  });

  it('should have root node at level 0', () => {
    const buffer = loadLasFixture();
    const header = parseLASHeader(buffer);
    const result = parseLASPoints(buffer, header);
    const nodes = buildOctree(result.positions, result.colors, result.pointCount);
    expect(nodes[0].level).toBe(0);
    expect(nodes[0].id).toBe(0);
  });

  it('should preserve all points in leaf nodes (disjoint)', () => {
    const buffer = loadLasFixture();
    const header = parseLASHeader(buffer);
    const result = parseLASPoints(buffer, header);
    const nodes = buildOctree(result.positions, result.colors, result.pointCount);

    let totalPoints = 0;
    for (const node of nodes) {
      totalPoints += node.pointCount;
    }
    expect(totalPoints).toBe(100);
  });

  it('should preserve colors in leaf nodes', () => {
    const buffer = loadLasFixture();
    const header = parseLASHeader(buffer);
    const result = parseLASPoints(buffer, header);
    const nodes = buildOctree(result.positions, result.colors, result.pointCount);

    const leaf = nodes[0]; // single leaf for 100 points
    expect(leaf.colors).not.toBeNull();
    expect(leaf.colors.length).toBe(100 * 3);
  });

  it('should create multiple nodes for larger point sets', () => {
    // Generate 10000 random points (exceeds MAX_POINTS_PER_LEAF=5000)
    const count = 10000;
    const positions = new Float32Array(count * 3);
    const colors = new Uint8Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = Math.random() * 100;
      positions[i * 3 + 1] = Math.random() * 100;
      positions[i * 3 + 2] = Math.random() * 100;
      colors[i * 3] = Math.floor(Math.random() * 256);
      colors[i * 3 + 1] = Math.floor(Math.random() * 256);
      colors[i * 3 + 2] = Math.floor(Math.random() * 256);
    }

    const nodes = buildOctree(positions, colors, count);
    expect(nodes.length).toBeGreaterThan(1);

    // Verify disjoint: total points across all nodes should equal input
    let totalPoints = 0;
    for (const node of nodes) {
      totalPoints += node.pointCount;
    }
    expect(totalPoints).toBe(count);

    // Root should be internal (not leaf)
    expect(nodes[0].isLeaf).toBe(false);

    // All leaves should have <= MAX_POINTS_PER_LEAF points
    for (const node of nodes) {
      if (node.isLeaf) {
        expect(node.pointCount).toBeLessThanOrEqual(5000);
      }
    }
  });

  it('should have valid child references', () => {
    const count = 10000;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = Math.random() * 100;
      positions[i * 3 + 1] = Math.random() * 100;
      positions[i * 3 + 2] = Math.random() * 100;
    }

    const nodes = buildOctree(positions, null, count);
    const nodeIds = new Set(nodes.map(n => n.id));

    for (const node of nodes) {
      for (const childId of node.childIds) {
        if (childId >= 0) {
          expect(nodeIds.has(childId)).toBe(true);
        }
      }
    }
  });
});
