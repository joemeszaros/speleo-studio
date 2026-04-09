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

import { i18n } from '../i18n/i18n.js';
import { degreesToRads, parseMyFloat, radsToDegrees, formatBytes } from '../utils/utils.js';
import * as U from '../utils/utils.js';
import { TextureFile } from '../model.js';
import { ModelSheetEditor } from './editor/model-sheet.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import * as THREE from 'three';

/**
 * ModelsTree - UI component for managing 3D models in the sidebar
 * Provides a tree structure with visibility controls and property editing
 */
export class ModelsTree {
  constructor(
    db,
    options,
    scene,
    treeContainer,
    propertiesContainer,
    contextMenu,
    textureInput,
    modelSystem,
    projectSystem
  ) {
    this.db = db;
    this.options = options;
    this.scene = scene;
    this.treeContainer = treeContainer;
    this.propertiesContainer = propertiesContainer;
    this.contextMenu = contextMenu;
    this.textureInput = textureInput;
    this.modelSystem = modelSystem;
    this.projectSystem = projectSystem;

    // Node structure: categories contain model nodes
    this.categories = new Map();
    this.selectedNode = null;
    this.expandedCategories = new Set(['3d-models']); // Expanded by default
    this.propertiesPanelExpanded = true; // Properties panel expanded by default
    this._saveTimers = new Map(); // modelFileId -> debounce timeout

    document.addEventListener('languageChanged', () => {
      this.render();
      this.renderPropertiesPanel();
    });
    document.addEventListener('click', (e) => this.handleOutsideClick(e));

    this.setupTextureInput();
    this.initializeCategories();
    this.render();
    this.renderPropertiesPanel();
  }

  /**
   * Setup the texture file input handler
   */
  setupTextureInput() {
    if (!this.textureInput) return;

    this.textureInput.addEventListener('change', async (e) => {
      const files = Array.from(e.target.files);
      if (files.length === 0) return;

      const targetNode = this.textureInput.targetModelNode;
      if (!targetNode) return;

      await this.loadTexturesForModel(targetNode, files);
      this.textureInput.value = ''; // Reset input
      this.textureInput.targetModelNode = null;
    });
  }

  /**
   * Initialize the category structure
   * Currently supports 3D Models, with future support for SVG planned
   */
  initializeCategories() {
    this.categories.set('3d-models', {
      id       : '3d-models',
      type     : 'category',
      label    : () => i18n.t('ui.models.categories.models3d'),
      icon     : '🌐',
      children : [],
      expanded : true
    });

    // Future: SVG category
    // this.categories.set('svg-files', {
    //   id: 'svg-files',
    //   type: 'category',
    //   label: () => i18n.t('ui.models.categories.svgFiles'),
    //   icon: '🖼️',
    //   children: [],
    //   expanded: true
    // });
  }

  /**
   * Add a 3D model to the tree
   * @param {Object} model - The model data object
   * @param {THREE.Object3D} object3D - The Three.js object
   */
  addModel(model, object3D, modelFileId = null, savedSettings = null) {
    const category = this.categories.get('3d-models');
    if (!category || !model || !object3D) return null;

    const modelNode = {
      id          : `model-${model.name}`,
      type        : 'model',
      label       : model.name,
      data        : model,
      object3D    : object3D,
      parent      : category,
      visible     : true,
      modelFileId : modelFileId,
      transform   : {}
    };

    if (savedSettings?.transform) {
      // Restore saved transform
      modelNode.transform = savedSettings.transform;
      modelNode.opacity = savedSettings.opacity ?? 1.0;
      modelNode.visible = savedSettings.visible ?? true;

      // Apply to Three.js object
      const t = savedSettings.transform;
      object3D.position.set(t.position.x, t.position.y, t.position.z);
      object3D.rotation.set(degreesToRads(t.rotation.x), degreesToRads(t.rotation.y), degreesToRads(t.rotation.z));
      object3D.scale.set(t.scale.x, t.scale.y, t.scale.z);
      object3D.visible = modelNode.visible;

      // Apply opacity to materials
      if (modelNode.opacity < 1) {
        object3D.traverse((child) => {
          if (child.material) {
            child.material.transparent = true;
            child.material.opacity = modelNode.opacity;
            child.material.needsUpdate = true;
          }
        });
      }
    } else {
      // Use defaults from the object3D
      modelNode.transform.position = {
        x : object3D.position.x,
        y : object3D.position.y,
        z : object3D.position.z
      };
      modelNode.transform.rotation = {
        x : radsToDegrees(object3D.rotation.x),
        y : radsToDegrees(object3D.rotation.y),
        z : radsToDegrees(object3D.rotation.z)
      };
      modelNode.transform.scale = {
        x : object3D.scale.x,
        y : object3D.scale.y,
        z : object3D.scale.z
      };
      modelNode.opacity = 1.0;
    }

    const wasEmpty = category.children.length === 0;
    category.children.push(modelNode);
    this.render();

    // Activate the models tab when the first model is added
    if (wasEmpty) {
      document.dispatchEvent(new CustomEvent('switchSidebarTab', { detail: { tab: 'models' } }));
    }

    return modelNode;
  }

