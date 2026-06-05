/*
 * Copyright 2024 Joe Meszaros
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

// Renders two kinds of per-cave point markers, both as pixel-sized spheres in one group:
//   - the START POINT (first survey's start station) — `scene.startPoints` config / `startPoint` material
//   - ENTRANCE markers (stations flagged via Survex *entrance / Therion `entrance`) — `scene.entrances`
//     config / `entrance` material
// The two share this class and group but have independent color, size and visibility.
export class StartPointScene {

  constructor(options, materials, scene) {
    this.options = options;
    this.mats = materials.materials;
    this.scene = scene;
    this.startPoints3DGroup = new THREE.Group();
    this.startPoints3DGroup.name = 'starting points';
    // cave.name -> { mesh?, geometry?, entranceMeshes: [{ mesh, geometry }] }
    this.startPointObjects = new Map();
    this.scene.addObjectToScene(this.startPoints3DGroup);
  }

  // Build a pixel-sized sphere and add it to the group.
  #makeSphere(position, name, radius, material, visible) {
    const _8_px = this.scene.view.control.getWorldUnitsForPixels(8);
    const geometry = new THREE.SphereGeometry((radius || 1) * _8_px, 8, 8);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(position);
    mesh.name = name;
    mesh.visible = visible;
    mesh.layers.set(1);
    this.startPoints3DGroup.add(mesh);
    return { mesh, geometry };
  }

  addOrUpdateStartingPoint(cave) {
    // Remove existing markers for this cave if they exist
    if (this.startPointObjects.has(cave.name)) {
      this.removeStartingPoint(cave.name);
    }

    const caveVisible = cave.visible !== false;
    const startCfg = this.options.scene.startPoints;
    const entCfg = this.options.scene.entrances;

    // Start point — the first survey's start station.
    let start;
    const firstStation = cave.getFirstStation();
    if (firstStation) {
      start = this.#makeSphere(
        firstStation.position,
        `startPoint_${cave.name}`,
        startCfg.radius,
        this.mats.sphere.startPoint,
        startCfg.show && caveVisible
      );
    }

    // Entrance markers — every station flagged as an entrance across this cave's subtree.
    // Keys match getAllStations() keys (qualified for multi-survey caves, bare otherwise).
    const allStations = cave.getAllStations();
    const entranceMeshes = [];
    const seen = new Set();
    cave.walk((c) => {
      (c.entrances ?? []).forEach((key) => {
        if (seen.has(key)) return;
        seen.add(key);
        const station = allStations.get(key);
        if (station) {
          entranceMeshes.push(
            this.#makeSphere(
              station.position,
              `entrance_${cave.name}_${key}`,
              entCfg.radius,
              this.mats.sphere.entrance,
              entCfg.show && caveVisible
            )
          );
        }
      });
    });

    if (!start && entranceMeshes.length === 0) return;

    this.startPointObjects.set(cave.name, {
      mesh     : start?.mesh,
      geometry : start?.geometry,
      entranceMeshes
    });

    return start?.mesh;
  }

  removeStartingPoint(caveName) {
    const obj = this.startPointObjects.get(caveName);
    if (!obj) return;
    if (obj.mesh) {
      this.startPoints3DGroup.remove(obj.mesh);
      obj.geometry.dispose();
    }
    (obj.entranceMeshes ?? []).forEach((e) => {
      this.startPoints3DGroup.remove(e.mesh);
      e.geometry.dispose();
    });
    // Materials are shared across all caves — never dispose them here.
    this.startPointObjects.delete(caveName);
  }

  renameCave(oldName, newName) {
    if (this.startPointObjects.has(oldName)) {
      const obj = this.startPointObjects.get(oldName);
      this.startPointObjects.delete(oldName);
      this.startPointObjects.set(newName, obj);
      if (obj.mesh) obj.mesh.name = `startPoint_${newName}`;
    }
  }

  // ── Start point appearance ──────────────────────────────────────────────────

  toggleStartingPointsVisibility(visible) {
    this.startPointObjects.forEach((obj) => {
      if (obj.mesh) obj.mesh.visible = visible;
    });
  }

  updateStartingPointColor(color) {
    this.mats.sphere.startPoint.color = new THREE.Color(color);
  }

  updateStartingPointRadius() {
    this.updateAllMarkerSizes();
  }

  // ── Entrance appearance ─────────────────────────────────────────────────────

  toggleEntrancesVisibility(visible) {
    this.startPointObjects.forEach((obj) => {
      (obj.entranceMeshes ?? []).forEach((e) => (e.mesh.visible = visible));
    });
  }

  updateEntranceColor(color) {
    this.mats.sphere.entrance.color = new THREE.Color(color);
  }

  updateEntranceRadius() {
    this.updateAllMarkerSizes();
  }

  // ── Per-cave visibility (cave shown/hidden in the tree) ─────────────────────

  updateStartingPointVisibility(caveName, caveVisible) {
    const obj = this.startPointObjects.get(caveName);
    if (!obj) return;
    if (obj.mesh) obj.mesh.visible = this.options.scene.startPoints.show && caveVisible;
    (obj.entranceMeshes ?? []).forEach((e) => (e.mesh.visible = this.options.scene.entrances.show && caveVisible));
    this.scene.view.renderView();
  }

  // ── Pixel-size maintenance ──────────────────────────────────────────────────
  // Start points and entrances keep a constant pixel size, so their world-space radius is
  // recomputed on zoom/dolly. Each kind uses its own configured radius.

  updateAllMarkerSizes() {
    const _8_px = this.scene.view.control.getWorldUnitsForPixels(8);
    const startR = this.options.scene.startPoints.radius ?? 1;
    const entR = this.options.scene.entrances.radius ?? 1;
    const resize = (mesh, r) => {
      const geometry = new THREE.SphereGeometry(r * _8_px, 8, 8);
      mesh.geometry.dispose();
      mesh.geometry = geometry;
      return geometry;
    };
    this.startPointObjects.forEach((obj) => {
      if (obj.mesh) obj.geometry = resize(obj.mesh, startR);
      (obj.entranceMeshes ?? []).forEach((e) => {
        e.geometry = resize(e.mesh, entR);
      });
    });
  }

  // Kept for the existing zoom callers in views.js.
  updateAllStartPointSizes() {
    this.updateAllMarkerSizes();
  }

  // Throttled variant for high-frequency callers (wheel zoom / dolly). Runs every 3rd call and
  // schedules a trailing-edge flush 80 ms after the last call so the spheres settle correctly
  // when scrolling stops mid-counter.
  updateAllStartPointSizesThrottled() {
    this._tick = (this._tick ?? 0) + 1;
    if (this._tick % 3 === 0) {
      this.updateAllMarkerSizes();
    }
    clearTimeout(this._settleTimer);
    this._settleTimer = setTimeout(() => this.updateAllMarkerSizes(), 80);
  }
}
