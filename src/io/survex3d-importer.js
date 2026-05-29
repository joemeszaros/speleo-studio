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
 * Survex .3d binary file importer.
 *
 * Format spec: https://survex.com/docs/3dformat.htm
 *
 * .3d files contain the pre-solved output of Survex: stations already have absolute
 * 3D coordinates, and legs reference station pairs. Because the geometry is already
 * solved (and a single .3d can hold many physically-disconnected components — e.g.
 * system_migovec.3d is 23), we do NOT reconstruct positions by chain-traversing shots
 * from a start point. Instead the imported cave is marked **read-only** and its station
 * positions are built directly from the absolute coordinates and persisted as-is. Legs
 * are still turned into Shots (with polar length/azimuth/clino back-calculated from the
 * coordinate displacement) so the survey tree and read-only sheets work and the
 * centerline topology is preserved.
 *
 * Supported versions: v3, v4, v5, v6, v7, v8. (Bv0.01 is rejected — predates 2002.)
 *
 * Cross-survey equates (`*equate a b` in the source) collapse two station names onto
 * the same coordinate in the .3d. We handle this by using one canonical name per
 * coordinate and creating SurveyAlias entries for the others.
 *
 * XSECT records (`*data passage` in the source) are imported into cave.stationDimensions.
 */

import { Importer } from './importer-base.js';
import { CoordinateSystemDialog } from '../ui/coordinate-system-dialog.js';
import { showInfoPanel } from '../ui/popups.js';
import { i18n } from '../i18n/i18n.js';
import {
  Shot,
  ShotType,
  Survey,
  SurveyMetadata,
  SurveyTeam,
  SurveyAlias,
  SurveyStation,
  StationDimension
} from '../model/survey.js';
import { Cave, CaveMetadata } from '../model/cave.js';
import { Vector } from '../model.js';
import {
  UTMCoordinateWithElevation,
  UTMCoordinateSystem,
  EOVCoordinateWithElevation,
  EOVCoordinateSystem,
  GeoData,
  StationCoordinates,
  StationWithCoordinate,
  WGS84Coordinate
} from '../model/geo.js';
import { globalNormalizer } from '../utils/global-coordinate-normalizer.js';
import { WGS84Converter } from '../utils/geo.js';
import { toPolar, radsToDegrees } from '../utils/utils.js';

class Survex3dImporter extends Importer {

  constructor(db, options, scene, manager) {
    super(db, options, scene, manager);
    this.coordinateSystemDialog = new CoordinateSystemDialog();
  }

  // Single-file entry point. The base class reads the file as ArrayBuffer and calls importData.
  async importFile(file, name, onCaveLoad) {
    await super.importFileAsArrayBuffer(file, name, onCaveLoad);
  }

  async importData(arrayBuffer, onCaveLoad, name) {
    const cave = await this.#parseAndAssemble(arrayBuffer, name ?? 'cave.3d');
    if (cave) await onCaveLoad(cave);
  }

  // Public for testing.
  async getCave(arrayBuffer, filename) {
    return await this.#parseAndAssemble(arrayBuffer, filename);
  }

