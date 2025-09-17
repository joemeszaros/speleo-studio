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
    this.caveIds = []; // Array of cave names (IDs)
  }

  #generateId() {
    return 'project_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
  }

  addCaveId(caveId) {
    if (caveId && !this.caveIds.includes(caveId)) {
      this.caveIds.push(caveId);
      this.updatedAt = new Date().toISOString();
    }
  }

  removeCaveId(caveId) {
    const index = this.caveIds.indexOf(caveId);
    if (index !== -1) {
      this.caveIds.splice(index, 1);
      this.updatedAt = new Date().toISOString();
    }
  }

  getCaveIds() {
    return [...this.caveIds];
  }

  toExport() {
    return {
      id          : this.id,
      name        : this.name,
      createdAt   : this.createdAt,
      updatedAt   : this.updatedAt,
      caveIds     : this.caveIds,
      description : this.description
    };
  }

  static fromPure(pure) {
    return Object.assign(new Project(), pure);
  }
}
