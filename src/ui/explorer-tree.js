import { SurveyEditor, SurveySheetEditor } from './editor/survey.js';
import { CaveEditor } from './editor/cave.js';

export class ExplorerTree {
  constructor(db, options, scene, container, contextMenuElement) {
    this.db = db;
    this.options = options;
    this.scene = scene;
    this.container = container;
    this.contextMenu = contextMenuElement;
    this.nodes = new Map();
    this.selectedNode = null;
    this.expandedNodes = new Set();

    this.init();
  }

  init() {
    document.addEventListener('click', this.hideContextMenuOnClickOutside.bind(this));
    this.render();
  }

  addCave(cave) {
    const node = {
      id       : cave.name,
      type     : 'cave',
      label    : cave.name,
      data     : cave,
      children : [],
      visible  : cave.visible !== false,
      expanded : false
    };

    this.nodes.set(node.id, node);
    this.render();
    return node;
  }

  addSurvey(cave, survey) {
    const caveNode = this.nodes.get(cave.name);
    if (!caveNode) return null;

    const surveyNode = {
      id       : `${cave.name}-${survey.name}`,
      type     : 'survey',
      label    : survey.name,
      data     : survey,
      parent   : caveNode,
      visible  : survey.visible !== false,
      expanded : false
    };

    caveNode.children.push(surveyNode);
    // Don't add survey nodes to the nodes Map - they should only exist as children
    // this.nodes.set(surveyNode.id, surveyNode);
    this.render();
    return surveyNode;
  }

  removeCave(caveName) {
    const caveNode = this.nodes.get(caveName);
    if (!caveNode) return;

    this.nodes.delete(caveName);
    this.render();
  }

  removeSurvey(caveName, surveyName) {
    const caveNode = this.nodes.get(caveName);
    if (!caveNode) return;

    const surveyIndex = caveNode.children.findIndex((s) => s.label === surveyName);
    if (surveyIndex !== -1) {
      caveNode.children.splice(surveyIndex, 1);
      this.render();
    }
  }

  // Alias for removeCave to match the interface expected by the project manager
  deleteCave(caveName) {
    return this.removeCave(caveName);
  }

  updateCave(cave, predicate) {
    let caveNode;
    if (predicate) {
      // Find cave using predicate function
      for (const [, node] of this.nodes) {
        if (predicate(node)) {
          caveNode = node;
          break;
        }
      }
    } else {
      // Find cave by name
      caveNode = this.nodes.get(cave.name);
    }

    if (caveNode) {
      caveNode.data = cave;
      caveNode.visible = cave.visible !== false;
      this.render();
    }
  }

  updateSurvey(cave, survey, predicate) {
    let caveNode;
    if (predicate) {
      // Find cave using predicate function
      for (const [, node] of this.nodes) {
        if (predicate(node)) {
          caveNode = node;
          break;
        }
      }
    } else {
      // Find cave by name
      caveNode = this.nodes.get(cave.name);
    }

    if (!caveNode) return;

    let surveyNode;
    if (predicate) {
      // Find survey using predicate function
      surveyNode = caveNode.children.find(predicate);
    } else {
      // Find survey by name
      surveyNode = caveNode.children.find((s) => s.label === survey.name);
    }

    if (surveyNode) {
      surveyNode.data = survey;
      surveyNode.visible = survey.visible !== false;
      this.render();
    }
  }

  // Helper method to find a node by ID (searches both top-level and children)
  findNodeById(nodeId) {
    // First check top-level nodes
    const topLevelNode = this.nodes.get(nodeId);
    if (topLevelNode) return topLevelNode;

    // If not found, search through children of all caves
    for (const [, caveNode] of this.nodes) {
      const surveyNode = caveNode.children.find((s) => s.id === nodeId);
      if (surveyNode) return surveyNode;
    }
    return null;
  }

  toggleNodeExpansion(nodeId) {
    const node = this.findNodeById(nodeId);
    if (!node) return;

    node.expanded = !node.expanded;
    if (node.expanded) {
      this.expandedNodes.add(nodeId);
    } else {
      this.expandedNodes.delete(nodeId);
    }

    this.render();
  }

  toggleNodeVisibility(nodeId) {
    const node = this.findNodeById(nodeId);
    if (!node) return;

    node.visible = !node.visible;
    if (node.type === 'survey') {
      this.scene.setSurveyVisibility(node.parent.data.name, node.data.name, node.visible);
    } else if (node.type === 'cave') {
      node.data.visible = node.visible;
      node.data.surveys.forEach((survey) => {
        this.scene.setSurveyVisibility(node.data.name, survey.name, node.visible);
      });
    }
    this.render();
  }

