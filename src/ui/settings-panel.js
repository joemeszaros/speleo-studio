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

import { ConfigManager } from '../config.js';
import { i18n } from '../i18n/i18n.js';

export class SettingsPanel {
  constructor(container, options) {
    this.container = container;
    this.options = options;
    this.init();

    // Listen for language changes to refresh translations
    document.addEventListener('languageChanged', () => {
      this.render();
    });
  }

  init() {
    this.render();
  }

  render() {
    this.container.innerHTML = '';

    // Configuration Management Buttons
    this.container.appendChild(
      this.createButtonRow([
        this.createButton('📥 ' + i18n.t('ui.settingsPanel.buttons.download'), () => {
          this.downloadConfig();
        }),
        this.createButton('📤 ' + i18n.t('ui.settingsPanel.buttons.load'), () => {
          this.loadConfig();
        }),
        this.createButton(i18n.t('ui.settingsPanel.buttons.reset'), () => {
          this.resetConfig();
        })
      ])
    );

    // Print Layout Section
    this.createSection(
      '🖨️ ' + i18n.t('ui.settingsPanel.sections.print'),
      [
        this.createSelect(
          i18n.t('ui.settingsPanel.labels.printLayout'),
          [i18n.t('ui.settingsPanel.options.portrait'), i18n.t('ui.settingsPanel.options.landscape')],
          i18n.t(`ui.settingsPanel.options.${this.options.print.layout}`),
          (value) => {
            if (value === i18n.t('ui.settingsPanel.options.portrait')) {
              this.options.print.layout = 'portrait';
            } else {
              this.options.print.layout = 'landscape';
            }
          }
        )
      ],
      true
    );

    // Survey Lines Section (expanded by default)
    this.createSection(
      '➜ ' + i18n.t('ui.settingsPanel.sections.surveyLines'),
      [
        // Center Lines Group
        this.createSubGroup(
          i18n.t('ui.settingsPanel.groups.centerLines'),
          [
            this.createColorInput(
              i18n.t('ui.settingsPanel.labels.color'),
              this.options.scene.centerLines.segments.color,
              (value) => {
                this.options.scene.centerLines.segments.color = value;
              }
            ),
            this.createRangeInput(
              i18n.t('ui.settingsPanel.labels.width'),
              this.options.scene.centerLines.segments.width,
              0.1,
              5,
              0.1,
              (value) => {
                this.options.scene.centerLines.segments.width = value;
              }
            ),
            this.createRangeInput(
              i18n.t('ui.settingsPanel.labels.opacity'),
              this.options.scene.centerLines.segments.opacity,
              0,
              1,
              0.1,
              (value) => {
                this.options.scene.centerLines.segments.opacity = value;
              }
            )
          ],
          this.options.scene.centerLines.segments,
          (value) => {
            this.options.scene.centerLines.segments.show = value;
          }
        ),

        // Splays Group
        this.createSubGroup(
          i18n.t('ui.settingsPanel.groups.splays'),
          [
            this.createColorInput(
              i18n.t('ui.settingsPanel.labels.color'),
              this.options.scene.splays.segments.color,
              (value) => {
                this.options.scene.splays.segments.color = value;
              }
            ),
            this.createRangeInput(
              i18n.t('ui.settingsPanel.labels.width'),
              this.options.scene.splays.segments.width,
              0.1,
              5,
              0.1,
              (value) => {
                this.options.scene.splays.segments.width = value;
              }
            ),
            this.createRangeInput(
              i18n.t('ui.settingsPanel.labels.opacity'),
              this.options.scene.splays.segments.opacity,
              0,
              1,
              0.1,
              (value) => {
                this.options.scene.splays.segments.opacity = value;
              }
            )
          ],
          this.options.scene.splays.segments,
          (value) => {
            this.options.scene.splays.segments.show = value;
          }
        ),

        // Auxiliary Lines Group
        this.createSubGroup(
          i18n.t('ui.settingsPanel.groups.auxiliaryLines'),
          [
            this.createColorInput(
              i18n.t('ui.settingsPanel.labels.color'),
              this.options.scene.auxiliaries.segments.color,
              (value) => {
                this.options.scene.auxiliaries.segments.color = value;
              }
            ),
            this.createRangeInput(
              i18n.t('ui.settingsPanel.labels.width'),
              this.options.scene.auxiliaries.segments.width,
              0.1,
              5,
              0.1,
              (value) => {
                this.options.scene.auxiliaries.segments.width = value;
              }
            ),
            this.createRangeInput(
              i18n.t('ui.settingsPanel.labels.opacity'),
              this.options.scene.auxiliaries.segments.opacity,
              0,
              1,
              0.1,
              (value) => {
                this.options.scene.auxiliaries.segments.opacity = value;
              }
            )
          ],
          this.options.scene.auxiliaries.segments,
          (value) => {
            this.options.scene.auxiliaries.segments.show = value;
          }
        )
      ],
      true
    );

    // Stations Section (collapsed by default)
    this.createSection(
      '📍 ' + i18n.t('ui.settingsPanel.sections.stations'),
      [
        // Center Stations Group
        this.createSubGroup(
          i18n.t('ui.settingsPanel.groups.centerStations'),
          [
            this.createColorInput(
              i18n.t('ui.settingsPanel.labels.color'),
              this.options.scene.centerLines.spheres.color,
              (value) => {
                this.options.scene.centerLines.spheres.color = value;
              }
            ),
            this.createRangeInput(
              i18n.t('ui.settingsPanel.labels.size'),
              this.options.scene.centerLines.spheres.radius,
              0.1,
              4,
              0.1,
              (value) => {
                this.options.scene.centerLines.spheres.radius = value;
              }
            )
          ],
          this.options.scene.centerLines.spheres,
          (value) => {
            this.options.scene.centerLines.spheres.show = value;
          }
        ),

        // Splay Stations Group
        this.createSubGroup(
          i18n.t('ui.settingsPanel.groups.splayStations'),
          [
            this.createColorInput(
              i18n.t('ui.settingsPanel.labels.color'),
              this.options.scene.splays.spheres.color,
              (value) => {
                this.options.scene.splays.spheres.color = value;
              }
            ),
            this.createRangeInput(
              i18n.t('ui.settingsPanel.labels.size'),
              this.options.scene.splays.spheres.radius,
              0.1,
              4,
              0.1,
              (value) => {
                this.options.scene.splays.spheres.radius = value;
              }
            )
          ],
          this.options.scene.splays.spheres,
          (value) => {
            this.options.scene.splays.spheres.show = value;
          }
        ),

        // Auxiliary Stations Group
        this.createSubGroup(
          i18n.t('ui.settingsPanel.groups.auxiliaryStations'),
          [
            this.createColorInput(
              i18n.t('ui.settingsPanel.labels.color'),
              this.options.scene.auxiliaries.spheres.color,
              (value) => {
                this.options.scene.auxiliaries.spheres.color = value;
              }
            ),
            this.createRangeInput(
              i18n.t('ui.settingsPanel.labels.size'),
              this.options.scene.auxiliaries.spheres.radius,
              0.1,
              4,
              0.1,
              (value) => {
                this.options.scene.auxiliaries.spheres.radius = value;
              }
            )
          ],
          this.options.scene.auxiliaries.spheres,
          (value) => {
            this.options.scene.auxiliaries.spheres.show = value;
          }
        )
      ],
      true
    );

    // Station Labels Section
    this.createSection(
      '🏷️ ' + i18n.t('ui.settingsPanel.sections.stationLabels'),
      [
        this.createSubGroup(
          i18n.t('ui.settingsPanel.groups.stationLabels'),
          [
            this.createSelect(
              i18n.t('ui.settingsPanel.labels.labelMode'),
              [i18n.t('ui.settingsPanel.options.name'), i18n.t('ui.settingsPanel.options.depth')],
              i18n.t(`ui.settingsPanel.options.${this.options.scene.stationLabels.mode}`),
              (value) => {
                if (value === i18n.t('ui.settingsPanel.options.name')) {
                  this.options.scene.stationLabels.mode = 'name';
                } else {
                  this.options.scene.stationLabels.mode = 'depth';
                }
              }
            ),
            this.createColorInput(
              i18n.t('ui.settingsPanel.labels.color'),
              this.options.scene.stationLabels.color,
              (value) => {
                this.options.scene.stationLabels.color = value;
              }
            ),
            this.createRangeInput(
              i18n.t('ui.settingsPanel.labels.size'),
              this.options.scene.stationLabels.size,
              1,
              60,
              1,
              (value) => {
                this.options.scene.stationLabels.size = value;
              }
            ),
            this.createRangeInput(
              i18n.t('ui.settingsPanel.labels.offset'),
              this.options.scene.stationLabels.offset,
              0.1,
              10,
              0.1,
              (value) => {
                this.options.scene.stationLabels.offset = value;
              }
            ),
            this.createSelect(
              i18n.t('ui.settingsPanel.labels.offsetDirection'),
              [
                i18n.t('ui.settingsPanel.options.up'),
                i18n.t('ui.settingsPanel.options.down'),
                i18n.t('ui.settingsPanel.options.left'),
                i18n.t('ui.settingsPanel.options.right')
              ],
              i18n.t(`ui.settingsPanel.options.${this.options.scene.stationLabels.offsetDirection}`),
              (value) => {
                if (value === i18n.t('ui.settingsPanel.options.up')) {
                  this.options.scene.stationLabels.offsetDirection = 'up';
                } else if (value === i18n.t('ui.settingsPanel.options.down')) {
                  this.options.scene.stationLabels.offsetDirection = 'down';
                } else if (value === i18n.t('ui.settingsPanel.options.left')) {
                  this.options.scene.stationLabels.offsetDirection = 'left';
                } else if (value === i18n.t('ui.settingsPanel.options.right')) {
                  this.options.scene.stationLabels.offsetDirection = 'right';
                }

              }
            ),
            this.createCheckbox(
              i18n.t('ui.settingsPanel.labels.stroke'),
              this.options.scene.stationLabels.stroke,
              (value) => {
                this.options.scene.stationLabels.stroke = value;
              }
            ),
            this.createColorInput(
              i18n.t('ui.settingsPanel.labels.strokeColor'),
              this.options.scene.stationLabels.strokeColor,
              (value) => {
                this.options.scene.stationLabels.strokeColor = value;
              }
            )
          ],
          this.options.scene.stationLabels,
          (value) => {
            this.options.scene.stationLabels.show = value;
          }
        )
      ],
      true
    );

    // Appearance Section
    this.createSection(
      '🖼 ' + i18n.t('ui.settingsPanel.sections.appearance'),
      [
        this.createColorInput(
          i18n.t('ui.settingsPanel.labels.backgroundColor'),
          this.options.scene.background.color,
          (value) => {
            this.options.scene.background.color = value;
          }
        ),

        this.createRangeInput(
          i18n.t('ui.settingsPanel.labels.screenDPI'),
          this.options.screen.DPI,
          72,
          300,
          1,
          (value) => {
            this.options.screen.DPI = value;
          }
        ),
        this.createRangeInput(
          i18n.t('ui.settingsPanel.labels.gridStep'),
          this.options.scene.grid.step,
          1,
          100,
          1,
          (value) => {
            this.options.scene.grid.step = value;
          }
        ),
        this.createColorInput(i18n.t('ui.settingsPanel.labels.gridColor'), this.options.scene.grid.color, (value) => {
          this.options.scene.grid.color = value;
        }),
        this.createRangeInput(
          i18n.t('ui.settingsPanel.labels.gridOpacity'),
          this.options.scene.grid.opacity,
          0.1,
          1,
          0.1,
          (value) => {
            this.options.scene.grid.opacity = value;
          }
        ),
        this.createColorInput(
          i18n.t('ui.settingsPanel.labels.sectionColor'),
          this.options.scene.sections.color,
          (value) => {
            this.options.scene.sections.color = value;
          }
        ),
        this.createRangeInput(
          i18n.t('ui.settingsPanel.labels.sectionSize'),
          this.options.scene.sections.width,
          0.1,
          32,
          0.1,
          (value) => {
            this.options.scene.sections.width = value;
          }
        ),
        // Column 1:
        this.createCompactCheckboxGroup([
          this.createCheckbox(
            i18n.t('ui.settingsPanel.labels.startPoint'),
            this.options.scene.startPoints.show,
            (value) => {
              this.options.scene.startPoints.show = value;
            }
          ),
          this.createCheckbox(
            i18n.t('ui.settingsPanel.labels.targetPoint'),
            this.options.scene.camera.target.show,
            (value) => {
              this.options.scene.camera.target.show = value;
            }
          ),
          this.createCheckbox(
            i18n.t('ui.settingsPanel.labels.sectionsLabel'),
            this.options.scene.sections.labels.show,
            (value) => {
              this.options.scene.sections.labels.show = value;
            }
          )
        ])
      ],
      true
    );

    this.createSection(
      '🅰️ ' + i18n.t('ui.settingsPanel.sections.attributes'),
      [
        this.createColorInput(
          i18n.t('ui.settingsPanel.labels.labelColor'),
          this.options.scene.sections.labels.color,
          (value) => {
            this.options.scene.sections.labels.color = value;
          }
        ),
        this.createColorInput(
          i18n.t('ui.settingsPanel.labels.labelStrokeColor'),
          this.options.scene.sections.labels.strokeColor,
          (value) => {
            this.options.scene.sections.labels.strokeColor = value;
          }
        ),

        this.createRangeInput(
          i18n.t('ui.settingsPanel.labels.labelSize'),
          this.options.scene.sections.labels.size,
          1,
          32,
          1,
          (value) => {
            this.options.scene.sections.labels.size = value;
          }
        ),

        this.createRangeInput(
          i18n.t('ui.settingsPanel.labels.stationIconScale'),
          this.options.scene.stationAttributes.iconScale,
          0.1,
          20,
          0.1,
          (value) => {
            this.options.scene.stationAttributes.iconScale = value;
          }
        ),
        this.createRangeInput(
          i18n.t('ui.settingsPanel.labels.circleOpacity'),
          this.options.scene.attributes.tectonic.circle.opacity,
          0.1,
          1,
          0.1,
          (value) => {
            this.options.scene.attributes.tectonic.circle.opacity = value;
          }
        )
      ],
      true
    );

    this.createStationDetailsSection(
      'ⓘ ' + i18n.t('ui.settingsPanel.sections.stationDetails'),
      [
        // Column 1: Core names
        this.createCompactCheckboxGroup([
          this.createCheckbox(
            i18n.t('ui.settingsPanel.labels.caveName'),
            this.options.ui.stationDetails.caveName,
            (value) => {
              this.options.ui.stationDetails.caveName = value;
            }
          ),
          this.createCheckbox(
            i18n.t('ui.settingsPanel.labels.surveyName'),
            this.options.ui.stationDetails.surveyName,
            (value) => {
              this.options.ui.stationDetails.surveyName = value;
            }
          ),
          this.createCheckbox(
            i18n.t('ui.settingsPanel.labels.stationName'),
            this.options.ui.stationDetails.stationName,
            (value) => {
              this.options.ui.stationDetails.stationName = value;
            }
          )
        ]),
        // Column 2: Local coordinates
        this.createCompactCheckboxGroup([
          this.createCheckbox(
            i18n.t('ui.settingsPanel.labels.xCoordinate'),
            this.options.ui.stationDetails.xCoordinate,
            (value) => {
              this.options.ui.stationDetails.xCoordinate = value;
            }
          ),
          this.createCheckbox(
            i18n.t('ui.settingsPanel.labels.yCoordinate'),
            this.options.ui.stationDetails.yCoordinate,
            (value) => {
              this.options.ui.stationDetails.yCoordinate = value;
            }
          ),
          this.createCheckbox(
            i18n.t('ui.settingsPanel.labels.zCoordinate'),
            this.options.ui.stationDetails.zCoordinate,
            (value) => {
              this.options.ui.stationDetails.zCoordinate = value;
            }
          )
        ]),
        // Column 3: EOV and UTMcoordinates
        this.createCompactCheckboxGroup([
          this.createCheckbox(i18n.t('ui.settingsPanel.labels.eovY'), this.options.ui.stationDetails.eovY, (value) => {
            this.options.ui.stationDetails.eovY = value;
          }),
          this.createCheckbox(i18n.t('ui.settingsPanel.labels.eovX'), this.options.ui.stationDetails.eovX, (value) => {
            this.options.ui.stationDetails.eovX = value;
          }),
          this.createCheckbox(
            i18n.t('ui.settingsPanel.labels.utmEasting'),
            this.options.ui.stationDetails.utmEasting,
            (value) => {
              this.options.ui.stationDetails.utmEasting = value;
            }
          ),
          this.createCheckbox(
            i18n.t('ui.settingsPanel.labels.utmNorthing'),
            this.options.ui.stationDetails.utmNorthing,
            (value) => {
              this.options.ui.stationDetails.utmNorthing = value;
            }
          ),

          this.createCheckbox(
            i18n.t('ui.settingsPanel.labels.elevation'),
            this.options.ui.stationDetails.elevation,
            (value) => {
              this.options.ui.stationDetails.elevation = value;
            }
          )
        ]),
        // Column 4: Other options
        this.createCompactCheckboxGroup([
          this.createCheckbox(i18n.t('ui.settingsPanel.labels.type'), this.options.ui.stationDetails.type, (value) => {
            this.options.ui.stationDetails.type = value;
          }),
          this.createCheckbox(
            i18n.t('ui.settingsPanel.labels.position'),
            this.options.ui.stationDetails.position,
            (value) => {
              this.options.ui.stationDetails.position = value;
            }
          ),
          this.createCheckbox(
            i18n.t('ui.settingsPanel.labels.shots'),
            this.options.ui.stationDetails.shots,
            (value) => {
              this.options.ui.stationDetails.shots = value;
            }
          ),
          this.createCheckbox(
            i18n.t('ui.settingsPanel.labels.comments'),
            this.options.ui.stationDetails.comments,
            (value) => {
              this.options.ui.stationDetails.comments = value;
            }
          ),
          this.createCheckbox(
            i18n.t('ui.settingsPanel.labels.attributes'),
            this.options.ui.stationDetails.attributes,
            (value) => {
              this.options.ui.stationDetails.attributes = value;
            }
          )
        ])
      ],
      true
    );

    // 3D Sprites Section
    this.createSection(
      '🎯 ' + i18n.t('ui.settingsPanel.sections.sprites3D'),
      [
        // Column 1: Main sprite groups
        this.createCompactCheckboxGroup([
          this.createCheckbox(
            i18n.t('ui.settingsPanel.labels.compass'),
            this.options.scene?.sprites3D?.compass?.show ?? true,
            (show) => {
              this.options.scene.sprites3D.compass.show = show;
            }
          ),
          this.createCheckbox(
            i18n.t('ui.settingsPanel.labels.ruler'),
            this.options.scene?.sprites3D?.ruler?.show ?? true,
            (show) => {
              this.options.scene.sprites3D.ruler.show = show;
            }
          ),
          this.createCheckbox(
            i18n.t('ui.settingsPanel.labels.dip'),
            this.options.scene?.sprites3D?.dip?.show ?? true,
            (show) => {
              this.options.scene.sprites3D.dip.show = show;
            }
          )
        ]),
        // Column 2: Other elements
        this.createCompactCheckboxGroup([
          this.createCheckbox(
            i18n.t('ui.settingsPanel.labels.logo'),
            this.options.scene?.sprites3D?.logo?.show ?? true,
            (show) => {
              this.options.scene.sprites3D.logo.show = show;
            }
          ),
          this.createCheckbox(
            i18n.t('ui.settingsPanel.labels.viewHelper'),
            this.options.scene?.sprites3D?.viewHelper?.show ?? true,
            (show) => {
              this.options.scene.sprites3D.viewHelper.show = show;
            }
          )
        ]),
        // Column 3: Text styling
        this.createColorInput(
          i18n.t('ui.settingsPanel.labels.textColor'),
          this.options.scene?.sprites3D?.textColor ?? '#ffffff',
          (color) => {
            this.options.scene.sprites3D.textColor = color;
          }
        ),
        this.createColorInput(
          i18n.t('ui.settingsPanel.labels.textStroke'),
          this.options.scene?.sprites3D?.textStroke ?? '#000000',
          (strokeColor) => {
            this.options.scene.sprites3D.textStroke = strokeColor;
          }
        )
      ],
      true
    );

    // Color Gradient Section
    this.createColorGradientSection();
  }

