import { Database } from './db.js';
import { MyScene, SceneOverview } from './scene/scene.js';
import { PlySurfaceImporter, PolygonImporter, TopodroidImporter, JsonImporter } from './io/import.js';
import { SceneInteraction } from './interactive.js';
import { OPTIONS } from './config.js';
import { Materials } from './materials.js';
import { ProjectExplorer, ProjectManager } from './ui/explorer.js';
import { NavigationBar } from './ui/navbar.js';
import { Footer } from './ui/footer.js';
import { addGui } from './ui/controls.js';
import { AttributesDefinitions, attributeDefintions } from './attributes.js';

class Main {

  constructor() {

    if (localStorage.getItem('welcome') === null) {
      document.querySelector('#welcome-panel').style.display = 'block';
    }

    const db = new Database();
    const options = OPTIONS;
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

    const footer = new Footer(document.getElementById('footer'));

    const explorer = new ProjectExplorer(options, db, scene, attributeDefs, document.querySelector('#tree-panel'));
    new ProjectManager(db, options, scene, explorer);
    const controls = addGui(options, scene, materials, document.getElementById('control-panel'));
    controls.close();
    const interaction = new SceneInteraction(
      db,
      options,
      footer,
      scene,
      materials,
      scene.domElement,
      document.getElementById('getdistance'),
      document.getElementById('contextmenu'),
      document.getElementById('infopanel'),
      document.getElementById('interactive')
    );
    new NavigationBar(db, document.getElementById('navbarcontainer'), options, scene, interaction);

    this.scene = scene;
    this.importers = {
      topodroid : new TopodroidImporter(db, options, scene, explorer),
      polygon   : new PolygonImporter(db, options, scene, explorer),
      json      : new JsonImporter(db, options, scene, explorer, attributeDefs),
      ply       : new PlySurfaceImporter(db, options, scene)
    };

    this.#setupEventListeners();
    this.#loadCaveFromUrl();
  }

  #setupEventListeners() {
    this.#setupFileInputListener('topodroidInput', this.importers.topodroid);
    this.#setupFileInputListener('polygonInput', this.importers.polygon);
    this.#setupFileInputListener('jsonInput', this.importers.json);
    this.#setupFileInputListener('plyInput', this.importers.ply);

  }

  #setupFileInputListener(inputName, handler) {
    const input = document.getElementById(inputName);
    input
      .addEventListener('change', (e) => {

        for (const file of e.target.files) {
          handler.importFile(file);
        }

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
          .then((res) => importer.importFile(res))
          .catch((error) => console.error(error));
      }
    } else {
      this.scene.view.renderView();
    }
  }
}

export { Main };
