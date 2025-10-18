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

import * as U from '../utils/utils.js';
import { SurveyHelper } from '../survey.js';
import { showErrorPanel } from '../ui/popups.js';
import { Shot, ShotType } from '../model/survey.js';
import { Vector, Surface } from '../model.js';
import { Cave, CaveMetadata } from '../model/cave.js';
import { SurveyMetadata, Survey, SurveyTeamMember, SurveyTeam, SurveyInstrument } from '../model/survey.js';
import { MeridianConvergence, UTMConverter } from '../utils/geo.js';
import { globalNormalizer } from '../utils/global-coordinate-normalizer.js';
import {
  EOVCoordinateWithElevation,
  UTMCoordinateWithElevation,
  StationWithCoordinate,
  GeoData,
  CoordinateSystemType,
  UTMCoordinateSystem
} from '../model/geo.js';
import { CoordinateSystemDialog } from '../ui/coordinate-system-dialog.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import * as THREE from 'three';
import { i18n } from '../i18n/i18n.js';
/**
 * Base class for cave importerers
 */
class Importer {

  constructor(db, options, scene, manager) {
    this.db = db;
    this.options = options;
    this.scene = scene;
    this.manager = manager;
  }

  async importFile(file, name, onLoadFn, endcoding = 'utf8') {
    if (!file) {
      return;
    }

    const reader = new FileReader();
    const nameToUse = name ?? file.name;
    const errorMessage = i18n.t('errors.import.importFileFailed', {
      name : nameToUse.substring(nameToUse.lastIndexOf('/') + 1)
    });

    await new Promise((resolve, reject) => {
      reader.onload = async (event) => {
        try {
          await this.importText(event.target.result, onLoadFn, name);
          resolve();
        } catch (e) {
          reject(e);
        }
      };

      reader.onerror = (error) => {
        console.error(errorMessage, error);
        showErrorPanel(`${errorMessage}: ${error}`, 0);
        reject(error);
      };

      reader.readAsText(file, endcoding);
    });
  }

  static setupFileInputListener(config) {
    const { inputId, handlers, onLoad } = config;

    const input = document.getElementById(inputId);

    input.addEventListener('change', async (e) => {
      const files = Array.from(e.target.files);

      try {
        for (const file of files) {
          try {
            let handler;
            const extension = file.name.toLowerCase().split('.').pop();

            handler = handlers.get(extension);

            if (handler === undefined) {
              throw new Error(i18n.t('errors.import.unsupportedFileType', { extension }));
            }
            // Serialize cave file imports to prevent coordinate system dialog conflicts
            await handler.importFile(file, file.name, async (importedData, arg1) => {
              await onLoad(importedData, arg1);
            });
          } catch (error) {
            const msgPrefix = i18n.t('errors.import.importFileFailed', { name: file.name });
            showErrorPanel(`${msgPrefix}: ${error.message}`);
            console.error(msgPrefix, error);
          }
        }
      } catch (error) {
        console.error(i18n.t('errors.import.importFailed'), error);
      } finally {
        // Always clear the input value, regardless of success or failure
        input.value = '';
      }
    });
  }
}

class PolygonImporter extends Importer {

  constructor(db, options, scene, manager) {
    super(db, options, scene, manager);
    this.coordinateSystemDialog = new CoordinateSystemDialog();
  }

  #getShotsFromPolygon = function (iterator) {
    var it;
    var i = 0;

    const shots = [];
    do {
      it = iterator.next();
      const parts = it.value[1].split(/\t/).map((p) => p.trim());
      if (parts.length > 10) {
        // splays are not supported by polygon format
        shots.push(
          new Shot(
            i++,
            parts[1] === '' || parts[1] === '-' ? ShotType.SPLAY : ShotType.CENTER,
            parts[0],
            parts[1] === '' ? undefined : parts[1],
            U.parseMyFloat(parts[2]),
            U.parseMyFloat(parts[3]),
            U.parseMyFloat(parts[4]),
            parts[10] === '' ? undefined : parts[10]
          )
        );
      }
    } while (!it.done && it.value[1] != '');

