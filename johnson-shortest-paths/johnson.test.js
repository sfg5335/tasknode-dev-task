'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { johnson } = require('./johnson.js');

// Independent Floyd-Warshall reference implementation, deliberately
// structurally different from Johnson's algorithm (no reweighting, no
// Dijkstra, no heap -- a direct O(V^3) dynamic program), used to
// differentially cross-check johnson()'s output.
function floydWarshall(vertexCount, edges) {
  const dist = Array.from({ length: vertexCount }, () => new Array(vertexCount).fill(Infinity));
  for (let v = 0; v < vertexCount; v++) dist[v][v] = 0;
  for (const [from, to, weight] of edges) {
    if (weight < dist[from][to]) dist[from][to] = weight;
  }
  for (let k = 0; k < vertexCount; k++) {
    for (let i = 0; i < vertexCount; i++) {
      if (dist[i][k] === Infinity) continue;
      for (let j = 0; j < vertexCount; j++) {
        if (dist[k][j] === Infinity) continue;
        const candidate = dist[i][k] + dist[k][j];
        if (candidate < dist[i][j]) dist[i][j] = candidate;
      }
    }
  }
  let hasNegativeCycle = false;
  for (let v = 0; v < vertexCount; v++) {
    if (dist[v][v] < 0) hasNegativeCycle = true;
  }
  return { dist, hasNegativeCycle };
}

// mulberry32 seeded PRNG, for reproducible random trials.
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

function assertMatchesFloydWarshall(vertexCount, edges) {
  const { dist: expected, hasNegativeCycle } = floydWarshall(vertexCount, edges);
  if (hasNegativeCycle) {
    assert.throws(() => johnson(vertexCount, edges), RangeError);
    return;
  }
  const actual = johnson(vertexCount, edges);
  assert.deepEqual(actual, expected);
}

test('basic: simple two-vertex positive-weight graph', () => {
  const result = johnson(2, [[0, 1, 5]]);
  assert.deepEqual(result, [
    [0, 5],
    [Infinity, 0],
  ]);
});

test('basic: three-vertex chain accumulates weights along the path', () => {
  const result = johnson(3, [
    [0, 1, 2],
    [1, 2, 3],
  ]);
  assert.deepEqual(result, [
    [0, 2, 5],
    [Infinity, 0, 3],
    [Infinity, Infinity, 0],
  ]);
});

test('diagonal is always exactly zero, regardless of graph shape', () => {
  const graphs = [
    [1, []],
    [3, [[0, 1, 5], [1, 2, -3], [2, 0, 1]]],
    [4, [[0, 0, 100], [1, 2, -50], [3, 1, 7]]],
  ];
  for (const [vertexCount, edges] of graphs) {
    const result = johnson(vertexCount, edges);
    for (let v = 0; v < vertexCount; v++) {
      assert.equal(result[v][v], 0, `diagonal at ${v} should be 0 for vertexCount=${vertexCount}`);
    }
  }
});

test('empty graph: vertexCount 0 returns a 0x0 matrix', () => {
  const result = johnson(0, []);
  assert.deepEqual(result, []);
});

test('single vertex, no edges: 1x1 matrix of [[0]]', () => {
  const result = johnson(1, []);
  assert.deepEqual(result, [[0]]);
});

test('disconnected graph: unreachable pairs are Infinity in both directions', () => {
  const result = johnson(4, [
    [0, 1, 1],
    [2, 3, 1],
  ]);
  assert.equal(result[0][2], Infinity);
  assert.equal(result[0][3], Infinity);
  assert.equal(result[2][0], Infinity);
  assert.equal(result[1][2], Infinity);
  assert.equal(result[0][1], 1);
  assert.equal(result[2][3], 1);
});

test('fully disconnected graph (no edges at all): every off-diagonal entry is Infinity', () => {
  const result = johnson(3, []);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      if (i === j) assert.equal(result[i][j], 0);
      else assert.equal(result[i][j], Infinity);
    }
  }
});

test('negative edges without a cycle: a negative-weight shortcut is correctly found', () => {
  // 0 -> 2 direct costs 10, but 0 -> 1 -> 2 costs -3 + 2 = -1, which is cheaper.
  const result = johnson(3, [
    [0, 1, -3],
    [1, 2, 2],
    [0, 2, 10],
  ]);
  assert.equal(result[0][2], -1);
  assert.equal(result[0][1], -3);
  assert.equal(result[1][2], 2);
});

