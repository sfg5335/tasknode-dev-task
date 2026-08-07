'use strict';

/**
 * Dependency-free, single-file, deterministic global minimum-cut solver
 * for undirected weighted graphs, using the Stoer-Wagner algorithm.
 *
 * stoerWagner(vertexCount, edges)
 *   `vertexCount` is the number of vertices, addressed `0..vertexCount-1`.
 *   Must be an integer >= 2 (a cut requires splitting the graph into two
 *   non-empty sides, which is impossible with fewer than 2 vertices).
 *
 *   `edges` is an array of `[u, v, weight]` triples (undirected: order of
 *   `u`/`v` doesn't matter). `u`/`v` must be integers in `[0, vertexCount)`;
 *   `weight` must be a finite number `>= 0`. Parallel edges between the
 *   same pair are summed. Self-loops (`u === v`) are validated (same type
 *   and non-negativity rules as any other edge) but then ignored -- a
 *   self-loop can never be part of any cut, since both its endpoints are
 *   always on the same side of any partition.
 *
 *   Returns `{ weight, partition: [A, B] }`: `weight` is the total weight
 *   of the global minimum cut (the smallest total edge weight that, if
 *   removed, splits the graph into two non-empty components), and
 *   `partition` is `[A, B]`, two disjoint, jointly-exhaustive, ascending-
 *   sorted arrays of vertex ids representing the two sides. The pair is
 *   canonically oriented so `A` is the lexicographically smaller of the
 *   two arrays (comparing element-by-element, treating a strict prefix as
 *   smaller than its extension) -- this makes `partition` deterministic
 *   regardless of which physical side the algorithm happened to isolate.
 *
 *   On a disconnected graph the minimum cut weight is `0` (some pair of
 *   components can always be separated for free). On a graph with only
 *   zero-weight edges (or no edges at all) every cut has weight `0`.
 *
 *   Every input is validated: a non-integer/non-number `vertexCount`,
 *   `u`, or `v`, or a non-finite-number `weight`, throws `TypeError`; a
 *   correctly-typed `vertexCount < 2`, `u`/`v` outside `[0, vertexCount)`,
 *   or a negative `weight`, throws `RangeError`. Neither `edges` nor any
 *   of its sub-arrays is ever mutated.
 *
 * Algorithm: the classic O(V^3) Stoer-Wagner formulation. Each of
 * `vertexCount - 1` "minimum cut phases" runs a maximum-adjacency search
 * (repeatedly adding, to a growing set `A`, the not-yet-added vertex most
 * tightly connected to `A` so far -- ties broken by smallest vertex id)
 * until every currently-active vertex is in `A`. The last two vertices
 * added, `s` then `t`, become this phase's "cut of the phase": the weight
 * of every edge from `t` to the rest of the (currently active, i.e.
 * already-contracted) graph, isolating `t`'s current group from
 * everything else. After recording that candidate cut, `s` and `t` are
 * merged into a single supernode (parallel edges summed) and the next
 * phase begins. The true global minimum cut is provably always among
 * these `vertexCount - 1` phase cuts, so the minimum over all of them is
 * the answer. When multiple phases tie for the lowest weight, the
 * (canonically oriented) partition that sorts lexicographically smaller
 * is kept, making the whole computation fully deterministic for a given
 * input.
 */

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function isInteger(v) {
  return typeof v === 'number' && Number.isInteger(v);
}

