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

import * as U from '../utils/utils.js';
import { SurveyHelper } from '../survey.js';
import { CaveEditor } from './editor/cave.js';
import { SurveyEditor } from './editor/survey.js';
import { showInfoPanel, showSuccessPanel } from './popups.js';
import { SectionHelper } from '../section.js';
import { showErrorPanel } from './popups.js';
import { i18n } from '../i18n/i18n.js';
import * as THREE from 'three';
class ProjectManager {

  /**
   * Creates a new project manager that is used on survey updates
   * @param {Database} db - The project database containing caves and surveys
   * @param {MyScene} scene - The 3D scene
   * @param {ProjectExplorer} explorer - The project explorer that displays caves and surveys in a tree view
   */
  constructor(db, options, scene, interaction, explorer, projectSystem, editorStateSystem, attributeDefs) {
    this.db = db;
    this.options = options;
    this.scene = scene;
    this.interaction = interaction;
    this.explorer = explorer;
    this.projectSystem = projectSystem;
    this.editorStateSystem = editorStateSystem;
    this.attributeDefs = attributeDefs;
    this.firstEdit = true;

    document.addEventListener('surveyChanged', (e) => this.onSurveyChanged(e));
    document.addEventListener('surveyDeleted', (e) => this.onSurveyDeleted(e));
    document.addEventListener('caveDeleted', (e) => this.onCaveDeleted(e));
    document.addEventListener('caveRenamed', (e) => this.onCaveRenamed(e));
    document.addEventListener('caveAdded', (e) => this.onCaveAdded(e));
    document.addEventListener('surveyRenamed', (e) => this.onSurveyRenamed(e));
    document.addEventListener('surveyAdded', (e) => this.onSurveyAdded(e));
    document.addEventListener('surveyReordered', (e) => this.onSurveyReordered(e));
    document.addEventListener('surveyDataEdited', (e) => this.onSurveyDataEdited(e));
    document.addEventListener('surveyDataUpdated', (e) => this.onSurveyDataUpdated(e));
    document.addEventListener('currentProjectChanged', (e) => this.onCurrentProjectChanged(e));
    document.addEventListener('currentProjectDeleted', (e) => this.onCurrentProjectDeleted(e));
    document.addEventListener('sectionAttributesChanged', (e) => this.onAttributesChanged(e));
    document.addEventListener('componentAttributesChanged', (e) => this.onAttributesChanged(e));
    document.addEventListener('stationAttributesChanged', (e) => this.onAttributesChanged(e));
    document.addEventListener('surveyCommentsChanged', (e) => this.onSurveyCommentsChanged(e));

  }

  async saveCave(cave) {
    await this.projectSystem.saveCaveInProject(this.projectSystem.getCurrentProject().id, cave);
  }

  async onCaveAdded(e) {
    const cave = e.detail.cave;
    this.addCave(cave);
    await this.saveCave(cave);
  }

  async onSurveyReordered(e) {
    const cave = e.detail.cave;
    await this.reloadCave(cave);
    await this.saveCave(cave);
  }

  async onSurveyAdded(e) {
    const cave = e.detail.cave;
    const newSurvey = e.detail.survey;
    this.addSurvey(cave.name, newSurvey);
    await this.saveCave(cave);
  }

  beforeUnloadHandler = (event) => {
    // Recommended
    event.preventDefault();
    // Included for legacy support, e.g. Chrome/Edge < 119
    event.returnValue = true;
  };

  async onSurveyCommentsChanged(e) {
    const cave = e.detail.cave;
    await this.saveCave(cave);
  }

  async onSurveyDataEdited(e) {
    if (this.firstEdit) {
      window.addEventListener('beforeunload', this.beforeUnloadHandler);
    }
    this.firstEdit = false;
    const data = e.detail.data;
    const surveyName = e.detail.survey.name;
    const caveName = e.detail.cave.name;
    const projectId = this.projectSystem.getCurrentProject().id;
    await this.editorStateSystem.saveState(projectId, data, {
      surveyName : surveyName,
      caveName   : caveName
    });
  }

  async onSurveyDataUpdated() {
    this.firstEdit = true;
    window.removeEventListener('beforeunload', this.beforeUnloadHandler);
    const projectId = this.projectSystem.getCurrentProject().id;
    await this.editorStateSystem.deleteState(projectId);
  }

  async onSurveyChanged(e) {
    //TODO : consider survey here and only recalculate following surveys
    // If eov coordinates are changed, the first survey is passed in the event
    const reasons = e.detail.reasons;
    const cave = e.detail.cave;

    // we do not need to reload the cave if only the metadata has changed
    if (reasons.length > 1 || (reasons.length === 1 && reasons[0] !== 'metadata')) {
      await this.reloadCave(cave);
    }
    await this.saveCave(cave);
  }

