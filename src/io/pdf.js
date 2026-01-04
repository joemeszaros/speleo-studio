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

import { PDFDocument, mmToPt, ptToMm, createPDF } from '../utils/pdf-utils.js';
import { ShotType } from '../model/survey.js';
import { i18n } from '../i18n/i18n.js';

// Re-export pdf-utils functions
export { PDFDocument, mmToPt, ptToMm, createPDF };

/**
 * Generate a multi-page PDF from cave data
 * @param {Object} config - Configuration object
 * @param {Array} config.pageLayout - Array of page positions
 * @param {Set} config.selectedPages - Set of selected page indices
 * @param {Array} config.caves - Array of cave objects
 * @param {Object} config.scene - Scene object with speleo data
 * @param {HTMLCanvasElement} config.canvas - Canvas element for preview capture
 * @param {Object} config.options - Print options
 * @param {number} config.options.pageWidthMM - Page width in mm
 * @param {number} config.options.pageHeightMM - Page height in mm
 * @param {number} config.options.marginMM - Margin in mm
 * @param {number} config.options.ratio - Scale ratio (e.g., 100 for 1:100)
 * @param {Object} config.options.caveBounds - Cave bounding box
 * @param {Object} config.options.caveBoundsOffset - Offset from dragging
 * @param {string} config.options.sheetContent - Sheet info text content
 * @param {string} config.options.sheetPosition - Sheet position (top-left, etc.)
 * @param {boolean} config.options.showGrid - Whether to show grid lines
 * @param {number} config.options.gridSpacingMM - Grid spacing in mm
 * @param {boolean} config.options.showMarginBorder - Whether to show margin border
 * @param {string} config.options.backgroundColor - Background color hex
 * @param {string} config.options.projectName - Project name for filename
 * @param {number} config.options.centerLinesWidth - Center lines width
 * @param {number} config.options.centerLinesOpacity - Center lines opacity
 * @param {number} config.options.splaysWidth - Splays width
 * @param {number} config.options.splaysOpacity - Splays opacity
 * @param {number} config.options.auxiliariesWidth - Auxiliaries width
 * @param {number} config.options.auxiliariesOpacity - Auxiliaries opacity
 * @param {boolean} config.options.stationLabelsVisible - Whether station labels are visible
 * @param {Object} config.options.stationLabelSettings - Station label settings
 */
