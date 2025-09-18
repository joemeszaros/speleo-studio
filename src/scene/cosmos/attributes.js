import * as THREE from 'three';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { i18n } from '../../i18n/i18n.js';
import * as U from '../../utils/utils.js';
import { SegmentScene } from './segments.js';

export class AttributesScene {

  constructor(options, materials, scene) {
    this.options = options;
    this.scene = scene;
    this.mats = materials.materials;
    this.sectionAttributes = new Map();
    this.stationAttributes = new Map();
    this.sectionAttributes3DGroup = new THREE.Group();
    this.sectionAttributes3DGroup.name = 'section attributes';
    this.stationAttributes3DGroup = new THREE.Group();
    this.stationAttributes3DGroup.name = 'station attributes';
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
      const formattedAttribute = U.interpolate(format, localized);
      let sprite = this.scene.addSpriteLabel(
        formattedAttribute,
        center,
        this.options.scene.sections.labels.size,
        this.options.scene.sections.labels.color,
        this.options.scene.sections.labels.strokeColor
      );
      this.sectionAttributes3DGroup.add(sprite);
      sprite.layers.set(1);

      this.sectionAttributes.set(id, {
        tube     : tubeGroup,
        text     : sprite,
        label    : formattedAttribute,
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
      e.text.visible = visible;
    });
    this.scene.view.renderView();
  }

  updateSectionAttributesLabels() {
    this.sectionAttributes.forEach((e) => {
      const visible = e.text.visible;
      e.text.material.map.dispose();
      e.text.material.dispose();
      e.text.geometry.dispose();
      this.sectionAttributes3DGroup.remove(e.text);
      let newSprite = this.scene.addSpriteLabel(
        e.label,
        e.center,
        this.options.scene.sections.labels.size,
        this.options.scene.sections.labels.color,
        this.options.scene.sections.labels.strokeColor
      );
      newSprite.visible = visible;
      newSprite.layers.set(1);
      e.text = newSprite;
      this.sectionAttributes3DGroup.add(newSprite);
    });
    this.scene.view.renderView();
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

      const textMesh = e.text;
      this.sectionAttributes3DGroup.remove(textMesh);
      textMesh.geometry.dispose();
      this.sectionAttributes.delete(id);
      this.scene.view.renderView();
    }
  }

  showStationAttribute(id, station, attribute) {
    if (!this.stationAttributes.has(id)) {
      if (['bedding', 'fault'].includes(attribute.name)) {
        this.showPlaneFor(id, station, attribute);
      } else {
        this.showIconFor(id, station, attribute);
      }
    }
  }

  showPlaneFor(id, station, attribute) {
    if (!this.stationAttributes.has(id)) {
      const position = station.position;
      const geometry = new THREE.PlaneGeometry(attribute.width, attribute.height, 10, 10);
      const plane = new THREE.Mesh(geometry, this.mats.planes.get(attribute.name));
      plane.name = `plane-${attribute.name}-${id}`;
      plane.position.set(0, 0, 0);
      const dir = U.normal(U.degreesToRads(attribute.azimuth), U.degreesToRads(attribute.dip));
      plane.lookAt(dir.x, dir.y, dir.z);
      const v = new THREE.Vector3(position.x, position.y, position.z);
      plane.position.copy(v);

      this.stationAttributes3DGroup.add(plane);

      this.stationAttributes.set(id, {
        plane     : plane,
        station   : station,
        attribute : attribute
      });
      this.scene.view.renderView();
    }
  }

  showIconFor(id, station, attribute) {
    if (!this.stationAttributes.has(id)) {
      const position = station.position;

      // Create a sprite with the SVG icon
      const iconPath = `icons/${attribute.name}.svg`;
      const textureLoader = new THREE.TextureLoader();

      textureLoader.load(
        iconPath,
        (texture) => {
          texture.colorSpace = THREE.SRGBColorSpace;
          const spriteMaterial = new THREE.SpriteMaterial({
            map         : texture,
            transparent : false,
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
            station   : station,
            attribute : attribute
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

  disposeStationAttribute(id, attribute) {
    if (this.stationAttributes.has(id)) {
      if (['bedding', 'fault'].includes(attribute.name)) {
        this.scene.attributes.disposePlaneFor(id);
      } else {
        this.scene.attributes.disposeIconFor(id);
      }
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
      const plane = e.plane;
      plane.geometry.dispose();
      this.stationAttributes3DGroup.remove(plane);
      this.stationAttributes.delete(id);
      this.scene.view.renderView();
    }
  }

  updateStationAttributeIconScales(newScale) {
    // Update the scale of all existing station attribute icons
    this.stationAttributes.forEach((entry) => {
      if (entry.sprite && entry.sprite.type === 'Sprite') {
        entry.sprite.scale.set(newScale, newScale, newScale);
      }
    });
    this.scene.view.renderView();
  }

  renameCaveTo(newName) {
    this.sectionAttributes.forEach((sa) => (sa.caveName = newName)); //TODO: what to do with component attributes here?
  }

}