  createSection(title, items, collapsed = false) {
    const section = document.createElement('div');
    section.className = 'settings-group';

    const titleElement = document.createElement('h3');
    titleElement.className = 'settings-group-title';
    titleElement.innerHTML = `
      <span class="settings-group-toggle">${collapsed ? '▶' : '▼'}</span>
      <span>${title}</span>
    `;
    titleElement.onclick = () => this.toggleSection(section);
    section.appendChild(titleElement);

    const content = document.createElement('div');
    content.className = 'settings-group-content';
    if (collapsed) {
      content.style.display = 'none';
    }

    items.forEach((item) => {
      content.appendChild(item);
    });

    section.appendChild(content);
    this.container.appendChild(section);
  }

  createStationDetailsSection(title, items, collapsed = false) {
    const section = document.createElement('div');
    section.className = 'settings-group';

    const titleElement = document.createElement('h3');
    titleElement.className = 'settings-group-title';
    titleElement.innerHTML = `
      <span class="settings-group-toggle">${collapsed ? '▶' : '▼'}</span>
      <span>${title}</span>
    `;
    titleElement.onclick = () => this.toggleSection(section);
    section.appendChild(titleElement);

    const content = document.createElement('div');
    content.className = 'settings-group-content compact-layout';
    if (collapsed) {
      content.style.display = 'none';
    }

    items.forEach((item) => {
      content.appendChild(item);
    });

    section.appendChild(content);
    this.container.appendChild(section);
  }