  /**
   * Get all model names in the tree
   * @returns {string[]} Array of model names
   */
  getModelNames() {
    const category = this.categories.get('3d-models');
    if (!category) return [];
    return category.children.map((m) => m.label);
  }

  /**
   * Get all models with their coordinate systems
   * @returns {Array<{name: string, coordinateSystem: Object|undefined}>}
   */
  getModelsWithCoordinateSystems() {
    const category = this.categories.get('3d-models');
    if (!category) return [];
    return category.children
      .filter((m) => m.data?.geoData?.coordinateSystem !== undefined)
      .map((m) => ({ name: m.label, coordinateSystem: m.data.geoData.coordinateSystem }));
  }

  /**
   * Remove a model from the tree
   * @param {string} modelName - Name of the model to remove
   */
  removeModel(modelName) {
    const category = this.categories.get('3d-models');
    if (!category) return;

    const index = category.children.findIndex((m) => m.label === modelName);
    if (index !== -1) {
      const removedNode = category.children.splice(index, 1)[0];

      // Clear selection if this was selected
      if (this.selectedNode === removedNode) {
        this.selectedNode = null;
        this.renderPropertiesPanel();
      }

      this.render();
    }
  }

  /**
   * Dispatch a modelDeleted event for the manager to handle cleanup
   * @param {Object} node - The model tree node
   */
  /**
   * Toggle embed state of a model. Warns if model is large.
   * @param {Object} node - The model tree node
   */
  async toggleEmbed(node) {
    const newEmbedded = !node.embedded;

    // Warn if embedding a large model
    if (newEmbedded && node.modelFileId && this.modelSystem) {
      const threshold = this.options?.scene?.models?.embedSizeWarningThreshold ?? 5 * 1024 * 1024;
      try {
        const modelFile = await this.modelSystem.getModelFile(node.modelFileId);
        let totalSize = modelFile?.data instanceof Blob ? modelFile.data.size : 0;
        const textures = await this.modelSystem.getTextureFilesByModel(node.modelFileId);
        for (const tex of textures) {
          totalSize += tex.data instanceof Blob ? tex.data.size : 0;
        }
        if (totalSize > threshold) {
          const sizeStr = formatBytes(totalSize);
          const ok = confirm(i18n.t('ui.models.menu.embedLargeConfirm', { size: sizeStr }));
          if (!ok) return;
        }
      } catch (err) {
        console.warn('Failed to check model size:', err);
      }
    }

    node.embedded = newEmbedded;

    document.dispatchEvent(
      new CustomEvent('modelChanged', {
        detail : {
          modelFileId : node.modelFileId,
          name        : node.label,
          embedded    : newEmbedded
        }
      })
    );

    this.render();
  }

  dispatchModelDeleted(node) {
    // Remove from in-memory database
    this.db.deleteModel(node.label);

    document.dispatchEvent(
      new CustomEvent('modelDeleted', {
        detail : {
          name        : node.label,
          modelFileId : node.modelFileId
        }
      })
    );
  }

  /**
   * Clear all models from the tree UI.
   * Used when switching projects.
   */
  clear() {
    // Clear all children from 3d-models category
    const category = this.categories.get('3d-models');
    if (category) {
      category.children = [];
    }

    // Clear selection
    this.selectedNode = null;

    // Re-render
    this.render();
    this.renderPropertiesPanel();
  }

