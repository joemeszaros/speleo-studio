import * as THREE from 'three';
import { makeMovable, showErrorPanel } from './ui/popups.js';
import { get3DCoordsStr, node } from './utils/utils.js';
import { SectionHelper } from './section.js';

class SceneInteraction {

  constructor(
    db,
    options,
    footer,
    scene,
    materials,
    sceneDOMElement,
    calcDistanceButton,
    contextMenu,
    infoPanel,
    locatePanel
  ) {
    this.db = db;
    this.options = options;
    this.footer = footer;
    this.scene = scene;
    this.materials = materials;
    this.mouseCoordinates = new THREE.Vector2();
    this.contextMenu = contextMenu;
    this.infoPanel = infoPanel;
    this.locatePanel = locatePanel;
    this.selectedStation = undefined;
    this.selectedPosition = undefined;
    this.selectedStationForContext = undefined;

    document.addEventListener('pointermove', (event) => this.onPointerMove(event));
    sceneDOMElement.addEventListener('click', () => this.onClick(), false);
    sceneDOMElement.addEventListener('dblclick', () => this.onDoubleClick(), false);
    sceneDOMElement.addEventListener('mousedown', (event) => this.onMouseDown(event), false);

    calcDistanceButton.addEventListener('click', (event) => this.calcualteDistanceListener(event), false);
  }

  onPointerMove(event) {
    this.mouseCoordinates.x = event.clientX;
    this.mouseCoordinates.y = event.clientY;
  }

  calcualteDistanceListener(event) {
    const rect = this.scene.getBoundingClientRect();
    const left = event.clientX - rect.left;
    const top = event.clientY - rect.top;

    if (this.selectedStation === undefined) {
      showErrorPanel('You should select the starting point for distance measurement');
    } else {
      const from = this.selectedStation.position.clone();
      const to = this.selectedStationForContext.position.clone();
      const diff = to.clone().sub(from);
      this.hideContextMenu();

      const geometry = new THREE.BufferGeometry().setFromPoints([from, to]);
      const line = new THREE.Line(geometry, this.materials.distanceLine);
      line.computeLineDistances();
      this.scene.addObjectToScene(line);

      this.showDistancePanel(this.selectedStation, this.selectedStationForContext, diff, left, top, () => {
        this.scene.removeFromScene(line);
        this.scene.view.renderView();
      });

      this.#clearSelectedForContext();
      this.#clearSelected();
      this.scene.view.renderView();
    }
  }

  getMaterialForType(object) {
    switch (object.meta.type) {
      case 'splay':
        return this.materials.sphere.splay;
      case 'center':
        return this.materials.sphere.centerLine;
      case 'surface':
        return this.materials.sphere.surface;
      default:
        throw new Error(`Uknown object type for sphere ${object.meta.type}`);
    }
  }

