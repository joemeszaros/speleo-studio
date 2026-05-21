#!/usr/bin/env node
/**
 * Generate synthetic GeoTIFF fixtures for testing.
 *
 * Outputs:
 *   - sample-dtm-eov.tif           — 50×50 Float32 elevation grid, EPSG:23700 (EOV),
 *                                    with a NODATA patch (r=22..27, c=22..27).
 *   - sample-orthophoto-eov.tif    — 100×100 RGB Uint8 photo, EPSG:23700 (EOV),
 *                                    bbox exactly matches sample-dtm-eov.tif so
 *                                    auto-drape kicks in when both are loaded.
 *   - sample-orthophoto-mercator.tif — 100×100 RGB Uint8 photo, EPSG:3857
 *                                      (Web Mercator), exercises the EPSG:3857
 *                                      → WGS84 → project-CS path.
 *
 * Why manual: geotiff.js v2.1.3's writeArrayBuffer is hard-coded to write 8-bit
 * samples (treats values as Uint8 regardless of BitsPerSample) and doesn't
 * configure RGB photometric interpretation correctly. Real DTMs need Float32
 * elevations and orthophotos need PI=2, so we emit minimal GeoTIFFs by hand.
 *
 * Usage: node tests/fixtures/generate-geotiff.js
 */

import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Minimal GeoTIFF writer (little-endian, classic TIFF, single strip) ──

const TIFF_TYPES = {
  BYTE   : { id: 1,  size: 1 },
  ASCII  : { id: 2,  size: 1 },
  SHORT  : { id: 3,  size: 2 },
  LONG   : { id: 4,  size: 4 },
  DOUBLE : { id: 12, size: 8 }
};

/**
 * Build a minimal GeoTIFF byte array.
 *
 * @param {Object} opts
 * @param {number} opts.ncols
 * @param {number} opts.nrows
 * @param {number} opts.samplesPerPixel  1 = single-band, 3 = RGB, 4 = RGBA
 * @param {number} opts.bitsPerSample    8 (uint), 16, 32 (float for DTM)
 * @param {1|3}    opts.sampleFormat     1 = uint, 3 = float
 * @param {1|2}    opts.photometric      1 = BlackIsZero (DTM), 2 = RGB
 * @param {number} opts.xOrigin          easting of the top-left corner
 * @param {number} opts.yTop             northing of the top edge
 * @param {number} opts.xStep
 * @param {number} opts.yStep
 * @param {number} opts.epsg             ProjectedCSTypeGeoKey value
 * @param {Uint8Array} opts.rasterBytes  pre-packed strip data, length = ncols*nrows*samplesPerPixel*(bitsPerSample/8)
 * @param {string|null} opts.gdalNodata  e.g. "-9999" or null to omit
 */
