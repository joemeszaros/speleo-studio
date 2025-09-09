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
