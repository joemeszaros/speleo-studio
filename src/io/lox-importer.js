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

// Imports Therion's binary .lox format: triangulated scrap wall mesh + survey centerline.
// Format spec derived from therion/src/common-utils/lxFile.h + lxFile.cxx.
// DEM surface chunks (type 5/6) and LRUD tube generation are out of scope.

import { Importer } from './importer-base.js';
import { Mesh3D, ModelFile, Vector } from '../model.js';
import { globalNormalizer } from '../utils/global-coordinate-normalizer.js';
import * as THREE from 'three';

// Chunk type constants (from lxFile.cxx)
const CHUNK_STATION    = 2;
const CHUNK_SHOT       = 3;
const CHUNK_SCRAP      = 4;

// Shot flag bitmask values (LXFILE_SHOT_FLAG_*)
const SHOT_FLAG_SURFACE     = 1;
const SHOT_FLAG_DUPLICATE   = 2;
const SHOT_FLAG_NOT_VISIBLE = 4;
const SHOT_FLAG_SPLAY       = 16;

class LoxImporter extends Importer {

  async importFile(file, name, onModelLoad) {
    await super.importFileAsArrayBuffer(file, name, onModelLoad);
  }

  async importData(arrayBuffer, onModelLoad, name) {
    const { stations, shots, scraps } = this.#parseLox(arrayBuffer);

    // Auto-center geometry to preserve Float32 precision (large UTM coordinates).
    const center  = this.#computeCenter(stations, scraps);
    // When a cave is already loaded the globalNormalizer has an origin; offset
    // by that so this model lands in the same coordinate space.
    const normOff = this.#getNormalizerOffset();
    const ox = center[0] + normOff[0];
    const oy = center[1] + normOff[1];
    const oz = center[2] + normOff[2];

    const group = new THREE.Group();
    group.name = name;

    if (scraps.length > 0) {
      const geom = this.#buildScrapGeometry(scraps, ox, oy, oz);
      geom.computeVertexNormals();
      // MeshLambertMaterial: diffuse-only (no specular), so the camera-following
      // headLight doesn't create harsh face-by-face contrast on low-poly cave meshes.
      // emissive keeps shadow-facing triangles from going pitch-black.
      // vertexColors: true is set upfront so the gradient color mode activates cleanly.
      const mat = new THREE.MeshLambertMaterial({
        color        : 0xffffff,
        emissive     : new THREE.Color(0x282828),
        vertexColors : true,
        side         : THREE.DoubleSide
      });
      group.add(new THREE.Mesh(geom, mat));
    }

    if (stations.size > 0 && shots.length > 0) {
      const geom = this.#buildCenterlineGeometry(stations, shots, ox, oy, oz);
      if (geom) {
        const mat = new THREE.LineBasicMaterial({ color: 0xff5500 });
        group.add(new THREE.LineSegments(geom, mat));
      }
    }

    const centerVector = new Vector(center[0], center[1], center[2]);
    const mesh = new Mesh3D(name, centerVector);

    // Provide first station coords as a hint in ModelCoordinateDialog.
    if (stations.size > 0) {
      const first = stations.values().next().value;
      mesh.firstPointCoords = [first.x, first.y, first.z];
    }

    const modelFile = new ModelFile(name, 'lox', arrayBuffer);
    await onModelLoad(mesh, group, modelFile);
  }

  // ── Binary parser ──────────────────────────────────────────────────────────

  // Reads the .lox file chunk by chunk and returns raw geometry data.
  // File layout: sequential chunks until EOF.
  // Each chunk: 16-byte header (type, recSize, recCount, dataSize) → records → aux data.
  // recSize is the TOTAL bytes for all records combined (not per-record).
  #parseLox(arrayBuffer) {
    const view       = new DataView(arrayBuffer);
    const byteLength = arrayBuffer.byteLength;
    let   pos        = 0;

    const stations = new Map(); // id (uint32) → {x, y, z, flags}
    const shots    = [];        // [{from, to, flags}]
    const scraps   = [];        // [{points:[{x,y,z}], triangles:[{a,b,c}]}]

