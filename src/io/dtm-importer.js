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
import {
  CoordinateSystemType,
  GeoData,
  StationWithCoordinate,
  UTMCoordinateSystem,
  UTMCoordinateWithElevation,
  EOVCoordinateWithElevation
} from '../model/geo.js';
import { UTMConverter, EOVToWGS84Transformer } from '../utils/geo.js';

/**
 * Shared base class for Digital Terrain Model importers.
 *
 * Subclasses parse a format-specific source (text for ASC, binary for HGT)
 * into a `grid` object — { ncols, nrows, cellsize | cellsizeX/cellsizeY,
 * elevations: Float32Array (NaN for NODATA) } — and a `header` object
 * (xllcorner, yllcorner, ...). They then call `dispatchToScene(...)` which
 * builds either a triangle mesh or a point cloud and hands it off to the
 * regular model pipeline.
 */
export class DTMImporterBase extends PointCloudImporter {

  // Below this many points, the point-cloud path uses THREE.Points (no octree).
  static OCTREE_THRESHOLD = 5000;

  /**
   * Compute decimation stride. Returns 1 (no decimation) when total cells
   * already fits, otherwise a float stride such that
   * `(ncols/stride) * (nrows/stride) ≈ maxCells`.
   */
  static computeStride(ncols, nrows, maxCells) {
    const total = ncols * nrows;
    if (!Number.isFinite(maxCells) || maxCells <= 0 || total <= maxCells) return 1;
    return Math.sqrt(total / maxCells);
  }

  /**
   * Build a compact vertex layout for a (possibly decimated) grid. Skips
   * NODATA (NaN) cells. Supports separate cellsizeX/cellsizeY for grids
   * sampled in WGS84 (HGT) where east-west and north-south meter spacings
   * differ.
   */
  static buildVertexLayout(grid) {
    const { ncols, nrows, elevations, worldFrame } = grid;
    const cellsizeX = grid.cellsizeX ?? grid.cellsize;
    const cellsizeY = grid.cellsizeY ?? grid.cellsize;
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
    let minZ = Infinity;
    let maxZ = -Infinity;
    // Pass 1: collect raw (worldX, worldY) per valid vertex to find the
    // local origin (min) — then subtract so positions stay small floats.
    if (worldFrame) {
      let minX = Infinity, minY = Infinity;
      for (let row = 0; row < nrows; row++) {
        for (let col = 0; col < ncols; col++) {
          const i = row * ncols + col;
          if (vertexIndex[i] < 0) continue;
          const wx = worldFrame.worldX[i];
          const wy = worldFrame.worldY[i];
          if (wx < minX) minX = wx;
          if (wy < minY) minY = wy;
        }
      }
      grid.worldOriginX = minX;
      grid.worldOriginY = minY;
      for (let row = 0; row < nrows; row++) {
        for (let col = 0; col < ncols; col++) {
          const i = row * ncols + col;
          const vi = vertexIndex[i];
          if (vi < 0) continue;
          const z = elevations[i];
          positions[vi * 3]     = worldFrame.worldX[i] - minX;
          positions[vi * 3 + 1] = worldFrame.worldY[i] - minY;
          positions[vi * 3 + 2] = z;
          if (z < minZ) minZ = z;
          if (z > maxZ) maxZ = z;
        }
      }
    } else {
      for (let row = 0; row < nrows; row++) {
        for (let col = 0; col < ncols; col++) {
          const i = row * ncols + col;
          const vi = vertexIndex[i];
          if (vi < 0) continue;
          const z = elevations[i];
          positions[vi * 3] = col * cellsizeX;
          positions[vi * 3 + 1] = (nrows - 1 - row) * cellsizeY;
          positions[vi * 3 + 2] = z;
          if (z < minZ) minZ = z;
          if (z > maxZ) maxZ = z;
        }
      }
    }
    if (!isFinite(minZ)) {
      minZ = 0;
      maxZ = 0;
    }
    return { positions, vertexIndex, validCount, minZ, maxZ };
  }

