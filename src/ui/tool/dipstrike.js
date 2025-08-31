import { makeFloatingPanel } from '../popups.js';
import { node, degreesToRads, fromPolar } from '../../utils/utils.js';
import { StrikeDipCalculator } from '../../utils/geo.js';
import { Vector } from '../../model.js';

import { i18n } from '../../i18n/i18n.js';

export class DipStrikeCalculatorTool {

  constructor(panel = '#tool-panel') {
    this.panel = document.querySelector(panel);
    this.panel.style.width = '300px';
  }

  showPanel() {
    this.buildPanel();
    document.addEventListener('languageChanged', () => {
      this.buildPanel();
    });
  }

  buildPanel() {
    const contentElmnt = makeFloatingPanel(
      this.panel,
      i18n.t('ui.panels.dipStrikeCalculator.title'),
      false,
      false,
      {},
      () => {
        document.removeEventListener('languageChanged', () => {
          this.buildPanel();
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
}
