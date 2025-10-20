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

import { Vector, Polar } from '../model.js';

/**
 * Converts polar coordinates (distance, azimuth, clino) to Cartesian coordinates (x,y,z)
 * @param {number} distance - The distance/length of the vector
 * @param {number} azimuth - The azimuth angle in radians (0 = North, increases clockwise)
 * @param {number} clino - The inclination/clino angle in radians (positive = up)
 * @returns {Vector} A Vector representing the Cartesian coordinates
 */
function fromPolar(distance, azimuth, clino) {
  const h = Math.cos(clino) * distance;
  return new Vector(Math.sin(azimuth) * h, Math.cos(azimuth) * h, Math.sin(clino) * distance);
}

/**
 * Converts Cartesian coordinates (x,y,z) to polar coordinates (distance, azimuth, clino)
 * @param {Vector} vector - The 3D vector in Cartesian coordinates
 * @returns {Object} Object containing distance, azimuth (in radians), and clino (in radians)
 */
function toPolar(vector) {
  const distance = vector.length();
  if (distance === 0) {
    return new Polar(0, 0, 0);
  }

  // Calculate clino (vertical angle)
  const clino = Math.asin(vector.z / distance);

  // Calculate horizontal angle from Y axis (0 degrees = North)
  let azimuth = Math.atan2(vector.x, vector.y);
  // Normalize azimuth to 0-2π range
  if (azimuth < 0) {
    azimuth += 2 * Math.PI;
  }

  return new Polar(distance, azimuth, clino);
}

// https://courses.eas.ualberta.ca/eas421/formulasheets/formulasheetxythetaP12010.pdf
function normal(azimuth, clino) {
  const h = Math.sin(clino);
  return new Vector(
    -Math.cos(azimuth) * h, //TODO: don't forget declination
    Math.sin(azimuth) * h, //TODO: don't forget declination
    -Math.cos(clino)
  );
}

const deg2rad = Math.PI / 180.0;

function degreesToRads(deg) {
  return deg * deg2rad;
}

function radsToDegrees(rad) {
  return (rad * 180.0) / Math.PI;
}

function interpolate(template, params) {
  const names = Object.keys(params);
  const vals = Object.values(params);
  try {
    const interpolated = new Function(...names, `return \`${template}\`;`)(...vals);
    return { interpolated, success: true };
  } catch (error) {
    console.error(`Interpolation failed for ${template} with params ${params}`, error);
    return { interpolated: template, success: false };
  }
}

function randomAlphaNumbericString(maxLength) {
  return Math.random()
    .toString(36)
    .replace(/[^a-z]+/g, '')
    .substr(0, maxLength);
}

/**
 * Detects the main browser family from the user agent string
 * @param {string} userAgent - The user agent string (defaults to navigator.userAgent)
 * @returns {string} The browser name (chrome, firefox, safari, edge, opera, etc.)
 */
function detectBrowser(userAgent = navigator.userAgent) {
  const ua = userAgent.toLowerCase();

  // Chrome (must be checked before Safari since Chrome includes Safari in its UA)
  if (ua.includes('chrome') && !ua.includes('edg') && !ua.includes('opr')) {
    return 'Chrome';
  }

  // Edge (must be checked before Chrome)
  if (ua.includes('edg')) {
    return 'Edge';
  }

  // Opera (must be checked before Chrome)
  if (ua.includes('opr') || ua.includes('opera')) {
    return 'Opera';
  }

  // Firefox
  if (ua.includes('firefox')) {
    return 'Firefox';
  }

  // Safari (must be checked after Chrome)
  if (ua.includes('safari') && !ua.includes('chrome')) {
    return 'Safari';
  }

  // Internet Explorer
  if (ua.includes('msie') || ua.includes('trident')) {
    return 'IE';
  }

  // Samsung Internet
  if (ua.includes('samsungbrowser')) {
    return 'Samsung';
  }

  // UC Browser
  if (ua.includes('ucbrowser')) {
    return 'UC';
  }

  // Unknown browser
  return 'Unknown';
}

/**
 * Detects the platform type from the user agent string and screen size
 * @param {string} userAgent - The user agent string (defaults to navigator.userAgent)
 * @returns {string} The platform type (desktop, mobile, tablet)
 */
