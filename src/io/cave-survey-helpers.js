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

/*
 * Shared pure helpers used by both TherionImporter and SurvexImporter.
 *
 * All functions are stateless — they take explicit arguments and return values
 * (or mutate only the arguments passed to them). This lets both importers reuse
 * the same data-format parsing, shot construction, coordinate-system handling,
 * and cave assembly logic without any code duplication.
 */

import { SurveyHelper } from '../survey.js';
import {
  Shot, ShotType, Survey, SurveyMetadata, SurveyAlias, StationComment, SurveyTeamMember, DEFAULT_UNITS
} from '../model/survey.js';
import { Cave, CaveMetadata } from '../model/cave.js';
import {
  EOVCoordinateWithElevation,
  EOVCoordinateSystem,
  UTMCoordinateWithElevation,
  StationWithCoordinate,
  GeoData,
  CoordinateSystemType,
  UTMCoordinateSystem
} from '../model/geo.js';
import { Vector } from '../model.js';
import {
  parseMyFloat, lengthToDegrees, angleToDegrees, clinoToDegrees, roundToTwoDecimalPlaces,
  convertLengthFromMeters, convertAngleFromDegrees
} from '../utils/utils.js';
import { MeridianConvergence, UTMConverter } from '../utils/geo.js';
import { globalNormalizer } from '../utils/global-coordinate-normalizer.js';
import { showInfoPanel } from '../ui/popups.js';
import { i18n } from '../i18n/i18n.js';

// ─── File reading ──────────────────────────────────────────────────────────────

export async function detectEncoding(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const m = (e.target.result ?? '').match(/^\s*encoding\s+(\S+)/im);
      if (m) {
        const raw = m[1].toLowerCase()
          .replace(/^utf8$/, 'utf-8')
          .replace(/^iso(\d)$/, 'iso-8859-$1')
          .replace(/^iso8859-(\d+)$/, 'iso-8859-$1');
        const known = [
          'utf-8',
          'iso-8859-1',
          'iso-8859-2',
          'iso-8859-3',
          'iso-8859-4',
          'iso-8859-5',
          'iso-8859-6',
          'iso-8859-7',
          'iso-8859-8',
          'iso-8859-9',
          'windows-1250',
          'windows-1251',
          'windows-1252'
        ];
        resolve(known.includes(raw) ? raw : 'utf-8');
      } else {
        resolve('utf-8');
      }
    };
    reader.onerror = () => resolve('utf-8');
    reader.readAsText(file.slice(0, 200), 'ascii');
  });
}

export async function readFileAsText(file, encoding) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsText(file, encoding);
  });
}

// ─── Tokenizer / include expansion ───────────────────────────────────────────
//
// Shared by TherionImporter and SurvexImporter. Both formats use the same
// tokenization logic except for the comment character and whether leading '*'
// is stripped and lowercased on command tokens.
//
// opts shape:
//   commentChar     : string   — '#' (Therion) | ';' (Survex)
//   stripStarPrefix : boolean  — strip '*' and lowercase command tokens (Survex only)
//   includeKeyword  : string   — 'input' (Therion) | 'include' (Survex)
//   countPattern    : RegExp   — used to rank candidate root files
//   skipExtensions  : string[] — unresolved includes with these extensions are silently ignored

export function tokenizeLine(line, opts) {
  const { commentChar, stripStarPrefix } = opts;
  const tokens = [];
  let i = 0;
  while (i < line.length) {
    while (i < line.length && (line[i] === ' ' || line[i] === '\t')) i++;
    if (i >= line.length || line[i] === commentChar) break;

    if (line[i] === '"') {
      i++;
      let str = '';
      while (i < line.length && line[i] !== '"') {
        if (line[i] === '\\' && i + 1 < line.length) str += line[++i];
        else str += line[i];
        i++;
      }
      if (i < line.length) i++; // skip closing quote
      tokens.push(str);
    } else {
      let token = '';
      while (i < line.length && line[i] !== ' ' && line[i] !== '\t' && line[i] !== commentChar) {
        token += line[i++];
      }
      if (token) {
        tokens.push(stripStarPrefix && token.startsWith('*') ? token.slice(1).toLowerCase() : token);
      }
    }
  }
  return tokens;
}