  async #parseAndAssemble(arrayBuffer, filename) {
    const parsed = parse3d(arrayBuffer);
    return await this.#assembleCave(parsed, filename);
  }

  async #assembleCave(parsed, filename) {
    const { title, crs, positions, labels, legs, xsects } = parsed;

    // Pick a canonical name per coordinate key. Several station labels can share the
    // same coordinate (cross-survey *equate); collect them so we can create aliases.
    //
    // .3d files carry full hierarchical names like
    // "system_migovec.primadona_ubend_mona_tip.ubend.ubend.6". Showing those verbatim
    // in the UI is unusable, so we shorten each name to its shortest dotted suffix
    // that's still globally unique. The common case is a bare station id ("6") when
    // the suffix collides with another station, we fall back to one or more parent
    // segments ("mona_tip1.6"). This matches the surveyor convention of referring to
    // stations by their leaf survey + id.
    const rawCanonicalForKey = new Map();
    const rawAliasGroups = new Map();
    for (const [key, allNames] of labels) {
      rawCanonicalForKey.set(key, allNames[0]);
      if (allNames.length > 1) rawAliasGroups.set(allNames[0], allNames.slice(1));
    }

    const shortenMap = shortestUniqueSuffixes([...rawCanonicalForKey.values()]);
    const shorten = (name) => shortenMap.get(name) ?? name;

    const nameForKey = new Map();
    for (const [key, raw] of rawCanonicalForKey) nameForKey.set(key, shorten(raw));

    // Any coord referenced by a leg but lacking a label gets an auto name.
    let autoIdx = 0;
    const ensureName = (key) => {
      if (!nameForKey.has(key)) nameForKey.set(key, `_${autoIdx++}`);
      return nameForKey.get(key);
    };

    // Build SurveyAlias entries from equate groups (both sides shortened). Equated
    // stations share a coordinate key, so they already collapse to one canonical name
    // in the centerline; the aliases are kept for round-trip fidelity.
    const aliases = [];
    for (const [canonicalRaw, others] of rawAliasGroups) {
      const canonical = shorten(canonicalRaw);
      for (const other of others) aliases.push(new SurveyAlias(canonical, shorten(other)));
    }

    // Group legs by their survey path (captured from the LINE-context label during
    // parsing). Surface/duplicate legs are dropped — not part of the centerline.
    // Insertion order is preserved (roughly parents-before-children in Survex output).
    const legsByPath = new Map();
    for (const leg of legs) {
      if (leg.type === 'surface' || leg.type === 'dup') continue;
      const p = leg.surveyPath || '';
      if (!legsByPath.has(p)) legsByPath.set(p, []);
      legsByPath.get(p).push(leg);
    }

    if (legsByPath.size === 0) {
      throw new Error(i18n.t('errors.import.survex3dNoData'));
    }

    // GeoData: derive a fix point from the first labeled station if we recognize the CRS.
    //
    // Note: .3d azimuths are back-calculated from projected (grid) coordinate
    // differences, so they're already **grid** bearings — there's no magnetic
    // declination to remove and no meridian convergence to apply. We deliberately
    // leave convergence at null on the SurveyMetadata.
    const csInfo = parseCrs(crs);
    let geoData = null;
    let coordinateSys = null;
    let startCoord = null;
    let anchorKey = null;
    let anchorName = null;

    if (csInfo && nameForKey.size > 0) {
      [anchorKey, anchorName] = [...nameForKey.entries()][0];
      const p = positions.get(anchorKey);
      if (p) {
        if (csInfo.type === 'utm') {
          startCoord = new UTMCoordinateWithElevation(p.x, p.y, p.z);
          coordinateSys = new UTMCoordinateSystem(csInfo.zone, csInfo.northern);
        } else if (csInfo.type === 'eov') {
          startCoord = new EOVCoordinateWithElevation(p.x, p.y, p.z);
          coordinateSys = new EOVCoordinateSystem();
        }
        if (startCoord && coordinateSys) {
          if (!globalNormalizer.isInitialized()) {
            globalNormalizer.initializeGlobalOrigin(startCoord);
          }
          geoData = new GeoData(coordinateSys, [new StationWithCoordinate(anchorName, startCoord)]);
        }
      }
    } else if (crs) {
      // Unknown CRS but coordinates probably are projected — flag it.
      showInfoPanel(i18n.t('errors.import.survex3dUnknownCs', { cs: crs }), 5000);
    }

    // Local-coordinate origin: the anchor's .3d position when CRS is recognized,
    // otherwise the first leg's start. Station `local` coordinates are measured from
    // here, and (without a CRS) so is the rendered position — keeping the numbers
    // small for Float32 precision.
    let origin3d = anchorKey ? positions.get(anchorKey) : null;
    if (!origin3d) {
      const firstLeg = legsByPath.values().next().value?.[0];
      if (firstLeg) origin3d = positions.get(firstLeg.fromKey);
    }
    if (!origin3d) origin3d = { x: 0, y: 0, z: 0 };

    const buildProjected = (p) =>
      csInfo?.type === 'utm'
        ? new UTMCoordinateWithElevation(p.x, p.y, p.z)
        : new EOVCoordinateWithElevation(p.x, p.y, p.z);

    // Build a SurveyStation directly from a coordinate's absolute .3d position — no
    // chaining, the .3d already solved every station. When the CRS is recognized we
    // also attach the projected (UTM/EOV) coordinate and its WGS84 conversion, and
    // render at the globally-normalized position so multiple caves stay aligned.
    const makeStation = (type, key, survey) => {
      const p = positions.get(key);
      const local = new Vector(p.x - origin3d.x, p.y - origin3d.y, p.z - origin3d.z);
      let projected, wgs, position;
      if (coordinateSys) {
        projected = buildProjected(p);
        const { latitude, longitude } = WGS84Converter.toLatLon(projected, coordinateSys);
        wgs = new WGS84Coordinate(latitude, longitude);
        position = projected.toNormalizedVector();
      } else {
        position = local;
      }
      return new SurveyStation(type, position, new StationCoordinates(local, projected, wgs), survey, []);
    };

    // Build one Survey per surveyPath. Each leg becomes a Shot (polar back-calculated
    // from the coordinate displacement, kept for the survey tree / read-only sheets /
    // centerline topology) and contributes its endpoint stations, built directly.
    const stations = new Map();
    const surveys = [];
    let shotIdCounter = 0;

    for (const [path, pathLegs] of legsByPath) {
      const surveyName = sanitizeName(path === '' ? title || 'survey' : path.split('.').pop()) || 'survey';
      // Matches Survey.getSplayStationName(id) so getSegments resolves splay endpoints.
      const splayStationName = (id) => `splay-${id}@${surveyName}`;

      const shots = [];
      const stationSpecs = []; // { name, type, key } — created after the survey object exists

      for (const leg of pathLegs) {
        const from = positions.get(leg.fromKey);
        const to = positions.get(leg.toKey);
        if (!from || !to) continue;
        const polar = toPolar(new Vector(to.x - from.x, to.y - from.y, to.z - from.z));
        if (polar.distance < 1e-6) continue;

        const isSplay = leg.type === 'splay';
        const id = shotIdCounter++;
        const fromName = ensureName(leg.fromKey);
        const toName = isSplay ? undefined : ensureName(leg.toKey);

        shots.push(
          new Shot(
            id,
            isSplay ? ShotType.SPLAY : ShotType.CENTER,
            fromName,
            toName,
            polar.distance,
            radsToDegrees(polar.azimuth),
            radsToDegrees(polar.clino),
            undefined
          )
        );

        stationSpecs.push({ name: fromName, type: ShotType.CENTER, key: leg.fromKey });
        if (isSplay) {
          stationSpecs.push({ name: splayStationName(id), type: ShotType.SPLAY, key: leg.toKey });
        } else {
          stationSpecs.push({ name: toName, type: ShotType.CENTER, key: leg.toKey });
        }
      }

      if (shots.length === 0) continue;

      const meta = new SurveyMetadata(new Date(), 0, null, new SurveyTeam('', []), []);
      const survey = new Survey(surveyName, true, meta, shots[0].from, shots);
      surveys.push(survey);

      // First survey to reference a coordinate owns the station (later equated/shared
      // references reuse it). station.survey points at that owning survey.
      for (const spec of stationSpecs) {
        if (!stations.has(spec.name)) {
          stations.set(spec.name, makeStation(spec.type, spec.key, survey));
        }
      }
    }

    const caveName =
      sanitizeName(title) ||
      filename
        .replace(/\.[^.]+$/, '')
        .split(/[\\/]/)
        .pop();
    const caveMeta = new CaveMetadata(undefined, undefined, undefined, undefined, new Date(), '');

    // XSECTS → station dimensions. The XSECT label is the full station name from the
    // .3d file; shorten it the same way station names were shortened so it lines up
    // with what's in `stations`. Drop entries that don't resolve to a known station.
    const dims = [];
    const seen = new Set();
    for (const x of xsects) {
      if (!x.label) continue;
      const name = shorten(x.label);
      if (seen.has(name)) continue;
      const exists = stations.has(name) || aliases.some((a) => a.contains(name));
      if (!exists) continue;
      seen.add(name);
      const safe = (v) => (typeof v === 'number' && v > 0 ? v : undefined);
      const d = new StationDimension(name, safe(x.l), safe(x.r), safe(x.u), safe(x.d));
      if (d.left || d.right || d.up || d.down) dims.push(d);
    }

    // visible = true, readOnly = true: .3d caves are visualization-only.
    return new Cave(caveName, caveMeta, geoData, stations, surveys, aliases, undefined, [], dims, true, true);
  }
}

