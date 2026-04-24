/*
 * Copyright 2024 Joe Meszaros
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as THREE from 'three';
import { Polar } from '../model.js';

/*
 * Camera controls for the three built-in views.
 *
 * Hierarchy:
 *   BaseViewControl (abstract)
 *     ├── ProfileViewControl       — camera on an X-Y circle, looking sideways (Z up)
 *     ├── PlanViewControl          — camera above target, looking straight down
 *     └── SpatialControlBase       — spherical orbit (azimuth, clino, distance)
 *           ├── SpatialOrthographicControl  — wheel scales camera.zoom
 *           └── SpatialPerspectiveControl   — wheel dollies camera.position
 *
 * Each control owns one camera and one DOM element and translates pointer /
 * wheel events into camera motion. It never renders — it just updates the
 * camera transform and dispatches 'start' / 'end' / 'orbitChange' / 'orbitSet'
 * events that the View listens to for re-rendering and UI updates.
 */

// Base class for view controls with common functionality: event wiring, button
// semantics, pan/rotate state machine, and a tiny custom event system used by
// subclasses to notify the View of motion.
export class BaseViewControl {
  constructor(camera, domElement) {
    this.camera = camera;
    this.domElement = domElement;
    this.target = new THREE.Vector3();
    this.zoom = 1;
    // Cached world-units-per-100-pixels at the current zoom, used by
    // getWorldUnitsForPixels() to size raycast radii and sprite scales.
    // 100px was picked as a convenient scale reference; the actual pixel
    // count is divided out in the getter.
    this._100pixelsInWorldUnites = 0;
    this.enabled = false;

    // Drag state machine. 'rotate' and 'pan' are driven by pointer-down +
    // pointer-move; 'none' means idle. Subclasses inspect `state` in their
    // onPointerMove to decide which math to run.
    this.state = 'none';
    this.startX = 0;
    this.startY = 0;
    this.startPan = new THREE.Vector2();
    this.isPanning = false;
    this.isTouchDevice = this.#detectTouchDevice();

    this.setupEventListeners();
  }

  #detectTouchDevice() {
    return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
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
    // Pointer events unify mouse + touch + pen — a single code path handles all
    // input devices.
    this.domElement.addEventListener('pointerdown', this.onPointerDown.bind(this));
    this.domElement.addEventListener('pointermove', this.onPointerMove.bind(this));
    this.domElement.addEventListener('pointerup', this.onPointerUp.bind(this));
    this.domElement.addEventListener('pointercancel', this.onPointerUp.bind(this));
    // passive: true tells the browser we won't preventDefault() on wheel, which
    // lets it scroll-compose without blocking the main thread (Chrome warns
    // otherwise and throttles non-passive wheel handlers on slow frames).
    this.domElement.addEventListener('wheel', this.onWheel.bind(this), { passive: true });

