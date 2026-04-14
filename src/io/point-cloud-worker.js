// point-cloud-worker.js — Web Worker for point cloud parsing (LAS/LAZ) + octree construction
// Classic worker (non-module) because laz-perf.js uses importScripts()

/* global Module */

// ============================================================================
// LAS Header Parsing
// ============================================================================

function readAs(buf, Type, offset, count) {
  count = count === undefined || count === 0 ? 1 : count;
  const sub = buf.slice(offset, offset + Type.BYTES_PER_ELEMENT * count);
  const r = new Type(sub);
  if (count === undefined || count === 1) return r[0];
  const ret = [];
  for (let i = 0; i < count; i++) ret.push(r[i]);
  return ret;
}

function parseLASHeader(arraybuffer) {
  const o = {};

  // Signature check
  const sig = new Uint8Array(arraybuffer, 0, 4);
  if (String.fromCharCode(sig[0], sig[1], sig[2], sig[3]) !== 'LASF') {
    throw new Error('Not a valid LAS file (missing LASF signature)');
  }

  // Version
  const ver = new Uint8Array(arraybuffer, 24, 2);
  o.versionMajor = ver[0];
  o.versionMinor = ver[1];
  o.version = ver[0] * 10 + ver[1];

  // Point data
  o.pointsOffset = readAs(arraybuffer, Uint32Array, 32 * 3);
  const formatByte = readAs(arraybuffer, Uint8Array, 32 * 3 + 8);
  o.pointsStructSize = readAs(arraybuffer, Uint16Array, 32 * 3 + 8 + 1);

  // Compression detection (bits 6 and 7)
  const bit7 = (formatByte & 0x80) >> 7;
  const bit6 = (formatByte & 0x40) >> 6;
  o.isCompressed = bit7 === 1 || bit6 === 1;
  o.pointsFormatId = formatByte & 0x3f;

  // Point count — legacy (LAS 1.0-1.3)
  o.pointsCount = readAs(arraybuffer, Uint32Array, 32 * 3 + 11);

  // For LAS 1.4, use 64-bit point count at offset 247
  if (o.versionMajor >= 1 && o.versionMinor >= 4) {
    const low = readAs(arraybuffer, Uint32Array, 247);
    const high = readAs(arraybuffer, Uint32Array, 251);
    if (high > 0 || low > o.pointsCount) {
      o.pointsCount = low + high * 4294967296;
    }
  }

  // Scale and offset
  let start = 32 * 3 + 35;
  o.scale = readAs(arraybuffer, Float64Array, start, 3);
  start += 24;
  o.offset = readAs(arraybuffer, Float64Array, start, 3);
  start += 24;

  // Bounds (interleaved: maxX, minX, maxY, minY, maxZ, minZ)
  const bounds = readAs(arraybuffer, Float64Array, start, 6);
  o.maxs = [bounds[0], bounds[2], bounds[4]];
  o.mins = [bounds[1], bounds[3], bounds[5]];

  // Determine if format has RGB color
  o.hasColor = [2, 3, 5, 7, 8, 10].includes(o.pointsFormatId);

  // RGB offset within point record
  if (o.hasColor) {
    switch (o.pointsFormatId) {
      case 2:
        o.colorOffset = 20;
        break;
      case 3:
      case 5:
        o.colorOffset = 28;
        break;
      case 7:
      case 8:
      case 10:
        o.colorOffset = 30;
        break;
      default:
        o.colorOffset = -1;
        o.hasColor = false;
    }
  }

  // Detect 8-bit vs 16-bit colors by sampling the first point's RGB.
  // Some LAS software stores 8-bit values (0-255) in the 16-bit fields.
  if (o.hasColor && o.colorOffset >= 0) {
    const firstPointBase = o.pointsOffset;
    if (firstPointBase + o.colorOffset + 6 <= arraybuffer.byteLength) {
      const view = new DataView(arraybuffer);
      const r = view.getUint16(firstPointBase + o.colorOffset, true);
      const g = view.getUint16(firstPointBase + o.colorOffset + 2, true);
      const b = view.getUint16(firstPointBase + o.colorOffset + 4, true);
      o.color8bit = (r <= 255 && g <= 255 && b <= 255);
    } else {
      o.color8bit = false;
    }
  }

  return o;
}

