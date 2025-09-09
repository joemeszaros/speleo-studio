import { i18n } from '../i18n/i18n.js';

/**
 * Database manager version history:
 * 1. Initial version
 * 2. Added declinationCache store
 */
export class DatabaseManager {
  constructor() {
    this.dbName = 'SpeleoStudioDB';
    this.dbVersion = 2;
    this.indexedDb = null;
    this.stores = {
      projects : {
        keyPath : 'id',
        indexes : [
          { name: 'name', keyPath: 'name', options: { unique: true } },
          { name: 'createdAt', keyPath: 'createdAt', options: { unique: false } },
          { name: 'updatedAt', keyPath: 'updatedAt', options: { unique: false } }
        ]
      },
      caves : {
        keyPath : 'id',
        indexes : [{ name: 'projectId', keyPath: 'projectId', options: { unique: false } }]
      },
      surveyEditorStates : {
        keyPath : 'id',
        indexes : [{ name: 'projectId', keyPath: 'projectId', options: { unique: false } }]
      },
      declinationCache : {
        keyPath : 'key',
        indexes : [
          { name: 'coordinates', keyPath: ['lat', 'lon'], options: { unique: false } },
          { name: 'cachedAt', keyPath: 'cachedAt', options: { unique: false } }
        ]
      }
    };
  }

  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onerror = () => {
        reject(new Error(i18n.t('errors.storage.databaseManager.failedToOpenIndexedDb')));
      };

      request.onsuccess = () => {
        this.indexedDb = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        console.log('Creating database stores...');
        // Create all stores
        Object.entries(this.stores).forEach(([storeName, config]) => {
          if (!db.objectStoreNames.contains(storeName)) {
            this.createStore(db, storeName, config);
          }
        });
      };
    });
  }

  createStore(db, storeName, config) {
    console.log(`Creating ${storeName} store`);
    const store = db.createObjectStore(storeName, { keyPath: config.keyPath });

    // Create indexes
    config.indexes.forEach((index) => {
      store.createIndex(index.name, index.keyPath, index.options);
    });

  }

  getStore(storeName, mode = 'readonly') {
    if (!this.indexedDb) {
      throw new Error(i18n.t('errors.storage.databaseManager.databaseNotInitialized'));
    }

    if (!this.stores[storeName]) {
      throw new Error(i18n.t('errors.storage.databaseManager.storeNotFound', { storeName }));
    }

    const transaction = this.indexedDb.transaction([storeName], mode);
    return transaction.objectStore(storeName);
  }

  getReadOnlyStore(storeName) {
    return this.getStore(storeName, 'readonly');
  }

  getReadWriteStore(storeName) {
    return this.getStore(storeName, 'readwrite');
  }

  async close() {
    if (this.indexedDb) {
      this.indexedDb.close();
      this.indexedDb = null;
    }
  }
}
