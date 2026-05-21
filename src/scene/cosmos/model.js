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
import { PointCloudHelper, interpolateGradientColor } from '../../utils/models.js';

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

    // Models rendered as wireframe (per-model override, meshes only)
    this.wireframeModels = new Set();

    // Lazy-attached camera listeners that sync the headlight. Only active
    // while at least one model is loaded — see #ensureHeadlightListeners /
    // #detachHeadlightListeners.
    this.headlightListenersAttached = false;
    this.onCameraChangeForHeadlight = null;

    // Single group for all 3D model objects
    this.object3DGroup = new THREE.Group();
    this.object3DGroup.name = 'model objects';
    scene.addObjectToScene(this.object3DGroup);
  }

  /**
   * Attach orbit listeners that keep the headlight aligned with the active
   * camera. Called lazily the first time a model is added so cave-only
   * projects never pay the cost.
   */
  #ensureHeadlightListeners() {
    if (this.headlightListenersAttached) return;
    if (!this.scene.views || !this.scene.headLight) return;

    this.onCameraChangeForHeadlight = () => {
      const view = this.scene.view;
      if (!view) return;
      const cam = view.camera;
      const target = view.control?.target;
      this.scene.headLight.position.copy(cam.position);
      if (target) {
        this.scene.headLight.target.position.copy(target);
        this.scene.headLight.target.updateMatrixWorld();
      }
    };

    for (const view of this.scene.views.values()) {
      view.control.addEventListener('orbitChange', this.onCameraChangeForHeadlight);
      view.control.addEventListener('orbitSet', this.onCameraChangeForHeadlight);
    }
    this.headlightListenersAttached = true;

    // Initial sync so the first render after the first model loads has the
    // headlight pointing the right way without waiting for user interaction.
    this.onCameraChangeForHeadlight();
  }

  /**
   * Detach the headlight listeners when the scene no longer contains any models.
   */
  #detachHeadlightListeners() {
    if (!this.headlightListenersAttached || !this.onCameraChangeForHeadlight) return;
    for (const view of this.scene.views.values()) {
      view.control.removeEventListener('orbitChange', this.onCameraChangeForHeadlight);
      view.control.removeEventListener('orbitSet', this.onCameraChangeForHeadlight);
    }
    this.onCameraChangeForHeadlight = null;
    this.headlightListenersAttached = false;
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

    this.#ensureHeadlightListeners();
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
    const showCenterlines = this.scene.options?.scene?.centerLines?.segments?.show ?? true;
    entry.object3D.traverse((child) => {
      child.layers.set(2);
      child.frustumCulled = false;
      // Apply the current centerline visibility setting to .lox centerline children
      // so opening a .lox file while the toggle is off doesn't show the centerline.
      if (child.userData.isLoxCenterline) child.visible = showCenterlines;
    });

    if (this.meshObjects.has(mesh.name)) {
      throw new Error(i18n.t('errors.scene.meshAlreadyAdded', { name: mesh.name }));
    }
    this.meshObjects.set(mesh.name, entry);

    this.#ensureHeadlightListeners();
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
   * Set visibility of the .lox centerline children across all loaded mesh models.
   * Called when the "show centerlines" setting changes so .lox centerlines
   * stay in sync with the cave survey centerlines toggle.
   * @param {boolean} visible
   */
  setLoxCenterlineVisibility(visible) {
    for (const [, entry] of this.meshObjects) {
      entry.object3D.traverse((child) => {
        if (child.userData.isLoxCenterline) child.visible = visible;
      });
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
   * Toggle the drape-overlay mesh associated with an orthophoto. When the
   * photo is draped on a DTM the overlay is what's actually rendered;
   * the photo's own flat plane stays hidden. The plane's visibility tracks
   * the eye toggle separately for the un-draped case — kept in sync so an
   * un-drape later restores the right state.
   */
  setOrthophotoOverlayVisibility(orthoName, visible) {
    for (const [, dtmEntry] of this.meshObjects) {
      if (dtmEntry.userData?.drapedBy !== orthoName) continue;
      dtmEntry.object3D.traverse((child) => {
        if (child.userData?.isDrapeOverlay === orthoName) {
          child.visible = visible;
        }
      });
    }
    this.scene.view.renderView();
  }

  /**
   * Toggle wireframe rendering on a mesh model. No-op for point clouds
   * and textured meshes. Orthogonal to color mode — only touches material.wireframe.
   * @param {string} name - The model name
   * @param {boolean} enabled - True for wireframe, false for solid
   */
  setModelWireframe(name, enabled) {
    if (this.texturedModels.has(name)) return;
    const entry = this.meshObjects.get(name);
    if (!entry) return;

    entry.object3D.traverse((child) => {
      if (!child.isMesh || !child.material) return;
      if (Array.isArray(child.material)) {
        child.material.forEach((m) => { m.wireframe = enabled; m.needsUpdate = true; });
      } else {
        child.material.wireframe = enabled;
        child.material.needsUpdate = true;
      }
    });

    if (enabled) this.wireframeModels.add(name);
    else this.wireframeModels.delete(name);

    this.scene.view.renderView();
  }

  /**
   * Photogrammetry textures (Metashape/RealityCapture) already have lighting
   * baked in from the source photos. Rendering them through MeshPhongMaterial
   * with only directional lights double-shades the already-shaded texture —
   * faces whose normals point away from every directional light drop to the
   * hemisphere-ground floor (~10% brightness), far darker than the same model
   * in CloudCompare / Metashape / Blender's texture view.
   *
   * The fix: route a fraction of the diffuse texture through the emissive
   * channel so it bypasses lighting entirely. Phong still contributes specular
   * and the remaining diffuse fraction, so highlights/shadows still read as
   * 3D depth cues — they just sit on top of a brighter floor.
   *
   * Only materials that actually have a diffuse map are touched; non-textured
   * meshes (including the OBJ importer's default MeshPhongMaterial) are left
   * alone so their hand-tuned shading is preserved. MTL-authored emissive
   * (Ke / map_Ke) is respected and not overwritten.
   *
   * @param {THREE.Material} material - A single material (not an array)
   */
  boostTexturedMaterial(material) {
    if (!material || !material.map) return;
    if (!material.emissive) return; // not a Phong/Standard/Lambert material
    if (material.emissiveMap) return;
    if (material.emissive.r > 0 || material.emissive.g > 0 || material.emissive.b > 0) return;
    material.emissive = new THREE.Color(0xffffff);
    material.emissiveMap = material.map;
    material.emissiveIntensity = 0.6;
    material.needsUpdate = true;
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

  unmarkAsTextured(name) {
    this.texturedModels.delete(name);
  }

  /**
   * Drape an orthophoto onto a DTM mesh. Computes per-vertex UVs on the DTM
   * geometry from each vertex's world (X, Y) position vs the orthophoto's
   * world bbox. The DTM's original material is **kept** — we add a sibling
   * mesh (sharing the same geometry) with a photo material that discards
   * fragments outside the photo's UV range. Net effect: the DTM keeps its
   * gradient / per-model color everywhere; the photo appears on top only
   * where its bbox actually covers the terrain.
   *
   * This is more correct than the naïve "swap material" approach, which
   * stretches a tiny photo across a huge DTM tile via UV clamping and ends
   * up averaging to the photo's edge color across the whole surface.
   *
   * @param {string} orthoName    Name of an orthophoto model already added via addMesh
   * @param {string} dtmName      Name of a DTM model already added via addMesh
   */
  drapeOrthophoto(orthoName, dtmName) {
    const orthoEntry = this.meshObjects.get(orthoName);
    const dtmEntry   = this.meshObjects.get(dtmName);
    if (!orthoEntry || !dtmEntry) {
      console.warn(`drapeOrthophoto: missing entry — ortho=${orthoName} dtm=${dtmName}`);
      return false;
    }

    const meta = orthoEntry.object3D.userData?.orthoMetadata
              ?? orthoEntry.userData?.orthoMetadata;
    const orthoMeta = meta || this.#orthoMetadataFor(orthoName);
    if (!orthoMeta?.texture) {
      console.warn(`drapeOrthophoto: orthophoto ${orthoName} has no texture metadata`);
      return false;
    }

    const orthoOrigin = {
      x: orthoEntry.object3D.position.x,
      y: orthoEntry.object3D.position.y
    };
    const orthoSize = {
      width : orthoMeta.widthMeters,
      height: orthoMeta.heightMeters
    };

    // For every DTM child mesh with a position attribute, compute UVs and
    // add a sibling overlay mesh that carries the photo material.
    //
    // Each overlay gets a SHELL BufferGeometry: it shares the DTM's
    // position/normal/index BufferAttributes (no duplication of the heavy
    // arrays) but owns its own `uv` attribute. That way multiple
    // orthophotos can be draped onto the same DTM at once — each overlay
    // samples its texture with its own per-photo UV mapping, and removing
    // one overlay doesn't disturb the others.
    dtmEntry.object3D.traverse((child) => {
      if (!child.isMesh || !child.geometry?.attributes?.position) return;
      if (child.userData.isDrapeOverlay) return; // skip overlays from previous drapes
      const dtmWorldOffset = {
        x: dtmEntry.object3D.position.x,
        y: dtmEntry.object3D.position.y
      };
      const positions = child.geometry.attributes.position;
      const uvs = ModelScene.computeDrapeUVs(positions, dtmWorldOffset, orthoOrigin, orthoSize);

      const overlayGeom = new THREE.BufferGeometry();
      overlayGeom.setAttribute('position', child.geometry.attributes.position);
      if (child.geometry.attributes.normal) {
        overlayGeom.setAttribute('normal', child.geometry.attributes.normal);
      }
      if (child.geometry.index) overlayGeom.setIndex(child.geometry.index);
      overlayGeom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      // Reuse the DTM's bounding volumes — they're identical since
      // positions are shared.
      overlayGeom.boundingBox    = child.geometry.boundingBox;
      overlayGeom.boundingSphere = child.geometry.boundingSphere;

      const photoMat = ModelScene.#createPhotoOverlayMaterial(orthoMeta.texture, !!orthoMeta.hasAlpha);

      const overlay = new THREE.Mesh(overlayGeom, photoMat);
      overlay.userData.isDrapeOverlay = orthoName;
      overlay.layers.mask = child.layers.mask;
      overlay.frustumCulled = false;
      overlay.renderOrder = (child.renderOrder || 0) + 1;
      photoMat.polygonOffset = true;
      photoMat.polygonOffsetFactor = -1;
      photoMat.polygonOffsetUnits = -1;

      child.add(overlay);
    });

    // Hide the orthophoto's own flat-plane geometry; the overlay carries it now.
    orthoEntry.object3D.visible = false;

    if (!dtmEntry.userData) dtmEntry.userData = {};
    if (!orthoEntry.userData) orthoEntry.userData = {};
    dtmEntry.userData.drapedBy   = orthoName;
    orthoEntry.userData.drapedOnto = dtmName;

    this.scene.view.renderView();
    return true;
  }

  /**
   * Build a MeshBasicMaterial that samples the texture but discards fragments
   * where the UV is outside [0,1] — so a small orthophoto on a huge DTM tile
   * only paints its actual footprint, instead of clamping to the edge color
   * across the rest of the surface.
   */
  static #createPhotoOverlayMaterial(texture, hasAlpha) {
    const mat = new THREE.MeshBasicMaterial({
      map         : texture,
      side        : THREE.DoubleSide,
      transparent : true,
      depthWrite  : false
    });
    // Inject a UV-range discard into the standard fragment shader.
    mat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        `
        #ifdef USE_MAP
          vec2 drapeUv = vMapUv;
          if (drapeUv.x < 0.0 || drapeUv.x > 1.0 || drapeUv.y < 0.0 || drapeUv.y > 1.0) discard;
          vec4 sampledDiffuseColor = texture2D( map, drapeUv );
          diffuseColor *= sampledDiffuseColor;
        #endif
        `
      );
    };
    // Three.js caches compiled shaders by a key that ignores onBeforeCompile by
    // default — set a custom key so each overlay gets its own compiled shader.
    mat.customProgramCacheKey = () => `dtm-photo-overlay-${hasAlpha ? 'rgba' : 'rgb'}`;
    return mat;
  }

  /**
   * Reverse a drape: remove the photo-overlay sibling meshes and re-show
   * the orthophoto's own flat plane.
   */
  undrape(dtmName) {
    const dtmEntry = this.meshObjects.get(dtmName);
    if (!dtmEntry) return false;
    const orthoName = dtmEntry.userData?.drapedBy;

    // Collect overlays first (don't remove during traversal).
    const overlays = [];
    dtmEntry.object3D.traverse((child) => {
      if (child.userData?.isDrapeOverlay) overlays.push(child);
    });
    for (const overlay of overlays) {
      overlay.parent?.remove(overlay);
      overlay.material?.dispose();
      // The overlay's geometry is a SHELL — it shares position/index with
      // the DTM, so we must NOT dispose its attribute buffers. Only the
      // owned uv attribute can be safely dropped. BufferGeometry.dispose()
      // would free shared buffers too aggressively here, so we skip it.
    }

    if (dtmEntry.userData) delete dtmEntry.userData.drapedBy;
    // Also clear the data wrapper so a saved-settings save doesn't persist
    // a stale drape relationship after the orthophoto is deleted.
    const dtmModel = this.scene.db.getMesh(dtmName);
    if (dtmModel) delete dtmModel.drapedBy;

    if (orthoName) {
      const orthoEntry = this.meshObjects.get(orthoName);
      if (orthoEntry) {
        orthoEntry.object3D.visible = true;
        if (orthoEntry.userData) delete orthoEntry.userData.drapedOnto;
        // Lift the photo plane above the DTM's terrain so it doesn't get
        // buried — at sea level the photo at z=0 would be clipped by every
        // DTM vertex with elevation > 0. We use the max world-Z of the DTM
        // mesh in the photo's world XY bbox + 10 m clearance.
        const liftZ = this.#computePhotoLiftZ(orthoEntry, dtmEntry);
        if (Number.isFinite(liftZ)) {
          orthoEntry.object3D.position.z = liftZ;
        }
      }
      const orthoModel = this.scene.db.getMesh(orthoName);
      if (orthoModel) delete orthoModel.drapedOnto;
    }

    this.scene.view.renderView();
    return true;
  }

  /**
   * Find the maximum Z within the photo's world XY footprint among the
   * DTM's vertices, plus a small clearance. Used to lift an undraped
   * orthophoto plane above the terrain so it doesn't get clipped.
   * Returns NaN when no DTM vertex falls inside the photo's footprint
   * (the photo is outside the DTM's coverage area).
   */
  #computePhotoLiftZ(orthoEntry, dtmEntry) {
    const meta = this.orthoMetadataByName?.get(
      [...this.meshObjects.entries()].find(([, e]) => e === orthoEntry)?.[0]
    );
    if (!meta) return NaN;
    const orthoMinX = orthoEntry.object3D.position.x;
    const orthoMinY = orthoEntry.object3D.position.y;
    const orthoMaxX = orthoMinX + meta.widthMeters;
    const orthoMaxY = orthoMinY + meta.heightMeters;
    const dtmOffsetX = dtmEntry.object3D.position.x;
    const dtmOffsetY = dtmEntry.object3D.position.y;
    let maxZ = -Infinity;
    dtmEntry.object3D.traverse((child) => {
      const pos = child.geometry?.attributes?.position;
      if (!pos) return;
      for (let i = 0; i < pos.count; i++) {
        const wx = pos.getX(i) + dtmOffsetX;
        const wy = pos.getY(i) + dtmOffsetY;
        if (wx < orthoMinX || wx > orthoMaxX || wy < orthoMinY || wy > orthoMaxY) continue;
        const z = pos.getZ(i);
        if (z > maxZ) maxZ = z;
      }
    });
    if (!Number.isFinite(maxZ)) return NaN;
    return maxZ + 10;
  }

  /**
   * Pure UV computation — given a DTM geometry's local positions, the world
   * offset that places the DTM, the orthophoto's world origin (lower-left)
   * and width/height in metres, return a Float32Array of (u, v) per vertex.
   *
   * UVs are **not clamped** — vertices outside the photo's footprint get
   * UV values outside [0, 1] (e.g. negative or > 1). The photo overlay's
   * fragment shader uses that to discard fragments outside the photo's
   * actual coverage. Pre-clamping at vertex level would silently squash
   * out-of-range UVs to the edge so the shader saw in-range values and
   * sampled the photo's edge color across the whole DTM tile (the "grey
   * surface" bug).
   *
   * @param {THREE.BufferAttribute|{count:number, getX:Function, getY:Function}} positions
   * @param {{x:number, y:number}} dtmWorldOffset
   * @param {{x:number, y:number}} orthoWorldOrigin    lower-left of the photo in world coords
   * @param {{width:number, height:number}} orthoSize in metres
   * @returns {Float32Array}
   */
  static computeDrapeUVs(positions, dtmWorldOffset, orthoWorldOrigin, orthoSize) {
    const count = positions.count;
    const uvs = new Float32Array(count * 2);
    const invW = 1 / orthoSize.width;
    const invH = 1 / orthoSize.height;
    for (let i = 0; i < count; i++) {
      const worldX = positions.getX(i) + dtmWorldOffset.x;
      const worldY = positions.getY(i) + dtmWorldOffset.y;
      uvs[i * 2]     = (worldX - orthoWorldOrigin.x) * invW;
      uvs[i * 2 + 1] = (worldY - orthoWorldOrigin.y) * invH;
    }
    return uvs;
  }

  /**
   * Look up the orthoMetadata for a given orthophoto model. Set by
   * `addOrthophoto` below — separate from the Mesh3D wrapper so the
   * model lifecycle (delete/re-create) doesn't strand it.
   */
  #orthoMetadataFor(name) {
    return this.orthoMetadataByName?.get(name);
  }

  /**
   * Called by main.js right after addMesh for an orthophoto model — caches
   * the texture + bbox info so drape can find them by name.
   */
  registerOrthoMetadata(name, metadata) {
    if (!this.orthoMetadataByName) this.orthoMetadataByName = new Map();
    this.orthoMetadataByName.set(name, metadata);
  }

  unregisterOrthoMetadata(name) {
    this.orthoMetadataByName?.delete(name);
  }

  /**
   * Apply the current color mode to all models.
   * @param {string} mode - 'gradientByZ' | 'perModel' | 'ownColor'
   * @param {Object} [trigger] - Optional trigger object with reason/model/color fields
   */
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
      const fallback = colorConfig.defaultColor;
      for (const [name] of this.#allModelEntries()) {
        if (this.texturedModels.has(name)) continue;
        const color = this.modelColors.get(name);
        this.#applyPerModelColor(name, color ?? fallback);
      }
    } else if (mode === 'ownColor') {
      this.#applyOwnColor(colorConfig.defaultColor);
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
    // Compute combined WORLD Z range across all non-textured models (point clouds + meshes).
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

    for (const [name, entry] of this.meshObjects) {
      if (this.texturedModels.has(name)) continue;
      const offsetZ = entry.object3D.position.z;
      entry.object3D.traverse((child) => {
        if (!child.isMesh || !child.geometry) return;
        const pos = child.geometry.getAttribute('position');
        if (!pos) return;
        for (let i = 0; i < pos.count; i++) {
          const wz = pos.getZ(i) + offsetZ;
          if (wz < globalMinZ) globalMinZ = wz;
          if (wz > globalMaxZ) globalMaxZ = wz;
        }
      });
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

    for (const [name, entry] of this.meshObjects) {
      if (this.texturedModels.has(name)) continue;
      const offsetZ = entry.object3D.position.z;
      entry.object3D.traverse((child) => {
        if (!child.isMesh || !child.geometry) return;
        const colors = this.#computeMeshGradientColors(
          child.geometry, gradientColors,
          hasRange ? globalMinZ : undefined,
          hasRange ? globalMaxZ : undefined,
          offsetZ
        );
        if (colors) {
          child.geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
          child.geometry.attributes.color.needsUpdate = true;
          child.material.vertexColors = true;
          child.material.needsUpdate = true;
        }
      });
    }
  }

  #computeMeshGradientColors(geometry, gradientColors, minZ, maxZ, offsetZ = 0) {
    const pos = geometry.getAttribute('position');
    if (!pos) return null;
    const sortedColors = [...gradientColors].sort((a, b) => a.depth - b.depth);
    let computedMinZ = minZ;
    let computedMaxZ = maxZ;
    if (computedMinZ === undefined || computedMaxZ === undefined) {
      computedMinZ = Infinity;
      computedMaxZ = -Infinity;
      for (let i = 0; i < pos.count; i++) {
        const wz = pos.getZ(i) + offsetZ;
        if (wz < computedMinZ) computedMinZ = wz;
        if (wz > computedMaxZ) computedMaxZ = wz;
      }
    }
    const diffZ = computedMaxZ - computedMinZ;
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const worldZ = pos.getZ(i) + offsetZ;
      const depth = diffZ === 0 ? 0 : ((computedMaxZ - worldZ) / diffZ) * 100;
      const c = interpolateGradientColor(depth, sortedColors, 'depth');
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    return colors;
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
          child.material.vertexColors = false;
          child.material.color = threeColor;
          child.material.needsUpdate = true;
        }
      });
    }
  }

  #applyOwnColor(defaultColor) {
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
    // Meshes have no native vertex colors — apply the configurable default color
    // (and clear any vertex colors left from gradient mode).
    const threeColor = new THREE.Color(defaultColor);
    for (const [name, entry] of this.meshObjects) {
      if (this.texturedModels.has(name)) continue;
      entry.object3D.traverse((child) => {
        if (!child.isMesh || !child.material) return;
        child.material.vertexColors = false;
        child.material.color = threeColor;
        child.material.needsUpdate = true;
      });
    }
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

    // If this is an orthophoto draped onto a DTM, undrape first so the DTM's
    // original material is restored and the overlay mesh is removed from the
    // scene. Without this the photo's texture would keep painting the DTM
    // even after the photo model is deleted.
    if (entry.userData?.drapedOnto) {
      this.undrape(entry.userData.drapedOnto);
    }
    // If this is a DTM that's currently being draped, undrape so the overlay
    // is removed and the orthophoto's flat plane is restored.
    if (entry.userData?.drapedBy) {
      this.undrape(name);
    }

    // Drop any cached orthophoto metadata (texture stays alive via Three's
    // texture-cache until JS finalization; that's fine).
    this.unregisterOrthoMetadata?.(name);

    this.#disposeObject3D(entry.object3D);
    this.object3DGroup.remove(entry.object3D);
    this.pointCloudObjects.delete(name);
    this.meshObjects.delete(name);
    this.wireframeModels.delete(name);

    if (this.pointCloudObjects.size === 0 && this.meshObjects.size === 0) {
      this.#detachHeadlightListeners();
    }

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
    this.wireframeModels.clear();

    this.#detachHeadlightListeners();

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
