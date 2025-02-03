import * as THREE from 'three';

const STATE = Object.freeze({
  NONE   : 'none',
  ROTATE : 'rotate',
  PAN    : 'pan'
});

const COORDINATE_INDEX = Object.freeze({
  X : 0,
  Y : 1,
  Z : 2
});

class SimpleOrbitControl {

  constructor(camera, domElement, coordinateIndex, zoomMultiplier = 1.2) {
    this.camera = camera;
    this.domElement = domElement;
    this.coordinateIndex = coordinateIndex;
    this.panStart = new THREE.Vector2();
    this.state = STATE.NONE;
    this.startAngle = 0;
    const boxBoundingRect = domElement.getBoundingClientRect();
    this.boxCenter = {
      x : boxBoundingRect.left + boxBoundingRect.width / 2,
      y : boxBoundingRect.top + boxBoundingRect.height / 2
    };
    this.zoomMultiplier = zoomMultiplier;

  }

  setTarget(target) {
    this.target = target;
    this.camera.lookAt(this.target);
    this.camera.updateProjectionMatrix();
  }

  onWheel(event) {
    event.preventDefault();
    if (event.deltaY < 0) {
      this.camera.zoom *= this.zoomMultiplier;
    } else {
      this.camera.zoom /= this.zoomMultiplier;
    }

    this.camera.updateProjectionMatrix();
    this.#dispatchChange('zoom', { level: this.camera.zoom });
  }

  setZoomLevel(level) {
    this.camera.zoom = level;
    this.camera.updateProjectionMatrix();
    this.#dispatchChange('zoom', { level: this.camera.zoom });
  }

  onDown(event) {
    if (event.ctrlKey || event.metaKey || event.shiftKey) {
      this.state = STATE.PAN;
      this.panStart.set(event.clientX, event.clientY);
    } else {
      this.state = STATE.ROTATE;
      this.startAngle = Math.atan2(event.clientX - this.boxCenter.x, -(event.clientY - this.boxCenter.y));
    }
  }

  onUp() {
    if (this.state === STATE.ROTATE) {
      this.#dispatchChange('rotateEnd', {}); // just an indicator
    } else if (this.state === STATE.PAN) {
      this.#dispatchChange('panEnd', {}); // just an indicator
    }
    this.state = STATE.NONE;
  }

  onMove(e) {
    if (this.state === STATE.ROTATE) {
      const angle = Math.atan2(e.clientX - this.boxCenter.x, -(e.clientY - this.boxCenter.y));
      const delta = angle - this.startAngle;
      if (delta !== 0) {
        let newValue;
        if (this.coordinateIndex === COORDINATE_INDEX.Z) {
          const actualValue = this.camera.rotation.z;
          newValue = actualValue + delta;
          this.camera.rotation.z = newValue;
        } else if (this.coordinateIndex === COORDINATE_INDEX.Y) {
          const actualValue = this.camera.rotation.y;
          newValue = actualValue + delta;
          this.camera.rotation.y = newValue;
        }

        this.startAngle = angle;

        this.#dispatchChange(this.state, { rotation: newValue });
      }
    } else if (this.state === STATE.PAN) {
      const panEnd = new THREE.Vector2(e.clientX, e.clientY);
      const delta = panEnd.clone().sub(this.panStart);
      const panOffset = new THREE.Vector3();
      const v = new THREE.Vector3();

      if (this.camera.isPerspectiveCamera) {

        // perspective
        const position = this.camera.position;
        v.copy(position).sub(this.target);
        let targetDistance = v.length();

        // half of the fov is center to top of screen
        targetDistance *= Math.tan(((this.camera.fov / 2) * Math.PI) / 180.0);

        // we use only clientHeight here so aspect ratio does not distort speed
        this.#panLeft(panOffset, (2 * delta.x * targetDistance) / this.domElement.clientHeight, this.camera.matrix);
        this.#panUp(panOffset, (2 * delta.y * targetDistance) / this.domElement.clientHeight, this.camera.matrix);

      } else if (this.camera.isOrthographicCamera) {

        // orthographic

        this.#panLeft(
          panOffset,
          (delta.x * (this.camera.right - this.camera.left)) / this.camera.zoom / this.domElement.clientWidth,
          this.camera.matrix
        );
        this.#panUp(
          panOffset,
          (delta.y * (this.camera.top - this.camera.bottom)) / this.camera.zoom / this.domElement.clientHeight,
          this.camera.matrix
        );
      }

      if (panOffset.length() > 0) {
        this.camera.position.add(panOffset);
        this.panStart = panEnd;
        this.#dispatchChange(this.state, { offset: panOffset });
      }

    }
  }

  #panLeft(panOffset, distance, objectMatrix) {
    const v = new THREE.Vector3();
    v.setFromMatrixColumn(objectMatrix, 0); // get X column of objectMatrix
    v.multiplyScalar(-distance);
    panOffset.add(v);

  }

  #panUp(panOffset, distance, objectMatrix) {
    const v = new THREE.Vector3();
    v.setFromMatrixColumn(objectMatrix, 0);
    v.crossVectors(this.camera.up, v);
    v.multiplyScalar(distance);
    panOffset.add(v);
  }

  #dispatchChange(reason, value) {
    const event = new CustomEvent('orbitChange', {
      detail : {
        reason : reason,
        value  : value
      }
    });
    this.domElement.dispatchEvent(event);
  }

}

export { SimpleOrbitControl, COORDINATE_INDEX };
