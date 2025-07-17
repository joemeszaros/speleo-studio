/**
 * Pixel to centimeter conversion utilities for web applications
 */

/**
 * Get the device pixel ratio (DPR) for the current device
 * @returns {number} The device pixel ratio
 */
function getDevicePixelRatio() {
  return window.devicePixelRatio || 1;
}

/**
 * Get the CSS pixel density (DPI) for the current device
 * This is an approximation since browsers don't directly expose DPI
 * @returns {number} Approximate DPI value
 */
function getApproximateDPI() {
  // Most modern displays are around 96 DPI (CSS pixels per inch)
  // High-DPI displays will have higher values
  const dpr = getDevicePixelRatio();

  // Base DPI for standard displays
  const baseDPI = 96;

  // Adjust for high-DPI displays
  // This is an approximation - actual DPI varies by device
  if (dpr >= 2) {
    return baseDPI * dpr;
  } else if (dpr >= 1.5) {
    return baseDPI * 1.5;
  } else {
    return baseDPI;
  }
}

/**
 * Convert pixels to centimeters
 * @param {number} pixels - Number of pixels to convert
 * @param {number} [dpi] - Optional DPI value (defaults to approximate DPI)
 * @returns {number} Centimeters
 */
function pixelsToCentimeters(pixels, dpi = null) {
  if (dpi === null) {
    dpi = getApproximateDPI();
  }

  // Convert pixels to inches first, then to centimeters
  // 1 inch = 2.54 centimeters
  const inches = pixels / dpi;
  const centimeters = inches * 2.54;

  return centimeters;
}

/**
 * Convert centimeters to pixels
 * @param {number} centimeters - Number of centimeters to convert
 * @param {number} [dpi] - Optional DPI value (defaults to approximate DPI)
 * @returns {number} Pixels
 */
function centimetersToPixels(centimeters, dpi = null) {
  if (dpi === null) {
    dpi = getApproximateDPI();
  }

  // Convert centimeters to inches first, then to pixels
  const inches = centimeters / 2.54;
  const pixels = inches * dpi;

  return pixels;
}

/**
 * Get the physical width of an element in centimeters
 * @param {HTMLElement} element - The element to measure
 * @param {number} [dpi] - Optional DPI value (defaults to approximate DPI)
 * @returns {number} Width in centimeters
 */
function getElementWidthInCentimeters(element, dpi = null) {
  const rect = element.getBoundingClientRect();
  return pixelsToCentimeters(rect.width, dpi);
}

/**
 * Get the physical height of an element in centimeters
 * @param {HTMLElement} element - The element to measure
 * @param {number} [dpi] - Optional DPI value (defaults to approximate DPI)
 * @returns {number} Height in centimeters
 */
function getElementHeightInCentimeters(element, dpi = null) {
  const rect = element.getBoundingClientRect();
  return pixelsToCentimeters(rect.height, dpi);
}

/**
 * Get the physical dimensions of the viewport in centimeters
 * @param {number} [dpi] - Optional DPI value (defaults to approximate DPI)
 * @returns {Object} Object with width and height in centimeters
 */
function getViewportSizeInCentimeters(dpi = null) {
  return {
    width  : pixelsToCentimeters(window.innerWidth, dpi),
    height : pixelsToCentimeters(window.innerHeight, dpi)
  };
}

/**
 * Get the physical dimensions of the screen in centimeters
 * @param {number} [dpi] - Optional DPI value (defaults to approximate DPI)
 * @returns {Object} Object with width and height in centimeters
 */
function getScreenSizeInCentimeters(dpi = null) {
  return {
    width  : pixelsToCentimeters(screen.width, dpi),
    height : pixelsToCentimeters(screen.height, dpi)
  };
}

/**
 * Calculate a more accurate DPI using screen dimensions and known physical size
 * This requires the user to provide the actual physical screen size
 * @param {number} physicalWidthInches - Physical width of the screen in inches
 * @param {number} physicalHeightInches - Physical height of the screen in inches
 * @returns {Object} Object with xDPI and yDPI
 */
function calculateDPIFromPhysicalSize(physicalWidthInches, physicalHeightInches) {
  const xDPI = screen.width / physicalWidthInches;
  const yDPI = screen.height / physicalHeightInches;

  return {
    xDPI       : xDPI,
    yDPI       : yDPI,
    averageDPI : (xDPI + yDPI) / 2
  };
}

// Export functions for use in other modules
export {
  getDevicePixelRatio,
  getApproximateDPI,
  pixelsToCentimeters,
  centimetersToPixels,
  getElementWidthInCentimeters,
  getElementHeightInCentimeters,
  getViewportSizeInCentimeters,
  getScreenSizeInCentimeters,
  calculateDPIFromPhysicalSize
};
