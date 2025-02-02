import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TrackballControls } from 'three/addons/controls/TrackballControls.js';
import { SimpleOrbitControl, COORDINATE_INDEX } from '../utils/orbitcontrol.js';
import { TextSprite } from './textsprite.js';
import { showWarningPanel } from '../ui/popups.js';

class View {

  constructor(camera, domElement, scene) {
    this.camera = camera;
    this.domElement = domElement;
    this.scene = scene;
  }

  renderView() {
    this.scene.renderScene(this.camera);
  }

  onResize(width, height) {
    if (this.camera.isOrthographicCamera) {
      const aspect = width / height;
      this.camera.left = this.camera.bottom * aspect;
      this.camera.right = this.camera.top * aspect;
      this.camera.width = Math.abs(this.camera.left) + Math.abs(this.camera.right); // left is a negative number
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

  static createOrthoCamera(aspect, frustrum = 100) {
    const camera = new THREE.OrthographicCamera(
      (frustrum * aspect) / -2,
      (frustrum * aspect) / 2,
      frustrum / 2,
      frustrum / -2,
      -1000,
      3000
    );
    camera.width = frustrum * aspect; // custom property
    camera.height = frustrum; // custom property
    return camera;
  }

  fitScreen(boundingBox, update = false) {
    if (boundingBox === undefined) return;
    const boundingBoxCenter = boundingBox.getCenter(new THREE.Vector3());
    const rotation = new THREE.Matrix4().extractRotation(this.camera.matrix);
    boundingBox.applyMatrix4(rotation);
    const width = boundingBox.max.x - boundingBox.min.x;
    const height = boundingBox.max.y - boundingBox.min.y;
    const zoomLevel = Math.min(this.camera.width / width, this.camera.height / height); // camera width and height in world units
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
    if (level >= 0.1) {
      this.camera.zoom = level;
      this.camera.updateProjectionMatrix();
      this.renderView();
    }
  }

  zoomIn() {
    this.zoomCameraTo(this.camera.zoom * 1.1);
  }

  zoomOut() {
    this.zoomCameraTo(this.camera.zoom / 1.1);
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

  constructor(scene, domElement, ratioIndicatorWidth = 200, compassSize = 100) {
    super(View.createOrthoCamera(scene.width / scene.height), domElement, scene);

    this.spriteCamera = new THREE.OrthographicCamera( //TODO: standardize ortho camera creation (static methon in view)
      -scene.width / 2,
      scene.width / 2,
      scene.height / 2,
      -scene.height / 2,
      0,
      10
    );
    this.spriteCamera.position.z = 1;

    this.control = new SimpleOrbitControl(this.camera, domElement, COORDINATE_INDEX.Z);

    this.compass = this.#createCompass(compassSize);
    scene.sprites3DGroup.add(this.compass);

    this.ratio = this.#createRatioIndicator(ratioIndicatorWidth);
    scene.sprites3DGroup.add(this.ratio);
    this.ratio.onclick = () => {
      this.#setRatio();
    };

    this.ratioText = this.#createRatioText();
    const ratioTextSprite = this.ratioText.getSprite();
    scene.sprites3DGroup.add(ratioTextSprite);
    ratioTextSprite.onclick = () => {
      this.#setRatio();
    };

    this.initiated = false;
    this.enabled = false;
    this.addListener('orbitChange', (e) => this.#handleControlChange(e));
    this.addListener('pointermove', (e) => this.control.onMove(e));
    this.addListener('pointerdown', (e) => this.control.onDown(e));
    this.addListener('pointerup', () => this.control.onUp());
    this.addListener('wheel', (e) => this.control.onWheel(e));
  }

  #setRatio() {
    const ratioRaw = prompt('Enter the ratio values');
    if (!Number.isInteger(Number.parseInt(ratioRaw, 10))) {
      showWarningPanel(`Ratio '${ratioRaw}' is not an integer`);
      return;
    }
    const ratioValue = Number.parseInt(ratioRaw);
    if (ratioValue <= 0) {
      showWarningPanel('Ratio must be a positive number');
      return;
    } else {
      const level = this.camera.width / (ratioValue * (this.scene.width / this.ratio.width));
      this.control.setZoomLevel(level);
    }
  }

  onZoomLevelChange(level) {
    const worldWidth = this.camera.width / level;
    const ratio = worldWidth / (this.scene.width / this.ratio.width);
    let ratioText;
    if (ratio <= 15) {
      ratioText = ratio.toFixed(1);
    } else {
      ratioText = Math.ceil(ratio);
    }
    this.ratioText.update(`${ratioText} m`);
  }

  zoomCameraTo(level) {
    super.zoomCameraTo(level);
    this.onZoomLevelChange(this.camera.zoom);
  }

  #handleControlChange(e) {
    if (e.detail.reason === 'rotate') {
      this.compass.material.rotation = -e.detail.value.rotation;
    }
    if (e.detail.reason === 'zoom') {
      this.onZoomLevelChange(e.detail.value.level);
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
      this.onZoomLevelChange(this.camera.zoom);
    }
    this.renderView();

  }

  deactivate() {
    this.enabled = false;
  }

  renderView() {
    this.scene.renderScene(this.camera, this.spriteCamera);
  }

  onResize(width, height) {
    super.onResize(width, height);
    this.compass.position.set(width / 2 - 60, -height / 2 + 60, 1); // bottom right
    this.ratioText.getSprite().position.set(0, -this.scene.height / 2 + 45, 1);
    this.ratio.position.set(0, -this.scene.height / 2 + 20, 1);
    this.spriteCamera.left = -width / 2;
    this.spriteCamera.right = width / 2;
    this.spriteCamera.top = height / 2;
    this.spriteCamera.bottom = -height / 2;
    this.spriteCamera.updateProjectionMatrix();
    this.onZoomLevelChange(this.camera.zoom);

  }

  #createCompass(size) {
    const map = new THREE.TextureLoader().load('images/compass.svg');
    const material = new THREE.SpriteMaterial({ map: map, color: 0xffffff });
    const sprite = new THREE.Sprite(material);
    sprite.center.set(0.5, 0.5);
    sprite.scale.set(size, size, 1);
    sprite.position.set(this.scene.width / 2 - 60, -this.scene.height / 2 + 60, 1); // bottom right
    return sprite;
  }

  #createRatioText() {
    //https://discourse.threejs.org/t/how-to-update-text-in-real-time/39050/12
    const position = new THREE.Vector3(0, -this.scene.height / 2 + 45, 1);
    return new TextSprite('10 m', position, { size: 40, family: 'Helvetica Neue', strokeColor: 'black' }, 0.5);

  }

  #createRatioIndicator(width) {
    const map = new THREE.TextureLoader().load('images/ratio.png');
    const material = new THREE.SpriteMaterial({ map: map, color: 0xffffff });
    const sprite = new THREE.Sprite(material);
    sprite.center.set(0.5, 0.5);
    sprite.scale.set(width, (width / 605) * 35, 1);
    sprite.position.set(0, -this.scene.height / 2 + 20, 1); // bottom right
    sprite.width = width; // custom property
    return sprite;
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
