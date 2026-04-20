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
import { degreesToRads } from '../../utils/utils.js';
import * as U from '../../utils/utils.js';
import { i18n } from '../../i18n/i18n.js';
import { PointCloudHelper } from '../../utils/models.js';

export class ModelScene {

  constructor(scene) {
    this.scene = scene;

    // Separate tracking for point clouds and meshes
    this.pointCloudObjects = new Map();
    this.meshObjects = new Map();

    // Octree instances for LAS/LAZ point clouds (used for per-frame LOD updates)
    this.pointCloudOctrees = [];

    // Per-model color overrides (used in perModel mode)
    this.modelColors = new Map();

    // Models with loaded textures (skip color mode for these)
    this.texturedModels = new Set();

    // Single group for all 3D model objects
    this.object3DGroup = new THREE.Group();
    this.object3DGroup.name = 'model objects';
    scene.addObjectToScene(this.object3DGroup);
  }

  /**
   * Prepares a point cloud object for rendering with color gradients.
   * @param {THREE.Points} pointsObject - The Three.js Points object
   * @param {Array|null} colorGradients - Color gradient array, or null if point cloud has vertex colors
   * @returns {Object} Entry object with id and object3D
   */
  getPointCloudObject(pointsObject, colorGradients) {
    if (colorGradients && pointsObject.geometry) {
      pointsObject.geometry.setAttribute('color', new THREE.Float32BufferAttribute(colorGradients, 3));
    }

    // Snapshot native vertex colors for non-octree vertex-colored point clouds (e.g. small PLY)
    // so they can be restored when switching back to ownColor mode.
    const colorAttr = pointsObject.geometry?.getAttribute('color');
    const nativeColors = (!colorGradients && colorAttr) ? new Float32Array(colorAttr.array) : null;

    pointsObject.name = `pointcloud-${pointsObject.name || 'model'}`;
    this.scene.view.renderView();

    return {
      id          : U.randomAlphaNumbericString(5),
      object3D    : pointsObject,
      nativeColors: nativeColors
    };
  }

  /**
   * Adds a point cloud to the scene.
   * @param {PointCloud} pointCloud - The point cloud data object
   * @param {Object} entry - Entry object with id and object3D
   */
  addPointCloud(pointCloud, entry) {
    this.#addObject3D(entry.object3D);

    if (this.pointCloudObjects.has(pointCloud.name)) {
      throw new Error(i18n.t('errors.scene.pointCloudAlreadyAdded', { name: pointCloud.name }));
    }
    this.pointCloudObjects.set(pointCloud.name, entry);

    // Track octree for per-frame LOD updates.
    // Run updateVisibility once immediately so nodes are visible for
    // bounding box computation and camera fitting.
    if (pointCloud.hasOctree && pointCloud.octree) {
      this.pointCloudOctrees.push(pointCloud.octree);
      pointCloud.octree.updateVisibility(this.scene.view.camera, this.scene.sceneRenderer);
    }

    this.scene.view.renderView();
  }

  /**
   * Prepares a mesh object for rendering.
   * @param {THREE.Mesh|THREE.Group} meshObject - The Three.js Mesh or Group object
   * @returns {Object} Entry object with id and object3D
   */
  getMeshObject(meshObject) {
    meshObject.name = `mesh-${meshObject.name || 'model'}`;
    this.scene.view.renderView();

    return {
      id       : U.randomAlphaNumbericString(5),
      object3D : meshObject
    };
  }

  /**
   * Adds a mesh to the scene.
   * @param {Mesh3D} mesh - The mesh data object
   * @param {Object} entry - Entry object with id and object3D
   */
  addMesh(mesh, entry) {
    this.#addObject3D(entry.object3D);

    // For meshes (especially OBJ groups), set layers on all children
    entry.object3D.traverse((child) => {
      child.layers.set(2);
      child.frustumCulled = false;
    });

    if (this.meshObjects.has(mesh.name)) {
      throw new Error(i18n.t('errors.scene.meshAlreadyAdded', { name: mesh.name }));
    }
    this.meshObjects.set(mesh.name, entry);

    this.scene.view.renderView();
  }

  /**
   * Internal method to add a 3D object to the scene with common settings.
   * @param {THREE.Object3D} object3D - The object to add
   */
  #addObject3D(object3D) {
    this.object3DGroup.add(object3D);

