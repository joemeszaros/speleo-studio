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
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { i18n } from '../../i18n/i18n.js';
import * as U from '../../utils/utils.js';
import { SegmentScene } from './segments.js';
import { SectionHelper } from '../../section.js';
import { ImageCache } from '../../utils/image-cache.js';

export class AttributesScene {

  constructor(options, materials, scene, imageCache) {
    this.options = options;
    this.scene = scene;
    this.mats = materials.materials;
    this.sectionAttributes = new Map();
    this.stationAttributes = new Map();
    this.sectionAttributes3DGroup = new THREE.Group();
    this.sectionAttributes3DGroup.name = 'section attributes';
    this.stationAttributes3DGroup = new THREE.Group();
    this.stationAttributes3DGroup.name = 'station attributes';
    this.imageCache = imageCache;
    this.textureLoader = new THREE.TextureLoader();
    scene.addObjectToScene(this.sectionAttributes3DGroup);
    scene.addObjectToScene(this.stationAttributes3DGroup);
  }

  // for section and component attributes
  showFragmentAttribute(id, segments, attribute, format = '${name}', color, caveName) {
    if (!this.sectionAttributes.has(id)) {
      // Create tube geometry for the attribute path
      const tubeGroup = SegmentScene.createTubeGeometryFromSegments(segments, this.options.scene.sections.width);

      // Apply material to all tube segments in the group
      tubeGroup.children.forEach((tubeMesh) => {
        tubeMesh.material = new THREE.MeshBasicMaterial({
          color       : new THREE.Color(color),
          transparent : false,
          opacity     : 1.0
        });
      });

      tubeGroup.layers.set(1);
      this.sectionAttributes3DGroup.add(tubeGroup);

      const geometry = new LineSegmentsGeometry();
      geometry.setPositions(segments);
      geometry.computeBoundingBox();
      const bb = geometry.boundingBox;
      const center = bb.getCenter(new THREE.Vector3());
      const maxZ = bb.min.z > bb.max.z ? bb.min.z : bb.max.z;
      center.z = maxZ;
      const localized = attribute.localize(i18n);
      const { interpolated, success } = U.interpolate(format, localized);
      let sprite;
      if (success) {
        let textSprite = this.scene.getSpriteLabel(
          interpolated,
          center,
          this.options.scene.sections.labels.size,
          this.options.scene.sections.labels.color,
          this.options.scene.sections.labels.strokeColor
        );
        sprite = textSprite.getSprite();
        this.sectionAttributes3DGroup.add(sprite);
        sprite.layers.set(1);
      }

      this.sectionAttributes.set(id, {
        tube     : tubeGroup,
        text     : sprite,
        label    : interpolated,
        center   : center,
        caveName : caveName,
        segments : segments,
        color    : color
      });
      this.scene.view.renderView();
    }
  }

  toggleSectionsLabelVisibility(visible) {
    this.sectionAttributes.forEach((e) => {
      if (e.text) {
        e.text.visible = visible;
      }
    });
    this.scene.view.renderView();
  }

  updateSectionAttributesLabels() {
    this.sectionAttributes.forEach((e) => {
      if (e.text) {
        e.text = this.updateAttributeLabel(
          e.label,
          this.options.scene.sections.labels.size,
          e.text,
          e.center,
          this.sectionAttributes3DGroup
        );
      }
    });
    this.scene.view.renderView();
  }

  updateAttributeLabel(label, newSize, sprite, position, group) {
    const visible = sprite.visible;
    sprite.material.map.dispose();
    sprite.material.dispose();
    sprite.geometry.dispose();
    group.remove(sprite);
    let newTextSprite = this.scene.getSpriteLabel(
      label,
      position,
      newSize,
      this.options.scene.sections.labels.color,
      this.options.scene.sections.labels.strokeColor
    );
    const newSprite = newTextSprite.getSprite();
    newSprite.visible = visible;
    newSprite.layers.set(1);
    group.add(newSprite);
    return newSprite;
  }

  updateSectionAttributesWidth() {
    this.sectionAttributes.forEach((e) => {
      e.tube.children.forEach((tubeMesh) => {
        tubeMesh.geometry.dispose();
        tubeMesh.material.dispose();
      });
      this.sectionAttributes3DGroup.remove(e.tube);

      const newGroup = SegmentScene.createTubeGeometryFromSegments(e.segments, this.options.scene.sections.width);
      newGroup.children.forEach((tubeMesh) => {
        tubeMesh.material = new THREE.MeshBasicMaterial({
          color       : new THREE.Color(e.color),
          transparent : false,
          opacity     : 1.0
        });
      });
      newGroup.layers.set(1);
      this.sectionAttributes3DGroup.add(newGroup);
      e.tube = newGroup;
    });
    this.scene.view.renderView();
  }

