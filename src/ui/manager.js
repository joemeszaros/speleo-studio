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
import { RevisionInfo } from '../model/misc.js';
import { PointCloud, Mesh3D } from '../model.js';
import { PointCloudHelper } from '../utils/models.js';
import { globalNormalizer } from '../utils/global-coordinate-normalizer.js';

class ProjectManager {

  /**
   * Creates a new project manager that is used on survey updates
   * @param {Database} db - The project database containing caves and surveys
   * @param {MyScene} scene - The 3D scene
   * @param {ProjectExplorer} explorer - The project explorer that displays caves and surveys in a tree view
   */
  constructor(
    db,
    options,
    scene,
    interaction,
    explorer,
    projectSystem,
    caveSystem,
    editorStateSystem,
    googleDriveSync,
    revisionStore,
    attributeDefs,
    modelSystem = null,
    modelsTree = null
  ) {
    this.db = db;
    this.options = options;
    this.scene = scene;
    this.interaction = interaction;
    this.explorer = explorer;
    this.projectSystem = projectSystem;
    this.caveSystem = caveSystem;
    this.editorStateSystem = editorStateSystem;
    this.googleDriveSync = googleDriveSync;
    this.revisionStore = revisionStore;
    this.attributeDefs = attributeDefs;
    this.modelSystem = modelSystem;
    this.modelsTree = modelsTree;
    this.modelLoader = null; // set via setModelLoader() after construction
    this.firstEdit = true;

    document.addEventListener('caveDeleted', (e) => this.onCaveDeleted(e));
    document.addEventListener('modelDeleted', (e) => this.onModelDeleted(e));
    document.addEventListener('modelChanged', (e) => this.onModelChanged(e));
    document.addEventListener('caveRenamed', (e) => this.onCaveRenamed(e));
    this._modelSyncTimers = new Map();
    document.addEventListener('modelFileSettingsSaved', (e) => {
      const { modelFileId, projectId } = e.detail;
      clearTimeout(this._modelSyncTimers.get(modelFileId));
      this._modelSyncTimers.set(modelFileId, setTimeout(() => {
        this._modelSyncTimers.delete(modelFileId);
        this.#autoSyncModelSettings(modelFileId, projectId);
      }, 2000));
    });
    document.addEventListener('caveAdded', (e) => this.onCaveAdded(e));
    document.addEventListener('caveChanged', (e) => this.onCaveChanged(e));
    document.addEventListener('caveSynced', (e) => this.onCaveSynced(e));
    document.addEventListener('surveyRenamed', (e) => this.onSurveyRenamed(e));
    document.addEventListener('surveyChanged', (e) => this.onSurveyChanged(e));
    document.addEventListener('surveyDeleted', (e) => this.onSurveyDeleted(e));
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
    cave.revision++;
    await this.projectSystem.saveCaveInProject(this.projectSystem.getCurrentProject().id, cave);

    const existingRevInfo = await this.revisionStore.loadRevision(cave.id);
    if (existingRevInfo === null) {
      // this is a cave that has never been saved to Google Drive
      return;
    }
    const originApp = existingRevInfo.originApp;
    const originRevision = existingRevInfo.originRevision;

    const autoSync = this.googleDriveSync.config.get('autoSync');
    const revInfo = new RevisionInfo(
      cave.id,
      cave.revision,
      this.googleDriveSync.config.getApp(),
      autoSync,
      originApp,
      originRevision
    );

    if (autoSync) {
      try {
        await this.googleDriveSync.coordinateUploadCave(cave, this.projectSystem.getCurrentProject(), revInfo);
      } catch (error) {
        console.log('Failed to sync to Google Drive', error);
        revInfo.synced = false;
      }
    }
    await this.revisionStore.saveRevision(revInfo);

  }

  async onCaveSynced(e) {
    const cave = e.detail.cave;
    const project = e.detail.project;
    if (project.id === this.projectSystem.getCurrentProject().id) {
      await this.currentProjectChanged(project, true);
    }
  }

