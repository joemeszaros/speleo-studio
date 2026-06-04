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
import { Vector, Mesh3D, ModelFile } from '../model.js';
import { i18n } from '../i18n/i18n.js';
import { showWarningPanel } from '../ui/popups.js';
import { DTMImporterBase } from './dtm-importer.js';
import {
  EOVCoordinateSystem,
  UTMCoordinateSystem,
  EOVCoordinateWithElevation,
  UTMCoordinateWithElevation,
  StationWithCoordinate,
  GeoData
} from '../model/geo.js';
import { WebMercatorConverter } from '../utils/geo.js';

/**
 * Importer for GeoTIFF (.tif, .tiff) files. Handles two kinds:
 *
 *   - **Elevation DTM** — single-band Float32/Int16 raster. Built into a 3D
 *     mesh / point cloud via the existing DTMImporterBase pipeline.
 *   - **Orthophoto** — multi-band 8-bit RGB(A) raster
 *     (`SamplesPerPixel ≥ 3`, `PhotometricInterpretation = 2`). Rendered as
 *     a flat textured plane via `THREE.DataTexture`, marked
 *     `model.modelKind = 'orthophoto'` so the auto-drape logic in main.js
 *     can attach it to a covering DTM.
 *
 * Auto-routing — no kind dialog. The RGB / DTM heuristic is unambiguous for
 * the common cases. The render-mode dialog (mesh vs point cloud) is shown
 * for all `.tif` files in the batch; the orthophoto path silently ignores
 * `opts.renderMode`.
 *
 * CRS handling: known EPSG codes (23700 EOV, 32601–32760 UTM, 3857 Web
 * Mercator) auto-resolve the model's placement so the WGS84 dialog is
 * skipped. Unknown CRS falls through to the dialog with the file's
 * xllcorner/yllcorner as reference.
 *
 * Uses the vendored geotiff.js library (loaded as `window.GeoTIFF` via a
 * `<script>` tag in index.html, same pattern as Tabulator).
 */
export class GeoTiffImporter extends DTMImporterBase {

  // Cap the orthophoto texture at this many pixels per side. geotiff.js does
  // the resampling natively via readRasters({width, height}); we never
  // allocate the full-resolution buffer for a huge image.
  static MAX_ORTHOPHOTO_SIDE = 4096;

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

  async importData(buffer, onModelLoad, name, modelFileId = null, sourceBlob = null, opts = {}) {
    if (typeof window === 'undefined' || !window.GeoTIFF) {
      throw new Error('GeoTIFF library is not loaded — check dependencies/geotiff/geotiff.js');
    }

    const tiff = await window.GeoTIFF.fromArrayBuffer(buffer);
    const image = await tiff.getImage();

    const ext = name.toLowerCase().endsWith('.tiff') ? 'tiff' : 'tif';
    const modelFile = new ModelFile(name, ext, sourceBlob ?? buffer);

    if (GeoTiffImporter.isRgbPhoto(image)) {
      await this.#importAsOrthophoto(image, name, modelFile, modelFileId, opts, onModelLoad);
    } else {
      await this.#importAsDtm(image, name, modelFile, modelFileId, opts, onModelLoad);
    }
  }

  /**
   * Header-only kind detection (no raster decode) for the import chooser: reads just the
   * GeoTIFF directory via a lazy Blob read and reports whether it is an RGB orthophoto or a
   * single-band elevation DTM. Falls back to 'dtm' if the library/header can't be read.
   */
  static async detectKind(file) {
    if (typeof window === 'undefined' || !window.GeoTIFF) return 'dtm';
    try {
      const tiff = await window.GeoTIFF.fromBlob(file);
      const image = await tiff.getImage();
      return GeoTiffImporter.isRgbPhoto(image) ? 'orthophoto' : 'dtm';
    } catch {
      return 'dtm';
    }
  }

  /**
   * RGB photo detection: multi-band 8-bit raster with photometric=RGB.
   * Real DTMs are single-band Float32/Int16; real photos are 3-4 band uint8.
   */
  static isRgbPhoto(image) {
    const samplesPerPixel = image.getSamplesPerPixel();
    const bps = image.fileDirectory.BitsPerSample || [];
    const photoInterp = image.fileDirectory.PhotometricInterpretation;
    return samplesPerPixel >= 3 && photoInterp === 2 && Array.from(bps).every((b) => b <= 8);
  }

  // ─── DTM path (single-band elevation) ─────────────────────────────────────

