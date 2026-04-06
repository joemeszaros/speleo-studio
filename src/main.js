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

import { Database } from './db.js';
import { MyScene, SceneOverview } from './scene/scene.js';
import {
  PlyModelImporter,
  ObjModelImporter,
  PolygonImporter,
  TopodroidImporter,
  JsonImporter,
  Importer
} from './io/import.js';
import { SceneInteraction } from './interactive.js';
import { ConfigManager, ObjectObserver, ConfigChanges } from './config.js';
import { Materials } from './materials.js';
import { ProjectManager } from './ui/manager.js';
import { NavigationBar } from './ui/navbar.js';
import { Footer } from './ui/footer.js';

import { Sidebar } from './ui/sidebar.js';
import { ExplorerTree } from './ui/explorer-tree.js';
import { ModelsTree } from './ui/models-tree.js';
import { SettingsPanel } from './ui/settings-panel.js';

import { AttributesDefinitions } from './attributes.js';
import { showErrorPanel, showInfoPanel, showSuccessPanel } from './ui/popups.js';
import { ProjectSystem } from './storage/project-system.js';
import { CaveSystem } from './storage/cave-system.js';
import { EditorStateSystem } from './storage/editor-states.js';
import { DatabaseManager } from './storage/database-manager.js';
import { ModelSystem } from './storage/model-system.js';
import { DeclinationCache } from './storage/declination-cache.js';
import { GoogleDriveSync } from './storage/google-drive-sync.js';
import { GoogleDriveSettings } from './ui/google-drive-settings.js';
import { ProjectPanel } from './ui/project-panel.js';
import { i18n } from './i18n/i18n.js';
import { LoadingOverlay } from './ui/loading-overlay.js';
import { PointCloudHelper } from './utils/models.js';
import { PointCloud, Mesh3D, ModelFile, ModelMetadata } from './model.js';
import { ModelCoordinateDialog } from './ui/model-coordinate-dialog.js';
import { GeoData, UTMCoordinateWithElevation, UTMCoordinateSystem, StationWithCoordinate } from './model/geo.js';
import { UTMConverter } from './utils/geo.js';
import { globalNormalizer } from './utils/global-coordinate-normalizer.js';
import { PrintUtils } from './utils/print.js';
import { node } from './utils/utils.js';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { RevisionStore } from './storage/revision.js';

class Main {

  constructor() {
    const loader = new FontLoader();
    i18n.init().then(() => {
      if (localStorage.getItem('first-visit') === null) {
        this.showWelcomePanel();
      }

      const db = new Database();
      this.db = db;
      // Load saved configuration or use defaults
      const loadedOptions = ConfigManager.loadOrDefaults();
      ConfigManager.fillWithNewDefaults(loadedOptions);
      const observer = new ObjectObserver();
      const options = observer.watchObject(loadedOptions);

      this.#loadAttributes()
        .then((attributeDefintions) => {

          if (!AttributesDefinitions.validateDefinitions(attributeDefintions)) {
            showErrorPanel(i18n.t('errors.init.invalidAttributesDefinitions'));
            return;
          }

          const attributeDefs = new AttributesDefinitions(attributeDefintions);
          console.log(
            `Attribute definitions version ${attributeDefintions.version} loaded: ${attributeDefintions.definitions.length} attributes, ${attributeDefintions.categories.length} categories`
          );

          // Initialize IndexedDB database and project systems
          this.databaseManager = new DatabaseManager();
          this.caveSystem = new CaveSystem(this.databaseManager, attributeDefs);
          this.projectSystem = new ProjectSystem(this.databaseManager, this.caveSystem);
          this.modelSystem = new ModelSystem(this.databaseManager);
          this.editorStateSystem = new EditorStateSystem(this.databaseManager);
          this.declinationCache = new DeclinationCache(this.databaseManager);
          this.revisionStore = new RevisionStore(this.databaseManager);

          loader.load(
            'fonts/helvetiker_regular.typeface.json',
            (font) => {
              // Initialize the application
              this.#initializeApp(db, options, observer, attributeDefs, font);
            },
            () => {},
            (error) => {
              console.error(i18n.t('errors.init.failedToLoadFont'), error);
              showErrorPanel(i18n.t('errors.init.failedToLoadFont'));
            }
          );
        })
        .catch((error) => {
          console.error(i18n.t('errors.init.failedToLoadAttributes', { error: error.message }), error);
          showErrorPanel(i18n.t('errors.init.failedToLoadAttributes', { error: error.message }));
        });
    });

  }