  disposeSectionAttributes(caveName) {
    const matchingIds = [];
    for (const [id, entry] of this.sectionAttributes) {
      if (entry.caveName === caveName) {
        matchingIds.push(id);
      }
    }
    matchingIds.forEach((id) => this.disposeSectionAttribute(id));
  }

  disposeSectionAttribute(id) {
    if (this.sectionAttributes.has(id)) {
      const e = this.sectionAttributes.get(id);

      const tubeGroup = e.tube;

      // Dispose tube mesh if it exists
      if (tubeGroup) {
        tubeGroup.children.forEach((tubeMesh) => {
          tubeMesh.geometry.dispose();
          tubeMesh.material.dispose();
        });
        this.sectionAttributes3DGroup.remove(tubeGroup);
      }

      if (e.text) {
        const sprite = e.text;
        this.sectionAttributes3DGroup.remove(sprite);
        sprite.material.map.dispose();
        sprite.material.dispose();
        sprite.geometry.dispose();
      }
      this.sectionAttributes.delete(id);
      this.scene.view.renderView();
    }
  }

  reloadSectionAttributes(cave) {
    if (this.sectionAttributes.size === 0) {
      return;
    }
    const graph = SectionHelper.getGraph(cave);

    const matchingIds = [...this.sectionAttributes]
      .filter(([, entry]) => entry.caveName === cave.name)
      .map(([id]) => id);

    matchingIds.forEach((id) => {
      const sa = cave.attributes.sectionAttributes.find((sa) => sa.id === id);
      if (sa !== undefined) {
        const section = SectionHelper.getSection(graph, sa.section.from, sa.section.to);
        const segments = SectionHelper.getSectionSegments(section, cave.stations);
        const oldSegments = this.sectionAttributes.get(id).segments;
        if (!U.arraysEqual(segments, oldSegments)) {
          this.disposeSectionAttribute(id);
          this.showFragmentAttribute(id, segments, sa.attribute, sa.format, sa.color, cave.name);
        }
      }

      const ca = cave.attributes.componentAttributes.find((ca) => ca.id === id);
      if (ca !== undefined) {
        const component = SectionHelper.getComponent(graph, ca.component.start, ca.component.termination);
        const segments = SectionHelper.getComponentSegments(component, cave.stations);
        const oldSegments = this.sectionAttributes.get(id).segments;
        if (!U.arraysEqual(segments, oldSegments)) {
          this.disposeSectionAttribute(id);
          this.showFragmentAttribute(id, segments, ca.attribute, ca.format, ca.color, cave.name);
        }
      }

    });
  }

  reloadStationAttributes(cave) {
    if (this.stationAttributes.size === 0) {
      return;
    }
    const caveName = cave.name;
    const stations = cave.stations;
    [...this.stationAttributes]
      .filter(([, entry]) => entry.caveName === caveName)
      .forEach(([id, entry]) => {
        const oldStation = entry.station;
        const newStation = stations.get(oldStation.name);
        if (newStation !== undefined && !newStation.position.equals(oldStation.position)) {
          this.disposeStationAttribute(id);
          this.showStationAttribute(id, newStation, entry.attribute, caveName);
        } else {
          // station doesn't exist anymore
          this.disposeStationAttribute(id);
        }
      });
  }

  showStationAttribute(id, station, attribute, caveName) {
    if (!this.stationAttributes.has(id)) {
      if (['bedding', 'fault'].includes(attribute.name)) {
        this.showPlaneFor(id, station, attribute, caveName);
      } else if (attribute.name === 'photo' && attribute.url) {
        this.showPhotoAttribute(id, station, attribute, caveName);
      } else {
        this.showIconFor(id, station, attribute, caveName);
      }
    }
  }

  repositionPlaneLabels() {
    this.stationAttributes.forEach((e) => {
      if (e.label) {
        this.updateLabelPosition(e);
      }
    });
  }