function buildGeotiff(opts) {
  const {
    ncols, nrows, samplesPerPixel, bitsPerSample, sampleFormat,
    photometric, xOrigin, yTop, xStep, yStep, epsg, rasterBytes, gdalNodata
  } = opts;

  // External blobs go AFTER the IFD; raster goes last.
  const modelPixelScale = new Float64Array([xStep, yStep, 0]);
  const modelTiepoint   = new Float64Array([0, 0, 0, xOrigin, yTop, 0]);
  // GeoKeyDirectory: header (4 shorts) + 1 entry (4 shorts) for ProjectedCSTypeGeoKey.
  //   Header   = [KeyDirectoryVersion=1, KeyRevision=1, MinorRevision=0, NumberOfKeys=1]
  //   Entry    = [KeyID=3072 (ProjectedCSTypeGeoKey), TIFFTagLocation=0, Count=1, ValueOffset=EPSG]
  const geoKeyDir = new Uint16Array([1, 1, 0, 1, 3072, 0, 1, epsg]);
  // For multi-band, BitsPerSample and SampleFormat need samplesPerPixel values.
  const bpsArr = new Uint16Array(samplesPerPixel).fill(bitsPerSample);
  const sfArr  = new Uint16Array(samplesPerPixel).fill(sampleFormat);

  const nodataAscii = gdalNodata ? new TextEncoder().encode(gdalNodata + '\0') : null;

  // Tag-list construction. Each tag descriptor: { tag, type, count, valueWriter, externalBlob? }
  // - inline (count*typeSize <= 4): write value into the entry's 4-byte slot.
  // - external: lay out blob after IFD, write offset into the entry's slot.
  const tagDefs = [
    { tag: 256,   type: TIFF_TYPES.SHORT,  count: 1, inline: (dv, off) => dv.setUint16(off, ncols, true) },
    { tag: 257,   type: TIFF_TYPES.SHORT,  count: 1, inline: (dv, off) => dv.setUint16(off, nrows, true) }
  ];
  if (samplesPerPixel === 1) {
    tagDefs.push({ tag: 258, type: TIFF_TYPES.SHORT, count: 1, inline: (dv, off) => dv.setUint16(off, bitsPerSample, true) });
  } else {
    // BitsPerSample is a 3+ short array — needs external blob
    tagDefs.push({ tag: 258, type: TIFF_TYPES.SHORT, count: samplesPerPixel, external: new Uint8Array(bpsArr.buffer) });
  }
  tagDefs.push(
    { tag: 259, type: TIFF_TYPES.SHORT, count: 1, inline: (dv, off) => dv.setUint16(off, 1, true) },                  // Compression
    { tag: 262, type: TIFF_TYPES.SHORT, count: 1, inline: (dv, off) => dv.setUint16(off, photometric, true) },         // PhotometricInterpretation
    { tag: 273, type: TIFF_TYPES.LONG,  count: 1, kind: 'strip-offset' },                                              // StripOffsets — filled in later
    { tag: 277, type: TIFF_TYPES.SHORT, count: 1, inline: (dv, off) => dv.setUint16(off, samplesPerPixel, true) },     // SamplesPerPixel
    { tag: 278, type: TIFF_TYPES.SHORT, count: 1, inline: (dv, off) => dv.setUint16(off, nrows, true) },               // RowsPerStrip
    { tag: 279, type: TIFF_TYPES.LONG,  count: 1, inline: (dv, off) => dv.setUint32(off, rasterBytes.length, true) }   // StripByteCounts
  );
  tagDefs.push(
    { tag: 284, type: TIFF_TYPES.SHORT, count: 1, inline: (dv, off) => dv.setUint16(off, 1, true) }                    // PlanarConfiguration: chunky
  );
  if (samplesPerPixel === 1) {
    tagDefs.push({ tag: 339, type: TIFF_TYPES.SHORT, count: 1, inline: (dv, off) => dv.setUint16(off, sampleFormat, true) });
  } else {
    tagDefs.push({ tag: 339, type: TIFF_TYPES.SHORT, count: samplesPerPixel, external: new Uint8Array(sfArr.buffer) });
  }
  tagDefs.push(
    { tag: 33550, type: TIFF_TYPES.DOUBLE, count: 3, external: new Uint8Array(modelPixelScale.buffer) },
    { tag: 33922, type: TIFF_TYPES.DOUBLE, count: 6, external: new Uint8Array(modelTiepoint.buffer) },
    { tag: 34735, type: TIFF_TYPES.SHORT,  count: 8, external: new Uint8Array(geoKeyDir.buffer) }
  );
  if (nodataAscii) {
    tagDefs.push({ tag: 42113, type: TIFF_TYPES.ASCII, count: nodataAscii.length, external: nodataAscii });
  }

  const entryCount = tagDefs.length;
  const ifdBytes = 2 + entryCount * 12 + 4;
  const ifdStart = 8;
  let extOff = ifdStart + ifdBytes;

  // Assign offsets for external blobs
  for (const t of tagDefs) {
    if (t.external) {
      t.externalOffset = extOff;
      extOff += t.external.byteLength;
      // pad to even byte boundary (TIFF convention, though not strictly required)
      if (extOff % 2 !== 0) extOff++;
    }
  }
  const stripOffset = extOff;
  const totalBytes = stripOffset + rasterBytes.length;

  const buf = new ArrayBuffer(totalBytes);
  const u8 = new Uint8Array(buf);
  const dv = new DataView(buf);

  // Header
  u8[0] = 0x49; u8[1] = 0x49;
  dv.setUint16(2, 42, true);
  dv.setUint32(4, ifdStart, true);

  // IFD: entry count
  dv.setUint16(ifdStart, entryCount, true);
  let entryOff = ifdStart + 2;
  for (const t of tagDefs) {
    dv.setUint16(entryOff, t.tag, true);
    dv.setUint16(entryOff + 2, t.type.id, true);
    dv.setUint32(entryOff + 4, t.count, true);
    dv.setUint32(entryOff + 8, 0, true);
    if (t.kind === 'strip-offset') {
      dv.setUint32(entryOff + 8, stripOffset, true);
    } else if (t.external) {
      dv.setUint32(entryOff + 8, t.externalOffset, true);
    } else {
      t.inline(dv, entryOff + 8);
    }
    entryOff += 12;
  }
  dv.setUint32(ifdStart + 2 + entryCount * 12, 0, true);

  // External blobs
  for (const t of tagDefs) {
    if (t.external) {
      u8.set(t.external, t.externalOffset);
    }
  }
  // Raster
  u8.set(rasterBytes, stripOffset);

  return { bytes: Buffer.from(buf), totalBytes };
}

// ─── 1. sample-dtm-eov.tif — Float32 elevation ───────────────────────────

{
  const NCOLS = 50, NROWS = 50, STEP = 20;
  const X_MIN = 650000, Y_TOP = 241000;
  const NODATA = -9999;
  const samples = new Float32Array(NCOLS * NROWS);
  for (let r = 0; r < NROWS; r++) {
    for (let c = 0; c < NCOLS; c++) {
      if (r >= 22 && r <= 27 && c >= 22 && c <= 27) {
        samples[r * NCOLS + c] = NODATA;
      } else {
        const dx = (c - 25) / 25;
        const dy = (r - 25) / 25;
        samples[r * NCOLS + c] = 100 + 40 * Math.exp(-(dx * dx + dy * dy));
      }
    }
  }
  const out = buildGeotiff({
    ncols           : NCOLS,
    nrows           : NROWS,
    samplesPerPixel : 1,
    bitsPerSample   : 32,
    sampleFormat    : 3,   // float
    photometric     : 1,   // BlackIsZero
    xOrigin         : X_MIN,
    yTop            : Y_TOP,
    xStep           : STEP,
    yStep           : STEP,
    epsg            : 23700,
    rasterBytes     : new Uint8Array(samples.buffer),
    gdalNodata      : String(NODATA)
  });
  const p = resolve(__dirname, 'sample-dtm-eov.tif');
  writeFileSync(p, out.bytes);
  console.log(`Generated ${p} (${NCOLS}×${NROWS}, Float32, EPSG:23700, ${out.totalBytes} bytes)`);
}

