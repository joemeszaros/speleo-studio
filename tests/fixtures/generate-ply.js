#!/usr/bin/env node
/**
 * Generate a synthetic PLY point cloud fixture for testing the octree path.
 * Creates a point cloud with 6000 points (above the 5000 octree threshold).
 *
 * Usage: node tests/fixtures/generate-ply.js
 * Output: tests/fixtures/sample-pointcloud-large.ply
 */

import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const NUM_POINTS = 6000;
const lines = [];

// PLY ASCII header
lines.push('ply');
lines.push('format ascii 1.0');
lines.push('comment Large point cloud for octree testing');
lines.push(`element vertex ${NUM_POINTS}`);
lines.push('property float x');
lines.push('property float y');
lines.push('property float z');
lines.push('property uchar red');
lines.push('property uchar green');
lines.push('property uchar blue');
lines.push('end_header');

// Generate points in a grid pattern
const side = Math.ceil(Math.sqrt(NUM_POINTS));
let count = 0;
for (let i = 0; i < side && count < NUM_POINTS; i++) {
  for (let j = 0; j < side && count < NUM_POINTS; j++) {
    const x = (i / side) * 10.0;
    const y = (j / side) * 10.0;
    const z = Math.sin(i * 0.3) * 2.0 + Math.cos(j * 0.3) * 1.5;
    const r = Math.round((i / side) * 255);
    const g = Math.round((j / side) * 255);
    const b = Math.round(Math.max(0, Math.min(1, (z + 3.5) / 7)) * 255);
    lines.push(`${x.toFixed(4)} ${y.toFixed(4)} ${z.toFixed(4)} ${r} ${g} ${b}`);
    count++;
  }
}

const outPath = resolve(__dirname, 'sample-pointcloud-large.ply');
writeFileSync(outPath, lines.join('\n') + '\n');
console.log(`Generated ${outPath} (${count} points)`);
