'use strict';

// Johnson's all-pairs shortest-path algorithm for a directed, weighted graph
// that may contain negative edge weights (but must not contain a negative
// cycle). Dependency-free.
//
// `johnson(vertexCount, edges)`:
//   - `vertexCount`: a non-negative integer; vertices are numbered
//     `0 .. vertexCount - 1`.
//   - `edges`: an array of `[from, to, weight]` triples. `from`/`to` must be
//     integer vertex indices in range; `weight` must be a finite number.
//     Parallel edges (more than one edge between the same ordered pair) and
//     self-loops (`from === to`) are both explicitly supported.
//
// Returns an `n x n` (n = vertexCount) matrix of shortest-path distances:
// `matrix[u][v]` is the shortest distance from `u` to `v`. The diagonal is
// always `0`. `matrix[u][v]` is `Infinity` when `v` is not reachable from
// `u`. Throws `RangeError` if the graph contains a negative-weight cycle
// (shortest paths are undefined in that case). Never mutates `edges` or any
// nested edge array.
//
// Algorithm (the classic Johnson's algorithm, three stages):
//
//   1. Reweighting potentials `h(v)`: conceptually, add a virtual source
//      vertex connected to every real vertex by a zero-weight edge, then run
//      Bellman-Ford from that virtual source. This is implemented without
//      actually materializing the virtual vertex, by initializing every
//      `h(v) = 0` (equivalent to "one round of relaxation" from a
//      zero-weight-edge source that reaches every vertex directly) and then
//      running ordinary Bellman-Ford relaxation over the real edges for
//      `vertexCount` further rounds. A `vertexCount`+1-th pass that still
//      finds a relaxable edge proves a negative cycle exists (reachable from
//      the virtual source, which — since it connects directly to every
//      vertex — means a negative cycle exists *anywhere* in the graph), and
//      `johnson` throws `RangeError` in that case.
//   2. Reweighting: every edge `(u, v, w)` is reweighted to
//      `w'(u, v) = w + h(u) - h(v)`. A standard triangle-inequality argument
//      (using the fact that `h(v)` is itself a shortest-path distance from
//      the virtual source, so `h(v) <= h(u) + w(u, v)` for every edge) shows
//      every reweighted edge has `w'(u, v) >= 0`, given no negative cycle.
//   3. For each vertex `u`, run Dijkstra's algorithm (binary min-heap,
//      lazy-deletion for decrease-key) over the reweighted graph to get
//      `d'(u, v)` for every `v`. The true distance is recovered via
//      `d(u, v) = d'(u, v) + h(v) - h(u)` (the `h` terms telescope away along
//      any path, so this identity holds for the shortest path specifically,
//      not just some path).
//
// Complexity: O(V * E) for the Bellman-Ford reweighting stage, plus
// O(V * (E + V) log V) for V runs of binary-heap Dijkstra — the same overall
// bound as the textbook (CLRS) presentation of Johnson's algorithm.

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function isInteger(value) {
  return typeof value === 'number' && Number.isInteger(value);
}

function describe(value) {
  if (value === null) return 'null';
  if (typeof value === 'number' && Number.isNaN(value)) return 'NaN';
  return typeof value === 'number' ? String(value) : typeof value;
}

function validateInputs(vertexCount, edges) {
  if (!isInteger(vertexCount)) {
    throw new TypeError(`vertexCount must be an integer, got ${describe(vertexCount)}`);
  }
  if (vertexCount < 0) {
    throw new RangeError(`vertexCount must be non-negative, got ${vertexCount}`);
  }
  if (!Array.isArray(edges)) {
    throw new TypeError(`edges must be an array, got ${describe(edges)}`);
  }
  edges.forEach((edge, i) => {
    if (!Array.isArray(edge) || edge.length !== 3) {
      throw new TypeError(
        `edges[${i}] must be a [from, to, weight] triple (array of length 3), got ${describe(edge)}`
      );
    }
    const [from, to, weight] = edge;
    if (!isInteger(from)) {
      throw new TypeError(`edges[${i}][0] (from) must be an integer, got ${describe(from)}`);
    }
    if (!isInteger(to)) {
      throw new TypeError(`edges[${i}][1] (to) must be an integer, got ${describe(to)}`);
    }
    if (!isFiniteNumber(weight)) {
      throw new TypeError(`edges[${i}][2] (weight) must be a finite number, got ${describe(weight)}`);
    }
    if (from < 0 || from >= vertexCount) {
      throw new RangeError(`edges[${i}][0] (from=${from}) is out of range [0, ${vertexCount - 1}]`);
    }
    if (to < 0 || to >= vertexCount) {
      throw new RangeError(`edges[${i}][1] (to=${to}) is out of range [0, ${vertexCount - 1}]`);
    }
  });
}

