import * as THREE from 'three';
import { Polar } from '../model.js';

// Base class for view controls with common functionality
export class BaseViewControl {
  constructor(camera, domElement) {
    this.camera = camera;
    this.domElement = domElement;
    this.target = new THREE.Vector3();
    this.zoom = 1;
    this._100pixelsInWorldUnites = 0;
    this.enabled = false;

    this.state = 'none';
    this.startX = 0;
    this.startPan = new THREE.Vector2();
    this.isPanning = false;

    this.setupEventListeners();
  }

  setTarget(target) {
    this.target.copy(target);
    this.updateCameraPosition();
  }

  getTarget() {
    return this.target.clone();
  }

  getCameraPosition() {
    return this.camera.position.clone();
  }

  setupEventListeners() {
    this.domElement.addEventListener('pointerdown', this.onPointerDown.bind(this));
    this.domElement.addEventListener('pointermove', this.onPointerMove.bind(this));
    this.domElement.addEventListener('pointerup', this.onPointerUp.bind(this));
    this.domElement.addEventListener('wheel', this.onWheel.bind(this));
  }

  onPointerDown(event) {
    if (!this.enabled) return;

    if (event.ctrlKey || event.metaKey || event.shiftKey) {
      // Pan mode
      this.state = 'pan';
      this.isPanning = true;
      this.startPan.set(event.clientX, event.clientY);
    } else {
      // Rotate mode - to be implemented by subclasses
      this.state = 'rotate';
      this.startX = event.clientX;
    }

    this.dispatchEvent('start');
  }

  onPointerUp() {
    if (!this.enabled) return;

    if (this.state === 'rotate') {
      this.dispatchEvent('end', { type: 'rotate' });
    } else if (this.state === 'pan') {
      this.dispatchEvent('end', { type: 'pan' });
    }
    this.state = 'none';
    this.isPanning = false;
  }

  onWheel(event) {
    if (!this.enabled) return;

    event.preventDefault();

    // Zoom in/out
    const zoomSpeed = 0.1;

    let newZoom;
    if (event.deltaY < 0) {
      newZoom = this.zoom * (1 + zoomSpeed);
    } else {
      newZoom = this.zoom / (1 + zoomSpeed);
    }

    this.setZoomLevel(newZoom);

    // Dispatch change event
    this.dispatchEvent('orbitChange', { type: 'zoom', level: this.zoom });
  }

  onRotationEnd() {
    this.dispatchEvent('end', { type: 'rotate' }); // for update frustum frame and overview camera
  }

  getWorldUnitsForPixels(pixels) {
    return this._100pixelsInWorldUnites / (100 / pixels);
  }

  setZoomLevel(level) {

    if (this.zoom === level) return;

    this.zoom = level;
    this._100pixelsInWorldUnites =
      ((100 / this.domElement.getBoundingClientRect().width) * this.camera.width) / this.zoom;
    this.camera.zoom = this.zoom;
    this.camera.updateProjectionMatrix();

  }

  addEventListener(type, listener) {
    if (!this.listeners) this.listeners = new Map();
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }

  removeEventListener(type, listener) {
    if (this.listeners && this.listeners.has(type)) {
      this.listeners.get(type).splice(this.listeners.get(type).indexOf(listener), 1);
    }
  }

  dispatchEvent(type, params) {
    if (this.listeners && this.listeners.has(type)) {
      this.listeners.get(type).forEach((listener) => listener(params));
    }
  }
}

// Custom camera control for ProfileView - restricts camera to X-Y circle around 3d objects
export class ProfileViewControl extends BaseViewControl {
  constructor(camera, domElement) {
    super(camera, domElement);
    this.radius = 100; // Distance from cave center
    this.angle = 0;
  }

  getRadius() {
    return this.radius;
  }

  getAngle() {
    return this.angle;
  }

  setAngle(angle) {
    this.angle = angle;
    this.#update();
  }

  setRadius(radius) {
    this.radius = radius;
    this.#update();
  }