  async onAttributesChanged(e) {
    const cave = e.detail.cave;
    await this.saveCave(cave);
  }

  async onSurveyDeleted(e) {
    const caveName = e.detail.cave;
    const surveyName = e.detail.survey;
    this.scene.speleo.disposeSurvey(caveName, surveyName);
    this.scene.speleo.deleteSurvey(caveName, surveyName);
    const cave = this.db.getCave(caveName);
    this.recalculateCave(cave);
    this.reloadOnScene(cave);
    this.scene.view.renderView();
    this.explorer.removeSurvey(caveName, surveyName);
    await this.saveCave(cave);

  }

  async onCaveRenamed(e) {
    const oldName = e.detail.oldName;
    const cave = e.detail.cave;
    this.scene.renameCave(oldName, cave.name);
    this.explorer.renameCave(oldName, cave.name);
    //indexed db caves object store is indexed by id
    await this.saveCave(cave);
  }

  async onSurveyRenamed(e) {
    const oldName = e.detail.oldName;
    const survey = e.detail.survey;
    const newName = survey.name;
    const cave = e.detail.cave;
    this.scene.speleo.renameSurvey(oldName, newName, cave.name);
    this.explorer.renameSurvey(oldName, newName, cave.name);
    await this.saveCave(cave);
  }

  async onCaveDeleted(e) {
    const caveName = e.detail.name;
    const id = e.detail.id;
    await this.deleteCave(caveName, id);
  }

  async onCurrentProjectChanged(e) {
    const project = e.detail.project;

    this.db.getAllCaves().forEach((cave) => {
      this.disposeCave(cave.name, cave.id);
    });

    this.db.clear();

    const caves = await this.projectSystem.getCavesForProject(project.id);
    caves.forEach((cave) => {
      this.recalculateCave(cave);
      this.calculateFragmentAttributes(cave);
      this.addCave(cave);
    });
    this.scene.view.renderView();
    this.projectSystem.setCurrentProject(project);

    const editorState = await this.editorStateSystem.loadState(project.id);
    if (editorState !== undefined) {
      const cave = this.db.getCave(editorState.metadata.caveName);
      const survey = cave.surveys.find((s) => s.name === editorState.metadata.surveyName);
      this.editor = new SurveyEditor(
        this.options,
        cave,
        survey,
        this.scene,
        this.interaction,
        document.getElementById('resizable-editor'),
        editorState.state,
        this.attributeDefs
      );
      this.editor.setupPanel();
      this.editor.show();
      showInfoPanel(
        i18n.t('ui.editors.survey.messages.openedSurveyEditorUnsavedChanges', {
          caveName   : cave.name,
          surveyName : survey.name
        })
      );
    }
    console.log(`🚧 Loaded project: ${project.name}`);
  }

  async onCurrentProjectDeleted() {
    this.db.getAllCaves().forEach((cave) => {
      this.disposeCave(cave.name, cave.id);
    });

    this.db.clear();
    this.scene.view.renderView();
  }

  disposeCave(caveName) {
    this.scene.disposeCave(caveName);
    this.scene.speleo.deleteCave(caveName);
    this.scene.view.renderView();
    this.explorer.removeCave(caveName);
    this.explorer.closeEditorsForCave(caveName);
  }

  async deleteCave(caveName, id) {
    this.disposeCave(caveName);

    const currentProject = this.projectSystem.getCurrentProject();
    if (currentProject) {
      await this.projectSystem.removeCaveFromProject(currentProject.id, id);
    }
  }

  async reloadCave(cave) {
    this.recalculateCave(cave);
    this.reloadOnScene(cave);
    this.scene.view.renderView();
    this.explorer.updateCave(cave);
  }

  calculateFragmentAttributes(cave) {
    if (cave.attributes.sectionAttributes.length > 0 || cave.attributes.componentAttributes.length > 0) {

      const g = SectionHelper.getGraph(cave);

      if (cave.attributes.sectionAttributes.length > 0) {
        cave.attributes.sectionAttributes.forEach((sa) => {
          const from = sa.section.from;
          const to = sa.section.to;
          if (from === undefined || to === undefined) {
            return;
          }
          if (!cave.stations.has(from) || !cave.stations.has(to)) {
            return;
          }
          const cs = SectionHelper.getSection(g, from, to);
          if (cs !== undefined) {
            sa.section = cs;
          } else {
            //TODO: show error
          }

        });
      }
      if (cave.attributes.componentAttributes.length > 0) {
        cave.attributes.componentAttributes.forEach((ca) => {
          if (ca.component.start === undefined) {
            return;
          }
          if (!cave.stations.has(ca.component.start) || ca.component.termination.some((t) => !cave.stations.has(t))) {
            return;
          }
          const cs = SectionHelper.getComponent(g, ca.component.start, ca.component.termination);
          if (cs !== undefined) {
            ca.component = cs;
          } else {
            //TODO: show error
          }

        });
      }
    }
  }

