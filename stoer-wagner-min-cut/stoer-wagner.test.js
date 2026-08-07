'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { stoerWagner } = require('./stoer-wagner.js');

// ---- shared helpers ----

/** Deterministic PRNG (mulberry32) so the seeded stress test below is
 * fully reproducible across runs and machines. */
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

/** Exhaustive brute-force global-minimum-cut oracle: tries every non-empty
 * proper subset (as the side containing vertex 0, to avoid counting each
 * partition twice) and returns the minimum crossing weight. Only usable
 * for small vertexCount (this suite keeps it to <= 9, i.e. <= 256 masks). */
function bruteForceMinCutWeight(vertexCount, edges) {
  const w = Array.from({ length: vertexCount }, () => new Array(vertexCount).fill(0));
  for (const [u, v, weight] of edges) {
    if (u === v) continue;
    w[u][v] += weight;
    w[v][u] += weight;
  }
  let best = Infinity;
  const total = 1 << vertexCount;
  for (let mask = 1; mask < total - 1; mask++) {
    if (!(mask & 1)) continue; // fix vertex 0 in the "A" side to avoid double-counting complements
    let weight = 0;
    for (let u = 0; u < vertexCount; u++) {
      if (!(mask & (1 << u))) continue;
      for (let v = 0; v < vertexCount; v++) {
        if (mask & (1 << v)) continue;
        weight += w[u][v];
      }
    }
    if (weight < best) best = weight;
  }
  return best;
}

/** Validates that `partition` is a legitimate, exhaustive, non-empty
 * bipartition of `0..vertexCount-1` whose crossing weight (recomputed
 * independently from `edges`) equals `claimedWeight`. */
function validatePartition(vertexCount, edges, partition, claimedWeight) {
  const [A, B] = partition;
  assert.ok(Array.isArray(A) && Array.isArray(B), 'partition must be [A, B] arrays');
  assert.ok(A.length > 0 && B.length > 0, 'both sides of the partition must be non-empty');
  assert.equal(A.length + B.length, vertexCount, 'partition must cover every vertex exactly once');
  const setA = new Set(A);
  const setB = new Set(B);
  assert.equal(setA.size, A.length, 'side A must not contain duplicates');
  assert.equal(setB.size, B.length, 'side B must not contain duplicates');
  for (const v of A) assert.ok(!setB.has(v), `vertex ${v} must not be on both sides`);
  for (let i = 0; i < vertexCount; i++) {
    assert.ok(setA.has(i) || setB.has(i), `vertex ${i} must be on some side`);
  }
  // each side must be ascending-sorted
  for (const side of [A, B]) {
    for (let i = 1; i < side.length; i++) {
      assert.ok(side[i - 1] < side[i], 'each side must be strictly ascending');
    }
  }
  // A must be the lexicographically smaller side (canonical orientation)
  const cmp = compareArrays(A, B);
  assert.ok(cmp < 0, 'side A must be lexicographically smaller than side B');

  const w = Array.from({ length: vertexCount }, () => new Array(vertexCount).fill(0));
  for (const [u, v, weight] of edges) {
    if (u === v) continue;
    w[u][v] += weight;
    w[v][u] += weight;
  }
  let weight = 0;
  for (const u of A) for (const v of B) weight += w[u][v];
  assert.equal(weight, claimedWeight, 'partition must actually achieve the claimed cut weight');
}

