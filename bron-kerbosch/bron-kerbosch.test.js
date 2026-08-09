'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { maximalCliques } = require('./bron-kerbosch.js');

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Independent brute-force oracle (subset enumeration via bitmask, feasible
// up to ~16-18 vertices), deliberately structured completely differently
// from the shipped Bron-Kerbosch implementation (no pivoting, no
// degeneracy ordering, no recursion) so it cannot share a bug with it.
//
// Convention: a 0-vertex graph has ZERO maximal cliques (not one
// containing the empty set) -- see the README's "Design choices" section
// for the reasoning; this oracle special-cases it to match.
// ---------------------------------------------------------------------------

function bruteForceMaximalCliques(vertexCount, edges) {
  if (vertexCount === 0) return [];

  const adj = Array.from({ length: vertexCount }, () => new Set());
  for (const [u, v] of edges) {
    if (u === v) continue;
    adj[u].add(v);
    adj[v].add(u);
  }

  const out = [];
  const total = 1 << vertexCount;
  for (let mask = 0; mask < total; mask++) {
    const verts = [];
    for (let v = 0; v < vertexCount; v++) {
      if (mask & (1 << v)) verts.push(v);
    }

    let isClique = true;
    for (let i = 0; isClique && i < verts.length; i++) {
      for (let j = i + 1; j < verts.length; j++) {
        if (!adj[verts[i]].has(verts[j])) {
          isClique = false;
          break;
        }
      }
    }
    if (!isClique) continue;

    let maximal = true;
    for (let w = 0; w < vertexCount; w++) {
      if (mask & (1 << w)) continue;
      let canAdd = true;
      for (const v of verts) {
        if (!adj[v].has(w)) {
          canAdd = false;
          break;
        }
      }
      if (canAdd) {
        maximal = false;
        break;
      }
    }
    if (maximal) out.push(verts);
  }

  out.sort(compareCliquesLexicographically);
  return out;
}

function compareCliquesLexicographically(a, b) {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

function randomGraph(rand, vertexCount, edgeProbability) {
  const edges = [];
  for (let u = 0; u < vertexCount; u++) {
    for (let v = u + 1; v < vertexCount; v++) {
      if (rand() < edgeProbability) edges.push([u, v]);
    }
  }
  return edges;
}

function isSortedLexicographically(cliques) {
  for (let i = 1; i < cliques.length; i++) {
    if (compareCliquesLexicographically(cliques[i - 1], cliques[i]) > 0) return false;
  }
  return true;
}

function isValidCliqueSet(vertexCount, edges, cliques) {
  const adj = Array.from({ length: vertexCount }, () => new Set());
  for (const [u, v] of edges) {
    if (u === v) continue;
    adj[u].add(v);
    adj[v].add(u);
  }
  for (const clique of cliques) {
    for (let i = 0; i < clique.length; i++) {
      for (let j = i + 1; j < clique.length; j++) {
        if (!adj[clique[i]].has(clique[j])) return false;
      }
    }
  }
  return true;
}

function hasNoDuplicateCliques(cliques) {
  const keys = new Set(cliques.map((c) => c.join(',')));
  return keys.size === cliques.length;
}

// =========================================================================
// Empty, isolated, complete, cyclic, and disconnected graphs
// =========================================================================

test('empty graph (0 vertices) has zero maximal cliques', () => {
  assert.deepEqual(maximalCliques(0, []), []);
});

test('graph with vertices but no edges: every vertex is its own maximal clique', () => {
  assert.deepEqual(maximalCliques(3, []), [[0], [1], [2]]);
  assert.deepEqual(maximalCliques(1, []), [[0]]);
});

test('complete graph K_n has exactly one maximal clique: all vertices', () => {
  for (const n of [1, 2, 3, 5, 8]) {
    const edges = [];
    for (let u = 0; u < n; u++) for (let v = u + 1; v < n; v++) edges.push([u, v]);
    const result = maximalCliques(n, edges);
    assert.equal(result.length, 1);
    assert.deepEqual(result[0], Array.from({ length: n }, (_, i) => i));
  }
});

test('cyclic graph (triangle-free cycle C5) has one maximal clique per edge', () => {
  // 0-1-2-3-4-0, no chords -> triangle-free, so every edge is itself a
  // maximal 2-clique (no vertex is adjacent to both endpoints of any edge).
  const edges = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 0]];
  const result = maximalCliques(5, edges);
  assert.deepEqual(result, [[0, 1], [0, 4], [1, 2], [2, 3], [3, 4]]);
});

test('cyclic graph with a chord (C4 + one diagonal) produces one triangle and one edge', () => {
  // 0-1-2-3-0 plus chord 0-2: triangle {0,1,2}, triangle {0,2,3}... wait,
  // both triangles share edge 0-2, and each is maximal on its own since
  // 1 and 3 are not adjacent to each other.
  const edges = [[0, 1], [1, 2], [2, 3], [3, 0], [0, 2]];
  const result = maximalCliques(4, edges);
  assert.deepEqual(result, [[0, 1, 2], [0, 2, 3]]);
});

