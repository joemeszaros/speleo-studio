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
import { Vector, PointCloud, Mesh3D, ModelFile } from '../model.js';
import { showWarningPanel } from '../ui/popups.js';
import { i18n } from '../i18n/i18n.js';
import { PointCloudImporter } from './import.js';

/**
 * Importer for ESRI ASCII Grid (.asc) Digital Terrain Model files.
 *
 * Format: 6-line header (ncols, nrows, xllcorner|xllcenter, yllcorner|yllcenter,
 * cellsize, NODATA_value) followed by nrows × ncols whitespace-separated
 * elevation values, ordered top-to-bottom (row 0 = north).
 *
 * example:
 * ncols 1668
 * nrows 1460
 * xllcenter 379764.640
 * yllcenter 5138143.526
 * cellsize 1.0000
 * nodata_value -9999.9
 *
 * Renders as either a triangle mesh (cell corners → vertices, NODATA → holes)
 * or a point cloud, based on `opts.renderMode`.
 *
 * Memory-efficient parser: walks the source text once, skipping tokens for
 * non-sampled cells without invoking parseFloat, and allocates a Float32Array
 * sized for the (already decimated) grid only.
 *
 * Coordinate handling: xllcorner/yllcorner from the file are NOT used for
 * scene placement (they may be in any projected CS — EOV, UTM, custom — and
 * the file doesn't say). The user-entered WGS84 from the existing
 * ModelCoordinateDialog is treated as the lower-left corner. The header
 * values are surfaced as `firstPointCoords` for display in that dialog.
 */
export class AscDTMImporter extends PointCloudImporter {

  // Below this many points, the point-cloud path uses THREE.Points (no octree).
  static OCTREE_THRESHOLD = 5000;

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
    const renderMode = opts.renderMode ?? 'mesh';
    const maxCells = opts.maxCells ?? this.options?.scene?.models?.dtmMaxCells ?? 4_000_000;

    const header = AscDTMImporter.parseHeader(text);
    const stride = AscDTMImporter.computeStride(header.ncols, header.nrows, maxCells);
    const grid = AscDTMImporter.readGrid(text, header, stride);

    if (stride > 1) {
      showWarningPanel(
        i18n.t('errors.import.ascDecimated', {
          name,
          fromCols : header.ncols,
          fromRows : header.nrows,
          toCols   : grid.ncols,
          toRows   : grid.nrows
        }),
        8
      );
    }

    const modelFile = new ModelFile(name, 'asc', sourceBlob ?? text);

