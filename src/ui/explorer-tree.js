import { SurveyEditor, SurveySheetEditor } from './editor/survey.js';
import { CaveEditor } from './editor/cave.js';
import { StationAttributeEditor, SectionAttributeEditor, ComponentAttributeEditor } from './editor/attributes.js';
import { CyclePanel } from './editor/cycle.js';
import { i18n } from '../i18n/i18n.js';

export class ExplorerTree {
  constructor(db, options, scene, interaction, attributeDefs, declinationCache, container, contextMenuElement) {
    this.db = db;
    this.options = options;
    this.scene = scene;
    this.interaction = interaction;
    this.attributeDefs = attributeDefs;
    this.declinationCache = declinationCache;
    this.container = container;
    this.contextMenu = contextMenuElement;
    this.nodes = new Map();
    this.selectedNode = null;
    this.expandedNodes = new Set();
    this.filterText = '';
    this.filteredNodes = new Map();
    this.searchMode = 'caveSurvey'; // 'caveSurvey' or 'shotNames'

    document.addEventListener('languageChanged', () => this.render());
    document.addEventListener('click', this.hideContextMenuOnClickOutside.bind(this));
    this.container.addEventListener('scroll', () => this.hideContextMenu());
    this.renderFilterInput();
    this.render();

  }

  setSearchMode(mode) {
    if (this.searchMode === mode) return;

    this.searchMode = mode;

    // Update button active states
    if (this.caveSurveyButton && this.shotNamesButton) {
      this.caveSurveyButton.classList.toggle('active', mode === 'caveSurvey');
      this.shotNamesButton.classList.toggle('active', mode === 'shotNames');
    }

    // Update placeholder text based on mode
    const filterInput = this.filterInputContainer?.querySelector('.explorer-filter-input');
    if (filterInput) {
      if (mode === 'shotNames') {
        filterInput.placeholder = i18n.t('ui.explorer.filter.modes.shotNames') + '...';
      } else {
        filterInput.placeholder = i18n.t('ui.explorer.filter.placeholder');
      }
    }

    // Reapply filter if there's active filter text
    if (this.filterText) {
      this.applyFilter();
      this.render();
    }
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

    // Reapply filter if active
    if (this.filterText) {
      this.applyFilter();
    }

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
      visible  : survey.visible !== false && caveNode.visible, // Inherit cave visibility
      expanded : false
    };

    caveNode.children.push(surveyNode);

    // Reapply filter if active
    if (this.filterText) {
      this.applyFilter();
    }

