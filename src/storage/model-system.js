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
  static MODEL_FILE_SETTINGS_STORE = 'modelFileSettings';
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

  /**
   * Delete a model file and all associated data (textures, settings)
   * @param {string} id - Model file ID
   */
  async deleteModelFile(id) {
    if (id === null || id === undefined || id === '') {
      throw new Error(i18n.t('errors.storage.modelSystem.idRequired'));
    }

    // Delete the model file itself
    await new Promise((resolve, reject) => {
      const store = this.dbManager.getReadWriteStore(ModelSystem.MODEL_FILES_STORE);
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error(i18n.t('errors.storage.modelSystem.failedToDeleteModelFile')));
    });

    // Delete associated texture files
    await this.deleteTextureFilesByModel(id);

    // Delete associated settings
    await this.deleteModelFileSettings(id).catch(() => {});

    console.log(`🗑️ Model file deleted: ${id}`);
  }

  /**
   * Delete all texture files associated with a model
   * @param {string} modelId - The model file ID
   */
  async deleteTextureFilesByModel(modelId) {
    if (modelId === null || modelId === undefined || modelId === '') {
      throw new Error(i18n.t('errors.storage.modelSystem.idRequired'));
    }

    const textures = await this.getTextureFilesByModel(modelId);
    for (const texture of textures) {
      await new Promise((resolve, reject) => {
        const store = this.dbManager.getReadWriteStore(ModelSystem.TEXTURE_FILES_STORE);
        const request = store.delete(texture.id);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(new Error(i18n.t('errors.storage.modelSystem.failedToDeleteTextureFile')));
      });
    }
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

  // ==================== Model File Settings ====================

  /**
   * Save or update model file settings (transform, opacity, visibility)
   * @param {string} id - Model file ID (same as modelFiles record)
   * @param {string} projectId - Project ID
   * @param {Object} properties - { transform, opacity, visible }
   */
  async saveModelFileSettings(id, projectId, properties) {
    const record = {
      id,
      projectId,
      ...properties,
      updatedAt : new Date().toISOString()
    };

    return new Promise((resolve, reject) => {
      const store = this.dbManager.getReadWriteStore(ModelSystem.MODEL_FILE_SETTINGS_STORE);
      const request = store.put(record);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error('Failed to save model file settings'));
    });
  }

  /**
   * Get model file settings by ID
   * @param {string} id - Model file ID
   * @returns {Promise<Object|null>} The settings record or null
   */
  async getModelFileSettings(id) {
    return new Promise((resolve, reject) => {
      const store = this.dbManager.getReadOnlyStore(ModelSystem.MODEL_FILE_SETTINGS_STORE);
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(new Error('Failed to load model file settings'));
    });
  }

  /**
   * Delete model file settings
   * @param {string} id - Model file ID
   */
  async deleteModelFileSettings(id) {
    if (id === null || id === undefined || id === '') {
      throw new Error(i18n.t('errors.storage.modelSystem.idRequired'));
    }

    return new Promise((resolve, reject) => {
      const store = this.dbManager.getReadWriteStore(ModelSystem.MODEL_FILE_SETTINGS_STORE);
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error('Failed to delete model file settings'));
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
