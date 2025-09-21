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

import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import * as THREE from 'three';
import { ShotType } from '../../model/survey.js';
import * as U from '../../utils/utils.js';
import { i18n } from '../../i18n/i18n.js';
import { ColorModeHelper } from '../colormode.js';
import { TextSprite } from '../textsprite.js';

export class SpeleoScene {

  constructor(db, options, materials, scene) {
    this.options = options;
    this.db = db;
    this.mats = materials.materials;
    this.materials = materials;
    this.scene = scene;
    this.caveObjects = new Map(); // for centerlines, splays ... for a cave
    this.caveObject3DGroup = new THREE.Group();
    this.caveObject3DGroup.name = 'cave object';

    this.colorModeHelper = new ColorModeHelper(this.db, this.options, this.caveObjects, materials);
    this.scene.addObjectToScene(this.caveObject3DGroup);

  }

  setObjectsVisibility(fieldName, val) {
    const entries = this.#getCaveObjectsFlattened();
    entries.forEach((e) => {
      if (e[fieldName] !== undefined) {
        e[fieldName].visible = !e.centerLines.hidden && val;
      }
    });
    this.scene.view.renderView();
  }

  setObjectsOpacity(fieldName, val) {
    const entries = this.#getCaveObjectsFlattened();
    entries.forEach((e) => {
      if (e[fieldName] !== undefined) {
        e[fieldName].material.transparent = true;
        e[fieldName].material.opacity = val;
      }
    });
    this.scene.view.renderView();
  }

  changeCenterLineColorMode(mode, trigger) {
    this.colorModeHelper.setColorMode(mode, trigger);
    this.scene.view.renderView();
  }

  //#region station spheres

  addSpheresInsanced(geometry, material, stations, caveName, surveyName) {
    const iMeshSpheres = new THREE.InstancedMesh(geometry, material, stations.length);
    iMeshSpheres.name = `spheres-${caveName}-${surveyName}`;
    iMeshSpheres.layers.set(1);
    stations.forEach((r, index) => {
      iMeshSpheres.setMatrixAt(
        index,
        new THREE.Matrix4().makeTranslation(r.station.position.x, r.station.position.y, r.station.position.z)
      );
    });
    return iMeshSpheres;
  }

  addStationSpheres(material, sphereOtions, stations, visibility, caveName, surveyName, group) {
    if (stations.length === 0) {
      return undefined;
    }
    const geometry = new THREE.SphereGeometry(sphereOtions.radius, 5, 5);
    const instancedMesh = this.addSpheresInsanced(geometry, material, stations, caveName, surveyName);
    instancedMesh.visible = visibility && sphereOtions.show;
    group.add(instancedMesh);
    return instancedMesh;
  }

