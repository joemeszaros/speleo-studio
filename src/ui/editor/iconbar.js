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
import { i18n } from '../../i18n/i18n.js';

export class IconBar {

  constructor(container, options = {}) {
    this.container = container;
    this.options = options;
    this.element = U.node`<div class="iconbar">`;
    this.container.appendChild(this.element);
  }

  addButton(config) {
    let element;
    if (config.separator) {
      element = U.node`<span class="icon-separator"></span>`;
    } else {
      if (config.icon) {
        element = U.node`<a id="${config.id}" class="mytooltip"><img src="${config.icon}" alt="${config.id}" ${config.width ? `style="width:${config.width}px"` : ''}><span class="mytooltiptext">${config.tooltip}</span></a>`;
      } else {
        element = U.node`<button id="${config.id}">${config.text}</button>`;
      }
      element.onclick = (e) => {
        config.click(e);
      };
    }
    this.element.appendChild(element);
    return element;
  }

  addSeparator() {
    return this.addButton({ separator: true });
  }

  // Common button configurations
  // at the time of this function call this.table is undefined therefore we need to pass a function that returns the table
  static getCommonButtons(getTable, options = {}) {
    const getIndex = () => {
      if (!getTable()) return undefined;
      const ranges = getTable().getRanges();
      if (ranges.length > 0) {
        const rows = ranges[0].getRows();
        if (rows.length > 0) {
          return rows[0].getIndex();
        }
      }
      return undefined;
    };

    return [
      {
        id      : 'undo',
        icon    : 'icons/undo.svg',
        tooltip : i18n.t('common.undo'),
        click   : () => getTable()?.undo?.()
      },
      {
        id      : 'redo',
        icon    : 'icons/redo.svg',
        tooltip : i18n.t('common.redo'),
        click   : () => getTable()?.redo?.()
      },
      {
        id      : 'add-row-before',
        icon    : 'icons/add_before.svg',
        tooltip : i18n.t('ui.editors.common.addRowBefore'),
        click   : () => {
          const index = getIndex();
          if (index !== undefined && options.getEmptyRow) {
            getTable().addRow(options.getEmptyRow(), true, index);
          }
        }
      },
      {
        id      : 'add-row-after',
        icon    : 'icons/add_after.svg',
        tooltip : i18n.t('ui.editors.common.addRowAfter'),
        click   : () => {
          const index = getIndex();
          if (index !== undefined && options.getEmptyRow) {
            getTable().addRow(options.getEmptyRow(), false, index);
          }
        }
      },
      {
        id      : 'add-row',
        icon    : 'icons/add_white.svg',
        tooltip : i18n.t('ui.editors.common.addRowToEnd'),
        click   : () => {
          if (options.getEmptyRow) {
            getTable()
              .addRow(options.getEmptyRow())
              .then((row) => {
                row.scrollTo('nearest', false).catch((err) => {
                  console.warn('Failed to scroll to new row:', err);
                });
              });
          }
        }
      },
      {
        id      : 'delete-row',
        tooltip : i18n.t('ui.editors.common.deleteActiveRows'),
        icon    : 'icons/trash_white.svg',
        click   : () => {
          if (getTable()) {
            var ranges = getTable().getRanges();
            ranges.forEach((r) => {
              const rows = r.getRows();
              rows.forEach((r) => r.delete());
              r.remove();
            });
          }
        }
      }
    ];
  }

  // Survey-specific buttons
  static getSurveyButtons(validateSurvey, updateSurvey, cancelSurvey) {
    return [
      { separator: true },
      {
        id      : 'validate-shots',
        tooltip : i18n.t('ui.editors.common.validateShots'),
        icon    : 'icons/validate.svg',
        click   : () => validateSurvey?.()
      },
      {
        id      : 'update-survey',
        tooltip : i18n.t('ui.editors.survey.buttons.update'),
        icon    : 'icons/update.svg',
        click   : () => updateSurvey?.()
      },
      {
        id      : 'cancel-survey',
        tooltip : i18n.t('ui.editors.base.buttons.cancel'),
        icon    : 'icons/cancel.svg',
        click   : () => cancelSurvey?.()
      }
    ];
  }

  // Attribute editor-specific buttons
  static getAttributesButtons(validateAttributes, updateAttributes, cancelAttributes) {
    return [
      { separator: true },
      {
        id      : 'validate-attributes',
        tooltip : i18n.t('ui.editors.common.validateAttributes'),
        icon    : 'icons/validate.svg',
        click   : () => validateAttributes?.()
      },
      {
        id      : 'update-addtributes',
        tooltip : i18n.t('ui.editors.attributes.buttons.update'),
        icon    : 'icons/update.svg',
        click   : () => updateAttributes?.()
      },
      {
        id      : 'cancel-attributes',
        tooltip : i18n.t('ui.editors.base.buttons.cancel'),
        icon    : 'icons/cancel.svg',
        click   : () => cancelAttributes?.()
      }

    ];
  }

