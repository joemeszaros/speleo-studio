import { wm } from '../window.js';
import { node, degreesToRads, fromPolar } from '../../utils/utils.js';
import { StrikeDipCalculator } from '../../utils/geo.js';
import { Vector } from '../../model.js';

import { i18n } from '../../i18n/i18n.js';

export class DipStrikeCalculatorTool {

  constructor(panel = '#tool-panel') {
    this.panel = document.querySelector(panel);
    this.panel.style.width = '300px';

    // Data storage
    this.points = [null, null, null];
    this.surveyData = [null, null, null];

    // DOM elements (will be set in build)
    this.container = null;
    this.coordinatesInput = null;
    this.surveyInput = null;
    this.resultSection = null;
    this.errorSection = null;
    this.calculateBtn = null;
    this.clearBtn = null;
    this.coordInputs = null;
    this.surveyInputs = null;
    this.inputMethodRadios = null;

    // Bind event handlers
    this.onInputMethodChange = this.handleInputMethodChange.bind(this);
    this.onCalculateClick = this.handleCalculateClick.bind(this);
    this.onClearClick = this.handleClearClick.bind(this);
    this.onCoordInput = this.handleCoordInput.bind(this);
    this.onSurveyInput = this.handleSurveyInput.bind(this);
  }

  show() {
    wm.makeFloatingPanel(
      this.panel,
      (contentElmnt) => this.build(contentElmnt),
      'ui.panels.dipStrikeCalculator.title',
      false,
      false,
      {},
      () => {
        // Cleanup event listeners when panel is closed
        this.cleanup();
      }
    );
  }

  showCalculatorError(message) {
    const errorMessage = this.errorSection.querySelector('#error-message');
    this.resultSection.style.display = 'none';
    errorMessage.textContent = message;
    this.errorSection.style.display = 'block';
  }

  handleInputMethodChange(event) {
    const radio = event.target;
    if (radio.value === 'coordinates') {
      this.coordinatesInput.style.display = 'block';
      this.surveyInput.style.display = 'none';
    } else {
      this.coordinatesInput.style.display = 'none';
      this.surveyInput.style.display = 'block';
    }
    // Clear results when switching methods
    this.resultSection.style.display = 'none';
    this.errorSection.style.display = 'none';
  }

  handleCalculateClick() {
    const selectedMethod = this.container.querySelector('input[name="input-method"]:checked').value;

    if (selectedMethod === 'coordinates') {
      // Check if all points are defined
      const allPointsDefined = this.points.every(
        (point) =>
          point !== null &&
          point.x !== undefined &&
          point.y !== undefined &&
          point.z !== undefined &&
          point.x != '' &&
          point.y != '' &&
          point.z != ''
      );
      if (!allPointsDefined) {
        this.showCalculatorError(i18n.t('ui.panels.dipStrikeCalculator.error.allPointsDefined'));
        return;
      }

      // Check if points define a valid plane
      if (!StrikeDipCalculator.isValidPlane(this.points[0], this.points[1], this.points[2])) {
        this.showCalculatorError(i18n.t('ui.panels.dipStrikeCalculator.error.validPlane'));
        return;
      }

      try {
        const result = StrikeDipCalculator.calculateStrikeDip(this.points[0], this.points[1], this.points[2]);
        this.errorSection.style.display = 'none';
        this.resultSection.querySelector('#strike-result').textContent = `${result.strike.toFixed(2)}°`;
        this.resultSection.querySelector('#dip-result').textContent = `${result.dip.toFixed(2)}°`;
        this.resultSection.querySelector('#normal-vector-result').textContent =
          `(${result.normal.x.toFixed(3)}, ${result.normal.y.toFixed(3)}, ${result.normal.z.toFixed(3)})`;

        this.resultSection.style.display = 'block';
      } catch (error) {
        this.showCalculatorError(
          `${i18n.t('ui.panels.dipStrikeCalculator.error.calculationError', { error: error.message })}`
        );
      }
    } else {
      // Survey method
      const allSurveyDataDefined = this.surveyData.every(
        (data) => data !== null && data.length !== undefined && data.azimuth !== undefined && data.clino !== undefined
      );
      if (!allSurveyDataDefined) {
        this.showCalculatorError(i18n.t('ui.panels.dipStrikeCalculator.error.allSurveyDataDefined'));
        return;
      }

      try {
        // Convert survey measurements to 3D coordinates
        const convertedPoints = this.surveyData.map((data) => {
          const azimuthRad = degreesToRads(data.azimuth);
          const clinoRad = degreesToRads(data.clino);
          return fromPolar(data.length, azimuthRad, clinoRad);
        });

        // Check if points define a valid plane
        if (!StrikeDipCalculator.isValidPlane(convertedPoints[0], convertedPoints[1], convertedPoints[2])) {
          this.showCalculatorError(i18n.t('ui.panels.dipStrikeCalculator.error.validPlane'));
          return;
        }

        const result = StrikeDipCalculator.calculateStrikeDip(
          convertedPoints[0],
          convertedPoints[1],
          convertedPoints[2]
        );
        this.errorSection.style.display = 'none';
        this.resultSection.querySelector('#strike-result').textContent = `${result.strike.toFixed(2)}°`;
        this.resultSection.querySelector('#dip-result').textContent = `${result.dip.toFixed(2)}°`;
        this.resultSection.querySelector('#normal-vector-result').textContent =
          `(${result.normal.x.toFixed(3)}, ${result.normal.y.toFixed(3)}, ${result.normal.z.toFixed(3)})`;

        this.resultSection.style.display = 'block';
      } catch (error) {
        this.showCalculatorError(
          `${i18n.t('ui.panels.dipStrikeCalculator.error.calculationError', { error: error.message })}`
        );
      }
    }
  }

