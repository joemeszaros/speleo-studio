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
import { createFloatInput } from './component/input.js';
import { TextureFile } from '../model.js';
import { ModelSheetEditor } from './editor/model-sheet.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import { PointCloud } from '../model.js';
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
    document.addEventListener('decimalSeparatorChanged', () => {
      this._floatInputs?.forEach((w) => w.reformat());
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
      modelNode.color = savedSettings.color ?? null;
      modelNode.wireframe = savedSettings.wireframe ?? false;

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

      // Apply wireframe to mesh materials
      if (modelNode.wireframe && this.scene?.models) {
        this.scene.models.setModelWireframe(model.name, true);
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

    document.dispatchEvent(new CustomEvent('modelsChanged', { detail: { count: category.children.length } }));

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
      document.dispatchEvent(new CustomEvent('modelsChanged', { detail: { count: category.children.length } }));
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
    document.dispatchEvent(new CustomEvent('modelsChanged', { detail: { count: 0 } }));
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

    if (node.object3D) {
      this.scene.models.setModelVisibility(node.object3D, node.visible);
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

    if (this.selectedNode.object3D) {
      this.scene.models.setModelTransform(this.selectedNode.object3D, property, axis, numValue);
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

    if (this.selectedNode.object3D) {
      this.scene.models.setModelOpacity(this.selectedNode.object3D, this.selectedNode.opacity);
    }

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
            visible   : node.visible,
            color     : node.color ?? null,
            wireframe : node.wireframe ?? false
          }).then(() => {
            this.projectSystem.saveProject(currentProject);
            document.dispatchEvent(new CustomEvent('modelFileSettingsSaved', {
              detail: { modelFileId: node.modelFileId, projectId: currentProject.id }
            }));
          })
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
    if (node.data instanceof PointCloud) {
      icon.textContent = '☁️';
    } else {
      icon.textContent = '🗿';
    }
    
    nodeElement.appendChild(icon);

    // Label
    const label = document.createElement('span');
    label.className = 'models-tree-node-label';
    label.textContent = node.label;
    if (node.color) {
      label.style.color = node.color;
    }
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

    // Hamburger menu button
    const menuBtn = document.createElement('div');
    menuBtn.className = 'tree-node-menu-btn';
    menuBtn.textContent = '⋮';
    menuBtn.onclick = (e) => {
      e.stopPropagation();
      this.selectNode(node.id);
      this.showModelContextMenu(node);
    };
    nodeElement.appendChild(menuBtn);

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
    this._floatInputs = []; // wrappers we'll reformat on decimalSeparatorChanged

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

    // Show file size and matrix button in header when a model is selected
    if (this.selectedNode?.type === 'model') {
      const sizeLabel = document.createElement('span');
      sizeLabel.className = 'models-properties-header-size';
      sizeLabel.textContent = '...';
      header.appendChild(sizeLabel);
      this.computeModelFileSize(this.selectedNode).then((size) => {
        sizeLabel.textContent = size;
      });

      const matrixBtn = document.createElement('button');
      matrixBtn.className = 'models-properties-matrix-btn';
      matrixBtn.title = i18n.t('ui.models.properties.matrix');
      matrixBtn.innerHTML = '<img src="icons/matrix.svg" alt="4x4">';
      matrixBtn.onclick = (e) => {
        e.stopPropagation();
        this.showMatrixDialog();
      };
      header.appendChild(matrixBtn);
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

      const input = createFloatInput({
        value    : this.selectedNode.transform[property][axis],
        step     : property === 'scale' ? 0.1 : 1,
        decimals : 2
      });
      input.classList.add('models-properties-input');

      input.addEventListener('change', () => {
        this.updateTransform(property, axis, input.floatValue);
      });
      input.addEventListener('input', () => {
        this.updateTransform(property, axis, input.floatValue);
      });

      this._floatInputs.push(input);
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

    const valueDisplay = createFloatInput({
      value    : this.selectedNode.opacity,
      min      : 0,
      max      : 1,
      step     : 0.05,
      decimals : 2
    });
    valueDisplay.classList.add('models-properties-slider-value');
    this._floatInputs.push(valueDisplay);

    slider.oninput = (e) => {
      const val = parseFloat(e.target.value);
      valueDisplay.floatValue = val;
      this.updateOpacity(val);
    };

    slider.onchange = (e) => {
      const val = parseFloat(e.target.value);
      valueDisplay.floatValue = val;
      this.updateOpacity(val);
    };

    valueDisplay.addEventListener('change', () => {
      const val = valueDisplay.floatValue;
      slider.value = val;
      this.updateOpacity(val);
    });

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

  /**
   * Show a dialog for pasting a 4x4 transformation matrix
   */
  showMatrixDialog() {
    // Build current 4x4 matrix from the node's position, rotation, and scale
    const t = this.selectedNode.transform;
    const matrix = new THREE.Matrix4();
    matrix.compose(
      new THREE.Vector3(t.position.x, t.position.y, t.position.z),
      new THREE.Quaternion().setFromEuler(
        new THREE.Euler(degreesToRads(t.rotation.x), degreesToRads(t.rotation.y), degreesToRads(t.rotation.z))
      ),
      new THREE.Vector3(t.scale.x, t.scale.y, t.scale.z)
    );
    const e = matrix.elements; // column-major
    const fmt = (v) => (Math.abs(v) < 1e-10 ? '0' : U.formatFloat(v, 6).replace(/[.,]?0+$/, ''));
    const currentMatrix = [
      [fmt(e[0]), fmt(e[4]), fmt(e[8]), fmt(e[12])].join('\t'),
      [fmt(e[1]), fmt(e[5]), fmt(e[9]), fmt(e[13])].join('\t'),
      [fmt(e[2]), fmt(e[6]), fmt(e[10]), fmt(e[14])].join('\t'),
      [fmt(e[3]), fmt(e[7]), fmt(e[11]), fmt(e[15])].join('\t')
    ].join('\n');

    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    overlay.innerHTML = `
      <div class="dialog-container dialog-content" style="max-width: 620px; min-width: 520px;">
        <h3 style="margin: 0 0 8px 0;">${i18n.t('ui.models.properties.matrixDialogTitle')}</h3>
        <p style="margin: 0 0 12px 0; font-size: 0.85em; opacity: 0.7;">${i18n.t('ui.models.properties.matrixDialogDescription')}</p>
        <textarea id="matrix-input" rows="5"></textarea>
        <div id="matrix-error" style="color: #f66; font-size: 0.85em; min-height: 1.2em; margin-top: 4px;"></div>
        <div class="config-buttons-container" style="margin-top: 12px;">
          <button type="button" class="settings-button" id="matrix-ok">${i18n.t('common.ok')}</button>
          <button type="button" class="settings-button" id="matrix-cancel">${i18n.t('common.cancel')}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.style.display = 'block';

    const textarea = overlay.querySelector('#matrix-input');
    textarea.value = currentMatrix;
    const errorDiv = overlay.querySelector('#matrix-error');
    textarea.focus();
    textarea.select();

    const close = () => overlay.remove();

    overlay.querySelector('#matrix-cancel').onclick = close;
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });

    overlay.querySelector('#matrix-ok').onclick = () => {
      const result = this.applyMatrix(textarea.value);
      if (result.success) {
        close();
      } else {
        errorDiv.textContent = result.error;
      }
    };
  }

  /**
   * Parse a 4x4 matrix string and apply it as position, rotation, and scale.
   * @param {string} text - Matrix text (rows of numbers separated by whitespace/commas)
   * @returns {{success: boolean, error?: string}}
   */
  applyMatrix(text) {
    // Parse numbers from the text: split by whitespace, commas, semicolons
    const numbers = text
      .split(/[\n\r]+/)
      .filter((line) => line.trim().length > 0)
      .flatMap((line) => line.trim().split(/[\s,;]+/))
      .map(Number);

    if (numbers.length !== 16 || numbers.some(isNaN)) {
      return { success: false, error: i18n.t('ui.models.properties.matrixInvalid') };
    }

    if (!numbers.every(isFinite)) {
      return { success: false, error: i18n.t('ui.models.properties.matrixNotFinite') };
    }

    // Warn if bottom row is not [0, 0, 0, 1]
    if (numbers[12] !== 0 || numbers[13] !== 0 || numbers[14] !== 0 || numbers[15] !== 1) {
      return { success: false, error: i18n.t('ui.models.properties.matrixBottomRow') };
    }

    // THREE.Matrix4.set() takes row-major arguments
    const matrix = new THREE.Matrix4();
    matrix.set(
      numbers[0],
      numbers[1],
      numbers[2],
      numbers[3],
      numbers[4],
      numbers[5],
      numbers[6],
      numbers[7],
      numbers[8],
      numbers[9],
      numbers[10],
      numbers[11],
      numbers[12],
      numbers[13],
      numbers[14],
      numbers[15]
    );

    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    matrix.decompose(position, quaternion, scale);

    const euler = new THREE.Euler().setFromQuaternion(quaternion);

    // Update node transform
    const t = this.selectedNode.transform;
    t.position.x = position.x;
    t.position.y = position.y;
    t.position.z = position.z;
    t.rotation.x = radsToDegrees(euler.x);
    t.rotation.y = radsToDegrees(euler.y);
    t.rotation.z = radsToDegrees(euler.z);
    t.scale.x = scale.x;
    t.scale.y = scale.y;
    t.scale.z = scale.z;

    // Apply to Three.js object
    if (this.selectedNode.object3D) {
      const obj = this.selectedNode.object3D;
      obj.position.copy(position);
      obj.rotation.copy(euler);
      obj.scale.copy(scale);

      const boundingBox = this.scene.computeBoundingBox();
      if (boundingBox) {
        this.scene.grid.adjust(boundingBox);
      }
      this.scene.view.renderView();
    }

    this._scheduleSave(this.selectedNode);
    this.renderPropertiesPanel();

    return { success: true };
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
        icon    : '💾',
        title   : i18n.t('ui.models.menu.download'),
        onclick : async () => {
          this.hideContextMenu();
          if (!node.modelFileId || !this.modelSystem) return;
          try {
            const modelFile = await this.modelSystem.getModelFile(node.modelFileId);
            if (!modelFile?.data) return;
            const url = URL.createObjectURL(modelFile.data);
            const a = document.createElement('a');
            a.href = url;
            a.download = modelFile.filename;
            a.click();
            URL.revokeObjectURL(url);
          } catch (error) {
            console.error('Download failed:', error);
          }
        }
      },
      {
        icon    : '🎨',
        title   : i18n.t('ui.models.menu.setColor'),
        onclick : () => {
          this.hideContextMenu();
          const colorPicker = document.createElement('input');
          colorPicker.type = 'color';
          colorPicker.value = node.color || '#ffffff';
          colorPicker.style.display = 'none';
          document.body.appendChild(colorPicker);
          colorPicker.oninput = (e) => {
            node.color = e.target.value;
            this.options.scene.models.color.trigger = {
              reason : 'modelColor',
              model  : node.label,
              color  : e.target.value
            };
            this._scheduleSave(node);
            this.render();
          };
          colorPicker.onchange = () => colorPicker.remove();
          colorPicker.click();
        }
      },
      {
        icon    : '<span style="text-decoration: line-through; text-decoration-color: red; text-decoration-thickness: 2px; transform: rotate(45deg); display: inline-block;">🎨</span>',
        title   : i18n.t('ui.models.menu.clearColor'),
        onclick : () => {
          this.hideContextMenu();
          node.color = null;
          this.options.scene.models.color.trigger = {
            reason : 'modelColorCleared',
            model  : node.label
          };
          this._scheduleSave(node);
          this.render();
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

    // Wireframe toggle — meshes only, and skip textured meshes.
    const isMesh = !(node.data instanceof PointCloud);
    const isTextured = this.scene?.models?.texturedModels?.has(node.label) ?? false;
    if (isMesh && !isTextured) {
      const wireframeOn = node.wireframe === true;
      items.splice(items.length - 1, 0, {
        icon    : wireframeOn ? '🐢' : '𓆉︎',
        title   : wireframeOn ? i18n.t('ui.models.menu.solid') : i18n.t('ui.models.menu.wireframe'),
        onclick : () => {
          this.hideContextMenu();
          node.wireframe = !wireframeOn;
          if (this.scene?.models) {
            this.scene.models.setModelWireframe(node.label, node.wireframe);
          }
          this._scheduleSave(node);
        }
      });
    }

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
    const textureFiles = files.filter((f) => /\.(jpg|jpeg|png|gif|bmp|webp|exr)$/i.test(f.name));

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
    node.hasMaterials = true;

    // Notify scene that this model now has textures (skip color mode)
    this.scene.models.markAsTextured(node.label);

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

      // MTLLoader calls manager.getHandler(url) before falling back to TextureLoader,
      // so registering EXRLoader here makes .exr textures loadable from MTL files.
      // The manager must be passed to EXRLoader so the URL modifier (blob URLs) and
      // itemStart/itemEnd tracking route through this manager — otherwise the loader
      // uses DefaultLoadingManager and onLoad never fires.
      //
      // Wrapping mode: photogrammetry tools (e.g. RealityCapture) emit multi-texture
      // OBJs with UDIM-style UVs where each material's triangles have their U
      // coordinate offset by the tile index (group 0 → [0,1], group 1 → [1,2],
      // etc.). The correct content lives within each material's own [0,1] texture
      // once U is wrapped modulo 1. Three.js defaults to ClampToEdgeWrapping, which
      // pins U>1 to the black padding at the texture's right edge and makes the
      // model appear mostly black. RepeatWrapping fixes this by taking U mod 1.
      //
      // Colorspace is left as EXRLoader's default (LinearSRGBColorSpace) because
      // WebGL forbids SRGBColorSpace on HalfFloatType textures — the renderer's
      // outputColorSpace=sRGB handles the linear→sRGB conversion at display.
      //
      // flipY is left as EXRLoader's default (false) since the decoded EXR data
      // already matches OBJ's V-origin convention.
      const exrLoader = new EXRLoader(loadingManager);
      const exrLoad = exrLoader.load.bind(exrLoader);
      exrLoader.load = (url, onLoad, onProgress, onError) =>
        exrLoad(
          url,
          (texture, texData) => {
            texture.wrapS = THREE.RepeatWrapping;
            texture.wrapT = THREE.RepeatWrapping;
            if (onLoad) onLoad(texture, texData);
          },
          onProgress,
          onError
        );
      loadingManager.addHandler(/\.exr$/i, exrLoader);

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
        const filename = decodeURIComponent(url.split('/').pop())
          .replace(/^["']|["']$/g, '')
          .normalize('NFC');
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

        // Preserve opacity + delegate texture-brightness boost to ModelScene
        // (Three.js material tweaks live alongside the other scene material methods).
        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach((m) => {
              m.transparent = node.opacity < 1;
              m.opacity = node.opacity;
              this.scene.models.boostTexturedMaterial(m);
            });
          } else {
            child.material.transparent = node.opacity < 1;
            child.material.opacity = node.opacity;
            this.scene.models.boostTexturedMaterial(child.material);
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
