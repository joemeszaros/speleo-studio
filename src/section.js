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

import { CaveComponent, CaveCycle, CaveSection } from './model/cave.js';
import { Graph } from './utils/graph.js';
import { randomAlphaNumbericString, convertLengthToMeters } from './utils/utils.js';
import { ShotType, DEFAULT_UNITS } from './model/survey.js';
import { SurveyHelper } from './survey.js';

class SectionHelper {

  static getSection(graph, from, to) {
    const path = graph.findShortestPath(from, to);
    // No connecting route → there is no section. Return undefined instead of fabricating a 0 m
    // section (findShortestPath reports an unreachable target as a distance of 'Infinity'); the
    // callers already treat undefined as "no path / cannot build section".
    if (path === undefined || path.distance === 'Infinity') {
      return undefined;
    }
    return new CaveSection(from, to, path.path, path.distance);
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
    if (section === undefined) return segments; // no path → no segments (getSection may return undefined)
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
    if (component === undefined) return segments; // parity with getSectionSegments
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
    const stations = cave.getAllStations();
    [...stations.keys()].forEach((k) => g.addVertex(k));
    const aliases = cave.getAllAliases();

    // An equated junction is one physical station shared under several names, but the map stores
    // it under a SINGLE representative key (the other names are not keys of their own). To build a
    // graph whose connectivity matches the solved network we must map every station reference to
    // that representative key. `keyByStation` reverses the map (station object → its key); a name
    // that isn't itself a key is resolved through the equate group via SurveyHelper.findAliasedStation.
    const keyByStation = new Map();
    for (const [k, v] of stations) if (!keyByStation.has(v)) keyByStation.set(v, k);
    const resolveKey = (name) => {
      if (stations.has(name)) return name;
      const st = SurveyHelper.findAliasedStation(name, aliases, stations);
      return st !== undefined ? keyByStation.get(st) : undefined;
    };

    cave.getAllSurveys().forEach((s) => {
      const lengthUnit = s.units?.length ?? DEFAULT_UNITS.length;
      s.validShots.forEach((sh) => {
        if (sh.type !== ShotType.CENTER) {
          return;
        }
        // Resolve each endpoint to the representative key it is stored under. qualify() is a no-op
        // for single-survey/legacy caves; resolveKey additionally follows equates, so a shot whose
        // endpoint is an equated (merged) station still produces an edge instead of being dropped —
        // otherwise much of a multi-survey network fragments into disconnected components.
        const fromKey = resolveKey(s.qualify(s.getFromStationName(sh)));
        const toKey = resolveKey(s.qualify(s.getToStationName(sh)));
        if (fromKey !== undefined && toKey !== undefined) {
          g.addEdge(fromKey, toKey, convertLengthToMeters(sh.length, lengthUnit));
        }
      });
    });

    // Zero-length edges for equates that link two DISTINCT placed stations. A connected system
    // often fixes one entrance per sub-cave, so each sub-cave is positioned independently and the
    // cross-sub-cave equate drives NO shot placement — the loop above then adds no bridging edge.
    // Without this such systems fragment and shortest-path / section queries between sub-caves
    // wrongly report "no path". (Equates whose endpoints resolve to the same key are already one
    // vertex, so they are skipped.)
    aliases.forEach((a) => {
      const fromKey = resolveKey(a.from);
      const toKey = resolveKey(a.to);
      if (fromKey !== undefined && toKey !== undefined && fromKey !== toKey) {
        g.addEdge(fromKey, toKey, 0);
      }
    });
    return g;
  }
}

export { SectionHelper };
