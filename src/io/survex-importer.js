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
 * Survex (.svx) file format overview:
 *
 * Commands start with '*', comments start with ';'.
 * Surveys are hierarchical blocks: *begin <name> ... *end <name>
 * Shot data lives directly inside *begin/*end (no wrapper block like Therion's centreline).
 *
 * Key commands:
 *   *data normal from to tape compass clino  — define column order
 *   *data normal station newline tape compass clino  — interleaved (station on own line)
 *   *units tape meters / *units compass degrees / *units clino degrees
 *   *flags splay / *flags not splay  — toggle splay mode
 *   *alias station - ..             — map '-' to anonymous wall point (splay marker)
 *   *calibrate compass <offset> / *calibrate clino <offset>
 *   *fix <station> <x> <y> <z>     — fix station coordinates
 *   *cs <system>                   — coordinate system (e.g. UTM33N, EPSG:32633)
 *   *equate <stn1> <stn2>          — declare station equivalence across surveys
 *   *include <filename>            — load another .svx file
 *   *declination <value> <unit>
 *   *date YYYY.MM.DD
 *   *team "Name" [role]
 *
 * Splay shots: 'to' station is '-' (when *alias station - .. is active),
 *              or '.' / '..' (anonymous station conventions), or *flags splay is set.
 *
 * Station names are hierarchical: outer.inner.stationId when nested *begin blocks are used.
 * *equate links stations across surveys to form a connected network.
 */

import { Importer } from './importer-base.js';
import { SurveyMetadata, SurveyTeam } from '../model/survey.js';
import { showInfoPanel } from '../ui/popups.js';
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
  assembleCave,
  parseTeam,
} from './cave-survey-helpers.js';

const SURVEX_OPTS = {
  commentChar    : ';',
  stripStarPrefix: true,
  includeKeyword : 'include',
  countPattern   : /^\s*\*include\b/gim,
  skipExtensions : [],
};

class SurvexImporter extends Importer {

  constructor(db, options, scene, manager) {
    super(db, options, scene, manager);
    this.coordinateSystemDialog = new CoordinateSystemDialog();
  }

  // ─── Public API ──────────────────────────────────────────────────────────────