function compareArrays(a, b) {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

function orientPartition(sideA, sideB) {
  return compareArrays(sideA, sideB) <= 0 ? [sideA, sideB] : [sideB, sideA];
}

function comparePartitions(p1, p2) {
  const c = compareArrays(p1[0], p2[0]);
  if (c !== 0) return c;
  return compareArrays(p1[1], p2[1]);
}

function complementOf(sideA, vertexCount) {
  const inSideA = new Set(sideA);
  const sideB = [];
  for (let i = 0; i < vertexCount; i++) {
    if (!inSideA.has(i)) sideB.push(i);
  }
  return sideB;
}

/**
 * Runs one minimum-cut-phase (maximum-adjacency search) over the
 * currently-active vertices. Returns `{ s, t, cutWeight }`: `s` and `t`
 * are the last two vertices added to `A` (in that order), and `cutWeight`
 * is the total weight from `t` to every other currently-active vertex.
 */
function minimumCutPhase(w, active) {
  const inA = new Set();
  const start = active[0];
  inA.add(start);

  const tightness = new Map();
  for (const v of active) {
    if (v !== start) tightness.set(v, w[start][v]);
  }

  let s = start;
  let t = start;
  let prev = start;

  for (let added = 1; added < active.length; added++) {
    let best = -1;
    let bestWeight = -Infinity;
    for (const v of active) {
      if (inA.has(v)) continue;
      const wt = tightness.get(v);
      if (wt > bestWeight || (wt === bestWeight && v < best)) {
        bestWeight = wt;
        best = v;
      }
    }
    inA.add(best);
    s = prev;
    t = best;
    prev = best;

    for (const v of active) {
      if (!inA.has(v)) {
        tightness.set(v, tightness.get(v) + w[best][v]);
      }
    }
  }

  let cutWeight = 0;
  for (const v of active) {
    if (v !== t) cutWeight += w[t][v];
  }

  return { s, t, cutWeight };
}

/** Merges supernode `t` into supernode `s` in place: sums `t`'s edges
 * into `s`'s row/column of the adjacency matrix, folds `t`'s original-
 * vertex membership into `s`'s group, and drops `t` from `active`. */
function mergeSupernodes(w, active, groups, s, t) {
  for (const v of active) {
    if (v === s || v === t) continue;
    w[s][v] += w[t][v];
    w[v][s] += w[v][t];
  }
  groups[s] = groups[s].concat(groups[t]).sort((a, b) => a - b);
  active.splice(active.indexOf(t), 1);
}

function stoerWagner(vertexCount, edges) {
  if (!isInteger(vertexCount)) {
    throw new TypeError('vertexCount must be an integer');
  }
  if (vertexCount < 2) {
    throw new RangeError('vertexCount must be at least 2 (a cut needs two non-empty sides)');
  }
  if (!Array.isArray(edges)) {
    throw new TypeError('edges must be an array');
  }

  const w = Array.from({ length: vertexCount }, () => new Float64Array(vertexCount));

  edges.forEach((edge, i) => {
    if (!Array.isArray(edge) || edge.length !== 3) {
      throw new TypeError(`edges[${i}] must be a [u, v, weight] triple`);
    }
    const [u, v, weight] = edge;
    if (!isInteger(u)) throw new TypeError(`edges[${i}][0] (u) must be an integer`);
    if (!isInteger(v)) throw new TypeError(`edges[${i}][1] (v) must be an integer`);
    if (u < 0 || u >= vertexCount) throw new RangeError(`edges[${i}][0] (u=${u}) is out of range [0, ${vertexCount})`);
    if (v < 0 || v >= vertexCount) throw new RangeError(`edges[${i}][1] (v=${v}) is out of range [0, ${vertexCount})`);
    if (!isFiniteNumber(weight)) throw new TypeError(`edges[${i}][2] (weight) must be a finite number`);
    if (weight < 0) throw new RangeError(`edges[${i}][2] (weight=${weight}) must be non-negative`);

    if (u === v) return; // validated self-loop -- can never be part of any cut, so ignored

    w[u][v] += weight;
    w[v][u] += weight;
  });

  const active = [];
  const groups = [];
  for (let i = 0; i < vertexCount; i++) {
    active.push(i);
    groups.push([i]);
  }

  let best = null; // { weight, partition: [A, B] }

  while (active.length > 1) {
    const { s, t, cutWeight } = minimumCutPhase(w, active);

    const sideA = groups[t].slice().sort((a, b) => a - b);
    const sideB = complementOf(sideA, vertexCount);
    const partition = orientPartition(sideA, sideB);

    if (
      best === null ||
      cutWeight < best.weight ||
      (cutWeight === best.weight && comparePartitions(partition, best.partition) < 0)
    ) {
      best = { weight: cutWeight, partition };
    }

    mergeSupernodes(w, active, groups, s, t);
  }

  return { weight: best.weight, partition: best.partition };
}

module.exports = { stoerWagner };
