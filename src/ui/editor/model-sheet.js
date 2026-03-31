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

import * as U from '../../utils/utils.js';
import { BaseEditor } from './base.js';
import { wm } from '../window.js';
import { i18n } from '../../i18n/i18n.js';
import {
  GeoData,
  EOVCoordinateWithElevation,
  UTMCoordinateWithElevation,
  EOVCoordinateSystem,
  UTMCoordinateSystem,
  StationWithCoordinate,
  CoordinateSystemType
} from '../../model/geo.js';
import { UTMConverter } from '../../utils/geo.js';

/**
 * Editor for 3D model metadata — coordinate system and coordinates.
 * Similar to CaveEditor's coordinate section but for models.
 */
export class ModelSheetEditor extends BaseEditor {

  constructor(modelNode, modelSystem, projectSystem, panel) {
    super(panel);
    this.modelNode = modelNode;
    this.modelSystem = modelSystem;
    this.projectSystem = projectSystem;
    this.hasChanged = false;

    // Working copy of coordinate data
    this.coordData = {
      coordinateSystem : modelNode.data?.geoData?.coordinateSystem ?? undefined,
      coordinates      : this.#extractCoordinates(modelNode.data?.geoData)
    };
  }

  #extractCoordinates(geoData) {
    if (!geoData?.coordinates?.length) return [];
    return geoData.coordinates.map((c) => {
      const coord = c.coordinate;
      if (coord?.type === CoordinateSystemType.UTM) {
        return { name: c.name, easting: coord.easting, northing: coord.northing, elevation: coord.elevation };
      } else if (coord?.type === CoordinateSystemType.EOV) {
        return { name: c.name, y: coord.y, x: coord.x, elevation: coord.elevation };
      }
      return { name: c.name, elevation: coord?.elevation ?? 0 };
    });
  }

  setupPanel() {
    wm.makeFloatingPanel(
      this.panel,
      (contentElmnt) => this.build(contentElmnt),
      () => i18n.t('ui.editors.modelSheet.title', { name: this.modelNode.label }),
      true,
      false,
      {},
      () => this.closeEditor()
    );
  }

  build(contentElmnt) {
    const form = U.node`<form class="editor"></form>`;

    // Name field (matching cave sheet style)
    const nameField = U.node`<div class="sheet-editor-field"></div>`;
    const nameLabel = U.node`<label class="sheet-editor-label" for="model-name">${i18n.t('common.name')}: </label>`;
    const nameInput = U.node`<input type="text" id="model-name" name="name" value="${this.modelNode.label}" required>`;
    nameInput.oninput = () => {
      this.hasChanged = true;
    };
    nameField.appendChild(nameLabel);
    nameField.appendChild(nameInput);
    form.appendChild(nameField);

    // Coordinate system selection
    const coordsDiv = U.node`<div class="coords-section"></div>`;

    const coordSystemDiv = U.node`<div class="coord-system-selection" style="margin-bottom: 16px;">
      <label for="model-coord-system">${i18n.t('ui.editors.caveSheet.fields.coordinateSystem')}:</label>
      <select id="model-coord-system" style="margin-left: 8px;">
        <option value="none" ${this.coordData.coordinateSystem === undefined ? 'selected' : ''}>${i18n.t('ui.editors.caveSheet.fields.none')}</option>
        <option value="eov" ${this.coordData.coordinateSystem?.type === CoordinateSystemType.EOV ? 'selected' : ''}>EOV</option>
        <option value="utm" ${this.coordData.coordinateSystem?.type === CoordinateSystemType.UTM ? 'selected' : ''}>UTM</option>
      </select>
    </div>`;

    const utmZoneDiv = U.node`<div id="model-utm-zone-selection" style="margin-bottom: 16px; display: ${this.coordData.coordinateSystem?.type === CoordinateSystemType.UTM ? 'block' : 'none'};">
      <label for="model-utm-zone">${i18n.t('ui.editors.caveSheet.fields.utmZone')}:</label>
      <input type="number" id="model-utm-zone" min="1" max="60" value="${this.coordData.coordinateSystem?.zoneNum || 34}" style="margin-left: 8px; width: 60px;">
      <label for="model-utm-hemisphere" style="margin-left: 16px;">${i18n.t('ui.editors.caveSheet.fields.hemisphere')}:</label>
      <select id="model-utm-hemisphere" style="margin-left: 8px;">
        <option value="N" ${(this.coordData.coordinateSystem?.northern ?? true) ? 'selected' : ''}>${i18n.t('ui.editors.caveSheet.fields.northern')}</option>
        <option value="S" ${!(this.coordData.coordinateSystem?.northern ?? true) ? 'selected' : ''}>${i18n.t('ui.editors.caveSheet.fields.southern')}</option>
      </select>
    </div>`;

    this.coordsList = U.node`<div class="coords-list"></div>`;

    coordsDiv.appendChild(coordSystemDiv);
    coordsDiv.appendChild(utmZoneDiv);
    coordsDiv.appendChild(this.coordsList);
    form.appendChild(coordsDiv);

    // Coordinate system change handler
    coordSystemDiv.querySelector('#model-coord-system').onchange = (e) => {
      const isUTM = e.target.value === CoordinateSystemType.UTM;
      utmZoneDiv.style.display = isUTM ? 'block' : 'none';

      this.coordData.coordinates = [];

      switch (e.target.value) {
        case CoordinateSystemType.UTM:
          this.coordData.coordinateSystem = new UTMCoordinateSystem(
            parseInt(utmZoneDiv.querySelector('#model-utm-zone').value),
            utmZoneDiv.querySelector('#model-utm-hemisphere').value === 'N'
          );
          this.renderCoords();
          break;
        case CoordinateSystemType.EOV:
          this.coordData.coordinateSystem = new EOVCoordinateSystem();
          this.renderCoords();
          break;
        default:
          this.coordsList.innerHTML = '';
          this.coordData.coordinateSystem = undefined;
          break;
      }
      this.hasChanged = true;
    };

    // UTM zone/hemisphere change handlers
    utmZoneDiv.querySelector('#model-utm-zone').onchange = (e) => {
      if (this.coordData.coordinateSystem?.type === CoordinateSystemType.UTM) {
        this.coordData.coordinateSystem = new UTMCoordinateSystem(
          parseInt(e.target.value),
          utmZoneDiv.querySelector('#model-utm-hemisphere').value === 'N'
        );
        this.hasChanged = true;
      }
    };

    utmZoneDiv.querySelector('#model-utm-hemisphere').onchange = (e) => {
      if (this.coordData.coordinateSystem?.type === CoordinateSystemType.UTM) {
        this.coordData.coordinateSystem = new UTMCoordinateSystem(
          parseInt(utmZoneDiv.querySelector('#model-utm-zone').value),
          e.target.value === 'N'
        );
        this.hasChanged = true;
      }
    };

    // Buttons (matching cave sheet pattern)
    const saveBtn = U.node`<button type="submit">${i18n.t('common.save')}</button>`;
    const cancelBtn = U.node`<button type="button">${i18n.t('common.cancel')}</button>`;
    cancelBtn.onclick = (e) => {
      e.preventDefault();
      this.closeEditor();
    };
    form.appendChild(saveBtn);
    form.appendChild(cancelBtn);

    // File info section (read-only)
    const infoDiv = U.node`<div class="settings-group" style="margin-top: 16px;">
      <div class="settings-group-title"><span>${i18n.t('ui.editors.modelSheet.fileInfo')}</span></div>
      <div class="settings-group-content" id="model-file-info"></div>
    </div>`;
    form.appendChild(infoDiv);
    this.#loadFileInfo(infoDiv.querySelector('#model-file-info'));

    // Save handler
    form.onsubmit = (e) => {
      e.preventDefault();
      this.#handleSave();
    };

    contentElmnt.appendChild(form);

    this.renderCoords();
  }

  renderCoords() {
    const fields = [];

    switch (this.coordData.coordinateSystem?.type) {
      case CoordinateSystemType.UTM:
        fields.push(
          {
            key         : 'easting',
            placeholder : i18n.t('ui.editors.caveSheet.fields.utmEasting'),
            type        : 'number',
            step        : '0.01',
            width       : '120px',
            required    : true
          },
          {
            key         : 'northing',
            placeholder : i18n.t('ui.editors.caveSheet.fields.utmNorthing'),
            type        : 'number',
            step        : '0.01',
            width       : '120px',
            required    : true
          }
        );
        break;
      case CoordinateSystemType.EOV:
        fields.push(
          {
            key         : 'y',
            placeholder : i18n.t('ui.editors.caveSheet.fields.eovy'),
            type        : 'number',
            step        : '0.01',
            width       : '100px',
            required    : true
          },
          {
            key         : 'x',
            placeholder : i18n.t('ui.editors.caveSheet.fields.eovx'),
            type        : 'number',
            step        : '0.01',
            width       : '100px',
            required    : true
          }
        );
        break;
      default:
        this.coordsList.innerHTML = '';
        return;
    }

    fields.push({
      key         : 'elevation',
      placeholder : i18n.t('ui.editors.caveSheet.fields.elevation'),
      type        : 'number',
      step        : '0.01',
      width       : '100px',
      required    : true
    });

    this.renderListEditor({
      container : this.coordsList,
      items     : this.coordData.coordinates,
      fields    : fields,
      nodes     : [],
      onAdd     : () => {
        const empty = { elevation: 0 };
        if (this.coordData.coordinateSystem?.type === CoordinateSystemType.UTM) {
          empty.easting = 0;
          empty.northing = 0;
        } else if (this.coordData.coordinateSystem?.type === CoordinateSystemType.EOV) {
          empty.y = 0;
          empty.x = 0;
        }
        this.coordData.coordinates.push(empty);
        this.renderCoords();
        this.hasChanged = true;
      },
      onRemove : (idx) => {
        this.coordData.coordinates.splice(idx, 1);
        this.renderCoords();
        this.hasChanged = true;
      },
      onChange : (idx, key, value) => {
        this.coordData.coordinates[idx][key] = value;
        this.hasChanged = true;
      },
      addButtonLabel : i18n.t('ui.editors.modelSheet.addCoordinate')
    });
  }

  async #handleSave() {
    if (!this.hasChanged) {
      this.closeEditor();
      return;
    }

    // Build GeoData from the form
    let geoData;
    if (this.coordData.coordinates.length > 0 && this.coordData.coordinateSystem) {
      const coordinates = this.coordData.coordinates.map((c) => {
        let coordinate;
        switch (this.coordData.coordinateSystem.type) {
          case CoordinateSystemType.UTM:
            coordinate = new UTMCoordinateWithElevation(
              U.parseMyFloat(c.easting),
              U.parseMyFloat(c.northing),
              U.parseMyFloat(c.elevation)
            );
            break;
          case CoordinateSystemType.EOV:
            coordinate = new EOVCoordinateWithElevation(
              U.parseMyFloat(c.y),
              U.parseMyFloat(c.x),
              U.parseMyFloat(c.elevation)
            );
            break;
        }
        return new StationWithCoordinate('origin', coordinate);
      });
      geoData = new GeoData(this.coordData.coordinateSystem, coordinates);
    } else {
      geoData = undefined;
    }

    const newName = this.panel.querySelector('#model-name').value.trim();

    // Update model's geoData
    this.modelNode.data.geoData = geoData;

    // Update name if changed
    const oldName = this.modelNode.label;
    if (newName && newName !== oldName) {
      this.modelNode.label = newName;
      this.modelNode.data.name = newName;
    }

    // Dispatch event for manager to handle persistence
    document.dispatchEvent(
      new CustomEvent('modelChanged', {
        detail : {
          modelFileId : this.modelNode.modelFileId,
          oldName     : oldName,
          name        : newName || oldName,
          geoData     : geoData
        }
      })
    );

    this.closeEditor();
  }

  async #loadFileInfo(container) {
    container.innerHTML = `<div style="color: #999; font-size: 11px;">${i18n.t('common.loading')}</div>`;

    try {
      const project = this.projectSystem.getCurrentProject();
      if (!project || !this.modelNode.modelFileId) return;

      const modelFile = await this.modelSystem.getModelFile(this.modelNode.modelFileId);

      let totalBytes = 0;

      container.innerHTML = '';

      if (modelFile) {
        const modelSize = modelFile.data instanceof Blob ? modelFile.data.size : 0;
        totalBytes += modelSize;
        const textures = await this.modelSystem.getTextureFilesByModel(modelFile.id);
        for (const tex of textures) {
          totalBytes += tex.data instanceof Blob ? tex.data.size : 0;
        }

        // Two-column layout
        const columns = U.node`<div style="display: flex; gap: 16px;"></div>`;

        // Left column: model file
        const leftCol = U.node`<div style="flex: 1;">
          <div style="font-size: 11px; font-weight: 600; color: #ddd; margin-bottom: 4px;">${i18n.t('ui.editors.modelSheet.modelFile')}</div>
          <div style="font-size: 11px; color: #ccc; margin-left: 8px;">${modelFile.filename} (${this.#formatBytes(modelSize)})</div>
        </div>`;
        columns.appendChild(leftCol);

        // Right column: texture files
        if (textures.length > 0) {
          const rightCol = U.node`<div style="flex: 1;">
            <div style="font-size: 11px; font-weight: 600; color: #ddd; margin-bottom: 4px;">${i18n.t('ui.editors.modelSheet.textureFiles')}</div>
          </div>`;
          for (const tex of textures) {
            const texSize = tex.data instanceof Blob ? tex.data.size : 0;
            rightCol.appendChild(
              U.node`<div style="font-size: 11px; color: #ccc; margin-bottom: 2px; margin-left: 8px;">${tex.filename} (${this.#formatBytes(texSize)})</div>`
            );
          }
          columns.appendChild(rightCol);
        }

        container.appendChild(columns);
      }

      container.appendChild(
        U.node`<div style="font-size: 11px; font-weight: 600; color: #fff; margin-top: 8px;">${i18n.t('ui.editors.modelSheet.totalSize')}: ${this.#formatBytes(totalBytes)}</div>`
      );
    } catch (err) {
      container.innerHTML = `<div style="color: #f66; font-size: 11px;">${err.message}</div>`;
    }
  }

  #formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const k = 1024;
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + units[i];
  }
}
