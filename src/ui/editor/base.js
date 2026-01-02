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

import * as U from '../../utils/utils.js';
import { AttributesDefinitions } from '../../attributes.js';
import { SectionHelper } from '../../section.js';
import { CaveSection, CaveComponent } from '../../model/cave.js';
import { i18n } from '../../i18n/i18n.js';

class BaseEditor {
  constructor(panel) {
    this.panel = panel;
  }

  show() {
    this.panel.style.display = 'block';
  }

  closeEditor() {
    this.closed = true;

    if (this.table !== undefined) {
      this.table.destroy();
      this.table = undefined;
    }

    this.panel.style.display = 'none';
  }

  showAlert(msg, postAction = () => {}) {
    if (this.table === undefined) return;
    const closingButton = U.node`<button style="position: absolute; right: 4px; top: 4px; cursor: pointer; border: none; background: none; font-size: 1.5em; color: #666;">✕</button>`;
    closingButton.onclick = () => {
      this.table.clearAlert();
      postAction();
    };
    const div = U.node`<div style="position: relative; padding:10px;"><div style="margin-right: 30px;">${msg}</div></div>`;
    div.appendChild(closingButton);
    this.table.alert(div);
  }

  renderListEditor({
    container,
    items,
    fields,
    nodes,
    onAdd,
    onRemove,
    onChange,
    addButtonLabel = 'Add',
    rowStyle = ''
  }) {
    container.innerHTML = '';
    items.forEach((item, idx) => {
      const row = U.node`<div class="list-row" style="display: flex; gap: 8px; align-items: center; margin-bottom: 4px;${rowStyle}"></div>`;
      fields.forEach((f) => {
        const input = U.node`<input type="${f.type}" placeholder="${f.placeholder}" value="${item[f.key]}" ${f.required ? 'required' : ''} ${f.step ? 'step="' + f.step + '"' : ''} style="width: ${f.width || '100px'};">`;
        input.onchange = (e) => onChange(idx, f.key, e.target.value);
        row.appendChild(input);
      });

      nodes.forEach((n) => {
        const el = U.node(n.node);
        el.value = item[n.key];
        el.onchange = (e) => onChange(idx, n.key, e.target.value);
        row.appendChild(el);
      });

      const removeBtn = U.node`<button type="button">${i18n.t('common.remove')}</button>`;
      removeBtn.onclick = (e) => {
        e.preventDefault();
        onRemove(idx);
      };
      row.appendChild(removeBtn);
      container.appendChild(row);
    });
    const addBtn = U.node`<button type="button">${addButtonLabel}</button>`;
    addBtn.onclick = (e) => {
      e.preventDefault();
      onAdd();
    };
    container.appendChild(addBtn);
  }

  setupCustomEditMode(allowedColumns) {
    // Prevent range selection keyboard events when editing cells
    let isEditing = false;

    this.table.on('cellEditing', () => {
      isEditing = true;
    });

    this.table.on('cellEdited', () => {
      isEditing = false;
    });

    this.table.on('cellEditCancelled', () => {
      isEditing = false;
    });

    let activeCell = undefined;

    // Add event listener to prevent arrow key events from reaching range selection when editing
    this.table.element.addEventListener(
      'keydown',
      (e) => {
        if (isEditing && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
          // Stop the event from reaching Tabulator's keyboard binding system
          e.stopImmediatePropagation();
        }

        if (!allowedColumns) {
          return;
        }
        //navigate to an other cell
        if (!isEditing && e.key.startsWith('Arrow')) {
          activeCell = undefined;
        }

        if (
          !isEditing &&
          !e.key.startsWith('Arrow') &&
          !e.ctrlKey &&
          //!e.shiftKey &&
          !e.altKey &&
          !e.metaKey &&
          e.key.length === 1 &&
          e.key !== 'Enter' &&
          e.key !== 'Tab' &&
          e.key !== 'Backspace' &&
          e.key !== 'Delete' &&
          e.key !== 'Escape' &&
          e.key !== 'PageUp' &&
          e.key !== 'PageDown' &&
          e.key !== 'Home' &&
          e.key !== 'End' &&
          e.key !== 'Insert' &&
          e.key !== 'F1' &&
          e.key !== 'F2' &&
          e.key !== 'F3' &&
          e.key !== 'F4' &&
          e.key !== 'F5' &&
          e.key !== 'F6' &&
          e.key !== 'F7' &&
          e.key !== 'F8' &&
          e.key !== 'F9' &&
          e.key !== 'F10' &&
          e.key !== 'F11' &&
          e.key !== 'F12' &&
          e.key !== 'F13' &&
          e.key !== 'F14' &&
          e.key !== 'F15' &&
          e.key !== 'F16' &&
          e.key !== 'F17' &&
          e.key !== 'F18' &&
          e.key !== 'F19' &&
          e.key !== 'F20' &&
          e.key !== 'F21' &&
          e.key !== 'F22' &&
          e.key !== 'F23' &&
          e.key !== 'F24' &&
          e.key !== 'F25' &&
          e.key !== 'F26' &&
          e.key !== 'F27' &&
          e.key !== 'F28' &&
          e.key !== 'F29' &&
          e.key !== 'F30'
        ) {
          const ranges = this.table.getRanges();
          if (ranges && ranges.length > 0 && ranges[0].getCells().length > 0 && ranges[0].getCells()[0].length > 0) {
            const cell = ranges[0].getCells()[0][0];
            if (allowedColumns && allowedColumns.includes(cell.getColumn().getField())) {
              if (!activeCell || activeCell !== cell) {
                cell.setValue(e.key);
                activeCell = cell;
              } else {
                cell.setValue((cell.getValue() ?? '') + e.key);
              }
              e.preventDefault();
            }

          }

        }
      },
      true
    ); // Use capture phase to intercept before Tabulator
  }
}

