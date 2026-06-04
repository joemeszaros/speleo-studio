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
  Shot,
  ShotType,
  Survey,
  SurveyMetadata,
  SurveyAlias,
  StationComment,
  StationDimension,
  SurveyTeamMember,
  DEFAULT_UNITS
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
import {
  parseMyFloat,
  lengthToDegrees,
  angleToDegrees,
  clinoToDegrees,
  roundToTwoDecimalPlaces,
  convertLengthFromMeters,
  convertAngleFromDegrees,
  sanitizeName
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

// Best-effort human-readable title for a candidate master file. Tries an explicit
// `*title "…"` / `title "…"` (Survex), a `-title "…"` option (Therion `survey … -title`),
// then the first `*begin <name>` / `survey <name>` block name. Returns '' when nothing fits.
function extractTitle(text) {
  let m = text.match(/^\s*\*?title\s+"([^"]*)"/im);
  if (m) return m[1];
  m = text.match(/-title\s+"([^"]*)"/i);
  if (m) return m[1];
  m = text.match(/^\s*(?:\*?begin|survey)\s+(\S+)/im);
  if (m) return m[1];
  return '';
}

// Resolves an `input`/`*include` path (as written in a file located in `dir`) to its actual
// textMap key, directory-aware and extension-aware, exactly like flattenFile. Falls back to a
// basename match (flat multi-file selection where keys are basenames). Returns null if nothing
// matches. Shared by findRootFiles for both root detection and recursive file counting.
function resolveInclude(inc, dir, textMap, defaultExt) {
  const cands = [inc, normalizeRelativePath(dir, inc)];
  if (defaultExt && !inc.toLowerCase().endsWith(defaultExt)) {
    cands.push(inc + defaultExt, normalizeRelativePath(dir, inc + defaultExt));
  }
  const direct = cands.find((c) => textMap.has(c));
  if (direct) return direct;
  const lcBase = inc.split(/[\\/]/).pop().toLowerCase();
  const lcBaseExt = defaultExt ? lcBase + defaultExt : null;
  for (const key of textMap.keys()) {
    const keyBase = key.split(/[\\/]/).pop().toLowerCase();
    if (keyBase === lcBase || keyBase === lcBaseExt) return key;
  }
  return null;
}

// Number of OTHER files a master pulls in through its recursive `input`/`*include` closure
// (the master itself is not counted). This is the real "size" of importing that master.
function recursiveFileCount(rootKey, textMap, opts) {
  const { includeKeyword, defaultExt } = opts;
  const visited = new Set();
  const walk = (key) => {
    if (visited.has(key)) return;
    visited.add(key);
    const text = textMap.get(key);
    if (text === undefined) return;
    const slash = Math.max(key.lastIndexOf('/'), key.lastIndexOf('\\'));
    const dir = slash >= 0 ? key.slice(0, slash) : '';
    for (const line of text.split(/\r?\n/)) {
      const tokens = tokenizeLine(line, opts);
      if (tokens.length >= 2 && tokens[0].toLowerCase() === includeKeyword) {
        const resolved = resolveInclude(tokens[1], dir, textMap, defaultExt);
        if (resolved) walk(resolved);
      }
    }
  };
  walk(rootKey);
  return visited.size - 1; // exclude the master itself
}

// Returns the full ranked list of candidate master files as
// `[{ key, fileCount, title }]` (best first). A "candidate" is a file that no other
// file `input`s/`*include`s — i.e. a potential top of an include tree. `fileCount` is the
// number of files reachable through its recursive include closure (used both to rank and to
// display), `title` a best-effort display name. `findRootFile` is `findRootFiles(...)[0].key`.
export function findRootFiles(textMap, opts) {
  const { includeKeyword, defaultExt } = opts;
  const describe = (key) => ({
    key,
    fileCount : recursiveFileCount(key, textMap, opts),
    title     : extractTitle(textMap.get(key))
  });

  if (textMap.size === 1) return [describe([...textMap.keys()][0])];

  // Mark every file that is referenced by some `input`/`*include`. Resolve each include to
  // its ACTUAL textMap key (directory-aware, same as flattenFile) so that when two files
  // share a basename in different folders (e.g. ubend/ubend.th vs ubend/2000/ubend/ubend.th)
  // only the truly-referenced one is excluded — not every file with that name. Basename is
  // only used as a last-resort fallback when the path can't be resolved to a key.
  const referencedKeys = new Set();
  const unresolvedBasenames = new Set();

  for (const [fromKey, text] of textMap) {
    const slash = Math.max(fromKey.lastIndexOf('/'), fromKey.lastIndexOf('\\'));
    const dir = slash >= 0 ? fromKey.slice(0, slash) : '';
    for (const line of text.split(/\r?\n/)) {
      const tokens = tokenizeLine(line, opts);
      if (tokens.length >= 2 && tokens[0].toLowerCase() === includeKeyword) {
        const inc = tokens[1];
        const resolved = resolveInclude(inc, dir, textMap, defaultExt);
        if (resolved) referencedKeys.add(resolved);
        else unresolvedBasenames.add(inc.split(/[\\/]/).pop());
      }
    }
  }

  // Empty / whitespace-only files (e.g. 0-byte placeholder .th files that litter some
  // datasets) can't be a master — never offer them as candidates.
  const nonEmpty = (name) => (textMap.get(name) ?? '').trim() !== '';

  // A file is a root candidate if its full key was never referenced. When an include
  // couldn't be resolved to a key (e.g. flat multi-file selection keyed by basename), fall
  // back to excluding by basename so those still work.
  const candidates = [...textMap.keys()].filter((name) => {
    if (!nonEmpty(name)) return false;
    if (referencedKeys.has(name)) return false;
    const base = name.split(/[\\/]/).pop();
    if (unresolvedBasenames.has(base)) return false;
    return true;
  });

  const fallback = [...textMap.keys()].filter(nonEmpty);
  const ranked = (candidates.length > 0 ? candidates : fallback).map(describe);
  ranked.sort((a, b) => b.fileCount - a.fileCount);
  return ranked;
}

