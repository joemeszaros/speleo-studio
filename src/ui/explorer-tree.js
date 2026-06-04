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

import { SurveyEditor } from './editor/survey.js';
import { SurveySheetEditor } from './editor/survey-sheet.js';
import { CaveEditor } from './editor/cave.js';
import { StationAttributeEditor, SectionAttributeEditor, ComponentAttributeEditor } from './editor/attributes.js';
import { CyclePanel } from './editor/cycle.js';
import { StationCommentsEditor } from './editor/station-comments.js';
import { StationDimensionsEditor } from './editor/station-dimensions.js';
import { ExportWindow } from '../io/export.js';
import { i18n } from '../i18n/i18n.js';

export class ExplorerTree {
  constructor(
    db,
    options,
    scene,
    interaction,
    attributeDefs,
    declinationCache,
    container,
    contextMenuElement,
    projectSystem
  ) {
    this.db = db;
    this.options = options;
    this.scene = scene;
    this.interaction = interaction;
    this.attributeDefs = attributeDefs;
    this.declinationCache = declinationCache;
    this.container = container;
    this.contextMenu = contextMenuElement;
    this.projectSystem = projectSystem;
    this.nodes = new Map();
    this.selectedNode = null;
    this.expandedNodes = new Set();
    this.cavesCategoryExpanded = true;
    this.filterText = '';
    this.filteredNodes = new Map();
    this.searchMode = 'caveSurvey'; // 'caveSurvey' or 'shotNames'

    this.partialImport = undefined;
    this.draggedNode = null; // Track the currently dragged survey node
    this.currentDropTarget = null; // Track the current drop target

    document.addEventListener('languageChanged', () => this.render());
    document.addEventListener('click', this.hideContextMenuOnClickOutside.bind(this));
    document.addEventListener('currentProjectChanged', () => this.#updateAddCaveButtonState());
    document.addEventListener('currentProjectDeleted', () => this.#updateAddCaveButtonState());
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
    // Build the whole nested tree (a cave may contain child caves and surveys). The
    // top-level node keeps the cave name as its id (the nodes map is keyed by it);
    // nested cave/survey nodes use the model object's unique id (names are not unique
    // across the tree). `rootCaveName` is the scene's outer key for every descendant.
    const node = this.#buildCaveNode(cave, cave.name, null, cave.name);

    this.insertCaveInAlphabeticalOrder(node);

    // Reapply filter if active
    if (this.filterText) {
      this.applyFilter();
    }

    this.render();
    return node;
  }

  #buildCaveNode(cave, rootCaveName, parent, idOverride) {
    const id = idOverride ?? cave.id;
    const node = {
      id,
      type     : 'cave',
      label    : cave.name,
      data     : cave,
      rootCaveName,
      parent,
      children : [],
      visible  : cave.visible !== false,
      expanded : this.expandedNodes.has(id)
    };
    for (const child of cave.children) {
      node.children.push(this.#buildCaveNode(child, rootCaveName, node));
    }
    for (const survey of cave.surveys) {
      node.children.push(this.#buildSurveyNode(survey, rootCaveName, node));
    }
    return node;
  }

  #buildSurveyNode(survey, rootCaveName, parent) {
    return {
      id       : survey.id,
      type     : 'survey',
      label    : survey.name,
      data     : survey,
      rootCaveName,
      parent,
      children : [], // leaf; kept for uniform tree traversal
      visible  : survey.visible !== false && parent.visible,
      expanded : false
    };
  }

  /**
   * Inserts a cave node in alphabetical order within the nodes map
   * @param {Object} caveNode - The cave node to insert
   */
  insertCaveInAlphabeticalOrder(caveNode) {
    // Convert current nodes to array and sort alphabetically
    const currentNodes = Array.from(this.nodes.values()).sort((a, b) => a.label.localeCompare(b.label));

    // Find the correct position for the new cave
    let insertIndex = currentNodes.length;
    for (let i = 0; i < currentNodes.length; i++) {
      if (caveNode.label.localeCompare(currentNodes[i].label) < 0) {
        insertIndex = i;
        break;
      }
    }

    // Insert the new cave at the correct position
    currentNodes.splice(insertIndex, 0, caveNode);

    // Rebuild the nodes map with the new order
    this.nodes.clear();
    currentNodes.forEach((node) => {
      this.nodes.set(node.id, node);
    });
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

    // Remove the first survey node with this name anywhere in the cave's subtree.
    const removeFrom = (node) => {
      const idx = node.children.findIndex((c) => c.type === 'survey' && c.label === surveyName);
      if (idx !== -1) {
        node.children.splice(idx, 1);
        return true;
      }
      return node.children.some((c) => c.type === 'cave' && removeFrom(c));
    };

    if (removeFrom(caveNode)) {
      if (this.filterText) {
        this.applyFilter();
      }
      this.render();
    }
  }

  renameCave(oldName, newName) {
    if (!this.nodes.has(oldName)) return;
    const caveNode = this.nodes.get(oldName);

    caveNode.label = newName;
    caveNode.id = newName;

    // The cave name is the scene's outer key for every descendant — update it.
    const updateRoot = (node) => {
      node.rootCaveName = newName;
      node.children.forEach(updateRoot);
    };
    updateRoot(caveNode);

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

  renameSurvey(survey, newName) {
    // Survey nodes can be anywhere in the (possibly nested) tree and are identified by survey.id.
    // findNodeById searches the whole tree; the previous name+cave-name lookup missed surveys in
    // sub-caves (this.nodes holds only top-level cave nodes, keyed by cave name).
    const surveyNode = this.findNodeById(survey.id);
    if (surveyNode) surveyNode.label = newName;

    // Reapply filter if active
    if (this.filterText) {
      this.applyFilter();
    }

    this.render();
  }

  updateCave(cave) {
    if (!this.nodes.has(cave.name)) return;
    // Rebuild the cave's node subtree so structural changes (reorder, add/remove,
    // recalculated state) are reflected; expansion state is restored from expandedNodes.
    const node = this.#buildCaveNode(cave, cave.name, null, cave.name);
    this.nodes.set(cave.name, node);

    if (this.filterText) {
      this.applyFilter();
    }

    this.render();
  }

  // Helper method to find a node by ID (recursively searches the whole nested tree)
  findNodeById(nodeId) {
    const topLevelNode = this.nodes.get(nodeId);
    if (topLevelNode) return topLevelNode;

    const search = (nodes) => {
      for (const node of nodes) {
        if (node.id === nodeId) return node;
        if (node.children && node.children.length > 0) {
          const found = search(node.children);
          if (found) return found;
        }
      }
      return null;
    };

    const fromMain = search([...this.nodes.values()]);
    if (fromMain) return fromMain;

    if (this.filterText && this.filteredNodes.size > 0) {
      return search([...this.filteredNodes.values()]);
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
      node.data.visible = node.visible;
      // Reflect the change on the survey's ancestor cave nodes (turning a survey on makes
      // its ancestors visible; turning the last visible survey off hides the parent).
      let p = node.parent;
      while (p) {
        if (node.visible) {
          p.visible = true;
          p.data.visible = true;
        } else if (p.children.every((child) => !child.visible)) {
          p.visible = false;
          p.data.visible = false;
        }
        p = p.parent;
      }
      this.scene.speleo.setSurveyVisibility(node.rootCaveName, node.data.id, node.visible);
    } else if (node.type === 'cave') {
      // Cascade to the whole subtree (descendant caves + surveys).
      this.#setSubtreeVisibility(node, node.visible);
      // Update start point visibility to match the top cave's visibility
      this.scene.startPoint.updateStartingPointVisibility(node.rootCaveName, node.visible);
    }

    const boundingBox = this.scene.computeBoundingBox();
    if (boundingBox) {
      this.scene.grid.adjust(boundingBox);
    }

    this.scene.view.refreshElevationIndicators?.();
    this.scene.view.renderView();
    this.render();
  }

  // Recursively set visibility on a cave node and its entire subtree (child caves + surveys),
  // pushing each survey's visibility to the scene (keyed by the survey's unique id).
  #setSubtreeVisibility(node, visible) {
    node.visible = visible;
    node.data.visible = visible;
    for (const child of node.children) {
      if (child.type === 'survey') {
        child.visible = visible;
        child.data.visible = visible;
        this.scene.speleo.setSurveyVisibility(child.rootCaveName, child.data.id, visible);
      } else {
        this.#setSubtreeVisibility(child, visible);
      }
    }
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
        // Re-render to hide up arrow
        this.render();
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

      // Re-render to show/hide up arrow for selected survey
      this.render();

      // If filtering is active, reapply the filter to maintain the filtered view with selection
      if (this.filterText) {
        this.applyFilter();
        // Defer the render slightly to ensure selection is shown after render completes
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

    const readOnly = caveNode.data.readOnly === true;

    const items = [
      {
        id      : 'editCaveData',
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
        id      : 'newSurvey',
        icon    : '📝',
        title   : i18n.t('ui.explorer.menu.newSurvey'),
        onclick : () => {
          editorSetup(
            new SurveySheetEditor(
              this.db,
              caveNode.data,
              undefined,
              document.getElementById('fixed-size-editor'),
              this.declinationCache,
              this.options
            )
          );
        }
      },
      {
        id      : 'newSubCave',
        icon    : '♎',
        title   : i18n.t('ui.explorer.menu.newSubCave'),
        onclick : () => {
          editorSetup(
            new CaveEditor(
              this.db,
              this.options,
              undefined,
              this.scene,
              document.getElementById('fixed-size-editor'),
              caveNode.data
            )
          );
        }
      },
      {
        id      : 'importSurvey',
        icon    : '<img src="icons/topodroid.png" alt="TopoDroid" style="width: 20px; height: 20px;">',
        title   : i18n.t('ui.explorer.menu.importSurvey'),
        onclick : () => {
          const surveyInput = document.getElementById('surveyInput');
          surveyInput.caveName = caveNode.data.name;
          surveyInput.click();
        }
      },
      {
        id      : 'editStationAttributes',
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
        id      : 'editSectionAttributes',
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
        id      : 'editComponentAttributes',
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
        id      : 'editStationComments',
        icon    : '💬',
        title   : i18n.t('ui.explorer.menu.editStationComments'),
        onclick : () => {
          this.editor = new StationCommentsEditor(
            this.options,
            caveNode.data,
            document.getElementById('resizable-editor')
          );
          this.editor.setupPanel();
          this.editor.show();
        }
      },
      {
        id      : 'editStationDimensions',
        icon    : '<img src="icons/lrud.svg" alt="LRUD" style="width: 18px; height: 18px;">',
        title   : i18n.t('ui.explorer.menu.editStationDimensions'),
        onclick : () => {
          this.editor = new StationDimensionsEditor(
            this.options,
            caveNode.data,
            document.getElementById('resizable-editor')
          );
          this.editor.setupPanel();
          this.editor.show();
        }
      },
      {
        id      : 'cycles',
        icon    : '🔄',
        title   : i18n.t('ui.explorer.menu.cycles'),
        onclick : () => {
          editorSetup(
            new CyclePanel(this.options, document.getElementById('resizable-editor'), this.scene, caveNode.data)
          );
        }
      },
      {
        id      : 'setCaveColor',
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
            this.options.scene.caveLines.color.trigger = {
              reason : 'caveColor',
              cave   : caveNode.data.name,
              color  : e.target.value
            };
            this.render();
            // Persist the color (saveCave resolves the root, so a sub-cave color is stored in its
            // top-level cave record). 'color' is a cosmetic reason → saved without a recompute.
            document.dispatchEvent(
              new CustomEvent('caveChanged', {
                detail : { cave: caveNode.data, reasons: ['color'], source: 'explorer' }
              })
            );
          });

        }
      },
      {
        id      : 'clearCaveColor',
        icon    : '<span style="text-decoration: line-through; text-decoration-color: red; text-decoration-thickness: 2px; transform: rotate(45deg); display: inline-block;">🎨</span>',
        title   : i18n.t('ui.explorer.menu.clearCaveColor'),
        onclick : () => {
          caveNode.data.color = undefined;
          this.options.scene.caveLines.color.trigger = {
            reason : 'caveColor',
            cave   : caveNode.data.name,
            color  : undefined
          };
          this.render();
          document.dispatchEvent(
            new CustomEvent('caveChanged', { detail: { cave: caveNode.data, reasons: ['color'], source: 'explorer' } })
          );

        }
      },
      {
        id      : 'exportCave',
        icon    : '📤',
        title   : i18n.t('ui.explorer.menu.exportCave'),
        onclick : () => {
          new ExportWindow(
            [caveNode.data],
            this.projectSystem.getCurrentProject(),
            this.scene,
            document.getElementById('export-panel')
          ).show();
        }
      },
      {
        id      : 'deleteCave',
        icon    : '🗑️',
        title   : i18n.t('ui.explorer.menu.deleteCave'),
        onclick : () => {
          const result = confirm(i18n.t('ui.explorer.confirm.deleteCave', { name: caveNode.data.name }));
          if (result) {
            this.db.deleteCave(caveNode.data.name);
            const event = new CustomEvent('caveDeleted', {
              detail : {
                name   : caveNode.data.name,
                id     : caveNode.data.id,
                source : 'explorer-tree'
              }
            });
            document.dispatchEvent(event);
          }

        }
      }
    ];

    // Read-only caves (Survex .3d) are visualization-only: keep only the non-editing
    // actions (view cave sheet, set/clear color, delete cave). Editing actions —
    // new/import survey, attribute editors, comments, dimensions, cycles — are omitted.
    const readOnlyAllowed = new Set(['editCaveData', 'setCaveColor', 'clearCaveColor', 'exportCave', 'deleteCave']);
    const caveItems = readOnly ? items.filter((i) => readOnlyAllowed.has(i.id)) : items;
    this.showContextMenu(caveNode, caveItems);
  }

