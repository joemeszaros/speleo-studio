import * as THREE from 'three';
import { makeFloatingPanel, showErrorPanel } from './ui/popups.js';
import { get3DCoordsStr, node, degreesToRads, fromPolar } from './utils/utils.js';
import { SectionHelper } from './section.js';
import { ShotType } from './model/survey.js';
import { StrikeDipCalculator } from './utils/geo.js';
import { Vector } from './model.js';
import { i18n } from './i18n/i18n.js';
import { toPolar, radsToDegrees } from './utils/utils.js';

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
    this.selectedStationForContext = undefined;
    this.pointedStation = undefined;

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
          this.showStationDetailsPanel(
            this.selectedStationForContext,
            event.clientX - rect.left,
            event.clientY - rect.top
          );
        }
      },
      {
        name    : i18n.t('menu.station.distanceFromHere'),
        onclick : (event) => this.calcualteDistanceListener(event, 'from')
      },
      { name: i18n.t('menu.station.distanceToHere'), onclick: (event) => this.calcualteDistanceListener(event, 'to') }

    ].forEach((item) => {
      const button = node`<button id="station-context-menu-${item.name.toLowerCase().replace(' ', '-')}">${item.name}</button>`;
      button.onclick = (event) => {
        item.onclick(event);
        this.hideContextMenu();
      };
      this.contextMenu.appendChild(button);

    });
  }

  calcualteDistanceListener(event, direction) {
    const rect = this.scene.getBoundingClientRect();
    const left = event.clientX - rect.left;
    const top = event.clientY - rect.top;

    if (this.selectedStation === undefined) {
      showErrorPanel(i18n.t('ui.panels.distance.error.noStartingPoint'));
    } else {
      let from, to;
      if (direction === 'to') {
        from = this.selectedStation.position.clone();
        to = this.selectedStationForContext.position.clone();
      } else {
        from = this.selectedStationForContext.position.clone();
        to = this.selectedStation.position.clone();
      }
      const diff = to.clone().sub(from);
      this.hideContextMenu();

      const geometry = new THREE.BufferGeometry().setFromPoints([from, to]);
      const line = new THREE.Line(geometry, this.materials.distanceLine);
      line.name = `distance-line-${from}-${to}`;
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
      case ShotType.SPLAY:
        return this.materials.sphere.splay;
      case ShotType.CENTER:
        return this.materials.sphere.centerLine;
      case ShotType.AUXILIARY:
        return this.materials.sphere.auxiliary;
      case 'surface':
        return this.materials.sphere.surface;
      default:
        throw new Error(`Uknown object type for sphere ${object.meta.type}`);
    }
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

  #setSelected(st) {
    this.selectedStation = st;
    this.selectedPosition = st.position.clone();
    this.selectedStation.material = this.materials.sphere.selected;
    this.selectedStation.scale.setScalar(1.7);
    if (this.selectedStation.meta.type === 'surface') {
      this.selectedStation.visible = true;
    }

    this.footer.showMessage(this.getSelectedStationDetails(st));
  }

  #clearSelected() {
    this.selectedPosition = undefined;
    this.selectedStation.material = this.getMaterialForType(this.selectedStation);
    this.selectedStation.scale.setScalar(1.0);
    if (this.selectedStation.meta.type === 'surface') {
      this.selectedStation.visible = false;
    }
    this.selectedStation = undefined;
    this.hideContextMenu();
  }

  #setSelectedForContext(st) {
    this.selectedStationForContext = st;
    this.selectedStationForContext.material = this.materials.sphere.selectedForContext;
    this.selectedStationForContext.scale.setScalar(1.7);
    if (this.selectedStationForContext.type === 'surface') {
      this.selectedStationForContext.visible = true;
    }

    this.footer.showMessage(this.getSelectedStationDetails(st));
  }

  #clearSelectedForContext() {
    this.selectedStationForContext.material = this.getMaterialForType(this.selectedStationForContext);
    this.selectedStationForContext.scale.setScalar(1.0);
    if (this.selectedStationForContext.meta.type === 'surface') {
      this.selectedStationForContext.visible = false;
    }
    this.selectedStationForContext = undefined;
  }

  onPointerMove(event) {
    if (this.mouseOnEditor || this.scene.view.isInteracting) {
      return;
    }
    this.mouseCoordinates.x = event.clientX;
    this.mouseCoordinates.y = event.clientY;
    const intersectedStation = this.scene.getIntersectedStationSphere(this.mouseCoordinates);
    if (intersectedStation !== undefined) {
      this.scene.domElement.style.cursor = 'pointer';
      this.footer.showMessage(this.getPointedStationDetails(intersectedStation));
      this.pointedStation = intersectedStation;
    } else if (this.pointedStation !== undefined) {
      this.scene.domElement.style.cursor = 'default';
      // do not call clearmessage every time
      this.footer.clearMessage();
      this.pointedStation = undefined;
    }
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

    this.hideContextMenu();

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
        }
        this.#clearSelected();
        this.#setSelectedForContext(intersectedObject);
        this.showContextMenu(event.clientX - rect.left, event.clientY - rect.top);
      } else {
        if (this.selectedStationForContext !== undefined) {
          // clicked on the same sphere, that was already selected
          this.#clearSelectedForContext();
          this.hideContextMenu();
        } else {
          this.#setSelectedForContext(intersectedObject);
          this.showContextMenu(event.clientX - rect.left, event.clientY - rect.top);
        }
      }
      this.scene.view.renderView();
    } else {
      this.hideContextMenu();
    }
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
        <div><label for="forContext">${i18n.t('ui.panels.locateStation.forContext')}<input type="checkbox" id="forContext" /></label></div>
        <button id="locate-button">${i18n.t('ui.panels.locateStation.locate')}</button>
      </div>`;
    const input = container.querySelector('#pointtolocate');

    container.querySelector('#locate-button').onclick = () => {
      const selectedOption = container.querySelector(`#stations option[value='${input.value}']`);
      const caveName = selectedOption.getAttribute('cave');
      const stationName = selectedOption.getAttribute('station');
      const forContext = container.querySelector('#forContext').checked;
      this.locateStation(caveName, stationName, forContext);
      input.value = '';
      this.locatePanel.style.display = 'none';
    };

    contentElmnt.appendChild(container);
  }

  locateStation(caveName, stationName, forContext) {
    const stationSphere = this.scene.getStationSphere(stationName, caveName);
    if (stationSphere !== undefined) {
      if (this.selectedStation !== undefined) {
        this.#clearSelected();
      }
      if (forContext) {
        this.#setSelectedForContext(stationSphere);
      } else {
        this.#setSelected(stationSphere);
      }

      this.scene.view.panCameraTo(stationSphere.position);
      this.scene.view.zoomCameraTo(4);
    }
  }

  showDipStrikeCalculatorPanel() {
    this.buildDipStrikeCalculatorPanel();
    document.addEventListener('languageChanged', () => {
      this.buildDipStrikeCalculatorPanel();
    });
  }

  buildDipStrikeCalculatorPanel() {
    const contentElmnt = makeFloatingPanel(
      this.locatePanel,
      i18n.t('ui.panels.dipStrikeCalculator.title'),
      false,
      false,
      {},
      () => {
        document.removeEventListener('languageChanged', () => {
          this.buildDipStrikeCalculatorPanel();
        });
      }
    );

    const container = node`
    <div id="dip-strike-calculator-container">
      <div>${i18n.t('ui.panels.dipStrikeCalculator.inputMethod')}:</div>
      <div>
        <label><input type="radio" name="input-method" value="coordinates" checked /> ${i18n.t('ui.panels.dipStrikeCalculator.coordinates')}</label>
        <label><input type="radio" name="input-method" value="survey" /> ${i18n.t('ui.panels.dipStrikeCalculator.survey')}</label>
      </div>
      
      <div id="coordinates-input" style="display: block;">
        <div>${i18n.t('ui.panels.dipStrikeCalculator.enterCoordinates')}:</div>
        ${[0, 1, 2]
          .map(
            (i) => `
          <div>
            <input type="number" step="0.01" placeholder="X" class="coord-input" data-point="${i}" data-coord="x" />
            <input type="number" step="0.01" placeholder="Y" class="coord-input" data-point="${i}" data-coord="y" />
            <input type="number" step="0.01" placeholder="Z" class="coord-input" data-point="${i}" data-coord="z" />
          </div>
        `
          )
          .join('')}
      </div>
      
      <div id="survey-input" style="display: none;">
        <div>${i18n.t('ui.panels.dipStrikeCalculator.enterSurvey')}:</div>
        ${[0, 1, 2]
          .map(
            (i) => `
          <div>
            <input type="number" step="0.01" placeholder="${i18n.t('ui.panels.dipStrikeCalculator.length')}" class="survey-input" data-point="${i}" data-field="length" />
            <input type="number" step="0.1" placeholder="${i18n.t('ui.panels.dipStrikeCalculator.azimuth')}" class="survey-input" data-point="${i}" data-field="azimuth" />
            <input type="number" step="0.1" placeholder="${i18n.t('ui.panels.dipStrikeCalculator.clino')}" class="survey-input" data-point="${i}" data-field="clino" />
          </div>
        `
          )
          .join('')}
      </div>
    </div>`;

    const calculateBtn = node`<button id="calculate-btn">${i18n.t('ui.panels.dipStrikeCalculator.calculate')}</button>`;
    const clearBtn = node`<button id="clear-btn">${i18n.t('common.clear')}</button>`;

    container.appendChild(calculateBtn);
    container.appendChild(clearBtn);

    const resultSection = node`
      <div id="results-section" style="display: none;">
        <div>${i18n.t('ui.panels.dipStrikeCalculator.strike')}: <span id="strike-result">-</span></div>
        <div>${i18n.t('ui.panels.dipStrikeCalculator.dip')}: <span id="dip-result">-</span></div>
        <div>${i18n.t('ui.panels.dipStrikeCalculator.normal')}: <span id="normal-vector-result">-</span></div>
      </div>`;
    container.appendChild(resultSection);

    const errorSection = node`
      <div id="error-section" style="display: none;">
        <div id="error-message" style="color: #ff6b6b;"></div>
      </div>`;
    container.appendChild(errorSection);

    const showCalculatorError = (message) => {
      const errorMessage = errorSection.querySelector('#error-message');
      resultSection.style.display = 'none';
      errorMessage.textContent = message;
      errorSection.style.display = 'block';
    };

    // Setup input method toggle
    const inputMethodRadios = container.querySelectorAll('input[name="input-method"]');
    const coordinatesInput = container.querySelector('#coordinates-input');
    const surveyInput = container.querySelector('#survey-input');

    inputMethodRadios.forEach((radio) => {
      radio.onchange = () => {
        if (radio.value === 'coordinates') {
          coordinatesInput.style.display = 'block';
          surveyInput.style.display = 'none';
        } else {
          coordinatesInput.style.display = 'none';
          surveyInput.style.display = 'block';
        }
        // Clear results when switching methods
        resultSection.style.display = 'none';
        errorSection.style.display = 'none';
      };
    });

    // Setup event listeners
    const coordInputs = container.querySelectorAll('.coord-input');
    const surveyInputs = container.querySelectorAll('.survey-input');
    const points = [null, null, null];
    const surveyData = [null, null, null];

    calculateBtn.onclick = () => {
      const selectedMethod = container.querySelector('input[name="input-method"]:checked').value;

      if (selectedMethod === 'coordinates') {
        // Check if all points are defined
        const allPointsDefined = points.every((point) => point !== null);
        if (!allPointsDefined) {
          showCalculatorError(i18n.t('ui.panels.dipStrikeCalculator.error.allPointsDefined'));
          return;
        }

        // Check if points define a valid plane
        if (!StrikeDipCalculator.isValidPlane(points[0], points[1], points[2])) {
          showCalculatorError(i18n.t('ui.panels.dipStrikeCalculator.error.validPlane'));
          return;
        }

        try {
          const result = StrikeDipCalculator.calculateStrikeDip(points[0], points[1], points[2]);
          errorSection.style.display = 'none';
          resultSection.querySelector('#strike-result').textContent = `${result.strike.toFixed(2)}°`;
          resultSection.querySelector('#dip-result').textContent = `${result.dip.toFixed(2)}°`;
          resultSection.querySelector('#normal-vector-result').textContent =
            `(${result.normal.x.toFixed(3)}, ${result.normal.y.toFixed(3)}, ${result.normal.z.toFixed(3)})`;

          resultSection.style.display = 'block';
        } catch (error) {
          showCalculatorError(
            `${i18n.t('ui.panels.dipStrikeCalculator.error.calculationError', { error: error.message })}`
          );
        }
      } else {
        // Survey method
        const allSurveyDataDefined = surveyData.every(
          (data) => data !== null && data.length !== undefined && data.azimuth !== undefined && data.clino !== undefined
        );
        if (!allSurveyDataDefined) {
          showCalculatorError(i18n.t('ui.panels.dipStrikeCalculator.error.allSurveyDataDefined'));
          return;
        }

        try {
          // Convert survey measurements to 3D coordinates
          const convertedPoints = surveyData.map((data) => {
            const azimuthRad = degreesToRads(data.azimuth);
            const clinoRad = degreesToRads(data.clino);
            return fromPolar(data.length, azimuthRad, clinoRad);
          });

          // Check if points define a valid plane
          if (!StrikeDipCalculator.isValidPlane(convertedPoints[0], convertedPoints[1], convertedPoints[2])) {
            showCalculatorError(i18n.t('ui.panels.dipStrikeCalculator.error.validPlane'));
            return;
          }

          const result = StrikeDipCalculator.calculateStrikeDip(
            convertedPoints[0],
            convertedPoints[1],
            convertedPoints[2]
          );
          errorSection.style.display = 'none';
          resultSection.querySelector('#strike-result').textContent = `${result.strike.toFixed(2)}°`;
          resultSection.querySelector('#dip-result').textContent = `${result.dip.toFixed(2)}°`;
          resultSection.querySelector('#normal-vector-result').textContent =
            `(${result.normal.x.toFixed(3)}, ${result.normal.y.toFixed(3)}, ${result.normal.z.toFixed(3)})`;

          resultSection.style.display = 'block';
        } catch (error) {
          showCalculatorError(
            `${i18n.t('ui.panels.dipStrikeCalculator.error.calculationError', { error: error.message })}`
          );
        }
      }
    };

    clearBtn.onclick = () => {
      points.fill(null);
      surveyData.fill(null);
      coordInputs.forEach((input) => {
        input.value = '';
      });
      surveyInputs.forEach((input) => {
        input.value = '';
      });
      resultSection.style.display = 'none';
      errorSection.style.display = 'none';
    };

    coordInputs.forEach((input) => {
      input.oninput = () => {
        const pointIndex = parseInt(input.dataset.point);
        const coord = input.dataset.coord;
        const value = parseFloat(input.value) || 0;

        if (!points[pointIndex]) {
          points[pointIndex] = new Vector(0, 0, 0);
        }

        points[pointIndex][coord] = value;
      };
    });

    surveyInputs.forEach((input) => {
      input.oninput = () => {
        const pointIndex = parseInt(input.dataset.point);
        const field = input.dataset.field;
        const value = parseFloat(input.value) || 0;

        if (!surveyData[pointIndex]) {
          surveyData[pointIndex] = {};
        }

        surveyData[pointIndex][field] = value;
      };
    });

    contentElmnt.appendChild(container);
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
  }

  hideContextMenu() {
    this.contextMenu.style.display = 'none';
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
        this.#clearSelectedForContext();
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

    let panelWidth = panel.offsetWidth;
    let panelHeight = panel.offsetHeight;

    // Ensure we have valid dimensions
    if (panelWidth <= 0) {
      console.warn('panelWidth is 0');
      panelWidth = 350;
    }
    if (panelHeight <= 0) {
      console.warn('panelHeight is 0');
      panelHeight = 250;
    }

    // Ensure panel doesn't go off the right edge
    if (left + panelWidth > viewportWidth) {
      left = Math.max(10, viewportWidth - panelWidth - 10); // 10px margin from edge
    }

    // Ensure panel doesn't go off the left edge
    if (left < 10) {
      left = 10;
    }

    // Ensure panel doesn't go off the bottom edge
    if (top + panelHeight + 30 > viewportHeight) {
      top = Math.max(48, viewportHeight - panelHeight - 30); // 10px margin from edge
    }

    // Ensure panel doesn't go off the top edge
    if (top < 48) {
      top = 48;
    }

    // Final safety check - ensure panel is completely visible
    if (left + panelWidth > viewportWidth) {
      left = viewportWidth - panelWidth - 5;
    }
    if (top + panelHeight > viewportHeight) {
      top = viewportHeight - panelHeight - 5;
    }

    // Ensure minimum margins from edges
    left = Math.max(5, Math.min(left, viewportWidth - panelWidth - 5));
    top = Math.max(5, Math.min(top, viewportHeight - panelHeight - 5));

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
