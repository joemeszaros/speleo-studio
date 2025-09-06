import {
  CylinderGeometry,
  CanvasTexture,
  Color,
  Euler,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  OrthographicCamera,
  Quaternion,
  Raycaster,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector2,
  Vector3,
  Vector4
} from 'three';

class ViewHelper extends Object3D {

  constructor(camera, domElement, options, center = new Vector3(0, 0, 0)) {

    super();

    this.isViewHelper = true;

    this.animating = false;
    this.center = center;

    const xColor = new Color('#ff4466');
    const yColor = new Color('#88ff44');
    const zColor = new Color('#4488ff');

    const interactiveObjects = [];
    const raycaster = new Raycaster();
    const mouse = new Vector2();
    const dummy = new Object3D();

    const orthoCamera = new OrthographicCamera(-2, 2, 2, -2, 0, 4);
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
      this.add(sprite);
      interactiveObjects.push(sprite);
    });

    const point = new Vector3();
    const dim = 128;
    const turnRate = 2 * Math.PI; // turn rate in angles per second

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

    const targetPosition = new Vector3();
    const targetQuaternion = new Quaternion();

    const q1 = new Quaternion();
    const q2 = new Quaternion();
    const viewport = new Vector4();
    let radius = 0;

    this.handleClick = function (event) {

      if (this.animating === true) return false;

      const rect = domElement.getBoundingClientRect();
      const offsetX = rect.left + (domElement.offsetWidth - dim);
      const offsetY = rect.top + (domElement.offsetHeight - dim);
      mouse.x = ((event.clientX - offsetX) / (rect.right - offsetX)) * 2 - 1;
      mouse.y = -((event.clientY - offsetY) / (rect.bottom - offsetY)) * 2 + 1;

      raycaster.setFromCamera(mouse, orthoCamera);

      const intersects = raycaster.intersectObjects(interactiveObjects);

      if (intersects.length > 0) {
        const intersection = intersects[0];
        const object = intersection.object;
        prepareAnimationData(object, this.center);
        this.animating = true;
        return true;
      } else {
        return false;
      }

    };

    this.update = function (delta) {

      const step = delta * turnRate;

      // animate position by doing a slerp and then scaling the position on the unit sphere
      q1.rotateTowards(q2, step);
      camera.position.set(0, 0, 1).applyQuaternion(q1).multiplyScalar(radius).add(this.center);

      // animate orientation
      camera.quaternion.rotateTowards(targetQuaternion, step);

      if (q1.angleTo(q2) === 0) {
        this.animating = false;
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

    function prepareAnimationData(object, focusPoint) {
      const delta = new Vector3();

      switch (object.userData.type) {

        case 'posX':
          delta.setX(100);
          targetQuaternion.setFromEuler(new Euler(0, Math.PI * 0.5, 0));
          break;

        case 'posY':
          delta.setY(-100);
          targetQuaternion.setFromEuler(new Euler(-Math.PI * 0.5, 0, 0));
          break;

        case 'posZ':
          delta.setZ(100);
          targetQuaternion.setFromEuler(new Euler());
          break;

        case 'negX':
          delta.setX(-100);
          targetQuaternion.setFromEuler(new Euler(0, -Math.PI * 0.5, 0));
          break;

        case 'negY':
          delta.setY(100);
          targetQuaternion.setFromEuler(new Euler(Math.PI * 0.5, 0, 0));
          break;

        case 'negZ':
          delta.setZ(-100);
          targetQuaternion.setFromEuler(new Euler(0, Math.PI, 0));
          break;

        default:
          console.error('ViewHelper: Invalid axis.');
      }

      radius = camera.position.distanceTo(focusPoint);
      targetPosition.copy(focusPoint.clone().add(delta));

      dummy.position.copy(focusPoint);
      dummy.lookAt(camera.position);
      q1.copy(dummy.quaternion);
      dummy.lookAt(targetPosition);
      q2.copy(dummy.quaternion);
    }

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
