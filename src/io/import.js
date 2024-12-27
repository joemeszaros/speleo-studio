import * as U from "../utils/utils.js";
import { SurveyHelper } from "../survey.js";
import { SurfaceHelper } from "../surface.js";
import { showErrorPanel, showWarningPanel } from "../ui/popups.js";
import { CAVES_MAX_DISTANCE } from "../constants.js";
import { Shot, Survey, Cave, SurveyStartStation, Vector, SurveyStation, SurveyAlias, Surface } from "../model.js";
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import * as THREE from 'three';

class Importer {
    static getFarCaves(caves, position) {
        return Array.from(caves.values()).reduce((acc, c) => {
            const distanceBetweenCaves = c.startPosition.distanceTo(position);
            if (distanceBetweenCaves > CAVES_MAX_DISTANCE) {
                acc.push(`${c.name} - ${distanceBetweenCaves.toFixed(2)} m`);
            }
            return acc;
        }, []);
    }
}

class CaveImporter {

    constructor(db, options, scene, explorer) {
        this.db = db;
        this.options = options;
        this.scene = scene;
        this.explorer = explorer;
    }

    addCave(cave) {

        const cavesReallyFar = Importer.getFarCaves(this.db.caves, cave.startPosition)
        if (this.db.caves.has(cave.name)) {
            showErrorPanel('Import failed, cave has already been imported!', 20);
        } else if (cavesReallyFar.length > 0) {
            const message = `Import failed, the cave is too far from previously imported caves: ${cavesReallyFar.join(",")}`;
            showWarningPanel(message, 20);
        } else {
            this.db.caves.set(cave.name, cave);

            const lOptions = this.options.scene.caveLines;
            let colorGradients = SurveyHelper.getColorGradients(cave, lOptions);

            cave.surveys.forEach(s => {
                const [centerLineSegments, splaySegments] = SurveyHelper.getSegments(s, cave.stations);
                const _3dobjects =
                    this.scene.addToScene(
                        s.name,
                        cave.stations,
                        centerLineSegments,
                        splaySegments,
                        true,
                        colorGradients.get(s.name),
                    );
                this.scene.addSurvey(cave.name, s.name, _3dobjects);
            });
            this.explorer.addCave(cave);
            const boundingBox = this.scene.computeBoundingBox();
            this.scene.grid.adjust(boundingBox);
            this.scene.fitScene(boundingBox);
        }
    }

}

class PolygonImporter extends CaveImporter {

    constructor(db, options, scene, explorer) {
        super(db, options, scene, explorer)
    }

    getShotsFromPolygon = function (iterator) {
        var it;
        var i = 0;

        const shots = []
        do {
            it = iterator.next();
            const parts = it.value[1].split(/\t|\s/);
            if (parts.length > 10) {
                // splays are not supported by polygon format
                shots.push(new Shot(i++, 'center', parts[0], parts[1], U.parseMyFloat(parts[2]), U.parseMyFloat(parts[3]), U.parseMyFloat(parts[4])));
            }
        } while (!it.done && it.value[1] != '');

        return shots;
    }

    getCave(wholeFileInText) {
        if (wholeFileInText.startsWith("POLYGON Cave Surveying Software")) {
            const lines = wholeFileInText.split(/\r\n|\n/);
            const lineIterator = lines.entries();
            U.iterateUntil(lineIterator, (v) => v !== "*** Project ***");
            const caveNameResult = lineIterator.next();

            if (!caveNameResult.value[1].startsWith("Project name:")) {
                showErrorPanel(`Invalid file, unable to read project name at line ${caveNameResult.value[0]}`);
                return;
            }

            const projectName = caveNameResult.value[1].substring(14);
            const surveys = []
            const stations = new Map();
            var surveyName;
            var surveyIndex = 0;
            let caveStartPosition;
            do {
                surveyName = U.iterateUntil(lineIterator, (v) => !v.startsWith("Survey name"));
                if (surveyName !== undefined) {
                    const surveyNameStr = surveyName.substring(13);
                    let fixPoint = U.iterateUntil(lineIterator, (v) => !v.startsWith("Fix point")).substring(11);
                    let posLine = lineIterator.next();
                    let parts = posLine.value[1].split(/\t|\s/);
                    let parsed = parts.toSpliced(3).map(x => U.parseMyFloat(x));
                    let startPosParsed = new Vector(...parsed);
                    let startPoint = new SurveyStartStation(fixPoint, new SurveyStation('center', startPosParsed))
                    U.iterateUntil(lineIterator, (v) => v !== "Survey data");
                    lineIterator.next(); //From To ...
                    const shots = this.getShotsFromPolygon(lineIterator);
                    let startName, startPosition;
                    if (surveyIndex == 0) {
                        startName = fixPoint;
                        startPosition = startPosParsed;
                        caveStartPosition = startPosParsed;
                        if (fixPoint != shots[0].from) {
                            throw new Error(`Invalid Polygon survey, fix point ${fixPoint} != first shot's from value (${shots[0].from})`);
                        }
                    }
                    const survey = new Survey(surveyNameStr, true, startPoint, shots);
                    SurveyHelper.calculateSurveyStations(survey, stations, [], startName, startPosition);
                    surveys.push(survey);
                    surveyIndex++;
                }

            } while (surveyName !== undefined)
            const cave = new Cave(projectName, caveStartPosition, stations, surveys);
            return cave;
        }
    }

