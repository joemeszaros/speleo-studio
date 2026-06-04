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
      // Colour each segment along a start→end gradient, with an "on top" material so the
      // path stays visible through nearer passages.
      this.#applyGradientToTube(tubeGroup, color);
      this.tubes3DGroup.add(tubeGroup);

      const markers = this.#createMarkers(segments, color);
      this.tubes3DGroup.add(markers.group);

      this.tubes.set(id, {
        tube     : tubeGroup,
        markers  : markers,
        segments : segments,
        color    : color,
        caveName : caveName
      });
      this.scene.view.renderView();
    }
  }

  // Builds the endpoint markers (green start / red end) plus optional bead spheres
  // every N path vertices. Returns { group, spheres } where each sphere carries a
  // userData.pxFactor so it can be re-sized on zoom.
  #createMarkers(segments, color) {
    const group = new THREE.Group();
    group.name = 'shortest-path-markers';
    group.layers.set(1);
    const spheres = [];

    const vertices = SegmentScene.getOrderedVertices(segments);
    if (vertices.length === 0) {
      return { group, spheres };
    }

    const px = this.scene.view.control.getWorldUnitsForPixels(8);
    const sectionsCfg = this.options.scene.sections;
    const interval = sectionsCfg.markerInterval ?? 0;

    const addSphere = (pos, hexColor, pxFactor, renderOrder) => {
      const geometry = new THREE.SphereGeometry(px * pxFactor, 12, 12);
      const material = new THREE.MeshBasicMaterial({
        color       : new THREE.Color(hexColor),
        depthTest   : false,
        depthWrite  : false,
        transparent : true,
        opacity     : 1.0
      });
      const sphere = new THREE.Mesh(geometry, material);
      sphere.position.copy(pos);
      sphere.renderOrder = renderOrder;
      sphere.layers.set(1);
      sphere.userData.pxFactor = pxFactor;
      group.add(sphere);
      spheres.push(sphere);
    };

    const startColor = sectionsCfg.startColor ?? color;
    const endColor = sectionsCfg.endColor ?? color;
    const lastIndex = vertices.length - 1;

    // Bead spheres at every Nth intermediate vertex (skip the two endpoints), coloured
    // along the same start→end gradient as the tube.
    if (interval > 0) {
      for (let i = interval; i < lastIndex; i += interval) {
        const t = lastIndex > 0 ? i / lastIndex : 0;
        addSphere(vertices[i], SegmentScene.gradientColor(startColor, endColor, t), 0.7, 1000);
      }
    }

    // Endpoint markers drawn last/on top (the gradient ends).
    addSphere(vertices[0], startColor, 1.4, 1001);
    addSphere(vertices[lastIndex], endColor, 1.4, 1001);

    return { group, spheres };
  }

  // Colours each child segment of a tube group along a start→end gradient and gives it
  // the on-top material + render order. Gradient ends come from sections.startColor/endColor
  // (falling back to the supplied solid color).
  #applyGradientToTube(tubeGroup, fallbackColor) {
    const sectionsCfg = this.options.scene.sections;
    const startColor = sectionsCfg.startColor ?? fallbackColor;
    const endColor = sectionsCfg.endColor ?? fallbackColor;
    const n = tubeGroup.children.length;
    tubeGroup.children.forEach((tubeMesh, idx) => {
      const t = n > 1 ? idx / (n - 1) : 0;
      tubeMesh.material = SegmentScene.createOnTopMaterial(SegmentScene.gradientColor(startColor, endColor, t));
      tubeMesh.renderOrder = 999;
    });
  }

  #disposeMarkers(markers) {
    if (!markers) return;
    markers.spheres.forEach((s) => {
      s.geometry.dispose();
      s.material.dispose();
    });
    this.tubes3DGroup.remove(markers.group);
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

      this.#disposeMarkers(e.markers);

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
      this.#applyGradientToTube(newGroup, e.color);
      newGroup.layers.set(1);
      this.tubes3DGroup.add(newGroup);
      e.tube = newGroup;
    });
    this.scene.view.renderView();
  }

  // Keep endpoint/bead markers a constant pixel size as the user zoom changes.
  updateSegmentsEndpointSizes() {
    const px = this.scene.view.control.getWorldUnitsForPixels(8);
    this.tubes.forEach((e) => {
      e.markers?.spheres.forEach((s) => {
        s.geometry.dispose();
        s.geometry = new THREE.SphereGeometry(px * s.userData.pxFactor, 12, 12);
      });
    });
  }

  // Throttled variant for high-frequency callers (wheel zoom / dolly), mirroring
  // StartPointScene.updateAllStartPointSizesThrottled.
  updateSegmentsEndpointSizesThrottled() {
    this._tick = (this._tick ?? 0) + 1;
    if (this._tick % 3 === 0) {
      this.updateSegmentsEndpointSizes();
    }
    clearTimeout(this._settleTimer);
    this._settleTimer = setTimeout(() => this.updateSegmentsEndpointSizes(), 80);
  }

  // Linearly interpolated colour between two colours (hex strings or THREE.Color),
  // t in [0, 1]. Returns a new THREE.Color.
  static gradientColor(startColor, endColor, t) {
    return new THREE.Color(startColor).lerp(new THREE.Color(endColor), t);
  }

  // Material that renders on top of the rest of the scene (no depth test/write),
  // so the highlighted path is never occluded by nearer passages.
  static createOnTopMaterial(color) {
    return new THREE.MeshBasicMaterial({
      color       : new THREE.Color(color),
      depthTest   : false,
      depthWrite  : false,
      transparent : true,
      opacity     : 1.0
    });
  }

  // Reconstructs the ordered list of path vertices from the flat segment array
  // [from0, to0, from1(=to0), to1, ...]. Returns Vector3[] of length path.length.
  static getOrderedVertices(segments) {
    const vertices = [];
    if (!segments || segments.length < 6) return vertices;
    vertices.push(new THREE.Vector3(segments[0], segments[1], segments[2]));
    for (let i = 3; i + 2 < segments.length; i += 6) {
      vertices.push(new THREE.Vector3(segments[i], segments[i + 1], segments[i + 2]));
    }
    return vertices;
  }

  static createTubeGeometryFromSegments(segments, sectionWidth) {

    if (!segments || segments.length === 0) {
      return new THREE.Group();
    }
    // Create a simpler approach: create individual tube segments for each line segment
    const group = new THREE.Group();
    group.name = `tube-geometry-from-segments`;

    // Use fixed values for simplicity
    const tubeRadius = sectionWidth * 0.35; // thicker than the old 15% so the path reads boldly

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
