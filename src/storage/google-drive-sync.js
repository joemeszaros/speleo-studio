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

import { GoogleDriveConfig } from './google-drive-config.js';
import { GoogleDriveAPI } from './google-drive-api.js';
import { LightProject } from '../model/project.js';

/**
 * Google Drive synchronization manager
 * Handles syncing of caves and projects between IndexedDB and Google Drive
 */
export class GoogleDriveSync {
  constructor(databaseManager, projectSystem, caveSystem) {
    this.dbManager = databaseManager;
    this.projectSystem = projectSystem;
    this.caveSystem = caveSystem;
    this.config = new GoogleDriveConfig();
    this.api = new GoogleDriveAPI(this.config);
    this.isSyncing = false;
  }

  /**
   * Check if Google Drive sync is configured and ready
   * @returns {boolean} True if ready for sync
   */
  isReady() {
    return this.config.isConfigured() && this.config.hasValidTokens();
  }

  async refreshToken() {
    if (this.config.isConfigured() && !this.config.hasValidTokens()) {
      console.log('Refresh access tokens');
      const tokenResponse = await this.api.refreshAccessToken();
      this.config.setTokens(tokenResponse.access_token, this.config.get('refreshToken'), tokenResponse.expires_in);

    }
  }

  /**
   * Get authorization URL for OAuth2 flow
   * @returns {string} Authorization URL
   */
  getAuthorizationURL() {
    return this.api.getAuthorizationURL();
  }

  /**
   * Complete OAuth2 flow with authorization code
   * @param {string} code - Authorization code
   * @returns {Promise<void>}
   */
  async completeAuthorization(code) {
    try {
      const tokenResponse = await this.api.exchangeCodeForTokens(code);
      this.config.setTokens(tokenResponse.access_token, tokenResponse.refresh_token, tokenResponse.expires_in);

      // Test the connection by getting folder IDs
      await this.api.getMainFolderId();

      const email = await this.api.getUserEmail();
      console.log('User email:', email);
      this.config.set('email', email);
      console.log('Google Drive authorization completed successfully');
    } catch (error) {
      console.error('Google Drive authorization failed:', error);
      throw error;
    }
  }

  /**
   * Sync all projects to Google Drive
   * @returns {Promise<void>}
   */
  async syncProjects() {
    if (!this.isReady()) {
      throw new Error('Google Drive not configured or authenticated');
    }

    if (this.isSyncing) {
      throw new Error('Sync already in progress');
    }

    this.isSyncing = true;
    try {
      this.syncProjectsInternal();
    } finally {
      this.isSyncing = false;
    }
  }

  async syncProjectsInternal() {

    console.log('Starting project sync to Google Drive...');

    const projects = await this.projectSystem.getAllProjects();
    const projectsFolderId = await this.api.getProjectsFolderId();

    for (const project of projects) {
      await this.trySyncProject(project, projectsFolderId);
    }

    this.config.set('lastSync', new Date().toISOString());
    console.log('Project sync completed successfully');
  }

  async trySyncProject(project, projectsFolderId) {
    if (!this.isReady()) {
      return;
    }

    const revPlusApp = await this.getRevision(project, projectsFolderId);
    console.log(`revision and app for ${project.name} is`, revPlusApp);
    //TODO: handle missing files
    // if (revPlusApp === null) {
    //   console.log(`File ${cave.name} doens't exist, return`);
    //   return;
    // }
    if (revPlusApp !== null) {
      if (project.revision === revPlusApp.revision && revPlusApp.app === this.config.getApp()) {
        console.log(`File ${project.name} has the same revision and app, return`);
        return;
      }

      if (project.revision < revPlusApp.revision) {
        //manage conflicts
        console.log(`File ${project.name} has a higher revision, return`);
        return;
      }
    }

    await this.syncProject(project, projectsFolderId, this.getProjectDescription(project), {
      app      : this.config.getApp(),
      revision : project.revision.toString(),
      email    : this.config.get('email')
    });
  }
  /**
   * Sync a single project to Google Drive
   * @param {Project} project - Project to sync
   * @param {string} projectsFolderId - Projects folder ID
   * @returns {Promise<void>}
   */
  async syncProject(project, projectsFolderId, description, properties) {
    const fileName = this.getFileName(project);
    const caveIds = await this.caveSystem.getCaveIdsByProjectId(project.id);
    const lightProject = new LightProject(project, caveIds);
    const content = JSON.stringify(lightProject.toExport(), null, 2);

    try {
      // Upload or update file (preserves revision history)
      await this.api.uploadOrUpdateFile(
        fileName,
        content,
        'application/json',
        projectsFolderId,
        description,
        properties
      );
      console.log(`Synced project: ${project.name}`);
    } catch (error) {
      console.error(`Failed to sync project ${project.name}:`, error);
      throw error;
    }
  }

