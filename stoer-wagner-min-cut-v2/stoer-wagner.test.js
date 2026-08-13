'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { globalMinCut } = require('./stoer-wagner.js');

// xorshift32 PRNG, matching this repo's established differential-test convention.
function xorshift32(seed) {
  let state = seed >>> 0;
  return function next() {
    state ^= state << 13; state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5; state >>>= 0;
    return state / 4294967296;
  };
}

// Independent brute-force reference: enumerate every non-trivial
// bipartition of the vertex set (fixing vertex 0 to side A) and sum
// crossing-edge weight directly from the raw edge list. Structurally
// unrelated to the contraction-based algorithm under test.
function exhaustiveMinCut(vertexCount, edges) {
  const n = vertexCount;
  let bestWeight = Infinity;
  let bestMaskA = null;
  const totalMasks = 1 << (n - 1);
  for (let m = 0; m < totalMasks; m++) {
    let maskA = 1;
    for (let b = 0; b < n - 1; b++) {
      if (m & (1 << b)) maskA |= (1 << (b + 1));
    }
    const maskB = ((1 << n) - 1) & ~maskA;
    if (maskB === 0) continue;
    let weight = 0;
    for (const edge of edges) {
      const uInA = (maskA & (1 << edge.u)) !== 0;
      const vInA = (maskA & (1 << edge.v)) !== 0;
      if (uInA !== vInA) weight += edge.weight;
    }
    if (weight < bestWeight) {
      bestWeight = weight;
      bestMaskA = maskA;
    }
  }
  const sideA = [];
  const sideB = [];
  for (let v = 0; v < n; v++) {
    if (bestMaskA & (1 << v)) sideA.push(v); else sideB.push(v);
  }
  return { weight: bestWeight, sideA, sideB };
}

function crossingWeight(edges, sideASet) {
  let w = 0;
  for (const e of edges) {
    const uInA = sideASet.has(e.u);
    const vInA = sideASet.has(e.v);
    if (uInA !== vInA) w += e.weight;
  }
  return w;
}

function assertValidPartition(result, n) {
  const seen = new Array(n).fill(0);
  for (const v of result.partition[0]) seen[v]++;
  for (const v of result.partition[1]) seen[v]++;
  assert.ok(seen.every((c) => c === 1), 'partition must cover every vertex exactly once');
  assert.equal(result.partition[0].length + result.partition[1].length, n);
  assert.ok(result.partition[0].length > 0 && result.partition[1].length > 0, 'both sides must be non-empty');
  assert.ok(result.partition[0].includes(0), 'side A (partition[0]) must always contain vertex 0');
}

test('two-vertex graph: single edge is the only possible cut', () => {
  const result = globalMinCut(2, [{ u: 0, v: 1, weight: 7 }]);
  assert.equal(result.weight, 7);
  assert.deepEqual(result.partition, [[0], [1]]);
});

test('two-vertex graph: no edge at all, min cut weight 0', () => {
  const result = globalMinCut(2, []);
  assert.equal(result.weight, 0);
  assert.deepEqual(result.partition, [[0], [1]]);
});

test('path graph: light edge is the minimum cut', () => {
  // 0 --1-- 1 --10-- 2 : cutting the weight-1 edge isolates {0}.
  const result = globalMinCut(3, [{ u: 0, v: 1, weight: 1 }, { u: 1, v: 2, weight: 10 }]);
  assert.equal(result.weight, 1);
  assertValidPartition(result, 3);
  assert.equal(crossingWeight([{ u: 0, v: 1, weight: 1 }, { u: 1, v: 2, weight: 10 }], new Set(result.partition[0])), 1);
});

test('longer path graph: minimum edge weight anywhere along the chain wins', () => {
  const edges = [
    { u: 0, v: 1, weight: 5 },
    { u: 1, v: 2, weight: 2 },
    { u: 2, v: 3, weight: 8 },
    { u: 3, v: 4, weight: 6 },
  ];
  const result = globalMinCut(5, edges);
  assert.equal(result.weight, 2);
  assertValidPartition(result, 5);
});