// ============================================================================
// Point Data Decoding
// ============================================================================

function parseLASPoints(arraybuffer, header, maxPoints) {
  const totalPoints = header.pointsCount;
  let skip = 1;
  if (maxPoints > 0 && totalPoints > maxPoints) {
    skip = Math.ceil(totalPoints / maxPoints);
  }
  const outputCount = Math.ceil(totalPoints / skip);

  const positions = new Float32Array(outputCount * 3);
  const colors = header.hasColor ? new Uint8Array(outputCount * 3) : null;
  const view = new DataView(arraybuffer);
  const pointsOffset = header.pointsOffset;
  const recordSize = header.pointsStructSize;
  const scale = header.scale;
  const hdrOffset = header.offset;
  const colorOff = header.colorOffset;

  // Subtract bounding box center so Float32 positions stay near zero (full precision)
  const cx = (header.mins[0] + header.maxs[0]) / 2;
  const cy = (header.mins[1] + header.maxs[1]) / 2;
  const cz = (header.mins[2] + header.maxs[2]) / 2;

  let written = 0;
  let lastProgress = 0;
  let parseError = null;

  for (let i = 0; i < totalPoints; i++) {
    if (i % skip === 0) {
      try {
        const base = pointsOffset + i * recordSize;

        const ix = view.getInt32(base, true);
        const iy = view.getInt32(base + 4, true);
        const iz = view.getInt32(base + 8, true);

        positions[written * 3] = ix * scale[0] + hdrOffset[0] - cx;
        positions[written * 3 + 1] = iy * scale[1] + hdrOffset[1] - cy;
        positions[written * 3 + 2] = iz * scale[2] + hdrOffset[2] - cz;

        if (colors && colorOff >= 0) {
          const cr = view.getUint16(base + colorOff, true);
          const cg = view.getUint16(base + colorOff + 2, true);
          const cb = view.getUint16(base + colorOff + 4, true);
          colors[written * 3] = header.color8bit ? cr : cr >> 8;
          colors[written * 3 + 1] = header.color8bit ? cg : cg >> 8;
          colors[written * 3 + 2] = header.color8bit ? cb : cb >> 8;
        }

        written++;
      } catch (e) {
        parseError = 'Error reading point ' + i + ': ' + (e.message || e);
        break;
      }
    }

    if (i % 500000 === 0) {
      const pct = Math.round((i / totalPoints) * 100);
      if (pct > lastProgress) {
        lastProgress = pct;
        self.postMessage({ type: 'progress', percent: pct, phase: 'parsing' });
      }
    }
  }

  if (parseError) {
    self.postMessage({ type: 'progress', percent: 100, phase: 'parsing',
      warning: parseError + '. Loaded ' + written + ' of ' + totalPoints + ' points.' });
  }

  // First point in original (non-centered) coordinates for display to user
  const firstPoint = written > 0
    ? [positions[0] + cx, positions[1] + cy, positions[2] + cz]
    : null;

  return { positions, colors, pointCount: written, originalCount: totalPoints, positionOffset: [cx, cy, cz], firstPoint, parseError };
}

