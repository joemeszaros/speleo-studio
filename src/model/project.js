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

import { Cave, DriveCaveMetadata } from './cave.js';
import { Model } from '../model.js';
import { compressToGzip, decompressGzip, isGzipped } from '../utils/compression.js';

export class DriveModelMetadata {
  constructor(id, name, metadataRevision, metadataApp, settingsRevision, settingsApp) {
    this.id = id;
    this.name = name;
    this.metadataRevision = metadataRevision;
    this.metadataApp = metadataApp;
    this.settingsRevision = settingsRevision;
    this.settingsApp = settingsApp;
  }

  toExport() {
    return {
      id               : this.id,
      name             : this.name,
      metadataRevision : this.metadataRevision,
      metadataApp      : this.metadataApp,
      settingsRevision : this.settingsRevision,
      settingsApp      : this.settingsApp
    };
  }

  static fromPure(pure) {
    return Object.assign(new DriveModelMetadata(), pure);
  }
}

export class FatProject {

  constructor(project, caves, models) {
    this.project = project;
    this.caves = caves;
    this.models = models;
  }

  hasModels() {
    return this.models.length > 0;
  }

  async toExport() {
    const exported = {
      project : this.project.toExport(),
      caves   : this.caves.map((cave) => cave.toExport())
    };
    if (this.hasModels()) {
      exported.models = await Promise.all(this.models.map((m) => m.toExport()));
    }
    return exported;
  }

  /**
   * Serialize to a Blob. Uses gzip compression if models are present.
   * @returns {Promise<{blob: Blob, compressed: boolean}>}
   */
  async serialize() {
    const data = await this.toExport();
    const jsonString = JSON.stringify(data, null, 2);
    if (this.hasModels()) {
      return { blob: await compressToGzip(jsonString), compressed: true };
    }
    return { blob: new Blob([jsonString], { type: 'application/json' }), compressed: false };
  }

  /**
   * Deserialize from a File/Blob. Handles both plain JSON and gzip.
   * @param {File|Blob} file
   * @param {AttributesDefinitions} attributeDefs
   * @returns {Promise<FatProject>}
   */
  static async deserialize(file, attributeDefs) {
    let text;
    if (await isGzipped(file)) {
      text = await decompressGzip(file);
    } else {
      text = await file.text();
    }
    const pure = JSON.parse(text);
    if (pure.projects !== undefined) {
      return FatProjects.fromPure(pure, attributeDefs);
    }
    return FatProject.fromPure(pure, attributeDefs);
  }

  static fromPure(pure, attributeDefs) {
    const project = Project.fromPure(pure.project);
    const caves = pure.caves.map((cave) => Cave.fromPure(cave, attributeDefs));
    const models = (pure.models || []).map(Model.fromPure);
    return new FatProject(project, caves, models);
  }
}

export class FatProjects {
  constructor(fatProjects) {
    this.projects = fatProjects;
  }

  hasModels() {
    return this.projects.some((p) => p.hasModels());
  }

  async toExport() {
    return {
      projects : await Promise.all(this.projects.map((project) => project.toExport()))
    };
  }

  /**
   * Serialize to a Blob. Uses gzip compression if any project has models.
   * @returns {Promise<{blob: Blob, compressed: boolean}>}
   */
  async serialize() {
    const data = await this.toExport();
    const jsonString = JSON.stringify(data, null, 2);
    if (this.hasModels()) {
      return { blob: await compressToGzip(jsonString), compressed: true };
    }
    return { blob: new Blob([jsonString], { type: 'application/json' }), compressed: false };
  }

  static fromPure(pure, attributeDefs) {
    const projects = pure.projects.map((project) => FatProject.fromPure(project, attributeDefs));
    return new FatProjects(projects);
  }
}

export class DriveProject {

  constructor(project, caves, app, deletedCaveIds = [], models = []) {
    this.project = project;
    this.caves = caves;
    this.app = app;
    this.deletedCaveIds = deletedCaveIds;
    this.models = models;
  }

  toExport() {
    return {
      project        : this.project.toExport(),
      caves          : this.caves.map((cave) => cave.toExport()),
      app            : this.app,
      deletedCaveIds : this.deletedCaveIds,
      models         : this.models.map((m) => m.toExport())
    };
  }

  static fromPure(pure) {
    pure.project = Project.fromPure(pure.project);
    pure.caves = pure.caves.map((cave) => DriveCaveMetadata.fromPure(cave));
    pure.models = (pure.models || []).map((m) => DriveModelMetadata.fromPure(m));
    return Object.assign(new DriveProject(), pure);
  }
}

export class Project {
  constructor(name, id = null, revision = 1, createdAt = null, updatedAt = null) {
    this.id = id || Project.generateId();
    this.revision = revision;
    this.name = name;
    this.createdAt = createdAt || new Date().toISOString();
    this.updatedAt = updatedAt || new Date().toISOString();
    this.description = '';
  }

  static generateId() {
    return 'project_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
  }

  toExport() {
    return {
      id          : this.id,
      revision    : this.revision,
      name        : this.name,
      createdAt   : this.createdAt,
      updatedAt   : this.updatedAt,
      description : this.description
    };
  }

  static fromPure(pure) {
    if (pure.revision === undefined) {
      pure.revision = 1;
    }
    return Object.assign(new Project(), pure);
  }
}
