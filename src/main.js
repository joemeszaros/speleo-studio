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

import * as THREE from 'three';
import { Database } from './db.js';
import { MyScene, SceneOverview } from './scene/scene.js';
import {
  PlyModelImporter,
  ObjModelImporter,
  LasModelImporter,
  PolygonImporter,
  TopodroidImporter,
  JsonImporter,
  TherionImporter,
  SurvexImporter,
  LoxImporter,
  Importer
} from './io/import.js';
import { AscDTMImporter, HgtDTMImporter } from './io/dtm-importer.js';
import { XyzImporter } from './io/xyz-importer.js';
import { GeoTiffImporter } from './io/geotiff-importer.js';
import { XyzKindDialog } from './ui/xyz-kind-dialog.js';
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
import { AscRenderModeDialog } from './ui/asc-render-mode-dialog.js';
import { GeoData, UTMCoordinateWithElevation, UTMCoordinateSystem, EOVCoordinateWithElevation, EOVCoordinateSystem, StationWithCoordinate, CoordinateSystemType } from './model/geo.js';
import { UTMConverter, WGS84Converter } from './utils/geo.js';
import { globalNormalizer } from './utils/global-coordinate-normalizer.js';
import { PrintUtils } from './utils/print.js';
import { node } from './utils/utils.js';
import { setDecimalSeparator } from './ui/component/input.js';
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

      // Apply the configured decimal separator and keep it in sync with config changes.
      setDecimalSeparator(options.format?.decimalSeparator ?? '.');
      document.addEventListener('decimalSeparatorChanged', () => {
        setDecimalSeparator(options.format?.decimalSeparator ?? '.');
      });

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
          this.revisionStore = new RevisionStore(this.databaseManager);
          this.modelSystem = new ModelSystem(this.databaseManager, this.revisionStore);
          this.editorStateSystem = new EditorStateSystem(this.databaseManager);
          this.declinationCache = new DeclinationCache(this.databaseManager);

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
    footer.updateZoomLevel(scene.view.control.zoom);

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
      document.getElementById('explorer-context-menu'),
      this.projectSystem
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

    this.googleDriveSync = new GoogleDriveSync(this.dbManager, this.projectSystem, this.caveSystem, attributeDefs, this.modelSystem);
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
    document.addEventListener('newCaveRequested', () => {
      if (this.projectSystem.getCurrentProject() === null) return;
      this.projectManager.addNewCave();
    });
    this.projectManager.setModelLoader(async (modelFile, onModelParsed) => {
      const importer = this.importers[modelFile.type];
      if (!importer) {
        console.warn(`No importer found for model type: ${modelFile.type}`);
        return;
      }
      const binaryTypes = new Set(['ply', 'las', 'laz', 'lox', 'hgt', 'tif', 'tiff']);
      const importMethod = binaryTypes.has(modelFile.type) ? 'importData' : 'importText';
      const importData = binaryTypes.has(modelFile.type)
        ? await modelFile.data.arrayBuffer()
        : await modelFile.data.text();
      await importer[importMethod](importData, onModelParsed, modelFile.filename, modelFile.id);
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
    this.googleDriveSettings.projectPanel = this.projectPanel;

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
    this.projectManager.loadingOverlay = this.loadingOverlay;
    scene.loadingOverlay = this.loadingOverlay;

    // Listen for LAS/LAZ loading progress to update the overlay
    document.addEventListener('pointCloudLoadProgress', (e) => {
      if (this.loadingOverlay.isActive()) {
        this.loadingOverlay.updateMessage(e.detail.message);
        this.loadingOverlay.updateProgress(e.detail.percent);
      }
    });

    this.importers = {
      topodroid : new TopodroidImporter(db, options, scene, this.projectManager),
      polygon   : new PolygonImporter(db, options, scene, this.projectManager),
      json      : new JsonImporter(db, options, scene, this.projectManager, attributeDefs),
      therion   : new TherionImporter(db, options, scene, this.projectManager),
      survex    : new SurvexImporter(db, options, scene, this.projectManager),
      ply       : new PlyModelImporter(db, options, scene, this.projectManager),
      obj       : new ObjModelImporter(db, options, scene, this.projectManager),
      asc       : new AscDTMImporter(db, options, scene, this.projectManager),
      hgt       : new HgtDTMImporter(db, options, scene, this.projectManager),
      xyz       : new XyzImporter(db, options, scene, this.projectManager),
      tif       : new GeoTiffImporter(db, options, scene, this.projectManager),
      las       : new LasModelImporter(db, options, scene, this.projectManager),
      laz       : new LasModelImporter(db, options, scene, this.projectManager),
      lox       : new LoxImporter(db, options, scene, this.projectManager)
    };
    this.importers.tiff = this.importers.tif;

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
    this.#preventFileDrop();
  }

  #preventFileDrop() {
    document.addEventListener('dragover', e => e.preventDefault());
    document.addEventListener('drop',     e => e.preventDefault());
  }

  #setupCaveFileInputListener() {
    const input = document.getElementById('caveInput');
    input.addEventListener('change', async (e) => {
      const files = Array.from(e.target.files);
      if (files.length === 0) return;

      try {
        // Batch all .th files together so input directives can be resolved across them
        const therionFiles = files.filter(f => f.name.toLowerCase().endsWith('.th'));
        // Batch all .svx files together so *include directives can be resolved across them
        const svxFiles     = files.filter(f => f.name.toLowerCase().endsWith('.svx'));
        const otherFiles   = files.filter(f =>
          !f.name.toLowerCase().endsWith('.th') &&
          !f.name.toLowerCase().endsWith('.svx')
        );

        if (therionFiles.length > 0) {
          try {
            const filesMap = new Map(therionFiles.map(f => [f.name, f]));
            await this.importers.therion.importFiles(filesMap, async (cave) => {
              await this.#tryAddCave(cave);
            });
          } catch (error) {
            const msgPrefix = i18n.t('errors.import.importFileFailed', { name: therionFiles[0].name });
            showErrorPanel(`${msgPrefix}: ${error.message}`);
            console.error(msgPrefix, error);
          }
        }

        if (svxFiles.length > 0) {
          try {
            const filesMap = new Map(svxFiles.map(f => [f.name, f]));
            await this.importers.survex.importFiles(filesMap, async (cave) => {
              await this.#tryAddCave(cave);
            });
          } catch (error) {
            const msgPrefix = i18n.t('errors.import.importFileFailed', { name: svxFiles[0].name });
            showErrorPanel(`${msgPrefix}: ${error.message}`);
            console.error(msgPrefix, error);
          }
        }

        const handlers = new Map([
          ['cave', this.importers.polygon],
          ['json', this.importers.json]
        ]);

        for (const file of otherFiles) {
          try {
            const ext     = file.name.toLowerCase().split('.').pop();
            const handler = handlers.get(ext);
            if (!handler) {
              showErrorPanel(i18n.t('errors.import.unsupportedFileType', { extension: ext }));
              continue;
            }
            await handler.importFile(file, file.name, async (cave) => {
              await this.#tryAddCave(cave);
            });
          } catch (error) {
            const msgPrefix = i18n.t('errors.import.importFileFailed', { name: file.name });
            showErrorPanel(`${msgPrefix}: ${error.message}`);
            console.error(msgPrefix, error);
          }
        }
      } finally {
        input.value = '';
      }
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
    const modelExtensions = new Set(['ply', 'obj', 'asc', 'hgt', 'xyz', 'tif', 'tiff', 'las', 'laz', 'lox']);
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

        // XYZ files: ask the user whether the file is a DTM (regular grid)
        // or a scattered point cloud. The format itself doesn't say.
        const isXyz = (f) => f.name.toLowerCase().endsWith('.xyz');
        let xyzKind = null;
        const hasXyz = modelFiles.some(isXyz);
        if (hasXyz) {
          xyzKind = await new XyzKindDialog().show();
          if (xyzKind === null) {
            // Skip XYZ files if cancelled
            modelFiles.splice(0, modelFiles.length, ...modelFiles.filter((f) => !isXyz(f)));
          }
        }

        // DTM files (.asc, .hgt, and .xyz when xyzKind==='dtm') need an extra
        // dialog (mesh vs point cloud). Asked once per batch. The render-mode
        // dialog is skipped for pure scattered-XYZ batches (no mesh option).
        const innateDtmExts = new Set(['asc', 'hgt', 'tif', 'tiff']);
        const isInnateDtm = (f) => innateDtmExts.has(f.name.toLowerCase().split('.').pop());
        const dtmRequiresRenderMode = (f) => {
          const ext = f.name.toLowerCase().split('.').pop();
          if (innateDtmExts.has(ext)) return true;
          if (ext === 'xyz' && xyzKind === 'dtm') return true;
          return false;
        };
        let dtmRenderMode = null;
        const hasDtmRenderMode = modelFiles.some(dtmRequiresRenderMode);
        if (hasDtmRenderMode) {
          dtmRenderMode = await new AscRenderModeDialog().show();
          if (dtmRenderMode === null) {
            // Skip DTM-rendered files if cancelled (innate DTMs + dtm-mode XYZ)
            modelFiles.splice(
              0, modelFiles.length,
              ...modelFiles.filter((f) => !dtmRequiresRenderMode(f))
            );
          }
        }

        // Parse model files first to extract embedded coordinates
        const parsedModels = [];
        this.loadingOverlay.beginBatch(modelFiles.length);
        try {
          for (const file of modelFiles) {
            const ext = file.name.toLowerCase().split('.').pop();
            const handler = this.importers[ext];
            if (!handler) {
              this.loadingOverlay.advanceBatch();
              continue;
            }

            try {
              let importOpts;
              if (ext === 'xyz') {
                importOpts = { xyzKind, renderMode: dtmRenderMode };
              } else if (innateDtmExts.has(ext)) {
                importOpts = { renderMode: dtmRenderMode };
              }
              await handler.importFile(file, file.name, async (model, object3D, modelFile) => {
                parsedModels.push({ model, object3D, modelFile });
              }, importOpts);
            } catch (error) {
              const msgPrefix = i18n.t('errors.import.importFileFailed', { name: file.name });
              showErrorPanel(`${msgPrefix}: ${error.message}`);
              console.error(msgPrefix, error);
            }
            this.loadingOverlay.advanceBatch();
          }
        } finally {
          this.loadingOverlay.endBatch();
        }

        // Resolve per-model embeddedCoords (e.g. HGT filename, OBJ comment
        // headers) to geoData first — each model gets its own anchor.
        for (const pm of parsedModels) {
          if (pm.model.embeddedCoords && !pm.model.geoData) {
            pm.model.geoData = this.#createGeoDataFromWGS84(pm.model.embeddedCoords);
          }
        }

        // Show the shared WGS84 dialog only for models that still lack
        // geoData (typical for ASC / bare PLY / OBJ without comments).
        const needsCoords = parsedModels.filter((pm) => !pm.model.geoData);
        let sharedGeoData = null;
        if (needsCoords.length > 0) {
          const firstNeeding = needsCoords[0].model;
          const embeddedCoords = firstNeeding?.embeddedCoords || null;
          const firstPointCoords = firstNeeding?.firstPointCoords || null;
          const modelCoordDialog = new ModelCoordinateDialog();
          const wgs84Coords = await modelCoordDialog.show(
            modelFiles[0]?.name || '',
            embeddedCoords,
            firstPointCoords
          );
          if (wgs84Coords) {
            sharedGeoData = this.#createGeoDataFromWGS84(wgs84Coords);
          }
        }

        // Add parsed models to the scene
        const importedNodes = [];
        for (const { model, object3D, modelFile } of parsedModels) {
          // Hide model until textures are applied to prevent visual pop-in
          if (hasAssets) object3D.visible = false;

          // Apply shared dialog result only to models that didn't already
          // have geoData from their own embeddedCoords.
          if (!model.geoData && sharedGeoData) model.geoData = sharedGeoData;

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
    // Check distance from existing caves before adding
    const distanceWarning = this.projectManager.checkModelDistance(model);
    if (distanceWarning) {
      showErrorPanel(distanceWarning);
      return;
    }

    let entry;

    if (model instanceof PointCloud) {
      // Handle point cloud (PLY without faces, or LAS/LAZ)
      this.db.addPointCloud(model);

      // LAS/LAZ octree point clouds have colors pre-computed (RGB or gradient in worker)
      // PLY point clouds without vertex colors need gradient colors computed here
      const colorGradients = (model.hasVertexColors || model.hasOctree)
        ? null
        : PointCloudHelper.getColorGradientsMultiColor(model.points, this.options.scene.models.color.gradientColors);

      entry = this.scene.models.getPointCloudObject(object3D, colorGradients);
      this.scene.models.addPointCloud(model, entry);
    } else if (model instanceof Mesh3D) {
      // Handle mesh (PLY with faces or OBJ)
      this.db.addMesh(model);
      entry = this.scene.models.getMeshObject(object3D);
      this.scene.models.addMesh(model, entry);
      // Register orthophoto texture metadata so drape can find it later
      if (model.modelKind === 'orthophoto' && model.orthoMetadata) {
        this.scene.models.registerOrthoMetadata(model.name, model.orthoMetadata);
      }
    }

    // Position model using geoData coordinates
    this.#positionModelFromGeoData(model, entry.object3D);

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
      const modelNode = this.modelsTree.addModel(model, entry.object3D, modelFile?.id);
      // Sync saved per-model color into ModelScene
      if (modelNode?.color) {
        this.scene.models.modelColors.set(model.name, modelNode.color);
      }
    }

    // Apply current color mode to the newly added model
    await this.scene.models.updateModelColorMode(this.options.scene.models.color.mode);

    // Drape orchestration:
    //  - new orthophoto: prefer its saved drape target (project reload),
    //    otherwise auto-pick the first overlapping DTM in the scene.
    //  - new DTM: late-arrival case — drape any orthophoto whose saved
    //    drape target matches this DTM and isn't yet draped.
    let drapeChanged = false;
    if (model.modelKind === 'orthophoto') {
      let target = null;
      if (model.drapedOnto && this.scene.models.meshObjects.has(model.drapedOnto)) {
        target = model.drapedOnto;
      } else {
        target = this.#findDrapeTarget(model.name);
      }
      if (target) {
        if (this.scene.models.drapeOrthophoto(model.name, target)) {
          model.drapedOnto = target;
          drapeChanged = true;
        }
      }
    } else if (model.modelKind === 'dtm' && this.modelsTree) {
      const category = this.modelsTree.categories.get('3d-models');
      for (const node of category?.children ?? []) {
        const m = node.data;
        if (m?.modelKind !== 'orthophoto') continue;
        if (m === model) continue;
        if (m.drapedOnto !== model.name) continue;
        const orthoEntry = this.scene.models.meshObjects.get(node.label);
        if (orthoEntry?.userData?.drapedOnto) continue;
        if (this.scene.models.drapeOrthophoto(node.label, model.name)) {
          drapeChanged = true;
        }
      }
    }
    // Re-render the tree so the drape badge / icon updates pick up the change.
    if (drapeChanged && this.modelsTree) this.modelsTree.render();

    const boundingBox = this.scene.computeBoundingBox();
    if (boundingBox) {
      this.scene.grid.adjust(boundingBox);
      this.scene.view.fitScreen(boundingBox);
    }
  }

  /**
   * Find a DTM mesh whose world XY bbox overlaps the given orthophoto's
   * world XY bbox. Returns the DTM model's name, or null if no match.
   */
  #findDrapeTarget(orthoName) {
    const orthoEntry = this.scene.models.meshObjects.get(orthoName);
    if (!orthoEntry) return null;
    const orthoBox = new THREE.Box3().setFromObject(orthoEntry.object3D);
    if (orthoBox.isEmpty()) return null;

    for (const [name, entry] of this.scene.models.meshObjects) {
      if (name === orthoName) continue;
      const dtmModel = this.db.getMesh(name);
      if (dtmModel?.modelKind !== 'dtm') continue;
      const dtmBox = new THREE.Box3().setFromObject(entry.object3D);
      if (dtmBox.isEmpty()) continue;
      // 2D XY overlap test
      const overlapX = dtmBox.max.x > orthoBox.min.x && dtmBox.min.x < orthoBox.max.x;
      const overlapY = dtmBox.max.y > orthoBox.min.y && dtmBox.min.y < orthoBox.max.y;
      if (overlapX && overlapY) return name;
    }
    return null;
  }

  /**
   * Position a model's object3D based on its geoData coordinates using the
   * global normalizer. If no geoData, the model stays at (0,0,0) which is
   * the cave fixpoint position. For model-only projects (DTM + orthophoto,
   * no caves), the first georeferenced model bootstraps the normalizer
   * so subsequent models land at their true relative offset.
   */
  #positionModelFromGeoData(model, object3D) {
    const coordinate = model.geoData?.coordinates?.[0]?.coordinate;
    if (!coordinate) return;

    if (!globalNormalizer.isInitialized()) {
      globalNormalizer.initializeGlobalOrigin(coordinate);
    }
    if (!globalNormalizer.isInitialized()) return;

    const normalizedPos = globalNormalizer.getNormalizedVector(coordinate);
    object3D.position.set(normalizedPos.x, normalizedPos.y, normalizedPos.z);
  }

  /**
   * Convert WGS84 coordinates to GeoData with UTM coordinate system.
   * If a project coordinate system already exists, converts to that system instead.
   * @param {{latitude: number, longitude: number, elevation: number}} wgs84
   * @returns {GeoData}
   */
  #createGeoDataFromWGS84(wgs84) {
    const { latitude, longitude, elevation } = wgs84;

    // If a project coordinate system already exists (from caves), convert to that system
    const existingCoordSystem = this.db.getAllCaves()
      .find((c) => c.geoData?.coordinateSystem)?.geoData?.coordinateSystem;

    if (existingCoordSystem?.type === CoordinateSystemType.EOV) {
      const { y, x } = WGS84Converter.fromLatLon(latitude, longitude, existingCoordSystem);
      const coordinate = new EOVCoordinateWithElevation(y, x, elevation);
      return new GeoData(existingCoordSystem, [new StationWithCoordinate('origin', coordinate)]);
    }

    // Default: convert to UTM
    const { easting, northing, zoneNum, zoneLetter } = UTMConverter.fromLatLon(latitude, longitude);
    const northern = zoneLetter >= 'N';

    // Use existing UTM system if available (preserves zone), otherwise create new
    const coordinateSystem = (existingCoordSystem?.type === CoordinateSystemType.UTM)
      ? existingCoordSystem
      : new UTMCoordinateSystem(zoneNum, northern);

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