  /**
   * Sniff the project's existing coordinate system from the loaded caves,
   * falling back to any georeferenced model. Returns null when the project
   * has no CS yet.
   */
  detectProjectCS() {
    const caves = this.db?.getAllCaves?.() ?? [];
    for (const cave of caves) {
      const cs = cave.geoData?.coordinateSystem;
      if (cs) return cs;
    }
    const models = this.db?.getAllModels?.() ?? [];
    for (const m of models) {
      const cs = m.geoData?.coordinateSystem;
      if (cs) return cs;
    }
    return null;
  }

  /**
   * Read a projected coordinate's east/north axes regardless of CS flavour.
   * UTM stores them as easting/northing, EOV as y/x.
   */
  static #eastNorthOf(coordinate) {
    if (coordinate.type === CoordinateSystemType.UTM) {
      return { east: coordinate.easting, north: coordinate.northing };
    }
    if (coordinate.type === CoordinateSystemType.EOV) {
      return { east: coordinate.y, north: coordinate.x };
    }
    return null;
  }

  /**
   * Construct a `GeoData` anchoring a DTM's local (0, 0) vertex at the given
   * projected coordinate.
   *
   * `elevation` defaults to **0**: `buildVertexLayout` localises X and Y to
   * the grid's SW corner but leaves Z as the file's absolute elevation, so a
   * non-zero anchor elevation would be added on top of an already-absolute Z
   * and float the terrain by that amount. The octree path passes a non-zero
   * value to fold in the worker's centering offset — see
   * `tryGeoreferenceFromHeader`.
   */
  static buildGeoDataAt(cs, east, north, elevation = 0) {
    if (cs.type === CoordinateSystemType.UTM) {
      return new GeoData(cs, [
        new StationWithCoordinate('origin', new UTMCoordinateWithElevation(east, north, elevation))
      ]);
    }
    if (cs.type === CoordinateSystemType.EOV) {
      return new GeoData(cs, [
        new StationWithCoordinate('origin', new EOVCoordinateWithElevation(east, north, elevation))
      ]);
    }
    throw new Error(`Unsupported CS for DTM geoData: ${cs.type}`);
  }

  /**
   * Auto-georeference a DTM whose header carries projected coordinates that
   * are already in the project's own CS (the common case: a tile cut from a
   * national/regional DTM for a cave that is surveyed in that same CS).
   *
   * Only subclasses whose header is projected opt in, via
   * `header.headerCRS === 'projected'` — HGT's header is lat/lon degrees and
   * must not take this path.
   *
   * Guarded by a plausibility check: the grid's footprint must lie within
   * `import.cavesMaxDistance` of a known cave. A file in a *different* CS
   * lands hundreds of km away (or further) and is rejected, so the caller
   * falls back to asking the user for WGS84 coordinates.
   *
   * `centeringOffset` is the octree worker's `positionOffset` — the bbox
   * centre it subtracted from every vertex for Float32 precision. Folding it
   * into the anchor keeps the composition exact, because the consumers
   * (`Main.#positionModelFromGeoData`, `ProjectManager`'s reload path) *set*
   * the group position from the anchor rather than adding to it, and would
   * otherwise discard the offset. Omit for non-octree paths, whose vertices
   * are already in the grid's local frame.
   *
   * Sets `model.geoData` and returns true when georeferencing was applied.
   */
  tryGeoreferenceFromHeader(model, grid, header, centeringOffset = [0, 0, 0]) {
    if (header?.headerCRS !== 'projected') return false;
    if (model.geoData) return false;
    if (!Number.isFinite(header.xllcorner) || !Number.isFinite(header.yllcorner)) return false;

    const cs = this.detectProjectCS();
    if (!cs) return false;

    // Footprint the mesh actually spans: local (0,0) is the SW corner and
    // vertices reach (ncols-1)*cellsizeX / (nrows-1)*cellsizeY from there.
    const cellsizeX = grid.cellsizeX ?? grid.cellsize;
    const cellsizeY = grid.cellsizeY ?? grid.cellsize;
    const minEast = header.xllcorner;
    const minNorth = header.yllcorner;
    const maxEast = minEast + (grid.ncols - 1) * cellsizeX;
    const maxNorth = minNorth + (grid.nrows - 1) * cellsizeY;

    const maxDistance = this.options?.import?.cavesMaxDistance ?? 10000;
    const caveCoords = (this.db?.getAllCaves?.() ?? [])
      .map((c) => c.geoData?.coordinates?.[0]?.coordinate)
      .filter((c) => c)
      .map((c) => DTMImporterBase.#eastNorthOf(c))
      .filter((c) => c);

    // No cave to check against — a model-only project. Trust the header.
    if (caveCoords.length > 0) {
      // Distance from each cave to the footprint rectangle (0 when inside).
      let nearest = Infinity;
      let anyInside = false;
      for (const { east, north } of caveCoords) {
        const dx = Math.max(minEast - east, 0, east - maxEast);
        const dy = Math.max(minNorth - north, 0, north - maxNorth);
        const d = Math.hypot(dx, dy);
        if (d === 0) anyInside = true;
        if (d < nearest) nearest = d;
      }
      // Too far to plausibly be the same CS — let the WGS84 dialog decide.
      if (nearest > maxDistance) return false;

      // Same CS, but the tile was cut from the wrong spot. Place it anyway
      // (the coordinates are right) and tell the user why nothing lines up.
      if (!anyInside) {
        showWarningPanel(
          i18n.t('errors.import.dtmNoCaveOverlap', {
            name     : model.name,
            distance : Math.round(nearest)
          })
        );
      }
    }

    model.geoData = DTMImporterBase.buildGeoDataAt(
      cs,
      minEast + centeringOffset[0],
      minNorth + centeringOffset[1],
      centeringOffset[2]
    );
    return true;
  }

  static computePositionBounds(layout) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
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

  /**
   * Build either a mesh or a point cloud from the parsed grid and hand it to
   * `onModelLoad`. Subclasses call this after they've produced the grid.
   *
   * @param {{ncols, nrows, cellsize?|cellsizeX,cellsizeY, elevations}} grid
   * @param {{xllcorner, yllcorner, origNcols?, origNrows?}} header
   *   `xllcorner` / `yllcorner` are surfaced via firstPointCoords for the
   *   WGS84 dialog; `origNcols` / `origNrows` are the pre-decimation dims
   *   used for the decimation warning (fall back to current dims).
   */
  async dispatchToScene(grid, header, name, modelFile, modelFileId, opts, onModelLoad) {
    const renderMode = opts?.renderMode ?? 'mesh';

    const origNcols = header.origNcols ?? grid.ncols;
    const origNrows = header.origNrows ?? grid.nrows;
    if (origNcols !== grid.ncols || origNrows !== grid.nrows) {
      showWarningPanel(
        i18n.t('errors.import.ascDecimated', {
          name,
          fromCols : origNcols,
          fromRows : origNrows,
          toCols   : grid.ncols,
          toRows   : grid.nrows
        })
      );
    }

    if (renderMode === 'pointcloud') {
      await this.#importAsPointCloud(grid, header, name, modelFile, modelFileId, onModelLoad);
    } else {
      await this.#importAsMesh(grid, header, name, modelFile, onModelLoad);
    }
  }

  async #importAsMesh(grid, header, name, modelFile, onModelLoad) {
    const { ncols, nrows } = grid;
    const layout = DTMImporterBase.buildVertexLayout(grid);

    if (layout.validCount === 0) {
      throw new Error(`DTM ${name} contains no valid (non-NODATA) cells`);
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
    mesh.modelKind = 'dtm';
    this.tryGeoreferenceFromHeader(mesh, grid, header);

    await onModelLoad(mesh, meshObject, modelFile);
  }

  async #importAsPointCloud(grid, header, name, modelFile, modelFileId, onModelLoad) {
    const layout = DTMImporterBase.buildVertexLayout(grid);

    if (layout.validCount === 0) {
      throw new Error(`DTM ${name} contains no valid (non-NODATA) cells`);
    }

    if (layout.validCount > DTMImporterBase.OCTREE_THRESHOLD) {
      await this.#importAsOctree(layout, grid, header, name, modelFile, modelFileId, onModelLoad);
      return;
    }

    const bounds = DTMImporterBase.computePositionBounds(layout);
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
    pointCloud.modelKind = 'dtm';
    this.tryGeoreferenceFromHeader(pointCloud, grid, header);

    await onModelLoad(pointCloud, pointsObject, modelFile);
  }

  async #importAsOctree(layout, grid, header, name, modelFile, modelFileId, onModelLoad) {
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

    const xy = DTMImporterBase.computePositionBounds(layout);
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
            result.pointCloud.modelKind = 'dtm';
            this.tryGeoreferenceFromHeader(
              result.pointCloud, grid, header, msg.header.positionOffset || [0, 0, 0]
            );
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
 * Memory-efficient parser: walks the source text once, skipping tokens for
 * non-sampled cells without invoking parseFloat, and allocates a Float32Array
 * sized for the (already decimated) grid only.
 *
 * Coordinate handling: the file doesn't state its CS, so xllcorner/yllcorner
 * are assumed to be in the project's own CS and used for scene placement —
 * but only when the resulting footprint lands within `cavesMaxDistance` of a
 * known cave (see `tryGeoreferenceFromHeader`). A file in some other CS fails
 * that check and falls back to the user-entered WGS84 from
 * ModelCoordinateDialog, treated as the lower-left corner. The header values
 * are surfaced as `firstPointCoords` for display in that dialog either way.
 */
