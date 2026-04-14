#!/usr/bin/env node
/**
 * Generate a minimal synthetic LAS 1.2 Format 2 file for testing.
 * Creates a point cloud with 100 points in a 10x10x5 meter box with RGB colors.
 *
 * Usage: node tests/fixtures/generate-las.js
 * Output: tests/fixtures/sample-pointcloud.las
 */

import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const NUM_POINTS = 100;
const POINT_FORMAT = 2;       // XYZ + intensity + classification + RGB
const POINT_RECORD_LENGTH = 26;
const HEADER_SIZE = 227;

// Scale and offset — use mm precision with a small offset
const scaleX = 0.001, scaleY = 0.001, scaleZ = 0.001;
const offsetX = 100.0, offsetY = 200.0, offsetZ = 50.0;

// Generate points in a grid: 10×10 points, Z varies, with RGB
const points = [];
for (let i = 0; i < 10; i++) {
  for (let j = 0; j < 10; j++) {
    const x = i * 1.0;       // 0-9 meters
    const y = j * 1.0;       // 0-9 meters
    const z = Math.sin(i * 0.5) * 2.0 + j * 0.3; // wavy surface, 0-5m range
    const r = Math.round((i / 9) * 65535);   // red gradient X
    const g = Math.round((j / 9) * 65535);   // green gradient Y
    const b = Math.round(Math.max(0, Math.min(1, (z + 2) / 7)) * 65535); // blue gradient Z (normalized)
    points.push({ x, y, z, r, g, b, intensity: 1000, classification: 2 });
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

// Signature "LASF"
headerBuf.write('LASF', 0, 'ascii'); off = 4;
// File source ID
headerBuf.writeUInt16LE(0, off); off += 2;
// Reserved
headerBuf.writeUInt16LE(0, off); off += 2;
// GUID (16 bytes zero)
off += 16;
// Version major.minor (1.2)
headerBuf.writeUInt8(1, off); off += 1;   // byte 24
headerBuf.writeUInt8(2, off); off += 1;   // byte 25
// System identifier (32 bytes)
headerBuf.write('Test', off, 'ascii'); off += 32;
// Generating software (32 bytes)
headerBuf.write('generate-las.js', off, 'ascii'); off += 32;
// File creation day of year
headerBuf.writeUInt16LE(1, off); off += 2;
// File creation year
headerBuf.writeUInt16LE(2026, off); off += 2;
// Header size
headerBuf.writeUInt16LE(HEADER_SIZE, off); off += 2; // byte 94
// Offset to point data
headerBuf.writeUInt32LE(HEADER_SIZE, off); off += 4; // byte 96
// Number of VLRs
headerBuf.writeUInt32LE(0, off); off += 4;            // byte 100
// Point data format ID
headerBuf.writeUInt8(POINT_FORMAT, off); off += 1;    // byte 104
// Point data record length
headerBuf.writeUInt16LE(POINT_RECORD_LENGTH, off); off += 2; // byte 105
// Number of point records
headerBuf.writeUInt32LE(NUM_POINTS, off); off += 4;          // byte 107
// Number of points by return (5 × uint32)
headerBuf.writeUInt32LE(NUM_POINTS, off); off += 4; // return 1
off += 16; // returns 2-5 = 0

// Scale factors (3 × float64) — byte 131
headerBuf.writeDoubleLE(scaleX, off); off += 8;
headerBuf.writeDoubleLE(scaleY, off); off += 8;
headerBuf.writeDoubleLE(scaleZ, off); off += 8;

// Offsets (3 × float64) — byte 155
headerBuf.writeDoubleLE(offsetX, off); off += 8;
headerBuf.writeDoubleLE(offsetY, off); off += 8;
headerBuf.writeDoubleLE(offsetZ, off); off += 8;

// Bounds: maxX, minX, maxY, minY, maxZ, minZ (6 × float64) — byte 179
headerBuf.writeDoubleLE(maxX, off); off += 8;
headerBuf.writeDoubleLE(minX, off); off += 8;
headerBuf.writeDoubleLE(maxY, off); off += 8;
headerBuf.writeDoubleLE(minY, off); off += 8;
headerBuf.writeDoubleLE(maxZ, off); off += 8;
headerBuf.writeDoubleLE(minZ, off); off += 8;

// Build point data
const pointsBuf = Buffer.alloc(NUM_POINTS * POINT_RECORD_LENGTH);
for (let i = 0; i < NUM_POINTS; i++) {
  const p = points[i];
  const base = i * POINT_RECORD_LENGTH;

  // XYZ as scaled integers: intVal = (realVal - offset) / scale
  const ix = Math.round((p.x + offsetX - offsetX) / scaleX);
  const iy = Math.round((p.y + offsetY - offsetY) / scaleY);
  const iz = Math.round((p.z + offsetZ - offsetZ) / scaleZ);

  pointsBuf.writeInt32LE(ix, base);
  pointsBuf.writeInt32LE(iy, base + 4);
  pointsBuf.writeInt32LE(iz, base + 8);

  // Intensity (uint16)
  pointsBuf.writeUInt16LE(p.intensity, base + 12);

  // Return number (3 bits) | num returns (3 bits) | scan dir (1) | edge (1)
  pointsBuf.writeUInt8(0x11, base + 14); // return 1, 1 return

  // Classification
  pointsBuf.writeUInt8(p.classification, base + 15);

  // Scan angle rank
  pointsBuf.writeInt8(0, base + 16);

  // User data
  pointsBuf.writeUInt8(0, base + 17);

  // Point source ID
  pointsBuf.writeUInt16LE(1, base + 18);

  // RGB (uint16 each) — Format 2 color offset is 20
  pointsBuf.writeUInt16LE(p.r, base + 20);
  pointsBuf.writeUInt16LE(p.g, base + 22);
  pointsBuf.writeUInt16LE(p.b, base + 24);
}

// Write file
const output = Buffer.concat([headerBuf, pointsBuf]);
const outPath = resolve(__dirname, 'sample-pointcloud.las');
writeFileSync(outPath, output);
console.log(`Generated ${outPath} (${output.length} bytes, ${NUM_POINTS} points)`);