  handleClearClick() {
    this.points.fill(null);
    this.surveyData.fill(null);
    this.coordInputs.forEach((input) => {
      input.value = '';
    });
    this.surveyInputs.forEach((input) => {
      input.value = '';
    });
    this.resultSection.style.display = 'none';
    this.errorSection.style.display = 'none';
  }

  handleCoordInput(event) {
    const input = event.target;
    const pointIndex = parseInt(input.dataset.point);
    const coord = input.dataset.coord;
    const value = parseFloat(input.value) || 0;

    if (!this.points[pointIndex]) {
      this.points[pointIndex] = new Vector(0, 0, 0);
    }

    this.points[pointIndex][coord] = value;
  }

  handleSurveyInput(event) {
    const input = event.target;
    const pointIndex = parseInt(input.dataset.point);
    const field = input.dataset.field;
    const value = parseFloat(input.value) || 0;

    if (!this.surveyData[pointIndex]) {
      this.surveyData[pointIndex] = {};
    }

    this.surveyData[pointIndex][field] = value;
  }

  cleanup() {
    // Remove event listeners
    if (this.inputMethodRadios) {
      this.inputMethodRadios.forEach((radio) => {
        radio.removeEventListener('change', this.onInputMethodChange);
      });
    }

    if (this.calculateBtn) {
      this.calculateBtn.removeEventListener('click', this.onCalculateClick);
    }

    if (this.clearBtn) {
      this.clearBtn.removeEventListener('click', this.onClearClick);
    }

    if (this.coordInputs) {
      this.coordInputs.forEach((input) => {
        input.removeEventListener('input', this.onCoordInput);
      });
    }

    if (this.surveyInputs) {
      this.surveyInputs.forEach((input) => {
        input.removeEventListener('input', this.onSurveyInput);
      });
    }

    // Clear DOM references to avoid detached nodes
    this.container = null;
    this.coordinatesInput = null;
    this.surveyInput = null;
    this.resultSection = null;
    this.errorSection = null;
    this.calculateBtn = null;
    this.clearBtn = null;
    this.coordInputs = null;
    this.surveyInputs = null;
    this.inputMethodRadios = null;
  }

  build(contentElmnt) {
    this.container = node`
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

    this.calculateBtn = node`<button id="calculate-btn">${i18n.t('ui.panels.dipStrikeCalculator.calculate')}</button>`;
    this.clearBtn = node`<button id="clear-btn">${i18n.t('common.clear')}</button>`;

    this.container.appendChild(this.calculateBtn);
    this.container.appendChild(this.clearBtn);

    this.resultSection = node`
      <div id="results-section" style="display: none;">
        <div>${i18n.t('ui.panels.dipStrikeCalculator.strike')}: <span id="strike-result">-</span></div>
        <div>${i18n.t('ui.panels.dipStrikeCalculator.dip')}: <span id="dip-result">-</span></div>
        <div>${i18n.t('ui.panels.dipStrikeCalculator.normal')}: <span id="normal-vector-result">-</span></div>
      </div>`;
    this.container.appendChild(this.resultSection);

    this.errorSection = node`
      <div id="error-section" style="display: none;">
        <div id="error-message" style="color: #ff6b6b;"></div>
      </div>`;
    this.container.appendChild(this.errorSection);

    // Store DOM element references
    this.inputMethodRadios = this.container.querySelectorAll('input[name="input-method"]');
    this.coordinatesInput = this.container.querySelector('#coordinates-input');
    this.surveyInput = this.container.querySelector('#survey-input');
    this.coordInputs = this.container.querySelectorAll('.coord-input');
    this.surveyInputs = this.container.querySelectorAll('.survey-input');

    // Setup event listeners using bound handlers
    this.inputMethodRadios.forEach((radio) => {
      radio.addEventListener('change', this.onInputMethodChange);
    });

    this.calculateBtn.addEventListener('click', this.onCalculateClick);
    this.clearBtn.addEventListener('click', this.onClearClick);

    this.coordInputs.forEach((input) => {
      input.addEventListener('input', this.onCoordInput);
    });

    this.surveyInputs.forEach((input) => {
      input.addEventListener('input', this.onSurveyInput);
    });

    contentElmnt.appendChild(this.container);
  }
}