function detectPlatform(userAgent = navigator.userAgent) {
  const ua = userAgent.toLowerCase();

  // Check for mobile indicators first
  const mobileIndicators = [
    'mobile',
    'android',
    'iphone',
    'ipod',
    'blackberry',
    'windows phone',
    'opera mini',
    'iemobile',
    'mobile safari'
  ];

  const isMobileUA = mobileIndicators.some((indicator) => ua.includes(indicator));

  // Check for tablet indicators
  const tabletIndicators = ['ipad', 'tablet', 'kindle', 'silk', 'playbook', 'bb10', 'rim tablet'];

  const isTabletUA = tabletIndicators.some((indicator) => ua.includes(indicator));

  // Additional tablet detection for Android tablets
  if (ua.includes('android') && !ua.includes('mobile')) {
    // This is likely an Android tablet
    return 'tablet';
  }

  // Check screen size for additional context (if available)
  if (typeof window !== 'undefined' && window.screen) {
    const screenWidth = window.screen.width;
    const screenHeight = window.screen.height;
    const maxDimension = Math.max(screenWidth, screenHeight);
    const minDimension = Math.min(screenWidth, screenHeight);

    // Tablet screen size detection (typically 7-12 inches)
    if (maxDimension >= 768 && maxDimension <= 1366 && minDimension >= 600) {
      // If UA suggests tablet or ambiguous mobile, prefer tablet
      if (isTabletUA || (!isMobileUA && maxDimension >= 1024)) {
        return 'tablet';
      }
    }

    // Mobile screen size detection (typically < 7 inches)
    if (maxDimension < 768 || (maxDimension < 1024 && minDimension < 600)) {
      if (isMobileUA || !isTabletUA) {
        return 'mobile';
      }
    }
  }

  // User agent based detection
  if (isTabletUA) {
    return 'tablet';
  }

  if (isMobileUA) {
    return 'mobile';
  }

  // Default to desktop for desktop browsers
  return 'desktop';
}

function parseMyFloat(strOrNum) {
  if (typeof strOrNum === 'number') {
    return parseFloat(strOrNum);
  } else if (typeof strOrNum === 'string') {
    return parseFloat(strOrNum.replace(',', '.'));
  } else {
    return parseFloat(strOrNum);
  }
}

const floatPattern = /^[+-]?\d+([.,]\d+)?$/;

function isFloatStr(value) {
  return floatPattern.test(value);
}

function get3DCoordsStr(vector, fields = ['x', 'y', 'z'], decimals = 3) {
  const s = fields.map((n) => vector[n].toFixed(decimals)).join(', ');
  return `(${s})`;
}

function iterateUntil(iterator, condition) {
  var it;
  do {
    it = iterator.next();
  } while (!it.done && condition(it.value[1]));

  if (it.done) {
    return undefined;
  } else {
    return it.value[1];
  }
}

const node = (strings, ...values) => {
  const parser = new DOMParser();

  const cookedStr = String.raw({ raw: strings }, ...values);
  const doc = parser.parseFromString(cookedStr, 'text/html');
  return doc.body.firstChild;
};

const nodes = (strings, ...values) => {
  const parser = new DOMParser();

  const cookedStr = String.raw({ raw: strings }, ...values);
  const doc = parser.parseFromString(cookedStr, 'text/html');
  return doc.body.childNodes;
};

function addDays(date, days) {
  const newDate = new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
  return newDate;
}

function toPolygonDate(date) {
  const epochStart = new Date(-2209161600000); //1899-12-30T00:00:00Z
  const diffTime = date.getTime() - epochStart.getTime();
  const diffDays = diffTime / (24 * 60 * 60 * 1000);
  return Math.floor(diffDays);
}

function getPolygonDate(value) {
  const epochStart = new Date(-2209161600000); //1899-12-30T00:00:00Z
  const daysInt = Math.floor(value);
  return addDays(epochStart, daysInt);
}

function formatDistance(distanceInMeters, decimals = 2) {
  if (distanceInMeters >= 1000) {
    const distanceInKm = distanceInMeters / 1000.0;
    return `${distanceInKm.toFixed(decimals)} km`;
  } else if (distanceInMeters < 15) {
    return `${distanceInMeters.toFixed(1)} m`;
  } else {
    return `${Math.round(distanceInMeters)} m`;

  }
}

