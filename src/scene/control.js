import * as THREE from 'three';

// Custom camera control for ProfileView - restricts camera to X-Y circle around 3d objects
export class ProfileViewControl {
  constructor(camera, domElement) {
    this.camera = camera;
    this.domElement = domElement;
    this.target = new THREE.Vector3();
    this.radius = 100; // Distance from cave center
    this.angle = 0; // Current angle on the circle (0 = right, π/2 = up, π = left, 3π/2 = down)
    this.zoom = 1;
    this.enabled = false;

    this.state = 'none';
    this.startX = 0;
    this.startZoom = 1;
    this.startPan = new THREE.Vector2();
    this.isPanning = false;
    this.manualCameraPosition = false;

    this.setupEventListeners();
  }

  setTarget(target) {
    this.target.copy(target);
    this.updateCameraPosition();
  }

  setRadius(radius) {
    this.radius = radius;
    this.updateCameraPosition();
  }

  getTarget() {
    return this.target.clone();
  }

  getCameraPosition() {
    return this.camera.position.clone();
  }

  updateCameraPosition() {
    // Calculate camera position on the X-Y circle
    const x = this.target.x + this.radius * Math.cos(this.angle);
    const y = this.target.y + this.radius * Math.sin(this.angle);
    const z = this.target.z;

    this.camera.position.set(x, y, z);
    this.camera.lookAt(this.target);
    // Ensure camera up vector is always (0, 0, 1) for consistent side view
    this.camera.up.set(0, 0, 1);
    this.camera.updateMatrixWorld();
    this.camera.updateProjectionMatrix();
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
      // Rotate mode - move camera around the circle
      this.state = 'rotate';
      this.startX = event.clientX;
    }

    this.dispatchEvent('start');
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
      const panOffsetX = -worldDeltaX * sinAngle;
      const panOffsetY = -worldDeltaX * cosAngle;
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
    if (event.deltaY < 0) {
      this.zoom *= 1 + zoomSpeed;
    } else {
      this.zoom /= 1 + zoomSpeed;
    }

    // Clamp zoom
    //this.zoom = Math.max(0.1, Math.min(10, this.zoom));

    this.camera.zoom = this.zoom;
    this.camera.updateProjectionMatrix();

    // Dispatch change event
    this.dispatchEvent('orbitChange', { type: 'zoom', level: this.zoom });
  }

  addEventListener(type, listener) {
    if (!this.listeners) this.listeners = new Map();
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }

  dispatchEvent(type, params) {
    if (this.listeners && this.listeners.has(type)) {
      this.listeners.get(type).forEach((listener) => listener(params));
    }
  }

}
