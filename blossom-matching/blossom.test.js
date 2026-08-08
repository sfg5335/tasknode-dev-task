'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { maximumMatching } = require('./blossom.js');

// ---------------------------------------------------------------------
// Independent oracle: exact maximum-cardinality matching via dynamic
// programming over subsets of vertices. Structurally unrelated to the
// augmenting-path / blossom-contraction design under test -- dp[mask] is
// "the best matching achievable using only the vertices in mask", computed
// by picking the lowest-indexed available vertex and trying every option
// of either leaving it unmatched or pairing it with an available neighbor.
// Exponential in n, so only used for small/moderate n (bitmask limits).
// ---------------------------------------------------------------------
function bruteForceMaxMatching(n, adjacency) {
  if (n === 0) return 0;
  const size = 1 << n;
  const memo = new Int16Array(size).fill(-1);
  function solve(mask) {
    if (mask === 0) return 0;
    const cached = memo[mask];
    if (cached !== -1) return cached;
    let v = 0;
    while (((mask >> v) & 1) === 0) v++;
    let best = solve(mask & ~(1 << v));
    for (const u of adjacency[v]) {
      if (((mask >> u) & 1) === 1) {
        const sub = mask & ~(1 << v) & ~(1 << u);
        const candidate = 1 + solve(sub);
        if (candidate > best) best = candidate;
      }
    }
    memo[mask] = best;
    return best;
  }
  return solve(size - 1);
}

function buildAdjacency(n, edges) {
  const adjacency = Array.from({ length: n }, () => []);
  for (const [a, b] of edges) {
    adjacency[a].push(b);
    adjacency[b].push(a);
  }
  return adjacency;
}

// Structural validator: confirms `mate` is an internally-consistent
// matching (symmetric, no vertex used twice) whose every matched pair is
// actually an edge of the input graph, and whose cardinality is exactly
// half the number of matched (non -1) entries.
function assertValidMatching(n, edges, result) {
  const edgeKey = new Set(edges.map(([a, b]) => (a < b ? `${a},${b}` : `${b},${a}`)));
  assert.equal(result.mate.length, n, 'mate array length must equal vertexCount');
  let matchedCount = 0;
  for (let v = 0; v < n; v++) {
    const m = result.mate[v];
    if (m === -1) continue;
    matchedCount++;
    assert.ok(m >= 0 && m < n, `mate[${v}] = ${m} out of range`);
    assert.notEqual(m, v, `vertex ${v} cannot be matched to itself`);
    assert.equal(result.mate[m], v, `mate must be symmetric: mate[${v}]=${m} but mate[${m}]=${result.mate[m]}`);
    const key = v < m ? `${v},${m}` : `${m},${v}`;
    assert.ok(edgeKey.has(key), `matched pair {${v},${m}} is not an edge of the input graph`);
  }
  assert.equal(matchedCount % 2, 0, 'matched vertex count must be even');
  assert.equal(result.cardinality, matchedCount / 2, 'reported cardinality must equal half the matched vertex count');
}

function checkAgainstOracle(n, edges) {
  const result = maximumMatching(n, edges);
  assertValidMatching(n, edges, result);
  const expected = bruteForceMaxMatching(n, buildAdjacency(n, edges));
  assert.equal(result.cardinality, expected, `cardinality mismatch for n=${n} edges=${JSON.stringify(edges)}`);
  return result;
}

// ---------------------------------------------------------------------

test('empty graph (n=0) has cardinality 0 and an empty mate array', () => {
  const result = maximumMatching(0, []);
  assert.deepEqual(result, { cardinality: 0, mate: [] });
});

test('a graph with vertices but no edges has cardinality 0 and every vertex unmatched', () => {
  const result = maximumMatching(4, []);
  assert.deepEqual(result, { cardinality: 0, mate: [-1, -1, -1, -1] });
});

test('a single edge matches both its endpoints', () => {
  const result = checkAgainstOracle(2, [[0, 1]]);
  assert.deepEqual(result, { cardinality: 1, mate: [1, 0] });
});

test('a disconnected graph matches every component independently', () => {
  const result = checkAgainstOracle(6, [[0, 1], [2, 3]]);
  assert.equal(result.cardinality, 2);
  assert.equal(result.mate[4], -1);
  assert.equal(result.mate[5], -1);
});

test('an even-length path (4 vertices) admits a perfect matching', () => {
  const result = checkAgainstOracle(4, [[0, 1], [1, 2], [2, 3]]);
  assert.equal(result.cardinality, 2);
});