function parseLAZPoints(arraybuffer, header, maxPoints) {
  const totalPoints = header.pointsCount;
  let skip = 1;
  if (maxPoints > 0 && totalPoints > maxPoints) {
    skip = Math.ceil(totalPoints / maxPoints);
  }
  const outputCount = Math.ceil(totalPoints / skip);

  const positions = new Float32Array(outputCount * 3);
  const colors = header.hasColor ? new Uint8Array(outputCount * 3) : null;
  const scale = header.scale;
  const hdrOffset = header.offset;
  const colorOff = header.colorOffset;
  const recordSize = header.pointsStructSize;

  // Subtract bounding box center so Float32 positions stay near zero (full precision)
  const cx = (header.mins[0] + header.maxs[0]) / 2;
  const cy = (header.mins[1] + header.maxs[1]) / 2;
  const cz = (header.mins[2] + header.maxs[2]) / 2;

  // Initialize laz-perf LASZip
  const laz = new Module.LASZip();
  const abInt = new Uint8Array(arraybuffer);
  const buf = Module._malloc(arraybuffer.byteLength);
  Module.HEAPU8.set(abInt, buf);
  laz.open(buf, arraybuffer.byteLength);

  const pointBuf = Module._malloc(recordSize);
  let written = 0;
  let lastProgress = 0;

  let parseError = null;
  for (let i = 0; i < totalPoints; i++) {
    try {
      laz.getPoint(pointBuf);
    } catch (e) {
      parseError = 'LAZ decompression error at point ' + i + ' of ' + totalPoints + ': ' + (e.message || e);
      break;
    }

    if (i % skip === 0) {
      try {
        const pointData = new DataView(Module.HEAPU8.buffer, pointBuf, recordSize);

        const ix = pointData.getInt32(0, true);
        const iy = pointData.getInt32(4, true);
        const iz = pointData.getInt32(8, true);

        positions[written * 3] = ix * scale[0] + hdrOffset[0] - cx;
        positions[written * 3 + 1] = iy * scale[1] + hdrOffset[1] - cy;
        positions[written * 3 + 2] = iz * scale[2] + hdrOffset[2] - cz;

        if (colors && colorOff >= 0) {
          const cr = pointData.getUint16(colorOff, true);
          const cg = pointData.getUint16(colorOff + 2, true);
          const cb = pointData.getUint16(colorOff + 4, true);
          colors[written * 3] = header.color8bit ? cr : cr >> 8;
          colors[written * 3 + 1] = header.color8bit ? cg : cg >> 8;
          colors[written * 3 + 2] = header.color8bit ? cb : cb >> 8;
        }

        written++;
      } catch (e) {
        parseError = 'Error reading point ' + i + ': ' + (e.message || e);
        break;
      }
    }

    if (i % 500000 === 0) {
      const pct = Math.round((i / totalPoints) * 100);
      if (pct > lastProgress) {
        lastProgress = pct;
        self.postMessage({ type: 'progress', percent: pct, phase: 'decompressing' });
      }
    }
  }

  if (parseError) {
    self.postMessage({ type: 'progress', percent: 100, phase: 'decompressing',
      warning: parseError + '. Loaded ' + written + ' of ' + totalPoints + ' points.' });
  }

  Module._free(pointBuf);
  Module._free(buf);
  laz.delete();

  const firstPoint = written > 0
    ? [positions[0] + cx, positions[1] + cy, positions[2] + cz]
    : null;

  return { positions, colors, pointCount: written, originalCount: totalPoints, positionOffset: [cx, cy, cz], firstPoint, parseError };
}

// ============================================================================
// Octree Construction
// ============================================================================

const MAX_POINTS_PER_LEAF = 5000;
const MAX_DEPTH = 20;
const SUBSAMPLE_SIZE = 5000;

