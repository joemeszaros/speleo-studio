import { classNames } from '../../dependencies/classnames.js';
import { tag } from '../../dependencies/html5-tag.js';
import { escapeHtml } from '../../dependencies/escape-html.js';
import * as U from '../utils/utils.js';
import { SurveyHelper } from '../survey.js';
import { Color } from '../model.js';
import { Survey } from '../model/survey.js';
import { SectionAttributeEditor, ComponentAttributeEditor } from './editor/attributes.js';
import { CaveEditor, NewCaveEditor } from './editor/cave.js';
import { SurveyEditor, SurveySheetEditor } from './editor/survey.js';
import { CyclePanel } from '../cycle.js';
import { showErrorPanel, showWarningPanel } from './popups.js';
import { SectionHelper } from '../section.js';

class ProjectManager {

  /**
   * Creates a new project manager that is used on survey updates
   * @param {Database} db - The project database containing caves and surveys
   * @param {MyScene} scene - The 3D scene
   * @param {ProjectExplorer} explorer - The project explorer that displays caves and surveys in a tree view
   */
  constructor(db, options, scene, explorer) {
    this.db = db;
    this.options = options;
    this.scene = scene;
    this.explorer = explorer;
    document.addEventListener('surveyChanged', (e) => this.onSurveyChanged(e));
    document.addEventListener('attributesChanged', (e) => this.onAttributesChanged(e));
    document.addEventListener('surveyDeleted', (e) => this.onSurveyDeleted(e));
    document.addEventListener('caveDeleted', (e) => this.onCaveDeleted(e));
    document.addEventListener('caveRenamed', (e) => this.onCaveRenamed(e));
    document.addEventListener('surveyRenamed', (e) => this.onSurveyRenamed(e));
  }

  onSurveyChanged(e) {
    //TODO : consider survey here and only recalculate following surveys
    const cave = e.detail.cave;
    this.recalculateCave(cave);
    this.scene.view.renderView();
    this.explorer.updateCave(cave, (n) => n.name === cave.name);
  }

  onAttributesChanged(e) {
    const cave = e.detail.cave;
    this.scene.view.renderView();
    this.explorer.updateCave(cave, (n) => n.name === cave.name);
  }

  onSurveyDeleted(e) {
    const caveName = e.detail.cave;
    const surveyName = e.detail.survey;
    this.scene.disposeSurvey(caveName, surveyName);
    const cave = this.db.getCave(caveName);
    this.recalculateCave(cave);
    this.scene.view.renderView();
    this.explorer.deleteSurvey(caveName, surveyName);
    this.explorer.updateCave(cave, (n) => n.name === cave.name);
  }

  onCaveRenamed(e) {
    const oldName = e.detail.oldName;
    const cave = e.detail.cave;
    this.scene.renameCave(oldName, cave.name);
    this.explorer.updateCave(cave, (n) => n.name === oldName);
  }

  onSurveyRenamed(e) {
    const oldName = e.detail.oldName;
    const survey = e.detail.survey;
    const newName = survey.name;
    const cave = e.detail.cave;

    this.scene.renameSurvey(oldName, newName, cave.name);
    this.explorer.updateSurvey(cave, survey, (s) => s.name === oldName);
  }

  onCaveDeleted(e) {
    const caveName = e.detail.cave;
    this.scene.disposeCave(caveName);
    this.scene.deleteCave(caveName);
    this.scene.view.renderView();
    this.explorer.deleteCave(caveName);
    this.explorer.closeEditors(caveName);
  }

  recalculateCave(cave) {
    let caveStations = new Map();
    const lOptions = this.options.scene.caveLines;
    cave.stations = caveStations;
    cave.surveys.entries().forEach(([index, es]) => {
      SurveyHelper.recalculateSurvey(index, es, caveStations, cave.aliases, cave.geoData);
      this.#emitSurveyRecalculated(cave, es);
    });
    cave.stations = caveStations;
    //TODO: should recalculate section attributes

    // get color gradients after recalculation
    const colorGradients = SurveyHelper.getColorGradients(cave, lOptions);

    cave.surveys.forEach((es) => {
      this.scene.disposeSurvey(cave.name, es.name);
      this.scene.deleteSurvey(cave.name, es.name);

      const [clSegments, splaySegments] = SurveyHelper.getSegments(es, caveStations);
      if (clSegments.length !== 0) {
        const _3dObjects = this.scene.addToScene(
          es,
          cave,
          clSegments,
          splaySegments,
          cave.visible && es.visible,
          colorGradients.get(es.name)
        );
        this.scene.addSurvey(cave.name, es.name, _3dObjects);
      }
    });
    this.scene.updateVisiblePlanes();
    const boundingBox = this.scene.computeBoundingBox();
    this.scene.grid.adjust(boundingBox);
    this.scene.view.fitScreen(boundingBox);
  }

