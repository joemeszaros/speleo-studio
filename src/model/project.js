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

export class FatProject {

  constructor(project, caves) {
    this.project = project;
    this.caves = caves;
  }

  toExport() {
    return {
      project : this.project.toExport(),
      caves   : this.caves.map((cave) => cave.toExport())
    };
  }

  static fromPure(pure, attributeDefs) {
    const project = Project.fromPure(pure.project);
    const caves = pure.caves.map((cave) => Cave.fromPure(cave, attributeDefs));
    return new FatProject(project, caves);

  }
}

export class FatProjects {
  constructor(fatProjects) {
    this.projects = fatProjects;
  }

  toExport() {
    return {
      projects : this.projects.map((project) => project.toExport())
    };
  }

  static fromPure(pure, attributeDefs) {
    const projects = pure.projects.map((project) => FatProject.fromPure(project, attributeDefs));
    return new FatProjects(projects);
  }
}

export class DriveProject {

  constructor(project, caves, app, deletedCaveIds = []) {
    this.project = project;
    this.caves = caves;
    this.app = app;
    this.deletedCaveIds = deletedCaveIds;
  }

  toExport() {
    return {
      project        : this.project.toExport(),
      caves          : this.caves.map((cave) => cave.toExport()),
      app            : this.app,
      deletedCaveIds : this.deletedCaveIds
    };
  }

  static fromPure(pure) {
    pure.project = Project.fromPure(pure.project);
    pure.caves = pure.caves.map((cave) => DriveCaveMetadata.fromPure(cave));
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
