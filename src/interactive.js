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
import { wm } from './ui/window.js';
import { showErrorPanel } from './ui/popups.js';
import {
  get3DCoordsStr,
  node,
  radsToDegrees,
  toPolar,
  convertLengthFromMeters,
  convertAngleFromDegrees,
  formatFloat,
  bareStationName
} from './utils/utils.js';
import { i18n } from './i18n/i18n.js';
import { Raycasting } from './scene/raycasting.js';
import { AttributesDefinitions } from './attributes.js';
import { CoordinateSystemType } from './model/geo.js';
import { DEFAULT_UNITS } from './model/survey.js';

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
    toolPanel,
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
    this.toolPanel = toolPanel;
    this.selectedStation = undefined;
    this.selectedPosition = undefined;
    this.pointedStation = undefined;
    this.distanceMeasurementMode = false;
    this.distanceFromStation = undefined;
    this.distanceToStation = undefined;
    this.raycastingEnabled = this.options.interactive.raycasting;

    this.mouseOnEditor = false;

    this.raycasting = new Raycasting(this.options, this.scene);

    document.addEventListener('pointermove', (event) => this.onPointerMove(event));
    sceneDOMElement.addEventListener('click', () => this.onClick(), false);
    sceneDOMElement.addEventListener('dblclick', () => this.onDoubleClick(), false);
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
          if (this.selectedStation.type === 'station') {
            this.showStationDetailsPanel(this.selectedStation, event.clientX - rect.left, event.clientY - rect.top);
          } else if (this.selectedStation.type === 'pointcloud' || this.selectedStation.type === 'mesh') {
            this.showSurfacePointDetailsPanel(
              this.selectedStation,
              event.clientX - rect.left,
              event.clientY - rect.top
            );
          }
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
      this.scene.points.focusSphere.visible = false;
      this.scene.points.distanceSphere.position.copy(this.selectedStation.position);
      this.showSphere(this.scene.points.distanceSphere);
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
        this.scene.removeObjectFromScene(line);
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

  toggleRaycasting() {
    this.raycastingEnabled = !this.raycastingEnabled;
    this.options.interactive.raycasting = this.raycastingEnabled;
    if (this.raycastingEnabled) {
      this.footer.showMessage(i18n.t('ui.footer.raycastingEnabled'));
    } else {
      this.footer.showMessage(i18n.t('ui.footer.raycastingDisabled'));
    }
    if (this.raycastingEnabled === false) {
      this.scene.points.focusSphere.visible = false;
    }
  }

  getSelectedStationDetails(st) {
    // Use the same configuration as pointed station details
    return this.getPointedStationDetails(st);
  }

  // `stationKey` is the SURVEY-QUALIFIED station key (`12@survey.path`) — attributes store and
  // their section/component paths reference that qualified key, so matching the bare name misses
  // for multi-survey caves. Attributes are owned per cave node (a cross-sub-cave section lives on
  // the container), so scan the whole subtree; qualified keys are globally unique, so there are
  // no false matches across sub-caves.
  getAttributesForStation(cave, stationKey) {
    const attributes = [];
    cave.walk((c) => {
      if (!c.attributes) return;

      c.attributes.stationAttributes.forEach((sa) => {
        if (sa?.name === stationKey && sa.attribute && sa.visible) {
          attributes.push({ emoji: '📍', attribute: sa.attribute });
        }
      });

      c.attributes.componentAttributes.forEach((ca) => {
        if (
          ca?.component?.path?.some((p) => p.from === stationKey || p.to === stationKey) &&
          ca.attribute &&
          ca.visible
        ) {
          attributes.push({ emoji: '🧩', attribute: ca.attribute });
        }
      });

      c.attributes.sectionAttributes.forEach((sa) => {
        if (sa?.section?.path?.includes(stationKey) && sa.attribute && sa.visible) {
          attributes.push({ emoji: '🔀', attribute: sa.attribute });
        }
      });
    });

    return attributes;
  }

  // Resolves the qualified station key and the cave node that directly owns the station's survey.
  // Comments/dimensions are bare-keyed per cave node, so scoping to the owner node prevents a
  // comment on one sub-cave's station "1" from showing on every other sub-cave's "1".
  #stationContext(stationMeta) {
    const survey = stationMeta.station?.survey;
    const key = stationMeta.key ?? (survey ? survey.qualify(stationMeta.name) : stationMeta.name);
    const chain = survey ? stationMeta.cave.getCaveChain(survey) : [];
    const ownerCave = chain.length > 0 ? chain[chain.length - 1] : stationMeta.cave;
    return { key, ownerCave };
  }

  getPointedStationDetails(stationMeta) {
    const st = stationMeta.station;
    const config = this.options.ui.stationDetails;
    const details = [];

    // Check if cave name, survey name, and station name are all enabled
    const hasCaveName = config.caveName && stationMeta.cave !== undefined;
    const hasSurveyName = config.surveyName && st.survey !== undefined;
    const hasStationName = config.stationName;

    // The full breadcrumb runs top cave → (sub-caves …) → survey, so a survey nested under
    // sub-caves shows its real location (e.g. System Migovec → Vrtnarija Vilinska →
    // Vrtnarija → rural_underground), not just topCave → survey. getSurveyNamePath includes
    // the survey name as its last element; the cave-chain is everything before it.
    const namePath = stationMeta.cave.getSurveyNamePath(st.survey);
    const caveChain = namePath.slice(0, -1);

    // Use arrow format for cave -> survey -> station if all three are enabled
    if (hasCaveName && hasSurveyName && hasStationName) {
      details.push(`${caveChain.join(' → ')} → ${st.survey.name} → ${stationMeta.name}`);
    } else {
      // Use individual names with pipe separators
      if (hasCaveName) {
        details.push(caveChain.join(' → '));
      }
      if (hasSurveyName) {
        details.push(st.survey.name);
      }
      if (hasStationName) {
        details.push(stationMeta.name);
      }
    }

    // Individual coordinates
    const coords = [];
    if (config.xCoordinate) {
      coords.push(`X: ${formatFloat(st.position.x, 2)}`);
    }
    if (config.yCoordinate) {
      coords.push(`Y: ${formatFloat(st.position.y, 2)}`);
    }
    if (config.zCoordinate) {
      coords.push(`Z: ${formatFloat(st.position.z, 2)}`);
    }
    if (coords.length > 0) {
      details.push('(' + coords.join(', ') + ')');
    }

    // EOV coordinates
    if (st.coordinates && st.coordinates.projected && st.coordinates.projected.type === CoordinateSystemType.EOV) {
      const eovCoords = [];
      if (config.eovY) {
        eovCoords.push(`EOV Y: ${formatFloat(st.coordinates.projected.y, 2)}`);
      }
      if (config.eovX) {
        eovCoords.push(`EOV X: ${formatFloat(st.coordinates.projected.x, 2)}`);
      }
      if (config.elevation) {
        eovCoords.push(`Elev: ${formatFloat(st.coordinates.projected.elevation, 2)}`);
      }
      if (eovCoords.length > 0) {
        details.push('(' + eovCoords.join(', ') + ')');
      }
    }

    //UTM coordinates
    if (st.coordinates && st.coordinates.projected && st.coordinates.projected.type === CoordinateSystemType.UTM) {
      const utmCoords = [];
      if (config.utmEasting) {
        utmCoords.push(`UTM E: ${formatFloat(st.coordinates.projected.easting, 2)}`);
      }
      if (config.utmNorthing) {
        utmCoords.push(`UTM N: ${formatFloat(st.coordinates.projected.northing, 2)}`);
      }
      if (config.elevation) {
        utmCoords.push(`Elev: ${formatFloat(st.coordinates.projected.elevation, 2)}`);
      }
      if (utmCoords.length > 0) {
        details.push('(' + utmCoords.join(', ') + ')');
      }
    }

    // Type
    if (config.type) {
      details.push(`${i18n.t('common.type')}: ${i18n.t(`params.shotType.${st.type}`)}`);
    }

    // Position (x,y,z)
    if (config.position) {
      details.push(
        `(${formatFloat(st.position.x, 2)}, ${formatFloat(st.position.y, 2)}, ${formatFloat(st.position.z, 2)})`
      );
    }

    // Shots in compact format
    if (config.shots) {
      const shots = st.shots.map(
        (shw) =>
          `${shw.shot.from}→${shw.shot.to}(${formatFloat(shw.shot.length, 1)}${i18n.t(`ui.units.short.${shw.survey?.units?.length ?? DEFAULT_UNITS.length}`)})`
      );
      if (shots.length > 0) {
        details.push(`${i18n.t('common.shots')}: ${shots.join(', ')}`);
      }
    }

    // Qualified key (for attribute matching) + owning cave node (for bare comment/dimension
    // matching). Computed once, only when one of these sections is shown — this runs on every
    // hover and #stationContext walks the cave tree.
    let stationKey, ownerCave;
    if (config.attributes || config.comments || config.dimensions) {
      ({ key: stationKey, ownerCave } = this.#stationContext(stationMeta));
    }

    if (config.attributes) {
      const attributes = this.getAttributesForStation(stationMeta.cave, stationKey);
      if (attributes.length > 0) {
        const s = attributes
          .map((a) => `${a.emoji} ${AttributesDefinitions.getAttributesAsString([a.attribute], i18n, ',', 20)}`)
          .join(', ');
        details.push(`${i18n.t('common.attributes')}: ${s}`);
      }

    }

    // Comments in compact format
    if (config.comments) {
      const comments = st.shots
        .filter((shw) => shw.shot.to === stationMeta.name)
        .map((shw) => shw.shot.comment)
        .filter((c) => c !== undefined && c !== '');
      // Station comments are bare-keyed per cave node; scope to the OWNING node so a comment on
      // one sub-cave's "1" doesn't show on every other sub-cave's "1".
      const stationComments = ownerCave.stationComments ?? [];
      comments.push(...stationComments.filter((sc) => sc.name === stationMeta.name).map((sc) => sc.comment));
      if (comments.length > 0) {
        details.push(`${i18n.t('common.comments')}: ${comments.join(', ')}`);
      }
    }

    // LRUD passage dimensions
    if (config.dimensions) {
      const sd = (ownerCave.stationDimensions ?? []).find((d) => d.name === stationMeta.name);
      if (sd) {
        const lengthUnit = st.survey?.units?.length ?? DEFAULT_UNITS.length;
        const u = i18n.t('ui.units.short.' + lengthUnit);
        const fmt = (v) => (v === undefined || v === null || isNaN(v) ? '-' : formatFloat(v, 2));
        details.push(`LRUD: ${fmt(sd.left)}/${fmt(sd.right)}/${fmt(sd.up)}/${fmt(sd.down)} ${u}`);
      }
    }

    // If no details are configured, fall back to basic name
    if (details.length === 0) {
      return stationMeta.name;
    }

    return details.join(' | ');
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
    this.scene.points.setFocusSpherePosition(st.position);
    this.showSphere(this.scene.points.focusSphere);
    if (st.type === 'station') {
      this.footer.showMessage(this.getSelectedStationDetails(st));
    } else if (st.type === 'pointcloud') {
      this.footer.showMessage(
        i18n.t('ui.footer.pointCloudPoint', {
          x : formatFloat(st.position.x, 2),
          y : formatFloat(st.position.y, 2),
          z : formatFloat(st.position.z, 2)
        })
      );
    } else if (st.type === 'mesh') {
      this.footer.showMessage(
        i18n.t('ui.footer.meshPoint', {
          name : st.name,
          x    : formatFloat(st.position.x, 2),
          y    : formatFloat(st.position.y, 2),
          z    : formatFloat(st.position.z, 2)
        })
      );
    }
  }

  #clearSelected() {
    this.selectedPosition = undefined;
    this.scene.points.focusSphere.visible = false;
    this.scene.points.distanceSphere.visible = false;
    this.selectedStation = undefined;
    this.distanceMeasurementMode = false;
    this.hideContextMenu();
    this.scene.view.renderView();

  }

  onPointerMove(event) {
    // Always track the latest mouse position. Click/dblclick handlers raycast
    // against the ViewHelper and sprite camera using these coords; without this
    // update they would stay at (0,0) whenever raycasting is disabled.
    this.mouseCoordinates.x = event.clientX;
    this.mouseCoordinates.y = event.clientY;

    if (this.raycastingEnabled === false || this.mouseOnEditor || this.scene.view.isInteracting) {
      return;
    }

    const worldUnitsFor5Pixels = this.scene.view.control.getWorldUnitsForPixels(5);
    const intersectedStation = this.raycasting.getIntersectedStationMeta(this.mouseCoordinates, worldUnitsFor5Pixels);
    const intersectedPhoto = this.raycasting.getFirstIntersectedPhoto(this.mouseCoordinates);

    if (intersectedPhoto !== undefined) {
      if (this.intersectedPhoto === undefined) {
        this.intersectedPhoto = intersectedPhoto;
        this.originalScale = this.intersectedPhoto.scale.clone();
        this.intersectedPhoto.scale.set(this.originalScale.x * 5, this.originalScale.y * 5, this.originalScale.z);
        this.scene.view.renderView();
      }
    } else if (this.intersectedPhoto !== undefined) {
      this.intersectedPhoto.scale.set(this.originalScale.x, this.originalScale.y, this.originalScale.z);
      this.intersectedPhoto = undefined;
      this.originalScale = undefined;
      this.scene.view.renderView();
    }

    if (intersectedStation !== undefined) {
      this.scene.domElement.style.cursor = 'pointer';
      this.scene.points.setFocusTorusPosition(intersectedStation.position);
      const worldUnitsFor30Pixels = this.scene.view.control.getWorldUnitsForPixels(30);
      this.scene.points.focusSprite.scale.set(worldUnitsFor30Pixels, worldUnitsFor30Pixels, worldUnitsFor30Pixels);
      this.scene.points.focusSprite.visible = true;

      this.footer.showMessage(this.getPointedStationDetails(intersectedStation));
      this.pointedStation = intersectedStation;
      this.scene.view.renderView();
    } else if (this.pointedStation !== undefined) {
      this.scene.domElement.style.cursor = 'default';
      this.scene.points.focusSprite.visible = false;
      // do not call clearmessage every time
      this.footer.clearMessage();
      this.pointedStation = undefined;
      this.scene.view.renderView();
    }
  }

  onDoubleClick() {
    const intersectedSprite = this.raycasting.getFirstIntersectedSprite(this.mouseCoordinates);
    if (intersectedSprite !== undefined && typeof intersectedSprite.onclick === 'function') {
      intersectedSprite.onclick(); // custom function
    }
  }

  onClick() {

    const firstSprite = this.raycasting.getFirstIntersectedViewHelperSprite(this.mouseCoordinates);
    if (firstSprite !== undefined && typeof firstSprite.onclick === 'function') {
      firstSprite.onclick(); // custom function
      return; // Exit early if viewhelper was clicked
    }

    if (this.raycastingEnabled === false) {
      return;
    }

    const worldUnitsFor5Pixels = this.scene.view.control.getWorldUnitsForPixels(5);
    const intersectedStation = this.raycasting.getIntersectedStationMeta(this.mouseCoordinates, worldUnitsFor5Pixels);
    const intersectsPointCloud = this.raycasting.getIntersectedPointCloudMeta(this.mouseCoordinates);
    const intersectsMesh = this.raycasting.getIntersectedMeshMeta(this.mouseCoordinates);
    const hasIntersection =
      intersectedStation !== undefined || intersectsPointCloud !== undefined || intersectsMesh !== undefined;

    if (hasIntersection) {
      let intersectedObject;
      if (intersectedStation !== undefined) {
        intersectedObject = intersectedStation;
      } else {
        const cameraPosition = this.scene.view.camera.position;
        const surfaceCandidates = [intersectsPointCloud, intersectsMesh].filter((x) => x !== undefined);
        surfaceCandidates.sort(
          (a, b) => a.position.distanceToSquared(cameraPosition) - b.position.distanceToSquared(cameraPosition)
        );
        intersectedObject = surfaceCandidates[0];
      }

      // Check if we're in distance measurement mode
      if (this.distanceMeasurementMode && (this.distanceFromStation || this.distanceToStation)) {
        // Handle distance measurement
        if (this.handleDistanceMeasurement(intersectedObject)) {
          return; // Distance measurement handled, exit early
        }
      }

      const isSurface = intersectedObject.type === 'pointcloud' || intersectedObject.type === 'mesh';
      if (!isSurface && intersectedObject === this.selectedStation) {
        // clicked on the same sphere again
        this.#clearSelected();
      } else if (
        isSurface &&
        this.selectedStation !== undefined &&
        intersectedObject.type === this.selectedStation.type &&
        intersectedObject.name === this.selectedStation.name &&
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

  showLocateStationPanel() {
    wm.makeFloatingPanel(
      this.toolPanel,
      (e) => this.buildLocateStationPanel(e),
      'ui.panels.locateStation.title',
      false,
      false,
      {}
    );

  }

  buildLocateStationPanel(contentElmnt) {
    const stNames = this.db.getAllStationNameDetails();
    // A datalist collapses options with the same `value`, so each option's value must be
    // unique. In a simple project (one cave, one survey) bare names are already unique, so we
    // show just the station name (typing "A2" works). When the same bare name repeats across
    // surveys/sub-caves we append the full owning path (top cave → … → survey) to
    // disambiguate AND to let the user filter by any cave/survey term (e.g. "rural"). The
    // exact internal key is kept in `station=` for an unambiguous locate.
    const counts = new Map();
    for (const x of stNames) counts.set(x.name, (counts.get(x.name) ?? 0) + 1);
    const optionValue = (x) => (x.path && counts.get(x.name) > 1 ? `${x.name} — ${x.path}` : x.name);
    const options = stNames
      .map(
        (x) =>
          `<option cave="${x.cave}" station="${x.key}" station-name="${x.name.replace(/"/g, '&quot;')}" value="${optionValue(x).replace(/"/g, '&quot;')}">`
      )
      .join('');

    const container = node`<div id="container-locate-station">
        <label for="pointtolocate">${i18n.t('common.station')}: <input type="search" list="stations" id="pointtolocate"/></label>
        <datalist id="stations">${options}</datalist>
        <button id="locate-button">${i18n.t('ui.panels.locateStation.locate')}</button>
      </div>`;
    const input = container.querySelector('#pointtolocate');

    container.querySelector('#locate-button').onclick = () => {
      const typed = input.value.trim();
      // Prefer an exact option-value match (full "name — path" label or a unique bare name).
      // Fall back to the first option whose bare station name equals the typed text, so a user
      // who just types the station name (e.g. "A2") still locates it.
      const opts = [...container.querySelectorAll('#stations option')];
      const selectedOption =
        opts.find((o) => o.value === typed) || opts.find((o) => o.getAttribute('station-name') === typed);
      if (!selectedOption) {
        showErrorPanel(i18n.t('ui.panels.locateStation.notFound', { name: typed }));
        return;
      }
      const caveName = selectedOption.getAttribute('cave');
      const stationName = selectedOption.getAttribute('station');
      this.locateStation(caveName, stationName);
      input.value = '';
      this.toolPanel.style.display = 'none';
    };

    contentElmnt.appendChild(container);
  }

  locateStation(caveName, stationName) {

    const cave = this.db.getCave(caveName);
    let stationMeta;

    for (const [name, station] of cave.getAllStations()) {
      // Map keys are survey-qualified for multi-survey caves; the requested name is bare,
      // so compare against the bare form (first visible match wins).
      if (station.survey.visible && (stationName === name || stationName === bareStationName(name))) {
        stationMeta = { name: bareStationName(name), station, position: station.position, cave: cave, type: 'station' };
        break;
      }
    }

    if (stationMeta !== undefined) {
      if (this.selectedStation !== undefined) {
        this.#clearSelected();
      }

      // Always use regular selection now
      this.#setSelected(stationMeta);

      this.scene.view.panCameraTo(stationMeta.position);
      this.scene.view.zoomCameraTo(4);
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
    this.infoPanel.style.width = '400px';
    wm.makeFloatingPanel(
      this.infoPanel,
      (contentElmnt) => this.buildDistancePanel(contentElmnt, from, to, diffVector, left, top),
      'ui.panels.distance.title',
      false,
      false,
      {},
      () => {
        lineRemoveFn();
      },
      () => {},
      () => {},
      false
    );
  }

  buildDistancePanel(contentElmnt, from, to, diffVector, left, top) {

    const fp = from.position;
    const tp = to.position;
    const content = node`<div class="infopanel-content"></div>`;

    const polar = toPolar(diffVector);

    const detailsFor = (x) => (x.type === 'station' ? `${x.cave.name} → ${x.station.survey.name} → ${x.name}` : x.name);
    const fromDetails = detailsFor(from);
    const toDetails = detailsFor(to);

    // Scene positions and diffs are stored internally in metres / degrees — convert
    // to the user's display unit and append the localized unit label.
    const lengthUnit = this.options?.format?.units?.length ?? DEFAULT_UNITS.length;
    const angleUnit = this.options?.format?.units?.angle ?? DEFAULT_UNITS.angle;
    const lLabel = i18n.t(`ui.units.short.${lengthUnit}`);
    const aLabel = i18n.t(`ui.units.short.${angleUnit}`);
    const fmtL = (m) => `${formatFloat(convertLengthFromMeters(m, lengthUnit), 3)} ${lLabel}`;
    const aSep = angleUnit === 'degrees' ? '' : ' ';
    const fmtA = (deg) => `${formatFloat(convertAngleFromDegrees(deg, angleUnit), 3)}${aSep}${aLabel}`;

    const horizontal = Math.sqrt(diffVector.x * diffVector.x + diffVector.y * diffVector.y);
    content.innerHTML = `
        ${i18n.t('common.from')}: ${fromDetails}<br>
        X: ${fmtL(fp.x)}<br>
        Y: ${fmtL(fp.y)}<br>
        Z: ${fmtL(fp.z)}<br>
        <br>
        ${i18n.t('common.to')}: ${toDetails}<br>
        X: ${fmtL(tp.x)}<br>
        Y: ${fmtL(tp.y)}<br>
        Z: ${fmtL(tp.z)}<br>
        <br>
        ${i18n.t('ui.panels.distance.x')}: ${fmtL(diffVector.x)}<br>
        ${i18n.t('ui.panels.distance.y')}: ${fmtL(diffVector.y)}<br>
        ${i18n.t('ui.panels.distance.z')}: ${fmtL(diffVector.z)}<br>
        ${i18n.t('ui.panels.distance.spatial')}: ${fmtL(polar.distance)}<br>
        ${i18n.t('ui.panels.distance.azimuth')}: ${fmtA(radsToDegrees(polar.azimuth))}<br>
        ${i18n.t('ui.panels.distance.clino')}: ${fmtA(radsToDegrees(polar.clino))}<br>
        ${i18n.t('ui.panels.distance.horizontal')}: ${fmtL(horizontal)}<br>
        <br>
        `;
    contentElmnt.appendChild(content);

    const adjustedPosition = this.#ensurePanelInViewport(left, top, this.infoPanel);

    //FIXME: replace this with a generalized solution
    this.infoPanel.style.left = adjustedPosition.left + 'px';
    this.infoPanel.style.top = adjustedPosition.top + 'px';

  }

  showSurfacePointDetailsPanel(stationMeta, left, top) {
    this.infoPanel.style.width = '350px';
    wm.makeFloatingPanel(
      this.infoPanel,
      (contentElmnt) => this.buildSurfacePointDetailsPanel(contentElmnt, stationMeta, left, top),
      'ui.panels.pointCloudPointDetails.title',
      false,
      false,
      {},
      () => {
        this.#clearSelected();
        this.scene.view.renderView();
      },
      () => {},
      () => {},
      false
    );
  }

  buildSurfacePointDetailsPanel(contentElmnt, pointMeta, left, top) {
    const content = node`<div class="infopanel-content"></div>`;
    content.innerHTML = `
        ${i18n.t('ui.panels.pointCloudPointDetails.fileName')}: ${pointMeta.name}<br><br>
        X: ${formatFloat(pointMeta.position.x, 3)}<br>
        Y: ${formatFloat(pointMeta.position.y, 3)}<br>
        Z: ${formatFloat(pointMeta.position.z, 3)}<br>`;
    contentElmnt.appendChild(content);
    const adjustedPosition = this.#ensurePanelInViewport(left, top, this.infoPanel);
    this.infoPanel.style.left = adjustedPosition.left + 'px';
    this.infoPanel.style.top = adjustedPosition.top + 'px';

  }

  showStationDetailsPanel(stationMeta, left, top) {
    this.infoPanel.style.width = '450px';
    this.infoPanel.style.heigth = '';
    wm.makeFloatingPanel(
      this.infoPanel,
      (contentElmnt) => this.buildStationDetailsPanel(contentElmnt, stationMeta, left, top),
      'ui.panels.stationDetails.title',
      false,
      false,
      {},
      () => {
        this.#clearSelected();
        this.scene.view.renderView();
      },
      () => {},
      () => {},
      false
    );
  }

  buildStationDetailsPanel(contentElmnt, stationMeta, left, top) {

    // Shots touching this station. `stationMeta.name` is the bare station name, which is only
    // unique WITHIN one survey, so scope the search to the station's owning survey (the
    // station knows it). This avoids matching same-numbered stations in sibling surveys of a
    // multi-survey cave. We compare against bare shot.from / getToStationName.
    const ownerSurvey = stationMeta.station.survey;
    const shots = (ownerSurvey ? [ownerSurvey] : stationMeta.cave.getAllSurveys()).flatMap((st) =>
      st.shots
        .filter((sh) => (sh.isCenter() && sh.from === stationMeta.name) || st.getToStationName(sh) === stationMeta.name)
        .map((sh) => ({ survey: st, shot: sh }))
    );
    // Qualified key (attributes) + owning cave node (bare comments/dimensions). Scoping comments
    // to the owner node stops a comment on one sub-cave's "1" appearing on every other "1".
    const { key: stationKey, ownerCave } = this.#stationContext(stationMeta);

    // Station comments are bare-keyed; take them from the station's owning cave node only.
    const comments = (ownerCave.stationComments ?? [])
      .filter((cc) => cc.name === stationMeta.name)
      .map((cc) => cc.comment);
    let commentsString = '';
    if (comments.length > 0) {
      commentsString = `${i18n.t('common.comments')}:<br>${comments.join('<br>')}<br>`;
    }

    let dimensionsString = '';
    const dim = (ownerCave.stationDimensions ?? []).find((d) => d.name === stationMeta.name);
    if (dim) {
      const lengthUnit = stationMeta.station.survey?.units?.length ?? DEFAULT_UNITS.length;
      const u = i18n.t('ui.units.short.' + lengthUnit);
      const fmt = (v) => (v === undefined || v === null || isNaN(v) ? '-' : formatFloat(v, 2));
      dimensionsString =
        `${i18n.t('ui.panels.stationDetails.dimensions')}: ` +
        `${fmt(dim.left)} / ${fmt(dim.right)} / ${fmt(dim.up)} / ${fmt(dim.down)} ${u} ` +
        `(${i18n.t('ui.editors.stationDimensions.columns.left')} / ` +
        `${i18n.t('ui.editors.stationDimensions.columns.right')} / ` +
        `${i18n.t('ui.editors.stationDimensions.columns.up')} / ` +
        `${i18n.t('ui.editors.stationDimensions.columns.down')})<br>`;
    }
    const shotDetails = shots
      .map((r) => {
        const comment = r.shot.comment
          ? r.shot.comment.length > 40
            ? r.shot.comment.substring(0, 40) + '...'
            : r.shot.comment
          : 'no comment';
        const lLabel = i18n.t(`ui.units.short.${r.survey?.units?.length ?? DEFAULT_UNITS.length}`);
        const aLabel = i18n.t(`ui.units.short.${r.survey?.units?.angle ?? DEFAULT_UNITS.angle}`);
        return `
        ${r.shot.from} -> ${r.shot.to} (${formatFloat(r.shot.length, 2)} ${lLabel}, ${formatFloat(r.shot.azimuth, 2)}${aLabel}, ${formatFloat(r.shot.clino, 2)}${aLabel}) - ${r.survey.name} - ${comment}`;
      })
      .join('<br>');

    const attributes = this.getAttributesForStation(stationMeta.cave, stationKey);
    let attributesString = '';
    if (attributes.length > 0) {
      attributesString = attributes
        .map((a) => `${a.emoji} ${AttributesDefinitions.getAttributesAsString([a.attribute], i18n)}`)
        .join('<br>');
      attributesString = `<br>${i18n.t('common.attributes')}: <br>${attributesString}<br></br>`;
    }

    let projectedCoordinates = '';
    if (stationMeta.station.coordinates.projected) {
      if (stationMeta.station.coordinates.projected.type === CoordinateSystemType.EOV) {
        projectedCoordinates = `
          ${i18n.t('ui.panels.stationDetails.eovCoordinates')}: ${get3DCoordsStr(stationMeta.station.coordinates.projected, ['y', 'x', 'elevation'])}<br>
        `;
      } else if (stationMeta.station.coordinates.projected.type === CoordinateSystemType.UTM) {
        projectedCoordinates = `
          ${i18n.t('ui.panels.stationDetails.utmCoordinates')}: ${get3DCoordsStr(stationMeta.station.coordinates.projected, ['easting', 'northing', 'elevation'])}<br>
        `;
      }
    }

    // Full cave chain (top cave → sub-caves …) that owns this station — a station in a nested
    // sub-cave belongs to several caves, so list them all rather than just the top-level cave.
    // getSurveyNamePath returns [topCave, …subCaves…, surveyName]; drop the survey name.
    const caveChain = stationMeta.cave.getSurveyNamePath(stationMeta.station.survey).slice(0, -1);
    const caveLabel = i18n.t(caveChain.length > 1 ? 'common.caves' : 'common.cave');

    const content = node`<div class="infopanel-content"></div>`;
    content.innerHTML = `
        ${i18n.t('common.name')}: ${stationMeta.name}<br><br>
        X: ${formatFloat(stationMeta.position.x, 3)}<br>
        Y: ${formatFloat(stationMeta.position.y, 3)}<br>
        Z: ${formatFloat(stationMeta.position.z, 3)}<br>
        ${i18n.t('common.type')}: ${i18n.t(`params.shotType.${stationMeta.station.type}`)}<br>
        ${i18n.t('common.survey')}: ${stationMeta.station.survey.name}<br>
        ${caveLabel}: ${caveChain.join(' → ')}<br>
        ${i18n.t('ui.panels.stationDetails.localCoordinates')}: ${get3DCoordsStr(stationMeta.station.coordinates.local)}<br>
        ${projectedCoordinates}
        <br>${i18n.t('common.shots')}:<br>${shotDetails}<br><br>
        ${commentsString}
        ${dimensionsString}
        ${attributesString}
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