  #emitSurveyRecalculated(cave, survey) {
    const event = new CustomEvent('surveyRecalculated', {
      detail : {
        cave   : cave,
        survey : survey
      }
    });
    document.dispatchEvent(event);
  }

  addNewCave() {
    const panel = document.getElementById('caveeditor');
    this.editor = new NewCaveEditor({
      panel,
      onCreate : (cave) => {
        this.addCave(cave);
        this.editor = null;
      },
      onCancel : () => {
        this.editor = null;
      }
    });
    this.editor.show();
  }

  addCave(cave) {
    const cavesReallyFar = []; //this.constructor.getFarCaves(this.db.caves, cave.startPosition);
    if (this.db.caves.has(cave.name)) {
      showErrorPanel(`Import of '${cave.name}' failed, cave has already been imported!`, 20);
    } else if (cavesReallyFar.length > 0) {
      const message = `Import of '${cave.name}' failed, the cave is too far from previously imported caves: ${cavesReallyFar.join(',')}`;
      showWarningPanel(message, 20);
    } else {
      this.db.caves.set(cave.name, cave);

      const lOptions = this.options.scene.caveLines;
      let colorGradients = SurveyHelper.getColorGradients(cave, lOptions);

      cave.surveys.forEach((s) => {
        const [centerLineSegments, splaySegments] = SurveyHelper.getSegments(s, cave.stations);
        const _3dobjects = this.scene.addToScene(
          s,
          cave,
          centerLineSegments,
          splaySegments,
          true,
          colorGradients.get(s.name)
        );
        this.scene.addSurvey(cave.name, s.name, _3dobjects);
      });

      cave.sectionAttributes.forEach((sa) => {
        if (sa.visible) {
          const segments = SectionHelper.getSectionSegments(sa.section, cave.stations);
          this.scene.showSectionAttribute(sa.id, segments, sa.attribute, sa.format, sa.color, cave.name);
        }
      });
      cave.componentAttributes.forEach((ca) => {
        if (ca.visible) {
          const segments = SectionHelper.getComponentSegments(ca.component, cave.stations);
          this.scene.showSectionAttribute(ca.id, segments, ca.attribute, ca.format, ca.color, cave.name);
        }
      });

      this.explorer.addCave(cave);
      const boundingBox = this.scene.computeBoundingBox();
      this.scene.grid.adjust(boundingBox);
      this.scene.view.fitScreen(boundingBox);
    }
  }

}

class ProjectExplorer {

  constructor(options, db, scene, attributeDefs, node) {
    this.options = options;
    this.db = db;
    this.scene = scene;
    this.attributeDefs = attributeDefs;
    this.trees = new Map();
    this.panel = node;
    this.itree = undefined;
    this.contextMenuElement = U.node`<div class="context-menu-tree" id="tree-contextmenu"></div>`;
    document.body.insertBefore(this.contextMenuElement, document.body.firstChild);
    window.addEventListener('click', () => {
      this.contextMenuElement.style.display = 'none';
    });
  }

  deleteSurvey(caveName, surveyName) {
    const caveNode = this.itree.getChildNodes().find((n) => n.name === caveName);
    const surveyNode = this.itree.getChildNodes(caveNode).find((n) => n.name === surveyName);
    this.itree.removeNode(surveyNode);
  }

  addSurvey(cave, survey) {
    const caveNode = this.itree.getChildNodes().find((n) => n.name === cave.name);
    this.itree.appendChildNode(
      {
        id           : U.randomAlphaNumbericString(8),
        name         : survey.name,
        loadOnDemand : true,
        state        : { checked: survey.visible, nodeType: 'survey', cave: cave, survey: survey }
      },
      caveNode
    );
  }

  deleteCave(caveName) {
    const caveNode = this.itree.getChildNodes().find((n) => n.name === caveName);
    this.itree.removeNode(caveNode);
    if (this.itree.getChildNodes().length === 0) {
      document.querySelector('#infinite-tree-filter').style.display = 'none';
    }
  }

  closeEditors(caveName) {
    if (this.editor !== undefined && !this.closed && this.editor.cave.name === caveName) {
      this.editor.closeEditor();
    }
  }

  updateCave(cave, predicate) {
    const caveNode = this.itree.getChildNodes().find(predicate);
    const data = this.transformCave(cave);
    this.itree.updateNode(caveNode, data);
  }