  createCompactCheckboxGroup(checkboxes) {
    const container = document.createElement('div');
    container.className = 'compact-checkbox-group';

    checkboxes.forEach((checkbox) => {
      container.appendChild(checkbox);
    });

    return container;
  }

  toggleSection(section) {
    const content = section.querySelector('.settings-group-content');
    const toggle = section.querySelector('.settings-group-toggle');

    if (content.style.display === 'none') {
      content.style.display = 'block';
      toggle.textContent = '▼';
    } else {
      content.style.display = 'none';
      toggle.textContent = '▶';
    }
  }

  createCheckbox(label, value, onChange) {
    const container = document.createElement('div');
    container.className = 'settings-item';

    const checkboxContainer = document.createElement('div');
    checkboxContainer.className = 'settings-checkbox-container';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'settings-input';
    input.checked = value;
    input.onchange = (e) => onChange(e.target.checked);

    const labelElement = document.createElement('label');
    labelElement.className = 'settings-checkbox-label';
    labelElement.textContent = label;

    checkboxContainer.appendChild(input);
    checkboxContainer.appendChild(labelElement);
    container.appendChild(checkboxContainer);

    return container;
  }

  createSelect(label, options, currentValue, onChange) {
    const container = document.createElement('div');
    container.className = 'settings-item';

    const labelElement = document.createElement('label');
    labelElement.className = 'settings-label';
    labelElement.textContent = label;

    const select = document.createElement('select');
    select.className = 'settings-input';
    select.onchange = (e) => onChange(e.target.value);

    // Create option elements for each option
    options.forEach((value) => {
      const optionElement = document.createElement('option');
      optionElement.value = value;
      optionElement.textContent = value;
      select.appendChild(optionElement);
    });

    container.appendChild(labelElement);
    container.appendChild(select);

    select.querySelectorAll('option').forEach((option) => {
      if (option.value === currentValue) {
        option.selected = true;
      }
    });

    return container;
  }

