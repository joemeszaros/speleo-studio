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

export class Neighbor {
  constructor(node, weight) {
    this.node = node;
    this.weight = weight;
  }
}

export class Graph {
  constructor() {
    this.adjacencyList = new Map();
  }

  addVertex(vertex) {
    if (!this.adjacencyList.has(vertex)) {
      this.adjacencyList.set(vertex, []);
    }
  }

  addEdge(source, destination, weight) {
    if (!this.adjacencyList.has(source)) {
      this.addVertex(source);
    }
    if (!this.adjacencyList.has(destination)) {
      this.addVertex(destination);
    }
    this.adjacencyList.get(source).push(new Neighbor(destination, weight));
    this.adjacencyList.get(destination).push(new Neighbor(source, weight));
  }

  shortestDistanceNode = function (distances, visited) {
    // create a default value for shortest
    let shortest = null;

    // for each node in the distances object
    for (const [node, distance] of distances) {
      // if no node has been assigned to shortest yet
      // or if the current node's distance is smaller than the current shortest
      let currentIsShortest = shortest === null || distance < distances.get(shortest);

      // and if the current node is in the unvisited set
      if (currentIsShortest && !visited.has(node)) {
        // update shortest to be the current node
        shortest = node;
      }
    }
    return shortest;
  };
  // https://levelup.gitconnected.com/finding-the-shortest-path-in-javascript-dijkstras-algorithm-8d16451eea34
  findShortestPath = function (startNode, endNode) {

    // track distances from the start node using a hash object
    let distances = new Map();
    distances.set(endNode, 'Infinity');
    for (let child of this.adjacencyList.get(startNode)) {
      distances.set(child.node, child.weight);
    }

    let parents = new Map();
    parents.set(endNode, null);

    for (let child of this.adjacencyList.get(startNode)) {
      parents.set(child.node, startNode);
    }

    // collect visited nodes
    let visited = new Set(); // find the nearest node
    let node = this.shortestDistanceNode(distances, visited);
    // for that node:
    while (node) {
      // find its distance from the start node & its child nodes
      let distance = distances.get(node);
      let children = this.adjacencyList.get(node);

      // for each of those child nodes:
      for (let child of children) {

        // make sure each child node is not the start node
        if (String(child.node) === String(startNode)) {
          continue;
        } else {
          // save the distance from the start node to the child node
          let newdistance = distance + child.weight; // if there's no recorded distance from the start node to the child node in the distances object
          // or if the recorded distance is shorter than the previously stored distance from the start node to the child node
          if (!distances.has(child.node) || distances.get(child.node) > newdistance) {
            // save the distance to the object
            distances.set(child.node, newdistance);
            // record the path
            parents.set(child.node, node);
          }
        }
      }
      // move the current node to the visited set
      visited.add(node); // move to the nearest neighbor node
      node = this.shortestDistanceNode(distances, visited);
    }

    // using the stored paths from start node to end node
    // record the shortest path
    let shortestPath = [endNode];
    let parent = parents.get(endNode);
    while (parent) {
      shortestPath.push(parent);
      parent = parents.get(parent);
    }
    shortestPath.reverse();

    //this is the shortest path
    let results = {
      distance : distances.get(endNode),
      path     : shortestPath
    };
    // return the shortest path & the end node's distance from the start node
    return results;
  };

  //https://www.freecodecamp.org/news/8-essential-graph-algorithms-in-javascript/
  /** Depth First Search traverse of the graph
   * DFS visits the nodes depth wise. Since we need to process the nodes in a Last In First Out manner, we’ll use a stack.
   * Starting from a vertex, we’ll push the neighboring vertices to our stack. Whenever a vertex is popped, it is marked visited
   * in our visited object. Its neighboring vertices are pushed to the stack. Since we are always popping a new adjacent vertex,
   * our algorithm will always explore a new level.
   *
   * The time complexity is the same as BFS, O(V+E).
   **/
  traverse = function (start, terminationNodes = []) {
    const queue = [{ node: start, distance: 0 }];
    const distances = new Map();
    var distance = 0;
    const visited = new Set(terminationNodes);
    visited.add(start);
    const path = [];
    let currentVertex;
    while (queue.length) {
      currentVertex = queue.shift();
      distances.set(currentVertex.node, currentVertex.distance);
      this.adjacencyList.get(currentVertex.node).forEach((neighbor) => {
        if (!visited.has(neighbor.node)) {
          visited.add(neighbor.node);
          queue.push({ node: neighbor.node, distance: currentVertex.distance + neighbor.weight });
          path.push({ from: currentVertex.node, to: neighbor.node });
          distance += neighbor.weight;
        } else if (
          !path.some((p) => p.from === neighbor.node && p.to === currentVertex.node) &&
          !terminationNodes.includes(neighbor.node)
        ) {
          // cycle in the graph
          console.log('cycle in the graph', currentVertex.node, neighbor.node);
          path.push({ from: currentVertex.node, to: neighbor.node });
          distance += neighbor.weight;
        }
      });
    }
    return { distances: distances, distance: distance, path: path };
  };