  /**
   * Toggle category expansion
   * @param {string} categoryId - The category ID
   */
  toggleCategoryExpansion(categoryId) {
    const category = this.categories.get(categoryId);
    if (!category) return;

    category.expanded = !category.expanded;
    if (category.expanded) {
      this.expandedCategories.add(categoryId);
    } else {
      this.expandedCategories.delete(categoryId);
    }
    this.render();
  }

  /**
   * Toggle model visibility
   * @param {string} nodeId - The node ID
   */
  toggleVisibility(nodeId) {
    const node = this.findNodeById(nodeId);
    if (!node) return;

    node.visible = !node.visible;

    // Update the Three.js object visibility
    if (node.object3D) {
      node.object3D.visible = node.visible;
      this.scene.view.renderView();
    }

    this.render();
    this._scheduleSave(node);
  }

  /**
   * Select a node
   * @param {string} nodeId - The node ID
   */
  selectNode(nodeId) {
    // Deselect previous
    if (this.selectedNode) {
      this.selectedNode.selected = false;
    }

    const node = this.findNodeById(nodeId);
    if (node && node.type === 'model') {
      node.selected = true;
      this.selectedNode = node;
    } else {
      this.selectedNode = null;
    }

    this.render();
    this.renderPropertiesPanel();
  }

  /**
   * Find a node by ID
   * @param {string} nodeId - The node ID
   * @returns {Object|null} The node or null
   */
  findNodeById(nodeId) {
    for (const [, category] of this.categories) {
      if (category.id === nodeId) return category;
      const model = category.children.find((m) => m.id === nodeId);
      if (model) return model;
    }
    return null;
  }

  /**
   * Update model transform
   * @param {string} property - 'position', 'rotation', or 'scale'
   * @param {string} axis - 'x', 'y', or 'z'
   * @param {number} value - The new value
   */
  updateTransform(property, axis, value) {
    if (!this.selectedNode || this.selectedNode.type !== 'model') return;

    const numValue = parseMyFloat(value);
    if (isNaN(numValue)) return;

    this.selectedNode.transform[property][axis] = numValue;

    // Apply to Three.js object
    if (this.selectedNode.object3D) {
      if (property === 'position') {
        this.selectedNode.object3D.position[axis] = numValue;
      } else if (property === 'rotation') {
        this.selectedNode.object3D.rotation[axis] = degreesToRads(numValue);
      } else if (property === 'scale') {
        this.selectedNode.object3D.scale[axis] = numValue;
      }
      this.scene.view.renderView();
    }
    this._scheduleSave(this.selectedNode);
  }

  /**
   * Update model opacity
   * @param {number} value - Opacity value from 0 to 1
   */
  updateOpacity(value) {
    if (!this.selectedNode || this.selectedNode.type !== 'model') return;

    const numValue = parseMyFloat(value);
    if (isNaN(numValue)) return;

    this.selectedNode.opacity = Math.max(0, Math.min(1, numValue));

    // Apply to Three.js object materials
    if (this.selectedNode.object3D) {
      this.selectedNode.object3D.traverse((child) => {
        if (child.material) {
          child.material.transparent = this.selectedNode.opacity < 1;
          child.material.opacity = this.selectedNode.opacity;
          child.material.needsUpdate = true;
        }
      });
    }

    this.scene.view.renderView();
    this._scheduleSave(this.selectedNode);
  }

  /**
   * Debounced save of model properties to IndexedDB
   * @param {Object} node - The model node
   */
  _scheduleSave(node) {
    if (!node?.modelFileId || !this.modelSystem || !this.projectSystem) return;

    const existing = this._saveTimers.get(node.modelFileId);
    if (existing) clearTimeout(existing);

    this._saveTimers.set(
      node.modelFileId,
      setTimeout(() => {
        this._saveTimers.delete(node.modelFileId);
        const currentProject = this.projectSystem.getCurrentProject();
        if (!currentProject) return;

        this.modelSystem
          .saveModelFileSettings(node.modelFileId, currentProject.id, {
            transform : node.transform,
            opacity   : node.opacity,
            visible   : node.visible
          }).then(() => this.projectSystem.saveProject(currentProject))
          .catch((err) => console.error('Failed to persist model properties:', err));
      }, 500)
    );
  }