function buildOctree(positions, colors, pointCount, header) {
  let mins = [header.mins[0], header.mins[1], header.mins[2]];
  let maxs = [header.maxs[0], header.maxs[1], header.maxs[2]];

  // Make the bounding box a cube (required for proper octree subdivision)
  const sizeX = maxs[0] - mins[0];
  const sizeY = maxs[1] - mins[1];
  const sizeZ = maxs[2] - mins[2];
  const maxSize = Math.max(sizeX, sizeY, sizeZ);

  const centerX = (mins[0] + maxs[0]) / 2;
  const centerY = (mins[1] + maxs[1]) / 2;
  const centerZ = (mins[2] + maxs[2]) / 2;
  const halfSize = (maxSize / 2) * 1.01; // 1% padding to avoid edge cases

  mins = [centerX - halfSize, centerY - halfSize, centerZ - halfSize];
  maxs = [centerX + halfSize, centerY + halfSize, centerZ + halfSize];

  const nodes = [];
  let nextId = 0;

  function subdivide(nodeIndices, bboxMin, bboxMax, depth) {
    const nodeId = nextId++;
    const count = nodeIndices.length;

    // Report progress occasionally
    if (nodeId % 50 === 0) {
      self.postMessage({
        type      : 'progress',
        percent   : Math.min(99, Math.round((nodes.length / (pointCount / MAX_POINTS_PER_LEAF)) * 100)),
        phase     : 'octree',
        nodeCount : nodes.length
      });
    }

    // Leaf node: store all points
    if (count <= MAX_POINTS_PER_LEAF || depth >= MAX_DEPTH) {
      const leafPositions = new Float32Array(count * 3);
      const leafColors = colors ? new Uint8Array(count * 3) : null;

      for (let i = 0; i < count; i++) {
        const idx = nodeIndices[i];
        leafPositions[i * 3] = positions[idx * 3];
        leafPositions[i * 3 + 1] = positions[idx * 3 + 1];
        leafPositions[i * 3 + 2] = positions[idx * 3 + 2];
        if (leafColors) {
          leafColors[i * 3] = colors[idx * 3];
          leafColors[i * 3 + 1] = colors[idx * 3 + 1];
          leafColors[i * 3 + 2] = colors[idx * 3 + 2];
        }
      }

      nodes.push({
        id         : nodeId,
        level      : depth,
        bbox       : { min: bboxMin.slice(), max: bboxMax.slice() },
        childIds   : [-1, -1, -1, -1, -1, -1, -1, -1],
        isLeaf     : true,
        pointCount : count,
        positions  : leafPositions,
        colors     : leafColors
      });

      return nodeId;
    }

    // Internal node: subdivide into 8 octants
    const midX = (bboxMin[0] + bboxMax[0]) / 2;
    const midY = (bboxMin[1] + bboxMax[1]) / 2;
    const midZ = (bboxMin[2] + bboxMax[2]) / 2;

    // Pick disjoint subsample FIRST, before sorting into octants.
    // These points belong to THIS node only — they won't be passed to children.
    const subsampleCount = Math.min(SUBSAMPLE_SIZE, count);
    const subsamplePositions = new Float32Array(subsampleCount * 3);
    const subsampleColors = colors ? new Uint8Array(subsampleCount * 3) : null;
    const subsampledSet = new Set();

    const stride = Math.max(1, Math.floor(count / subsampleCount));
    for (let si = 0; si < subsampleCount; si++) {
      const pickIdx = Math.min(si * stride, count - 1);
      const srcIdx = nodeIndices[pickIdx];
      subsamplePositions[si * 3] = positions[srcIdx * 3];
      subsamplePositions[si * 3 + 1] = positions[srcIdx * 3 + 1];
      subsamplePositions[si * 3 + 2] = positions[srcIdx * 3 + 2];
      if (subsampleColors) {
        subsampleColors[si * 3] = colors[srcIdx * 3];
        subsampleColors[si * 3 + 1] = colors[srcIdx * 3 + 1];
        subsampleColors[si * 3 + 2] = colors[srcIdx * 3 + 2];
      }
      subsampledSet.add(pickIdx);
    }

    // Sort remaining points (excluding subsample) into 8 octants
    const octants = [[], [], [], [], [], [], [], []];
    for (let pi = 0; pi < count; pi++) {
      if (subsampledSet.has(pi)) continue;

      const idx = nodeIndices[pi];
      const px = positions[idx * 3];
      const py = positions[idx * 3 + 1];
      const pz = positions[idx * 3 + 2];

      let octant = 0;
      if (px >= midX) octant |= 1;
      if (py >= midY) octant |= 2;
      if (pz >= midZ) octant |= 4;

      octants[octant].push(idx);
    }

    const node = {
      id         : nodeId,
      level      : depth,
      bbox       : { min: bboxMin.slice(), max: bboxMax.slice() },
      childIds   : [-1, -1, -1, -1, -1, -1, -1, -1],
      isLeaf     : false,
      pointCount : subsampleCount,
      positions  : subsamplePositions,
      colors     : subsampleColors
    };
    nodes.push(node);

    // Recurse into non-empty octants
    const childBounds = [
      [
        [bboxMin[0], bboxMin[1], bboxMin[2]],
        [midX, midY, midZ]
      ],
      [
        [midX, bboxMin[1], bboxMin[2]],
        [bboxMax[0], midY, midZ]
      ],
      [
        [bboxMin[0], midY, bboxMin[2]],
        [midX, bboxMax[1], midZ]
      ],
      [
        [midX, midY, bboxMin[2]],
        [bboxMax[0], bboxMax[1], midZ]
      ],
      [
        [bboxMin[0], bboxMin[1], midZ],
        [midX, midY, bboxMax[2]]
      ],
      [
        [midX, bboxMin[1], midZ],
        [bboxMax[0], midY, bboxMax[2]]
      ],
      [
        [bboxMin[0], midY, midZ],
        [midX, bboxMax[1], bboxMax[2]]
      ],
      [
        [midX, midY, midZ],
        [bboxMax[0], bboxMax[1], bboxMax[2]]
      ]
    ];

    for (let oi = 0; oi < 8; oi++) {
      if (octants[oi].length > 0) {
        node.childIds[oi] = subdivide(octants[oi], childBounds[oi][0], childBounds[oi][1], depth + 1);
      }
    }

    return nodeId;
  }

  const allIndices = [];
  for (let i = 0; i < pointCount; i++) allIndices.push(i);

  subdivide(allIndices, mins, maxs, 0);

  return nodes;
}