export function findRootFile(textMap, opts) {
  const { includeKeyword, countPattern } = opts;
  if (textMap.size === 1) return [...textMap.keys()][0];

  const referenced = new Set();
  for (const text of textMap.values()) {
    for (const line of text.split(/\r?\n/)) {
      const tokens = tokenizeLine(line, opts);
      if (tokens.length >= 2 && tokens[0].toLowerCase() === includeKeyword) {
        const path = tokens[1];
        referenced.add(path);
        referenced.add(path.split(/[\\/]/).pop());
      }
    }
  }

  const candidates = [...textMap.keys()].filter((name) => {
    const base = name.split(/[\\/]/).pop();
    return !referenced.has(name) && !referenced.has(base);
  });

  const ranked = (candidates.length > 0 ? candidates : [...textMap.keys()]).sort((a, b) => {
    const count = (text) => (text.match(countPattern) ?? []).length;
    return count(textMap.get(b)) - count(textMap.get(a));
  });

  return ranked[0];
}

export function flattenFile(filename, textMap, visited, unresolved, opts) {
  const { includeKeyword, skipExtensions = [] } = opts;
  if (visited.has(filename)) return [];
  visited.add(filename);

  const text = textMap.get(filename);
  if (text === undefined) {
    unresolved.push(filename);
    return [];
  }

  const rawLines = text.split(/\r?\n/);
  const result = [];

  for (let i = 0; i < rawLines.length; i++) {
    let line = rawLines[i];
    // Line continuation: backslash at end of line joins with the next line
    while (line.endsWith('\\') && i + 1 < rawLines.length) {
      line = line.slice(0, -1) + ' ' + rawLines[++i];
    }

    const tokens = tokenizeLine(line, opts);
    if (tokens.length === 0) continue;

    if (tokens[0].toLowerCase() === includeKeyword) {
      const includePath = tokens[1] ?? '';
      const basename = includePath.split(/[\\/]/).pop();
      let resolved = null;

      if (textMap.has(includePath)) {
        resolved = includePath;
      } else {
        for (const key of textMap.keys()) {
          const keyBase = key.split(/[\\/]/).pop();
          if (keyBase === basename || keyBase.toLowerCase() === basename.toLowerCase()) {
            resolved = key;
            break;
          }
        }
      }

      if (resolved) {
        result.push(...flattenFile(resolved, textMap, visited, unresolved, opts));
      } else {
        const lc = basename.toLowerCase();
        if (!skipExtensions.some((ext) => lc.endsWith(ext))) {
          unresolved.push(includePath);
        }
      }
    } else {
      result.push(tokens);
    }
  }

  return result;
}

// ─── Shared command parsers ───────────────────────────────────────────────────

/**
 * Parses a `team` / `*team` token list and appends members to state.
 * Format: team "Name" [role] "Name2" [role2] ...
 */
export function parseTeam(tokens, state) {
  let j = 1;
  while (j < tokens.length) {
    const memberName = tokens[j++];
    const hasRole = j < tokens.length && isNaN(parseMyFloat(tokens[j])) && !/^\d/.test(tokens[j]);
    const role = hasRole ? tokens[j++] : '';
    if (memberName) {
      state.members.push(new SurveyTeamMember(memberName, role));
      if (!state.teamName) state.teamName = memberName;
    }
  }
}

/**
 * Applies a `calibrate` / `*calibrate` directive to state.calibration.
 * Handles optional explicit unit string between the offset and scale factor.
 * The offset is converted to the internal unit (metres for length, degrees for
 * angles) using the explicit unit when given, or the current survey unit.
 * `extraFields` is an optional object of additional quantity aliases / handlers
 * keyed by lowercased field name (used by SurvexImporter for `declination`).
 */