  updateSurvey(cave, survey, predicate) {
    const caveNode = this.itree.getChildNodes().find((n) => n.name === cave.name);
    const surveyNode = this.itree.getChildNodes(caveNode).find(predicate);
    const data = this.transformSurvey(cave, survey);
    this.itree.updateNode(surveyNode, data);
  }

  showCaveContextMenu(cave) {
    const menu = U.node`<ul class="menu-options">`;
    const editCaveData = U.node`<li class="menu-option">Edit cave sheet</li>`;
    editCaveData.onclick = () => {
      this.editor = new CaveEditor(
        this.db,
        this.options,
        cave,
        this.scene,
        this.attributeDefs,
        document.getElementById('caveeditor')
      );
      this.editor.setupPanel();
      this.editor.show();
      this.contextMenuElement.style.display = 'none';
    };

    const editSectionAttributes = U.node`<li class="menu-option">Edit section attributes</li>`;
    editSectionAttributes.onclick = () => {
      this.editor = new SectionAttributeEditor(
        this.db,
        this.options,
        cave,
        this.scene,
        this.attributeDefs,
        document.getElementById('caveeditor')
      );
      this.editor.setupPanel();
      this.editor.show();
      this.contextMenuElement.style.display = 'none';

    };

    const editComponentAttributes = U.node`<li class="menu-option">Edit component attributes</li>`;
    editComponentAttributes.onclick = () => {
      this.editor = new ComponentAttributeEditor(
        this.db,
        this.options,
        cave,
        this.scene,
        this.attributeDefs,
        document.getElementById('caveeditor')
      );
      this.editor.setupPanel();
      this.editor.show();
      this.contextMenuElement.style.display = 'none';

    };

    const addSurvey = U.node`<li class="menu-option">Add survey</li>`;
    addSurvey.onclick = () => {
      this.contextMenuElement.style.display = 'none';
      const name = prompt('Please enter the survey name');
      if (name.length === 0) {
        showWarningPanel('Survey name should not be empty!');
      } else if (cave.surveys.find((s) => s.name === name) !== undefined) {
        showWarningPanel(`Survey with name '${name}' already exists!`);
      } else {
        const newSurvey = new Survey(name, true, undefined, '0', []);
        cave.surveys.push(newSurvey);
        this.addSurvey(cave, newSurvey);
        this.editor = new SurveyEditor(
          cave,
          newSurvey,
          this.scene,
          this.attributeDefs,
          document.getElementById('surveyeditor')
        );
        this.editor.setupTable();
        this.editor.show();
      }
    };

    const cycles = U.node`<li class="menu-option">Cycles</li>`;
    cycles.onclick = () => {
      this.editor = new CyclePanel(document.querySelector('#cycle-panel'), this.scene, cave);
      this.editor.setupPanel();
      this.editor.show();

    };

    menu.appendChild(editCaveData);
    menu.appendChild(editSectionAttributes);
    menu.appendChild(editComponentAttributes);
    menu.appendChild(addSurvey);
    menu.appendChild(cycles);
    this.contextMenuElement.innerHTML = '';
    this.contextMenuElement.appendChild(menu);
  }

  showSurveyContextMenu(cave, survey) {
    const menu = U.node`<ul class="menu-options">`;
    const editSurveySheet = U.node`<li class="menu-option">Edit survey sheet</li>`;
    editSurveySheet.onclick = () => {
      this.editor = new SurveySheetEditor(this.db, cave, survey, document.getElementById('surveyeditor'));
      this.editor.setupPanel();
      this.editor.show();
      this.contextMenuElement.style.display = 'none';
    };
    menu.appendChild(editSurveySheet);
    this.contextMenuElement.innerHTML = '';
    this.contextMenuElement.appendChild(menu);

  }

  contextMewnu = (tree) => (e) => {
    e.preventDefault();
    const currentNode = tree.getNodeFromPoint(e.clientX, e.clientY);
    if (!currentNode) {
      return;
    }
    const state = currentNode.state;
    if (state.nodeType === 'cave') {
      this.showCaveContextMenu(state.cave);
      this.contextMenuElement.style.left = `${e.pageX}px`;
      this.contextMenuElement.style.top = `${e.pageY}px`;
      this.contextMenuElement.style.display = 'block';
    } else if (state.nodeType === 'survey') {
      this.showSurveyContextMenu(state.cave, state.survey);
      this.contextMenuElement.style.left = `${e.pageX}px`;
      this.contextMenuElement.style.top = `${e.pageY}px`;
      this.contextMenuElement.style.display = 'block';
    }

  };

