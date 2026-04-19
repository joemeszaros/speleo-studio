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

/**
 * Client-side octree for efficient point cloud rendering with LOD.
 * Each octree node holds either a subsample (internal) or full point data (leaf).
 * Per-frame traversal uses Screen-Space Error (SSE) to decide which nodes to render,
 * achieving Potree-quality LOD without requiring offline preprocessing.
 */
export class PointCloudOctree {

  /**
   * @param {Array} nodesData - Serialized octree nodes from the Web Worker
   * @param {object} options - { pointBudget, sseThreshold, pointSize }
   */
  constructor(nodesData, options) {
    this.group = new THREE.Group();
    this.nodes = new Map(); // id → { data, threePoints, visible }
    this.pointBudget = options.pointBudget;
    this.sseThreshold = options.sseThreshold;
    this.material = new THREE.PointsMaterial({
      vertexColors    : true,
      size            : options.pointSize,
      sizeAttenuation : false
    });

    // Reusable temporaries to avoid per-frame allocations
    this._frustum = new THREE.Frustum();
    this._projScreenMatrix = new THREE.Matrix4();
    this._size = new THREE.Vector2();
    this._bbox = new THREE.Box3();
    this._bboxSize = new THREE.Vector3();
    this._bboxCenter = new THREE.Vector3();
    this._prevVisible = new Set(); // nodes visible last frame — used for cheap hide-only-changed

    // Build node map from serialized data
    for (const nodeData of nodesData) {
      this.nodes.set(nodeData.id, {
        data        : nodeData,
        threePoints : null,
        visible     : false
      });
    }
  }

  /**
   * Per-frame visibility update using SSE-based octree traversal.
   * Shows/hides nodes to maintain the point budget with hierarchical LOD.
   * @param {THREE.Camera} camera
   * @param {THREE.WebGLRenderer} renderer
   * @param {object} [opts]
   * @param {boolean} [opts.skipCameraUpdate] - Skip camera matrix updates (caller already did them)
   */
  updateVisibility(camera, renderer, opts = {}) {
    // Ensure camera matrices are current. Callers that process multiple octrees
    // can hoist this once and pass skipCameraUpdate=true to avoid 8× redundancy.
    if (!opts.skipCameraUpdate) {
      camera.updateMatrixWorld();
      camera.updateProjectionMatrix();
    }

    // Build frustum from camera
    this._projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this._frustum.setFromProjectionMatrix(this._projScreenMatrix);
    const screenHeight = renderer.getSize(this._size).y;

    // Hide only nodes that were visible last frame (avoids iterating all ~1000 nodes each frame)
    for (const node of this._prevVisible) {
      if (node.threePoints) node.threePoints.visible = false;
      node.visible = false;
    }
    this._prevVisible.clear();

    // Coarse octree-level frustum cull: if the entire octree's root bbox is
    // outside the frustum, skip all ~1000 node iterations and return early.
    const root = this.nodes.get(0);
    if (!root) return;
    if (this.group.matrixWorldNeedsUpdate) this.group.updateMatrixWorld();
    this._bbox.min.set(root.data.bbox.min[0], root.data.bbox.min[1], root.data.bbox.min[2]);
    this._bbox.max.set(root.data.bbox.max[0], root.data.bbox.max[1], root.data.bbox.max[2]);
    this._bbox.applyMatrix4(this.group.matrixWorld);
    if (!this._frustum.intersectsBox(this._bbox)) return;

    // Level-by-level (breadth-first) traversal with additive refinement.
    // All in-frustum nodes at a level are shown together (uniform density),
    // and the budget is checked BETWEEN levels — never mid-level — to avoid
    // rectangular density holes at node boundaries.
    let currentLevel = [0]; // root node ID
    let visiblePoints = 0;

    while (currentLevel.length > 0) {
      // Show all in-frustum nodes at this level, compute SSE for refinement decision
      let refineCount = 0;
      let visibleCount = 0;
      let nonLeafCount = 0;
      const nextLevel = [];

      for (const nodeId of currentLevel) {
        const node = this.nodes.get(nodeId);
        if (!node) continue;
        const { data } = node;

        this._bbox.min.set(data.bbox.min[0], data.bbox.min[1], data.bbox.min[2]);
        this._bbox.max.set(data.bbox.max[0], data.bbox.max[1], data.bbox.max[2]);
        this._bbox.applyMatrix4(this.group.matrixWorld);

        if (!this._frustum.intersectsBox(this._bbox)) continue;

        this.#showNode(node);
        visiblePoints += data.pointCount;
        visibleCount++;

        if (!data.isLeaf) {
          this._bbox.getSize(this._bboxSize);
          const nodeSize = this._bboxSize.length();
          this._bbox.getCenter(this._bboxCenter);
          const distance = Math.max(camera.position.distanceTo(this._bboxCenter), 0.1);
          const fov = ((camera.fov || 60) * Math.PI) / 180;
          const sse = (nodeSize * screenHeight) / (distance * 2 * Math.tan(fov / 2));

          nonLeafCount++;
          if (sse >= this.sseThreshold) {
            refineCount++;
            for (const childId of data.childIds) {
              if (childId >= 0) nextLevel.push(childId);
            }
          }
        }
      }

      // Budget check between levels — never cut mid-level to avoid density holes
      if (visiblePoints >= this.pointBudget) break;

      // Collective refinement: >30% of refinable (non-leaf) nodes must want to go deeper.
      // Leaf nodes are excluded from the denominator — they can't refine regardless.
      if (nonLeafCount === 0 || refineCount <= nonLeafCount * 0.3) break;
      if (nextLevel.length === 0) break;

      currentLevel = nextLevel;
    }
  }

