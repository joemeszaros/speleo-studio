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
import { SurveyMetadata, SurveyTeam } from '../model/survey.js';
import { showInfoPanel, showWarningPanel } from '../ui/popups.js';
import { parseMyFloat, angleToDegrees } from '../utils/utils.js';
import { CoordinateSystemDialog } from '../ui/coordinate-system-dialog.js';
import { i18n } from '../i18n/i18n.js';
import {
  detectEncoding,
  readFileAsText,
  tokenizeLine,
  findRootFile,
  flattenFile,
  parseDataFormat,
  parseShotRow,
  parsePassageRow,
  flushStationPairs,
  parseDate,
  applyUnits,
  applyCalibration,
  parseCs,
  applyStnNames,
  qualifyStn,
  stripStn,
  addAliases,
  assembleCave,
  parseTeam,
} from './cave-survey-helpers.js';

const THERION_OPTS = {
  commentChar    : '#',
  stripStarPrefix: false,
  includeKeyword : 'input',
  countPattern   : /^\s*input\b/gim,
  skipExtensions : ['.th2', '.thm'],
};

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
      const encoding = await detectEncoding(file);
      textMap.set(name, await readFileAsText(file, encoding));
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

  // ─── Root file detection / tokenizer / include expansion ─────────────────────

  #findRootFile(textMap)                               { return findRootFile(textMap, THERION_OPTS); }
  #flattenFile(filename, textMap, visited, unresolved) { return flattenFile(filename, textMap, visited, unresolved, THERION_OPTS); }

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
      showInfoPanel(
        i18n.t('errors.import.therionUnresolvedInputs', { files: unresolvedInputs.join(', ') }),
        6000
      );
    }

    return await assembleCave(
      context,
      rootFilename,
      this.coordinateSystemDialog,
      'errors.import.therionUnknownCs'
    );
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
          if (tokens.length >= 2) context.globalCs = parseCs(tokens.slice(1));
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
      calibration    : { length: 0, lengthScale: 1, compass: 0, compassScale: 1, clino: 0, clinoScale: 1 },
      stationPrefix  : '',
      stationSuffix  : '',
      cs          : context.globalCs,
      fixes       : [],
      equates     : [],
      fmt               : null,
      isSplay           : false,
      stationComments   : [],
      stationDimensions : []
    };

    const shots = [];
    let shotId = 0;
    const stationPairs = [];
    let pendingLine1 = null;
    let pendingState = null;

    const IGNORE_KWS = new Set([
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
          flushStationPairs(stationPairs, shots, shotId, surveyPath);
          shotId = shots.length;
          stationPairs.length = 0;
          pendingLine1 = null;
        }
        state.fmt = parseDataFormat(tokens);
        continue;
      }

      if (kw === 'cs' && tokens.length >= 2) {
        state.cs = parseCs(tokens.slice(1));
        continue;
      }

      if (kw === 'fix' && tokens.length >= 5) {
        const stn = stripStn(qualifyStn(applyStnNames(tokens[1], state), surveyPath));
        const x = parseMyFloat(tokens[2]);
        const y = parseMyFloat(tokens[3]);
        const z = parseMyFloat(tokens[4]);
        if (!isNaN(x) && !isNaN(y) && !isNaN(z)) state.fixes.push({ station: stn, x, y, z });
        continue;
      }

      if (kw === 'date' && tokens.length >= 2) {
        state.date = parseDate(tokens[1]);
        continue;
      }

      if (kw === 'team') { parseTeam(tokens, state); continue; }

      if (kw === 'declination') {
        if (shots.length > 0) {
          showWarningPanel(
            i18n.t('errors.import.therionDeclinationAfterShots', { survey: displayName }),
            8000
          );
          return null;
        }
        if (tokens[1]?.toLowerCase() === 'auto') {
          state.declination = 0; // cannot replicate Therion's auto calculation
        } else {
          const val = parseMyFloat(tokens[1]);
          if (!isNaN(val)) {
            const unit = tokens[2]?.toLowerCase();
            state.declination = angleToDegrees(val, unit);
          }
        }
        continue;
      }

      if (kw === 'units') {
        applyUnits(tokens, state.units);
        continue;
      }

      if (kw === 'calibrate') { applyCalibration(tokens, state); continue; }

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

      if (kw === 'station-names' && tokens.length >= 3) {
        state.stationPrefix = tokens[1] === '-' ? '' : tokens[1];
        state.stationSuffix = tokens[2] === '-' ? '' : tokens[2];
        continue;
      }

      if (kw === 'station' && tokens.length >= 3) {
        const stnName = stripStn(qualifyStn(applyStnNames(tokens[1], state), surveyPath));
        const comment = tokens[2];
        state.stationComments.push({ station: stnName, comment });
        continue;
      }

      if (IGNORE_KWS.has(kw)) continue;

      // ── data rows ──
      if (!state.fmt) continue;

      // `data dimensions station left right up down` — per-station LRUD (Therion equivalent of Survex *data passage)
      if (state.fmt.type === 'dimensions') {
        parsePassageRow(tokens, state, surveyPath);
        continue;
      }

      if (state.fmt.hasNewline) {
        if (!pendingLine1) {
          pendingLine1 = tokens;
          pendingState = {
            fmt           : state.fmt,
            units         : { ...state.units },
            calibration   : { ...state.calibration },
            isSplay       : state.isSplay,
            stationPrefix : state.stationPrefix,
            stationSuffix : state.stationSuffix
          };
        } else {
          stationPairs.push({ line1: pendingLine1, line2: tokens, state: pendingState });
          pendingLine1 = null;
        }
      } else {
        const shot = parseShotRow(tokens, state, surveyPath, shotId);
        if (shot) {
          shots.push(shot);
          shotId++;
        }
      }
    }

    // Flush remaining station pairs
    if (stationPairs.length > 0) {
      flushStationPairs(stationPairs, shots, shotId, surveyPath);
    }

    if (shots.length === 0 && state.fixes.length === 0 && state.stationDimensions.length === 0) return null;

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
      units             : { ...state.units },
      equates           : state.equates,
      cs                : state.cs,
      fixes             : state.fixes,
      startStation      : shots[0]?.from,
      stationComments   : state.stationComments,
      stationDimensions : state.stationDimensions
    };
  }
}

export { TherionImporter };
