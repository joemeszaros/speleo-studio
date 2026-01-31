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
import { degreesToRads, parseMyFloat, radsToDegrees } from '../utils/utils.js';
/**
 * ModelsTree - UI component for managing 3D models in the sidebar
 * Provides a tree structure with visibility controls and property editing
 */
export class ModelsTree {
  constructor(db, options, scene, treeContainer, propertiesContainer) {
    this.db = db;
    this.options = options;
    this.scene = scene;
    this.treeContainer = treeContainer;
    this.propertiesContainer = propertiesContainer;

    // Node structure: categories contain model nodes
    this.categories = new Map();
    this.selectedNode = null;
    this.expandedCategories = new Set(['3d-models']); // Expanded by default

    document.addEventListener('languageChanged', () => this.render());

    this.initializeCategories();
    this.render();
    this.renderPropertiesPanel();
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
      icon     : '📦',
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
  addModel(model, object3D) {
    const category = this.categories.get('3d-models');
    if (!category || !model || !object3D) return null;

    const modelNode = {
      id        : `model-${model.name}`,
      type      : 'model',
      label     : model.name,
      data      : model,
      object3D  : object3D,
      parent    : category,
      visible   : true,
      transform : {}
    };

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

    category.children.push(modelNode);
    this.render();

    return modelNode;
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
    }

    this.render();
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
    }
  }

  /**
   * Render the tree
   */
  render() {
    this.treeContainer.innerHTML = '';

    const treeContent = document.createElement('div');
    treeContent.className = 'models-tree-content';

    // Render each category
    for (const [, category] of this.categories) {
      this.renderCategory(category, treeContent);
    }

    this.treeContainer.appendChild(treeContent);
  }

  /**
   * Render a category node
   */
  renderCategory(category, container) {
    const categoryElement = document.createElement('div');
    categoryElement.className = 'models-tree-category';
    categoryElement.setAttribute('data-node-id', category.id);

    // Category header
    const header = document.createElement('div');
    header.className = 'models-tree-category-header';

    // Expand/collapse toggle
    const toggle = document.createElement('div');
    toggle.className = `models-tree-toggle ${category.expanded ? 'expanded' : 'collapsed'}`;
    toggle.innerHTML = '▶';
    toggle.onclick = (e) => {
      e.stopPropagation();
      this.toggleCategoryExpansion(category.id);
    };
    header.appendChild(toggle);

    // Icon
    const icon = document.createElement('span');
    icon.className = 'models-tree-category-icon';
    icon.textContent = category.icon;
    header.appendChild(icon);

    // Label
    const label = document.createElement('span');
    label.className = 'models-tree-category-label';
    label.textContent = typeof category.label === 'function' ? category.label() : category.label;
    header.appendChild(label);

    // Count badge
    const count = document.createElement('span');
    count.className = 'models-tree-count';
    count.textContent = category.children.length;
    header.appendChild(count);

    categoryElement.appendChild(header);

    // Children container
    if (category.expanded && category.children.length > 0) {
      const childrenContainer = document.createElement('div');
      childrenContainer.className = 'models-tree-children';

      category.children.forEach((child) => {
        this.renderModelNode(child, childrenContainer);
      });

      categoryElement.appendChild(childrenContainer);
    }

    // Empty state
    if (category.expanded && category.children.length === 0) {
      const emptyState = document.createElement('div');
      emptyState.className = 'models-tree-empty';
      emptyState.textContent = i18n.t('ui.models.noModels');
      categoryElement.appendChild(emptyState);
    }

    container.appendChild(categoryElement);
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

    // Click to select
    nodeElement.onclick = (e) => {
      e.stopPropagation();
      this.selectNode(node.id);
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
   * Render the properties panel
   */
  renderPropertiesPanel() {
    this.propertiesContainer.innerHTML = '';

    const panel = document.createElement('div');
    panel.className = 'models-properties-panel';

    // Header
    const header = document.createElement('div');
    header.className = 'models-properties-header';
    header.textContent = i18n.t('ui.models.properties.title');
    panel.appendChild(header);

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
    }

    panel.appendChild(content);
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