  /**
   * Sync all caves to Google Drive
   * @returns {Promise<void>}
   */
  async syncCaves() {
    if (!this.isReady()) {
      throw new Error('Google Drive not configured or authenticated');
    }

    if (this.isSyncing) {
      throw new Error('Sync already in progress');
    }

    this.isSyncing = true;

    try {
      this.syncCavesInternal();
    } finally {
      this.isSyncing = false;
    }
  }

  async syncCavesInternal() {
    console.log('Starting cave sync to Google Drive...');

    const projects = await this.projectSystem.getAllProjects();

    for (const project of projects) {
      const caves = await this.caveSystem.getCavesByProjectId(project.id);

      for (const cave of caves) {
        await this.trySyncCave(cave, project);
      }
    }

    this.config.set('lastSync', new Date().toISOString());
    console.log('Cave sync completed successfully');
  }

  getFileName(caveOrProject) {
    return `${caveOrProject.id}.json`;
  }

  getProjectDescription(project) {
    return `Project: ${project.name} Revision: ${project.revision}`;
  }

  getCaveDescription(cave, project) {
    return `Project: ${project.name}, Cave: ${cave.name} Revision: ${cave.revision} App: ${this.config.getApp()} Email: ${this.config.get('email')}`;
  }

  async getRevision(caveOrProject, folderId) {
    const fileName = this.getFileName(caveOrProject);
    const file = await this.api.findFileByName(fileName, folderId);
    if (file === null) {
      return null;
    }
    const revision = parseInt(file?.properties?.revision ?? '-1');
    const app = file?.properties?.app ?? '';
    return { revision, app };
  }

  async trySyncCave(cave, project, allowCreate = true) {
    if (!this.isReady()) {
      return;
    }

    const cavesFolderId = await this.api.getCavesFolderId();

    const revPlusApp = await this.getRevision(cave, cavesFolderId);
    console.log(`revision and app for ${cave.name} is`, revPlusApp);

    if (revPlusApp === null && !allowCreate) {
      console.log(`File ${cave.name} doens't exist, return`);
      return;
    }

    if (revPlusApp !== null) {
      if (cave.revision === revPlusApp.revision && revPlusApp.app === this.config.getApp()) {
        console.log(`File ${cave.name} has the same revision and app, return`);
        return;
      }

      if (cave.revision < revPlusApp.revision) {
        //manage conflicts
        console.log(`File ${cave.name} has a higher revision, return`);
        return;
      }
    }

    await this.syncCave(cave, project, cavesFolderId, this.getCaveDescription(cave, project), {
      app      : this.config.getApp(),
      revision : cave.revision.toString(),
      email    : this.config.get('email')
    });
  }

  /**
   * Sync a single cave to Google Drive
   * @param {Cave} cave - Cave to sync
   * @param {Project} project - Project the cave belongs to
   * @param {string} cavesFolderId - Caves folder name
   * @returns {Promise<void>}
   */
  async syncCave(cave, project, cavesFolderId, description, properties) {
    const fileName = this.getFileName(cave);
    const content = JSON.stringify(cave.toExport(), null, 2);

    try {
      // Upload or update file (preserves revision history)
      await this.api.uploadOrUpdateFile(fileName, content, 'application/json', cavesFolderId, description, properties);
      console.log(`Synced cave: ${cave.name} from project ${project.name}`);
    } catch (error) {
      console.error(`Failed to sync cave ${cave.name}:`, error);
      throw error;
    }
  }