  changeStationSpheresRadius(type) {
    let spheres, radius;
    const entries = [...this.#getCaveObjectsFlattened()];
    if (type === ShotType.CENTER) {
      spheres = entries.map((e) => e.centerLinesSpheres);
      radius = this.options.scene.centerLines.spheres.radius;
    } else if (type === ShotType.SPLAY) {
      spheres = entries.map((e) => e.splaysSpheres).filter((x) => x !== undefined);
      radius = this.options.scene.splays.spheres.radius;
    } else if (type === ShotType.AUXILIARY) {
      spheres = entries.map((e) => e.auxiliariesSpheres).filter((x) => x !== undefined);
      radius = this.options.scene.auxiliaries.spheres.radius;
    }
    const geometry = new THREE.SphereGeometry(radius, 5, 5);
    spheres.forEach((s) => {
      s.geometry.dispose();
      s.geometry = geometry;
    });
    this.scene.view.renderView();
  }

  //#endregion

  //#region station labels
  /**
   * Options for 3D labels in three.js

    CSS3DRenderer (HTML overlay)
        Pros: crisp text, easy styling, fixed pixel size, trivial offsets.
        Cons: no automatic occlusion by 3D objects, lots of DOM nodes hurt performance (>300–500), z-order is DOM-based.
        Good for: dozens to a few hundred labels, quick UI, when occlusion isn’t critical.
    WebGL sprites with canvas textures (THREE.Sprite or libraries like three-spritetext)
        Pros: occludes correctly, simple to billboard, OK for a few hundred.
        Cons: each label has its own texture; blurry at varying scales; memory-heavy with many labels.
    Signed-distance-field (SDF/MSDF) text meshes (troika-three-text)
        Pros: crisp at any scale, participates in depth, occludes correctly, good performance, easy billboarding, outlines/shadows.
        Cons: still one mesh per label; very large counts require culling/decluttering.
        Good for: hundreds to a few thousand labels with culling.
    look at addLabel for a 4th option where ShapeGeometry is used to create the text mesh
   */
  addStationLabel(stationLabel, stationName, position, targetGroup) {
    const labelConfig = this.options.scene.stationLabels;
    const labelPosition = position.clone();

    if (labelConfig.offsetDirection === 'up') {
      labelPosition.y += labelConfig.offset; // offset above the station
    } else if (labelConfig.offsetDirection === 'down') {
      labelPosition.y -= labelConfig.offset; // offset below the station
    } else if (labelConfig.offsetDirection === 'left') {
      labelPosition.x -= labelConfig.offset; // offset left of the station
    } else if (labelConfig.offsetDirection === 'right') {
      labelPosition.x += labelConfig.offset; // offset right of the station
    }

    const font = {
      size  : labelConfig.size,
      color : labelConfig.color,
      name  : 'Arial'

    };

    if (labelConfig.stroke) {
      font.strokeColor = labelConfig.strokeColor;
    }

    const textSprite = new TextSprite(
      stationLabel,
      labelPosition,
      font,
      labelConfig.scale,
      `station-label-${stationLabel}`
    );

    const sprite = textSprite.getSprite();
    sprite.userData = {
      label           : stationLabel,
      textSprite,
      stationName,
      stationPosition : position.clone()
    };
    sprite.layers.set(1);

    targetGroup.add(sprite);
  }

  addStationLabels() {
    const mode = this.options.scene.stationLabels.mode;
    this.caveObjects.forEach((surveyEntries, caveName) => {
      const cave = this.db.getCave(caveName);
      surveyEntries.forEach((surveyObject, surveyName) => {
        cave.stations.forEach((station, stationName) => {
          if (station.survey.name === surveyName && station.type !== ShotType.SPLAY) {
            const stationLabel = mode === 'name' ? stationName : station.position.z.toFixed(2);
            this.addStationLabel(stationLabel, stationName, station.position, surveyObject.stationLabels);
          }
        });
      });
    });
  }

  getStationsLabelCount() {
    let count = 0;
    this.caveObjects.forEach((caveObject) => {
      caveObject.forEach((surveyObject) => {
        if (surveyObject.stationLabels) {
          count += surveyObject.stationLabels.children.length;
        }
      });
    });
    return count;
  }

  recreateAllStationLabels() {
    if (!this.options.scene.stationLabels.show) return;
    const mode = this.options.scene.stationLabels.mode;

    this.caveObjects.forEach((caveObject) => {
      caveObject.forEach((surveyObject) => {
        // Store all existing label data
        const labelData = [];

        surveyObject.stationLabels.children.forEach((label) => {
          if (label.userData) {
            labelData.push({
              stationName : label.userData.stationName,
              position    : label.userData.stationPosition.clone()
            });
          }
        });

        // Dispose old labels and clear the group
        surveyObject.stationLabels.children.forEach((label) => {
          if (label.userData && label.userData.textSprite) {
            // Dispose the texture
            if (label.userData.textSprite.sprite.material.map) {
              label.userData.textSprite.sprite.material.map.dispose();
            }

            label.userData.textSprite.sprite.material.dispose();
          }
        });
        surveyObject.stationLabels.clear();

        // Recreate labels with current configuration
        labelData.forEach((data) => {
          const stationLabel = mode === 'name' ? data.stationName : data.position.z.toFixed(2);
          this.addStationLabel(stationLabel, data.stationName, data.position, surveyObject.stationLabels);
        });

      });
    });
  }
  //#endregion

  //#region bounding box

  toogleBoundingBox() {
    this.options.scene.boundingBox.show = !this.options.scene.boundingBox.show;

    if (this.options.scene.boundingBox.show === true) {
      const bb = this.computeBoundingBox();
      if (bb !== undefined) {
        const boundingBoxHelper = new THREE.Box3Helper(bb, 0xffffff);
        this.boundingBoxHelper = boundingBoxHelper;
        this.boundingBoxHelper.layers.set(1);
        this.scene.addObjectToScene(boundingBoxHelper);
      }
    } else {
      if (this.boundingBoxHelper !== undefined) {
        this.scene.removeObjectFromScene(this.boundingBoxHelper);
        this.boundingBoxHelper.dispose();
        this.boundingBoxHelper = undefined;
      }
    }
    this.scene.view.renderView();

  }

  computeBoundingBox() {
    if (this.caveObjects.size > 0) {
      const bb = new THREE.Box3();
      // eslint-disable-next-line no-unused-vars
      this.caveObjects.forEach((sMap, _caveName) => {
        // eslint-disable-next-line no-unused-vars
        sMap.forEach((e, _surveyName) => {
          if (e.centerLines.visible) {
            bb.expandByObject(e.centerLines);
          }
          if (e.splays.visible) {
            bb.expandByObject(e.splays);
          }
        });
      });
      //TODO: move this out from here. with an if || this.surfaceObjects.size > 0
      // eslint-disable-next-line no-unused-vars
      // this.surfaceObjects.forEach((entry, surfaceName) => {
      //   if (entry.cloud.visible) {
      //     bb.expandByObject(entry.cloud);
      //   }
      // });
      return bb;
    } else {
      return undefined;
    }
  }

  //#endregion

  //#region Survey

  setSurveyVisibility(caveName, surveyName, value) {
    const entry = this.caveObjects.get(caveName).get(surveyName);
    const s = this.options.scene;
    entry.centerLines.visible = value && s.centerLines.segments.show;
    entry.centerLines.hidden = !value; // hidden is a custom attribute set by me, used in setObjectsVisibility
    entry.splays.visible = value && s.splays.segments.show;
    entry.splays.hidden = !value;
    entry.auxiliaries.visible = value && s.auxiliaries.segments.show;
    entry.auxiliaries.hidden = !value;
    entry.centerLinesSpheres.visible = value && s.centerLines.spheres.show;
    entry.centerLinesSpheres.hidden = !value;

    if (entry.auxiliariesSpheres) {
      entry.auxiliariesSpheres.visible = value && s.auxiliaries.spheres.show;
      entry.auxiliariesSpheres.hidden = !value;
    }
    if (entry.splaysSpheres) {
      entry.splaysSpheres.visible = value && s.splays.spheres.show;
      entry.splaysSpheres.hidden = !value;
    }
    this.scene.view.renderView();
  }

  getSurveyObjects(survey, cave, polygonSegments, splaySegments, auxiliarySegments, visibility) {

    const geometryStations = new LineSegmentsGeometry();
    geometryStations.setPositions(polygonSegments);
    const splaysGeometry = new LineSegmentsGeometry();
    splaysGeometry.setPositions(splaySegments);
    const auxiliaryGeometry = new LineSegmentsGeometry();
    auxiliaryGeometry.setPositions(auxiliarySegments);

    //We set simple materials here, color mode helper will set the correct materials after
    // this function is called
    const clLineMat = this.mats.segments.centerLine;
    const splayLineMat = this.mats.segments.splay;
    const auxiliaryLineMat = this.mats.segments.auxiliary;

    const lineSegmentsPolygon = new LineSegments2(geometryStations, clLineMat);
    lineSegmentsPolygon.name = `centerline-segments-${cave.name}-${survey.name}`;
    lineSegmentsPolygon.visible = visibility && this.options.scene.centerLines.segments.show;

    const lineSegmentsSplays = new LineSegments2(splaysGeometry, splayLineMat);
    lineSegmentsSplays.name = `splay-segments-${cave.name}-${survey.name}`;
    lineSegmentsSplays.visible = visibility && this.options.scene.splays.segments.show;

    const lineSegmentsAuxiliaries = new LineSegments2(auxiliaryGeometry, auxiliaryLineMat);
    lineSegmentsAuxiliaries.name = `auxiliary-segments-${cave.name}-${survey.name}`;
    lineSegmentsAuxiliaries.visible = visibility && this.options.scene.auxiliaries.segments.show;

    const group = new THREE.Group();
    group.name = `segments-cave-${cave.name}-survey-${survey.name}`;

    group.add(lineSegmentsPolygon);
    group.add(lineSegmentsSplays);
    group.add(lineSegmentsAuxiliaries);

    const stationLabelsGroup = new THREE.Group();
    stationLabelsGroup.name = `station-labels-${cave.name}-${survey.name}`;
    const stationNameMode = this.options.scene.stationLabels.mode;

    const stationsByType = {
      [ShotType.CENTER]    : [],
      [ShotType.SPLAY]     : [],
      [ShotType.AUXILIARY] : []
    };

    for (const [stationName, station] of cave.stations) {
      if (station.survey.name === survey.name) {
        stationsByType[station.type].push({ name: stationName, station });
      }
    }

    const iSpheresCl = this.addStationSpheres(
      this.mats.sphere.centerLine,
      this.options.scene.centerLines.spheres,
      stationsByType[ShotType.CENTER],
      visibility,
      cave.name,
      survey.name,
      group
    );
    const iSpheresSplay = this.addStationSpheres(
      this.mats.sphere.splay,
      this.options.scene.splays.spheres,
      stationsByType[ShotType.SPLAY],
      visibility,
      cave.name,
      survey.name,
      group
    );
    const iSpheresAuxiliary = this.addStationSpheres(
      this.mats.sphere.auxiliary,
      this.options.scene.auxiliaries.spheres,
      stationsByType[ShotType.AUXILIARY],
      visibility,
      cave.name,
      survey.name,
      group
    );

    for (const [stationName, station] of cave.stations) {
      if (station.survey.name !== survey.name) continue; // without this line we would add all stations for each survey
      const stationLabel = stationNameMode === 'name' ? stationName : station.position.z.toFixed(2);
      if (station.type === ShotType.CENTER) {

        // Add station label
        if (this.options.scene.stationLabels.show) {
          // adding sprites for a cave with 3k stations is roughly 25 MB, let's try to save memory by not adding them if they are not visible
          this.addStationLabel(stationLabel, stationName, station.position, stationLabelsGroup);
        }

      } else if (station.type === ShotType.SPLAY) {

        // no station label for splays
      } else if (station.type === ShotType.AUXILIARY) {

        if (this.options.scene.stationLabels.show) {
          this.addStationLabel(stationLabel, stationName, station.position, stationLabelsGroup);
        }
      }
    }
    stationLabelsGroup.visible = visibility && this.options.scene.stationLabels.show;

    group.add(stationLabelsGroup);

    return {
      id                 : U.randomAlphaNumbericString(5),
      centerLines        : lineSegmentsPolygon,
      centerLinesSpheres : iSpheresCl,
      splays             : lineSegmentsSplays,
      splaysSpheres      : iSpheresSplay,
      auxiliaries        : lineSegmentsAuxiliaries,
      auxiliariesSpheres : iSpheresAuxiliary,
      stationLabels      : stationLabelsGroup,
      group              : group
    };
  }

  addSurvey(caveName, surveyName, entry) {

    this.caveObject3DGroup.add(entry.group);

    if (!this.caveObjects.has(caveName)) {
      this.caveObjects.set(caveName, new Map());
    }
    if (this.caveObjects.get(caveName).has(surveyName)) {
      throw new Error(i18n.t('errors.scene.surveyObjectsAlreadyAdded', { caveName, surveyName }));
    }
    this.caveObjects.get(caveName).set(surveyName, entry);

  }

  deleteSurvey(caveName, surveyName) {
    if (this.caveObjects.has(caveName) && this.caveObjects.get(caveName).has(surveyName)) {
      this.caveObjects.get(caveName).delete(surveyName);
    }
  }

  disposeSurvey(caveName, surveyName) {
    if (this.caveObjects.has(caveName) && this.caveObjects.get(caveName).has(surveyName)) {
      const e = this.caveObjects.get(caveName).get(surveyName);
      this.#disposeSurveyObjects(e);
    }
  }

  #disposeSurveyObjects(e) {
    e.centerLines.geometry.dispose();
    e.splays.geometry.dispose();
    e.auxiliaries.geometry.dispose();
    e.centerLinesSpheres?.children?.forEach((c) => c.geometry.dispose()); // all stations spheres use the same geometry
    e.centerLinesSpheres?.clear();
    e.splaysSpheres?.children?.forEach((c) => c.geometry.dispose()); // all stations spheres use the same geometry
    e.splaysSpheres?.clear();
    e.auxiliariesSpheres?.children?.forEach((c) => c.geometry.dispose());
    e.auxiliariesSpheres?.clear();
    e.stationLabels.children.forEach((sprite) => {

      if (sprite.material && sprite.material.map) {
        sprite.material.map.dispose();
      }
      sprite.material.dispose();
      sprite.geometry.dispose();

    });
    e.stationLabels.clear();
    e.group.clear();
    this.caveObject3DGroup.remove(e.group);
  }