test('negative edges: a longer negative-weight path can beat a shorter positive one', () => {
  const result = johnson(4, [
    [0, 1, 1],
    [1, 2, 1],
    [2, 3, 1],
    [0, 3, 10],
  ]);
  assert.equal(result[0][3], 3); // via the 3-edge chain, not the direct edge
});

test('parallel edges: the minimum-weight parallel edge determines the shortest distance', () => {
  const result = johnson(2, [
    [0, 1, 10],
    [0, 1, 3],
    [0, 1, 7],
  ]);
  assert.equal(result[0][1], 3);
});

test('parallel edges combined with a cheaper indirect path still finds the true minimum', () => {
  const result = johnson(3, [
    [0, 1, 10],
    [0, 1, 8],
    [0, 2, 1],
    [2, 1, 2],
  ]);
  assert.equal(result[0][1], 3); // via vertex 2 (1 + 2), cheaper than either parallel edge
});

test('self-loops with non-negative weight have no effect on any shortest path', () => {
  const withoutSelfLoop = johnson(3, [
    [0, 1, 2],
    [1, 2, 3],
  ]);
  const withSelfLoop = johnson(3, [
    [0, 1, 2],
    [1, 1, 100],
    [1, 2, 3],
    [2, 2, 0],
  ]);
  assert.deepEqual(withSelfLoop, withoutSelfLoop);
});

test('self-loop with weight exactly zero is accepted and has no effect', () => {
  const result = johnson(2, [
    [0, 0, 0],
    [0, 1, 4],
  ]);
  assert.deepEqual(result, [
    [0, 4],
    [Infinity, 0],
  ]);
});

test('negative-weight self-loop is a negative cycle: throws RangeError', () => {
  assert.throws(() => johnson(1, [[0, 0, -1]]), RangeError);
  assert.throws(() => johnson(3, [[0, 1, 1], [1, 2, 1], [2, 2, -0.5]]), RangeError);
});

test('negative cycle (length > 1) is detected and throws RangeError', () => {
  assert.throws(() => johnson(2, [[0, 1, 1], [1, 0, -2]]), RangeError);
  assert.throws(
    () => johnson(3, [[0, 1, 1], [1, 2, 1], [2, 0, -3]]),
    RangeError
  );
});

test('negative cycle not reachable from every vertex is still detected', () => {
  // The negative cycle lives entirely among vertices 2,3; vertex 0,1 have no
  // path into it at all, and nothing points back out. Still must throw,
  // since Johnson's algorithm must detect a negative cycle anywhere in the
  // graph (not just ones reachable from vertex 0).
  assert.throws(
    () => johnson(4, [[0, 1, 5], [2, 3, 1], [3, 2, -3]]),
    RangeError
  );
});

test('a graph with negative edges but provably no negative cycle does not throw', () => {
  assert.doesNotThrow(() => johnson(3, [[0, 1, -5], [1, 2, -5], [0, 2, -1]]));
});

test('the classic CLRS Chapter 25 Bellman-Ford/Johnson example graph', () => {
  // 0-indexed transcription of the standard 5-vertex textbook example
  // (CLRS uses 1-indexed vertices 1..5); independently cross-checked
  // against the Floyd-Warshall reference below, not merely transcribed from
  // memory.
  const vertexCount = 5;
  const edges = [
    [0, 1, 3],
    [0, 2, 8],
    [0, 4, -4],
    [1, 3, 1],
    [1, 4, 7],
    [2, 1, 4],
    [3, 0, 2],
    [3, 2, -5],
    [4, 3, 6],
  ];
  const result = johnson(vertexCount, edges);
  assert.deepEqual(result, [
    [0, 1, -3, 2, -4],
    [3, 0, -4, 1, -1],
    [7, 4, 0, 5, 3],
    [2, -1, -5, 0, -2],
    [8, 5, 1, 6, 0],
  ]);
  assertMatchesFloydWarshall(vertexCount, edges);
});

