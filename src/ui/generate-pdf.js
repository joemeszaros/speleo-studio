/*
 * Copyright 2026 Joe Meszaros
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

import { wm } from './window.js';
import { node } from '../utils/utils.js';
import { i18n } from '../i18n/i18n.js';
import { showErrorPanel } from './popups.js';
import { generatePDF } from '../io/pdf.js';

// Page dimensions in mm (width x height in portrait orientation)
const PAGE_SIZES = {
  A5     : { width: 148, height: 210, name: 'A5' },
  A4     : { width: 210, height: 297, name: 'A4' },
  A3     : { width: 297, height: 420, name: 'A3' },
  A2     : { width: 420, height: 594, name: 'A2' },
  A1     : { width: 594, height: 841, name: 'A1' },
  A0     : { width: 841, height: 1189, name: 'A0' },
  Letter : { width: 216, height: 279, name: 'Letter' },
  Legal  : { width: 216, height: 356, name: 'Legal' },
  Custom : { width: 210, height: 297, name: 'Custom' }
};

class PDFPrintDialog {

  constructor(caves, scene, project = null, panel, options = null) {
    this.caves = caves;
    this.scene = scene;
    this.project = project;
    this.panel = panel;
    this.options = options;

    // Layout state
    this.caveBounds = null;
    this.pageLayout = null; // Array of page positions
    this.caveOffset = { x: 0, y: 0 }; // Offset for dragging entire layout
    this.caveBoundsOffset = { x: 0, y: 0 }; // Offset for dragging cave bounds relative to pages (in mm)
    this.selectedPages = new Set();
    this.scale = 1; // Scale factor for PDF rendering (mm per meter)
    this.ratio = 100; // Default ratio (1:100 means 1cm on paper = 1m in cave)

    // Page settings
    this.pageType = 'A4';
    this.pageOrientation = 'portrait'; // 'portrait' or 'landscape'
    this.customWidth = 210;
    this.customHeight = 297;

    // Sheet info box settings
    this.sheetPosition = 'bottom-right'; // 'top-left', 'top-right', 'bottom-left', 'bottom-right'
    this.sheetContent = `${i18n.t('ui.panels.pdfPrint.project')}: ${project?.name || ''}\n${i18n.t('ui.panels.pdfPrint.date')}: ${new Date().toLocaleDateString()}\n${i18n.t('ui.panels.pdfPrint.ratio')}: 1:${this.ratio}`;

    this.marginMM = 10; // Default margin in mm
    this.showMarginBorder = false; // Show margin border on PDF pages
    this.showGrid = false; // Show grid lines on PDF pages
    this.gridSpacingMM = 10; // Grid spacing in mm
    this.backgroundColor = '#ffffff';
    this.rotationAngle = 0;

    // Original cave center (before rotation) for rotating around
    this.originalCaveCenter = { x: 0, y: 0 };
  }

  // Get the camera rotation angle from the scene (in radians)
  getCameraRotation() {
    return this.scene?.view?.control?.getAzimuth();
  }

  // Rotate a 2D point around a center point
  // Angle is in radians, positive = clockwise (opposite of standard math convention)
  rotatePoint(x, y, centerX, centerY, angle) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const dx = x - centerX;
    const dy = y - centerY;
    return {
      x : centerX + dx * cos + dy * sin,
      y : centerY - dx * sin + dy * cos
    };
  }

  // Get line width for a specific line type from options
  getLineWidth(lineType) {
    const defaultWidth = 1.5;
    if (!this.options?.scene) return defaultWidth;

    switch (lineType) {
      case 'centerLines':
        return this.options.scene.centerLines?.segments?.width || defaultWidth;
      case 'splays':
        return this.options.scene.splays?.segments?.width || defaultWidth;
      case 'auxiliaries':
        return this.options.scene.auxiliaries?.segments?.width || defaultWidth;
      default:
        return defaultWidth;
    }
  }

  // Get line opacity for a specific line type from options
  getLineOpacity(lineType) {
    const defaultOpacity = 1.0;
    if (!this.options?.scene) return defaultOpacity;

    switch (lineType) {
      case 'centerLines':
        return this.options.scene.centerLines?.segments?.opacity ?? defaultOpacity;
      case 'splays':
        return this.options.scene.splays?.segments?.opacity ?? defaultOpacity;
      case 'auxiliaries':
        return this.options.scene.auxiliaries?.segments?.opacity ?? defaultOpacity;
      default:
        return defaultOpacity;
    }
  }

  // Check if station labels should be shown
  areStationLabelsVisible() {
    return this.options?.scene?.stationLabels?.show === true;
  }

  // Get station label settings
  getStationLabelSettings() {
    const defaults = {
      mode   : 'name',
      color  : '#000000', // Black for PDF (white wouldn't be visible)
      size   : 10,
      offset : 1.0
    };
    if (!this.options?.scene?.stationLabels) return defaults;

    // For PDF, use black if the configured color is white (wouldn't be visible on white paper)
    let color = this.options.scene.stationLabels.color || defaults.color;
    if (color.toLowerCase() === '#ffffff' || color.toLowerCase() === '#fff') {
      color = '#000000';
    }

    return {
      mode   : this.options.scene.stationLabels.mode || defaults.mode,
      color  : color,
      size   : this.options.scene.stationLabels.size || defaults.size,
      offset : this.options.scene.stationLabels.offset || defaults.offset
    };
  }

  // Get current page dimensions in mm based on page type and orientation
  getPageDimensions() {
    let width, height;

    if (this.pageType === 'Custom') {
      width = this.customWidth;
      height = this.customHeight;
    } else {
      const pageSize = PAGE_SIZES[this.pageType] || PAGE_SIZES.A4;
      width = pageSize.width;
      height = pageSize.height;
    }

    // Swap dimensions for landscape orientation
    if (this.pageOrientation === 'landscape') {
      return { width: height, height: width };
    }
    return { width, height };
  }

  // Compute bounding box based on enabled print content (centerlines, splays, auxiliaries)
  // Applies camera rotation to get bounds in rotated coordinate system
  computeCaveBounds() {
    // Get the camera rotation angle
    this.rotationAngle = this.getCameraRotation();

    if (!this.caves || !this.scene?.speleo?.caveObjects) {
      this.caveBounds = null;
      return;
    }

    // First pass: collect all points to find the original center
    const allPoints = [];

    const collectPointsFromLineSegments = (lineSegments) => {
      if (!lineSegments?.geometry) return;

      const geometry = lineSegments.geometry;
      const instanceStart = geometry.getAttribute('instanceStart');
      const instanceEnd = geometry.getAttribute('instanceEnd');

      if (!instanceStart || !instanceEnd) return;

      const instanceCount = geometry.instanceCount || instanceStart.count;

      for (let i = 0; i < instanceCount; i++) {
        allPoints.push({ x: instanceStart.getX(i), y: instanceStart.getY(i) });
        allPoints.push({ x: instanceEnd.getX(i), y: instanceEnd.getY(i) });
      }
    };

    // Iterate through visible caves and surveys to collect points
    this.caves.forEach((cave) => {
      if (!cave.visible) return;

      const caveObject = this.scene.speleo.caveObjects.get(cave.name);
      if (!caveObject) return;

      cave.surveys.forEach((survey) => {
        if (!survey.visible) return;

        const surveyObject = caveObject.get(survey.name);
        if (!surveyObject) return;

        if (surveyObject.centerLines?.visible) {
          collectPointsFromLineSegments(surveyObject.centerLines);
        }
        if (surveyObject.splays?.visible) {
          collectPointsFromLineSegments(surveyObject.splays);
        }
        if (surveyObject.auxiliaries?.visible) {
          collectPointsFromLineSegments(surveyObject.auxiliaries);
        }
      });
    });

    // Check if we found any content
    if (allPoints.length === 0) {
      this.caveBounds = null;
      return;
    }

    // Calculate original center (before rotation)
    let origMinX = Infinity,
      origMaxX = -Infinity;
    let origMinY = Infinity,
      origMaxY = -Infinity;
    for (const pt of allPoints) {
      origMinX = Math.min(origMinX, pt.x);
      origMaxX = Math.max(origMaxX, pt.x);
      origMinY = Math.min(origMinY, pt.y);
      origMaxY = Math.max(origMaxY, pt.y);
    }
    this.originalCaveCenter = {
      x : (origMinX + origMaxX) / 2,
      y : (origMinY + origMaxY) / 2
    };

    // Second pass: compute rotated bounds
    let minX = Infinity,
      maxX = -Infinity;
    let minY = Infinity,
      maxY = -Infinity;

    for (const pt of allPoints) {
      const rotated = this.rotatePoint(
        pt.x,
        pt.y,
        this.originalCaveCenter.x,
        this.originalCaveCenter.y,
        this.rotationAngle
      );
      minX = Math.min(minX, rotated.x);
      maxX = Math.max(maxX, rotated.x);
      minY = Math.min(minY, rotated.y);
      maxY = Math.max(maxY, rotated.y);
    }

    this.caveBounds = {
      minX,
      maxX,
      minY,
      maxY,
      width  : maxX - minX,
      height : maxY - minY
    };

  }

  show() {
    // Calculate cave bounds based on enabled content
    this.computeCaveBounds();

    if (!this.caveBounds) {
      showErrorPanel(i18n.t('ui.panels.pdfPrint.noCaveData'));
      return;
    }

    // Calculate initial page layout
    this.calculatePageLayout();

    wm.makeFloatingPanel(
      this.panel,
      (contentElmnt, close) => this.build(contentElmnt, close),
      'ui.panels.pdfPrint.title',
      true,
      true,
      { width: window.innerWidth - 100, height: window.innerHeight - 100 },
      () => {
        // Cleanup
        if (this.resizeObserver) {
          this.resizeObserver.disconnect();
          this.resizeObserver = null;
        }
        const canvas = this.panel.querySelector('#pdf-layout-canvas');
        if (canvas) {
          const ctx = canvas.getContext('2d');
          ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
      }
    );
  }

  calculatePageLayout() {
    if (!this.caveBounds) return;

    // Ratio determines scale: 1:ratio means 1 unit on paper = ratio units in cave
    // For example, 1:100 means 1cm on paper = 100cm (1m) in cave
    // So 1mm on paper = ratio mm in cave
    // Scale factor: mm on paper per meter in cave = ratio / 1000
    // (since 1m = 1000mm, and ratio is the number of mm in cave per mm on paper)
    this.scale = this.ratio / 1000; // mm on paper per meter in cave

    // Get current page dimensions based on page type and orientation
    const pageDimensions = this.getPageDimensions();
    const pageWidthMM = pageDimensions.width;
    const pageHeightMM = pageDimensions.height;

    // Calculate page dimensions with margins
    const marginMM = this.marginMM;
    const usableWidthMM = pageWidthMM - marginMM * 2;
    const usableHeightMM = pageHeightMM - marginMM * 2;

    // Convert cave dimensions from meters to mm, then calculate paper size needed
    // Cave width in mm = caveBounds.width * 1000 (meters to mm)
    // Paper width needed = cave width in mm / ratio
    const caveWidthMM = this.caveBounds.width * 1000; // Convert meters to mm
    const caveHeightMM = this.caveBounds.height * 1000; // Convert meters to mm

    const paperWidthNeededMM = caveWidthMM / this.ratio;
    const paperHeightNeededMM = caveHeightMM / this.ratio;

    // Calculate how many pages needed for the cave
    const basePagesX = Math.ceil(paperWidthNeededMM / usableWidthMM);
    const basePagesY = Math.ceil(paperHeightNeededMM / usableHeightMM);

    // Add one extra row and column to allow dragging the cave
    // This ensures centerlines always fit on pages even when dragged
    const pagesX = basePagesX + 1;
    const pagesY = basePagesY + 1;

    // Initialize page layout
    this.pageLayout = [];
    this.selectedPages = new Set(); // Reset selected pages

    // Create page grid
    for (let py = 0; py < pagesY; py++) {
      for (let px = 0; px < pagesX; px++) {
        const pageX = px * usableWidthMM + marginMM;
        const pageY = py * usableHeightMM + marginMM;
        this.pageLayout.push({
          pageX,
          pageY,
          pageIndex : py * pagesX + px,
          selected  : false // Start with all pages deselected
        });
      }
    }

    // Auto-select only pages that contain centerlines
    this.autoSelectPagesWithContent(usableWidthMM, usableHeightMM, marginMM);
  }

  // Build a map of line segments to their page locations based on print settings
  // Key: "type:surveyName:lineIndex", Value: { startPage: pageIndex, endPage: pageIndex }
  buildCenterlinePageMap(usableWidthMM, usableHeightMM, marginMM) {
    const linePageMap = new Map();

    if (!this.caves || !this.scene?.speleo?.caveObjects) {
      return linePageMap;
    }

    // Helper to find which page a point is on (returns page index or -1 if outside all pages)
    const getPageForPoint = (paperX, paperY) => {
      for (const page of this.pageLayout) {
        const pageLeft = page.pageX;
        const pageTop = page.pageY;
        const pageRight = pageLeft + usableWidthMM;
        const pageBottom = pageTop + usableHeightMM;

        if (paperX >= pageLeft && paperX <= pageRight && paperY >= pageTop && paperY <= pageBottom) {
          return page.pageIndex;
        }
      }
      return -1; // Point is outside all pages
    };

    // Helper to convert world coordinates (meters) to paper coordinates (mm)
    // Applies rotation around the original cave center
    const worldToPaperMM = (worldX, worldY) => {
      // Apply rotation around original cave center
      const rotated = this.rotatePoint(
        worldX,
        worldY,
        this.originalCaveCenter.x,
        this.originalCaveCenter.y,
        this.rotationAngle
      );

      const relativeX = rotated.x - this.caveBounds.minX;
      const relativeY = rotated.y - this.caveBounds.minY;

      // Convert to paper mm using the ratio (1m = 1000mm, then divide by ratio)
      const paperX = (relativeX * 1000) / this.ratio;
      // Flip Y: in plan view, Y increases upward in world but downward on paper
      const paperY = ((this.caveBounds.height - relativeY) * 1000) / this.ratio;

      // Add offset for where cave bounds start on paper
      const firstPageX = this.pageLayout[0]?.pageX || marginMM;
      const firstPageY = this.pageLayout[0]?.pageY || marginMM;

      return {
        x : paperX + firstPageX - marginMM + this.caveBoundsOffset.x,
        y : paperY + firstPageY - marginMM + this.caveBoundsOffset.y
      };
    };

    // Helper to process line segments and add to map
    const processLineSegments = (lineSegments, typeName, surveyName) => {
      if (!lineSegments?.geometry) return;

      const geometry = lineSegments.geometry;
      const instanceStart = geometry.getAttribute('instanceStart');
      const instanceEnd = geometry.getAttribute('instanceEnd');

      if (!instanceStart || !instanceEnd) return;

      const instanceCount = geometry.instanceCount || instanceStart.count;

      for (let i = 0; i < instanceCount; i++) {
        const startWorld = { x: instanceStart.getX(i), y: instanceStart.getY(i) };
        const endWorld = { x: instanceEnd.getX(i), y: instanceEnd.getY(i) };

        const startPaper = worldToPaperMM(startWorld.x, startWorld.y);
        const endPaper = worldToPaperMM(endWorld.x, endWorld.y);

        const startPage = getPageForPoint(startPaper.x, startPaper.y);
        const endPage = getPageForPoint(endPaper.x, endPaper.y);

        // Create compound key: type:surveyName:lineIndex
        const key = `${typeName}:${surveyName}:${i}`;
        linePageMap.set(key, { startPage, endPage });
      }
    };

    // Iterate through all visible caves and surveys
    this.caves.forEach((cave) => {
      if (!cave.visible) return;

      const caveObject = this.scene.speleo.caveObjects.get(cave.name);
      if (!caveObject) return;

      cave.surveys.forEach((survey) => {
        if (!survey.visible) return;

        const surveyObject = caveObject.get(survey.name);
        if (!surveyObject) return;

        // Process centerlines if visible in scene
        if (surveyObject.centerLines?.visible) {
          processLineSegments(surveyObject.centerLines, 'cl', survey.name);
        }

        // Process splays if visible in scene
        if (surveyObject.splays?.visible) {
          processLineSegments(surveyObject.splays, 'sp', survey.name);
        }

        // Process auxiliaries if visible in scene
        if (surveyObject.auxiliaries?.visible) {
          processLineSegments(surveyObject.auxiliaries, 'aux', survey.name);
        }
      });
    });

    return linePageMap;
  }

  // Check which pages contain centerline content and select only those
  autoSelectPagesWithContent(usableWidthMM, usableHeightMM, marginMM) {
    // First, clear all selections
    this.selectedPages.clear();
    this.pageLayout.forEach((page) => {
      page.selected = false;
    });

    if (!this.caves || !this.scene?.speleo?.caveObjects) {
      // If no cave data, select all pages as fallback
      this.pageLayout.forEach((page) => {
        page.selected = true;
        this.selectedPages.add(page.pageIndex);
      });
      return;
    }

    // Build the centerline to page map
    this.centerlinePageMap = this.buildCenterlinePageMap(usableWidthMM, usableHeightMM, marginMM);

    // Collect all pages that have centerlines (either start or end point)
    const pagesWithContent = new Set();

    for (const [, pageInfo] of this.centerlinePageMap) {
      // A page has content if a centerline starts or ends on it
      if (pageInfo.startPage >= 0) {
        pagesWithContent.add(pageInfo.startPage);
      }
      if (pageInfo.endPage >= 0) {
        pagesWithContent.add(pageInfo.endPage);
      }
    }

    // Select only pages that have content
    this.pageLayout.forEach((page) => {
      if (pagesWithContent.has(page.pageIndex)) {
        page.selected = true;
        this.selectedPages.add(page.pageIndex);
      }
    });

  }

  build(contentElmnt, close) {
    // Build page type options
    const pageTypeOptions = Object.keys(PAGE_SIZES)
      .map(
        (type) =>
          `<option value="${type}" ${type === this.pageType ? 'selected' : ''}>${PAGE_SIZES[type].name}</option>`
      )
      .join('');

    const container = node`
      <div class="pdf-print-container">
        <div class="pdf-print-layout-editor">
          <div class="pdf-print-canvas-container">
            <canvas id="pdf-layout-canvas"></canvas>
          </div>
          <div class="pdf-print-controls">
            <div class="pdf-print-info">
  
              
              <!-- Tabs -->
              <div class="pdf-print-tabs">
                <button class="pdf-print-tab active" data-tab="page-setup">${i18n.t('ui.panels.pdfPrint.tabPageSetup')}</button>
                <button class="pdf-print-tab" data-tab="sheet">${i18n.t('ui.panels.pdfPrint.tabSheet')}</button>
                <button class="pdf-print-tab" data-tab="other">${i18n.t('ui.panels.pdfPrint.tabOther')}</button>
              </div>
              
              <!-- Tab: Page Setup -->
              <div class="pdf-print-tab-content active" data-tab="page-setup">
                <div class="form-group">
                  <label for="pdf-print-page-type">${i18n.t('ui.panels.pdfPrint.pageType')}:</label>
                  <select id="pdf-print-page-type">${pageTypeOptions}</select>
                </div>
                <div class="form-group" id="pdf-print-custom-size-group" style="display: ${this.pageType === 'Custom' ? 'flex' : 'none'}">
                  <label>${i18n.t('ui.panels.pdfPrint.customSize')}:</label>
                  <input type="number" id="pdf-print-custom-width" min="50" max="2000" value="${this.customWidth}" style="width: 60px" />
                  <span>×</span>
                  <input type="number" id="pdf-print-custom-height" min="50" max="2000" value="${this.customHeight}" style="width: 60px" />
                  <span>mm</span>
                </div>
                <div class="form-group">
                  <label for="pdf-print-orientation">${i18n.t('ui.panels.pdfPrint.orientation')}:</label>
                  <select id="pdf-print-orientation">
                    <option value="portrait" ${this.pageOrientation === 'portrait' ? 'selected' : ''}>${i18n.t('ui.panels.pdfPrint.portrait')}</option>
                    <option value="landscape" ${this.pageOrientation === 'landscape' ? 'selected' : ''}>${i18n.t('ui.panels.pdfPrint.landscape')}</option>
                  </select>
                </div>
              </div>
              
              <!-- Tab: Sheet -->
              <div class="pdf-print-tab-content" data-tab="sheet">
                <div class="form-group">
                  <label>${i18n.t('ui.panels.pdfPrint.sheetInfo')}:</label>
                  <textarea id="pdf-print-sheet-content" rows="4">${this.sheetContent}</textarea>
                </div>
                <div class="form-group">
                  <label for="pdf-print-sheet-position">${i18n.t('ui.panels.pdfPrint.sheetPosition')}:</label>
                  <select id="pdf-print-sheet-position">
                    <option value="top-left" ${this.sheetPosition === 'top-left' ? 'selected' : ''}>${i18n.t('ui.panels.pdfPrint.topLeft')}</option>
                    <option value="top-right" ${this.sheetPosition === 'top-right' ? 'selected' : ''}>${i18n.t('ui.panels.pdfPrint.topRight')}</option>
                    <option value="bottom-left" ${this.sheetPosition === 'bottom-left' ? 'selected' : ''}>${i18n.t('ui.panels.pdfPrint.bottomLeft')}</option>
                    <option value="bottom-right" ${this.sheetPosition === 'bottom-right' ? 'selected' : ''}>${i18n.t('ui.panels.pdfPrint.bottomRight')}</option>
                  </select>
                </div>
              </div>
              
              <!-- Tab: Other -->
              <div class="pdf-print-tab-content" data-tab="other">
                <div class="form-group pdf-print-inline-row">
                  <label for="pdf-print-margin">${i18n.t('ui.panels.pdfPrint.margin')}:</label>
                  <input type="number" id="pdf-print-margin" min="0" max="50" step="1" value="${this.marginMM}" style="width: 50px" />
                  <span class="pdf-print-unit">mm</span>
                  <label class="pdf-print-inline-checkbox">
                    <input type="checkbox" id="pdf-print-show-margin-border" ${this.showMarginBorder ? 'checked' : ''} />
                    ${i18n.t('ui.panels.pdfPrint.showMarginBorder')}
                  </label>
                </div>
                <div class="form-group pdf-print-inline-row">
                  <label for="pdf-print-grid-spacing">${i18n.t('ui.panels.pdfPrint.gridSpacing')}:</label>
                  <input type="number" id="pdf-print-grid-spacing" min="1" max="100" step="1" value="${this.gridSpacingMM}" style="width: 50px" />
                  <span class="pdf-print-unit">mm</span>
                  <label class="pdf-print-inline-checkbox">
                    <input type="checkbox" id="pdf-print-show-grid" ${this.showGrid ? 'checked' : ''} />
                    ${i18n.t('ui.panels.pdfPrint.showGrid')}
                  </label>
                </div>
                <div class="form-group">
                  <label for="pdf-print-background-color">${i18n.t('ui.panels.pdfPrint.backgroundColor')}:</label>
                  <input type="color" id="pdf-print-background-color" value="${this.backgroundColor}" />
                </div>
              </div>
              
              <!-- Main options (always visible) -->
              <p class="pdf-print-instructions">${i18n.t('ui.panels.pdfPrint.instructions')}</p>

              <div class="form-group">
                <label for="pdf-print-ratio">${i18n.t('ui.panels.pdfPrint.ratio')}:</label>
                <input type="number" id="pdf-print-ratio" min="1" step="1" value="${this.ratio}" />
              </div>

              <div class="pdf-print-page-actions">
                <button class="btn btn-small" id="pdf-print-select-all">${i18n.t('ui.panels.pdfPrint.selectAll')}</button>
                <button class="btn btn-small" id="pdf-print-deselect-all">${i18n.t('ui.panels.pdfPrint.deselectAll')}</button>
              </div>

            </div>
            <div class="pdf-print-actions">
              <button class="pdf-print-action-btn-large" id="pdf-print-generate">${i18n.t('ui.panels.pdfPrint.generate')}</button>
              <button class="pdf-print-action-btn-large" id="pdf-print-cancel">${i18n.t('common.cancel')}</button>
            </div>
          </div>
        </div>
      </div>
    `;

    contentElmnt.appendChild(container);

    // Setup tab switching
    const tabs = contentElmnt.querySelectorAll('.pdf-print-tab');
    const tabContents = contentElmnt.querySelectorAll('.pdf-print-tab-content');
    tabs.forEach((tab) => {
      tab.onclick = () => {
        const targetTab = tab.dataset.tab;
        // Update active tab button
        tabs.forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        // Update visible content
        tabContents.forEach((content) => {
          content.classList.toggle('active', content.dataset.tab === targetTab);
        });
      };
    });

    // Setup canvas - query from contentElmnt since that's where it was added
    const canvas = contentElmnt.querySelector('#pdf-layout-canvas');
    if (!canvas) {
      console.error('Canvas not found in contentElmnt');
      return;
    }
    this.setupCanvas(canvas);

    // Setup event listeners - also query from contentElmnt
    const generateBtn = contentElmnt.querySelector('#pdf-print-generate');
    const cancelBtn = contentElmnt.querySelector('#pdf-print-cancel');
    const ratioInput = contentElmnt.querySelector('#pdf-print-ratio');
    const pageTypeSelect = contentElmnt.querySelector('#pdf-print-page-type');
    const orientationSelect = contentElmnt.querySelector('#pdf-print-orientation');
    const customWidthInput = contentElmnt.querySelector('#pdf-print-custom-width');
    const customHeightInput = contentElmnt.querySelector('#pdf-print-custom-height');
    const customSizeGroup = contentElmnt.querySelector('#pdf-print-custom-size-group');
    const marginInput = contentElmnt.querySelector('#pdf-print-margin');
    const showMarginBorderCheckbox = contentElmnt.querySelector('#pdf-print-show-margin-border');

    // Helper to recalculate layout and redraw
    const recalculateAndRedraw = () => {
      this.caveBoundsOffset = { x: 0, y: 0 }; // Reset offset when page settings change
      this.calculatePageLayout();
      this.updatePageCountDisplay();
      if (this.redrawCanvas) {
        this.redrawCanvas();
      }
    };

    // Setup page type handler
    if (pageTypeSelect) {
      pageTypeSelect.onchange = () => {
        this.pageType = pageTypeSelect.value;
        // Show/hide custom size inputs
        if (customSizeGroup) {
          customSizeGroup.style.display = this.pageType === 'Custom' ? 'flex' : 'none';
        }
        recalculateAndRedraw();
      };
    }

    // Setup orientation handler
    if (orientationSelect) {
      orientationSelect.onchange = () => {
        this.pageOrientation = orientationSelect.value;
        recalculateAndRedraw();
      };
    }

    // Setup custom size handlers
    if (customWidthInput) {
      customWidthInput.onchange = () => {
        const width = parseInt(customWidthInput.value, 10);
        if (width >= 50 && width <= 2000) {
          this.customWidth = width;
          if (this.pageType === 'Custom') {
            recalculateAndRedraw();
          }
        }
      };
    }

    if (customHeightInput) {
      customHeightInput.onchange = () => {
        const height = parseInt(customHeightInput.value, 10);
        if (height >= 50 && height <= 2000) {
          this.customHeight = height;
          if (this.pageType === 'Custom') {
            recalculateAndRedraw();
          }
        }
      };
    }

    // Setup ratio input handler
    if (ratioInput) {
      ratioInput.onchange = () => {
        const newRatio = parseInt(ratioInput.value, 10);
        if (newRatio > 0 && isFinite(newRatio)) {
          this.ratio = newRatio;
          recalculateAndRedraw();
        }
      };
    }

    // Setup margin input handler
    if (marginInput) {
      marginInput.onchange = () => {
        const newMargin = parseInt(marginInput.value, 10);
        if (newMargin >= 0 && newMargin <= 50 && isFinite(newMargin)) {
          this.marginMM = newMargin;
          recalculateAndRedraw();
        }
      };
    }

    // Setup show margin border checkbox handler
    if (showMarginBorderCheckbox) {
      showMarginBorderCheckbox.onchange = () => {
        this.showMarginBorder = showMarginBorderCheckbox.checked;
        // No need to recalculate layout, just redraw the canvas
        if (this.redrawCanvas) {
          this.redrawCanvas();
        }
      };
    }

    // Setup grid controls
    const gridSpacingInput = contentElmnt.querySelector('#pdf-print-grid-spacing');
    const showGridCheckbox = contentElmnt.querySelector('#pdf-print-show-grid');

    if (gridSpacingInput) {
      gridSpacingInput.onchange = () => {
        const newSpacing = parseInt(gridSpacingInput.value, 10);
        if (newSpacing >= 1 && newSpacing <= 100 && isFinite(newSpacing)) {
          this.gridSpacingMM = newSpacing;
          // No need to recalculate layout, just affects PDF output
        }
      };
    }

    if (showGridCheckbox) {
      showGridCheckbox.onchange = () => {
        this.showGrid = showGridCheckbox.checked;
      };
    }

    // Setup background color handler
    const backgroundColorInput = contentElmnt.querySelector('#pdf-print-background-color');
    if (backgroundColorInput) {
      backgroundColorInput.onchange = () => {
        this.backgroundColor = backgroundColorInput.value;
        // Redraw canvas with new background color
        if (this.redrawCanvas) {
          this.redrawCanvas();
        }
      };
    }

    // Setup sheet info handlers
    const sheetContentTextarea = contentElmnt.querySelector('#pdf-print-sheet-content');
    const sheetPositionSelect = contentElmnt.querySelector('#pdf-print-sheet-position');

    if (sheetContentTextarea) {
      sheetContentTextarea.oninput = () => {
        this.sheetContent = sheetContentTextarea.value;
      };
    }

    if (sheetPositionSelect) {
      sheetPositionSelect.onchange = () => {
        this.sheetPosition = sheetPositionSelect.value;
      };
    }

    if (generateBtn) {
      generateBtn.onclick = async () => {
        // Guard: prevent generating PDF with 0 pages selected
        if (this.selectedPages.size === 0) {
          showErrorPanel(i18n.t('ui.panels.pdfPrint.noPagesSelected'));
          return;
        }
        generateBtn.disabled = true;
        generateBtn.textContent = 'Loading font...';
        try {
          await this.handleGeneratePDF();
          close();
        } catch (error) {
          console.error('PDF generation failed:', error);
          showErrorPanel(i18n.t('ui.panels.pdfPrint.generationFailed', { error: error.message }));
        } finally {
          generateBtn.disabled = false;
          generateBtn.textContent = i18n.t('ui.panels.pdfPrint.generate');
        }
      };
    }

    if (cancelBtn) {
      cancelBtn.onclick = () => close();
    }

    // Select All / Deselect All buttons
    const selectAllBtn = contentElmnt.querySelector('#pdf-print-select-all');
    const deselectAllBtn = contentElmnt.querySelector('#pdf-print-deselect-all');

    if (selectAllBtn) {
      selectAllBtn.onclick = () => {
        this.pageLayout.forEach((page) => {
          page.selected = true;
          this.selectedPages.add(page.pageIndex);
        });
        this.updatePageCountDisplay();
        if (this.redrawCanvas) {
          this.redrawCanvas();
        }
      };
    }

    if (deselectAllBtn) {
      deselectAllBtn.onclick = () => {
        this.pageLayout.forEach((page) => {
          page.selected = false;
        });
        this.selectedPages.clear();
        this.updatePageCountDisplay();
        if (this.redrawCanvas) {
          this.redrawCanvas();
        }
      };
    }

    this.close = close;

    // Trigger initial redraw after setup is complete
    // Use requestAnimationFrame to ensure DOM is ready
    requestAnimationFrame(() => {

      this.redrawCanvas();

    });
  }

  setupCanvas(canvas) {
    this.canvas = canvas; // Store reference for later use (e.g., preview page)
    const ctx = canvas.getContext('2d');
    let isDragging = false;
    let isDraggingCaveBounds = false; // Track if we're dragging cave bounds or entire layout
    let dragStart = { x: 0, y: 0 };
    let lastOffset = { x: 0, y: 0 };

    const self = this; // Store reference for closure

    // Function to resize canvas to match container
    const resizeCanvas = () => {
      const container = canvas.parentElement;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;

      // Set canvas size to match container, accounting for device pixel ratio
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;

      // Scale the context to handle high DPI displays
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Store logical dimensions for calculations
      canvas.logicalWidth = rect.width;
      canvas.logicalHeight = rect.height;
    };

    // Initial resize
    resizeCanvas();

    // Observe container size changes
    this.resizeObserver = new ResizeObserver(() => {
      resizeCanvas();
      if (this.redrawCanvas) {
        this.redrawCanvas();
      }
    });
    this.resizeObserver.observe(canvas.parentElement);

    // Store redraw function so it can be called externally
    this.redrawCanvas = () => {
      // Use logical dimensions for drawing
      const canvasWidth = canvas.logicalWidth || canvas.width;
      const canvasHeight = canvas.logicalHeight || canvas.height;

      ctx.clearRect(0, 0, canvasWidth, canvasHeight);

      // Fill with configured background color
      ctx.fillStyle = this.backgroundColor || '#ffffff';
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);

      if (!this.caveBounds || !this.pageLayout) {
        // Draw a message on canvas to indicate the issue
        ctx.fillStyle = '#000000';
        ctx.font = '16px Arial';
        ctx.textAlign = 'left';
        ctx.fillText('Waiting for cave data...', 20, 30);
        return;
      }

      // Calculate the total paper size needed (all pages combined) in mm
      const pageDimensions = this.getPageDimensions();
      const marginMM = this.marginMM;
      const usableWidthMM = pageDimensions.width - marginMM * 2;
      const usableHeightMM = pageDimensions.height - marginMM * 2;

      // Find the bounds of all pages
      let minPageX = Infinity;
      let minPageY = Infinity;
      let maxPageX = -Infinity;
      let maxPageY = -Infinity;

      this.pageLayout.forEach((page) => {
        minPageX = Math.min(minPageX, page.pageX);
        minPageY = Math.min(minPageY, page.pageY);
        maxPageX = Math.max(maxPageX, page.pageX + usableWidthMM);
        maxPageY = Math.max(maxPageY, page.pageY + usableHeightMM);
      });

      const totalPaperWidthMM = maxPageX - minPageX;
      const totalPaperHeightMM = maxPageY - minPageY;

      // Calculate canvas scale to fit all pages on canvas
      const margin = 20;
      const usableWidth = canvasWidth - margin * 2;
      const usableHeight = canvasHeight - margin * 2;

      // Check for invalid bounds
      if (totalPaperWidthMM <= 0 || totalPaperHeightMM <= 0) {
        console.error('Invalid paper dimensions:', totalPaperWidthMM, totalPaperHeightMM);
        ctx.fillStyle = '#ff0000';
        ctx.font = '16px Arial';
        ctx.fillText('Invalid paper dimensions!', 20, 30);
        return;
      }

      const scaleX = usableWidth / totalPaperWidthMM;
      const scaleY = usableHeight / totalPaperHeightMM;
      const canvasScale = Math.min(scaleX, scaleY); // pixels per mm

      if (!isFinite(canvasScale) || canvasScale <= 0) {
        console.warn('Invalid canvas scale:', canvasScale);
        return;
      }

      // Calculate offset to center all pages
      const scaledPaperWidth = totalPaperWidthMM * canvasScale;
      const scaledPaperHeight = totalPaperHeightMM * canvasScale;
      const offsetX = margin + (usableWidth - scaledPaperWidth) / 2 + this.caveOffset.x;
      const offsetY = margin + (usableHeight - scaledPaperHeight) / 2 + this.caveOffset.y;

      // Draw pages - convert from mm coordinates to canvas pixels
      // Store page canvas positions for accurate click detection
      this.pageCanvasPositions = new Map();

      this.pageLayout.forEach((page) => {
        // Page positions are in mm relative to minPageX/minPageY
        const pageCanvasX = offsetX + (page.pageX - minPageX) * canvasScale;
        const pageCanvasY = offsetY + (page.pageY - minPageY) * canvasScale;
        const pageCanvasWidth = usableWidthMM * canvasScale;
        const pageCanvasHeight = usableHeightMM * canvasScale;

        // Store canvas position for this page (for click detection)
        this.pageCanvasPositions.set(page.pageIndex, {
          x      : pageCanvasX,
          y      : pageCanvasY,
          width  : pageCanvasWidth,
          height : pageCanvasHeight,
          page   : page
        });

        // Draw page rectangle
        ctx.strokeStyle = page.selected ? '#0066cc' : '#cccccc';
        ctx.lineWidth = page.selected ? 2 : 1;
        ctx.setLineDash(page.selected ? [] : [5, 5]);
        ctx.strokeRect(pageCanvasX, pageCanvasY, pageCanvasWidth, pageCanvasHeight);

        // Draw page number
        ctx.fillStyle = page.selected ? '#0066cc' : '#999999';
        ctx.font = '12px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(`${page.pageIndex + 1}`, pageCanvasX + pageCanvasWidth / 2, pageCanvasY + 15);
      });

      // Build PDF page number map for selected pages
      // Sort selected pages and assign sequential PDF page numbers
      const sortedSelectedPages = this.pageLayout
        .filter((p) => p.selected)
        .sort((a, b) => a.pageIndex - b.pageIndex);

      const pdfPageNumberMap = new Map();
      sortedSelectedPages.forEach((page, idx) => {
        pdfPageNumberMap.set(page.pageIndex, idx + 1);
      });

      // Draw PDF page numbers for selected pages (in parentheses)
      this.pageLayout.forEach((page) => {
        if (!page.selected) return;

        const pos = this.pageCanvasPositions.get(page.pageIndex);
        if (!pos) return;

        const pdfPageNum = pdfPageNumberMap.get(page.pageIndex);
        if (pdfPageNum) {
          ctx.fillStyle = '#009900';
          ctx.font = 'bold 10px Arial';
          ctx.textAlign = 'center';
          ctx.fillText(`(${pdfPageNum})`, pos.x + pos.width / 2, pos.y + 28);
        }
      });

      // Draw cave bounds rectangle (skeleton)
      // Calculate cave bounds position on paper (in mm)
      const caveWidthMM = this.caveBounds.width * 1000; // meters to mm
      const caveHeightMM = this.caveBounds.height * 1000; // meters to mm
      const paperWidthNeededMM = caveWidthMM / this.ratio;
      const paperHeightNeededMM = caveHeightMM / this.ratio;

      // Position cave bounds relative to pages with offset
      const firstPageX = this.pageLayout[0]?.pageX || 0;
      const firstPageY = this.pageLayout[0]?.pageY || 0;
      const caveBoundsX = offsetX + (firstPageX - minPageX + this.caveBoundsOffset.x) * canvasScale;
      const caveBoundsY = offsetY + (firstPageY - minPageY + this.caveBoundsOffset.y) * canvasScale;
      const caveBoundsWidth = paperWidthNeededMM * canvasScale;
      const caveBoundsHeight = paperHeightNeededMM * canvasScale;

      ctx.strokeStyle = '#ff0000';
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      ctx.strokeRect(caveBoundsX, caveBoundsY, caveBoundsWidth, caveBoundsHeight);

      // Draw cave content preview (centerlines)
      // canvasScale is pixels per mm on paper
      // 1000/ratio converts meters to mm on paper (e.g., 1:100 means 1m = 10mm on paper)
      const metersToCanvasPixels = canvasScale * (1000 / this.ratio);
      self.drawCavePreview(ctx, caveBoundsX, caveBoundsY, metersToCanvasPixels);

      // Draw compass rose in the corner of the canvas
      self.drawCanvasCompass(ctx);
    };

    // Call redraw immediately if data is ready
    if (this.caveBounds && this.pageLayout) {
      this.redrawCanvas();
    }

    // Helper function to calculate page positions (used by both click detection and redraw)
    // This must match the exact calculation in redrawCanvas
    const calculatePagePositions = () => {
      if (!this.pageLayout || this.pageLayout.length === 0) return null;

      const pageDimensions = this.getPageDimensions();
      const marginMM = this.marginMM;
      const usableWidthMM = pageDimensions.width - marginMM * 2;
      const usableHeightMM = pageDimensions.height - marginMM * 2;

      // Calculate bounds exactly as in redraw
      let minPageX = Infinity;
      let minPageY = Infinity;
      let maxPageX = -Infinity;
      let maxPageY = -Infinity;

      this.pageLayout.forEach((page) => {
        minPageX = Math.min(minPageX, page.pageX);
        minPageY = Math.min(minPageY, page.pageY);
        maxPageX = Math.max(maxPageX, page.pageX + usableWidthMM);
        maxPageY = Math.max(maxPageY, page.pageY + usableHeightMM);
      });

      const totalPaperWidthMM = maxPageX - minPageX;
      const totalPaperHeightMM = maxPageY - minPageY;

      const margin = 20;
      const canvasWidth = canvas.logicalWidth || canvas.width;
      const canvasHeight = canvas.logicalHeight || canvas.height;
      const usableWidth = canvasWidth - margin * 2;
      const usableHeight = canvasHeight - margin * 2;
      const scaleX = usableWidth / totalPaperWidthMM;
      const scaleY = usableHeight / totalPaperHeightMM;
      const canvasScale = Math.min(scaleX, scaleY);

      const scaledPaperWidth = totalPaperWidthMM * canvasScale;
      const scaledPaperHeight = totalPaperHeightMM * canvasScale;
      const offsetX = margin + (usableWidth - scaledPaperWidth) / 2 + this.caveOffset.x;
      const offsetY = margin + (usableHeight - scaledPaperHeight) / 2 + this.caveOffset.y;

      return {
        marginMM,
        usableWidthMM,
        usableHeightMM,
        minPageX,
        minPageY,
        maxPageX,
        maxPageY,
        totalPaperWidthMM,
        totalPaperHeightMM,
        canvasScale,
        offsetX,
        offsetY
      };
    };

    // Helper to convert mouse event coordinates to canvas coordinates
    // This accounts for CSS scaling of the canvas element
    const getCanvasCoords = (e) => {
      const rect = canvas.getBoundingClientRect();
      // Use logical dimensions for coordinate mapping
      return {
        x : ((e.clientX - rect.left) * (canvas.logicalWidth || canvas.width)) / rect.width,
        y : ((e.clientY - rect.top) * (canvas.logicalHeight || canvas.height)) / rect.height
      };
    };

    // Mouse events - distinguish between click (page selection) and drag (move cave bounds)
    const DRAG_THRESHOLD = 5; // pixels of movement to distinguish click from drag
    let mouseDownPos = null;
    let hasDragged = false;
    let isOnCaveBounds = false;

    // Helper to check if a point is inside cave bounds
    const isInsideCaveBounds = (x, y, pagePos) => {
      if (!this.caveBounds || !this.pageLayout || this.pageLayout.length === 0) return false;

      const caveWidthMM = this.caveBounds.width * 1000;
      const caveHeightMM = this.caveBounds.height * 1000;
      const paperWidthNeededMM = caveWidthMM / this.ratio;
      const paperHeightNeededMM = caveHeightMM / this.ratio;

      const firstPageX = this.pageLayout[0].pageX;
      const firstPageY = this.pageLayout[0].pageY;
      const caveBoundsX =
        pagePos.offsetX + (firstPageX - pagePos.minPageX + this.caveBoundsOffset.x) * pagePos.canvasScale;
      const caveBoundsY =
        pagePos.offsetY + (firstPageY - pagePos.minPageY + this.caveBoundsOffset.y) * pagePos.canvasScale;
      const caveBoundsWidth = paperWidthNeededMM * pagePos.canvasScale;
      const caveBoundsHeight = paperHeightNeededMM * pagePos.canvasScale;

      return x >= caveBoundsX &&
        x <= caveBoundsX + caveBoundsWidth &&
        y >= caveBoundsY &&
        y <= caveBoundsY + caveBoundsHeight;
    };

    // Helper to find clicked page
    const findClickedPage = (x, y) => {
      if (!this.pageCanvasPositions || this.pageCanvasPositions.size === 0) return null;

      for (const [, pos] of this.pageCanvasPositions.entries()) {
        if (x >= pos.x && x <= pos.x + pos.width && y >= pos.y && y <= pos.y + pos.height) {
          return pos.page;
        }
      }
      return null;
    };

    canvas.onmousedown = (e) => {
      const { x, y } = getCanvasCoords(e);
      const pagePos = calculatePagePositions();

      mouseDownPos = { x, y };
      hasDragged = false;
      isOnCaveBounds = pagePos ? isInsideCaveBounds(x, y, pagePos) : false;

      if (isOnCaveBounds) {
        // Prepare for potential drag of cave bounds
        isDragging = true;
        dragStart = { x, y };
        lastOffset = { ...this.caveBoundsOffset };
        isDraggingCaveBounds = true;
      }

      e.preventDefault();
    };

    canvas.onmousemove = (e) => {
      const { x, y } = getCanvasCoords(e);

      // Check if we've exceeded drag threshold
      if (mouseDownPos && !hasDragged) {
        const dx = x - mouseDownPos.x;
        const dy = y - mouseDownPos.y;
        if (Math.sqrt(dx * dx + dy * dy) > DRAG_THRESHOLD) {
          hasDragged = true;
          if (isOnCaveBounds) {
            canvas.style.cursor = 'move';
          }
        }
      }

      if (!isDragging || !hasDragged) return;

      if (isDraggingCaveBounds) {
        // Dragging cave bounds only - convert pixel movement to mm offset
        const pagePos = calculatePagePositions();
        if (pagePos) {
          const deltaX = (x - dragStart.x) / pagePos.canvasScale;
          const deltaY = (y - dragStart.y) / pagePos.canvasScale;
          this.caveBoundsOffset.x = lastOffset.x + deltaX;
          this.caveBoundsOffset.y = lastOffset.y + deltaY;
          this.redrawCanvas();
        }
      } else {
        // Dragging entire layout
        this.caveOffset.x = lastOffset.x + (x - dragStart.x);
        this.caveOffset.y = lastOffset.y + (y - dragStart.y);
        this.updatePageLayout();
        this.redrawCanvas();
      }
    };

    canvas.onmouseup = (e) => {
      const { x, y } = getCanvasCoords(e);

      // If we didn't drag, treat as a click for page selection
      if (!hasDragged && mouseDownPos) {
        const clickedPage = findClickedPage(x, y);
        if (clickedPage) {
          clickedPage.selected = !clickedPage.selected;
          if (clickedPage.selected) {
            this.selectedPages.add(clickedPage.pageIndex);
          } else {
            this.selectedPages.delete(clickedPage.pageIndex);
          }

          this.updatePageCountDisplay();
          this.redrawCanvas();
        }
      } else if (hasDragged && isOnCaveBounds) {
        // After dragging cave bounds, recalculate which pages contain centerlines
        const pageDimensions = this.getPageDimensions();
        const marginMM = this.marginMM;
        const usableWidthMM = pageDimensions.width - marginMM * 2;
        const usableHeightMM = pageDimensions.height - marginMM * 2;
        this.autoSelectPagesWithContent(usableWidthMM, usableHeightMM, marginMM);
        this.updatePageCountDisplay();
        this.redrawCanvas();
      }

      // Reset state
      isDragging = false;
      isDraggingCaveBounds = false;
      mouseDownPos = null;
      hasDragged = false;
      isOnCaveBounds = false;
      canvas.style.cursor = 'default';
    };

    canvas.onmouseleave = () => {
      isDragging = false;
      isDraggingCaveBounds = false;
      mouseDownPos = null;
      hasDragged = false;
      isOnCaveBounds = false;
      canvas.style.cursor = 'default';
    };

    // Initial draw - will be called after build completes
    // redraw is now stored as this.redrawCanvas
  }

  updatePageLayout() {
    if (!this.pageLayout || !this.caveBounds) return;

    // Calculate total paper size (same as in redraw)
    const pageDimensions = this.getPageDimensions();
    const marginMM = this.marginMM;
    const usableWidthMM = pageDimensions.width - marginMM * 2;
    const usableHeightMM = pageDimensions.height - marginMM * 2;

    // Calculate paper size needed for cave
    const caveWidthMM = this.caveBounds.width * 1000;
    const caveHeightMM = this.caveBounds.height * 1000;
    const paperWidthNeededMM = caveWidthMM / this.ratio;
    const paperHeightNeededMM = caveHeightMM / this.ratio;

    const pagesX = Math.ceil(paperWidthNeededMM / usableWidthMM);
    const pagesY = Math.ceil(paperHeightNeededMM / usableHeightMM);

    // Calculate canvas scale (same as in redraw)
    const margin = 20;
    const usableWidth = 800 - margin * 2;
    const usableHeight = 600 - margin * 2;

    // Find current page bounds
    let minPageX = Infinity;
    let minPageY = Infinity;
    this.pageLayout.forEach((page) => {
      minPageX = Math.min(minPageX, page.pageX);
      minPageY = Math.min(minPageY, page.pageY);
    });

    const totalPaperWidthMM = pagesX * usableWidthMM;
    const totalPaperHeightMM = pagesY * usableHeightMM;

    const scaleX = usableWidth / totalPaperWidthMM;
    const scaleY = usableHeight / totalPaperHeightMM;
    const canvasScale = Math.min(scaleX, scaleY);

    // Convert canvas offset (in pixels) to mm offset
    const offsetMMX = this.caveOffset.x / canvasScale;
    const offsetMMY = this.caveOffset.y / canvasScale;

    // Update page positions - keep relative positions but adjust base
    const basePageX = marginMM - offsetMMX;
    const basePageY = marginMM - offsetMMY;

    this.pageLayout.forEach((page, index) => {
      const px = index % pagesX;
      const py = Math.floor(index / pagesX);
      page.pageX = basePageX + px * usableWidthMM;
      page.pageY = basePageY + py * usableHeightMM;
    });
  }

  updatePageCountDisplay() {
    const pageCountEl = this.panel?.querySelector('.pdf-print-page-count');
    if (pageCountEl) {
      pageCountEl.textContent = i18n.t('ui.panels.pdfPrint.pagesCount', {
        count : this.selectedPages?.size || 0,
        total : this.pageLayout?.length || 0
      });
    }
  }

  drawCavePreview(ctx, offsetX, offsetY, canvasScale) {
    // Draw cave lines in the preview based on print settings
    if (!this.caves || !this.scene?.speleo?.caveObjects) {
      return;
    }

    ctx.setLineDash([]);

    // Helper to convert world coordinates (meters) to canvas coordinates
    // Applies rotation around the original cave center
    const worldToCanvas = (worldX, worldY) => {
      // Apply rotation around original cave center
      const rotated = this.rotatePoint(
        worldX,
        worldY,
        this.originalCaveCenter.x,
        this.originalCaveCenter.y,
        this.rotationAngle
      );

      const relativeX = rotated.x - this.caveBounds.minX;
      const relativeY = rotated.y - this.caveBounds.minY;
      // Flip Y: canvas Y increases downward, world Y increases upward
      const canvasX = offsetX + relativeX * canvasScale;
      const canvasY = offsetY + (this.caveBounds.height - relativeY) * canvasScale;
      return { x: canvasX, y: canvasY };
    };

    // Helper to get color from instance attributes with opacity
    const getInstanceColor = (colorAttr, index, opacity = 1.0) => {
      if (!colorAttr || index >= colorAttr.count) return null;
      const r = Math.round(colorAttr.getX(index) * 255);
      const g = Math.round(colorAttr.getY(index) * 255);
      const b = Math.round(colorAttr.getZ(index) * 255);
      return `rgba(${r},${g},${b},${opacity})`;
    };

    // Helper to draw line segments with opacity
    const drawLineSegments = (lineSegments, lineWidth = 1, opacity = 1.0) => {
      if (!lineSegments?.geometry) return;

      const geometry = lineSegments.geometry;
      const instanceStart = geometry.getAttribute('instanceStart');
      const instanceEnd = geometry.getAttribute('instanceEnd');
      const colorStartAttr = geometry.getAttribute('instanceColorStart');
      const colorEndAttr = geometry.getAttribute('instanceColorEnd');

      if (!instanceStart || !instanceEnd) return;

      const instanceCount = geometry.instanceCount || instanceStart.count;
      const hasColors = colorStartAttr && colorStartAttr.count > 0;

      // Get default color from material with opacity
      let defaultColor = `rgba(0, 255, 0, ${opacity})`;
      if (lineSegments.material?.color) {
        const c = lineSegments.material.color;
        defaultColor = `rgba(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}, ${opacity})`;
      }

      ctx.lineWidth = lineWidth;

      for (let i = 0; i < instanceCount; i++) {
        const startX = instanceStart.getX(i);
        const startY = instanceStart.getY(i);
        const endX = instanceEnd.getX(i);
        const endY = instanceEnd.getY(i);

        const startCanvas = worldToCanvas(startX, startY);
        const endCanvas = worldToCanvas(endX, endY);

        // Get color for this segment
        if (hasColors) {
          const startColor = getInstanceColor(colorStartAttr, i, opacity);
          const endColor = getInstanceColor(colorEndAttr, i, opacity);

          if (startColor && endColor && startColor !== endColor) {
            // Create gradient
            const gradient = ctx.createLinearGradient(startCanvas.x, startCanvas.y, endCanvas.x, endCanvas.y);
            gradient.addColorStop(0, startColor);
            gradient.addColorStop(1, endColor);
            ctx.strokeStyle = gradient;
          } else {
            ctx.strokeStyle = startColor || defaultColor;
          }
        } else {
          ctx.strokeStyle = defaultColor;
        }

        ctx.beginPath();
        ctx.moveTo(startCanvas.x, startCanvas.y);
        ctx.lineTo(endCanvas.x, endCanvas.y);
        ctx.stroke();
      }
    };

    // Iterate through all visible caves and surveys
    this.caves.forEach((cave) => {
      if (!cave.visible) return;

      const caveObject = this.scene.speleo.caveObjects.get(cave.name);
      if (!caveObject) return;

      cave.surveys.forEach((survey) => {
        if (!survey.visible) return;

        const surveyObject = caveObject.get(survey.name);
        if (!surveyObject) return;

        // Draw center lines if visible in scene
        if (surveyObject.centerLines?.visible) {
          drawLineSegments(
            surveyObject.centerLines,
            this.getLineWidth('centerLines'),
            this.getLineOpacity('centerLines')
          );
        }

        // Draw splays if visible in scene
        if (surveyObject.splays?.visible) {
          drawLineSegments(surveyObject.splays, this.getLineWidth('splays'), this.getLineOpacity('splays'));
        }

        // Draw auxiliaries if visible in scene (dashed lines)
        if (surveyObject.auxiliaries?.visible) {
          ctx.setLineDash([2, 2]);
          drawLineSegments(
            surveyObject.auxiliaries,
            this.getLineWidth('auxiliaries'),
            this.getLineOpacity('auxiliaries')
          );
          ctx.setLineDash([]);
        }
      });
    });
  }

  // Draw compass rose on the canvas preview
  drawCanvasCompass(ctx) {
    const compassSize = 40; // Size of the compass rose in canvas pixels
    const margin = 15; // Margin from canvas edge
    const arrowLength = 15; // Length of the N arrow

    // Position in top-left corner
    const centerX = margin + compassSize / 2;
    const centerY = margin + compassSize / 2;
    const radius = compassSize / 2 - 5;

    // The rotation angle is the camera rotation
    // Use positive rotation angle (opposite direction)
    const northAngle = this.rotationAngle;

    // Calculate north direction vector (pointing up when angle is 0)
    // In canvas coordinates, Y increases downward, so we need to negate Y
    const northX = Math.sin(northAngle);
    const northY = -Math.cos(northAngle); // Negate because canvas Y is inverted

    // Draw compass circle (outer ring)
    ctx.save();
    ctx.strokeStyle = '#333333';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.stroke();

    // Draw north arrow
    const arrowTipX = centerX + northX * arrowLength;
    const arrowTipY = centerY + northY * arrowLength;
    const arrowBaseX = centerX - northX * arrowLength * 0.3;
    const arrowBaseY = centerY - northY * arrowLength * 0.3;

    // Draw arrow shaft
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#cc0000';
    ctx.beginPath();
    ctx.moveTo(arrowBaseX, arrowBaseY);
    ctx.lineTo(arrowTipX, arrowTipY);
    ctx.stroke();

    // Draw arrowhead
    const headLength = arrowLength * 0.4;
    const headWidth = arrowLength * 0.25;

    // Perpendicular vector for arrowhead wings
    const perpX = -northY;
    const perpY = northX;

    const head1X = arrowTipX - northX * headLength + perpX * headWidth;
    const head1Y = arrowTipY - northY * headLength + perpY * headWidth;
    const head2X = arrowTipX - northX * headLength - perpX * headWidth;
    const head2Y = arrowTipY - northY * headLength - perpY * headWidth;

    // Fill the arrowhead as a triangle
    ctx.fillStyle = '#cc0000';
    ctx.beginPath();
    ctx.moveTo(arrowTipX, arrowTipY);
    ctx.lineTo(head1X, head1Y);
    ctx.lineTo(head2X, head2Y);
    ctx.closePath();
    ctx.fill();

    // Draw "N" label
    ctx.font = 'bold 12px Arial';
    ctx.fillStyle = '#333333';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Position the N label outside the circle in the north direction
    const labelOffset = radius + 10;
    const labelX = centerX + northX * labelOffset;
    const labelY = centerY + northY * labelOffset;
    ctx.fillText('N', labelX, labelY);

    // Draw rotation angle in degrees
    const angleDegrees = ((this.rotationAngle * 180) / Math.PI).toFixed(1);
    ctx.font = '10px Arial';
    ctx.fillStyle = '#666666';
    ctx.fillText(`${angleDegrees}°`, centerX, centerY + radius + 22);

    ctx.restore();
  }

  // Handle PDF generation by calling the external generatePDF function
  async handleGeneratePDF() {
    if (!this.pageLayout || this.selectedPages.size === 0) {
      showErrorPanel(i18n.t('ui.panels.pdfPrint.noPagesSelected'));
      return;
    }

    const pageDimensions = this.getPageDimensions();

    // Build configuration object for generatePDF
    const config = {
      pageLayout    : this.pageLayout,
      selectedPages : this.selectedPages,
      caves         : this.caves,
      scene         : this.scene,
      canvas        : this.canvas,
      options       : {
        pageWidthMM          : pageDimensions.width,
        pageHeightMM         : pageDimensions.height,
        marginMM             : this.marginMM,
        ratio                : this.ratio,
        caveBounds           : this.caveBounds,
        caveBoundsOffset     : this.caveBoundsOffset,
        sheetContent         : this.sheetContent,
        sheetPosition        : this.sheetPosition,
        showGrid             : this.showGrid,
        gridSpacingMM        : this.gridSpacingMM,
        showMarginBorder     : this.showMarginBorder,
        backgroundColor      : this.backgroundColor,
        projectName          : this.project?.name,
        centerLinesWidth     : this.getLineWidth('centerLines'),
        centerLinesOpacity   : this.getLineOpacity('centerLines'),
        splaysWidth          : this.getLineWidth('splays'),
        splaysOpacity        : this.getLineOpacity('splays'),
        auxiliariesWidth     : this.getLineWidth('auxiliaries'),
        auxiliariesOpacity   : this.getLineOpacity('auxiliaries'),
        stationLabelsVisible : this.areStationLabelsVisible(),
        stationLabelSettings : this.getStationLabelSettings(),
        // Rotation settings
        rotationAngle        : this.rotationAngle,
        originalCaveCenter   : this.originalCaveCenter
      }
    };

    await generatePDF(config);
  }
}

export { PDFPrintDialog };