    importFile(file) {
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => this.importText(event.target.result);
            reader.readAsText(file, "iso_8859-2");
        }
    }

    importText(wholeFileInText) {
        const cave = this.getCave(wholeFileInText);
        this.addCave(cave);
    }

}

class TopodroidImporter extends CaveImporter {

    constructor(db, options, scene, explorer) {
        super(db, options, scene, explorer)
    }

    getShotsAndAliasesFromCsv(csvData) {
        const aliases = [];
        const shots = [];

        for (let i = 0; i < csvData.length; i++) {
            const row = csvData[i];
            if (row === null || row.length === 0) {
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
            const distance = row[2];
            const azimuth = row[3];
            const clino = row[4];
            const type = (to === '-') ? 'splay' : 'center';
            const toName = (type === 'splay') ? undefined : to;
            shots.push(new Shot(i, type, from, toName, distance, azimuth, clino));
        }
        return [shots, aliases];
    }

    getCave(fileName, csvData) {
        const [shots, aliases] = this.getShotsAndAliasesFromCsv(csvData);
        const stations = new Map();
        const surveyName = 'polygon';
        const startPoint = new SurveyStartStation(shots[0].from, new SurveyStation('center', new Vector(0, 0, 0)));
        const survey = new Survey(surveyName, true, startPoint, shots);
        SurveyHelper.calculateSurveyStations(survey, stations, aliases, startPoint.name, startPoint.station.position);
        return new Cave(fileName, startPoint.station.position, stations, [survey], aliases);
    }

    importFile(file, fileName) {
        if (file) {
            Papa.parse(file, {
                header: false,
                comments: "#",
                dynamicTyping: true,
                complete: (results) => {
                    const caveName = (fileName !== undefined) ? fileName : file.name;
                    const cave = this.getCave(caveName, results.data);
                    this.addCave(cave);
                },
                error: function (error) {
                    console.error('Error parsing CSV:', error);
                }
            });
        }
    }
}

class JsonImporter extends CaveImporter {

    constructor(db, options, scene, explorer, attributeDefs) {
        super(db, options, scene, explorer)
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
        cave.surveys.entries().forEach(([index, es]) => SurveyHelper.recalculateSurvey(index, es, cave.stations, cave.aliases));
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
            showErrorPanel('Import failed, surface has already been imported!', 20);
        } else if (cavesReallyFar.length > 0) {
            const message = `Import failed, the surface is too far from previously imported caves: ${cavesReallyFar.join(",")}`;
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
        const material = new THREE.PointsMaterial({ color: 0xffffff, size: 2, vertexColors: true });
        const cloud = new THREE.Points(geometry, material);
        const position = geometry.getAttribute('position');
        const points = [];

        for (let i = 0; i < position.count; i++) {
            const point = new Vector(
                position.getX(i),
                position.getY(i),
                position.getZ(i)
            );
            points.push(point);
        }
        const surface = new Surface(fileName, points, new Vector(center.x, center.y, center.z));
        this.addSurface(surface, cloud);
    }

}

export { PolygonImporter, TopodroidImporter, JsonImporter, PlySurfaceImporter };