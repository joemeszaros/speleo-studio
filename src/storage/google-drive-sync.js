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
import { ModelFile, TextureFile, ModelMetadata } from '../model.js';
import { compressBlobToGzip, decompressGzipToBlob } from '../utils/compression.js';

/**
 * Google Drive synchronization manager
 * Handles syncing of caves and projects between IndexedDB and Google Drive
 */
export class GoogleDriveSync {
  constructor(databaseManager, projectSystem, caveSystem, attributeDefs, modelSystem = null) {
    this.dbManager = databaseManager;
    this.projectSystem = projectSystem;
    this.caveSystem = caveSystem;
    this.attributeDefs = attributeDefs;
    this.modelSystem = modelSystem;
    this.config = new GoogleDriveConfig();
    this.api = new GoogleDriveAPI(this.config);
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
    if (!this.config.isConfigured() || !this.config.hasTokens()) {
      throw new Error('Google Drive not configured or authenticated');
    }

    if (!this.config.hasValidTokens()) {
      this.refreshToken();
    }

    const syncStartedEvent = new CustomEvent('googleDriveSyncStarted');
    document.dispatchEvent(syncStartedEvent);
    try {
      return await op();
    } finally {
      const syncCompletedEvent = new CustomEvent('googleDriveSyncCompleted');
      document.dispatchEvent(syncCompletedEvent);
    }
  }

  getFileName(caveOrProject) {
    return `${caveOrProject.id}.json`;
  }

  getProjectDescription(driveProject) {
    return `Project: ${driveProject.project.name} Revision: ${driveProject.project.revision} App: ${driveProject.app} Email: ${this.config.get('email')}`;
  }

  getCaveDescription(cave, project) {
    return `Project: ${project.name}, Cave: ${cave.name} Revision: ${cave.revision} App: ${this.config.getApp()} Email: ${this.config.get('email')}`;
  }

  async getRevisionInfo(caveOrProject, folderId) {
    return await this.operation(() => this.getRevisionInfoInternal(caveOrProject, folderId));
  }

  async getRevisionInfoInternal(caveOrProject, folderId) {
    const fileName = this.getFileName(caveOrProject);
    const file = await this.api.findFileByName(fileName, folderId);
    if (file === null) {
      return null;
    }
    const revision = parseInt(file?.properties?.revision ?? '-1');
    const app = file?.properties?.app ?? 'unknown';
    // origin revision and app are not stored in properties
    return new RevisionInfo(caveOrProject.id, revision, app, true);
  }

  async uploadProject(driveProject, create = false) {
    return await this.operation(() => this.tryUploadProject(driveProject, create));
  }

  async tryUploadProject(driveProject, create = false) {
    const projectsFolderId = await this.api.getProjectsFolderId();
    const project = driveProject.project;
    const fileName = this.getFileName(project);
    const content = JSON.stringify(driveProject.toExport(), null, 2);
    const description = this.getProjectDescription(driveProject);
    const mimeType = 'application/json';
    const properties = {
      app      : this.config.getApp(),
      revision : project.revision.toString()
    };
    if (!create) {
      const fileId = await this.api.getFileId(fileName, projectsFolderId);
      await this.api.updateFile(fileId, content, mimeType, description, properties);
    } else {
      await this.api.uploadFile(fileName, content, mimeType, projectsFolderId, description, properties);
    }
  }

  async uploadCaveToProject(cave, localProject, revisionInfo) {
    return await this.operation(() => this.uploadCaveToProjectInternal(cave, localProject, revisionInfo));
  }

  async uploadCaveToProjectInternal(cave, localProject, revisionInfo) {
    const cavesFolderId = await this.api.getCavesFolderId();
    const driveRevision = await this.getRevisionInfoInternal(cave, cavesFolderId);
    if (driveRevision !== null) {
      throw new Error('Cave already uploaded to Google Drive');
    }
    const response = await this.fetchProject(localProject);
    const driveProject = response.project;
    driveProject.caves.push(new DriveCaveMetadata(cave.id, cave.name, cave.revision, revisionInfo.app));
    await this.uploadProject(driveProject);
    await this.uploadCave(cave, localProject, true);
  }

  async coordinateUploadCave(cave, localProject, revisionInfo) {
    return await this.operation(() => this.coordinateUploadCaveInternal(cave, localProject, revisionInfo));
  }

  async coordinateUploadCaveInternal(cave, localProject, revisionInfo) {
    const cavesFolderId = await this.api.getCavesFolderId();
    const driveRevision = await this.getRevisionInfoInternal(cave, cavesFolderId);
    if (driveRevision === null) {
      return;
    }

    const hasConflict =
      revisionInfo.originApp !== driveRevision.app && revisionInfo.originRevision !== driveRevision.revision;

    const ignoreConflict = this.config.get('ignoreConflict');

    if (hasConflict && !ignoreConflict) {
      return;
    }

    if (revisionInfo.revision > driveRevision.revision) {
      //we need to update the cave revision
      const response = await this.fetchProject(localProject);
      const project = response.project;
      const updatedCave = project.caves.find((c) => c.id === cave.id);
      updatedCave.revision = revisionInfo.revision;
      updatedCave.app = revisionInfo.app;
      updatedCave.name = cave.name;
      const driveProject = new DriveProject(project.project, project.caves, project.app);
      await this.uploadProject(driveProject);
      await this.uploadCave(cave, localProject);
    }

  }

