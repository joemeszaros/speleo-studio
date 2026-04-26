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
import { showErrorPanel, showInfoPanel } from '../ui/popups.js';
import { Shot, ShotType } from '../model/survey.js';
import { Vector, PointCloud, Mesh3D, ModelFile } from '../model.js';
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
import { EncodingSelectionDialog } from '../ui/encoding-selection-dialog.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import * as THREE from 'three';
import { i18n } from '../i18n/i18n.js';
import { PointCloudOctree } from '../utils/point-cloud-octree.js';
import { Importer } from './importer-base.js';
import { TherionImporter } from './therion-importer.js';

class PolygonImporter extends Importer {

  constructor(db, options, scene, manager) {
    super(db, options, scene, manager);
    this.coordinateSystemDialog = new CoordinateSystemDialog();
    this.encodingSelectionDialog = new EncodingSelectionDialog();
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
              if (
                !globalNormalizer.isInitialized() &&
                (coordinate.type === CoordinateSystemType.UTM || coordinate.type === CoordinateSystemType.EOV)
              ) {
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

          // Only store start station for the first survey
          const surveyStart = surveyIndex === 0 ? fixPointName : undefined;
          const survey = new Survey(surveyNameStr, true, metadata, surveyStart, shots);
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

  async importFile(file, name, onCaveLoad) {
    const encoding = await this.encodingSelectionDialog.show(file.name);
    await super.importFile(file, name, onCaveLoad, encoding);
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

      const trimmedLine = fixPointHeader === null ? line.substring(1).trim() : line.trim();

      // we loose precision information and h_geo here
      //# station, lon, lat, h_geo, accuracy, V_accuracy, comment, CRS
      //0, 19.004823, 47.652094, 161, 78.5, 55.1,"ass",

      if (fixPointHeader !== null) {
        const headerParts = fixPointHeader.split(',').map((p) => p.trim());
        const parts = trimmedLine.split(',').map((p) => p.trim());
        if (parts.length === headerParts.length) {
          metadata.fixPointStation = parts[headerParts.indexOf('station')];
          const lat = parts[headerParts.indexOf('lat')];
          const lonIndex = headerParts.indexOf('lon');
          const lon = parts[lonIndex !== -1 ? lonIndex : headerParts.indexOf('lng')];

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

      if (
        trimmedLine.includes('lat') &&
        (trimmedLine.includes('lon') || trimmedLine.includes('lng')) &&
        trimmedLine.includes('station')
      ) {
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

  async importFile(file, name, onSurveyLoad) {
    await super.importFile(file, name, onSurveyLoad);
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

  async importFile(file, name, onCaveLoad, endcoding = 'utf8') {
    await super.importFile(file, name, onCaveLoad, endcoding);
  }

  async importText(wholeFileInText, onCaveLoad) {
    const cave = this.importJson(wholeFileInText, onCaveLoad);
    // replace cave id to avoid conflicts with existing caves
    cave.id = Cave.generateId();
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

/**
 * Base class for point cloud importers (PLY and LAS/LAZ).
 * Provides shared octree creation, caching, and coordinate normalization.
 */
class PointCloudImporter extends Importer {

  // Increment when octree construction or position encoding changes to invalidate stale caches
  static OCTREE_CACHE_VERSION = 3;

  createOctreeFromNodes(msg, name, opts) {
    const octree = new PointCloudOctree(msg.nodes, opts);

    // Position the model: positions were centered in the worker (for Float32 precision).
    // positionOffset = the bbox center that was subtracted.
    // group.position = positionOffset (- globalOrigin if one exists), so that:
    //   rendered = group.position + local_vertex = (C - origin) + (P - C) = P - origin
    const po = msg.header.positionOffset || [0, 0, 0];
    let groupX = po[0], groupY = po[1], groupZ = po[2];

    if (globalNormalizer.isInitialized()) {
      const origin = globalNormalizer.globalOrigin;
      if (origin) {
        const ox = origin.easting !== undefined ? origin.easting : origin.y || 0;
        const oy = origin.northing !== undefined ? origin.northing : origin.x || 0;
        const oz = origin.elevation || 0;
        groupX -= ox;
        groupY -= oy;
        groupZ -= oz;
      }
    }

    octree.group.position.set(groupX, groupY, groupZ);

    const samplePoints = this.samplePointsFromLeaves(msg.nodes);
    const center = this.computeOctreeCenter(msg.header);
    const pointCloud = new PointCloud(name, samplePoints, center, msg.hasColors);
    pointCloud.octree = octree;
    pointCloud.hasOctree = true;
    pointCloud.firstPointCoords = msg.firstPoint || null;

    return { pointCloud, octree };
  }

  async tryLoadOctreeFromCache(modelFileId, name, onModelLoad, opts) {
    if (!this.manager?.modelSystem) return false;
    try {
      document.dispatchEvent(
        new CustomEvent('pointCloudLoadProgress', {
          detail : { message: i18n.t('ui.loading.octreeCacheReading'), percent: 0, phase: 'cache-read' }
        })
      );
      const cached = await this.manager.modelSystem.getOctreeCache(modelFileId);
      if (!cached || cached.maxPoints !== opts.maxPoints || cached.cacheVersion !== PointCloudImporter.OCTREE_CACHE_VERSION) return false;

      console.log(
        `Octree: loading from cache (${cached.nodeCount} nodes, point budget: ${opts.pointBudget.toLocaleString()})`
      );

      document.dispatchEvent(
        new CustomEvent('pointCloudLoadProgress', {
          detail : {
            message : i18n.t('ui.loading.octreeCacheBuilding'),
            percent : 60,
            phase   : 'cache-build'
          }
        })
      );
      const result = this.createOctreeFromNodes(cached, name, opts);
      document.dispatchEvent(
        new CustomEvent('pointCloudLoadProgress', {
          detail : {
            message : i18n.t('ui.loading.lasOctreeBuilding', { count: cached.nodeCount }),
            percent : 95,
            phase   : 'cache-build'
          }
        })
      );
      await onModelLoad(result.pointCloud, result.octree.group);
      return true;
    } catch (e) {
      console.warn('Octree cache load failed, falling back to worker:', e);
      return false;
    }
  }

  saveOctreeToCache(modelFileId, msg, maxPoints) {
    if (!this.manager?.modelSystem) return;

    const projectSystem = this.manager.projectSystem;
    const projectId = projectSystem?.getCurrentProject()?.id;
    if (!projectId) return;

    this.manager.modelSystem
      .saveOctreeCache(modelFileId, projectId, {
        nodes           : msg.nodes,
        header          : msg.header,
        hasColors       : msg.hasColors,
        totalPoints     : msg.totalPoints,
        displayedPoints : msg.displayedPoints,
        nodeCount       : msg.nodeCount,
        maxPoints       : maxPoints,
        cacheVersion    : PointCloudImporter.OCTREE_CACHE_VERSION
      })
      .catch((err) => console.warn('Failed to cache octree:', err));
  }

  samplePointsFromLeaves(nodes) {
    const points = [];
    const maxSamplePoints = 50000;
    let totalLeafPoints = 0;

    for (const node of nodes) {
      if (node.isLeaf) totalLeafPoints += node.pointCount;
    }

    const skip = Math.max(1, Math.floor(totalLeafPoints / maxSamplePoints));
    let globalIdx = 0;

    for (const node of nodes) {
      if (!node.isLeaf) continue;
      const pos = node.positions;
      for (let i = 0; i < node.pointCount; i++) {
        if (globalIdx % skip === 0) {
          points.push(new Vector(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]));
        }
        globalIdx++;
      }
    }

    return points;
  }

  computeOctreeCenter(header) {
    return new Vector(
      (header.mins[0] + header.maxs[0]) / 2,
      (header.mins[1] + header.maxs[1]) / 2,
      (header.mins[2] + header.maxs[2]) / 2
    );
  }
}

class PlyModelImporter extends PointCloudImporter {

  constructor(db, options, scene, manager) {
    super(db, options, scene, manager);
  }

  async importFile(file, name, onModelLoad) {
    // Use ArrayBuffer reading for binary PLY support
    await super.importFileAsArrayBuffer(file, name, onModelLoad);
  }

  async importData(data, onModelLoad, name, modelFileId = null, sourceBlob = null) {
    const OCTREE_THRESHOLD = 5000;

    const loader = new PLYLoader();
    // PLYLoader.parse() accepts both string (ASCII PLY) and ArrayBuffer (binary PLY)
    const geometry = loader.parse(data);

    // Apply coordinate normalization if global origin is initialized
    // This handles the case where PLY coordinates are in the same coordinate system
    // as the loaded caves (e.g., UTM coordinates)
    this.normalizeGeometry(geometry);

    geometry.computeBoundingBox();
    const center = geometry.boundingBox.getCenter(new THREE.Vector3());

    // Determine if the PLY has faces (indexed geometry) or just points
    const hasFaces = geometry.index !== null && geometry.index.count > 0;
    const hasVertexColors = geometry.getAttribute('color') !== undefined;
    const centerVector = new Vector(center.x, center.y, center.z);

    // Prefer the File Blob so large PLYs don't cost an extra ArrayBuffer copy on
    // the main thread. See LasModelImporter.importData for the same rationale.
    const modelFile = new ModelFile(name, 'ply', sourceBlob instanceof Blob ? sourceBlob : data);

    if (hasFaces) {
      // PLY has faces - render as a mesh
      if (!geometry.getAttribute('normal')) {
        geometry.computeVertexNormals();
      }

      const material = hasVertexColors
        ? new THREE.MeshBasicMaterial({
            vertexColors : true,
            color        : 0xffffff,
            side         : THREE.DoubleSide
          })
        : new THREE.MeshStandardMaterial({
            color       : 0x888888,
            side        : THREE.DoubleSide,
            flatShading : false,
            roughness   : 0.8,
            metalness   : 0.1
          });

      const meshObject = new THREE.Mesh(geometry, material);
      const mesh = new Mesh3D(name, centerVector);
      await onModelLoad(mesh, meshObject, modelFile);
    } else {
      const position = geometry.getAttribute('position');
      const pointCount = position.count;

      if (pointCount > OCTREE_THRESHOLD) {
        // Large point cloud — use octree with LOD
        await this.#importAsOctree(geometry, name, modelFile, modelFileId, hasVertexColors, onModelLoad);
      } else {
        // Small point cloud — simple THREE.Points (no octree overhead)
        const points = [];
        for (let i = 0; i < pointCount; i++) {
          points.push(new Vector(position.getX(i), position.getY(i), position.getZ(i)));
        }

        const material = new THREE.PointsMaterial({
          color        : 0xffffff,
          size         : this.options.scene.models.pointSize,
          vertexColors : true
        });
        const pointsObject = new THREE.Points(geometry, material);
        const pointCloud = new PointCloud(name, points, centerVector, hasVertexColors);
        if (points.length > 0) {
          pointCloud.firstPointCoords = [points[0].x, points[0].y, points[0].z];
        }
        await onModelLoad(pointCloud, pointsObject, modelFile);
      }
    }
  }

  /**
   * Import a large PLY point cloud using the octree system.
   * Sends pre-parsed positions/colors to the worker for octree construction.
   */
  async #importAsOctree(geometry, name, modelFile, modelFileId, hasVertexColors, onModelLoad) {
    const options = this.options;
    const pointBudget = options.scene.models.pointBudget;
    const sseThreshold = options.scene.models.sseThreshold;
    const pointSize = options.scene.models.pointSize;
    const gradientColors = options.scene.models.color.gradientColors ?? [];
    const sorted = [...gradientColors].sort((a, b) => a.depth - b.depth);
    const colorStart = sorted[0]?.color ?? '#39b14d';
    const colorEnd = sorted[sorted.length - 1]?.color ?? '#9f2d2d';
    const maxPoints = options.scene.models.maxPoints;

    // Try loading from cached octree
    if (modelFileId) {
      const cached = await this.tryLoadOctreeFromCache(modelFileId, name, onModelLoad, {
        pointBudget,
        sseThreshold,
        pointSize,
        maxPoints
      });
      if (cached) return;
    }

    // Extract flat typed arrays from PLYLoader geometry
    const posAttr = geometry.getAttribute('position');
    const positions = new Float32Array(posAttr.array); // copy — worker will transfer

    let colors = null;
    if (hasVertexColors) {
      const colAttr = geometry.getAttribute('color');
      // PLY colors are Float32 (0-1), convert to Uint8 (0-255) for the worker
      colors = new Uint8Array(colAttr.count * 3);
      for (let i = 0; i < colAttr.count; i++) {
        colors[i * 3] = Math.round(colAttr.getX(i) * 255);
        colors[i * 3 + 1] = Math.round(colAttr.getY(i) * 255);
        colors[i * 3 + 2] = Math.round(colAttr.getZ(i) * 255);
      }
    }

    const bb = geometry.boundingBox;
    const bounds = {
      min : [bb.min.x, bb.min.y, bb.min.z],
      max : [bb.max.x, bb.max.y, bb.max.z]
    };

    return new Promise((resolve, reject) => {
      const workerUrl = new URL('./point-cloud-worker.js', import.meta.url);
      const worker = new Worker(workerUrl);

      worker.onmessage = async (e) => {
        const msg = e.data;

        if (msg.type === 'progress') {
          document.dispatchEvent(
            new CustomEvent('pointCloudLoadProgress', {
              detail : {
                message : i18n.t('ui.loading.lasOctreeBuilding', { count: msg.nodeCount || 0 }),
                percent : msg.percent,
                phase   : msg.phase
              }
            })
          );
        } else if (msg.type === 'result') {
          try {
            const result = this.createOctreeFromNodes(msg, name, {
              pointBudget,
              sseThreshold,
              pointSize
            });

            console.log(
              `PLY: loaded ${msg.displayedPoints.toLocaleString()} points, ${msg.nodeCount} octree nodes, point budget: ${pointBudget.toLocaleString()}`
            );

            await onModelLoad(result.pointCloud, result.octree.group, modelFile);

            this.saveOctreeToCache(modelFileId || modelFile.id, msg, maxPoints);

            resolve();
          } catch (err) {
            reject(err);
          } finally {
            worker.terminate();
          }
        } else if (msg.type === 'error') {
          worker.terminate();
          reject(new Error(msg.message));
        }
      };

      worker.onerror = (err) => {
        worker.terminate();
        reject(new Error('Octree worker error: ' + err.message));
      };

      // Transfer arrays to worker for octree construction only
      const transferables = [positions.buffer];
      if (colors) transferables.push(colors.buffer);

      worker.postMessage(
        {
          type       : 'build-octree',
          positions  : positions.buffer,
          colors     : colors ? colors.buffer : null,
          pointCount : posAttr.count,
          bounds     : bounds,
          hasColors  : hasVertexColors,
          colorStart : colorStart,
          colorEnd   : colorEnd
        },
        transferables
      );
    });
  }

  /**
   * Normalize geometry coordinates relative to the global coordinate origin.
   * This ensures PLY models with UTM/EOV coordinates appear correctly
   * relative to caves that have been loaded.
   *
   * Only normalizes if the PLY coordinates appear to be in the same coordinate
   * system (i.e., coordinates are close to the global origin). This prevents
   * breaking PLY files that use local/relative coordinates.
   *
   * @param {THREE.BufferGeometry} geometry - The geometry to normalize
   */
  normalizeGeometry(geometry) {
    if (!globalNormalizer.isInitialized()) {
      // No global origin set yet - coordinates will be used as-is
      return;
    }

    const origin = globalNormalizer.globalOrigin;
    if (!origin) return;

    const position = geometry.getAttribute('position');
    const positionArray = position.array;

    // Determine offset based on what type of coordinates are in the global origin
    // For UTM: easting/northing/elevation, for EOV: y/x/elevation
    const offsetX = origin.easting !== undefined ? origin.easting : origin.y || 0;
    const offsetY = origin.northing !== undefined ? origin.northing : origin.x || 0;
    const offsetZ = origin.elevation || 0;

    // Check if the PLY coordinates are likely in the same coordinate system
    // by examining if they're within a reasonable distance from the origin
    // If coordinates are local (near 0), don't normalize
    if (!this.shouldNormalizeCoordinates(positionArray, offsetX, offsetY)) {
      return;
    }

    console.log(`Normalizing PLY coordinates with offset: (${offsetX}, ${offsetY}, ${offsetZ})`);

    // Modify each vertex position in-place
    for (let i = 0; i < positionArray.length; i += 3) {
      positionArray[i] -= offsetX; // X coordinate
      positionArray[i + 1] -= offsetY; // Y coordinate
      positionArray[i + 2] -= offsetZ; // Z coordinate
    }

    // Mark the attribute as needing update
    position.needsUpdate = true;

    // Recompute bounding box and sphere after modifying positions
    // This is critical for raycasting to work correctly
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
  }

  /**
   * Determine if PLY coordinates should be normalized based on their values.
   * If coordinates are small (local/relative system), don't normalize.
   * If coordinates are large and close to the global origin, normalize.
   *
   * @param {Float32Array} positionArray - The vertex positions
   * @param {number} originX - The global origin X
   * @param {number} originY - The global origin Y
   * @returns {boolean} True if coordinates should be normalized
   */
  shouldNormalizeCoordinates(positionArray, originX, originY) {
    if (positionArray.length < 3) return false;

    // Sample a few points to determine coordinate system type
    const sampleCount = Math.min(100, positionArray.length / 3);
    let sumX = 0,
      sumY = 0;

    for (let i = 0; i < sampleCount * 3; i += 3) {
      sumX += positionArray[i];
      sumY += positionArray[i + 1];
    }

    const avgX = sumX / sampleCount;
    const avgY = sumY / sampleCount;

    // If the global origin has large coordinates (UTM/EOV typically > 100000)
    // and the PLY average coordinates are also large and within reasonable range
    const originMagnitude = Math.max(Math.abs(originX), Math.abs(originY));
    const plyMagnitude = Math.max(Math.abs(avgX), Math.abs(avgY));

    // Consider coordinates "global" if:
    // 1. The origin is large (UTM/EOV style coordinates)
    // 2. The PLY coordinates are also large (same order of magnitude)
    // 3. The PLY coordinates are within 100km of the origin
    const isOriginLarge = originMagnitude > 10000;
    const isPlyLarge = plyMagnitude > 10000;
    const distanceFromOrigin = Math.sqrt(Math.pow(avgX - originX, 2) + Math.pow(avgY - originY, 2));
    const isWithinRange = distanceFromOrigin < 100000; // 100km threshold

    return isOriginLarge && isPlyLarge && isWithinRange;
  }
}

/**
 * Importer for OBJ 3D model files.
 * OBJ files can contain meshes, which are imported as Three.js Mesh objects.
 */
class ObjModelImporter extends Importer {

  constructor(db, options, scene, manager) {
    super(db, options, scene, manager);
  }

  async importFile(file, name, onModelLoad) {
    await super.importFile(file, name, onModelLoad);
  }

  async importText(text, onModelLoad, name) {
    // Extract WGS84 coordinates from OBJ comments before parsing
    const embeddedCoords = ObjModelImporter.extractCoordinates(text);

    const loader = new OBJLoader();
    const object = loader.parse(text);

    // Apply coordinate normalization to all geometries in the object
    this.normalizeObject(object);

    // Compute bounding box for the entire object
    const boundingBox = new THREE.Box3().setFromObject(object);
    const center = boundingBox.getCenter(new THREE.Vector3());

    // Apply a default material if none exists
    this.applyDefaultMaterial(object);

    // File info for storage
    const modelFile = new ModelFile(name, 'obj', text);

    const mesh = new Mesh3D(name, new Vector(center.x, center.y, center.z));
    mesh.embeddedCoords = embeddedCoords;
    await onModelLoad(mesh, object, modelFile);
  }

  /**
   * Extract WGS84 coordinates from OBJ file comment headers.
   * Supports Scaniverse-style comments: # Latitude: 47.6, # Longitude: 18.9, # Elevation: 275.0
   * @param {string} text - Raw OBJ file text
   * @returns {{latitude: number, longitude: number, elevation: number}|null}
   */
  static extractCoordinates(text) {
    let latitude = null,
      longitude = null,
      elevation = null;

    const lines = text.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('#')) {
        // Stop scanning once we hit non-comment lines (geometry data)
        if (trimmed.length > 0) break;
        continue;
      }
      const latMatch = trimmed.match(/^#\s*Latitude:\s*([-\d.]+)/i);
      if (latMatch) latitude = parseFloat(latMatch[1]);

      const lonMatch = trimmed.match(/^#\s*Longitude:\s*([-\d.]+)/i);
      if (lonMatch) longitude = parseFloat(lonMatch[1]);

      const elevMatch = trimmed.match(/^#\s*Elevation:\s*([-\d.]+)/i);
      if (elevMatch) elevation = parseFloat(elevMatch[1]);
    }

    if (latitude !== null && longitude !== null) {
      return { latitude, longitude, elevation: elevation ?? 0 };
    }
    return null;
  }

  /**
   * Apply a default material to meshes that don't have one
   * Uses MeshStandardMaterial with a neutral color for proper lighting.
   * Preserves original material names in userData for future MTL loading.
   * @param {THREE.Object3D} object - The loaded OBJ object
   */
  applyDefaultMaterial(object) {
    // Phong gives sharper highlights and deeper shadows than Standard (PBR) —
    // closer to the CloudCompare look cave users expect.
    const defaultMaterial = new THREE.MeshPhongMaterial({
      color       : 0xb8b8b8,
      specular    : 0x222222,
      shininess   : 40,
      side        : THREE.DoubleSide,
      flatShading : false
    });

    object.traverse((child) => {
      if (child.isMesh) {
        // Preserve original material name(s) for future MTL loading
        if (child.material) {
          if (Array.isArray(child.material)) {
            // Multi-material mesh
            child.userData.originalMaterialNames = child.material.map((m) => m.name || null);
          } else {
            // Single material mesh
            child.userData.originalMaterialName = child.material.name || null;
          }
        }

        // Ensure normals are computed for proper shading
        if (!child.geometry.getAttribute('normal')) {
          child.geometry.computeVertexNormals();
        }

        // Use standard material for proper lighting
        // Clone to allow per-object opacity changes
        child.material = defaultMaterial.clone();
      }
    });
  }

  /**
   * Normalize object coordinates relative to the global coordinate origin.
   * @param {THREE.Object3D} object - The loaded OBJ object
   */
  normalizeObject(object) {
    if (!globalNormalizer.isInitialized()) {
      return;
    }

    const origin = globalNormalizer.globalOrigin;
    if (!origin) return;

    // Determine offset based on coordinate type
    const offsetX = origin.easting !== undefined ? origin.easting : origin.y || 0;
    const offsetY = origin.northing !== undefined ? origin.northing : origin.x || 0;
    const offsetZ = origin.elevation || 0;

    // Check if normalization should be applied by sampling vertices
    const shouldNormalize = this.shouldNormalizeObject(object, offsetX, offsetY);
    if (!shouldNormalize) {
      return;
    }

    console.log(`Normalizing OBJ coordinates with offset: (${offsetX}, ${offsetY}, ${offsetZ})`);

    // Normalize all geometries in the object
    object.traverse((child) => {
      if (child.isMesh && child.geometry) {
        this.normalizeGeometry(child.geometry, offsetX, offsetY, offsetZ);
      }
    });
  }

  /**
   * Check if the object should be normalized based on vertex positions
   * @param {THREE.Object3D} object - The loaded OBJ object
   * @param {number} originX - The global origin X
   * @param {number} originY - The global origin Y
   * @returns {boolean} True if coordinates should be normalized
   */
  shouldNormalizeObject(object, originX, originY) {
    let sumX = 0,
      sumY = 0,
      count = 0;

    object.traverse((child) => {
      if (child.isMesh && child.geometry) {
        const position = child.geometry.getAttribute('position');
        if (position) {
          const sampleCount = Math.min(100, position.count);
          for (let i = 0; i < sampleCount; i++) {
            sumX += position.getX(i);
            sumY += position.getY(i);
            count++;
          }
        }
      }
    });

    if (count === 0) return false;

    const avgX = sumX / count;
    const avgY = sumY / count;

    const originMagnitude = Math.max(Math.abs(originX), Math.abs(originY));
    const objMagnitude = Math.max(Math.abs(avgX), Math.abs(avgY));
    const distanceFromOrigin = Math.sqrt(Math.pow(avgX - originX, 2) + Math.pow(avgY - originY, 2));

    const isOriginLarge = originMagnitude > 10000;
    const isObjLarge = objMagnitude > 10000;
    const isWithinRange = distanceFromOrigin < 100000;

    return isOriginLarge && isObjLarge && isWithinRange;
  }

  /**
   * Normalize a single geometry's coordinates
   * @param {THREE.BufferGeometry} geometry - The geometry to normalize
   * @param {number} offsetX - X offset
   * @param {number} offsetY - Y offset
   * @param {number} offsetZ - Z offset
   */
  normalizeGeometry(geometry, offsetX, offsetY, offsetZ) {
    const position = geometry.getAttribute('position');
    if (!position) return;

    const positionArray = position.array;

    for (let i = 0; i < positionArray.length; i += 3) {
      positionArray[i] -= offsetX;
      positionArray[i + 1] -= offsetY;
      positionArray[i + 2] -= offsetZ;
    }

    position.needsUpdate = true;
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
  }
}

/**
 * Importer for LAS/LAZ point cloud files.
 * Parses the file in a Web Worker, builds a client-side octree with LOD,
 * and creates a PointCloudOctree for efficient rendering.
 */
class LasModelImporter extends PointCloudImporter {

  // Upper bound on the compressed buffer we can feed into laz-perf.
  // laz-perf.js (emscripten asm.js, ALLOW_MEMORY_GROWTH=0) hosts its heap in a
  // single ArrayBuffer that we pre-size before importScripts. V8 can allocate
  // ~2GB ArrayBuffers reliably; we cap at 1.5GB to leave headroom for decoder
  // state, stack and other allocations inside the WASM heap.
  static MAX_LAZ_BYTES = 1.25 * 1024 * 1024 * 1024;
  static MAX_LAS_BYTES = 2 * 1024 * 1024 * 1024;

  constructor(db, options, scene, manager) {
    super(db, options, scene, manager);
  }

  async importFile(file, name, onModelLoad) {
    if (file && typeof file.size === 'number') {
      const ext = (name || file.name || '').toLowerCase().split('.').pop();
      const isLaz = ext === 'laz';
      const limit = isLaz ? LasModelImporter.MAX_LAZ_BYTES : LasModelImporter.MAX_LAS_BYTES;
      if (file.size > limit) {
        throw new Error(i18n.t('errors.import.pointCloudFileTooLarge', {
          name  : name || file.name,
          size  : (file.size / (1024 * 1024)).toFixed(0),
          limit : (limit / (1024 * 1024)).toFixed(0)
        }));
      }
    }
    await super.importFileAsArrayBuffer(file, name, onModelLoad);
  }

  async importData(data, onModelLoad, name, modelFileId = null, sourceBlob = null) {
    const options = this.options;
    const pointBudget = options.scene.models.pointBudget;
    const sseThreshold = options.scene.models.sseThreshold;
    const pointSize = options.scene.models.pointSize;
    const gradientColors = options.scene.models.color?.gradientColors ?? [];
    const sorted = [...gradientColors].sort((a, b) => a.depth - b.depth);
    const colorStart = sorted[0]?.color ?? '#39b14d';
    const colorEnd = sorted[sorted.length - 1]?.color ?? '#9f2d2d';
    const maxPoints = options.scene.models.maxPoints;

    // Try loading from cached octree (fast path for project reload)
    if (modelFileId && this.manager?.modelSystem) {
      const cached = await this.tryLoadOctreeFromCache(modelFileId, name, onModelLoad, {
        pointBudget,
        sseThreshold,
        pointSize,
        maxPoints
      });
      if (cached) return;
    }

    // Ensure we have an ArrayBuffer
    const buffer = data instanceof ArrayBuffer ? data : await data.arrayBuffer();

    // Persist the file as a Blob without duplicating the buffer. When the importer is
    // called from a file picker we already have the File (a Blob backed by the OS file),
    // so it costs no extra RAM. On project-reload paths a ModelFile already exists in
    // IndexedDB and the callback ignores any new one, so we skip the ~1GB slice there.
    let modelFileData;
    if (sourceBlob instanceof Blob) {
      modelFileData = sourceBlob;
    } else if (modelFileId) {
      modelFileData = null;
    } else {
      modelFileData = buffer.slice(0);
    }

    return new Promise((resolve, reject) => {
      const workerUrl = new URL('./point-cloud-worker.js', import.meta.url);
      const worker = new Worker(workerUrl);

      worker.onmessage = async (e) => {
        const msg = e.data;

        if (msg.type === 'progress') {
          // Format i18n message from structured worker progress data
          let message;
          switch (msg.phase) {
            case 'header':
              message = i18n.t('ui.loading.lasHeader');
              break;
            case 'parsing':
              message = i18n.t('ui.loading.lasParsing', { percent: msg.percent });
              break;
            case 'decompressing':
              message = i18n.t('ui.loading.lazDecompressing', { percent: msg.percent });
              break;
            case 'octree':
              message = msg.nodeCount
                ? i18n.t('ui.loading.lasOctreeBuilding', { count: msg.nodeCount })
                : i18n.t('ui.loading.lasOctreeStart');
              break;
            default:
              message = i18n.t('ui.loading.openingModel');
          }
          document.dispatchEvent(
            new CustomEvent('pointCloudLoadProgress', {
              detail : { message, percent: msg.percent, phase: msg.phase }
            })
          );
        } else if (msg.type === 'result') {
          try {
            const result = this.createOctreeFromNodes(msg, name, {
              pointBudget,
              sseThreshold,
              pointSize
            });

            const modelFile = modelFileData ? new ModelFile(name, 'las', modelFileData) : null;

            if (msg.totalPoints !== msg.displayedPoints) {
              console.log(
                `LAS: loaded ${msg.displayedPoints.toLocaleString()} of ${msg.totalPoints.toLocaleString()} points (subsampled), ${msg.nodeCount} octree nodes, point budget: ${pointBudget.toLocaleString()}`
              );
              showInfoPanel(
                i18n.t('ui.loading.pointsSubsampled', {
                  name      : name,
                  displayed : msg.displayedPoints.toLocaleString(),
                  total     : msg.totalPoints.toLocaleString(),
                  max       : maxPoints.toLocaleString()
                })
              );
            } else {
              console.log(
                `LAS: loaded ${msg.displayedPoints.toLocaleString()} points, ${msg.nodeCount} octree nodes, point budget: ${pointBudget.toLocaleString()}`
              );
            }

            if (msg.warning) {
              showInfoPanel(i18n.t('ui.loading.partialLoad', {
                name    : name,
                loaded  : msg.displayedPoints.toLocaleString(),
                total   : msg.totalPoints.toLocaleString()
              }));
              console.warn('LAS parse warning:', msg.warning);
            }

            await onModelLoad(result.pointCloud, result.octree.group, modelFile);

            // Cache octree for fast reload on next project open
            // Use the stored modelFileId if reloading, otherwise the new modelFile's id
            this.saveOctreeToCache(modelFileId || modelFile.id, msg, maxPoints);

            resolve();
          } catch (err) {
            reject(err);
          } finally {
            worker.terminate();
          }
        } else if (msg.type === 'error') {
          worker.terminate();
          reject(new Error(msg.message));
        }
      };

      worker.onerror = (err) => {
        worker.terminate();
        reject(new Error('LAS worker error: ' + err.message));
      };

      // Transfer the ArrayBuffer to the worker (zero-copy)
      worker.postMessage(
        {
          type       : 'parse',
          buffer     : buffer,
          maxPoints  : maxPoints,
          colorStart : colorStart,
          colorEnd   : colorEnd
        },
        [buffer]
      );
    });
  }

}

export {
  PolygonImporter,
  TopodroidImporter,
  JsonImporter,
  PlyModelImporter,
  ObjModelImporter,
  LasModelImporter,
  TherionImporter,
  Importer
};
