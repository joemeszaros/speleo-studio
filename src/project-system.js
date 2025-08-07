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
  static DEFAULT_PROJECT_STORE_NAME = 'projects';

  constructor(databaseManager, caveSystem) {
    this.storeName = ProjectSystem.DEFAULT_PROJECT_STORE_NAME;
    this.dbManager = databaseManager;
    this.currentProject = null;
    this.caveSystem = caveSystem;
  }

  async createProject(name, description = '') {
    const project = new Project(name);
    project.description = description;
    await this.saveProject(project);
    return project;
  }

  async saveProject(project) {
    return new Promise((resolve, reject) => {

      const request = this.dbManager.getReadWriteStore(this.storeName).put(project.toJSON());

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
      const request = this.dbManager.getReadOnlyStore(this.storeName).get(projectId);
      this.#loadProject(request, resolve, reject, projectId);
    });
  }

  async loadProjectByName(projectName) {
    return new Promise((resolve, reject) => {
      const request = this.dbManager.getReadOnlyStore(this.storeName).index('name').get(projectName);
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
      const request = this.dbManager.getReadOnlyStore(this.storeName).index('name').count(projectName);

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
      const request = this.dbManager.getReadOnlyStore(this.storeName).getAll();

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

  // Cave management methods
  async addCaveToProject(project, cave) {
    if (!project) {
      throw new Error('Project not found');
    }

    // Save cave to cave store
    await this.caveSystem.saveCave(cave, project.id);

    // Add cave ID to project
    project.addCaveId(cave.id);
    await this.saveProject(project);

    return cave;
  }

  async removeCaveFromProject(projectId, caveId) {
    const project = await this.loadProjectById(projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    // Remove cave from cave store
    await this.caveSystem.deleteCave(caveId);

    // Remove cave ID from project
    project.removeCaveId(caveId);
    await this.saveProject(project);
  }

  async getCavesForProject(projectId) {
    return await this.caveSystem.getCavesByProjectId(projectId);
  }

  async getCaveNamesForProject(projectId) {
    return await this.caveSystem.getCaveNamesByProjectId(projectId);
  }

  async saveCaveInProject(projectId, cave) {
    return await this.caveSystem.saveCave(cave, projectId);
  }

  async deleteProject(projectId) {
    // First delete all caves associated with this project
    await this.caveSystem.deleteCavesByProjectId(projectId);

    // Then delete the project
    return new Promise((resolve, reject) => {
      const request = this.dbManager.getReadWriteStore(this.storeName).delete(projectId);

      request.onsuccess = () => {
        resolve();
      };

      request.onerror = () => {
        reject(new Error('Failed to delete project'));
      };
    });
  }
}