    while (pos + 16 <= byteLength) {
      const type     = view.getUint32(pos,      true); pos += 4;
      const recSize  = view.getUint32(pos,      true); pos += 4;
      const recCount = view.getUint32(pos,      true); pos += 4;
      const dataSize = view.getUint32(pos,      true); pos += 4;

      const recStart  = pos;
      const auxStart  = recStart + recSize;  // aux data (strings, point/triangle arrays) follows records
      const nextChunk = auxStart + dataSize;

      if (nextChunk > byteLength) break;

      if (recCount > 0 && recSize > 0) {
        const perRec = recSize / recCount;

        switch (type) {

          case CHUNK_STATION:
            // Station record layout (52 bytes):
            //  0: id              (uint32)
            //  4: surveyId        (uint32)
            //  8: namePtr.position (uint32)
            // 12: namePtr.size     (uint32)
            // 16: commentPtr.position (uint32)
            // 20: commentPtr.size     (uint32)
            // 24: flags           (uint32)
            // 28: x               (float64)
            // 36: y               (float64)
            // 44: z               (float64)
            for (let i = 0; i < recCount; i++) {
              const rp    = recStart + i * perRec;
              const id    = view.getUint32(rp,      true);
              const flags = view.getUint32(rp + 24, true);
              const x     = view.getFloat64(rp + 28, true);
              const y     = view.getFloat64(rp + 36, true);
              const z     = view.getFloat64(rp + 44, true);
              stations.set(id, { x, y, z, flags });
            }
            break;

          case CHUNK_SHOT:
            // Shot record layout (92 bytes):
            //  0: from            (uint32)
            //  4: to              (uint32)
            //  8: fLRUD[4]        (4 × float64 = 32 bytes) — LRUD at FROM station
            // 40: tLRUD[4]        (4 × float64 = 32 bytes) — LRUD at TO station
            // 72: flags           (uint32)
            // 76: sectionType     (uint32)
            // 80: surveyId        (uint32)
            // 84: threshold       (float64)
            for (let i = 0; i < recCount; i++) {
              const rp    = recStart + i * perRec;
              const from  = view.getUint32(rp,      true);
              const to    = view.getUint32(rp +  4, true);
              const flags = view.getUint32(rp + 72, true);
              shots.push({ from, to, flags });
            }
            break;

          case CHUNK_SCRAP:
            // Scrap record layout (32 bytes):
            //  0: id                    (uint32)
            //  4: surveyId              (uint32)
            //  8: numPoints             (uint32)
            // 12: pointsPtr.position    (uint32) — offset into aux data
            // 16: pointsPtr.size        (uint32)
            // 20: num3Angles            (uint32)
            // 24: trianglesPtr.position (uint32) — offset into aux data
            // 28: trianglesPtr.size     (uint32)
            // Aux data:
            //   Points:    numPoints  × lxFile3Point  (3 × float64 = 24 bytes)
            //   Triangles: num3Angles × lxFile3Angle  (3 × uint32  = 12 bytes)
            for (let i = 0; i < recCount; i++) {
              const rp        = recStart + i * perRec;
              const numPoints = view.getUint32(rp +  8, true);
              const ptsPos    = view.getUint32(rp + 12, true);
              const numTris   = view.getUint32(rp + 20, true);
              const trisPos   = view.getUint32(rp + 24, true);

              const points = [];
              for (let p = 0; p < numPoints; p++) {
                const ap = auxStart + ptsPos + p * 24;
                points.push({
                  x: view.getFloat64(ap,      true),
                  y: view.getFloat64(ap +  8, true),
                  z: view.getFloat64(ap + 16, true)
                });
              }

              const triangles = [];
              for (let t = 0; t < numTris; t++) {
                const at = auxStart + trisPos + t * 12;
                const a  = view.getUint32(at,     true);
                const b  = view.getUint32(at + 4, true);
                const c  = view.getUint32(at + 8, true);
                // Some .lox files contain degenerate triangles — skip them.
                if (a !== b && a !== c && b !== c) triangles.push({ a, b, c });
              }

              // Fix winding order consistency within each scrap.
              // Therion does not guarantee that consecutive triangles in a scrap
              // share edges in opposite directions (the invariant required for a
              // consistently-wound mesh). When two adjacent triangles share an edge
              // in the SAME direction they are wound oppositely, and
              // computeVertexNormals() will average opposing normals → near-zero
              // result → dark patches. We detect this case and reverse the winding
              // of the offending triangle (port of CaveView.js fix_direction).
              for (let t = 1; t < triangles.length; t++) {
                const cur  = triangles[t];
                const prev = triangles[t - 1];
                const ce = [[cur.a,  cur.b],  [cur.b,  cur.c],  [cur.c,  cur.a]];
                const pe = [[prev.a, prev.b], [prev.b, prev.c], [prev.c, prev.a]];
                let flip = false;
                outer: for (const [p0, p1] of pe) {
                  for (const [c0, c1] of ce) {
                    if (c0 === p0 && c1 === p1) { flip = true; break outer; }
                  }
                }
                if (flip) triangles[t] = { a: cur.a, b: cur.c, c: cur.b };
              }

              scraps.push({ points, triangles });
            }
            break;

          // CHUNK_SURVEY (1), CHUNK_SURFACE (5), CHUNK_SURFACEBMP (6): skip silently.
        }
      }

      pos = nextChunk;
    }

