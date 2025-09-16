import * as THREE from 'three';

export class StartPointScene {

  constructor(options, materials, scene) {
    this.options = options;
    this.mats = materials.materials;
    this.startPoints3DGroup = new THREE.Group();
    this.startPoints3DGroup.name = 'starting points';
    this.startPointObjects = new Map(); // Map to store starting point objects for each cave
    scene.addObjectToScene(this.startPoints3DGroup);

  }
  toggleStartingPointsVisibility(visible) {
    this.startPoints3DGroup.visible = visible;
  }

  addOrUpdateStartingPoint(cave) {
    // Remove existing starting point if it exists
    if (this.startPointObjects.has(cave.name)) {
      this.removeStartingPoint(cave.name);
    }

    // Get the first station of the first survey
    const firstStation = cave.getFirstStation();
    if (!firstStation) return;

    // Create a sphere geometry for the starting point
    const startPointGeo = new THREE.SphereGeometry(this.options.scene.startPoints.radius, 7, 7);

    // Create the starting point mesh
    const startPoint = new THREE.Mesh(startPointGeo, this.mats.sphere.startPoint);
    startPoint.position.copy(firstStation.position);
    startPoint.name = `startPoint_${cave.name}`;

    // Set visibility based on configuration
    startPoint.visible = this.options.scene.startPoints.show;

    // Add to the starting points group
    this.startPoints3DGroup.add(startPoint);

    // Store reference for later management
    this.startPointObjects.set(cave.name, {
      mesh     : startPoint,
      geometry : startPointGeo,
      material : this.mats.sphere.startPoint
    });

    return startPoint;
  }

  removeStartingPoint(caveName) {
    const startPointObj = this.startPointObjects.get(caveName);
    if (startPointObj) {
      this.startPoints3DGroup.remove(startPointObj.mesh);
      startPointObj.geometry.dispose();
      startPointObj.material.dispose();
      this.startPointObjects.delete(caveName);
    }
  }

  updateStartingPointColor(color) {
    this.startPointObjects.forEach((obj) => {
      obj.material.color.setHex(color);
    });
  }

  updateStartingPointRadius(radius) {
    this.startPointObjects.forEach((obj) => {
      // Create new geometry with new radius
      const newGeometry = new THREE.SphereGeometry(radius, 7, 7);
      obj.mesh.geometry.dispose();
      obj.mesh.geometry = newGeometry;
    });
  }

}
