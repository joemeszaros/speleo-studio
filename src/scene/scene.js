import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';

import { SurveyHelper } from '../survey.js';
import { Grid } from './grid.js';
import * as U from '../utils/utils.js';
import { Options } from '../config.js';
import { SECTION_LINE_MULTIPLIER } from '../constants.js';

import { SpatialView, PlanView, ProfileView } from './views.js';

class SceneOverview {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
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
    this.segments = new Map(); // for shortest path segments
    this.caveObject3DGroup = new THREE.Group();
    this.sprites3DGroup = new THREE.Group();
    this.surfaceObject3DGroup = new THREE.Group();
    this.sectionAttributes3DGroup = new THREE.Group();
    this.segments3DGroup = new THREE.Group();
    this.stationFont = undefined;
    const loader = new FontLoader();
    loader.load('fonts/helvetiker_regular.typeface.json', (font) => this.setFont(font));

    this.container = container;
    this.sceneRenderer = new THREE.WebGLRenderer({ antialias: true });
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
    this.spriteScene.add(this.sprites3DGroup);

    this.views = {
      plan    : new PlanView(this, this.domElement),
      profile : new ProfileView(this, this.domElement),
      spatial : new SpatialView(this, this.domElement, viewHelperContainer)
    };

    this.threejsScene = new THREE.Scene();
    this.threejsScene.background = new THREE.Color(this.options.scene.background.color.hex());

    this.grid = new Grid(this.options, this);

    this.threejsScene.add(this.caveObject3DGroup);
    this.threejsScene.add(this.surfaceObject3DGroup);
    this.threejsScene.add(this.sectionAttributes3DGroup);
    this.threejsScene.add(this.segments3DGroup);

    this.boundingBox = undefined;
    this.planeMeshes = new Map();

    this.raycaster = new THREE.Raycaster();

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
    this.surfaceSphereContext = this.addSphere(
      'surface',
      new THREE.Vector3(0, 0, 0),
      this.surfaceObject3DGroup,
      sphereGeo,
      this.materials.sphere.surface,
      {
        type : 'surface'
      }
    );
    this.view = this.views.spatial;
    this.view.activate();