  /**
   * Render the tree
   */
  render() {
    this.treeContainer.innerHTML = '';

    const treeContent = document.createElement('div');
    treeContent.className = 'models-tree-content';

    const category = this.categories.get('3d-models');
    if (category && category.children.length > 0) {
      category.children.forEach((child) => {
        this.renderModelNode(child, treeContent);
      });
    } else {
      const emptyState = document.createElement('div');
      emptyState.className = 'models-tree-empty';
      emptyState.textContent = i18n.t('ui.models.noModels');
      treeContent.appendChild(emptyState);
    }

    this.treeContainer.appendChild(treeContent);
  }

  /**
   * Render a model node
   */
  renderModelNode(node, container) {
    const nodeElement = document.createElement('div');
    nodeElement.className = `models-tree-node ${node.selected ? 'selected' : ''}`;
    nodeElement.setAttribute('data-node-id', node.id);

    // Model icon
    const icon = document.createElement('span');
    icon.className = 'models-tree-node-icon';
    icon.textContent = '🗿';
    nodeElement.appendChild(icon);

    // Label
    const label = document.createElement('span');
    label.className = 'models-tree-node-label';
    label.textContent = node.label;
    nodeElement.appendChild(label);

    // Embedded indicator
    if (node.embedded) {
      const embedIcon = document.createElement('span');
      embedIcon.className = 'models-tree-embed-icon';
      embedIcon.textContent = '🔗';
      embedIcon.title = i18n.t('ui.models.menu.embedded');
      nodeElement.appendChild(embedIcon);
    }

    // Left-click to select and hide context menu
    nodeElement.onclick = (e) => {
      e.stopPropagation();
      this.hideContextMenu();
      this.selectNode(node.id);
    };

    // Right-click to show context menu
    nodeElement.oncontextmenu = (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.selectNode(node.id);
      this.showModelContextMenu(node);
    };

    // Visibility toggle
    const visibility = document.createElement('div');
    visibility.className = `models-tree-visibility ${node.visible ? 'visible' : 'hidden'}`;
    if (node.visible) {
      visibility.innerHTML = '👁️';
    } else {
      visibility.innerHTML = '<span class="eye-strikethrough">👁️</span>';
    }
    visibility.onclick = (e) => {
      e.stopPropagation();
      this.toggleVisibility(node.id);
    };
    nodeElement.appendChild(visibility);

    container.appendChild(nodeElement);
  }

  /**
   * Toggle properties panel expansion
   */
  togglePropertiesPanel() {
    this.propertiesPanelExpanded = !this.propertiesPanelExpanded;
    this.renderPropertiesPanel();
  }

  /**
   * Render the properties panel
   */
  renderPropertiesPanel() {
    this.propertiesContainer.innerHTML = '';

    const panel = document.createElement('div');
    panel.className = 'models-properties-panel';

    // Collapsible Header
    const header = document.createElement('div');
    header.className = 'models-properties-header';

    const toggle = document.createElement('span');
    toggle.className = 'models-properties-toggle';
    toggle.textContent = this.propertiesPanelExpanded ? '▼' : '▶';
    header.appendChild(toggle);

    const title = document.createElement('span');
    title.className = 'models-properties-title';
    title.textContent = i18n.t('ui.models.properties.title');
    header.appendChild(title);

    // Show file size in header when a model is selected
    if (this.selectedNode?.type === 'model') {
      const sizeLabel = document.createElement('span');
      sizeLabel.className = 'models-properties-header-size';
      sizeLabel.textContent = '...';
      header.appendChild(sizeLabel);
      this.computeModelFileSize(this.selectedNode).then((size) => {
        sizeLabel.textContent = size;
      });
    }

    header.onclick = () => this.togglePropertiesPanel();
    panel.appendChild(header);

    // Content wrapper (for collapse animation)
    const contentWrapper = document.createElement('div');
    contentWrapper.className = `models-properties-content-wrapper ${this.propertiesPanelExpanded ? '' : 'collapsed'}`;

    // Content
    const content = document.createElement('div');
    content.className = 'models-properties-content';

    if (!this.selectedNode || this.selectedNode.type !== 'model') {
      // No selection state
      const noSelection = document.createElement('div');
      noSelection.className = 'models-properties-empty';
      noSelection.textContent = i18n.t('ui.models.properties.noSelection');
      content.appendChild(noSelection);
    } else {
      // Show transform controls
      content.appendChild(
        this.createTransformSection('position', i18n.t('ui.models.properties.position'), 'x', 'y', 'z')
      );
      content.appendChild(
        this.createTransformSection('rotation', i18n.t('ui.models.properties.rotation'), 'x', 'y', 'z', '°')
      );
      content.appendChild(this.createTransformSection('scale', i18n.t('ui.models.properties.scale'), 'x', 'y', 'z'));
      content.appendChild(this.createOpacitySection());
    }

    contentWrapper.appendChild(content);
    panel.appendChild(contentWrapper);
    this.propertiesContainer.appendChild(panel);
  }

