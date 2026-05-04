#!/usr/bin/env node
/**
 * Generate ESRI ASCII Grid (.asc) DTM fixtures for testing.
 *
 * Usage: node tests/fixtures/generate-asc.js
 * Outputs:
 *   - sample-dtm.asc       — 10x10 grid, mix of valid + NODATA cells
 *   - sample-dtm-large.asc — 50x50 grid for the point-cloud octree path
 */

import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function buildAsc({ ncols, nrows, xllcorner, yllcorner, cellsize, nodata, elevations }) {
  const lines = [];
  lines.push(`ncols         ${ncols}`);
  lines.push(`nrows         ${nrows}`);
  lines.push(`xllcorner     ${xllcorner}`);
  lines.push(`yllcorner     ${yllcorner}`);
  lines.push(`cellsize      ${cellsize}`);
  lines.push(`NODATA_value  ${nodata}`);
  for (let r = 0; r < nrows; r++) {
    const row = [];
    for (let c = 0; c < ncols; c++) {
      const v = elevations[r * ncols + c];
      row.push(Number.isNaN(v) ? String(nodata) : v.toFixed(2));
    }
    lines.push(row.join(' '));
  }
  return lines.join('\n') + '\n';
}

// Small fixture: 10x10 with a NODATA patch in the middle
{
  const ncols = 10, nrows = 10;
  const elevations = new Float32Array(ncols * nrows);
  for (let r = 0; r < nrows; r++) {
    for (let c = 0; c < ncols; c++) {
      // Smooth dome-like surface
      const dx = (c - 4.5) / 4.5;
      const dy = (r - 4.5) / 4.5;
      elevations[r * ncols + c] = 100 + 20 * Math.exp(-(dx * dx + dy * dy));
    }
  }
  // Punch a NODATA hole at cells (3..5, 3..5)
  for (let r = 3; r <= 5; r++) {
    for (let c = 3; c <= 5; c++) {
      elevations[r * ncols + c] = NaN;
    }
  }
  const text = buildAsc({
    ncols, nrows,
    xllcorner : 650000,
    yllcorner : 240000,
    cellsize  : 5,
    nodata    : -9999,
    elevations
  });
  const outPath = resolve(__dirname, 'sample-dtm.asc');
  writeFileSync(outPath, text);
  console.log(`Generated ${outPath} (${ncols}x${nrows}, with NODATA hole)`);
}

// Larger fixture: 50x50 to exercise the point-cloud octree path (>5000 points)
{
  const ncols = 80, nrows = 80; // 6400 cells > 5000 threshold
  const elevations = new Float32Array(ncols * nrows);
  for (let r = 0; r < nrows; r++) {
    for (let c = 0; c < ncols; c++) {
      elevations[r * ncols + c] = 200 + 15 * Math.sin(c * 0.2) + 10 * Math.cos(r * 0.18);
    }
  }
  const text = buildAsc({
    ncols, nrows,
    xllcorner : 650000,
    yllcorner : 240000,
    cellsize  : 2,
    nodata    : -9999,
    elevations
  });
  const outPath = resolve(__dirname, 'sample-dtm-large.asc');
  writeFileSync(outPath, text);
  console.log(`Generated ${outPath} (${ncols}x${nrows})`);
}