  #showNode(node) {
    // Lazy THREE.Points creation
    if (!node.threePoints) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(node.data.positions, 3));
      if (node.data.colors) {
        geometry.setAttribute('color', new THREE.BufferAttribute(node.data.colors, 3, true));
      }
      geometry.computeBoundingSphere();

      node.threePoints = new THREE.Points(geometry, this.material);
      node.threePoints.frustumCulled = false; // We do our own frustum culling at the octree level
      node.threePoints.layers.set(2); // dedicated "3D models" layer — visible in overview too
      this.group.add(node.threePoints);
    }
    node.threePoints.visible = true;
    node.visible = true;
    this._prevVisible.add(node);
  }

  /**
   * Update point size for all created THREE.Points.
   * @param {number} size
   */
  updatePointSize(size) {
    this.material.size = size;
    this.material.needsUpdate = true;
  }

  /**
   * Update gradient colors for all nodes (when user changes color config).
   * @param {string} colorStart - Hex color string
   * @param {string} colorEnd - Hex color string
   * @param {boolean} hasNativeColors - If true, skip (LAS file had RGB)
   */
  updateGradientColors(colorStart, colorEnd, hasNativeColors) {
    if (hasNativeColors) return;

    // Find global Z range
    let minZ = Infinity,
      maxZ = -Infinity;
    for (const node of this.nodes.values()) {
      const pos = node.data.positions;
      for (let i = 2; i < pos.length; i += 3) {
        if (pos[i] < minZ) minZ = pos[i];
        if (pos[i] > maxZ) maxZ = pos[i];
      }
    }
    const rangeZ = maxZ - minZ || 1;

    const sr = parseInt(colorStart.slice(1, 3), 16);
    const sg = parseInt(colorStart.slice(3, 5), 16);
    const sb = parseInt(colorStart.slice(5, 7), 16);
    const er = parseInt(colorEnd.slice(1, 3), 16);
    const eg = parseInt(colorEnd.slice(3, 5), 16);
    const eb = parseInt(colorEnd.slice(5, 7), 16);

    for (const node of this.nodes.values()) {
      const pos = node.data.positions;
      const count = pos.length / 3;
      const colors = new Uint8Array(count * 3);

      for (let i = 0; i < count; i++) {
        const t = (pos[i * 3 + 2] - minZ) / rangeZ;
        colors[i * 3] = Math.round(sr + (er - sr) * t);
        colors[i * 3 + 1] = Math.round(sg + (eg - sg) * t);
        colors[i * 3 + 2] = Math.round(sb + (eb - sb) * t);
      }

      node.data.colors = colors;

      // Update existing Three.js geometry if it was already created
      if (node.threePoints) {
        const geometry = node.threePoints.geometry;
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3, true));
      }
    }
  }

  /**
   * Dispose all GPU resources.
   */
  dispose() {
    for (const node of this.nodes.values()) {
      if (node.threePoints) {
        node.threePoints.geometry.dispose();
      }
    }
    this.material.dispose();
    this.nodes.clear();
    this._prevVisible.clear();
  }
}
