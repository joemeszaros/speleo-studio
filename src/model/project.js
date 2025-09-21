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

import { Cave } from './cave.js';

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

export class Project {
  constructor(name, id = null, createdAt = null, updatedAt = null) {
    this.id = id || this.#generateId();
    this.name = name;
    this.createdAt = createdAt || new Date().toISOString();
    this.updatedAt = updatedAt || new Date().toISOString();
    this.description = '';
  }

  #generateId() {
    return 'project_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
  }

  toExport() {
    return {
      id          : this.id,
      name        : this.name,
      createdAt   : this.createdAt,
      updatedAt   : this.updatedAt,
      description : this.description
    };
  }

  static fromPure(pure) {
    return Object.assign(new Project(), pure);
  }
}
