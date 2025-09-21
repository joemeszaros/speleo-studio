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

import { toPolar, degreesToRads, radsToDegrees } from './utils.js';
import { Polar } from '../model.js';
import { i18n } from '../i18n/i18n.js';

export class CycleUtil {

  /**
   * Helper method to find a shot between two stations
   * @param {SurveyStation} fromStation - The source station
   * @param {string} from - Source station name
   * @param {string} to - Target station name
   * @returns {Object} Object containing shot and survey data
   */
  static _findShotBetweenStations(fromStation, from, to) {
    const shotWithSurvey = fromStation.shots.find(
      (shWst) =>
        (shWst.shot.from === from && shWst.shot.to === to) || (shWst.shot.from === to && shWst.shot.to === from)
    );

    if (!shotWithSurvey) {
      throw new Error(i18n.t('ui.editors.cycles.errors.noShotBetweenStations', { from, to }));
    }

    return shotWithSurvey;
  }

  /**
   * Helper method to get survey metadata with fallbacks
   * @param {Object} survey - Survey object
   * @returns {Object} Object containing declination and convergence
   */
  static _getSurveyMetadata(survey) {
    //TODO: remove fallback logic
    return {
      declination : survey?.metadata?.declination ?? 0.0,
      convergence : survey?.metadata?.convergence ?? 0.0
    };
  }

  /**
   * Helper method to create a Polar vector from shot data with corrections
   * @param {Object} shot - Shot object
   * @param {number} declination - Declination correction
   * @param {number} convergence - Convergence correction
   * @returns {Vector3} Vector representation of the shot
   */
  static _createShotVector(shot, declination, convergence) {
    return new Polar(
      shot.length,
      degreesToRads(shot.azimuth + declination + convergence),
      degreesToRads(shot.clino)
    ).toVector();
  }

  /**
   * Helper method to validate loop path
   * @param {string[]} path - Array of station names
   * @param {Map<string, SurveyStation>} stations - Map of stations
   */
  static _validateLoopPath(path, stations) {
    if (!Array.isArray(path) || path.length < 3) {
      throw new Error(i18n.t('ui.editors.cycles.errors.pathMustBeArray'));
    }

    if (path[0] !== path[path.length - 1]) {
      throw new Error(i18n.t('ui.editors.cycles.errors.pathMustFormLoop'));
    }

    const missingStation = path.find((stationName) => !stations.has(stationName));
    if (missingStation) {
      throw new Error(i18n.t('ui.editors.cycles.errors.stationNotFound', { station: missingStation }));
    }
  }

  /**
   * Calculates the loop closure error for a given path through survey stations
   * @param {string[]} path - Array of station names representing the loop path
   * @param {Map<string, SurveyStation>} stations - Map from station names to SurveyStation objects
   * @returns {Object} Object containing distance, azimuth, and clino of the loop closure error (in radians)
   */
  static calculateCycleError(path, stations) {
    this._validateLoopPath(path, stations);

    let totalLength = 0;
    const startStation = stations.get(path[0]);
    let startPosition = startStation.position.clone();
    let calculatedPosition = startStation.position.clone(); // Start from the known position

    // Follow the path through each station
    for (let i = 0; i < path.length - 1; i++) {
      const from = path[i];
      const to = path[i + 1];
      const fromStation = stations.get(from);

      const { shot } = this._findShotBetweenStations(fromStation, from, to);

      const v = this._createShotVector(shot, 0, 0);

      if (shot.from === from) {
        calculatedPosition = calculatedPosition.add(v);
      } else if (shot.from === to) {
        calculatedPosition = calculatedPosition.sub(v);
      }
      totalLength += shot.length;
    }

    const closureError = startPosition.sub(calculatedPosition);
    const polarError = toPolar(closureError);

    return {
      totalLength : totalLength,
      error       : new Polar(
        polarError.distance,
        polarError.distance < 0.0001 ? 0 : polarError.azimuth,
        polarError.distance < 0.0001 ? 0 : polarError.clino
      )
    };
  }

  /**
   * Applies the Bowditch rule to distribute loop closure error through the shots in a loop
   * The Bowditch rule distributes the closure error proportionally to each shot based on their lengths
   * @param {string[]} path - Array of station names representing the loop path
   * @param {Map<string, SurveyStation>} stations - Map from station names to SurveyStation objects
   * @param {Polar} closureError - The loop closure error object with distance, azimuth, and clino
   * @param {number} totalLength - The total length of the loop
   * @returns {Object} Object containing the applied corrections to each shot
   */
  static propagateError(path, stations, closureError, totalLength) {
    this._validateLoopPath(path, stations);

    // If the closure error is very small, no correction needed
    if (closureError.distance < 0.0001) {
      return false;
    }

    for (let i = 0; i < path.length - 1; i++) {
      const from = path[i];
      const to = path[i + 1];
      const fromStation = stations.get(from);
      const { shot } = this._findShotBetweenStations(fromStation, from, to);
      const errorProportion = shot.length / totalLength;
      const correction = closureError.mul(errorProportion).toVector();
      const shotVector = this._createShotVector(shot, 0, 0);
      let newShotPolar;
      if (shot.from === from) {
        const newShotVector = shotVector.add(correction);
        newShotPolar = newShotVector.toPolar();
      } else {
        const newShotVector = shotVector.sub(correction);
        newShotPolar = newShotVector.toPolar();
      }
      shot.length = newShotPolar.distance;
      shot.azimuth = radsToDegrees(newShotPolar.azimuth);
      shot.clino = radsToDegrees(newShotPolar.clino);
    }
    return true;
  }

  static findLoopDeviationShots(path, stations) {
    this._validateLoopPath(path, stations);

    const result = [];

    for (let i = 0; i < path.length - 1; i++) {
      const from = path[i];
      const to = path[i + 1];
      const fromStation = stations.get(from);
      const toStation = stations.get(to);

      const { shot, survey } = this._findShotBetweenStations(fromStation, from, to);
      const { declination, convergence } = this._getSurveyMetadata(survey);

      const shotVector = this._createShotVector(shot, declination, convergence);

      let diff, newShotPolar;
      if (shot.from === from) {
        diff = fromStation.position.add(shotVector).sub(toStation.position);
        newShotPolar = shotVector.sub(diff).toPolar();
      } else {
        diff = toStation.position.add(shotVector).sub(fromStation.position);
        newShotPolar = shotVector.sub(diff).toPolar();
      }

      const newShot = {
        length  : newShotPolar.distance,
        azimuth : radsToDegrees(newShotPolar.azimuth) - declination - convergence,
        clino   : radsToDegrees(newShotPolar.clino)
      };

      if (diff.length() > 0.01) {
        result.push({
          shot,
          diff,
          newShot,
          declination,
          convergence
        });
      }
    }

    return result;
  }

  static adjustShots(shotsToAdjust) {
    let adjustedShots = false;

    shotsToAdjust.forEach((s) => {
      s.shot.length = s.newShot.length;
      s.shot.azimuth = s.newShot.azimuth;
      s.shot.clino = s.newShot.clino;
      adjustedShots = true;
    });

    return adjustedShots;
  }
}
