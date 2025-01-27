import * as U from '../utils/utils.js';
import { SurveyHelper } from '../survey.js';
import { SurfaceHelper } from '../surface.js';
import { showErrorPanel, showWarningPanel } from '../ui/popups.js';
import { CAVES_MAX_DISTANCE } from '../constants.js';
import {
  Shot,
  Survey,
  Cave,
  SurveyStartStation,
  Vector,
  SurveyStation,
  SurveyAlias,
  Surface,
  CaveMetadata
} from '../model.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import * as THREE from 'three';
import { SectionHelper } from '../section.js';

class Importer {

  /**
   * Get a list of caves that are farther than a specified distance from a given position.
   *
   * @param {Map<string, Cave>} caves - A map of cave objects, where each key is a cave identifier and each value is a cave object.
   * @param {Vector} position - The position to measure the distance from.
   * @returns {Array<string>} An array of strings, each representing a cave name and its distance from the position, formatted as "caveName - distance m".
   */
  static getFarCaves(caves, position) {
    return Array.from(caves.values()).reduce((acc, c) => {
      const distanceBetweenCaves = c.startPosition.distanceTo(position);
      if (distanceBetweenCaves > CAVES_MAX_DISTANCE) {
        acc.push(`${c.name} - ${U.formatDistance(distanceBetweenCaves, 0)}`);
      }
      return acc;
    }, []);
  }
}

/**
 * Base class for cave importerers
 */
class CaveImporter {

  constructor(db, options, scene, explorer) {
    this.db = db;
    this.options = options;
    this.scene = scene;
    this.explorer = explorer;
  }

  /**
   * Adds a freshly importeed cave to the scene and to the database.
   * @param {Cave} cave - The newly imported cave to be added.
   */
  addCave(cave) {
    const cavesReallyFar = Importer.getFarCaves(this.db.caves, cave.startPosition);
    if (this.db.caves.has(cave.name)) {
      showErrorPanel(`Import of '${cave.name}' failed, cave has already been imported!`, 20);
    } else if (cavesReallyFar.length > 0) {
      const message = `Import of '${cave.name}' failed, the cave is too far from previously imported caves: ${cavesReallyFar.join(',')}`;
      showWarningPanel(message, 20);
    } else {
      this.db.caves.set(cave.name, cave);

      const lOptions = this.options.scene.caveLines;
      let colorGradients = SurveyHelper.getColorGradients(cave, lOptions);

      cave.surveys.forEach((s) => {
        const [centerLineSegments, splaySegments] = SurveyHelper.getSegments(s, cave.stations);
        const _3dobjects = this.scene.addToScene(
          s,
          cave,
          centerLineSegments,
          splaySegments,
          true,
          colorGradients.get(s.name)
        );
        this.scene.addSurvey(cave.name, s.name, _3dobjects);
      });

      cave.sectionAttributes.forEach((sa) => {
        if (sa.visible) {
          const segments = SectionHelper.getSectionSegments(sa.section, cave.stations);
          this.scene.showSectionAttribute(sa.id, segments, sa.attribute, sa.format, sa.color, cave.name);
        }
      });
      cave.componentAttributes.forEach((ca) => {
        if (ca.visible) {
          const segments = SectionHelper.getComponentSegments(ca.component, cave.stations);
          this.scene.showSectionAttribute(ca.id, segments, ca.attribute, ca.format, ca.color, cave.name);
        }
      });

      this.explorer.addCave(cave);
      const boundingBox = this.scene.computeBoundingBox();
      this.scene.grid.adjust(boundingBox);
      this.scene.view.fitScreen(boundingBox);
    }
  }

  importFiles(files) {
    for (const file of files) {
      this.importFile(file);
    }
  }
}

class PolygonImporter extends CaveImporter {

  constructor(db, options, scene, explorer) {
    super(db, options, scene, explorer);
  }

  #getShotsFromPolygon = function (iterator) {
    var it;
    var i = 0;

    const shots = [];
    do {
      it = iterator.next();
      const parts = it.value[1].split(/\t|\s/);
      if (parts.length > 10) {
        // splays are not supported by polygon format
        shots.push(
          new Shot(
            i++,
            'center',
            parts[0],
            parts[1],
            U.parseMyFloat(parts[2]),
            U.parseMyFloat(parts[3]),
            U.parseMyFloat(parts[4])
          )
        );
      }
    } while (!it.done && it.value[1] != '');

