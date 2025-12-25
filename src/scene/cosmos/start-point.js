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

export class StartPointScene {

  constructor(options, materials, scene) {
    this.options = options;
    this.mats = materials.materials;
    this.scene = scene;
    this.startPoints3DGroup = new THREE.Group();
    this.startPoints3DGroup.name = 'starting points';
    this.startPointObjects = new Map(); // Map to store starting point objects for each cave
    this.scene.addObjectToScene(this.startPoints3DGroup);

  }
  toggleStartingPointsVisibility(visible) {
    this.startPoints3DGroup.children.forEach((child) => {
      child.visible = visible;
    });
  }

  addOrUpdateStartingPoint(cave) {
    // Remove existing starting point if it exists
    if (this.startPointObjects.has(cave.name)) {
      this.removeStartingPoint(cave.name);
    }
    // Get the first station of the first survey
    const firstStation = cave.getFirstStation();
    if (!firstStation) return;

    // Use configured radius instead of pixel-based calculation
    const _8_px = this.scene.view.control.getWorldUnitsForPixels(8);
    const radius = this.options.scene.startPoints.radius || 1;

    // Create a new sphere geometry for the starting point
    const startPointGeo = new THREE.SphereGeometry(radius * _8_px, 8, 8);

    // Create the starting point mesh
    const startPoint = new THREE.Mesh(startPointGeo, this.mats.sphere.startPoint);
    startPoint.position.copy(firstStation.position);
    startPoint.name = `startPoint_${cave.name}`;

    // Set visibility based on configuration and cave visibility
    startPoint.visible = this.options.scene.startPoints.show && cave.visible !== false;
    startPoint.layers.set(1);

    // Add to the starting points group
    this.startPoints3DGroup.add(startPoint);

    // Store reference for later management
    this.startPointObjects.set(cave.name, {
      mesh     : startPoint,
      geometry : startPointGeo,
      material : this.mats.sphere.startPoint
    });

    return startPoint;
  }

  removeStartingPoint(caveName) {
    const startPointObj = this.startPointObjects.get(caveName);
    if (startPointObj) {
      this.startPoints3DGroup.remove(startPointObj.mesh);
      startPointObj.geometry.dispose();
      startPointObj.material.dispose();
      this.startPointObjects.delete(caveName);
    }
  }

  renameCave(oldName, newName) {
    if (this.startPointObjects.has(oldName)) {
      const startPointObj = this.startPointObjects.get(oldName);
      this.startPointObjects.delete(oldName);
      this.startPointObjects.set(newName, startPointObj);
      startPointObj.mesh.name = `startPoint_${newName}`;
    }

  }

  updateStartingPointColor(color) {
    this.startPointObjects.forEach((obj) => {
      obj.material.color = new THREE.Color(color);
    });
  }

  updateStartingPointRadius(radius) {
    this.startPointObjects.forEach((obj) => {
      // Create new geometry with new radius
      const _8_px = this.scene.view.control.getWorldUnitsForPixels(8);
      const newGeometry = new THREE.SphereGeometry(radius * _8_px, 8, 8);
      obj.mesh.geometry.dispose();
      obj.mesh.geometry = newGeometry;
      // Update stored geometry reference
      obj.geometry = newGeometry;
    });
  }

  updateStartingPointVisibility(caveName, caveVisible) {
    const startPointObj = this.startPointObjects.get(caveName);
    if (startPointObj) {
      // Update visibility based on both configuration and cave visibility
      startPointObj.mesh.visible = this.options.scene.startPoints.show && caveVisible;
      this.scene.view.renderView();
    }
  }

}
