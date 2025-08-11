import * as U from './utils/utils.js';
import { SurveyStation as ST } from './model/survey.js';
import { Vector, Color } from './model.js';
import { ShotType } from './model/survey.js';
import { StationCoordinates, WGS84Coordinate } from './model/geo.js';
import { Graph } from './utils/graph.js';
import { EOVToWGS84Transformer } from './utils/geo.js';

class SurveyHelper {

  /**
   * Recalculates and updates survey's shots, station positions, orphan shots and isolatied property
   * @param {number} index - The 0 based index of the survey withing the surveys array of a cave
   * @param {Survey} es - The survey that will be updated in place
   * @param {Map<string, SurveyStation> } surveyStations - Previously calculated survey stations
   * @param {aliases} - The connection points between different surveys
   * @returns The survey with updated properties
   */
  static recalculateSurvey(index, es, surveyStations, aliases, geoData) {
    let startName, startPosition, startEov;

    //TODO: check if start station is still in shots
    startName = es.start !== undefined ? es.start : es.shots[0].from;

    if (index === 0) {
      startEov = geoData?.coordinates?.find((c) => c.name === startName)?.coordinate;

      if (startEov !== undefined) {
        startPosition = startEov.toVector();
      } else {
        startPosition = new Vector(0, 0, 0);
      }
    }

    SurveyHelper.calculateSurveyStations(es, surveyStations, aliases, startName, startPosition, startEov);
    return es;
  }