    // Right-click is used for pan, so suppress the native context menu that
    // would otherwise steal the second-click and interrupt drag-to-pan.
    this.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  onPointerDown(event) {
    if (!this.enabled) return;

    // Record anchor coords. Rotate subclasses use (startX, startY) as the drag
    // origin; pan uses startPan (a Vector2) so it can be updated progressively
    // without disturbing the rotate anchor.
    this.startX = event.clientX;
    this.startY = event.clientY;
    this.startPan.set(event.clientX, event.clientY);

    if (this.isTouchDevice) {
      // Touch: one finger always pans (Google Maps feel). Rotation on touch
      // would conflict with browser pinch-zoom and tap-scrolls.
      this.state = 'pan';
      this.isPanning = true;
    } else {
      // Mouse button mapping:
      //   button 0 (left)   — rotate, or pan with Ctrl/Meta/Shift
      //   button 1 (middle) — pan
      //   button 2 (right)  — pan (context menu suppressed in setupEventListeners)
      if (event.button === 2 || event.button === 1) {
        this.state = 'pan';
        this.isPanning = true;
      } else if (event.button === 0) {
        if (event.ctrlKey || event.metaKey || event.shiftKey) {
          this.state = 'pan';
          this.isPanning = true;
        } else {
          // Actual rotate math lives in subclass onPointerMove — the base class
          // only sets the state flag.
          this.state = 'rotate';
        }
      }
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

  // Default wheel handler is orthographic: multiplicative scaling of
  // camera.zoom. SpatialPerspectiveControl overrides this to translate the
  // camera instead (dolly), because perspective "zoom" via FOV is visually
  // confusing.
  onWheel(event) {
    if (!this.enabled) return;

    const zoomSpeed = 0.1;

    // Multiplicative so zoom-in / zoom-out are exact inverses and the feel
    // is uniform at any current zoom level.
    let newZoom;
    if (event.deltaY < 0) {
      newZoom = this.zoom * (1 + zoomSpeed);
    } else {
      newZoom = this.zoom / (1 + zoomSpeed);
    }

    this.setZoomLevel(newZoom);

    this.dispatchEvent('orbitChange', { type: 'zoom', level: this.zoom });
  }

  onRotationEnd() {
    this.dispatchEvent('end', { type: 'rotate' }); // for update frustum frame and overview camera
  }

  // Used for hit-test radii, sprite scaling, grid spacing — anywhere a
  // consumer wants "how big is N pixels in world units right now".
  getWorldUnitsForPixels(pixels) {
    return this._100pixelsInWorldUnites / (100 / pixels);
  }

  // Recompute the pixels↔world conversion when the viewport changes size.
  // Reads camera.width, which is ortho-specific; SpatialPerspectiveControl
  // overrides this to a no-op and computes its conversion on demand.
  onResize() {
    this._100pixelsInWorldUnites =
      ((100 / this.domElement.getBoundingClientRect().width) * this.camera.width) / this.zoom;
  }

  getZoomLevel() {
    return this.zoom;
  }

  // Orthographic zoom: scales camera.zoom, which shrinks/grows the frustum
  // without moving the camera. Perspective subclasses leave this alone and
  // translate the camera instead.
  setZoomLevel(level) {

    if (this.zoom === level) return;

    this.zoom = level;
    this._100pixelsInWorldUnites =
      ((100 / this.domElement.getBoundingClientRect().width) * this.camera.width) / this.zoom;
    this.camera.zoom = this.zoom;
    this.camera.updateProjectionMatrix();

  }

  // Minimal custom event system (intentionally not THREE.EventDispatcher to keep
  // the listeners accessible as a plain Map — SpatialView.setProjection walks
  // the map to migrate external listeners across a projection swap).
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

// Custom camera control for ProfileView. The camera orbits around the target
// on a horizontal circle in the X-Y plane, always looking horizontally (Z up).
// Rotating the view corresponds to walking around the cave at a fixed altitude
// and looking in. Panning shifts the target (and camera) in a camera-relative
// basis so the viewer can slide along the passage.
export class ProfileViewControl extends BaseViewControl {
  constructor(camera, domElement, angle = 0) {
    super(camera, domElement);
    this.radius = 100; // Horizontal distance between camera and target (world units)
    this.angle = angle; // 0 = looking south (camera north of target), rotates clockwise
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
      // Incremental rotation: use (clientX - startX) and then move the anchor.
      // This is simpler than SpatialControlBase's "lock startAzimuth at
      // pointer-down" approach and is fine here because there's only one DOF.
      const deltaX = event.clientX - this.startX;
      const sensitivity = 0.01;

      this.angle = (this.angle + deltaX * sensitivity) % (2 * Math.PI);
      if (this.angle < 0) this.angle += 2 * Math.PI;

      this.startX = event.clientX;

      this.updateCameraPosition();
      this.dispatchEvent('orbitChange', { type: 'rotate', angle: this.angle });

    } else if (this.state === 'pan') {
      // Pan target + camera together so the camera→target distance is preserved.
      const rect = this.domElement.getBoundingClientRect();
      const deltaX = event.clientX - this.startPan.x;
      const deltaY = event.clientY - this.startPan.y;

      // Screen pixels → world units via the ortho frustum size and zoom.
      const worldDeltaX = ((deltaX / rect.width) * this.camera.width) / this.zoom;
      const worldDeltaY = ((deltaY / rect.height) * this.camera.height) / this.zoom;

      // Camera is always horizontal: screen-X maps into the horizontal plane
      // (X,Y) at the current angle; screen-Y maps directly to world Z
      // (altitude). That makes drag-right always slide sideways and drag-up
      // always go up, regardless of the orbit angle.
      const cosAngle = Math.cos(this.angle);
      const sinAngle = Math.sin(this.angle);

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

// Custom camera control for PlanView — a top-down map-style projection. The
// camera sits directly above the target and looks straight down; rotation spins
// the view around the Z axis (like turning a paper map). No tilt is possible.
export class PlanViewControl extends BaseViewControl {
  constructor(camera, domElement) {
    super(camera, domElement);
    this.height = 100; // Camera altitude above target along +Z (world units)
    this.azimuth = 0; // Internal camera.rotation.z (radians)
    this.startY = 0;
    this.startAngle = 0;
  }

  getHeight() {
    return this.height;
  }

  // The internal `azimuth` rotates the camera frame, while users think in
  // terms of "where is north on my map" (the compass bearing at the top).
  // The two are inverse-rotations plus a 180° offset, hence the
  //    display = -internal + π
  // conversion used by {get,set}Rotation.
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
    // External callers hand in compass-style rotation — convert to internal
    // frame (see getRotation comment for the formula).
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
    // Camera stacked directly above the target along +Z. lookAt(target) yields
    // a straight-down view; rotation.z then spins the image in screen-plane
    // (same effect as turning a physical map).
    this.camera.position.set(this.target.x, this.target.y, this.target.z + this.height);
    this.camera.lookAt(this.target);
    this.camera.rotation.z = this.azimuth;
    // +Y as up so screen-up maps to world +Y (north) before azimuth rotation.
    this.camera.up.set(0, 1, 0);
    this.camera.updateMatrixWorld();
    this.camera.updateProjectionMatrix();
  }

  onPointerDown(event) {
    if (!this.enabled) return;

    // Let base class set the button-based state (rotate vs pan).
    super.onPointerDown(event);

    if (this.state === 'rotate') {
      // Rotation is "grab a point and swing" — we need the vector from the
      // element's center to the pointer to measure angular change. Cache the
      // initial angle so onPointerMove can compute an incremental delta.
      this.startY = event.clientY;
      const rect = this.domElement.getBoundingClientRect();
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      this.startAngle = Math.atan2(event.clientY - centerY, event.clientX - centerX);
    }
  }

  onPointerMove(event) {
    if (!this.enabled) return;

    if (this.state === 'rotate') {
      // Swing rotation: the pointer's angle around the viewport center drives
      // camera.rotation.z. Incremental (uses delta from last frame's angle)
      // so long drags don't accumulate floating-point error.
      const rect = this.domElement.getBoundingClientRect();
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;

      const currentAngle = Math.atan2(event.clientY - centerY, event.clientX - centerX);
      let angleDiff = currentAngle - this.startAngle;

      let newRotation = (this.camera.rotation.z + angleDiff) % (2 * Math.PI);
      if (newRotation < 0) newRotation += 2 * Math.PI;

      this.azimuth = newRotation;
      this.camera.rotation.z = newRotation;
      this.startAngle = currentAngle;

      this.dispatchEvent('orbitChange', { type: 'rotate', rotation: this.camera.rotation.z });

    } else if (this.state === 'pan') {
      // Slide the map under the viewport. Move target (and camera, to preserve
      // the top-down stack) in the X-Y plane; Z is unaffected.
      const rect = this.domElement.getBoundingClientRect();
      const deltaX = event.clientX - this.startPan.x;
      const deltaY = event.clientY - this.startPan.y;

      const worldDeltaX = ((deltaX / rect.width) * this.camera.width) / this.zoom;
      const worldDeltaY = ((deltaY / rect.height) * this.camera.height) / this.zoom;

      // The camera can be rotated around Z (see setRotation). Pan axes must be
      // rotated into that frame so drag-right always moves the map right from
      // the user's perspective, not in world coords.
      const rotationZ = this.camera.rotation.z;
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

// Shared spherical-orbit control for SpatialView. The camera is positioned on
// a sphere around `target` parameterised by (distance, azimuth, clino) and
// always looks at the target. Left-drag rotates (updates azimuth/clino);
// right-drag or mod+left pans (translates target); wheel does something
// projection-specific — the subclasses wire that up.
//
// Why a base class: orthographic and perspective spatial controls share 90 %
// of their behaviour (rotation math, pan math, pointer-down state machine,
// spherical→Cartesian position math). Only zoom/dolly and screen→world pixel
// mapping differ, and those are delegated to screenToWorldDelta() and
// onWheel().
export class SpatialControlBase extends BaseViewControl {
  constructor(camera, domElement) {
    super(camera, domElement);
    this.distance = 100; // Radius of the orbit sphere (world units)
    this.azimuth = 0; // Horizontal rotation (0° = North, increases clockwise)
    this.clino = 0; // Vertical angle (-90° = down, 0° = horizontal, +90° = up)

    // Anchors captured at pointer-down. Holding these fixed while dragging
    // avoids cumulative rounding error that would drift the orbit angles.
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
    // Spherical: camera = target + Polar(distance, azimuth, clino). Distance
    // must be positive; perspective dolly past the pivot is handled by
    // advancing the target along the view direction (see
    // SpatialPerspectiveControl.onWheel) rather than flipping distance sign.
    const polar = new Polar(this.distance, this.azimuth, this.clino);
    const v = polar.toVector();
    this.camera.position.set(this.target.x + v.x, this.target.y + v.y, this.target.z + v.z);
    this.camera.lookAt(this.target);
    this.camera.up.set(0, 0, 1);
    this.camera.updateMatrixWorld();
    this.camera.updateProjectionMatrix();
  }

  onPointerDown(event) {
    if (!this.enabled) return;

    super.onPointerDown(event);

    if (this.state === 'rotate') {
      // Snapshot the orbit at drag start. onPointerMove reads these anchors
      // plus the pixel delta to compute the absolute new orbit — this avoids
      // the per-frame drift that an incremental approach would accumulate.
      this.startAzimuth = this.azimuth;
      this.startClino = this.clino;
    }
  }

  onPointerMove(event) {
    if (!this.enabled) return;

    if (this.state === 'rotate') {
      // Total pixel delta from the drag origin (not the previous frame).
      const deltaX = event.clientX - this.startX;
      const deltaY = event.clientY - this.startY;
      const azimuthSpeed = 0.01; // radians per pixel ≈ 0.57 °/px
      const clinoSpeed = 0.01;

      this.azimuth = this.startAzimuth + deltaX * azimuthSpeed;
      this.setSafeClino(this.startClino + deltaY * clinoSpeed);

      this.updateCameraPosition();
      this.dispatchEvent('orbitChange', { type: 'rotate', azimuth: this.azimuth, clino: this.clino });

    } else if (this.state === 'pan') {
      // Incremental pan — update startPan after each frame so long drags don't
      // multiply the total pixel delta against screen-to-world every frame
      // (which would make the cursor slip off the content).
      const rect = this.domElement.getBoundingClientRect();
      const pxDx = event.clientX - this.startPan.x;
      const pxDy = event.clientY - this.startPan.y;
      // Subclass-provided pixel→world conversion (ortho: camera.width/zoom;
      // perspective: tan(fov/2) × distance).
      const worldDelta = this.screenToWorldDelta(pxDx, pxDy, rect);

      // Build a camera-relative basis (right, up) so the pan direction matches
      // the user's screen-relative drag regardless of current orbit orientation.
      // The target moves in this basis; updateCameraPosition then re-derives the
      // camera's world position from the new target + unchanged orbit.
      const cameraDirection = new THREE.Vector3();
      this.camera.getWorldDirection(cameraDirection);
      const cameraRight = new THREE.Vector3().crossVectors(cameraDirection, this.camera.up).normalize();
      const cameraUp = new THREE.Vector3().crossVectors(cameraRight, cameraDirection).normalize();

      const panOffset = new THREE.Vector3()
        .addScaledVector(cameraRight, -worldDelta.x) // drag right → content moves left
        .addScaledVector(cameraUp, +worldDelta.y);   // drag down → content moves up

      this.target.add(panOffset);
      this.updateCameraPosition();
      this.startPan.set(event.clientX, event.clientY);
      this.dispatchEvent('orbitChange', { type: 'pan', offset: panOffset.clone() });
    }
  }

  // Clamp clino away from ±90° by ~0.06°. At exactly ±90° the camera's forward
  // direction is parallel to its up vector (0, 0, 1), making lookAt() yield an
  // undefined rotation (gimbal lock — the scene snaps to a random yaw).
  setSafeClino(clino) {
    this.clino = Math.max(-Math.PI / 2 + 0.001, Math.min(Math.PI / 2 - 0.001, clino));
  }

  // Programmatic orbit set (used by ViewHelper axis clicks, fitScreen, and
  // projection swaps). Normalizes azimuth into [0, 2π) and gimbal-clamps clino.
  setCameraOrientation(distance, azimuth, clino) {
    this.distance = distance;
    this.setSafeClino(clino);
    this.azimuth = azimuth % (2 * Math.PI);
    if (this.azimuth < 0) this.azimuth += 2 * Math.PI;

    this.updateCameraPosition();
    this.dispatchEvent('orbitSet', { type: 'rotate', azimuth: this.azimuth, clino: this.clino });
  }

  getCameraOrientation() {
    return {
      distance : this.distance,
      azimuth  : this.azimuth,
      clino    : this.clino
    };
  }

  /**
   * Convert a screen-space delta (pixels) to a world-space delta used by the
   * shared pan handler. Ortho and perspective subclasses differ here.
   * @returns {{x:number, y:number}}
   */
  // eslint-disable-next-line no-unused-vars
  screenToWorldDelta(pxDx, pxDy, rect) {
    throw new Error('screenToWorldDelta must be implemented by subclass');
  }
}

// Orthographic spatial control — zoom scales camera.zoom, pan uses camera.width/zoom.
export class SpatialOrthographicControl extends SpatialControlBase {

  screenToWorldDelta(pxDx, pxDy, rect) {
    return {
      x : ((pxDx / rect.width) * this.camera.width) / this.zoom,
      y : ((pxDy / rect.height) * this.camera.height) / this.zoom
    };
  }
}

// Perspective spatial control — zoom dollies the camera along the view axis.
// Distance is clamped to a small positive minimum; if the wheel would push it
// below the clamp, the pivot is advanced along the view direction so the
// camera keeps flying forward (and keeps looking forward) indefinitely. Pan
// uses perspective unprojection at the pivot depth.
export class SpatialPerspectiveControl extends SpatialControlBase {

  static MIN_DISTANCE = 0.05;

  onWheel(event) {
    if (!this.enabled) return;

    // Additive dolly with a step proportional to current distance so the feel
    // stays natural at any scale.
    const sign = event.deltaY < 0 ? -1 : 1; // scroll up = dolly in (decrease distance)
    const step = Math.min(Math.max(this.distance * 0.1, 0.05), 50);
    let newDistance = this.distance + sign * step;

    if (newDistance < SpatialPerspectiveControl.MIN_DISTANCE) {
      // Flying forward past the pivot: clamp distance and translate the pivot
      // along the camera's view direction by the overshoot, so the camera
      // keeps moving forward without lookAt flipping behind it.
      const overshoot = SpatialPerspectiveControl.MIN_DISTANCE - newDistance;
      const forward = new THREE.Vector3();
      this.camera.getWorldDirection(forward);
      this.target.addScaledVector(forward, overshoot);
      newDistance = SpatialPerspectiveControl.MIN_DISTANCE;
    }

    this.distance = newDistance;

    this.updateCameraPosition();
    this.dispatchEvent('orbitChange', { type: 'dolly', distance: this.distance });
  }

  screenToWorldDelta(pxDx, pxDy, rect) {
    const fovRad = ((this.camera.fov ?? 60) * Math.PI) / 180;
    const worldHeight = 2 * Math.tan(fovRad / 2) * Math.max(Math.abs(this.distance), 0.01);
    const aspect = this.camera.aspect || rect.width / rect.height;
    const worldWidth = worldHeight * aspect;
    return {
      x : (pxDx / rect.width) * worldWidth,
      y : (pxDy / rect.height) * worldHeight
    };
  }

  // Pixel-to-world in perspective is depth-dependent; approximate by the pivot
  // depth (which is what the user is looking at) so pick radii and start-point
  // sphere sizes scale sensibly when dollying in and out.
  getWorldUnitsForPixels(pixels) {
    const rect = this.domElement.getBoundingClientRect();
    const fovRad = ((this.camera.fov ?? 60) * Math.PI) / 180;
    return (pixels / rect.height) * 2 * Math.tan(fovRad / 2) * Math.max(Math.abs(this.distance), 0.01);
  }

  onResize() {
    // Inherited impl reads ortho-only `camera.width`; no-op here — the
    // on-demand getWorldUnitsForPixels handles all callers.
  }
}