export async function generatePDF(config) {
  const { pageLayout, selectedPages, caves, scene, canvas, options } = config;

  const {
    pageWidthMM,
    pageHeightMM,
    marginMM,
    ratio,
    caveBounds,
    caveBoundsOffset,
    sheetContent,
    sheetPosition,
    showGrid,
    gridSpacingMM,
    showMarginBorder,
    backgroundColor,
    projectName,
    centerLinesWidth,
    centerLinesOpacity,
    splaysWidth,
    splaysOpacity,
    auxiliariesWidth,
    auxiliariesOpacity,
    stationLabelsVisible,
    stationLabelSettings,
    rotationAngle = 0,
    originalCaveCenter = { x: 0, y: 0 }
  } = options;

  // Rotate a 2D point around a center point
  // Angle is in radians, positive = clockwise (opposite of standard math convention)
  const rotatePoint = (x, y, centerX, centerY, angle) => {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const dx = x - centerX;
    const dy = y - centerY;
    return {
      x : centerX + dx * cos + dy * sin,
      y : centerY - dx * sin + dy * cos
    };
  };

  // Create PDF document with our custom utility
  const pdfDoc = new PDFDocument({
    width  : mmToPt(pageWidthMM),
    height : mmToPt(pageHeightMM)
  });

  // Helper to check if text requires Unicode font (non-WinAnsi characters)
  const requiresUnicodeFont = (text) => {
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      // WinAnsi encoding covers: ASCII (32-126) and Latin-1 Supplement (128-255)
      // Characters outside this range need Unicode font
      if (code > 255 || (code > 126 && code < 128)) {
        return true;
      }
    }
    return false;
  };

  // Collect all text that will be in the PDF to check if Unicode font is needed
  let allText = sheetContent || '';

  // Add station names if they'll be exported
  if (stationLabelsVisible) {
    caves.forEach((cave) => {
      if (!cave.stations) return;
      cave.stations.forEach((station, stationName) => {
        if (station.type === ShotType.SPLAY) return;
        if (!station.position) return;
        if (stationLabelSettings?.mode === 'name') {
          allText += stationName;
        }
      });
    });
  }

  // Only load Unicode font if non-Latin characters are detected
  const needsUnicodeFont = requiresUnicodeFont(allText);
  if (needsUnicodeFont) {
    try {
      await pdfDoc.loadFont('fonts/NotoSans-Regular.ttf');
      console.log('Successfully loaded Unicode font (non-Latin characters detected)');
    } catch (fontError) {
      console.warn('Could not load Unicode font, using built-in Helvetica:', fontError.message);
      // Continue without embedded font - some characters may not render correctly
    }
  } else {
    console.log('Using built-in Helvetica font (only Latin characters detected)');
  }

  // Helper to convert world coordinates (meters) to PDF page coordinates (points)
  // Applies rotation around the original cave center
  const worldToPDFCoords = (worldX, worldY, page) => {
    // Apply rotation around original cave center
    const rotated = rotatePoint(worldX, worldY, originalCaveCenter.x, originalCaveCenter.y, rotationAngle);

    // Convert world coordinates (meters) to paper coordinates (mm)
    const relativeX = rotated.x - caveBounds.minX;
    const relativeY = rotated.y - caveBounds.minY;

    // Apply ratio: 1:ratio means 1mm on paper = ratio mm in cave
    const paperX = (relativeX * 1000) / ratio;
    // Flip Y: in plan view, Y increases upward in world but downward on paper
    const paperY = ((caveBounds.height - relativeY) * 1000) / ratio;

    // Add cave bounds offset (from user dragging)
    const offsetPaperX = paperX + caveBoundsOffset.x;
    const offsetPaperY = paperY + caveBoundsOffset.y;

    // Get the first page position as reference
    const firstPageX = pageLayout[0]?.pageX || marginMM;
    const firstPageY = pageLayout[0]?.pageY || marginMM;

    // Calculate position relative to the current page
    const pageRelativeX = offsetPaperX + firstPageX - page.pageX;
    const pageRelativeY = offsetPaperY + firstPageY - page.pageY;

    // Convert to PDF points
    // PDF origin is at bottom-left, so we need to flip Y
    const pdfX = mmToPt(pageRelativeX);
    const pdfY = mmToPt(pageHeightMM - pageRelativeY);

    return { x: pdfX, y: pdfY };
  };

  // Check if a point is within the page margins
  const isPointInPage = (x, y) => {
    const marginPT = mmToPt(marginMM);
    const usableWidthPT = mmToPt(pageWidthMM - marginMM * 2);
    const usableHeightPT = mmToPt(pageHeightMM - marginMM * 2);

    return x >= marginPT && x <= marginPT + usableWidthPT && y >= marginPT && y <= marginPT + usableHeightPT;
  };

  // Get color for a line segment instance
  const getInstanceColorRGB = (lineSegments, instanceIndex) => {
    const colorStartAttr = lineSegments.geometry?.getAttribute('instanceColorStart');

    if (colorStartAttr && colorStartAttr.count > instanceIndex) {
      return {
        r : Math.round(colorStartAttr.getX(instanceIndex) * 255),
        g : Math.round(colorStartAttr.getY(instanceIndex) * 255),
        b : Math.round(colorStartAttr.getZ(instanceIndex) * 255)
      };
    }

    // Fallback to material color
    if (lineSegments.material?.color) {
      const c = lineSegments.material.color;
      return {
        r : Math.round(c.r * 255),
        g : Math.round(c.g * 255),
        b : Math.round(c.b * 255)
      };
    }

    return { r: 0, g: 0, b: 0 };
  };

  // Export line segments for a page
  const exportLineSegmentsForPage = (lineSegments, page, pdfPage, lineWidth = 0.5, opacity = 1.0) => {
    if (!lineSegments?.geometry) return;

    const geometry = lineSegments.geometry;
    const instanceStart = geometry.getAttribute('instanceStart');
    const instanceEnd = geometry.getAttribute('instanceEnd');

    if (!instanceStart || !instanceEnd) return;

    const instanceCount = geometry.instanceCount || instanceStart.count;

    // Use save/restore for opacity changes
    const needsOpacity = opacity < 1.0;
    if (needsOpacity) {
      pdfPage.saveState();
      pdfPage.setOpacity(opacity);
    }

    for (let i = 0; i < instanceCount; i++) {
      const startWorld = {
        x : instanceStart.getX(i),
        y : instanceStart.getY(i)
      };
      const endWorld = {
        x : instanceEnd.getX(i),
        y : instanceEnd.getY(i)
      };

      const startPDF = worldToPDFCoords(startWorld.x, startWorld.y, page);
      const endPDF = worldToPDFCoords(endWorld.x, endWorld.y, page);

      // Check if line segment intersects with page bounds
      if (
        isPointInPage(startPDF.x, startPDF.y) ||
        isPointInPage(endPDF.x, endPDF.y) ||
        lineIntersectsPageRect(startPDF, endPDF, pageWidthMM, pageHeightMM, marginMM)
      ) {
        const color = getInstanceColorRGB(lineSegments, i);
        pdfPage.setStrokeColor(color.r, color.g, color.b);
        pdfPage.setLineWidth(lineWidth);
        pdfPage.drawLine(startPDF.x, startPDF.y, endPDF.x, endPDF.y);
      }
    }

    // Restore graphics state after drawing
    if (needsOpacity) {
      pdfPage.restoreState();
    }
  };

  // Sort pages by index
  const sortedPages = pageLayout
    .filter((p) => selectedPages.has(p.pageIndex))
    .sort((a, b) => a.pageIndex - b.pageIndex);

  // Add preview page as the first page (showing the layout overview)
  if (canvas) {
    // Create a preview page (same size as content pages)
    const previewPage = pdfDoc.addPage();

    // Capture the canvas as JPEG
    const jpegDataUrl = canvas.toDataURL('image/jpeg', 0.85);
    const base64Data = jpegDataUrl.split(',')[1];
    const binaryString = atob(base64Data);
    const jpegData = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      jpegData[i] = binaryString.charCodeAt(i);
    }

    // Add image to PDF and draw it
    const imageName = pdfDoc.addImage(jpegData, canvas.width, canvas.height);

    // Calculate image dimensions to fit the page with minimal margins
    const previewMarginPT = mmToPt(5); // Minimal margin
    const titleHeightPT = mmToPt(8); // Space for title at top
    const availableWidth = mmToPt(pageWidthMM) - previewMarginPT * 2;
    const availableHeight = mmToPt(pageHeightMM) - previewMarginPT * 2 - titleHeightPT;

    const canvasAspect = canvas.width / canvas.height;
    const pageAspect = availableWidth / availableHeight;

    let drawWidth, drawHeight;
    if (canvasAspect > pageAspect) {
      // Canvas is wider - fit to width
      drawWidth = availableWidth;
      drawHeight = availableWidth / canvasAspect;
    } else {
      // Canvas is taller - fit to height
      drawHeight = availableHeight;
      drawWidth = availableHeight * canvasAspect;
    }

    // Center the image on the page (below the title)
    const drawX = previewMarginPT + (availableWidth - drawWidth) / 2;
    const drawY = previewMarginPT + (availableHeight - drawHeight) / 2;

    previewPage.drawImage(imageName, drawX, drawY, drawWidth, drawHeight);

    // Add title text at top
    previewPage.setFillColor(0, 0, 0);
    previewPage.setFontSize(12);
    previewPage.drawText(
      `Print Layout Preview - ${sortedPages.length} pages`,
      previewMarginPT,
      mmToPt(pageHeightMM) - previewMarginPT - mmToPt(3)
    );
  }

  // Parse background color
  const bgColor = backgroundColor || '#ffffff';
  const bgR = parseInt(bgColor.slice(1, 3), 16);
  const bgG = parseInt(bgColor.slice(3, 5), 16);
  const bgB = parseInt(bgColor.slice(5, 7), 16);

  // Process each selected page
  sortedPages.forEach((page, pageIndex) => {
    // Add page
    const pdfPage = pdfDoc.addPage();

    // Fill page with background color
    pdfPage.setFillColor(bgR, bgG, bgB);
    pdfPage.drawRect(0, 0, mmToPt(pageWidthMM), mmToPt(pageHeightMM), 'fill');

    // Set up clipping rectangle for the usable area
    const marginPT = mmToPt(marginMM);
    const usableWidthPT = mmToPt(pageWidthMM - marginMM * 2);
    const usableHeightPT = mmToPt(pageHeightMM - marginMM * 2);

    pdfPage.saveState();
    pdfPage.clipRect(marginPT, marginPT, usableWidthPT, usableHeightPT);

    // Draw grid lines first (behind everything else) if enabled
    if (showGrid && gridSpacingMM > 0) {
      const gridSpacingPT = mmToPt(gridSpacingMM);
      pdfPage.setStrokeColor(220, 220, 220); // Very light gray grid lines
      pdfPage.setLineWidth(0.25);

      // Draw vertical grid lines
      for (let x = marginPT; x <= marginPT + usableWidthPT; x += gridSpacingPT) {
        pdfPage.drawLine(x, marginPT, x, marginPT + usableHeightPT);
      }

      // Draw horizontal grid lines
      for (let y = marginPT; y <= marginPT + usableHeightPT; y += gridSpacingPT) {
        pdfPage.drawLine(marginPT, y, marginPT + usableWidthPT, y);
      }
    }

    // Process each visible cave
    caves.forEach((cave) => {
      if (!cave.visible) return;

      const caveObject = scene.speleo.caveObjects.get(cave.name);
      if (!caveObject) return;

      // Process each visible survey
      cave.surveys.forEach((survey) => {
        if (!survey.visible) return;

        const surveyObject = caveObject.get(survey.name);
        if (!surveyObject) return;

        // Export center lines if visible in scene
        if (surveyObject.centerLines?.visible && surveyObject.centerLines.geometry?.instanceCount > 0) {
          exportLineSegmentsForPage(surveyObject.centerLines, page, pdfPage, centerLinesWidth, centerLinesOpacity);
        }

        // Export splays if visible in scene
        if (surveyObject.splays?.visible && surveyObject.splays.geometry?.instanceCount > 0) {
          exportLineSegmentsForPage(surveyObject.splays, page, pdfPage, splaysWidth, splaysOpacity);
        }

        // Export auxiliaries if visible in scene
        if (surveyObject.auxiliaries?.visible && surveyObject.auxiliaries.geometry?.instanceCount > 0) {
          exportLineSegmentsForPage(surveyObject.auxiliaries, page, pdfPage, auxiliariesWidth, auxiliariesOpacity);
        }
      });
    });

    pdfPage.restoreState();

    // Export station labels if visible in scene
    if (stationLabelsVisible) {
      const labelColor = stationLabelSettings?.color || '#000000';
      // Parse hex color to RGB
      const r = parseInt(labelColor.slice(1, 3), 16) || 0;
      const g = parseInt(labelColor.slice(3, 5), 16) || 0;
      const b = parseInt(labelColor.slice(5, 7), 16) || 0;

      // Scale font size: the label size in options is in screen pixels
      // We need to convert to PDF points, considering the ratio
      const fontSize = Math.max(6, Math.min(12, (stationLabelSettings?.size || 10) * 0.5));
      pdfPage.setFontSize(fontSize);
      pdfPage.setFillColor(r, g, b);

      caves.forEach((cave) => {
        if (!cave.stations) return;
        cave.stations.forEach((station, stationName) => {
          // Skip splay stations or stations without valid position
          if (station.type === ShotType.SPLAY) return;
          if (!station.position || typeof station.position.x !== 'number') return;

          // Get station position in world coordinates (meters)
          const stationX = station.position.x;
          const stationY = station.position.y;

          // Use the same coordinate transformation as for line segments
          const pdfCoords = worldToPDFCoords(stationX, stationY, page);

          // Check if station is within page margins
          if (isPointInPage(pdfCoords.x, pdfCoords.y)) {
            // Get label text based on mode
            const labelText = stationLabelSettings?.mode === 'depth' ? station.position.z.toFixed(2) : stationName;
            pdfPage.drawText(labelText, pdfCoords.x, pdfCoords.y);
          }
        });
      });
    }

    // Draw margin border if enabled
    if (showMarginBorder) {
      pdfPage.setStrokeColor(128, 128, 128); // Gray border
      pdfPage.setLineWidth(0.5);
      pdfPage.drawRect(marginPT, marginPT, usableWidthPT, usableHeightPT);
    }

    // Draw sheet info box
    drawSheetInfoBox(
      pdfPage,
      pageWidthMM,
      pageHeightMM,
      pageIndex + 1,
      sortedPages.length,
      sheetContent,
      sheetPosition
    );

    // Draw compass rose showing north direction (opposite horizontal corner from sheet)
    const compassPosition = getOppositeHorizontalCorner(sheetPosition);
    drawCompassRose(pdfPage, pageWidthMM, pageHeightMM, rotationAngle, compassPosition);
  });

  // Save PDF
  const fileName = projectName || 'cave-print';
  pdfDoc.save(`${fileName}.pdf`);
}

