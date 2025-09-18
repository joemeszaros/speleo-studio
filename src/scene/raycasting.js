import * as THREE from 'three';
import { ShotType } from '../model/survey.js';

export class Raycasting {

  constructor(options, scene) {
    this.scene = scene;
    this.options = options;
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();

  }

  // this function is required because threejs canvas is 48 px from top
  getMousePosition(mouseCoordinates) {
    const { x, y } = mouseCoordinates;
    const rect = this.scene.container.getBoundingClientRect();
    return new THREE.Vector2((x - rect.left) / rect.width, (y - rect.top) / rect.height);
  }

  setPointer(mousePosition) {
    this.pointer.x = mousePosition.x * 2 - 1;
    this.pointer.y = -mousePosition.y * 2 + 1;
  }

  getFirstIntersectedSprite(mouseCoordinates) {
    if (this.scene.view.spriteCamera === undefined) return;
    this.setPointer(this.getMousePosition(mouseCoordinates));
    const sprites = this.scene.sprites3DGroup.children.filter((s) => s.visible);
    this.raycaster.setFromCamera(this.pointer, this.scene.view.spriteCamera);
    const intersectedSprites = this.raycaster.intersectObjects(sprites);
    if (intersectedSprites.length) {
      return intersectedSprites[0].object;
    } else {
      return undefined;
    }
  }

  getIntersectedStationMeta(mouseCoordinates, radius) {
    this.setPointer(this.getMousePosition(mouseCoordinates));
    const caves = this.scene.db.getAllCaves();
    const visibleStations = [];
    caves.forEach((c) => {
      for (const [name, station] of c.stations) {
        if (station.survey.visible) {
          switch (station.type) {
            case ShotType.CENTER:
              if (!this.options.scene.centerLines.segments.show) continue;
              break;
            case ShotType.SPLAY:
              if (!this.options.scene.splays.segments.show) continue;
              break;
            case ShotType.AUXILIARY:
              if (!this.options.scene.auxiliaries.segments.show) continue;
              break;
            default:
              console.log(station);
              throw new Error(`Invalid shot type: ${station.type}`);

          }
          visibleStations.push({ name, station, position: station.position, cave: c, type: 'station' });
        }
      }
    });
    const camera = this.scene.view.camera;
    const origin = new THREE.Vector3(
      this.pointer.x,
      this.pointer.y,
      (camera.near + camera.far) / (camera.near - camera.far)
    ).unproject(camera);
    const direction = new THREE.Vector3(0, 0, -1).transformDirection(camera.matrixWorld);
    const spheres = visibleStations.map((r) => {
      const sphere = new THREE.Sphere(r.station.position, radius);
      sphere.meta = r; // custom property
      sphere.distance = origin.distanceTo(r.station.position); // custom property
      return sphere;
    });

    const ray = new THREE.Ray(origin, direction);
    const intersectedSpheres = spheres.filter((s) => ray.intersectSphere(s, new THREE.Vector3()));
    if (intersectedSpheres.length) {
      intersectedSpheres.sort((a, b) => a.distance - b.distance); // get the closest sphere
      return intersectedSpheres[0].meta;
    } else {
      return undefined;
    }
  }

  /**
   * Get the first intersected sprite from the viewhelper. It converts mouse coordinates to viewhelper's coordinate system,
   * which is in the top right corner of the canvas.
   * @param {*} mouseCoordinates
   * @returns
   */

  getFirstIntersectedViewHelperSprite(mouseCoordinates) {
    if (this.scene.view.name !== 'spatialView') return;

    const viewHelper = this.scene.view.viewHelper;
    const dim = viewHelper.size;

    const sceneRect = this.scene.domElement.getBoundingClientRect();

    const relativeX = mouseCoordinates.x - sceneRect.left;
    const relativeY = mouseCoordinates.y - sceneRect.top;

    if (relativeX < sceneRect.width - dim || relativeY > dim) {
      return undefined;
    }

    // Convert mouse coordinates to viewhelper's coordinate system
    const localX = (relativeX - (sceneRect.width - dim)) / dim;
    const localY = relativeY / dim;

    // Convert to normalized device coordinates for the orthographic camera
    const ndcX = localX * 2 - 1;
    const ndcY = -(localY * 2 - 1);
    // Set up raycaster with viewhelper's orthographic camera
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), viewHelper.orthoCamera);
    const intersectedSprites = this.raycaster.intersectObjects(viewHelper.interactiveObjects);

    return intersectedSprites.length > 0 ? intersectedSprites[0].object : undefined;
  }

  getIntersectedSurfacePointMeta(mouseCoordinates) {
    this.setPointer(this.getMousePosition(mouseCoordinates));
    this.raycaster.setFromCamera(this.pointer, this.scene.view.camera);
    this.raycaster.params.Points.threshold = 0.3;

    for (const [name, cloud] of this.scene.models.surfaceObjects) {
      const intersectedPoints = this.raycaster.intersectObject(cloud.cloud, false);
      if (intersectedPoints.length) {
        return { position: intersectedPoints[0].point, type: 'surface', name: name };
      }
    }

    return undefined;
  }
}