// ============================================================================
// Z-Height Gradient Colors
// ============================================================================

function applyGradientColors(nodes, colorStart, colorEnd) {
  let minZ = Infinity,
    maxZ = -Infinity;
  for (let n = 0; n < nodes.length; n++) {
    const pos = nodes[n].positions;
    for (let i = 2; i < pos.length; i += 3) {
      if (pos[i] < minZ) minZ = pos[i];
      if (pos[i] > maxZ) maxZ = pos[i];
    }
  }

  const rangeZ = maxZ - minZ || 1;

  const sr = parseInt(colorStart.slice(1, 3), 16);
  const sg = parseInt(colorStart.slice(3, 5), 16);
  const sb = parseInt(colorStart.slice(5, 7), 16);
  const er = parseInt(colorEnd.slice(1, 3), 16);
  const eg = parseInt(colorEnd.slice(3, 5), 16);
  const eb = parseInt(colorEnd.slice(5, 7), 16);

  for (let n = 0; n < nodes.length; n++) {
    const node = nodes[n];
    const pos = node.positions;
    const count = pos.length / 3;
    const nodeColors = new Uint8Array(count * 3);

    for (let i = 0; i < count; i++) {
      const t = (pos[i * 3 + 2] - minZ) / rangeZ;
      nodeColors[i * 3] = Math.round(sr + (er - sr) * t);
      nodeColors[i * 3 + 1] = Math.round(sg + (eg - sg) * t);
      nodeColors[i * 3 + 2] = Math.round(sb + (eb - sb) * t);
    }

    node.colors = nodeColors;
  }
}

// ============================================================================
// Shared: Collect transferables and serialize nodes for postMessage
// ============================================================================

function sendOctreeResult(nodes, header, hasColors, totalPoints, displayedPoints, firstPoint, warning) {
  const transferables = [];
  for (let i = 0; i < nodes.length; i++) {
    transferables.push(nodes[i].positions.buffer);
    if (nodes[i].colors) transferables.push(nodes[i].colors.buffer);
  }

  const serializedNodes = nodes.map(function (n) {
    return {
      id         : n.id,
      level      : n.level,
      bbox       : n.bbox,
      childIds   : n.childIds,
      isLeaf     : n.isLeaf,
      pointCount : n.pointCount,
      positions  : n.positions,
      colors     : n.colors
    };
  });

  self.postMessage(
    {
      type            : 'result',
      nodes           : serializedNodes,
      header          : header,
      hasColors       : hasColors,
      totalPoints     : totalPoints,
      displayedPoints : displayedPoints,
      nodeCount       : nodes.length,
      firstPoint      : firstPoint || null,
      warning         : warning || null
    },
    transferables
  );
}

