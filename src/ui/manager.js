import * as U from '../utils/utils.js';
import { SurveyHelper } from '../survey.js';
import { CaveEditor } from './editor/cave.js';
import { SurveyEditor } from './editor/survey.js';
import { showInfoPanel } from './popups.js';
import { SectionHelper } from '../section.js';

class ProjectManager {

  /**
   * Creates a new project manager that is used on survey updates
   * @param {Database} db - The project database containing caves and surveys
   * @param {MyScene} scene - The 3D scene
   * @param {ProjectExplorer} explorer - The project explorer that displays caves and surveys in a tree view
   */
  constructor(db, options, scene, interaction, explorer, projectSystem, editorStateSystem) {
    this.db = db;
    this.options = options;
    this.scene = scene;
    this.interaction = interaction;
    this.explorer = explorer;
    this.projectSystem = projectSystem;
    this.editorStateSystem = editorStateSystem;
    this.firstEdit = true;
    document.addEventListener('surveyChanged', (e) => this.onSurveyChanged(e));
    document.addEventListener('surveyDeleted', (e) => this.onSurveyDeleted(e));
    document.addEventListener('caveDeleted', (e) => this.onCaveDeleted(e));
    document.addEventListener('caveRenamed', (e) => this.onCaveRenamed(e));
    document.addEventListener('caveAdded', (e) => this.onCaveAdded(e));
    document.addEventListener('surveyRenamed', (e) => this.onSurveyRenamed(e));
    document.addEventListener('surveyAdded', (e) => this.onSurveyAdded(e));
    document.addEventListener('surveyDataEdited', (e) => this.onSurveyDataEdited(e));
    document.addEventListener('surveyDataUpdated', (e) => this.onSurveyDataUpdated(e));
    document.addEventListener('currentProjectChanged', (e) => this.onCurrentProjectChanged(e));
    document.addEventListener('currentProjectDeleted', (e) => this.onCurrentProjectDeleted(e));
    document.addEventListener('sectionAttributesChanged', (e) => this.onAttributesChanged(e));
    document.addEventListener('componentAttributesChanged', (e) => this.onAttributesChanged(e));
    document.addEventListener('stationAttributesChanged', (e) => this.onAttributesChanged(e));

  }

  async saveCave(cave) {
    await this.projectSystem.saveCaveInProject(this.projectSystem.getCurrentProject().id, cave);
  }

  async onCaveAdded(e) {
    const cave = e.detail.cave;
    this.addCave(cave);
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
    const cave = e.detail.cave;
    await this.reloadCave(cave);
    await this.saveCave(cave);
  }

  async onAttributesChanged(e) {
    const cave = e.detail.cave;
    await this.saveCave(cave);
  }

  async onSurveyDeleted(e) {
    const caveName = e.detail.cave;
    const surveyName = e.detail.survey;
    this.scene.disposeSurvey(caveName, surveyName);
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

    this.scene.renameSurvey(oldName, newName, cave.name);
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
        editorState.state
      );
      this.editor.setupPanel();
      this.editor.show();
      showInfoPanel(`Opened survey editor because you have unsaved changes for cave ${cave.name} / ${survey.name}`);
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
    this.scene.deleteCave(caveName);
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
          if (sa.section.from === undefined || sa.section.to === undefined) {
            return;
          }
          const cs = SectionHelper.getSection(g, sa.section.from, sa.section.to);
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
    const lOptions = this.options.scene.caveLines;

    // get color gradients after recalculation
    const colorGradients = SurveyHelper.getColorGradients(cave, lOptions);

    cave.surveys.forEach((es) => {
      this.scene.disposeSurvey(cave.name, es.name);
      this.scene.deleteSurvey(cave.name, es.name);

      const [clSegments, splaySegments, auxiliarySegments] = SurveyHelper.getSegments(es, caveStations);
      if (clSegments.length !== 0) {
        const _3dObjects = this.scene.addToScene(
          es,
          cave,
          clSegments,
          splaySegments,
          auxiliarySegments,
          cave.visible && es.visible,
          colorGradients.get(es.name)
        );
        this.scene.addSurvey(cave.name, es.name, _3dObjects);
      }
    });

    // Update starting point position after recalculation
    this.scene.addStartingPoint(cave);

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
    const cavesReallyFar = this.getFarCaves(this.db.caves, cave.getFirstStation().coordinates.eov);

    if (this.db.caves.has(cave.name)) {
      return `Cave '${cave.name}' has already been added!`;
    } else if (cavesReallyFar.length > 0) {
      return `'${cave.name}' is too far from previously imported caves: ${cavesReallyFar.join(',')}`;
    }

    return undefined;

  }

  addSurvey(caveName, survey) {
    const cave = this.db.getCave(caveName);
    cave.surveys.push(survey);
    this.explorer.addSurvey(cave, survey);
    this.reloadCave(cave);
  }

  addCave(cave) {
    this.db.caves.set(cave.name, cave);

    const lOptions = this.options.scene.caveLines;
    let colorGradients = SurveyHelper.getColorGradients(cave, lOptions);

    cave.surveys.forEach((s) => {
      const [centerLineSegments, splaySegments, auxiliarySegments] = SurveyHelper.getSegments(s, cave.stations);
      const _3dobjects = this.scene.addToScene(
        s,
        cave,
        centerLineSegments,
        splaySegments,
        auxiliarySegments,
        true,
        colorGradients.get(s.name)
      );
      this.scene.addSurvey(cave.name, s.name, _3dobjects);
    });

    // Add starting point for the cave
    this.scene.addStartingPoint(cave);

    cave.attributes.sectionAttributes.forEach((sa) => {
      if (sa.visible) {
        const segments = SectionHelper.getSectionSegments(sa.section, cave.stations);
        this.scene.showSectionAttribute(sa.id, segments, sa.attribute, sa.format, sa.color, cave.name);
      }
    });
    cave.attributes.componentAttributes.forEach((ca) => {
      if (ca.visible) {
        const segments = SectionHelper.getComponentSegments(ca.component, cave.stations);
        this.scene.showSectionAttribute(ca.id, segments, ca.attribute, ca.format, ca.color, cave.name);
      }
    });

    this.explorer.addCave(cave);
    cave.surveys.forEach((s) => {
      this.explorer.addSurvey(cave, s);
    });

    const boundingBox = this.scene.computeBoundingBox();
    this.scene.grid.adjust(boundingBox);
    this.scene.view.fitScreen(boundingBox);
    this.scene.view.renderView();
  }

  /**
   * Get a list of caves that are farther than a specified distance from a given position.
   *
   * @param {Map<string, Cave>} caves - A map of cave objects, where each key is a cave identifier and each value is a cave object.
   * @param {Vector} position - The position to measure the distance from.
   * @returns {Array<string>} An array of strings, each representing a cave name and its distance from the position, formatted as "caveName - distance m".
   */
  getFarCaves(caves, eovCoordinate) {
    return Array.from(caves.values()).reduce((acc, c) => {
      const firstStation = c.getFirstStation();
      const distanceBetweenCaves = firstStation?.coordinates.eov?.distanceTo(eovCoordinate);
      if (distanceBetweenCaves !== undefined && distanceBetweenCaves > this.options.import.cavesMaxDistance) {
        acc.push(`${c.name} - ${U.formatDistance(distanceBetweenCaves, 0)}`);
      }

      if (eovCoordinate !== undefined && distanceBetweenCaves === undefined) {
        acc.push(`${c.name} - Unknown distance, no EOV coordinates`);
      }
      return acc;
    }, []);
  }

}

export { ProjectManager };