  /** Batch entry point: filesMap is Map<filename, File>. All .svx files passed together. */
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
    return await this.#parseSurvex(rootName, textMap);
  }

  // ─── Root file detection / tokenizer / include expansion ─────────────────────

  #findRootFile(textMap)                               { return findRootFile(textMap, SURVEX_OPTS); }
  #flattenFile(filename, textMap, visited, unresolved) { return flattenFile(filename, textMap, visited, unresolved, SURVEX_OPTS); }

  // ─── Main parser ──────────────────────────────────────────────────────────────

  async #parseSurvex(rootFilename, textMap) {
    const unresolvedIncludes = [];
    const lines = this.#flattenFile(rootFilename, textMap, new Set(), unresolvedIncludes);

    const context = {
      surveyStack     : [],   // stack of active *begin blocks
      surveys         : [],   // completed survey objects
      topLevelEquates : [],   // equates outside any *begin block (rare)
      globalCs        : null,
      caveTitle       : null
    };

    this.#parseBlocks(lines, context);

    if (context.surveys.length === 0) {
      if (unresolvedIncludes.length > 0) {
        throw new Error(i18n.t('errors.import.survexUnresolvedIncludes'));
      }
      throw new Error(i18n.t('errors.import.survexNoData'));
    }

    if (unresolvedIncludes.length > 0) {
      showInfoPanel(
        i18n.t('errors.import.survexUnresolvedInputs', {
          files : unresolvedIncludes.join(', ')
        }),
        6000
      );
    }

    return await assembleCave(
      context,
      rootFilename,
      this.coordinateSystemDialog,
      'errors.import.survexUnknownCs'
    );
  }

  // ─── Block parser ─────────────────────────────────────────────────────────────

  /*
   * In Survex, shot data and commands live directly inside *begin/*end blocks
   * (unlike Therion which wraps shots in a separate centreline/endcentreline block).
   * A stack of survey accumulators tracks the active nesting level. Each *begin
   * pushes a fresh state that inherits units/calibration/cs/fmt from the parent.
   * Each *end pops and finalises the accumulator into context.surveys.
   */
  #parseBlocks(lines, context) {

    // Build a fresh state for a new *begin block, inheriting from parent state.
    const makeState = (parent) => ({
      date          : parent?.date ?? null,
      teamName      : parent?.teamName ?? null,
      members       : [],
      declination          : parent?.declination ?? 0,
      cartesianNorth       : parent?.cartesianNorth ?? 'true',
      cartesianExtraRot    : parent?.cartesianExtraRot ?? 0,
      units         : parent ? { ...parent.units } : { length: 'meters', compass: 'degrees', clino: 'degrees' },
      calibration   : parent ? { ...parent.calibration } : { length: 0, lengthScale: 1, compass: 0, compassScale: 1, clino: 0, clinoScale: 1 },
      stationPrefix : parent?.stationPrefix ?? '',
      stationSuffix : parent?.stationSuffix ?? '',
      cs            : parent?.cs ?? context.globalCs,
      fixes         : [],
      equates       : [],
      fmt           : parent ? parent.fmt : null,   // inherit active data format
      isSplay       : parent?.isSplay ?? false,
      stationComments   : [],
      stationDimensions : []
    });

    // Each stack entry: {name, surveyPath, state, shots, shotId, stationPairs, pendingLine1, pendingState}
    const stack = [];

    const IGNORE_KWS = new Set([
      'cs',       // catches malformed *cs with no argument (valid *cs handled above)
      'entrance', 'title', 'copyright', 'ref', 'sd', 'instrument',
      'solve', 'case', 'require', 'truncate', 'infer',
      'export', 'passage', 'endpassage', 'walls', 'endwalls', 'nosurvey',
    ]);

    for (const tokens of lines) {
      if (!tokens?.length) continue;
      const kw = tokens[0].toLowerCase();

      // ── *begin / *end ──────────────────────────────────────────────────────
      if (kw === 'begin') {
        const name = tokens[1] ?? 'unnamed';
        const parentEntry = stack.at(-1);
        const parentPath = parentEntry?.surveyPath ?? '';
        const surveyPath = parentPath ? `${parentPath}.${name}` : name;
        const parentState = parentEntry?.state ?? null;

        if (!context.caveTitle) context.caveTitle = name;

        stack.push({
          name,
          surveyPath,
          state         : makeState(parentState),
          shots         : [],
          shotId        : 0,
          stationPairs  : [],
          pendingLine1  : null,
          pendingState  : null
        });
        continue;
      }

      if (kw === 'end') {
        const top = stack.pop();
        if (!top) continue;

        // Flush any buffered interleaved-format pairs
        if (top.stationPairs.length > 0) {
          flushStationPairs(top.stationPairs, top.shots, top.shotId, top.surveyPath);
        }

        if (top.shots.length > 0 || top.state.fixes.length > 0 || top.state.stationDimensions.length > 0) {
          const metadata = new SurveyMetadata(
            top.state.date ?? new Date(),
            top.state.declination,
            null,
            new SurveyTeam(top.state.teamName ?? '', top.state.members),
            []
          );
          context.surveys.push({
            displayName       : top.name,
            surveyPath        : top.surveyPath,
            shots             : top.shots,
            metadata,
            units             : { ...top.state.units },
            equates           : top.state.equates,
            cs                : top.state.cs,
            fixes             : top.state.fixes,
            startStation      : top.shots[0]?.from,
            stationComments   : top.state.stationComments,
            stationDimensions : top.state.stationDimensions
          });
        }
        continue;
      }

      // Commands outside any *begin block (unusual but possible for *equate/*cs at top level)
      const top = stack.at(-1);

      if (kw === 'equate' && tokens.length >= 3) {
        if (top) {
          top.state.equates.push(tokens.slice(1));
        } else {
          context.topLevelEquates.push({
            tokens     : tokens.slice(1),
            surveyPath : ''
          });
        }
        continue;
      }

      if (kw === 'cs' && tokens.length >= 2) {
        // *cs out ... is an output CS directive — ignore; only *cs sets the input CS
        if (tokens[1]?.toLowerCase() !== 'out') {
          const cs = parseCs(tokens.slice(1));
          if (top) top.state.cs = cs;
          else context.globalCs = cs;
        }
        continue;
      }

      if (!top) continue; // remaining commands require an active *begin block

      const state = top.state;

      // ── *data ──────────────────────────────────────────────────────────────
      if (kw === 'data') {
        // Flush buffered interleaved pairs before switching format
        if (top.stationPairs.length > 0) {
          flushStationPairs(top.stationPairs, top.shots, top.shotId, top.surveyPath);
          top.shotId = top.shots.length;
          top.stationPairs.length = 0;
          top.pendingLine1 = null;
        }
        state.fmt = parseDataFormat(tokens);
        continue;
      }

      // ── *units ─────────────────────────────────────────────────────────────
      if (kw === 'units') {
        applyUnits(tokens, state.units);
        continue;
      }

      // ── *calibrate ─────────────────────────────────────────────────────────
      // *calibrate declination is the pre-2.0 Survex way to set magnetic declination.
      // Declination is always stored in degrees (regardless of survey angle unit), so we
      // convert here explicitly rather than going through parseCompass (which preserves
      // the source unit for natively-supported angle units like grads).
      if (kw === 'calibrate') {
        applyCalibration(tokens, state, {
          declination : (raw, unit, s) => {
            const num = parseMyFloat(raw);
            if (!isNaN(num)) s.declination = angleToDegrees(num, unit ?? 'degrees');
          }
        });
        continue;
      }

      // ── *flags ─────────────────────────────────────────────────────────────
      if (kw === 'flags') {
        const sub = tokens[1]?.toLowerCase();
        if (sub === 'splay') state.isSplay = true;
        else if (sub === 'not' && tokens[2]?.toLowerCase() === 'splay') state.isSplay = false;
        continue;
      }

      // ── *alias station - .. ────────────────────────────────────────────────
      // Declares that shots to '-' are splays. parseShotRow already treats '-' as a
      // splay destination, so no further action is needed here.
      if (kw === 'alias') continue;

      // ── *fix ───────────────────────────────────────────────────────────────
      if (kw === 'fix' && tokens.length >= 5) {
        const stn = stripStn(qualifyStn(applyStnNames(tokens[1], state), top.surveyPath));
        const x = parseMyFloat(tokens[2]);
        const y = parseMyFloat(tokens[3]);
        const z = parseMyFloat(tokens[4]);
        if (!isNaN(x) && !isNaN(y) && !isNaN(z)) state.fixes.push({ station: stn, x, y, z });
        continue;
      }

      // ── *date ──────────────────────────────────────────────────────────────
      if (kw === 'date' && tokens.length >= 2) {
        state.date = parseDate(tokens[1]);
        continue;
      }

      // ── *team ──────────────────────────────────────────────────────────────
      if (kw === 'team') { parseTeam(tokens, state); continue; }

      // ── *cartesian ──────────────────────────────────────────────────────────
      // Specifies which North cartesian data is aligned to, with optional rotation.
      if (kw === 'cartesian' && tokens.length >= 2) {
        const northType = tokens[1].toLowerCase();
        if (northType === 'true' || northType === 'grid' || northType === 'magnetic') {
          state.cartesianNorth = northType;
          if (tokens[2] !== undefined) {
            const rotVal = parseMyFloat(tokens[2]);
            if (!isNaN(rotVal)) {
              const unit = tokens[3]?.toLowerCase() ?? 'degrees';
              state.cartesianExtraRot = angleToDegrees(rotVal, unit);
            }
          } else {
            state.cartesianExtraRot = 0;
          }
        }
        continue;
      }

      // ── *declination ────────────────────────────────────────────────────────
      if (kw === 'declination' && tokens.length >= 2) {
        if (tokens[1]?.toLowerCase() !== 'auto') {
          const val = parseMyFloat(tokens[1]);
          if (!isNaN(val)) {
            const unit = tokens[2]?.toLowerCase();
            state.declination = angleToDegrees(val, unit);
          }
        }
        continue;
      }

      if (IGNORE_KWS.has(kw)) continue;

      // ── data rows ──────────────────────────────────────────────────────────
      // A line is a data row when a format has been declared and the first token
      // is not a command (commands were already stripped of their '*' and matched above).
      if (!state.fmt) continue;

      if (state.fmt.type === 'passage') {
        parsePassageRow(tokens, state, top.surveyPath);
        continue;
      }

      if (state.fmt.hasNewline) {
        // Interleaved format: station name on one line, measurements on the next
        if (!top.pendingLine1) {
          top.pendingLine1 = tokens;
          top.pendingState = {
            fmt           : state.fmt,
            units         : { ...state.units },
            calibration   : { ...state.calibration },
            isSplay       : state.isSplay,
            stationPrefix : state.stationPrefix,
            stationSuffix : state.stationSuffix
          };
        } else {
          top.stationPairs.push({
            line1 : top.pendingLine1,
            line2 : tokens,
            state : top.pendingState
          });
          top.pendingLine1 = null;
        }
      } else {
        const shot = parseShotRow(tokens, state, top.surveyPath, top.shotId);
        if (shot) {
          top.shots.push(shot);
          top.shotId++;
        }
      }
    }
  }
}

export { SurvexImporter };
