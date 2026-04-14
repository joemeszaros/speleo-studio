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
   */
  updateVisibility(camera, renderer) {
    // Ensure camera matrices are current (they may be stale if updateVisibility
    // runs before the renderer's own matrix update within the animation loop)
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();

    // Build frustum from camera
    this._projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this._frustum.setFromProjectionMatrix(this._projScreenMatrix);
    const screenHeight = renderer.getSize(this._size).y;

    // Reset all nodes to hidden
    for (const node of this.nodes.values()) {
      if (node.threePoints) node.threePoints.visible = false;
      node.visible = false;
    }

    // Level-by-level (breadth-first) traversal with additive refinement.
    // Each level is processed fully. The refinement decision (whether to go
    // one level deeper) is made for the ENTIRE level collectively — if most
    // visible nodes at a level want to refine, ALL refine. This prevents
    // per-node SSE differences from creating rectangular density boundaries.
    let currentLevel = [];
    const root = this.nodes.get(0);
    if (!root) return;

    currentLevel.push(0); // root node ID
    let visiblePoints = 0;

    while (currentLevel.length > 0) {
      // First pass: show all nodes at this level, compute SSE for each
      let refineCount = 0;
      let visibleCount = 0;
      const nodesAtLevel = []; // { node, shouldRefine }

      for (const nodeId of currentLevel) {
        const node = this.nodes.get(nodeId);
        if (!node) continue;

        const { data } = node;

        // Build bbox
        this._bbox.min.set(data.bbox.min[0], data.bbox.min[1], data.bbox.min[2]);
        this._bbox.max.set(data.bbox.max[0], data.bbox.max[1], data.bbox.max[2]);

        if (this.group.matrixWorldNeedsUpdate) this.group.updateMatrixWorld();
        this._bbox.applyMatrix4(this.group.matrixWorld);

        // Frustum cull
        if (!this._frustum.intersectsBox(this._bbox)) continue;

        // Always show this node (disjoint point sets — additive refinement)
        this.#showNode(node);
        visiblePoints += data.pointCount;
        visibleCount++;

        // Compute SSE
        this._bbox.getSize(this._bboxSize);
        const nodeSize = this._bboxSize.length();
        this._bbox.getCenter(this._bboxCenter);
        const distance = Math.max(camera.position.distanceTo(this._bboxCenter), 0.1);
        const fov = ((camera.fov || 60) * Math.PI) / 180;
        const sse = (nodeSize * screenHeight) / (distance * 2 * Math.tan(fov / 2));

        const wantsRefine = sse >= this.sseThreshold && !data.isLeaf;
        nodesAtLevel.push({ node, wantsRefine });
        if (wantsRefine) refineCount++;
      }

      // Collective refinement decision: if majority of visible nodes want to
      // refine, refine ALL non-leaf nodes at this level (uniform density).
      const shouldRefineLevel = visibleCount > 0 && refineCount > visibleCount * 0.3;
      const nextLevel = [];

      if (shouldRefineLevel) {
        for (const { node } of nodesAtLevel) {
          if (!node.data.isLeaf) {
            for (const childId of node.data.childIds) {
              if (childId >= 0) nextLevel.push(childId);
            }
          }
        }
      }

      // Check budget BETWEEN levels
      if (visiblePoints >= this.pointBudget || nextLevel.length === 0) break;

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
      this.group.add(node.threePoints);
    }
    node.threePoints.visible = true;
    node.visible = true;
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
  }
}