export function applyCalibration(tokens, state, extraFields = {}) {
  if (tokens.length < 3) return;
  const field = tokens[1].toLowerCase();
  const rawOffset = tokens[2];
  const num = parseMyFloat(rawOffset);
  if (isNaN(num)) return;

  // tokens[3] is either an explicit unit string or a numeric scale factor.
  const t3 = tokens[3];
  const hasUnit = t3 !== undefined && isNaN(parseMyFloat(t3));
  const unitStr  = hasUnit ? t3.toLowerCase() : undefined;
  const scaleRaw = hasUnit ? tokens[4] : t3;
  const scale    = scaleRaw !== undefined ? parseMyFloat(scaleRaw) : 1.0;

  // The calibration offset is added directly to shot values during parseShotRow / flushStationPairs.
  // Shot values are stored in `state.units.<field>`, so the offset must end up in that same unit.
  // Pivot through metres / degrees to handle both native and non-native source units uniformly.

  if (field === 'length' || field === 'tape' || field === 'distance') {
    const sourceUnit = unitStr ?? state.units.length;
    const offsetMeters = lengthToDegrees(num, sourceUnit);
    state.calibration.length      = convertLengthFromMeters(offsetMeters, mapToSpeleoStudioUnits(state.units).length);
    state.calibration.lengthScale = isNaN(scale) ? 1.0 : scale;
  } else if (field === 'compass' || field === 'bearing') {
    const sourceUnit = unitStr ?? state.units.compass;
    const offsetDegrees = angleToDegrees(num, sourceUnit);
    state.calibration.compass      = convertAngleFromDegrees(offsetDegrees, mapToSpeleoStudioUnits(state.units).angle);
    state.calibration.compassScale = isNaN(scale) ? 1.0 : scale;
  } else if (field === 'clino' || field === 'gradient' || field === 'inclination') {
    const sourceUnit = unitStr ?? state.units.clino;
    const offsetDegrees = clinoToDegrees(num, sourceUnit);
    state.calibration.clino      = convertAngleFromDegrees(offsetDegrees, mapToSpeleoStudioUnits(state.units).angle);
    state.calibration.clinoScale = isNaN(scale) ? 1.0 : scale;
  } else if (field in extraFields) {
    extraFields[field](rawOffset, unitStr, state);
  }
  // backsight quantities and passage dimensions are intentionally ignored
}

// ─── Data format ──────────────────────────────────────────────────────────────

export function parseDataFormat(tokens) {
  const type = tokens[1]?.toLowerCase() ?? 'normal';
  const columns = tokens.slice(2).map((t) => t.toLowerCase());
  const nlIdx = columns.indexOf('newline');

  const ALIASES = {
    tape        : 'length',
    distance    : 'length',
    bearing     : 'compass',
    azimuth     : 'compass',
    gradient    : 'clino',
    inclination : 'clino'
  };

  const fmt = {
    type,
    columns,
    hasNewline : nlIdx >= 0,
    newlineIdx : nlIdx,
    from       : -1,
    to         : -1,
    length     : -1,
    compass    : -1,
    clino      : -1,
    station    : -1,
    left       : -1,
    right      : -1,
    up         : -1,
    down       : -1,
    dx         : -1,
    dy         : -1,
    dz         : -1,
  };

  columns.forEach((col, idx) => {
    if (col === 'newline' || col === 'ignoreall') return;
    const key = ALIASES[col] ?? col;
    if (key in fmt && fmt[key] === -1) fmt[key] = idx;
  });

  return fmt;
}

// ─── Value parsers ─────────────────────────────────────────────────────────────
//
// These return shot values in the unit Speleo Studio will store them in:
//   • If the file's source unit is one Speleo Studio supports natively
//     (metres, feet, yards, inches; degrees, grads), the value is returned **as-is**
//     and `survey.units` is later stamped accordingly — no conversion is performed.
//   • If the source unit is not natively supported (cm, minutes, percent), the
//     value is converted to the closest Speleo Studio storage unit (metres for
//     length; degrees for angle).

const NATIVE_LENGTH_UNITS = new Set([
  'meters', 'meter', 'metres', 'metre', 'm',
  'feet', 'foot', 'ft',
  'yards', 'yard', 'yd', 'yds',
  'inches', 'inch', 'in'
]);
const NATIVE_ANGLE_UNITS = new Set([
  'degrees', 'degree', 'deg',
  'grads', 'grad', 'gon', 'gons'
]);

function isGradsUnit(unit) {
  return unit === 'grads' || unit === 'grad' || unit === 'gon' || unit === 'gons';
}

