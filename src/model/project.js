import { Cave } from './cave.js';
import { Database } from '../db.js';

export class Project {
  constructor(name, id = null, createdAt = null, updatedAt = null, db = new Database()) {
    this.db = db;
    this.id = id || this.generateId();
    this.name = name;
    this.createdAt = createdAt || new Date().toISOString();
    this.updatedAt = updatedAt || new Date().toISOString();
    this.description = '';
  }

  generateId() {
    return 'project_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  addCave(cave) {
    if (cave) {
      this.db.addCave(cave);
    }
    this.updatedAt = new Date().toISOString();
  }

  deleteCave(caveName) {
    this.db.deleteCave(caveName);
    this.updatedAt = new Date().toISOString();
  }

  getAllCaves() {
    return this.db.getAllCaves();
  }

  toJSON() {
    return {
      id          : this.id,
      name        : this.name,
      createdAt   : this.createdAt,
      updatedAt   : this.updatedAt,
      caves       : this.db.getAllCaves().map((c) => c.toExport()),
      description : this.description
    };
  }

  static fromJSON(data) {
    const project = new Project(data.name, data.id, data.createdAt, data.updatedAt);
    project.description = data.description || '';

    if (data.caves) {
      data.caves
        .map((c) => Cave.fromPure(c))
        .forEach((c) => {
          project.addCave(c);
        });
    }

    return project;
  }
}