  async onCaveAdded(e) {
    const cave = e.detail.cave;
    this.addCave(cave);
    // we are not using this.saveCave() here because it changes the revision and uploads the cave to Google Drive
    const currentProject = this.projectSystem.getCurrentProject();
    await this.projectSystem.saveCaveInProject(currentProject.id, cave);
    await this.uploadCaveToDrive(cave);
  }

  async onCaveChanged(e) {
    const cave = e.detail.cave;
    const reasons = e.detail.reasons;
    const source = e.detail.source;

    // we do not need to reload the cave if only the metadata has changed
    if (reasons.length > 1 || (reasons.length === 1 && reasons[0] !== 'metadata')) {
      await this.reloadCave(cave);
    }

    if (source !== 'project-panel') {
      await this.saveCave(cave);
    }

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
    const source = e.detail.source;
    const projectId = e.detail.projectId;
    const currentProject = this.projectSystem.getCurrentProject();

    if (!projectId || (currentProject && currentProject.id === projectId)) {
      this.scene.renameCave(oldName, cave.name);
    }
    this.explorer.renameCave(oldName, cave.name);
    //indexed db caves object store is indexed by id
    if (source !== 'project-panel') {
      await this.saveCave(cave);
    }
    this.#emitCaveRenamedCompleted(cave, oldName);
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
    const source = e.detail.source;
    const projectId = e.detail.projectId ?? this.projectSystem.getCurrentProject().id;
    await this.deleteCave(caveName, id, source, projectId);
  }

  async onCurrentProjectChanged(e) {
    const project = e.detail.project;
    await this.currentProjectChanged(project);
  }

