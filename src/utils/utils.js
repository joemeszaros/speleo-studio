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

function get3DCoordsStr(vector) {
  const s = ['x', 'y', 'z'].map((n) => vector[n].toFixed(2)).join(', ');
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

export {
  fromPolar,
  normal,
  degreesToRads,
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
  formatDateISO,
  formatDistance,
  fitString,
  falsy
};
