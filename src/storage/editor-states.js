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

import { i18n } from '../i18n/i18n.js';

export class EditorStateSystem {

  constructor(databaseManager) {
    this.storeName = 'surveyEditorStates';
    this.dbManager = databaseManager;
  }

  async saveState(projectId, state, metadata) {
    return new Promise((resolve, reject) => {
      const data = {
        id        : projectId,
        metadata  : metadata,
        state     : state,
        createdAt : new Date().toISOString()
      };

      const request = this.dbManager.getReadWriteStore(this.storeName).put(data);

      request.onsuccess = () => {
        resolve(data);
      };

      request.onerror = () => {
        reject(new Error(i18n.t('errors.storage.editorStates.failedToSaveEditorState')));
      };
    });
  }

  async loadState(projectId) {
    return new Promise((resolve, reject) => {
      const request = this.dbManager.getReadOnlyStore(this.storeName).get(projectId);
      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onerror = () => {
        reject(new Error(i18n.t('errors.storage.editorStates.failedToLoadEditorState')));
      };

    });
  }

  async deleteState(projectId) {
    return new Promise((resolve, reject) => {
      const request = this.dbManager.getReadWriteStore(this.storeName).delete(projectId);
      request.onsuccess = () => {
        resolve();
      };
      request.onerror = () => {
        reject(new Error(i18n.t('errors.storage.editorStates.failedToDeleteEditorState')));
      };
    });
  }
}
