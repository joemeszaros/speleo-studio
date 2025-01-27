import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TrackballControls } from 'three/addons/controls/TrackballControls.js';
import { SimpleOrbitControl, COORDINATE_INDEX } from '../utils/orbitcontrol.js';
import * as C from '../constants.js';

class View {
  constructor(camera, domElement, scene) {
    this.camera = camera;
    this.domElement = domElement;
    this.scene = scene;
  }

  renderView() {
    this.scene.renderScene(this.camera);
  }

  onResize(aspect) {
    if (this.camera.isOrthographicCamera) {
      this.camera.left = this.camera.bottom * aspect;
      this.camera.right = this.camera.top * aspect;
      this.camera.updateProjectionMatrix();
    }
  }

  addListener(name, handler) {
    this.domElement.addEventListener(name, (e) => {
      if (this.enabled) {
        handler(e);
      }
    });
  }

  static createOrthoCamera(aspect) {
    return new THREE.OrthographicCamera(
      -C.FRUSTRUM * aspect,
      C.FRUSTRUM * aspect,
      C.FRUSTRUM,
      -C.FRUSTRUM,
      -1000,
      3000
    );
  }

  fitScreen(boundingBox, update = false) {
    if (boundingBox === undefined) return;
    const boundingBoxCenter = boundingBox.getCenter(new THREE.Vector3());
    const aspect = this.scene.width / this.scene.height; //TODO: should implement getAspect() in scene
    const rotation = new THREE.Matrix4().extractRotation(this.camera.matrix);
    boundingBox.applyMatrix4(rotation);
    const width = boundingBox.max.x - boundingBox.min.x;
    const height = boundingBox.max.y - boundingBox.min.y;
    //const maxSize = Math.max(width, height);
    //this.options.scene.zoomStep = C.FRUSTRUM / maxSize;
    const zoomLevel = Math.min((2 * C.FRUSTRUM * aspect) / width, (2 * C.FRUSTRUM) / height);
    const zoomChanged = this.camera.zoom !== zoomLevel;
    this.camera.zoom = zoomLevel;

    const offset = boundingBoxCenter.clone().sub(this.target);
    if (update || offset.length() > 0) {
      const oldPosition = this.camera.position.clone();
      const newCameraPosition = oldPosition.add(offset);
      this.target.copy(boundingBoxCenter);
      this.camera.position.copy(newCameraPosition);
      this.camera.lookAt(this.target);
      this.control.target = this.target;
    }

    if (update || zoomChanged || offset.length > 0) {
      this.camera.updateProjectionMatrix(); //lookat or zoom
      this.renderView();
    }
  }

  panCameraTo(position) {
    const pos = position.clone();
    const dir = this.camera.position.clone().sub(this.target);
    const camPos = pos.clone().add(dir);
    this.target.copy(pos);
    this.camera.position.copy(camPos);
    this.camera.updateProjectionMatrix();
    this.renderView();
  }

  zoomCameraTo(level) {
    this.camera.zoom = level;
    this.camera.updateProjectionMatrix();
    this.renderView();

  }

  zoomIn(delta) {
    this.zoomWithDelta(delta);
  }

  zoomOut(delta) {
    this.zoomWithDelta(-delta);
  }

  zoomWithDelta(delta) {
    const zoomValue = this.camera.zoom + delta;
    if (zoomValue >= 0.1) {
      this.camera.zoom = zoomValue;
      this.camera.updateProjectionMatrix();
      this.renderView();
    }
  }

}

class SpatialView extends View {

  constructor(scene, domElement) {
    super(View.createOrthoCamera(scene.width / scene.height), domElement, scene);
    this.control = new OrbitControls(this.camera, this.domElement);
    this.control.update();
    this.control.addEventListener('change', () => {
      this.renderView();
    });
    this.enabled = false;
    this.control.enabled = false;
    this.initiated = false;
  }