  /**
   * Create a transform section (position, rotation, or scale)
   */
  createTransformSection(property, label, ...axes) {
    const suffix = axes.includes('°') ? '°' : '';
    const axisLabels = axes.filter((a) => a !== '°');

    const section = document.createElement('div');
    section.className = 'models-properties-section';

    const sectionLabel = document.createElement('div');
    sectionLabel.className = 'models-properties-section-label';
    sectionLabel.textContent = label;
    section.appendChild(sectionLabel);

    const inputs = document.createElement('div');
    inputs.className = 'models-properties-inputs';

    axisLabels.forEach((axis) => {
      const inputGroup = document.createElement('div');
      inputGroup.className = 'models-properties-input-group';

      const axisLabel = document.createElement('label');
      axisLabel.className = 'models-properties-axis-label';
      axisLabel.textContent = axis.toUpperCase() + (suffix ? suffix : '');
      inputGroup.appendChild(axisLabel);

      const input = document.createElement('input');
      input.type = 'number';
      input.className = 'models-properties-input';
      input.step = property === 'scale' ? '0.1' : '1';
      input.value = this.selectedNode.transform[property][axis].toFixed(2);

      input.onchange = (e) => {
        this.updateTransform(property, axis, e.target.value);
      };

      input.oninput = (e) => {
        this.updateTransform(property, axis, e.target.value);
      };

      inputGroup.appendChild(input);
      inputs.appendChild(inputGroup);
    });

    section.appendChild(inputs);
    return section;
  }

  /**
   * Create the opacity slider section
   */
  createOpacitySection() {
    const section = document.createElement('div');
    section.className = 'models-properties-section';

    const sectionLabel = document.createElement('div');
    sectionLabel.className = 'models-properties-section-label';
    sectionLabel.textContent = i18n.t('ui.models.properties.opacity');
    section.appendChild(sectionLabel);

    const sliderContainer = document.createElement('div');
    sliderContainer.className = 'models-properties-slider-container';

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'models-properties-slider';
    slider.min = '0';
    slider.max = '1';
    slider.step = '0.05';
    slider.value = this.selectedNode.opacity;

    const valueDisplay = document.createElement('input');
    valueDisplay.type = 'number';
    valueDisplay.className = 'models-properties-slider-value';
    valueDisplay.min = '0';
    valueDisplay.max = '1';
    valueDisplay.step = '0.05';
    valueDisplay.value = this.selectedNode.opacity.toFixed(2);

    slider.oninput = (e) => {
      const val = parseFloat(e.target.value);
      valueDisplay.value = val.toFixed(2);
      this.updateOpacity(val);
    };

    slider.onchange = (e) => {
      const val = parseFloat(e.target.value);
      valueDisplay.value = val.toFixed(2);
      this.updateOpacity(val);
    };

    valueDisplay.onchange = (e) => {
      const val = parseFloat(e.target.value);
      if (!isNaN(val) && val >= 0 && val <= 1) {
        slider.value = val;
        this.updateOpacity(val);
      } else {
        valueDisplay.value = this.selectedNode.opacity.toFixed(2);
      }
    };

    sliderContainer.appendChild(slider);
    sliderContainer.appendChild(valueDisplay);
    section.appendChild(sliderContainer);

    return section;
  }

  /**
   * Create a read-only section showing the model's file size (model + textures)
   */
  createSizeSection() {
    const section = document.createElement('div');
    section.className = 'models-properties-section';

    const sectionLabel = document.createElement('div');
    sectionLabel.className = 'models-properties-section-label';
    sectionLabel.textContent = i18n.t('ui.models.properties.size');
    section.appendChild(sectionLabel);

    const sizeValue = document.createElement('div');
    sizeValue.className = 'models-properties-size-value';
    sizeValue.textContent = '...';
    section.appendChild(sizeValue);

    // Load size asynchronously
    this.computeModelFileSize(this.selectedNode).then((size) => {
      sizeValue.textContent = size;
    });

    return section;
  }

