import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';

import { SurveyHelper } from '../survey.js';
import { Grid } from './grid.js';
import * as U from '../utils/utils.js';
import { ShotType } from '../model/survey.js';

import { SpatialView, PlanView, ProfileView } from './views.js';
import { TextSprite } from './textsprite.js';

class SceneOverview {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: false });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(container.offsetWidth, container.offsetHeight);
    this.domElement = this.renderer.domElement; // auto generate canvas
    container.appendChild(this.domElement);
    this.width = container.offsetWidth;
    this.height = container.offsetHeight;
  }

}

class MyScene {

  /**
   * A class that creates the 3D scene that makes user interactions and scene modifications (camera position, add/remove 3D objects) possible
   *
   * @param {Map<String, Map>} options - The project options
   * @param {Database} db - The database of the application, containing caves and other infomations
   * @param {*} - Collection of line and geometry materials
   */
  constructor(options, db, materials, container, viewHelperContainer, overview) {
    this.options = options;
    this.db = db;
    this.materials = materials;
    this.caveObjects = new Map(); // for centerlines, splays ... for a cave
    this.surfaceObjects = new Map();
    this.sectionAttributes = new Map();
    this.stationAttributes = new Map();
    this.segments = new Map(); // for shortest path segments
    this.caveObject3DGroup = new THREE.Group();
    this.caveObject3DGroup.name = 'cave object';
    this.sprites3DGroup = new THREE.Group();
    this.sprites3DGroup.name = 'sprites';
    this.surfaceObject3DGroup = new THREE.Group();
    this.surfaceObject3DGroup.name = 'surface objects';
    this.sectionAttributes3DGroup = new THREE.Group();
    this.sectionAttributes3DGroup.name = 'section attributes';
    this.stationAttributes3DGroup = new THREE.Group();
    this.stationAttributes3DGroup.name = 'station attributes';
    this.segments3DGroup = new THREE.Group();
    this.segments3DGroup.name = 'segments';
    this.spheres3DGroup = new THREE.Group();
    this.spheres3DGroup.name = 'spheres';
    this.startPoints3DGroup = new THREE.Group();
    this.startPoints3DGroup.name = 'starting points';
    this.startPointObjects = new Map(); // Map to store starting point objects for each cave
    this.stationFont = undefined;

    // Camera tracking for optimized billboarding
    this.lastCameraPosition = new THREE.Vector3();
    this.lastCameraQuaternion = new THREE.Quaternion();
    this.framesSinceLastBillboardUpdate = 0;
    this.billboardUpdateThreshold = 2; // Update every 2 frames when camera moves
    this.cameraMovementThreshold = 0.1; // Minimum camera movement to trigger update

    const loader = new FontLoader();
    loader.load('fonts/helvetiker_regular.typeface.json', (font) => this.setFont(font));

    this.container = container;
    this.sceneRenderer = new THREE.WebGLRenderer({ antialias: true });
    this.sceneRenderer.name = 'sceneRenderer';
    this.sceneRenderer.setPixelRatio(window.devicePixelRatio);
    this.sceneRenderer.setSize(container.offsetWidth, container.offsetHeight);
    this.sceneRenderer.autoClear = false; // To allow render overlay on top of normal scene
    this.sceneRenderer.setAnimationLoop(() => this.animate());
    this.clock = new THREE.Clock(); // only used for animations
    this.domElement = this.sceneRenderer.domElement; // auto generate canvas
    container.appendChild(this.domElement);
    this.width = container.offsetWidth;
    this.height = container.offsetHeight;

    this.overview = overview;

    this.spriteScene = new THREE.Scene();
    this.spriteScene.name = 'sprite scene';
    this.spriteScene.add(this.sprites3DGroup);

    this.threejsScene = new THREE.Scene();
    this.threejsScene.name = 'main scene';
    this.threejsScene.background = new THREE.Color(this.options.scene.background.color);

    this.views = new Map([
      ['plan', new PlanView(this, this.domElement)],
      ['profile', new ProfileView(this, this.domElement)],
      ['spatial', new SpatialView(this, this.domElement, viewHelperContainer)]
    ]);

    this.grid = new Grid(this.options, this);

    this.threejsScene.add(this.caveObject3DGroup);
    this.threejsScene.add(this.surfaceObject3DGroup);
    this.threejsScene.add(this.sectionAttributes3DGroup);
    this.threejsScene.add(this.stationAttributes3DGroup);
    this.threejsScene.add(this.segments3DGroup);
    this.threejsScene.add(this.spheres3DGroup);
    this.threejsScene.add(this.startPoints3DGroup);

    this.boundingBox = undefined;

    this.raycaster = new THREE.Raycaster();
    this.raycaster.params.Mesh.threshold = 10;
    this.pointer = new THREE.Vector2();

    const sphereGeo = new THREE.SphereGeometry(this.options.scene.centerLines.spheres.radius, 10, 10);
    this.surfaceSphere = this.addSphere(
      'surface',
      new THREE.Vector3(0, 0, 0),
      this.surfaceObject3DGroup,
      sphereGeo,
      this.materials.sphere.surface,
      {
        type : 'surface'
      }
    );

    const map = new THREE.TextureLoader().load('icons/focus.svg');
    map.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.SpriteMaterial({ map: map });

    const focusSprite = new THREE.Sprite(material);
    focusSprite.name = 'focus sprite';
    this.focusSprite = focusSprite;
    this.threejsScene.add(focusSprite);

    const geometry = new THREE.TorusGeometry(1.3, 0.2, 16, 100);
    this.focusSphere = this.addSphere(
      'selected station sphere',
      new THREE.Vector3(0, 0, 0),
      this.spheres3DGroup,
      sphereGeo,
      this.materials.sphere.selectedStation,
      {
        type : 'selected station'
      }
    );
    this.focusSphere.visible = false;
    this.distanceSphere = this.addSphere(
      'distance sphere',
      new THREE.Vector3(0, 0, 0),
      this.spheres3DGroup,
      geometry,
      this.materials.sphere.distanceMeasurement,
      {
        type : 'distance station'
      }
    );
    this.distanceSphere.visible = false;

    this.view = this.views.get('spatial');
    this.view.activate(this.computeBoundingBox());

    // Initialize camera tracking for billboard optimization
    this.#initializeCameraTracking();

    window.addEventListener('resize', () => this.onWindowResize());
    document.addEventListener('viewport-resized', () => this.onViewportResized());
  }

