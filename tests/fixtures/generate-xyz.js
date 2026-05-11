#!/usr/bin/env node
/**
 * Generate synthetic XYZ fixtures for testing.
 *
 * Outputs:
 *   - sample-dtm.xyz           — 10×10 column-major grid, EOV coords, with a NODATA patch.
 *   - sample-points.xyz        — 1000 scattered points in a small region.
 *
 * Usage: node tests/fixtures/generate-xyz.js
 */

import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── DTM grid fixture (column-major, Y descending — matches QGIS export style) ──

{
  const NCOLS = 10;
  const NROWS = 10;
  const STEP = 20;
  const X_MIN = 650000;
  const Y_MIN = 240000;
  const Y_MAX = Y_MIN + (NROWS - 1) * STEP;
  const NODATA = -9999;
  const lines = [];
  for (let c = 0; c < NCOLS; c++) {
    const x = X_MIN + c * STEP;
    for (let r = 0; r < NROWS; r++) {
      // file order: Y descends from Y_MAX
      const y = Y_MAX - r * STEP;
      let z;
      if (r >= 3 && r <= 5 && c >= 3 && c <= 5) {
        z = NODATA;
      } else {
        const dx = (c - 4.5) / 4.5;
        const dy = (r - 4.5) / 4.5;
        z = 100 + 20 * Math.exp(-(dx * dx + dy * dy));
      }
      lines.push(`${x.toFixed(2)} ${y.toFixed(2)} ${z === NODATA ? '-9999' : z.toFixed(2)}`);
    }
  }
  const outPath = resolve(__dirname, 'sample-dtm.xyz');
  writeFileSync(outPath, lines.join('\n') + '\n');
  console.log(`Generated ${outPath} (${NCOLS}×${NROWS} grid, column-major, NODATA hole)`);
}

// ─── Scattered point cloud fixture ────────────────────────────────────────────

{
  const N = 1000;
  // Seeded pseudo-random so the fixture is reproducible
  let seed = 42;
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  const lines = [];
  lines.push('# Synthetic scattered XYZ for testing — not a regular grid');
  for (let i = 0; i < N; i++) {
    const x = 650000 + rand() * 200;
    const y = 240000 + rand() * 200;
    const z = 100 + rand() * 30;
    lines.push(`${x.toFixed(2)} ${y.toFixed(2)} ${z.toFixed(2)}`);
  }
  const outPath = resolve(__dirname, 'sample-points.xyz');
  writeFileSync(outPath, lines.join('\n') + '\n');
  console.log(`Generated ${outPath} (${N} scattered points)`);
}
