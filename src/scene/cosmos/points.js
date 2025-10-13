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

export class PointScene {
  constructor(options, materials, scene) {
    this.options = options;
    this.scene = scene;
    this.mats = materials.materials;
    this.spheres3DGroup = new THREE.Group();
    this.spheres3DGroup.name = 'spheres';
    scene.addObjectToScene(this.spheres3DGroup);
    this.createSpheres();
  }

  createSpheres() {
    const cameraTargetGeo = new THREE.SphereGeometry(this.options.scene.camera.target.radius, 10, 10);
    this.cameraTarget = this.addSphere(
      'camera target',
      new THREE.Vector3(0, 0, 0),
      this.spheres3DGroup,
      cameraTargetGeo,
      this.mats.sphere.cameraTarget,
      {
        type : 'camera target'
      }
    );
    this.cameraTarget.visible = this.options.scene.camera.target.show;

    const sphereGeo = new THREE.SphereGeometry(this.options.scene.centerLines.spheres.radius, 10, 10);
    this.surfaceSphere = this.addSphere(
      'surface',
      new THREE.Vector3(0, 0, 0),
      this.spheres3DGroup,
      sphereGeo,
      this.mats.sphere.surface,
      {
        type : 'surface'
      }
    );
    this.surfaceSphere.visible = false;

    const map = new THREE.TextureLoader().load('icons/focus.svg');
    map.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.SpriteMaterial({ map: map });

    const focusSprite = new THREE.Sprite(material);
    focusSprite.name = 'focus sprite';
    this.focusSprite = focusSprite;
    focusSprite.layers.set(1);
    focusSprite.visible = false;
    this.spheres3DGroup.add(focusSprite); // not the best place for this

    const geometry = new THREE.TorusGeometry(1.3, 0.2, 16, 100);
    this.focusSphere = this.addSphere(
      'selected station sphere',
      new THREE.Vector3(0, 0, 0),
      this.spheres3DGroup,
      sphereGeo,
      this.mats.sphere.selectedStation,
      {
        type : 'selected station'
      }
    );
    this.focusSphere.visible = false;
    this.distanceSphere = this.addSphere(
      'distance sphere',
      new THREE.Vector3(0, 0, 0),
      this.spheres3DGroup,
      geometry,
      this.mats.sphere.distanceMeasurement,
      {
        type : 'distance station'
      }
    );
    this.distanceSphere.visible = false;
  }

  setFocusSpherePosition(position) {
    this.focusSphere.position.copy(position);
  }

  setFocusTorusPosition(position) {
    this.focusSprite.position.copy(position);
  }

  setCameraTargetPosition(position) {
    this.cameraTarget.position.copy(position);
  }

  addSphere(name, position, sphereGroup, geometry, material, meta) {
    const sphere = new THREE.Mesh(geometry, material);
    sphere.position.x = position.x;
    sphere.position.y = position.y;
    sphere.position.z = position.z;
    sphere.name = name;
    sphere.type = meta.type; // custom property
    sphere.meta = meta; // custom property
    sphereGroup.add(sphere);
    sphere.layers.set(1);
    return sphere;
  }
}