  async currentProjectChanged(project, skipLocalChanges = false) {

    this.db.getAllCaves().forEach((cave) => {
      this.disposeCave(cave.name, cave.id);
    });

    this.db.clear();
    this.clearAllModels();
    globalNormalizer.reset();

    const caves = await this.caveSystem.getCavesByProjectId(project.id);

    caves.forEach((cave) => {
      this.recalculateCave(cave);
      this.calculateFragmentAttributes(cave);
      this.addCave(cave);
    });

    // Load models for this project
    const modelCoordSystem = await this.loadProjectModels(project.id);

    // Emit coordinate system from caves or models
    const caveCoordSystem = caves.find((c) => c.geoData?.coordinateSystem)?.geoData?.coordinateSystem;
    this.#emitCoordinateSystemChange(caveCoordSystem || modelCoordSystem || null);

    // Adjust grid and camera to fit all content (caves + models)
    const boundingBox = this.scene.computeBoundingBox();
    if (boundingBox) {
      this.scene.grid.adjust(boundingBox);
      this.scene.view.fitScreen(boundingBox);
    }

    this.scene.view.renderView();
    this.projectSystem.setCurrentProject(project);

    const editorState = await this.editorStateSystem.loadState(project.id);
    if (editorState !== undefined && !skipLocalChanges) {
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
    this.clearAllModels();
    globalNormalizer.reset();
    this.scene.view.renderView();
  }

  disposeCave(caveName) {
    this.scene.disposeCave(caveName);
    this.scene.speleo.deleteCave(caveName);
    this.scene.view.renderView();
    this.explorer.removeCave(caveName);
    this.explorer.closeEditorsForCave(caveName);
  }

  async deleteCave(caveName, caveId, source, projectId) {

    const currentProject = this.projectSystem.getCurrentProject();

    if (currentProject && currentProject.id === projectId) {
      this.disposeCave(caveName);
      if (this.db.getAllCaveNames().length === 0) {
        this.#emitCoordinateSystemChange(null);
      }
    }

    // adjust grid
    const boundingBox = this.scene.computeBoundingBox();
    if (boundingBox) {
      const size = boundingBox.getSize(new THREE.Vector3());
      if (!(size.x === 0 && size.y === 0 && size.z === 0)) {
        this.scene.grid.adjust(boundingBox);

        if (this.options.scene.grid.mode === 'hidden') {
          this.scene.grid.hide();
        } else {
          this.scene.view.renderView();
        }
      }
    }

    await this.projectSystem.removeCaveFromProject(projectId, caveId);

    switch (source) {
      case 'explorer-tree': {
        const revInfo = await this.revisionStore.loadRevision(caveId);

        if (revInfo === null) {
          return;
        }

        const autoSync = this.googleDriveSync.config.get('autoSync');

        if (autoSync && revInfo !== null) {
          await this.googleDriveSync.deleteCave({ id: caveId, name: caveName });
          // you can only delete a cave from an active project
          const projectId = this.projectSystem.getCurrentProject().id;
          const response = await this.googleDriveSync.fetchProject({ id: projectId });
          response.project.caves = response.project.caves.filter((c) => c.id !== caveId);
          response.project.deletedCaveIds.push(caveId);
          await this.googleDriveSync.uploadProject(response.project);
          await this.revisionStore.deleteRevision(caveId);
        } else {
          revInfo.deleted = true;
          await this.revisionStore.saveRevision(revInfo);
        }

        break;
      }
      case 'project-panel':
        this.#emitCaveDestructed(caveId);
        break;
      default:
        throw new Error(`Unknown source: ${source}`);
    }
  }

  async onModelDeleted(e) {
    const { name, modelFileId } = e.detail;

    // Remove from scene
    this.scene.models.removeModel(name);

    // Remove from UI tree
    if (this.modelsTree) {
      this.modelsTree.removeModel(name);
    }

    // Delete from storage (model file, textures, settings)
    if (modelFileId && this.modelSystem) {
      try {
        await this.modelSystem.deleteModelFile(modelFileId);
      } catch (err) {
        console.error('Failed to delete model from storage:', err);
      }
    }

    // Update project timestamp
    const project = this.projectSystem.getCurrentProject();
    if (project) {
      await this.projectSystem.saveProject(project);
    }

    // Adjust grid
    const boundingBox = this.scene.computeBoundingBox();
    if (boundingBox) {
      const size = boundingBox.getSize(new THREE.Vector3());
      if (!(size.x === 0 && size.y === 0 && size.z === 0)) {
        this.scene.grid.adjust(boundingBox);
      }
    }
    this.scene.view.renderView();
  }

  // ==================== Model Loading ====================

  /**
   * Set the model loader function that parses raw model files (PLY/OBJ blobs)
   * into Three.js objects. Keeps import/parsing logic out of the manager.
   * @param {Function} loaderFn - async (modelFile, onModelParsed) => void
   */
  setModelLoader(loaderFn) {
    this.modelLoader = loaderFn;
  }

  clearAllModels() {
    if (this.scene?.models) {
      this.scene.models.clearModels();
    }
    if (this.modelsTree) {
      this.modelsTree.clear();
    }
  }

  /**
   * Load all models for a project from storage.
   * @param {string} projectId
   * @returns {Promise<CoordinateSystem|null>} The first coordinate system found among models
   */
  async loadProjectModels(projectId) {
    if (!this.modelSystem || !this.modelLoader) return null;

    let coordSystem = null;

    try {
      const modelFiles = await this.modelSystem.getModelFilesByProject(projectId);
      if (modelFiles.length === 0) return null;

      const runLoad = async () => {
        if (this.loadingOverlay) this.loadingOverlay.beginBatch(modelFiles.length);
        try {
          for (const modelFile of modelFiles) {
            await this.modelLoader(modelFile, async (model, object3D) => {
              await this.addModelFromStorage(model, object3D, modelFile);
              if (!coordSystem && model.geoData?.coordinateSystem) {
                coordSystem = model.geoData.coordinateSystem;
              }
            });
            if (this.loadingOverlay) this.loadingOverlay.advanceBatch();
          }
        } finally {
          if (this.loadingOverlay) this.loadingOverlay.endBatch();
        }
      };

      if (this.loadingOverlay) {
        await this.loadingOverlay.guard(i18n.t('ui.loading.openingModel'), runLoad);
      } else {
        await runLoad();
      }

      console.log(`🌐 Loaded ${modelFiles.length} model(s) from storage`);
      if (this.modelsTree) this.modelsTree.render();
    } catch (error) {
      console.error('Failed to load project models:', error);
    }

    return coordSystem;
  }

  async addModelFromStorage(model, object3D, modelFile) {
    // Hide until fully loaded (settings + textures) to avoid visual pop-in
    object3D.visible = false;

    let entry;

    if (model instanceof PointCloud) {
      this.db.addPointCloud(model);
      // LAS/LAZ octree point clouds have colors pre-computed; PLY needs gradient here
      let colorGradients = null;
      if (!model.hasVertexColors && !model.hasOctree) {
        colorGradients = PointCloudHelper.getColorGradientsMultiColor(model.points, this.options.scene.models.color.gradientColors);
      }
      entry = this.scene.models.getPointCloudObject(object3D, colorGradients);
      this.scene.models.addPointCloud(model, entry);
    } else if (model instanceof Mesh3D) {
      this.db.addMesh(model);
      entry = this.scene.models.getMeshObject(object3D);
      this.scene.models.addMesh(model, entry);
    }

    // Load saved settings (transform, opacity, visibility)
    let savedSettings = null;
    try {
      savedSettings = await this.modelSystem.getModelFileSettings(modelFile.id);
    } catch (err) {
      console.warn('Failed to load model settings:', err);
    }

    // Load metadata (name, geoData/coordinates, embedded)
    let metadata = null;
    try {
      metadata = await this.modelSystem.getModelMetadataByModelFileId(modelFile.id);
      if (metadata) {
        if (metadata.name) model.name = metadata.name;
        if (metadata.geoData) model.geoData = metadata.geoData;
      }
    } catch (err) {
      console.warn('Failed to load model metadata:', err);
    }

    // Position model from geoData coordinates (before user transforms are applied)
    const coordinate = model.geoData?.coordinates?.[0]?.coordinate;
    if (coordinate && globalNormalizer.isInitialized()) {
      const normalizedPos = globalNormalizer.getNormalizedVector(coordinate);
      entry.object3D.position.set(normalizedPos.x, normalizedPos.y, normalizedPos.z);
    }

    // Add to models tree (applies saved transform/opacity)
    if (this.modelsTree && entry) {
      const node = this.modelsTree.addModel(model, entry.object3D, modelFile.id, savedSettings);
      if (node && metadata?.embedded) {
        node.embedded = true;
      }
      // Sync saved per-model color into ModelScene
      if (node?.color) {
        this.scene.models.modelColors.set(model.name, node.color);
      }
    }

    // Load associated textures/materials
    await this.loadModelAssets(model, modelFile);

    // Apply current color mode after model and textures are loaded
    await this.scene.models.updateModelColorMode(this.options.scene.models.color.mode);

    // Reveal the model with final transform and textures applied
    const finalVisible = savedSettings?.visible ?? true;
    if (entry) {
      entry.object3D.visible = finalVisible;
    }
  }

  async loadModelAssets(model, modelFile) {
    try {
      const assets = await this.modelSystem.getTextureFilesByModel(modelFile.id);
      if (assets.length === 0) return;

      const mtlAssets = assets.filter((a) => a.type === 'mtl');
      const textureAssets = assets.filter((a) => ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'exr'].includes(a.type));

      if (mtlAssets.length === 0) return;

      const textureMap = new Map();
      for (const texture of textureAssets) {
        const url = URL.createObjectURL(texture.data);
        textureMap.set(texture.filename, url);
        textureMap.set(texture.filename.toLowerCase(), url);
        textureMap.set(texture.filename.normalize('NFC'), url);
        textureMap.set(texture.filename.normalize('NFC').toLowerCase(), url);
      }

      const modelNode = this.modelsTree?.categories
        .get('3d-models')
        ?.children.find((n) => n.label === model.name);

      if (modelNode) {
        for (const mtlAsset of mtlAssets) {
          const mtlText = await mtlAsset.data.text();
          await this.modelsTree.applyMTLToModel(modelNode, mtlText, textureMap);
        }
      }
    } catch (error) {
      console.error(`Failed to load assets for model ${model.name}:`, error);
    }
  }