  selectNode(nodeId) {
    if (this.selectedNode) {
      this.selectedNode.selected = false;
    }

    const node = this.findNodeById(nodeId);

    if (node) {
      node.selected = true;
      this.selectedNode = node;

      // Remove 'selected' class from all node elements
      this.container.querySelectorAll('.explorer-tree-node').forEach((el) => {
        el.classList.remove('selected');
      });

      node.element.classList.add('selected');

      // Show context popup for surveys after render is complete
      if (node.type === 'survey') {
        this.showSurveyContextMenu(node);
      } else if (node.type === 'cave') {
        this.showCaveContextMenu(node);
      } else {
        this.hideContextMenu();
      }
    }
  }

  showCaveContextMenu(caveNode) {
    const items = [
      {
        icon    : '📝',
        title   : 'Open cave sheet editor',
        onclick : () => {
          this.editor = new CaveEditor(
            this.db,
            this.options,
            caveNode.data,
            this.scene,
            document.getElementById('fixed-size-editor')
          );
          this.editor.setupPanel();
          this.editor.show();
        }
      },
      {
        icon    : '〽🧩🔀',
        title   : 'Rename cave',
        onclick : () => {
          const newName = prompt('Enter new cave name');
          if (newName) {
            this.db.renameCave(caveNode.data.name, newName);
          }
        }
      },
      {
        icon    : '〽',
        title   : 'Rename cave',
        onclick : () => {
          const newName = prompt('Enter new cave name');
          if (newName) {
            this.db.renameCave(caveNode.data.name, newName);
          }
        }
      },
      {
        icon    : '🗑️',
        title   : 'Delete Cave',
        onclick : () => {
          this.db.deleteCave(caveNode.data.name);
        }
      }
    ];
    this.showContextMenu(caveNode, items);
  }

  showSurveyContextMenu(surveyNode) {
    const items = [
      {
        icon    : '📝',
        title   : 'Open Survey Editor',
        onclick : () => {
          this.editor = new SurveyEditor(
            this.options,
            surveyNode.parent.data,
            surveyNode.data,
            this.scene,
            document.getElementById('resizable-editor')
          );
          this.editor.setupPanel();
          this.editor.show();
        }
      },
      {
        icon    : '🔠',
        title   : 'Open Survey Sheet Editor',
        onclick : () => {
          this.editor = new SurveySheetEditor(
            this.db,
            surveyNode.parent.data,
            surveyNode.data,
            document.getElementById('fixed-size-editor')
          );
          this.editor.setupPanel();
          this.editor.show();
        }
      },
      {
        icon    : '🎨',
        title   : 'Set survey color',
        onclick : () => {
          const colorPicker = document.createElement('input');
          colorPicker.type = 'color';
          if (surveyNode.data.color) {
            colorPicker.value = surveyNode.data.color;
          }
          colorPicker.click();

          colorPicker.addEventListener('input', (e) => {
            surveyNode.data.color = e.target.value;
            this.render();
          });

        }
      },
      {
        icon    : '🗑️',
        title   : 'Delete Survey',
        onclick : () => {
          const result = confirm(`Do you want to delete survey '${surveyNode.data.name}'?`);
          if (result) {
            this.db.deleteSurvey(surveyNode.parent.data.name, surveyNode.data.name);
            const event = new CustomEvent('surveyDeleted', {
              detail : {
                cave   : surveyNode.parent.data.name,
                survey : surveyNode.data.name
              }
            });
            document.dispatchEvent(event);
          }
        }
      }

    ];
    this.showContextMenu(surveyNode, items);
  }

  showContextMenu(node, items) {
    this.contextMenu.innerHTML = '';

    items.forEach((option) => {
      const optionElement = document.createElement('div');
      optionElement.className = 'context-menu-option';
      optionElement.innerHTML = option.icon;
      optionElement.title = option.title;
      optionElement.onclick = () => {
        option.onclick();
        this.hideContextMenu();
      };
      this.contextMenu.appendChild(optionElement);
    });

    // Position the context menu relative to the selected node
    const element = this.container.querySelector(`[data-node-id="${node.id}"]`);
    if (element) {
      const rect = element.getBoundingClientRect();

      this.contextMenu.style.position = 'fixed';
      this.contextMenu.style.left = `${rect.left + 10}px`;
      this.contextMenu.style.top = `${rect.top + 30}px`;
    }

    this.contextMenu.style.display = 'flex';
    this.contextMenu.node = node;

  }

  hideContextMenu() {
    this.contextMenu.style.display = 'none';
  }

  hideContextMenuOnClickOutside(event) {
    if (this.contextMenu.style.display !== 'none' && !this.contextMenu.node.element.contains(event.target)) {
      this.hideContextMenu();
    }
  }

