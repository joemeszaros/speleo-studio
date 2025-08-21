import { i18n } from '../i18n/i18n.js';

export class ExplorerTree {
  constructor(container, options = {}) {
    this.container = container;
    this.options = {
      onNodeClick        : () => {},
      onVisibilityToggle : () => {},
      onNodeSelect       : () => {},
      ...options
    };

    this.nodes = new Map();
    this.selectedNode = null;
    this.expandedNodes = new Set();

    this.init();
  }

  init() {
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

  addSurvey(caveName, survey) {
    const caveNode = this.nodes.get(caveName);
    if (!caveNode) return null;

    const surveyNode = {
      id       : `${caveName}-${survey.name}`,
      type     : 'survey',
      label    : survey.name,
      data     : survey,
      parent   : caveNode,
      visible  : survey.visible !== false,
      expanded : false
    };

    caveNode.children.push(surveyNode);
    this.nodes.set(surveyNode.id, surveyNode);
    this.render();
    return surveyNode;
  }

  removeCave(caveName) {
    const caveNode = this.nodes.get(caveName);
    if (!caveNode) return;

    // Remove all survey nodes
    caveNode.children.forEach((survey) => {
      this.nodes.delete(survey.id);
    });

    this.nodes.delete(caveName);
    this.render();
  }

  removeSurvey(caveName, surveyName) {
    const caveNode = this.nodes.get(caveName);
    if (!caveNode) return;

    const surveyIndex = caveNode.children.findIndex((s) => s.name === surveyName);
    if (surveyIndex !== -1) {
      const surveyNode = caveNode.children[surveyIndex];
      caveNode.children.splice(surveyIndex, 1);
      this.nodes.delete(surveyNode.id);
      this.render();
    }
  }

  updateCave(cave) {
    const node = this.nodes.get(cave.name);
    if (node) {
      node.data = cave;
      node.visible = cave.visible !== false;
      this.render();
    }
  }

  updateSurvey(cave, survey) {
    const caveNode = this.nodes.get(cave.name);
    if (!caveNode) return;

    const surveyNode = caveNode.children.find((s) => s.name === survey.name);
    if (surveyNode) {
      surveyNode.data = survey;
      surveyNode.visible = survey.visible !== false;
      this.render();
    }
  }

  toggleNodeExpansion(nodeId) {
    const node = this.nodes.get(nodeId);
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
    const node = this.nodes.get(nodeId);
    if (!node) return;

    node.visible = !node.visible;
    this.options.onVisibilityToggle(node);
    this.render();
  }

  selectNode(nodeId) {
    if (this.selectedNode) {
      this.selectedNode.selected = false;
    }

    const node = this.nodes.get(nodeId);
    if (node) {
      node.selected = true;
      this.selectedNode = node;
      this.options.onNodeSelect(node);
    }

    this.render();
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
    for (const [caveId, caveNode] of this.nodes) {
      this.renderNode(caveNode, 0);
    }
  }

  renderNode(node, level) {
    const nodeElement = document.createElement('div');
    nodeElement.className = 'explorer-tree-node';
    nodeElement.style.paddingLeft = `${level * 20}px`;

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

    // Icon
    const icon = document.createElement('div');
    icon.className = 'explorer-tree-icon';
    if (node.type === 'cave') {
      icon.innerHTML = '🏔️';
    } else if (node.type === 'survey') {
      icon.innerHTML = '📊';
    }
    nodeElement.appendChild(icon);

    // Label
    const label = document.createElement('div');
    label.className = 'explorer-tree-label';
    label.textContent = node.label;
    label.onclick = () => {
      this.selectNode(node.id);
      this.options.onNodeClick(node);
    };

    // Add double-click to expand/collapse
    label.ondblclick = (e) => {
      e.stopPropagation();
      if (node.children && node.children.length > 0) {
        this.toggleNodeExpansion(node.id);
      }
    };
    nodeElement.appendChild(label);

    // Visibility toggle
    const visibility = document.createElement('div');
    visibility.className = `explorer-tree-visibility ${node.visible ? 'visible' : 'hidden'}`;
    visibility.innerHTML = node.visible ? '👁️' : '👁️‍🗨️';
    visibility.onclick = (e) => {
      e.stopPropagation();
      this.toggleNodeVisibility(node.id);
    };
    nodeElement.appendChild(visibility);

    this.container.appendChild(nodeElement);

    // Render children if expanded
    if (node.expanded && node.children && node.children.length > 0) {
      node.children.forEach((child) => {
        this.renderNode(child, level + 1);
      });
    }
  }

  getVisibleNodes() {
    const visible = [];
    for (const [id, node] of this.nodes) {
      if (node.visible) {
        visible.push(node);
      }
    }
    return visible;
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