// Given a length value freshly returned by parseLength (which is in `sourceUnit` if that
// unit is native, else in metres), return the equivalent value in `targetUnit` (a Speleo
// Studio storage unit: meters/feet/yards/inches).
function lengthIntoTargetUnit(value, sourceUnit, targetUnit) {
  const valueUnit = NATIVE_LENGTH_UNITS.has(sourceUnit) ? sourceUnit : 'meters';
  if (valueUnit === targetUnit) return value;
  // Convert through metres
  const meters = lengthToDegrees(value, valueUnit);
  return convertLengthFromMeters(meters, targetUnit);
}

// Same idea for an angle (`targetUnit` is 'degrees' or 'grads').
function angleIntoTargetUnit(value, sourceUnit, targetUnit) {
  const valueUnit = NATIVE_ANGLE_UNITS.has(sourceUnit) ? sourceUnit : 'degrees';
  // Same family (both grads-aliases or both degrees-aliases) → no conversion
  if (isGradsUnit(valueUnit) === isGradsUnit(targetUnit)) return value;
  return isGradsUnit(valueUnit) ? value * 0.9 : value / 0.9;
}

export function parseLength(value, unit) {
  if (!value) return NaN;
  const num = parseMyFloat(value);
  if (isNaN(num)) return NaN;
  if (unit === undefined || NATIVE_LENGTH_UNITS.has(unit)) return num;
  // Non-native source (cm, etc.) — fall back to metres so the survey can be stamped as 'meters'.
  return lengthToDegrees(num, unit);
}

export function parseCompass(value, unit) {
  if (!value || value === '-') return 0;
  const num = parseMyFloat(value);
  if (isNaN(num)) return 0;
  if (unit === undefined || NATIVE_ANGLE_UNITS.has(unit)) return num;
  // minutes → degrees
  return angleToDegrees(num, unit);
}

export function parseClino(value, unit) {
  if (!value) return 0;
  const lower = value.toLowerCase();
  if (lower === 'up') return isGradsUnit(unit) ? 100 : 90;
  if (lower === 'down') return isGradsUnit(unit) ? -100 : -90;
  const num = parseMyFloat(value);
  if (isNaN(num)) return 0;
  if (unit === undefined || NATIVE_ANGLE_UNITS.has(unit)) return num;
  // percent → degrees (via arctan), minutes → degrees
  return clinoToDegrees(num, unit);
}

export function parseDate(str) {
  if (!str) return new Date();
  const parts = str.split('.');
  if (parts.length >= 2) {
    return new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2] ?? '1'));
  }
  return new Date(parseInt(parts[0]), 0, 1);
}

/** Mutates `units` in place according to a `units <quantity> <unit>` token list. */
export function applyUnits(tokens, units) {
  if (tokens.length < 3) return;
  const field = tokens[1].toLowerCase();
  const unit = tokens[2].toLowerCase();
  // Accept both Therion and Survex quantity aliases
  if (field === 'length' || field === 'tape' || field === 'distance') units.length = unit;
  else if (field === 'compass' || field === 'bearing') units.compass = unit;
  else if (field === 'clino' || field === 'gradient' || field === 'inclination') units.clino = unit;
}

/**
 * Map a parser units triplet (`{ length, compass, clino }`) to the simpler Speleo Studio
 * survey units (`{ length, angle }`).
 *
 * - Length: feet/foot/ft → 'feet'; yards/yard/yd/yds → 'yards'; inches/inch/in → 'inches';
 *   anything else (including cm and metres aliases) → 'meters'.
 * - Angle: only preserved when both compass and clino are the same recognized unit.
 *   `grad`/`grads`/`gon`/`gons` → 'grads'; otherwise 'degrees'.
 */
