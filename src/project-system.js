import { Project } from './model/project.js';

export class ProjectLoadError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ProjectLoadError';
  }
}

export class ProjectNotFoundError extends Error {
  constructor(projectName) {
    super(`Project ${projectName} not found`);
    this.projectName = projectName;
    this.name = 'ProjectNotFoundError';
  }
}

export class ProjectSystem {

  static DEFAULT_PROJECT_NAME = 'default-project';
  static DEFAULT_DB_NAME = 'SpeleoStudioDB';
  static DEFAULT_PROJECT_STORE_NAME = 'projects';
  static DB_VERSION = 1;

  constructor() {
    this.dbName = ProjectSystem.DEFAULT_DB_NAME;
    this.storeName = ProjectSystem.DEFAULT_PROJECT_STORE_NAME;
    this.dbVersion = ProjectSystem.DB_VERSION;
    this.indexedDb = null;
    this.currentProject = null;
  }

  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onerror = () => {
        reject(new Error('Failed to open IndexedDB'));
      };

      request.onsuccess = () => {
        this.indexedDb = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Create projects store
        if (!db.objectStoreNames.contains(this.storeName)) {
          const store = db.createObjectStore(this.storeName, { keyPath: 'id' });
          store.createIndex('name', 'name', { unique: false });
          store.createIndex('createdAt', 'createdAt', { unique: false });
          store.createIndex('updatedAt', 'updatedAt', { unique: false });
        }
      };
    });
  }

  async createProject(name, description = '') {
    const project = new Project(name);
    project.description = description;
    await this.saveProject(project);
    return project;
  }

  async saveProject(project) {
    return new Promise((resolve, reject) => {

      const request = this.#getStoreRW().put(project.toJSON());

      request.onsuccess = () => {
        resolve(project);
      };

      request.onerror = () => {
        reject(new Error('Failed to save project'));
      };
    });
  }

  async loadProjectOrCreateByName(projectName) {

    return this.loadProjectByName(projectName).catch((error) => {
      if (error instanceof ProjectNotFoundError) {
        console.log(`Project not found, creating new project with name: ${projectName}`);
        return this.createProject(projectName);
      }
      throw error;
    });
  }

  async loadProjectById(projectId) {
    return new Promise((resolve, reject) => {
      const request = this.#getStoreRO().get(projectId);
      this.#loadProject(request, resolve, reject, projectId);
    });
  }

  async loadProjectByName(projectName) {
    return new Promise((resolve, reject) => {
      const request = this.#getStoreRO().index('name').get(projectName);
      this.#loadProject(request, resolve, reject, projectName);
    });
  }

  async #loadProject(request, resolve, reject, idOrName) {
    request.onsuccess = () => {
      if (request.result) {
        const project = Project.fromJSON(request.result);
        resolve(project);
      } else {
        reject(new ProjectNotFoundError(idOrName));
      }
    };

    request.onerror = () => {
      reject(new ProjectLoadError('Failed to load project'));
    };
  }

  async checkProjectExists(projectName) {
    return new Promise((resolve, reject) => {
      const request = this.#getStoreRO().index('name').count(projectName);

      request.onsuccess = () => {
        resolve(request.result > 0);
      };

      request.onerror = () => {
        reject(new Error('Failed to check project existence'));
      };
    });
  }

  async getAllProjects() {
    return new Promise((resolve, reject) => {
      const request = this.#getStoreRO().getAll();

      request.onsuccess = () => {
        const projects = request.result.map((data) => Project.fromJSON(data));
        // Sort by updatedAt (most recent first)
        projects.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
        resolve(projects);
      };

      request.onerror = () => {
        reject(new Error('Failed to load projects'));
      };
    });
  }

  async deleteProject(projectId) {
    return new Promise((resolve, reject) => {
      const request = this.#getStoreRW().delete(projectId);

      request.onsuccess = () => {
        resolve();
      };

      request.onerror = () => {
        reject(new Error('Failed to delete project'));
      };
    });
  }

  #getStoreRW() {
    const transaction = this.indexedDb.transaction([this.storeName], 'readwrite');
    return transaction.objectStore(this.storeName);
  }

  #getStoreRO() {
    const transaction = this.indexedDb.transaction([this.storeName], 'readonly');
    return transaction.objectStore(this.storeName);

  }

  async updateProject(project) {
    project.updatedAt = new Date().toISOString();
    return this.saveProject(project);
  }

  setCurrentProject(project) {
    document.title = `Speleo Studio - ${project.name}`;
    this.currentProject = project;
  }

  getCurrentProject() {
    return this.currentProject;
  }

  async saveCurrentProject() {
    if (this.currentProject) {
      await this.updateProject(this.currentProject);
    }
  }

}