export class AscDTMImporter extends DTMImporterBase {

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
    const maxCells = opts.maxCells ?? this.options?.scene?.models?.dtmMaxCells ?? 4_000_000;

    const header = AscDTMImporter.parseHeader(text);
    const stride = DTMImporterBase.computeStride(header.ncols, header.nrows, maxCells);
    const grid = AscDTMImporter.readGrid(text, header, stride);

    const modelFile = new ModelFile(name, 'asc', sourceBlob ?? text);

    // Surface pre-decimation dims so dispatchToScene can show the warning
    const fullHeader = {
      ...header,
      origNcols : header.ncols,
      origNrows : header.nrows,
      headerCRS : 'projected'
    };

    await this.dispatchToScene(grid, fullHeader, name, modelFile, modelFileId, opts, onModelLoad);
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
        while (pos < len && text.charCodeAt(pos) > 32) pos++;
      }

      srcCol++;
      if (srcCol >= ncols) {
        srcCol = 0;
        srcRow++;
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
}

/**
 * Importer for SRTM HGT (.hgt) Digital Terrain Model files.
 *
 * Format: raw `int16` big-endian binary, no header, square grid. Each value
 * is elevation in meters; `-32768` marks NODATA. Standard sizes are 1201²
 * (SRTM3, ~90m) or 3601² (SRTM1, ~30m).
 *
 * The filename encodes the SW corner of the 1° tile, e.g. `N47E019.hgt` =
 * lat 47°N..48°N, lon 19°E..20°E. We use this to set `model.embeddedCoords`
 * so the WGS84 dialog is auto-resolved per-model.
 *
 * Cell spacing is ~1°/(N-1). We convert to local meters using the
 * local-tangent-plane approximation: cellsizeY = 111320 / (N-1) and
 * cellsizeX = 111320 * cos(latCenter) / (N-1). Accurate within a fraction
 * of a percent across a 1° tile.
 */