  render() {
    this.container.innerHTML = '';

    if (this.nodes.size === 0) {
      const emptyMessage = document.createElement('div');
      emptyMessage.className = 'explorer-empty';
      emptyMessage.textContent = 'No caves loaded';
      emptyMessage.style.padding = '20px';
      emptyMessage.style.textAlign = 'center';
      emptyMessage.style.color = '#666';
      this.container.appendChild(emptyMessage);
      return;
    }

    // Render caves and their surveys
    this.nodes.values().forEach((caveNode) => {
      this.renderNode(caveNode, 0);
    });
  }

  renderNode(node, level) {
    const nodeElement = document.createElement('div');
    nodeElement.className = 'explorer-tree-node';
    nodeElement.style.paddingLeft = `${level * 10}px`;
    nodeElement.setAttribute('data-node-id', node.id);

    if (node.selected) {
      nodeElement.classList.add('selected');
    }

    // Toggle button for expandable nodes
    if (node.children && node.children.length > 0) {
      const toggle = document.createElement('div');
      toggle.className = `explorer-tree-toggle ${node.expanded ? 'expanded' : 'collapsed'}`;
      toggle.innerHTML = '▶';
      toggle.onclick = (e) => {
        e.stopPropagation();
        this.toggleNodeExpansion(node.id);
      };
      nodeElement.appendChild(toggle);
    } else {
      // Spacer for leaf nodes
      const spacer = document.createElement('div');
      spacer.className = 'explorer-tree-toggle';
      spacer.style.visibility = 'hidden';
      nodeElement.appendChild(spacer);
    }

    // Warning icons for surveys with issues
    if (node.type === 'survey') {
      const survey = node.data;
      const hasIssues = survey.isolated === true || survey.orphanShotIds.size > 0 || survey.invalidShotIds.size > 0;

      if (hasIssues) {
        const warningIcon = document.createElement('div');
        warningIcon.className = 'explorer-tree-warning';

        if (survey.isolated === true) {
          warningIcon.innerHTML = '❌';
          warningIcon.title = 'Survey is isolated from the cave network';
          nodeElement.title = 'Survey is isolated from the cave network';
        } else if (survey.orphanShotIds.size > 0) {
          warningIcon.innerHTML = '⚠️';
          warningIcon.title = `Survey has ${survey.orphanShotIds.size} orphan shots`;
          nodeElement.title = `Survey has ${survey.orphanShotIds.size} orphan shots`;
        } else if (survey.invalidShotIds.size > 0) {
          warningIcon.innerHTML = '⚠️';
          warningIcon.title = `Survey has ${survey.invalidShotIds.size} invalid shots`;
          nodeElement.title = `Survey has ${survey.invalidShotIds.size} invalid shots`;
        }

        nodeElement.appendChild(warningIcon);
      }
    }

    // Label
    const label = document.createElement('div');
    label.className = 'explorer-tree-label';
    label.textContent = node.label;
    if (node.data.color) {
      label.style.color = node.data.color;
    }
    // Add double-click to expand/collapse
    label.ondblclick = (e) => {
      e.stopPropagation();
      if (node.children && node.children.length > 0 && node.type === 'cave') {
        this.toggleNodeExpansion(node.id);
      }
    };
    nodeElement.appendChild(label);
    nodeElement.onclick = () => {
      this.selectNode(node.id);
    };

    // Visibility toggle
    const visibility = document.createElement('div');
    visibility.className = `explorer-tree-visibility ${node.visible ? 'visible' : 'hidden'}`;

    if (node.visible) {
      visibility.innerHTML = '👁️';
    } else {
      visibility.innerHTML = '<span class="eye-strikethrough">👁️</span>';
    }

    visibility.onclick = (e) => {
      e.stopPropagation();
      this.toggleNodeVisibility(node.id);
    };
    nodeElement.appendChild(visibility);

    this.container.appendChild(nodeElement);
    node.element = nodeElement;

    // Render children if expanded
    if (node.expanded && node.children && node.children.length > 0) {
      node.children.forEach((child) => {
        this.renderNode(child, level + 1);
      });
    }
  }

  getVisibleNodes() {
    return Array.from(this.nodes.values()).filter((node) => node.visible && node.type === 'cave');
  }

  expandAll() {
    for (const [id, node] of this.nodes) {
      if (node.children && node.children.length > 0) {
        node.expanded = true;
        this.expandedNodes.add(id);
      }
    }
    this.render();
  }

  collapseAll() {
    for (const [id, node] of this.nodes) {
      node.expanded = false;
      this.expandedNodes.delete(id);
    }
    this.render();
  }

  clear() {
    this.nodes.clear();
    this.selectedNode = null;
    this.expandedNodes.clear();
    this.render();
  }
}
