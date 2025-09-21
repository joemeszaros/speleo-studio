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
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';

export class SegmentScene {

  constructor(options, scene) {
    this.options = options;
    this.scene = scene;
    this.segments = new Map(); // for shortest path segments
    this.tubes = new Map(); //
    this.tubes3DGroup = new THREE.Group();
    this.segments3DGroup = new THREE.Group();
    this.segments3DGroup.name = 'segments';
    scene.addObjectToScene(this.segments3DGroup);
    scene.addObjectToScene(this.tubes3DGroup);
  }

  showSegments(id, name, segments, color, caveName) {
    if (!this.segments.has(id)) {
      const geometry = new LineSegmentsGeometry();
      geometry.setPositions(segments);
      geometry.computeBoundingBox();
      const material = new LineMaterial({
        color        : new THREE.Color(color),
        linewidth    : this.options.scene.sections.width,
        worldUnits   : false,
        vertexColors : false
      });
      const lineSegments = new LineSegments2(geometry, material);
      lineSegments.name = name;
      lineSegments.layers.set(1);
      this.segments3DGroup.add(lineSegments);
      this.segments.set(id, {
        segments : lineSegments,
        caveName : caveName
      });
      this.scene.view.renderView();
    }
  }

  disposeSegments(id) {
    if (this.segments.has(id)) {
      const e = this.segments.get(id);
      const lineSegments = e.segments;
      lineSegments.geometry.dispose();
      lineSegments.material.dispose();
      this.segments3DGroup.remove(lineSegments);
      this.segments.delete(id);
      this.scene.view.renderView();
    }
  }

  updateSegmentsWidth(width) {
    this.segments3DGroup.children.forEach((e) => {
      e.material.linewidth = width;
    });
    this.scene.view.renderView();
  }

  showSegmentsTube(id, name, segments, color, caveName) {
    if (!this.tubes.has(id)) {
      const tubeGroup = SegmentScene.createTubeGeometryFromSegments(segments, this.options.scene.sections.width);
      tubeGroup.name = name;
      tubeGroup.layers.set(1);
      // Apply material to all tube segments in the group
      tubeGroup.children.forEach((tubeMesh) => {
        tubeMesh.material = new THREE.MeshBasicMaterial({
          color       : new THREE.Color(color),
          transparent : false,
          opacity     : 1.0
        });
      });
      this.tubes3DGroup.add(tubeGroup);
      this.tubes.set(id, {
        tube     : tubeGroup,
        segments : segments,
        color    : color,
        caveName : caveName
      });
      this.scene.view.renderView();
    }
  }

  disposeSegmentsTube(id) {
    if (this.tubes.has(id)) {
      const e = this.tubes.get(id);

      const tubeGroup = e.tube;

      // Dispose tube mesh if it exists
      if (tubeGroup) {
        tubeGroup.children.forEach((tubeMesh) => {
          tubeMesh.geometry.dispose();
          tubeMesh.material.dispose();
        });
        this.tubes3DGroup.remove(tubeGroup);
      }

      this.tubes.delete(id);
      this.scene.view.renderView();
    }
  }

  updateSegmentsTubesWidth() {

    this.tubes.forEach((e) => {
      e.tube.children.forEach((tubeMesh) => {
        tubeMesh.geometry.dispose();
        tubeMesh.material.dispose();
      });
      this.tubes3DGroup.remove(e.tube);

      const newGroup = SegmentScene.createTubeGeometryFromSegments(e.segments, this.options.scene.sections.width);
      newGroup.children.forEach((tubeMesh) => {
        tubeMesh.material = new THREE.MeshBasicMaterial({
          color       : new THREE.Color(e.color),
          transparent : false,
          opacity     : 1.0
        });
      });
      newGroup.layers.set(1);
      this.tubes3DGroup.add(newGroup);
      e.tube = newGroup;
    });
    this.scene.view.renderView();
  }

  static createTubeGeometryFromSegments(segments, sectionWidth) {

    if (!segments || segments.length === 0) {
      return new THREE.Group();
    }
    // Create a simpler approach: create individual tube segments for each line segment
    const group = new THREE.Group();
    group.name = `tube-geometry-from-segments`;

    // Use fixed values for simplicity
    const tubeRadius = sectionWidth * 0.15; // 15% of line width

    // Process segments in pairs (start and end points)
    for (let i = 0; i < segments.length; i += 6) {
      if (i + 5 < segments.length) {
        const startPoint = new THREE.Vector3(segments[i], segments[i + 1], segments[i + 2]);
        const endPoint = new THREE.Vector3(segments[i + 3], segments[i + 4], segments[i + 5]);

        // Create a tube segment between these two points
        const direction = new THREE.Vector3().subVectors(endPoint, startPoint);
        const distance = direction.length();

        if (distance > 0.001) {
          // Avoid very short segments
          const tubeGeometry = new THREE.CylinderGeometry(tubeRadius, tubeRadius, distance, 6, 1, false);

          // Position the tube at the midpoint
          const midPoint = new THREE.Vector3().addVectors(startPoint, endPoint).multiplyScalar(0.5);

          // Rotate to align with the direction
          const up = new THREE.Vector3(0, 1, 0);
          const quaternion = new THREE.Quaternion().setFromUnitVectors(up, direction.normalize());

          const tubeMesh = new THREE.Mesh(tubeGeometry);
          tubeMesh.name = `tube-geometry-from-segments-${i}-${i + 5}`;
          tubeMesh.position.copy(midPoint);
          tubeMesh.setRotationFromQuaternion(quaternion);

          group.add(tubeMesh);
        }
      }
    }

    return group;
  }
}
