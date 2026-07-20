/*
 * Copyright 2026 Joe Meszaros
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as THREE from 'three';
import { Vector, PointCloud, ModelFile } from '../model.js';
import { i18n } from '../i18n/i18n.js';
import { DTMImporterBase } from './dtm-importer.js';

/**
 * Importer for XYZ (.xyz) files.
 *
 * XYZ is a plain-text format: one point per line, whitespace-separated
 * `X Y Z`. No header, no connectivity. The format is used both for
 * regularly-gridded DTMs (QGIS / GDAL exports) and for scattered point
 * clouds (LIDAR, photogrammetry). Since the file itself doesn't say which,
 * the user picks via the XyzKindDialog before parsing; `opts.xyzKind` is
 * 'dtm' or 'pointcloud'.
 *
 * DTM path: validates that the data is a regular grid, then reuses the
 * DTMImporterBase pipeline (mesh option + decimation + NODATA holes +
 * color modes).
 *
 * Point-cloud path: builds a positions Float32Array and routes through the
 * existing octree worker (>5000 points) or THREE.Points (smaller),
 * exactly like a face-less PLY.
 */
export class XyzImporter extends DTMImporterBase {

  static OCTREE_THRESHOLD = 5000;
  static NODATA = -9999;

  constructor(db, options, scene, manager) {
    super(db, options, scene, manager);
  }

  async importFile(file, name, onModelLoad, opts = {}) {
    if (!file) return;
    const reader = new FileReader();
    const nameToUse = name ?? file.name;
    const errorMessage = i18n.t('errors.import.importFileFailed', {
      name : nameToUse.substring(nameToUse.lastIndexOf('/') + 1)
    });

    await new Promise((resolve, reject) => {
      reader.onload = async (event) => {
        try {
          await this.importText(event.target.result, onModelLoad, name, null, file, opts);
          resolve();
        } catch (e) {
          reject(e);
        }
      };
      reader.onerror = (error) => {
        console.error(errorMessage, error);
        reject(error);
      };
      reader.readAsText(file, 'utf8');
    });
  }

  async importText(text, onModelLoad, name, modelFileId = null, sourceBlob = null, opts = {}) {
    const xyzKind = opts.xyzKind ?? 'dtm';
    const modelFile = new ModelFile(name, 'xyz', sourceBlob ?? text);

    if (xyzKind === 'dtm') {
      const detection = XyzImporter.detectGridXyz(text);
      if (!detection) {
        throw new Error(i18n.t('errors.import.xyzNotAGrid', { name }));
      }
      await this.#importAsDtm(text, detection, name, modelFile, modelFileId, opts, onModelLoad);
    } else {
      await this.#importAsPointCloud(text, name, modelFile, modelFileId, opts, onModelLoad);
    }
  }

  // ─── Tokenizer helpers ─────────────────────────────────────────────────────