    window.addEventListener('resize', () => this.onWindowResize());
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
    if (type === 'centerLine') {
      spheres = this.getAllCenterLineStationSpheres();
      radius = this.options.scene.centerLines.spheres.radius;
    } else if (type === 'splay') {
      spheres = this.getAllSplaysStationSpheres();
      radius = this.options.scene.splays.spheres.radius;
    }
    const geometry = new THREE.SphereGeometry(radius, 5, 5);
    spheres.forEach((s) => {
      s.geometry.dispose();
      s.geometry = geometry;
    });
    this.view.renderView();
  }

  deleteSurvey(caveName, surveyName) {
    this.caveObjects.get(caveName).delete(surveyName);
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

  getBoundingClientRect() {
    return this.domElement.getBoundingClientRect();
  }

  getAllSurfacePoints() {
    return [...this.surfaceObjects.values()].map((s) => s.cloud);
  }

  getStationSphere(stationName, caveName) {
    const clSpheres = this.getAllCenterLineStationSpheres();
    const splaySpheres = this.getAllSplaysStationSpheres();
    return clSpheres.concat(splaySpheres).find((s) => s.name === stationName && s.meta.cave.name === caveName);
  }

  // this function is required because threejs canvas is 48 px from top
  getMousePosition(mouseCoordinates) {
    const { x, y } = mouseCoordinates;
    const rect = this.container.getBoundingClientRect();
    return new THREE.Vector2((x - rect.left) / rect.width, (y - rect.top) / rect.height);
  }

  getPointer(mousePosition) {
    const pointer = new THREE.Vector2();
    pointer.x = mousePosition.x * 2 - 1;
    pointer.y = -mousePosition.y * 2 + 1;
    return pointer;
  }

  getFirstIntersectedSprite(mouseCoordinates) {
    if (this.view.spriteCamera === undefined) return;
    const pointer = this.getPointer(this.getMousePosition(mouseCoordinates));
    const sprites = this.sprites3DGroup.children;
    this.raycaster.setFromCamera(pointer, this.view.spriteCamera);
    const intersectedSprites = this.raycaster.intersectObjects(sprites);
    if (intersectedSprites.length) {
      return intersectedSprites[0].object;
    } else {
      return undefined;
    }

  }

  getIntersectedStationSphere(mouseCoordinates) {
    const pointer = this.getPointer(this.getMousePosition(mouseCoordinates));
    const clSpheres = this.getAllCenterLineStationSpheres();
    const splaySpheres = this.getAllSplaysStationSpheres();
    this.raycaster.setFromCamera(pointer, this.view.camera);
    const intersectedSpheres = this.raycaster.intersectObjects(clSpheres.concat(splaySpheres));
    if (intersectedSpheres.length) {
      return intersectedSpheres[0].object;
    } else {
      return undefined;
    }

  }

  getIntersectedSurfacePoint(mouseCoordinates, purpose) {
    const pointer = this.getPointer(this.getMousePosition(mouseCoordinates));
    const clouds = this.getAllSurfacePoints();
    this.raycaster.setFromCamera(pointer, this.view.camera);
    this.raycaster.params.Points.threshold = 0.1;
    const intersectedPoints = this.raycaster.intersectObjects(clouds);
    if (intersectedPoints.length) {
      if (purpose === 'selected') {
        this.surfaceSphere.position.copy(intersectedPoints[0].point);
        this.surfaceSphere.visible = true;
        return this.surfaceSphere;
      } else if (purpose === 'selectedForContext') {
        this.surfaceSphereContext.position.copy(intersectedPoints[0].point);
        this.surfaceSphereContext.visible = true;
        return this.surfaceSphereContext;
      }
    } else {
      return undefined;
    }
  }

  onWindowResize() {
    this.width = this.container.offsetWidth;
    this.height = this.container.offsetHeight;
    this.sceneRenderer.setSize(this.width, this.height);
    Object.keys(this.views).forEach((k) => this.views[k].onResize(this.width, this.height));
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
        this.addSphere(
          '',
          bb.getCenter(new THREE.Vector3()), //TODO: remove sphere from here
          this.caveObject3DGroup,
          new THREE.SphereGeometry(this.options.scene.centerLines.spheres.radius * 4, 10, 10),
          this.materials.sphere.centerLine,
          {

          }
        );
        //this.addSphere('center', bb.getCenter(new THREE.Vector3()),);
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

  showSegments(id, segments, color, caveName) {
    if (!this.segments.has(id)) {
      const geometry = new LineSegmentsGeometry();
      geometry.setPositions(segments);
      geometry.computeBoundingBox();
      const material = new LineMaterial({
        color        : color.hex(),
        linewidth    : this.options.scene.centerLines.segments.width * SECTION_LINE_MULTIPLIER,
        worldUnits   : false,
        vertexColors : false
      });
      const lineSegments = new LineSegments2(geometry, material);
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
      const material = new LineMaterial({
        color        : color.hex(),
        linewidth    : this.options.scene.centerLines.segments.width * SECTION_LINE_MULTIPLIER,
        worldUnits   : false,
        vertexColors : false
      });
      const lineSegments = new LineSegments2(geometry, material);
      lineSegments.layers.set(1);
      this.sectionAttributes3DGroup.add(lineSegments);
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
        segments : lineSegments,
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
      const lineSegments = e.segments;
      lineSegments.geometry.dispose();
      lineSegments.material.dispose();
      this.sectionAttributes3DGroup.remove(lineSegments);
      const textMesh = e.text;
      this.sectionAttributes3DGroup.remove(textMesh);
      textMesh.geometry.dispose();
      this.sectionAttributes.delete(id);
      this.view.renderView();
    }
  }

  showPlaneFor(attributeName) {
    const planes = [];
    this.db.caves.forEach((cave) => {
      cave.surveys.forEach((s) => {
        const matchingAttributes = s.getAttributesWithPositionsByName(cave.stations, attributeName);
        if (matchingAttributes.length === 0) return;
        matchingAttributes.forEach((ma) => {
          const [position, firstAttribute] = ma;
          const geometry = new THREE.PlaneGeometry(firstAttribute.width, firstAttribute.height, 10, 10);
          const plane = new THREE.Mesh(geometry, this.materials.planes.get(attributeName));
          plane.position.set(0, 0, 0);
          const dir = U.normal(U.degreesToRads(firstAttribute.azimuth), U.degreesToRads(firstAttribute.dip));
          plane.lookAt(dir.x, dir.y, dir.z);
          const v = new THREE.Vector3(position.x, position.y, position.z);
          plane.position.copy(v);
          planes.push(plane);
          this.threejsScene.add(plane);
        });

      });
    });

    this.planeMeshes.set(attributeName, planes); // even set if planes is emptry
    this.view.renderView();
  }

  rollCenterLineColor() {
    const config = this.options.scene.caveLines.color.mode;
    const clConfig = this.options.scene.centerLines;
    const splayConfig = this.options.scene.splays;

    Options.rotateOptionChoice(config);
    console.log(config.value);
    switch (config.value) {
      case 'gradientByZ':
      case 'gradientByDistance': {
        const colors = SurveyHelper.getColorGradientsForCaves(this.db.caves, this.options.scene.caveLines);
        this.caveObjects.forEach((surveyEntrires, caveName) => {
          surveyEntrires.forEach((e, surveyName) => {
            e['centerLines'].material = this.materials.whiteLine;
            e['splays'].material = this.materials.whiteLine;
            const surveyColors = colors.get(caveName).get(surveyName);
            e['centerLines'].geometry.setColors(surveyColors.center);
            e['splays'].geometry.setColors(surveyColors.splays);
          });
        });
        break;
      }
      case 'global':
      case 'percave':
      case 'persurvey': {

        this.caveObjects.forEach((surveyEntrires, caveName) => {

          let newClMaterial, newSplayMaterial;
          if (config.value === 'percave' && this.db.getCave(caveName).color !== undefined) {
            const color = this.db.getCave(caveName).color.hex();
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
          }

          surveyEntrires.forEach((e, surveyName) => {

            e['centerLines'].geometry.setColors([]);
            e['splays'].geometry.setColors([]);

            if (config.value === 'global' || (config.value === 'percave' && newClMaterial === undefined)) {
              e['centerLines'].material = this.materials.segments.centerLine;
              e['splays'].material = this.materials.segments.splay;
            } else if (config.value === 'percave' && newClMaterial !== undefined) {
              e['centerLines'].material = newClMaterial;
              e['splays'].material = newSplayMaterial;
            } else if (config.value === 'persurvey') {
              const survey = this.db.getSurvey(caveName, surveyName);
              if (survey.color === undefined) return; // = continue
              const hexColor = survey.color.hex();
              e['centerLines'].material = new LineMaterial({
                color       : hexColor,
                linewidth   : clConfig.segments.width,
                transparent : true,
                opacity     : clConfig.segments.opacity
              });
              e['splays'].material = new LineMaterial({
                color       : hexColor,
                linewidth   : splayConfig.segments.width,
                transparent : true,
                opacity     : clConfig.segments.opacity
              });
            }

          });
        });
        break;
      }
      default:
        throw new Error(`unknown configuration for cave line colors: ${config.value}`);
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

  disposePlaneFor(attributeName, shouldDelete = true) {
    const planes = this.planeMeshes.get(attributeName);
    planes.forEach((p) => {
      p.geometry.dispose();
      this.threejsScene.remove(p);
    });
    if (shouldDelete) {
      this.planeMeshes.delete(attributeName);
    }

    this.view.renderView();
  }

  tooglePlaneFor(attributeName) {
    if (!this.planeMeshes.has(attributeName)) {
      this.showPlaneFor(attributeName);
    } else {
      this.disposePlaneFor(attributeName);
    }

  }

  updateVisiblePlanes() {
    this.planeMeshes.keys().forEach((k) => this.disposePlaneFor(k, false));
    this.planeMeshes.keys().forEach((k) => this.showPlaneFor(k));
  }

  changeView(viewName) {
    if (this.view !== this.views[viewName]) {
      this.view.deactivate();
      this.view = this.views[viewName];
      this.view.activate();
    }
  }

  updateSegmentsWidth(width) {
    this.sectionAttributes.forEach((e) => {
      e.segments.material.linewidth = width * SECTION_LINE_MULTIPLIER;
    });
    this.view.renderView();
  }

  updateCenterLinesOpacity(width) {
    this.sectionAttributes.forEach((e) => {
      e.segments.material.linewidth = width * SECTION_LINE_MULTIPLIER;
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
    sphere.meta = meta; // custom property
    sphereGroup.add(sphere);
    return sphere;
  }

  addToScene(survey, cave, polygonSegments, splaySegments, visibility, colorGradients) {

    const geometryStations = new LineSegmentsGeometry();
    geometryStations.setPositions(polygonSegments);
    const splaysGeometry = new LineSegmentsGeometry();
    splaysGeometry.setPositions(splaySegments);
    let clLineMat, splayLineMat;
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
      geometryStations.setColors(colorGradients.center);
      splaysGeometry.setColors(colorGradients.splays);
      clLineMat = gradientMaterial;
      splayLineMat = gradientMaterial;
    } else {
      clLineMat = this.materials.segments.centerLine;
      splayLineMat = this.materials.segments.splay;
    }

    const lineSegmentsPolygon = new LineSegments2(geometryStations, clLineMat);
    lineSegmentsPolygon.visible = visibility && this.options.scene.centerLines.segments.show;

    const lineSegmentsSplays = new LineSegments2(splaysGeometry, splayLineMat);
    lineSegmentsSplays.visible = visibility && this.options.scene.splays.segments.show;
    const group = new THREE.Group();

    group.add(lineSegmentsPolygon);
    group.add(lineSegmentsSplays);

    const clStationSpheresGroup = new THREE.Group();
    const splayStationSpheresGroup = new THREE.Group();

    const clSphereGeo = new THREE.SphereGeometry(this.options.scene.centerLines.spheres.radius, 10, 10);
    const splaySphereGeo = new THREE.SphereGeometry(this.options.scene.splays.spheres.radius, 10, 10);

    for (const [stationName, station] of cave.stations) {
      if (station.survey.name !== survey.name) continue; // without this line we would add all stations for each survey
      if (station.type === 'center') {
        this.addSphere(
          stationName,
          station.position,
          clStationSpheresGroup,
          clSphereGeo,
          this.materials.sphere.centerLine,
          {
            cave   : cave,
            survey : station.survey,
            type   : station.type
          }
        );
      } else if (station.type === 'splay') {
        this.addSphere(
          stationName,
          station.position,
          splayStationSpheresGroup,
          splaySphereGeo,
          this.materials.sphere.splay,
          {
            cave   : cave,
            survey : station.survey,
            type   : station.type
          }
        );
      }
    }
    clStationSpheresGroup.visible = visibility && this.options.scene.centerLines.spheres.show;
    splayStationSpheresGroup.visible = visibility && this.options.scene.splays.spheres.shows;

    group.add(clStationSpheresGroup);
    group.add(splayStationSpheresGroup);
    this.caveObject3DGroup.add(group);

    return {
      id                 : U.randomAlphaNumbericString(5),
      centerLines        : lineSegmentsPolygon,
      centerLinesSpheres : clStationSpheresGroup,
      splays             : lineSegmentsSplays,
      splaysSpheres      : splayStationSpheresGroup,
      group              : group
    };
  }

  addSurfaceToScene(cloud, colorGradients) {
    cloud.geometry.setAttribute('color', new THREE.Float32BufferAttribute(colorGradients, 3));
    this.surfaceObject3DGroup.add(cloud);
    this.view.renderView();

    return {
      id    : U.randomAlphaNumbericString(5),
      cloud : cloud
    };
  }

  addSurfaceSphere(position, sphereGroup, geometry, material) {
    const sphere = new THREE.Mesh(geometry, material);
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
    e.centerLinesSpheres.children.forEach((c) => c.geometry.dispose()); // all stations spheres use the same geometry
    e.centerLinesSpheres.clear();
    e.splaysSpheres.children.forEach((c) => c.geometry.dispose()); // all stations spheres use the same geometry
    e.splaysSpheres.clear();
    e.group.clear();
    this.threejsScene.remove(e.group);
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
    this.sectionAttributes.forEach((sa) => (sa.caveName = newName));
  }

  disposeCave(caveName) {
    const surveyObjectList = this.caveObjects.get(caveName);
    surveyObjectList.forEach((c) => this.#disposeSurveyObjects(c));
    this.#dipostSectionAttributes(caveName);
  }

  deleteCave(caveName) {
    this.caveObjects.delete(caveName);
  }

}

export { MyScene, SceneOverview };