  async #importAsDtm(image, name, modelFile, modelFileId, opts, onModelLoad) {
    const ncols = image.getWidth();
    const nrows = image.getHeight();
    const origin = image.getOrigin();
    const resolution = image.getResolution();
    const geoKeys = image.getGeoKeys() || {};
    const nodata = image.getGDALNoData() ?? -9999;

    // Resolution → ground metres. For projected metric CRSs (EOV, UTM)
    // this is identity; for EPSG:3857 we divide out the Mercator stretch
    // (~1.64× at 52°N); for EPSG:4326 the file's resolution is in degrees,
    // which we convert via the standard 111320 m/° (×cos(lat) for X).
    const { absXRes, absYRes } = GeoTiffImporter.#groundCellSize(resolution, origin, nrows, geoKeys);

    const maxCells = opts.maxCells ?? this.options?.scene?.models?.dtmMaxCells ?? 4_000_000;
    const stride = DTMImporterBase.computeStride(ncols, nrows, maxCells);
    const newCols = stride <= 1 ? ncols : Math.max(1, Math.floor(ncols / stride));
    const newRows = stride <= 1 ? nrows : Math.max(1, Math.floor(nrows / stride));

    const rasters = await image.readRasters({
      samples        : [0],
      width          : newCols,
      height         : newRows,
      resampleMethod : 'nearest'
    });
    const band = rasters[0];

    const elevations = new Float32Array(band.length);
    for (let i = 0; i < band.length; i++) {
      const v = band[i];
      elevations[i] = v === nodata ? NaN : v;
    }

    // xMin/yMin are in **file CRS units** (degrees for 4326, Mercator
    // metres for 3857, metres for UTM/EOV) — that's what `resolvePlacement`
    // expects. We use the **raw** resolution here, not the ground-metres
    // values returned by #groundCellSize.
    const rawAbsYRes = Math.abs(resolution[1]);
    const xMin = origin[0];
    const yMin = origin[1] - nrows * rawAbsYRes;

    const grid = {
      ncols     : newCols,
      nrows     : newRows,
      cellsize  : absXRes,
      cellsizeX : absXRes * (stride > 1 ? stride : 1),
      cellsizeY : absYRes * (stride > 1 ? stride : 1),
      elevations
    };
    const header = {
      xllcorner : xMin,
      yllcorner : yMin,
      origNcols : ncols,
      origNrows : nrows
    };

    const placement = GeoTiffImporter.resolvePlacement(geoKeys, xMin, yMin);
    const wrapped = async (model, obj, mf) => {
      model.modelKind = 'dtm';
      GeoTiffImporter.applyPlacement(model, placement);
      await onModelLoad(model, obj, mf);
    };