// ─── 2. sample-orthophoto-eov.tif — RGB Uint8, same bbox as the DTM ─────

{
  const NCOLS = 100, NROWS = 100, STEP = 10;
  const X_MIN = 650000, Y_TOP = 241000;     // bbox matches the DTM exactly (1km × 1km)
  // Colored 4×4 cell grid pattern so the texture is visually obvious when draped.
  const cellPx = NCOLS / 4;
  const palette = [
    [220, 60, 60],   // red
    [60, 180, 60],   // green
    [60, 60, 220],   // blue
    [220, 200, 60]   // yellow
  ];
  const bytes = new Uint8Array(NCOLS * NROWS * 3);
  for (let r = 0; r < NROWS; r++) {
    for (let c = 0; c < NCOLS; c++) {
      const cellR = Math.floor(r / cellPx);
      const cellC = Math.floor(c / cellPx);
      const colour = palette[((cellR + cellC) * 2) % 4];
      const i = (r * NCOLS + c) * 3;
      bytes[i] = colour[0]; bytes[i + 1] = colour[1]; bytes[i + 2] = colour[2];
    }
  }
  const out = buildGeotiff({
    ncols: NCOLS, nrows: NROWS,
    samplesPerPixel : 3,
    bitsPerSample   : 8,
    sampleFormat    : 1,     // uint
    photometric     : 2,     // RGB
    xOrigin         : X_MIN,
    yTop            : Y_TOP,
    xStep           : STEP,
    yStep           : STEP,
    epsg            : 23700,
    rasterBytes     : bytes,
    gdalNodata      : null
  });
  const p = resolve(__dirname, 'sample-orthophoto-eov.tif');
  writeFileSync(p, out.bytes);
  console.log(`Generated ${p} (${NCOLS}×${NROWS}, RGB Uint8, EPSG:23700, ${out.totalBytes} bytes)`);
}

// ─── 3. sample-orthophoto-mercator.tif — RGB Uint8 in EPSG:3857 ─────────

{
  const NCOLS = 100, NROWS = 100;
  // Centre the photo near the user's beach file (~52.498°N, 4.587°E) so a
  // real-world DEM tile covering this lat/lon (e.g. N52E004.hgt) overlaps.
  // Convert to Web Mercator metres:
  //   x = lon * π/180 * R
  //   y = asinh(tan(lat * π/180)) * R          (R = 6378137)
  const R = 6378137;
  const lonCenter = 4.587;
  const latCenter = 52.498;
  const xCenter = lonCenter * Math.PI / 180 * R;
  const yCenter = Math.asinh(Math.tan(latCenter * Math.PI / 180)) * R;
  const widthMeters = 1000;
  const heightMeters = 1000;
  const STEP = widthMeters / NCOLS;
  const X_MIN = xCenter - widthMeters / 2;
  const Y_TOP = yCenter + heightMeters / 2;

  // Same colored cell grid pattern
  const cellPx = NCOLS / 4;
  const palette = [
    [220, 60, 60],
    [60, 180, 60],
    [60, 60, 220],
    [220, 200, 60]
  ];
  const bytes = new Uint8Array(NCOLS * NROWS * 3);
  for (let r = 0; r < NROWS; r++) {
    for (let c = 0; c < NCOLS; c++) {
      const cellR = Math.floor(r / cellPx);
      const cellC = Math.floor(c / cellPx);
      const colour = palette[((cellR + cellC) * 2) % 4];
      const i = (r * NCOLS + c) * 3;
      bytes[i] = colour[0]; bytes[i + 1] = colour[1]; bytes[i + 2] = colour[2];
    }
  }

  const out = buildGeotiff({
    ncols: NCOLS, nrows: NROWS,
    samplesPerPixel : 3,
    bitsPerSample   : 8,
    sampleFormat    : 1,
    photometric     : 2,
    xOrigin         : X_MIN,
    yTop            : Y_TOP,
    xStep           : STEP,
    yStep           : STEP,
    epsg            : 3857,
    rasterBytes     : bytes,
    gdalNodata      : null
  });
  const p = resolve(__dirname, 'sample-orthophoto-mercator.tif');
  writeFileSync(p, out.bytes);
  console.log(`Generated ${p} (${NCOLS}×${NROWS}, RGB Uint8, EPSG:3857 @ ${lonCenter.toFixed(3)}°E ${latCenter.toFixed(3)}°N, ${out.totalBytes} bytes)`);
}