  createColorInput(label, value, onChange) {
    const container = document.createElement('div');
    container.className = 'settings-item';

    const labelElement = document.createElement('label');
    labelElement.className = 'settings-label';
    labelElement.textContent = label;

    const input = document.createElement('input');
    input.type = 'color';
    input.className = 'settings-input';
    input.value = value;
    input.onchange = (e) => onChange(e.target.value);

    container.appendChild(labelElement);
    container.appendChild(input);

    return container;
  }

  createRangeInput(label, value, min, max, step, onChange) {
    const container = document.createElement('div');
    container.className = 'settings-item';

    const labelElement = document.createElement('label');
    labelElement.className = 'settings-label';
    labelElement.textContent = label;

    const rangeContainer = document.createElement('div');
    rangeContainer.className = 'settings-range-container';

    const valueDisplay = document.createElement('input');
    const input = document.createElement('input');
    input.type = 'range';
    input.className = 'settings-range';
    input.min = min;
    input.max = max;
    input.step = step;
    input.value = value;
    input.oninput = (e) => {
      const newValue = parseFloat(e.target.value);
      valueDisplay.value = newValue.toFixed(1);
    };
    input.onchange = (e) => {
      const newValue = parseFloat(e.target.value);
      onChange(newValue);
      valueDisplay.value = newValue.toFixed(1);
    };

    valueDisplay.onchange = (e) => {
      const newValue = parseFloat(e.target.value);
      if (!isNaN(newValue) && newValue >= min && newValue <= max) {
        onChange(newValue);
        input.value = newValue;
      } else {
        // Reset to current value if invalid input
        valueDisplay.value = value.toFixed(1);
      }
    };

    valueDisplay.type = 'number';
    valueDisplay.className = 'settings-range-value';
    valueDisplay.value = value.toFixed(1);
    valueDisplay.min = min;
    valueDisplay.max = max;
    valueDisplay.step = step;
    valueDisplay.style.width = '60px';
    valueDisplay.style.textAlign = 'center';

    rangeContainer.appendChild(input);
    rangeContainer.appendChild(valueDisplay);

    container.appendChild(labelElement);
    container.appendChild(rangeContainer);

    return container;
  }