    return shots;
  };

  getCave(wholeFileInText) {
    if (wholeFileInText.startsWith('POLYGON Cave Surveying Software')) {
      const lines = wholeFileInText.split(/\r\n|\n/);
      const lineIterator = lines.entries();
      U.iterateUntil(lineIterator, (v) => v !== '*** Project ***');

      const caveNameResult = lineIterator.next();
      if (!caveNameResult.value[1].startsWith('Project name:')) {
        showErrorPanel(`Invalid file, unable to read project name at line ${caveNameResult.value[0]}`);
        return;
      }
      const projectName = caveNameResult.value[1].substring(14);

      const settlementResult = lineIterator.next();
      if (!settlementResult.value[1].startsWith('Project place:')) {
        showErrorPanel(`Invalid file, unable to read settlement at line ${settlementResult.value[0]}`);
        return;
      }
      const settlement = settlementResult.value[1].substring(15);

      const catasterCodeResult = lineIterator.next();
      if (!catasterCodeResult.value[1].startsWith('Project code:')) {
        showErrorPanel(`Invalid file, unable to read cataster code at line ${catasterCodeResult.value[0]}`);
        return;
      }
      const catasterCode = catasterCodeResult.value[1].substring(14);

      lineIterator.next(); // TODO: skip made by for now

      const dateResult = lineIterator.next();
      if (!dateResult.value[1].startsWith('Made date:')) {
        showErrorPanel(`Invalid file, unable to read date at line ${dateResult.value[0]}`);
        return;
      }
      const floatValue = U.parseMyFloat(dateResult.value[1].substring(11));
      const date = U.getPolygonDate(floatValue);
      const metaData = new CaveMetadata(settlement, catasterCode, date);
      const surveys = [];
      const stations = new Map();
      var surveyName;
      var surveyIndex = 0;
      let caveStartPosition;
      do {
        surveyName = U.iterateUntil(lineIterator, (v) => !v.startsWith('Survey name'));
        if (surveyName !== undefined) {
          const surveyNameStr = surveyName.substring(13);
          let fixPoint = U.iterateUntil(lineIterator, (v) => !v.startsWith('Fix point')).substring(11);
          let posLine = lineIterator.next();
          let parts = posLine.value[1].split(/\t|\s/);
          let parsed = parts.toSpliced(3).map((x) => U.parseMyFloat(x));
          let startPosParsed = new Vector(...parsed);
          let startPoint = new SurveyStartStation(fixPoint, new SurveyStation('center', startPosParsed)); //TODO: check if fix point is in shots
          U.iterateUntil(lineIterator, (v) => v !== 'Survey data');
          lineIterator.next(); //From To ...
          const shots = this.#getShotsFromPolygon(lineIterator);
          let startName, startPosition;
          if (surveyIndex == 0) {
            startName = fixPoint;
            startPosition = startPosParsed;
            caveStartPosition = startPosParsed;
            if (fixPoint != shots[0].from) {
              throw new Error(
                `Invalid Polygon survey, fix point ${fixPoint} != first shot's from value (${shots[0].from})`
              );
            }
          }
          const survey = new Survey(surveyNameStr, true, startPoint, shots);
          SurveyHelper.calculateSurveyStations(survey, stations, [], startName, startPosition);
          surveys.push(survey);
          surveyIndex++;
        }
      } while (surveyName !== undefined);
      return new Cave(projectName, metaData, caveStartPosition, stations, surveys);
    }
  }

  importFile(file) {
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => this.importText(event.target.result);
      reader.readAsText(file, 'iso_8859-2');
    }
  }

  importText(wholeFileInText) {
    const cave = this.getCave(wholeFileInText);
    this.addCave(cave);
  }
}

class TopodroidImporter extends CaveImporter {

  constructor(db, options, scene, explorer) {
    super(db, options, scene, explorer);
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
      const type = to === '-' ? 'splay' : 'center';
      const toName = type === 'splay' ? undefined : to;
      shots.push(new Shot(i, type, from, toName, distance, azimuth, clino));
    }
    return [shots, aliases];
  }

  getCave(fileName, csvTextData) {
    const [shots, aliases] = this.#getShotsAndAliasesFromCsv(csvTextData);
    const stations = new Map();
    const surveyName = 'polygon';
    const startPoint = new SurveyStartStation(shots[0].from, new SurveyStation('center', new Vector(0, 0, 0)));
    const survey = new Survey(surveyName, true, startPoint, shots);
    SurveyHelper.calculateSurveyStations(survey, stations, aliases, startPoint.name, startPoint.station.position);
    return new Cave(fileName, undefined, startPoint.station.position, stations, [survey], aliases);
  }

  importFile(file) {
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => this.importText(file, event.target.result);
      reader.readAsText(file);
    }
  }

  importText(file, csvTextData) {
    const cave = this.getCave(file.name, csvTextData);
    this.addCave(cave);
  }
}

class JsonImporter extends CaveImporter {
  constructor(db, options, scene, explorer, attributeDefs) {
    super(db, options, scene, explorer);
    this.attributeDefs = attributeDefs;
  }

  importFile(file) {
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => this.importJson(event.target.result);
      reader.readAsText(file);
    }
  }

  importJson(json) {
    const parsedCave = JSON.parse(json);
    const cave = Cave.fromPure(parsedCave, this.attributeDefs);

    [...cave.surveys.entries()]
      .forEach(([index, es]) => SurveyHelper.recalculateSurvey(index, es, cave.stations, cave.aliases));

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
    this.addCave(cave);
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
      this.scene.fitScene(boundingBox);
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