  showSurveyContextMenu(surveyNode) {
    const readOnly = surveyNode.parent?.data?.readOnly === true;
    const items = [
      {
        id      : 'openSurveyEditor',
        icon    : '📝',
        title   : i18n.t('ui.explorer.menu.openSurveyEditor'),
        onclick : () => this.#openSurveyEditor(surveyNode)
      },
      {
        id      : 'editSurveySheet',
        icon    : '🔠',
        title   : i18n.t('ui.explorer.menu.editSurveySheet'),
        onclick : () => {
          this.editor = new SurveySheetEditor(
            this.db,
            surveyNode.parent.data,
            surveyNode.data,
            document.getElementById('fixed-size-editor'),
            this.declinationCache,
            this.options
          );
          this.editor.setupPanel();
          this.editor.show();
        }
      },
      {
        id      : 'importSurvey',
        icon    : '<img src="icons/topodroid.png" alt="TopoDroid" style="width: 20px; height: 20px;">',
        title   : i18n.t('ui.explorer.menu.importSurvey'),
        onclick : () => {
          const surveyInput = document.getElementById('surveyInputPartial');
          this.partialImport = {
            cave   : surveyNode.parent.data,
            survey : surveyNode.data
          };
          surveyInput.click();
        }
      },
      {
        id      : 'setSurveyColor',
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
            this.options.scene.caveLines.color.trigger = {
              reason : 'surveyColor',
              survey : surveyNode.data.name,
              cave   : surveyNode.parent.data.name,
              color  : e.target.value
            };
            this.render();
            // Persist the survey color via its owning cave (saveCave stores the root record).
            document.dispatchEvent(
              new CustomEvent('surveyChanged', {
                detail : { cave: surveyNode.parent.data, survey: surveyNode.data, reasons: ['color'] }
              })
            );
          });
        }
      },
      {
        id      : 'clearSurveyColor',
        icon    : '<span style="text-decoration: line-through; text-decoration-color: red; text-decoration-thickness: 2px; transform: rotate(45deg); display: inline-block;">🎨</span>',
        title   : i18n.t('ui.explorer.menu.clearSurveyColor'),
        onclick : () => {
          surveyNode.data.color = undefined;
          this.options.scene.caveLines.color.trigger = {
            reason : 'surveyColor',
            survey : surveyNode.data.name,
            cave   : surveyNode.parent.data.name,
            color  : undefined
          };
          this.render();
          document.dispatchEvent(
            new CustomEvent('surveyChanged', {
              detail : { cave: surveyNode.parent.data, survey: surveyNode.data, reasons: ['color'] }
            })
          );

        }
      },
      {
        id      : 'deleteSurvey',
        icon    : '🗑️',
        title   : i18n.t('ui.explorer.menu.deleteSurvey'),
        onclick : () => {
          const result = confirm(i18n.t('ui.explorer.confirm.deleteSurvey', { name: surveyNode.data.name }));
          if (result) {
            // Remove from the survey's owning cave node (works for nested + flat). The
            // event carries the ROOT cave name so the manager recalculates/saves the
            // whole network (one stored record per top-level cave).
            const owningCave = surveyNode.parent.data;
            const idx = owningCave.surveys.indexOf(surveyNode.data);
            if (idx !== -1) owningCave.surveys.splice(idx, 1);
            const event = new CustomEvent('surveyDeleted', {
              detail : {
                cave   : surveyNode.rootCaveName,
                survey : surveyNode.data.name
              }
            });
            document.dispatchEvent(event);
          }
        }
      }

    ];

    // Surveys of a read-only cave (Survex .3d) are visualization-only: keep the
    // survey sheet (metadata viewer) and color, but drop the survey editor (shot
    // grid), import-survey and delete-survey. Only delete-cave is offered, on the
    // cave node.
    const readOnlyAllowed = new Set(['editSurveySheet', 'setSurveyColor', 'clearSurveyColor']);
    const surveyItems = readOnly ? items.filter((i) => readOnlyAllowed.has(i.id)) : items;
    this.showContextMenu(surveyNode, surveyItems);
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
    if (this.editor !== undefined && !this.editor.closed && this.editor?.cave?.name === caveName) {
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

    // Check if we have any caves at all
    if (this.nodes.size === 0) {
      const emptyMessage = document.createElement('div');
      emptyMessage.className = 'explorer-empty';
      emptyMessage.textContent = i18n.t('ui.explorer.noCaves');
      emptyMessage.style.padding = '20px';
      emptyMessage.style.textAlign = 'center';
      emptyMessage.style.color = '#666';
      treeContentContainer.appendChild(emptyMessage);
      this.container.appendChild(treeContentContainer);
      return;
    }

    // Render caves and their surveys (filtered if needed)
    const nodesToRender = this.filterText ? this.filteredNodes : this.nodes;

    if (nodesToRender.size === 0 && this.filterText) {
      const noResultsMessage = document.createElement('div');
      noResultsMessage.className = 'explorer-empty';
      noResultsMessage.textContent = i18n.t('ui.explorer.filter.noResults');
      noResultsMessage.style.padding = '20px';
      noResultsMessage.style.textAlign = 'center';
      noResultsMessage.style.color = '#666';
      treeContentContainer.appendChild(noResultsMessage);
    } else {
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

    const addCaveButton = document.createElement('button');
    addCaveButton.className = 'explorer-add-cave-btn';
    addCaveButton.innerHTML = '+';
    addCaveButton.title = i18n.t('ui.explorer.newCave');
    addCaveButton.onclick = () => {
      if (addCaveButton.disabled) return;
      document.dispatchEvent(new CustomEvent('newCaveRequested'));
    };
    this.addCaveButton = addCaveButton;

    this.filterInputContainer.appendChild(modeSelector);
    this.filterInputContainer.appendChild(filterInput);
    this.filterInputContainer.appendChild(addCaveButton);
    this.container.appendChild(this.filterInputContainer);

    this.#updateAddCaveButtonState();
  }

  #openSurveyEditor(surveyNode) {
    this.editor = new SurveyEditor(
      this.options,
      surveyNode.parent.data,
      surveyNode.data,
      this.scene,
      this.interaction,
      document.getElementById('resizable-editor'),
      undefined,
      this.attributeDefs
    );
    this.editor.setupPanel();
    this.editor.show();
  }

  #updateAddCaveButtonState() {
    if (!this.addCaveButton) return;
    const hasProject = this.projectSystem?.getCurrentProject() != null;
    this.addCaveButton.disabled = !hasProject;
    this.addCaveButton.classList.toggle('disabled', !hasProject);
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

    // Recursively filter the (arbitrarily nested) tree. Each top-level cave is pruned to a
    // copy that keeps only nodes which match the query or have a matching descendant; a node
    // that matches by name keeps its whole subtree. Works for both search modes and any
    // nesting depth (sub-caves, sub-surveys), so e.g. a station name deep in a sub-cave is
    // found. Returns a filtered copy of `node`, or null when nothing in the subtree matches.
    for (const [caveName, caveNode] of this.nodes) {
      const filtered = this.#filterNode(caveNode, null);
      if (filtered) this.filteredNodes.set(caveName, filtered);
    }

    // Update the filter input UI
    this.updateFilterInputUI();
  }

  // True when this node itself matches the active query (name, or shot station names in
  // shotNames mode). Container/leaf agnostic.
  #nodeSelfMatches(node) {
    if (this.searchMode === 'shotNames') {
      const shots = node.data?.shots;
      if (!shots) return false;
      return shots.some(
        (shot) =>
          (shot.from && shot.from.toLowerCase().includes(this.filterText)) ||
          (shot.to && shot.to.toLowerCase().includes(this.filterText))
      );
    }
    return (node.label ?? '').toLowerCase().includes(this.filterText);
  }

  // Builds a filtered copy of `node` (with `parent` rewired to the filtered parent), keeping
  // only matching nodes / ancestors-of-matches. Returns null if nothing matches in the subtree.
  #filterNode(node, filteredParent) {
    const copy = { ...node, parent: filteredParent };
    const selfMatch = this.#nodeSelfMatches(node);

    if (selfMatch) {
      // Keep the whole subtree under a matched node, but rewire parents on the copies.
      copy.children = (node.children ?? []).map((c) => {
        const childCopy = this.#filterNode(c, copy) ?? { ...c, parent: copy };
        return childCopy;
      });
      copy.expanded = node.expanded;
      return copy;
    }

    // No self-match: keep only children that contain a match.
    const keptChildren = [];
    for (const child of node.children ?? []) {
      const fc = this.#filterNode(child, copy);
      if (fc) keptChildren.push(fc);
    }
    if (keptChildren.length === 0) return null;

    copy.children = keptChildren;
    // Force-expand containers on the path to a match so the result is visible.
    copy.expanded = true;
    return copy;
  }

  renderCaveNode(node, container) {
    const categoryElement = document.createElement('div');
    categoryElement.className = 'models-tree-category';
    categoryElement.setAttribute('data-node-id', node.id);

    // Category-style header
    const header = document.createElement('div');
    header.className = 'models-tree-category-header';
    if (node.selected) header.classList.add('selected');

    // Toggle arrow
    const toggle = document.createElement('div');
    toggle.className = `models-tree-toggle ${node.expanded ? 'expanded' : 'collapsed'}`;
    toggle.innerHTML = '▶';
    toggle.onclick = (e) => {
      e.stopPropagation();
      this.toggleNodeExpansion(node.id);
    };
    header.appendChild(toggle);

    // Cave name label
    const label = document.createElement('span');
    label.className = 'models-tree-category-label';
    label.textContent = node.label;
    if (node.data.color) {
      label.style.color = node.data.color;
    }
    header.appendChild(label);

    // Survey status badges
    if (node.children && node.children.length > 0) {
      let valid = 0,
        warning = 0,
        isolated = 0;
      for (const child of node.children) {
        const s = child.data;
        if (s.isolated === true) {
          isolated++;
        } else if (s.invalidShotIds?.size > 0 || s.orphanShotIds?.size > 0 || s.duplicateShotIds?.size > 0) {
          warning++;
        } else {
          valid++;
        }
      }

      const badgeContainer = document.createElement('span');
      badgeContainer.style.display = 'flex';
      badgeContainer.style.gap = '3px';

      if (valid > 0) {
        const b = document.createElement('span');
        b.className = 'models-tree-count';
        b.textContent = valid;
        badgeContainer.appendChild(b);
      }
      if (warning > 0) {
        const b = document.createElement('span');
        b.className = 'models-tree-count';
        b.style.background = '#e6a817';
        b.textContent = warning;
        badgeContainer.appendChild(b);
      }
      if (isolated > 0) {
        const b = document.createElement('span');
        b.className = 'models-tree-count';
        b.style.background = '#d44';
        b.textContent = isolated;
        badgeContainer.appendChild(b);
      }

      header.appendChild(badgeContainer);
    }

    // Hamburger menu button
    const menuBtn = document.createElement('div');
    menuBtn.className = 'tree-node-menu-btn';
    menuBtn.textContent = '⋮';
    menuBtn.onclick = (e) => {
      e.stopPropagation();
      this.selectNode(node.id);
      this.showCaveContextMenu(node);
    };
    header.appendChild(menuBtn);

    // Visibility toggle
    const visibility = document.createElement('div');
    visibility.className = `explorer-tree-visibility ${node.visible ? 'visible' : 'hidden'}`;
    visibility.innerHTML = node.visible ? '👁️' : '<span class="eye-strikethrough">👁️</span>';
    visibility.onclick = (e) => {
      e.stopPropagation();
      this.toggleNodeVisibility(node.id);
    };
    header.appendChild(visibility);

    // Left-click to select and hide context menu
    header.onclick = (e) => {
      e.stopPropagation();
      this.hideContextMenu();
      this.selectNode(node.id);
    };

    // Right-click for context menu
    header.oncontextmenu = (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.selectNode(node.id);
      this.showCaveContextMenu(node);
    };

    // Drag and drop for cave reordering
    header.draggable = true;
    header.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', node.id);
      e.dataTransfer.effectAllowed = 'move';
      categoryElement.classList.add('dragging');
      this.draggedNode = node;
    });
    header.addEventListener('dragend', () => {
      categoryElement.classList.remove('dragging');
      if (this.draggedNode && this.currentDropTarget && this.currentDropTarget !== categoryElement) {
        const targetNodeId = this.currentDropTarget.getAttribute('data-node-id');
        if (targetNodeId) this.handleCaveDrop(this.draggedNode.id, targetNodeId);
      }
      this.draggedNode = null;
      this.clearDropIndicators();
    });
    categoryElement.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      this.showDropIndicator(categoryElement, e);
    });
    categoryElement.addEventListener('dragleave', (e) => {
      if (!categoryElement.contains(e.relatedTarget)) this.clearDropIndicators();
    });
    categoryElement.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.handleCaveDrop(e.dataTransfer.getData('text/plain'), node.id);
      this.clearDropIndicators();
    });

    categoryElement.appendChild(header);
    node.element = header;

    // Render survey children when expanded
    if (node.expanded && node.children && node.children.length > 0) {
      const childrenContainer = document.createElement('div');
      childrenContainer.className = 'models-tree-children';

      node.children.forEach((child) => {
        this.renderNode(child, 0, childrenContainer);
      });

      categoryElement.appendChild(childrenContainer);
    }

    container.appendChild(categoryElement);
  }

  renderNode(node, level, container) {
    if (node.type === 'cave') {
      this.renderCaveNode(node, container);
      return;
    }

    const nodeElement = document.createElement('div');
    nodeElement.className = 'explorer-tree-node';
    nodeElement.setAttribute('data-node-id', node.id);

    if (node.selected) {
      nodeElement.classList.add('selected');
    }

    // Spacer for leaf nodes (surveys don't have children toggle)
    const spacer = document.createElement('div');
    spacer.className = 'explorer-tree-toggle';
    spacer.style.visibility = 'hidden';
    nodeElement.appendChild(spacer);

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
    nodeElement.appendChild(label);
    nodeElement.onclick = (e) => {
      e.stopPropagation();
      this.hideContextMenu();
      this.selectNode(node.id);
    };

    // Double-click opens the survey editor (shot grid). Read-only caves (Survex .3d)
    // are visualization-only — the editor stays locked, use the survey sheet instead.
    if (node.type === 'survey' && node.parent?.data?.readOnly !== true) {
      nodeElement.ondblclick = (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.hideContextMenu();
        this.#openSurveyEditor(node);
      };
    }

    // Right-click to show context menu
    nodeElement.oncontextmenu = (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.selectNode(node.id);
      if (node.type === 'survey') {
        this.showSurveyContextMenu(node);
      }
    };

    // Add move up button for selected survey nodes (before visibility icon)
    if (node.type === 'survey' && node.selected) {
      const moveUpButton = document.createElement('div');
      moveUpButton.className = 'explorer-tree-move-up';
      moveUpButton.innerHTML = '⇧';
      moveUpButton.title = 'Move to top';
      moveUpButton.onclick = (e) => {
        e.stopPropagation();
        this.moveSurveyToTop(node.id);
      };
      nodeElement.appendChild(moveUpButton);
    }

    // Add drag and drop functionality for survey nodes
    if (node.type === 'survey') {
      nodeElement.draggable = true;
      nodeElement.classList.add('draggable-survey');

      nodeElement.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', node.id);
        e.dataTransfer.effectAllowed = 'move';
        nodeElement.classList.add('dragging');
        this.draggedNode = node;
      });

      nodeElement.addEventListener('dragend', () => {
        nodeElement.classList.remove('dragging');

        // Fallback: if we have a current drop target but no drop event was triggered
        if (this.draggedNode && this.currentDropTarget && this.currentDropTarget !== nodeElement) {
          const draggedNodeId = this.draggedNode.id;
          const targetNodeId = this.currentDropTarget.getAttribute('data-node-id');
          if (targetNodeId) {
            this.handleSurveyDrop(draggedNodeId, targetNodeId);
          }
        }

        this.draggedNode = null;
        this.clearDropIndicators();
      });

      nodeElement.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        this.showDropIndicator(nodeElement, e);
      });

      nodeElement.addEventListener('dragleave', (e) => {
        // Only clear indicators if we're leaving the entire element
        if (!nodeElement.contains(e.relatedTarget)) {
          this.clearDropIndicators();
        }
      });

      nodeElement.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const draggedNodeId = e.dataTransfer.getData('text/plain');
        this.handleSurveyDrop(draggedNodeId, node.id);
        this.clearDropIndicators();
      });
    }

    // Hamburger menu button
    if (node.type === 'survey') {
      const menuBtn = document.createElement('div');
      menuBtn.className = 'tree-node-menu-btn';
      menuBtn.textContent = '⋮';
      menuBtn.onclick = (e) => {
        e.stopPropagation();
        this.selectNode(node.id);
        this.showSurveyContextMenu(node);
      };
      nodeElement.appendChild(menuBtn);
    }

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

  /**
   * Shows a visual indicator for where a survey can be dropped
   * @param {HTMLElement} targetElement - The element being dragged over
   * @param {DragEvent} e - The drag event
   */
  showDropIndicator(targetElement, e) {
    this.clearDropIndicators();

    const rect = targetElement.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const height = rect.height;

    // Create drop indicator
    const indicator = document.createElement('div');
    indicator.className = 'drop-indicator';

    // Position indicator above or below the target based on mouse position
    if (y < height / 2) {
      indicator.classList.add('top');
      targetElement.style.position = 'relative';
      targetElement.insertBefore(indicator, targetElement.firstChild);
    } else {
      indicator.classList.add('bottom');
      targetElement.style.position = 'relative';
      targetElement.appendChild(indicator);
    }

    // Store reference to current drop target
    this.currentDropTarget = targetElement;
  }

  clearDropIndicators() {
    const indicators = document.querySelectorAll('.drop-indicator');
    indicators.forEach((indicator) => indicator.remove());
    this.currentDropTarget = null;
  }

  /**
   * Handles the drop operation for survey reordering
   * @param {string} draggedNodeId - ID of the dragged survey node
   * @param {string} targetNodeId - ID of the target survey node
   */
  handleSurveyDrop(draggedNodeId, targetNodeId) {
    if (draggedNodeId === targetNodeId) {
      return; // No change needed
    }

    // Resolve both nodes anywhere in the (possibly nested) tree.
    const draggedNode = this.findNodeById(draggedNodeId);
    const targetNode = this.findNodeById(targetNodeId);

    if (
      !draggedNode ||
      !targetNode ||
      draggedNode.type !== 'survey' ||
      targetNode.type !== 'survey' ||
      draggedNode.parent !== targetNode.parent
    ) {
      return; // Can only reorder surveys within the same (immediate) parent cave
    }

    // The survey's immediate parent cave node owns it (could be a nested sub-cave).
    const parentNode = draggedNode.parent;
    const ownerCave = parentNode.data;

    const draggedIndex = parentNode.children.findIndex((child) => child.id === draggedNodeId);
    const targetIndex = parentNode.children.findIndex((child) => child.id === targetNodeId);
    if (draggedIndex === -1 || targetIndex === -1) {
      return;
    }

    // Index within the owner cave's surveys array (children may interleave sub-caves and
    // surveys, so map the survey-node position to a surveys-array position).
    const surveyChildren = parentNode.children.filter((c) => c.type === 'survey');
    const fromSurveyIdx = surveyChildren.findIndex((c) => c.id === draggedNodeId);
    let toSurveyIdx = surveyChildren.findIndex((c) => c.id === targetNodeId);
    if (fromSurveyIdx < toSurveyIdx) toSurveyIdx -= 1; // adjust for removal of the dragged item

    const success = this.db.reorderSurvey(ownerCave, draggedNode.data, toSurveyIdx);
    if (!success) return;

    // Mirror the move in the tree node's children array (re-render reads node order). The model
    // (db.reorderSurvey) places the dragged survey immediately BEFORE the target in both
    // directions, so insert before the target here too — inserting after it on downward drags
    // made the UI show the dragged survey after the target while the saved order had it before.
    const [draggedChild] = parentNode.children.splice(draggedIndex, 1);
    const newChildIdx = parentNode.children.findIndex((child) => child.id === targetNodeId);
    parentNode.children.splice(newChildIdx, 0, draggedChild);

    document.dispatchEvent(
      new CustomEvent('surveyReordered', {
        detail : { cave: ownerCave, survey: draggedNode.data, newIndex: toSurveyIdx }
      })
    );
    this.render();
  }

  /**
   * Handles the drop operation for cave reordering
   * @param {string} draggedNodeId - ID of the dragged cave node
   * @param {string} targetNodeId - ID of the target cave node
   */
  handleCaveDrop(draggedNodeId, targetNodeId) {
    if (draggedNodeId === targetNodeId) {
      return; // No change needed
    }

    const draggedCaveNode = this.findNodeById(draggedNodeId);
    const targetCaveNode = this.findNodeById(targetNodeId);

    if (!draggedCaveNode || !targetCaveNode || draggedCaveNode.type !== 'cave' || targetCaveNode.type !== 'cave') {
      return; // Can only reorder caves onto caves
    }

    // Two cases: top-level caves (reordered in the `nodes` Map) and nested sub-caves
    // (reordered within their shared parent's children). Both must have the SAME parent.
    const draggedParent = draggedCaveNode.parent ?? null;
    const targetParent = targetCaveNode.parent ?? null;
    if (draggedParent !== targetParent) {
      return; // only reorder among siblings
    }

    if (draggedParent === null) {
      // Top-level caves: reorder the nodes Map (render order only; not persisted, as before).
      const arr = Array.from(this.nodes.values());
      const di = arr.findIndex((n) => n.id === draggedNodeId);
      const ti = arr.findIndex((n) => n.id === targetNodeId);
      if (di === -1 || ti === -1) return;
      const [moved] = arr.splice(di, 1);
      arr.splice(di < ti ? ti - 1 : ti, 0, moved);
      this.nodes.clear();
      arr.forEach((n) => this.nodes.set(n.id, n));
      this.render();
      return;
    }

    // Nested sub-caves: reorder within the parent's children (tree) AND the parent cave's
    // model children array, then persist via the root cave.
    const di = draggedParent.children.findIndex((n) => n.id === draggedNodeId);
    const ti = draggedParent.children.findIndex((n) => n.id === targetNodeId);
    if (di === -1 || ti === -1) return;
    const [movedNode] = draggedParent.children.splice(di, 1);
    draggedParent.children.splice(di < ti ? ti - 1 : ti, 0, movedNode);

    const parentCave = draggedParent.data;
    const mFrom = parentCave.children.indexOf(draggedCaveNode.data);
    const mTo = parentCave.children.indexOf(targetCaveNode.data);
    if (mFrom !== -1 && mTo !== -1) {
      const [movedCave] = parentCave.children.splice(mFrom, 1);
      parentCave.children.splice(mFrom < mTo ? mTo - 1 : mTo, 0, movedCave);
    }

    this.render();
    document.dispatchEvent(new CustomEvent('surveyReordered', { detail: { cave: parentCave } }));
  }

  /**
   * Moves a survey to the top of its cave's survey list
   * @param {string} surveyNodeId - ID of the survey node to move
   */
  moveSurveyToTop(surveyNodeId) {
    // Resolve the survey node anywhere in the (possibly nested) tree.
    const surveyNode = this.findNodeById(surveyNodeId);
    if (!surveyNode || surveyNode.type !== 'survey' || !surveyNode.parent) {
      return;
    }

    const parentNode = surveyNode.parent;
    const ownerCave = parentNode.data;

    // Already the first survey among its parent's survey children? Nothing to do.
    const surveyChildren = parentNode.children.filter((c) => c.type === 'survey');
    if (surveyChildren[0]?.id === surveyNodeId) {
      return;
    }

    const success = this.db.reorderSurvey(ownerCave, surveyNode.data, 0);
    if (!success) return;

    // Mirror in the tree node order: move the dragged survey before the first survey child.
    const currentIndex = parentNode.children.findIndex((c) => c.id === surveyNodeId);
    const [moved] = parentNode.children.splice(currentIndex, 1);
    const firstSurveyPos = parentNode.children.findIndex((c) => c.type === 'survey');
    parentNode.children.splice(firstSurveyPos === -1 ? parentNode.children.length : firstSurveyPos, 0, moved);

    this.render();
    document.dispatchEvent(
      new CustomEvent('surveyReordered', {
        detail : { cave: ownerCave, survey: surveyNode.data, newIndex: 0 }
      })
    );
  }
}