  activate() {
    this.enabled = true;
    this.control.enabled = true;

    if (this.initiated === false) {
      const boundingBox = this.scene.computeBoundingBox();
      this.target = boundingBox?.getCenter(new THREE.Vector3()) ?? new THREE.Vector3(0, 0, 0);
      this.camera.position.set(this.target.x, this.target.y, this.target.z + 100);
      this.camera.lookAt(this.target);
      this.fitScreen(boundingBox, true);
      this.initiated = true;
    }

    this.renderView();
  }

  deactivate() {
    this.enabled = false;
    this.control.enabled = false;
  }

}

class PlanView extends View {

  constructor(scene, domElement, compass, ratio) {
    super(View.createOrthoCamera(scene.width / scene.height), domElement, scene);

    this.control = new SimpleOrbitControl(this.camera, domElement, COORDINATE_INDEX.Z);
    this.compass = compass;
    this.ratio = ratio;
    this.initiated = false;
    this.enabled = false;
    this.addListener('orbitChange', (e) => this.#handleControlChange(e));
    this.addListener('pointermove', (e) => this.control.onMove(e));
    this.addListener('pointerdown', (e) => this.control.onDown(e));
    this.addListener('pointerup', () => this.control.onUp());
    this.addListener('wheel', (e) => this.control.onWheel(e));
  }

  #handleControlChange(e) {
    if (e.detail.reason === 'rotate') {
      this.compass.style.transform = `rotate(${e.detail.value.rotation}rad)`;
    }
    if (e.detail.reason === 'zoom') {
      this.ratio.style.transform = `scale(${e.detail.value.level})`;
    }
    this.renderView();
  }

  activate() {
    this.enabled = true;

    if (this.initiated === false) {
      const boundingBox = this.scene.computeBoundingBox();
      this.target = boundingBox?.getCenter(new THREE.Vector3()) ?? new THREE.Vector3(0, 0, 0);
      this.camera.position.set(this.target.x, this.target.y, this.target.z + 100);
      this.fitScreen(boundingBox, true);
      this.initiated = true;
    }
    this.compass.classList.remove('hide');
    this.compass.classList.add('show');

    this.renderView();

  }

  deactivate() {
    this.compass.classList.remove('show');
    this.compass.classList.add('hide');
    this.enabled = false;
  }
}

class ProfileView extends View {

  constructor(scene, domElement) {
    super(View.createOrthoCamera(scene.width / scene.height), domElement, scene);
    this.control = new SimpleOrbitControl(this.camera, domElement, COORDINATE_INDEX.Y);
    this.initiated = false;
    this.enabled = false;
    this.addListener('orbitChange', () => this.#handleControlChange());
    this.addListener('pointermove', (e) => this.control.onMove(e));
    this.addListener('pointerdown', (e) => this.control.onDown(e));
    this.addListener('pointerup', () => this.control.onUp());
    this.addListener('wheel', (e) => this.control.onWheel(e));
  }

  #handleControlChange() {
    this.sp.position.copy(this.target);
    this.renderView();

  }

  activate() {
    this.enabled = true;

    if (this.initiated === false) {
      const boundingBox = this.scene.computeBoundingBox();
      this.target = boundingBox?.getCenter(new THREE.Vector3()) ?? new THREE.Vector3(0, 0, 0);
      this.sp = this.scene.addSphere(
        '',
        this.target, //TODO: remove sphere from here
        this.scene.caveObject3DGroup,
        new THREE.SphereGeometry(this.scene.options.scene.centerLines.spheres.radius * 6, 10, 10),
        this.scene.materials.sphere.selected,
        {

        }
      );
      this.camera.position.set(this.target.x, this.target.y - 100, this.target.z);
      this.fitScreen(boundingBox, true);
      this.initiated = true;
    }

    this.renderView();

  }

  deactivate() {
    this.enabled = false;
  }
}

export { SpatialView, PlanView, ProfileView };