// ─── Pure parser ────────────────────────────────────────────────────────────────

// Reads a binary .3d buffer and returns the raw collected data.
// Throws on unsupported versions or corrupt headers.
function parse3d(arrayBuffer) {
  const data = new Uint8Array(arrayBuffer);
  const view = new DataView(arrayBuffer);
  const decoder = new TextDecoder('utf-8');

  // Helpers operating on a shared cursor.
  let pos = 0;

  const readLine = () => {
    const start = pos;
    while (pos < data.length && data[pos] !== 0x0a) pos++;
    const s = decoder.decode(data.subarray(start, pos));
    pos++; // skip LF
    return s;
  };

  // Read until LF, splitting by null bytes (used for the title+CRS line in v3+).
  const readLineNullSplit = () => {
    const parts = [];
    const start = pos;
    let segStart = start;
    while (pos < data.length && data[pos] !== 0x0a) {
      if (data[pos] === 0) {
        parts.push(decoder.decode(data.subarray(segStart, pos)));
        segStart = pos + 1;
      }
      pos++;
    }
    parts.push(decoder.decode(data.subarray(segStart, pos)));
    pos++; // skip LF
    return parts;
  };

  // ── Header ──────────────────────────────────────────────────────────────────
  const magic = readLine();
  if (magic !== 'Survex 3D Image File') {
    throw new Error(i18n.t('errors.import.survex3dBadMagic'));
  }
  const version = readLine();
  const supportedV = ['v3', 'v4', 'v5', 'v6', 'v7', 'v8'];
  if (!supportedV.includes(version)) {
    throw new Error(i18n.t('errors.import.survex3dUnsupportedVersion', { version }));
  }
  const versionNum = parseInt(version.slice(1), 10);

  const auxParts = readLineNullSplit();
  const title = (auxParts[0] ?? '').trim();
  const crs = auxParts[1] ? auxParts[1].trim() : null;
  readLine(); // timestamp — ignored

  // v8: file-wide flags byte after the header.
  if (versionNum === 8) pos++;

  // ── State for the body parser ──────────────────────────────────────────────
  const positions = new Map(); // coordKey → {x, y, z}
  const labels = new Map(); // coordKey → [station names]
  const legs = []; // {fromKey, toKey, type, surveyPath}
  const xsects = []; // {label, l, r, u, d}

  let label = ''; // current accumulated label
  let legSurveyPath = ''; // last LINE-context label, used as the leg's survey path
  let lastKey = null; // coordKey from the previous MOVE/LINE/LABEL
  let move = false; // last op was a MOVE? (means next LINE needs to record the MOVE coords)

  const readCoords = () => {
    const x = view.getInt32(pos, true) / 100;
    const y = view.getInt32(pos + 4, true) / 100;
    const z = view.getInt32(pos + 8, true) / 100;
    // 12-byte raw key for dedup: same bytes ↔ same physical station.
    const key = bytesToKey(data, pos, 12);
    pos += 12;
    if (!positions.has(key)) positions.set(key, { x, y, z });
    return key;
  };

  const readLabelV7 = () => {
    // First byte: length, or 0xfe (uint16+0xfe), or 0xff (uint32).
    let len;
    const b = data[pos];
    if (b === 0xfe) {
      len = view.getUint16(pos + 1, true) + 0xfe;
      pos += 3;
    } else if (b === 0xff) {
      len = view.getUint32(pos + 1, true);
      pos += 5;
    } else {
      len = b;
      pos++;
    }
    if (len === 0) return;
    label += decoder.decode(data.subarray(pos, pos + len));
    pos += len;
  };

  const readLabelV8 = (flags) => {
    if (flags & 0x20) return; // 0x20 on LINE/LABEL = no label change
    let b = data[pos++];
    let del = 0,
      add = 0;
    if (b !== 0) {
      del = b >> 4;
      add = b & 0x0f;
    } else {
      // extended encoding
      b = data[pos++];
      if (b !== 0xff) {
        del = b;
      } else {
        del = view.getUint32(pos, true);
        pos += 4;
      }
      b = data[pos++];
      if (b !== 0xff) {
        add = b;
      } else {
        add = view.getUint32(pos, true);
        pos += 4;
      }
    }
    if (del === 0 && add === 0) return;
    if (del) label = label.slice(0, -del);
    if (add) {
      label += decoder.decode(data.subarray(pos, pos + add));
      pos += add;
    }
  };

  // v3-v7 trim commands modify the label string. v8 doesn't use these.
  const trimPlus = (c) => {
    // 0x01-0x0e: drop 16 chars and pop c label components.
    label = label.slice(0, -16);
    if (label.endsWith('.')) label = label.slice(0, -1);
    const parts = label.split('.');
    parts.splice(-c);
    label = parts.join('.');
    if (label) label += '.';
  };

  const trim = (c) => {
    // 0x10-0x1f: drop (c - 15) chars from the end.
    label = label.slice(0, -(c - 15));
  };

  const readLabel = versionNum === 8 ? readLabelV8 : readLabelV7;

  // ── Body loop ──────────────────────────────────────────────────────────────
  while (pos < data.length) {
    const cmd = data[pos++];

    // STOP — reset label (v3-v7 only; in v8 0x00 is a STYLE).
    if (cmd === 0x00) {
      if (versionNum === 8) continue; // STYLE_NORMAL
      label = '';
      continue;
    }

    // v8 STYLE_* — no payload.
    if (versionNum === 8 && cmd >= 0x01 && cmd <= 0x04) continue;

    // v3-v7 TRIM_PLUS (0x01-0x0e): drop 16 chars then pop c components.
    if (versionNum < 8 && cmd >= 0x01 && cmd <= 0x0e) {
      trimPlus(cmd);
      continue;
    }

    // MOVE — read 12 bytes coords; next LINE will record a leg from here.
    if (cmd === 0x0f) {
      lastKey = readCoords();
      move = true;
      continue;
    }

    // v3-v7 TRIM (0x10-0x1f).
    if (versionNum < 8 && cmd >= 0x10 && cmd <= 0x1f) {
      trim(cmd);
      continue;
    }

    // DATE / ERROR records — known fixed-size, skip the payload.
    if (versionNum === 8) {
      if (cmd === 0x10) continue; // no date
      if (cmd === 0x11) {
        pos += 2;
        continue;
      }
      if (cmd === 0x12) {
        pos += 3;
        continue;
      }
      if (cmd === 0x13) {
        pos += 4;
        continue;
      }
      if (cmd === 0x1f) {
        pos += 20;
        continue;
      } // ERROR
    } else {
      if (cmd === 0x20) {
        pos += versionNum >= 4 && versionNum <= 6 ? 4 : 2;
        continue;
      }
      if (cmd === 0x21) {
        pos += versionNum >= 4 && versionNum <= 6 ? 8 : 3;
        continue;
      }
      if (cmd === 0x22) {
        pos += 20;
        continue;
      }
      if (cmd === 0x23) {
        pos += 4;
        continue;
      }
      if (cmd === 0x24) continue; // no date
    }

    // XSECT (0x30-0x33): 0x30/0x31 = int16 LRUD (8 bytes), 0x32/0x33 = int32 LRUD (16 bytes).
    if (cmd === 0x30 || cmd === 0x31) {
      readLabel(cmd & 0x01);
      const l = view.getInt16(pos, true) / 100;
      const r = view.getInt16(pos + 2, true) / 100;
      const u = view.getInt16(pos + 4, true) / 100;
      const d = view.getInt16(pos + 6, true) / 100;
      pos += 8;
      xsects.push({ label, l, r, u, d });
      continue;
    }
    if (cmd === 0x32 || cmd === 0x33) {
      readLabel(cmd & 0x01);
      const l = view.getInt32(pos, true) / 100;
      const r = view.getInt32(pos + 4, true) / 100;
      const u = view.getInt32(pos + 8, true) / 100;
      const d = view.getInt32(pos + 12, true) / 100;
      pos += 16;
      xsects.push({ label, l, r, u, d });
      continue;
    }

    // LINE: v7 = 0x40-0x7f (flags low 6 bits), v8 = 0x40-0x7f too (label encoding differs).
    // v8 label flags use bit 0x20 of the LINE byte to mean "no label change".
    const isLineV7 = versionNum < 8 && cmd >= 0x80 && cmd <= 0xff;
    const isLineV8 = versionNum === 8 && cmd >= 0x40 && cmd <= 0x7f;
    if (isLineV7 || isLineV8) {
      const flags = cmd & 0x3f;
      readLabel(flags);
      // After readLabel on a LINE, `label` is the survey path the leg belongs to.
      // LABEL commands also share `label` but extend it with a station component;
      // a follow-up LINE's readLabel typically trims back to the survey path.
      legSurveyPath = label;
      const thisKey = readCoords();
      const legType = flags & 0x04 ? 'splay' : flags & 0x01 ? 'surface' : flags & 0x02 ? 'dup' : 'cave';
      if (lastKey !== null) {
        legs.push({ fromKey: lastKey, toKey: thisKey, type: legType, surveyPath: legSurveyPath });
      }
      lastKey = thisKey;
      move = false;
      continue;
    }

    // LABEL: v7 = 0x40-0x7f (flags low 6 bits), v8 = 0x80-0xff (flags low 7 bits).
    const isLabelV7 = versionNum < 8 && cmd >= 0x40 && cmd <= 0x7f;
    const isLabelV8 = versionNum === 8 && cmd >= 0x80 && cmd <= 0xff;
    if (isLabelV7 || isLabelV8) {
      const flags = isLabelV8 ? cmd & 0x7f : cmd & 0x3f;
      readLabel(0); // LABEL always reads a label suffix in v3-v7; in v8 the 0x20 bit is set on flags only for LINE
      const thisKey = readCoords();
      // Skip surface-only stations (no underground / entrance bits) and anonymous (0x20).
      const underground = flags & 0x0e;
      const anonymous = flags & 0x20;
      if (underground && !anonymous && label) {
        if (!labels.has(thisKey)) labels.set(thisKey, []);
        const arr = labels.get(thisKey);
        if (!arr.includes(label)) arr.push(label);
      }
      lastKey = thisKey;
      move = false;
      continue;
    }

    throw new Error(`Unhandled .3d command 0x${cmd.toString(16)} at pos ${(pos - 1).toString(16)}`);
  }

  return { version, versionNum, title, crs, positions, labels, legs, xsects };
}

