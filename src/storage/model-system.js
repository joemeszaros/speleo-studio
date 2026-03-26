/*
 * Copyright 2026 Joe Meszaros
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

import { i18n } from '../i18n/i18n.js';
import { TextureFile, ModelFile } from '../model.js';

/**
 * ModelSystem - Manages 3D model files and their assets in IndexedDB
 * Handles storage and retrieval of PLY, OBJ, MTL, and texture files
 */
export class ModelSystem {

  static MODEL_FILES_STORE = 'modelFiles';
  static TEXTURE_FILES_STORE = 'textureFiles';

  constructor(databaseManager) {
    this.dbManager = databaseManager;
  }

  async saveModelFile(projectId, modelFile) {
    if (modelFile.data instanceof Blob === false) {
      throw new Error('Data must be a Blob');
    }

    const record = {
      ...modelFile,
      projectId,
      createdAt : new Date().toISOString(),
      updatedAt : new Date().toISOString()
    };

    return new Promise((resolve, reject) => {
      const store = this.dbManager.getReadWriteStore(ModelSystem.MODEL_FILES_STORE);
      const request = store.put(record);
      request.onsuccess = () => {
        console.log(`💾 Model file saved: ${modelFile.filename}`);
        resolve(modelFile.id);
      };
      request.onerror = () => {
        reject(new Error(i18n.t('errors.storage.modelSystem.failedToSaveModelFile')));
      };
    });
  }

  /**
   * Get a model file by ID
   * @param {string} id - Model file ID
   * @returns {Promise<Object|null>} The model file record or null
   */
  async getModelFile(id) {
    return new Promise((resolve, reject) => {
      const store = this.dbManager.getReadOnlyStore(ModelSystem.MODEL_FILES_STORE);
      const request = store.get(id);
      request.onsuccess = () => resolve(ModelFile.fromPure(request.result));
      request.onerror = () => {
        reject(new Error(i18n.t('errors.storage.modelSystem.failedToLoadModelFile')));
      };
    });
  }

  /**
   * Get all model files for a project
   * @param {string} projectId - The project ID
   * @returns {Promise<Array>} Array of model file records
   */
  async getModelFilesByProject(projectId) {
    return new Promise((resolve, reject) => {
      const store = this.dbManager.getReadOnlyStore(ModelSystem.MODEL_FILES_STORE);
      const index = store.index('projectId');
      const request = index.getAll(projectId);
      request.onsuccess = () => resolve(request.result.map(ModelFile.fromPure) || []);
      request.onerror = () => {
        reject(new Error(i18n.t('errors.storage.modelSystem.failedToLoadModelFiles')));
      };
    });
  }

  async saveTextureFile(projectId, textureFile) {

    const record = {
      ...textureFile,
      projectId,
      createdAt : new Date().toISOString(),
      updatedAt : new Date().toISOString()
    };

    return new Promise((resolve, reject) => {
      const store = this.dbManager.getReadWriteStore(ModelSystem.TEXTURE_FILES_STORE);
      const request = store.put(record);
      request.onsuccess = () => {
        console.log(`💾 Texture file saved: ${textureFile.filename}`);
        resolve(textureFile.id);
      };
      request.onerror = () => {
        reject(new Error(i18n.t('errors.storage.modelSystem.failedToSaveTextureFile')));
      };
    });
  }

  async getTextureFilesByModel(modelId) {
    return new Promise((resolve, reject) => {
      const store = this.dbManager.getReadOnlyStore(ModelSystem.TEXTURE_FILES_STORE);
      const index = store.index('modelId');
      const request = index.getAll(modelId);
      request.onsuccess = () => resolve(request.result.map(TextureFile.fromPure) || []);
      request.onerror = () => {
        reject(new Error(i18n.t('errors.storage.modelSystem.failedToLoadTextureFiles')));
      };
    });
  }

}