  updateLabelPosition(entry) {
    const { circle, sprite, attribute } = entry;

    const cameraDirection = new THREE.Vector3();
    this.scene.view.control.camera.getWorldDirection(cameraDirection);
    cameraDirection.negate();

    // Get the circle's normal vector (perpendicular to the circle plane)
    const circleNormal = new THREE.Vector3();
    circle.getWorldDirection(circleNormal);

    // Calculate the dot product to determine how "edge-on" the circle appears
    // 1 = circle facing camera (width = diameter), 0 = edge-on (width = 0)
    const dotProduct = Math.abs(cameraDirection.dot(circleNormal));

    const baseOffset = 1.3;
    const offsetMultiplier = (1 - dotProduct) * attribute.size;
    const offsetDistance = 3 + baseOffset * offsetMultiplier;

    // Calculate label position in world coordinates
    const circleWorldPosition = new THREE.Vector3();
    circle.getWorldPosition(circleWorldPosition);

    const labelPosition = circleWorldPosition.clone();
    labelPosition.add(cameraDirection.clone().multiplyScalar(offsetDistance));
    sprite.position.copy(labelPosition);
  }

  updateStationAttributesLabels() {
    this.stationAttributes.forEach((e) => {
      if (e.sprite && e.label) {
        e.sprite = this.updateAttributeLabel(
          e.label,
          this.options.scene.sections.labels.size * 0.7,
          e.sprite,
          e.center,
          this.stationAttributes3DGroup
        );
      }
    });

    this.scene.view.renderView();
  }

  getPhotoSprites() {
    return this.stationAttributes
      .values()
      .filter((v) => v.attribute.name === 'photo')
      .map((v) => v.sprite);
  }

  showPlaneFor(id, station, attribute, caveName) {
    if (!this.stationAttributes.has(id)) {
      const position = station.position;

      // Create a group to hold all tectonic feature elements
      const tectonicGroup = new THREE.Group();
      tectonicGroup.name = `tectonic-${attribute.name}-${id}`;

      const radius = attribute.size / 2;
      const circleGeometry = new THREE.CircleGeometry(radius, 32);
      const circle = new THREE.Mesh(circleGeometry, this.mats.planes.get(attribute.name));
      circle.name = `circle-${attribute.name}-${id}`;

      const strokeGeometry = new LineSegmentsGeometry();
      const points = [];
      const segments = attribute.size * 2;

      let prevPoint = undefined;
      for (let i = 0; i <= segments; i++) {
        const angle = (i / segments) * Math.PI * 2;
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius;
        const z = 0.001;
        const point = new THREE.Vector3(x, y, z);

        if (prevPoint) {
          points.push(prevPoint.x, prevPoint.y, prevPoint.z);
          points.push(point.x, point.y, point.z);
        }
        prevPoint = point;
      }

      strokeGeometry.setPositions(points);
      const stroke = new LineSegments2(strokeGeometry, this.mats.tectonicLine);
      stroke.name = `stroke-${attribute.name}-${id}`;
      tectonicGroup.add(circle);
      tectonicGroup.add(stroke);

      this.addGeologicalSymbols(tectonicGroup, attribute, radius);
      const textSprite = this.addTectonicLabels(attribute);

      const dir = U.normal(U.degreesToRads(attribute.azimuth), U.degreesToRads(attribute.dip));
      tectonicGroup.children.forEach((child) => {
        child.lookAt(dir.x, dir.y, dir.z);
        child.layers.set(1);
      });

      const v = new THREE.Vector3(position.x, position.y, position.z);
      tectonicGroup.position.copy(v);

      this.stationAttributes3DGroup.add(tectonicGroup);
      const entry = {
        group     : tectonicGroup,
        circle    : circle,
        stroke    : stroke,
        center    : v,
        label     : textSprite.label,
        sprite    : textSprite.getSprite(),
        attribute : attribute,
        station   : station,
        caveName  : caveName,
        hasPlane  : true
      };
      this.stationAttributes.set(id, entry);
      this.updateLabelPosition(entry);

      this.scene.view.renderView();
    }
  }

  addGeologicalSymbols(group, attribute, radius) {
    if (attribute.name === 'bedding') {
      this.addBeddingSymbol(group, radius);
    } else if (attribute.name === 'fault') {
      this.addFaultSymbol(group, radius);
    }
  }

  addBeddingSymbol(group, radius) {
    const symbolSize = radius * 0.6;

    const strikeGeometry = new LineSegmentsGeometry();
    const strikePoints = [-symbolSize, 0, 0, symbolSize, 0, 0];
    strikeGeometry.setPositions(strikePoints);
    const strikeLine = new LineSegments2(strikeGeometry, this.mats.tectonicLine);
    strikeLine.name = 'bedding-strike';
    group.add(strikeLine);

    const dipGeometry = new LineSegmentsGeometry();
    const dipLength = symbolSize * 0.4;
    const dipPoints = [0, 0, 0, 0, dipLength, 0];
    dipGeometry.setPositions(dipPoints);
    const dipIndicator = new LineSegments2(dipGeometry, this.mats.tectonicLine);
    dipIndicator.name = 'bedding-dip';
    group.add(dipIndicator);
  }