  setFont(font) {
    this.stationFont = font;
  }

  setBackground(val) {
    this.threejsScene.background = new THREE.Color(val);
    this.view.renderView();
  }

  setSurveyVisibility(cave, survey, value) {
    const entry = this.caveObjects.get(cave).get(survey);
    const s = this.options.scene;
    entry.centerLines.visible = value && s.centerLines.segments.show;
    entry.centerLines.hidden = !value; // hidden is a custom attribute set by me, used in setObjectsVisibility
    entry.splays.visible = value && s.splays.segments.show;
    entry.splays.hidden = !value;
    entry.centerLinesSpheres.visible = value && s.centerLines.spheres.show;
    entry.centerLinesSpheres.hidden = !value;
    entry.splaysSpheres.visible = value && s.splays.spheres.show;
    entry.splaysSpheres.hidden = !value;
    this.view.renderView();
  }

  setObjectsVisibility(fieldName, val) {
    const entries = this.#getCaveObjectsFlattened();
    entries.forEach((e) => {
      e[fieldName].visible = !e.centerLines.hidden && val;
    });
    this.view.renderView();
  }

  setObjectsOpacity(fieldName, val) {
    const entries = this.#getCaveObjectsFlattened();
    entries.forEach((e) => {
      e[fieldName].material.transparent = true;
      e[fieldName].material.opacity = val;
    });
    this.view.renderView();
  }

  changeStationSpheresRadius(type) {
    let spheres, radius;
    if (type === ShotType.CENTER) {
      spheres = this.getAllCenterLineStationSpheres();
      radius = this.options.scene.centerLines.spheres.radius;
    } else if (type === ShotType.SPLAY) {
      spheres = this.getAllSplaysStationSpheres();
      radius = this.options.scene.splays.spheres.radius;
    } else if (type === ShotType.AUXILIARY) {
      spheres = this.getAllAuxiliaryStationSpheres();
      radius = this.options.scene.auxiliaries.spheres.radius;
    }
    const geometry = new THREE.SphereGeometry(radius, 5, 5);
    spheres.forEach((s) => {
      s.geometry.dispose();
      s.geometry = geometry;
    });
    this.view.renderView();
  }

  deleteSurvey(caveName, surveyName) {
    if (this.caveObjects.has(caveName) && this.caveObjects.get(caveName).has(surveyName)) {
      this.caveObjects.get(caveName).delete(surveyName);
    }
  }

  addSurvey(caveName, surveyName, entry) {
    if (!this.caveObjects.has(caveName)) {
      this.caveObjects.set(caveName, new Map());
    }
    if (this.caveObjects.get(caveName).has(surveyName)) {
      throw new Error(`Survey ${caveName} / ${surveyName} objects have already been added to the scene!`);
    }
    this.caveObjects.get(caveName).set(surveyName, entry);

  }