/**
 * Draw the sheet info box on a PDF page
 */
function drawSheetInfoBox(pdfPage, pageWidthMM, pageHeightMM, currentPage, totalPages, sheetContent, sheetPosition) {
  const boxWidthMM = 55;
  const marginMM = 5;
  const paddingMM = 2;
  const lineHeightMM = 4;
  const fontSize = 7;

  // Parse content lines and add page number
  const contentLines = (sheetContent || '').split('\n').filter((line) => line.trim());
  contentLines.push(`${i18n.t('ui.panels.pdfPrint.page')}: ${currentPage} / ${totalPages}`);

  // Calculate box height based on number of lines
  const boxHeightMM = paddingMM * 2 + contentLines.length * lineHeightMM + 2;

  // Calculate box position based on selected corner
  let boxX, boxY;
  switch (sheetPosition) {
    case 'top-left':
      boxX = marginMM;
      boxY = pageHeightMM - marginMM - boxHeightMM;
      break;
    case 'top-right':
      boxX = pageWidthMM - marginMM - boxWidthMM;
      boxY = pageHeightMM - marginMM - boxHeightMM;
      break;
    case 'bottom-left':
      boxX = marginMM;
      boxY = marginMM;
      break;
    case 'bottom-right':
    default:
      boxX = pageWidthMM - marginMM - boxWidthMM;
      boxY = marginMM;
      break;
  }

  // Convert to points
  const boxXPt = mmToPt(boxX);
  const boxYPt = mmToPt(boxY);
  const boxWidthPt = mmToPt(boxWidthMM);
  const boxHeightPt = mmToPt(boxHeightMM);
  const paddingPt = mmToPt(paddingMM);
  const lineHeightPt = mmToPt(lineHeightMM);

  // Draw box background (white fill with black border)
  pdfPage.setFillColor(255, 255, 255);
  pdfPage.drawRect(boxXPt, boxYPt, boxWidthPt, boxHeightPt, 'fill');
  pdfPage.setStrokeColor(0, 0, 0);
  pdfPage.setLineWidth(0.5);
  pdfPage.drawRect(boxXPt, boxYPt, boxWidthPt, boxHeightPt, 'stroke');

  // Draw text content
  pdfPage.setFillColor(0, 0, 0);
  pdfPage.setFontSize(fontSize);

  // Text positions (PDF Y is from bottom, so we start from top of box)
  const textX = boxXPt + paddingPt;
  let textY = boxYPt + boxHeightPt - paddingPt - lineHeightPt;

  // Draw each line
  for (const line of contentLines) {
    pdfPage.drawText(line, textX, textY);
    textY -= lineHeightPt;
  }
}

