import { Database } from './db.js';
import { MyScene, SceneOverview } from './scene/scene.js';
import { PlySurfaceImporter, PolygonImporter, TopodroidImporter, JsonImporter } from './io/import.js';
import { SceneInteraction } from './interactive.js';
import { ConfigManager, ObjectObserver, ConfigChanges } from './config.js';
import { Materials } from './materials.js';
import { ProjectExplorer, ProjectManager } from './ui/explorer.js';
import { NavigationBar } from './ui/navbar.js';
import { Footer } from './ui/footer.js';
import { Controls } from './ui/controls.js';
import { AttributesDefinitions, attributeDefintions } from './attributes.js';
import { showErrorPanel, showSuccessPanel } from './ui/popups.js';
import { ProjectSystem } from './storage/project-system.js';
import { CaveSystem } from './storage/cave-system.js';
import { EditorStateSystem } from './storage/editor-states.js';
import { DatabaseManager } from './storage/database-manager.js';
import { ProjectPanel } from './ui/project-panel.js';

class Main {

  constructor() {

    if (localStorage.getItem('welcome') === null) {
      document.querySelector('#welcome-panel').style.display = 'block';
    }

    const db = new Database();
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
  }

  async #initializeApp(db, options, observer, attributeDefs) {
    try {
      await this.databaseManager.init();
    } catch (error) {
      console.error('Failed to initialize database:', error);
      showErrorPanel('Failed to initialize database');
    }

    const materials = new Materials(options).materials;

    const sceneOverview = new SceneOverview(document.querySelector('#overview'));
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

    const explorer = new ProjectExplorer(options, db, scene, attributeDefs, document.querySelector('#tree-panel'));
    this.projectManager = new ProjectManager(db, options, scene, explorer, this.projectSystem, this.editorStateSystem);

    // Initialize project panel
    this.projectPanel = new ProjectPanel(this.projectSystem);
    document.body.appendChild(this.projectPanel.createPanel());
    this.projectPanel.show();

    this.controls = new Controls(options, document.getElementById('control-panel'));
    this.controls.close();

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
      .then((project) => {
        if (project) {
          this.projectPanel.hide();
          this.#loadCaveFromUrl(urlParams, project);
        }
      }).catch((error) => {
        console.error('Failed to load project or cave from URL:', error);
        showErrorPanel(`Failed to load project or cave from URL: ${error.message}`);
      });

  }

  #setupEventListeners() {
    this.#setupUnifiedFileInputListener();
    this.#setupConfigFileInputListener();
    this.#setupKeyboardShortcuts();
  }

  #setupUnifiedFileInputListener() {
    const input = document.getElementById('caveInput');
    input.addEventListener('change', (e) => {
      for (const file of e.target.files) {
        try {
          console.log('🚧 Importing unified file', file.name);

          // Determine the appropriate importer based on file extension
          let handler;
          const extension = file.name.toLowerCase().split('.').pop();

          switch (extension) {
            case 'csv':
              handler = this.importers.topodroid;
              break;
            case 'cave':
              handler = this.importers.polygon;
              break;
            case 'json':
              handler = this.importers.json;
              break;
            default:
              throw new Error(`Unsupported file type: ${extension}`);
          }

          handler.importFile(file, file.name, async (cave) => {
            const currentProject = this.projectSystem.getCurrentProject();
            const cavesNamesInProject = await this.projectSystem.getCaveNamesForProject(currentProject.id);

            if (!cavesNamesInProject.includes(cave.name)) {
              await this.projectSystem.addCaveToProject(currentProject, cave);
              this.projectManager.addCave(cave);
            } else {
              throw Error(`Cave ${cave.name} has already been imported`);
            }
          });
        } catch (error) {
          showErrorPanel(`Unable to import file ${file.name}: ${error.message}`);
          console.error(error);
        }
      }

      input.value = '';
    });
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

      const cavesNamesInProject = await this.projectSystem.getCaveNamesForProject(project.id);

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
            importer.importFile(res, caveNameUrl, async (cave) => {
              if (cavesNamesInProject.includes(cave.name)) {
                showErrorPanel(`'${cave.name}' has already been imported to this project!`);
              } else {
                await this.projectSystem.addCaveToProject(project, cave);
                this.projectManager.addCave(cave);
              }
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
