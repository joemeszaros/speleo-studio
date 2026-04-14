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
    // Only apply gradient colors if the point cloud doesn't have its own vertex colors
    if (colorGradients && pointsObject.geometry) {
      pointsObject.geometry.setAttribute('color', new THREE.Float32BufferAttribute(colorGradients, 3));
    }

    pointsObject.name = `pointcloud-${pointsObject.name || 'model'}`;
    this.scene.view.renderView();

    return {
      id       : U.randomAlphaNumbericString(5),
      object3D : pointsObject
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
      child.layers.set(1);
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

    // Set layer 1 for the object to match other scene objects
    object3D.layers.set(1);

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
  updatePointBudget(budget) {
    for (const octree of this.pointCloudOctrees) {
      octree.pointBudget = budget;
    }
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
   * Only updates point clouds that don't have native vertex colors.
   * @param {Object} colorConfig - The color configuration with start and end colors
   */
  updatePointCloudColors(colorConfig) {
    for (const [name, entry] of this.pointCloudObjects) {
      const pointCloud = this.scene.db.getPointCloud(name);
      // Only update colors for point clouds without native vertex colors
      if (pointCloud && !pointCloud.hasVertexColors) {
        if (pointCloud.hasOctree && pointCloud.octree) {
          // LAS/LAZ octree: update gradient colors on all nodes
          pointCloud.octree.updateGradientColors(colorConfig.start, colorConfig.end, false);
        } else {
          // PLY point cloud: update via PointCloudHelper
          const colorGradients = PointCloudHelper.getColorGradients(pointCloud.points, colorConfig);
          if (colorGradients && entry.object3D.geometry) {
            entry.object3D.geometry.setAttribute('color', new THREE.Float32BufferAttribute(colorGradients, 3));
          }
        }
      }
    }
    this.scene.view.renderView();
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