  /**
   * Sync all data to Google Drive
   * @returns {Promise<void>}
   */
  async syncAll() {
    if (!this.isReady()) {
      throw new Error('Google Drive not configured or authenticated');
    }

    if (this.isSyncing) {
      throw new Error('Sync already in progress');
    }

    this.isSyncing = true;

    try {
      console.log('Starting full sync to Google Drive...');

      // Sync projects first
      await this.syncProjectsInternal();

      // Then sync caves
      await this.syncCavesInternal();

      this.config.set('lastSync', new Date().toISOString());
      console.log('Full sync completed successfully');
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Restore projects from Google Drive
   * @returns {Promise<void>}
   */
  async restoreProjects() {
    if (!this.isReady()) {
      throw new Error('Google Drive not configured or authenticated');
    }

    if (this.isSyncing) {
      throw new Error('Sync already in progress');
    }

    this.isSyncing = true;

    try {
      console.log('Starting project restore from Google Drive...');

      const projectsFolderId = await this.api.getProjectsFolderId();
      const files = await this.api.listFiles(projectsFolderId);

      for (const file of files) {
        if (file.name.endsWith('.json')) {
          await this.restoreProject(file.id, file.name);
        }
      }

      console.log('Project restore completed successfully');
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Restore a single project from Google Drive
   * @param {string} fileId - File ID
   * @param {string} fileName - File name
   * @returns {Promise<void>}
   */
  async restoreProject(fileId, fileName) {
    try {
      const content = await this.api.downloadFile(fileId);
      const lightProject = LightProject.fromPure(JSON.parse(content));
      const projectData = lightProject.project;

      // Check if project already exists
      const existingProject = await this.projectSystem.loadProjectById(projectData.id).catch(() => null);

      if (existingProject) {
        // Update existing project
        existingProject.name = projectData.name;
        existingProject.description = projectData.description;
        existingProject.updatedAt = new Date().toISOString();
        await this.projectSystem.saveProject(existingProject);
        console.log(`Restored project: ${projectData.name}`);
      } else {
        // Create new project
        const project = this.projectSystem.constructor.fromPure(projectData);
        await this.projectSystem.saveProject(project);
        console.log(`Restored project: ${projectData.name}`);
      }
    } catch (error) {
      console.error(`Failed to restore project ${fileName}:`, error);
      throw error;
    }
  }

  /**
   * Restore caves from Google Drive
   * @returns {Promise<void>}
   */
  async restoreCaves() {
    if (!this.isReady()) {
      throw new Error('Google Drive not configured or authenticated');
    }

    if (this.isSyncing) {
      throw new Error('Sync already in progress');
    }

    this.isSyncing = true;

    try {
      console.log('Starting cave restore from Google Drive...');

      const cavesFolderId = await this.api.getCavesFolderId();
      const files = await this.api.listFiles(cavesFolderId);

      for (const file of files) {
        if (file.name.endsWith('.json')) {
          await this.restoreCave(file.id, file.name);
        }
      }

      console.log('Cave restore completed successfully');
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Restore a single cave from Google Drive
   * @param {string} fileId - File ID
   * @param {string} fileName - File name
   * @returns {Promise<void>}
   */
  async restoreCave(fileId, fileName) {
    try {
      const content = await this.api.downloadFile(fileId);
      const caveData = JSON.parse(content);

      // Extract project name from filename (format: projectName_caveName.json)
      const projectName = fileName.split('_')[0];
      const project = await this.projectSystem.loadProjectByName(projectName);

      if (!project) {
        console.warn(`Project ${projectName} not found for cave ${caveData.name}`);
        return;
      }

      // Check if cave already exists
      const existingCave = await this.caveSystem.loadCave(caveData.id).catch(() => null);

      if (existingCave) {
        // Update existing cave
        const updatedCave = this.caveSystem.constructor.fromPure(caveData);
        await this.caveSystem.saveCave(updatedCave, project.id);
        console.log(`Restored cave: ${caveData.name}`);
      } else {
        // Create new cave
        const cave = this.caveSystem.constructor.fromPure(caveData);
        await this.caveSystem.saveCave(cave, project.id);
        console.log(`Restored cave: ${caveData.name}`);
      }
    } catch (error) {
      console.error(`Failed to restore cave ${fileName}:`, error);
      throw error;
    }
  }

  /**
   * Restore all data from Google Drive
   * @returns {Promise<void>}
   */
  async restoreAll() {
    if (!this.isReady()) {
      throw new Error('Google Drive not configured or authenticated');
    }

    if (this.isSyncing) {
      throw new Error('Sync already in progress');
    }

    this.isSyncing = true;

    try {
      console.log('Starting full restore from Google Drive...');

      // Restore projects first
      await this.restoreProjects();

      // Then restore caves
      await this.restoreCaves();

      console.log('Full restore completed successfully');
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Get sync status
   * @returns {Object} Sync status information
   */
  getSyncStatus() {
    return {
      isConfigured   : this.config.isConfigured(),
      hasValidTokens : this.config.hasValidTokens(),
      isSyncing      : this.isSyncing,
      lastSync       : this.config.get('lastSync'),
      autoSync       : this.config.get('autoSync')
    };
  }

  /**
   * Disconnect from Google Drive
   */
  disconnect() {
    this.config.clearTokens();
    console.log('Disconnected from Google Drive');
  }
}