  /**
   * Compute total file size of a model and its associated texture files
   * @param {Object} node - The model node
   * @returns {Promise<string>} Human-readable file size
   */
  async computeModelFileSize(node) {
    let totalBytes = 0;

    if (!this.modelSystem || !this.projectSystem) return formatBytes(0);

    const currentProject = this.projectSystem.getCurrentProject();
    if (!currentProject) return formatBytes(0);

    try {
      const modelFiles = await this.modelSystem.getModelFilesByProject(currentProject.id);
      const modelFile = modelFiles.find((f) => f.filename === node.label);

      if (modelFile) {
        if (modelFile.data instanceof Blob) totalBytes += modelFile.data.size;
        const textures = await this.modelSystem.getTextureFilesByModel(modelFile.id);
        for (const tex of textures) {
          if (tex.data instanceof Blob) totalBytes += tex.data.size;
        }
      }
    } catch (error) {
      console.warn('Failed to compute model file size:', error);
    }

    return U.formatBytes(totalBytes);
  }

  // ==================== Context Menu Methods ====================

  /**
   * Show context menu for a model node
   * @param {Object} node - The model node
   */
  showModelContextMenu(node) {
    if (!this.contextMenu) return;

    const items = [
      {
        icon    : '🔠',
        title   : i18n.t('ui.models.menu.sheet'),
        onclick : () => {
          this.hideContextMenu();
          const editor = new ModelSheetEditor(
            node,
            this.modelSystem,
            this.projectSystem,
            document.getElementById('fixed-size-editor'),
            this.db,
            this,
            this.options
          );
          editor.setupPanel();
          editor.show();
        }
      },
      {
        icon    : '🧶',
        title   : i18n.t('ui.models.menu.loadTextures'),
        onclick : () => {
          this.textureInput.targetModelNode = node;
          this.textureInput.click();
          this.hideContextMenu();
        }
      },
      {
        icon : node.embedded
          ? '<span style="text-decoration: line-through; text-decoration-color: red; text-decoration-thickness: 2px; transform: rotate(45deg); display: inline-block;">🔗</span>'
          : '🔗',
        title   : node.embedded ? i18n.t('ui.models.menu.unembed') : i18n.t('ui.models.menu.embed'),
        onclick : () => {
          this.hideContextMenu();
          this.toggleEmbed(node);
        }
      },
      {
        icon    : '🗑️',
        title   : i18n.t('ui.models.menu.delete'),
        onclick : () => {
          this.hideContextMenu();
          const result = confirm(i18n.t('ui.models.menu.deleteConfirm', { name: node.label }));
          if (result) {
            this.dispatchModelDeleted(node);
          }
        }
      }
    ];

    this.renderContextMenu(node, items);
  }

  /**
   * Render the context menu with given items
   * @param {Object} node - The node to position menu relative to
   * @param {Array} items - Menu items
   */
  renderContextMenu(node, items) {
    this.contextMenu.innerHTML = '';

    items.forEach((option) => {
      const optionElement = document.createElement('div');
      optionElement.className = 'context-menu-option';
      optionElement.innerHTML = option.icon;
      optionElement.title = option.title;
      optionElement.onclick = (e) => {
        e.stopPropagation();
        option.onclick();
      };
      this.contextMenu.appendChild(optionElement);
    });

    // Position the context menu relative to the selected node
    const element = this.treeContainer.querySelector(`[data-node-id="${node.id}"]`);
    if (element) {
      const rect = element.getBoundingClientRect();

      this.contextMenu.style.position = 'fixed';
      this.contextMenu.style.setProperty('display', 'flex', 'important');
      this.contextMenu.node = node;

      // Get context menu dimensions
      const menuWidth = this.contextMenu.offsetWidth;
      const menuHeight = this.contextMenu.offsetHeight;

      // Calculate positions ensuring menu stays within viewport
      const left = Math.min(rect.left + 10, window.innerWidth - menuWidth);
      const top = Math.min(rect.top + 30, window.innerHeight - menuHeight);

      this.contextMenu.style.left = `${Math.max(0, left)}px`;
      this.contextMenu.style.top = `${Math.max(0, top)}px`;
    }
  }

  /**
   * Hide the context menu
   */
  hideContextMenu() {
    if (this.contextMenu) {
      this.contextMenu.style.display = 'none';
      this.contextMenu.node = null;
    }
  }

