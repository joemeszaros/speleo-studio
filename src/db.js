import { i18n } from './i18n/i18n.js';

class Database {

  constructor() {
    this.caves = new Map();
    this.surfaces = new Map();
  }

  deleteSurvey(caveName, surveyName) {
    if (this.caves.has(caveName)) {
      const cave = this.caves.get(caveName);
      const survey = cave.surveys.find((s) => s.name === surveyName);
      const indexToDelete = cave.surveys.indexOf(survey);
      if (indexToDelete !== -1) {
        cave.surveys.splice(indexToDelete, 1);
      }
    }
  }

  /**
   * Returns all the surveys for all caves
   * @returns {Array[Survey]} Surveys of all caves
   */
  getAllSurveys() {
    return this.caves.values().flatMap((c) => c.surveys);
  }

  getAllCaves() {
    return [...this.caves.values()];
  }

  getStationNames(caveName, filter = () => true) {
    const cave = this.caves.get(caveName);
    if (!cave.stations) return [];
    return [...cave.stations]
      .filter(([_, value]) => filter(value))
      .map(([key]) => key);
  }

  getAllStationNames() {
    const stNames = [
      ...this.caves.values().flatMap((c) =>
        [...c.stations.keys()].map((st) => {
          return { name: st, cave: c.name };
        })
      )
    ];
    return stNames.sort((a, b) => {
      if (a.name < b.name) {
        return -1;
      }
      if (a.name > b.name) {
        return 1;
      }
      return 0;
    });
  }

  getAllCaveNames() {
    return [...this.caves.keys()];
  }

  getSurvey(caveName, surveyName) {
    if (this.caves.has(caveName)) {
      return this.caves.get(caveName).surveys.find((s) => s.name === surveyName);
    } else {
      return undefined;
    }
  }

  addCave(cave) {
    this.caves.set(cave.name, cave);
  }

  getCave(caveName) {
    return this.caves.get(caveName);
  }

  renameCave(oldName, newName) {
    if (this.caves.has(newName)) {
      throw new Error(i18n.t('errors.db.caveAlreadyExists', { name: newName }));
    }
    const cave = this.caves.get(oldName);
    cave.name = newName;
    this.caves.delete(oldName);
    this.caves.set(newName, cave);
  }

  renameSurvey(cave, oldName, newName) {
    const survey = this.getSurvey(cave.name, oldName);
    if (survey === undefined) {
      throw new Error(i18n.t('errors.db.surveyDoesNotExist', { name: oldName }));
    }
    if (this.getSurvey(cave.name, newName) !== undefined) {
      throw new Error(i18n.t('errors.db.surveyAlreadyExists', { name: newName }));
    }
    survey.name = newName;
  }

  getSurface(name) {
    return this.surfaces.get(name);
  }

  addSurface(surface) {
    if (this.surfaces.has(surface.name)) {
      throw new Error(i18n.t('errors.db.surfaceAlreadyAdded', { name: surface.name }));
    }
    this.surfaces.set(surface.name, surface);
  }

  deleteCave(caveName) {
    if (this.caves.has(caveName)) {
      this.caves.delete(caveName);
    }
  }

  clear() {
    this.caves.clear();
    this.surfaces.clear();
  }

  reorderSurvey(caveName, surveyName, newIndex) {
    if (this.caves.has(caveName)) {
      const cave = this.caves.get(caveName);
      const surveyIndex = cave.surveys.findIndex((s) => s.name === surveyName);

      if (surveyIndex !== -1 && newIndex >= 0 && newIndex < cave.surveys.length) {
        // Remove the survey from its current position
        const [survey] = cave.surveys.splice(surveyIndex, 1);
        // Insert it at the new position
        cave.surveys.splice(newIndex, 0, survey);
        return true;
      }
    }
    return false;
  }

}

export { Database };