    return { stations, shots, scraps };
  }

  // ── Geometry helpers ───────────────────────────────────────────────────────

  // Returns the bounding-box centroid over all stations and scrap points.
  // Used to shift coordinates to the origin before storing as Float32.
  #computeCenter(stations, scraps) {
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;

    const expand = (x, y, z) => {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    };

    for (const { x, y, z } of stations.values()) expand(x, y, z);
    for (const { points } of scraps) for (const { x, y, z } of points) expand(x, y, z);

    if (!isFinite(minX)) return [0, 0, 0];
    return [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
  }

  // Returns the global coordinate origin so this model aligns with any cave
  // already loaded in the scene. Returns [0,0,0] when no cave is loaded yet.
  #getNormalizerOffset() {
    if (!globalNormalizer.isInitialized()) return [0, 0, 0];
    const o = globalNormalizer.globalOrigin;
    if (!o) return [0, 0, 0];
    return [
      o.easting  !== undefined ? o.easting  : (o.y ?? 0),
      o.northing !== undefined ? o.northing : (o.x ?? 0),
      o.elevation ?? 0
    ];
  }

  // Builds the cave wall geometry by concatenating all scrap meshes.
  // Vertices are NOT merged across scrap boundaries even where scraps share edges,
  // because adjacent scraps can have opposite winding orders. Merging them would
  // cause computeVertexNormals() to average opposing normals → dark triangles.
  // The winding correction applied during parsing (#parseLox) handles consistency
  // within each scrap; cross-scrap seams are hidden by DoubleSide rendering.
  #buildScrapGeometry(scraps, ox, oy, oz) {
    let totalVerts = 0, totalTris = 0;
    for (const { points, triangles } of scraps) {
      totalVerts += points.length;
      totalTris  += triangles.length;
    }

    const positions = new Float32Array(totalVerts * 3);
    // Use 32-bit indices only when the vertex count exceeds the 16-bit limit.
    const idxArray  = totalVerts > 65535
      ? new Uint32Array(totalTris * 3)
      : new Uint16Array(totalTris * 3);

    let vi = 0, ii = 0, vertOffset = 0;
    for (const { points, triangles } of scraps) {
      for (const { x, y, z } of points) {
        positions[vi++] = x - ox;
        positions[vi++] = y - oy;
        positions[vi++] = z - oz;
      }
      for (const { a, b, c } of triangles) {
        idxArray[ii++] = vertOffset + a;
        idxArray[ii++] = vertOffset + b;
        idxArray[ii++] = vertOffset + c;
      }
      vertOffset += points.length;
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setIndex(new THREE.BufferAttribute(idxArray, 1));
    return geom;
  }

  // Builds the survey centerline as line segments.
  // Surface, duplicate, invisible, and splay shots are excluded — only the
  // primary underground passage legs are shown.
  #buildCenterlineGeometry(stations, shots, ox, oy, oz) {
    const skipMask = SHOT_FLAG_SURFACE | SHOT_FLAG_DUPLICATE | SHOT_FLAG_NOT_VISIBLE | SHOT_FLAG_SPLAY;
    const visible  = shots.filter(s => !(s.flags & skipMask));
    if (visible.length === 0) return null;

    // Build a compact vertex array containing only the referenced stations.
    const idToIdx = new Map();
    for (const { from, to } of visible) {
      if (!idToIdx.has(from)) idToIdx.set(from, idToIdx.size);
      if (!idToIdx.has(to))   idToIdx.set(to,   idToIdx.size);
    }

    const positions = new Float32Array(idToIdx.size * 3);
    for (const [id, idx] of idToIdx) {
      const st = stations.get(id);
      if (!st) continue;
      positions[idx * 3]     = st.x - ox;
      positions[idx * 3 + 1] = st.y - oy;
      positions[idx * 3 + 2] = st.z - oz;
    }

    const lineIdx = new Uint32Array(visible.length * 2);
    let li = 0;
    for (const { from, to } of visible) {
      lineIdx[li++] = idToIdx.get(from);
      lineIdx[li++] = idToIdx.get(to);
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setIndex(new THREE.BufferAttribute(lineIdx, 1));
    return geom;
  }
}

export { LoxImporter };