  async onModelChanged(e) {
    const { modelFileId, geoData, name, oldName, embedded } = e.detail;

    if (!modelFileId || !this.modelSystem) return;

    const project = this.projectSystem.getCurrentProject();
    if (!project) return;

    try {
      let metadata = await this.modelSystem.getModelMetadataByModelFileId(modelFileId);
      if (metadata) {
        if (geoData !== undefined) metadata.geoData = geoData;
        if (name !== undefined) metadata.name = name;
        if (embedded !== undefined) metadata.embedded = embedded;
        await this.modelSystem.saveModelMetadata(project.id, metadata);
        await this.#autoSyncModelMeta(modelFileId, project);
      }

      // Re-render model tree if name changed
      if (oldName && name && oldName !== name && this.modelsTree) {
        this.modelsTree.render();
      }

      if (geoData?.coordinateSystem) {
        this.#emitCoordinateSystemChange(geoData.coordinateSystem);
      }

      await this.projectSystem.saveProject(project);
    } catch (err) {
      console.error('Failed to save model metadata:', err);
    }
  }

  async #autoSyncModelMeta(modelFileId, project) {
    if (!this.googleDriveSync?.isReady() || !this.googleDriveSync.config.get('autoSync')) return;
    try {
      const metadata = await this.modelSystem.getModelMetadataByModelFileId(modelFileId);
      if (!metadata?.embedded) return;
      const rev = await this.revisionStore.loadRevision(`${modelFileId}_meta`);
      if (!rev || rev.originRevision === 0) return;
      const localApp = this.googleDriveSync.config.getApp();
      await this.googleDriveSync.uploadModelMetadata(metadata, rev, project, false);
      rev.synced = true;
      rev.originApp = localApp;
      rev.originRevision = rev.revision;
      await this.revisionStore.saveRevision(rev);
      await this.#updateDriveProjectModelRevision(project, modelFileId, { metadataRevision: rev.revision, metadataApp: localApp });
    } catch (err) {
      console.error('Auto-sync model metadata failed:', err);
    }
  }

  async #autoSyncModelSettings(modelFileId, projectId) {
    if (!this.googleDriveSync?.isReady() || !this.googleDriveSync.config.get('autoSync')) return;
    const project = this.projectSystem.getCurrentProject();
    if (!project || project.id !== projectId) return;
    try {
      const metadata = await this.modelSystem.getModelMetadataByModelFileId(modelFileId);
      if (!metadata?.embedded) return;
      const rev = await this.revisionStore.loadRevision(`${modelFileId}_settings`);
      if (!rev || rev.originRevision === 0) return;
      const settings = await this.modelSystem.getModelFileSettings(modelFileId);
      if (!settings) return;
      const localApp = this.googleDriveSync.config.getApp();
      await this.googleDriveSync.uploadModelSettings(settings, modelFileId, rev, project, false);
      rev.synced = true;
      rev.originApp = localApp;
      rev.originRevision = rev.revision;
      await this.revisionStore.saveRevision(rev);
      await this.#updateDriveProjectModelRevision(project, modelFileId, { settingsRevision: rev.revision, settingsApp: localApp });
    } catch (err) {
      console.error('Auto-sync model settings failed:', err);
    }
  }

  async #updateDriveProjectModelRevision(project, modelFileId, { metadataRevision, metadataApp, settingsRevision, settingsApp } = {}) {
    const result = await this.googleDriveSync.fetchProject({ id: project.id });
    if (!result) return;
    const driveProject = result.project;
    const model = driveProject.models.find((m) => m.id === modelFileId);
    if (!model) return;
    if (metadataRevision !== undefined) { model.metadataRevision = metadataRevision; model.metadataApp = metadataApp; }
    if (settingsRevision !== undefined) { model.settingsRevision = settingsRevision; model.settingsApp = settingsApp; }
    await this.googleDriveSync.uploadProject(driveProject, false);
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

    if (caveStations.size < 2) {
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
    this.scene.attributes.reloadStationAttributes(cave);
    this.scene.attributes.reloadSectionAttributes(cave);

    const boundingBox = this.scene.computeBoundingBox();
    if (boundingBox) {
      this.scene.grid.adjust(boundingBox);
      this.scene.view.panCameraTo(boundingBox.getCenter(new THREE.Vector3()));
      this.scene.view.fitScreen(boundingBox);
    }
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

  #emitCoordinateSystemChange(coordinateSystem) {
    const event = new CustomEvent('coordinateSystemChanged', {
      detail : {
        coordinateSystem
      }
    });
    document.dispatchEvent(event);
  }

  #emitCaveDestructed(id) {
    const event = new CustomEvent('caveDestructed', {
      detail : {
        id : id
      }
    });
    document.dispatchEvent(event);
  }

  #emitCaveRenamedCompleted(cave, oldName) {
    const event = new CustomEvent('caveRenamedCompleted', {
      detail : {
        cave    : cave,
        oldName : oldName
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

    const caves = this.db.getCavesMap();

    const coordinateSystems = [...new Set(caves.values().map((c) => c.geoData?.coordinateSystem))];
    // theoretically it is not possible, all already imported caves have the same coordinate system
    if (coordinateSystems.size > 1) {
      showErrorPanel(
        i18n.t('errors.import.cavesDifferentCoordinateSystems', {
          coordinateSystems : coordinateSystems.map((x) => x.type).join(', ')
        })
      );
      return;
    }

    const existingCoordinateSystem = coordinateSystems.length > 0 ? coordinateSystems[0] : undefined;
    const newCoordinateSystem = cave.geoData?.coordinateSystem;
    const isEqual =
      (existingCoordinateSystem === undefined && newCoordinateSystem === undefined) ||
      (existingCoordinateSystem !== undefined && existingCoordinateSystem.isEqual(newCoordinateSystem));

    if (!isEqual && coordinateSystems.length > 0) {
      return i18n.t('errors.import.caveDifferentCoordinateSystem', {
        coordinateSystem         : newCoordinateSystem?.toString() ?? i18n.t('ui.panels.coordinateSystem.none.title'),
        existingCoordinateSystem :
          existingCoordinateSystem?.toString() ?? i18n.t('ui.panels.coordinateSystem.none.title')
      });
    }

    const firstStationName = cave.getFirstStationName();
    const firstStationCoordinate = cave.geoData?.coordinates?.find((c) => c.name === firstStationName)?.coordinate;
    const firstStation = cave.getFirstStation();
    const coordinate = firstStationCoordinate ?? firstStation?.position;
    const maxDistance = this.options.import.cavesMaxDistance;
    const farEntities = this.db.getFarEntities(coordinate, cave.name, maxDistance);

    if (this.db.hasCave(cave.name)) {
      return i18n.t('errors.import.caveAlreadyImported', { name: cave.name });
    } else if (farEntities.length > 0) {
      return i18n.t('errors.import.cavesReallyFar', { name: cave.name, caves: farEntities.join('<br>') });
    }

    return undefined;

  }

  addSurvey(caveName, survey) {
    const cave = this.db.getCave(caveName);
    // Clear start station for non-first surveys
    if (cave.surveys.length > 0) {
      survey.start = undefined;
    }
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

      // this is the first cave in the project
      if (this.db.getAllCaveNames().length === 1) {
        this.#emitCoordinateSystemChange(cave?.geoData?.coordinateSystem);
      }

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

      let shouldRender = false;
      cave.attributes.sectionAttributes.forEach((sa) => {
        if (
          sa.visible &&
          sa.section.path !== undefined &&
          sa.section.path.length > 0 &&
          sa.attribute?.isValid() === true
        ) {
          const segments = SectionHelper.getSectionSegments(sa.section, cave.stations);
          this.scene.attributes.showFragmentAttribute(
            sa.id,
            segments,
            sa.attribute,
            sa.format,
            sa.color,
            cave.name,
            sa.position,
            sa.offset,
            false
          );
          shouldRender = true;
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
          this.scene.attributes.showFragmentAttribute(
            ca.id,
            segments,
            ca.attribute,
            ca.format,
            ca.color,
            cave.name,
            ca.position,
            ca.offset,
            false
          );
          shouldRender = true;
        } else if (ca.visible) {
          ca.visible = false;
        }
      });
      const promises = [];
      cave.attributes.stationAttributes.forEach((sa) => {
        if (sa.visible && cave.stations.has(sa.name) && sa.attribute?.isValid() === true) {
          shouldRender = true;
          promises.push(
            new Promise((resolve) => {
              this.scene.attributes.showStationAttribute(
                sa.id,
                cave.stations.get(sa.name),
                sa.attribute,
                cave.name,
                sa.position,
                sa.offset,
                false,
                () => resolve()
              );
            })
          );
        } else if (sa.visible) {
          sa.visible = false;
        }
      });
      if (shouldRender) {
        if (promises.length > 0) {
          Promise.all(promises).then(() => {
            this.scene.view.renderView();
          });
        } else {
          this.scene.view.renderView();
        }
      }

      const boundingBox = this.scene.computeBoundingBox();

      const [w, h, d] = boundingBox.getSize(new THREE.Vector3());

      // if the center lines or splays are not visible
      if (!(w === 0 && h === 0 && d === 0)) {
        this.scene.grid.adjust(boundingBox);

        if (this.options.scene.grid.mode === 'hidden') {
          this.scene.grid.hide();
        }

        this.scene.views.forEach((view) => {
          view.initiated = false;
        });

        this.scene.view.activate(boundingBox);

        // update starting points for all caves
        this.db.getAllCaves().forEach((c) => {
          this.scene.startPoint.addOrUpdateStartingPoint(c);
        });
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

  async uploadCaveToDrive(cave) {
    const currentProject = this.projectSystem.getCurrentProject();
    const autoSync = this.googleDriveSync.config.get('autoSync');

    if (autoSync) {
      try {
        const localApp = this.googleDriveSync.config.getApp();
        const revInfo = new RevisionInfo(cave.id, cave.revision, localApp, true, localApp, cave.revision);
        const projectRevInfo = await this.revisionStore.loadRevision(currentProject.id);
        // this is a project that has never been saved to Google Drive
        if (projectRevInfo === null) {
          return;
        }
        await this.googleDriveSync.uploadCaveToProject(cave, currentProject, revInfo);
        await this.revisionStore.saveRevision(revInfo);
      } catch (error) {
        console.warn('Failed to sync to Google Drive', error);
      }
    }
  }

  /**
   * Check if a model's coordinates are far from existing caves and models.
   * @param {PointCloud|Mesh3D} model - The model with geoData
   * @returns {string|null} Warning message or null
   */
  checkModelDistance(model) {
    const modelCoord = model.geoData?.coordinates?.[0]?.coordinate;
    if (!modelCoord) return null;

    const maxDistance = this.options.import.cavesMaxDistance;
    const farEntities = this.db.getFarEntities(modelCoord, model.name, maxDistance);

    if (farEntities.length > 0) {
      return i18n.t('errors.import.modelFarFromCaves', { name: model.name, caves: farEntities.join('<br>') });
    }
    return null;
  }

}

export { ProjectManager };