    if (renderMode === 'pointcloud') {
      await this.#importAsPointCloud(grid, header, name, modelFile, modelFileId, onModelLoad);
    } else {
      await this.#importAsMesh(grid, header, name, modelFile, onModelLoad);
    }
  }

  /**
   * Parse the 6-line ASC header, returning header values plus the byte offset
   * in `text` where the data section begins. Header keys are case-insensitive
   * and may appear in any order.
   *
   * @returns {{ncols, nrows, xllcorner, yllcorner, cellsize, nodata, dataOffset}}
   */
  static parseHeader(text) {
    const headerKeys = new Set([
      'ncols',
      'nrows',
      'xllcorner',
      'yllcorner',
      'xllcenter',
      'yllcenter',
      'cellsize',
      'nodata_value'
    ]);

    const raw = {};
    const len = text.length;
    let pos = 0;
    let dataOffset = 0;

    while (pos < len) {
      const lineStart = pos;
      while (pos < len && text.charCodeAt(pos) !== 10) pos++;
      const lineEnd = pos;
      if (pos < len) pos++; // consume \n

      const line = text.substring(lineStart, lineEnd).trim();
      if (line.length === 0) {
        // tolerate blank lines between header rows
        continue;
      }

      const m = line.match(/^([A-Za-z_]+)\s+(\S+)\s*$/);
      if (m && headerKeys.has(m[1].toLowerCase())) {
        raw[m[1].toLowerCase()] = parseFloat(m[2]);
        dataOffset = pos;
        continue;
      }

      // First non-header line — data starts here
      dataOffset = lineStart;
      break;
    }

    const ncols = raw.ncols;
    const nrows = raw.nrows;
    if (
      !Number.isFinite(ncols) ||
      !Number.isFinite(nrows) ||
      isNaN(ncols) ||
      isNaN(nrows) ||
      ncols <= 0 ||
      nrows <= 0
    ) {
      throw new Error(`Invalid ASC header: ncols=${ncols}, nrows=${nrows}`);
    }
    const cellsize = raw.cellsize;
    if (!Number.isFinite(cellsize) || isNaN(cellsize) || cellsize <= 0) {
      throw new Error(`Invalid ASC header: cellsize=${cellsize}`);
    }

    let xllcorner, yllcorner;
    if (raw.xllcorner !== undefined) {
      xllcorner = raw.xllcorner;
    } else if (raw.xllcenter !== undefined) {
      xllcorner = raw.xllcenter - cellsize / 2;
    } else {
      throw new Error('Invalid ASC header: missing xllcorner/xllcenter');
    }
    if (raw.yllcorner !== undefined) {
      yllcorner = raw.yllcorner;
    } else if (raw.yllcenter !== undefined) {
      yllcorner = raw.yllcenter - cellsize / 2;
    } else {
      throw new Error('Invalid ASC header: missing yllcorner/yllcenter');
    }

    const nodata = raw.nodata_value ?? -9999;

    return { ncols, nrows, xllcorner, yllcorner, cellsize, nodata, dataOffset };
  }

  /**
   * Compute decimation stride. Returns 1 (no decimation) when total cells
   * already fits, otherwise a float stride such that `(ncols/stride) *
   * (nrows/stride) ≈ maxCells`. New cellsize is `cellsize * stride`.
   */
  static computeStride(ncols, nrows, maxCells) {
    const total = ncols * nrows;
    if (!Number.isFinite(maxCells) || maxCells <= 0 || total <= maxCells) return 1;
    return Math.sqrt(total / maxCells);
  }

  /**
   * Stream-read the data section from `text` starting at `header.dataOffset`,
   * sampling at `stride` (1 = no decimation, float > 1 = decimated). Skipped
   * tokens are advanced past without parseFloat.
   *
   * @returns {{ncols, nrows, cellsize, elevations: Float32Array}} elevations
   *          uses NaN to mark NODATA cells.
   */
  static readGrid(text, header, stride) {
    const { ncols, nrows, cellsize, nodata, dataOffset } = header;

    let newNcols, newNrows, newCellsize;
    let sampledRow, newRowOf, sampledCol, newColOf;

    if (stride <= 1) {
      newNcols = ncols;
      newNrows = nrows;
      newCellsize = cellsize;
      sampledRow = null;
      sampledCol = null;
      newRowOf = null;
      newColOf = null;
    } else {
      newNcols = Math.max(1, Math.floor(ncols / stride));
      newNrows = Math.max(1, Math.floor(nrows / stride));
      newCellsize = cellsize * stride;
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
    const len = text.length;
    let pos = dataOffset;
    let srcRow = 0;
    let srcCol = 0;

    while (pos < len && srcRow < nrows) {
      // Skip whitespace
      while (pos < len && text.charCodeAt(pos) <= 32) pos++;
      if (pos >= len) break;

      const wantRow = sampledRow ? sampledRow[srcRow] : 1;
      const wantCol = sampledCol ? sampledCol[srcCol] : 1;

      if (wantRow && wantCol) {
        const start = pos;
        while (pos < len && text.charCodeAt(pos) > 32) pos++;
        const tok = text.substring(start, pos);
        const v = parseFloat(tok);
        if (!Number.isFinite(v)) {
          throw new Error(`Invalid ASC value at row ${srcRow}, col ${srcCol}: "${tok}"`);
        }
        const nr = newRowOf ? newRowOf[srcRow] : srcRow;
        const nc = newColOf ? newColOf[srcCol] : srcCol;
        elevations[nr * newNcols + nc] = v === nodata ? NaN : v;
      } else {
        // Skip token without parseFloat
        while (pos < len && text.charCodeAt(pos) > 32) pos++;
      }

      srcCol++;
      if (srcCol >= ncols) {
        srcCol = 0;
        srcRow++;
        // Optimization: if the next row isn't sampled, fast-forward through
        // its ncols tokens without per-token sampledCol checks.
        while (sampledRow && srcRow < nrows && !sampledRow[srcRow]) {
          let toSkip = ncols;
          while (toSkip > 0 && pos < len) {
            while (pos < len && text.charCodeAt(pos) <= 32) pos++;
            if (pos >= len) break;
            while (pos < len && text.charCodeAt(pos) > 32) pos++;
            toSkip--;
          }
          srcRow++;
        }
      }
    }

    if (srcRow < nrows) {
      throw new Error(`ASC file truncated: stopped at row ${srcRow}/${nrows}`);
    }

    return { ncols: newNcols, nrows: newNrows, cellsize: newCellsize, elevations };
  }

  /**
   * Compute compact vertex layout for a (possibly decimated) grid.
   * Skips NODATA (NaN) cells.
   */
  static buildVertexLayout(grid) {
    const { ncols, nrows, cellsize, elevations } = grid;
    const total = ncols * nrows;
    const vertexIndex = new Int32Array(total);
    vertexIndex.fill(-1);
    let validCount = 0;
    for (let i = 0; i < total; i++) {
      if (!isNaN(elevations[i])) {
        vertexIndex[i] = validCount++;
      }
    }
    const positions = new Float32Array(validCount * 3);
    let minZ = Infinity,
      maxZ = -Infinity;
    for (let row = 0; row < nrows; row++) {
      for (let col = 0; col < ncols; col++) {
        const i = row * ncols + col;
        const vi = vertexIndex[i];
        if (vi < 0) continue;
        const z = elevations[i];
        positions[vi * 3] = col * cellsize;
        positions[vi * 3 + 1] = (nrows - 1 - row) * cellsize;
        positions[vi * 3 + 2] = z;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
      }
    }
    if (!isFinite(minZ)) {
      minZ = 0;
      maxZ = 0;
    }
    return { positions, vertexIndex, validCount, minZ, maxZ };
  }

  static computePositionBounds(layout) {
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (let i = 0; i < layout.validCount; i++) {
      const x = layout.positions[i * 3];
      const y = layout.positions[i * 3 + 1];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    return { minX, maxX, minY, maxY };
  }

  async #importAsMesh(grid, header, name, modelFile, onModelLoad) {
    const { ncols, nrows } = grid;
    const layout = AscDTMImporter.buildVertexLayout(grid);

    if (layout.validCount === 0) {
      throw new Error(`ASC file ${name} contains no valid (non-NODATA) cells`);
    }

    const indices = [];
    for (let row = 0; row < nrows - 1; row++) {
      for (let col = 0; col < ncols - 1; col++) {
        const tl = layout.vertexIndex[row * ncols + col];
        const tr = layout.vertexIndex[row * ncols + col + 1];
        const bl = layout.vertexIndex[(row + 1) * ncols + col];
        const br = layout.vertexIndex[(row + 1) * ncols + col + 1];
        if (tl < 0 || tr < 0 || bl < 0 || br < 0) continue;
        indices.push(tl, bl, br);
        indices.push(tl, br, tr);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(layout.positions, 3));
    const indexArray = layout.validCount < 65536 ? new Uint16Array(indices) : new Uint32Array(indices);
    geometry.setIndex(new THREE.BufferAttribute(indexArray, 1));
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    const material = new THREE.MeshPhongMaterial({
      color       : 0xb8b8b8,
      specular    : 0x222222,
      shininess   : 40,
      side        : THREE.DoubleSide,
      flatShading : false
    });

    const meshObject = new THREE.Mesh(geometry, material);
    const center = geometry.boundingBox.getCenter(new THREE.Vector3());
    const mesh = new Mesh3D(name, new Vector(center.x, center.y, center.z));
    mesh.firstPointCoords = [header.xllcorner, header.yllcorner, layout.minZ];

    await onModelLoad(mesh, meshObject, modelFile);
  }

  async #importAsPointCloud(grid, header, name, modelFile, modelFileId, onModelLoad) {
    const layout = AscDTMImporter.buildVertexLayout(grid);

    if (layout.validCount === 0) {
      throw new Error(`ASC file ${name} contains no valid (non-NODATA) cells`);
    }

    if (layout.validCount > AscDTMImporter.OCTREE_THRESHOLD) {
      await this.#importAsOctree(layout, header, name, modelFile, modelFileId, onModelLoad);
      return;
    }

    const bounds = AscDTMImporter.computePositionBounds(layout);
    const center = new Vector(
      (bounds.minX + bounds.maxX) / 2,
      (bounds.minY + bounds.maxY) / 2,
      (layout.minZ + layout.maxZ) / 2
    );

    const points = [];
    for (let i = 0; i < layout.validCount; i++) {
      points.push(new Vector(layout.positions[i * 3], layout.positions[i * 3 + 1], layout.positions[i * 3 + 2]));
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(layout.positions, 3));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    const material = new THREE.PointsMaterial({
      color        : 0xffffff,
      size         : this.options.scene.models.pointSize,
      vertexColors : true
    });
    const pointsObject = new THREE.Points(geometry, material);
    const pointCloud = new PointCloud(name, points, center, false);
    pointCloud.firstPointCoords = [header.xllcorner, header.yllcorner, layout.minZ];

    await onModelLoad(pointCloud, pointsObject, modelFile);
  }

  async #importAsOctree(layout, header, name, modelFile, modelFileId, onModelLoad) {
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
        pointBudget,
        sseThreshold,
        pointSize,
        maxPoints
      });
      if (cached) return;
    }

    const xy = AscDTMImporter.computePositionBounds(layout);
    const bounds = {
      min : [xy.minX, xy.minY, layout.minZ],
      max : [xy.maxX, xy.maxY, layout.maxZ]
    };

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
              pointBudget,
              sseThreshold,
              pointSize
            });
            result.pointCloud.firstPointCoords = [header.xllcorner, header.yllcorner, layout.minZ];
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

      const transferables = [layout.positions.buffer];
      worker.postMessage(
        {
          type       : 'build-octree',
          positions  : layout.positions.buffer,
          colors     : null,
          pointCount : layout.validCount,
          bounds     : bounds,
          hasColors  : false,
          colorStart : colorStart,
          colorEnd   : colorEnd
        },
        transferables
      );
    });
  }
}
