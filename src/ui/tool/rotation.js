import { wm } from '../window.js';
import { node, degreesToRads, radsToDegrees } from '../../utils/utils.js';

import { i18n } from '../../i18n/i18n.js';

export class RotationTool {

  constructor(scene, panel = '#tool-panel') {
    this.scene = scene;
    this.panel = document.querySelector(panel);
    this.panel.style.width = '400px';

    // Rotation state
    this.currentRotation = 0;
    this.currentDip = 0;
    this.isDragging = false;
    this.isDraggingDip = false;
    this.dragStartAngle = 0;
    this.dragStartRotation = 0;
    this.polar = null;

    // DOM elements (will be set in build)
    this.rotationCanvas = null;
    this.dipCanvas = null;
    this.angleInput = null;
    this.dipInput = null;
    this.spatialControls = null;

    this.onRotationMouseDown = this.handleRotationMouseDown.bind(this);
    this.onDipMouseDown = this.handleDipMouseDown.bind(this);
    this.onMouseMove = this.handleMouseMove.bind(this);
    this.onMouseUp = this.handleMouseUp.bind(this);
    this.onRotationInputChange = this.handleRotationInputChange.bind(this);
    this.onDipInputChange = this.handleDipInputChange.bind(this);
    this.onOrbitChange = this.handleOrbitChange.bind(this);
    this.onViewActivated = this.handleViewActivated.bind(this);
  }

  show() {
    wm.makeFloatingPanel(
      this.panel,
      (contentElmnt) => this.build(contentElmnt),
      'ui.panels.rotation.title',
      false,
      true,
      {},
      (contentElmnt) => {
        this.rotationCanvas.removeEventListener('mousedown', this.onRotationMouseDown);
        this.dipCanvas.removeEventListener('mousedown', this.onDipMouseDown);
        contentElmnt.parentNode.removeEventListener('mousemove', this.onMouseMove);
        contentElmnt.parentNode.removeEventListener('mouseup', this.onMouseUp);
        this.angleInput.removeEventListener('change', this.onRotationInputChange);
        this.dipInput.removeEventListener('change', this.onDipInputChange);
        this.scene.views.forEach((view) => {
          view.control.removeEventListener('orbitChange', this.onOrbitChange);
          view.removeEventListener('viewActivated', this.onViewActivated);
        });

        this.rotationCanvas = null; // avoid detached dom nodes
        this.dipCanvas = null;
        this.angleInput = null;
        this.dipInput = null;
        this.spatialControls = null;
      }
    );
  }

  // Function to draw the rotation circle
  drawRotationCircle(rotation) {
    const ctx = this.rotationCanvas.getContext('2d');
    const centerX = this.rotationCanvas.width / 2;
    const centerY = this.rotationCanvas.height / 2;
    const radius = 70;

    // Clear canvas
    ctx.clearRect(0, 0, this.rotationCanvas.width, this.rotationCanvas.height);

    // Draw circle
    ctx.strokeStyle = '#4CAF50';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
    ctx.stroke();

    // Draw center dot
    ctx.fillStyle = '#4CAF50';
    ctx.beginPath();
    ctx.arc(centerX, centerY, 4, 0, 2 * Math.PI);
    ctx.fill();

    // Draw degree markers
    ctx.fillStyle = '#666';
    ctx.font = '14px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // 0° (right)
    ctx.fillText('90°', centerX + radius + 20, centerY);

    // 90° (up)
    ctx.fillText('0°', centerX, centerY - radius - 10);

    // 180° (left)
    ctx.fillText('270°', centerX - radius - 15, centerY);

    // 270° (down)
    ctx.fillText('180°', centerX, centerY + radius + 10);

    // Draw rotation indicator (line from center to circle edge)
    ctx.strokeStyle = '#FF5722';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    const indicatorX = centerX + radius * Math.sin(rotation);
    const indicatorY = centerY - radius * Math.cos(rotation);
    ctx.lineTo(indicatorX, indicatorY);
    ctx.stroke();

    // Draw arrowhead
    ctx.fillStyle = '#FF5722';
    const arrowSize = 8;
    const angle = Math.atan2(indicatorY - centerY, indicatorX - centerX);
    ctx.beginPath();
    ctx.moveTo(indicatorX, indicatorY);
    ctx.lineTo(
      indicatorX - arrowSize * Math.cos(angle - Math.PI / 6),
      indicatorY - arrowSize * Math.sin(angle - Math.PI / 6)
    );
    ctx.moveTo(indicatorX, indicatorY);
    ctx.lineTo(
      indicatorX - arrowSize * Math.cos(angle + Math.PI / 6),
      indicatorY - arrowSize * Math.sin(angle + Math.PI / 6)
    );
    ctx.stroke();
  }