export function mapToSpeleoStudioUnits(parserUnits) {
  const lengthMap = {
    feet   : 'feet',  foot   : 'feet',  ft : 'feet',
    yards  : 'yards', yard   : 'yards', yd : 'yards', yds : 'yards',
    inches : 'inches', inch  : 'inches', in : 'inches',
    meters : 'meters', meter : 'meters', metres : 'meters', metre : 'meters', m : 'meters'
  };
  const angleMap = {
    degrees : 'degrees', degree : 'degrees', deg : 'degrees',
    grads   : 'grads',   grad   : 'grads',   gon : 'grads', gons : 'grads'
  };
  const length = lengthMap[parserUnits?.length] ?? DEFAULT_UNITS.length;
  const compassMapped = angleMap[parserUnits?.compass];
  const clinoMapped = angleMap[parserUnits?.clino];
  // Only preserve the angle unit if compass and clino agree — Speleo Studio surveys
  // store one angle unit for both, so anything mixed falls back to degrees.
  const angle = compassMapped && compassMapped === clinoMapped ? compassMapped : DEFAULT_UNITS.angle;
  return { length, angle };
}

// ─── Coordinate system ────────────────────────────────────────────────────────

export function parseCs(tokens) {
  const raw = tokens.join(' ').trim();
  const lower = raw.toLowerCase();
  let m;

  m = lower.match(/^utm(\d+)([ns]?)$/);
  if (m) return { type: 'utm', zone: +m[1], northern: m[2] !== 's' };

  m = lower.match(/^utm\s+zone\s+(\d+)\s*(north|south|n|s)?$/);
  if (m) return { type: 'utm', zone: +m[1], northern: !m[2] || m[2][0] === 'n' };

  m = lower.match(/^epsg:326(\d{2})$/);
  if (m) return { type: 'utm', zone: +m[1], northern: true };

  m = lower.match(/^epsg:327(\d{2})$/);
  if (m) return { type: 'utm', zone: +m[1], northern: false };

  if (lower === 'long-lat') return { type: 'longlat', latFirst: false };
  if (lower === 'lat-long') return { type: 'longlat', latFirst: true };

  if (lower === 'epsg:23700') return { type: 'eov' };

  return { type: 'unknown', raw };
}

// ─── Station name helpers ─────────────────────────────────────────────────────

export function applyStnNames(name, state) {
  if (!name || name === '.' || name === '-') return name;
  if (name.includes('@')) return name;
  const { stationPrefix: p, stationSuffix: s } = state;
  return p || s ? `${p}${name}${s}` : name;
}

export function qualifyStn(name, surveyPath) {
  if (!name || name === '.' || name === '-') return name;
  if (name.includes('@') || !surveyPath) return name;
  return `${name}@${surveyPath}`;
}

export function stripStn(name) {
  if (!name || !name.includes('@')) return name;
  return name.split('@')[0];
}

export function resolveRef(ref, currentPath, allPaths) {
  if (!ref.includes('@')) {
    return currentPath ? `${ref}@${currentPath}` : ref;
  }
  const at = ref.lastIndexOf('@');
  const stn = ref.slice(0, at);
  const partial = ref.slice(at + 1);
  const match = allPaths.find((p) => p === partial || p.endsWith(`.${partial}`));
  return match ? `${stn}@${match}` : ref;
}

// ─── Equate → alias resolution ────────────────────────────────────────────────

export function addAliases(eqTokens, currentPath, allPaths, aliases) {
  const resolved = eqTokens.map((t) => stripStn(resolveRef(t, currentPath, allPaths)));
  for (let i = 0; i + 1 < resolved.length; i++) {
    const a = new SurveyAlias(resolved[i], resolved[i + 1]);
    if (!aliases.some((e) => e.isEqual(a))) aliases.push(a);
  }
}

// ─── Shot parsing ─────────────────────────────────────────────────────────────

