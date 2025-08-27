import * as THREE from 'three';

// Base class for view controls with common functionality
export class BaseViewControl {
  constructor(camera, domElement) {
    this.camera = camera;
    this.domElement = domElement;
    this.target = new THREE.Vector3();
    this.zoom = 1;
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
    if (event.deltaY < 0) {
      this.zoom *= 1 + zoomSpeed;
    } else {
      this.zoom /= 1 + zoomSpeed;
    }

    // Clamp zoom
    this.zoom = Math.max(0.1, Math.min(10, this.zoom));

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

// Custom camera control for ProfileView - restricts camera to X-Y circle around 3d objects
export class ProfileViewControl extends BaseViewControl {
  constructor(camera, domElement) {
    super(camera, domElement);
    this.radius = 100; // Distance from cave center
    this.angle = 0; // Current angle on the circle (0 = right, π/2 = up, π = left, 3π/2 = down)
  }

  setRadius(radius) {
    this.radius = radius;
    this.updateCameraPosition();
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
}

// Custom camera control for PlanView - shows X-Y plane from top (positive Z direction)
export class PlanViewControl extends BaseViewControl {
  constructor(camera, domElement) {
    super(camera, domElement);
    this.height = 100; // Distance above the cave center (Z coordinate)
    this.startY = 0;
    this.startAngle = 0;
  }

  setHeight(height) {
    this.height = height;
    this.updateCameraPosition();
  }

  updateCameraPosition() {
    // Position camera above the target looking down
    this.camera.position.set(this.target.x, this.target.y, this.target.z + this.height);
    this.camera.lookAt(this.target);
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

      // Calculate angle difference
      let angleDiff = currentAngle - this.startAngle;

      //   // Handle angle wrapping (when crossing -π/π boundary)
      //   if (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
      //   if (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;

      // Apply rotation to camera around Z axis
      this.camera.rotation.z = (this.camera.rotation.z + angleDiff) % (2 * Math.PI);
      if (this.camera.rotation.z < 0) this.camera.rotation.z += 2 * Math.PI;

      // Update start angle for next frame
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
