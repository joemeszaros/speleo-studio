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
        this.createButton(i18n.t('ui.settingsPanel.buttons.download'), () => {
          this.downloadConfig();
        }),
        this.createButton(i18n.t('ui.settingsPanel.buttons.load'), () => {
          this.loadConfig();
        }),
        this.createButton(i18n.t('ui.settingsPanel.buttons.reset'), () => {
          this.resetConfig();
        })
      ])
    );

    // Print Layout Section
    this.createSection(
      i18n.t('ui.settingsPanel.sections.print'),
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
    this.createSection(i18n.t('ui.settingsPanel.sections.surveyLines'), [
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
          )
        ],
        this.options.scene.auxiliaries.segments,
        (value) => {
          this.options.scene.auxiliaries.segments.show = value;
        }
      )
    ]);

    // Stations Section (collapsed by default)
    this.createSection(
      i18n.t('ui.settingsPanel.sections.stations'),
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
              2,
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
              2,
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
              2,
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
        ),

        // General Station Settings Group
        this.createSubGroup(i18n.t('ui.settingsPanel.groups.generalSettings'), [
          this.createRangeInput(
            i18n.t('ui.settingsPanel.labels.stationIconScale'),
            this.options.scene.stationAttributes.iconScale,
            0.1,
            3,
            0.1,
            (value) => {
              this.options.scene.stationAttributes.iconScale = value;
            }
          )
        ])
      ],
      true
    );

    // Appearance Section
    this.createSection(
      i18n.t('ui.settingsPanel.sections.appearance'),
      [
        this.createColorInput(
          i18n.t('ui.settingsPanel.labels.backgroundColor'),
          this.options.scene.background.color,
          (value) => {
            this.options.scene.background.color = value;
          }
        ),
        this.createColorInput(
          i18n.t('ui.settingsPanel.labels.labelColor'),
          this.options.scene.labels.color,
          (value) => {
            this.options.scene.labels.color = value;
          }
        ),
        this.createRangeInput(
          i18n.t('ui.settingsPanel.labels.labelSize'),
          this.options.scene.labels.size,
          8,
          32,
          1,
          (value) => {
            this.options.scene.labels.size = value;
          }
        ),
        this.createColorInput(
          i18n.t('ui.settingsPanel.labels.sectionColor'),
          this.options.scene.sectionAttributes.color,
          (value) => {
            this.options.scene.sectionAttributes.color = value;
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
        eyeIcon.style.opacity = '0.3';
        eyeIcon.textContent = '👁️‍🗨️';
      }

      eyeIcon.onclick = (e) => {
        e.stopPropagation();
        const newValue = !visibilityKey.show;
        visibilityKey.show = newValue;
        onVisibilityChange(newValue);

        // Update icon appearance
        if (newValue) {
          eyeIcon.style.opacity = '1';
          eyeIcon.textContent = '👁️';
        } else {
          eyeIcon.style.opacity = '0.3';
          eyeIcon.textContent = '👁️‍🗨️';
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
      <span>${i18n.t('ui.settingsPanel.sections.colorGradient')}</span>
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
      this.options.scene.caveLines.color.gradientColors.sort((a, b) => a.depth - b.depth);
      this.options.scene.caveLines.color.gradientColors = [...this.options.scene.caveLines.color.gradientColors]; // trigger a change event
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
      gradientColor.color = e.target.value;
      this.options.scene.caveLines.color.gradientColors = [...this.options.scene.caveLines.color.gradientColors]; // trigger a change event
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
    this.options.scene.caveLines.color.gradientColors.push(newColor);
    this.options.scene.caveLines.color.gradientColors.sort((a, b) => a.depth - b.depth);
    this.options.scene.caveLines.color.gradientColors = [...this.options.scene.caveLines.color.gradientColors]; // trigger a change event
    this.reloadGradientSection();
  }

  removeGradientColor(index) {
    if (this.options.scene.caveLines.color.gradientColors.length > 2) {
      this.options.scene.caveLines.color.gradientColors.splice(index, 1);
      this.options.scene.caveLines.color.gradientColors = [...this.options.scene.caveLines.color.gradientColors]; // trigger a change event
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
      ConfigManager.clear();
      const loadedConfig = ConfigManager.loadOrDefaults();
      ConfigManager.deepMerge(this.options, loadedConfig);
      this.options.print.layout = 'portrait';
      this.render();
    }
  }
}