test('disconnected graph: maximal cliques are computed independently per component', () => {
  // Component A: triangle {0,1,2}. Component B: edge {3,4}. Isolated: {5}.
  const edges = [[0, 1], [1, 2], [0, 2], [3, 4]];
  const result = maximalCliques(6, edges);
  assert.deepEqual(result, [[0, 1, 2], [3, 4], [5]]);
});

// =========================================================================
// The required named K3,3,3 test
// =========================================================================

test('the complete tripartite graph K3,3,3 produces exactly 27 maximal cliques', () => {
  // Parts {0,1,2}, {3,4,5}, {6,7,8}; edges between every pair of vertices
  // in DIFFERENT parts, no edges within the same part. Every maximal
  // clique picks exactly one vertex from each part (3 * 3 * 3 = 27),
  // since same-part vertices are never adjacent and any one-per-part
  // selection is fully interconnected.
  const parts = [[0, 1, 2], [3, 4, 5], [6, 7, 8]];
  const edges = [];
  for (let pi = 0; pi < 3; pi++) {
    for (let pj = pi + 1; pj < 3; pj++) {
      for (const a of parts[pi]) for (const b of parts[pj]) edges.push([a, b]);
    }
  }

  const result = maximalCliques(9, edges);

  assert.equal(result.length, 27, 'K3,3,3 must have exactly 27 maximal cliques');
  assert.ok(result.every((c) => c.length === 3), 'every maximal clique in K3,3,3 has exactly 3 vertices');

  // Every clique must contain exactly one vertex from each part.
  for (const clique of result) {
    const countPerPart = parts.map((part) => clique.filter((v) => part.includes(v)).length);
    assert.deepEqual(countPerPart, [1, 1, 1]);
  }

  // No duplicates, and the result is exactly the 27 distinct one-per-part
  // combinations, confirmed against an independently constructed expected
  // set (cartesian product), sorted the same lexicographic way.
  const expected = [];
  for (const a of parts[0]) for (const b of parts[1]) for (const c of parts[2]) expected.push([a, b, c]);
  expected.sort(compareCliquesLexicographically);
  assert.deepEqual(result, expected);
});

// =========================================================================
// Invalid inputs
// =========================================================================

test('non-integer or negative vertexCount throws the correct error type', () => {
  assert.throws(() => maximalCliques('3', []), TypeError);
  assert.throws(() => maximalCliques(3.5, []), TypeError);
  assert.throws(() => maximalCliques(NaN, []), TypeError);
  assert.throws(() => maximalCliques(Infinity, []), TypeError);
  assert.throws(() => maximalCliques(null, []), TypeError);
  assert.throws(() => maximalCliques(undefined, []), TypeError);
  // Well-typed integer, but out of the allowed (non-negative) domain.
  assert.throws(() => maximalCliques(-1, []), RangeError);
  assert.throws(() => maximalCliques(-100, []), RangeError);
});

test('non-array edges throws TypeError', () => {
  assert.throws(() => maximalCliques(3, 'nope'), TypeError);
  assert.throws(() => maximalCliques(3, null), TypeError);
  assert.throws(() => maximalCliques(3, {}), TypeError);
  assert.throws(() => maximalCliques(3, 5), TypeError);
});

test('malformed edge entries throw TypeError', () => {
  assert.throws(() => maximalCliques(3, [[0]]), TypeError, 'edge with only 1 element');
  assert.throws(() => maximalCliques(3, [[0, 1, 2]]), TypeError, 'edge with 3 elements');
  assert.throws(() => maximalCliques(3, ['0,1']), TypeError, 'edge not an array');
  assert.throws(() => maximalCliques(3, [[0.5, 1]]), TypeError, 'non-integer endpoint');
  assert.throws(() => maximalCliques(3, [['0', 1]]), TypeError, 'string endpoint');
  assert.throws(() => maximalCliques(3, [[null, 1]]), TypeError, 'null endpoint');
  assert.throws(() => maximalCliques(3, [[NaN, 1]]), TypeError, 'NaN endpoint');
});

test('endpoints outside [0, vertexCount) throw RangeError', () => {
  assert.throws(() => maximalCliques(3, [[0, 3]]), RangeError, 'endpoint equal to vertexCount');
  assert.throws(() => maximalCliques(3, [[0, 100]]), RangeError, 'endpoint far out of range');
  assert.throws(() => maximalCliques(3, [[-1, 0]]), RangeError, 'negative endpoint');
});

test('self-loop edges throw RangeError', () => {
  assert.throws(() => maximalCliques(3, [[0, 0]]), RangeError);
  assert.throws(() => maximalCliques(3, [[1, 1]]), RangeError);
  assert.throws(() => maximalCliques(1, [[0, 0]]), RangeError);
});

test('invalid inputs never mutate the passed-in edges array', () => {
  const edges = [[0, 1], [1, 2]];
  const before = JSON.parse(JSON.stringify(edges));
  try {
    maximalCliques(3, edges.concat([[5, 5]]));
  } catch (e) {
    /* expected */
  }
  assert.deepEqual(edges, before);
});

