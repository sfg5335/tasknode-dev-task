'use strict';

// Deterministic Bron-Kerbosch Maximal Clique Enumeration
// --------------------------------------------------------
//
// Enumerates every maximal clique of a simple undirected graph on vertices
// 0..vertexCount-1, using the classic Bron-Kerbosch algorithm with pivoting
// (Bron & Kerbosch, 1973; the pivoting refinement is due to Tomita, Tanaka
// & Takahashi, 2006) driven by an outer loop over a deterministic
// degeneracy ordering of the vertices (Eppstein, Loffler & Strash, 2010),
// which gives worst-case-optimal running time on sparse graphs while still
// visiting every maximal clique exactly once.
//
// Every non-determinism point in the classic algorithm (which vertex is
// processed first, which pivot is chosen when several are tied, which
// candidate is branched on first) is pinned to an explicit, documented
// rule below, so that two calls with the same (vertexCount, edges) always
// produce byte-identical output -- not just the same *set* of cliques.

// Validates and normalizes `edges` against `vertexCount`, returning an
// adjacency-set array (`adj[v]` is a Set of v's neighbors). Duplicate and
// reversed-order edges (e.g. [0,1] and [1,0], or the same edge repeated)
// collapse into a single logical edge -- see the README's "Design choices"
// section for why this is normalization rather than a validation error.
function buildAdjacency(vertexCount, edges) {
  if (typeof vertexCount !== 'number' || !Number.isInteger(vertexCount)) {
    throw new TypeError('vertexCount must be an integer');
  }
  if (vertexCount < 0) {
    throw new RangeError('vertexCount must be non-negative');
  }
  if (!Array.isArray(edges)) {
    throw new TypeError('edges must be an array');
  }

  const adj = new Array(vertexCount);
  for (let v = 0; v < vertexCount; v++) adj[v] = new Set();

  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    if (!Array.isArray(e) || e.length !== 2) {
      throw new TypeError(`edges[${i}] must be a 2-element array [u, v]`);
    }
    const [u, v] = e;
    if (typeof u !== 'number' || !Number.isInteger(u) || typeof v !== 'number' || !Number.isInteger(v)) {
      throw new TypeError(`edges[${i}] endpoints must be integers`);
    }
    if (u < 0 || v < 0 || u >= vertexCount || v >= vertexCount) {
      throw new RangeError(`edges[${i}] endpoint out of range for vertexCount=${vertexCount}`);
    }
    if (u === v) {
      throw new RangeError(`edges[${i}] is a self-loop (${u}, ${v}), which is not permitted`);
    }
    adj[u].add(v);
    adj[v].add(u);
  }

  return adj;
}

// Computes a degeneracy ordering of the graph: repeatedly remove the
// currently-lowest-degree vertex (ties broken by smallest vertex id),
// recording removal order. The returned array lists vertices in REMOVAL
// order, which is also the order the outer Bron-Kerbosch loop below
// processes them in (the standard convention for the degeneracy-ordering
// variant: each vertex v's "later" set is exactly the neighbors removed
// after v, i.e. still present in the graph at the moment v is removed).
//
// Deliberately O(vertexCount^2): simple, easy to verify by inspection, and
// fast enough for the graph sizes this task's tests exercise (maximal
// clique enumeration is itself worst-case exponential in output size, so
// no stress test here uses more than a few dozen vertices for dense
// graphs). The tie-break rule (smallest id) is what makes this ordering
// -- and therefore the whole algorithm's recursion trace -- deterministic.
function degeneracyOrdering(vertexCount, adj) {
  const degree = new Array(vertexCount);
  for (let v = 0; v < vertexCount; v++) degree[v] = adj[v].size;
  const removed = new Array(vertexCount).fill(false);
  const order = new Array(vertexCount);

  for (let step = 0; step < vertexCount; step++) {
    let chosen = -1;
    let bestDegree = Infinity;
    for (let v = 0; v < vertexCount; v++) {
      if (!removed[v] && degree[v] < bestDegree) {
        bestDegree = degree[v];
        chosen = v;
      }
    }
    removed[chosen] = true;
    order[step] = chosen;
    for (const w of adj[chosen]) {
      if (!removed[w]) degree[w] -= 1;
    }
  }

  return order;
}