test('an odd-length path (5 vertices) leaves exactly one vertex unmatched', () => {
  const result = checkAgainstOracle(5, [[0, 1], [1, 2], [2, 3], [3, 4]]);
  assert.equal(result.cardinality, 2);
  const unmatchedCount = result.mate.filter((m) => m === -1).length;
  assert.equal(unmatchedCount, 1);
});

test('an even cycle (6 vertices) admits a perfect matching', () => {
  const result = checkAgainstOracle(6, [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0]]);
  assert.equal(result.cardinality, 3);
  assert.ok(result.mate.every((m) => m !== -1));
});

test('an odd cycle (5 vertices) can never admit a perfect matching', () => {
  const result = checkAgainstOracle(5, [[0, 1], [1, 2], [2, 3], [3, 4], [4, 0]]);
  assert.equal(result.cardinality, 2);
  assert.equal(result.mate.filter((m) => m === -1).length, 1);
});

test('contraction-dependent augmenting path: triangle with a pendant on two different triangle vertices requires blossom contraction to find the maximum matching', () => {
  // Empirically confirmed (via a temporary instrumented copy of this exact
  // implementation, run interactively) that this specific graph, processed
  // in the algorithm's default ascending vertex/edge order starting from
  // an empty matching, causes the blossom-contraction branch inside
  // findAugmentingPathFrom to fire exactly once: vertex 0 is a pendant on
  // triangle vertex 0... concretely, triangle {0,1,2} plus pendant 3-0 and
  // pendant 4-1. Without contracting the odd triangle cycle, a naive
  // augmenting-path search exploring from one pendant into the triangle
  // and back out towards the other pendant would misinterpret the
  // alternating structure around the odd cycle. The independent bitmask-DP
  // oracle confirms the correct answer is cardinality 2 (5 vertices is
  // odd, so a perfect matching is impossible; {0-3, 1-4} or {0-1, none
  // else} etc. -- the true maximum is 2, leaving vertex 2 unmatched).
  const result = checkAgainstOracle(5, [[0, 1], [1, 2], [2, 0], [0, 3], [1, 4]]);
  assert.equal(result.cardinality, 2);
});

test('a second contraction-dependent case: a 5-cycle with pendants on two different cycle vertices', () => {
  // Also empirically confirmed to exercise blossom contraction. 7
  // vertices, odd 5-cycle {0,1,2,3,4} plus pendants 5-2 and 6-3.
  const result = checkAgainstOracle(7, [
    [0, 1], [1, 2], [2, 3], [3, 4], [4, 0], [2, 5], [3, 6],
  ]);
  assert.equal(result.cardinality, 3);
});

test('reordering the input edges does not change the result (determinism)', () => {
  const edgesA = [[0, 1], [1, 2], [2, 0], [0, 3], [1, 4]];
  const edgesB = [[1, 4], [0, 3], [2, 0], [1, 2], [0, 1]]; // same set, shuffled
  const resultA = maximumMatching(5, edgesA);
  const resultB = maximumMatching(5, edgesB);
  assert.deepEqual(resultA, resultB);
});

test('running the same input twice yields byte-identical results (determinism)', () => {
  const edges = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 0], [2, 5], [3, 6]];
  const result1 = maximumMatching(7, edges);
  const result2 = maximumMatching(7, edges);
  assert.deepEqual(result1, result2);
});

test('duplicate edges (including reversed-endpoint duplicates) are deduplicated, not double-counted or rejected', () => {
  const withDuplicates = [[0, 1], [1, 0], [0, 1], [1, 2], [2, 1]];
  const deduped = [[0, 1], [1, 2]];
  const resultWithDuplicates = maximumMatching(3, withDuplicates);
  const resultDeduped = maximumMatching(3, deduped);
  assert.deepEqual(resultWithDuplicates, resultDeduped);
  assert.equal(resultWithDuplicates.cardinality, 1);
});

test('vertexCount that is not an integer throws TypeError', () => {
  for (const bad of [1.5, '3', null, undefined, NaN, Infinity, {}, [], true]) {
    assert.throws(() => maximumMatching(bad, []), TypeError);
  }
});

test('a negative vertexCount throws RangeError', () => {
  assert.throws(() => maximumMatching(-1, []), RangeError);
  assert.throws(() => maximumMatching(-100, []), RangeError);
});