  recalculateCave(cave) {
    let caveStations = new Map();
    cave.stations = caveStations;
    cave.surveys.entries().forEach(([index, es]) => {
      SurveyHelper.recalculateSurvey(index, es, cave.surveys, caveStations, cave.aliases, cave.geoData);
      this.#emitSurveyRecalculated(cave, es);
    });
    cave.stations = caveStations;
    this.#emitCaveRecalculated(cave);
    //TODO: should recalculate section attributes
  }

  reloadOnScene(cave) {
    const caveStations = cave.stations;

    if (caveStations.size < 3) {
      return;
    }

    cave.surveys.forEach((es) => {
      this.scene.speleo.disposeSurvey(cave.name, es.name);
      this.scene.speleo.deleteSurvey(cave.name, es.name);

      const [clSegments, splaySegments, auxiliarySegments] = SurveyHelper.getSegments(es, caveStations);
      if (clSegments.length !== 0) {
        const _3dObjects = this.scene.speleo.getSurveyObjects(
          es,
          cave,
          clSegments,
          splaySegments,
          auxiliarySegments,
          cave.visible && es.visible
        );
        this.scene.speleo.addSurvey(cave.name, es.name, _3dObjects);
        this.scene.speleo.colorModeHelper.setColorMode(this.options.scene.caveLines.color.mode);
      }
    });

    // Update starting point position after recalculation
    this.scene.startPoint.addOrUpdateStartingPoint(cave);

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

  #emitCaveRecalculated(cave) {
    const event = new CustomEvent('caveRecalculated', {
      detail : {
        cave : cave
      }
    });
    document.dispatchEvent(event);
  }
  addNewCave() {
    this.editor = new CaveEditor(
      this.db,
      this.options,
      undefined,
      this.scene,
      document.getElementById('fixed-size-editor')
    );

    this.editor.setupPanel();
    this.editor.show();
  }

  validateBeforeAdd(cave) {
    let cavesReallyFar = [];

    if (cave.getFirstStation()) {
      cavesReallyFar = this.getFarCaves(
        this.db.getCavesMap(),
        cave.getFirstStation().coordinates.eov,
        cave.getFirstStation()?.position
      );
    }

    if (this.db.hasCave(cave.name)) {
      return i18n.t('errors.import.caveAlreadyImported', { name: cave.name });
    } else if (cavesReallyFar.length > 0) {
      return i18n.t('errors.import.cavesReallyFar', { name: cave.name, caves: cavesReallyFar.join('<br>') });
    }

    return undefined;

  }

  addSurvey(caveName, survey) {
    const cave = this.db.getCave(caveName);
    cave.surveys.push(survey);
    this.explorer.addSurvey(cave, survey);
    if (survey.shots.length > 0) {
      this.reloadCave(cave);
    }
  }

  async tryAddSurveyToSurvey(surveyToAdd) {

    const { cave, survey } = this.explorer.partialImport;
    this.addSurveyToSurvey(surveyToAdd, cave, survey);
    this.explorer.partialImport = undefined;
  }

  async addSurveyToSurvey(surveyToAdd, cave, survey) {

    if (surveyToAdd.shots.length === 0) {
      showErrorPanel(i18n.t('errors.import.noShotsToAdd', { survey: surveyToAdd.name }));
      return;
    }

    const filteredShots = surveyToAdd.shots.filter((sh) => {
      return !survey.shots.some((s) => {
        return s.from === sh.from && s.to === sh.to;
      });
    });

    filteredShots.forEach((sh) => {
      sh.comment =
        sh.comment ??
        '' + (sh.comment ? ' ' : '') + `(TopoDroid ${i18n.t('common.survey').toLowerCase()}: ${surveyToAdd.name})`;
    });
    survey.shots.push(...filteredShots);
    survey.updateShots(survey.shots); // due to survey.validShots
    await this.onSurveyChanged({ detail: { cave: cave, survey: survey, reasons: ['shots'] } });
    const skipped = surveyToAdd.shots.length - filteredShots.length;
    if (skipped === surveyToAdd.shots.length) {
      showErrorPanel(i18n.t('errors.import.allShotsSkipped', { survey: surveyToAdd.name }));
      return;
    }
    showSuccessPanel(
      i18n.t('messages.import.surveyAddedSuccessfully', {
        survey   : surveyToAdd.name,
        toSurvey : survey.name,
        nrShots  : surveyToAdd.shots.length,
        skipped  : skipped
      })
    );
  }