export function parseShotRow(tokens, state, surveyPath, shotId) {
  const { fmt, units, calibration, isSplay } = state;
  const get = (field) => {
    const idx = fmt[field];
    return idx >= 0 && idx < tokens.length ? tokens[idx] : null;
  };

  const fromRaw = get('from');
  if (!fromRaw || fromRaw === '.' || fromRaw === '-') return null;

  const toRaw = get('to');
  const isPlaceholder = !toRaw || toRaw === '.' || toRaw === '-';
  const type = isPlaceholder || isSplay ? ShotType.SPLAY : ShotType.CENTER;
  const from = stripStn(qualifyStn(applyStnNames(fromRaw, state), surveyPath));
  const to = type === ShotType.SPLAY
    ? undefined
    : stripStn(qualifyStn(applyStnNames(toRaw, state), surveyPath));

  // Survey storage unit — every shot in this survey ends up in this unit.
  const target = mapToSpeleoStudioUnits(units);

  if (fmt.type === 'cartesian') {
    // Convert displacement vector (East, North, Up) to polar (length, azimuth, clino).
    // dx = East, dy = North, dz = Up — standard Survex cartesian convention.
    // dx/dy/dz come back in `units.length` (or metres if non-native). Normalize to
    // the survey's target length unit so sqrt and the resulting `len` are in target unit.
    const dx = lengthIntoTargetUnit(parseLength(get('dx'), units.length), units.length, target.length);
    const dy = lengthIntoTargetUnit(parseLength(get('dy'), units.length), units.length, target.length);
    const dz = lengthIntoTargetUnit(parseLength(get('dz'), units.length), units.length, target.length);
    if (isNaN(dx) || isNaN(dy) || isNaN(dz)) return null;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len === 0) return null;
    // declination + atan2/asin output + cartesianExtraRot are all in degrees by construction.
    const northAdj = state.cartesianNorth === 'magnetic' ? (state.declination ?? 0) : 0;
    const extraRot = state.cartesianExtraRot ?? 0;
    let az = ((Math.atan2(dx, dy) * (180 / Math.PI)) + northAdj + extraRot + 360) % 360;
    let cl = Math.asin(dz / len) * (180 / Math.PI);
    // If the survey stores angles in grads, convert the degree-result of atan2/asin to grads.
    if (target.angle === 'grads') {
      az = az / 0.9;
      cl = cl / 0.9;
    }
    return new Shot(shotId, type, from, to, len, az, cl, undefined);
  }

  // Normal data row — parse each quantity, normalize to the survey's target unit, then apply calibration.
  const length =
    (lengthIntoTargetUnit(parseLength(get('length'), units.length), units.length, target.length) +
      calibration.length) * calibration.lengthScale;
  const compass =
    (angleIntoTargetUnit(parseCompass(get('compass'), units.compass), units.compass, target.angle) +
      calibration.compass) * calibration.compassScale;
  const clino =
    (angleIntoTargetUnit(parseClino(get('clino'), units.clino), units.clino, target.angle) +
      calibration.clino) * calibration.clinoScale;

  if (isNaN(length)) return null;

  return new Shot(shotId, type, from, to, length, compass, clino, undefined);
}

export function flushStationPairs(pairs, shots, startId, surveyPath) {
  let id = startId;
  for (let i = 0; i < pairs.length; i++) {
    const { line1, line2, state } = pairs[i];
    const { fmt, units, calibration, isSplay } = state;

    const stnIdx = fmt.station >= 0 ? fmt.station : 0;
    const fromRaw = stnIdx < line1.length ? line1[stnIdx] : null;
    if (!fromRaw) continue;

    const nextPair = pairs[i + 1];
    const nextStnIdx = nextPair ? (fmt.station >= 0 ? fmt.station : 0) : -1;
    const toRaw =
      nextPair && nextStnIdx < nextPair.line1.length ? nextPair.line1[nextStnIdx] : null;

    const from = stripStn(qualifyStn(applyStnNames(fromRaw, state), surveyPath));
    const type = toRaw && !isSplay ? ShotType.CENTER : ShotType.SPLAY;
    const to =
      type === ShotType.CENTER
        ? stripStn(qualifyStn(applyStnNames(toRaw, state), surveyPath))
        : undefined;

    const offset = fmt.newlineIdx + 1;
    const getL2 = (field) => {
      const idx = fmt[field] - offset;
      return idx >= 0 && idx < line2.length ? line2[idx] : null;
    };

    const target = mapToSpeleoStudioUnits(units);
    const length =
      (lengthIntoTargetUnit(parseLength(getL2('length'), units.length), units.length, target.length) +
        calibration.length) * calibration.lengthScale;
    const compass =
      (angleIntoTargetUnit(parseCompass(getL2('compass'), units.compass), units.compass, target.angle) +
        calibration.compass) * calibration.compassScale;
    const clino =
      (angleIntoTargetUnit(parseClino(getL2('clino'), units.clino), units.clino, target.angle) +
        calibration.clino) * calibration.clinoScale;

    if (isNaN(length)) continue;
    shots.push(new Shot(id++, type, from, to, length, compass, clino, undefined));
  }
}