function compareArrays(a, b) {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

// ---- known cuts ----

test('triangle with one heavy edge: min cut isolates the middle-weight vertex', () => {
  // 0-1:1, 1-2:1, 0-2:5 -- cheapest cut isolates vertex 1 (1+1=2)
  const result = stoerWagner(3, [[0, 1, 1], [1, 2, 1], [0, 2, 5]]);
  assert.equal(result.weight, 2);
  validatePartition(3, [[0, 1, 1], [1, 2, 1], [0, 2, 5]], result.partition, 2);
  assert.deepEqual(result.partition, [[0, 2], [1]]);
});

test('4-cycle with two weak opposite edges: min cut isolates the two weak edges together', () => {
  // 0-1:1, 1-2:5, 2-3:1, 3-0:5 -- cutting {0,3}|{1,2} only crosses the two weight-1 edges
  const edges = [[0, 1, 1], [1, 2, 5], [2, 3, 1], [3, 0, 5]];
  const result = stoerWagner(4, edges);
  assert.equal(result.weight, 2);
  validatePartition(4, edges, result.partition, 2);
  assert.deepEqual(result.partition, [[0, 3], [1, 2]]);
});

test('classic Stoer-Wagner paper example (8 vertices, unique min cut of weight 4)', () => {
  // The worked example from the original Stoer & Wagner (1997) paper,
  // 0-indexed (paper vertices 1..8 -> 0..7). Its unique global minimum
  // cut has weight 4, separating {1,2,5,6} from {3,4,7,8} (1-indexed),
  // i.e. {0,1,4,5} from {2,3,6,7} here -- independently confirmed by
  // exhaustive brute force during development (see scratch-stress.js).
  const edges = [
    [0, 1, 2],
    [0, 4, 3],
    [1, 2, 3],
    [1, 4, 2],
    [1, 5, 2],
    [2, 3, 4],
    [2, 6, 2],
    [3, 6, 2],
    [3, 7, 2],
    [4, 5, 3],
    [5, 6, 1],
    [6, 7, 3],
  ];
  const result = stoerWagner(8, edges);
  assert.equal(result.weight, 4);
  assert.deepEqual(result.partition, [[0, 1, 4, 5], [2, 3, 6, 7]]);
  validatePartition(8, edges, result.partition, 4);
  assert.equal(bruteForceMinCutWeight(8, edges), 4, 'sanity check against the brute-force oracle');
});

test('two-vertex graph: min cut is just the single edge weight', () => {
  const result = stoerWagner(2, [[0, 1, 7]]);
  assert.equal(result.weight, 7);
  assert.deepEqual(result.partition, [[0], [1]]);
});

// ---- disconnected and zero-weight graphs ----

test('disconnected graph: min cut is 0, isolating a whole component', () => {
  // {0,1} connected (weight 5); {2,3} isolated with no edges at all
  const edges = [[0, 1, 5]];
  const result = stoerWagner(4, edges);
  assert.equal(result.weight, 0);
  validatePartition(4, edges, result.partition, 0);
});

test('three separate components: min cut is still 0', () => {
  const edges = [[0, 1, 3], [2, 3, 4]];
  const result = stoerWagner(6, edges); // vertices 4, 5 also isolated
  assert.equal(result.weight, 0);
  validatePartition(6, edges, result.partition, 0);
});

test('graph with no edges at all: min cut is 0 for any vertexCount >= 2', () => {
  const result = stoerWagner(5, []);
  assert.equal(result.weight, 0);
  validatePartition(5, [], result.partition, 0);
});

test('fully connected graph where every edge has weight 0: min cut is 0', () => {
  const edges = [];
  for (let u = 0; u < 4; u++) {
    for (let v = u + 1; v < 4; v++) edges.push([u, v, 0]);
  }
  const result = stoerWagner(4, edges);
  assert.equal(result.weight, 0);
  validatePartition(4, edges, result.partition, 0);
});

// ---- parallel edges ----

test('parallel edges between the same pair are summed before cutting', () => {
  // 0-1 appears three times (1+1+1=3), 1-2:5, 0-2:5 -> min cut isolates {0} at weight 3+5=8? check both:
  // cut{0}: (0-1 sum 3) + (0-2:5) = 8; cut{1}: (0-1 sum 3) + (1-2:5) = 8; cut{2}: (1-2:5)+(0-2:5)=10
  const edges = [[0, 1, 1], [0, 1, 1], [0, 1, 1], [1, 2, 5], [0, 2, 5]];
  const result = stoerWagner(3, edges);
  assert.equal(result.weight, 8);
  validatePartition(3, edges, result.partition, 8);
});

test('many parallel edges collapse to the same effective weight as one summed edge', () => {
  const parallel = [[0, 1, 2], [0, 1, 2], [1, 2, 5], [0, 2, 5]];
  const summed = [[0, 1, 4], [1, 2, 5], [0, 2, 5]];
  assert.deepEqual(stoerWagner(3, parallel), stoerWagner(3, summed));
});

// ---- self-loops ----

test('self-loops are ignored (they cannot affect any cut)', () => {
  const withLoop = [[0, 0, 999], [0, 1, 3]];
  const withoutLoop = [[0, 1, 3]];
  assert.deepEqual(stoerWagner(2, withLoop), stoerWagner(2, withoutLoop));
});

test('self-loops are still validated even though they end up ignored', () => {
  assert.throws(() => stoerWagner(2, [[0, 0, -5], [0, 1, 3]]), RangeError, 'negative self-loop weight must still be rejected');
  assert.throws(() => stoerWagner(2, [[0, 0, 'x'], [0, 1, 3]]), TypeError, 'non-numeric self-loop weight must still be rejected');
  assert.throws(() => stoerWagner(2, [[0, 0, NaN]]), TypeError, 'non-finite self-loop weight must still be rejected');
});

test('multiple self-loops on different vertices are all ignored', () => {
  const result = stoerWagner(3, [[0, 0, 100], [1, 1, 200], [2, 2, 300], [0, 1, 4], [1, 2, 4], [0, 2, 4]]);
  assert.equal(result.weight, 8); // cutting off any single vertex costs 4+4=8
});

// ---- tied cuts / determinism ----

test('repeated calls on the same graph return an identical result (deterministic)', () => {
  const edges = [[0, 1, 2], [1, 2, 3], [2, 3, 1], [3, 4, 4], [4, 0, 2], [1, 3, 1]];
  const results = Array.from({ length: 5 }, () => stoerWagner(5, edges));
  for (let i = 1; i < results.length; i++) {
    assert.deepEqual(results[i], results[0], `run ${i} must match run 0`);
  }
});

test('tied minimum-weight cuts: the lexicographically smaller partition wins, deterministically', () => {
  // 0-1: 2 (only edge among {0,1}), 1-2: 5, 0-2: 5. Cutting off {0} alone
  // and cutting off {1} alone both cost 2+5=7 -- a genuine tie. The
  // canonically-oriented candidates are [[0],[1,2]] (from isolating 0)
  // and [[0,2],[1]] (from isolating 1); [[0],[1,2]] sorts first.
  const edges = [[0, 1, 2], [1, 2, 5], [0, 2, 5]];
  const result = stoerWagner(3, edges);
  assert.equal(result.weight, 7);
  assert.deepEqual(result.partition, [[0], [1, 2]]);
  validatePartition(3, edges, result.partition, 7);
});

test('all-zero-weight graph (maximal tie): partition is still fully deterministic across repeats', () => {
  const edges = [[0, 1, 0], [1, 2, 0], [2, 3, 0], [3, 0, 0]];
  const results = Array.from({ length: 5 }, () => stoerWagner(4, edges));
  for (let i = 1; i < results.length; i++) assert.deepEqual(results[i], results[0]);
  assert.equal(results[0].weight, 0);
});

// ---- input immutability ----

test('does not mutate the edges array or any edge sub-array', () => {
  const edges = [[0, 1, 2], [1, 2, 3], [0, 2, 1]];
  const snapshot = edges.map((e) => e.slice());
  stoerWagner(3, edges);
  assert.deepEqual(edges, snapshot, 'edges array/sub-arrays must be unchanged after the call');
  assert.equal(edges.length, 3, 'edges array length must be unchanged');
});

test('does not mutate edges across multiple calls with the same array', () => {
  const edges = [[0, 1, 5], [1, 2, 5], [2, 3, 5], [3, 0, 5]];
  const snapshot = edges.map((e) => e.slice());
  stoerWagner(4, edges);
  stoerWagner(4, edges);
  stoerWagner(4, edges);
  assert.deepEqual(edges, snapshot);
});

// ---- invalid vertices or weights ----

test('vertexCount must be an integer', () => {
  assert.throws(() => stoerWagner(3.5, []), TypeError);
  assert.throws(() => stoerWagner('4', []), TypeError);
  assert.throws(() => stoerWagner(null, []), TypeError);
  assert.throws(() => stoerWagner(undefined, []), TypeError);
  assert.throws(() => stoerWagner(NaN, []), TypeError);
});

test('vertexCount must be at least 2', () => {
  assert.throws(() => stoerWagner(0, []), RangeError);
  assert.throws(() => stoerWagner(1, []), RangeError);
  assert.throws(() => stoerWagner(-3, []), RangeError);
});

test('edges must be an array', () => {
  assert.throws(() => stoerWagner(3, null), TypeError);
  assert.throws(() => stoerWagner(3, 'edges'), TypeError);
  assert.throws(() => stoerWagner(3, {}), TypeError);
});

test('each edge must be a well-formed [u, v, weight] triple', () => {
  assert.throws(() => stoerWagner(3, [[0, 1]]), TypeError, 'too short');
  assert.throws(() => stoerWagner(3, [[0, 1, 2, 3]]), TypeError, 'too long');
  assert.throws(() => stoerWagner(3, [null]), TypeError, 'not an array');
  assert.throws(() => stoerWagner(3, ['0,1,2']), TypeError, 'not an array');
});

test('u and v must be integers', () => {
  assert.throws(() => stoerWagner(3, [[0.5, 1, 1]]), TypeError);
  assert.throws(() => stoerWagner(3, [[0, 1.5, 1]]), TypeError);
  assert.throws(() => stoerWagner(3, [['0', 1, 1]]), TypeError);
  assert.throws(() => stoerWagner(3, [[0, '1', 1]]), TypeError);
  assert.throws(() => stoerWagner(3, [[NaN, 1, 1]]), TypeError);
});

test('u and v must be within [0, vertexCount)', () => {
  assert.throws(() => stoerWagner(3, [[-1, 1, 1]]), RangeError);
  assert.throws(() => stoerWagner(3, [[0, 3, 1]]), RangeError);
  assert.throws(() => stoerWagner(3, [[3, 0, 1]]), RangeError);
  assert.throws(() => stoerWagner(3, [[0, -1, 1]]), RangeError);
});

test('weight must be a finite number', () => {
  assert.throws(() => stoerWagner(3, [[0, 1, '1']]), TypeError);
  assert.throws(() => stoerWagner(3, [[0, 1, NaN]]), TypeError);
  assert.throws(() => stoerWagner(3, [[0, 1, Infinity]]), TypeError);
  assert.throws(() => stoerWagner(3, [[0, 1, -Infinity]]), TypeError);
  assert.throws(() => stoerWagner(3, [[0, 1, null]]), TypeError);
  assert.throws(() => stoerWagner(3, [[0, 1, undefined]]), TypeError);
});

test('weight must be non-negative', () => {
  assert.throws(() => stoerWagner(3, [[0, 1, -1]]), RangeError);
  assert.throws(() => stoerWagner(3, [[0, 1, -0.001]]), RangeError);
});

test('weight of exactly 0 is valid (not an error)', () => {
  assert.doesNotThrow(() => stoerWagner(2, [[0, 1, 0]]));
});

// ---- seeded small-graph tests against the exhaustive brute-force oracle ----

test('seeded random small graphs: weight and partition validity match exhaustive enumeration', () => {
  const rand = mulberry32(20260807);
  const trialCount = 400;
  let checked = 0;
  for (let trial = 0; trial < trialCount; trial++) {
    const vertexCount = 2 + Math.floor(rand() * 6); // 2..7 (2^7 = 128 masks, cheap to enumerate)
    const maxWeight = 1 + Math.floor(rand() * 6);
    const edgeCount = Math.floor(rand() * (vertexCount * vertexCount));
    const edges = [];
    for (let i = 0; i < edgeCount; i++) {
      const u = Math.floor(rand() * vertexCount);
      const v = Math.floor(rand() * vertexCount);
      const weight = Math.floor(rand() * maxWeight); // includes 0-weight edges
      edges.push([u, v, weight]);
    }

    const snapshot = edges.map((e) => e.slice());
    const result = stoerWagner(vertexCount, edges);
    assert.deepEqual(edges, snapshot, `trial ${trial}: edges must not be mutated`);

    const oracleWeight = bruteForceMinCutWeight(vertexCount, edges);
    assert.equal(result.weight, oracleWeight, `trial ${trial}: weight must match brute-force oracle (vertexCount=${vertexCount}, edges=${JSON.stringify(edges)})`);
    validatePartition(vertexCount, edges, result.partition, result.weight);
    checked++;
  }
  assert.equal(checked, trialCount);
});

test('seeded random small graphs: repeated calls stay identical (no hidden nondeterminism)', () => {
  const rand = mulberry32(424242);
  for (let trial = 0; trial < 60; trial++) {
    const vertexCount = 2 + Math.floor(rand() * 6);
    const edgeCount = Math.floor(rand() * (vertexCount * vertexCount));
    const edges = [];
    for (let i = 0; i < edgeCount; i++) {
      edges.push([Math.floor(rand() * vertexCount), Math.floor(rand() * vertexCount), Math.floor(rand() * 5)]);
    }
    const first = stoerWagner(vertexCount, edges);
    const second = stoerWagner(vertexCount, edges);
    assert.deepEqual(second, first, `trial ${trial}: must be deterministic`);
  }
});