test('comparison with a Floyd-Warshall oracle: hand-picked small graphs', () => {
  assertMatchesFloydWarshall(0, []);
  assertMatchesFloydWarshall(1, [[0, 0, 3]]);
  assertMatchesFloydWarshall(5, [
    [0, 1, 3],
    [0, 2, 8],
    [0, 4, -4],
    [1, 3, 1],
    [1, 4, 7],
    [2, 1, 4],
    [3, 0, 2],
    [3, 2, -5],
    [4, 3, 6],
  ]);
  assertMatchesFloydWarshall(4, [
    [0, 1, -2],
    [1, 2, -1],
    [2, 3, -1],
    [3, 1, 4],
  ]);
  assertMatchesFloydWarshall(6, [
    [0, 1, 4],
    [0, 2, 1],
    [2, 1, 1],
    [1, 3, 1],
    [2, 3, 5],
    [3, 4, 3],
    [4, 5, -2],
    [5, 3, 1],
  ]);
});

test('comparison with a Floyd-Warshall oracle: seeded random small graphs, integer weights (exact match expected)', () => {
  const rng = mulberry32(90210);
  for (let trial = 0; trial < 300; trial++) {
    const vertexCount = 1 + Math.floor(rng() * 6);
    const edgeCount = Math.floor(rng() * vertexCount * vertexCount * 1.5);
    const edges = [];
    for (let e = 0; e < edgeCount; e++) {
      const from = Math.floor(rng() * vertexCount);
      const to = Math.floor(rng() * vertexCount);
      const weight = Math.floor(rng() * 21) - 10; // -10..10
      edges.push([from, to, weight]);
    }
    assertMatchesFloydWarshall(vertexCount, edges);
  }
});

test('edge-order independence: shuffling the edges array does not change the result', () => {
  const edges = [
    [0, 1, 3],
    [0, 2, 8],
    [0, 4, -4],
    [1, 3, 1],
    [1, 4, 7],
    [2, 1, 4],
    [3, 0, 2],
    [3, 2, -5],
    [4, 3, 6],
  ];
  const baseline = johnson(5, edges);

  // deterministic shuffle (Fisher-Yates with a seeded PRNG), several
  // different permutations of the exact same edge multiset.
  const rng = mulberry32(112358);
  for (let trial = 0; trial < 20; trial++) {
    const shuffled = edges.map((e) => e.slice());
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const result = johnson(5, shuffled);
    assert.deepEqual(result, baseline, `mismatch after shuffle trial ${trial}`);
  }
});

test('edge-order independence also holds with parallel edges and self-loops present', () => {
  const edges = [
    [0, 1, 10],
    [1, 1, 5],
    [0, 1, 3],
    [1, 2, 2],
    [0, 2, 100],
    [2, 0, -1],
  ];
  const baseline = johnson(3, edges);
  const reversed = johnson(3, edges.slice().reverse());
  assert.deepEqual(reversed, baseline);
});

test('input immutability: the edges array and its sub-arrays are never mutated', () => {
  const edges = [
    [0, 1, 3],
    [1, 2, -2],
    [2, 0, 5],
  ];
  const snapshot = edges.map((e) => e.slice());
  Object.freeze(edges);
  edges.forEach((e) => Object.freeze(e));

  const result = johnson(3, edges);

  assert.deepEqual(edges.map((e) => e.slice()), snapshot);
  assert.equal(Array.isArray(result), true);
});

test('input immutability: vertexCount and edges are not retroactively affected by mutating the caller copy after the call', () => {
  const edges = [[0, 1, 4]];
  const result1 = johnson(2, edges);
  edges[0][2] = 999;
  edges.push([1, 0, -1000]);
  const result2 = johnson(2, [[0, 1, 4]]); // fresh, unrelated call with the original values
  assert.deepEqual(result1, result2);
});

test('repeated calls with the same graph produce identical results every time', () => {
  const vertexCount = 4;
  const edges = [
    [0, 1, 2],
    [1, 2, -1],
    [2, 3, 3],
    [3, 0, 1],
  ];
  const first = johnson(vertexCount, edges);
  for (let i = 0; i < 5; i++) {
    assert.deepEqual(johnson(vertexCount, edges), first);
  }
});

test('repeated calls with different graphs do not leak state between calls', () => {
  const a = johnson(2, [[0, 1, 5]]);
  const b = johnson(2, [[0, 1, -3]]);
  const aAgain = johnson(2, [[0, 1, 5]]);
  assert.deepEqual(a, aAgain);
  assert.notDeepEqual(a, b);
});

test('matrix dimensions are exactly vertexCount x vertexCount for a range of sizes', () => {
  for (const n of [0, 1, 2, 5, 10]) {
    const result = johnson(n, []);
    assert.equal(result.length, n);
    for (const row of result) {
      assert.equal(row.length, n);
    }
  }
});

