import * as THREE from 'three';
import { makeFloatingPanel, showErrorPanel } from './ui/popups.js';
import { get3DCoordsStr, node, radsToDegrees, toPolar } from './utils/utils.js';
import { SectionHelper } from './section.js';
import { ShotType } from './model/survey.js';
import { i18n } from './i18n/i18n.js';

class SceneInteraction {

  constructor(
    db,
    options,
    footer,
    scene,
    materials,
    sceneDOMElement,
    contextMenu,
    infoPanel,
    locatePanel,
    editorElementIDs
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
    this.pointedStation = undefined;
    this.distanceMeasurementMode = false;
    this.distanceFromStation = undefined;
    this.distanceToStation = undefined;

    this.mouseOnEditor = false;

    document.addEventListener('pointermove', (event) => this.onPointerMove(event));
    sceneDOMElement.addEventListener('click', () => this.onClick(), false);
    sceneDOMElement.addEventListener('dblclick', () => this.onDoubleClick(), false);
    sceneDOMElement.addEventListener('mousedown', (event) => this.onMouseDown(event), false);
    editorElementIDs.forEach((id) => {
      document.getElementById(id).addEventListener('mouseenter', () => {
        this.mouseOnEditor = true;
      });
      document.getElementById(id).addEventListener('mouseleave', () => {
        this.mouseOnEditor = false;
      });
    });

    // Handle window resize to keep panels within bounds
    window.addEventListener('resize', () => this.handleWindowResize());

    this.buildContextMenu();
  }

  buildContextMenu() {
    [
      {
        name    : i18n.t('menu.station.details'),
        onclick : (event) => {
          const rect = this.scene.getBoundingClientRect();
          this.showStationDetailsPanel(this.selectedStation, event.clientX - rect.left, event.clientY - rect.top);
        }
      },
      {
        name    : i18n.t('menu.station.distanceFromHere'),
        onclick : () => this.selectDistanceStation('from')
      },
      {
        name    : i18n.t('menu.station.distanceToHere'),
        onclick : () => this.selectDistanceStation('to')
      },
      {
        name    : i18n.t('menu.station.pivotPoint'),
        onclick : () => this.selectPivotPoint()
      }
    ].forEach((item) => {
      const button = node`<button id="station-context-menu-${item.name.toLowerCase().replace(' ', '-')}">${item.name}</button>`;
      button.onclick = (event) => {
        item.onclick(event);
        this.hideContextMenu();
      };
      this.contextMenu.appendChild(button);

    });
  }

  selectDistanceStation(mode) {
    if (this.selectedStation === undefined) {
      showErrorPanel(i18n.t('ui.panels.distance.error.noStartingPoint'));
    } else {
      // Set distance measurement mode and change the visual appearance
      this.distanceMeasurementMode = true;
      this.scene.focusSphere.visible = false;
      this.scene.distanceSphere.position.copy(this.selectedStation.position);
      this.showSphere(this.scene.distanceSphere);
      this.scene.view.renderView();

      // Show message that user should click on another station
      this.footer.showMessage(i18n.t('ui.panels.distance.clickNextStation'));

      // Store the first station for distance calculation
      if (mode === 'from') {
        this.distanceFromStation = this.selectedStation;
      } else {
        this.distanceToStation = this.selectedStation;
      }
    }
  }

  handleDistanceMeasurement(secondStation) {
    if (!this.distanceMeasurementMode || (!this.distanceFromStation && !this.distanceToStation)) {
      return false;
    }

    let from, to;
    if (this.distanceFromStation !== undefined) {
      from = this.distanceFromStation;
      to = secondStation;

    } else {
      from = secondStation;
      to = this.distanceToStation;

    }
    const diff = to.position.clone().sub(from.position.clone());

    const geometry = new THREE.BufferGeometry().setFromPoints([from.position.clone(), to.position.clone()]);
    const line = new THREE.Line(geometry, this.materials.distanceLine);
    line.name = `distance-line-${from}-${to}`;
    line.computeLineDistances();
    this.scene.addObjectToScene(line);

    //FIXME; ensure that it fits in the screen
    // Show distance panel
    const rect = this.scene.getBoundingClientRect();
    this.showDistancePanel(
      from,
      to,
      diff,
      this.mouseCoordinates.x - rect.left + 50,
      this.mouseCoordinates.y - rect.top + 50,
      () => {
        this.scene.removeFromScene(line);
        this.#clearSelected();
        this.scene.view.renderView();
      }
    );

    // Clear distance measurement mode
    this.distanceMeasurementMode = false;
    this.distanceFromStation = undefined;
    this.distanceToStation = undefined;

    this.#setSelected(secondStation);
    this.scene.view.renderView();
    return true;
  }

