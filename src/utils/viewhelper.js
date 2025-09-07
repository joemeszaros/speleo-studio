import {
  CylinderGeometry,
  CanvasTexture,
  Color,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  OrthographicCamera,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector3,
  Vector4
} from 'three';

class ViewHelper extends Object3D {

  constructor(camera, domElement, spatialControl, options, size = 128, center = new Vector3(0, 0, 0)) {

    super();

    this.spatialControl = spatialControl;
    this.isViewHelper = true;

    this.animating = false;
    this.center = center;

    const xColor = new Color('#ff4466');
    const yColor = new Color('#88ff44');
    const zColor = new Color('#4488ff');

    this.interactiveObjects = []; // used in scene.js for raycasting

    const orthoCamera = new OrthographicCamera(-2, 2, 2, -2, 0, 4);
    this.orthoCamera = orthoCamera;
    orthoCamera.position.set(0, 0, 2);

    const geometry = new CylinderGeometry(0.04, 0.04, 0.8, 5).rotateZ(-Math.PI / 2).translate(0.4, 0, 0);

    const xAxis = new Mesh(geometry, getAxisMaterial(xColor));
    const yAxis = new Mesh(geometry, getAxisMaterial(yColor));
    const zAxis = new Mesh(geometry, getAxisMaterial(zColor));

    yAxis.rotation.z = Math.PI / 2;
    zAxis.rotation.y = -Math.PI / 2;

    this.add(xAxis);
    this.add(zAxis);
    this.add(yAxis);

    const posXSprite = new Sprite(getSpriteMaterial(xColor, options.labelX));
    const posYSprite = new Sprite(getSpriteMaterial(yColor, options.labelY));
    const posZSprite = new Sprite(getSpriteMaterial(zColor, options.labelZ));
    const negXSprite = new Sprite(getSpriteMaterial(xColor));
    const negYSprite = new Sprite(getSpriteMaterial(yColor));
    const negZSprite = new Sprite(getSpriteMaterial(zColor));

    posXSprite.position.x = 1;
    posYSprite.position.y = 1;
    posZSprite.position.z = 1;
    negXSprite.position.x = -1;
    negYSprite.position.y = -1;
    negZSprite.position.z = -1;

    negXSprite.material.opacity = 0.4;
    negYSprite.material.opacity = 0.4;
    negZSprite.material.opacity = 0.4;

    posXSprite.userData.type = 'posX';
    posYSprite.userData.type = 'posY';
    posZSprite.userData.type = 'posZ';
    negXSprite.userData.type = 'negX';
    negYSprite.userData.type = 'negY';
    negZSprite.userData.type = 'negZ';

    [posXSprite, posYSprite, posZSprite, negXSprite, negYSprite, negZSprite].forEach((sprite) => {
      sprite.onclick = () => {
        this.prepareAnimationData(sprite);
        this.animating = true;
        this.animationProgress = 0;
      };
      this.add(sprite);
      this.interactiveObjects.push(sprite);
    });

    const point = new Vector3();
    const dim = size;
    this.size = size;
    const turnRate = 2.0; // turn rate in radians per second (slower for smoother animation)

    this.render = function (renderer) {

      this.quaternion.copy(camera.quaternion).invert();
      this.updateMatrixWorld();
      point.set(0, 0, 1);
      point.applyQuaternion(camera.quaternion);
      const x = domElement.offsetWidth - dim;
      const y = domElement.offsetHeight - dim;
      renderer.clearDepth();
      renderer.getViewport(viewport);
      renderer.setViewport(x, y, dim, dim);
      renderer.render(this, orthoCamera);
      renderer.setViewport(viewport.x, viewport.y, viewport.z, viewport.w);
    };

    const viewport = new Vector4();

    this.update = function (delta) {
      if (!this.animating) return;

      const step = delta * turnRate;
      const spatialControl = this.spatialControl;

      // Increment animation progress
      this.animationProgress = (this.animationProgress || 0) + step;

      const currentOrientation = spatialControl.getCameraOrientation();

      // Calculate azimuth difference with proper wrapping
      let azimuthDiff = this.targetAzimuth - this.startAzimuth;

      // Handle azimuth wrapping (shortest path)
      if (azimuthDiff > Math.PI) {
        azimuthDiff -= 2 * Math.PI;
      } else if (azimuthDiff < -Math.PI) {
        azimuthDiff += 2 * Math.PI;
      }

      // Interpolate azimuth
      const newAzimuth = this.startAzimuth + azimuthDiff * Math.min(this.animationProgress, 1.0);

      // Interpolate clino
      const clinoDiff = this.targetClino - this.startClino;
      const newClino = this.startClino + clinoDiff * Math.min(this.animationProgress, 1.0);

      spatialControl.setCameraOrientation(currentOrientation.distance, newAzimuth, newClino);

      // Check if animation is complete
      if (this.animationProgress >= 1.0) {
        this.animating = false;
        this.animationProgress = 0;
        // Set final position to ensure we end exactly at target
        spatialControl.setCameraOrientation(currentOrientation.distance, this.targetAzimuth, this.targetClino);
      }
    };

    this.dispose = function () {

      geometry.dispose();

      xAxis.material.dispose();
      yAxis.material.dispose();
      zAxis.material.dispose();

      posXSprite.material.map.dispose();
      posYSprite.material.map.dispose();
      posZSprite.material.map.dispose();
      negXSprite.material.map.dispose();
      negYSprite.material.map.dispose();
      negZSprite.material.map.dispose();

      posXSprite.material.dispose();
      posYSprite.material.dispose();
      posZSprite.material.dispose();
      negXSprite.material.dispose();
      negYSprite.material.dispose();
      negZSprite.material.dispose();

    };

    this.prepareAnimationData = function (object) {
      // Get current camera orientation from SpatialViewControl
      const currentOrientation = this.spatialControl?.getCameraOrientation();
      if (!currentOrientation) {
        console.error('ViewHelper: SpatialViewControl not found on camera');
        return;
      }

      let targetAzimuth = currentOrientation.azimuth;
      let targetClino = currentOrientation.clino;

      // Map axis clicks to azimuth/clino values
      // In your system: Y-axis is North (0° azimuth), azimuth increases clockwise
      switch (object.userData.type) {
        case 'posX': // Positive X axis (East)
          targetAzimuth = Math.PI / 2; // 90° East
          targetClino = 0; // Horizontal
          break;

        case 'posY': // Positive Y axis (North)
          targetAzimuth = 0; // 0° North
          targetClino = 0; // Horizontal
          break;

        case 'posZ': // Positive Z axis (Up)
          targetAzimuth = currentOrientation.azimuth; // Keep current azimuth
          targetClino = Math.PI / 2; // 90° Up
          break;

        case 'negX': // Negative X axis (West)
          targetAzimuth = -Math.PI / 2; // -90° West (or 270°)
          targetClino = 0; // Horizontal
          break;

        case 'negY': // Negative Y axis (South)
          targetAzimuth = Math.PI; // 180° South
          targetClino = 0; // Horizontal
          break;

        case 'negZ': // Negative Z axis (Down)
          targetAzimuth = currentOrientation.azimuth; // Keep current azimuth
          targetClino = -Math.PI / 2; // -90° Down
          break;

        default:
          console.error('ViewHelper: Invalid axis.');
          return;
      }

      // Normalize azimuth to 0-2π range
      if (targetAzimuth < 0) targetAzimuth += 2 * Math.PI;
      if (targetAzimuth >= 2 * Math.PI) targetAzimuth -= 2 * Math.PI;

      // Store target values for animation
      this.targetAzimuth = targetAzimuth;
      this.targetClino = targetClino;
      this.startAzimuth = currentOrientation.azimuth;
      this.startClino = currentOrientation.clino;

    };

    function getAxisMaterial(color) {
      return new MeshBasicMaterial({ color: color, toneMapped: false });
    }

    function getSpriteMaterial(color, text) {

      const { font = '24px Arial', color: labelColor = '#000000', radius = 14 } = options;

      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;

      const context = canvas.getContext('2d');
      context.beginPath();
      context.arc(32, 32, radius, 0, 2 * Math.PI);
      context.closePath();
      context.fillStyle = color.getStyle();
      context.fill();

      if (text) {
        context.font = font;
        context.textAlign = 'center';
        context.fillStyle = labelColor;
        context.fillText(text, 32, 41);
      }

      const texture = new CanvasTexture(canvas);
      texture.colorSpace = SRGBColorSpace;

      return new SpriteMaterial({ map: texture, toneMapped: false });

    }

  }

}

export { ViewHelper };