/**
 * Check if a line segment intersects with the page rectangle
 */
function lineIntersectsPageRect(start, end, pageWidthMM, pageHeightMM, marginMM) {
  const marginPT = mmToPt(marginMM);
  const usableWidthPT = mmToPt(pageWidthMM) - marginPT * 2;
  const usableHeightPT = mmToPt(pageHeightMM) - marginPT * 2;

  const pageLeft = marginPT;
  const pageRight = marginPT + usableWidthPT;
  const pageTop = marginPT;
  const pageBottom = marginPT + usableHeightPT;

  // Simple line-rectangle intersection check
  // Check if line segment intersects with any edge of the page rectangle
  return lineIntersectsLine(start, end, { x: pageLeft, y: pageTop }, { x: pageRight, y: pageTop }) ||
    lineIntersectsLine(start, end, { x: pageRight, y: pageTop }, { x: pageRight, y: pageBottom }) ||
    lineIntersectsLine(start, end, { x: pageRight, y: pageBottom }, { x: pageLeft, y: pageBottom }) ||
    lineIntersectsLine(start, end, { x: pageLeft, y: pageBottom }, { x: pageLeft, y: pageTop });
}

/**
 * Check if two line segments intersect
 */
function lineIntersectsLine(p1, p2, p3, p4) {
  const denom = (p4.y - p3.y) * (p2.x - p1.x) - (p4.x - p3.x) * (p2.y - p1.y);
  if (denom === 0) return false;

  const ua = ((p4.x - p3.x) * (p1.y - p3.y) - (p4.y - p3.y) * (p1.x - p3.x)) / denom;
  const ub = ((p2.x - p1.x) * (p1.y - p3.y) - (p2.y - p1.y) * (p1.x - p3.x)) / denom;

  return ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1;
}