  //#endregion

  //#region Cave

  renameCave(oldName, newName) {
    if (this.caveObjects.has(newName)) {
      throw new Error(i18n.t('errors.scene.caveAlreadyExists', { name: newName }));
    }
    const surveyObjects = this.caveObjects.get(oldName);
    this.caveObjects.delete(oldName);
    this.caveObjects.set(newName, surveyObjects);
  }

  renameSurvey(oldName, newName, caveName) {
    const caveObjects = this.caveObjects.get(caveName);
    if (caveObjects.has(newName)) {
      throw new Error(i18n.t('errors.scene.surveyAlreadyExists', { name: newName }));
    }
    const surveyObjects = caveObjects.get(oldName);
    caveObjects.delete(oldName);
    caveObjects.set(newName, surveyObjects);
    this.materials.renameSurvey(oldName, newName, caveName);
  }

  disposeCave(caveName) {
    if (this.caveObjects.has(caveName)) {
      const caveObject = this.caveObjects.get(caveName);
      caveObject.forEach((surveyObject) => {
        this.#disposeSurveyObjects(surveyObject);
      });
    }
  }

  deleteCave(caveName) {
    this.caveObjects.delete(caveName);
  }

  //#endregion

  #getCaveObjectsFlattened() {
    return [...this.caveObjects.values()].filter((c) => c && c.size > 0).flatMap((c) => Array.from(c.values()));
  }
}