// ============================================================================
// Worker Message Handler
// ============================================================================

let lazPerfLoaded = false;

onmessage = function (event) {
  const msg = event.data;

  if (msg.type === 'build-octree') {
    handleBuildOctree(msg);
    return;
  }

  if (msg.type === 'parse') {
    handleParseLAS(msg);
    return;
  }
};

function handleBuildOctree(msg) {
  try {
    const positions = new Float32Array(msg.positions);
    const colors = msg.colors ? new Uint8Array(msg.colors) : null;
    const pointCount = msg.pointCount;
    const colorStart = msg.colorStart || '#39b14d';
    const colorEnd = msg.colorEnd || '#9f2d2d';
    const hasColors = msg.hasColors;
    const header = { mins: msg.bounds.min, maxs: msg.bounds.max };

    self.postMessage({ type: 'progress', percent: 0, phase: 'octree' });

    const nodes = buildOctree(positions, colors, pointCount, header);

    if (!hasColors) {
      applyGradientColors(nodes, colorStart, colorEnd);
    }

    self.postMessage({ type: 'progress', percent: 100, phase: 'done' });

    sendOctreeResult(nodes, { mins: header.mins, maxs: header.maxs }, hasColors, pointCount, pointCount);
  } catch (e) {
    self.postMessage({ type: 'error', message: e.message || String(e) });
  }
}

function handleParseLAS(msg) {
  try {
    const arraybuffer = msg.buffer;
    const maxPoints = msg.maxPoints || 20000000;
    const colorStart = msg.colorStart || '#39b14d';
    const colorEnd = msg.colorEnd || '#9f2d2d';

    // Phase 1: Parse header
    self.postMessage({ type: 'progress', percent: 0, phase: 'header' });
    const header = parseLASHeader(arraybuffer);

    // Phase 1: Parse/decompress points
    let result;
    if (header.isCompressed) {
      if (!lazPerfLoaded) {
        // The worker is at src/io/point-cloud-worker.js, laz-perf is at dependencies/laz-perf/laz-perf.js
        importScripts('../../dependencies/laz-perf/laz-perf.js');
        lazPerfLoaded = true;
      }
      result = parseLAZPoints(arraybuffer, header, maxPoints);
    } else {
      result = parseLASPoints(arraybuffer, header, maxPoints);
    }

    if (result.pointCount === 0) {
      self.postMessage({ type: 'error', message: 'No points could be read from the file.' });
      return;
    }

    self.postMessage({ type: 'progress', percent: 100, phase: 'octree' });

    // Build octree with centered bounds (positions are already centered)
    const po = result.positionOffset;
    const centeredHeader = {
      mins : [header.mins[0] - po[0], header.mins[1] - po[1], header.mins[2] - po[2]],
      maxs : [header.maxs[0] - po[0], header.maxs[1] - po[1], header.maxs[2] - po[2]]
    };
    const nodes = buildOctree(result.positions, result.colors, result.pointCount, centeredHeader);

    if (!header.hasColor) {
      applyGradientColors(nodes, colorStart, colorEnd);
    }

    self.postMessage({ type: 'progress', percent: 100, phase: 'done' });

    sendOctreeResult(
      nodes,
      {
        versionMajor   : header.versionMajor,
        versionMinor   : header.versionMinor,
        pointsFormatId : header.pointsFormatId,
        isCompressed   : header.isCompressed,
        mins           : centeredHeader.mins,
        maxs           : centeredHeader.maxs,
        positionOffset : po,
        scale          : header.scale,
        offset         : header.offset
      },
      header.hasColor,
      result.originalCount,
      result.pointCount,
      result.firstPoint,
      result.parseError
    );
  } catch (e) {
    self.postMessage({ type: 'error', message: e.message || String(e) });
  }
}