class Editor extends BaseEditor {
  constructor(panel, scene, cave, attributeDefs) {
    super(panel);
    this.scene = scene;
    this.cave = cave;
    this.closed = false;
    this.attributesModified = false;
    this.attributeDefs = attributeDefs;
  }

  baseTableFunctions = {

    sumDistance : (_values, data) => {
      return data.reduce((sum, v) => sum + (v.distance || 0), 0).toFixed(2);
    },
    statusIcon : (cell) => {
      const data = cell.getData();
      if (data.status === 'ok') {
        return '<div class="ok-row"></div>';
      } else {
        return '<div class="warning-row"></div>';
      }
    },
    countBadRows : (_values, data) => {
      const cnt = data.filter((v) => v.status !== 'ok').length;
      return `${cnt}`;
    },
    getContextMenu : () => {
      return [
        {
          label  : `<span class="delete-row"></span><span>${i18n.t('ui.editors.base.menu.deleteRow')}<span/> `,
          action : function (e, row) {
            row.delete();
          }
        },
        {
          label  : `<span class="add-row"></span><span>${i18n.t('ui.editors.base.menu.addRowAbove')}<span/> `,
          action : (e, row) => {
            const newRow = this.getEmptyRow();
            row.getTable().addRow(newRow, true, row.getIndex());
          }
        },
        {
          label  : `<span class="add-row"></span><span>${i18n.t('ui.editors.base.menu.addRowBelow')}<span/> `,
          action : (e, row) => {
            const newRow = this.getEmptyRow();
            row.getTable().addRow(newRow, false, row.getIndex());
          }
        }
      ];
    },
    floatMutator : (value) => {
      if (value === '') {
        //when the user clears a cell by editing an empty string remains in the column as data
        return undefined;
      } else if (U.isFloatStr(value)) {
        return U.parseMyFloat(value);
      } else {
        return value;
      }
    },
    floatAccessor : (value) => {
      if (value === undefined) {
        return undefined;
      } else if (U.isFloatStr(value)) {
        return U.parseMyFloat(value);
      } else {
        return value;
      }
    },
    floatFormatter : (defaultValue = '0', decimals = 2) => {
      return (cell) => {
        const value = cell.getValue();
        if (value !== undefined && typeof value === 'number') {
          return value.toFixed(decimals);
        } else {
          return defaultValue;
        }
      };
    },
    colorIcon : (cell) => {
      const data = cell.getData();
      const color = data.color;
      const style = `style="background: ${color}"`;
      return `<input type="color" id="color-picker-${data.id}" value="${color}"><label id="color-picker-${data.id}-label" for="color-picker-${data.id}" ${style}></label>`;
    },
    changeColor : (e, cell) => {
      if (e.target.tagName === 'INPUT') {
        e.target.oninput = (e2) => {
          const newColor = e2.target.value;
          const data = cell.getData();
          data.color = newColor;
          if (data.visible) {
            this.scene.attributes.disposeSectionAttribute(data.id);
            this.scene.attributes.showFragmentAttribute(
              data.id,
              data.start === undefined
                ? SectionHelper.getSectionSegments(
                    new CaveSection(data.from, data.to, data.path, data.distance),
                    this.cave.stations
                  )
                : SectionHelper.getComponentSegments(
                    new CaveComponent(data.start, data.termination, data.path, data.distance),
                    this.cave.stations
                  ),
              data.attribute,
              data.format,
              data.color,
              this.cave.name,
              data.position,
              data.offset
            );
          }
          const label = document.getElementById(e.target.id + '-label');
          label.style.background = newColor;
        };
      }
    },
    addPhotoPreviewTooltip(element, photoUrl) {
      let tooltip = null;
      let imageLoaded = false;

      const showTooltip = async () => {
        if (tooltip) return; // Already showing

        // Create tooltip element
        tooltip = document.createElement('div');
        tooltip.className = 'photo-preview-tooltip';
        tooltip.innerHTML = `
          <div class="photo-preview-content">
            <div class="photo-preview-loading">${i18n.t('common.loading')}</div>
          </div>`;

        document.body.appendChild(tooltip);

        // Position tooltip
        const rect = element.getBoundingClientRect();
        const tooltipRect = tooltip.getBoundingClientRect();

        let left = rect.left + rect.width / 2 - tooltipRect.width / 2;
        let top = rect.top - tooltipRect.height - 10;

        // Adjust if tooltip goes off screen
        if (left < 10) left = 10;
        if (left + tooltipRect.width > window.innerWidth - 10) {
          left = window.innerWidth - tooltipRect.width - 10;
        }
        if (top < 10) {
          top = rect.bottom + 10;
        }

        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${top}px`;
        const loading = tooltip.querySelector('.photo-preview-loading');

        try {
          let cachedImage;
          // Try to use image cache if available
          if (this.scene && this.scene.imageCache) {
            cachedImage = await this.scene.imageCache.loadImage(photoUrl);
          }

          if (cachedImage) {
            cachedImage.className = 'photo-preview-image';
            tooltip.appendChild(cachedImage);
            imageLoaded = true;
            loading.style.display = 'none';
          } else {
            const img = U.node`<img src=${photoUrl} class="photo-preview-image" style="display:none" class="photo-preview-image"/>`;
            img.onload = () => {
              loading.style.display = 'none';
              img.style.display = 'block';
              imageLoaded = true;
            };

            img.onerror = () => {
              loading.textContent = i18n.t('ui.editors.attributes.errors.failedToLoadImage');
              loading.style.color = '#ff4444';
            };

            tooltip.appendChild(img);
          }

        } catch (error) {
          console.warn('Failed to load photo preview:', error);
          loading.textContent = i18n.t('ui.editors.attributes.errors.failedToLoadImage');
          loading.style.color = '#ff4444';
        }
      };

      const hideTooltip = () => {
        if (tooltip) {
          tooltip.remove();
          tooltip = null;
          imageLoaded = false;
        }
      };

      // Add event listeners
      element.addEventListener('mouseenter', showTooltip);
      element.addEventListener('mouseleave', hideTooltip);
      element.addEventListener('mousemove', () => {
        if (tooltip && imageLoaded) {
          const rect = element.getBoundingClientRect();
          const tooltipRect = tooltip.getBoundingClientRect();

          let left = rect.left + rect.width / 2 - tooltipRect.width / 2;
          let top = rect.top - tooltipRect.height - 10;

          // Adjust if tooltip goes off screen
          if (left < 10) left = 10;
          if (left + tooltipRect.width > window.innerWidth - 10) {
            left = window.innerWidth - tooltipRect.width - 10;
          }
          if (top < 10) {
            top = rect.bottom + 10;
          }

          tooltip.style.left = `${left}px`;
          tooltip.style.top = `${top}px`;
        }
      });
    },
    atrributesFormatter : (cell, extractor, i18n) => {
      const attrs = extractor(cell.getData());
      if (attrs === undefined) {
        return undefined;
      }

      if (Array.isArray(attrs) && attrs.length > 0) {
        const formattedString = AttributesDefinitions.getAttributesAsString(attrs, i18n);

        // Check if any attribute is a photo attribute
        const hasPhotoAttribute = attrs.some((attr) => attr.name === 'photo' && attr.url);

        if (hasPhotoAttribute) {
          // Create a wrapper div with hover functionality for photo preview
          const cellId = `photo-cell-${cell.getData().id}`;
          const div = U.node`<div id="${cellId}" class="photo-attribute-cell" data-photo-url="${attrs.find((attr) => attr.name === 'photo')?.url || ''}">${formattedString}</div>`;
          this.baseTableFunctions.addPhotoPreviewTooltip(div, attrs.find((attr) => attr.name === 'photo')?.url);
          return div;
        }

        return formattedString;
      } else {
        return undefined;
      }
    },
    attributesHeaderFilter : (headerValue, _rowValue, rowData) => {
      let attrs;
      if (rowData.attribute !== undefined) {
        attrs = [rowData.attribute];
      } else if (rowData.attributes !== undefined) {
        attrs = rowData.attributes;
      }
      if (attrs !== undefined && attrs && Array.isArray(attrs) && attrs.length > 0) {
        const formatted = AttributesDefinitions.getAttributesAsString(attrs, i18n, ',');
        return formatted.includes(headerValue);
      } else {
        return false;
      }
    },
    attributesToClipboard : (value, extractor = (value) => value) => {
      const attributes = extractor(value);
      if (attributes !== undefined) {
        return AttributesDefinitions.getAttributesAsString(attributes);
      } else {
        return '';
      }
    },
    clipboardFormatter : (cell, extractor) => {
      const attrs = extractor(cell.getData());
      if (Array.isArray(attrs) && attrs.length > 0) {
        return this.attributeDefs.getAttributesAsString(attrs);
      } else {
        return '';
      }
    },
    attributesFromClipboard : (value, converter = (attrs) => attrs) => {
      if (value === undefined || typeof value !== 'string' || value.length === 0) {
        return [];
      }
      const result = this.attributeDefs.getAttributesFromString(value);
      if (result.errors.length > 0) {
        this.showAlert(result.errors.join('<br>'));
      } else if (result.attributes.length > 0) {
        return converter(result.attributes);
      }
    }

  };

}

export { BaseEditor, Editor };
