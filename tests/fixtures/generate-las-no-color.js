#!/usr/bin/env node
/**
 * Generate a minimal synthetic LAS 1.2 Format 0 file (no RGB) for testing.
 * Creates a point cloud with 50 points without colors.
 *
 * Usage: node tests/fixtures/generate-las-no-color.js
 * Output: tests/fixtures/sample-pointcloud-no-color.las
 */

import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const NUM_POINTS = 49;
const POINT_FORMAT = 0;        // XYZ + intensity + classification (no RGB)
const POINT_RECORD_LENGTH = 20;
const HEADER_SIZE = 227;

const scaleX = 0.001, scaleY = 0.001, scaleZ = 0.001;
const offsetX = 100.0, offsetY = 200.0, offsetZ = 50.0;

// Generate points in a grid: ~7x7 points
const points = [];
for (let i = 0; i < 7; i++) {
  for (let j = 0; j < 7 && points.length < NUM_POINTS; j++) {
    const x = i * 1.0;
    const y = j * 1.0;
    const z = Math.sin(i * 0.5) * 2.0 + j * 0.3;
    points.push({ x, y, z, intensity: 500, classification: 2 });
  }
}

// Compute bounds
let minX = Infinity, minY = Infinity, minZ = Infinity;
let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
for (const p of points) {
  const rx = p.x + offsetX, ry = p.y + offsetY, rz = p.z + offsetZ;
  if (rx < minX) minX = rx; if (rx > maxX) maxX = rx;
  if (ry < minY) minY = ry; if (ry > maxY) maxY = ry;
  if (rz < minZ) minZ = rz; if (rz > maxZ) maxZ = rz;
}

// Build header
const headerBuf = Buffer.alloc(HEADER_SIZE);
let off = 0;

headerBuf.write('LASF', 0, 'ascii'); off = 4;
headerBuf.writeUInt16LE(0, off); off += 2;
headerBuf.writeUInt16LE(0, off); off += 2;
off += 16; // GUID
headerBuf.writeUInt8(1, off); off += 1;
headerBuf.writeUInt8(2, off); off += 1;
headerBuf.write('Test', off, 'ascii'); off += 32;
headerBuf.write('generate-las-no-color.js', off, 'ascii'); off += 32;
headerBuf.writeUInt16LE(1, off); off += 2;
headerBuf.writeUInt16LE(2026, off); off += 2;
headerBuf.writeUInt16LE(HEADER_SIZE, off); off += 2;
headerBuf.writeUInt32LE(HEADER_SIZE, off); off += 4;
headerBuf.writeUInt32LE(0, off); off += 4;
headerBuf.writeUInt8(POINT_FORMAT, off); off += 1;
headerBuf.writeUInt16LE(POINT_RECORD_LENGTH, off); off += 2;
headerBuf.writeUInt32LE(NUM_POINTS, off); off += 4;
headerBuf.writeUInt32LE(NUM_POINTS, off); off += 4;
off += 16;

headerBuf.writeDoubleLE(scaleX, off); off += 8;
headerBuf.writeDoubleLE(scaleY, off); off += 8;
headerBuf.writeDoubleLE(scaleZ, off); off += 8;
headerBuf.writeDoubleLE(offsetX, off); off += 8;
headerBuf.writeDoubleLE(offsetY, off); off += 8;
headerBuf.writeDoubleLE(offsetZ, off); off += 8;
headerBuf.writeDoubleLE(maxX, off); off += 8;
headerBuf.writeDoubleLE(minX, off); off += 8;
headerBuf.writeDoubleLE(maxY, off); off += 8;
headerBuf.writeDoubleLE(minY, off); off += 8;
headerBuf.writeDoubleLE(maxZ, off); off += 8;
headerBuf.writeDoubleLE(minZ, off); off += 8;

// Build point data (Format 0: XYZ + intensity + flags + classification + scan angle + user + source)
const pointsBuf = Buffer.alloc(NUM_POINTS * POINT_RECORD_LENGTH);
for (let i = 0; i < NUM_POINTS; i++) {
  const p = points[i];
  const base = i * POINT_RECORD_LENGTH;

  const ix = Math.round(p.x / scaleX);
  const iy = Math.round(p.y / scaleY);
  const iz = Math.round(p.z / scaleZ);

  pointsBuf.writeInt32LE(ix, base);
  pointsBuf.writeInt32LE(iy, base + 4);
  pointsBuf.writeInt32LE(iz, base + 8);
  pointsBuf.writeUInt16LE(p.intensity, base + 12);
  pointsBuf.writeUInt8(0x11, base + 14);
  pointsBuf.writeUInt8(p.classification, base + 15);
  pointsBuf.writeInt8(0, base + 16);
  pointsBuf.writeUInt8(0, base + 17);
  pointsBuf.writeUInt16LE(1, base + 18);
}

const output = Buffer.concat([headerBuf, pointsBuf]);
const outPath = resolve(__dirname, 'sample-pointcloud-no-color.las');
writeFileSync(outPath, output);
console.log(`Generated ${outPath} (${output.length} bytes, ${NUM_POINTS} points)`);
