import * as U from '../utils/utils.js';
import { SurveyHelper } from '../survey.js';
import { SurfaceHelper } from '../surface.js';
import { showErrorPanel, showWarningPanel } from '../ui/popups.js';
import { Shot, ShotType } from '../model/survey.js';
import { Vector, Surface } from '../model.js';
import { Cave, CaveMetadata } from '../model/cave.js';
import {
  SurveyMetadata,
  Survey,
  SurveyAlias,
  SurveyTeamMember,
  SurveyTeam,
  SurveyInstrument
} from '../model/survey.js';
import { MeridianConvergence } from '../utils/geo.js';
import { EOVCoordinateWithElevation, StationWithCoordinate, GeoData, CoordinateSytem } from '../model/geo.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import * as THREE from 'three';
import { SectionHelper } from '../section.js';

/**
 * Base class for cave importerers
 */
class CaveImporter {

  constructor(db, options, scene, manager) {
    this.db = db;
    this.options = options;
    this.scene = scene;
    this.manager = manager;
  }

  importFile(file, name, onCaveLoad, endcoding = 'utf8') {
    if (file) {
      const reader = new FileReader();
      const nameToUse = name ?? file.name;
      const errorMessage = `Import of ${nameToUse.substring(nameToUse.lastIndexOf('/') + 1)} failed`;
      reader.onload = async (event) => {
        try {
          await this.importText(event.target.result, onCaveLoad, nameToUse);
        } catch (e) {
          console.error(errorMessage, e);
          showErrorPanel(`${errorMessage}: ${e.message}`, 0);
        }
      };
      reader.onerror = (error) => {
        console.error(errorMessage, error);
        showErrorPanel(`${errorMessage}: ${error}`, 0);
      };
      reader.readAsText(file, endcoding);
    }
  }
}

class PolygonImporter extends CaveImporter {

  constructor(db, options, scene, manager) {
    super(db, options, scene, manager);
  }

  #getShotsFromPolygon = function (iterator) {
    var it;
    var i = 0;

    const shots = [];
    do {
      it = iterator.next();
      const parts = it.value[1].split(/\t/);
      if (parts.length > 10) {
        // splays are not supported by polygon format
        shots.push(
          new Shot(
            i++,
            ShotType.CENTER,
            parts[0],
            parts[1],
            U.parseMyFloat(parts[2]),
            U.parseMyFloat(parts[3]),
            U.parseMyFloat(parts[4]),
            parts[10]
          )
        );
      }
    } while (!it.done && it.value[1] != '');