export function findRootFile(textMap, opts) {
  return findRootFiles(textMap, opts)[0]?.key ?? [...textMap.keys()][0];
}

// Decides which master file(s) to import. Returns an array of textMap keys to import:
//   • 0 candidates  → []        (caller auto-detects a single root)
//   • 1 candidate   → [thatKey] (unambiguous — import straight through)
//   • >1 candidates → shows `dialog` so the user picks; returns the chosen keys, or
//                     `null` when the user cancelled (caller imports nothing).
export async function chooseRootImports(textMap, opts, dialog) {
  const cands = findRootFiles(textMap, opts);
  if (cands.length <= 1) return cands.map((c) => c.key);
  const sel = await dialog.show(cands);
  return sel; // string[] of chosen keys, or null if cancelled
}

// Resolves an include path against the including file's directory, collapsing
// '.' and '..' segments. Returns a forward-slash relative path (textMap keys use '/').
export function normalizeRelativePath(dir, p) {
  const combined = (dir ? dir.split(/[\\/]/) : []).concat((p ?? '').split(/[\\/]/));
  const out = [];
  for (const seg of combined) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return out.join('/');
}

export function flattenFile(filename, textMap, visited, unresolved, opts) {
  const { includeKeyword, skipExtensions = [], defaultExt } = opts;
  if (visited.has(filename)) return [];
  visited.add(filename);

  // Directory of the including file (for resolving relative include paths across folders).
  const slash = Math.max(filename.lastIndexOf('/'), filename.lastIndexOf('\\'));
  const dir = slash >= 0 ? filename.slice(0, slash) : '';

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

      // Try, in order: exact key, path resolved relative to the including file's directory,
      // both again with the format's default extension appended.
      const candidates = [includePath, normalizeRelativePath(dir, includePath)];
      if (defaultExt && !includePath.toLowerCase().endsWith(defaultExt)) {
        candidates.push(includePath + defaultExt, normalizeRelativePath(dir, includePath + defaultExt));
      }
      resolved = candidates.find((c) => textMap.has(c)) ?? null;

      if (!resolved) {
        // Basename fallback (handles flat multi-file selection where keys are basenames).
        const lcBase = basename.toLowerCase();
        const lcBaseExt = defaultExt ? lcBase + defaultExt : null;
        for (const key of textMap.keys()) {
          const keyBase = key.split(/[\\/]/).pop().toLowerCase();
          if (keyBase === lcBase || keyBase === lcBaseExt) {
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
  const unitStr = hasUnit ? t3.toLowerCase() : undefined;
  const scaleRaw = hasUnit ? tokens[4] : t3;
  const scale = scaleRaw !== undefined ? parseMyFloat(scaleRaw) : 1.0;

  // The calibration offset is added directly to shot values during parseShotRow / flushStationPairs.
  // Shot values are stored in `state.units.<field>`, so the offset must end up in that same unit.
  // Pivot through metres / degrees to handle both native and non-native source units uniformly.

  if (field === 'length' || field === 'tape' || field === 'distance') {
    const sourceUnit = unitStr ?? state.units.length;
    const offsetMeters = lengthToDegrees(num, sourceUnit);
    state.calibration.length = convertLengthFromMeters(offsetMeters, mapToSpeleoStudioUnits(state.units).length);
    state.calibration.lengthScale = isNaN(scale) ? 1.0 : scale;
  } else if (field === 'compass' || field === 'bearing') {
    const sourceUnit = unitStr ?? state.units.compass;
    const offsetDegrees = angleToDegrees(num, sourceUnit);
    state.calibration.compass = convertAngleFromDegrees(offsetDegrees, mapToSpeleoStudioUnits(state.units).angle);
    state.calibration.compassScale = isNaN(scale) ? 1.0 : scale;
  } else if (field === 'clino' || field === 'gradient' || field === 'inclination') {
    const sourceUnit = unitStr ?? state.units.clino;
    const offsetDegrees = clinoToDegrees(num, sourceUnit);
    state.calibration.clino = convertAngleFromDegrees(offsetDegrees, mapToSpeleoStudioUnits(state.units).angle);
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
    dz         : -1
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
const NATIVE_ANGLE_UNITS = new Set(['degrees', 'degree', 'deg', 'grads', 'grad', 'gon', 'gons']);

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

/**
 * Mutates `units` in place according to a `units <quantity>... [factor] <unit>` token list.
 * Supports the multi-quantity form (`*units left right up down feet`) and per-column LRUD
 * overrides (`*units left feet`), which sit alongside the survey-wide `length` unit and are
 * consumed by `extractLrud`. Numeric factor tokens (Survex `*units tape 0.3048 meters`) are
 * skipped — we don't apply scale factors here.
 */
export function applyUnits(tokens, units) {
  if (tokens.length < 3) return;
  const unit = tokens[tokens.length - 1].toLowerCase();
  for (let i = 1; i < tokens.length - 1; i++) {
    if (!isNaN(parseMyFloat(tokens[i]))) continue; // skip numeric factor
    const field = tokens[i].toLowerCase();
    // Accept both Therion and Survex quantity aliases
    if (field === 'length' || field === 'tape' || field === 'distance') units.length = unit;
    else if (field === 'compass' || field === 'bearing') units.compass = unit;
    else if (field === 'clino' || field === 'gradient' || field === 'inclination') units.clino = unit;
    else if (field === 'left' || field === 'right' || field === 'up' || field === 'down') {
      units[field] = unit;
    }
  }
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
    feet   : 'feet',
    foot   : 'feet',
    ft     : 'feet',
    yards  : 'yards',
    yard   : 'yards',
    yd     : 'yards',
    yds    : 'yards',
    inches : 'inches',
    inch   : 'inches',
    in     : 'inches',
    meters : 'meters',
    meter  : 'meters',
    metres : 'meters',
    metre  : 'meters',
    m      : 'meters'
  };
  const angleMap = {
    degrees : 'degrees',
    degree  : 'degrees',
    deg     : 'degrees',
    grads   : 'grads',
    grad    : 'grads',
    gon     : 'grads',
    gons    : 'grads'
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

// Survex station/survey names are case-insensitive by default: cavern forces every name to
// lower case (manual `*case` command — default `tolower`). `*case toupper`/`tolower` force a
// case; `*case preserve` keeps it as-is (so `2a` and `2A` differ). We honour this by folding
// the case of names as they are captured. `mode === undefined` means "no case folding" — that
// is the Therion path (Therion names ARE case-sensitive), so this helper is a no-op there.
export function applyCase(name, mode) {
  if (!name || mode === undefined || mode === 'preserve') return name;
  if (mode === 'toupper') return name.toUpperCase();
  return name.toLowerCase(); // 'tolower' — the Survex default
}

export function applyStnNames(name, state) {
  if (!name || name === '.' || name === '-') return name;
  if (name.includes('@')) return name;
  const { stationPrefix: p, stationSuffix: s } = state;
  const combined = p || s ? `${p}${name}${s}` : name;
  // Fold case per the active Survex *case mode (no-op for Therion, where caseMode is undefined).
  return applyCase(combined, state.caseMode);
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

// Resolves a (possibly partial) Therion/Survex station reference from an `equate` to a
// fully-qualified `station@surveyPath` name, where surveyPath is our internal,
// OUTERMOST-first path (e.g. `system_migovec.m2m16m18.M18.gallery`).
//
// Therion `@`-addressing is INNERMOST-first and relative to the scope where the equate is
// declared: `6@gallery.M18.m2m16m18` means station 6 in survey `gallery`, which is in
// `M18`, which is in `m2m16m18`. So we reverse the partial to get an outermost-first
// suffix (`m2m16m18.M18.gallery`) and match it against the tail of a known surveyPath,
// preferring a path inside the equate's declaring scope (`currentPath`).
export function resolveRef(ref, currentPath, allPaths) {
  if (!ref.includes('@')) {
    // A bare station number is local to the survey the equate is declared in.
    return currentPath ? `${ref}@${currentPath}` : ref;
  }
  const at = ref.lastIndexOf('@');
  const stn = ref.slice(0, at);
  const partial = ref.slice(at + 1);
  const tryMatch = (suffix) => {
    const candidates = allPaths.filter((p) => p === suffix || p.endsWith(`.${suffix}`));
    return candidates.find((p) => currentPath && (p === currentPath || p.startsWith(`${currentPath}.`))) ??
      candidates[0];
  };
  // Therion addresses INNERMOST-first, so reverse the partial to outermost-first and match — this
  // stays the primary path (Therion behaviour unchanged). Survex addresses OUTERMOST-first, so its
  // (already converted) refs match the partial as-is; fall back to that only when the reversed
  // form found nothing, keeping the two formats unambiguous.
  const reversed = partial.split('.').reverse().join('.');
  const match = tryMatch(reversed) ?? tryMatch(partial);
  return match ? `${stn}@${match}` : ref;
}

// ─── Equate → alias resolution ────────────────────────────────────────────────

export function addAliases(eqTokens, currentPath, allPaths, aliases) {
  // Keep the fully-qualified names (`station@surveyPath`). They must stay qualified so the
  // position solver can link the exact equated stations across surveys — stripping them to
  // bare numbers (the old behavior) collapsed every survey's `1,2,3…` onto each other.
  const resolved = eqTokens.map((t) => resolveRef(t, currentPath, allPaths));
  for (let i = 0; i + 1 < resolved.length; i++) {
    const a = new SurveyAlias(resolved[i], resolved[i + 1]);
    if (!aliases.some((e) => e.isEqual(a))) aliases.push(a);
  }
}

// ─── Shot parsing ─────────────────────────────────────────────────────────────

// Extracts L/R/U/D values from a tokens array using the format's column indices.
// Each value is parsed through parseLength (so source-unit aliases work) and
// normalised to the survey's storage length unit. Per-column unit overrides
// from `*units left feet` etc. are honoured via `units[f] ?? units.length`.
// Values that are NaN, zero, or negative (e.g. Therion's `-` missing sentinel
// or `-1.0`, or files that pad missing dimensions with `0`) are treated as
// missing and dropped. Returns an object like { left, right, up, down } with
// only the valid keys present, or null if no LRUD field is present in the
// format or all values are missing.
function extractLrud(getter, fmt, units, targetUnit) {
  const haveAnyIdx = ['left', 'right', 'up', 'down'].some((f) => fmt[f] >= 0);
  if (!haveAnyIdx) return null;
  const out = {};
  ['left', 'right', 'up', 'down'].forEach((f) => {
    if (fmt[f] < 0) return;
    const raw = getter(f);
    if (raw === null || raw === undefined || raw === '' || raw === '-') return;
    const sourceUnit = units[f] ?? units.length;
    const parsed = parseLength(raw, sourceUnit);
    if (isNaN(parsed) || parsed <= 0) return;
    out[f] = lengthIntoTargetUnit(parsed, sourceUnit, targetUnit);
  });
  return Object.keys(out).length > 0 ? out : null;
}

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
  const to = type === ShotType.SPLAY ? undefined : stripStn(qualifyStn(applyStnNames(toRaw, state), surveyPath));

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
    let az = (Math.atan2(dx, dy) * (180 / Math.PI) + northAdj + extraRot + 360) % 360;
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
    (lengthIntoTargetUnit(parseLength(get('length'), units.length), units.length, target.length) + calibration.length) *
    calibration.lengthScale;
  const compass =
    (angleIntoTargetUnit(parseCompass(get('compass'), units.compass), units.compass, target.angle) +
      calibration.compass) *
    calibration.compassScale;
  const clino =
    (angleIntoTargetUnit(parseClino(get('clino'), units.clino), units.clino, target.angle) + calibration.clino) *
    calibration.clinoScale;

  if (isNaN(length)) return null;

  const shot = new Shot(shotId, type, from, to, length, compass, clino, undefined);
  const lrud = extractLrud(get, fmt, units, target.length);
  if (lrud) shot._lrud = lrud;
  return shot;
}

/**
 * Parses one row of a `*data passage` block (Survex) — per-station LRUD data.
 * Format example: `*data passage station left right up down`.
 * Pushes `{station, left?, right?, up?, down?}` into `state.stationDimensions`
 * with only the valid (positive, non-missing) values present.
 */
export function parsePassageRow(tokens, state, surveyPath) {
  const { fmt, units } = state;
  const stnIdx = fmt.station >= 0 ? fmt.station : 0;
  const stnRaw = stnIdx < tokens.length ? tokens[stnIdx] : null;
  if (!stnRaw || stnRaw === '-' || stnRaw === '.') return;
  const stn = stripStn(qualifyStn(applyStnNames(stnRaw, state), surveyPath));

  const target = mapToSpeleoStudioUnits(units);
  const get = (field) => {
    const idx = fmt[field];
    return idx >= 0 && idx < tokens.length ? tokens[idx] : null;
  };
  const lrud = extractLrud(get, fmt, units, target.length);
  if (!lrud) return;
  state.stationDimensions.push({ station: stn, ...lrud });
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
    const toRaw = nextPair && nextStnIdx < nextPair.line1.length ? nextPair.line1[nextStnIdx] : null;

    const from = stripStn(qualifyStn(applyStnNames(fromRaw, state), surveyPath));
    const type = toRaw && !isSplay ? ShotType.CENTER : ShotType.SPLAY;
    const to = type === ShotType.CENTER ? stripStn(qualifyStn(applyStnNames(toRaw, state), surveyPath)) : undefined;

    const offset = fmt.newlineIdx + 1;
    const getL1 = (field) => {
      const idx = fmt[field];
      return idx >= 0 && idx < line1.length ? line1[idx] : null;
    };
    const getL2 = (field) => {
      const idx = fmt[field] - offset;
      return idx >= 0 && idx < line2.length ? line2[idx] : null;
    };
    // LRUD columns can sit on either physical line — pick whichever line owns the index.
    const getLrudField = (field) => {
      const idx = fmt[field];
      if (idx < 0) return null;
      return idx < offset ? getL1(field) : getL2(field);
    };

    const target = mapToSpeleoStudioUnits(units);
    const length =
      (lengthIntoTargetUnit(parseLength(getL2('length'), units.length), units.length, target.length) +
        calibration.length) *
      calibration.lengthScale;
    const compass =
      (angleIntoTargetUnit(parseCompass(getL2('compass'), units.compass), units.compass, target.angle) +
        calibration.compass) *
      calibration.compassScale;
    const clino =
      (angleIntoTargetUnit(parseClino(getL2('clino'), units.clino), units.clino, target.angle) + calibration.clino) *
      calibration.clinoScale;

    if (isNaN(length)) continue;
    const shot = new Shot(id++, type, from, to, length, compass, clino, undefined);
    const lrud = extractLrud(getLrudField, fmt, units, target.length);
    if (lrud) shot._lrud = lrud;
    shots.push(shot);
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
      m.stationDimensions.push(...(s.stationDimensions ?? []));
      if (!m.cs && s.cs) m.cs = s.cs;
    } else {
      mergedMap.set(s.surveyPath, {
        ...s,
        shots             : [...s.shots],
        equates           : [...s.equates],
        fixes             : [...s.fixes],
        stationComments   : [...(s.stationComments ?? [])],
        stationDimensions : [...(s.stationDimensions ?? [])]
      });
    }
  }
  const surveys = [...mergedMap.values()];
  const { topLevelEquates } = context;
  const allPaths = surveys.map((s) => s.surveyPath);

  // Resolve all equates → SurveyAlias[]. We keep the declaring survey path alongside
  // each alias so it can later be stored on the cave node where it was declared
  // (aliases are owned per cave); `aliases` stays the flat list used for position calc.
  const aliases = [];
  const aliasOwners = []; // { alias, ownerPath }
  const collectAliases = (eqTokens, ownerPath) => {
    const tmp = [];
    addAliases(eqTokens, ownerPath, allPaths, tmp);
    for (const a of tmp) {
      aliases.push(a);
      aliasOwners.push({ alias: a, ownerPath });
    }
  };
  for (const s of surveys) {
    for (const eqTokens of s.equates) {
      collectAliases(eqTokens, s.surveyPath);
    }
  }
  for (const { tokens, surveyPath } of topLevelEquates) {
    collectAliases(tokens, surveyPath);
  }

  // Resolve each fix's station to the SAME qualified key the solver will use. A fix often
  // targets a deep sub-survey station (`fix 35@prima1.primadona...` declared at the system
  // root); resolveRef turns that raw ref into `35@<full.survey.path>` so the seed actually
  // matches a real station. A bare ref (single-survey/legacy cave) qualifies to its own
  // survey path, which equals the bare name when that survey has no path.
  // Only meaningful for multi-survey caves: a single-survey cave keeps bare station keys
  // (surveyPath is dropped later), so its fix must stay bare too.
  if (surveys.length > 1) {
    for (const s of surveys) {
      for (const fix of s.fixes ?? []) {
        if (fix.ref !== undefined) {
          const resolved = resolveRef(fix.ref, s.surveyPath, allPaths);
          // Adopt the qualified form only when it resolves to a real survey path.
          if (resolved.includes('@')) fix.station = resolved;
        }
      }
    }
  }

  // The coordinate system may be declared once at a grouping root (e.g. plateau's
  // centreline `cs`) and inherited by the independent caves below it.
  const globalCsEntry = surveys.find((s) => s.cs && s.cs.type !== 'unknown');
  const globalCs = globalCsEntry ? globalCsEntry.cs : null;
  const globalRawCs = surveys.map((s) => s.cs).find((cs) => cs && cs.raw)?.raw;

  // ─── Build the nested Cave tree (positions computed later, per connected cave) ──
  //
  // Therion/Survex nest surveys arbitrarily deep (surveyPath is the dot-separated,
  // outermost-first path). A survey block that contains sub-surveys becomes a Cave; a
  // leaf block (centreline shots) becomes a Survey owned by its parent Cave. Whether the
  // whole file is ONE cave or several is decided after the tree is built (see splitting).

  const splitPath = (p) => (p === '' || p == null ? [] : p.split('.'));
  const rootBase = rootFilename
    .replace(/\.[^.]+$/, '')
    .split(/[\\/]/)
    .pop();
  const rootTitle = context.caveTitle ?? rootBase;
  const titleFor = (path, fallback) => (context.titles && context.titles.get(path)) || fallback;

  const isContainer = new Set();
  for (const s of surveys) {
    const segs = splitPath(s.surveyPath);
    for (let d = 1; d < segs.length; d++) isContainer.add(segs.slice(0, d).join('.'));
  }

  const syntheticRoot = new Cave(rootTitle);
  const caveByPath = new Map();
  const ensureCave = (segs) => {
    if (segs.length === 0) return syntheticRoot;
    let parent = syntheticRoot,
      path = '',
      node = syntheticRoot;
    for (let d = 0; d < segs.length; d++) {
      path = d === 0 ? segs[0] : `${path}.${segs[d]}`;
      if (caveByPath.has(path)) {
        node = caveByPath.get(path);
      } else {
        node = new Cave(segs[d]);
        caveByPath.set(path, node);
        parent.children.push(node);
      }
      parent = node;
    }
    return node;
  };
  const nodeForPath = (path) => {
    const segs = splitPath(path);
    if (segs.length === 0) return syntheticRoot;
    if (isContainer.has(path)) return ensureCave(segs);
    return ensureCave(segs.slice(0, -1));
  };

  // Build Survey objects (no positions yet) and attach fixes/cs to their cave nodes.
  const surveyEntry = new Map(); // Survey -> source entry (for start station / comments / dims)
  const surveyByPath = new Map(); // surveyPath -> Survey (leaf blocks, for alias ownership)
  for (const s of surveys) {
    const segs = splitPath(s.surveyPath);
    // A block that itself contains sub-blocks owns the node at its own path; its centreline
    // is that cave's OWN survey. A leaf block is a survey of its parent cave.
    const isOwnCentreline = segs.length === 0 || isContainer.has(s.surveyPath);
    const owner = nodeForPath(s.surveyPath);
    if (s.fixes && s.fixes.length) (owner._fixes ??= []).push(...s.fixes);
    if (s.cs && s.cs.type !== 'unknown' && !owner._cs) owner._cs = s.cs;
    if (s.cs && s.cs.raw && !owner._rawCs) owner._rawCs = s.cs.raw;
    if (s.shots.length > 0) {
      let name = s.displayName;
      if (segs.length > 1 && s.displayName === s.surveyPath) name = sanitizeName(segs[segs.length - 1]);
      // Re-index shot ids to be unique within the (possibly merged from multiple
      // centrelines) survey — splay/auxiliary station names derive from shot.id.
      s.shots.forEach((sh, i) => {
        sh.id = i + 1;
      });
      const meta = new SurveyMetadata(s.metadata.date, s.metadata.declination, null, s.metadata.team, []);
      const survey = new Survey(name, true, meta, undefined, s.shots, mapToSpeleoStudioUnits(s.units));
      // Record the survey's path so the position solver can qualify its station names and
      // avoid collisions with the same numbers reused in sibling surveys. (qualify() is a
      // no-op when surveyPath is empty, so single-survey files keep bare keys.)
      survey.surveyPath = s.surveyPath || undefined;
      owner.surveys.push(survey);
      if (isOwnCentreline) owner._hasOwnCentreline = true;
      surveyEntry.set(survey, s);
      surveyByPath.set(s.surveyPath, survey);
    }
  }

  // Survex top-level fixes (declared outside any *begin — e.g. a master file's single anchor
  // `*fix system.m2.izent1.16 ...`) are owned by no survey. Resolve each ref to its station's
  // full survey path and attach the fix to that path's cave node, so the per-cave solver below
  // seeds from it. Therion never sets topLevelFixes, so this is a no-op there.
  for (const fix of context.topLevelFixes ?? []) {
    const resolved = resolveRef(fix.ref, '', allPaths);
    if (!resolved.includes('@')) continue;
    const fixPath = resolved.slice(resolved.indexOf('@') + 1);
    // Only attach when the resolved path actually exists (a real survey, or a container of one).
    // resolveRef returns the ref unchanged when it can't match, so without this an unresolvable
    // master fix (e.g. referencing a survey that wasn't imported) would make nodeForPath()
    // fabricate phantom cave nodes for a path no survey owns.
    const known = allPaths.some((p) => p === fixPath || p.startsWith(`${fixPath}.`));
    if (!known) continue;
    fix.station = resolved;
    (nodeForPath(fixPath)._fixes ??= []).push(fix);
  }

  // Prefer the block's title for cave node names (keep the segment as fallback).
  for (const [path, node] of caveByPath) node.name = titleFor(path, node.name);

  // Assign aliases to the cave node where the equate was declared.
  const ownerCaveForPath = (dotPath) => {
    const segs = splitPath(dotPath);
    for (let d = segs.length; d >= 1; d--) {
      const p = segs.slice(0, d).join('.');
      if (caveByPath.has(p)) return caveByPath.get(p);
    }
    return syntheticRoot;
  };
  for (const { alias, ownerPath } of aliasOwners) {
    // Equates declared inside a leaf survey block belong to that survey (they connect its
    // own stations) — keep them off the grouping parent so a plain grouping isn't mistaken
    // for a connected cave. Container-level equates (which connect child caves) stay on the
    // cave node.
    const leafSurvey = !isContainer.has(ownerPath) && surveyByPath.get(ownerPath);
    if (leafSurvey) {
      (leafSurvey._aliases ??= []).push(alias);
    } else {
      ownerCaveForPath(ownerPath).aliases.push(alias);
    }
  }

  // ─── Split pure-grouping nodes into separate top-level caves ───────────────────
  //
  // A connected cave is stored as ONE cave (with sub-caves). But a Therion file that just
  // `input`s several *unconnected* caves (e.g. a whole karst plateau) is only an
  // organizational grouping — its members are independent caves that reuse station
  // numbers, so they must NOT share a station map. A node is a "pure grouping" when it has
  // no centreline of its own AND owns no equates (which would connect its children) AND has
  // child caves; its children become separate top-level caves (recursively). Everything
  // else (own shots, owns equates, or a leaf cave) is one cave.
  const caveRoots = [];
  const collectRoots = (node) => {
    // Transparent wrapper: a node with no data of its own and a single child — descend
    // (e.g. the synthetic root, or a file's outer survey that just wraps one cave).
    if (node.surveys.length === 0 && node.aliases.length === 0 && node.children.length === 1) {
      collectRoots(node.children[0]);
      return;
    }
    // Grouping: a node with no centreline of its own (it just `input`s/`*begin`s others)
    // and no equates connecting its members, yet several independent members (leaf surveys
    // and/or child caves). Each member becomes its own top-level cave — a node WITH its own
    // centreline is a real cave and keeps its sub-surveys/sub-caves together.
    const memberCount = node.surveys.length + node.children.length;
    if (!node._hasOwnCentreline && node.aliases.length === 0 && memberCount > 1) {
      node.children.forEach(collectRoots);
      for (const survey of node.surveys) {
        const wrapped = new Cave(survey.name);
        wrapped.surveys.push(survey);
        if (survey._aliases) wrapped.aliases.push(...survey._aliases);
        caveRoots.push(wrapped);
      }
      return;
    }
    caveRoots.push(node);
  };
  collectRoots(syntheticRoot);

  // ─── Compute each cave independently (own station map + own geoData) ───────────
  // Builds a projected coordinate for a single fix under a known coordinate system.
  // Returns { coordinate, csObj, convergence } or null when the CS is unrecognized.
  const buildCoordinate = (fix, cs) => {
    let coordinate = null,
      csObj = null,
      convergence = null;
    if (cs.type === 'utm') {
      coordinate = new UTMCoordinateWithElevation(fix.x, fix.y, fix.z);
      csObj = new UTMCoordinateSystem(cs.zone, cs.northern);
    } else if (cs.type === 'eov') {
      coordinate = new EOVCoordinateWithElevation(fix.x, fix.y, fix.z);
      csObj = new EOVCoordinateSystem();
    } else if (cs.type === 'longlat') {
      const utmR = cs.latFirst ? UTMConverter.fromLatLon(fix.x, fix.y) : UTMConverter.fromLatLon(fix.y, fix.x);
      coordinate = new UTMCoordinateWithElevation(
        roundToTwoDecimalPlaces(utmR.easting),
        roundToTwoDecimalPlaces(utmR.northing),
        fix.z
      );
      csObj = new UTMCoordinateSystem(utmR.zoneNum, utmR.zoneLetter >= 'N');
    }
    if (!coordinate || !csObj) return null;
    if (!globalNormalizer.isInitialized()) globalNormalizer.initializeGlobalOrigin(coordinate);
    if (cs.type === 'utm' || cs.type === 'longlat') {
      convergence = MeridianConvergence.getUTMConvergence(
        coordinate.easting,
        coordinate.northing,
        csObj.zoneNum,
        csObj.northern
      );
    }
    return { coordinate, csObj, convergence };
  };

  // Resolve an unknown coordinate system via the dialog once and reuse the answer for
  // every independent cave in the same import (e.g. one EPSG the app doesn't recognize).
  // Returns the chosen CoordinateSystem (or null if cancelled); per-fix coordinates are
  // built by the caller via buildCoordinate so multiple fixes share one CS.
  const dialogCache = new Map(); // rawCs -> coordinateSystem | null
  const resolveUnknownCs = async (fix, rawCs, displayName) => {
    const key = rawCs ?? '';
    if (!dialogCache.has(key)) {
      if (rawCs) showInfoPanel(i18n.t(unknownCsKey, { cs: rawCs }), 5000);
      try {
        const result = await coordinateSystemDialog.show(displayName, [fix.x, fix.y, fix.z]);
        dialogCache.set(key, result?.coordinateSystem ?? null);
      } catch (_) {
        dialogCache.set(key, null);
      }
    }
    return dialogCache.get(key);
  };

  const computeCaveRoot = async (caveRoot) => {
    const subNodes = [];
    caveRoot.walk((c) => subNodes.push(c));
    const subAliases = [];
    caveRoot.walk((c) => subAliases.push(...c.aliases));

    // Station-name collisions only happen when several surveys are solved into one shared
    // map (a connected cave with sub-surveys, each numbered from 1). A cave with a single
    // survey can't collide, so we drop its surveyPath and keep BARE station keys — that
    // way the vast majority of caves (and all their display/edit/export consumers) behave
    // exactly as before. Only genuinely multi-survey connected caves use qualified keys.
    const allSurveysInCave = caveRoot.getAllSurveys();
    if (allSurveysInCave.length <= 1) {
      allSurveysInCave.forEach((s) => {
        s.surveyPath = undefined;
      });
    }
    // Include equates owned by leaf surveys (not promoted to a cave node).
    for (const survey of caveRoot.getAllSurveys()) {
      if (survey._aliases) subAliases.push(...survey._aliases);
    }

    // Collect ALL fixed stations in this cave's subtree, each with the CS that applies to
    // it (its own, else inherited from a grouping ancestor / file-level `cs`). A connected
    // system like Migovec fixes one entrance PER sub-cave, and those sub-caves are anchored
    // independently in the shared coordinate space — not all reachable through equates — so
    // every fix must seed the solver, not just the first.
    // The same fix can be reachable from both a cave node's `_fixes` and a survey source
    // entry's `fixes` (a leaf block is both), so dedupe by station + coordinates to avoid
    // duplicate geoData coordinates.
    const fixEntries = []; // { fix, cs, raw }
    const seenFix = new Set();
    const addFix = (fix, cs, raw) => {
      const k = `${fix.station}|${fix.x}|${fix.y}|${fix.z}`;
      if (seenFix.has(k)) return;
      seenFix.add(k);
      fixEntries.push({ fix, cs, raw });
    };
    caveRoot.walk((c) => {
      for (const fix of c._fixes ?? []) addFix(fix, c._cs ?? globalCs, c._rawCs ?? globalRawCs);
    });
    for (const survey of caveRoot.getAllSurveys()) {
      const e = surveyEntry.get(survey);
      for (const fix of e?.fixes ?? []) {
        addFix(fix, e.cs && e.cs.type !== 'unknown' ? e.cs : globalCs, e.cs?.raw ?? globalRawCs);
      }
    }

    // Resolve a single coordinate system for the whole cave: the first recognized parsed CS,
    // else ask the user once (an unknown EPSG). All fixes are then projected under it.
    let coordinateSys = null,
      convergence = null;
    const fixCoords = []; // StationWithCoordinate[]
    const knownEntry = fixEntries.find((fe) => fe.cs && fe.cs.type !== 'unknown');
    if (knownEntry) {
      for (const { fix, cs } of fixEntries) {
        const built = cs && cs.type !== 'unknown' ? buildCoordinate(fix, cs) : null;
        if (built) {
          fixCoords.push(new StationWithCoordinate(fix.station, built.coordinate));
          coordinateSys ??= built.csObj;
          convergence ??= built.convergence;
        }
      }
    } else if (fixEntries.length > 0) {
      // No recognized CS — ask once (reused across the import), then project every fix.
      const first = fixEntries[0];
      coordinateSys = await resolveUnknownCs(first.fix, first.raw, caveRoot.name);
      if (coordinateSys) {
        for (const { fix } of fixEntries) {
          const coord =
            coordinateSys.type === CoordinateSystemType.EOV
              ? new EOVCoordinateWithElevation(fix.x, fix.y, fix.z)
              : new UTMCoordinateWithElevation(fix.x, fix.y, fix.z);
          if (!globalNormalizer.isInitialized()) globalNormalizer.initializeGlobalOrigin(coord);
          fixCoords.push(new StationWithCoordinate(fix.station, coord));
        }
      }
    }
    const geoData = coordinateSys && fixCoords.length > 0 ? new GeoData(coordinateSys, fixCoords) : null;

    // Set each survey's start to its source start station and stamp meridian convergence,
    // then solve the whole network with the SHARED order-independent fixpoint solver — the
    // same one used on reload/edit, so all three paths agree. (Surveys connect only via
    // shared/equated stations, so a single ordered pass cannot place every survey.)
    for (const survey of caveRoot.getAllSurveys()) {
      const entry = surveyEntry.get(survey);
      survey.metadata.convergence = convergence ?? null;
      if (entry?.startStation !== undefined) survey.start = entry.startStation;
    }
    let stations;
    try {
      stations = SurveyHelper.calculateCaveStations(caveRoot.getAllSurveys(), subAliases, geoData);
    } catch (e) {
      throw new Error(i18n.t('errors.import.surveyAtPathFailed', { path: caveRoot.name }) + ' ' + e.message);
    }

    // Distribute computed stations into each cave node's own map (by owning survey).
    const surveyToCave = new Map();
    subNodes.forEach((c) => {
      c.stations = new Map();
      c.surveys.forEach((s) => surveyToCave.set(s, c));
    });
    for (const [name, st] of stations) {
      (surveyToCave.get(st.survey) ?? caveRoot).stations.set(name, st);
    }

    // Distribute station comments: start station → its cave; others → shot.comment (first use).
    const shotCommentAssigned = new Set();
    for (const survey of caveRoot.getAllSurveys()) {
      const entry = surveyEntry.get(survey);
      const cave = surveyToCave.get(survey) ?? caveRoot;
      for (const { station, comment } of entry?.stationComments ?? []) {
        if (station === entry.startStation) {
          cave.stationComments.push(new StationComment(station, comment));
        } else if (!shotCommentAssigned.has(station)) {
          const shot = survey.shots.find((sh) => sh.from === station);
          if (shot) {
            shot.comment = comment;
            shotCommentAssigned.add(station);
          } else {
            cave.stationComments.push(new StationComment(station, comment));
          }
        } else {
          cave.stationComments.push(new StationComment(station, comment));
        }
      }
    }

    // Aggregate station-level LRUD (passage-derived first, then shot-derived `_lrud`).
    const dimsByStation = new Map();
    for (const survey of caveRoot.getAllSurveys()) {
      for (const { station, ...lrud } of surveyEntry.get(survey)?.stationDimensions ?? []) {
        if (!dimsByStation.has(station)) dimsByStation.set(station, lrud);
      }
    }
    for (const survey of caveRoot.getAllSurveys()) {
      for (const shot of survey.shots) {
        if (!shot._lrud) continue;
        if (!dimsByStation.has(shot.from)) dimsByStation.set(shot.from, shot._lrud);
        delete shot._lrud;
      }
    }
    for (const [name, l] of dimsByStation) {
      const cave = (stations.get(name)?.survey && surveyToCave.get(stations.get(name).survey)) ?? caveRoot;
      cave.stationDimensions.push(new StationDimension(name, l.left, l.right, l.up, l.down));
    }

    const firstSurvey = caveRoot.getAllSurveys()[0];
    caveRoot.metadata = new CaveMetadata(
      undefined,
      undefined,
      undefined,
      undefined,
      firstSurvey?.metadata?.date ?? new Date(),
      firstSurvey?.metadata?.team?.name ?? ''
    );
    caveRoot.geoData = geoData;
  };

  for (const caveRoot of caveRoots) {
    await computeCaveRoot(caveRoot);
  }

  // A single connected cave returns one element; a grouping file returns several
  // independent caves. The caller adds each to the project.
  return caveRoots;
}