  getAllCenterLineStationSpheres() {
    const entries = Array.from(this.#getCaveObjectsFlattened());
    return entries.flatMap((e) => e.centerLinesSpheres.children);
  }

  getAllSplaysStationSpheres() {
    const entries = Array.from(this.#getCaveObjectsFlattened());
    return entries.flatMap((e) => e.splaysSpheres.children);
  }

  getAllAuxiliaryStationSpheres() {
    const entries = Array.from(this.#getCaveObjectsFlattened());
    return entries.flatMap((e) => e.auxiliarySpheres.children);
  }

  getBoundingClientRect() {
    return this.domElement.getBoundingClientRect();
  }

  getAllSurfacePoints() {
    return [...this.surfaceObjects.values()].map((s) => s.cloud);
  }

  getStationSphere(stationName, caveName) {
    const clSpheres = this.getAllCenterLineStationSpheres();
    const splaySpheres = this.getAllSplaysStationSpheres();
    const auxiliarySpheres = this.getAllAuxiliaryStationSpheres();
    return clSpheres
      .concat(splaySpheres)
      .concat(auxiliarySpheres)
      .find((s) => s.name === stationName && s.meta.cave.name === caveName);
  }

  // this function is required because threejs canvas is 48 px from top
  getMousePosition(mouseCoordinates) {
    const { x, y } = mouseCoordinates;
    const rect = this.container.getBoundingClientRect();
    return new THREE.Vector2((x - rect.left) / rect.width, (y - rect.top) / rect.height);
  }

  setPointer(mousePosition) {
    this.pointer.x = mousePosition.x * 2 - 1;
    this.pointer.y = -mousePosition.y * 2 + 1;
  }

  getFirstIntersectedSprite(mouseCoordinates) {
    if (this.view.spriteCamera === undefined) return;
    this.setPointer(this.getMousePosition(mouseCoordinates));
    const sprites = this.sprites3DGroup.children.filter((s) => s.visible);
    this.raycaster.setFromCamera(this.pointer, this.view.spriteCamera);
    const intersectedSprites = this.raycaster.intersectObjects(sprites);
    if (intersectedSprites.length) {
      return intersectedSprites[0].object;
    } else {
      return undefined;
    }

  }

  getIntersectedStationSphere(mouseCoordinates, radius) {
    this.setPointer(this.getMousePosition(mouseCoordinates));
    const clSpheres = this.getAllCenterLineStationSpheres();
    const splaySpheres = this.getAllSplaysStationSpheres();
    const auxiliarySpheres = this.getAllAuxiliaryStationSpheres();
    const stationSpheres = clSpheres.concat(splaySpheres).concat(auxiliarySpheres);

    const camera = this.view.camera;
    const origin = new THREE.Vector3(
      this.pointer.x,
      this.pointer.y,
      (camera.near + camera.far) / (camera.near - camera.far)
    ).unproject(camera);
    const direction = new THREE.Vector3(0, 0, -1).transformDirection(camera.matrixWorld);
    const spheres = stationSpheres.map((s) => {
      const sphere = new THREE.Sphere(s.position, radius);
      sphere.station = s; // custom property
      sphere.distance = origin.distanceTo(s.position); // custom property
      return sphere;
    });

    const ray = new THREE.Ray(origin, direction);
    const intersectedSpheres = spheres.filter((s) => ray.intersectSphere(s, new THREE.Vector3()));
    if (intersectedSpheres.length) {
      intersectedSpheres.sort((a, b) => a.distance - b.distance); // get the closest sphere
      return intersectedSpheres[0].station;
    } else {
      return undefined;
    }
  }

  getIntersectedSurfacePoint(mouseCoordinates, purpose) {
    this.setPointer(this.getMousePosition(mouseCoordinates));
    const clouds = this.getAllSurfacePoints();
    this.raycaster.setFromCamera(this.pointer, this.view.camera);
    this.raycaster.params.Points.threshold = 0.1;
    const intersectedPoints = this.raycaster.intersectObjects(clouds);
    if (intersectedPoints.length) {
      if (purpose === 'selected') {
        this.surfaceSphere.position.copy(intersectedPoints[0].point);
        this.surfaceSphere.visible = true;
        return this.surfaceSphere;
      }
    } else {
      return undefined;
    }
  }

  onViewportResized() {
    this.onResize(this.container.offsetWidth, this.container.offsetHeight);
  }

  onWindowResize() {
    this.onResize(this.container.offsetWidth, this.container.offsetHeight);
  }

  onResize(newWidth, newHeigth) {
    this.width = newWidth;
    this.height = newHeigth;
    this.sceneRenderer.setSize(this.width, this.height);
    this.views.forEach((view) => view.onResize(this.width, this.height));
    this.view.renderView();
  }

  computeBoundingBox() {
    if (this.caveObjects.size > 0 || this.surfaceObjects.size > 0) {
      const bb = new THREE.Box3();
      // eslint-disable-next-line no-unused-vars
      this.caveObjects.forEach((sMap, _caveName) => {
        // eslint-disable-next-line no-unused-vars
        sMap.forEach((e, _surveyName) => {
          if (e.centerLines.visible) {
            bb.expandByObject(e.centerLines);
          }
          if (e.splays.visible) {
            bb.expandByObject(e.splays);
          }
        });
      });
      // eslint-disable-next-line no-unused-vars
      this.surfaceObjects.forEach((entry, surfaceName) => {
        if (entry.cloud.visible) {
          bb.expandByObject(entry.cloud);
        }
      });
      return bb;
    } else {
      return undefined;
    }
  }

  toogleBoundingBox() {
    this.options.scene.boundingBox.show = !this.options.scene.boundingBox.show;

    if (this.options.scene.boundingBox.show === true) {
      const bb = this.computeBoundingBox();
      if (bb !== undefined) {
        const boundingBoxHelper = new THREE.Box3Helper(bb, 0xffffff);
        this.boundingBoxHelper = boundingBoxHelper;
        this.boundingBoxHelper.layers.set(1);
        this.threejsScene.add(boundingBoxHelper);
      }
    } else {
      if (this.boundingBoxHelper !== undefined) {
        this.threejsScene.remove(this.boundingBoxHelper);
        this.boundingBoxHelper.dispose();
        this.boundingBoxHelper = undefined;
      }
    }
    this.view.renderView();

  }

  showSegments(id, name, segments, color, caveName) {
    if (!this.segments.has(id)) {
      const geometry = new LineSegmentsGeometry();
      geometry.setPositions(segments);
      geometry.computeBoundingBox();
      const material = new LineMaterial({
        color        : new THREE.Color(color),
        linewidth    : this.options.scene.centerLines.segments.width * this.options.scene.sectionLineMultiplier,
        worldUnits   : false,
        vertexColors : false
      });
      const lineSegments = new LineSegments2(geometry, material);
      lineSegments.name = name;
      lineSegments.layers.set(1);
      this.segments3DGroup.add(lineSegments);
      this.segments.set(id, {
        segments : lineSegments,
        caveName : caveName
      });
      this.view.renderView();
    }
  }

  disposeSegments(id) {
    if (this.segments.has(id)) {
      const e = this.segments.get(id);
      const lineSegments = e.segments;
      lineSegments.geometry.dispose();
      lineSegments.material.dispose();
      this.segments3DGroup.remove(lineSegments);
      this.segments.delete(id);
      this.view.renderView();
    }
  }

  showSectionAttribute(id, segments, attribute, format = '${name}', color, caveName) {
    if (!this.sectionAttributes.has(id)) {
      const geometry = new LineSegmentsGeometry();
      geometry.setPositions(segments);
      geometry.computeBoundingBox();

      // Create tube geometry for the attribute path
      const tubeGroup = this.createTubeGeometryFromSegments(segments);

      // Apply material to all tube segments in the group
      tubeGroup.children.forEach((tubeMesh) => {
        tubeMesh.material = new THREE.MeshBasicMaterial({
          color       : new THREE.Color(color),
          transparent : false,
          opacity     : 1.0
        });
      });

      tubeGroup.layers.set(1);
      this.sectionAttributes3DGroup.add(tubeGroup);

      const bb = geometry.boundingBox;
      const center = bb.getCenter(new THREE.Vector3());
      const maxZ = bb.min.z > bb.max.z ? bb.min.z : bb.max.z;
      center.z = maxZ;
      //center.setComponent(2, maxZ + 10);
      const formattedAttribute = U.interpolate(format, attribute);
      const textMesh = this.addLabel(formattedAttribute, center, this.options.scene.labels.size);
      this.sectionAttributes3DGroup.add(textMesh);
      textMesh.layers.set(1);

      this.sectionAttributes.set(id, {
        tube     : tubeGroup,
        text     : textMesh,
        label    : formattedAttribute,
        center   : center,
        caveName : caveName
      });
      this.view.renderView();
    }
  }

  disposeSectionAttribute(id) {
    if (this.sectionAttributes.has(id)) {
      const e = this.sectionAttributes.get(id);

      const tubeGroup = e.tube;

      // Dispose tube mesh if it exists
      if (tubeGroup) {
        tubeGroup.children.forEach((tubeMesh) => {
          tubeMesh.geometry.dispose();
          tubeMesh.material.dispose();
        });
        this.sectionAttributes3DGroup.remove(tubeGroup);
      }

      const textMesh = e.text;
      this.sectionAttributes3DGroup.remove(textMesh);
      textMesh.geometry.dispose();
      this.sectionAttributes.delete(id);
      this.view.renderView();
    }
  }

  showPlaneFor(id, station, attribute) {
    if (!this.stationAttributes.has(id)) {
      const position = station.position;
      const geometry = new THREE.PlaneGeometry(attribute.width, attribute.height, 10, 10);
      const plane = new THREE.Mesh(geometry, this.materials.planes.get(attribute.name));
      plane.name = `plane-${attribute.name}-${id}`;
      plane.position.set(0, 0, 0);
      const dir = U.normal(U.degreesToRads(attribute.azimuth), U.degreesToRads(attribute.dip));
      plane.lookAt(dir.x, dir.y, dir.z);
      const v = new THREE.Vector3(position.x, position.y, position.z);
      plane.position.copy(v);

      this.stationAttributes3DGroup.add(plane);

      this.stationAttributes.set(id, {
        plane     : plane,
        station   : station,
        attribute : attribute
      });
      this.view.renderView();
    }
  }

  disposePlaneFor(id) {
    if (this.stationAttributes.has(id)) {
      const e = this.stationAttributes.get(id);
      const plane = e.plane;
      plane.geometry.dispose();
      this.stationAttributes3DGroup.remove(plane);
      this.stationAttributes.delete(id);
      this.view.renderView();
    }
  }

  showIconFor(id, station, attribute) {
    if (!this.stationAttributes.has(id)) {
      const position = station.position;

      // Create a sprite with the SVG icon
      const iconPath = `icons/${attribute.name}.svg`;
      const textureLoader = new THREE.TextureLoader();

      textureLoader.load(
        iconPath,
        (texture) => {
          texture.colorSpace = THREE.SRGBColorSpace;
          const spriteMaterial = new THREE.SpriteMaterial({
            map         : texture,
            transparent : false,
            opacity     : 1.0
          });

          const sprite = new THREE.Sprite(spriteMaterial);
          sprite.name = `icon-${attribute.name}-${id}`;
          sprite.position.set(position.x, position.y, position.z);
          sprite.scale.set(
            this.options.scene.stationAttributes.iconScale,
            this.options.scene.stationAttributes.iconScale,
            this.options.scene.stationAttributes.iconScale
          );

          this.stationAttributes3DGroup.add(sprite);

          this.stationAttributes.set(id, {
            sprite    : sprite,
            station   : station,
            attribute : attribute
          });

          this.view.renderView();
        },
        undefined,
        (error) => {
          console.warn(`Failed to load icon for ${attribute.name}:`, error);
        }
      );
    }
  }

  disposeIconFor(id) {
    if (this.stationAttributes.has(id)) {
      const e = this.stationAttributes.get(id);
      const sprite = e.sprite;

      if (sprite.material && sprite.material.map) {
        sprite.material.map.dispose();
      }
      sprite.material.dispose();
      sprite.geometry?.dispose();

      this.stationAttributes3DGroup.remove(sprite);
      this.stationAttributes.delete(id);
      this.view.renderView();
    }
  }

  updateStationAttributeIconScales(newScale) {
    // Update the scale of all existing station attribute icons
    this.stationAttributes.forEach((entry) => {
      if (entry.sprite && entry.sprite.type === 'Sprite') {
        entry.sprite.scale.set(newScale, newScale, newScale);
      }
    });
    this.view.renderView();
  }

  changeCenterLineColorMode(mode) {
    const clConfig = this.options.scene.centerLines;
    const splayConfig = this.options.scene.splays;
    const auxiliaryConfig = this.options.scene.auxiliaries;

    switch (mode) {
      case 'gradientByZ':
      case 'gradientByDistance': {
        const colors = SurveyHelper.getColorGradientsForCaves(this.db.caves, this.options.scene.caveLines);
        this.caveObjects.forEach((surveyEntrires, caveName) => {
          surveyEntrires.forEach((e, surveyName) => {
            e['centerLines'].material = this.materials.whiteLine;
            e['splays'].material = this.materials.whiteLine;
            e['auxiliaries'].material = this.materials.whiteLine;
            const surveyColors = colors.get(caveName).get(surveyName);
            e['centerLines'].geometry.setColors(surveyColors.center);
            e['splays'].geometry.setColors(surveyColors.splays);
            e['auxiliaries'].geometry.setColors(surveyColors.auxiliary);
          });
        });
        break;
      }
      case 'global':
      case 'percave':
      case 'persurvey': {

        this.caveObjects.forEach((surveyEntrires, caveName) => {

          let newClMaterial, newSplayMaterial, newAuxiliaryMaterial;
          if (mode === 'percave' && this.db.getCave(caveName).color !== undefined) {
            const color = this.db.getCave(caveName).color;
            newClMaterial = new LineMaterial({
              color        : color,
              linewidth    : clConfig.segments.width,
              vertexColors : false,
              transparent  : true,
              opacity      : clConfig.segments.opacity
            });
            newSplayMaterial = new LineMaterial({
              color       : color,
              linewidth   : splayConfig.segments.width,
              transparent : true,
              opacity     : clConfig.segments.opacity
            });
            newAuxiliaryMaterial = new LineMaterial({
              color       : color,
              linewidth   : auxiliaryConfig.segments.width,
              transparent : true,
              opacity     : clConfig.segments.opacity
            });
          }

          surveyEntrires.forEach((e, surveyName) => {

            e['centerLines'].geometry.setColors([]);
            e['splays'].geometry.setColors([]);
            e['auxiliaries'].geometry.setColors([]);

            if (mode === 'global' || (mode === 'percave' && newClMaterial === undefined)) {
              e['centerLines'].material = this.materials.segments.centerLine;
              e['splays'].material = this.materials.segments.splay;
              e['auxiliaries'].material = this.materials.segments.auxiliary;
            } else if (mode === 'percave' && newClMaterial !== undefined) {
              e['centerLines'].material = newClMaterial;
              e['splays'].material = newSplayMaterial;
              e['auxiliaries'].material = newAuxiliaryMaterial;
            } else if (mode === 'persurvey') {
              const survey = this.db.getSurvey(caveName, surveyName);
              if (survey.color === undefined) {
                e['centerLines'].material = this.materials.segments.fallback;
                e['splays'].material = this.materials.segments.fallback;
                e['auxiliaries'].material = this.materials.segments.fallback;

              } else {

                e['centerLines'].material = new LineMaterial({
                  color       : survey.color,
                  linewidth   : clConfig.segments.width,
                  transparent : true,
                  opacity     : clConfig.segments.opacity
                });
                e['splays'].material = new LineMaterial({
                  color       : survey.color,
                  linewidth   : splayConfig.segments.width,
                  transparent : true,
                  opacity     : clConfig.segments.opacity
                });
                e['auxiliaries'].material = new LineMaterial({
                  color       : survey.color,
                  linewidth   : auxiliaryConfig.segments.width,
                  transparent : true,
                  opacity     : clConfig.segments.opacity
                });
              }
            }

          });
        });
        break;
      }
      default:
        throw new Error(`unknown configuration for cave line colors: ${mode}`);
    }
    this.view.renderView();

  }

  rollSurface() {
    const config = this.options.scene.surface.color.mode;
    Options.rotateOptionChoice(config);

    switch (config.value) {
      case 'gradientByZ':
        // don't need to recalculate color gradients because surface is not editable
        this.surfaceObjects.forEach((entry) => {
          entry.cloud.visible = true;
        });
        break;
      case 'hidden':
        this.surfaceObjects.forEach((entry) => {
          entry.cloud.visible = false;
        });
        break;
      default:
        throw new Error(`unknown configuration for surface colors: ${config.value}`);
    }
    this.view.renderView();

  }

  changeView(viewName) {
    if (this.view !== this.views.get(viewName)) {
      this.view.deactivate();
      this.view = this.views.get(viewName);
      this.view.activate(this.computeBoundingBox());
      // Reinitialize camera tracking for billboard optimization
      this.#initializeCameraTracking();
    }
  }

  updateSegmentsWidth(width) {
    this.sectionAttributes.forEach((e) => {
      e.segments.material.linewidth = width * this.options.scene.sectionLineMultiplier;
    });
    this.view.renderView();
  }

  updateCenterLinesOpacity(width) {
    this.sectionAttributes.forEach((e) => {
      e.segments.material.linewidth = width * this.options.scene.sectionLineMultiplier;
      // Also update glow line width to maintain the glow effect
      if (e.glow) {
        e.glow.material.linewidth = width * this.options.scene.sectionLineMultiplier * 3;
      }
    });
    this.view.renderView();
  }

  updateLabelSize(size) {
    this.sectionAttributes.forEach((e) => {
      this.sectionAttributes3DGroup.remove(e.text);
      e.text.geometry.dispose();
      const newText = this.addLabel(e.label, e.center, size);
      newText.layers.set(1);
      this.sectionAttributes3DGroup.add(newText);
      e.text = newText;
    });
    this.view.renderView();
  }

  animate() {
    const delta = this.clock.getDelta();
    this.view.animate(delta);
  }

  renderScene(camera, overViewCamera, spriteCamera, helper) {
    this.sectionAttributes.forEach((e) => {
      const pos = e.center.clone();
      pos.z = pos.z + 100;
      e.text.lookAt(pos);
    });

    if (this.options.scene.stationLabels.show) {
      this.#updateStationLabelsBillboarding();
    }

    if (spriteCamera === undefined) {
      this.sceneRenderer.render(this.threejsScene, camera);
    } else {
      this.sceneRenderer.clear();
      this.sceneRenderer.render(this.threejsScene, camera);
      this.sceneRenderer.clearDepth();
      this.sceneRenderer.render(this.spriteScene, spriteCamera);
    }

    if (helper !== undefined) {
      helper.render(this.sceneRenderer);
    }

    if (overViewCamera !== undefined) {
      this.overview.renderer.render(this.threejsScene, overViewCamera);
    }

  }

  #getCaveObjectsFlattened() {
    return [...this.caveObjects.values()].flatMap((c) => Array.from(c.values()));
  }

  #initializeCameraTracking() {
    if (this.view && this.view.camera) {
      this.lastCameraPosition.copy(this.view.camera.position);
      this.lastCameraQuaternion.copy(this.view.camera.quaternion);
    }
  }

  #hasCameraMoved() {
    const currentPosition = this.view.camera.position;
    const currentQuaternion = this.view.camera.quaternion;

    const positionDelta = currentPosition.distanceTo(this.lastCameraPosition);
    const rotationDelta = currentQuaternion.angleTo(this.lastCameraQuaternion);
    return positionDelta > this.cameraMovementThreshold || rotationDelta > this.cameraMovementThreshold;
  }