// Intersects a sorted candidate array with a neighbor Set, returning a new
// sorted array (order is preserved automatically since `candidates` is
// already ascending and we only filter, never reorder).
function intersectSortedWithSet(candidates, neighborSet) {
  const out = [];
  for (const c of candidates) {
    if (neighborSet.has(c)) out.push(c);
  }
  return out;
}

// Inserts `value` into a sorted (ascending) array, preserving order.
// X only ever grows one element at a time within a single pivoting call,
// so a linear insertion is simple, correct, and fast enough at this scale.
function insertSorted(sortedArray, value) {
  let i = 0;
  while (i < sortedArray.length && sortedArray[i] < value) i++;
  sortedArray.splice(i, 0, value);
}

// The classic Bron-Kerbosch-with-pivoting recursion. `P` and `X` are kept
// as explicitly ascending-sorted arrays throughout (never relying on
// JS Set/Map iteration order for anything output-visible), which is what
// makes every candidate-branching order in this function deterministic.
//
// Pivot selection: among all vertices u in P union X, deterministically
// pick the one maximizing |P intersect N(u)| (the classic Tomita et al.
// pivoting rule, which minimizes the number of recursive branches taken).
// Ties are broken by iterating P union X in ascending vertex-id order and
// keeping the FIRST (i.e. smallest-id) vertex achieving the best count --
// this is what pins the pivot choice to a single deterministic vertex
// whenever multiple vertices are equally good pivots.
function bronKerboschPivot(clique, P, X, adj, out) {
  if (P.length === 0 && X.length === 0) {
    out.push(clique.slice().sort((a, b) => a - b));
    return;
  }

  let pivot = -1;
  let bestScore = -1;
  // P and X are each already ascending; a simple merge-style scan visits
  // P union X in ascending order without needing a separate sort/dedupe
  // step (a vertex can appear in at most one of P or X at any time).
  let pi = 0;
  let xi = 0;
  while (pi < P.length || xi < X.length) {
    let u;
    if (pi < P.length && (xi >= X.length || P[pi] < X[xi])) {
      u = P[pi];
      pi++;
    } else {
      u = X[xi];
      xi++;
    }
    const neighbors = adj[u];
    let score = 0;
    for (const c of P) {
      if (neighbors.has(c)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      pivot = u;
    }
  }

  const pivotNeighbors = adj[pivot];
  // Candidates to branch on: P \ N(pivot). P is ascending, so this stays
  // ascending too -- the deterministic branching order required.
  const candidates = [];
  for (const v of P) {
    if (!pivotNeighbors.has(v)) candidates.push(v);
  }

  let curP = P.slice();
  let curX = X.slice();
  for (const v of candidates) {
    const vNeighbors = adj[v];
    const newP = intersectSortedWithSet(curP, vNeighbors);
    const newX = intersectSortedWithSet(curX, vNeighbors);
    clique.push(v);
    bronKerboschPivot(clique, newP, newX, adj, out);
    clique.pop();

    // Move v from P to X for the remaining sibling branches (standard
    // Bron-Kerbosch bookkeeping), preserving both arrays' sorted order.
    const idx = curP.indexOf(v);
    curP.splice(idx, 1);
    insertSorted(curX, v);
  }
}

function compareCliquesLexicographically(a, b) {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

// Returns every maximal clique of the simple undirected graph described by
// `vertexCount` (vertices 0..vertexCount-1) and `edges` (an array of
// [u, v] pairs). Each clique is returned as an array of vertex ids in
// ascending order, and the overall result array is sorted in ascending
// lexicographic order (comparing cliques element-by-element, treating a
// prefix of another clique as smaller -- matches Array.prototype.sort's
// natural extension to unequal-length sequences).
function maximalCliques(vertexCount, edges) {
  const adj = buildAdjacency(vertexCount, edges);
  const order = degeneracyOrdering(vertexCount, adj);

  const position = new Array(vertexCount);
  for (let i = 0; i < order.length; i++) position[order[i]] = i;

  const out = [];
  for (const v of order) {
    const neighbors = adj[v];
    const P = [];
    const X = [];
    // Ascending vertex-id iteration (0..vertexCount-1) rather than Set
    // iteration order keeps P/X construction deterministic regardless of
    // insertion history.
    for (let w = 0; w < vertexCount; w++) {
      if (!neighbors.has(w)) continue;
      if (position[w] > position[v]) P.push(w);
      else X.push(w);
    }
    bronKerboschPivot([v], P, X, adj, out);
  }

  out.sort(compareCliquesLexicographically);
  return out;
}

module.exports = { maximalCliques };