export class HgtDTMImporter extends DTMImporterBase {

  // Standard SRTM file sizes → grid dimension. Non-standard sizes also
  // accepted when byteLength = 2 * dim² for some integer dim (handy for
  // test fixtures).
  static STANDARD_DIMS = { 25934402: 3601, 2884802: 1201 };

  // Approximate meters per degree (meridional / equatorial).
  static METERS_PER_DEG = 111320;

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
          await this.importData(event.target.result, onModelLoad, name, null, file, opts);
          resolve();
        } catch (e) {
          reject(e);
        }
      };
      reader.onerror = (error) => {
        console.error(errorMessage, error);
        reject(error);
      };
      reader.readAsArrayBuffer(file);
    });
  }

  async importData(arrayBuffer, onModelLoad, name, modelFileId = null, sourceBlob = null, opts = {}) {
    const dim = HgtDTMImporter.detectDim(arrayBuffer.byteLength);
    const tile = HgtDTMImporter.parseFilename(name);

    const maxCells = opts.maxCells ?? this.options?.scene?.models?.dtmMaxCells ?? 4_000_000;
    const stride = DTMImporterBase.computeStride(dim, dim, maxCells);

    // Stride used as a sampling step in (lat, lon). Each output cell maps to
    // a source cell at (round(nc*stride), round(nr*stride)). For local-metre
    // cellsize we just multiply by the same stride.
    const cellsizeYDeg = 1 / (dim - 1);
    const cellsizeXDeg = 1 / (dim - 1);
    const latCenter = tile.latMin + 0.5;

    const grid = HgtDTMImporter.readGrid(arrayBuffer, dim, stride);
    // Vertex positions are computed by UTM-projecting each (lat, lon) cell
    // corner. The grid object's cellsizeX/Y are only used by the legacy
    // flat-grid `buildVertexLayout` path — pre-compute them per-cell anyway
    // so that path still works for non-georeferenced consumers.
    grid.cellsizeX = HgtDTMImporter.METERS_PER_DEG * Math.cos((latCenter * Math.PI) / 180) / (dim - 1) * stride;
    grid.cellsizeY = HgtDTMImporter.METERS_PER_DEG / (dim - 1) * stride;

    // Pre-compute per-output-vertex world positions via WGS84 → UTM so the
    // DTM mesh shares the orthophoto's UTM frame exactly. Otherwise a 1°
    // tile is a trapezoid in UTM and a flat-grid mesh ends up ~600 m off
    // from any orthophoto placed by Mercator → WGS84 → UTM.
    const projectCS = opts.projectCS ?? this.#detectProjectCS(tile);
    grid.worldFrame = HgtDTMImporter.#buildUTMWorldFrame(
      tile, dim, stride, grid.ncols, grid.nrows, projectCS
    );

    const header = {
      ncols     : grid.ncols,
      nrows     : grid.nrows,
      xllcorner : tile.lonMin,
      yllcorner : tile.latMin,
      origNcols : dim,
      origNrows : dim
    };

    const modelFile = new ModelFile(name, 'hgt', sourceBlob ?? arrayBuffer);

    const wrapped = async (model, obj, mf) => {
      // If we built the mesh in UTM/EOV (project CS detected), the mesh's
      // local (0,0) corresponds to a known projected coordinate — set that
      // as the model's geoData so per-vertex world coordinates line up with
      // any other georeferenced model (e.g. an orthophoto). Otherwise fall
      // back to embeddedCoords (the SW WGS84 corner) and let main.js handle
      // conversion if a CS becomes available later.
      if (grid.worldOriginX !== undefined && grid.worldOriginY !== undefined && projectCS) {
        model.geoData = DTMImporterBase.buildGeoDataAt(
          projectCS, grid.worldOriginX, grid.worldOriginY
        );
      } else {
        model.embeddedCoords = {
          latitude  : tile.latMin,
          longitude : tile.lonMin,
          elevation : 0
        };
      }
      await onModelLoad(model, obj, mf);
    };

    await this.dispatchToScene(grid, header, name, modelFile, modelFileId, opts, wrapped);
  }

  /**
   * Sniff the project's existing CS so we can build the HGT mesh in that
   * same projection. Falls back to a UTM zone derived from the tile when the
   * project has no CS yet.
   */
  #detectProjectCS(tile) {
    const projectCS = this.detectProjectCS();
    if (projectCS) return projectCS;
    // No CS in the project yet — pick a sensible UTM zone from the tile's
    // longitude so the HGT is built in a real projection. Any subsequent
    // model with embeddedCoords ends up in the same zone via main.js.
    if (tile) {
      const lonCenter = tile.lonMin + 0.5;
      const latCenter = tile.latMin + 0.5;
      const zoneNum = Math.floor((lonCenter + 180) / 6) + 1;
      const northern = latCenter >= 0;
      return new UTMCoordinateSystem(zoneNum, northern);
    }
    return null;
  }

  /**
   * Build a per-vertex world-coordinate frame by projecting each cell from
   * WGS84 (lat, lon) into the project's CS (UTM or EOV). Returns
   * `{ worldX: Float32Array, worldY: Float32Array }` of length ncols*nrows,
   * each entry the world XY of the corresponding (row, col) vertex.
   * Row 0 = north. Coordinates are absolute (not relative to SW corner) —
   * `dispatchToScene` shifts them to local space when building positions.
   */
  static #buildUTMWorldFrame(tile, dim, stride, ncols, nrows, projectCS) {
    if (!projectCS) return null;
    const worldX = new Float32Array(ncols * nrows);
    const worldY = new Float32Array(ncols * nrows);
    const step = 1 / (dim - 1);
    for (let nr = 0; nr < nrows; nr++) {
      const srcRow = stride <= 1 ? nr : Math.min(dim - 1, Math.round(nr * stride));
      const lat = tile.latMin + (dim - 1 - srcRow) * step;
      for (let nc = 0; nc < ncols; nc++) {
        const srcCol = stride <= 1 ? nc : Math.min(dim - 1, Math.round(nc * stride));
        const lon = tile.lonMin + srcCol * step;
        const { y, x } = HgtDTMImporter.#wgs84ToProject(lat, lon, projectCS);
        worldX[nr * ncols + nc] = y; // east axis
        worldY[nr * ncols + nc] = x; // north axis
      }
    }
    return { worldX, worldY };
  }

  static #wgs84ToProject(lat, lon, cs) {
    if (cs.type === CoordinateSystemType.UTM) {
      const r = UTMConverter.fromLatLon(lat, lon, cs.zoneNum, cs.northern);
      return { y: r.easting, x: r.northing };
    }
    if (cs.type === CoordinateSystemType.EOV) {
      const [yEov, xEov] = EOVToWGS84Transformer.wgs84TOeov(lat, lon);
      return { y: yEov, x: xEov };
    }
    throw new Error(`Unsupported CS type for HGT world frame: ${cs.type}`);
  }

  static detectDim(byteLength) {
    if (HgtDTMImporter.STANDARD_DIMS[byteLength]) {
      return HgtDTMImporter.STANDARD_DIMS[byteLength];
    }
    if (byteLength % 2 !== 0) {
      throw new Error(`Unrecognized HGT file size: ${byteLength} bytes (not a multiple of 2)`);
    }
    const guess = Math.sqrt(byteLength / 2);
    if (Number.isInteger(guess) && guess > 1) return guess;
    throw new Error(`Unrecognized HGT file size: ${byteLength} bytes (not a square grid of int16)`);
  }

  /**
   * Extract { latMin, lonMin } from an HGT filename. Supports:
   *   N47E019.hgt, n47e019.hgt, /path/N47E019.hgt, N47E019.SRTMGL1.hgt,
   *   S05W034.hgt, etc.
   */
  static parseFilename(name) {
    const base = name.split('/').pop().toUpperCase();
    const m = base.match(/([NS])(\d{1,2})([EW])(\d{1,3})/);
    if (!m) throw new Error(`HGT filename must contain N/S## E/W### — got "${name}"`);
    return {
      latMin : parseInt(m[2], 10) * (m[1] === 'N' ? 1 : -1),
      lonMin : parseInt(m[4], 10) * (m[3] === 'E' ? 1 : -1)
    };
  }

  /**
   * Read elevations from a big-endian int16 raw HGT buffer. With stride > 1,
   * only the sampled cells are read (no allocation of the full grid).
   * NODATA (-32768) → NaN.
   */
  static readGrid(arrayBuffer, dim, stride) {
    const view = new DataView(arrayBuffer);
    const NODATA = -32768;

    if (stride <= 1) {
      const elevations = new Float32Array(dim * dim);
      for (let i = 0; i < dim * dim; i++) {
        const v = view.getInt16(i * 2, false); // big-endian
        elevations[i] = v === NODATA ? NaN : v;
      }
      return { ncols: dim, nrows: dim, elevations };
    }

    const newDim = Math.max(1, Math.floor(dim / stride));
    const elevations = new Float32Array(newDim * newDim);
    for (let nr = 0; nr < newDim; nr++) {
      const sr = Math.min(dim - 1, Math.round(nr * stride));
      const rowOffset = sr * dim;
      for (let nc = 0; nc < newDim; nc++) {
        const sc = Math.min(dim - 1, Math.round(nc * stride));
        const v = view.getInt16((rowOffset + sc) * 2, false);
        elevations[nr * newDim + nc] = v === NODATA ? NaN : v;
      }
    }
    return { ncols: newDim, nrows: newDim, elevations };
  }
}