    return shots;
  };

  getNextLineValue(iterator, start, processor = (x) => x, validator = (x) => x.length > 0) {
    if (iterator.done) {
      throw new Error(`Invalid survey, reached end of file`);
    }
    const nextLine = iterator.next();
    const lineNr = nextLine.value[0] + 1;
    if (!nextLine.value[1].startsWith(start)) {
      throw new Error(`Invalid survey, expected ${start} at line ${lineNr}`);
    }
    const parts = nextLine.value[1].split(':');
    if (parts.length !== 2) {
      throw new Error(`Invalid survey, expected value separated by : at line ${lineNr}`);
    }
    const result = processor(parts[1].trim());
    if (!validator(result)) {
      throw new Error(
        `Invalid survey, value at line ${lineNr}: "${nextLine.value[1].substring(0, 15)}" is not valid accoring to : ${validator.toString()}`
      );
    }
    return result;
  }

  getCave(wholeFileInText) {
    if (wholeFileInText.startsWith('POLYGON Cave Surveying Software')) {
      const lines = wholeFileInText.split(/\r\n|\n/);
      const lineIterator = lines.entries();
      U.iterateUntil(lineIterator, (v) => v !== '*** Project ***');
      const projectName = this.getNextLineValue(lineIterator, 'Project name');
      const settlement = this.getNextLineValue(lineIterator, 'Project place');
      const catasterCode = this.getNextLineValue(lineIterator, 'Project code');
      const madeBy = this.getNextLineValue(lineIterator, 'Made by');
      const date = this.getNextLineValue(
        lineIterator,
        'Made date',
        (x) => U.getPolygonDate(U.parseMyFloat(x)),
        (x) => x instanceof Date
      );
      const metaData = new CaveMetadata(settlement, catasterCode, date, madeBy);
      let geoData, fixPointName, convergence;
      const surveys = [];
      const stations = new Map();
      var surveyName;
      var surveyIndex = 0;

      do {
        surveyName = U.iterateUntil(lineIterator, (v) => !v.startsWith('Survey name'));

        if (surveyName !== undefined) {
          const surveyNameStr = surveyName.substring(13);
          const surveyTeamName = this.getNextLineValue(
            lineIterator,
            'Survey team',
            (x) => x,
            () => true
          ); // we allow empty team name

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
            (x) => x > 0 && x < 20
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

          fixPointName = this.getNextLineValue(
            lineIterator,
            'Fix point',
            (x) => x,
            () => true // we allow empty fix point name
          );
          let posLine = lineIterator.next();
          U.iterateUntil(lineIterator, (v) => v !== 'Survey data');
          lineIterator.next(); //From To ...
          const shots = this.#getShotsFromPolygon(lineIterator);
          let startCoordinate, startPosition;
          if (surveyIndex == 0) {
            let parts = posLine.value[1].split(/\t|\s/);
            let [y, x, z] = parts.toSpliced(3).map((x) => U.parseMyFloat(x));
            if (y !== 0 && x !== 0 && z !== 0) {
              let eovCoordinate = new EOVCoordinateWithElevation(y, x, z);
              const eovErrors = eovCoordinate.validate();
              if (eovErrors.length > 0) {
                throw new Error(`Invalid EOV coordinates for start position: ${eovErrors.join(',')}`);
              }
              startCoordinate = new StationWithCoordinate(fixPointName, eovCoordinate);
              geoData = new GeoData(CoordinateSytem.EOV, [startCoordinate]);
              startPosition = eovCoordinate.toVector();
            } else {
              startPosition = new Vector(y, x, z);
            }

            if (fixPointName != shots[0].from) {
              throw new Error(
                `Invalid Polygon survey, fix point ${fixPointName} != first shot's from value (${shots[0].from})`
              );
            }
            //calculate convergence based on the first survey
            if (startCoordinate !== undefined) {
              convergence = MeridianConvergence.getConvergence(
                startCoordinate.coordinate.y,
                startCoordinate.coordinate.x
              );
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
            stations,
            [],
            fixPointName,
            startPosition,
            startCoordinate?.coordinate
          );
          surveys.push(survey);
          surveyIndex++;
        }
      } while (surveyName !== undefined);

      return new Cave(projectName, metaData, geoData, stations, surveys);
    }
  }

  importFile(file, name, onCaveLoad, endcoding = 'iso_8859-2') {
    super.importFile(file, name, onCaveLoad, endcoding);
  }

  async importText(wholeFileInText, onCaveLoad) {
    const cave = this.getCave(wholeFileInText);
    await onCaveLoad(cave);
  }
}

class TopodroidImporter extends CaveImporter {

  constructor(db, options, scene, manager) {
    super(db, options, scene, manager);
  }

  #getShotsAndAliasesFromCsv(csvTextData) {
    const aliases = [];
    const shots = [];

    const lines = csvTextData.split(/\r\n|\n/);

