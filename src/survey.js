import * as U from './utils/utils.js';
import { SurveyStation as ST } from './model/survey.js';
import { Vector } from './model.js';
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
  static recalculateSurvey(index, es, surveyStations, aliases, coordinates) {
    let startName, startPosition;
    if (index === 0) {
      //TODO: check if start station is still in shots
      startName = es.start !== undefined ? es.start.name : es.shots[0].from;
      startPosition = new Vector(0, 0, 0);
    }

    SurveyHelper.calculateSurveyStations(es, surveyStations, aliases, startName, startPosition);
    return es;
  }

  static calculateSurveyStations(survey, stations, aliases, startName, startPosition, startEov) {

    if (survey.validShots.length === 0) return [];

    const startStationName = startName !== undefined ? startName : survey.shots[0].from;

    // this is the first survey
    if (startPosition !== undefined) {
      stations.set(
        startStationName,
        new ST('center', startPosition, new StationCoordinates(new Vector(0, 0, 0), startEov), survey)
      );
    }

    survey.start = startStationName;

    survey.shots.forEach((sh) => {
      sh.processed = false;
      sh.fromAlias = undefined;
      sh.toAlias = undefined;
    });

    const declination = survey?.metadata?.declination ?? 0.0; //TODO: remove fallback logic
    const eovToWgs84Transformer = new EOVToWGS84Transformer();
    var repeat = true;

    // the basics of this algorithm came from Topodroid cave surveying software by Marco Corvi
    while (repeat) {
      repeat = false;
      survey.validShots.forEach((sh) => {
        if (sh.processed) return; // think of it like a continue statement in a for loop

        let fromStation = stations.get(sh.from);
        let toStation = stations.get(sh.to);

        const polarVector = U.fromPolar(
          sh.length,
          U.degreesToRads(sh.azimuth + declination),
          U.degreesToRads(sh.clino)
        );

        const newStation = (position, prevSt, diff) => {
          if (prevSt === undefined) {
            console.log('prevSt.coordinates.eov is undefined', prevSt);
          }
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
          if (toStation === undefined) {
            // from = 1, to = 0
            const fp = fromStation.position;
            const st = new Vector(fp.x, fp.y, fp.z).add(polarVector);
            const stationName = survey.getToStationName(sh);
            stations.set(stationName, newStation(st, fromStation, polarVector));
            repeat = true;
          } else {
            //from = 1, to = 1
          }
          sh.processed = true;
        } else if (toStation !== undefined) {
          // from = 0, to = 1
          const tp = toStation.position;
          const st = new Vector(tp.x, tp.y, tp.z).sub(polarVector);
          stations.set(sh.from, newStation(st, toStation, polarVector.neg()));
          sh.processed = true;
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
              const fp = from.position;
              const to = new Vector(fp.x, fp.y, fp.z).add(polarVector);
              const toStationName = survey.getToStationName(sh);
              stations.set(toStationName, newStation(to, from, polarVector));
              sh.processed = true;
              repeat = true;
              sh.fromAlias = pairName;
            }
          }

          if (talias !== undefined) {
            const pairName = talias.getPair(sh.to);
            if (stations.has(pairName)) {
              const to = stations.get(pairName);
              const tp = to.position;
              const from = new Vector(tp.x, tp.y, tp.z).sub(polarVector);
              stations.set(sh.from, newStation(from, to, polarVector.neg()));
              sh.processed = true;
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
    survey.isolated = processedCount === 0;
  }

  static getSegments(survey, stations) {
    const splaySegments = [];
    const centerlineSegments = [];
    survey.validShots.forEach((sh) => {
      const fromStation = stations.get(survey.getFromStationName(sh));
      const toStation = stations.get(survey.getToStationName(sh));

      if (fromStation !== undefined && toStation !== undefined) {
        const fromPos = fromStation.position;
        const toPos = toStation.position;
        switch (sh.type) {
          case 'splay':
            splaySegments.push(fromPos.x, fromPos.y, fromPos.z, toPos.x, toPos.y, toPos.z);
            break;
          case 'center':
            centerlineSegments.push(fromPos.x, fromPos.y, fromPos.z, toPos.x, toPos.y, toPos.z);
            break;
          default:
            throw new Error(`Undefined segment type ${sh.type}`);
        }
      }
    });

    return [centerlineSegments, splaySegments];

  }

  static getColorGradientsForCaves(caves, lOptions) {
    if (lOptions.color.mode.value === 'gradientByZ') {
      return SurveyHelper.getColorGradientsByDepthForCaves(caves, lOptions);
    } else if (lOptions.color.mode.value === 'gradientByDistance') {
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
    if (lOptions.color.mode.value === 'gradientByZ') {
      const colorGradientsCaves = SurveyHelper.getColorGradientsByDepthForCaves([cave], lOptions);
      return colorGradientsCaves.get(cave.name);
    } else if (lOptions.color.mode.value === 'gradientByDistance') {
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
        startStationName = s.start !== undefined ? s.start.name : s.shots[0].from;
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
    const startColor = clOptions.color.start;
    const endColor = clOptions.color.end;
    const colorDiff = endColor.sub(startColor);
    const result = new Map();
    cave.surveys.forEach((s) => {
      const centerColors = [];
      const splayColors = [];

      s.validShots.forEach((sh) => {
        const fromDistance = traverse.distances.get(s.getFromStationName(sh));
        const toDistance = traverse.distances.get(s.getToStationName(sh));

        if (fromDistance !== undefined && toDistance !== undefined) {
          const fc = startColor.add(colorDiff.mul(fromDistance / maxDistance));
          const tc = startColor.add(colorDiff.mul(toDistance / maxDistance));
          if (sh.type === 'center') {
            centerColors.push(fc.r, fc.g, fc.b, tc.r, tc.g, tc.b);
          } else if (sh.type === 'splay') {
            splayColors.push(fc.r, fc.g, fc.b, tc.r, tc.g, tc.b);
          }
        }
      });
      result.set(s.name, { center: centerColors, splays: splayColors });
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
          SurveyHelper.getColorGradientsByDepth(s, c.stations, diffZ, maxZ, clOptions.color.start, clOptions.color.end)
        );
      });

    });
    return colorGradients;
  }

  static getColorGradientsByDepth(survey, stations, diffZ, maxZ, startColor, endColor) {
    const centerColors = [];
    const splayColors = [];
    const colorDiff = endColor.sub(startColor);
    survey.validShots.forEach((sh) => {
      const fromStation = stations.get(survey.getFromStationName(sh));
      const toStation = stations.get(survey.getToStationName(sh));

      if (fromStation !== undefined && toStation !== undefined) {
        const fromD = maxZ - fromStation.position.z;
        const toD = maxZ - toStation.position.z;
        const fc = startColor.add(colorDiff.mul(fromD / diffZ));
        const tc = startColor.add(colorDiff.mul(toD / diffZ));
        if (sh.type === 'center') {
          centerColors.push(fc.r, fc.g, fc.b, tc.r, tc.g, tc.b);
        } else if (sh.type === 'splay') {
          splayColors.push(fc.r, fc.g, fc.b, tc.r, tc.g, tc.b);
        }
      }
    });
    return { center: centerColors, splays: splayColors };
  }
}

export { SurveyHelper };