  /**
   * Optimized station labels billboarding update
   */
  #updateStationLabelsBillboarding() {
    this.framesSinceLastBillboardUpdate++;

    //Only check camera movement every few frames for performance
    if (this.framesSinceLastBillboardUpdate < this.billboardUpdateThreshold) {
      return;
    }

    // Check if camera has moved significantly
    if (!this.#hasCameraMoved()) {
      this.framesSinceLastBillboardUpdate = 0;
      return;
    }

    const entries = this.#getCaveObjectsFlattened();
    entries.forEach((e) => {
      e.stationLabels.children.forEach((label) => {
        if (label.userData && label.userData.textSprite) {
          label.lookAt(this.view.camera.position);
        }
      });
    });

    this.lastCameraPosition.copy(this.view.camera.position);
    this.lastCameraQuaternion.copy(this.view.camera.quaternion);
    this.framesSinceLastBillboardUpdate = 0;
  }

  addObjectToScene(object) {
    this.threejsScene.add(object);
  }

  removeFromScene(object) {
    this.threejsScene.remove(object);
  }

  addLabel(label, position, size) {
    const textShape = this.stationFont.generateShapes(label, size);
    const textGeometry = new THREE.ShapeGeometry(textShape);
    textGeometry.computeBoundingBox();

    const xMid = -0.5 * (textGeometry.boundingBox.max.x - textGeometry.boundingBox.min.x);
    textGeometry.translate(xMid, 0, 0);

    const textMesh = new THREE.Mesh(textGeometry, this.materials.text);
    textMesh.lookAt(this.view.camera.position);
    textMesh.name = `label-${label}`;
    textMesh.position.x = position.x;
    textMesh.position.y = position.y;
    textMesh.position.z = position.z;
    return textMesh;
  }

  addSphere(name, position, sphereGroup, geometry, material, meta) {
    const sphere = new THREE.Mesh(geometry, material);
    sphere.position.x = position.x;
    sphere.position.y = position.y;
    sphere.position.z = position.z;
    sphere.name = name;
    sphere.type = meta.type; // custom property
    sphere.meta = meta; // custom property
    sphereGroup.add(sphere);
    return sphere;
  }

  /**
   * Options for 3D labels in three.js

    CSS3DRenderer (HTML overlay)
        Pros: crisp text, easy styling, fixed pixel size, trivial offsets.
        Cons: no automatic occlusion by 3D objects, lots of DOM nodes hurt performance (>300–500), z-order is DOM-based.
        Good for: dozens to a few hundred labels, quick UI, when occlusion isn’t critical.
    WebGL sprites with canvas textures (THREE.Sprite or libraries like three-spritetext)
        Pros: occludes correctly, simple to billboard, OK for a few hundred.
        Cons: each label has its own texture; blurry at varying scales; memory-heavy with many labels.
    Signed-distance-field (SDF/MSDF) text meshes (troika-three-text)
        Pros: crisp at any scale, participates in depth, occludes correctly, good performance, easy billboarding, outlines/shadows.
        Cons: still one mesh per label; very large counts require culling/decluttering.
        Good for: hundreds to a few thousand labels with culling.
    look at addLabel for a 4th option where ShapeGeometry is used to create the text mesh
   */
  addStationLabel(stationLabel, stationName, position, targetGroup) {
    const labelConfig = this.options.scene.stationLabels;
    const labelPosition = position.clone();

    if (labelConfig.offsetDirection === 'up') {
      labelPosition.y += labelConfig.offset; // offset above the station
    } else if (labelConfig.offsetDirection === 'down') {
      labelPosition.y -= labelConfig.offset; // offset below the station
    } else if (labelConfig.offsetDirection === 'left') {
      labelPosition.x -= labelConfig.offset; // offset left of the station
    } else if (labelConfig.offsetDirection === 'right') {
      labelPosition.x += labelConfig.offset; // offset right of the station
    }

    const font = {
      size  : labelConfig.size,
      color : labelConfig.color,
      name  : 'Arial'

    };

    if (labelConfig.stroke) {
      font.strokeColor = labelConfig.strokeColor;
    }

    const textSprite = new TextSprite(
      stationLabel,
      labelPosition,
      font,
      labelConfig.scale,
      `station-label-${stationLabel}`
    );

    const sprite = textSprite.getSprite();
    sprite.userData = {
      label           : stationLabel,
      textSprite,
      stationName,
      stationPosition : position.clone()
    };

    targetGroup.add(sprite);
  }

  addStartingPoint(cave) {
    // Remove existing starting point if it exists
    if (this.startPointObjects.has(cave.name)) {
      this.removeStartingPoint(cave.name);
    }

    // Get the first station of the first survey
    const firstStation = cave.getFirstStation();
    if (!firstStation) return;

    // Create a sphere geometry for the starting point
    const startPointGeo = new THREE.SphereGeometry(this.options.scene.startPoint.radius, 7, 7);

    // Create the starting point mesh
    const startPoint = new THREE.Mesh(startPointGeo, this.materials.sphere.startPoint);
    startPoint.position.copy(firstStation.position);
    startPoint.name = `startPoint_${cave.name}`;

    // Set visibility based on configuration
    startPoint.visible = this.options.scene.startPoint.show;

    // Add to the starting points group
    this.startPoints3DGroup.add(startPoint);

    // Store reference for later management
    this.startPointObjects.set(cave.name, {
      mesh     : startPoint,
      geometry : startPointGeo,
      material : this.materials.sphere.startPoint
    });

    return startPoint;
  }

  removeStartingPoint(caveName) {
    const startPointObj = this.startPointObjects.get(caveName);
    if (startPointObj) {
      this.startPoints3DGroup.remove(startPointObj.mesh);
      startPointObj.geometry.dispose();
      startPointObj.material.dispose();
      this.startPointObjects.delete(caveName);
    }
  }

  setStartingPointsVisibility(visible) {
    this.startPoints3DGroup.visible = visible;
    // Also update individual objects for consistency
    this.startPointObjects.forEach((obj) => {
      obj.mesh.visible = visible;
    });
  }

  updateStartingPointColor(color) {
    this.startPointObjects.forEach((obj) => {
      obj.material.color.setHex(color);
    });
  }

  updateStartingPointRadius(radius) {
    this.startPointObjects.forEach((obj) => {
      // Create new geometry with new radius
      const newGeometry = new THREE.SphereGeometry(radius, 7, 7);
      obj.mesh.geometry.dispose();
      obj.mesh.geometry = newGeometry;
    });
  }

  addSurveyToScene(survey, cave, polygonSegments, splaySegments, auxiliarySegments, visibility, colorGradients) {

    const geometryStations = new LineSegmentsGeometry();
    geometryStations.setPositions(polygonSegments);
    const splaysGeometry = new LineSegmentsGeometry();
    splaysGeometry.setPositions(splaySegments);
    const auxiliaryGeometry = new LineSegmentsGeometry();
    auxiliaryGeometry.setPositions(auxiliarySegments);

    let clLineMat, splayLineMat, auxiliaryLineMat;
    const gradientMaterial = this.materials.whiteLine;
    if (gradientMaterial.linewidth === 0) {
      gradientMaterial.linewidth = this.materials.segments.centerLine.linewidth;
    }
    if (colorGradients !== undefined) {
      if (colorGradients.center.length !== polygonSegments.length) {
        throw new Error(
          `Color gradients length ${colorGradients.center.length} does not match polygon segments length ${polygonSegments.length} for survey ${survey.name}`
        );
      }
      if (colorGradients.splays.length !== splaySegments.length) {
        throw new Error(
          `Color gradients length ${colorGradients.splays.length} does not match splay segments length ${splaySegments.length} for survey ${survey.name}`
        );
      }
      if (colorGradients.auxiliary.length !== auxiliarySegments.length) {
        throw new Error(
          `Color gradients length ${colorGradients.auxiliary.length} does not match auxiliary segments length ${auxiliarySegments.length} for survey ${survey.name}`
        );
      }
      geometryStations.setColors(colorGradients.center);
      splaysGeometry.setColors(colorGradients.splays);
      auxiliaryGeometry.setColors(colorGradients.auxiliary);
      clLineMat = gradientMaterial;
      splayLineMat = gradientMaterial;
      auxiliaryLineMat = gradientMaterial;
    } else {
      //FIXME: sophisticate percave, persurvey, global
      clLineMat = this.materials.segments.centerLine;
      splayLineMat = this.materials.segments.splay;
      auxiliaryLineMat = this.materials.segments.auxiliary;
    }

    const lineSegmentsPolygon = new LineSegments2(geometryStations, clLineMat);
    lineSegmentsPolygon.name = `centerline-segments-${cave.name}-${survey.name}`;
    lineSegmentsPolygon.visible = visibility && this.options.scene.centerLines.segments.show;

    const lineSegmentsSplays = new LineSegments2(splaysGeometry, splayLineMat);
    lineSegmentsSplays.name = `splay-segments-${cave.name}-${survey.name}`;
    lineSegmentsSplays.visible = visibility && this.options.scene.splays.segments.show;

    const lineSegmentsAuxiliaries = new LineSegments2(auxiliaryGeometry, auxiliaryLineMat);
    lineSegmentsAuxiliaries.name = `auxiliary-segments-${cave.name}-${survey.name}`;
    lineSegmentsAuxiliaries.visible = visibility && this.options.scene.auxiliaries.segments.show;

    const group = new THREE.Group();
    group.name = `segments-cave-${cave.name}-survey-${survey.name}`;

    group.add(lineSegmentsPolygon);
    group.add(lineSegmentsSplays);
    group.add(lineSegmentsAuxiliaries);

    const clStationSpheresGroup = new THREE.Group();
    clStationSpheresGroup.name = `center-line-spheres-${cave.name}-${survey.name}`;
    const splayStationSpheresGroup = new THREE.Group();
    splayStationSpheresGroup.name = `splay-spheres-${cave.name}-${survey.name}`;
    const auxiliaryStationSpheresGroup = new THREE.Group();
    auxiliaryStationSpheresGroup.name = `auxiliary-spheres-${cave.name}-${survey.name}`;

    const clSphereGeo = new THREE.SphereGeometry(this.options.scene.centerLines.spheres.radius, 5, 5);
    const splaySphereGeo = new THREE.SphereGeometry(this.options.scene.splays.spheres.radius, 5, 5);
    const auxiliarySphereGeo = new THREE.SphereGeometry(this.options.scene.auxiliaries.spheres.radius, 5, 5);

    const stationLabelsGroup = new THREE.Group();
    stationLabelsGroup.name = `station-labels-${cave.name}-${survey.name}`;
    const stationNameMode = this.options.scene.stationLabels.mode;

    for (const [stationName, station] of cave.stations) {
      if (station.survey.name !== survey.name) continue; // without this line we would add all stations for each survey
      const stationLabel = stationNameMode === 'name' ? stationName : station.position.z.toFixed(2);
      if (station.type === ShotType.CENTER) {
        this.addSphere(
          stationName,
          station.position,
          clStationSpheresGroup,
          clSphereGeo,
          this.materials.sphere.centerLine,
          {
            cave        : cave,
            survey      : station.survey,
            type        : station.type,
            coordinates : station.coordinates
          }
        );
        // Add station label
        if (this.options.scene.stationLabels.show) {
          // adding sprites for a cave with 3k stations is roughly 25 MB, let's try to save memory by not adding them if they are not visible
          this.addStationLabel(stationLabel, stationName, station.position, stationLabelsGroup);
        }

      } else if (station.type === ShotType.SPLAY) {
        this.addSphere(
          stationName,
          station.position,
          splayStationSpheresGroup,
          splaySphereGeo,
          this.materials.sphere.splay,
          {
            cave        : cave,
            survey      : station.survey,
            type        : station.type,
            coordinates : station.coordinates
          }
        );
      } else if (station.type === ShotType.AUXILIARY) {
        this.addSphere(
          stationName,
          station.position,
          auxiliaryStationSpheresGroup,
          auxiliarySphereGeo,
          this.materials.sphere.auxiliary,
          {
            cave        : cave,
            survey      : station.survey,
            type        : station.type,
            coordinates : station.coordinates
          }
        );
        if (this.options.scene.stationLabels.show) {
          this.addStationLabel(stationLabel, stationName, station.position, stationLabelsGroup);
        }
      }
    }
    clStationSpheresGroup.visible = visibility && this.options.scene.centerLines.spheres.show;
    splayStationSpheresGroup.visible = visibility && this.options.scene.splays.spheres.shows;
    auxiliaryStationSpheresGroup.visible = visibility && this.options.scene.auxiliaries.spheres.show;
    stationLabelsGroup.visible = visibility && this.options.scene.stationLabels.show;

    group.add(clStationSpheresGroup);
    group.add(splayStationSpheresGroup);
    group.add(auxiliaryStationSpheresGroup);
    group.add(stationLabelsGroup);
    this.caveObject3DGroup.add(group);

    return {
      id                 : U.randomAlphaNumbericString(5),
      centerLines        : lineSegmentsPolygon,
      centerLinesSpheres : clStationSpheresGroup,
      splays             : lineSegmentsSplays,
      splaysSpheres      : splayStationSpheresGroup,
      auxiliaries        : lineSegmentsAuxiliaries,
      auxiliarySpheres   : auxiliaryStationSpheresGroup,
      stationLabels      : stationLabelsGroup,
      group              : group
    };
  }

  addSurfaceToScene(cloud, colorGradients) {
    cloud.geometry.setAttribute('color', new THREE.Float32BufferAttribute(colorGradients, 3));
    cloud.name = `surface-${cloud.name}`;
    this.surfaceObject3DGroup.add(cloud);
    this.view.renderView();

    return {
      id    : U.randomAlphaNumbericString(5),
      cloud : cloud
    };
  }

  addSurfaceSphere(position, sphereGroup, geometry, material) {
    const sphere = new THREE.Mesh(geometry, material);
    sphere.name = `surface-sphere-${position.x}-${position.y}-${position.z}`;
    sphere.position.x = position.x;
    sphere.position.y = position.y;
    sphere.position.z = position.z;
    sphere.name = 'surface';
    sphere.type = 'surface'; // custom property
    sphereGroup.add(sphere);
  }

  addSurface(surface, entry) {
    if (this.surfaceObjects.has(surface.name)) {
      throw new Error(`Surface ${surface.name} object has already been added to the scene!`);
    }
    this.surfaceObjects.set(surface.name, entry);
  }

  disposeSurvey(caveName, surveyName) {
    if (this.caveObjects.has(caveName) && this.caveObjects.get(caveName).has(surveyName)) {
      const e = this.caveObjects.get(caveName).get(surveyName);
      this.#disposeSurveyObjects(e);
    }
  }

  #disposeSurveyObjects(e) {
    e.centerLines.geometry.dispose();
    e.splays.geometry.dispose();
    e.auxiliaries.geometry.dispose();
    e.centerLinesSpheres.children.forEach((c) => c.geometry.dispose()); // all stations spheres use the same geometry
    e.centerLinesSpheres.clear();
    e.splaysSpheres.children.forEach((c) => c.geometry.dispose()); // all stations spheres use the same geometry
    e.splaysSpheres.clear();
    e.auxiliarySpheres.children.forEach((c) => c.geometry.dispose());
    e.auxiliarySpheres.clear();
    e.stationLabels.children.forEach((sprite) => {

      if (sprite.material && sprite.material.map) {
        sprite.material.map.dispose();
      }
      sprite.material.dispose();
      sprite.geometry.dispose();

    });
    e.stationLabels.clear();
    e.group.clear();
    this.caveObject3DGroup.remove(e.group);
  }

  addStationLabels() {
    const mode = this.options.scene.stationLabels.mode;
    this.caveObjects.forEach((surveyEntries, caveName) => {
      const cave = this.db.getCave(caveName);
      surveyEntries.forEach((surveyObject, surveyName) => {
        cave.stations.forEach((station, stationName) => {
          if (station.survey.name === surveyName) {
            const stationLabel = mode === 'name' ? stationName : station.position.z.toFixed(2);
            this.addStationLabel(stationLabel, stationName, station.position, surveyObject.stationLabels);
          }
        });
      });
    });
  }

  getStationsLabelCount() {
    let count = 0;
    this.caveObjects.forEach((caveObject) => {
      caveObject.forEach((surveyObject) => {
        if (surveyObject.stationLabels) {
          count += surveyObject.stationLabels.children.length;
        }
      });
    });
    return count;
  }

  recreateAllStationLabels() {
    if (!this.options.scene.stationLabels.show) return;
    const mode = this.options.scene.stationLabels.mode;

    this.caveObjects.forEach((caveObject) => {
      caveObject.forEach((surveyObject) => {
        // Store all existing label data
        const labelData = [];

        surveyObject.stationLabels.children.forEach((label) => {
          if (label.userData) {
            labelData.push({
              stationName : label.userData.stationName,
              position    : label.userData.stationPosition.clone()
            });
          }
        });

        // Dispose old labels and clear the group
        surveyObject.stationLabels.children.forEach((label) => {
          if (label.userData && label.userData.textSprite) {
            // Dispose the texture
            if (label.userData.textSprite.sprite.material.map) {
              label.userData.textSprite.sprite.material.map.dispose();
            }

            label.userData.textSprite.sprite.material.dispose();
          }
        });
        surveyObject.stationLabels.clear();

        // Recreate labels with current configuration
        labelData.forEach((data) => {
          const stationLabel = mode === 'name' ? data.stationName : data.position.z.toFixed(2);
          this.addStationLabel(stationLabel, data.stationName, data.position, surveyObject.stationLabels);
        });

      });
    });
  }

  #dipostSectionAttributes(caveName) {
    const matchingIds = [];
    for (const [id, entry] of this.sectionAttributes) {
      if (entry.caveName === caveName) {
        matchingIds.push(id);
      }
    }
    matchingIds.forEach((id) => this.disposeSectionAttribute(id));
  }

  renameCave(oldName, newName) {
    if (this.caveObjects.has(newName)) {
      throw new Error(`Cave with ${newName} already exists!`);
    }
    const surveyObjects = this.caveObjects.get(oldName);
    this.caveObjects.delete(oldName);
    this.caveObjects.set(newName, surveyObjects);
    this.sectionAttributes.forEach((sa) => (sa.caveName = newName)); //TODO: what to do with component attributes here?

    // Update starting point for renamed cave
    if (this.startPointObjects.has(oldName)) {
      const startPointObj = this.startPointObjects.get(oldName);
      this.startPointObjects.delete(oldName);
      this.startPointObjects.set(newName, startPointObj);
      startPointObj.mesh.name = `startPoint_${newName}`;
    }
  }

  renameSurvey(oldName, newName, caveName) {
    const caveObjects = this.caveObjects.get(caveName);

    if (caveObjects.has(newName)) {
      throw new Error(`Survey with ${newName} does exists!`);
    }
    const surveyObjects = caveObjects.get(oldName);
    caveObjects.delete(oldName);
    caveObjects.set(newName, surveyObjects);
  }

  disposeCave(caveName) {
    if (this.caveObjects.has(caveName)) {
      const caveObject = this.caveObjects.get(caveName);
      caveObject.forEach((surveyObject) => {
        this.#disposeSurveyObjects(surveyObject);
      });
    }

    // Remove starting point for this cave
    this.removeStartingPoint(caveName);

    // Dispose section attributes for this cave
    this.#dipostSectionAttributes(caveName);
  }

  deleteCave(caveName) {
    this.caveObjects.delete(caveName);
  }

  createTubeGeometryFromSegments(segments) {
    // Create a simpler approach: create individual tube segments for each line segment
    const group = new THREE.Group();
    group.name = `tube-geometry-from-segments`;

    // Use fixed values for simplicity
    const tubeRadius = this.options.scene.centerLines.segments.width * 0.15; // 15% of line width

    // Process segments in pairs (start and end points)
    for (let i = 0; i < segments.length; i += 6) {
      if (i + 5 < segments.length) {
        const startPoint = new THREE.Vector3(segments[i], segments[i + 1], segments[i + 2]);
        const endPoint = new THREE.Vector3(segments[i + 3], segments[i + 4], segments[i + 5]);

        // Create a tube segment between these two points
        const direction = new THREE.Vector3().subVectors(endPoint, startPoint);
        const distance = direction.length();

        if (distance > 0.001) {
          // Avoid very short segments
          const tubeGeometry = new THREE.CylinderGeometry(tubeRadius, tubeRadius, distance, 6, 1, false);

          // Position the tube at the midpoint
          const midPoint = new THREE.Vector3().addVectors(startPoint, endPoint).multiplyScalar(0.5);

          // Rotate to align with the direction
          const up = new THREE.Vector3(0, 1, 0);
          const quaternion = new THREE.Quaternion().setFromUnitVectors(up, direction.normalize());

          const tubeMesh = new THREE.Mesh(tubeGeometry);
          tubeMesh.name = `tube-geometry-from-segments-${i}-${i + 5}`;
          tubeMesh.position.copy(midPoint);
          tubeMesh.setRotationFromQuaternion(quaternion);

          group.add(tubeMesh);
        }
      }
    }

    return group;
  }
}

export { MyScene, SceneOverview };