  static getVisibleButtons(showAll, hideAll) {
    return [
      { separator: true },
      {
        id      : 'show-all',
        tooltip : i18n.t('ui.editors.attributes.buttons.showAll'),
        icon    : 'icons/visible.svg',
        click   : () => showAll()
      },
      {
        id      : 'hide-all',
        tooltip : i18n.t('ui.editors.attributes.buttons.hideAll'),
        icon    : 'icons/invisible.svg',
        click   : () => hideAll()
      }
    ];
  }

  // Station comments editor-specific buttons
  static getStationCommentsButtons(validateComments, updateComments, cancelComments) {
    return [
      { separator: true },
      {
        id      : 'validate-comments',
        tooltip : i18n.t('ui.editors.stationComments.buttons.validate'),
        icon    : 'icons/validate.svg',
        click   : () => validateComments()
      },
      {
        id      : 'update-comments',
        tooltip : i18n.t('ui.editors.stationComments.buttons.update'),
        icon    : 'icons/update.svg',
        click   : () => updateComments()
      },
      {
        id      : 'cancel-comments',
        tooltip : i18n.t('ui.editors.base.buttons.cancel'),
        icon    : 'icons/cancel.svg',
        click   : () => cancelComments()
      }

    ];
  }

  // Cycle-specific buttons
  static getCycleButtons(showAllCycles, hideAllCycles, showAllDeviatingShots, hideAllDeviatingShots) {
    return [
      {
        id      : 'show-all-cycles',
        tooltip : i18n.t('ui.editors.cycles.buttons.showAllCycles'),
        icon    : 'icons/cycle.svg',
        click   : () => showAllCycles?.()
      },
      {
        id      : 'hide-all-cycles',
        tooltip : i18n.t('ui.editors.cycles.buttons.hideAllCycles'),
        icon    : 'icons/cycle_hide.svg',
        click   : () => hideAllCycles?.()
      },
      {
        id      : 'show-all-deviating-shots',
        tooltip : i18n.t('ui.editors.cycles.buttons.showAllDeviatingShots'),
        icon    : 'icons/deviating_shots.svg',
        click   : () => showAllDeviatingShots?.()
      },
      {
        id      : 'hide-all-deviating-shots',
        tooltip : i18n.t('ui.editors.cycles.buttons.hideAllDeviatingShots'),
        icon    : 'icons/deviating_shots_hide.svg',
        click   : () => hideAllDeviatingShots?.()
      }
    ];
  }

  // Export button
  static getExportButton(getTable, filename) {
    return [
      { separator: true },
      {
        id      : 'export-to-csv',
        tooltip : i18n.t('ui.editors.common.exportToCsv'),
        icon    : 'icons/export.svg',
        click   : () => getTable()?.download?.('csv', filename, { delimiter: '	' })
      }
    ];
  }

  // Column visibility toggle
  static getColumnToggleButton() {
    return [
      { separator: true },
      {
        id      : 'toggle-column',
        tooltip : i18n.t('ui.editors.common.toggleColumns'),
        icon    : 'icons/hamburger.svg',
        click   : (e) => {
          const menuDiv = document.getElementById('toogle-column-visibility-menu');
          if (menuDiv.style.display === 'block') {
            menuDiv.style.display = 'none';
          } else {
            menuDiv.style.display = 'block';

            // Add click outside handler to close menu
            const closeMenu = (event) => {
              if (!menuDiv.contains(event.target) && !e.target.contains(event.target)) {
                menuDiv.style.display = 'none';
                document.removeEventListener('click', closeMenu);
              }
            };

            // Use setTimeout to prevent immediate closure
            setTimeout(() => {
              document.addEventListener('click', closeMenu);
            }, 100);
          }
        }
      }
    ];
  }

  // Validate button
  static getValidateButton(validateFunction) {
    return [
      { separator: true },
      {
        id      : 'validate-rows',
        tooltip : i18n.t('ui.editors.common.validateShots'),
        icon    : 'icons/validate.svg',
        click   : () => validateFunction?.()
      }
    ];
  }

  // Update attributes button
  static getUpdateAttributesButton(updateFunction, buttonText) {
    return [
      {
        id      : 'update-attributes',
        tooltip : buttonText || 'Update attributes',
        icon    : 'icons/update.svg',
        click   : () => updateFunction?.()
      }
    ];
  }
}