test('cycle graph: equal weights, min cut = 2x edge weight', () => {
  const edges = [
    { u: 0, v: 1, weight: 1 },
    { u: 1, v: 2, weight: 1 },
    { u: 2, v: 3, weight: 1 },
    { u: 3, v: 0, weight: 1 },
  ];
  const result = globalMinCut(4, edges);
  assert.equal(result.weight, 2);
  assertValidPartition(result, 4);
  assert.equal(crossingWeight(edges, new Set(result.partition[0])), 2);
});

test('triangle with equal weights: min cut isolates any single vertex', () => {
  const edges = [
    { u: 0, v: 1, weight: 1 },
    { u: 1, v: 2, weight: 1 },
    { u: 0, v: 2, weight: 1 },
  ];
  const result = globalMinCut(3, edges);
  assert.equal(result.weight, 2);
  assertValidPartition(result, 3);
});

test('complete graph K4, unit weights: min cut isolates a single vertex', () => {
  const edges = [];
  for (let u = 0; u < 4; u++) {
    for (let v = u + 1; v < 4; v++) edges.push({ u, v, weight: 1 });
  }
  const result = globalMinCut(4, edges);
  assert.equal(result.weight, 3);
  assertValidPartition(result, 4);
  // exactly one side must be a singleton
  assert.ok(result.partition[0].length === 1 || result.partition[1].length === 1);
});

test('complete graph K5, unit weights: min cut isolates a single vertex', () => {
  const edges = [];
  for (let u = 0; u < 5; u++) {
    for (let v = u + 1; v < 5; v++) edges.push({ u, v, weight: 1 });
  }
  const result = globalMinCut(5, edges);
  assert.equal(result.weight, 4);
  assertValidPartition(result, 5);
});

test('disconnected graph: min cut weight 0, isolated vertex on its own side', () => {
  const edges = [{ u: 0, v: 1, weight: 3 }];
  const result = globalMinCut(3, edges);
  assert.equal(result.weight, 0);
  assertValidPartition(result, 3);
  assert.equal(crossingWeight(edges, new Set(result.partition[0])), 0);
});

test('fully disconnected graph (no edges at all): min cut weight 0', () => {
  const result = globalMinCut(4, []);
  assert.equal(result.weight, 0);
  assertValidPartition(result, 4);
});

test('zero-weight edges: contribute nothing to any cut', () => {
  const edges = [
    { u: 0, v: 1, weight: 0 },
    { u: 1, v: 2, weight: 5 },
  ];
  const result = globalMinCut(3, edges);
  assert.equal(result.weight, 0);
  assertValidPartition(result, 3);
});

test('all-zero-weight complete graph: min cut weight 0 regardless of partition', () => {
  const edges = [
    { u: 0, v: 1, weight: 0 },
    { u: 1, v: 2, weight: 0 },
    { u: 0, v: 2, weight: 0 },
  ];
  const result = globalMinCut(3, edges);
  assert.equal(result.weight, 0);
  assertValidPartition(result, 3);
});

test('parallel edges are summed into a single effective weight', () => {
  const result = globalMinCut(2, [
    { u: 0, v: 1, weight: 2 },
    { u: 0, v: 1, weight: 3 },
    { u: 1, v: 0, weight: 1 }, // reversed direction, still the same pair
  ]);
  assert.equal(result.weight, 6);
  assert.deepEqual(result.partition, [[0], [1]]);
});