// =========================================================================
// Shuffled and duplicate edges: input normalization, not error conditions
// =========================================================================

test('duplicate edges (exact repeats) are normalized away, not rejected', () => {
  const result = maximalCliques(3, [[0, 1], [0, 1], [0, 1], [1, 2]]);
  const expected = maximalCliques(3, [[0, 1], [1, 2]]);
  assert.deepEqual(result, expected);
});

test('reversed-order duplicate edges ([u,v] and [v,u]) are treated as the same edge', () => {
  const result = maximalCliques(3, [[0, 1], [1, 0], [1, 2], [2, 1]]);
  const expected = maximalCliques(3, [[0, 1], [1, 2]]);
  assert.deepEqual(result, expected);
});

test('shuffling edge order never changes the result', () => {
  const rand = mulberry32(2026);
  for (let trial = 0; trial < 30; trial++) {
    const n = 5 + Math.floor(rand() * 6);
    const edges = randomGraph(rand, n, rand());
    const canonical = maximalCliques(n, edges);
    const shuffled = edges.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    assert.deepEqual(maximalCliques(n, shuffled), canonical, `trial ${trial}`);
  }
});

// =========================================================================
// Determinism
// =========================================================================

test('the same graph produces byte-identical output across repeated independent calls', () => {
  const rand = mulberry32(13579);
  for (let trial = 0; trial < 20; trial++) {
    const n = 4 + Math.floor(rand() * 8);
    const edges = randomGraph(rand, n, rand());
    const first = maximalCliques(n, edges);
    for (let k = 0; k < 3; k++) {
      assert.deepEqual(maximalCliques(n, edges), first, `trial ${trial}, repeat ${k}`);
    }
  }
});

// =========================================================================
// Output shape: lexicographic order, validity, no duplicates
// =========================================================================

test('output is always sorted in ascending lexicographic order', () => {
  const rand = mulberry32(555);
  for (let trial = 0; trial < 20; trial++) {
    const n = 3 + Math.floor(rand() * 10);
    const edges = randomGraph(rand, n, rand());
    const result = maximalCliques(n, edges);
    assert.ok(isSortedLexicographically(result), `trial ${trial}: not sorted -- ${JSON.stringify(result)}`);
    for (const clique of result) {
      for (let i = 1; i < clique.length; i++) {
        assert.ok(clique[i - 1] < clique[i], 'each individual clique must list vertices in ascending order');
      }
    }
  }
});

test('every reported clique is a genuine clique and the whole set is duplicate-free', () => {
  const rand = mulberry32(31415);
  for (let trial = 0; trial < 20; trial++) {
    const n = 3 + Math.floor(rand() * 10);
    const edges = randomGraph(rand, n, rand());
    const result = maximalCliques(n, edges);
    assert.ok(isValidCliqueSet(n, edges, result), `trial ${trial}: some reported set is not a clique`);
    assert.ok(hasNoDuplicateCliques(result), `trial ${trial}: duplicate cliques in output`);
  }
});

// =========================================================================
// Differential test against the independent brute-force oracle
// =========================================================================

test('exhaustive comparison against the brute-force oracle for every labeled graph on 0..6 vertices', () => {
  for (let n = 0; n <= 6; n++) {
    const possibleEdges = [];
    for (let u = 0; u < n; u++) for (let v = u + 1; v < n; v++) possibleEdges.push([u, v]);
    const m = possibleEdges.length;
    const totalSubsets = 1 << m;
    for (let mask = 0; mask < totalSubsets; mask++) {
      const edges = [];
      for (let i = 0; i < m; i++) if (mask & (1 << i)) edges.push(possibleEdges[i]);
      const expected = bruteForceMaximalCliques(n, edges);
      const actual = maximalCliques(n, edges);
      assert.deepEqual(actual, expected, `n=${n}, edge-mask=${mask}`);
    }
  }
});

test('randomized comparison against the brute-force oracle at n=7..13', () => {
  for (let n = 7; n <= 13; n++) {
    const rand = mulberry32(n * 1009 + 7);
    for (let trial = 0; trial < 12; trial++) {
      const p = rand();
      const edges = randomGraph(rand, n, p);
      const expected = bruteForceMaximalCliques(n, edges);
      const actual = maximalCliques(n, edges);
      assert.deepEqual(actual, expected, `n=${n}, trial=${trial}, p=${p.toFixed(2)}`);
    }
  }
});

test('sparse randomized comparison against the brute-force oracle at n=14..16', () => {
  for (let n = 14; n <= 16; n++) {
    const rand = mulberry32(n * 7919 + 3);
    for (let trial = 0; trial < 6; trial++) {
      const p = rand() * 0.2; // keep sparse so 2^16 brute force stays fast
      const edges = randomGraph(rand, n, p);
      const expected = bruteForceMaximalCliques(n, edges);
      const actual = maximalCliques(n, edges);
      assert.deepEqual(actual, expected, `n=${n}, trial=${trial}, p=${p.toFixed(3)}`);
    }
  }
});
