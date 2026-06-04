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

import * as U from './utils/utils.js';
import { SurveyStation as ST, ShotWithSurvey, DEFAULT_UNITS } from './model/survey.js';
import { Vector, Color } from './model.js';
import { ShotType } from './model/survey.js';
import { CoordinateSystemType, StationCoordinates, WGS84Coordinate } from './model/geo.js';
import { Graph } from './utils/graph.js';
import { WGS84Converter } from './utils/geo.js';
import { i18n } from './i18n/i18n.js';
import { globalNormalizer } from './utils/global-coordinate-normalizer.js';

/**
 * ─── The cave position solver ───────────────────────────────────────────────────
 *
 * `SurveyHelper` turns a cave's raw shots into 3D station positions. A cave may be a
 * single survey or a deep tree of surveys (Therion/Survex nest `survey`/`*begin` blocks
 * arbitrarily). All surveys of one top-level cave are solved together into one shared
 * `Map<stationName, SurveyStation>`, which is then distributed back into each cave node.
 *
 * Three properties of real multi-survey data drive the design:
 *
 * 1. STATION NUMBERS ARE REUSED. Every Therion/Survex survey numbers its stations from 1,
 *    so dozens of surveys each have a station "1", "2", … The solver therefore keys the
 *    shared map by a SURVEY-QUALIFIED name, `name@surveyPath` (see `Survey.qualify`). A
 *    cave with a single survey (the common case) and all legacy caves have no `surveyPath`,
 *    so `qualify` is a no-op and keys stay bare — behavior there is unchanged. Bare,
 *    user-facing names are recovered for display/export via `bareStationName`.
 *
 * 2. SURVEYS CONNECT ONLY THROUGH SHARED OR EQUATED STATIONS. A shot in survey B can be
 *    placed only once one of its endpoints already has a position — reached either by a
 *    station shared within B, or by an `equate` (alias) to a station in another, already
 *    placed survey. A single ordered pass cannot place a survey whose connecting partner is
 *    processed later, so `calculateCaveStations` runs an ORDER-INDEPENDENT FIXPOINT: it
 *    repeats over the not-yet-placed surveys until a full pass adds nothing more.
 *
 * 3. A NETWORK MAY HAVE MANY ANCHORS. A connected system fixes one entrance per sub-cave
 *    (e.g. System Migovec fixes 8). Every survey that contains a fixed station is SEEDED
 *    with that absolute coordinate (not just one); if there is no fix at all, the first
 *    survey is seeded at the origin. All other surveys attach via the fixpoint.
 *
 * EQUATE RESOLUTION: an equated junction is the same physical point under several names
 * (`A.1 == B.13 == C.5`), but the map stores it under only ONE representative key. So when
 * a shot's endpoint is an aliased name, `findAliasedStation` walks the whole equate group
 * transitively to find whichever name is already placed — this is what makes multi-hop
 * equate chains resolve. The map is never polluted with duplicate keys, so each physical
 * station is one object (no double-counting in stats or rendering).
 *
 * A survey that cannot be reached from any anchor stays `isolated`; its unplaced shots are
 * reported as `orphanShotIds`. The same solver is used by import, project reload, and edit
 * so all three agree.
 */
class SurveyHelper {

  /**
   * Recalculates and updates survey's shots, station positions, orphan shots and isolatied property
   * @param {number} index - The 0 based index of the survey withing the surveys array of a cave
   * @param {Survey} es - The survey that will be updated in place
   * @param {Map<string, SurveyStation> } caveStations - Previously calculated survey stations
   * @param {aliases} - The connection points between different surveys
   * @returns The survey with updated properties
   */
  static recalculateSurvey(hasCoordinateOrFirstSurvey, es, surveys, caveStations, aliases, geoData) {
    let startName, startPosition, startCoordinate;

    if (es.validShots.length === 0) return;

    //TODO: check if start station is still in shots
    startName = es.start !== undefined && es.start !== '' ? es.start : es.shots[0].from;

    if (hasCoordinateOrFirstSurvey) {
      startCoordinate = geoData?.coordinates?.find((c) => c.name === startName)?.coordinate;

      if (startCoordinate !== undefined) {
        // Initialize global origin from the first cave with coordinates (only if not already initialized)
        if (
          !globalNormalizer.isInitialized() &&
          (startCoordinate.type === CoordinateSystemType.UTM || startCoordinate.type === CoordinateSystemType.EOV)
        ) {
          globalNormalizer.initializeGlobalOrigin(startCoordinate);
        }

        // Use normalized coordinates to avoid floating-point precision issues with large UTM values
        startPosition = startCoordinate.toNormalizedVector();
      } else {
        startPosition = new Vector(0, 0, 0);
      }
    }

    SurveyHelper.calculateSurveyStations(
      es,
      surveys,
      caveStations,
      aliases,
      startName,
      startPosition,
      startCoordinate,
      geoData?.coordinateSystem
    );
    return es;
  }

