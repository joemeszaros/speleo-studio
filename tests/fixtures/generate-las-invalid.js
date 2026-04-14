#!/usr/bin/env node
/**
 * Generate invalid/truncated LAS files for error handling tests.
 *
 * Usage: node tests/fixtures/generate-las-invalid.js
 * Output: tests/fixtures/sample-pointcloud-truncated.las
 *         tests/fixtures/sample-pointcloud-corrupt.las
 */

import { writeFileSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// 1. Truncated file: valid header but point data cut short
const validLas = readFileSync(resolve(__dirname, 'sample-pointcloud.las'));
// Cut the file at 70% of point data — creates a truncated file
const headerSize = 227;
const truncateAt = headerSize + Math.floor((validLas.length - headerSize) * 0.3);
const truncated = validLas.subarray(0, truncateAt);
const truncPath = resolve(__dirname, 'sample-pointcloud-truncated.las');
writeFileSync(truncPath, truncated);
console.log(`Generated ${truncPath} (${truncated.length} bytes, truncated from ${validLas.length})`);

// 2. Corrupt file: valid LASF signature but garbage header values
const corrupt = Buffer.alloc(300);
corrupt.write('LASF', 0, 'ascii');
// Version 1.2
corrupt.writeUInt8(1, 24);
corrupt.writeUInt8(2, 25);
// Header size (too large)
corrupt.writeUInt16LE(500, 94);
// Point format (invalid high value)
corrupt.writeUInt8(99, 104);
// Fill rest with random-ish data
for (let i = 100; i < 300; i++) {
  corrupt.writeUInt8(i % 256, i);
}
const corruptPath = resolve(__dirname, 'sample-pointcloud-corrupt.las');
writeFileSync(corruptPath, corrupt);
console.log(`Generated ${corruptPath} (${corrupt.length} bytes, corrupt header)`);