  createSubGroup(title, items, visibilityKey = null, onVisibilityChange = null) {
    const subGroup = document.createElement('div');
    subGroup.className = 'settings-subgroup';

    const titleElement = document.createElement('h4');
    titleElement.className = 'settings-subgroup-title';

    // Create title with eye icon if visibility control is needed
    if (visibilityKey && onVisibilityChange) {
      const titleSpan = document.createElement('span');
      titleSpan.textContent = title;

      const eyeIcon = document.createElement('span');
      eyeIcon.className = 'visibility-toggle';
      eyeIcon.textContent = '👁️';
      eyeIcon.style.cursor = 'pointer';
      eyeIcon.style.fontSize = '14px';

      // Set initial state based on visibility
      if (visibilityKey.show === false) {
        eyeIcon.innerHTML = '<span class="eye-strikethrough">👁️</span>';
      } else {
        eyeIcon.innerHTML = '👁️';
      }

      eyeIcon.onclick = (e) => {
        e.stopPropagation();
        const newValue = !visibilityKey.show;
        visibilityKey.show = newValue;
        onVisibilityChange(newValue);

        // Update icon appearance
        if (newValue) {
          eyeIcon.innerHTML = '👁️';
        } else {
          eyeIcon.innerHTML = '<span class="eye-strikethrough">👁️</span>';
        }
      };

      titleElement.appendChild(titleSpan);
      titleElement.appendChild(eyeIcon);
    } else {
      titleElement.textContent = title;
    }

    subGroup.appendChild(titleElement);

    const content = document.createElement('div');
    content.className = 'settings-subgroup-content';
    items.forEach((item) => {
      content.appendChild(item);
    });
    subGroup.appendChild(content);

    return subGroup;
  }