  // Function to draw the dip half-circle
  drawDipCircle(dip) {
    const ctx = this.dipCanvas.getContext('2d');
    const centerX = 20;
    const centerY = this.dipCanvas.height / 2; // Center vertically
    const radius = 70;

    // Clear canvas
    ctx.clearRect(0, 0, this.dipCanvas.width, this.dipCanvas.height);

    // Draw half-circle (from -90° to +90°) - rotated 90° to be vertical
    ctx.strokeStyle = '#4CAF50';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, -Math.PI / 2, Math.PI / 2, false); // Draw left half (rotated 90°)
    ctx.stroke();

    // Draw degree markers
    ctx.fillStyle = '#666';
    ctx.font = '12px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // 0° (center)
    ctx.fillText('0°', centerX + 15, centerY);

    // -90° (bottom)
    ctx.fillText('-90°', centerX, centerY + radius + 15);

    // +90° (top)
    ctx.fillText('+90°', centerX, centerY - radius - 15);

    // Draw dip indicator
    ctx.strokeStyle = '#FF5722';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);

    // Convert dip (clino) to position on the vertical half-circle
    // -90° maps to -radius (bottom), 0° maps to center, +90° maps to +radius (top)
    const indicatorX = centerX + radius * Math.cos(dip);
    const indicatorY = centerY - radius * Math.sin(dip);

    ctx.lineTo(indicatorX, indicatorY);
    ctx.stroke();

    // Draw arrowhead
    ctx.fillStyle = '#FF5722';
    const arrowSize = 8;
    const angle = Math.atan2(indicatorY - centerY, indicatorX - centerX);
    ctx.beginPath();
    ctx.moveTo(indicatorX, indicatorY);
    ctx.lineTo(
      indicatorX - arrowSize * Math.cos(angle - Math.PI / 6),
      indicatorY - arrowSize * Math.sin(angle - Math.PI / 6)
    );
    ctx.moveTo(indicatorX, indicatorY);
    ctx.lineTo(
      indicatorX - arrowSize * Math.cos(angle + Math.PI / 6),
      indicatorY - arrowSize * Math.sin(angle + Math.PI / 6)
    );
    ctx.stroke();
  }

  // Function to update rotation display
  updateRotationDisplay() {
    const currentView = this.scene.view.name;

    if (currentView !== 'spatialView') {
      this.spatialControls.style.opacity = '30%';
      this.dipInput.disabled = true;
      this.dipInput.value = '90';
      this.currentDip = Math.PI / 2;
      this.drawDipCircle(this.currentDip);
    }
    // Update view label and show/hide spatial controls
    if (currentView === 'planView') {
      this.currentRotation = this.scene.view.control.getRotation();
    } else if (currentView === 'profileView') {
      // For profile view, get the orbital angle from the control
      if (this.scene.view.control && this.scene.view.control.getAngle() !== undefined) {
        this.currentRotation = this.scene.view.control.getAngle();
      } else {
        this.currentRotation = 0;
      }
    } else if (currentView === 'spatialView') {
      // For spatial view, get current polar position
      this.polar = this.scene.view.control.getCameraOrientation();
      this.currentRotation = this.polar.azimuth;
      this.currentDip = this.polar.clino;
      this.spatialControls.style.opacity = '100%';
      this.dipInput.disabled = false;
      this.dipInput.value = Math.round(radsToDegrees(this.currentDip));
      this.drawDipCircle(this.currentDip);
    } else {
      throw Error('Unknown view');
    }
    this.angleInput.value = Math.round(radsToDegrees(this.currentRotation));
    this.drawRotationCircle(this.currentRotation);
  }

  // Function to apply rotation
  applyRotation(rotationRadians) {
    const currentView = this.scene.view.name;
    if (currentView === 'planView') {
      this.scene.view.control.setRotation(rotationRadians);
      this.currentRotation = rotationRadians;
    } else if (currentView === 'profileView') {
      if (this.scene.view.control && this.scene.view.control.getAngle() !== undefined) {
        this.scene.view.control.setAngle(rotationRadians);
        this.currentRotation = rotationRadians;
      }
    } else if (currentView === 'spatialView') {
      // without this little hack the rotation is not smooth around the 90 and 270 angles if the dip is 90 or -90
      // it's because the difff vector x and y components are very close to zero
      if (this.polar.clino === Math.PI / 2 || this.polar.clino === -Math.PI / 2) {
        this.polar.clino -= degreesToRads(0.1);
      }
      this.scene.view.control.setCameraOrientation(this.polar.distance, rotationRadians, this.polar.clino);
      this.currentRotation = rotationRadians;
    }
    this.updateRotationDisplay();
  }

  // Function to apply dip rotation
  applyDipRotation(dipRadians) {
    const currentView = this.scene.view.name;

    if (currentView === 'spatialView') {
      this.scene.view.control.setCameraOrientation(this.polar.distance, this.polar.azimuth, dipRadians);
      this.currentDip = dipRadians;
      this.updateRotationDisplay();
    }
  }

  // Mouse event handlers for canvas dragging
  handleRotationMouseDown(event) {
    this.isDragging = true;
    this.rotationCanvas.style.cursor = 'grabbing';

    const rect = this.rotationCanvas.getBoundingClientRect();
    const centerX = this.rotationCanvas.width / 2;
    const centerY = this.rotationCanvas.height / 2;
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    // Calculate the angle from center to mouse position
    const mouseAngle = Math.atan2(mouseY - centerY, mouseX - centerX);

    // Store the current rotation and the angle difference
    this.dragStartAngle = mouseAngle;
    this.dragStartRotation = this.currentRotation;

    event.preventDefault();
  }

  handleDipMouseDown(event) {
    this.isDraggingDip = true;
    this.dipCanvas.style.cursor = 'grabbing';

    const rect = this.dipCanvas.getBoundingClientRect();
    const centerY = this.dipCanvas.height / 2;
    const mouseY = event.clientY - rect.top;
    const radius = 70; // Same radius as used in drawDipCircle

    // Calculate dip from mouse position on vertical half-circle
    const dy = centerY - mouseY; // Inverted because Y increases downward

    // Map the half-circle to -90° to +90°
    // Bottom of circle (-radius to 0) maps to -90° to 0°
    // Top of circle (0 to +radius) maps to 0° to +90°
    let dip;
    if (dy <= 0) {
      // Bottom side: map -radius to 0 to -90° to 0°
      dip = (dy / radius) * 90;
    } else {
      // Top side: map 0 to +radius to 0° to +90°
      dip = (dy / radius) * 90;
    }

    // Clamp to valid range
    if (dip > 90) dip = 90;
    if (dip < -90) dip = -90;

    this.currentDip = degreesToRads(dip);
    this.applyDipRotation(degreesToRads(dip));
    event.preventDefault();
  }

  handleMouseMove(event) {
    if (!this.isDragging && !this.isDraggingDip) return;

    if (this.isDragging) {
      const rect = this.rotationCanvas.getBoundingClientRect();
      const centerX = this.rotationCanvas.width / 2;
      const centerY = this.rotationCanvas.height / 2;
      const mouseX = event.clientX - rect.left;
      const mouseY = event.clientY - rect.top;

      const currentAngle = Math.atan2(mouseY - centerY, mouseX - centerX);
      let angleDiff = currentAngle - this.dragStartAngle;

      // Handle angle wrapping
      if (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
      if (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;

      // Apply the rotation difference to the starting rotation
      const newRotation = this.dragStartRotation + angleDiff;
      this.applyRotation(newRotation);
    }

    if (this.isDraggingDip) {
      const rect = this.dipCanvas.getBoundingClientRect();
      const centerY = this.dipCanvas.height / 2;
      const mouseY = event.clientY - rect.top;
      const radius = 70; // Same radius as used in drawDipCircle

      // Calculate dip from mouse position on vertical half-circle
      const dy = centerY - mouseY; // Inverted because Y increases downward

      // Map the half-circle to -90° to +90°
      // Bottom of circle (-radius to 0) maps to -90° to 0°
      // Top of circle (0 to +radius) maps to 0° to +90°
      let dip;
      if (dy <= 0) {
        // Bottom side: map -radius to 0 to -90° to 0°
        dip = (dy / radius) * 90;
      } else {
        // Top side: map 0 to +radius to 0° to +90°
        dip = (dy / radius) * 90;
      }

      // Clamp to valid range
      if (dip > 90) dip = 90;
      if (dip < -90) dip = -90;

      this.currentDip = degreesToRads(dip);
      this.applyDipRotation(degreesToRads(dip));
      event.preventDefault();
    }

    event.preventDefault();
  }

  handleMouseUp() {
    if (this.isDragging) {
      this.rotationCanvas.style.cursor = 'grab';
      this.isDragging = false;
      this.scene.view.control.onRotationEnd();
    }

    if (this.isDraggingDip) {
      this.dipCanvas.style.cursor = 'grab';
      this.isDraggingDip = false;
    }
  }

  handleRotationInputChange() {
    let angleDegrees = parseFloat(this.angleInput.value) || 0;
    if (angleDegrees < 0) angleDegrees = 0;
    if (angleDegrees > 360) angleDegrees = 360;
    const angleRadians = degreesToRads(angleDegrees);
    this.applyRotation(angleRadians);
  }

  handleDipInputChange() {
    let dipDegrees = parseFloat(this.dipInput.value) || 0;
    if (dipDegrees > 90) dipDegrees = 90;
    if (dipDegrees < -90) dipDegrees = -90;
    const dipRadians = degreesToRads(dipDegrees);
    this.applyDipRotation(dipRadians);
  }

  handleOrbitChange(e) {
    if (e.type === 'rotate') {
      this.updateRotationDisplay();
    }
  }

  handleViewActivated() {
    this.updateRotationDisplay();
  }

  build(contentElmnt) {
    // Create the rotation control container
    const container = node`
    <div id="rotation-control-container" style="text-align: center; padding: 20px;">
    <div style="float:left; width: 50%;" id="rotation-control">
        <div id="rotation-canvas-container">
            <canvas id="rotation-canvas" width="200" height="200" style="border: 1px solid #ccc; cursor: grab;"></canvas>
        </div>

        <div style="margin-bottom: 20px;">
            <label for="rotation-angle">${i18n.t('ui.panels.rotation.angle')}: <input type="number" id="rotation-angle" step="0.1" style="width: 80px; margin-left: 10px;" /></label>
        </div>
    </div>

    <div style="float:left; width: 50%;" id="dip-control" style="display: none;">
        <div id="dip-canvas-container">
            <canvas id="dip-canvas" width="100" height="200" style="border: 1px solid #ccc; cursor: grab;"></canvas>
        </div>
        <div style="margin-bottom: 20px;">
            <label for="dip-angle">${i18n.t('ui.panels.rotation.dip')}: <input type="number" id="dip-angle" step="0.1" min="-90" max="90" style="width: 80px; margin-left: 10px;" /></label>
        </div>
    </div>
    </div>`;

    contentElmnt.appendChild(container);

    // Store DOM element references
    this.rotationCanvas = container.querySelector('#rotation-canvas');
    this.dipCanvas = container.querySelector('#dip-canvas');
    this.angleInput = container.querySelector('#rotation-angle');
    this.dipInput = container.querySelector('#dip-angle');
    this.spatialControls = container.querySelector('#dip-control');

    //TODO; remove event listeners
    // orbitChange is dispatched by manual rotation by the cursor
    // orbitSet is dispatched by setting the rotation programmatically to the rotation input
    this.scene.views.forEach((view) => {
      view.control.addEventListener('orbitChange', this.onOrbitChange);
      view.addEventListener('viewActivated', this.onViewActivated);
    });

    this.rotationCanvas.addEventListener('mousedown', this.onRotationMouseDown);
    this.dipCanvas.addEventListener('mousedown', this.onDipMouseDown);
    contentElmnt.parentNode.addEventListener('mousemove', this.onMouseMove);
    contentElmnt.parentNode.addEventListener('mouseup', this.onMouseUp);
    this.angleInput.addEventListener('change', this.onRotationInputChange);
    this.dipInput.addEventListener('change', this.onDipInputChange);

    // Initial draw
    this.updateRotationDisplay();
  }
}