  /**
   * Handle clicks outside the context menu
   * @param {Event} event - Click event
   */
  handleOutsideClick(event) {
    if (!this.contextMenu || this.contextMenu.style.display === 'none') return;

    // Check if click is inside context menu
    if (this.contextMenu.contains(event.target)) return;

    // Check if click is on the selected node
    const nodeElement = this.treeContainer.querySelector(`[data-node-id="${this.contextMenu.node?.id}"]`);
    if (nodeElement && nodeElement.contains(event.target)) return;

    this.hideContextMenu();
  }

  // ==================== Texture Loading Methods ====================

  /**
   * Load textures for a model from selected files
   * @param {Object} node - The model node
   * @param {File[]} files - Array of selected files (MTL and image files)
   */
  async loadTexturesForModel(node, files) {
    if (!node.object3D) return;

    // Separate MTL files and texture files
    const mtlFiles = files.filter((f) => f.name.toLowerCase().endsWith('.mtl'));
    const textureFiles = files.filter((f) => /\.(jpg|jpeg|png|gif|bmp|webp)$/i.test(f.name));

    if (mtlFiles.length === 0) {
      console.warn('No MTL file selected');
      return;
    }

    // Create a map of texture files by name for quick lookup
    // Store multiple key variants (original, lowercase, NFC-normalized) to handle
    // Unicode normalization differences (e.g. ó as single codepoint vs o + combining accent)
    const textureMap = new Map();
    for (const file of textureFiles) {
      const url = URL.createObjectURL(file);
      textureMap.set(file.name, url);
      textureMap.set(file.name.toLowerCase(), url);
      textureMap.set(file.name.normalize('NFC'), url);
      textureMap.set(file.name.normalize('NFC').toLowerCase(), url);
    }

    // Load each MTL file
    for (const mtlFile of mtlFiles) {
      try {
        const mtlText = await this.readFileAsText(mtlFile);
        await this.applyMTLToModel(node, mtlText, textureMap);
      } catch (error) {
        console.error(`Error loading MTL file ${mtlFile.name}:`, error);
      }
    }

    // Store texture info on node for future reference
    node.textureFiles = textureFiles.map((f) => f.name);
    node.mtlFiles = mtlFiles.map((f) => f.name);

    // Save asset files to IndexedDB for persistence
    await this.saveAssetFilesToStorage(node, mtlFiles, textureFiles);

    this.scene.view.renderView();
  }

  /**
   * Save asset files (MTL, textures) to IndexedDB
   * @param {Object} node - The model node
   * @param {File[]} mtlFiles - MTL files
   * @param {File[]} textureFiles - Texture files
   */
  async saveAssetFilesToStorage(node, mtlFiles, textureFiles) {
    if (!this.modelSystem || !this.projectSystem || !node.modelFileId) return;

    const currentProject = this.projectSystem.getCurrentProject();
    if (!currentProject) return;

    const projectId = currentProject.id;
    const modelId = node.modelFileId;

    try {
      // Save MTL files
      for (const file of mtlFiles) {
        const text = await this.readFileAsText(file);
        const textureFile = new TextureFile(modelId, file.name, 'mtl', text);
        await this.modelSystem.saveTextureFile(projectId, textureFile);
      }

      // Save texture files
      for (const file of textureFiles) {
        const arrayBuffer = await this.readFileAsArrayBuffer(file);
        const extension = file.name.split('.').pop().toLowerCase();
        const textureFile = new TextureFile(modelId, file.name, extension, arrayBuffer);
        await this.modelSystem.saveTextureFile(projectId, textureFile);
      }
    } catch (error) {
      console.error('Failed to save asset files to IndexedDB:', error);
    }
  }

