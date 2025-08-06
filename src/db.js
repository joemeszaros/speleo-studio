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
        const event = new CustomEvent('surveyDeleted', {
          detail : {
            cave   : caveName,
            survey : surveyName
          }
        });
        document.dispatchEvent(event);
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

  getStationNames(caveName) {
    return [...(this.caves.get(caveName)?.stations?.keys() ?? [])];
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
      throw new Error(`Cave with ${newName} already exists!`);
    }
    const cave = this.caves.get(oldName);
    cave.name = newName;
    this.caves.delete(oldName);
    this.caves.set(newName, cave);
  }

  renameSurvey(cave, oldName, newName) {
    const survey = this.getSurvey(cave.name, oldName);
    if (survey === undefined) {
      throw new Error(`Survey '${oldName}' does not exists!`);
    }
    if (this.getSurvey(cave, newName !== undefined)) {
      throw new Error(`Survey '${newName}' already exists!`);
    }
    survey.name = newName;
  }

  getSurface(name) {
    return this.surfaces.get(name);
  }

  addSurface(surface) {
    if (this.surfaces.has(surface.name)) {
      throw new Error(`Surface ${surface.name} has already been added!`);
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

}

export { Database };