  addFaultSymbol(group, radius) {
    const sSize = radius * 0.5; // symbol size
    const arrowLength = sSize * 0.8;
    const arrowWidth = sSize * 0.2;

    // Create two opposing half-arrows that lie ON the plane surface
    const faultGeometry = new LineSegmentsGeometry();
    const points = [];

    const sfc = sSize / 2; // shift from center
    const dY = 1; // shift y
    // Left arrow (pointing left) - all points at Z = 0 to lie on plane
    points.push(sfc - sSize, -dY, 0, sfc - sSize + arrowLength, -dY, 0);
    points.push(sfc - sSize + arrowLength, -dY, 0, sfc - sSize + arrowLength - arrowWidth, -dY - arrowWidth, 0);
    //right arrow
    points.push(-sfc + sSize, dY, 0, -sfc + sSize - arrowLength, dY, 0);
    points.push(-sfc + sSize - arrowLength, dY, 0, -sfc + sSize - arrowLength + arrowWidth, dY + arrowWidth, 0);

    faultGeometry.setPositions(points);
    const faultSymbol = new LineSegments2(faultGeometry, this.mats.tectonicLine);
    faultSymbol.name = 'fault-symbol';
    group.add(faultSymbol);
  }

  addTectonicLabels(attribute) {
    const dip = attribute.dip;
    const azimuth = attribute.azimuth;
    const value = `${String(Math.floor(azimuth)).padStart(3, '0')}° / ${String(Math.floor(dip)).padStart(2, '0')}°`;
    // Create dip label that always faces the camera
    const textSprite = this.scene.getSpriteLabel(
      value,
      new THREE.Vector3(0, 0, 0), // Will be positioned in world coordinates
      this.options.scene.sections.labels.size * 0.7,
      this.options.scene.sections.labels.color,
      this.options.scene.sections.labels.strokeColor
    );
    const sprite = textSprite.getSprite();
    sprite.name = 'dip-label';
    sprite.layers.set(1);

    // Add to scene group instead of the rotating group
    this.stationAttributes3DGroup.add(sprite);
    return textSprite;
  }

  updateTectonicCircleOpacity(opacity) {
    this.stationAttributes.forEach((e) => {
      if (e.circle) {
        e.circle.material.opacity = opacity;
      }
    });
    this.scene.view.renderView();
  }

  showIconFor(id, station, attribute, caveName) {
    if (!this.stationAttributes.has(id)) {
      const position = station.position;

      // Create a sprite with the SVG icon
      const iconPath = `icons/${attribute.name}.svg`;

      this.textureLoader.load(
        iconPath,
        (texture) => {
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.format = THREE.RGBAFormat;
          const spriteMaterial = new THREE.SpriteMaterial({
            map         : texture,
            transparent : true,
            opacity     : 1.0
          });

          const sprite = new THREE.Sprite(spriteMaterial);
          sprite.name = `icon-${attribute.name}-${id}`;
          sprite.position.set(position.x, position.y, position.z);
          sprite.scale.set(
            this.options.scene.stationAttributes.iconScale,
            this.options.scene.stationAttributes.iconScale,
            this.options.scene.stationAttributes.iconScale
          );
          sprite.layers.set(1);
          this.stationAttributes3DGroup.add(sprite);

          this.stationAttributes.set(id, {
            sprite    : sprite,
            caveName  : caveName,
            station   : station,
            attribute : attribute,
            hasIcon   : true
          });

          this.scene.view.renderView();
        },
        undefined,
        (error) => {
          console.warn(`Failed to load icon for ${attribute.name}:`, error);
        }
      );
    }
  }