  static #skipWhitespace(text, pos, len) {
    while (pos < len && text.charCodeAt(pos) <= 32) pos++;
    return pos;
  }

  static #skipToEOL(text, pos, len) {
    while (pos < len && text.charCodeAt(pos) !== 10) pos++;
    return pos;
  }

  static #skipToken(text, pos, len) {
    while (pos < len && text.charCodeAt(pos) > 32) pos++;
    return pos;
  }

  /**
   * Skip blank lines and `#`-comment lines starting at `pos`.
   * Returns the position of the first non-blank, non-comment character.
   */
  static #skipBlanksAndComments(text, pos, len) {
    while (pos < len) {
      // Skip whitespace incl. newlines
      while (pos < len && text.charCodeAt(pos) <= 32) pos++;
      if (pos >= len) return pos;
      if (text.charCodeAt(pos) === 35) {
        // '#' — skip to EOL
        pos = XyzImporter.#skipToEOL(text, pos, len);
        continue;
      }
      return pos;
    }
    return pos;
  }

  /**
   * Read a single `X Y Z` line starting at `pos`. Returns
   * `{ x, y, z, nextPos }` or `null` on malformed input.
   * The returned `nextPos` is positioned just past the line's `\n`.
   */
  static #readXYZAt(text, pos, len) {
    let p = XyzImporter.#skipWhitespace(text, pos, len);
    if (p >= len) return null;
    const xs = p; p = XyzImporter.#skipToken(text, p, len); const xe = p;
    p = XyzImporter.#skipWhitespace(text, p, len);
    const ys = p; p = XyzImporter.#skipToken(text, p, len); const ye = p;
    p = XyzImporter.#skipWhitespace(text, p, len);
    const zs = p; p = XyzImporter.#skipToken(text, p, len); const ze = p;
    if (xe === xs || ye === ys || ze === zs) return null;
    const x = parseFloat(text.substring(xs, xe));
    const y = parseFloat(text.substring(ys, ye));
    const z = parseFloat(text.substring(zs, ze));
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
    // Advance past EOL so the caller sits on the next line
    p = XyzImporter.#skipToEOL(text, p, len);
    if (p < len) p++; // consume \n
    return { x, y, z, nextPos: p };
  }

  /**
   * Like `#readXYZAt`, but only parses X and Y. Skips past Z without
   * parseFloat — so non-numeric Z values in scan-only positions are
   * tolerated. Used by detection where Z is irrelevant.
   */
  static #readXYAt(text, pos, len) {
    let p = XyzImporter.#skipWhitespace(text, pos, len);
    if (p >= len) return null;
    const xs = p; p = XyzImporter.#skipToken(text, p, len); const xe = p;
    p = XyzImporter.#skipWhitespace(text, p, len);
    const ys = p; p = XyzImporter.#skipToken(text, p, len); const ye = p;
    if (xe === xs || ye === ys) return null;
    const x = parseFloat(text.substring(xs, xe));
    const y = parseFloat(text.substring(ys, ye));
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    p = XyzImporter.#skipToEOL(text, p, len);
    if (p < len) p++;
    return { x, y, nextPos: p };
  }

  /**
   * Walk past one line (any kind: blank, comment, or data), returning the
   * position of the next character. Faster than parsing if we don't care.
   */
  static #skipOneLine(text, pos, len) {
    pos = XyzImporter.#skipToEOL(text, pos, len);
    if (pos < len) pos++;
    return pos;
  }

  /**
   * Count data lines from dataOffset (excludes blank and `#` comment lines).
   */
  static #countDataLines(text, dataOffset, len) {
    let count = 0;
    let pos = dataOffset;
    while (pos < len) {
      pos = XyzImporter.#skipWhitespace(text, pos, len);
      if (pos >= len) break;
      if (text.charCodeAt(pos) === 35) {
        pos = XyzImporter.#skipToEOL(text, pos, len);
        if (pos < len) pos++;
        continue;
      }
      count++;
      pos = XyzImporter.#skipToEOL(text, pos, len);
      if (pos < len) pos++;
    }
    return count;
  }

  // ─── Grid detection ────────────────────────────────────────────────────────

  /**
   * Pre-scan the file to determine if it represents a regular grid and, if
   * so, return its dimensions, layout, and steps. Returns `null` if the data
   * is not a clean grid — in which case the caller should throw a clear
   * error (the user explicitly chose DTM).
   *
   * @returns {{ncols, nrows, xMin, yMin, xMax, yMax, xStep, yStep, layout, dataOffset, totalLines}|null}
   */
  static detectGridXyz(text) {
    const len = text.length;
    const dataOffset = XyzImporter.#skipBlanksAndComments(text, 0, len);
    if (dataOffset >= len) return null;

    const line1 = XyzImporter.#readXYAt(text, dataOffset, len);
    if (!line1) return null;
    const { x: x0, y: y0 } = line1;

    const pos2 = XyzImporter.#skipBlanksAndComments(text, line1.nextPos, len);
    if (pos2 >= len) return null;
    const line2 = XyzImporter.#readXYAt(text, pos2, len);
    if (!line2) return null;
    const { x: x1, y: y1 } = line2;

    const eps = 1e-6;
    const xEq = Math.abs(x0 - x1) < eps;
    const yEq = Math.abs(y0 - y1) < eps;

    let layout;
    if (xEq && !yEq) layout = 'col-major';
    else if (!xEq && yEq) layout = 'row-major';
    else return null; // both equal or both different — not a clean grid

    // Walk forward until the leading axis changes. Up to ~1M lines safety
    // bound to avoid scanning a huge irregular file pointlessly.
    const leadingIsX = layout === 'col-major';
    let pos = line2.nextPos;
    let inner = 2; // line1 + line2 both in the same outer slot
    let changeLine = null;
    const SAFETY = 1_000_000;
    while (pos < len && inner < SAFETY) {
      pos = XyzImporter.#skipBlanksAndComments(text, pos, len);
      if (pos >= len) break;
      const ln = XyzImporter.#readXYAt(text, pos, len);
      if (!ln) return null;
      const val = leadingIsX ? ln.x : ln.y;
      const ref = leadingIsX ? x0 : y0;
      if (Math.abs(val - ref) >= eps) {
        changeLine = ln;
        break;
      }
      pos = ln.nextPos;
      inner++;
    }
    if (!changeLine) return null; // never found a change — not a 2D grid
    const innerDim = inner; // lines 0..inner-1 had same leading axis value

    // Steps
    const xStep = leadingIsX ? (changeLine.x - x0) : (x1 - x0);
    const yStep = leadingIsX ? (y1 - y0) : (changeLine.y - y0);
    if (Math.abs(xStep) < eps || Math.abs(yStep) < eps) return null;

    // Count total data lines in the file (single linear pass)
    const totalLines = XyzImporter.#countDataLines(text, dataOffset, len);
    if (totalLines % innerDim !== 0) return null;
    const outerDim = totalLines / innerDim;
    if (outerDim < 1) return null;

    const ncols = leadingIsX ? outerDim : innerDim;
    const nrows = leadingIsX ? innerDim : outerDim;

    const xCorner1 = x0;
    const xCorner2 = x0 + (ncols - 1) * xStep;
    const yCorner1 = y0;
    const yCorner2 = y0 + (nrows - 1) * yStep;
    const xMin = Math.min(xCorner1, xCorner2);
    const xMax = Math.max(xCorner1, xCorner2);
    const yMin = Math.min(yCorner1, yCorner2);
    const yMax = Math.max(yCorner1, yCorner2);

    return {
      ncols, nrows,
      xMin, yMin, xMax, yMax,
      xStep, yStep,
      x0, y0,
      layout, dataOffset, totalLines
    };
  }

  // ─── DTM grid read ────────────────────────────────────────────────────────

  /**
   * Stream-read the elevations from a detected grid. Skips X and Y tokens
   * without parseFloat; only parses Z for sampled cells.
   *
   * @returns {{ncols, nrows, cellsizeX, cellsizeY, cellsize, elevations}}
   */
  static readGridXyz(text, detection, stride) {
    const { ncols, nrows, xStep, yStep, dataOffset, totalLines, layout } = detection;
    const len = text.length;
    const absX = Math.abs(xStep);
    const absY = Math.abs(yStep);

    // Sampling masks (same pattern as ASC)
    let newNcols, newNrows;
    let sampledRow = null, sampledCol = null, newRowOf = null, newColOf = null;
    if (stride <= 1) {
      newNcols = ncols;
      newNrows = nrows;
    } else {
      newNcols = Math.max(1, Math.floor(ncols / stride));
      newNrows = Math.max(1, Math.floor(nrows / stride));
      sampledRow = new Uint8Array(nrows);
      sampledCol = new Uint8Array(ncols);
      newRowOf = new Int32Array(nrows).fill(-1);
      newColOf = new Int32Array(ncols).fill(-1);
      for (let nr = 0; nr < newNrows; nr++) {
        const sr = Math.min(nrows - 1, Math.round(nr * stride));
        sampledRow[sr] = 1;
        newRowOf[sr] = nr;
      }
      for (let nc = 0; nc < newNcols; nc++) {
        const sc = Math.min(ncols - 1, Math.round(nc * stride));
        sampledCol[sc] = 1;
        newColOf[sc] = nc;
      }
    }

    const elevations = new Float32Array(newNcols * newNrows);

    const leadingIsX = layout === 'col-major';
    // Pre-compute direction flips so the inner loop is branch-light
    const xAsc = xStep > 0;  // file's X-step direction; xAsc → file col == internal col
    const yDesc = yStep < 0; // file's Y-step direction; yDesc → file row == internal row (row 0 = north)

    let pos = dataOffset;
    let lineIdx = 0;
    while (pos < len && lineIdx < totalLines) {
      pos = XyzImporter.#skipBlanksAndComments(text, pos, len);
      if (pos >= len) break;

      // Compute internal (row, col) from lineIdx
      let row, col;
      if (leadingIsX) {
        // col-major: outer = X, inner = Y
        const colFile = (lineIdx / nrows) | 0;
        const posInCol = lineIdx - colFile * nrows;
        col = xAsc ? colFile : (ncols - 1 - colFile);
        row = yDesc ? posInCol : (nrows - 1 - posInCol);
      } else {
        // row-major: outer = Y, inner = X
        const rowFile = (lineIdx / ncols) | 0;
        const posInRow = lineIdx - rowFile * ncols;
        row = yDesc ? rowFile : (nrows - 1 - rowFile);
        col = xAsc ? posInRow : (ncols - 1 - posInRow);
      }

      // Skip X and Y tokens unconditionally
      pos = XyzImporter.#skipWhitespace(text, pos, len);
      pos = XyzImporter.#skipToken(text, pos, len);   // X
      pos = XyzImporter.#skipWhitespace(text, pos, len);
      pos = XyzImporter.#skipToken(text, pos, len);   // Y
      pos = XyzImporter.#skipWhitespace(text, pos, len);

      const wantRow = sampledRow ? sampledRow[row] : 1;
      const wantCol = sampledCol ? sampledCol[col] : 1;

      if (wantRow && wantCol) {
        const zs = pos;
        pos = XyzImporter.#skipToken(text, pos, len);
        const z = parseFloat(text.substring(zs, pos));
        if (!Number.isFinite(z)) {
          throw new Error(`Invalid XYZ Z value at line ${lineIdx + 1}`);
        }
        const nr = sampledRow ? newRowOf[row] : row;
        const nc = sampledCol ? newColOf[col] : col;
        elevations[nr * newNcols + nc] = (z === XyzImporter.NODATA) ? NaN : z;
      } else {
        // Skip Z token
        pos = XyzImporter.#skipToken(text, pos, len);
      }

      // Advance past EOL
      pos = XyzImporter.#skipToEOL(text, pos, len);
      if (pos < len) pos++;
      lineIdx++;
    }

    if (lineIdx < totalLines) {
      throw new Error(`XYZ file truncated: read ${lineIdx} of ${totalLines} lines`);
    }

    return {
      ncols     : newNcols,
      nrows     : newNrows,
      cellsize  : absX,                 // backward-compat
      cellsizeX : absX * (stride > 1 ? stride : 1),
      cellsizeY : absY * (stride > 1 ? stride : 1),
      elevations
    };
  }

  async #importAsDtm(text, detection, name, modelFile, modelFileId, opts, onModelLoad) {
    const maxCells = opts.maxCells ?? this.options?.scene?.models?.dtmMaxCells ?? 4_000_000;
    const stride = DTMImporterBase.computeStride(detection.ncols, detection.nrows, maxCells);
    const grid = XyzImporter.readGridXyz(text, detection, stride);

    const header = {
      xllcorner : detection.xMin,
      yllcorner : detection.yMin,
      origNcols : detection.ncols,
      origNrows : detection.nrows,
      headerCRS : 'projected'
    };

    await this.dispatchToScene(grid, header, name, modelFile, modelFileId, opts, onModelLoad);
  }

  // ─── Scattered point-cloud path ────────────────────────────────────────────

  /**
   * Walk the text once, parsing X Y Z for every data line. Returns a
   * `Float32Array(N*3)` of raw positions plus bounds. No auto-centering
   * here — positions stay in the file's coordinate space; centering is
   * handled by the octree worker (same as PLY).
   */
  static readScatteredXyz(text) {
    const len = text.length;
    const dataOffset = XyzImporter.#skipBlanksAndComments(text, 0, len);
    const totalLines = XyzImporter.#countDataLines(text, dataOffset, len);
    if (totalLines === 0) {
      throw new Error('XYZ file is empty');
    }
    const positions = new Float32Array(totalLines * 3);
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;

    let pos = dataOffset;
    let i = 0;
    while (pos < len && i < totalLines) {
      pos = XyzImporter.#skipBlanksAndComments(text, pos, len);
      if (pos >= len) break;
      const ln = XyzImporter.#readXYZAt(text, pos, len);
      if (!ln) throw new Error(`Invalid XYZ line at index ${i + 1}`);
      positions[i * 3] = ln.x;
      positions[i * 3 + 1] = ln.y;
      positions[i * 3 + 2] = ln.z;
      if (ln.x < minX) minX = ln.x; if (ln.x > maxX) maxX = ln.x;
      if (ln.y < minY) minY = ln.y; if (ln.y > maxY) maxY = ln.y;
      if (ln.z < minZ) minZ = ln.z; if (ln.z > maxZ) maxZ = ln.z;
      pos = ln.nextPos;
      i++;
    }

    return {
      positions,
      pointCount : i,
      bounds     : { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] }
    };
  }

  async #importAsPointCloud(text, name, modelFile, modelFileId, opts, onModelLoad) {
    const { positions, pointCount, bounds } = XyzImporter.readScatteredXyz(text);

    if (pointCount > XyzImporter.OCTREE_THRESHOLD) {
      await this.#importScatteredAsOctree(positions, pointCount, bounds, name, modelFile, modelFileId, onModelLoad);
      return;
    }

    // Small scattered → THREE.Points directly
    const center = new Vector(
      (bounds.min[0] + bounds.max[0]) / 2,
      (bounds.min[1] + bounds.max[1]) / 2,
      (bounds.min[2] + bounds.max[2]) / 2
    );

    const points = [];
    for (let i = 0; i < pointCount; i++) {
      points.push(new Vector(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]));
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    const material = new THREE.PointsMaterial({
      color        : 0xffffff,
      size         : this.options.scene.models.pointSize,
      vertexColors : true
    });
    const pointsObject = new THREE.Points(geometry, material);
    const pointCloud = new PointCloud(name, points, center, false);
    pointCloud.firstPointCoords = [positions[0], positions[1], positions[2]];

    await onModelLoad(pointCloud, pointsObject, modelFile);
  }

  /**
   * Dispatch scattered positions to the octree worker — same pattern as
   * PlyModelImporter.#importAsOctree but with positions sourced from XYZ.
   */
  async #importScatteredAsOctree(positions, pointCount, bounds, name, modelFile, modelFileId, onModelLoad) {
    const options = this.options;
    const pointBudget = options.scene.models.pointBudget;
    const sseThreshold = options.scene.models.sseThreshold;
    const pointSize = options.scene.models.pointSize;
    const gradientColors = options.scene.models.color.gradientColors ?? [];
    const sorted = [...gradientColors].sort((a, b) => a.depth - b.depth);
    const colorStart = sorted[0]?.color ?? '#39b14d';
    const colorEnd = sorted[sorted.length - 1]?.color ?? '#9f2d2d';
    const maxPoints = options.scene.models.maxPoints;

    if (modelFileId) {
      const cached = await this.tryLoadOctreeFromCache(modelFileId, name, onModelLoad, {
        pointBudget, sseThreshold, pointSize, maxPoints
      });
      if (cached) return;
    }

    return new Promise((resolve, reject) => {
      const workerUrl = new URL('./point-cloud-worker.js', import.meta.url);
      const worker = new Worker(workerUrl);

      worker.onmessage = async (e) => {
        const msg = e.data;
        if (msg.type === 'progress') {
          document.dispatchEvent(
            new CustomEvent('pointCloudLoadProgress', {
              detail : {
                message : i18n.t('ui.loading.lasOctreeBuilding', { count: msg.nodeCount || 0 }),
                percent : msg.percent,
                phase   : msg.phase
              }
            })
          );
        } else if (msg.type === 'result') {
          try {
            const result = this.createOctreeFromNodes(msg, name, {
              pointBudget, sseThreshold, pointSize
            });
            result.pointCloud.firstPointCoords = [bounds.min[0], bounds.min[1], bounds.min[2]];
            await onModelLoad(result.pointCloud, result.octree.group, modelFile);
            this.saveOctreeToCache(modelFileId || modelFile.id, msg, maxPoints);
            resolve();
          } catch (err) {
            reject(err);
          } finally {
            worker.terminate();
          }
        } else if (msg.type === 'error') {
          worker.terminate();
          reject(new Error(msg.message));
        }
      };

      worker.onerror = (err) => {
        worker.terminate();
        reject(new Error('Octree worker error: ' + err.message));
      };

      worker.postMessage(
        {
          type       : 'build-octree',
          positions  : positions.buffer,
          colors     : null,
          pointCount : pointCount,
          bounds     : bounds,
          hasColors  : false,
          colorStart : colorStart,
          colorEnd   : colorEnd
        },
        [positions.buffer]
      );
    });
  }
}