  /**
   * Read a file as ArrayBuffer
   * @param {File} file - File to read
   * @returns {Promise<ArrayBuffer>} File contents as ArrayBuffer
   */
  readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(file);
    });
  }

  /**
   * Read a file as text
   * @param {File} file - File to read
   * @returns {Promise<string>} File contents as text
   */
  readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });
  }

  /**
   * Apply MTL materials to a model
   * @param {Object} node - The model node
   * @param {string} mtlText - MTL file contents
   * @param {Map<string, string>} textureMap - Map of texture filename to blob URL
   */
  async applyMTLToModel(node, mtlText, textureMap) {
    // Create a promise that resolves when all textures are loaded
    const texturesLoaded = new Promise((resolve) => {
      const loadingManager = new THREE.LoadingManager();

      // Called when all textures finish loading
      loadingManager.onLoad = () => {
        resolve();
      };

      // Called on error - still resolve to continue
      loadingManager.onError = (url) => {
        console.warn(`Failed to load texture: ${url}`);
      };

      loadingManager.setURLModifier((url) => {
        // Extract just the filename from the URL, decode and strip quotes
        // (MTL files may quote filenames that contain spaces)
        const filename = decodeURIComponent(url.split('/').pop()).replace(/^["']|["']$/g, '').normalize('NFC');
        // Look up in our texture map (try original, lowercase, NFC variants)
        const blobUrl = textureMap.get(filename) || textureMap.get(filename.toLowerCase());
        if (blobUrl) {
          return blobUrl;
        }
        // Return original if not found (will likely fail, but provides error info)
        return url;
      });

      const mtlLoader = new MTLLoader(loadingManager);
      mtlLoader.setMaterialOptions({
        side : THREE.DoubleSide
      });

      // Strip quotes from texture paths (e.g. map_Kd "file with spaces.jpg" → map_Kd file with spaces.jpg)
      // Some software (Agisoft Metashape) quotes filenames with spaces, which Three.js MTLLoader doesn't handle
      const cleanedMtlText = mtlText.replace(/^(map_\w+)\s+"([^"]+)"/gm, '$1 $2');

      // Parse MTL - this creates a MaterialCreator
      const materials = mtlLoader.parse(cleanedMtlText, '');

      // Preload will now use our custom URL modifier to load textures from blob URLs
      materials.preload();

      // Apply materials to meshes
      this.applyMaterialsToMeshes(node, materials);

      // If no textures to load, resolve immediately
      if (textureMap.size === 0) {
        resolve();
      }
    });

    // Wait for all textures to load
    await texturesLoaded;
    this.scene.view.renderView();
  }

  /**
   * Apply parsed materials to mesh children
   * @param {Object} node - The model node
   * @param {Object} materials - The MaterialCreator object
   */
  applyMaterialsToMeshes(node, materials) {

    // Apply materials to meshes
    node.object3D.traverse((child) => {
      if (child.isMesh) {
        const originalMatName = child.userData.originalMaterialName;
        const originalMatNames = child.userData.originalMaterialNames;

        if (originalMatNames && Array.isArray(originalMatNames)) {
          // Multi-material mesh
          const newMaterials = originalMatNames.map((name) => {
            const mat = materials.materials[name];
            return mat || child.material;
          });
          child.material = newMaterials;
        } else if (originalMatName && materials.materials[originalMatName]) {
          // Single material mesh
          child.material = materials.materials[originalMatName];
        } else {
          // Try to find any matching material by mesh name
          const matByMeshName = materials.materials[child.name];
          if (matByMeshName) {
            child.material = matByMeshName;
          }
        }

        // Preserve opacity setting
        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach((m) => {
              m.transparent = node.opacity < 1;
              m.opacity = node.opacity;
            });
          } else {
            child.material.transparent = node.opacity < 1;
            child.material.opacity = node.opacity;
          }
        }
      }
    });

    // Mark that materials have been loaded
    node.hasMaterials = true;
  }

  /**
   * Load a texture from URL
   * @param {THREE.TextureLoader} loader - Texture loader
   * @param {string} url - Texture URL
   * @returns {Promise<THREE.Texture>} Loaded texture
   */
  loadTexture(loader, url) {
    return new Promise((resolve, reject) => {
      loader.load(
        url,
        (texture) => {
          texture.colorSpace = THREE.SRGBColorSpace;
          resolve(texture);
        },
        undefined,
        reject
      );
    });
  }

  // ==================== Getter Methods ====================

  /**
   * Get all models
   * @returns {Array} Array of model nodes
   */
  getModels() {
    const category = this.categories.get('3d-models');
    return category ? category.children : [];
  }

  /**
   * Get model by name
   * @param {string} name - Model name
   * @returns {Object|null} The model node or null
   */
  getModelByName(name) {
    const category = this.categories.get('3d-models');
    if (!category) return null;
    return category.children.find((m) => m.label === name) || null;
  }
}
