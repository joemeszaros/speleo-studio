#!/usr/bin/env node
/**
 * Generate a synthetic SRTM HGT fixture for testing.
 *
 * Real SRTM tiles are 1201²×2 = 2.9MB or 3601²×2 = 26MB. For tests we use a
 * non-standard 121×121 size — the HGT importer accepts any byteLength = 2*dim²
 * (see HgtDTMImporter.detectDim).
 *
 * Usage: node tests/fixtures/generate-hgt.js
 * Output: tests/fixtures/N47E019.hgt (121×121, ~29 KB, with NODATA patch)
 */

import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DIM = 121;
const NODATA = -32768;

const buf = Buffer.alloc(DIM * DIM * 2);

for (let r = 0; r < DIM; r++) {
  for (let c = 0; c < DIM; c++) {
    let z;
    // Punch a NODATA patch around (60..70, 60..70)
    if (r >= 60 && r <= 70 && c >= 60 && c <= 70) {
      z = NODATA;
    } else {
      // Gentle sin/cos surface — values stay well within int16 range
      const dx = (c - 60) / 60;
      const dy = (r - 60) / 60;
      z = Math.round(300 + 80 * Math.sin(dx * 3) + 60 * Math.cos(dy * 3));
    }
    // big-endian int16
    buf.writeInt16BE(z, (r * DIM + c) * 2);
  }
}

const outPath = resolve(__dirname, 'N47E019.hgt');
writeFileSync(outPath, buf);
console.log(`Generated ${outPath} (${DIM}×${DIM}, ${buf.byteLength} bytes, with NODATA patch)`);
