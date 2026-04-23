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
import { TextureFile, ModelFile, ModelMetadata, Model } from '../model.js';
import { RevisionInfo } from '../model/misc.js';

/**
 * ModelSystem - Manages 3D model files and their assets in IndexedDB
 * Handles storage and retrieval of PLY, OBJ, MTL, and texture files
 */
export class ModelSystem {

  static MODEL_FILES_STORE = 'modelFiles';
  static MODEL_FILE_SETTINGS_STORE = 'modelFileSettings';
  static MODEL_METADATA_STORE = 'modelMetadata';
  static TEXTURE_FILES_STORE = 'textureFiles';
  static OCTREE_CACHE_STORE = 'octreeCache';

  constructor(databaseManager, revisionStore = null) {
    this.dbManager = databaseManager;
    this.revisionStore = revisionStore;
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

    // Delete associated metadata
    await this.deleteModelMetadataByModelFileId(id).catch(() => {});

    // Delete cached octree data
    await this.deleteOctreeCache(id).catch(() => {});

    // Delete revision tracking entries
    if (this.revisionStore) {
      await this.revisionStore.deleteRevision(`${id}_meta`).catch(() => {});
      await this.revisionStore.deleteRevision(`${id}_settings`).catch(() => {});
    }

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

  // ==================== Model Metadata ====================

  /**
   * Save model metadata (coordinate/geo information)
   * @param {string} projectId - Project ID
   * @param {ModelMetadata} metadata - The metadata object
   */
  async saveModelMetadata(projectId, metadata) {
    const record = {
      ...metadata,
      projectId,
      updatedAt : new Date().toISOString()
    };

    await new Promise((resolve, reject) => {
      const store = this.dbManager.getReadWriteStore(ModelSystem.MODEL_METADATA_STORE);
      const request = store.put(record);
      request.onsuccess = () => resolve(metadata.id);
      request.onerror = () => reject(new Error('Failed to save model metadata'));
    });

    if (this.revisionStore) {
      await this.#bumpRevision(`${metadata.modelFileId}_meta`);
    }

    return metadata.id;
  }

  /**
   * Get model metadata by model file ID
   * @param {string} modelFileId - The model file ID
   * @returns {Promise<ModelMetadata|null>}
   */
  async getModelMetadataByModelFileId(modelFileId) {
    return new Promise((resolve, reject) => {
      const store = this.dbManager.getReadOnlyStore(ModelSystem.MODEL_METADATA_STORE);
      const index = store.index('modelFileId');
      const request = index.get(modelFileId);
      request.onsuccess = () => {
        resolve(request.result ? ModelMetadata.fromPure(request.result) : null);
      };
      request.onerror = () => reject(new Error('Failed to load model metadata'));
    });
  }

  /**
   * Get all model metadata for a project
   * @param {string} projectId - The project ID
   * @returns {Promise<Array<ModelMetadata>>}
   */
  async getModelMetadataByProject(projectId) {
    return new Promise((resolve, reject) => {
      const store = this.dbManager.getReadOnlyStore(ModelSystem.MODEL_METADATA_STORE);
      const index = store.index('projectId');
      const request = index.getAll(projectId);
      request.onsuccess = () => resolve((request.result || []).map(ModelMetadata.fromPure));
      request.onerror = () => reject(new Error('Failed to load model metadata'));
    });
  }

  /**
   * Delete model metadata by model file ID
   * @param {string} modelFileId - The model file ID
   */
  async deleteModelMetadataByModelFileId(modelFileId) {
    if (modelFileId === null || modelFileId === undefined || modelFileId === '') {
      throw new Error(i18n.t('errors.storage.modelSystem.idRequired'));
    }

    const metadata = await this.getModelMetadataByModelFileId(modelFileId);
    if (!metadata) return;

    return new Promise((resolve, reject) => {
      const store = this.dbManager.getReadWriteStore(ModelSystem.MODEL_METADATA_STORE);
      const request = store.delete(metadata.id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error('Failed to delete model metadata'));
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

    await new Promise((resolve, reject) => {
      const store = this.dbManager.getReadWriteStore(ModelSystem.MODEL_FILE_SETTINGS_STORE);
      const request = store.put(record);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error('Failed to save model file settings'));
    });

    if (this.revisionStore) {
      await this.#bumpRevision(`${id}_settings`);
    }
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

  /**
   * Get all models marked for export (embedded) for a project as Model instances.
   * @param {string} projectId - The project ID
   * @returns {Promise<Array<Model>>} Array of Model instances
   */
  async getModelsForExport(projectId) {
    const allMetadata = await this.getModelMetadataByProject(projectId);
    const exportable = allMetadata.filter((m) => m.embedded);
    if (exportable.length === 0) return [];

    const result = [];

    for (const metadata of exportable) {
      try {
        const modelFile = await this.getModelFile(metadata.modelFileId);
        if (!modelFile) continue;

        const textures = await this.getTextureFilesByModel(metadata.modelFileId);
        let settings = null;
        try {
          settings = await this.getModelFileSettings(metadata.modelFileId);
        } catch (e) {
          /* no settings */
        }

        result.push(new Model(metadata, modelFile, textures, settings));
      } catch (err) {
        console.error(`Failed to export model ${metadata.name}:`, err);
      }
    }

    return result;
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

  // ==================== Octree Cache ====================

  /**
   * Save cached octree data for a LAS/LAZ model file.
   * @param {string} modelFileId - The model file ID
   * @param {string} projectId - The project ID
   * @param {Object} data - { nodes, header, hasColors, totalPoints, displayedPoints, nodeCount, maxPoints }
   */
  async saveOctreeCache(modelFileId, projectId, data) {
    const record = {
      modelFileId,
      projectId,
      ...data,
      createdAt : new Date().toISOString()
    };

    return new Promise((resolve, reject) => {
      const store = this.dbManager.getReadWriteStore(ModelSystem.OCTREE_CACHE_STORE);
      const request = store.put(record);
      request.onsuccess = () => {
        console.log(`💾 Octree cache saved for model: ${modelFileId}`);
        resolve();
      };
      request.onerror = () => reject(new Error('Failed to save octree cache'));
    });
  }

  /**
   * Get cached octree data for a model file.
   * @param {string} modelFileId - The model file ID
   * @returns {Promise<Object|null>} The cached octree record or null
   */
  async getOctreeCache(modelFileId) {
    return new Promise((resolve, reject) => {
      const store = this.dbManager.getReadOnlyStore(ModelSystem.OCTREE_CACHE_STORE);
      const request = store.get(modelFileId);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(new Error('Failed to load octree cache'));
    });
  }

  async #bumpRevision(key) {
    const existing = await this.revisionStore.loadRevision(key);
    if (existing) {
      existing.revision += 1;
      existing.synced = false;
      await this.revisionStore.saveRevision(existing);
    } else {
      await this.revisionStore.saveRevision(new RevisionInfo(key, 1, 'local', false, 'local', 0));
    }
  }

  /**
   * Delete cached octree data for a model file.
   * @param {string} modelFileId - The model file ID
   */
  async deleteOctreeCache(modelFileId) {

    if (modelFileId === null || modelFileId === undefined || modelFileId === '') {
      throw new Error(i18n.t('errors.storage.modelSystem.idRequired'));
    }

    return new Promise((resolve, reject) => {
      const store = this.dbManager.getReadWriteStore(ModelSystem.OCTREE_CACHE_STORE);
      const request = store.delete(modelFileId);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error('Failed to delete octree cache'));
    });
  }

}