  initializeTree(data) {
    const filterNode = U.node`
    <div class="infinite-tree-filter" id="infinite-tree-filter">
      <label for="tree-filter">Filter: <input id="tree-filter" type="text" placeholder="Type to filter"/></label>
      <span id="add-cave" class="add-cave"></span>
    </div>`;
    const treeNode = U.node`<div id="tree-node"></div>`;
    this.panel.appendChild(filterNode);
    this.panel.appendChild(treeNode);
    // eslint-disable-next-line no-undef
    this.itree = new InfiniteTree({
      el          : treeNode,
      data        : data,
      autoOpen    : true,
      rowRenderer : this.treeRenderer,
      scene       : this.scene,
      options     : this.options
    });

    filterNode.querySelector('#tree-filter').onkeyup = (e) => {
      const filterOptions = {
        includeAncestors   : true,
        includeDescendants : false,
        caseSensitive      : false
      };
      const keyword = e.target.value;
      this.itree.filter(keyword, filterOptions);
    };

    this.itree.on('click', this.click(this.itree));
    treeNode.addEventListener('contextmenu', this.contextMewnu(this.itree));
  }

  transformSurvey(cave, survey) {
    return {
      id           : U.randomAlphaNumbericString(8),
      name         : survey.name,
      loadOnDemand : true,
      state        : { checked: survey.visible, nodeType: 'survey', cave: cave, survey: survey }
    };
  }

  transformCave(cave) {
    const mapCave = (cave) => {
      return {
        id           : U.randomAlphaNumbericString(8),
        name         : cave.name,
        children     : cave.surveys.map((s) => this.transformSurvey(cave, s)),
        loadOnDemand : true,
        state        : { checked: cave.visible, nodeType: 'cave', cave: cave }
      };
    };
    return mapCave(cave);
  }

  addCave(cave) {
    const data = this.transformCave(cave);

    if (this.itree === undefined) {
      this.initializeTree(data);
    } else {
      if (this.itree.getChildNodes().length === 0) {
        document.querySelector('#infinite-tree-filter').style.display = 'block';
      }
      this.itree.appendChildNode(data);

    }
  }

  click = (tree) => (event) => {
    const currentNode = tree.getNodeFromPoint(event.clientX, event.clientY);
    if (!currentNode) {
      return;
    }
    const state = currentNode.state;
    if (event.target.className === 'checkbox') {
      event.stopPropagation();
      const value = !state.checked;

      if (state.nodeType === 'survey') {
        state.survey.visible = value;
        this.scene.setSurveyVisibility(state.cave.name, state.survey.name, value);
      } else if (state.nodeType === 'cave') {
        const cave = state.cave;
        cave.visible = value;
        cave.surveys.forEach((survey) => {
          survey.visible = value;
          this.scene.setSurveyVisibility(cave.name, survey.name, value);
        });
      }

      tree.checkNode(currentNode);
      return;
    } else if (event.target.id === 'edit') {

      if (this.editor !== undefined && !this.editor.closed) {
        this.editor.closeEditor();
      }

      if (state.nodeType === 'survey') {
        this.editor = new SurveyEditor(
          state.cave,
          state.survey,
          this.scene,
          this.attributeDefs,
          document.getElementById('surveyeditor')
        );
        this.editor.setupTable();
        this.editor.show();
      } else if (state.nodeType === 'cave') {

        this.editor = new CaveEditor(
          this.db,
          this.options,
          state.cave,
          this.scene,
          this.attributeDefs,
          document.getElementById('caveeditor')
        );
        this.editor.setupPanel();
        this.editor.show();
      }

    } else if (event.target.id === 'delete') {
      if (state.nodeType === 'survey') {
        const result = confirm(`Do you want to delete survey '${state.survey.name}'?`);
        if (result) {
          this.db.deleteSurvey(state.cave.name, state.survey.name);
        }
      } else if (state.nodeType === 'cave') {
        const result = confirm(`Do you want to delete cave '${state.cave.name}'?`);
        if (result) {
          this.db.deleteCave(state.cave.name);
        }
      }
    } else if (event.target.id.startsWith('color-picker')) {
      const updateColor = (surveyOrCave) => (event2) => {
        surveyOrCave.color = new Color(event2.target.value);
        this.updateCave(state.cave, (n) => n.name === state.cave.name);
      };
      if (event.target.oninput === null) {
        if (state.nodeType === 'survey') {
          event.target.oninput = updateColor(state.survey);
        } else if (state.nodeType === 'cave') {
          event.target.oninput = updateColor(state.cave);
        }
      }
      event.target.showPicker();
      event.stopPropagation();
    }
  };