  #update() {
    this.updateCameraPosition();
    this.dispatchEvent('orbitSet', { type: 'rotate', angle: this.angle });
  }

  updateCameraPosition() {
    // Calculate camera position on the X-Y circle
    // 0° = North (Y axis), 90° = East (X axis), rotation goes clockwise
    const x = this.target.x + this.radius * Math.sin(this.angle);
    const y = this.target.y + this.radius * Math.cos(this.angle);
    const z = this.target.z;

    this.camera.position.set(x, y, z);
    this.camera.lookAt(this.target);
    // Ensure camera up vector is always (0, 0, 1) for consistent side view
    this.camera.up.set(0, 0, 1);
    this.camera.updateMatrixWorld();
    this.camera.updateProjectionMatrix();
  }

  onPointerMove(event) {
    if (!this.enabled) return;

    if (this.state === 'rotate') {
      // Simple horizontal mouse movement to rotate camera around the circle
      const deltaX = event.clientX - this.startX;
      const sensitivity = 0.01; // Adjust this value for rotation speed

      // Update camera angle based on horizontal mouse movement
      this.angle = (this.angle + deltaX * sensitivity) % (2 * Math.PI);
      if (this.angle < 0) this.angle += 2 * Math.PI;

      // Update start position for next frame
      this.startX = event.clientX;

      this.updateCameraPosition();
      this.dispatchEvent('orbitChange', { type: 'rotate', angle: this.angle });

    } else if (this.state === 'pan') {
      // Pan the target (cave center) based on mouse movement
      const rect = this.domElement.getBoundingClientRect();
      const deltaX = event.clientX - this.startPan.x;
      const deltaY = event.clientY - this.startPan.y;

      // Convert screen movement to world movement
      const worldDeltaX = ((deltaX / rect.width) * this.camera.width) / this.zoom;
      const worldDeltaY = ((deltaY / rect.height) * this.camera.height) / this.zoom;

      // Calculate how much X movement should go to X vs Y based on camera angle
      const cosAngle = Math.cos(this.angle);
      const sinAngle = Math.sin(this.angle);

      // Camera-relative panning: X movement goes to X or Y based on camera angle
      // Y movement always goes to Z (depth)
      const panOffsetX = worldDeltaX * cosAngle;
      const panOffsetY = worldDeltaX * sinAngle;
      const panOffsetZ = worldDeltaY;

      this.target.x += panOffsetX;
      this.target.y += panOffsetY;
      this.target.z += panOffsetZ;

      this.camera.position.x += panOffsetX;
      this.camera.position.y += panOffsetY;
      this.camera.position.z += panOffsetZ;

      this.startPan.set(event.clientX, event.clientY);

      // Force camera matrix updates
      this.camera.lookAt(this.target);
      this.camera.updateMatrixWorld();
      this.camera.updateProjectionMatrix();
      this.dispatchEvent('orbitChange', { type: 'pan', offset: new THREE.Vector3(panOffsetX, panOffsetY, panOffsetZ) });
    }
  }
}

// Custom camera control for PlanView - shows X-Y plane from top (positive Z direction)
export class PlanViewControl extends BaseViewControl {
  constructor(camera, domElement) {
    super(camera, domElement);
    this.height = 100; // Distance above the cave center (Z coordinate)
    this.azimuth = 0;
    this.startY = 0;
    this.startAngle = 0;
  }

  getHeight() {
    return this.height;
  }

  getRotation() {
    let r = -this.azimuth + Math.PI;
    if (r < 0) r += 2 * Math.PI;
    return r;
  }

  getAzimuth() {
    return this.azimuth;
  }

  setHeight(height) {
    this.height = height;
    this.#update();
  }

  setRotation(rotation) {
    let r = -rotation + Math.PI;
    if (r < 0) r += 2 * Math.PI;
    this.azimuth = r;
    this.#update();
  }

