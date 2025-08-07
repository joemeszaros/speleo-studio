export class DatabaseManager {
  constructor() {
    this.dbName = 'SpeleoStudioDB';
    this.dbVersion = 1;
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
      }
    };
  }

  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onerror = () => {
        reject(new Error('Failed to open IndexedDB'));
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
            console.log(`Creating ${storeName} store`);
            const store = db.createObjectStore(storeName, { keyPath: config.keyPath });

            // Create indexes
            config.indexes.forEach((index) => {
              store.createIndex(index.name, index.keyPath, index.options);
            });
          }
        });
      };
    });
  }

  getStore(storeName, mode = 'readonly') {
    if (!this.indexedDb) {
      throw new Error('Database not initialized');
    }

    if (!this.stores[storeName]) {
      throw new Error(`Store '${storeName}' not found`);
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