    // Layer 2 is the dedicated "3D models" layer — both main and overview cameras render it.
    object3D.layers.set(2);

    // Disable frustum culling - required for large models that may have
    // an incorrect bounding sphere calculated by Three.js
    object3D.frustumCulled = false;
  }

  /**
   * Gets all model objects (point clouds and meshes).
   * @returns {Map} Combined map of all model entries
   */
  getAllModelObjects() {
    return new Map([...this.pointCloudObjects, ...this.meshObjects]);
  }

  get3DModelsGroup() {
    return this.object3DGroup;
  }

  /**
   * Updates the point budget for all point cloud octrees.
   * @param {number} budget - The new point budget
   */
  updatePointBudget(_budget) {
    this.scene.updatePointCloudLOD();
    this.scene.view.renderView();
  }

  /**
   * Set visibility of a model.
   * @param {THREE.Object3D} object3D - The model's Three.js object
   * @param {boolean} visible - Whether the model should be visible
   */
  setModelVisibility(object3D, visible) {
    object3D.visible = visible;

    const boundingBox = this.scene.computeBoundingBox();
    if (boundingBox) {
      this.scene.grid.adjust(boundingBox);
    }
    this.scene.view.renderView();
  }

  /**
   * Set opacity of a model.
   * @param {THREE.Object3D} object3D - The model's Three.js object
   * @param {number} opacity - Opacity value (0-1)
   */
  setModelOpacity(object3D, opacity) {
    object3D.traverse((child) => {
      if (child.material) {
        child.material.transparent = opacity < 1;
        child.material.opacity = opacity;
        child.material.needsUpdate = true;
      }
    });
    this.scene.view.renderView();
  }

  /**
   * Apply a transform change to a model.
   * @param {THREE.Object3D} object3D - The model's Three.js object
   * @param {string} property - 'position', 'rotation', or 'scale'
   * @param {string} axis - 'x', 'y', or 'z'
   * @param {number} value - The new value (rotation in degrees)
   */
  setModelTransform(object3D, property, axis, value) {
    if (property === 'position') {
      object3D.position[axis] = value;
    } else if (property === 'rotation') {
      object3D.rotation[axis] = degreesToRads(value);
    } else if (property === 'scale') {
      object3D.scale[axis] = value;
    }
    const boundingBox = this.scene.computeBoundingBox();
    if (boundingBox) {
      this.scene.grid.adjust(boundingBox);
    }
    this.scene.view.renderView();
  }

  /**
   * Updates the point size of all point cloud materials.
   * @param {number} size - The new point size
   */
  updatePointCloudPointSize(size) {
    for (const [, entry] of this.pointCloudObjects) {
      if (entry.object3D.material) {
        entry.object3D.material.size = size;
        entry.object3D.material.needsUpdate = true;
      }
    }
    for (const octree of this.pointCloudOctrees) {
      octree.updatePointSize(size);
    }
    this.scene.view.renderView();
  }

  /**
   * Updates the colors of all point clouds based on the color configuration.
   * @deprecated Use updateModelColorMode instead.
   */
  async updatePointCloudColors(_colorConfig) {
    await this.updateModelColorMode(this.scene.options.scene.models.color.mode);
  }

  /**
   * Mark a model as having loaded textures so color mode is skipped for it.
   * @param {string} name - Model name
   */
  markAsTextured(name) {
    this.texturedModels.add(name);
  }

  /**
   * Apply the current color mode to all models.
   * @param {string} mode - 'gradientByZ' | 'perModel' | 'ownColor'
   * @param {Object} [trigger] - Optional trigger object with reason/model/color fields
   */
  static PER_MODEL_FALLBACK_COLOR = '#90ee90';

  async updateModelColorMode(mode, trigger) {
    const colorConfig = this.scene.options.scene.models.color;

    // Handle per-model color triggers (store/clear) regardless of mode
    if (trigger?.reason === 'modelColor') {
      this.modelColors.set(trigger.model, trigger.color);
    } else if (trigger?.reason === 'modelColorCleared') {
      this.modelColors.delete(trigger.model);
    }

    const overlay = this.scene.loadingOverlay;

    if (mode === 'gradientByZ') {
      const applyFn = () => {
        this.#applyGradientByZ(colorConfig.gradientColors);
        for (const [name] of this.#allModelEntries()) {
          if (this.texturedModels.has(name)) continue;
          const color = this.modelColors.get(name);
          if (color) this.#applyPerModelColor(name, color);
        }
      };
      if (overlay && !overlay.isActive()) {
        await overlay.guard(i18n.t('ui.loading.calculatingModelColors'), () =>
          new Promise((resolve) => setTimeout(() => { applyFn(); resolve(); }, 0))
        );
      } else {
        applyFn();
      }
    } else if (mode === 'perModel') {
      for (const [name] of this.#allModelEntries()) {
        if (this.texturedModels.has(name)) continue;
        const color = this.modelColors.get(name);
        this.#applyPerModelColor(name, color ?? ModelScene.PER_MODEL_FALLBACK_COLOR);
      }
    } else if (mode === 'ownColor') {
      this.#applyOwnColor();
      // Still apply per-model override if set
      for (const [name] of this.#allModelEntries()) {
        if (this.texturedModels.has(name)) continue;
        const color = this.modelColors.get(name);
        if (color) this.#applyPerModelColor(name, color);
      }
    }

    this.scene.view.renderView();
  }

  #allModelEntries() {
    return [...this.pointCloudObjects, ...this.meshObjects];
  }

  #applyGradientByZ(gradientColors) {
    // Compute combined WORLD Z range across all non-textured point clouds.
    // Octree positions are local (auto-centered); add group.position.z to get world Z.
    let globalMinZ = Infinity;
    let globalMaxZ = -Infinity;

    for (const [name, entry] of this.pointCloudObjects) {
      if (this.texturedModels.has(name)) continue;
      const pc = this.scene.db.getPointCloud(name);
      if (!pc) continue;
      const offsetZ = entry.object3D.position.z;
      if (pc.hasOctree && pc.octree) {
        for (const node of pc.octree.nodes.values()) {
          const pos = node.data.positions;
          for (let i = 2; i < pos.length; i += 3) {
            const wz = pos[i] + offsetZ;
            if (wz < globalMinZ) globalMinZ = wz;
            if (wz > globalMaxZ) globalMaxZ = wz;
          }
        }
      } else if (pc.points) {
        for (const p of pc.points) {
          const wz = p.z + offsetZ;
          if (wz < globalMinZ) globalMinZ = wz;
          if (wz > globalMaxZ) globalMaxZ = wz;
        }
      }
    }

    const hasRange = isFinite(globalMinZ) && isFinite(globalMaxZ);

    for (const [name, entry] of this.pointCloudObjects) {
      if (this.texturedModels.has(name)) continue;
      const pc = this.scene.db.getPointCloud(name);
      if (!pc) continue;
      const offsetZ = entry.object3D.position.z;
      if (pc.hasOctree && pc.octree) {
        pc.octree.updateGradientColorsMultiStop(
          gradientColors,
          hasRange ? globalMinZ : undefined,
          hasRange ? globalMaxZ : undefined,
          offsetZ
        );
      } else if (pc.points) {
        const colorGradients = PointCloudHelper.getColorGradientsMultiColor(
          pc.points,
          gradientColors,
          hasRange ? globalMinZ : undefined,
          hasRange ? globalMaxZ : undefined,
          offsetZ
        );
        if (colorGradients && entry.object3D.geometry) {
          entry.object3D.geometry.setAttribute('color', new THREE.Float32BufferAttribute(colorGradients, 3));
          entry.object3D.geometry.attributes.color.needsUpdate = true;
        }
      }
    }
  }

  #applyGradientByZToModel(name, gradientColors) {
    const entry = this.pointCloudObjects.get(name);
    if (!entry) return;
    const pc = this.scene.db.getPointCloud(name);
    if (!pc) return;
    if (pc.hasOctree && pc.octree) {
      pc.octree.updateGradientColorsMultiStop(gradientColors);
    } else if (pc.points) {
      const colorGradients = PointCloudHelper.getColorGradientsMultiColor(pc.points, gradientColors);
      if (colorGradients && entry.object3D.geometry) {
        entry.object3D.geometry.setAttribute('color', new THREE.Float32BufferAttribute(colorGradients, 3));
        entry.object3D.geometry.attributes.color.needsUpdate = true;
      }
    }
  }

  #applyPerModelColor(name, hexColor) {
    const pcEntry = this.pointCloudObjects.get(name);
    if (pcEntry) {
      const pc = this.scene.db.getPointCloud(name);
      if (pc?.hasOctree && pc.octree) {
        pc.octree.updateFlatColor(hexColor);
      } else if (pcEntry.object3D.geometry) {
        const threeColor = new THREE.Color(hexColor);
        const pos = pcEntry.object3D.geometry.getAttribute('position');
        if (pos) {
          const count = pos.count;
          const colors = new Float32Array(count * 3);
          for (let i = 0; i < count; i++) {
            colors[i * 3] = threeColor.r;
            colors[i * 3 + 1] = threeColor.g;
            colors[i * 3 + 2] = threeColor.b;
          }
          pcEntry.object3D.geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
          pcEntry.object3D.geometry.attributes.color.needsUpdate = true;
        }
      }
      return;
    }

    const meshEntry = this.meshObjects.get(name);
    if (meshEntry) {
      const threeColor = new THREE.Color(hexColor);
      meshEntry.object3D.traverse((child) => {
        if (child.isMesh && child.material) {
          child.material.color = threeColor;
          child.material.needsUpdate = true;
        }
      });
    }
  }

  #applyOwnColor() {
    for (const [name, entry] of this.pointCloudObjects) {
      if (this.texturedModels.has(name)) continue;
      const pc = this.scene.db.getPointCloud(name);
      if (!pc) continue;
      if (pc.hasOctree && pc.octree) {
        pc.octree.restoreOriginalColors();
      } else if (entry.nativeColors && entry.object3D.geometry) {
        // Restore snapshot taken at load time for non-octree vertex-colored point clouds
        entry.object3D.geometry.setAttribute('color', new THREE.Float32BufferAttribute(entry.nativeColors, 3));
        entry.object3D.geometry.attributes.color.needsUpdate = true;
      }
    }
    // Meshes keep their native materials; no action needed
  }

  /**
   * Remove a single model from the scene by name.
   * @param {string} name - The model name
   */
  removeModel(name) {
    let entry = this.pointCloudObjects.get(name) || this.meshObjects.get(name);
    if (!entry) return;

    // Clean up octree if this is a LAS point cloud
    const pointCloud = this.scene.db.getPointCloud(name);
    if (pointCloud?.hasOctree && pointCloud.octree) {
      pointCloud.octree.dispose();
      this.pointCloudOctrees = this.pointCloudOctrees.filter(o => o !== pointCloud.octree);
    }

    this.#disposeObject3D(entry.object3D);
    this.object3DGroup.remove(entry.object3D);
    this.pointCloudObjects.delete(name);
    this.meshObjects.delete(name);
    this.scene.view.renderView();
  }

  /**
   * Clear all models from the scene.
   * Removes all point clouds and meshes, disposing their geometries and materials.
   */
  clearModels() {
    // Dispose octrees
    for (const octree of this.pointCloudOctrees) {
      octree.dispose();
    }
    this.pointCloudOctrees = [];

    // Dispose and remove all point clouds
    for (const [, entry] of this.pointCloudObjects) {
      this.#disposeObject3D(entry.object3D);
    }
    this.pointCloudObjects.clear();

    // Dispose and remove all meshes
    for (const [, entry] of this.meshObjects) {
      this.#disposeObject3D(entry.object3D);
    }
    this.meshObjects.clear();

    // Clear all children from the group
    while (this.object3DGroup.children.length > 0) {
      this.object3DGroup.remove(this.object3DGroup.children[0]);
    }

    this.scene.view.renderView();
  }

  /**
   * Dispose a 3D object and its resources.
   * @param {THREE.Object3D} object3D - The object to dispose
   */
  #disposeObject3D(object3D) {
    object3D.traverse((child) => {
      if (child.geometry) {
        child.geometry.dispose();
      }
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => {
            if (m.map) m.map.dispose();
            m.dispose();
          });
        } else {
          if (child.material.map) child.material.map.dispose();
          child.material.dispose();
        }
      }
    });
  }

}
