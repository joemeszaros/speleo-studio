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

import { Project } from '../model/project.js';
import { i18n } from '../i18n/i18n.js';

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

      console.log(`💾 Saving project ${project.id}`);
      const request = this.dbManager.getReadWriteStore(this.storeName).put(project.toExport());

      request.onsuccess = () => {
        resolve(project);
      };

      request.onerror = () => {
        reject(new Error(i18n.t('errors.storage.projectSystem.failedToSaveProject')));
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
        const project = Project.fromPure(request.result);
        resolve(project);
      } else {
        reject(new ProjectNotFoundError(idOrName));
      }
    };

    request.onerror = () => {
      reject(new ProjectLoadError('Failed to load project'));
    };
  }

  async checkProjectExistsById(projectId) {
    return new Promise((resolve, reject) => {
      const request = this.dbManager.getReadOnlyStore(this.storeName).count(projectId);

      request.onsuccess = () => {
        resolve(request.result > 0);
      };

      request.onerror = () => {
        reject(new Error(i18n.t('errors.storage.projectSystem.failedToCheckProjectExistence')));
      };
    });
  }

  async checkProjectExistsByName(projectName) {
    return new Promise((resolve, reject) => {
      const request = this.dbManager.getReadOnlyStore(this.storeName).index('name').count(projectName);

      request.onsuccess = () => {
        resolve(request.result > 0);
      };

      request.onerror = () => {
        reject(new Error(i18n.t('errors.storage.projectSystem.failedToCheckProjectExistence')));
      };
    });
  }

  async getAllProjects() {
    return new Promise((resolve, reject) => {
      const request = this.dbManager.getReadOnlyStore(this.storeName).getAll();

      request.onsuccess = () => {
        const projects = request.result.map((data) => Project.fromPure(data));
        // Sort by updatedAt (most recent first)
        projects.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
        resolve(projects);
      };

      request.onerror = () => {
        reject(new Error(i18n.t('errors.storage.projectSystem.failedToLoadProjects')));
      };
    });
  }

  async updateProject(project) {
    project.updatedAt = new Date().toISOString();
    return this.saveProject(project);
  }

  clearCurrentProject() {
    this.currentProject = null;
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
      throw new Error(i18n.t('errors.storage.projectSystem.projectNotFound'));
    }

    await this.caveSystem.saveCave(cave, project.id);
    await this.saveProject(project);

    return cave;
  }

  async removeCaveFromProject(projectId, caveId) {
    const project = await this.loadProjectById(projectId);
    if (!project) {
      throw new Error(i18n.t('errors.storage.projectSystem.projectNotFound'));
    }
    await this.caveSystem.deleteCave(caveId);
    await this.saveProject(project);
  }

  async getCavesForProject(projectId) {
    return await this.caveSystem.getCavesByProjectId(projectId);
  }

  async getCaveNamesForProject(projectId) {
    return await this.caveSystem.getCaveNamesByProjectId(projectId);
  }

  async saveCaveInProject(projectId, cave) {
    console.log(`💾 Saving cave ${cave.name} in project ${projectId}`);
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

      request.onerror = (e) => {
        console.error('Failed to delete project', e);
        reject(new Error(i18n.t('errors.storage.projectSystem.failedToDeleteProject')));
      };
    });
  }
}