test('parallel edges in a larger graph match the equivalent single-summed-edge graph', () => {
  const parallelEdges = [
    { u: 0, v: 1, weight: 2 },
    { u: 0, v: 1, weight: 3 },
    { u: 1, v: 2, weight: 10 },
  ];
  const summedEdges = [
    { u: 0, v: 1, weight: 5 },
    { u: 1, v: 2, weight: 10 },
  ];
  const r1 = globalMinCut(3, parallelEdges);
  const r2 = globalMinCut(3, summedEdges);
  assert.deepEqual(r1, r2);
});

test('equal-weight competing cuts: the algorithm still returns a valid minimum (first phase to reach it wins deterministically)', () => {
  // Two "barbell" clusters of equal cut weight so that ties can occur
  // between candidate minimum cuts across phases.
  const edges = [
    { u: 0, v: 1, weight: 5 },
    { u: 1, v: 2, weight: 2 },
    { u: 2, v: 3, weight: 5 },
    { u: 3, v: 4, weight: 2 },
    { u: 4, v: 0, weight: 5 },
  ];
  const result = globalMinCut(5, edges);
  const oracle = exhaustiveMinCut(5, edges);
  assert.equal(result.weight, oracle.weight);
  assertValidPartition(result, 5);
});

test('repeatability: running the same input twice gives byte-identical output', () => {
  const edges = [
    { u: 0, v: 1, weight: 4 },
    { u: 1, v: 2, weight: 2 },
    { u: 2, v: 3, weight: 6 },
    { u: 3, v: 0, weight: 3 },
    { u: 0, v: 2, weight: 1 },
  ];
  const r1 = globalMinCut(4, edges);
  const r2 = globalMinCut(4, edges);
  assert.deepEqual(r1, r2);
});

test('input edges array and its elements are never mutated', () => {
  const edges = [{ u: 0, v: 1, weight: 3 }, { u: 1, v: 2, weight: 4 }];
  const snapshot = JSON.parse(JSON.stringify(edges));
  globalMinCut(3, edges);
  assert.deepEqual(edges, snapshot);
});

test('classic Stoer-Wagner paper example (8 vertices): known minimum cut weight 4', () => {
  const edges = [
    { u: 0, v: 1, weight: 2 },
    { u: 0, v: 4, weight: 3 },
    { u: 1, v: 2, weight: 3 },
    { u: 1, v: 4, weight: 2 },
    { u: 1, v: 5, weight: 2 },
    { u: 2, v: 3, weight: 4 },
    { u: 2, v: 6, weight: 2 },
    { u: 3, v: 6, weight: 2 },
    { u: 3, v: 7, weight: 2 },
    { u: 4, v: 5, weight: 3 },
    { u: 5, v: 6, weight: 1 },
    { u: 6, v: 7, weight: 3 },
  ];
  const result = globalMinCut(8, edges);
  assert.equal(result.weight, 4);
  assertValidPartition(result, 8);
  assert.equal(crossingWeight(edges, new Set(result.partition[0])), 4);
});

test('invalid input: vertexCount', () => {
  assert.throws(() => globalMinCut('2', []), TypeError);
  assert.throws(() => globalMinCut(null, []), TypeError);
  assert.throws(() => globalMinCut(undefined, []), TypeError);
  assert.throws(() => globalMinCut(2.5, []), RangeError);
  assert.throws(() => globalMinCut(NaN, []), RangeError);
  assert.throws(() => globalMinCut(Infinity, []), RangeError);
  assert.throws(() => globalMinCut(1, []), RangeError);
  assert.throws(() => globalMinCut(0, []), RangeError);
  assert.throws(() => globalMinCut(-3, []), RangeError);
});

test('invalid input: edges array shape', () => {
  assert.throws(() => globalMinCut(3, 'not-an-array'), TypeError);
  assert.throws(() => globalMinCut(3, null), TypeError);
  assert.throws(() => globalMinCut(3, undefined), TypeError);
  assert.throws(() => globalMinCut(3, [null]), TypeError);
  assert.throws(() => globalMinCut(3, [42]), TypeError);
});