  async #loadAttributes(url = 'attributes.json') {
    console.log(`Loading attributes from ${url}`);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(i18n.t('errors.init.failedAttributesHttpCode', { url, httpCode: response.status }));
    }
    return await response.json();
  }

  async #initializeApp(db, options, observer, attributeDefs, font) {
    try {
      await this.databaseManager.init();
    } catch (error) {
      console.error(i18n.t('errors.init.failedToInitIndexedDb'), error);
      showErrorPanel(i18n.t('errors.init.failedToInitIndexedDb'));
    }
    const materials = new Materials(options);
    const sceneOverview = new SceneOverview(document.querySelector('#scene-overview'));
    const scene = new MyScene(options, db, materials, font, document.querySelector('#viewport'), sceneOverview);

    observer.watchChanges(new ConfigChanges(options, scene, materials).getOnChangeHandler());

    const footer = new Footer(document.getElementById('footer'));

    this.scene = scene;
    this.options = options;

    // Initialize sidebar
    this.sidebar = new Sidebar(this.options);

    // wait for sidebar dom element to be available
    await new Promise((resolve) => {
      const checkElement = () => {
        const element = document.getElementById('explorer-tree');
        if (element) {
          resolve();
        } else {
          setTimeout(checkElement, 50);
        }
      };
      checkElement();
    });

    const interaction = new SceneInteraction(
      db,
      options,
      footer,
      scene,
      materials,
      scene.domElement,
      document.getElementById('station-context-menu'),
      document.getElementById('infopanel'),
      document.getElementById('tool-panel'),
      ['fixed-size-editor', 'resizable-editor']
    );

    // Initialize explorer tree in sidebar
    this.explorerTree = new ExplorerTree(
      db,
      options,
      scene,
      interaction,
      attributeDefs,
      this.declinationCache,
      document.getElementById('explorer-tree'),
      document.getElementById('explorer-context-menu')
    );

    // Initialize settings panel in sidebar
    this.settingsPanel = new SettingsPanel(document.getElementById('settings-content'), options);

    // Initialize models tree in sidebar
    this.modelsTree = new ModelsTree(
      db,
      options,
      scene,
      document.getElementById('models-tree'),
      document.getElementById('models-properties'),
      document.getElementById('models-context-menu'),
      document.getElementById('textureInput'),
      this.modelSystem,
      this.projectSystem
    );

    this.googleDriveSync = new GoogleDriveSync(this.dbManager, this.projectSystem, this.caveSystem, attributeDefs);
    if (
      this.googleDriveSync.config.isConfigured() &&
      this.googleDriveSync.config.hasTokens() &&
      !this.googleDriveSync.config.hasValidTokens()
    ) {
      try {
        await this.googleDriveSync.refreshToken();
      } catch (error) {
        console.error('Failed to refresh Google Drive token:', error);
      }
    }
    this.googleDriveSettings = new GoogleDriveSettings(this.googleDriveSync);

    this.projectManager = new ProjectManager(
      db,
      options,
      scene,
      interaction,
      this.explorerTree,
      this.projectSystem,
      this.caveSystem,
      this.editorStateSystem,
      this.googleDriveSync,
      this.revisionStore,
      attributeDefs,
      this.modelSystem,
      this.modelsTree
    );
    this.projectManager.setModelLoader(async (modelFile, onModelParsed) => {
      const importer = this.importers[modelFile.type];
      if (!importer) {
        console.warn(`No importer found for model type: ${modelFile.type}`);
        return;
      }
      const importMethod = modelFile.type === 'ply' ? 'importData' : 'importText';
      const importData = modelFile.type === 'ply'
        ? await modelFile.data.arrayBuffer()
        : await modelFile.data.text();
      await importer[importMethod](importData, onModelParsed, modelFile.filename);
    });

    // Initialize project panel
    this.projectPanel = new ProjectPanel(
      db,
      document.getElementById('project-panel'),
      this.projectSystem,
      this.caveSystem,
      this.googleDriveSync,
      this.revisionStore,
      attributeDefs,
      'projectInput',
      this.modelSystem
    );
    this.projectPanel.setupPanel();
    this.projectPanel.show();

    this.printUtils = new PrintUtils(options, scene, this.projectSystem);

    window.addEventListener('beforeprint', async () => {
      await this.printUtils.cropCanvasToImage();
    });

    new NavigationBar(
      db,
      document.getElementById('navbarcontainer'),
      options,
      scene,
      this.printUtils,
      interaction,
      this.projectManager,
      this.projectSystem,
      this.googleDriveSettings,
      this.projectPanel,
      document.getElementById('export-panel'),
      document.getElementById('print-panel')

    );

    this.loadingOverlay = new LoadingOverlay();

    this.importers = {
      topodroid : new TopodroidImporter(db, options, scene, this.projectManager),
      polygon   : new PolygonImporter(db, options, scene, this.projectManager),
      json      : new JsonImporter(db, options, scene, this.projectManager, attributeDefs),
      ply       : new PlyModelImporter(db, options, scene, this.projectManager),
      obj       : new ObjModelImporter(db, options, scene, this.projectManager)
    };

    this.#setupEventListeners();

    const urlParams = new URLSearchParams(window.location.search);
    this.#loadProjectFromUrl(urlParams)
      .then(async (project) => {
        if (project) {
          this.projectPanel.hide();
          try {
            await this.#loadCaveFromUrl(urlParams, project);
          } catch (error) {
            console.error('Failed to load cave from URL:', error);
            showErrorPanel(i18n.t('errors.import.failedToLoadCaveFromUrl', { error: error.message }));
          }
        }
      }).catch((error) => {
        console.error('Failed to load project or cave from URL:', error);
        showErrorPanel(i18n.t('errors.import.failedToLoadProjectOrCaveFromUrl', { error: error.message }));
      });

  }

  #setupEventListeners() {
    this.#setupCaveFileInputListener();
    this.#setupSurveyFileInputListeners();
    this.#setupModelFileInputListener();
    ConfigManager.setupConfigFileInputListener(
      this.options,
      this.settingsPanel,
      document.getElementById('configInput')
    );
  }

  #setupCaveFileInputListener() {
    Importer.setupFileInputListener({
      inputId : 'caveInput',

      handlers : new Map([
        ['cave', this.importers.polygon],
        ['json', this.importers.json]
      ]),
      onLoad : async (cave) => await this.#tryAddCave(cave)
    });
  }

  #setupSurveyFileInputListeners() {
    Importer.setupFileInputListener({
      inputId  : 'surveyInput',
      handlers : new Map([['csv', this.importers.topodroid]]),
      onLoad   : async (result) => {
        this.tryModifyGeoData(result.survey.name, result.geoData);
        await this.#tryAddSurvey(result.survey);
      }
    });
    Importer.setupFileInputListener({
      inputId  : 'surveyInputPartial',
      handlers : new Map([['csv', this.importers.topodroid]]),
      onLoad   : async (survey) => await this.projectManager.tryAddSurveyToSurvey(survey)
    });

  }

  #setupModelFileInputListener() {
    const modelExtensions = new Set(['ply', 'obj']);
    const input = document.getElementById('modelInput');

    input.addEventListener('change', async (e) => {
      const files = Array.from(e.target.files);
      if (files.length === 0) return;

      await this.loadingOverlay.guard(i18n.t('ui.loading.openingModel'), async () => {
      try {
        // Separate model files from asset files (MTL, textures)
        const modelFiles = [];
        const assetFiles = [];

        for (const file of files) {
          const ext = file.name.toLowerCase().split('.').pop();
          if (modelExtensions.has(ext)) {
            modelFiles.push(file);
          } else {
            assetFiles.push(file);
          }
        }

        const hasAssets = assetFiles.length > 0;

        // Parse model files first to extract embedded coordinates
        const parsedModels = [];
        for (const file of modelFiles) {
          const ext = file.name.toLowerCase().split('.').pop();
          const handler = this.importers[ext];
          if (!handler) continue;

          await handler.importFile(file, file.name, async (model, object3D, modelFile) => {
            parsedModels.push({ model, object3D, modelFile });
          });
        }

        // Show coordinate dialog with embedded coordinates pre-filled (if found)
        const firstModel = parsedModels[0]?.model;
        const embeddedCoords = firstModel?.embeddedCoords || null;
        const modelCoordDialog = new ModelCoordinateDialog();
        const wgs84Coords = await modelCoordDialog.show(
          modelFiles[0]?.name || '',
          embeddedCoords
        );

        // Convert WGS84 to GeoData if coordinates were provided
        let geoData = null;
        if (wgs84Coords) {
          geoData = this.#createGeoDataFromWGS84(wgs84Coords);
        }

        // Add parsed models to the scene
        const importedNodes = [];
        for (const { model, object3D, modelFile } of parsedModels) {
          // Hide model until textures are applied to prevent visual pop-in
          if (hasAssets) object3D.visible = false;

          // Set geoData on the model if coordinates were provided
          if (geoData) model.geoData = geoData;

          await this.#tryAddModel(model, object3D, modelFile);

          // Find the newly added model node for texture application
          if (hasAssets && this.modelsTree) {
            const node = this.modelsTree.categories
              .get('3d-models')
              ?.children.find((n) => n.label === model.name);
            if (node) importedNodes.push(node);
          }
        }

        // Apply asset files (MTL + textures) to imported models, then reveal
        if (hasAssets && importedNodes.length > 0) {
          for (const node of importedNodes) {
            await this.modelsTree.loadTexturesForModel(node, assetFiles);
            node.object3D.visible = true;
          }
          this.scene.view.renderView();
        }
      } finally {
        input.value = '';
      }
      });
    });
  }

  async #tryAddModel(model, object3D, modelFile) {
    let entry;

    if (model instanceof PointCloud) {
      // Handle point cloud (PLY without faces)
      this.db.addPointCloud(model);

      // Only calculate gradient colors if the point cloud doesn't have vertex colors
      const colorGradients = model.hasVertexColors
        ? null
        : PointCloudHelper.getColorGradients(model.points, this.options.scene.models.color);

      entry = this.scene.models.getPointCloudObject(object3D, colorGradients);
      this.scene.models.addPointCloud(model, entry);
    } else if (model instanceof Mesh3D) {
      // Handle mesh (PLY with faces or OBJ)
      this.db.addMesh(model);
      entry = this.scene.models.getMeshObject(object3D);
      this.scene.models.addMesh(model, entry);
    }

    // Save model file to IndexedDB for persistence
    if (modelFile && this.projectSystem.getCurrentProject()) {
      await this.#saveModelToStorage(model, modelFile);
    }

    // Emit coordinate system change if the model has geoData
    if (model.geoData?.coordinateSystem) {
      document.dispatchEvent(new CustomEvent('coordinateSystemChanged', {
        detail: { coordinateSystem: model.geoData.coordinateSystem }
      }));
    }

    // Add to models tree for management (pass modelFileId for settings persistence)
    if (this.modelsTree) {
      this.modelsTree.addModel(model, entry.object3D, modelFile?.id);
    }

    const boundingBox = this.scene.computeBoundingBox();
    this.scene.grid.adjust(boundingBox);
    this.scene.view.fitScreen(boundingBox);
  }

  /**
   * Convert WGS84 coordinates to GeoData with UTM coordinate system.
   * If a project coordinate system already exists, converts to that system instead.
   * @param {{latitude: number, longitude: number, elevation: number}} wgs84
   * @returns {GeoData}
   */
  #createGeoDataFromWGS84(wgs84) {
    const { latitude, longitude, elevation } = wgs84;
    const { easting, northing, zoneNum, zoneLetter } = UTMConverter.fromLatLon(latitude, longitude);
    const northern = zoneLetter >= 'N';
    const coordinateSystem = new UTMCoordinateSystem(zoneNum, northern);
    const coordinate = new UTMCoordinateWithElevation(easting, northing, elevation);

    return new GeoData(coordinateSystem, [new StationWithCoordinate('origin', coordinate)]);
  }

  /**
   * Save a model file to IndexedDB for persistence
   * @param {PointCloud|Mesh3D} model - The model data
   * @param {ModelFile} modelFile - File info with rawData, type, filename
   */
  async #saveModelToStorage(model, modelFile) {
    try {
      const project = this.projectSystem.getCurrentProject();
      await this.modelSystem.saveModelFile(project.id, modelFile);

      // Save model metadata (name, geoData)
      const metadata = new ModelMetadata(modelFile.id, model.name, model.geoData);
      await this.modelSystem.saveModelMetadata(project.id, metadata);

      await this.projectSystem.saveProject(project);
    } catch (error) {
      console.error('Failed to save model file to IndexedDB:', error);
    }
  }

  async #tryAddSurvey(survey) {

    if (survey.name === undefined) {
      showErrorPanel(i18n.t('errors.import.surveyNameUndefined'));
      return;
    }
    const caveName = document.getElementById('surveyInput').caveName; // custom property
    if (this.db.getSurvey(caveName, survey.name) !== undefined) {
      showErrorPanel(i18n.t('errors.import.surveyAlreadyExists', { name: survey.name, cave: caveName }));
      return;
    }
    const cave = this.db.getCave(caveName);
    this.projectManager.addSurvey(caveName, survey);
    await this.projectSystem.saveCaveInProject(this.projectSystem.getCurrentProject().id, cave);
  }

  tryModifyGeoData(surveyName, geoData) {
    if (!geoData) {
      return;
    }
    const caveName = document.getElementById('surveyInput').caveName; // custom property
    const cave = this.db.getCave(caveName);
    if (cave.geoData === undefined || cave.geoData.coordinateSystem.type === undefined) {
      cave.geoData = geoData;
      showSuccessPanel(i18n.t('messages.import.geoDataModified', { surveyName: surveyName }));
    } else {
      showInfoPanel(i18n.t('messages.import.geoDataSkipped', { surveyName: surveyName }));
    }

  }

  async #tryAddCave(cave) {
    const currentProject = this.projectSystem.getCurrentProject();
    const cavesNamesInProject = await this.projectSystem.getCaveNamesForProject(currentProject.id);
    if (cavesNamesInProject.includes(cave.name)) {
      throw Error(i18n.t('errors.import.caveAlreadyImported', { name: cave.name }));
    }
    //due to indexed db and google drive cave id must be globally unique
    const caveIdExists = await this.caveSystem.checkCaveExistsById(cave.id);
    if (caveIdExists) {
      throw Error(i18n.t('errors.import.caveIdAlreadyExists', { id: cave.id }));
    }

    const errorMessage = this.projectManager.validateBeforeAdd(cave);
    if (errorMessage) {
      showErrorPanel(`${i18n.t('errors.import.importFileFailed', { name: cave.name })}: ${errorMessage}`);
      return;
    }
    await this.projectSystem.addCaveToProject(currentProject.id, cave);
    this.projectManager.calculateFragmentAttributes(cave);
    this.projectManager.addCave(cave);
    await this.projectManager.uploadCaveToDrive(cave);

  }

  async #loadProjectFromUrl(urlParams) {

    if (urlParams.has('project')) {
      const projectName = urlParams.get('project');
      const loadedProject = await this.projectSystem.loadProjectOrCreateByName(projectName);

      document.dispatchEvent(
        new CustomEvent('currentProjectChanged', {
          detail : {
            project : loadedProject
          }
        })
      );
      return loadedProject;
    }
  }

  async #loadCaveFromUrl(urlParams, project) {

    if (urlParams.has('cave')) {
      const caveNameUrl = urlParams.get('cave');

      if (!project) {
        throw new Error(i18n.t('errors.import.projectUrlParameterMissing'));
      }

      this.projectPanel.hide();

      let importer;

      if (caveNameUrl.includes('.cave')) {
        importer = this.importers.polygon;
      } else if (caveNameUrl.includes('.csv')) {
        importer = this.importers.topodroid;
      } else if (caveNameUrl.includes('.json')) {
        importer = this.importers.json;
      }

      if (importer !== undefined) {
        fetch(caveNameUrl)
          .then((response) => {
            if (!response.ok) {
              throw new Error(
                i18n.t('errors.import.failedToDownloadFile', { name: caveNameUrl, error: response.statusText })
              );
            }
            return response.blob();
          })
          .then((res) => {
            return new Promise((resolve, reject) => {
              importer.importFile(res, caveNameUrl, async (cave) => {
                try {
                  await this.#tryAddCave(cave);
                  resolve();
                } catch (error) {
                  reject(error);
                }
              });
            });
          })
          .catch((error) => {
            const msgPrefix = i18n.t('errors.import.importFileFailed', { name: caveNameUrl });
            showErrorPanel(`${msgPrefix}: ${error.message}`);
            console.error(msgPrefix, error);
          });
      }
    } else {
      this.scene.view.renderView();
    }
  }

  showWelcomePanel() {
    const welcomePanel = node`
      <div id="welcome-panel">
      <div class="welcome-container">
        <img src="images/logo.png" alt="Speleo Studio Logo" class="welcome-logo" />
        <h1 class="welcome-title">${i18n.t('ui.welcome.title')}</h1>
        <p class="welcome-subtitle">
          ${i18n.t('ui.welcome.subtitle')}
        </p>
        <button class="welcome-button">
          ${i18n.t('ui.welcome.button')}
        </button>
      </div>
    </div>`;
    const welcomeButton = welcomePanel.querySelector('.welcome-button');
    welcomeButton.addEventListener('click', () => {
      welcomePanel.style.display = 'none';
      localStorage.setItem('first-visit', 'false');
      showInfoPanel(i18n.t('ui.welcome.info'));
    });
    document.body.appendChild(welcomePanel);
  }
}

export { Main };
