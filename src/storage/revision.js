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

import { RevisionInfo } from '../model/misc.js';
import { i18n } from '../i18n/i18n.js';

export class RevisionStore {

  constructor(databaseManager) {
    this.storeName = 'revisions';
    this.dbManager = databaseManager;
  }

  async loadRevision(id) {

    return new Promise((resolve, reject) => {
      const request = this.dbManager.getReadOnlyStore(this.storeName).get(id);

      request.onsuccess = () => {
        const result = request.result;
        if (result) {
          resolve(RevisionInfo.fromPure(result));
        } else {
          resolve(null);
        }
      };

      request.onerror = () => {
        console.error('Error reading from revisions:', request.error);
        reject(request.error);
      };
    });
  }

  async saveRevision(revInfo) {

    return new Promise((resolve, reject) => {
      const request = this.dbManager.getReadWriteStore(this.storeName).put(revInfo.toExport());

      request.onsuccess = () => {
        resolve();
      };

      request.onerror = () => {
        console.error('Error writing revisions:', request.error);
        reject(request.error);
      };
    });
  }

  async deleteRevision(id) {
    if (id === null || id === undefined) {
      throw new Error(i18n.t('errors.storage.revisionStore.revisionIdRequired'));
    }
    return new Promise((resolve, reject) => {
      const request = this.dbManager.getReadWriteStore(this.storeName).delete(id);
      request.onsuccess = () => {
        resolve();
      };
      request.onerror = () => {
        console.error('Error deleting revisions:', request.error);
        reject(request.error);
      };
    });
  }

}