  async showPhotoAttribute(id, station, attribute, caveName) {

    try {
      // Check if browser supports Cache API and imageCache is available
      let texture;

      if (!ImageCache.isSupported() || !this.imageCache) {
        console.log('🖼 Using direct texture loading (no cache available)');
        texture = await this.textureLoader.loadAsync(attribute.url);
      } else {
        const img = await this.imageCache.loadImage(attribute.url);

        texture = new THREE.Texture();
        texture.image = img;
        texture.needsUpdate = true;
      }

      if (!texture || !texture.image) {
        console.error(`Failed to load photo from ${attribute.url}`);
        return;
      }

      texture.colorSpace = THREE.SRGBColorSpace;
      // Create sprite material with the loaded texture
      const spriteMaterial = new THREE.SpriteMaterial({
        map         : texture,
        transparent : false,
        opacity     : 1.0
      });

      const position = station.position;
      const sprite = new THREE.Sprite(spriteMaterial);
      sprite.name = `photo-${id}`;
      sprite.position.set(position.x, position.y, position.z);

      const photoScale = this.options.scene.stationAttributes.iconScale;
      const aspectRatio = texture.image.width / texture.image.height;
      if (aspectRatio > 1) {
        sprite.scale.set(photoScale, photoScale / aspectRatio, 1);
      } else {
        sprite.scale.set(photoScale * aspectRatio, photoScale, 1);
      }
      sprite.layers.set(1);
      this.stationAttributes3DGroup.add(sprite);

      this.stationAttributes.set(id, {
        sprite    : sprite,
        caveName  : caveName,
        station   : station,
        attribute : attribute,
        hasImage  : true,
        texture   : texture
      });

      this.scene.view.renderView();
    } catch (error) {
      console.error(`Failed to load photo from ${attribute.url}:`, error);
    }
  }

  diposeStationAttributes(caveName) {
    const matchingIds = [];
    for (const [id, entry] of this.stationAttributes) {
      if (entry.caveName === caveName) {
        matchingIds.push(id);
      }
    }
    matchingIds.forEach((id) => this.disposeStationAttribute(id));
  }

  disposeStationAttribute(id) {
    if (this.stationAttributes.has(id)) {
      const entry = this.stationAttributes.get(id);
      const attributeName = entry.attribute.name;
      if (['bedding', 'fault'].includes(attributeName)) {
        this.disposePlaneFor(id);
      } else if (entry.hasImage) {
        this.disposeImageFor(id);
      } else {
        this.disposeIconFor(id);
      }
    }
  }

  disposeImageFor(id) {
    if (this.stationAttributes.has(id)) {
      const entry = this.stationAttributes.get(id);
      this.stationAttributes3DGroup.remove(entry.sprite);
      // nothing to do, texture image is cached
      //entry.sprite.material.map.dispose();
      entry.sprite.material.dispose();
      entry.sprite.geometry?.dispose();
      this.stationAttributes.delete(id);
      this.scene.view.renderView();
    }
  }

  disposeIconFor(id) {
    if (this.stationAttributes.has(id)) {
      const e = this.stationAttributes.get(id);

      const sprite = e.sprite;

      if (sprite.material && sprite.material.map) {
        sprite.material.map.dispose();
      }
      sprite.material.dispose();
      sprite.geometry?.dispose();

      this.stationAttributes3DGroup.remove(sprite);
      this.stationAttributes.delete(id);
      this.scene.view.renderView();
    }
  }

  disposePlaneFor(id) {
    if (this.stationAttributes.has(id)) {
      const e = this.stationAttributes.get(id);
      const group = e.group;

      // Dispose all geometries in the group
      group.traverse((child) => {
        if (child.geometry) {
          child.geometry.dispose();
        }
        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach((mat) => mat.dispose());
          } else {
            child.material.dispose();
          }
        }
      });

      // Dispose the label if it exists
      if (e.sprite) {
        if (e.sprite.material && e.sprite.material.map) {
          e.sprite.material.map.dispose();
        }
        e.sprite.material.dispose();
        e.sprite.geometry?.dispose();
        this.stationAttributes3DGroup.remove(e.sprite);
      }

      this.stationAttributes3DGroup.remove(group);
      this.stationAttributes.delete(id);
      this.scene.view.renderView();
    }
  }

  updateStationAttributeIconScales(newScale) {
    // Update the scale of all existing station attribute icons
    this.stationAttributes.forEach((entry) => {
      if (entry?.hasIcon && entry.sprite && entry.sprite.type === 'Sprite') {
        entry.sprite.scale.set(newScale, newScale, 1);
      } else if (entry?.hasImage && entry.sprite && entry.sprite.type === 'Sprite') {
        // Photos use a larger scale multiplier
        const aspectRatio = entry.texture.image.width / entry.texture.image.height;
        if (aspectRatio > 1) {
          entry.sprite.scale.set(newScale, newScale / aspectRatio, 1);
        } else {
          entry.sprite.scale.set(newScale * aspectRatio, newScale, 1);
        }

      }
    });
    this.scene.view.renderView();
  }

  renameCaveTo(newName) {
    this.sectionAttributes.forEach((sa) => (sa.caveName = newName)); //TODO: what to do with component attributes here?
  }

}