// ─── Utilities ──────────────────────────────────────────────────────────────────

// 12-byte raw key for coordinate deduplication. Uses a binary string (one char per byte)
// since byte-for-byte equality is what we want and string keys work in Maps.
function bytesToKey(data, start, len) {
  let s = '';
  for (let i = 0; i < len; i++) s += String.fromCharCode(data[start + i]);
  return s;
}

// Recognise common CRS strings from the .3d header. Returns null if unrecognised.
// Supported: bare "EPSG:nnnnn", "+init=epsg:nnnnn", "+proj=utm +zone=N [+south]".
function parseCrs(crs) {
  if (!crs) return null;
  const lower = crs.toLowerCase();

  // EPSG codes
  const epsgMatch = lower.match(/epsg[:=](\d+)/);
  if (epsgMatch) {
    const code = parseInt(epsgMatch[1], 10);
    if (code === 23700) return { type: 'eov' };
    if (code >= 32601 && code <= 32660) return { type: 'utm', zone: code - 32600, northern: true };
    if (code >= 32701 && code <= 32760) return { type: 'utm', zone: code - 32700, northern: false };
    return null;
  }

  // PROJ4 +proj=utm
  const utmMatch = lower.match(/\+proj=utm[^+]*\+zone=(\d+)/);
  if (utmMatch) {
    return { type: 'utm', zone: parseInt(utmMatch[1], 10), northern: !lower.includes('+south') };
  }

  return null;
}