  addCave(cave) {
    this.db.addCave(cave);

    const allShots = cave.surveys.flatMap((s) => s.shots);

    if (cave.surveys.length > 0 && allShots.length > 0) {

      cave.surveys.forEach((s) => {
        const [centerLineSegments, splaySegments, auxiliarySegments] = SurveyHelper.getSegments(s, cave.stations);
        const _3dobjects = this.scene.speleo.getSurveyObjects(
          s,
          cave,
          centerLineSegments,
          splaySegments,
          auxiliarySegments,
          true
        );
        this.scene.speleo.addSurvey(cave.name, s.name, _3dobjects);
      });

      this.scene.speleo.colorModeHelper.setColorMode(this.options.scene.caveLines.color.mode);

      cave.attributes.sectionAttributes.forEach((sa) => {
        if (
          sa.visible &&
          sa.section.path !== undefined &&
          sa.section.path.length > 0 &&
          sa.attribute?.isValid() === true
        ) {
          const segments = SectionHelper.getSectionSegments(sa.section, cave.stations);
          this.scene.attributes.showFragmentAttribute(sa.id, segments, sa.attribute, sa.format, sa.color, cave.name);
        } else if (sa.visible) {
          sa.visible = false;
        }
      });
      cave.attributes.componentAttributes.forEach((ca) => {
        if (
          ca.visible &&
          ca.component.path !== undefined &&
          ca.component.path.length > 0 &&
          ca.attribute?.isValid() === true
        ) {
          const segments = SectionHelper.getComponentSegments(ca.component, cave.stations);
          this.scene.attributes.showFragmentAttribute(ca.id, segments, ca.attribute, ca.format, ca.color, cave.name);
        } else if (ca.visible) {
          ca.visible = false;
        }
      });
      cave.attributes.stationAttributes.forEach((sa) => {
        if (sa.visible && cave.stations.has(sa.name) && sa.attribute?.isValid() === true) {
          this.scene.attributes.showStationAttribute(sa.id, cave.stations.get(sa.name), sa.attribute);
        } else if (sa.visible) {
          sa.visible = false;
        }
      });

      const boundingBox = this.scene.computeBoundingBox();
      const [w, h, d] = boundingBox.getSize(new THREE.Vector3());

      // if the center lines or splays are not visible
      if (w > 0 && h > 0 && d > 0) {
        this.scene.grid.adjust(boundingBox);

        this.scene.views.forEach((view) => {
          view.initiated = false;
        });

        this.scene.view.activate(boundingBox);

        // Add starting point for the cave
        // it is displayed based on world units in pixels that's why it is here
        this.scene.startPoint.addOrUpdateStartingPoint(cave);
      }
    }

    this.explorer.addCave(cave);
    cave.surveys.forEach((s) => {
      this.explorer.addSurvey(cave, s);
    });

  }

  /**
   * Get a list of caves that are farther than a specified distance from a given position.
   *
   * @param {Map<string, Cave>} caves - A map of cave objects, where each key is a cave identifier and each value is a cave object.
   * @param {Vector} position - The position to measure the distance from.
   * @returns {Array<string>} An array of strings, each representing a cave name and its distance from the position, formatted as "caveName - distance m".
   */
  getFarCaves(caves, eovCoordinate, position) {
    return Array.from(caves.values()).reduce((acc, c) => {
      const firstStation = c.getFirstStation();
      const firstStationEov = firstStation?.coordinates.eov;
      const maxDistance = this.options.import.cavesMaxDistance;

      if (eovCoordinate === undefined && firstStationEov !== undefined) {
        acc.push(`${c.name} - ${i18n.t('errors.import.unknownDistance')}`);
      } else if (
        firstStationEov === undefined &&
        eovCoordinate === undefined &&
        position !== undefined &&
        firstStation !== undefined &&
        firstStation.position.distanceTo(position) > maxDistance
      ) {
        acc.push(`${c.name} - ${U.formatDistance(firstStation.position.distanceTo(position), 0)}`);
      } else if (eovCoordinate !== undefined && firstStationEov === undefined) {
        acc.push(`${c.name} - ${i18n.t('errors.import.unknownDistance')}`);
      } else if (eovCoordinate !== undefined && firstStationEov !== undefined) {
        // eov for both caves
        const distanceBetweenCaves = firstStationEov.distanceTo(eovCoordinate);
        if (distanceBetweenCaves > this.options.import.cavesMaxDistance) {
          acc.push(`${c.name} - ${U.formatDistance(distanceBetweenCaves, 0)}`);
        }
      }

      return acc;
    }, []);
  }

}

export { ProjectManager };
