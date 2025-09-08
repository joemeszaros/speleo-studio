import { Database } from './db.js';
import { MyScene, SceneOverview } from './scene/scene.js';
import { PlySurfaceImporter, PolygonImporter, TopodroidImporter, JsonImporter } from './io/import.js';
import { SceneInteraction } from './interactive.js';
import { ConfigManager, ObjectObserver, ConfigChanges } from './config.js';
import { Materials } from './materials.js';
import { ProjectManager } from './ui/manager.js';
import { NavigationBar } from './ui/navbar.js';
import { Footer } from './ui/footer.js';

import { Sidebar } from './ui/sidebar.js';
import { ExplorerTree } from './ui/explorer-tree.js';
import { SettingsPanel } from './ui/settings-panel.js';

import { AttributesDefinitions, attributeDefintions } from './attributes.js';
import { showErrorPanel } from './ui/popups.js';
import { ProjectSystem } from './storage/project-system.js';
import { CaveSystem } from './storage/cave-system.js';
import { EditorStateSystem } from './storage/editor-states.js';
import { DatabaseManager } from './storage/database-manager.js';
import { DeclinationCache } from './storage/declination-cache.js';
import { ProjectPanel } from './ui/project-panel.js';
import { i18n } from './i18n/i18n.js';
import { SurfaceHelper } from './surface.js';
import { PrintUtils } from './utils/print.js';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';

class Main {

  constructor() {
    const loader = new FontLoader();

    i18n.init().then(() => {
      // Setup welcome panel translations
      this.setupWelcomePanel();

      if (localStorage.getItem('welcome') === null) {
        document.querySelector('#welcome-panel').style.display = 'block';
      }

      const db = new Database();
      this.db = db;
      // Load saved configuration or use defaults
      const loadedOptions = ConfigManager.loadOrDefaults();
      const observer = new ObjectObserver();
      const options = observer.watchObject(loadedOptions);

      const attributeDefs = new AttributesDefinitions(attributeDefintions);

      // Initialize IndexedDB database and project systems
      this.databaseManager = new DatabaseManager();
      this.caveSystem = new CaveSystem(this.databaseManager, attributeDefs);
      this.projectSystem = new ProjectSystem(this.databaseManager, this.caveSystem);
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
    });

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

    this.projectManager = new ProjectManager(
      db,
      options,
      scene,
      interaction,
      this.explorerTree,
      this.projectSystem,
      this.editorStateSystem,
      this.declinationCache
    );

    // Initialize project panel
    this.projectPanel = new ProjectPanel(document.getElementById('project-panel'), this.projectSystem);
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
      this.projectPanel,
      document.getElementById('export-panel')
    );

    this.importers = {
      topodroid : new TopodroidImporter(db, options, scene, this.projectManager),
      polygon   : new PolygonImporter(db, options, scene, this.projectManager),
      json      : new JsonImporter(db, options, scene, this.projectManager, attributeDefs),
      ply       : new PlySurfaceImporter(db, options, scene, this.projectManager)
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
    this.#setupSurveyFileInputListener();
    this.#setupModelFileInputListener();
    ConfigManager.setupConfigFileInputListener(
      this.options,
      this.settingsPanel,
      document.getElementById('configInput')
    );
  }

  #setupFileInputListener(config) {
    const { inputId, handlers, validationMethod } = config;

    const input = document.getElementById(inputId);
    input.addEventListener('change', async (e) => {
      for (const file of e.target.files) {
        try {
          console.log(`🚧 Importing file ${file.name}`);

          // Determine the appropriate importer based on file extension
          let handler;
          const extension = file.name.toLowerCase().split('.').pop();

          handler = handlers.get(extension);

          if (handler === undefined) {
            throw new Error(`Unsupported file type: ${extension}`);
          }

          // Create a promise-based wrapper for the importFile callback
          await new Promise((resolve, reject) => {
            handler.importFile(file, file.name, async (importedData, arg1) => {
              try {
                await validationMethod(importedData, arg1);
                resolve();
              } catch (error) {
                reject(error);
              }
            });
          });
        } catch (error) {
          showErrorPanel(i18n.t('errors.import.unableToImportFile', { name: file.name, error: error.message }));
          console.error(error);
        }
      }

      input.value = '';
    });
  }

  #setupCaveFileInputListener() {
    this.#setupFileInputListener({
      inputId : 'caveInput',

      handlers : new Map([
        ['cave', this.importers.polygon],
        ['json', this.importers.json]
      ]),
      validationMethod : async (data) => await this.#tryAddCave(data)
    });
  }

  #setupSurveyFileInputListener() {
    this.#setupFileInputListener({
      inputId          : 'surveyInput',
      handlers         : new Map([['csv', this.importers.topodroid]]),
      validationMethod : async (data) => await this.#tryAddSurvey(data)
    });
  }

  #setupModelFileInputListener() {
    this.#setupFileInputListener({
      inputId          : 'modelInput',
      handlers         : new Map([['ply', this.importers.ply]]),
      validationMethod : async (surface, cloud) => await this.#tryAddModel(surface, cloud)
    });
  }

  async #tryAddModel(surface, cloud) {

    //FIXME: check if surface already exists and is not too far from previously imported caves / objects
    this.db.addSurface(surface);
    const colorGradients = SurfaceHelper.getColorGradients(surface.points, this.options.scene.surface.color);
    const _3dobjects = this.scene.addSurfaceToScene(cloud, colorGradients);
    this.scene.addSurface(surface, _3dobjects);
    const boundingBox = this.scene.computeBoundingBox();
    this.scene.grid.adjust(boundingBox);
    this.scene.view.fitScreen(boundingBox);
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

  async #tryAddCave(cave) {
    const currentProject = this.projectSystem.getCurrentProject();
    const cavesNamesInProject = await this.projectSystem.getCaveNamesForProject(currentProject.id);

    if (!cavesNamesInProject.includes(cave.name)) {
      const errorMessage = this.projectManager.validateBeforeAdd(cave);
      if (errorMessage) {
        showErrorPanel(errorMessage);
        return;
      }
      await this.projectSystem.addCaveToProject(currentProject, cave);
      this.projectManager.addCave(cave);
    } else {
      throw Error(i18n.t('errors.import.caveAlreadyImported', { name: cave.name }));
    }
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
            showErrorPanel(i18n.t('errors.import.unableToImportFile', { name: caveNameUrl, error: error.message }));
            console.error(error);
          });
      }
    } else {
      this.scene.view.renderView();
    }
  }

  setupWelcomePanel() {
    // Update welcome panel translations
    const welcomeTitle = document.querySelector('.welcome-title');
    const welcomeSubtitle = document.querySelector('.welcome-subtitle');
    const welcomeButton = document.querySelector('.welcome-button');

    if (welcomeTitle) {
      welcomeTitle.textContent = i18n.t('ui.welcome.title');
    }
    if (welcomeSubtitle) {
      welcomeSubtitle.innerHTML = i18n.t('ui.welcome.subtitle');
    }
    if (welcomeButton) {
      welcomeButton.textContent = i18n.t('ui.welcome.button');
    }
  }
}

export { Main };