// For each dotted name in `names`, find the shortest dotted suffix that's globally
// unique within `names`. Returns a Map<fullName, shortestUniqueSuffix>.
//
// Example: ["a.b.5", "a.c.5", "a.b.6"]
//   → "a.b.5" → "b.5"   (suffix "5" collides with a.c.5; "b.5" is unique)
//   → "a.c.5" → "c.5"   (same reason)
//   → "a.b.6" → "6"     (only one name ends with ".6")
//
// Falls back to the full name if no suffix is unique.
function shortestUniqueSuffixes(names) {
  const counts = new Map();
  for (const name of names) {
    const parts = name.split('.');
    for (let i = 0; i < parts.length; i++) {
      const suffix = i === 0 ? name : parts.slice(i).join('.');
      counts.set(suffix, (counts.get(suffix) ?? 0) + 1);
    }
  }
  const out = new Map();
  for (const name of names) {
    const parts = name.split('.');
    let chosen = name;
    for (let i = parts.length - 1; i >= 0; i--) {
      const suffix = i === 0 ? name : parts.slice(i).join('.');
      if (counts.get(suffix) === 1) { chosen = suffix; break; }
    }
    out.set(name, chosen);
  }
  return out;
}

function sanitizeName(s) {
  if (!s) return '';
  // Drop trailing extension and path components.
  return s
    .replace(/\.[^.]+$/, '')
    .split(/[\\/]/)
    .pop()
    .trim();
}

export { Survex3dImporter, parse3d, parseCrs };