test('invalid input: individual edge fields', () => {
  assert.throws(() => globalMinCut(3, [{ u: '0', v: 1, weight: 1 }]), TypeError);
  assert.throws(() => globalMinCut(3, [{ u: 0, v: '1', weight: 1 }]), TypeError);
  assert.throws(() => globalMinCut(3, [{ u: 0, v: 1, weight: '1' }]), TypeError);
  assert.throws(() => globalMinCut(3, [{ u: 0.5, v: 1, weight: 1 }]), RangeError);
  assert.throws(() => globalMinCut(3, [{ u: 0, v: 1.5, weight: 1 }]), RangeError);
  assert.throws(() => globalMinCut(3, [{ u: -1, v: 1, weight: 1 }]), RangeError);
  assert.throws(() => globalMinCut(3, [{ u: 0, v: 3, weight: 1 }]), RangeError); // out of range (n=3, max index 2)
  assert.throws(() => globalMinCut(3, [{ u: 0, v: 0, weight: 1 }]), RangeError); // self-loop
  assert.throws(() => globalMinCut(3, [{ u: 0, v: 1, weight: -1 }]), RangeError);
  assert.throws(() => globalMinCut(3, [{ u: 0, v: 1, weight: 1.5 }]), RangeError);
  assert.throws(() => globalMinCut(3, [{ u: 0, v: 1, weight: NaN }]), RangeError);
  assert.throws(() => globalMinCut(3, [{ u: 0, v: 1, weight: Infinity }]), RangeError);
});

test('valid edge case: weight 0 is accepted (not rejected as falsy)', () => {
  assert.doesNotThrow(() => globalMinCut(2, [{ u: 0, v: 1, weight: 0 }]));
});

test('deterministic randomized differential coverage: xorshift32(0xC0FFEE), a seeded exhaustive oracle enumerating all cuts for >= 500 random graphs of up to eight vertices', () => {
  const rand = xorshift32(0xC0FFEE);
  const trials = 550;
  let checked = 0;
  for (let t = 0; t < trials; t++) {
    const n = 2 + Math.floor(rand() * 7); // 2..8 vertices
    const edgeProb = 0.2 + rand() * 0.6;
    const maxWeight = 1 + Math.floor(rand() * 10);
    const allowParallel = rand() < 0.3;

    const edges = [];
    for (let u = 0; u < n; u++) {
      for (let v = u + 1; v < n; v++) {
        if (rand() < edgeProb) {
          edges.push({ u, v, weight: Math.floor(rand() * maxWeight) });
          if (allowParallel && rand() < 0.2) {
            edges.push({ u, v, weight: Math.floor(rand() * maxWeight) });
          }
        }
      }
    }

    const oracle = exhaustiveMinCut(n, edges);
    const got = globalMinCut(n, edges);
    checked++;

    assert.equal(got.weight, oracle.weight, `trial ${t}: weight mismatch, n=${n}, edges=${JSON.stringify(edges)}`);

    // partition must be complete and disjoint
    const seen = new Array(n).fill(0);
    for (const v of got.partition[0]) seen[v]++;
    for (const v of got.partition[1]) seen[v]++;
    assert.ok(seen.every((c) => c === 1), `trial ${t}: partition not complete/disjoint`);
    assert.equal(got.partition[0].length + got.partition[1].length, n);
    assert.ok(got.partition[0].length > 0 && got.partition[1].length > 0, `trial ${t}: a side is empty`);

    // reported weight must equal the recomputed crossing weight of the
    // reported partition, independent of the algorithm's own bookkeeping.
    const recomputed = crossingWeight(edges, new Set(got.partition[0]));
    assert.equal(recomputed, got.weight, `trial ${t}: reported weight does not match recomputed crossing weight`);

    assert.ok(got.partition[0].includes(0), `trial ${t}: side A must contain vertex 0`);
  }
  assert.ok(checked >= 500, `expected >= 500 trials, got ${checked}`);
});
