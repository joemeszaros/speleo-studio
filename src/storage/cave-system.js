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

import { Cave } from '../model/cave.js';
import { i18n } from '../i18n/i18n.js';

export class CaveNotFoundError extends Error {
  constructor(caveName) {
    super(`Cave '${caveName}' not found`);
    this.name = 'CaveNotFoundError';
  }
}

export class CaveSystem {
  constructor(databaseManager, attributeDefs) {
    this.storeName = 'caves';
    this.dbManager = databaseManager;
    this.attributeDefs = attributeDefs;
  }

  async saveCave(cave, projectId) {
    return new Promise((resolve, reject) => {
      const caveData = {
        ...cave.toExport(),
        projectId : projectId,
        createdAt : cave?.createdAt ?? new Date().toISOString(),
        updatedAt : new Date().toISOString()
      };

      const request = this.dbManager.getReadWriteStore(this.storeName).put(caveData);

      request.onsuccess = () => {
        resolve(cave);
      };

      request.onerror = () => {
        reject(new Error(i18n.t('errors.storage.caveSystem.failedToSaveCave')));
      };
    });
  }

  async loadCave(caveId) {
    return new Promise((resolve, reject) => {
      const request = this.dbManager.getReadOnlyStore(this.storeName).get(caveId);
      this.#loadCave(request, resolve, reject, caveId);
    });
  }

  async #loadCave(request, resolve, reject, caveId) {
    request.onsuccess = () => {
      if (request.result) {
        const cave = Cave.fromPure(request.result, this.attributeDefs);
        cave.createdAt = request.result.createdAt;
        cave.updatedAt = request.result.updatedAt;
        resolve(cave);
      } else {
        reject(new CaveNotFoundError(caveId));
      }
    };

    request.onerror = () => {
      reject(new Error(i18n.t('errors.storage.caveSystem.failedToLoadCave')));
    };
  }

  async getCaveIdsByProjectId(projectId) {
    return new Promise((resolve, reject) => {
      const request = this.dbManager.getReadOnlyStore(this.storeName).index('projectId').getAll(projectId);

      request.onsuccess = () => {
        const caveIds = request.result.map((data) => data.id);
        resolve(caveIds);
      };

      request.onerror = () => {
        reject(new Error(i18n.t('errors.storage.caveSystem.failedToLoadCaveNames')));
      };
    });
  }

  async getCaveNamesByProjectId(projectId) {
    return new Promise((resolve, reject) => {
      const request = this.dbManager.getReadOnlyStore(this.storeName).index('projectId').getAll(projectId);

      request.onsuccess = () => {
        const caveNames = request.result.map((data) => data.name);
        resolve(caveNames);
      };

      request.onerror = () => {
        reject(new Error(i18n.t('errors.storage.caveSystem.failedToLoadCaveNames')));
      };
    });
  }

  async getCavesByProjectId(projectId) {
    return new Promise((resolve, reject) => {
      const request = this.dbManager.getReadOnlyStore(this.storeName).index('projectId').getAll(projectId);

      request.onsuccess = () => {
        const caves = request.result.map((data) => {
          const cave = Cave.fromPure(data, this.attributeDefs);
          cave.createdAt = data.createdAt;
          cave.updatedAt = data.updatedAt;
          return cave;
        });
        resolve(caves);
      };

      request.onerror = () => {
        reject(new Error(i18n.t('errors.storage.caveSystem.failedToLoadCaves')));
      };
    });
  }

  async checkCaveExistsById(caveId) {

    return new Promise((resolve, reject) => {
      const request = this.dbManager.getReadOnlyStore(this.storeName).count(caveId);

      request.onsuccess = () => {
        resolve(request.result > 0);
      };

      request.onerror = () => {
        reject(new Error(i18n.t('errors.storage.caveSystem.failedToCheckCaveExistence')));
      };
    });
  }

  async deleteCave(caveId) {
    return new Promise((resolve, reject) => {
      const request = this.dbManager.getReadWriteStore(this.storeName).delete(caveId);

      request.onsuccess = () => {
        resolve();
      };

      request.onerror = () => {
        reject(new Error(i18n.t('errors.storage.caveSystem.failedToDeleteCave')));
      };
    });
  }

  async deleteCavesByProjectId(projectId) {
    return new Promise((resolve, reject) => {
      const request = this.dbManager.getReadOnlyStore(this.storeName).index('projectId').getAllKeys(projectId);

      request.onsuccess = () => {
        const caveIds = request.result;
        if (caveIds.length === 0) {
          resolve();
          return;
        }

        const transaction = this.dbManager.getReadWriteStore(this.storeName);
        let completed = 0;
        let hasError = false;

        caveIds.forEach((caveId) => {
          const deleteRequest = transaction.delete(caveId);

          deleteRequest.onsuccess = () => {
            completed++;
            if (completed === caveIds.length && !hasError) {
              resolve();
            }
          };

          deleteRequest.onerror = () => {
            hasError = true;
            reject(new Error(i18n.t('errors.storage.caveSystem.failedToDeleteCave')));
          };
        });
      };

      request.onerror = () => {
        reject(new Error(i18n.t('errors.storage.caveSystem.failedToGetCavesForDeletion')));
      };
    });
  }
}
