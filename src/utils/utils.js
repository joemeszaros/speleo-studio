import { Vector } from '../model.js';

function fromPolar(distance, azimuth, clino) {
  const h = Math.cos(clino) * distance;
  return new Vector(Math.sin(azimuth) * h, Math.cos(azimuth) * h, Math.sin(clino) * distance);
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
  return new Function(...names, `return \`${template}\`;`)(...vals);
}

function randomAlphaNumbericString(maxLength) {
  return Math.random()
    .toString(36)
    .replace(/[^a-z]+/g, '')
    .substr(0, maxLength);
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

  } else {
    return `${distanceInMeters.toFixed(decimals)} m`;

  }

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

export {
  fromPolar,
  normal,
  degreesToRads,
  radsToDegrees,
  randomAlphaNumbericString,
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
  textToIso88592Bytes
};