    this.render();
    return surveyNode;
  }

  removeCave(caveName) {
    const caveNode = this.nodes.get(caveName);
    if (!caveNode) return;

    this.nodes.delete(caveName);

    // Reapply filter if active
    if (this.filterText) {
      this.applyFilter();
    }

    this.render();
  }

  removeSurvey(caveName, surveyName) {
    const caveNode = this.nodes.get(caveName);
    if (!caveNode) return;

    const surveyIndex = caveNode.children.findIndex((s) => s.label === surveyName);
    if (surveyIndex !== -1) {
      caveNode.children.splice(surveyIndex, 1);

      // Reapply filter if active
      if (this.filterText) {
        this.applyFilter();
      }

      this.render();
    }
  }

  renameCave(oldName, newName) {
    if (!this.nodes.has(oldName)) return;
    const caveNode = this.nodes.get(oldName);

    // Update the cave node properties
    caveNode.label = newName;
    caveNode.id = newName;

    // Update survey node IDs to reference the new cave name
    caveNode.children.forEach((surveyNode) => {
      surveyNode.id = `${newName}-${surveyNode.data.name}`;
    });

    // Update expandedNodes set to use the new name
    if (this.expandedNodes.has(oldName)) {
      this.expandedNodes.delete(oldName);
      this.expandedNodes.add(newName);
    }

    // Update the nodes map
    this.nodes.delete(oldName);
    this.nodes.set(newName, caveNode);

    // Reapply filter if active
    if (this.filterText) {
      this.applyFilter();
    }

    this.render();
  }

  renameSurvey(oldName, newName, caveName) {
    if (!this.nodes.has(caveName)) return;
    const caveNode = this.nodes.get(caveName);
    const surveyNode = caveNode.children.find((s) => s.label === oldName);
    surveyNode.label = newName;

    // Reapply filter if active
    if (this.filterText) {
      this.applyFilter();
    }

    this.render();
  }

  updateCave(cave) {
    const caveNode = this.nodes.get(cave.name);

    if (caveNode) {
      caveNode.data = cave;
      caveNode.visible = cave.visible !== false;

      // Update all survey nodes' visibility to match the cave
      caveNode.children.forEach((surveyNode) => {
        surveyNode.visible = caveNode.visible;
      });

      // Reapply filter if active
      if (this.filterText) {
        this.applyFilter();
      }

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

    // If filtering is active, also search in filtered nodes
    if (this.filterText && this.filteredNodes.size > 0) {
      for (const [, caveNode] of this.filteredNodes) {
        const surveyNode = caveNode.children.find((s) => s.id === nodeId);
        if (surveyNode) return surveyNode;
      }
    }

    return null;
  }

  toggleNodeExpansion(nodeId) {
    this.hideContextMenu();
    const node = this.findNodeById(nodeId);
    if (!node) return;

    node.expanded = !node.expanded;
    if (node.expanded) {
      this.expandedNodes.add(nodeId);
    } else {
      this.expandedNodes.delete(nodeId);
    }

    // If filtering is active, reapply the filter to maintain the filtered view
    if (this.filterText) {
      this.applyFilter();
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

      // Update all survey nodes' visibility to match the cave
      node.children.forEach((surveyNode) => {
        surveyNode.visible = node.visible;
        this.scene.setSurveyVisibility(node.data.name, surveyNode.data.name, node.visible);
      });
    }
    this.render();
  }

  selectNode(nodeId) {
    if (this.selectedNode) {
      this.selectedNode.selected = false;
      if (this.selectedNode.element) {
        this.selectedNode.element.classList.remove('selected');
      }
      if (nodeId === this.selectedNode.id) {
        this.hideContextMenu();
        this.selectedNode = undefined;
        return;
      }
    }

    const node = this.findNodeById(nodeId);
    if (node) {
      node.selected = true;
      this.selectedNode = node;

      // Remove 'selected' class from all node elements
      this.container.querySelectorAll('.explorer-tree-node').forEach((el) => {
        el.classList.remove('selected');
      });

      // Only try to add selected class if the element exists
      if (node.element) {
        node.element.classList.add('selected');
      }

      // Show context popup for surveys after render is complete
      if (node.type === 'survey') {
        this.showSurveyContextMenu(node);
      } else if (node.type === 'cave') {
        this.showCaveContextMenu(node);
      } else {
        this.hideContextMenu();
      }

      // If filtering is active, reapply the filter to maintain the filtered view with selection
      if (this.filterText) {
        this.applyFilter();
        // Defer the render slightly to ensure context menu is shown first
        setTimeout(() => {
          this.render();
          // After re-rendering, update the element reference and reapply the selected class
          if (node.selected) {
            const newElement = this.container.querySelector(`[data-node-id="${node.id}"]`);
            if (newElement) {
              node.element = newElement;
              newElement.classList.add('selected');
            }
          }
        }, 10);
      }
    }
  }

  showCaveContextMenu(caveNode) {

    const editorSetup = (editor) => {
      this.editor = editor;
      editor.setupPanel();
      editor.show();
    };

    const items = [
      {
        icon    : '🔠',
        title   : i18n.t('ui.explorer.menu.editCaveData'),
        onclick : () => {
          editorSetup(
            new CaveEditor(
              this.db,
              this.options,
              caveNode.data,
              this.scene,
              document.getElementById('fixed-size-editor')
            )
          );
        }
      },
      {
        icon    : '❇️',
        title   : i18n.t('ui.explorer.menu.newSurvey'),
        onclick : () => {
          editorSetup(
            new SurveySheetEditor(this.db, caveNode.data, undefined, document.getElementById('fixed-size-editor'))
          );
        }
      },
      {
        icon    : '<img src="icons/topodroid.png" alt="TopoDroid" style="width: 20px; height: 20px;">',
        title   : i18n.t('ui.explorer.menu.importSurvey'),
        onclick : () => {
          const surveyInput = document.getElementById('surveyInput');
          surveyInput.caveName = caveNode.data.name;
          surveyInput.click();
        }
      },
      {
        icon    : '📍',
        title   : i18n.t('ui.explorer.menu.editStationAttributes'),
        onclick : () => {
          editorSetup(
            new StationAttributeEditor(
              this.db,
              this.options,
              caveNode.data,
              this.scene,
              this.attributeDefs,
              document.getElementById('resizable-editor')
            )
          );
        }
      },
      {
        icon    : '🔀',
        title   : i18n.t('ui.explorer.menu.editSectionAttributes'),
        onclick : () => {
          editorSetup(
            new SectionAttributeEditor(
              this.db,
              this.options,
              caveNode.data,
              this.scene,
              this.attributeDefs,
              document.getElementById('resizable-editor')
            )
          );
        }
      },
      {
        icon    : '🧩',
        title   : i18n.t('ui.explorer.menu.editComponentAttributes'),
        onclick : () => {
          editorSetup(
            new ComponentAttributeEditor(
              this.db,
              this.options,
              caveNode.data,
              this.scene,
              this.attributeDefs,
              document.getElementById('resizable-editor')
            )
          );
        }
      },
      {
        icon    : '🔄',
        title   : i18n.t('ui.explorer.menu.cycles'),
        onclick : () => {
          editorSetup(
            new CyclePanel(this.options, document.getElementById('resizable-editor'), this.scene, caveNode.data)
          );
        }
      },
      {
        icon    : '🎨',
        title   : i18n.t('ui.explorer.menu.setCaveColor'),
        onclick : () => {
          const colorPicker = document.createElement('input');
          colorPicker.type = 'color';
          if (caveNode.data.color) {
            colorPicker.value = caveNode.data.color;
          }
          colorPicker.click();

          colorPicker.addEventListener('input', (e) => {
            caveNode.data.color = e.target.value;
            this.render();
          });

        }
      },
      {
        icon    : '🗑️',
        title   : i18n.t('ui.explorer.menu.deleteCave'),
        onclick : () => {
          const result = confirm(i18n.t('ui.explorer.confirm.deleteCave', { name: caveNode.data.name }));
          if (result) {
            this.db.deleteCave(caveNode.data.name);
            const event = new CustomEvent('caveDeleted', {
              detail : {
                name : caveNode.data.name,
                id   : caveNode.data.id
              }
            });
            document.dispatchEvent(event);
          }

        }
      }
    ];
    this.showContextMenu(caveNode, items);
  }

  showSurveyContextMenu(surveyNode) {
    const items = [
      {
        icon    : '📝',
        title   : i18n.t('ui.explorer.menu.openSurveyEditor'),
        onclick : () => {
          this.editor = new SurveyEditor(
            this.options,
            surveyNode.parent.data,
            surveyNode.data,
            this.scene,
            this.interaction,
            document.getElementById('resizable-editor')
          );
          this.editor.setupPanel();
          this.editor.show();
        }
      },
      {
        icon    : '🔠',
        title   : i18n.t('ui.explorer.menu.editSurveySheet'),
        onclick : () => {
          this.editor = new SurveySheetEditor(
            this.db,
            surveyNode.parent.data,
            surveyNode.data,
            document.getElementById('fixed-size-editor'),
            this.declinationCache

          );
          this.editor.setupPanel();
          this.editor.show();
        }
      },
      {
        icon    : '🎨',
        title   : i18n.t('ui.explorer.menu.setSurveyColor'),
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
        title   : i18n.t('ui.explorer.menu.deleteSurvey'),
        onclick : () => {
          const result = confirm(i18n.t('ui.explorer.confirm.deleteSurvey', { name: surveyNode.data.name }));
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

  closeEditorsForCave(caveName) {
    if (this.editor !== undefined && !this.closed && this.editor.cave.name === caveName) {
      this.editor.closeEditor();
    }
  }

  hideContextMenu() {
    this.contextMenu.style.display = 'none';
  }

  hideContextMenuOnClickOutside(event) {
    if (this.contextMenu.style.display !== 'none' && this.contextMenu.node?.id) {
      // Check if the click target is within the node element using data-node-id
      const nodeElement = this.container.querySelector(`[data-node-id="${this.contextMenu.node.id}"]`);
      if (nodeElement && !nodeElement.contains(event.target)) {
        this.hideContextMenu();
      }
    }
  }

  render() {
    // Clear only the tree content, not the filter input
    const treeContent = this.container.querySelector('.explorer-tree-content');
    if (treeContent) {
      treeContent.remove();
    }

    // Create tree content container
    const treeContentContainer = document.createElement('div');
    treeContentContainer.className = 'explorer-tree-content';

    // Check if we have any caves at all (not just filtered results)
    if (this.nodes.size === 0) {
      const emptyMessage = document.createElement('div');
      emptyMessage.className = 'explorer-empty';
      emptyMessage.textContent = i18n.t('ui.explorer.noCaves');
      emptyMessage.style.padding = '20px';
      emptyMessage.style.textAlign = 'center';
      emptyMessage.style.color = '#666';
      treeContentContainer.appendChild(emptyMessage);
      return;
    }

    // Render caves and their surveys (filtered if needed)
    const nodesToRender = this.filterText ? this.filteredNodes : this.nodes;

    if (nodesToRender.size === 0 && this.filterText) {
      // Show "no results" message when filtering returns nothing
      const noResultsMessage = document.createElement('div');
      noResultsMessage.className = 'explorer-empty';
      noResultsMessage.textContent = i18n.t('ui.explorer.filter.noResults');
      noResultsMessage.style.padding = '20px';
      noResultsMessage.style.textAlign = 'center';
      noResultsMessage.style.color = '#666';
      treeContentContainer.appendChild(noResultsMessage);
    } else {
      // Render the matching nodes
      nodesToRender.values().forEach((caveNode) => {
        this.renderNode(caveNode, 0, treeContentContainer);
      });
    }

    this.container.appendChild(treeContentContainer);
  }

  renderFilterInput() {
    this.filterInputContainer = document.createElement('div');
    this.filterInputContainer.className = 'explorer-filter-container';

    // Create search mode selector
    const modeSelector = document.createElement('div');
    modeSelector.className = 'explorer-filter-mode-selector';

    const caveSurveyButton = document.createElement('button');
    caveSurveyButton.className = 'explorer-filter-mode-button active';
    caveSurveyButton.innerHTML = '♎';
    caveSurveyButton.title = i18n.t('ui.explorer.filter.tooltip', {
      mode : i18n.t('ui.explorer.filter.modes.caveSurvey')
    });
    caveSurveyButton.onclick = () => this.setSearchMode('caveSurvey');

    const shotNamesButton = document.createElement('button');
    shotNamesButton.className = 'explorer-filter-mode-button';
    shotNamesButton.innerHTML = '📍';
    shotNamesButton.title = i18n.t('ui.explorer.filter.tooltip', {
      mode : i18n.t('ui.explorer.filter.modes.shotNames')
    });
    shotNamesButton.onclick = () => this.setSearchMode('shotNames');

    modeSelector.appendChild(caveSurveyButton);
    modeSelector.appendChild(shotNamesButton);

    // Store references to buttons for updating active state
    this.caveSurveyButton = caveSurveyButton;
    this.shotNamesButton = shotNamesButton;

    const filterInput = document.createElement('input');
    filterInput.type = 'text';
    filterInput.className = 'explorer-filter-input';
    filterInput.placeholder = i18n.t('ui.explorer.filter.placeholder');

    filterInput.addEventListener('input', (e) => {
      this.filterText = e.target.value.toLowerCase();
      this.applyFilter();
      this.render();
    });

    this.filterInputContainer.appendChild(modeSelector);
    this.filterInputContainer.appendChild(filterInput);
    this.container.appendChild(this.filterInputContainer);
  }

  updateFilterInputUI() {
    if (!this.filterInputContainer) return;

    const filterInput = this.filterInputContainer.querySelector('.explorer-filter-input');
    const existingClearButton = this.filterInputContainer.querySelector('.explorer-filter-clear');

    if (filterInput) {
      filterInput.value = this.filterText;
    }

    // Show/hide clear button based on filter text
    if (this.filterText && !existingClearButton) {
      const clearButton = document.createElement('button');
      clearButton.className = 'explorer-filter-clear';
      clearButton.innerHTML = '×';
      clearButton.title = i18n.t('ui.explorer.filter.clear');
      clearButton.onclick = () => {
        this.clearFilter();
      };
      this.filterInputContainer.appendChild(clearButton);
    } else if (!this.filterText && existingClearButton) {
      existingClearButton.remove();
    }
  }

  applyFilter() {
    this.filteredNodes.clear();

    if (!this.filterText.trim()) {
      return;
    }

    if (this.searchMode === 'shotNames') {
      // Filter by shot names (from/to stations)
      for (const [caveName, caveNode] of this.nodes) {
        const matchingSurveys = [];

        for (const survey of caveNode.children) {
          const surveyData = survey.data;
          if (surveyData && surveyData.shots) {
            // Check if any shots have matching from/to station names
            const hasMatchingShots = surveyData.shots.some(
              (shot) =>
                shot.from.toLowerCase().includes(this.filterText) ||
                (shot.to && shot.to.toLowerCase().includes(this.filterText))
            );

            if (hasMatchingShots) {
              matchingSurveys.push(survey);
            }
          }
        }

        if (matchingSurveys.length > 0) {
          const filteredCaveNode = {
            ...caveNode,
            children : matchingSurveys
          };

          // Ensure the filtered node has the same expansion state as the original
          filteredCaveNode.expanded = caveNode.expanded;
          filteredCaveNode.selected = caveNode.selected;

          // Ensure proper parent references
          filteredCaveNode.children = matchingSurveys.map((survey) => ({
            ...survey,
            parent   : filteredCaveNode,
            selected : survey.selected
          }));

          this.filteredNodes.set(caveName, filteredCaveNode);
        }
      }
    } else {
      // Filter caves and surveys based on name (original behavior)
      for (const [caveName, caveNode] of this.nodes) {
        const caveMatches = caveName.toLowerCase().includes(this.filterText);

        // Check if any surveys match
        const matchingSurveys = caveNode.children.filter((survey) =>
          survey.label.toLowerCase().includes(this.filterText)
        );

        // Include cave if it matches or has matching surveys
        if (caveMatches || matchingSurveys.length > 0) {
          const filteredCaveNode = {
            ...caveNode,
            children : caveMatches ? caveNode.children : matchingSurveys
          };

          // Ensure the filtered node has the same expansion state as the original
          filteredCaveNode.expanded = caveNode.expanded;

          // Ensure the filtered node has the same selection state as the original
          filteredCaveNode.selected = caveNode.selected;

          // If we're only showing matching surveys, ensure they have proper parent references
          if (!caveMatches && matchingSurveys.length > 0) {
            filteredCaveNode.children = matchingSurveys.map((survey) => ({
              ...survey,
              parent   : filteredCaveNode, // Ensure proper parent reference
              selected : survey.selected // Preserve selection state
            }));
          }

          this.filteredNodes.set(caveName, filteredCaveNode);
        }
      }
    }

    // Update the filter input UI
    this.updateFilterInputUI();
  }

  renderNode(node, level, container) {
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
      const hasIssues =
        survey.isolated === true ||
        survey.orphanShotIds.size > 0 ||
        survey.invalidShotIds.size > 0 ||
        survey.duplicateShotIds.size > 0;

      if (hasIssues) {
        const warningIcon = document.createElement('div');
        warningIcon.className = 'explorer-tree-warning';

        if (survey.isolated === true) {
          warningIcon.innerHTML = '❌';
          warningIcon.title = i18n.t('ui.explorer.tree.isolated');
          nodeElement.title = i18n.t('ui.explorer.tree.isolated');
        } else if (
          survey.invalidShotIds.size > 0 ||
          survey.orphanShotIds.size > 0 ||
          survey.duplicateShotIds.size > 0
        ) {
          const nrInvalidOrpath = survey.orphanShotIds
            .difference(survey.invalidShotIds)
            .difference(survey.duplicateShotIds).size;
          warningIcon.innerHTML = '⚠️';
          warningIcon.title = i18n.t('ui.explorer.tree.invalid', {
            nrInvalid   : survey.invalidShotIds.size,
            nrDuplicate : survey.duplicateShotIds.size,
            nrOrphan    : nrInvalidOrpath
          });
          nodeElement.title = i18n.t('ui.explorer.tree.invalid', {
            nrInvalid   : survey.invalidShotIds.size,
            nrDuplicate : survey.duplicateShotIds.size,
            nrOrphan    : nrInvalidOrpath
          });
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
    nodeElement.onclick = (e) => {
      e.stopPropagation();
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

    container.appendChild(nodeElement);
    node.element = nodeElement;

    // Render children if expanded
    if (node.expanded && node.children && node.children.length > 0) {
      node.children.forEach((child) => {
        this.renderNode(child, level + 1, container);
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

  clearFilter() {
    this.filterText = '';
    this.filteredNodes.clear();

    // Reset search mode to default
    this.setSearchMode('caveSurvey');

    // Update the filter input UI
    this.updateFilterInputUI();

    this.render();
  }
}
