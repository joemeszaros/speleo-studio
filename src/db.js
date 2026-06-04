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

import { i18n } from './i18n/i18n.js';
import { formatDistance, sanitizeName, bareStationName } from './utils/utils.js';

class Database {

  constructor() {
    this.caves = new Map();
    this.pointClouds = new Map();
    this.meshes = new Map();
  }

  deleteSurvey(caveName, surveyName) {
    if (this.caves.has(caveName)) {
      const cave = this.caves.get(caveName);
      const survey = cave.surveys.find((s) => s.name === surveyName);
      const indexToDelete = cave.surveys.indexOf(survey);
      if (indexToDelete !== -1) {
        cave.surveys.splice(indexToDelete, 1);
      }
    }
  }

  /**
   * Returns all the surveys for all caves
   * @returns {Array[Survey]} Surveys of all caves
   */
  getAllSurveys() {
    return [...this.caves.values()].flatMap((c) => c.getAllSurveys());
  }

  getCavesMap() {
    return this.caves;
  }

  getAllCaves() {
    return [...this.caves.values()];
  }

  getStationNames(caveName, filter = () => true) {
    const cave = this.caves.get(caveName);
    if (!cave) return [];
    return [...cave.getAllStations()]
      .filter(([_, value]) => filter(value))
      .map(([key]) => key);
  }

