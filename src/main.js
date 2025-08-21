import { Database } from './db.js';
import { MyScene, SceneOverview } from './scene/scene.js';
import { PlySurfaceImporter, PolygonImporter, TopodroidImporter, JsonImporter } from './io/import.js';
import { SceneInteraction } from './interactive.js';
import { ConfigManager, ObjectObserver, ConfigChanges } from './config.js';
import { Materials } from './materials.js';
import { ProjectExplorer } from './ui/explorer.js';
import { ProjectManager } from './ui/manager.js';
import { NavigationBar } from './ui/navbar.js';
import { Footer } from './ui/footer.js';

import { Sidebar } from './ui/sidebar.js';
import { ExplorerTree } from './ui/explorer-tree.js';
import { SettingsPanel } from './ui/settings-panel.js';

import { AttributesDefinitions, attributeDefintions } from './attributes.js';
import { showErrorPanel, showSuccessPanel } from './ui/popups.js';
import { ProjectSystem } from './storage/project-system.js';
import { CaveSystem } from './storage/cave-system.js';
import { EditorStateSystem } from './storage/editor-states.js';
import { DatabaseManager } from './storage/database-manager.js';
import { ProjectPanel } from './ui/project-panel.js';
import { i18n } from './i18n/i18n.js';

class Main {

  constructor() {

    i18n.init().then(() => {

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

      // Initialize database and project systems
      this.databaseManager = new DatabaseManager();
      this.caveSystem = new CaveSystem(this.databaseManager, attributeDefs);
      this.projectSystem = new ProjectSystem(this.databaseManager, this.caveSystem);
      this.editorStateSystem = new EditorStateSystem(this.databaseManager);

      // Initialize the application
      this.#initializeApp(db, options, observer, attributeDefs);
    });
  }

  async #initializeApp(db, options, observer, attributeDefs) {
    try {
      await this.databaseManager.init();
    } catch (error) {
      console.error('Failed to initialize database:', error);
      showErrorPanel('Failed to initialize database');
    }

    const materials = new Materials(options).materials;

    const sceneOverview = new SceneOverview(options, document.querySelector('#scene-overview'));
    const scene = new MyScene(
      options,
      db,
      materials,
      document.querySelector('#viewport'),
      document.querySelector('#view-helper'),
      sceneOverview
    );

    observer.watchChanges(new ConfigChanges(options, scene, materials).getOnChangeHandler());

    const footer = new Footer(document.getElementById('footer'));

    this.scene = scene;
    this.options = options;

    // Initialize sidebar
    this.sidebar = new Sidebar(this.options);

    // Initialize explorer tree in sidebar
    this.explorerTree = new ExplorerTree(document.getElementById('explorer-tree'), {
      onNodeClick : (node) => {
        // Handle node click - could open editor or focus on scene
        console.log('Node clicked:', node);
      },
      onVisibilityToggle : (node) => {
        // Handle visibility toggle
        if (node.type === 'cave') {
          scene.toggleCaveVisibility(node.data.name, node.visible);
        } else if (node.type === 'survey') {
          scene.toggleSurveyVisibility(node.data.name, node.visible);
        }
      },
      onNodeSelect : (node) => {
        // Handle node selection (attributes panel removed)
        console.log('Node selected:', node);
      }
    });

    // Initialize settings panel in sidebar
    this.settingsPanel = new SettingsPanel(document.getElementById('settings-content'), options);

    // Add test data after a short delay
    setTimeout(() => {
      this.addTestData();
    }, 1000);

    // Initialize legacy explorer for compatibility (will be removed later)
    this.legacyExplorer = new ProjectExplorer(
      options,
      db,
      scene,
      attributeDefs,
      document.querySelector('#explorer-tree')
    );
    this.projectManager = new ProjectManager(
      db,
      options,
      scene,
      this.legacyExplorer,
      this.projectSystem,
      this.editorStateSystem
    );

    // Initialize project panel
    this.projectPanel = new ProjectPanel(document.getElementById('project-panel'), this.projectSystem);
    this.projectPanel.setupPanel();
    this.projectPanel.show();

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