    await this.dispatchToScene(grid, header, name, modelFile, modelFileId, opts, wrapped);
  }

  // ─── Orthophoto path (RGB raster as a flat textured plane) ───────────────

  async #importAsOrthophoto(image, name, modelFile, modelFileId, opts, onModelLoad) {
    const ncols = image.getWidth();
    const nrows = image.getHeight();
    const samplesPerPixel = image.getSamplesPerPixel();
    const origin = image.getOrigin();
    const resolution = image.getResolution();
    const geoKeys = image.getGeoKeys() || {};
    const { absXRes, absYRes } = GeoTiffImporter.#groundCellSize(resolution, origin, nrows, geoKeys);

    // Decide the output texture size. Cap by MAX_ORTHOPHOTO_SIDE to avoid
    // GPU memory blowups on huge orthophotos.
    const cap = GeoTiffImporter.MAX_ORTHOPHOTO_SIDE;
    const scale = Math.min(1, cap / Math.max(ncols, nrows));
    const texW = Math.max(1, Math.floor(ncols * scale));
    const texH = Math.max(1, Math.floor(nrows * scale));

    if (texW !== ncols || texH !== nrows) {
      showWarningPanel(
        i18n.t('errors.import.orthophotoDownsampled', {
          name,
          fromCols : ncols,
          fromRows : nrows,
          toCols   : texW,
          toRows   : texH
        })
      );
    }

    // Read 3 or 4 bands interleaved, so geotiff.js hands us a single Uint8Array
    // of (texW * texH * samplesPerPixel) bytes.
    const sampleList = samplesPerPixel >= 4 ? [0, 1, 2, 3] : [0, 1, 2];
    const rasterBytes = await image.readRasters({
      samples        : sampleList,
      width          : texW,
      height         : texH,
      resampleMethod : 'bilinear',
      interleave     : true
    });

    // Pack into RGBA — Three's RGBAFormat expects 4 components per pixel.
    const rgba = GeoTiffImporter.packToRgba(rasterBytes, texW, texH, samplesPerPixel);

    const tex = new THREE.DataTexture(rgba, texW, texH, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipMapLinearFilter;
    tex.generateMipmaps = true;
    tex.flipY = true; // GeoTIFF rows are top→bottom; Three's UVs go bottom→top
    if ('SRGBColorSpace' in THREE) tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;

    // Build the flat plane in local meters. Lower-left at the local origin
    // matches the DTM convention so per-model placement works the same way.
    //
    // Web Mercator (EPSG:3857) caveat: the raster's xRes/yRes are in
    // *Mercator* metres, which are stretched by 1/cos(latitude) relative to
    // `absXRes`/`absYRes` are already corrected to ground metres by
    // #groundCellSize (which handles EPSG:3857 Mercator stretch and EPSG:4326
    // degrees → m). Just multiply through by pixel counts.
    const widthMeters  = ncols * absXRes;
    const heightMeters = nrows * absYRes;

    const positions = new Float32Array([0, 0, 0, widthMeters, 0, 0, widthMeters, heightMeters, 0, 0, heightMeters, 0]);
    const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
    const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    const material = new THREE.MeshBasicMaterial({
      map         : tex,
      side        : THREE.DoubleSide,
      transparent : samplesPerPixel >= 4
    });

    const meshObject = new THREE.Mesh(geometry, material);

    // xMin/yMin in **file CRS units** for placement (see DTM path note).
    const rawAbsYRes = Math.abs(resolution[1]);
    const xMin = origin[0];
    const yMin = origin[1] - nrows * rawAbsYRes;
    const centerVector = new Vector(widthMeters / 2, heightMeters / 2, 0);
    const mesh = new Mesh3D(name, centerVector);
    mesh.firstPointCoords = [xMin, yMin, 0];

    // Snapshot of orthophoto metadata used by the drape logic. Kept on the
    // model so per-vertex UV computation later can compute the photo's world
    // bbox from its (placed) embeddedCoords/geoData.
    mesh.orthoMetadata = {
      widthMeters,
      heightMeters,
      texture    : tex,
      xResMeters : absXRes,
      yResMeters : absYRes,
      hasAlpha   : samplesPerPixel >= 4
    };

    const placement = GeoTiffImporter.resolvePlacement(geoKeys, xMin, yMin);
    const wrapped = async (model, obj, mf) => {
      model.modelKind = 'orthophoto';
      GeoTiffImporter.applyPlacement(model, placement);
      await onModelLoad(model, obj, mf);
    };

    await wrapped(mesh, meshObject, modelFile);
  }

  /**
   * Pack an interleaved RGB or RGBA Uint8Array into RGBA (Three's
   * DataTexture wants 4 components for RGBAFormat). Returns a new array.
   */
  /**
   * Translate a GeoTIFF's pixel resolution into **ground metres** per pixel,
   * accounting for the file's CRS:
   *
   * - Projected metric CRS (EOV / UTM / anything not 3857): pass through.
   * - EPSG:3857 (Web Mercator): file metres are stretched by 1/cos(lat) —
   *   divide out the secant scale factor at the raster's centre latitude.
   * - EPSG:4326 (WGS84 geographic): file resolution is in *degrees*, not
   *   metres at all. Convert via the standard ellipsoid approximation
   *   `111320 m/° latitude` and `111320·cos(lat) m/° longitude`.
   * - Other / unknown: pass through unchanged. Caller likely falls back to
   *   the manual WGS84 dialog anyway.
   *
   * @param {[number, number]} resolution    raster's xRes, yRes (absolute values not yet taken)
   * @param {[number, number, number]} origin top-left corner in file CRS units
   * @param {number} nrows                   raster's row count
   * @param {Object} geoKeys                 GeoTIFF GeoKeys object
   * @returns {{absXRes:number, absYRes:number}} ground metres per pixel
   */
  static #groundCellSize(resolution, origin, nrows, geoKeys) {
    let absXRes = Math.abs(resolution[0]);
    let absYRes = Math.abs(resolution[1]);
    const projectedCS = geoKeys.ProjectedCSTypeGeoKey;
    const geographicCS = geoKeys.GeographicTypeGeoKey;
    if (projectedCS === 3857) {
      const R = 6378137;
      const yCenterMerc = origin[1] - (nrows / 2) * absYRes;
      const latCenter = 2 * Math.atan(Math.exp(yCenterMerc / R)) - Math.PI / 2;
      const k = Math.cos(latCenter);
      absXRes *= k;
      absYRes *= k;
    } else if (!projectedCS && geographicCS === 4326) {
      const METERS_PER_DEG = 111320;
      // origin[1] is the file's yMax (top latitude) in degrees; midpoint is
      // half the file's height down from there.
      const latCenter = origin[1] - (nrows / 2) * absYRes;
      absXRes *= METERS_PER_DEG * Math.cos((latCenter * Math.PI) / 180);
      absYRes *= METERS_PER_DEG;
    }
    return { absXRes, absYRes };
  }

  static packToRgba(srcBytes, width, height, samplesPerPixel) {
    const px = width * height;
    if (samplesPerPixel >= 4) {
      return new Uint8Array(srcBytes.buffer, srcBytes.byteOffset, px * 4);
    }
    const rgba = new Uint8Array(px * 4);
    for (let i = 0; i < px; i++) {
      rgba[i * 4] = srcBytes[i * 3];
      rgba[i * 4 + 1] = srcBytes[i * 3 + 1];
      rgba[i * 4 + 2] = srcBytes[i * 3 + 2];
      rgba[i * 4 + 3] = 255;
    }
    return rgba;
  }

  // ─── Placement (CRS → geoData OR WGS84-embeddedCoords) ───────────────────

  /**
   * Convert GeoTIFF GeoKeys into placement info. Returns one of:
   *   - `{ geoData: GeoData }`            — known projected CS (EOV / UTM); place directly
   *   - `{ embeddedCoords: { latitude, longitude, elevation } }` — WGS84-ish; let main.js convert
   *   - `null`                            — unknown CRS; fall back to the manual WGS84 dialog
   *
   * Supported EPSG codes:
   *  - 23700        → Hungarian EOV
   *  - 32601–32660  → UTM N zones 1–60
   *  - 32701–32760  → UTM S zones 1–60
   *  - 3857         → Web Mercator (most cloud-hosted orthophotos)
   *  - 4326         → WGS84 geographic (lon/lat as raster coords)
   */
  static resolvePlacement(geoKeys, xMin, yMin) {
    const projectedCS = geoKeys.ProjectedCSTypeGeoKey;
    const geographicCS = geoKeys.GeographicTypeGeoKey;

    if (projectedCS === 23700) {
      const coord = new EOVCoordinateWithElevation(xMin, yMin, 0);
      return {
        geoData : new GeoData(new EOVCoordinateSystem(), [new StationWithCoordinate('origin', coord)])
      };
    }

    if (Number.isInteger(projectedCS)) {
      if (projectedCS >= 32601 && projectedCS <= 32660) {
        const zoneNum = projectedCS - 32600;
        const coord = new UTMCoordinateWithElevation(xMin, yMin, 0);
        return {
          geoData : new GeoData(new UTMCoordinateSystem(zoneNum, true), [new StationWithCoordinate('origin', coord)])
        };
      }
      if (projectedCS >= 32701 && projectedCS <= 32760) {
        const zoneNum = projectedCS - 32700;
        const coord = new UTMCoordinateWithElevation(xMin, yMin, 0);
        return {
          geoData : new GeoData(new UTMCoordinateSystem(zoneNum, false), [new StationWithCoordinate('origin', coord)])
        };
      }
      if (projectedCS === 3857) {
        // Web Mercator (EPSG:3857). The file's xMin/yMin are Mercator metres
        // — convert to WGS84 and let main.js's per-model embeddedCoords flow
        // turn that into a project-CS geoData (EOV / UTM, picking up an
        // existing project CS if one's set).
        const { latitude, longitude } = WebMercatorConverter.toLatLon(xMin, yMin);
        return { embeddedCoords: { latitude, longitude, elevation: 0 } };
      }
    }

    if (geographicCS === 4326) {
      // WGS84 geographic raster: xMin = longitude, yMin = latitude.
      return { embeddedCoords: { latitude: yMin, longitude: xMin, elevation: 0 } };
    }

    return null;
  }

  /**
   * Apply a placement result (from `resolvePlacement`) to a model. Sets
   * `model.geoData` or `model.embeddedCoords`. main.js's import-time flow
   * picks these up: per-model embeddedCoords get converted into the project
   * CS, and pre-set geoData is respected as-is.
   */
  static applyPlacement(model, placement) {
    if (!placement) return;
    if (placement.geoData) model.geoData = placement.geoData;
    if (placement.embeddedCoords) {
      model.embeddedCoords = placement.embeddedCoords;
    }
  }
}
