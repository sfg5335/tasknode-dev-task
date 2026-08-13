'use strict';

/**
 * Dependency-free, deterministic Stoer-Wagner global minimum-cut algorithm
 * for undirected, non-negatively weighted graphs.
 *
 * `globalMinCut(vertexCount, edges)` returns `{ weight, partition }`:
 *   - `weight` is the minimum total weight of edges crossing some
 *     bipartition of the vertex set into two non-empty sides.
 *   - `partition` is `[sideA, sideB]`, each a sorted-ascending array of
 *     original vertex indices, together covering every vertex in
 *     `0 .. vertexCount - 1` exactly once. `sideA` is always the side
 *     containing vertex `0` (a fixed, deterministic labeling convention,
 *     independent of any internal algorithm bookkeeping).
 *
 * Every input is validated: a non-number/non-array argument throws
 * `TypeError`; a correctly-typed but invalid value (non-integer,
 * out-of-range vertex index, negative weight, a self-loop, too few
 * vertices) throws `RangeError`. The input `edges` array (and its
 * elements) is never mutated -- all edge data is copied into an internal
 * weight matrix built purely by reading, never writing to, the input.
 */
function globalMinCut(vertexCount, edges) {
  validateVertexCount(vertexCount);
  validateEdges(edges, vertexCount);

  const n = vertexCount;

  // Symmetric weight matrix. Parallel edges between the same pair are
  // summed; this is what makes edge order (and duplicate/parallel edges)
  // irrelevant to the final result -- matrix construction is a pure sum,
  // commutative and associative regardless of input order.
  const w = new Array(n);
  for (let i = 0; i < n; i++) {
    w[i] = new Array(n).fill(0);
  }
  for (const edge of edges) {
    w[edge.u][edge.v] += edge.weight;
    w[edge.v][edge.u] += edge.weight;
  }

  // groups[i]: original vertex indices currently merged into super-vertex i.
  const groups = new Array(n);
  for (let i = 0; i < n; i++) {
    groups[i] = [i];
  }
  const active = new Array(n).fill(true);
  let activeCount = n;

  let bestWeight = Infinity;
  let bestSide = null;

  while (activeCount > 1) {
    const { s, t, cutWeight } = minCutPhase(w, active, n);

    // Strict less-than: the FIRST phase to reach a given minimum weight
    // wins and is never displaced by a later phase tying that same
    // weight. Combined with every other tie rule below, this makes the
    // whole algorithm deterministic for a fixed input -- no randomness
    // anywhere, so repeated runs on the same input always agree.
    if (cutWeight < bestWeight) {
      bestWeight = cutWeight;
      bestSide = groups[t].slice();
    }

    // Merge t into s.
    for (let x = 0; x < n; x++) {
      if (active[x] && x !== s && x !== t) {
        w[s][x] += w[t][x];
        w[x][s] += w[t][x];
      }
    }
    groups[s] = groups[s].concat(groups[t]);
    active[t] = false;
    activeCount--;
  }

  const sideASet = new Set(bestSide);
  const sideA = [];
  const sideB = [];
  for (let v = 0; v < n; v++) {
    if (sideASet.has(v)) {
      sideA.push(v);
    } else {
      sideB.push(v);
    }
  }
  sideA.sort((a, b) => a - b);
  sideB.sort((a, b) => a - b);

  // Fixed output labeling: whichever side holds vertex 0 is reported
  // first, regardless of which side the algorithm's internal bookkeeping
  // happened to track as `bestSide`.
  const partition = sideA.includes(0) ? [sideA, sideB] : [sideB, sideA];

  return { weight: bestWeight, partition };
}

// One "minimum cut phase" of the Stoer-Wagner algorithm: a maximum
// adjacency ordering over the currently-active super-vertices, starting
// from the smallest-indexed active vertex. Returns the last two vertices
// added (`s`, the second-to-last; `t`, the last) and the "cut of the
// phase" weight (the total weight from `t` to every vertex added before
// it) -- which is provably the minimum s-t cut for that particular pair.
function minCutPhase(w, active, n) {
  const inA = new Array(n).fill(false);
  const wSum = new Array(n).fill(0);

  let start = -1;
  for (let v = 0; v < n; v++) {
    if (active[v]) {
      start = v;
      break;
    }
  }

  let prev = -1;
  let last = start;
  inA[start] = true;
  for (let x = 0; x < n; x++) {
    if (active[x] && x !== start) {
      wSum[x] += w[start][x];
    }
  }

  let remaining = 0;
  for (let v = 0; v < n; v++) {
    if (active[v] && !inA[v]) {
      remaining++;
    }
  }

  let lastCutWeight = 0;

  while (remaining > 0) {
    let next = -1;
    let bestSum = -Infinity;
    for (let v = 0; v < n; v++) {
      // Strict '>' means the smallest-indexed vertex wins any tie, since
      // we scan v in ascending order and only replace on strict
      // improvement.
      if (active[v] && !inA[v] && wSum[v] > bestSum) {
        bestSum = wSum[v];
        next = v;
      }
    }

    prev = last;
    last = next;
    lastCutWeight = bestSum;
    inA[next] = true;
    remaining--;

    for (let v = 0; v < n; v++) {
      if (active[v] && !inA[v]) {
        wSum[v] += w[next][v];
      }
    }
  }

  return { s: prev, t: last, cutWeight: lastCutWeight };
}

function validateVertexCount(vertexCount) {
  if (typeof vertexCount !== 'number') {
    throw new TypeError('vertexCount must be a number');
  }
  if (!Number.isSafeInteger(vertexCount)) {
    throw new RangeError('vertexCount must be a safe integer');
  }
  if (vertexCount < 2) {
    throw new RangeError('vertexCount must be at least 2 (a cut needs two non-empty sides)');
  }
}

function validateEdges(edges, vertexCount) {
  if (!Array.isArray(edges)) {
    throw new TypeError('edges must be an array');
  }
  for (const edge of edges) {
    if (typeof edge !== 'object' || edge === null) {
      throw new TypeError('each edge must be an object');
    }
    const { u, v, weight } = edge;
    if (typeof u !== 'number' || typeof v !== 'number' || typeof weight !== 'number') {
      throw new TypeError('edge.u, edge.v, and edge.weight must all be numbers');
    }
    if (!Number.isSafeInteger(u) || !Number.isSafeInteger(v)) {
      throw new RangeError('edge.u and edge.v must be safe integers');
    }
    if (u < 0 || u >= vertexCount || v < 0 || v >= vertexCount) {
      throw new RangeError('edge.u and edge.v must be valid vertex indexes (0 <= index < vertexCount)');
    }
    if (u === v) {
      throw new RangeError('self-loops (edge.u === edge.v) are not supported');
    }
    if (!Number.isSafeInteger(weight) || weight < 0) {
      throw new RangeError('edge.weight must be a nonnegative safe integer');
    }
  }
}

module.exports = { globalMinCut };