    return shots;
  };

  getNextLineValue(iterator, start, processor = (x) => x, validator = (x) => x.length > 0) {
    if (iterator.done) {
      throw new Error(i18n.t('errors.import.invalidSurveyReachedEndOfFile'));
    }
    const nextLine = iterator.next();
    const lineNr = nextLine.value[0] + 1;
    if (!nextLine.value[1].startsWith(start)) {
      throw new Error(i18n.t('errors.import.invalidSurveyExpectedValue', { start, lineNr }));
    }
    const parts = nextLine.value[1].split(':');
    if (parts.length !== 2) {
      throw new Error(i18n.t('errors.import.invalidSurveySeparator', { lineNr }));
    }
    const result = processor(parts[1].trim());
    if (!validator(result)) {
      throw new Error(
        i18n.t('errors.import.invalidSurveyValidation', {
          lineNr,
          value : nextLine.value[1].substring(0, 15),
          rule  : validator.toString()
        })
      );
    }
    return result;
  }

  async getCave(wholeFileInText) {
    if (wholeFileInText.startsWith('POLYGON Cave Surveying Software')) {
      const lines = wholeFileInText.split(/\r\n|\n/);
      const lineIterator = lines.entries();
      U.iterateUntil(lineIterator, (v) => v !== '*** Project ***');

      const getOptional = (fieldName) =>
        this.getNextLineValue(
          lineIterator,
          fieldName,
          (x) => x,
          () => true
        );

      const projectName = this.getNextLineValue(lineIterator, 'Project name');
      const region = getOptional('Project place');
      const catasterCode = getOptional('Project code');
      const madeBy = getOptional('Made by');
      const date = this.getNextLineValue(
        lineIterator,
        'Made date',
        (x) => U.getPolygonDate(U.parseMyFloat(x)),
        (x) => x instanceof Date
      );
      const metadata = new CaveMetadata(undefined, region, undefined, catasterCode, date, madeBy);
      let geoData, fixPointName, convergence;
      const surveys = [];
      const stations = new Map();
      var surveyName;
      var surveyIndex = 0;
      let coordinateSystem;

      do {
        surveyName = U.iterateUntil(lineIterator, (v) => !v.startsWith('Survey name'));

        if (surveyName !== undefined) {
          const surveyNameStr = surveyName.substring(13);
          if (surveys.find((s) => s.name === surveyNameStr)) {
            throw new Error(i18n.t('errors.import.surveyNameAlreadyExists', { name: surveyNameStr }));
          }
          const surveyTeamName = getOptional('Survey team');

          const members = [];
          for (let i = 0; i < 5; i++) {
            const memberStr = lineIterator.next().value[1];
            if (memberStr.length > 0) {
              const [name, role] = memberStr.split('\t').map((x) => x.trim());
              if (name.length > 0) {
                members.push(new SurveyTeamMember(name, role));
              }
            }
          }
          const surveyDate = this.getNextLineValue(
            lineIterator,
            'Survey date',
            (x) => U.getPolygonDate(U.parseMyFloat(x)),
            (x) => x instanceof Date
          );
          const declination = this.getNextLineValue(
            lineIterator,
            'Declination',
            (x) => U.parseMyFloat(x),
            (x) => x >= -25 && x < 30
          );
          U.iterateUntil(lineIterator, (v) => !v.startsWith('Instruments'));
          const instruments = [];
          for (let i = 0; i < 3; i++) {
            const instrumentStr = lineIterator.next().value[1];
            if (instrumentStr.length > 0) {
              const [instrument, correction] = instrumentStr.split('\t').map((x) => x.trim());
              if (instrument.length > 0) {
                instruments.push(new SurveyInstrument(instrument, correction));
              }
            }
          }

          fixPointName = getOptional('Fix point');
          let posLine = lineIterator.next();
          U.iterateUntil(lineIterator, (v) => v !== 'Survey data');
          lineIterator.next(); //From To ...
          const shots = this.#getShotsFromPolygon(lineIterator);
          let startCoordinate, startPosition;
          if (surveyIndex == 0) {
            let parts = posLine.value[1].split(/\t|\s/);
            let [f1, f2, f3] = parts.toSpliced(3).map((x) => U.parseMyFloat(x));
            // Show coordinate system selection dialog
            // Y X elevation for EOV
            // easting northing elevation for UTM
            const result = await this.coordinateSystemDialog.show(projectName, [f1, f2, f3]);
            coordinateSystem = result.coordinateSystem;

            const [coord1, coord2, coord3] = result.coordinates;

            if (coordinateSystem !== undefined) {
              let coordinate;
              if (coordinateSystem.type === CoordinateSystemType.EOV) {
                coordinate = new EOVCoordinateWithElevation(coord1, coord2, coord3);
              } else if (coordinateSystem.type === CoordinateSystemType.UTM) {
                coordinate = new UTMCoordinateWithElevation(coord1, coord2, coord3);
              }
              const coordinateErrors = coordinate.validate(i18n);
              if (coordinateErrors.length > 0) {
                throw new Error(
                  i18n.t('errors.import.invalidCoordinates', {
                    name  : surveyNameStr,
                    error : coordinateErrors.join(',')
                  })
                );
              }

              startCoordinate = new StationWithCoordinate(fixPointName, coordinate);
              geoData = new GeoData(coordinateSystem, [startCoordinate]);
              // Initialize global origin from the first cave with coordinates (only if not already initialized)
              if (!globalNormalizer.isInitialized() && coordinate.type === CoordinateSystemType.UTM) {
                globalNormalizer.initializeGlobalOrigin(coordinate);
              }
              // Use normalized coordinates to avoid floating-point precision issues with large UTM values
              startPosition = coordinate.toNormalizedVector();
            } else {
              startPosition = new Vector(coord1, coord2, coord3);
            }

            if (fixPointName != shots[0].from) {
              throw new Error(
                i18n.t('errors.import.invalidPolygonFixPoint', {
                  name  : surveyNameStr,
                  fixPointName,
                  shots : shots[0].from
                })
              );
            }
            //calculate convergence based on the first survey
            if (startCoordinate !== undefined) {
              if (startCoordinate.coordinate.type === CoordinateSystemType.EOV) {
                convergence = MeridianConvergence.getEOVConvergence(
                  startCoordinate.coordinate.y,
                  startCoordinate.coordinate.x
                );
              } else if (startCoordinate.coordinate.type === CoordinateSystemType.UTM) {
                convergence = MeridianConvergence.getUTMConvergence(
                  startCoordinate.coordinate.easting,
                  startCoordinate.coordinate.northing,
                  geoData.coordinateSystem.zoneNum,
                  geoData.coordinateSystem.northern
                );
              }
            }
          }

          const metadata = new SurveyMetadata(
            surveyDate,
            declination,
            convergence,
            new SurveyTeam(surveyTeamName, members),
            instruments
          );

          const survey = new Survey(surveyNameStr, true, metadata, fixPointName, shots);
          SurveyHelper.calculateSurveyStations(
            survey,
            surveys,
            stations,
            [],
            fixPointName,
            startPosition,
            startCoordinate?.coordinate,
            coordinateSystem
          );
          surveys.push(survey);
          surveyIndex++;
        }
      } while (surveyName !== undefined);

      return new Cave(projectName, metadata, geoData, stations, surveys);
    }
  }

  async importFile(file, name, onCaveLoad, endcoding = 'iso_8859-2') {
    await super.importFile(file, name, onCaveLoad, endcoding);
  }

  async importText(wholeFileInText, onCaveLoad) {
    const cave = await this.getCave(wholeFileInText);
    await onCaveLoad(cave);
  }
}

