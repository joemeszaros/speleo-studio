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

import { showErrorPanel } from '../ui/popups.js';
import { i18n } from '../i18n/i18n.js';

class Importer {

  constructor(db, options, scene, manager) {
    this.db = db;
    this.options = options;
    this.scene = scene;
    this.manager = manager;
  }

  async importFile(file, name, onLoadFn, endcoding = 'utf8') {
    if (!file) {
      return;
    }

    const reader = new FileReader();
    const nameToUse = name ?? file.name;
    const errorMessage = i18n.t('errors.import.importFileFailed', {
      name : nameToUse.substring(nameToUse.lastIndexOf('/') + 1)
    });

    await new Promise((resolve, reject) => {
      reader.onload = async (event) => {
        try {
          await this.importText(event.target.result, onLoadFn, name);
          resolve();
        } catch (e) {
          reject(e);
        }
      };

      reader.onerror = (error) => {
        console.error(errorMessage, error);
        showErrorPanel(`${errorMessage}: ${error}`, 0);
        reject(error);
      };

      reader.readAsText(file, endcoding);
    });
  }

  async importFileAsArrayBuffer(file, name, onLoadFn) {
    if (!file) {
      return;
    }

    const reader = new FileReader();
    const nameToUse = name ?? file.name;
    const errorMessage = i18n.t('errors.import.importFileFailed', {
      name : nameToUse.substring(nameToUse.lastIndexOf('/') + 1)
    });

    await new Promise((resolve, reject) => {
      reader.onload = async (event) => {
        try {
          // Pass the File as the source Blob so importers can persist it without
          // duplicating the ArrayBuffer on the main thread (important for large LAS/LAZ).
          await this.importData(event.target.result, onLoadFn, name, null, file);
          resolve();
        } catch (e) {
          reject(e);
        }
      };

      reader.onerror = (error) => {
        console.error(errorMessage, error);
        showErrorPanel(`${errorMessage}: ${error}`, 0);
        reject(error);
      };

      reader.readAsArrayBuffer(file);
    });
  }

  static setupFileInputListener(config) {
    const { inputId, handlers, onLoad } = config;

    const input = document.getElementById(inputId);

    input.addEventListener('change', async (e) => {
      const files = Array.from(e.target.files);

      try {
        for (const file of files) {
          try {
            let handler;
            const extension = file.name.toLowerCase().split('.').pop();

            handler = handlers.get(extension);

            if (handler === undefined) {
              throw new Error(i18n.t('errors.import.unsupportedFileType', { extension }));
            }
            // Serialize cave file imports to prevent coordinate system dialog conflicts
            await handler.importFile(file, file.name, async (importedData, arg1, arg2) => {
              await onLoad(importedData, arg1, arg2);
            });
          } catch (error) {
            const msgPrefix = i18n.t('errors.import.importFileFailed', { name: file.name });
            showErrorPanel(`${msgPrefix}: ${error.message}`);
            console.error(msgPrefix, error);
          }
        }
      } catch (error) {
        console.error(i18n.t('errors.import.importFailed'), error);
      } finally {
        // Always clear the input value, regardless of success or failure
        input.value = '';
      }
    });
  }

}

export { Importer };