  selectPivotPoint() {
    const position = this.selectedStation.position;
    this.scene.view.panCameraTo(position);
  }

  getSelectedStationDetails(st) {
    let stLabel;
    if (st.meta.survey !== undefined && st.meta.cave !== undefined) {
      stLabel = `${st.meta.cave.name} -> ${st.meta.survey.name} -> ${st.name}`;
    } else {
      stLabel = st.name;
    }

    return stLabel;
  }

  getPointedStationDetails(st) {
    let stLabel;
    if (st.meta.survey !== undefined && st.meta.cave !== undefined) {
      stLabel = `${st.meta.cave.name} -> ${st.meta.survey.name} -> ${st.name}`;
    } else {
      stLabel = st.name;
    }
    return stLabel;
  }

  showSphere(sphereToShow) {
    const radius = this.scene.view.control.getWorldUnitsForPixels(5);
    const actualRadius = sphereToShow.geometry.parameters.radius;

    if (radius !== actualRadius) {
      sphereToShow.geometry.dispose();
      sphereToShow.geometry = new THREE.SphereGeometry(radius, 10, 10);
    }

    sphereToShow.visible = true;
  }

  #setSelected(st) {
    this.selectedStation = st;
    this.selectedPosition = st.position.clone();
    this.scene.focusSphere.position.copy(st.position);
    this.showSphere(this.scene.focusSphere);
    this.footer.showMessage(this.getSelectedStationDetails(st));
  }

  #clearSelected() {
    this.selectedPosition = undefined;
    this.scene.focusSphere.visible = false;
    this.scene.distanceSphere.visible = false;
    this.selectedStation = undefined;
    this.distanceMeasurementMode = false;
    this.hideContextMenu();
    this.scene.view.renderView();

  }

  onPointerMove(event) {
    if (this.mouseOnEditor || this.scene.view.isInteracting) {
      return;
    }
    this.mouseCoordinates.x = event.clientX;
    this.mouseCoordinates.y = event.clientY;

    const worldUnitsFor5Pixels = this.scene.view.control.getWorldUnitsForPixels(5);
    const intersectedStation = this.scene.getIntersectedStationSphere(this.mouseCoordinates, worldUnitsFor5Pixels);

    if (intersectedStation !== undefined) {
      this.scene.domElement.style.cursor = 'pointer';
      this.scene.focusSprite.position.copy(intersectedStation.position);
      const worldUnitsFor30Pixels = this.scene.view.control.getWorldUnitsForPixels(30);
      this.scene.focusSprite.scale.set(worldUnitsFor30Pixels, worldUnitsFor30Pixels, worldUnitsFor30Pixels);
      this.scene.focusSprite.visible = true;

      this.footer.showMessage(this.getPointedStationDetails(intersectedStation));
      this.pointedStation = intersectedStation;
      this.scene.view.renderView();
    } else if (this.pointedStation !== undefined) {
      this.scene.domElement.style.cursor = 'default';
      this.scene.focusSprite.visible = false;
      // do not call clearmessage every time
      this.footer.clearMessage();
      this.pointedStation = undefined;
      this.scene.view.renderView();
    }
  }

  onDoubleClick() {
    const intersectedSprite = this.scene.getFirstIntersectedSprite(this.mouseCoordinates);
    if (intersectedSprite !== undefined && typeof intersectedSprite.onclick === 'function') {
      intersectedSprite.onclick(); // custom function
    }
  }

  onClick() {
    const worldUnitsFor5Pixels = this.scene.view.control.getWorldUnitsForPixels(5);
    const intersectedStation = this.scene.getIntersectedStationSphere(this.mouseCoordinates, worldUnitsFor5Pixels);
    const intersectsSurfacePoint = this.scene.getIntersectedSurfacePoint(this.mouseCoordinates, 'selected');
    const hasIntersection = intersectedStation !== undefined || intersectsSurfacePoint !== undefined;

    if (hasIntersection) {
      const intersectedObject = intersectsSurfacePoint !== undefined ? intersectsSurfacePoint : intersectedStation;

      // Check if we're in distance measurement mode
      if (this.distanceMeasurementMode && (this.distanceFromStation || this.distanceToStation)) {
        // Handle distance measurement
        if (this.handleDistanceMeasurement(intersectedObject)) {
          return; // Distance measurement handled, exit early
        }
      }

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
        // clicked on a different object
        if (this.selectedStation !== undefined) {
          // deactivate previously selected sphere
          this.#clearSelected();
        }

        // Set the new station as selected
        this.#setSelected(intersectedObject);

        // Show context menu for the newly selected station
        const rect = this.scene.getBoundingClientRect();
        this.showContextMenu(this.mouseCoordinates.x - rect.left + 10, this.mouseCoordinates.y - rect.top + 10);
      }
    } else if (this.selectedStation !== undefined) {
      this.#clearSelected();
    }

    if (hasIntersection || this.selectedStation !== undefined) {
      this.scene.view.renderView();
    }
  }

  onMouseDown(event) {
    // Prevent default behavior for all mouse buttons
    event.preventDefault();

    // Only handle left click for context menu (right click is now disabled)
    if (event.button !== 0) return;

    // The context menu is now handled in onClick method
  }

  showLocateStationPanel() {
    this.buildLocateStationPanel();
    document.addEventListener('languageChanged', () => {
      this.buildLocateStationPanel();
    });
  }

  buildLocateStationPanel() {

    const contentElmnt = makeFloatingPanel(
      this.locatePanel,
      i18n.t('ui.panels.locateStation.title'),
      false,
      false,
      {},
      () => {
        document.removeEventListener('languageChanged', () => {
          this.buildLocateStationPanel();
        });
      }
    );
    const stNames = this.db.getAllStationNames();
    const multipleCaves = this.db.getAllCaveNames().length > 1;
    const optionValue = (x) => (multipleCaves ? `${x.name} (${x.cave})` : x.name);
    const options = stNames
      .map((x) => `<option cave="${x.cave}" station="${x.name}" value="${optionValue(x)}">`)
      .join('');

    const container = node`<div id="container-locate-station">
        <label for="pointtolocate">${i18n.t('common.station')}: <input type="search" list="stations" id="pointtolocate"/></label>
        <datalist id="stations">${options}</datalist>
        <button id="locate-button">${i18n.t('ui.panels.locateStation.locate')}</button>
      </div>`;
    const input = container.querySelector('#pointtolocate');

    container.querySelector('#locate-button').onclick = () => {
      const selectedOption = container.querySelector(`#stations option[value='${input.value}']`);
      const caveName = selectedOption.getAttribute('cave');
      const stationName = selectedOption.getAttribute('station');
      this.locateStation(caveName, stationName);
      input.value = '';
      this.locatePanel.style.display = 'none';
    };

    contentElmnt.appendChild(container);
  }

  locateStation(caveName, stationName) {
    const stationSphere = this.scene.getStationSphere(stationName, caveName);
    if (stationSphere !== undefined) {
      if (this.selectedStation !== undefined) {
        this.#clearSelected();
      }

      // Always use regular selection now
      this.#setSelected(stationSphere);

      this.scene.view.panCameraTo(stationSphere.position);
      this.scene.view.zoomCameraTo(4);
    }
  }

  showShortestPathPanel() {
    this.buildShortestPathPanel();
    document.addEventListener('languageChanged', () => {
      this.buildShortestPathPanel();
    });
  }

  buildShortestPathPanel() {
    const segmentsId = 'shortest-path-segments';

    const addStationSelectors = (caveName) => {
      const form = node`<form id="container-shortest-path"></form>`;
      const stNames = this.db.getStationNames(caveName);
      const options = stNames.map((n) => `<option value="${n}">`).join('');
      const datalist = node`<datalist id="stations">${options}</datalist>`;
      const button = node`<button type="submit">${i18n.t('ui.panels.shortestPath.find')}</button>`;
      const fromL = node`<label for="point-from">${i18n.t('common.from')}:<input required type="search" list="stations" id="point-from"></label>`;
      const toL = node`<label for="point-to">${i18n.t('common.to')}:<input required type="search" list="stations" id="point-to"></label>`;

      form.appendChild(datalist);
      form.appendChild(fromL);
      form.appendChild(toL);
      form.appendChild(button);
      this.locatePanel.appendChild(form);

      form.onsubmit = (e) => {
        e.preventDefault();

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
            this.scene.showSegments(
              segmentsId,
              `shortest-path-${from}-${to}-${segmentsId}`,
              segments,
              this.options.scene.sectionAttributes.color,
              caveName
            );
            label = node`<div id="shortest-path-label">${i18n.t('ui.panels.shortestPath.from')}: ${from} ${i18n.t('ui.panels.shortestPath.to')}: ${to} ${i18n.t('ui.panels.shortestPath.length')}: ${section.distance.toFixed(2)}</div>`;
          } else {
            label = node`<div id="shortest-path-label">${i18n.t('ui.panels.shortestPath.cannotFindPath', { from, to })}</div>`;
          }
        } else {
          label = node`<div id="shortest-path-label">${i18n.t('ui.panels.shortestPath.cannotFindStations', { from, to })}</div>`;
        }
        this.locatePanel.appendChild(label);

      };
    };

    const contentElmnt = makeFloatingPanel(
      this.locatePanel,
      i18n.t('ui.panels.shortestPath.title'),
      false,
      false,
      {},
      () => {
        this.scene.disposeSegments(segmentsId);
        document.removeEventListener('languageChanged', () => {
          this.buildShortestPathPanel();
        });
      }
    );

    const cNames = this.db.getAllCaveNames();
    if (cNames.length > 1) {
      const optionCaveNames = cNames.map((n) => `<option value="${n}">${n}</option>`).join('');
      const caveNamesL = node`<label for="cave-names">${i18n.t('common.cave')}: <select id="cave-names" name="cave-names">${optionCaveNames}</select></label>`;
      const caveNames = caveNamesL.childNodes[1];

      contentElmnt.appendChild(caveNamesL);

      caveNames.onchange = () => {
        const caveName = caveNames.options[caveNames.selectedIndex].text;
        const cont = contentElmnt.querySelector('#container-shortest-path');
        if (cont !== undefined) {
          contentElmnt.removeChild(cont);
        }
        contentElmnt.querySelectorAll('#shortest-path-label').forEach((e) => contentElmnt.removeChild(e));

        addStationSelectors(caveName);
      };
    }

    if (cNames.length > 0) {
      addStationSelectors(cNames[0]);
    }
  }

  showContextMenu(left, top) {
    this.contextMenu.style.display = 'block';
    const adjustedPosition = this.#ensurePanelInViewport(left, top, this.contextMenu);
    this.contextMenu.style.left = adjustedPosition.left + 'px';
    this.contextMenu.style.top = adjustedPosition.top + 'px';

    // Handle very small viewports by making the context menu scrollable if needed
    this.#handleSmallViewportContextMenu();
  }

  hideContextMenu() {
    this.contextMenu.style.display = 'none';
    // Reset any small viewport adjustments
    this.contextMenu.style.maxHeight = '';
    this.contextMenu.style.overflowY = '';
  }

  /**
   * Handles context menu display in very small viewports
   * Makes the menu scrollable if it's too tall for the viewport
   */
  #handleSmallViewportContextMenu() {
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const menuHeight = this.contextMenu.offsetHeight;
    const availableHeight = viewportHeight - 100; // Leave some margin for navbar and padding

    if (menuHeight > availableHeight) {
      this.contextMenu.style.maxHeight = availableHeight + 'px';
      this.contextMenu.style.overflowY = 'auto';
    } else {
      this.contextMenu.style.maxHeight = '';
      this.contextMenu.style.overflowY = '';
    }
  }

  showDistancePanel(from, to, diffVector, left, top, lineRemoveFn) {
    this.buildDistancePanel(from, to, diffVector, left, top, lineRemoveFn);
    document.addEventListener('languageChanged', () => {
      this.buildDistancePanel(from, to, diffVector, left, top, lineRemoveFn);
    });
  }

  buildDistancePanel(from, to, diffVector, left, top, lineRemoveFn) {

    const contentElmnt = makeFloatingPanel(this.infoPanel, i18n.t('ui.panels.distance.title'), false, false, {}, () => {
      lineRemoveFn();

      document.removeEventListener('languageChanged', () => {
        this.buildDistancePanel(from, to, diffVector, left, top, lineRemoveFn);
      });
    });

    const fp = from.position;
    const formatCoords = (a) => a.map((x) => x.toFixed(2)).join(',');
    const tp = to.position;
    const content = node`<div class="infopanel-content"></div>`;

    const polar = toPolar(diffVector);

    content.innerHTML = `
        ${i18n.t('common.from')}: ${from.name} (${formatCoords([fp.x, fp.y, fp.z])})<br>
        ${i18n.t('common.to')}: ${to.name} (${formatCoords([tp.x, tp.y, tp.z])})<br>
        ${i18n.t('ui.panels.distance.x')}: ${diffVector.x.toFixed(3)}<br>
        ${i18n.t('ui.panels.distance.y')}: ${diffVector.y.toFixed(3)}<br>
        ${i18n.t('ui.panels.distance.z')}: ${diffVector.z.toFixed(3)}<br>
        ${i18n.t('ui.panels.distance.azimuth')}: ${radsToDegrees(polar.azimuth).toFixed(3)}°<br>
        ${i18n.t('ui.panels.distance.clino')}: ${radsToDegrees(polar.clino).toFixed(3)}°<br>
        ${i18n.t('ui.panels.distance.horizontal')}: ${Math.sqrt(Math.pow(diffVector.x, 2), Math.pow(diffVector.y, 2)).toFixed(3)}<br>
        ${i18n.t('ui.panels.distance.spatial')}: ${polar.distance.toFixed(3)}
        `;
    contentElmnt.appendChild(content);

    const adjustedPosition = this.#ensurePanelInViewport(left, top, this.infoPanel);

    //FIXME: replace this with a generalized solution
    this.infoPanel.style.left = adjustedPosition.left + 'px';
    this.infoPanel.style.top = adjustedPosition.top + 'px';

  }

  showStationDetailsPanel(station, left, top) {
    this.buildStationDetailsPanel(station, left, top);
    document.addEventListener('languageChanged', () => {
      this.buildStationDetailsPanel(station, left, top);
    });
  }

  buildStationDetailsPanel(station, left, top) {

    const contentElmnt = makeFloatingPanel(
      this.infoPanel,
      i18n.t('ui.panels.stationDetails.title'),
      false,
      false,
      {},
      () => {
        this.#clearSelected();
        this.scene.view.renderView();

        document.removeEventListener('languageChanged', () => {
          this.buildStationDetailsPanel(station, left, top);
        });
      }
    );

    const shots = station.meta.cave.surveys.flatMap((st) =>
      st.shots
        .filter((sh) => sh.from === station.name || sh.to === station.name)
        .map((sh) => ({ survey: st, shot: sh }))
    );
    const shotDetails = shots
      .map((r) => {
        return `
        ${r.shot.from} -> ${r.shot.to} (${r.shot.length.toFixed(2)} m, ${r.shot.clino.toFixed(2)}°, ${r.shot.azimuth.toFixed(2)}°) - ${r.survey.name}`;
      })
      .join('<br>');

    const content = node`<div class="infopanel-content"></div>`;
    content.innerHTML = `
        ${i18n.t('common.name')}: ${station.name}<br><br>
        X: ${station.position.x.toFixed(3)}<br>
        Y: ${station.position.y.toFixed(3)}<br>
        Z: ${station.position.z.toFixed(3)}<br>
        ${i18n.t('common.type')}: ${i18n.t(`params.shotType.${station.meta.type}`)}<br>
        ${i18n.t('common.survey')}: ${station.meta.survey.name}<br>
        ${i18n.t('common.cave')}: ${station.meta.cave.name}<br>
        ${i18n.t('ui.panels.stationDetails.localCoordinates')}: ${get3DCoordsStr(station.meta.coordinates.local)}<br>
        ${i18n.t('ui.panels.stationDetails.eovCoordinates')}: ${station.meta.coordinates.eov === undefined ? i18n.t('ui.panels.stationDetails.notAvailable') : get3DCoordsStr(station.meta.coordinates.eov, ['y', 'x', 'elevation'])}<br>
        ${i18n.t('ui.panels.stationDetails.wgs84Coordinates')}: ${station.meta.coordinates.wgs === undefined ? i18n.t('ui.panels.stationDetails.notAvailable') : get3DCoordsStr(station.meta.coordinates.wgs, ['lat', 'lon'], 6)}<br>
        <br>${i18n.t('common.shots')}:<br>${shotDetails}<br>
        `;
    contentElmnt.appendChild(content);

    const adjustedPosition = this.#ensurePanelInViewport(left, top, this.infoPanel);
    this.infoPanel.style.left = adjustedPosition.left + 'px';
    this.infoPanel.style.top = adjustedPosition.top + 'px';

  }

  /**
   * Ensures the panel position stays within the viewport bounds
   * @param {number} left - Left position in pixels
   * @param {number} top - Top position in pixels
   * @param {number} panelWidth - Width of the panel in pixels
   * @param {number} panelHeight - Height of the panel in pixels
   * @returns {Object} Adjusted left and top positions
   */
  #ensurePanelInViewport(left, top, panel) {
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const margin = 10; // Consistent margin from viewport edges

    let panelWidth = panel.offsetWidth;
    let panelHeight = panel.offsetHeight;

    // Ensure we have valid dimensions - get dimensions if not available
    if (panelWidth <= 0 || panelHeight <= 0) {
      // Temporarily show the panel to get accurate dimensions
      const wasVisible = panel.style.display !== 'none';
      if (!wasVisible) {
        panel.style.display = 'block';
        panel.style.visibility = 'hidden';
        panel.style.position = 'absolute';
        panel.style.left = '-9999px';
        panel.style.top = '-9999px';
      }

      panelWidth = panel.offsetWidth || 200; // fallback width
      panelHeight = panel.offsetHeight || 150; // fallback height

      if (!wasVisible) {
        panel.style.display = 'none';
        panel.style.visibility = 'visible';
        panel.style.position = 'absolute';
        panel.style.left = '';
        panel.style.top = '';
      }
    }

    // Adjust horizontal position
    if (left + panelWidth > viewportWidth - margin) {
      // Try to position to the left of the cursor
      left = Math.max(margin, left - panelWidth);
    }

    // Ensure minimum left margin
    if (left < margin) {
      left = margin;
    }

    // Adjust vertical position
    if (top + panelHeight > viewportHeight - margin) {
      // Try to position above the cursor
      top = Math.max(margin, top - panelHeight);
    }

    // Ensure minimum top margin (account for potential header/navbar)
    const minTopMargin = 50; // Account for navbar height
    if (top < minTopMargin) {
      top = minTopMargin;
    }

    // Final safety checks to ensure panel is completely within viewport
    left = Math.max(margin, Math.min(left, viewportWidth - panelWidth - margin));
    top = Math.max(minTopMargin, Math.min(top, viewportHeight - panelHeight - margin));

    return { left, top };
  }

  /**
   * Handles window resize events to ensure open panels stay within bounds
   */
  handleWindowResize() {
    // Check if infoPanel is visible and reposition if needed
    if (this.infoPanel.style.display === 'block') {
      const currentLeft = parseInt(this.infoPanel.style.left) || 0;
      const currentTop = parseInt(this.infoPanel.style.top) || 0;
      const adjustedPosition = this.#ensurePanelInViewport(currentLeft, currentTop, this.infoPanel);

      this.infoPanel.style.left = adjustedPosition.left + 'px';
      this.infoPanel.style.top = adjustedPosition.top + 'px';
    }

    // Check if contextMenu is visible and reposition if needed
    if (this.contextMenu.style.display === 'block') {
      const currentLeft = parseInt(this.contextMenu.style.left) || 0;
      const currentTop = parseInt(this.contextMenu.style.top) || 0;
      const adjustedPosition = this.#ensurePanelInViewport(currentLeft, currentTop, this.contextMenu);

      this.contextMenu.style.left = adjustedPosition.left + 'px';
      this.contextMenu.style.top = adjustedPosition.top + 'px';
    }
  }
}

export { SceneInteraction };