  treeRenderer(node, treeOptions) {
    const { id, name, loadOnDemand = false, children, state, props = {} } = node;
    const droppable = treeOptions.droppable && props.droppable;
    const { depth, open, path, total, selected = false, filtered, checked } = state;
    const childrenLength = Object.keys(children).length;
    const more = node.hasChildren();

    const isolatedSurvey = state.nodeType === 'survey' && state.survey.isolated === true;
    const orphanSurvey = state.nodeType === 'survey' && state.survey.orphanShotIds.size > 0;
    const invalidShots = state.nodeType === 'survey' && state.survey.invalidShotIds.size > 0;

    let color;

    if (state.nodeType === 'survey' && state.survey.color !== undefined) {
      color = state.survey.color.hexString();
    } else if (state.nodeType === 'cave' && state.cave.color !== undefined) {
      color = state.cave.color.hexString();
    }

    if (filtered === false) {
      return;
    }

    let togglerContent = '';
    if (!more && loadOnDemand) {
      togglerContent = tag(
        'i',
        {
          class : classNames('infinite-tree-right-arrow')
        },
        ''
      );
    }
    if (more && open) {
      togglerContent = tag(
        'i',
        {
          class : classNames('infinite-tree-down-arrow')
        },
        ''
      );
    }
    if (more && !open) {
      togglerContent = tag(
        'i',
        {
          class : classNames('infinite-tree-right-arrow')
        },
        ''
      );
    }
    if (state.expanding && !state.loading) {
      togglerContent = tag(
        'i',
        {
          class : classNames('glyphicon', 'glyphicon-refresh', 'rotating')
        },
        ''
      );
    }
    if (state.collapsing) {
      // TODO
    }
    const toggler = tag(
      'a',
      {
        class : (() => {
          if (!more && loadOnDemand) {
            return classNames(treeOptions.togglerClass, 'infinite-tree-closed');
          }
          if (more && open) {
            return classNames(treeOptions.togglerClass);
          }
          if (more && !open) {
            return classNames(treeOptions.togglerClass, 'infinite-tree-closed');
          }
          return '';
        })()
      },
      togglerContent
    );

    const icon = tag(
      'i',
      {
        class : classNames(
          { 'infinite-tree-isolated': isolatedSurvey },
          { 'infinite-tree-warning': invalidShots && !isolatedSurvey },
          { 'infinite-tree-warning': orphanSurvey && !invalidShots && !isolatedSurvey }
        )
      },
      ''
    );

    const title = tag(
      'span',
      {
        class : classNames('infinite-tree-title')
      },
      U.fitString(escapeHtml(name), 21)
    );

    const checkbox = tag('input', {
      type           : 'checkbox',
      checked        : checked,
      class          : classNames('checkbox'),
      'data-checked' : checked,
      id             : `checkbox-${id}`
    });

    const label = `<label for="checkbox-${id}"></label>`;

    const deleteIcon = tag(
      'span',
      {
        id    : 'delete',
        class : classNames('infinite-tree-delete')
      },
      ''
    );

    const colorIcon = tag(
      'input',
      {
        type  : 'color',
        id    : `color-picker-${id}`,
        value : color,
        class : classNames('infinite-tree-color')
      },
      ''
    );
    const colorLabel = tag('label', {
      for   : `color-picker-${id}`,
      class : classNames({ 'no-color': color === undefined }),
      style : color !== undefined ? `background: ${color};` : ''
    });

    const editIcon = tag(
      'span',
      {
        id    : 'edit',
        class : classNames('infinite-tree-edit')
      },
      ''
    );

    const treeNode = tag(
      'div',
      {
        class : 'infinite-tree-node',
        style : 'margin-left: ' + depth * 10 + 'px'
      },
      toggler + icon + title + checkbox + label + deleteIcon + editIcon + colorIcon + colorLabel
    );

    let treeNodeAttributes = {
      draggable       : 'false',
      'data-id'       : id,
      'data-expanded' : more && open,
      'data-depth'    : depth,
      'data-path'     : path,
      'data-selected' : selected,
      'data-children' : childrenLength,
      'data-total'    : total,
      class           : classNames('infinite-tree-item', { 'infinite-tree-selected': selected })
    };
    if (droppable) {
      treeNodeAttributes['droppable'] = true;
    }

    return tag('div', treeNodeAttributes, treeNode);
  }

}

export { ProjectManager, ProjectExplorer };