test('invalid inputs: throws TypeError when vertexCount has the wrong type', () => {
  for (const bad of ['3', null, undefined, {}, [], true, NaN]) {
    assert.throws(() => johnson(bad, []), TypeError, `vertexCount=${String(bad)}`);
  }
});

test('invalid inputs: throws TypeError when vertexCount is not an integer', () => {
  assert.throws(() => johnson(2.5, []), TypeError);
  assert.throws(() => johnson(Infinity, []), TypeError);
});

test('invalid inputs: throws RangeError when vertexCount is a negative integer', () => {
  assert.throws(() => johnson(-1, []), RangeError);
  assert.throws(() => johnson(-5, []), RangeError);
});

test('invalid inputs: throws TypeError when edges is not an array', () => {
  for (const bad of [null, undefined, 'edges', 42, {}]) {
    assert.throws(() => johnson(2, bad), TypeError, `edges=${String(bad)}`);
  }
});

test('invalid inputs: throws TypeError when an individual edge is not a length-3 array', () => {
  assert.throws(() => johnson(2, [[0, 1]]), TypeError); // too short
  assert.throws(() => johnson(2, [[0, 1, 2, 3]]), TypeError); // too long
  assert.throws(() => johnson(2, ['not-an-array']), TypeError);
  assert.throws(() => johnson(2, [{ from: 0, to: 1, weight: 2 }]), TypeError);
});

test('invalid inputs: throws TypeError when an edge endpoint is not an integer', () => {
  assert.throws(() => johnson(2, [[0.5, 1, 2]]), TypeError);
  assert.throws(() => johnson(2, [[0, '1', 2]]), TypeError);
  assert.throws(() => johnson(2, [[0, null, 2]]), TypeError);
  assert.throws(() => johnson(2, [[NaN, 1, 2]]), TypeError);
});

test('invalid inputs: throws TypeError when an edge weight is not a finite number', () => {
  assert.throws(() => johnson(2, [[0, 1, '5']]), TypeError);
  assert.throws(() => johnson(2, [[0, 1, NaN]]), TypeError);
  assert.throws(() => johnson(2, [[0, 1, Infinity]]), TypeError);
  assert.throws(() => johnson(2, [[0, 1, -Infinity]]), TypeError);
  assert.throws(() => johnson(2, [[0, 1, null]]), TypeError);
});

test('invalid inputs: throws RangeError when an edge endpoint is out of range', () => {
  assert.throws(() => johnson(2, [[0, 2, 1]]), RangeError); // to === vertexCount, out of range
  assert.throws(() => johnson(2, [[-1, 0, 1]]), RangeError); // from negative
  assert.throws(() => johnson(3, [[5, 0, 1]]), RangeError);
});

test('invalid-input RangeError and TypeError cases are distinct error classes', () => {
  let typeErrorCaught = false;
  let rangeErrorCaught = false;
  try {
    johnson('not a number', []);
  } catch (e) {
    typeErrorCaught = e instanceof TypeError && !(e instanceof RangeError);
  }
  try {
    johnson(-1, []);
  } catch (e) {
    rangeErrorCaught = e instanceof RangeError && !(e instanceof TypeError);
  }
  assert.equal(typeErrorCaught, true);
  assert.equal(rangeErrorCaught, true);
});

test('valid inputs with zero vertices and non-empty vertexCount but empty edges do not throw', () => {
  assert.doesNotThrow(() => johnson(0, []));
  assert.doesNotThrow(() => johnson(5, []));
});

test('a moderately large sparse random graph completes quickly and matches Floyd-Warshall', () => {
  const rng = mulberry32(424242);
  const vertexCount = 60;
  const edges = [];
  for (let i = 0; i < vertexCount; i++) {
    for (let j = 0; j < 4; j++) {
      const to = Math.floor(rng() * vertexCount);
      if (to === i) continue;
      const weight = Math.floor(rng() * 15) - 5;
      edges.push([i, to, weight]);
    }
  }
  const start = Date.now();
  const { dist: expected, hasNegativeCycle } = floydWarshall(vertexCount, edges);
  if (hasNegativeCycle) {
    assert.throws(() => johnson(vertexCount, edges), RangeError);
    return;
  }
  const result = johnson(vertexCount, edges);
  const elapsedMs = Date.now() - start;
  assert.deepEqual(result, expected);
  assert.ok(elapsedMs < 3000, `expected the 60-vertex run to complete quickly, took ${elapsedMs}ms`);
});