// Stage 1: Bellman-Ford reweighting potentials, via the implicit
// zero-weight-edge virtual source trick described above.
function computePotentials(vertexCount, edges) {
  const h = new Array(vertexCount).fill(0);
  for (let round = 0; round < vertexCount; round++) {
    let changed = false;
    for (let i = 0; i < edges.length; i++) {
      const from = edges[i][0];
      const to = edges[i][1];
      const weight = edges[i][2];
      const candidate = h[from] + weight;
      if (candidate < h[to]) {
        h[to] = candidate;
        changed = true;
      }
    }
    if (!changed) break;
  }
  for (let i = 0; i < edges.length; i++) {
    const from = edges[i][0];
    const to = edges[i][1];
    const weight = edges[i][2];
    if (h[from] + weight < h[to]) {
      throw new RangeError(
        `negative-weight cycle detected (involving edge ${from} -> ${to}, weight ${weight}); ` +
          'shortest paths are undefined for graphs with a negative cycle'
      );
    }
  }
  return h;
}

// A small binary min-heap of (key, value) pairs, supporting push and
// extract-min. Decrease-key is implemented via lazy deletion: a vertex may
// be pushed multiple times with different keys, and stale (superseded)
// entries are simply skipped when popped.
class MinHeap {
  constructor() {
    this._keys = [];
    this._values = [];
  }

  get size() {
    return this._keys.length;
  }

  push(key, value) {
    const keys = this._keys;
    const values = this._values;
    keys.push(key);
    values.push(value);
    let i = keys.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (keys[parent] <= keys[i]) break;
      [keys[parent], keys[i]] = [keys[i], keys[parent]];
      [values[parent], values[i]] = [values[i], values[parent]];
      i = parent;
    }
  }

  pop() {
    const keys = this._keys;
    const values = this._values;
    const n = keys.length;
    if (n === 0) return undefined;
    const topKey = keys[0];
    const topValue = values[0];
    const lastKey = keys.pop();
    const lastValue = values.pop();
    if (keys.length > 0) {
      keys[0] = lastKey;
      values[0] = lastValue;
      let i = 0;
      const size = keys.length;
      for (;;) {
        let smallest = i;
        const left = 2 * i + 1;
        const right = 2 * i + 2;
        if (left < size && keys[left] < keys[smallest]) smallest = left;
        if (right < size && keys[right] < keys[smallest]) smallest = right;
        if (smallest === i) break;
        [keys[smallest], keys[i]] = [keys[i], keys[smallest]];
        [values[smallest], values[i]] = [values[i], values[smallest]];
        i = smallest;
      }
    }
    return { key: topKey, value: topValue };
  }
}

// Stage 3: single-source Dijkstra over the reweighted graph, via a binary
// min-heap. `adjacency[u]` is an array of `{ to, weight }` reweighted edges.
function dijkstra(vertexCount, adjacency, source) {
  const dist = new Array(vertexCount).fill(Infinity);
  const visited = new Array(vertexCount).fill(false);
  dist[source] = 0;
  const heap = new MinHeap();
  heap.push(0, source);
  while (heap.size > 0) {
    const { key: d, value: u } = heap.pop();
    if (visited[u]) continue;
    if (d > dist[u]) continue; // stale, superseded entry
    visited[u] = true;
    const neighbors = adjacency[u];
    for (let i = 0; i < neighbors.length; i++) {
      const { to, weight } = neighbors[i];
      if (visited[to]) continue;
      const candidate = dist[u] + weight;
      if (candidate < dist[to]) {
        dist[to] = candidate;
        heap.push(candidate, to);
      }
    }
  }
  return dist;
}

function johnson(vertexCount, edges) {
  validateInputs(vertexCount, edges);

  const h = computePotentials(vertexCount, edges);

  // Stage 2: build a reweighted adjacency list. w'(u,v) = w(u,v) + h(u) - h(v).
  const adjacency = Array.from({ length: vertexCount }, () => []);
  for (let i = 0; i < edges.length; i++) {
    const from = edges[i][0];
    const to = edges[i][1];
    const weight = edges[i][2];
    adjacency[from].push({ to, weight: weight + h[from] - h[to] });
  }

  const matrix = new Array(vertexCount);
  for (let u = 0; u < vertexCount; u++) {
    const reweightedDist = dijkstra(vertexCount, adjacency, u);
    const row = new Array(vertexCount);
    for (let v = 0; v < vertexCount; v++) {
      row[v] = reweightedDist[v] === Infinity ? Infinity : reweightedDist[v] + h[v] - h[u];
    }
    row[u] = 0; // exact by construction, pinned explicitly to avoid any -0/rounding artifact
    matrix[u] = row;
  }

  return matrix;
}

module.exports = { johnson };