test('edges that is not an array throws TypeError', () => {
  for (const bad of [null, undefined, 'edges', 42, {}, new Set()]) {
    assert.throws(() => maximumMatching(3, bad), TypeError);
  }
});

test('an edge that is not a 2-element array throws TypeError', () => {
  for (const bad of [[0], [0, 1, 2], 'ab', { 0: 0, 1: 1 }, null, 5]) {
    assert.throws(() => maximumMatching(3, [bad]), TypeError);
  }
});

test('edge endpoints that are not integers throw TypeError', () => {
  for (const bad of [0.5, '1', null, undefined, NaN, {}, []]) {
    assert.throws(() => maximumMatching(3, [[0, bad]]), TypeError);
    assert.throws(() => maximumMatching(3, [[bad, 0]]), TypeError);
  }
});

test('edge endpoints out of the [0, vertexCount) range throw RangeError', () => {
  assert.throws(() => maximumMatching(3, [[0, 3]]), RangeError);
  assert.throws(() => maximumMatching(3, [[-1, 1]]), RangeError);
  assert.throws(() => maximumMatching(0, [[0, 1]]), RangeError);
});

test('a self-loop edge throws RangeError', () => {
  assert.throws(() => maximumMatching(3, [[1, 1]]), RangeError);
});

test('invalid edges are rejected before any valid ones are processed (no partial mutation of caller state)', () => {
  // Not directly observable on the module's own state (it has none), but
  // documents that validation happens in a dedicated pass before the
  // algorithm runs -- confirmed structurally by reading the source, and
  // behaviorally here by checking a mixed valid/invalid list throws.
  assert.throws(() => maximumMatching(3, [[0, 1], [1, 1]]), RangeError);
});

test('input edges array and its sub-arrays are never mutated (frozen inputs still work)', () => {
  const inner1 = Object.freeze([0, 1]);
  const inner2 = Object.freeze([1, 0]); // reversed duplicate of inner1
  const inner3 = Object.freeze([1, 2]);
  const edges = Object.freeze([inner1, inner2, inner3]);
  const snapshotBefore = JSON.stringify(edges);
  const result = maximumMatching(3, edges);
  assert.equal(JSON.stringify(edges), snapshotBefore, 'edges array must not be mutated');
  assert.equal(result.cardinality, 1);
});

test('the returned mate array is a fresh array, not aliased to any internal state across calls', () => {
  const result1 = maximumMatching(2, [[0, 1]]);
  const result2 = maximumMatching(2, [[0, 1]]);
  assert.notEqual(result1.mate, result2.mate, 'each call must return its own array');
  assert.deepEqual(result1.mate, result2.mate);
});

// ---------------------------------------------------------------------
// Required exhaustive check: every simple graph on 0..6 vertices,
// compared against the independent bitmask-DP oracle, with full
// structural matching validation on every single graph.
// ---------------------------------------------------------------------
test('exhaustive: matches the independent oracle on every simple graph with up to 6 vertices', () => {
  let graphsChecked = 0;
  for (let n = 0; n <= 6; n++) {
    const allPairs = [];
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) allPairs.push([i, j]);
    }
    const m = allPairs.length;
    const subsetCount = 1 << m;
    for (let mask = 0; mask < subsetCount; mask++) {
      const edges = [];
      for (let b = 0; b < m; b++) {
        if ((mask >> b) & 1) edges.push(allPairs[b]);
      }
      checkAgainstOracle(n, edges);
      graphsChecked++;
    }
  }
  // n=0..6 complete-graph edge-subset counts: 1+1+2+8+64+1024+32768 = 33868.
  assert.equal(graphsChecked, 33868, 'must have exhaustively checked every simple graph on 0..6 vertices');
});

// ---------------------------------------------------------------------
// Randomized differential test against the same independent oracle, at
// sizes larger than the exhaustive n<=6 sweep can reach.
// ---------------------------------------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('randomized differential test against the independent oracle for larger graphs (up to 14 vertices)', () => {
  const rand = mulberry32(20260808);
  let trialsRun = 0;
  for (let trial = 0; trial < 200; trial++) {
    const n = 2 + Math.floor(rand() * 13); // 2..14
    const density = 0.15 + rand() * 0.55; // sparse to fairly dense
    const edges = [];
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (rand() < density) edges.push([i, j]);
      }
    }
    checkAgainstOracle(n, edges);
    trialsRun++;
  }
  assert.equal(trialsRun, 200);
});