  static calculateSurveyStations(survey, stations, aliases, startName, startPosition, startEov) {

    if (survey.validShots.length === 0) return [];

    const startStationName = startName !== undefined ? startName : survey.shots[0].from;
    const eovToWgs84Transformer = new EOVToWGS84Transformer();

    // this is the first survey
    if (startPosition !== undefined) {
      let wgsCoord;
      if (startEov !== undefined) {
        const [lat, lon, h] = eovToWgs84Transformer.eovTOwgs84(startEov.y, startEov.x);
        wgsCoord = new WGS84Coordinate(lat, lon);
      }
      // this is only set for the first survey
      stations.set(
        startStationName,
        new ST(ShotType.CENTER, startPosition, new StationCoordinates(new Vector(0, 0, 0), startEov, wgsCoord), survey)
      );
    }

    survey.start = startStationName;

    survey.shots.forEach((sh) => {
      sh.processed = false;
      sh.fromAlias = undefined;
      sh.toAlias = undefined;
    });

    const declination = survey?.metadata?.declination ?? 0.0; //TODO: remove fallback logic
    const convergence = survey?.metadata?.convergence ?? 0.0;

    var repeat = true;

    const duplicateShotIds = new Set();

    const tryAddStation = (name, st, sh) => {
      if (stations.has(name)) {
        // this should never happen
        throw new Error(`Conflicting shot (${sh.from} -> ${sh.to})!`);
      } else {
        stations.set(name, st);
        sh.processed = true;

      }

    };

    // the basics of this algorithm came from Topodroid cave surveying software by Marco Corvi
    while (repeat) {
      repeat = false;
      survey.validShots.forEach((sh) => {
        if (sh.processed) return; // think of it like a continue statement in a for loop

        let fromStation = stations.get(sh.from);
        let toStation = stations.get(sh.to);

        const polarVector = U.fromPolar(
          sh.length,
          U.degreesToRads(sh.azimuth + declination + convergence),
          U.degreesToRads(sh.clino)
        );

        const newStation = (position, prevSt, diff) => {

          let eovCoord, wgsCoord;
          if (prevSt.coordinates.eov !== undefined) {
            eovCoord = prevSt.coordinates.eov.addVector(diff);
            const [lat, lon, h] = eovToWgs84Transformer.eovTOwgs84(eovCoord.y, eovCoord.x);
            wgsCoord = new WGS84Coordinate(lat, lon);
          }

          return new ST(
            sh.type,
            position,
            new StationCoordinates(prevSt.coordinates.local.add(diff), eovCoord, wgsCoord),
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
            const stationName = survey.getToStationName(sh);
            tryAddStation(stationName, newStation(st, fromStation, polarVector), sh);
            repeat = true;
          } else {
            //from = 1, to = 1
            duplicateShotIds.add(sh.id);
          }

        } else if (toStation !== undefined) {
          // it is not possible to create center and splay shots from an auxiliary station
          if (toStation.isAuxiliary() && (sh.isCenter() || sh.isSplay())) {
            return; // think of it like a continue statement in a for loop
          }

          // from = 0, to = 1
          const tp = toStation.position;
          const st = new Vector(tp.x, tp.y, tp.z).sub(polarVector);
          tryAddStation(sh.from, newStation(st, toStation, polarVector.neg()), sh);
          repeat = true;
        } else {
          //from = 0, to = 0, look for aliases
          let falias = aliases.find((a) => a.contains(sh.from));
          let talias = aliases.find((a) => a.contains(sh.to));
          if (falias === undefined && talias === undefined) return; // think of it like a continue statement in a for loop

          if (falias !== undefined) {
            const pairName = falias.getPair(sh.from);
            if (stations.has(pairName)) {
              const from = stations.get(pairName);
              // it is not possible to create center and splay shots from an auxiliary station
              if (from.isAuxiliary() && (sh.isCenter() || sh.isSplay())) {
                return; // think of it like a continue statement in a for loop
              }
              const fp = from.position;
              const to = new Vector(fp.x, fp.y, fp.z).add(polarVector);
              const toStationName = survey.getToStationName(sh);
              tryAddStation(toStationName, newStation(to, from, polarVector), sh);
              repeat = true;
              sh.fromAlias = pairName;
            }
          }

          if (talias !== undefined) {
            const pairName = talias.getPair(sh.to);
            if (stations.has(pairName)) {
              const to = stations.get(pairName);
              if (to.isAuxiliary() && (sh.isCenter() || sh.isSplay())) {
                return; // think of it like a continue statement in a for loop
              }
              const tp = to.position;
              const from = new Vector(tp.x, tp.y, tp.z).sub(polarVector);
              tryAddStation(sh.from, newStation(from, to, polarVector.neg()), sh);
              repeat = true;
              sh.toAlias = pairName;
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

  static getSegments(survey, stations) {
    const splaySegments = [];
    const centerlineSegments = [];
    const auxiliarySegments = [];
    survey.validShots.forEach((sh) => {
      const fromStation = stations.get(survey.getFromStationName(sh));
      const toStation = stations.get(survey.getToStationName(sh));

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
            throw new Error(`Undefined segment type ${sh.type}`);
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
    const g = new Graph();
    [...cave.stations.keys()].forEach((k) => g.addVertex(k));
    let startStationName;
    [...cave.surveys.entries()].forEach(([index, s]) => {
      if (index === 0) {
        startStationName = s.start !== undefined ? s.start : s.shots[0].from;
      }
      s.validShots.forEach((sh) => {
        const fromName = s.getFromStationName(sh);
        const from = cave.stations.get(fromName);
        const toStationName = s.getToStationName(sh);
        const to = cave.stations.get(toStationName);
        if (from !== undefined && to !== undefined) {
          g.addEdge(fromName, toStationName, sh.length);
        }
      });
    });

    const traverse = g.traverse(startStationName);
    const maxDistance = Math.max(...Array.from(traverse.distances.values()));

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

    cave.surveys.forEach((s) => {
      const centerColors = [];
      const splayColors = [];
      const auxiliaryColors = [];

      s.validShots.forEach((sh) => {
        const fromDistance = traverse.distances.get(s.getFromStationName(sh));
        const toDistance = traverse.distances.get(s.getToStationName(sh));

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
      result.set(s.name, { center: centerColors, splays: splayColors, auxiliary: auxiliaryColors });
    });

    return result;
  }

  static getColorGradientsByDepthForCaves(caves, clOptions) {
    const colorGradients = new Map();

    const zCoords = Array.from(
      [...caves.values()].flatMap((cave) => {
        if (cave.visible) {
          return [...cave.stations.values()].map((x) => x.position.z);
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
      c.surveys.forEach((s) => {
        sm.set(
          s.name,
          SurveyHelper.getColorGradientsByDepthMultiColor(s, c.stations, diffZ, maxZ, clOptions.color.gradientColors)
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
      const fromStation = stations.get(survey.getFromStationName(sh));
      const toStation = stations.get(survey.getToStationName(sh));

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
      throw new Error('At least 2 gradient colors are required');
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