  createButton(label, onClick) {
    const button = document.createElement('button');
    button.className = 'settings-button';
    button.textContent = label;
    button.onclick = onClick;
    return button;
  }

  createButtonRow(buttons) {
    const container = document.createElement('div');
    container.className = 'config-buttons-container';
    buttons.forEach((button) => {
      container.appendChild(button);
    });
    return container;
  }

  createColorGradientSection(collapsed = true) {
    const section = document.createElement('div');
    section.className = 'settings-group';

    const titleElement = document.createElement('h3');
    titleElement.className = 'settings-group-title';
    titleElement.innerHTML = `
      <span class="settings-group-toggle">${collapsed ? '▶' : '▼'}</span>
      <span>🌈 ${i18n.t('ui.settingsPanel.sections.colorGradient')}</span>
    `;
    titleElement.onclick = () => this.toggleSection(section);
    section.appendChild(titleElement);

    const content = document.createElement('div');
    content.className = 'settings-group-content';
    if (collapsed) {
      content.style.display = 'none';
    }

    const addButton = document.createElement('button');
    addButton.className = 'settings-input settings-add-button';
    addButton.textContent = i18n.t('ui.settingsPanel.labels.addColorStop');
    addButton.onclick = () => this.addGradientColor();
    content.appendChild(addButton);

    this.renderGradientColors(content);

    section.appendChild(content);
    this.container.appendChild(section);
  }