  async uploadCave(cave, project, create = false) {
    await this.operation(() => this.tryUploadCave(cave, project, create));
  }

  async tryUploadCave(cave, project, create = false) {
    const cavesFolderId = await this.api.getCavesFolderId();
    const fileName = this.getFileName(cave);
    const content = JSON.stringify(cave.toExport());
    // const stream = new Blob([JSON.stringify(cave.toExport())], {
    //   type : 'application/json'
    // }).stream();
    // // gzip stream
    // const compressedReadableStream = stream.pipeThrough(new CompressionStream('gzip'));
    // const compressedResponse = new Response(compressedReadableStream);
    // const blob = await compressedResponse.blob();
    const description = this.getCaveDescription(cave, project);
    const properties = {
      app      : this.config.getApp(),
      revision : cave.revision.toString()
    };
    const mimeType = 'application/json';
    if (!create) {
      const fileId = await this.api.getFileId(fileName, cavesFolderId);
      if (fileId === null) {
        throw new Error(`Cave file ${fileName} not found`);
      }
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
    return await this.operation(() => this.fetchProjectInternal(project));
  }

  async fetchProjectInternal(project) {
    const fileName = this.getFileName(project);
    const projectsFolderId = await this.api.getProjectsFolderId();
    const file = await this.api.findFileByName(fileName, projectsFolderId);
    if (file === null) {
      return null;
    }
    return await this.fetchProjectByFileInternal(file);

  }

  async fetchProjectByFile(file) {
    return await this.operation(() => this.fetchProjectByFileInternal(file));
  }

  async fetchProjectByFileInternal(file) {
    const content = await this.api.downloadFile(file.id);
    return { properties: file.properties, project: DriveProject.fromPure(content) };
  }

  async getCaveOwner(cave) {
    return await this.operation(() => this.getCaveOwnerInternal(cave));
  }

  async getCaveOwnerInternal(cave) {
    const cavesFolderId = await this.api.getCavesFolderId();
    const fileName = this.getFileName(cave);
    const file = await this.api.findFileByName(fileName, cavesFolderId, ['owners']);
    if (file === null) {
      return null;
    }
    return file.owners[0].emailAddress;
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

  // ==================== Model sync ====================

  getModelFileName(modelFileId) {
    return `${modelFileId}.gz`;
  }

  getModelMetadataFileName(modelFileId) {
    return `${modelFileId}.json`;
  }

  getModelDescription(metadata, project) {
    return `Model: ${metadata.name} Project: ${project.name} App: ${this.config.getApp()} Email: ${this.config.get('email')}`;
  }

  async uploadModelFile(modelFile, project) {
    return await this.operation(async () => {
      const folderId = await this.api.getModelFilesFolderId();
      const fileName = this.getModelFileName(modelFile.id);
      const existing = await this.api.findFileByName(fileName, folderId);
      if (existing) return;
      const blob = await compressBlobToGzip(modelFile.data);
      const description = this.getModelDescription({ name: modelFile.filename }, project);
      await this.api.uploadFile(fileName, blob, 'application/gzip', folderId, description, {
        app : this.config.getApp()
      });
    });
  }

  async uploadTextureFile(textureFile, project) {
    return await this.operation(async () => {
      const folderId = await this.api.getTextureFilesFolderId();
      const fileName = this.getModelFileName(textureFile.id);
      const existing = await this.api.findFileByName(fileName, folderId);
      if (existing) return;
      const blob = await compressBlobToGzip(textureFile.data);
      const description = `Texture: ${textureFile.filename} App: ${this.config.getApp()} Email: ${this.config.get('email')}`;
      await this.api.uploadFile(fileName, blob, 'application/gzip', folderId, description, {
        app : this.config.getApp()
      });
    });
  }

  async uploadModelMetadata(metadata, revisionInfo, project, create = false) {
    return await this.operation(async () => {
      const folderId = await this.api.getModelMetadataFolderId();
      const fileName = this.getModelMetadataFileName(metadata.modelFileId);
      const content = JSON.stringify({ id: metadata.id, modelFileId: metadata.modelFileId, ...metadata.toExport() });
      const description = this.getModelDescription(metadata, project);
      const properties = { app: this.config.getApp(), revision: revisionInfo.revision.toString() };
      if (create) {
        await this.api.uploadFile(fileName, content, 'application/json', folderId, description, properties);
      } else {
        const fileId = await this.api.getFileId(fileName, folderId);
        if (!fileId) {
          await this.api.uploadFile(fileName, content, 'application/json', folderId, description, properties);
        } else {
          await this.api.updateFile(fileId, content, 'application/json', description, properties);
        }
      }
    });
  }

  async uploadModelSettings(settings, modelFileId, revisionInfo, project, create = false) {
    return await this.operation(async () => {
      const folderId = await this.api.getModelSettingsFolderId();
      const fileName = this.getModelMetadataFileName(modelFileId);
      const content = JSON.stringify(settings);
      const description = `Settings for model ${modelFileId} Project: ${project.name} App: ${this.config.getApp()}`;
      const properties = { app: this.config.getApp(), revision: revisionInfo.revision.toString() };
      if (create) {
        await this.api.uploadFile(fileName, content, 'application/json', folderId, description, properties);
      } else {
        const fileId = await this.api.getFileId(fileName, folderId);
        if (!fileId) {
          await this.api.uploadFile(fileName, content, 'application/json', folderId, description, properties);
        } else {
          await this.api.updateFile(fileId, content, 'application/json', description, properties);
        }
      }
    });
  }

  async fetchModelFile(modelFileId) {
    return await this.operation(async () => {
      const folderId = await this.api.getModelFilesFolderId();
      const fileName = this.getModelFileName(modelFileId);
      const file = await this.api.findFileByName(fileName, folderId);
      if (!file) return null;
      const compressedBlob = await this.api.downloadFileAsBlob(file.id);
      const dataBlob = await decompressGzipToBlob(compressedBlob);
      const modelFile = new ModelFile('', '', dataBlob);
      modelFile.id = modelFileId;
      return modelFile;
    });
  }

  async fetchTextureFile(textureFileId, modelFileId) {
    return await this.operation(async () => {
      const folderId = await this.api.getTextureFilesFolderId();
      const fileName = this.getModelFileName(textureFileId);
      const file = await this.api.findFileByName(fileName, folderId);
      if (!file) return null;
      const compressedBlob = await this.api.downloadFileAsBlob(file.id);
      const dataBlob = await decompressGzipToBlob(compressedBlob);
      const textureFile = new TextureFile(modelFileId, '', '', dataBlob);
      textureFile.id = textureFileId;
      return textureFile;
    });
  }

  async fetchModelMetadata(modelFileId) {
    return await this.operation(async () => {
      const folderId = await this.api.getModelMetadataFolderId();
      const fileName = this.getModelMetadataFileName(modelFileId);
      const file = await this.api.findFileByName(fileName, folderId);
      if (!file) return null;
      const content = await this.api.downloadFile(file.id);
      return { properties: file.properties, metadata: ModelMetadata.fromPure(content) };
    });
  }

  async fetchModelSettings(modelFileId) {
    return await this.operation(async () => {
      const folderId = await this.api.getModelSettingsFolderId();
      const fileName = this.getModelMetadataFileName(modelFileId);
      const file = await this.api.findFileByName(fileName, folderId);
      if (!file) return null;
      const content = await this.api.downloadFile(file.id);
      return { properties: file.properties, settings: content };
    });
  }

  async getModelDriveRevisions(modelFileId) {
    return await this.operation(async () => {
      const [metaFile, settingsFile] = await Promise.all([
        this.api.findFileByName(this.getModelMetadataFileName(modelFileId), await this.api.getModelMetadataFolderId()),
        this.api.findFileByName(this.getModelMetadataFileName(modelFileId), await this.api.getModelSettingsFolderId())
      ]);
      return {
        metadataRevision : metaFile ? parseInt(metaFile.properties?.revision ?? '0') : null,
        metadataApp      : metaFile?.properties?.app ?? null,
        settingsRevision : settingsFile ? parseInt(settingsFile.properties?.revision ?? '0') : null,
        settingsApp      : settingsFile?.properties?.app ?? null
      };
    });
  }

  async deleteModelFromDrive(modelFileId, textureIds = []) {
    return await this.operation(async () => {
      const [modelFilesFolderId, textureFilesFolderId, metadataFolderId, settingsFolderId] = await Promise.all([
        this.api.getModelFilesFolderId(),
        this.api.getTextureFilesFolderId(),
        this.api.getModelMetadataFolderId(),
        this.api.getModelSettingsFolderId()
      ]);

      const deleteIfExists = async (fileName, folderId) => {
        const file = await this.api.findFileByName(fileName, folderId);
        if (file) await this.api.deleteFile(file.id);
      };

      await deleteIfExists(this.getModelFileName(modelFileId), modelFilesFolderId);
      await deleteIfExists(this.getModelMetadataFileName(modelFileId), metadataFolderId);
      await deleteIfExists(this.getModelMetadataFileName(modelFileId), settingsFolderId);
      for (const textureId of textureIds) {
        await deleteIfExists(this.getModelFileName(textureId), textureFilesFolderId);
      }
    });
  }

  disconnect() {
    this.config.clearTokens();
    console.log('Disconnected from Google Drive');
  }
}