/**
 * Get the opposite horizontal corner (same vertical level)
 * @param {string} position - Current position
 * @returns {string} - Opposite horizontal position
 */
function getOppositeHorizontalCorner(position) {
  switch (position) {
    case 'top-left':
      return 'top-right';
    case 'top-right':
      return 'top-left';
    case 'bottom-left':
      return 'bottom-right';
    case 'bottom-right':
    default:
      return 'bottom-left';
  }
}

/**
 * Draw a compass rose on a PDF page showing the direction of north
 * @param {Object} pdfPage - The PDF page to draw on
 * @param {number} pageWidthMM - Page width in mm
 * @param {number} pageHeightMM - Page height in mm
 * @param {number} rotationAngle - Rotation angle in radians (camera rotation)
 * @param {string} position - Position on page ('top-left', 'top-right', 'bottom-left', 'bottom-right')
 */
function drawCompassRose(pdfPage, pageWidthMM, pageHeightMM, rotationAngle, position = 'top-right') {
  const compassSizeMM = 30; // Size of the compass rose (2x bigger)
  const marginMM = 8; // Margin from page edge
  const arrowLengthMM = 10; // Length of the N arrow (2x bigger)
  const circleDiameterMM = 20; // Diameter of the compass circle (2x bigger)

  // Calculate compass center position based on position option
  let centerX, centerY;
  switch (position) {
    case 'top-left':
      centerX = marginMM + compassSizeMM / 2;
      centerY = marginMM + compassSizeMM / 2;
      break;
    case 'top-right':
      centerX = pageWidthMM - marginMM - compassSizeMM / 2;
      centerY = marginMM + compassSizeMM / 2;
      break;
    case 'bottom-left':
      centerX = marginMM + compassSizeMM / 2;
      centerY = pageHeightMM - marginMM - compassSizeMM / 2;
      break;
    case 'bottom-right':
    default:
      centerX = pageWidthMM - marginMM - compassSizeMM / 2;
      centerY = pageHeightMM - marginMM - compassSizeMM / 2;
      break;
  }

  // Convert to PDF points
  const centerXPt = mmToPt(centerX);
  const centerYPt = mmToPt(pageHeightMM - centerY); // Flip Y for PDF coordinates
  const radiusPt = mmToPt(circleDiameterMM / 2);
  const arrowLengthPt = mmToPt(arrowLengthMM);

  // The rotation angle is the camera rotation
  // Use positive rotation angle (opposite direction)
  const northAngle = rotationAngle;

  // Calculate north direction vector (pointing up when angle is 0)
  // In PDF coordinates, Y increases upward, so north is +Y direction
  const northX = Math.sin(northAngle);
  const northY = Math.cos(northAngle);

  // Draw compass circle (outer ring)
  pdfPage.setStrokeColor(0, 0, 0);
  pdfPage.setLineWidth(0.5);

  // Draw a circle using bezier curves (PDF doesn't have a circle primitive)
  // Use 4 bezier curves to approximate a circle
  const k = 0.5522847498; // Magic number for bezier circle approximation
  const kR = k * radiusPt;

  // First draw white background circle (filled)
  pdfPage.setFillColor(255, 255, 255);
  pdfPage.moveTo(centerXPt + radiusPt, centerYPt);
  // Right to top
  pdfPage.operations.push(
    `${(centerXPt + radiusPt).toFixed(2)} ${(centerYPt + kR).toFixed(2)} ` +
      `${(centerXPt + kR).toFixed(2)} ${(centerYPt + radiusPt).toFixed(2)} ` +
      `${centerXPt.toFixed(2)} ${(centerYPt + radiusPt).toFixed(2)} c`
  );
  // Top to left
  pdfPage.operations.push(
    `${(centerXPt - kR).toFixed(2)} ${(centerYPt + radiusPt).toFixed(2)} ` +
      `${(centerXPt - radiusPt).toFixed(2)} ${(centerYPt + kR).toFixed(2)} ` +
      `${(centerXPt - radiusPt).toFixed(2)} ${centerYPt.toFixed(2)} c`
  );
  // Left to bottom
  pdfPage.operations.push(
    `${(centerXPt - radiusPt).toFixed(2)} ${(centerYPt - kR).toFixed(2)} ` +
      `${(centerXPt - kR).toFixed(2)} ${(centerYPt - radiusPt).toFixed(2)} ` +
      `${centerXPt.toFixed(2)} ${(centerYPt - radiusPt).toFixed(2)} c`
  );
  // Bottom to right
  pdfPage.operations.push(
    `${(centerXPt + kR).toFixed(2)} ${(centerYPt - radiusPt).toFixed(2)} ` +
      `${(centerXPt + radiusPt).toFixed(2)} ${(centerYPt - kR).toFixed(2)} ` +
      `${(centerXPt + radiusPt).toFixed(2)} ${centerYPt.toFixed(2)} c`
  );
  pdfPage.closePath();
  pdfPage.fill();

  // Now draw the circle outline (stroked)
  pdfPage.moveTo(centerXPt + radiusPt, centerYPt);
  // Right to top
  pdfPage.operations.push(
    `${(centerXPt + radiusPt).toFixed(2)} ${(centerYPt + kR).toFixed(2)} ` +
      `${(centerXPt + kR).toFixed(2)} ${(centerYPt + radiusPt).toFixed(2)} ` +
      `${centerXPt.toFixed(2)} ${(centerYPt + radiusPt).toFixed(2)} c`
  );
  // Top to left
  pdfPage.operations.push(
    `${(centerXPt - kR).toFixed(2)} ${(centerYPt + radiusPt).toFixed(2)} ` +
      `${(centerXPt - radiusPt).toFixed(2)} ${(centerYPt + kR).toFixed(2)} ` +
      `${(centerXPt - radiusPt).toFixed(2)} ${centerYPt.toFixed(2)} c`
  );
  // Left to bottom
  pdfPage.operations.push(
    `${(centerXPt - radiusPt).toFixed(2)} ${(centerYPt - kR).toFixed(2)} ` +
      `${(centerXPt - kR).toFixed(2)} ${(centerYPt - radiusPt).toFixed(2)} ` +
      `${centerXPt.toFixed(2)} ${(centerYPt - radiusPt).toFixed(2)} c`
  );
  // Bottom to right
  pdfPage.operations.push(
    `${(centerXPt + kR).toFixed(2)} ${(centerYPt - radiusPt).toFixed(2)} ` +
      `${(centerXPt + radiusPt).toFixed(2)} ${(centerYPt - kR).toFixed(2)} ` +
      `${(centerXPt + radiusPt).toFixed(2)} ${centerYPt.toFixed(2)} c`
  );
  pdfPage.stroke();

  // Draw north arrow
  const arrowTipX = centerXPt + northX * arrowLengthPt;
  const arrowTipY = centerYPt + northY * arrowLengthPt;
  const arrowBaseX = centerXPt - northX * arrowLengthPt * 0.3;
  const arrowBaseY = centerYPt - northY * arrowLengthPt * 0.3;

  // Draw arrow shaft
  pdfPage.setLineWidth(1);
  pdfPage.setStrokeColor(0, 0, 0);
  pdfPage.drawLine(arrowBaseX, arrowBaseY, arrowTipX, arrowTipY);

  // Draw arrowhead
  const headLength = arrowLengthPt * 0.3;
  const headWidth = arrowLengthPt * 0.2;

  // Perpendicular vector for arrowhead wings
  const perpX = -northY;
  const perpY = northX;

  const head1X = arrowTipX - northX * headLength + perpX * headWidth;
  const head1Y = arrowTipY - northY * headLength + perpY * headWidth;
  const head2X = arrowTipX - northX * headLength - perpX * headWidth;
  const head2Y = arrowTipY - northY * headLength - perpY * headWidth;

  // Fill the arrowhead as a triangle
  pdfPage.setFillColor(0, 0, 0);
  pdfPage.moveTo(arrowTipX, arrowTipY);
  pdfPage.lineTo(head1X, head1Y);
  pdfPage.lineTo(head2X, head2Y);
  pdfPage.closePath();
  pdfPage.fill();

  // Draw "N" label
  pdfPage.setFontSize(7);
  pdfPage.setFillColor(0, 0, 0);
  // Position the N label outside the circle in the north direction
  const labelOffsetPt = radiusPt + mmToPt(2);
  const labelX = centerXPt + northX * labelOffsetPt - mmToPt(1.5); // Offset for text centering
  const labelY = centerYPt + northY * labelOffsetPt - mmToPt(1); // Offset for text baseline
  pdfPage.drawText('N', labelX, labelY);
}