  /**
   * Computes 3D station positions for a whole (possibly nested, multi-survey) cave and
   * returns the merged `Map<stationName, SurveyStation>`. Shared by import, reload and edit
   * so all three agree.
   *
   * Surveys connect only through shared or equated stations: a single ordered pass cannot
   * place a survey whose connecting partner happens to be processed later. So this seeds
   * exactly one survey with an absolute start (the one carrying the georeferenced fix, else
   * the first survey at the origin) and then repeats over the still-unplaced surveys until
   * no further survey can attach — an order-independent fixpoint.
   *
   * @param {Survey[]} surveys - all surveys across the cave subtree (any order)
   * @param {SurveyAlias[]} aliases - equate connections (qualified names for multi-survey caves)
   * @param {GeoData} geoData - coordinate system + fixed station(s); may be null/undefined
   */
  static calculateCaveStations(surveys, aliases, geoData) {
    const stations = new Map();
    if (!surveys || surveys.length === 0) return stations;

    // A survey is a SEED if it owns a fixed station: it is placed in absolute coordinates on
    // its own, independent of equates. A real system fixes one entrance per sub-cave, so
    // there are many seeds. Match each geoData fix name to the survey whose qualified station
    // keys contain it, and point that survey's `start` at the fix so recalculateSurvey seeds
    // from the fixed coordinate. (qualify is a no-op for bare names / single-survey caves.)
    const fixNames = (geoData?.coordinates ?? []).map((c) => c.name);
    const seeds = new Set();
    for (const fixName of fixNames) {
      const owner = surveys.find((s) =>
        s.validShots.some((sh) => s.qualify(sh.from) === fixName || s.qualify(s.getToStationName(sh)) === fixName)
      );
      if (owner) {
        owner.start = fixName;
        seeds.add(owner);
      }
    }
    const isSeed = (s) => seeds.has(s);

    // Seeds first, so their anchors are in the map before equate-only surveys try to attach.
    const ordered = [...surveys].sort((a, b) => (isSeed(b) ? 1 : 0) - (isSeed(a) ? 1 : 0));
    const anySeed = seeds.size > 0;

    // A cave with NO fixed station is anchored by seeding ONE survey at the origin. Pick that
    // survey DETERMINISTICALLY (smallest surveyPath/name) instead of "first in the array", so
    // reordering surveys cannot change the solved coordinates — reorder is then purely cosmetic
    // and needs no recompute. The absolute position of an un-georeferenced cave is arbitrary
    // anyway; only stability across reorder/reload matters.
    const originSurvey = anySeed
      ? undefined
      : [...surveys]
          .filter((s) => s.validShots.length > 0)
          .sort((a, b) => {
            const ka = a.surveyPath ?? a.name ?? '';
            const kb = b.surveyPath ?? b.name ?? '';
            return ka < kb ? -1 : ka > kb ? 1 : 0;
          })[0];

    // Seed-anchored fixpoint: sweep the not-yet-placed surveys, placing each survey that can
    // now attach (via a fix, or via a station a previously-placed survey/equate added), and
    // repeat until a sweep connects nothing more. `recalculateSurvey` rebuilds a survey from
    // scratch and throws on a pre-existing station, so a survey is finalized as soon as it
    // connects (it is not re-run). A survey with no path to any anchor stays isolated; its
    // unplaced legs are reported as orphan shots.
    //
    // We only re-sweep when the previous sweep added at least one station (`grewThisSweep`):
    // if a full sweep places nothing new, no further sweep can either, so we stop. This keeps
    // the result identical to a naive fixpoint while avoiding an extra no-op sweep. (A
    // station→survey work queue would cut the remaining re-traversals further, but transitive
    // equate chains make a correct index subtle, so we keep the robust sweep.)
    const placed = new Set();
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const es of ordered) {
        if (placed.has(es)) continue;
        if (es.validShots.length === 0) {
          placed.add(es);
          continue;
        }

        // Seed an absolute start: every fixed survey (each at its own fix) and — when there is no
        // fix at all — the single deterministically-chosen origin survey. Every other survey
        // attaches via a station already placed by a connected survey.
        let hasCoordinateOrFirstSurvey = false;
        if (isSeed(es)) hasCoordinateOrFirstSurvey = true;
        else if (es === originSurvey) hasCoordinateOrFirstSurvey = true;

        const before = stations.size;
        SurveyHelper.recalculateSurvey(hasCoordinateOrFirstSurvey, es, [...placed], stations, aliases, geoData);

        // Placed once it is no longer isolated; if it could not connect yet but the map grew
        // this pass (a partner got placed), iterate again.
        if (!es.isolated) {
          placed.add(es);
          progressed = true;
        } else if (stations.size > before) {
          progressed = true;
        }
      }
    }
    return stations;
  }

  /**
   * Recomputes 3D station positions for a whole (possibly nested, multi-survey) cave and
   * distributes the resulting stations back into each cave node's own `stations` map. The
   * network is solved in one pass (shots reach across sub-caves via aliases), mirroring the
   * import-time assembly so load and edit agree. Pure model update — no scene/DOM side effects;
   * the caller is responsible for any "recalculated" notifications and scene reload.
   * @param {Cave} cave - the (root) cave to recompute
   * @returns {Map<string, SurveyStation>} the merged station map that was distributed
   */
  static recalculateCave(cave) {
    const allSurveys = cave.getAllSurveys();
    const aliases = cave.getAllAliases();
    // Order-independent fixpoint solve over the whole network (same as import), so surveys
    // connected only via equates are placed regardless of their order in the tree.
    const caveStations = SurveyHelper.calculateCaveStations(allSurveys, aliases, cave.geoData);

    cave.walk((c) => {
      c.stations = new Map();
    });
    const surveyToCave = new Map();
    cave.walk((c) => c.surveys.forEach((s) => surveyToCave.set(s, c)));
    for (const [name, st] of caveStations) {
      (surveyToCave.get(st.survey) ?? cave).stations.set(name, st);
    }
    return caveStations;
  }

  /**
   * Finds an already-placed station that is equate-connected to `qname`, following the whole
   * equate group transitively. Equated stations are the same physical point but the solver
   * stores it under only one representative key; a multi-hop equate chain (A.1=B.13, then
   * C.1=B.13) can only reach the placed point by walking every name equated to this endpoint.
   * Returns the SurveyStation, or undefined if no equated name is placed yet.
   * @param {string} qname - qualified station name to resolve
   * @param {SurveyAlias[]} aliases - all equate connections
   * @param {Map<string, SurveyStation>} stations - placed stations by qualified name
   */
  static findAliasedStation(qname, aliases, stations) {
    const name = SurveyHelper.findAliasedStationName(qname, aliases, stations);
    return name !== undefined ? stations.get(name) : undefined;
  }

  /**
   * Like {@link findAliasedStation}, but returns the KEY under which the equated station is
   * actually stored (which may be several hops away in the equate group), or undefined. Callers
   * that need to record a usable map key — e.g. a shot's `fromAlias`/`toAlias`, later read by
   * getFromStationName()/getToStationName() in rendering, exports and color buffers — must use
   * this representative key, NOT the direct equate neighbor (which may not be a placed key).
   * @param {string} qname - qualified station name to resolve
   * @param {SurveyAlias[]} aliases - all equate connections
   * @param {Map<string, SurveyStation>} stations - placed stations by qualified name
   * @returns {string|undefined} the placed name, or undefined if no equated name is placed
   */
  static findAliasedStationName(qname, aliases, stations) {
    const visited = new Set([qname]);
    const queue = [qname];
    while (queue.length > 0) {
      const name = queue.shift();
      if (stations.has(name)) return name;
      for (const a of aliases) {
        if (!a.contains(name)) continue;
        const other = a.getPair(name);
        if (other !== undefined && !visited.has(other)) {
          visited.add(other);
          queue.push(other);
        }
      }
    }
    return undefined;
  }

  static calculateSurveyStations(
    survey,
    surveys,
    stations,
    aliases,
    startName,
    startPosition,
    startCoordinate,
    coordinateSystem
  ) {

    if (survey.validShots.length === 0) return;

    // Station keys in the shared solver map are qualified with the survey's path
    // (`name@surveyPath`) so that station numbers reused across surveys (every Therion
    // survey numbers from 1) stay distinct. `survey.qualify` is a no-op for legacy /
    // single-survey caves (no surveyPath), keeping the old bare-name behavior. Aliases are
    // already fully qualified by the importer, so we DON'T re-qualify a name that already
    // contains '@'.
    const qualify = (name) => survey.qualify(name);

    const startStationName = startName !== undefined ? startName : survey.shots[0].from;

    // this is the first survey
    if (startPosition !== undefined) {
      let wgsCoord;
      if (startCoordinate !== undefined && coordinateSystem !== undefined) {
        const { latitude, longitude } = WGS84Converter.toLatLon(startCoordinate, coordinateSystem);
        wgsCoord = new WGS84Coordinate(latitude, longitude);
      }
      // this is only set for the first survey
      stations.set(
        qualify(startStationName),
        new ST(
          ShotType.CENTER,
          startPosition,
          new StationCoordinates(new Vector(0, 0, 0), startCoordinate, wgsCoord),
          survey
        )
      );
    }

    survey.shots.forEach((sh) => {
      sh.processed = false;
      sh.fromAlias = undefined;
      sh.toAlias = undefined;
    });

    // declination and meridian convergence are also used in utils/cycle.js
    const declination = survey?.metadata?.declination ?? 0.0; //TODO: remove fallback logic
    const convergence = survey?.metadata?.convergence ?? 0.0;

    var repeat = true;

    const duplicateShotIds = new Set();

    const tryAddStation = (name, st, sh, otherSt) => {
      if (stations.has(name)) {
        // Two different physical stations resolved to the same name (e.g. station numbers
        // reused across surveys whose namespaces were stripped). Name the survey and the
        // conflicting station so the user can locate it.
        throw new Error(
          i18n.t('errors.survey.conflictingShot', {
            from    : sh.from,
            to      : sh.isSplay() ? `splay-${sh.id}` : (sh.to ?? '?'),
            station : name,
            survey  : survey.name
          })
        );
      } else {
        stations.set(name, st);
        sh.processed = true;
        st.shots.push(new ShotWithSurvey(sh, survey)); // this is used in loop closure
        otherSt.shots.push(new ShotWithSurvey(sh, survey)); // this is used in loop closure
      }

    };

    // the basics of this algorithm came from Topodroid cave surveying software by Marco Corvi
    while (repeat) {
      repeat = false;
      survey.validShots.forEach((sh) => {
        if (sh.processed) return; // think of it like a continue statement in a for loop

        // Center/normal endpoints are bare names local to this survey → qualify them for the
        // shared map. (Splay/auxiliary `to` names are generated already-unique, handled in
        // survey.getToStationName.)
        let fromStation = stations.get(qualify(sh.from));
        let toStation = stations.get(qualify(sh.to));

        const lenM = U.convertLengthToMeters(sh.length, survey.units?.length ?? DEFAULT_UNITS.length);
        const aziDeg = U.convertAngleToDegrees(sh.azimuth, survey.units?.angle ?? DEFAULT_UNITS.angle);
        const cliDeg = U.convertAngleToDegrees(sh.clino, survey.units?.angle ?? DEFAULT_UNITS.angle);

        const polarVector = U.fromPolar(
          lenM,
          U.degreesToRads(aziDeg + declination - convergence),
          U.degreesToRads(cliDeg)
        );

        const newStation = (position, prevSt, diff) => {

          let projectedCoord, wgsCoord;
          if (prevSt.coordinates.projected !== undefined) {
            projectedCoord = prevSt.coordinates.projected.addVector(diff);
            const { latitude, longitude } = WGS84Converter.toLatLon(projectedCoord, coordinateSystem);
            wgsCoord = new WGS84Coordinate(latitude, longitude);
          }

          return new ST(
            sh.type,
            position,
            new StationCoordinates(prevSt.coordinates.local.add(diff), projectedCoord, wgsCoord),
            survey
          );
        };

        if (fromStation !== undefined) {

          // it is not possible to create center and splay shots from an auxiliary station
          if (fromStation.isAuxiliary() && (sh.isCenter() || sh.isSplay())) {
            return; // think of it like a continue statement in a for loop
          }

          if (toStation === undefined) {
            // from = 1, to = 0
            const fp = fromStation.position;
            const st = new Vector(fp.x, fp.y, fp.z).add(polarVector);
            const stationName = qualify(survey.getToStationName(sh));
            tryAddStation(stationName, newStation(st, fromStation, polarVector), sh, fromStation);
            repeat = true;
          } else {
            // from = 1, to = 1
            // find a previously processed shot with the same from/to (or to/from) stations
            if (SurveyHelper.findDuplicateShots(sh, survey, surveys).length > 0) {
              duplicateShotIds.add(sh.id);
            } else {
              fromStation.shots.push(new ShotWithSurvey(sh, survey));
              toStation.shots.push(new ShotWithSurvey(sh, survey));
            }
            sh.processed = true;
            return;

          }

        } else if (toStation !== undefined) {
          // it is not possible to create center and splay shots from an auxiliary station
          if (toStation.isAuxiliary() && (sh.isCenter() || sh.isSplay())) {
            return; // think of it like a continue statement in a for loop
          }

          // from = 0, to = 1
          const tp = toStation.position;
          const st = new Vector(tp.x, tp.y, tp.z).sub(polarVector);
          tryAddStation(qualify(sh.from), newStation(st, toStation, polarVector.neg()), sh, toStation);
          repeat = true;
        } else {
          // from = 0, to = 0 → look for equate aliases that connect this shot to an
          // already-placed station in another survey. Aliases are stored fully qualified
          // (`station@surveyPath`), so we match this shot's endpoints in their qualified
          // form and use the alias partner name (already a valid map key) directly.
          const fromQ = qualify(sh.from);
          const toQ = qualify(sh.to);
          let falias = aliases.find((a) => a.contains(fromQ));
          let talias = aliases.find((a) => a.contains(toQ));
          if (falias === undefined && talias === undefined) return; // think of it like a continue statement in a for loop

          // Resolve an aliased endpoint to an already-placed station by following the WHOLE
          // equate group transitively (not just the direct partner). An equated junction is
          // stored under just one representative key; a multi-hop chain (X.1 = Y.13, then
          // Z.1 = Y.13) reaches the placed point only by walking all names equated to this
          // endpoint. We resolve to the KEY the station is stored under and record THAT on
          // fromAlias/toAlias — the direct neighbor (falias.getPair) may not be a placed key, so
          // getFromStationName()/getToStationName() would later miss it and drop the leg from
          // rendering / exports / color buffers even though the survey is connected.
          const resolveAliasName = (qname) => SurveyHelper.findAliasedStationName(qname, aliases, stations);

          // A shot attaches to the placed network through ONE of its endpoints. If BOTH endpoints
          // are equated, placing from `from` already determines `to`; running the `talias` branch
          // too would then re-place the `from` endpoint as a separate station, duplicating the
          // equated junction (e.g. `1@B` stored alongside its partner `2@A`). So the branches are
          // mutually exclusive — once the shot is placed via `from`, skip the `to` branch.
          let fromAliasFound = false;
          if (falias !== undefined) {
            const fromName = resolveAliasName(fromQ);
            const from = fromName !== undefined ? stations.get(fromName) : undefined;
            if (from !== undefined) {
              // it is not possible to create center and splay shots from an auxiliary station
              if (from.isAuxiliary() && (sh.isCenter() || sh.isSplay())) {
                return; // think of it like a continue statement in a for loop
              }
              const fp = from.position;
              const to = new Vector(fp.x, fp.y, fp.z).add(polarVector);
              const toStationName = qualify(survey.getToStationName(sh));
              tryAddStation(toStationName, newStation(to, from, polarVector), sh, from);
              repeat = true;
              sh.fromAlias = fromName; // the actual placed key, possibly several hops away
              fromAliasFound = true;
            }
          }

          if (!fromAliasFound && talias !== undefined) {
            const toName = resolveAliasName(toQ);
            const to = toName !== undefined ? stations.get(toName) : undefined;
            if (to !== undefined) {
              if (to.isAuxiliary() && (sh.isCenter() || sh.isSplay())) {
                return; // think of it like a continue statement in a for loop
              }
              const tp = to.position;
              const from = new Vector(tp.x, tp.y, tp.z).sub(polarVector);
              tryAddStation(qualify(sh.from), newStation(from, to, polarVector.neg()), sh, to);
              repeat = true;
              sh.toAlias = toName; // the actual placed key, possibly several hops away
            }
          }
        }

      });
    }

    const unprocessedShots = new Set(survey.shots.filter((sh) => !sh.processed).map((sh) => sh.id));
    const processedCount = survey.shots.filter((sh) => sh.processed).length;

    survey.orphanShotIds = unprocessedShots;
    survey.duplicateShotIds = duplicateShotIds;
    survey.isolated = processedCount === 0;
  }

  static findDuplicateShots(shot, survey, surveys) {

    const existingShot = (sh, survey) =>
      survey.validShots.find(
        (s) =>
          s.id !== sh.id &&
          s.processed &&
          ((s.from === sh.from && s.to === sh.to) || (s.from === sh.to && s.to === sh.from))
      );

    const surveyIndex = surveys.findIndex((s) => s.name === survey.name);
    const previousSurveys = surveys.slice(0, surveyIndex);
    return [...previousSurveys, survey]
      .map((survey) => {
        return existingShot(shot, survey);
      })
      .filter((s) => s !== undefined);
  }

  static getSegments(survey, stations) {
    const splaySegments = [];
    const centerlineSegments = [];
    const auxiliarySegments = [];
    // Station maps are keyed by the survey-qualified name (`name@surveyPath`); alias
    // partners and splay/aux names are already qualified, so survey.qualify is a no-op on
    // them. For legacy/single-survey caves qualify is a no-op everywhere (bare keys).
    survey.validShots.forEach((sh) => {
      const fromStation = stations.get(survey.qualify(survey.getFromStationName(sh)));
      const toStation = stations.get(survey.qualify(survey.getToStationName(sh)));

      if (fromStation !== undefined && toStation !== undefined) {
        const fromPos = fromStation.position;
        const toPos = toStation.position;
        switch (sh.type) {
          case ShotType.SPLAY:
            splaySegments.push(fromPos.x, fromPos.y, fromPos.z, toPos.x, toPos.y, toPos.z);
            break;
          case ShotType.CENTER:
            centerlineSegments.push(fromPos.x, fromPos.y, fromPos.z, toPos.x, toPos.y, toPos.z);
            break;
          case ShotType.AUXILIARY:
            auxiliarySegments.push(fromPos.x, fromPos.y, fromPos.z, toPos.x, toPos.y, toPos.z);
            break;
          default:
            throw new Error(i18n.t('errors.survey.undefinedSegmentType', { type: sh.type }));
        }
      }
    });

    return [centerlineSegments, splaySegments, auxiliarySegments];

  }

  static getColorGradientsForCaves(caves, lOptions) {
    if (lOptions.color.mode === 'gradientByZ') {
      return SurveyHelper.getColorGradientsByDepthForCaves(caves, lOptions);
    } else if (lOptions.color.mode === 'gradientByDistance') {
      const m = [...caves.entries()].map(([caveName, cave]) => {
        const colors = SurveyHelper.getColorGradientsByDistance(cave, lOptions);
        return [caveName, colors];
      });
      return new Map(m);
    } else {
      return new Map();
    }
  }

  static getColorGradients(cave, lOptions) {
    if (lOptions.color.mode === 'gradientByZ') {
      const colorGradientsCaves = SurveyHelper.getColorGradientsByDepthForCaves([cave], lOptions);
      return colorGradientsCaves.get(cave.name);
    } else if (lOptions.color.mode === 'gradientByDistance') {
      return SurveyHelper.getColorGradientsByDistance(cave, lOptions);
    } else {
      return new Map();
    }
  }

  static getColorGradientsByDistance(cave, clOptions) {
    const stations = cave.getAllStations();
    const surveys = cave.getAllSurveys();
    const aliases = cave.getAllAliases();
    const g = new Graph();
    [...stations.keys()].forEach((k) => g.addVertex(k));

    // Resolve equated endpoints to the single representative key they are stored under, and add
    // an edge for every equate, so the distance traversal spans the WHOLE connected network —
    // exactly like SectionHelper.getGraph. Without this, sub-caves anchored by their own fix are
    // unreachable from the start station, get NO distance, and their segments get no gradient
    // color; the color buffer then ends up shorter than the position buffer ("vertex buffer is
    // not big enough") and that part of the cave disappears.
    const keyByStation = new Map();
    for (const [k, v] of stations) if (!keyByStation.has(v)) keyByStation.set(v, k);
    const resolveKey = (name) => {
      if (stations.has(name)) return name;
      const st = SurveyHelper.findAliasedStation(name, aliases, stations);
      return st !== undefined ? keyByStation.get(st) : undefined;
    };

    let startStationName;
    surveys.forEach((s, index) => {
      if (index === 0) {
        // Vertices/edges use survey-qualified names (no-op for single-survey caves).
        startStationName = resolveKey(s.qualify(s.start !== undefined ? s.start : s.shots[0].from));
      }
      const lengthUnit = s.units?.length ?? DEFAULT_UNITS.length;
      s.validShots.forEach((sh) => {
        const fromKey = resolveKey(s.qualify(s.getFromStationName(sh)));
        const toKey = resolveKey(s.qualify(s.getToStationName(sh)));
        if (fromKey !== undefined && toKey !== undefined) {
          g.addEdge(fromKey, toKey, U.convertLengthToMeters(sh.length, lengthUnit));
        }
      });
    });
    aliases.forEach((a) => {
      const fromKey = resolveKey(a.from);
      const toKey = resolveKey(a.to);
      if (fromKey !== undefined && toKey !== undefined && fromKey !== toKey) {
        g.addEdge(fromKey, toKey, 0);
      }
    });

    // The first survey's start can be unplaced (isolated survey) → not a graph vertex; traverse()
    // would then dereference undefined. Fall back to any placed station (the gradient is relative,
    // so any anchor yields a valid colouring); bail out only if nothing is placed.
    if (startStationName === undefined || !g.adjacencyList.has(startStationName)) {
      startStationName = [...stations.keys()][0];
    }
    if (startStationName === undefined) return new Map();

    const traverse = g.traverse(startStationName);
    const distances = [...traverse.distances.values()];
    const maxDistance = distances.length > 0 ? Math.max(...distances) : 0;

    return SurveyHelper.getColorGradientsByDistanceMultiColor(
      cave,
      traverse,
      maxDistance,
      clOptions.color.gradientColors
    );
  }

  static getColorGradientsByDistanceMultiColor(cave, traverse, maxDistance, gradientColors) {
    const result = new Map();

    // Convert gradient colors to use distance instead of depth
    const distanceGradientColors = gradientColors.map((gc) => ({
      distance : gc.depth, // Map depth to distance for consistency
      color    : gc.color
    }));

    cave.getAllSurveys().forEach((s) => {
      const centerColors = [];
      const splayColors = [];
      const auxiliaryColors = [];

      s.validShots.forEach((sh) => {
        // Look up by the SAME key SurveyHelper.getSegments uses for positions
        // (`survey.qualify(getFromStationName)`), so a color is produced for exactly the shots that
        // get a rendered segment — keeping the color buffer the same length as the position buffer.
        // (The graph above is equate-bridged so every PLACED station has a distance; an unplaced
        // orphan endpoint is skipped here exactly as getSegments skips it.)
        const fromDistance = traverse.distances.get(s.qualify(s.getFromStationName(sh)));
        const toDistance = traverse.distances.get(s.qualify(s.getToStationName(sh)));

        if (fromDistance !== undefined && toDistance !== undefined) {
          // Convert absolute distances to relative values (0-100)
          const fromRelativeValue = maxDistance === 0 ? 0 : (fromDistance / maxDistance) * 100;
          const toRelativeValue = maxDistance === 0 ? 0 : (toDistance / maxDistance) * 100;

          const fc = SurveyHelper.interpolateColorByValue(fromRelativeValue, distanceGradientColors, 'distance');
          const tc = SurveyHelper.interpolateColorByValue(toRelativeValue, distanceGradientColors, 'distance');

          if (sh.type === ShotType.CENTER) {
            centerColors.push(fc.r, fc.g, fc.b, tc.r, tc.g, tc.b);
          } else if (sh.type === ShotType.SPLAY) {
            splayColors.push(fc.r, fc.g, fc.b, tc.r, tc.g, tc.b);
          } else if (sh.type === ShotType.AUXILIARY) {
            auxiliaryColors.push(fc.r, fc.g, fc.b, tc.r, tc.g, tc.b);
          }
        }
      });
      result.set(s.id, { center: centerColors, splays: splayColors, auxiliary: auxiliaryColors });
    });

    return result;
  }

  static getColorGradientsByDepthForCaves(caves, clOptions) {
    const colorGradients = new Map();

    const zCoords = Array.from(
      [...caves.values()].flatMap((cave) => {
        if (cave.visible) {
          return [...cave.getAllStations().values()].map((x) => x.position.z);
        } else {
          return [];
        }
      })
    );

    const maxZ = Math.max(...zCoords);
    const minZ = Math.min(...zCoords);
    const diffZ = maxZ - minZ;
    caves.forEach((c) => {
      const sm = new Map();
      colorGradients.set(c.name, sm);
      const stations = c.getAllStations();
      c.getAllSurveys().forEach((s) => {
        sm.set(
          s.id,
          SurveyHelper.getColorGradientsByDepthMultiColor(s, stations, diffZ, maxZ, clOptions.color.gradientColors)
        );

      });

    });
    return colorGradients;
  }

  static getColorGradientsByDepthMultiColor(survey, stations, diffZ, maxZ, gradientColors) {
    const centerColors = [];
    const splayColors = [];
    const auxiliaryColors = [];

    // Sort gradient colors by depth
    const sortedColors = [...gradientColors].sort((a, b) => a.depth - b.depth);

    survey.validShots.forEach((sh) => {
      // Station map is keyed by survey-qualified names for multi-survey caves; qualify the
      // lookup (no-op for single-survey/legacy caves) so colors are produced. Without this
      // the color buffer stays empty while the material expects per-vertex colors, which
      // makes WebGL error ("Vertex buffer is not big enough for glDrawElementsInstanced").
      const fromStation = stations.get(survey.qualify(survey.getFromStationName(sh)));
      const toStation = stations.get(survey.qualify(survey.getToStationName(sh)));

      if (fromStation !== undefined && toStation !== undefined) {
        // Convert absolute Z coordinates to relative depth (0-100)
        const fromRelativeDepth = diffZ === 0 ? 0 : ((maxZ - fromStation.position.z) / diffZ) * 100;
        const toRelativeDepth = diffZ === 0 ? 0 : ((maxZ - toStation.position.z) / diffZ) * 100;

        const fc = SurveyHelper.interpolateColorByValue(fromRelativeDepth, sortedColors, 'depth');
        const tc = SurveyHelper.interpolateColorByValue(toRelativeDepth, sortedColors, 'depth');

        if (sh.type === ShotType.CENTER) {
          centerColors.push(fc.r, fc.g, fc.b, tc.r, tc.g, tc.b);
        } else if (sh.type === ShotType.SPLAY) {
          splayColors.push(fc.r, fc.g, fc.b, tc.r, tc.g, tc.b);
        } else if (sh.type === ShotType.AUXILIARY) {
          auxiliaryColors.push(fc.r, fc.g, fc.b, tc.r, tc.g, tc.b);
        }
      }
    });
    return { center: centerColors, splays: splayColors, auxiliary: auxiliaryColors };
  }

  static interpolateColorByValue(value, sortedColors, valueKey = 'depth') {
    if (sortedColors.length < 2) {
      throw new Error(i18n.t('errors.survey.atLeastTwoGradientColorsRequired'));
    }

    let lowerColor = sortedColors[0];
    let upperColor = sortedColors[sortedColors.length - 1];

    for (let i = 0; i < sortedColors.length - 1; i++) {
      if (value >= sortedColors[i][valueKey] && value <= sortedColors[i + 1][valueKey]) {
        lowerColor = sortedColors[i];
        upperColor = sortedColors[i + 1];
        break;
      }
    }

    // If value is outside the range, clamp to the nearest color
    if (value < lowerColor[valueKey]) {
      return new Color(lowerColor.color);
    }
    if (value > upperColor[valueKey]) {
      return new Color(upperColor.color);
    }

    // Interpolate between the two colors
    const range = upperColor[valueKey] - lowerColor[valueKey];
    const factor = range === 0 ? 0 : (value - lowerColor[valueKey]) / range;

    const startColor = new Color(lowerColor.color);
    const endColor = new Color(upperColor.color);
    const colorDiff = endColor.sub(startColor);

    return startColor.add(colorDiff.mul(factor));
  }
}

export { SurveyHelper };
