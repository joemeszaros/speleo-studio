import { CaveComponent, CaveCycle, CaveSection } from './model/cave.js';
import { Graph } from './utils/graph.js';
import { randomAlphaNumbericString } from './utils/utils.js';
import { ShotType } from './model/survey.js';

class SectionHelper {

  static getSection(graph, from, to) {
    const path = graph.findShortestPath(from, to);
    if (path !== undefined) {
      return new CaveSection(from, to, path.path, path.distance === 'Infinity' ? 0 : path.distance);
    } else {
      return undefined;
    }
  }

  static getComponent(graph, start, termination) {
    const result = graph.traverse(start, termination);
    if (result !== undefined) {
      return new CaveComponent(start, termination, result.path, result.distance === 'Infinity' ? 0 : result.distance);
    } else {
      return undefined;
    }
  }

  static getSectionSegments(section, stations) {
    const segments = [];
    for (let index = 0; index < section.path.length - 1; index++) {
      const from = section.path[index];
      const to = section.path[index + 1];
      const fromSt = stations.get(from);
      const toSt = stations.get(to);
      const fromPos = fromSt.position;
      const toPos = toSt.position;
      if (fromPos !== undefined && toPos !== undefined) {
        segments.push(fromPos.x, fromPos.y, fromPos.z, toPos.x, toPos.y, toPos.z);
      }
    }
    return segments;
  }

  static getComponentSegments(component, stations) {
    const segments = [];
    component.path.forEach((p) => {
      const fromSt = stations.get(p.from);
      const toSt = stations.get(p.to);
      const fromPos = fromSt.position;
      const toPos = toSt.position;
      if (fromPos !== undefined && toPos !== undefined) {
        segments.push(fromPos.x, fromPos.y, fromPos.z, toPos.x, toPos.y, toPos.z);
      }

    });
    return segments;
  }

  static getCycles(graph) {
    return graph
      .findCircuits()
      .map((result) => new CaveCycle(randomAlphaNumbericString(6), result.path, result.distance));
  }

  static getCycleSegments(cycle, stations) {
    const segments = [];
    const cycleClosed = cycle.path.concat(cycle.path[0]);
    for (let index = 0; index < cycleClosed.length - 1; index++) {
      const from = cycleClosed[index];
      const to = cycleClosed[index + 1];
      const fromSt = stations.get(from);
      const toSt = stations.get(to);
      const fromPos = fromSt.position;
      const toPos = toSt.position;
      if (fromPos !== undefined && toPos !== undefined) {
        segments.push(fromPos.x, fromPos.y, fromPos.z, toPos.x, toPos.y, toPos.z);
      }

    }
    return segments;
  }

  static getGraph(cave) {

    const g = new Graph();
    [...cave.stations.keys()].forEach((k) => g.addVertex(k));
    cave.surveys.forEach((s) => {
      s.validShots.forEach((sh) => {
        if (sh.type !== ShotType.CENTER) {
          return;
        }
        const fromName = s.getFromStationName(sh);
        const from = cave.stations.get(fromName);
        const toStationName = s.getToStationName(sh);
        const to = cave.stations.get(toStationName);
        if (from !== undefined && to !== undefined) {
          g.addEdge(fromName, toStationName, sh.length);
        }
      });
    });
    return g;
  }
}

export { SectionHelper };