  renderGradientColors(container) {
    // Remove existing gradient color controls
    const existingControls = container.querySelectorAll('.gradient-color-control');
    existingControls.forEach((control) => control.remove());

    // Add controls for each gradient color
    this.options.scene.caveLines.color.gradientColors.forEach((gradientColor, index) => {
      const control = this.createGradientColorControl(gradientColor, index);
      container.appendChild(control);
    });
  }

  createGradientColorControl(gradientColor, index) {
    const container = document.createElement('div');
    container.className = 'gradient-color-control settings-item';

    // Create a compact row with depth and color
    const controlsRow = document.createElement('div');
    controlsRow.style.display = 'flex';
    controlsRow.style.gap = '8px';
    controlsRow.style.alignItems = 'end';

    // Depth input
    const depthContainer = document.createElement('div');
    depthContainer.style.flex = '1';

    const depthLabel = document.createElement('label');
    depthLabel.className = 'settings-label';
    depthLabel.textContent = i18n.t('ui.settingsPanel.labels.depth');

    const depthInput = document.createElement('input');
    depthInput.type = 'number';
    depthInput.className = 'settings-input';
    depthInput.value = gradientColor.depth;
    depthInput.min = 0;
    depthInput.max = 100;
    depthInput.style.padding = '4px 6px';
    depthInput.style.marginLeft = '8px';
    depthInput.onchange = (e) => {
      gradientColor.depth = parseFloat(e.target.value);
      const colors = [...this.options.scene.caveLines.color.gradientColors];
      colors.sort((a, b) => a.depth - b.depth);
      this.options.scene.caveLines.color.gradientColors = [...colors]; // trigger a change event
      this.reloadGradientSection();
    };

    depthContainer.appendChild(depthLabel);
    depthContainer.appendChild(depthInput);
    controlsRow.appendChild(depthContainer);

    // Color input
    const colorContainer = document.createElement('div');
    colorContainer.style.width = '60px';

    const colorLabel = document.createElement('label');
    colorLabel.className = 'settings-label';
    colorLabel.textContent = i18n.t('ui.settingsPanel.labels.color');

    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.className = 'settings-input';
    colorInput.value = gradientColor.color;
    colorInput.style.height = '24px';
    colorInput.style.padding = '2px';
    colorInput.onchange = (e) => {
      const colors = [...this.options.scene.caveLines.color.gradientColors];
      const item = colors.find((color) => color.depth === gradientColor.depth);
      colors.splice(colors.indexOf(item), 1, { ...item, color: e.target.value });
      this.options.scene.caveLines.color.gradientColors = [...colors]; // trigger a change event
    };

    colorContainer.appendChild(colorLabel);
    colorContainer.appendChild(colorInput);
    controlsRow.appendChild(colorContainer);

    container.appendChild(controlsRow);

    const removeButton = document.createElement('button');
    removeButton.textContent = i18n.t('ui.settingsPanel.labels.remove');
    removeButton.style.background = '#dc2626';
    removeButton.style.color = 'white';
    removeButton.style.border = 'none';
    removeButton.style.cursor = 'pointer';
    removeButton.style.borderRadius = '4px';
    removeButton.onclick = () => this.removeGradientColor(index);
    controlsRow.appendChild(removeButton);

    return container;
  }