/**
 * Hopefully robust TopoDroid CSV importer that recognizes survey metadata section and
 * find the shot data section containing the shots. This should prevent import failures
 * due to format changes in TopoDroid.
 */
class TopodroidImporter extends Importer {

  constructor(db, options, scene, manager) {
    super(db, options, scene, manager);
  }

  #parseMetadata(lines) {
    const metadata = {
      name            : null,
      date            : null,
      team            : null,
      comment         : null,
      declination     : null,
      units           : null,
      latitude        : null,
      longitude       : null,
      fixPointStation : null
    };

    let fixPointHeader = null;

    for (const line of lines) {
      if (!line.startsWith('#') && fixPointHeader === null) continue;

      const trimmedLine = line.substring(1).trim();

      // we loose precision information and h_geo here
      //# station, lon, lat, h_geo, accuracy, V_accuracy, comment, CRS
      //0, 19.004823, 47.652094, 161, 78.5, 55.1,"ass",

      if (fixPointHeader !== null) {
        const headerParts = fixPointHeader.split(',').map((p) => p.trim());
        const parts = trimmedLine.split(',').map((p) => p.trim());
        if (parts.length === headerParts.length) {
          metadata.fixPointStation = parts[headerParts.indexOf('station')];
          const lat = parts[headerParts.indexOf('lat')];
          const lon = parts[headerParts.indexOf('lon')];

          if (U.isFloatStr(lon) && U.isFloatStr(lat)) {
            const latFloat = U.parseMyFloat(lat);
            const lonFloat = U.parseMyFloat(lon);
            metadata.latitude = latFloat;
            metadata.longitude = lonFloat;
          } else {
            console.warn(`Skipping invalid fix point line without latitude and longitude: ${trimmedLine}`);
            continue;
          }

        }

        fixPointHeader = null;
        continue;
      }

      if (trimmedLine.includes('lat') && trimmedLine.includes('lon') && trimmedLine.includes('station')) {
        fixPointHeader = trimmedLine;
        continue;
      }

      Object.keys(metadata).forEach((key) => {
        if (trimmedLine.includes(`${key}:`)) {
          const value = trimmedLine.split(`${key}:`)[1].trim();
          metadata[key] = value ? value : null;
        }
      });

      if (metadata.declination && U.isFloatStr(metadata.declination)) {
        metadata.declination = U.parseMyFloat(metadata.declination);
      } else if (metadata.declination) {
        // it has a non-float value
        metadata.declination = null;
      }

    }