  #getStationDetails(st) {
    let stLabel;
    if (st.meta.survey !== undefined && st.meta.cave !== undefined) {
      stLabel = `${st.meta.cave.name} -> ${st.meta.survey.name} -> ${st.name}`;
    } else {
      stLabel = st.name;
    }
    //, local: ${get3DCoordsStr(st.meta.coordinates.local)}, eov: ${get3DCoordsStr(st.meta.coordinates.eov, ['y', 'x', 'elevation'])}
    return `${stLabel} selected, type: ${st.meta.type}, position: ${get3DCoordsStr(st.position, ['x', 'y', 'z'], 3)}`;
  }
  #setSelected(st) {
    this.selectedStation = st;
    this.selectedPosition = st.position.clone();
    this.selectedStation.material = this.materials.sphere.selected;
    this.selectedStation.scale.setScalar(1.7);
    if (this.selectedStation.meta.type === 'surface') {
      this.selectedStation.visible = true;
    }

    this.footer.addMessage(this.#getStationDetails(st));
  }

  #clearSelected() {
    this.selectedPosition = undefined;
    this.selectedStation.material = this.getMaterialForType(this.selectedStation);
    this.selectedStation.scale.setScalar(1.0);
    if (this.selectedStation.meta.type === 'surface') {
      this.selectedStation.visible = false;
    }
    this.selectedStation = undefined;
  }

  #setSelectedForContext(st) {
    this.selectedStationForContext = st;
    this.selectedStationForContext.material = this.materials.sphere.selectedForContext;
    this.selectedStationForContext.scale.setScalar(1.7);
    if (this.selectedStationForContext.type === 'surface') {
      this.selectedStationForContext.visible = true;
    }

    this.footer.addMessage(this.#getStationDetails(st));
  }

  #clearSelectedForContext() {
    this.selectedStationForContext.material = this.getMaterialForType(this.selectedStationForContext);
    this.selectedStationForContext.scale.setScalar(1.0);
    if (this.selectedStationForContext.meta.type === 'surface') {
      this.selectedStationForContext.visible = false;
    }
    this.selectedStationForContext = undefined;
  }

  onDoubleClick() {
    const intersectedSprite = this.scene.getFirstIntersectedSprite(this.mouseCoordinates);
    if (intersectedSprite !== undefined && typeof intersectedSprite.onclick === 'function') {
      intersectedSprite.onclick(); // custom function
    }

  }
  onClick() {
    const intersectedStation = this.scene.getIntersectedStationSphere(this.mouseCoordinates);
    const intersectsSurfacePoint = this.scene.getIntersectedSurfacePoint(this.mouseCoordinates, 'selected');
    const hasIntersection = intersectedStation !== undefined || intersectsSurfacePoint !== undefined;

    if (hasIntersection) {

      const intersectedObject = intersectsSurfacePoint !== undefined ? intersectsSurfacePoint : intersectedStation; // first intersected object
      if (intersectedObject.meta.type !== 'surface' && intersectedObject === this.selectedStation) {
        // clicked on the same sphere again
        this.#clearSelected();
      } else if (
        intersectedObject.meta.type === 'surface' &&
        intersectedObject === this.selectedStation &&
        intersectedObject.position.distanceTo(this.selectedPosition) < 0.2
      ) {
        // clicked on the same surface point again
        this.#clearSelected();
      } else {
        // clicked an other object
        if (this.selectedStation !== undefined) {
          // deactivate previouly selected sphere
          this.#clearSelected();
        }
        if (this.selectedStationForContext === intersectedObject) {
          this.hideContextMenu();
        }
        this.#setSelected(intersectedObject);
      }
    } else if (this.selectedStation !== undefined) {
      this.#clearSelected();
    }

    if (hasIntersection || this.selectedStation !== undefined) {
      this.scene.view.renderView();
    }
  }

  onMouseDown(event) {
    // right click
    event.preventDefault();
    var rightclick;
    if (!event) event = window.event;
    if (event.which) rightclick = event.which == 3;
    else if (event.button) rightclick = event.button == 2;
    if (!rightclick) return;

    const rect = this.scene.getBoundingClientRect();
    const intersectedStation = this.scene.getIntersectedStationSphere(this.mouseCoordinates);
    const intersectsSurfacePoint = this.scene.getIntersectedSurfacePoint(this.mouseCoordinates, 'selectedForContext');

    if (intersectedStation !== undefined || intersectsSurfacePoint !== undefined) {
      const intersectedObject = intersectsSurfacePoint !== undefined ? intersectsSurfacePoint : intersectedStation;
      let distanceToSelected;
      if (this.selectedPosition === undefined) {
        distanceToSelected = Infinity;
      } else {
        distanceToSelected = intersectedObject.position.distanceTo(this.selectedPosition);
      }
      if (
        (intersectedObject.meta.type !== 'surface' && intersectedObject === this.selectedStation) ||
        (intersectedObject.meta.type === 'surface' && distanceToSelected < 0.2)
      ) {
        if (this.selectedStationForContext !== undefined) {
          // deselect previously selected station for context
          this.#clearSelectedForContext();
          this.showContextMenu(event.clientX - rect.left, event.clientY - rect.top);
        }
        this.#clearSelected();
        this.#setSelectedForContext(intersectedObject);
      } else {
        if (this.selectedStationForContext !== undefined) {
          // clicked on the same sphere, that was already selected
          this.#clearSelectedForContext();
        }
        this.#setSelectedForContext(intersectedObject);
        this.showContextMenu(event.clientX - rect.left, event.clientY - rect.top);
      }
      this.scene.view.renderView();
    }
  }

  showLocateStationPanel() {
    this.locatePanel.innerHTML = '';
    makeMovable(
      this.locatePanel,
      `Locate station`,
      false,
      () => {
        this.locatePanel.style.display = 'none';
      },
      () => {},
      () => {}
    );
    const stNames = this.db.getAllStationNames();
    const multipleCaves = this.db.getAllCaveNames().length > 1;
    const optionValue = (x) => (multipleCaves ? `${x.name} (${x.cave})` : x.name);
    const options = stNames
      .map((x) => `<option cave="${x.cave}" station="${x.name}" value="${optionValue(x)}">`)
      .join('');

    const container = node`<div id="container-locate-station">
        <label for="pointtolocate">Station: <input type="search" list="stations" id="pointtolocate"/></label>
        <datalist id="stations">${options}</datalist>
        <div><label for="forContext">For context<input type="checkbox" id="forContext" /></label></div>
        <button id="locate-button">Locate point</button>
      </div>`;
    const input = container.querySelector('#pointtolocate');

    container.querySelector('#locate-button').onclick = () => {
      const selectedOption = container.querySelector(`#stations option[value='${input.value}']`);
      const caveName = selectedOption.getAttribute('cave');
      const stationName = selectedOption.getAttribute('station');

      const stationSphere = this.scene.getStationSphere(stationName, caveName);
      if (stationSphere !== undefined) {
        if (this.selectedStation !== undefined) {
          this.#clearSelected();
        }
        if (container.querySelector('#forContext').checked) {
          this.#setSelectedForContext(stationSphere);
        } else {
          this.#setSelected(stationSphere);
        }

        this.scene.view.panCameraTo(stationSphere.position);
        this.scene.view.zoomCameraTo(4);
        this.locatePanel.style.display = 'none';
        input.value = '';
      }

    };

    this.locatePanel.appendChild(container);
    this.locatePanel.style.display = 'block';
  }

  showShortestPathPanel() {
    const segmentsId = 'shortest-path-segments';

    const addStationSelectors = (caveName) => {
      const container = node`<div id="container-shortest-path"></div>`;
      const stNames = this.db.getStationNames(caveName);
      const options = stNames.map((n) => `<option value="${n}">`).join('');
      const datalist = node`<datalist id="stations">${options}</datalist>`;
      const button = node`<button id="find-shortest-path">Find shortest path</button>`;
      const fromL = node`<label for="point-from">From:<input type="search" list="stations" id="point-from"></label>`;
      const toL = node`<label for="point-to">To:<input type="search" list="stations" id="point-to"></label>`;

      container.appendChild(datalist);
      container.appendChild(fromL);
      container.appendChild(toL);
      container.appendChild(button);
      this.locatePanel.appendChild(container);

      button.onclick = () => {

        this.scene.disposeSegments(segmentsId);
        const cave = this.db.getCave(caveName);
        const g = SectionHelper.getGraph(cave);
        let label;
        const from = fromL.childNodes[1].value;
        const to = toL.childNodes[1].value;
        if (cave.stations.has(from) && cave.stations.has(to)) {
          const section = SectionHelper.getSection(g, from, to);
          if (section !== undefined) {
            const segments = SectionHelper.getSectionSegments(section, cave.stations);
            this.scene.showSegments(segmentsId, segments, this.options.scene.sectionAttributes.color, caveName);
            label = node`<div id="shortest-path-label">From: ${from} To: ${to} Length: ${section.distance.toFixed(2)}</div>`;
          } else {
            label = node`<div id="shortest-path-label">Cannot find path between '${from}' and '${to}'</div>`;
          }
        } else {
          label = node`<div id="shortest-path-label">Cannot find stations '${from}' or '${to}'</div>`;
        }
        this.locatePanel.appendChild(label);

      };
    };

    this.locatePanel.style.display = 'none'; //shown previously
    this.locatePanel.innerHTML = '';
    makeMovable(
      this.locatePanel,
      `Shortest path`,
      false,
      () => {
        this.scene.disposeSegments(segmentsId);
        this.locatePanel.style.display = 'none';
      },
      () => {},
      () => {}
    );

    const cNames = this.db.getAllCaveNames();
    if (cNames.length > 1) {
      const optionCaveNames = cNames.map((n) => `<option value="${n}">${n}</option>`).join('');
      const caveNamesL = node`<label for="cave-names">Cave: <select id="cave-names" name="cave-names">${optionCaveNames}</select></label>`;
      const caveNames = caveNamesL.childNodes[1];

      this.locatePanel.appendChild(caveNamesL);

      caveNames.onchange = () => {
        const caveName = caveNames.options[caveNames.selectedIndex].text;
        const cont = this.locatePanel.querySelector('#container-shortest-path');
        if (cont !== undefined) {
          this.locatePanel.removeChild(cont);
        }
        this.locatePanel.querySelectorAll('#shortest-path-label').forEach((e) => this.locatePanel.removeChild(e));

        addStationSelectors(caveName);
      };
    }

    if (cNames.length > 0) {
      addStationSelectors(cNames[0]);
      this.locatePanel.style.display = 'block';
    }
  }

  showContextMenu(left, top) {
    this.contextMenu.style.left = left + 'px';
    this.contextMenu.style.top = top + 'px';
    this.contextMenu.style.display = 'block';
  }

  hideContextMenu() {
    this.contextMenu.style.display = 'none';
  }

  showDistancePanel(from, to, diffVector, left, top, lineRemoveFn) {
    this.infoPanel.children.namedItem('close').onclick = () => {
      lineRemoveFn();
      this.infoPanel.style.display = 'none';
      return false;
    };
    this.infoPanel.style.left = left + 'px';
    this.infoPanel.style.top = top + 'px';
    this.infoPanel.style.display = 'block';
    const fp = from.position;
    const formatCoords = (a) => a.map((x) => x.toFixed(2)).join(',');
    const tp = to.position;
    this.infoPanel.children.namedItem('content').innerHTML = `
        From: ${from.name} (${formatCoords([fp.x, fp.y, fp.z])})<br>
        To: ${to.name} (${formatCoords([tp.x, tp.y, tp.z])})<br>
        X distance: ${diffVector.x}<br>
        Y distance: ${diffVector.y}<br>
        Z distance: ${diffVector.z}<br>
        Horizontal distance: ${Math.sqrt(Math.pow(diffVector.x, 2), Math.pow(diffVector.y, 2))}<br>
        Spatial distance: ${diffVector.length()}
        `;
  }
}

export { SceneInteraction };