// ─── Cave assembly ────────────────────────────────────────────────────────────

/**
 * Builds a Cave object from the intermediate survey list produced by a parser.
 *
 * @param {object} context - {surveys, topLevelEquates, globalCs, caveTitle}
 * @param {string} rootFilename - used to derive the cave name when no title exists
 * @param {CoordinateSystemDialog} coordinateSystemDialog - shown when CS is unknown
 * @param {string} unknownCsKey - i18n key for the "unknown CS" info panel message
 */
export async function assembleCave(context, rootFilename, coordinateSystemDialog, unknownCsKey) {
  // Merge multiple survey blocks that share the same surveyPath
  const mergedMap = new Map();
  for (const s of context.surveys) {
    if (mergedMap.has(s.surveyPath)) {
      const m = mergedMap.get(s.surveyPath);
      m.shots.push(...s.shots);
      m.equates.push(...s.equates);
      m.fixes.push(...s.fixes);
      m.stationComments.push(...(s.stationComments ?? []));
      if (!m.cs && s.cs) m.cs = s.cs;
    } else {
      mergedMap.set(s.surveyPath, {
        ...s,
        shots           : [...s.shots],
        equates         : [...s.equates],
        fixes           : [...s.fixes],
        stationComments : [...(s.stationComments ?? [])]
      });
    }
  }
  const surveys = [...mergedMap.values()];
  const { topLevelEquates } = context;
  const allPaths = surveys.map((s) => s.surveyPath);

  // Resolve all equates → SurveyAlias[]
  const aliases = [];
  for (const s of surveys) {
    for (const eqTokens of s.equates) {
      addAliases(eqTokens, s.surveyPath, allPaths, aliases);
    }
  }
  for (const { tokens, surveyPath } of topLevelEquates) {
    addAliases(tokens, surveyPath, allPaths, aliases);
  }

  // Find fix + known CS → GeoData
  let geoData = null;
  let coordinateSys = null;
  let convergence = null;
  let fixSurveyIdx = -1;

  for (let i = 0; i < surveys.length; i++) {
    const s = surveys[i];
    if (!s.fixes.length || !s.cs || s.cs.type === 'unknown') continue;

    const fix = s.fixes[0];
    const cs = s.cs;
    let coordinate = null;
    let csObj = null;

    if (cs.type === 'utm') {
      coordinate = new UTMCoordinateWithElevation(fix.x, fix.y, fix.z);
      csObj = new UTMCoordinateSystem(cs.zone, cs.northern);
    } else if (cs.type === 'eov') {
      coordinate = new EOVCoordinateWithElevation(fix.x, fix.y, fix.z);
      csObj = new EOVCoordinateSystem();
    } else if (cs.type === 'longlat') {
      const utmR = cs.latFirst
        ? UTMConverter.fromLatLon(fix.x, fix.y)
        : UTMConverter.fromLatLon(fix.y, fix.x);
      coordinate = new UTMCoordinateWithElevation(
        roundToTwoDecimalPlaces(utmR.easting),
        roundToTwoDecimalPlaces(utmR.northing),
        fix.z
      );
      csObj = new UTMCoordinateSystem(utmR.zoneNum, utmR.zoneLetter >= 'N');
    }

    if (coordinate && csObj) {
      if (!globalNormalizer.isInitialized()) globalNormalizer.initializeGlobalOrigin(coordinate);
      if (cs.type === 'utm' || cs.type === 'longlat') {
        convergence = MeridianConvergence.getUTMConvergence(
          coordinate.easting,
          coordinate.northing,
          csObj.zoneNum,
          csObj.northern
        );
      }
      geoData = new GeoData(csObj, [new StationWithCoordinate(fix.station, coordinate)]);
      coordinateSys = csObj;
      fixSurveyIdx = i;
      break;
    }
  }

  // Unknown / missing CS: show coordinate system dialog if a fix point exists
  if (!geoData) {
    const withFix = surveys.find((s) => s.fixes.length > 0);
    if (withFix) {
      const { x, y, z } = withFix.fixes[0];
      if (withFix.cs?.raw) {
        showInfoPanel(i18n.t(unknownCsKey, { cs: withFix.cs.raw }), 5000);
      }
      try {
        const result = await coordinateSystemDialog.show(withFix.displayName, [x, y, z]);
        coordinateSys = result.coordinateSystem;
        if (coordinateSys) {
          const [c1, c2, c3] = result.coordinates;
          let coord;
          if (coordinateSys.type === CoordinateSystemType.EOV) {
            coord = new EOVCoordinateWithElevation(c1, c2, c3);
          } else {
            coord = new UTMCoordinateWithElevation(c1, c2, c3);
          }
          if (!globalNormalizer.isInitialized()) globalNormalizer.initializeGlobalOrigin(coord);
          geoData = new GeoData(
            coordinateSys,
            [new StationWithCoordinate(withFix.fixes[0].station, coord)]
          );
          fixSurveyIdx = surveys.indexOf(withFix);
        }
      } catch (_) {
        /* user cancelled dialog */
      }
    }
  }

  // Put the fix survey first so calculateSurveyStations gets a proper start position
  const ordered = [...surveys];
  if (fixSurveyIdx > 0) ordered.unshift(ordered.splice(fixSurveyIdx, 1)[0]);

  // Build Survey objects and calculate 3D station positions
  const stations = new Map();
  const surveyObjs = [];

  for (let i = 0; i < ordered.length; i++) {
    const s = ordered[i];
    const meta = new SurveyMetadata(
      s.metadata.date,
      s.metadata.declination,
      convergence ?? null,
      s.metadata.team,
      []
    );

    // Shots already store values in the survey's storage unit because parseLength /
    // parseCompass / parseClino pass through values when the file's source unit is one
    // Speleo Studio supports natively. We just need to stamp the survey with that unit.
    const studioUnits = mapToSpeleoStudioUnits(s.units);
    const survey = new Survey(
      s.displayName,
      true,
      meta,
      i === 0 ? s.startStation : undefined,
      s.shots,
      studioUnits
    );

    let startPos = i === 0 ? new Vector(0, 0, 0) : undefined;
    let startCoord = undefined;

    if (i === 0 && geoData?.coordinates?.length > 0) {
      startCoord = geoData.coordinates[0].coordinate;
      startPos = startCoord.toNormalizedVector();
    }

    SurveyHelper.calculateSurveyStations(
      survey,
      surveyObjs,
      stations,
      aliases,
      i === 0 ? s.startStation : undefined,
      startPos,
      startCoord,
      coordinateSys
    );
    surveyObjs.push(survey);
  }

  // Distribute station comments: start station → cave level; others → shot.comment (first use)
  const caveStationComments = [];
  const shotCommentAssigned = new Set();

  for (let i = 0; i < ordered.length; i++) {
    const s = ordered[i];
    const surveyObj = surveyObjs[i];
    for (const { station, comment } of (s.stationComments ?? [])) {
      if (station === s.startStation) {
        caveStationComments.push(new StationComment(station, comment));
      } else if (!shotCommentAssigned.has(station)) {
        const shot = surveyObj.shots.find((sh) => sh.from === station);
        if (shot) {
          shot.comment = comment;
          shotCommentAssigned.add(station);
        } else {
          caveStationComments.push(new StationComment(station, comment));
        }
      } else {
        caveStationComments.push(new StationComment(station, comment));
      }
    }
  }

  // Cave name: title from the file, or the filename stem as fallback
  const rootBase = rootFilename.replace(/\.[^.]+$/, '').split(/[\\/]/).pop();
  const caveName = context.caveTitle ?? rootBase;

  const firstS = ordered[0];
  const caveMetadata = new CaveMetadata(
    undefined,
    undefined,
    undefined,
    undefined,
    firstS.metadata.date,
    firstS.metadata.team?.name ?? ''
  );

  return new Cave(
    caveName, caveMetadata, geoData, stations, surveyObjs, aliases, undefined, caveStationComments
  );
}