function arraysEqual(a, b) {
  return a.length === b.length && a.every((element, index) => element === b[index]);
}

function fitString(str, maxLength) {
  if (str.length > maxLength) {
    return str.substr(0, maxLength - 3) + '...';
  } else {
    return str;
  }
}

function formatDateISO(date) {
  // Convert the date to ISO string
  const isoString = date.toISOString();
  // Split at the "T" character to get the date part
  const formattedDate = isoString.split('T')[0];
  return formattedDate;
}

function roundToTwoDecimalPlaces(num) {
  return Math.round(num * 100) / 100;
}

function falsy(value) {
  return value === undefined || value === null || value === '' || value === ``;
}

function toAscii(str) {
  // Replace diacritics and special characters with ASCII equivalents
  return (
    str.normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
      .replace(/[^\x20-\x7E]/g, '')
  ); // Remove non-ASCII chars;
}

function textToIso88592Bytes(text) {

  // Create a proper ISO-8859-2 encoded byte array
  const iso88592Bytes = new Uint8Array(text.length);
  const mapping = new Map([
    // Hungarian characters
    ['í', 0xed],
    ['Í', 0xcd],
    ['é', 0xe9],
    ['É', 0xc9],
    ['á', 0xe1],
    ['Á', 0xc1],
    ['ú', 0xfa],
    ['Ú', 0xda],
    ['ó', 0xf3],
    ['Ó', 0xd3],
    ['ö', 0xf6],
    ['Ö', 0xd6],
    ['ő', 0xf5],
    ['Ő', 0xd5],
    ['ű', 0xfb],
    ['Ű', 0xdb],
    ['ü', 0xfc],
    ['Ü', 0xdc],

    // Polish characters
    ['Ą', 0xa1],
    ['ą', 0xb1],
    ['Ć', 0xc6],
    ['ć', 0xe6],
    ['Ę', 0xea],
    ['ę', 0xea],
    ['Ł', 0xa3],
    ['ł', 0xb3],
    ['Ń', 0xd1],
    ['ń', 0xf1],
    ['Ś', 0xa6],
    ['ś', 0xb6],
    ['Ź', 0xac],
    ['ź', 0xbc],
    ['Ż', 0xaf],
    ['ż', 0xbf],

    // Czech/Slovak characters
    ['Č', 0xc8],
    ['č', 0xe8],
    ['Ď', 0xcf],
    ['ď', 0xef],
    ['Ľ', 0xa5],
    ['ľ', 0xb5],
    ['Ň', 0xd2],
    ['ň', 0xf2],
    ['Ř', 0xd8],
    ['ř', 0xf8],
    ['Š', 0xa9],
    ['š', 0xb9],
    ['Ť', 0xab],
    ['ť', 0xbb],
    ['Ž', 0xae],
    ['ž', 0xbe]
  ]);

  for (let i = 0; i < text.length; i++) {
    const charCode = text.charCodeAt(i);

    // Map Unicode characters to ISO-8859-2
    if (charCode < 128) {

      // ASCII characters (0-127) are the same
      iso88592Bytes[i] = charCode;
    } else {
      // Map specific Central European characters to ISO-8859-2
      // This is a simplified mapping - you may need to add more characters
      if (mapping.has(text[i])) {
        iso88592Bytes[i] = mapping.get(text[i]);
      } else {
        iso88592Bytes[i] = 0x3f; // Question mark
      }
    }
  }
  return iso88592Bytes;
}

function range(start, stop, step = 1) {
  return Array.from({ length: (stop - start) / step + 1 }, (value, index) => start + index * step);
}

export {
  fromPolar,
  toPolar,
  normal,
  degreesToRads,
  radsToDegrees,
  randomAlphaNumbericString,
  detectBrowser,
  detectPlatform,
  parseMyFloat,
  isFloatStr,
  interpolate,
  get3DCoordsStr,
  iterateUntil,
  node,
  nodes,
  addDays,
  getPolygonDate,
  toPolygonDate,
  formatDateISO,
  formatDistance,
  fitString,
  falsy,
  toAscii,
  textToIso88592Bytes,
  arraysEqual,
  roundToTwoDecimalPlaces,
  range
};