    // Add test data method
    this.addTestData = () => {
      try {
        // Add a sample cave
        const testCave = {
          name        : 'Test Cave',
          description : 'A sample cave for testing the new sidebar interface',
          visible     : true,
          color       : '#4CAF50'
        };

        this.explorerTree.addCave(testCave);

        // Add a sample survey
        const testSurvey = {
          name    : 'Main Survey',
          date    : '2024-01-15',
          visible : true,
          color   : '#2196F3'
        };

        this.explorerTree.addSurvey('Test Cave', testSurvey);

        console.log('Test data added successfully');
      } catch (error) {
        console.error('Error adding test data:', error);
      }
    };

    new NavigationBar(
      db,
      document.getElementById('navbarcontainer'),
      options,
      scene,
      interaction,
      this.projectManager,
      this.projectSystem,
      this.projectPanel,
      document.getElementById('export-panel'),
      this.controls
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
            showErrorPanel(`Failed to load cave from URL: ${error.message}`);
          }
        }
      }).catch((error) => {
        console.error('Failed to load project or cave from URL:', error);
        showErrorPanel(`Failed to load project or cave from URL: ${error.message}`);
      });

  }

  #setupEventListeners() {
    this.#setupCaveFileInputListener();
    this.#setupSurveyFileInputListener();
    this.#setupConfigFileInputListener();
    this.#setupKeyboardShortcuts();
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
            handler.importFile(file, file.name, async (importedData) => {
              try {
                await validationMethod(importedData);
                resolve();
              } catch (error) {
                reject(error);
              }
            });
          });
        } catch (error) {
          showErrorPanel(`Unable to import file ${file.name}: ${error.message}`);
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

  async #tryAddSurvey(survey) {

    if (survey.name === undefined) {
      showErrorPanel('Survey name is undefined, please set a name in the file');
      return;
    }

    const caveName = document.getElementById('surveyInput').caveName; // custom property
    if (this.db.getSurvey(caveName, survey.name) !== undefined) {
      showErrorPanel(`Survey ${survey.name} already exists in cave ${caveName}`);
      return;
    }

    await this.projectManager.addSurvey(caveName, survey);
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
      throw Error(`Cave ${cave.name} has already been imported`);
    }
  }

  #setupConfigFileInputListener() {
    const input = document.getElementById('configInput');
    input.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const jsonString = event.target.result;
          const loadedConfig = ConfigManager.getConfigObject(jsonString);

          if (loadedConfig) {
            ConfigManager.deepMerge(this.options, loadedConfig);
            this.controls.reload();
            console.log('✅ Configuration loaded successfully from file');
            showSuccessPanel(`Configuration loaded successfully from ${file.name}`);
          } else {
            throw new Error('Invalid configuration file format');
          }
        } catch (error) {
          console.error('Failed to load configuration:', error);
          showErrorPanel(`Failed to load configuration from ${file.name}: ${error.message}`);
        }
      };

      reader.onerror = () => {
        showErrorPanel(`Failed to read file ${file.name}`);
      };

      reader.readAsText(file);
      input.value = '';
    });
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
        throw new Error('Probably the project URL parameter is missing');
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
              throw new Error(`Failed to download file: ${response.statusText} (HTTP ${response.status})`);
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
            showErrorPanel(`Unable to import file ${caveNameUrl}: ${error.message}`);
            console.error(error);
          });
      }
    } else {
      this.scene.view.renderView();
    }
  }

  #setupKeyboardShortcuts() {
    document.addEventListener('keydown', (event) => {
      // F11 for fullscreen
      if (event.key === 'F11') {
        event.preventDefault();
        this.#toggleFullscreen();
      }
    });
  }

  #toggleFullscreen() {
    if (!document.fullscreenElement) {
      // Enter fullscreen
      if (document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen();
      } else if (document.documentElement.webkitRequestFullscreen) {
        document.documentElement.webkitRequestFullscreen();
      } else if (document.documentElement.msRequestFullscreen) {
        document.documentElement.msRequestFullscreen();
      }
    } else {
      // Exit fullscreen
      if (document.exitFullscreen) {
        document.exitFullscreen();
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      } else if (document.msExitFullscreen) {
        document.msExitFullscreen();
      }
    }
  }
}

export { Main };