    return metadata;
  }

  #findShotDataSection(lines) {
    let shotDataStart = -1;
    let shotDataEnd = -1;
    let headerLine = null;

    for (let i = 0; i < lines.length; i++) {
      if (lines[i] === null || lines[i] === undefined || lines[i].trim() === '') continue;
      const line = lines[i];

      // Look for header line that contains "from" and "to"
      if (line.startsWith('#') && line.includes('from') && line.includes('to')) {
        if (line.includes('status')) {
          // TopoDroid long format
          throw new Error(i18n.t('errors.import.longFormatNotSupported'));
        }
        headerLine = line.substring(1).trim();
        shotDataStart = i + 1;
        continue;
      }

      // Look for end of shot data (empty line or next section)
      if (shotDataStart !== -1 && shotDataEnd === -1) {
        // next section of header with commented lines, except the following line
        if (line.startsWith('#') && !line.startsWith('# units')) {
          shotDataEnd = i;
          break;
        }
      }
    }

    return { shotDataStart, shotDataEnd, headerLine };
  }

  #parseShotData(lines, startIndex, endIndex, headerLine) {
    const shots = [];
    let surveyName;
    if (!headerLine) {
      throw new Error(i18n.t('errors.import.noHeaderLine'));
    }

    // Parse header to understand column positions
    const headerColumns = headerLine.split(/[,\s]+/).map((col) => col.trim().toLowerCase());
    const fromIndex = headerColumns.indexOf('from');
    const toIndex = headerColumns.indexOf('to');
    const tapeIndex = headerColumns.indexOf('tape');
    const compassIndex = headerColumns.indexOf('compass');
    const clinoIndex = headerColumns.indexOf('clino');
    const commentIndex = headerColumns.indexOf('comment');
    const maxIndex = Math.max(fromIndex, toIndex, tapeIndex, compassIndex, clinoIndex) + 1;
    if (fromIndex === -1 || toIndex === -1) {
      throw new Error(i18n.t('errors.import.noFromToInHeader', { header: headerLine }));
    }

    const stopIndex = endIndex > 0 ? endIndex : lines.length;
    const withoutQuotes = (s) => (s && s.startsWith('"') && s.endsWith('"') ? s.substring(1, s.length - 1) : s);

    for (let i = startIndex; i < stopIndex; i++) {
      const line = lines[i];
      if (!line || line.trim() === '') continue;

      const row = line.split(',').map((c) => c.trim());

      if (row.length < maxIndex) {
        continue; // Skip incomplete rows
      }

      let from = withoutQuotes(row[fromIndex]);
      let to = withoutQuotes(row[toIndex]);

      if (!from && !to) {
        console.error(`Skipping invalid line without from and to: ${line}`);
        continue;
      }

      if (from && from.includes('@')) {
        const fp = from.split('@');
        from = fp[0];
        if (!surveyName) {
          surveyName = fp[1];
        }
      }

      if (to && to.includes('@')) {
        const tp = to.split('@');
        to = tp[0];
        if (!surveyName) {
          surveyName = tp[1];
        }
      }

      const distance = tapeIndex !== -1 ? U.parseMyFloat(withoutQuotes(row[tapeIndex])) : 0;
      const azimuth = compassIndex !== -1 ? U.parseMyFloat(withoutQuotes(row[compassIndex])) : 0;
      const clino = clinoIndex !== -1 ? U.parseMyFloat(withoutQuotes(row[clinoIndex])) : 0;
      let comment = commentIndex !== -1 ? withoutQuotes(row[commentIndex]) : undefined;

      // Determine shot type
      const type = to === '-' || to === '' ? ShotType.SPLAY : ShotType.CENTER;
      const toName = type === ShotType.SPLAY ? undefined : to;

      shots.push(new Shot(i, type, from, toName, distance, azimuth, clino, comment));
    }

    return { shots, surveyName };
  }

  #getShotsAndMetadata(csvTextData) {
    const lines = csvTextData.split(/\r\n|\n/);
    const metadata = this.#parseMetadata(lines);
    const { shotDataStart, shotDataEnd, headerLine } = this.#findShotDataSection(lines);

    if (shotDataStart === -1) {
      throw new Error(i18n.t('errors.import.noShotDataSection'));
    }
    const { shots, surveyName } = this.#parseShotData(lines, shotDataStart, shotDataEnd, headerLine);

    if (!metadata.name && surveyName) {
      metadata.name = surveyName;
    }

    return { shots, metadata };
  }

  #createSurveyMetadata(metadata) {
    const surveyDate = metadata.date ? new Date(metadata.date) : new Date();
    const declination = metadata.declination;

    // Create team if team name is provided
    let team = null;
    if (metadata.team) {
      team = new SurveyTeam(metadata.team, []);
    }

    return new SurveyMetadata(surveyDate, declination, null, team, []);
  }

  getSurvey(csvTextData) {
    const { shots, metadata } = this.#getShotsAndMetadata(csvTextData);

    if (shots.length === 0) {
      throw new Error(i18n.t('errors.import.noShotTopodroid'));
    }

    const surveyMetadata = this.#createSurveyMetadata(metadata);
    const startStation = shots[0].from;
    const surveyName = metadata.name || 'TopoDroid Survey';
    let fixPointGeoData = null;
    if (metadata.fixPointStation !== null && metadata.latitude !== null && metadata.longitude !== null) {
      const utmCoordinates = UTMConverter.fromLatLon(metadata.latitude, metadata.longitude);
      const fixPointCoordinate = new UTMCoordinateWithElevation(
        U.roundToTwoDecimalPlaces(utmCoordinates.easting),
        U.roundToTwoDecimalPlaces(utmCoordinates.northing),
        0
      );
      const fixPointCoordinateSystem = new UTMCoordinateSystem(
        utmCoordinates.zoneNum,
        utmCoordinates.zoneLetter >= 'N'
      );

      const fixPointStation = new StationWithCoordinate(metadata.fixPointStation, fixPointCoordinate);
      fixPointGeoData = new GeoData(fixPointCoordinateSystem, [fixPointStation]);
    }
    return { survey: new Survey(surveyName, true, surveyMetadata, startStation, shots), geoData: fixPointGeoData };
  }

  importFile(file, name, onSurveyLoad) {
    super.importFile(file, name, onSurveyLoad);
  }

  async importText(csvTextData, onSurveyLoad) {
    const result = this.getSurvey(csvTextData);
    await onSurveyLoad(result);
  }
}