  #update() {
    this.updateCameraPosition();
    this.dispatchEvent('orbitSet', { type: 'rotate', rotation: this.camera.rotation.z });
  }

  updateCameraPosition() {
    // Position camera above the target looking down
    this.camera.position.set(this.target.x, this.target.y, this.target.z + this.height);
    this.camera.lookAt(this.target);
    this.camera.rotation.z = this.azimuth;
    // Ensure camera up vector is always (0, 1, 0) for consistent top-down view
    this.camera.up.set(0, 1, 0);
    this.camera.updateMatrixWorld();
    this.camera.updateProjectionMatrix();
  }

  onPointerDown(event) {
    if (!this.enabled) return;

    if (event.ctrlKey || event.metaKey || event.shiftKey) {
      // Pan mode
      this.state = 'pan';
      this.isPanning = true;
      this.startPan.set(event.clientX, event.clientY);
    } else {
      // Rotate mode - rotate camera around Z axis
      this.state = 'rotate';
      this.startX = event.clientX;
      this.startY = event.clientY;
      // Calculate start angle from center of the element
      const rect = this.domElement.getBoundingClientRect();
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      this.startAngle = Math.atan2(event.clientY - centerY, event.clientX - centerX);
    }

    this.dispatchEvent('start');
  }

  onPointerMove(event) {
    if (!this.enabled) return;

    if (this.state === 'rotate') {
      // Rotate camera around Z axis (top-down rotation)
      const rect = this.domElement.getBoundingClientRect();
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;

      // Calculate current angle from center
      const currentAngle = Math.atan2(event.clientY - centerY, event.clientX - centerX);
      let angleDiff = currentAngle - this.startAngle;

      // Apply rotation to camera around Z axis
      let newRotation = (this.camera.rotation.z + angleDiff) % (2 * Math.PI);
      if (newRotation < 0) newRotation += 2 * Math.PI;

      this.azimuth = newRotation;
      this.camera.rotation.z = newRotation;
      this.startAngle = currentAngle;

      this.dispatchEvent('orbitChange', { type: 'rotate', rotation: this.camera.rotation.z });

    } else if (this.state === 'pan') {
      // Pan the camera and target in X-Y plane relative to camera rotation
      const rect = this.domElement.getBoundingClientRect();
      const deltaX = event.clientX - this.startPan.x;
      const deltaY = event.clientY - this.startPan.y;

      // Convert screen movement to world movement
      const worldDeltaX = ((deltaX / rect.width) * this.camera.width) / this.zoom;
      const worldDeltaY = ((deltaY / rect.height) * this.camera.height) / this.zoom;

      // Get current camera rotation
      const rotationZ = this.camera.rotation.z;

      // Transform world movement to be relative to camera rotation
      // When camera is rotated, we need to rotate the pan direction accordingly
      const cosRotation = Math.cos(rotationZ);
      const sinRotation = Math.sin(rotationZ);

      const panOffsetX = -worldDeltaX * cosRotation - worldDeltaY * sinRotation;
      const panOffsetY = -worldDeltaX * sinRotation + worldDeltaY * cosRotation;

      this.target.x += panOffsetX;
      this.target.y += panOffsetY;

      // Update camera position directly to preserve rotation
      this.camera.position.x += panOffsetX;
      this.camera.position.y += panOffsetY;

      // Force camera matrix updates without resetting rotation
      this.camera.updateMatrixWorld();
      this.camera.updateProjectionMatrix();

      this.startPan.set(event.clientX, event.clientY);

      this.dispatchEvent('orbitChange', { type: 'pan', offset: new THREE.Vector3(panOffsetX, panOffsetY, 0) });
    }
  }
}

// Custom camera control for SpatialView - allows full 3D rotation around objects
export class SpatialViewControl extends BaseViewControl {
  constructor(camera, domElement) {
    super(camera, domElement);
    this.distance = 100; // Fixed distance from target
    this.azimuth = 0; // Horizontal rotation (0° = North, increases clockwise)
    this.clino = 0; // Vertical angle (-90° = down, 0° = horizontal, +90° = up)

    this.startAzimuth = 0;
    this.startClino = 0;
    this.startX = 0;
    this.startY = 0;
  }

  setDistance(distance) {
    this.distance = distance;
    this.updateCameraPosition();
  }

  getDistance() {
    return this.distance;
  }

  getAzimuth() {
    return this.azimuth;
  }

  getClino() {
    return this.clino;
  }