  addGradientColor() {
    const maxDepth = Math.max(...this.options.scene.caveLines.color.gradientColors.map((gc) => gc.depth));
    const newColor = { depth: Math.min(maxDepth + 25, 100), color: '#ffffff' };
    const colors = [...this.options.scene.caveLines.color.gradientColors];
    colors.push(newColor);
    colors.sort((a, b) => a.depth - b.depth);
    this.options.scene.caveLines.color.gradientColors = [...colors]; // trigger a change event
    this.reloadGradientSection();
  }

  removeGradientColor(index) {
    if (this.options.scene.caveLines.color.gradientColors.length > 2) {
      const colors = [...this.options.scene.caveLines.color.gradientColors];
      colors.splice(index, 1); // splicing the original array and then settings the value would NOT trigger a change event
      this.options.scene.caveLines.color.gradientColors = [...colors]; // trigger a change event
      this.reloadGradientSection();
    }
  }

  reloadGradientSection() {
    const gradientSection = this.container.querySelector('.settings-group:last-child .settings-group-content');
    if (gradientSection) {
      this.renderGradientColors(gradientSection);
    }
  }

  updateOptions(newOptions) {
    this.options = newOptions;
    this.render();
  }

  downloadConfig() {
    ConfigManager.downloadConfig(this.options);
  }

  loadConfig() {
    document.getElementById('configInput').click();
  }

  resetConfig() {
    if (confirm(i18n.t('ui.settingsPanel.confirm.resetConfig'))) {
      const defaultConfig = ConfigManager.getDefaults();
      if (!this.options.isDefault) {
        ConfigManager.clear();
        ConfigManager.deepMerge(this.options, defaultConfig);
      }
      this.render();
    }
  }
}