//FIXME: check attibute name + id matching
// check JSON serialization in Java
class JsonImporter extends Importer {
  constructor(db, options, scene, manager, attributeDefs) {
    super(db, options, scene, manager);
    this.attributeDefs = attributeDefs;
  }

  importFile(file, name, onCaveLoad, endcoding = 'utf8') {
    super.importFile(file, name, onCaveLoad, endcoding);
  }

  async importText(wholeFileInText, onCaveLoad) {
    const cave = this.importJson(wholeFileInText, onCaveLoad);
    await onCaveLoad(cave);
  }

  importJson(json) {
    const parsedCave = JSON.parse(json);
    const cave = Cave.fromPure(parsedCave, this.attributeDefs);

    [...cave.surveys.entries()]
      .forEach(([index, es]) =>
        SurveyHelper.recalculateSurvey(index, es, cave.surveys, cave.stations, cave.aliases, cave.geoData)
      );

    return cave;
  }
}

class PlySurfaceImporter extends Importer {

  constructor(db, options, scene, manager) {
    super(db, options, scene, manager);
  }

  importFile(file, name, onModelLoad) {
    super.importFile(file, name, onModelLoad);
  }

  async importText(text, onModelLoad, name) {
    const loader = new PLYLoader();
    const geometry = loader.parse(text);
    geometry.computeBoundingBox();
    const center = geometry.boundingBox.getCenter(new THREE.Vector3());
    const material = new THREE.PointsMaterial({
      color        : 0xffffff,
      size         : 2,
      vertexColors : true
    });
    const cloud = new THREE.Points(geometry, material);
    const position = geometry.getAttribute('position');
    const points = [];

    for (let i = 0; i < position.count; i++) {
      const point = new Vector(position.getX(i), position.getY(i), position.getZ(i));
      points.push(point);
    }
    const surface = new Surface(name, points, new Vector(center.x, center.y, center.z));
    await onModelLoad(surface, cloud);
  }
}

export { PolygonImporter, TopodroidImporter, JsonImporter, PlySurfaceImporter, Importer };