    for (let i = 0; i < lines.length; i++) {
      if (lines[i] === null || lines[i] === undefined || lines[i].startsWith('#')) continue;

      const row = lines[i].split(',');
      if (row.length < 3) {
        continue;
      }

      if (row[0] === 'alias') {
        aliases.push(new SurveyAlias(row[1], row[2]));
      }

      if (row.length != 8) {
        continue;
      }
      const from = row[0];
      const to = row[1];
      const distance = U.parseMyFloat(row[2]);
      const azimuth = U.parseMyFloat(row[3]);
      const clino = U.parseMyFloat(row[4]);
      const type = to === '-' ? ShotType.SPLAY : ShotType.CENTER;
      const toName = type === ShotType.SPLAY ? undefined : to;
      shots.push(new Shot(i, type, from, toName, distance, azimuth, clino));
    }
    return [shots, aliases];
  }

  getCave(fileName, csvTextData) {
    const [shots, aliases] = this.#getShotsAndAliasesFromCsv(csvTextData);
    const stations = new Map();
    const surveyName = 'polygon';
    //TODO: add metadata
    const startStation = shots[0].from;
    const survey = new Survey(surveyName, true, new SurveyMetadata(), startStation, shots);
    SurveyHelper.calculateSurveyStations(survey, stations, aliases, startStation, new Vector(0, 0, 0));
    return new Cave(fileName, undefined, undefined, stations, [survey], aliases);
  }

  importFile(file, name, onCaveLoad) {
    super.importFile(file, name, onCaveLoad);
  }

  importText(csvTextData, onCaveLoad, name) {
    const cave = this.getCave(name, csvTextData);
    onCaveLoad(cave);
  }
}

class JsonImporter extends CaveImporter {
  constructor(db, options, scene, manager, attributeDefs) {
    super(db, options, scene, manager);
    this.attributeDefs = attributeDefs;
  }

  importFile(file, onCaveLoad) {
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => this.importJson(event.target.result, onCaveLoad);
      reader.readAsText(file);
    }
  }
  importText(wholeFileInText, onCaveLoad) {
    return this.importJson(wholeFileInText, onCaveLoad);
  }

  importJson(json, onCaveLoad) {
    const parsedCave = JSON.parse(json);
    const cave = Cave.fromPure(parsedCave, this.attributeDefs);

    [...cave.surveys.entries()]
      .forEach(([index, es]) => SurveyHelper.recalculateSurvey(index, es, cave.stations, cave.aliases, cave.geoData));

    if (cave.sectionAttributes.length > 0 || cave.componentAttributes.length > 0) {
      const g = SectionHelper.getGraph(cave);

      if (cave.sectionAttributes.length > 0) {
        cave.sectionAttributes.forEach((sa) => {
          const cs = SectionHelper.getSection(g, sa.section.from, sa.section.to);
          if (cs !== undefined) {
            sa.section = cs;
          } else {
            //TODO: show error
          }

        });
      }
      if (cave.componentAttributes.length > 0) {
        cave.componentAttributes.forEach((ca) => {
          const cs = SectionHelper.getComponent(g, ca.component.start, ca.component.termination);
          if (cs !== undefined) {
            ca.component = cs;
          } else {
            //TODO: show error
          }

        });
      }
    }

    onCaveLoad(cave);
  }
}

class PlySurfaceImporter {

  constructor(db, options, scene) {
    this.db = db;
    this.options = options;
    this.scene = scene;
  }

  addSurface(surface, cloud) {
    const cavesReallyFar = Importer.getFarCaves(this.db.caves, surface.center);

    if (this.db.getSurface(surface.name) !== undefined) {
      showErrorPanel(`Import of '${surface.name}' failed, surface has already been imported!`, 20);
    } else if (cavesReallyFar.length > 0) {
      const message = `Import of '${surface.name}' failed, the surface is too far from previously imported caves:
       ${cavesReallyFar.join(',')}`;
      showWarningPanel(message, 20);
    } else {
      this.db.addSurface(surface);
      const colorGradients = SurfaceHelper.getColorGradients(surface.points, this.options.scene.surface.color);
      const _3dobjects = this.scene.addSurfaceToScene(cloud, colorGradients);
      this.scene.addSurface(surface, _3dobjects);
      const boundingBox = this.scene.computeBoundingBox();
      this.scene.grid.adjust(boundingBox);
      this.scene.view.fitScreen(boundingBox);
    }
  }

  importFile(file) {
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => this.importText(file.name, event.target.result);
      reader.readAsText(file);
    }
  }

  importText(fileName, text) {
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
    const surface = new Surface(fileName, points, new Vector(center.x, center.y, center.z));
    this.addSurface(surface, cloud);
  }
}

export { PolygonImporter, TopodroidImporter, JsonImporter, PlySurfaceImporter };
