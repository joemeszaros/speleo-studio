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

    const materials = new Materials(options).materials;
    const attributeDefs = new AttributesDefinitions(attributeDefintions);
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
    const projectManager = new ProjectManager(db, options, scene, explorer);

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
      document.getElementById('interactive'),
      ['fixed-size-editor', 'resizable-editor']
    );
    new NavigationBar(
      db,
      document.getElementById('navbarcontainer'),
      options,
      scene,
      interaction,
      projectManager,
      this.controls
    );

    this.importers = {
      topodroid : new TopodroidImporter(db, options, scene, projectManager),
      polygon   : new PolygonImporter(db, options, scene, projectManager),
      json      : new JsonImporter(db, options, scene, projectManager, attributeDefs),
      ply       : new PlySurfaceImporter(db, options, scene, projectManager)
    };

    this.#setupEventListeners();
    this.#loadCaveFromUrl();

  }

  #setupEventListeners() {
    this.#setupFileInputListener('topodroidInput', this.importers.topodroid);
    this.#setupFileInputListener('polygonInput', this.importers.polygon);
    this.#setupFileInputListener('jsonInput', this.importers.json);
    this.#setupFileInputListener('plyInput', this.importers.ply);
    this.#setupConfigFileInputListener();
  }

  #setupFileInputListener(inputName, handler) {
    const input = document.getElementById(inputName);
    input
      .addEventListener('change', (e) => {

        for (const file of e.target.files) {
          try {
            handler.importFile(file);
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

  #loadCaveFromUrl() {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('cave')) {
      const caveNameUrl = urlParams.get('cave');
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
          .then((data) => data.blob())
          .then((res) => importer.importFile(res, caveNameUrl))
          .catch((error) => {
            showErrorPanel(`Unable to import file ${caveNameUrl}: ${error.message}`);
            console.error(error);
          });
      }
    } else {
      this.scene.view.renderView();
    }
  }
}

export { Main };
