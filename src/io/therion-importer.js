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

import { Importer } from './importer-base.js';
import * as U from '../utils/utils.js';
import { SurveyHelper } from '../survey.js';
import { showInfoPanel } from '../ui/popups.js';
import { Shot, ShotType, Survey, SurveyMetadata, SurveyTeam, SurveyTeamMember, SurveyAlias } from '../model/survey.js';
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
import { parseMyFloat } from '../utils/utils.js';
import { MeridianConvergence, UTMConverter } from '../utils/geo.js';
import { globalNormalizer } from '../utils/global-coordinate-normalizer.js';
import { CoordinateSystemDialog } from '../ui/coordinate-system-dialog.js';
import { i18n } from '../i18n/i18n.js';

class TherionImporter extends Importer {

  constructor(db, options, scene, manager) {
    super(db, options, scene, manager);
    this.coordinateSystemDialog = new CoordinateSystemDialog();
  }

  // ─── Public API ──────────────────────────────────────────────────────────────

  /** Batch entry point: filesMap is Map<filename, File>. All .th files passed together. */
  async importFiles(filesMap, onCaveLoad) {
    const textMap = new Map();
    for (const [name, file] of filesMap) {
      const encoding = await this.#detectEncoding(file);
      textMap.set(name, await this.#readFileAsText(file, encoding));
    }
    const cave = await this.getCave(textMap);
    if (cave) await onCaveLoad(cave);
  }

  /** Single-file entry point – wraps into a one-entry map. */
  async importFile(file, name, onCaveLoad) {
    await this.importFiles(new Map([[file.name, file]]), onCaveLoad);
  }

  /** Public for testing: textMap is Map<filename, string>. Returns a Cave. */
  async getCave(textMap) {
    const rootName = this.#findRootFile(textMap);
    return await this.#parseTherion(rootName, textMap);
  }

  // ─── File reading ─────────────────────────────────────────────────────────────

  async #detectEncoding(file) {
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

  async #readFileAsText(file, encoding) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = reject;
      reader.readAsText(file, encoding);
    });
  }

  // ─── Root file detection ──────────────────────────────────────────────────────

  #findRootFile(textMap) {
    if (textMap.size === 1) return [...textMap.keys()][0];

    // Collect all basenames that appear in an 'input' directive
    const referenced = new Set();
    for (const text of textMap.values()) {
      for (const line of text.split(/\r?\n/)) {
        const tokens = this.#tokenizeLine(line);
        if (tokens.length >= 2 && tokens[0].toLowerCase() === 'input') {
          const path = tokens[1];
          referenced.add(path);
          referenced.add(path.split(/[\\/]/).pop());
        }
      }
    }

    // Root = a file whose name/basename is NOT in the referenced set
    const candidates = [...textMap.keys()].filter((name) => {
      const base = name.split(/[\\/]/).pop();
      return !referenced.has(name) && !referenced.has(base);
    });

    const ranked = (candidates.length > 0 ? candidates : [...textMap.keys()]).sort((a, b) => {
      const countInputs = (text) => (text.match(/^\s*input\b/gim) ?? []).length;
      return countInputs(textMap.get(b)) - countInputs(textMap.get(a));
    });

    return ranked[0];
  }

  // ─── Tokenizer ───────────────────────────────────────────────────────────────

  #tokenizeLine(line) {
    const tokens = [];
    let i = 0;
    while (i < line.length) {
      while (i < line.length && (line[i] === ' ' || line[i] === '\t')) i++;
      if (i >= line.length || line[i] === '#') break;

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
        while (i < line.length && line[i] !== ' ' && line[i] !== '\t' && line[i] !== '#') {
          token += line[i++];
        }
        if (token) tokens.push(token);
      }
    }
    return tokens;
  }

  // ─── Include expansion ────────────────────────────────────────────────────────

  #flattenFile(filename, textMap, visited, unresolvedInputs) {
    if (visited.has(filename)) return [];
    visited.add(filename);

    const text = textMap.get(filename);
    if (text === undefined) {
      unresolvedInputs.push(filename);
      return [];
    }

    const rawLines = text.split(/\r?\n/);
    const result = [];

    for (let i = 0; i < rawLines.length; i++) {
      let line = rawLines[i];
      // Line continuation
      while (line.endsWith('\\') && i + 1 < rawLines.length) {
        line = line.slice(0, -1) + ' ' + rawLines[++i];
      }

      const tokens = this.#tokenizeLine(line);
      if (tokens.length === 0) continue;

      if (tokens[0].toLowerCase() === 'input') {
        const inputPath = tokens[1] ?? '';
        const basename = inputPath.split(/[\\/]/).pop();
        let resolved = null;

        if (textMap.has(inputPath)) {
          resolved = inputPath;
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
          result.push(...this.#flattenFile(resolved, textMap, visited, unresolvedInputs));
        } else {
          const lc = basename.toLowerCase();
          if (!lc.endsWith('.th2') && !lc.endsWith('.thm')) {
            unresolvedInputs.push(inputPath);
          }
        }
      } else {
        result.push(tokens);
      }
    }

    return result;
  }

  // ─── Main parser ──────────────────────────────────────────────────────────────

  async #parseTherion(rootFilename, textMap) {
    const unresolvedInputs = [];
    const lines = this.#flattenFile(rootFilename, textMap, new Set(), unresolvedInputs);

    const context = {
      surveyStack     : [],
      surveys         : [],
      topLevelEquates : [],
      globalCs        : null,
      caveTitle       : null
    };

    this.#parseBlocks(lines, context);

    if (context.surveys.length === 0) {
      if (unresolvedInputs.length > 0) {
        throw new Error(i18n.t('errors.import.therionMissingInputFiles'));
      }
      throw new Error(i18n.t('errors.import.therionNoData'));
    }

    if (unresolvedInputs.length > 0) {
      showInfoPanel(i18n.t('errors.import.therionUnresolvedInputs', { files: unresolvedInputs.join(', ') }), 6000);
    }

    return await this.#assembleCave(context, rootFilename);
  }

  // ─── Block parser ─────────────────────────────────────────────────────────────

  #parseBlocks(lines, context) {
    let i = 0;
    while (i < lines.length) {
      const tokens = lines[i];
      if (!tokens?.length) {
        i++;
        continue;
      }
      const kw = tokens[0].toLowerCase();

      switch (kw) {
        case 'survey': {
          const name = tokens[1] ?? 'unnamed';
          const titleIdx = tokens.indexOf('-title');
          const title = titleIdx >= 0 && titleIdx + 1 < tokens.length ? tokens[titleIdx + 1] : name;
          context.surveyStack.push({ name, title });
          if (context.surveyStack.length === 1 && !context.caveTitle) {
            context.caveTitle = title;
          }
          i++;
          break;
        }

        case 'endsurvey':
          context.surveyStack.pop();
          i++;
          break;

        case 'centreline':
        case 'centerline': {
          const endIdx = this.#findBlockEnd(lines, i + 1, ['endcentreline', 'endcenterline', 'endcentraline']);
          const survey = this.#parseCentreline(lines, i + 1, endIdx, context);
          if (survey) context.surveys.push(survey);
          i = endIdx + 1;
          break;
        }

        case 'equate':
          if (tokens.length >= 3) {
            context.topLevelEquates.push({
              tokens     : tokens.slice(1),
              surveyPath : context.surveyStack.map((s) => s.name).join('.')
            });
          }
          i++;
          break;

        case 'cs':
          if (tokens.length >= 2) context.globalCs = this.#parseCs(tokens.slice(1));
          i++;
          break;

        default:
          i++;
      }
    }
  }

  #findBlockEnd(lines, start, endKeywords) {
    const targets = new Set(endKeywords.map((k) => k.toLowerCase()));
    const opens = new Set(['survey', 'centreline', 'centerline', 'scrap', 'map', 'surface', 'layout', 'lookup']);
    const closes = new Set([
      'endsurvey',
      'endcentreline',
      'endcenterline',
      'endcentraline',
      'endscrap',
      'endmap',
      'endsurface',
      'endlayout',
      'endlookup'
    ]);
    let depth = 0;

    for (let i = start; i < lines.length; i++) {
      const kw = lines[i]?.[0]?.toLowerCase();
      if (!kw) continue;
      if (targets.has(kw) && depth === 0) return i;
      if (opens.has(kw)) depth++;
      else if (closes.has(kw) && depth > 0) depth--;
    }
    return lines.length;
  }

  // ─── Centreline parser ────────────────────────────────────────────────────────

  #parseCentreline(lines, start, end, context) {
    const surveyPath = context.surveyStack.map((s) => s.name).join('.');
    const inner = context.surveyStack.at(-1);
    const displayName = inner && inner.title !== inner.name ? inner.title : surveyPath || 'Survey';

    const state = {
      date        : null,
      teamName    : null,
      members     : [],
      declination : 0,
      units       : { length: 'meters', compass: 'degrees', clino: 'degrees' },
      calibration : { compass: 0, clino: 0 },
      cs          : context.globalCs,
      fixes       : [],
      equates     : [],
      fmt         : null,
      isSplay     : false
    };

    const shots = [];
    let shotId = 0;
    const stationPairs = [];
    let pendingLine1 = null;
    let pendingState = null;

    const IGNORE_KWS = new Set([
      'station',
      'grade',
      'extend',
      'break',
      'export',
      'mark',
      'sd',
      'infer',
      'passage',
      'endpassage',
      'walls',
      'endwalls'
    ]);

    for (let i = start; i < end; i++) {
      const tokens = lines[i];
      if (!tokens?.length) continue;
      const kw = tokens[0].toLowerCase();

      // ── commands ──
      if (kw === 'data') {
        // Flush buffered station-format pairs before changing format
        if (stationPairs.length > 0) {
          this.#flushStationPairs(stationPairs, shots, shotId, surveyPath);
          shotId = shots.length;
          stationPairs.length = 0;
          pendingLine1 = null;
        }
        state.fmt = this.#parseDataFormat(tokens);
        continue;
      }

      if (kw === 'cs' && tokens.length >= 2) {
        state.cs = this.#parseCs(tokens.slice(1));
        continue;
      }

      if (kw === 'fix' && tokens.length >= 5) {
        const stn = this.#stripStn(this.#qualifyStn(tokens[1], surveyPath));
        const x = parseMyFloat(tokens[2]);
        const y = parseMyFloat(tokens[3]);
        const z = parseMyFloat(tokens[4]);
        if (!isNaN(x) && !isNaN(y) && !isNaN(z)) state.fixes.push({ station: stn, x, y, z });
        continue;
      }

      if (kw === 'date' && tokens.length >= 2) {
        state.date = this.#parseDate(tokens[1]);
        continue;
      }

      if (kw === 'team') {
        // team "Name" [role] "Name2" [role2] ...
        let j = 1;
        while (j < tokens.length) {
          const memberName = tokens[j++];
          // A role token is non-numeric and doesn't look like a quoted-string placeholder
          const hasRole = j < tokens.length && isNaN(tokens[j]) && !/^\d/.test(tokens[j]);
          const role = hasRole ? tokens[j++] : '';
          if (memberName) {
            state.members.push(new SurveyTeamMember(memberName, role));
            if (!state.teamName) state.teamName = memberName;
          }
        }
        continue;
      }

      if (kw === 'declination') {
        if (tokens[1]?.toLowerCase() === 'auto') {
          state.declination = 0; // cannot replicate Therion's auto calculation
        } else {
          const val = parseMyFloat(tokens[1]);
          if (!isNaN(val)) {
            const unit = tokens[2]?.toLowerCase();
            state.declination = unit === 'grad' || unit === 'grads' ? val * 0.9 : val;
          }
        }
        continue;
      }

      if (kw === 'units') {
        this.#applyUnits(tokens, state.units);
        continue;
      }

      if (kw === 'calibrate' && tokens.length >= 3) {
        const field = tokens[1].toLowerCase();
        const val = parseMyFloat(tokens[2]);
        if (!isNaN(val)) {
          if (field === 'compass' || field === 'bearing') state.calibration.compass = val;
          else if (field === 'clino' || field === 'gradient') state.calibration.clino = val;
        }
        continue;
      }

      if (kw === 'flags') {
        const sub = tokens[1]?.toLowerCase();
        if (sub === 'splay') state.isSplay = true;
        else if (sub === 'not' && tokens[2]?.toLowerCase() === 'splay') state.isSplay = false;
        continue;
      }

      if (kw === 'equate' && tokens.length >= 3) {
        state.equates.push(tokens.slice(1));
        continue;
      }

      if (IGNORE_KWS.has(kw)) continue;

      // ── data rows ──
      if (!state.fmt) continue;

      if (state.fmt.hasNewline) {
        if (!pendingLine1) {
          pendingLine1 = tokens;
          pendingState = {
            fmt         : state.fmt,
            units       : { ...state.units },
            calibration : { ...state.calibration },
            isSplay     : state.isSplay
          };
        } else {
          stationPairs.push({ line1: pendingLine1, line2: tokens, state: pendingState });
          pendingLine1 = null;
        }
      } else {
        const shot = this.#parseShotRow(tokens, state, surveyPath, shotId);
        if (shot) {
          shots.push(shot);
          shotId++;
        }
      }
    }

    // Flush remaining station pairs
    if (stationPairs.length > 0) {
      this.#flushStationPairs(stationPairs, shots, shotId, surveyPath);
    }

    if (shots.length === 0 && state.fixes.length === 0) return null;

    const metadata = new SurveyMetadata(
      state.date ?? new Date(),
      state.declination,
      null,
      new SurveyTeam(state.teamName ?? '', state.members),
      []
    );

    return {
      displayName,
      surveyPath,
      shots,
      metadata,
      equates      : state.equates,
      cs           : state.cs,
      fixes        : state.fixes,
      startStation : shots[0]?.from
    };
  }

  // ─── Data format ──────────────────────────────────────────────────────────────

  #parseDataFormat(tokens) {
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
      down       : -1
    };

    columns.forEach((col, idx) => {
      if (col === 'newline' || col === 'ignoreall') return;
      const key = ALIASES[col] ?? col;
      if (key in fmt && fmt[key] === -1) fmt[key] = idx;
    });

    return fmt;
  }

  // ─── Shot row parsing ─────────────────────────────────────────────────────────

  #parseShotRow(tokens, state, surveyPath, shotId) {
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
    const from = this.#stripStn(this.#qualifyStn(fromRaw, surveyPath));
    const to = type === ShotType.SPLAY ? undefined : this.#stripStn(this.#qualifyStn(toRaw, surveyPath));

    const length = this.#parseLength(get('length'), units.length);
    const compass = this.#parseCompass(get('compass'), units.compass) + calibration.compass;
    const clino = this.#parseClino(get('clino'), units.clino) + calibration.clino;

    if (isNaN(length)) return null;

    return new Shot(shotId, type, from, to, length, compass, clino, undefined);
  }

  /** Process buffered (line1, line2) pairs for the station-first data format. */
  #flushStationPairs(pairs, shots, startId, surveyPath) {
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

      const from = this.#stripStn(this.#qualifyStn(fromRaw, surveyPath));
      const type = toRaw && !isSplay ? ShotType.CENTER : ShotType.SPLAY;
      const to = type === ShotType.CENTER ? this.#stripStn(this.#qualifyStn(toRaw, surveyPath)) : undefined;

      // Shot values are in the second line (after newline column)
      const offset = fmt.newlineIdx + 1;
      const getL2 = (field) => {
        const idx = fmt[field] - offset;
        return idx >= 0 && idx < line2.length ? line2[idx] : null;
      };

      const length = this.#parseLength(getL2('length'), units.length);
      const compass = this.#parseCompass(getL2('compass'), units.compass) + calibration.compass;
      const clino = this.#parseClino(getL2('clino'), units.clino) + calibration.clino;

      if (isNaN(length)) continue;
      shots.push(new Shot(id++, type, from, to, length, compass, clino, undefined));
    }
  }

  // ─── Value parsers ────────────────────────────────────────────────────────────

  #parseLength(value, unit) {
    if (!value) return NaN;
    const num = parseMyFloat(value);
    if (isNaN(num)) return NaN;
    return unit === 'feet' ? num * 0.3048 : unit === 'yards' ? num * 0.9144 : num;
  }

  #parseCompass(value, unit) {
    if (!value || value === '-') return 0;
    const num = parseMyFloat(value);
    if (isNaN(num)) return 0;
    return unit === 'grad' || unit === 'grads' ? num * 0.9 : unit === 'minutes' ? num / 60 : num;
  }

  #parseClino(value, unit) {
    if (!value) return 0;
    const lower = value.toLowerCase();
    if (lower === 'up') return 90;
    if (lower === 'down') return -90;
    const num = parseMyFloat(value);
    if (isNaN(num)) return 0;
    return unit === 'percent'
      ? Math.atan(num / 100) * (180 / Math.PI)
      : unit === 'grad' || unit === 'grads'
        ? num * 0.9
        : num;
  }

  #parseDate(str) {
    if (!str) return new Date();
    const parts = str.split('.');
    if (parts.length >= 2) {
      return new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2] ?? '1'));
    }
    return new Date(parseInt(parts[0]), 0, 1);
  }

  #applyUnits(tokens, units) {
    if (tokens.length < 3) return;
    const field = tokens[1].toLowerCase();
    const unit = tokens[2].toLowerCase();
    if (field === 'length') units.length = unit;
    else if (field === 'compass' || field === 'bearing') units.compass = unit;
    else if (field === 'clino' || field === 'gradient') units.clino = unit;
  }

  // ─── Coordinate system ────────────────────────────────────────────────────────

  #parseCs(tokens) {
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

  #qualifyStn(name, surveyPath) {
    if (!name || name === '.' || name === '-') return name;
    if (name.includes('@') || !surveyPath) return name;
    return `${name}@${surveyPath}`;
  }

  /** Strip the @survey qualifier, returning only the local station name. */
  #stripStn(name) {
    if (!name || !name.includes('@')) return name;
    return name.split('@')[0];
  }

  /** Expand a potentially partial station reference to a fully-qualified name. */
  #resolveRef(ref, currentPath, allPaths) {
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

  #addAliases(eqTokens, currentPath, allPaths, aliases) {
    const resolved = eqTokens.map((t) => this.#stripStn(this.#resolveRef(t, currentPath, allPaths)));
    for (let i = 0; i + 1 < resolved.length; i++) {
      const a = new SurveyAlias(resolved[i], resolved[i + 1]);
      if (!aliases.some((e) => e.isEqual(a))) aliases.push(a);
    }
  }

  // ─── Cave assembly ────────────────────────────────────────────────────────────

  async #assembleCave(context, rootFilename) {
    // Merge multiple centreline blocks that share the same surveyPath into one
    const mergedMap = new Map();
    for (const s of context.surveys) {
      if (mergedMap.has(s.surveyPath)) {
        const m = mergedMap.get(s.surveyPath);
        m.shots.push(...s.shots);
        m.equates.push(...s.equates);
        m.fixes.push(...s.fixes);
        if (!m.cs && s.cs) m.cs = s.cs;
      } else {
        mergedMap.set(s.surveyPath, { ...s, shots: [...s.shots], equates: [...s.equates], fixes: [...s.fixes] });
      }
    }
    const surveys = [...mergedMap.values()];
    const { topLevelEquates } = context;
    const allPaths = surveys.map((s) => s.surveyPath);

    // Resolve all equates → SurveyAlias[]
    const aliases = [];
    for (const s of surveys) {
      for (const eqTokens of s.equates) {
        this.#addAliases(eqTokens, s.surveyPath, allPaths, aliases);
      }
    }
    for (const { tokens, surveyPath } of topLevelEquates) {
      this.#addAliases(tokens, surveyPath, allPaths, aliases);
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
        const utmR = cs.latFirst ? UTMConverter.fromLatLon(fix.x, fix.y) : UTMConverter.fromLatLon(fix.y, fix.x);
        coordinate = new UTMCoordinateWithElevation(
          U.roundToTwoDecimalPlaces(utmR.easting),
          U.roundToTwoDecimalPlaces(utmR.northing),
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
          showInfoPanel(i18n.t('errors.import.therionUnknownCs', { cs: withFix.cs.raw }), 5000);
        }
        try {
          const result = await this.coordinateSystemDialog.show(withFix.displayName, [x, y, z]);
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
            geoData = new GeoData(coordinateSys, [new StationWithCoordinate(withFix.fixes[0].station, coord)]);
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
      const survey = new Survey(s.displayName, true, meta, i === 0 ? s.startStation : undefined, s.shots);

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

    // Cave name: outermost survey title → first ordered survey name → filename stem
    const rootBase = rootFilename.replace(/\.th$/i, '').split(/[\\/]/).pop();
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

    return new Cave(caveName, caveMetadata, geoData, stations, surveyObjs, aliases);
  }
}

export { TherionImporter };