  spanningTree() {
    const spannigTree = new Map();

    [...this.adjacencyList.keys()].forEach((node) => {
      spannigTree.set(node, new Set());
    });

    let visitedVertices = new Set();

    this.adjacencyList.forEach((neighbours, node) => {
      neighbours.forEach((child) => {
        if (!visitedVertices.has(child.node)) {
          visitedVertices.add(child.node);
          spannigTree.get(node).add(child.node);
          spannigTree.get(child.node).add(node);
        }
      });
    });
    return spannigTree;
  }

  /**
   * This method captures the cyclic path between the start and end vertices by backtracking the spanning tree from the end vertex to the start.
   *  The parents map is used to get the reference of the patent vertices.
   * @param {*} start
   * @param {*} end
   * @param {*} current
   * @param {*} parents
   * @returns
   */
  getCyclePath(start, end, current, parents) {
    let cycle = [end];
    let prev = end;
    var distance = 0;
    while (current != start) {
      distance += this.adjacencyList.get(prev).find((n) => n.node === current).weight;
      cycle.push(current);
      prev = current;
      current = parents.get(current);
    }
    distance += this.adjacencyList.get(prev).find((n) => n.node === start).weight;
    distance += this.adjacencyList.get(end).find((n) => n.node === start).weight;
    cycle.push(start);
    return { path: cycle, distance: distance };
  }

  /**
   * This is a recursive method that takes the start and end of the removed edge and performs DFS traversal recursively on the spanning tree from start until it finds the end.
   * @param {*} start
   * @param {*} end
   * @param {*} spannigTree - The spanning tree of the graph
   * @param {*} visited - The visited Set holds the set of visited vertices while traversing the tree in order to find a cycle. This is initialized as an empty Map in the default argument.
   * @param {*} parents - The parents Map stores the immediate parent of a node while traversing the tree. This is initialized as an empty Map.
   * @param {*} current_node - The current_node variable holds the name of the current vertex in the recursion. This is initialized as start.
   * @param {*} parent_node - The parent_node variable holds the name of the current vertex in the recursion. This is initialized as " ".
   * @returns
   */
  findCycle(
    start,
    end,
    spannigTree,
    visited = new Set(),
    parents = new Map(),
    current_node = start,
    parent_node = ' '
  ) {
    let cycle = null;
    visited.add(current_node);
    parents.set(current_node, parent_node);
    const destinations = spannigTree.get(current_node);
    for (const destination of destinations) {
      if (destination === end) {
        return this.getCyclePath(start, end, current_node, parents);
      }
      if (destination === parents.get(current_node)) {
        continue;
      }
      if (!visited.has(destination)) {
        cycle = this.findCycle(start, end, spannigTree, visited, parents, destination, current_node);
        if (cycle !== null) return cycle;
      }
    }
    return cycle;
  }

  /**
   * he rejectedEdgesset is populated by iterating through the graph and adding the edgesKeysif the edges that are not present in the spanning tree.
   * @param {*} spannigTree - The spanning tree of the graph
   * @returns
   */
  getRejectedEdges(spannigTree) {
    let rejectedEdges = new Map();

    this.adjacencyList.forEach((neighbours, node) => {
      if (spannigTree.has(node)) {
        neighbours.forEach((child) => {
          if (!spannigTree.get(node).has(child.node)) {
            if (!rejectedEdges.has(child.node + '-' + node)) {
              rejectedEdges.set(node + '-' + child.node, { start: child.node, end: node });
            }
          }
        });
      }
    });

    return rejectedEdges;
  }

  /**
   * We can obtain the cycles present in the graph by performing a DFS traversal on the Spanning Tree.
   * @param {*} spannigTree - The spanning tree of the graph
   * @returns
   */
  findAllCycles(spannigTree) {
    let cycles = [];
    let rejectedEdges = this.getRejectedEdges(spannigTree);
    rejectedEdges.forEach((edge) => {
      let start = edge.start;
      let end = edge.end;
      let cycle = this.findCycle(start, end, spannigTree);
      if (cycle !== null) {
        cycles.push(cycle);
      }
    });
    return cycles;
  }

  /** The algorithm finds simple cycles in an undirected graph. This algorithm is intended to find all the cycles in the graph that have the least overlap.
   * The algorithm can be broadly divided into three steps.
   * - Forming a spanning tree for the graph and getting the list of removed edges.
   * - Finding the cycle connecting the ends of the removed edges.
   * For detailed explanation of the algorithm check out the following page: https://javascript.plainenglish.io/finding-simple-cycles-in-an-undirected-graph-a-javascript-approach-1fa84d2f3218
   * For other algorithms look at graphlib (https://github.com/dagrejs/graphlib/) findCycles() function and JGraph cycle detection algorithm package: https://jgrapht.org/javadoc/org.jgrapht.core/org/jgrapht/alg/cycle/package-summary.html
   * @returns
   */
  findCircuits() {
    let spannigTree = this.spanningTree();
    return this.findAllCycles(spannigTree);
  }

}
