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
import { DriveProject } from '../model/project.js';
import { Cave, DriveCaveMetadata } from '../model/cave.js';
import { RevisionInfo } from '../model/misc.js';

/**
 * Google Drive synchronization manager
 * Handles syncing of caves and projects between IndexedDB and Google Drive
 */
export class GoogleDriveSync {
  constructor(databaseManager, projectSystem, caveSystem, attributeDefs) {
    this.dbManager = databaseManager;
    this.projectSystem = projectSystem;
    this.caveSystem = caveSystem;
    this.attributeDefs = attributeDefs;
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

  async operation(op) {
    if (!this.isReady()) {
      throw new Error('Google Drive not configured or authenticated');
    }

    if (this.isSyncing) {
      throw new Error('Sync already in progress');
    }

    this.isSyncing = true;

    const syncStartedEvent = new CustomEvent('googleDriveSyncStarted');
    document.dispatchEvent(syncStartedEvent);
    try {
      return await op();
    } finally {
      this.isSyncing = false;
      const syncCompletedEvent = new CustomEvent('googleDriveSyncCompleted');
      document.dispatchEvent(syncCompletedEvent);
    }
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

  async getRevisionInfo(caveOrProject, folderId) {
    const fileName = this.getFileName(caveOrProject);
    const file = await this.api.findFileByName(fileName, folderId);
    if (file === null) {
      return null;
    }
    const revision = parseInt(file?.properties?.revision ?? '-1');
    const app = file?.properties?.app ?? 'unknown';
    const reason = file?.properties?.reason ?? 'unknown';
    return new RevisionInfo(caveOrProject.id, revision, app, reason);
  }

  /**
   * Sync all projects to Google Drive
   * @returns {Promise<void>}
   */
  async uploadProjects() {
    await this.operation(this.uploadProjectsInternal);
  }

  async uploadProjectsInternal() {

    const projects = await this.projectSystem.getAllProjects();

    for (const project of projects) {
      await this.tryUploadProject(project);
    }

    this.config.set('lastSync', new Date().toISOString());
  }

  async uploadProject(project, revisionInfo = null, cavesMetadata = null) {
    return await this.operation(() => this.tryUploadProject(project, revisionInfo, cavesMetadata));
  }

  async tryUploadProject(project, revisionInfo = null, cavesMetadata = null) {
    const projectsFolderId = await this.api.getProjectsFolderId();
    const revInfo = revisionInfo ?? (await this.getRevisionInfo(project, projectsFolderId));

    const fileName = this.getFileName(project);
    const cavesWithIdRev =
      cavesMetadata ?? (await this.caveSystem.getCaveFieldsByProjectId(project.id, ['id', 'revision', 'name']));
    const driveProject = new DriveProject(
      project,
      cavesWithIdRev.map((cave) => new DriveCaveMetadata(cave.id, cave.name, cave.revision ?? 1)),
      this.config.getApp()
    );
    const content = JSON.stringify(driveProject.toExport(), null, 2);
    const description = this.getProjectDescription(project);
    const properties = {
      app      : this.config.getApp(),
      revision : project.revision.toString(),
      email    : this.config.get('email'),
      reason   : revInfo === undefined ? 'create' : (revInfo?.reason ?? 'unknown')
    };

    const mimeType = 'application/json';
    if (revInfo !== null) {
      const fileId = await this.api.getFileId(fileName, projectsFolderId);
      await this.api.updateFile(fileId, content, mimeType, description, properties);
    } else {
      await this.api.uploadFile(fileName, content, mimeType, projectsFolderId, description, properties);
    }
    return { properties, project: driveProject };

  }

  /**
   * Sync all caves to Google Drive
   * @returns {Promise<void>}
   */
  async uploadCaves() {
    await this.operation(this.uploadCavesInternal);
  }

  async coordinateUploadCave(cave, project, revisionInfo) {
    const cavesFolderId = await this.api.getCavesFolderId();
    const driveRevision = this.getRevisionInfo(cave, cavesFolderId);
    if (driveRevision === null) {
      return;
    }

    if (revisionInfo.revision < driveRevision.revision) {
      console.log(
        `Cave ${cave.name} has a lower revision (${revisionInfo.revision} < ${driveRevision.revision}), return`
      );
      return;
    }

    if (revisionInfo.revision === driveRevision.revision) {
      if (revisionInfo.app === driveRevision.app) {
        console.log(`Cave ${cave.name} has the same revision and app, return`);
        return;
      } else {
        console.log(`Cave ${cave.name} has the same revision but different app, return`);
        return;
      }

    }

    await this.uploadCave(cave, project, false, revisionInfo);
    return;
  }

  async uploadCave(cave, project, create = true, revisionInfo = null) {
    await this.operation(() => this.tryUploadCave(cave, project, create, revisionInfo));
  }

  async tryUploadCave(cave, project, create = true, revisionInfo = null) {
    const cavesFolderId = await this.api.getCavesFolderId();

    const revInfo = revisionInfo ?? (await this.getRevisionInfo(cave, cavesFolderId));

    if (revInfo === null && !create) {
      return;
    }

    const fileName = this.getFileName(cave);
    const content = JSON.stringify(cave.toExport(), null, 2);
    const description = this.getCaveDescription(cave, project);
    const properties = {
      app      : this.config.getApp(),
      revision : cave.revision.toString(),
      email    : this.config.get('email'),
      reason   : revInfo === undefined ? 'create' : (revInfo?.reason ?? 'unknown')
    };
    const mimeType = 'application/json';
    if (revInfo !== null) {
      const fileId = await this.api.getFileId(fileName, cavesFolderId);
      await this.api.updateFile(fileId, content, mimeType, description, properties);
    } else {
      await this.api.uploadFile(fileName, content, mimeType, cavesFolderId, description, properties);
    }

  }

  /**
   * Restore projects from Google Drive
   * @returns {Promise<void>}
   */
  async listProjects() {
    return await this.operation(() => this.listProjectsInternal());
  }

  async listProjectsInternal() {
    const projectsFolderId = await this.api.getProjectsFolderId();
    return await this.api
      .listFiles(projectsFolderId)
      .then((files) => files.filter((file) => file.name.endsWith('.json')));
  }

  async fetchCave(cave) {
    return await this.operation(() => this.fetchCaveInternal(cave));
  }

  async fetchCaveInternal(cave) {
    const fileName = this.getFileName(cave);
    const cavesFolderId = await this.api.getCavesFolderId();
    const file = await this.api.findFileByName(fileName, cavesFolderId);
    if (file === null) {
      return null;
    }
    const content = await this.api.downloadFile(file.id);
    return { properties: file.properties, cave: Cave.fromPure(content, this.attributeDefs) };
  }

  async fetchProject(project) {
    const fileName = this.getFileName(project);
    const projectsFolderId = await this.api.getProjectsFolderId();
    const file = await this.api.findFileByName(fileName, projectsFolderId);
    if (file === null) {
      return null;
    }
    return await this.fetchProjectByFileUInternal(file);

  }

  async fetchProjectByFile(file) {
    return await this.operation(() => this.fetchProjectByFileUInternal(file));
  }

  async fetchProjectByFileUInternal(file) {
    const content = await this.api.downloadFile(file.id);
    return { properties: file.properties, project: DriveProject.fromPure(content) };
  }

  async deleteProject(project) {
    await this.operation(() => this.deleteProjectInternal(project));
  }

  async deleteProjectInternal(project) {
    const projectsFolderId = await this.api.getProjectsFolderId();
    const fileName = this.getFileName(project);
    const file = await this.api.findFileByName(fileName, projectsFolderId);
    if (file === null) {
      return null;
    }
    await this.api.deleteFile(file.id);
  }

  async deleteCave(cave) {
    await this.operation(() => this.deleteCaveInternal(cave));
  }

  async deleteCaveInternal(cave) {
    const fileName = this.getFileName(cave);
    const cavesFolderId = await this.api.getCavesFolderId();
    const file = await this.api.findFileByName(fileName, cavesFolderId);
    if (file === null) {
      return null;
    }
    await this.api.deleteFile(file.id);
  }

  disconnect() {
    this.config.clearTokens();
    console.log('Disconnected from Google Drive');
  }
}