  updateCameraPosition() {
    // Calculate camera position using spherical coordinates
    const polar = new Polar(this.distance, this.azimuth, this.clino);
    const v = polar.toVector();
    const x = this.target.x + v.x;
    const y = this.target.y + v.y;
    const z = this.target.z + v.z;

    this.camera.position.set(x, y, z);
    this.camera.lookAt(this.target);

    // Ensure camera up vector is always pointing up relative to world
    this.camera.up.set(0, 0, 1);
    this.camera.updateMatrixWorld();
    this.camera.updateProjectionMatrix();
  }

  onPointerDown(event) {
    if (!this.enabled) return;

    if (event.shiftKey) {
      // Pan mode with shift key
      this.state = 'pan';
      this.isPanning = true;
      this.startPan.set(event.clientX, event.clientY);
    } else {
      // Rotate mode - full 3D rotation
      this.state = 'rotate';
      this.startX = event.clientX;
      this.startY = event.clientY;
      this.startAzimuth = this.azimuth;
      this.startClino = this.clino;
    }

    this.dispatchEvent('start');
  }

  onPointerMove(event) {
    if (!this.enabled) return;

    if (this.state === 'rotate') {
      // Full 3D rotation around target
      const deltaX = event.clientX - this.startX;
      const deltaY = event.clientY - this.startY;

      // Convert mouse movement to rotation angles
      const azimuthSpeed = 0.01; // Adjust sensitivity
      const clinoSpeed = 0.01;

      // Update azimuth (horizontal rotation)
      this.azimuth = this.startAzimuth + deltaX * azimuthSpeed; // azimuth is inverted

      // Update clino (vertical rotation) with constraints
      let newClino = this.startClino - deltaY * clinoSpeed;
      newClino = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, newClino)); // Prevent gimbal lock
      this.clino = newClino;

      // Update camera position
      this.updateCameraPosition();
      this.dispatchEvent('orbitChange', { type: 'rotate', azimuth: this.azimuth, clino: this.clino });

    } else if (this.state === 'pan') {
      // Pan the target (cave center) based on mouse movement
      const rect = this.domElement.getBoundingClientRect();
      const deltaX = event.clientX - this.startPan.x;
      const deltaY = event.clientY - this.startPan.y;

      // Convert screen movement to world movement
      const worldDeltaX = ((deltaX / rect.width) * this.camera.width) / this.zoom;
      const worldDeltaY = ((deltaY / rect.height) * this.camera.height) / this.zoom;

      // Calculate pan direction in world space
      // We need to pan relative to the camera's current orientation
      const cameraDirection = new THREE.Vector3();
      this.camera.getWorldDirection(cameraDirection);

      // Create right and up vectors for camera-relative panning
      const cameraRight = new THREE.Vector3();
      cameraRight.crossVectors(cameraDirection, this.camera.up).normalize();
      const cameraUp = new THREE.Vector3();
      cameraUp.crossVectors(cameraRight, cameraDirection).normalize();

      // Calculate pan offset in world space
      const panOffsetX = -worldDeltaX * cameraRight.x - worldDeltaY * cameraUp.x;
      const panOffsetY = -worldDeltaX * cameraRight.y - worldDeltaY * cameraUp.y;
      const panOffsetZ = worldDeltaX * cameraRight.z - worldDeltaY * cameraUp.z;

      // Apply pan to target
      this.target.x += panOffsetX;
      this.target.y += panOffsetY;
      this.target.z -= panOffsetZ; // z axis is inverted

      // Update camera position to maintain distance
      this.updateCameraPosition();

      this.startPan.set(event.clientX, event.clientY);

      this.dispatchEvent('orbitChange', { type: 'pan', offset: new THREE.Vector3(panOffsetX, panOffsetY, panOffsetZ) });
    }
  }

  // Method to set camera to specific azimuth and clino
  setCameraOrientation(distance, azimuth, clino) {
    this.distance = distance;
    this.clino = clino;
    this.azimuth = azimuth % (2 * Math.PI);
    if (this.azimuth < 0) this.azimuth += 2 * Math.PI;

    this.updateCameraPosition();
    this.dispatchEvent('orbitSet', { type: 'rotate', azimuth: this.azimuth, clino: this.clino });
  }

  // Method to get current camera orientation as polar coordinates
  getCameraOrientation() {
    return {
      distance : this.distance,
      azimuth  : this.azimuth,
      clino    : this.clino
    };
  }
}