  // Lists every station for the locate panel. Each entry has:
  //   key  – the internal station-map key (survey-qualified for multi-survey caves), used to
  //          locate the exact point;
  //   name – the bare station name to display;
  //   cave – the TOP-level cave name (the db key);
  //   path – the full breadcrumb of cave→…→survey names that own the station, so stations are
  //          distinguishable and searchable by sub-cave / survey name (e.g. "rural").
  //   splay – true when the station is a splay endpoint (callers may filter these out).
  getAllStationNameDetails() {
    const stNames = [];
    for (const c of this.caves.values()) {
      for (const [key, station] of c.getAllStations()) {
        const survey = station.survey;
        // Full chain topCave → …sub-caves… → survey (getSurveyNamePath already includes the
        // survey name as its last element).
        const namePath = survey ? c.getSurveyNamePath(survey) : [c.name];
        stNames.push({
          key,
          name  : bareStationName(key),
          cave  : c.name,
          path  : namePath.join(' / '),
          splay : station.isSplay?.() ?? false
        });
      }
    }
    return stNames.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  getAllCaveNames() {
    return [...this.caves.keys()];
  }

  getSurvey(caveName, surveyName) {
    if (this.caves.has(caveName)) {
      // Search the whole nested tree; names are unique within a parent, so the first
      // match is the intended one for top-level callers (editors operate per cave node).
      return this.caves
        .get(caveName)
        .getAllSurveys()
        .find((s) => s.name === surveyName);
    } else {
      return undefined;
    }
  }

  // Resolve a survey by its stable unique id (scene/colormode key it by id since survey
  // names are not unique across the nested tree).
  getSurveyById(caveName, surveyId) {
    return this.caves
      .get(caveName)
      ?.getAllSurveys()
      .find((s) => s.id === surveyId);
  }

  addCave(cave) {
    this.caves.set(cave.name, cave);
  }

  getCave(caveName) {
    return this.caves.get(caveName);
  }

  getCaveById(caveId) {
    return this.caves.values().find((c) => c.id === caveId);
  }

  hasCave(caveName) {
    return this.caves.has(caveName);
  }

  renameCave(oldName, newName) {
    newName = sanitizeName(newName);
    if (this.caves.has(newName)) {
      throw new Error(i18n.t('errors.db.caveAlreadyExists', { name: newName }));
    }
    const cave = this.caves.get(oldName);
    cave.name = newName;
    this.caves.delete(oldName);
    this.caves.set(newName, cave);
  }

  renameSurvey(cave, oldName, newName) {
    newName = sanitizeName(newName);
    // Operate on the passed cave object directly: `cave` may be a nested SUB-cave, and the
    // `caves` map is keyed only by top-level cave names, so a name lookup (getSurvey by cave.name)
    // would miss and wrongly throw "survey does not exist" when renaming a survey in a sub-cave.
    const surveys = cave.getAllSurveys();
    const survey = surveys.find((s) => s.name === oldName);
    if (survey === undefined) {
      throw new Error(i18n.t('errors.db.surveyDoesNotExist', { name: oldName }));
    }
    if (surveys.some((s) => s !== survey && s.name === newName)) {
      throw new Error(i18n.t('errors.db.surveyAlreadyExists', { name: newName }));
    }
    survey.name = newName;
  }

  getPointCloud(name) {
    return this.pointClouds.get(name);
  }

  addPointCloud(pointCloud) {
    if (this.pointClouds.has(pointCloud.name)) {
      throw new Error(i18n.t('errors.db.pointCloudAlreadyAdded', { name: pointCloud.name }));
    }
    this.pointClouds.set(pointCloud.name, pointCloud);
  }

  getMesh(name) {
    return this.meshes.get(name);
  }

  addMesh(mesh) {
    if (this.meshes.has(mesh.name)) {
      throw new Error(i18n.t('errors.db.meshAlreadyAdded', { name: mesh.name }));
    }
    this.meshes.set(mesh.name, mesh);
  }

  getAllModels() {
    return new Map([...this.pointClouds, ...this.meshes]);
  }

  getAllModelNames() {
    return [...this.pointClouds.keys(), ...this.meshes.keys()];
  }

  hasModel(name) {
    return this.pointClouds.has(name) || this.meshes.has(name);
  }

  getModel(name) {
    return this.pointClouds.get(name) ?? this.meshes.get(name);
  }

  deleteModel(name) {
    this.pointClouds.delete(name);
    this.meshes.delete(name);
  }

  renameModel(oldName, newName) {
    newName = sanitizeName(newName);
    if (this.hasModel(newName)) {
      throw new Error(i18n.t('errors.db.modelAlreadyExists', { name: newName }));
    }
    if (this.pointClouds.has(oldName)) {
      const model = this.pointClouds.get(oldName);
      model.name = newName;
      this.pointClouds.delete(oldName);
      this.pointClouds.set(newName, model);
    } else if (this.meshes.has(oldName)) {
      const model = this.meshes.get(oldName);
      model.name = newName;
      this.meshes.delete(oldName);
      this.meshes.set(newName, model);
    }
  }

  /**
   * Get all coordinate systems from caves and models.
   * @returns {Array<{name: string, type: string, coordinateSystem: Object}>}
   */
  getAllCoordinateSystems() {
    const result = [];
    this.caves.forEach((c) => {
      if (c.geoData?.coordinateSystem) {
        result.push({ name: c.name, type: 'cave', coordinateSystem: c.geoData.coordinateSystem });
      }
    });
    this.getAllModels().forEach((m) => {
      if (m.geoData?.coordinateSystem) {
        result.push({ name: m.name, type: 'model', coordinateSystem: m.geoData.coordinateSystem });
      }
    });
    return result;
  }

  /**
   * Check if a coordinate is too far from existing caves and models.
   * @param {Object} coordinate - Coordinate with distanceTo method
   * @param {string} skipName - Name of the entity being edited (to skip self)
   * @param {number} maxDistance - Maximum allowed distance in meters
   * @returns {string[]} Array of names that are too far, with distance info
   */
  getFarEntities(coordinate, skipName, maxDistance) {
    if (!coordinate || !maxDistance) return [];

    const farEntities = [];

    // Check caves
    this.caves.forEach((cave) => {
      if (cave.name === skipName) return;
      const caveCoord = cave.geoData?.coordinates?.[0]?.coordinate;
      if (!caveCoord) return;
      const distance = coordinate.distanceTo(caveCoord);
      if (distance > maxDistance) {
        farEntities.push(`${cave.name} - ${formatDistance(distance, 0)}`);
      }
    });

    // Check models
    this.getAllModels().forEach((model) => {
      if (model.name === skipName) return;
      // Raster overlays (DTMs / orthophotos) carry a corner reference point
      // but their actual footprint can span tens of km — skip the
      // point-to-point distance check or it falsely rejects
      if (model.modelKind === 'dtm' || model.modelKind === 'orthophoto') return;
      const modelCoord = model.geoData?.coordinates?.[0]?.coordinate;
      if (!modelCoord) return;
      const distance = coordinate.distanceTo(modelCoord);
      if (distance > maxDistance) {
        farEntities.push(`${model.name} - ${formatDistance(distance, 0)}`);
      }
    });

    return farEntities;
  }

  deleteCave(caveName) {
    if (this.caves.has(caveName)) {
      this.caves.delete(caveName);
    }
  }

  clear() {
    this.caves.clear();
    this.pointClouds.clear();
    this.meshes.clear();
  }

  // Reorders a survey within its OWNING cave node's surveys array. `ownerCave` is the cave
  // (possibly a nested sub-cave) that directly contains the survey, and `survey` is the
  // Survey object itself — matched by identity, since survey names are not unique across a
  // nested tree.
  reorderSurvey(ownerCave, survey, newIndex) {
    if (!ownerCave || !survey) return false;
    const surveyIndex = ownerCave.surveys.indexOf(survey);
    if (surveyIndex !== -1 && newIndex >= 0 && newIndex < ownerCave.surveys.length) {
      ownerCave.surveys.splice(surveyIndex, 1);
      ownerCave.surveys.splice(newIndex, 0, survey);
      return true;
    }
    return false;
  }

}

export { Database };
