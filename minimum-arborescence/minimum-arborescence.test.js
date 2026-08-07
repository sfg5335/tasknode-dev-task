'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { minimumArborescence } = require('./minimum-arborescence.js');

// ---- shared helpers ----

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

/** Exhaustive brute-force oracle: tries every combination of "one
 * incoming edge per non-root vertex" and keeps the cheapest one that
 * forms an acyclic tree rooted at `root`. Only usable for small graphs
 * (this suite keeps max in-degree * vertex count small enough to stay
 * fast). Returns `{ weight, edgeIndices }` or `null`, same shape as the
 * real function. */
function bruteForce(vertexCount, edges, root) {
  const byTo = Array.from({ length: vertexCount }, () => []);
  edges.forEach((e, i) => {
    if (e.from !== e.to) byTo[e.to].push(i);
  });
  const nonRoot = [];
  for (let v = 0; v < vertexCount; v++) if (v !== root) nonRoot.push(v);
  for (const v of nonRoot) if (byTo[v].length === 0) return null;

  let best = null;

  function isAcyclic(chosen) {
    for (const v of nonRoot) {
      let u = v;
      const seen = new Set();
      while (u !== root) {
        if (seen.has(u)) return false;
        seen.add(u);
        u = edges[chosen.get(u)].from;
      }
    }
    return true;
  }

  function recurse(idx, chosen, weight) {
    if (idx === nonRoot.length) {
      if (isAcyclic(chosen)) {
        if (best === null || weight < best.weight) {
          best = { weight, edgeIndices: Array.from(chosen.values()).sort((a, b) => a - b) };
        }
      }
      return;
    }
    const v = nonRoot[idx];
    for (const eIdx of byTo[v]) {
      chosen.set(v, eIdx);
      recurse(idx + 1, chosen, weight + edges[eIdx].weight);
    }
    chosen.delete(v);
  }

  recurse(0, new Map(), 0);
  return best;
}

/** Validates that a non-null `result` really is a legitimate spanning
 * arborescence of `edges` rooted at `root`, and that its reported weight
 * matches the original (unadjusted) edge weights. */
function validateResult(vertexCount, edges, root, result) {
  assert.ok(result !== null, 'expected a feasible result');
  assert.equal(result.edgeIndices.length, vertexCount - 1, 'must select exactly vertexCount - 1 edges');
  const chosen = new Map();
  for (const idx of result.edgeIndices) {
    const e = edges[idx];
    assert.ok(!chosen.has(e.to), `vertex ${e.to} must not receive two selected incoming edges`);
    chosen.set(e.to, idx);
  }
  for (let v = 0; v < vertexCount; v++) {
    if (v === root) continue;
    assert.ok(chosen.has(v), `vertex ${v} must have a selected incoming edge`);
    let u = v;
    const seen = new Set();
    while (u !== root) {
      assert.ok(!seen.has(u), 'selected edges must not contain a cycle');
      seen.add(u);
      u = edges[chosen.get(u)].from;
    }
  }
  let recomputed = 0;
  for (const idx of result.edgeIndices) recomputed += edges[idx].weight;
  assert.equal(result.weight, recomputed, 'reported weight must equal the sum of original edge weights');
}

// ---- one-vertex graphs ----

test('single-vertex graph: trivial arborescence with no edges', () => {
  const result = minimumArborescence(1, [], 0);
  assert.deepEqual(result, { weight: 0, edgeIndices: [] });
});

test('single-vertex graph with an ignored self-loop still resolves trivially', () => {
  const result = minimumArborescence(1, [{ from: 0, to: 0, weight: 5 }], 0);
  assert.deepEqual(result, { weight: 0, edgeIndices: [] });
});

// ---- simple trees ----

test('already-a-tree graph: every edge is selected, in original order', () => {
  const edges = [
    { from: 0, to: 1, weight: 1 },
    { from: 0, to: 2, weight: 2 },
    { from: 1, to: 3, weight: 3 },
  ];
  const result = minimumArborescence(4, edges, 0);
  assert.deepEqual(result, { weight: 6, edgeIndices: [0, 1, 2] });
  validateResult(4, edges, 0, result);
});

test('star graph rooted at the center', () => {
  const edges = [
    { from: 0, to: 1, weight: 5 },
    { from: 0, to: 2, weight: 3 },
    { from: 0, to: 3, weight: 8 },
    { from: 0, to: 4, weight: 1 },
  ];
  const result = minimumArborescence(5, edges, 0);
  assert.deepEqual(result, { weight: 17, edgeIndices: [0, 1, 2, 3] });
  validateResult(5, edges, 0, result);
});

test('picks the cheaper of two direct edges when both endpoints are already reachable from root directly', () => {
  const edges = [
    { from: 0, to: 1, weight: 10 }, // 0
    { from: 0, to: 2, weight: 1 }, // 1
    { from: 2, to: 1, weight: 2 }, // 2 -- cheaper path to 1: 0->2->1 = 1+2 = 3 < 10
  ];
  const result = minimumArborescence(3, edges, 0);
  assert.deepEqual(result, { weight: 3, edgeIndices: [1, 2] });
  validateResult(3, edges, 0, result);
});

// ---- impossible graphs ----

test('impossible: a non-root vertex has no incoming edge at all', () => {
  assert.equal(minimumArborescence(3, [{ from: 1, to: 2, weight: 1 }], 0), null);
});

test('impossible: a component is entirely disconnected from root', () => {
  const edges = [
    { from: 0, to: 1, weight: 1 },
    { from: 2, to: 3, weight: 1 },
    { from: 3, to: 2, weight: 1 },
  ];
  assert.equal(minimumArborescence(4, edges, 0), null);
});

test('impossible: only self-loops point at a non-root vertex', () => {
  const edges = [
    { from: 0, to: 1, weight: 1 },
    { from: 2, to: 2, weight: 1 }, // self-loop, never counts as an incoming edge
  ];
  assert.equal(minimumArborescence(3, edges, 0), null);
});

test('feasible for every non-root vertex individually is not sufficient if it requires a cycle-only component', () => {
  // vertex 1 and 2 both have incoming edges, but only from each other -- no path from root 0 at all
  const edges = [
    { from: 1, to: 2, weight: 1 },
    { from: 2, to: 1, weight: 1 },
  ];
  assert.equal(minimumArborescence(3, edges, 0), null);
});

// ---- parallel and tied edges ----

test('parallel edges: the cheaper of two edges on the same pair wins', () => {
  const edges = [
    { from: 0, to: 1, weight: 9 }, // 0
    { from: 0, to: 1, weight: 4 }, // 1 -- cheaper parallel edge
  ];
  const result = minimumArborescence(2, edges, 0);
  assert.deepEqual(result, { weight: 4, edgeIndices: [1] });
});

test('tied edges: the smallest original index wins deterministically', () => {
  const edges = [
    { from: 0, to: 1, weight: 5 }, // 0
    { from: 0, to: 1, weight: 5 }, // 1 -- same weight, higher index, must lose
  ];
  const result = minimumArborescence(2, edges, 0);
  assert.deepEqual(result, { weight: 5, edgeIndices: [0] });
});

test('tied edges through a contraction: the resolved entry point still respects original-index tie-breaking', () => {
  // 2-cycle {1,2} both weight 1; two equally-cheap (weight 10) entry points.
  // The reduction makes both entries cost 10-1=9 after contraction -- a
  // genuine tie broken by original edge index (edge 0 beats edge 3).
  const edges = [
    { from: 0, to: 1, weight: 10 }, // 0
    { from: 1, to: 2, weight: 1 }, // 1
    { from: 2, to: 1, weight: 1 }, // 2
    { from: 0, to: 2, weight: 10 }, // 3
  ];
  const result = minimumArborescence(3, edges, 0);
  assert.deepEqual(result, { weight: 11, edgeIndices: [0, 1] });
  validateResult(3, edges, 0, result);
  assert.deepEqual(bruteForce(3, edges, 0), result);
});

// ---- negative weights ----

test('negative weights are fully supported and can lower the total below zero', () => {
  const edges = [
    { from: 0, to: 1, weight: -5 },
    { from: 1, to: 2, weight: -3 },
  ];
  const result = minimumArborescence(3, edges, 0);
  assert.deepEqual(result, { weight: -8, edgeIndices: [0, 1] });
});

test('negative weights inside a contracted cycle still net out correctly', () => {
  const edges = [
    { from: 0, to: 1, weight: 100 }, // 0
    { from: 1, to: 2, weight: -5 }, // 1
    { from: 2, to: 1, weight: -5 }, // 2
    { from: 0, to: 2, weight: 100 }, // 3
  ];
  const result = minimumArborescence(3, edges, 0);
  validateResult(3, edges, 0, result);
  assert.deepEqual(bruteForce(3, edges, 0), result);
});

// ---- cycles requiring single and nested contractions ----

test('a single 2-cycle requires exactly one contraction', () => {
  const edges = [
    { from: 0, to: 1, weight: 10 }, // 0
    { from: 1, to: 2, weight: 1 }, // 1
    { from: 2, to: 1, weight: 1 }, // 2
    { from: 0, to: 2, weight: 10 }, // 3
  ];
  const result = minimumArborescence(3, edges, 0);
  validateResult(3, edges, 0, result);
  assert.deepEqual(bruteForce(3, edges, 0), result);
});

test('a 3-cycle requires exactly one contraction', () => {
  const edges = [
    { from: 0, to: 1, weight: 50 }, // 0 -- cheapest external entry, into vertex 1
    { from: 1, to: 2, weight: 1 }, // 1
    { from: 2, to: 3, weight: 1 }, // 2
    { from: 3, to: 1, weight: 1 }, // 3
    { from: 0, to: 2, weight: 60 }, // 4
    { from: 0, to: 3, weight: 60 }, // 5
  ];
  const result = minimumArborescence(4, edges, 0);
  validateResult(4, edges, 0, result);
  assert.deepEqual(bruteForce(4, edges, 0), result);
});

test('nested contraction: contracting one cycle exposes a second cycle that itself needs contracting', () => {
  // Cycle {1,2} (cost 1 each way) contracts first; the resulting
  // supernode then forms a *second* cycle with vertex 3 (via edges 2->3
  // and 3->1), which itself must be contracted before a cheap direct
  // entry (edges 0 and 5, both cost 100) is finally compared against it.
  // Independently confirmed via exhaustive brute force (see also
  // scratch-stress.js from development) and by hand-tracing every
  // contraction step.
  const edges = [
    { from: 0, to: 1, weight: 100 }, // 0
    { from: 1, to: 2, weight: 1 }, // 1
    { from: 2, to: 1, weight: 1 }, // 2
    { from: 2, to: 3, weight: 1 }, // 3
    { from: 3, to: 1, weight: 1 }, // 4
    { from: 0, to: 3, weight: 100 }, // 5
  ];
  const result = minimumArborescence(4, edges, 0);
  assert.deepEqual(result, { weight: 102, edgeIndices: [0, 1, 3] });
  validateResult(4, edges, 0, result);
  assert.deepEqual(bruteForce(4, edges, 0), result);
});

// ---- repeatability ----

test('repeated calls on the same graph return an identical result', () => {
  const edges = [
    { from: 0, to: 1, weight: 4 },
    { from: 1, to: 2, weight: 2 },
    { from: 2, to: 1, weight: 2 },
    { from: 0, to: 2, weight: 4 },
    { from: 2, to: 3, weight: 3 },
    { from: 3, to: 2, weight: 3 },
  ];
  const results = Array.from({ length: 5 }, () => minimumArborescence(4, edges, 0));
  for (let i = 1; i < results.length; i++) {
    assert.deepEqual(results[i], results[0], `run ${i} must match run 0`);
  }
});

// ---- immutability ----

test('does not mutate the edges array or any edge object', () => {
  const edges = [
    { from: 0, to: 1, weight: 4 },
    { from: 1, to: 2, weight: 2 },
    { from: 2, to: 1, weight: 2 },
  ];
  const snapshot = edges.map((e) => ({ ...e }));
  minimumArborescence(3, edges, 0);
  assert.deepEqual(edges, snapshot, 'edges array/objects must be unchanged after the call');
  assert.equal(edges.length, 3);
});

test('does not mutate edges across multiple calls with the same array', () => {
  const edges = [
    { from: 0, to: 1, weight: 5 },
    { from: 0, to: 2, weight: 5 },
    { from: 1, to: 2, weight: 1 },
    { from: 2, to: 1, weight: 1 },
  ];
  const snapshot = edges.map((e) => ({ ...e }));
  minimumArborescence(3, edges, 0);
  minimumArborescence(3, edges, 0);
  minimumArborescence(3, edges, 0);
  assert.deepEqual(edges, snapshot);
});

// ---- invalid inputs ----

test('vertexCount must be an integer', () => {
  assert.throws(() => minimumArborescence(2.5, [], 0), TypeError);
  assert.throws(() => minimumArborescence('3', [], 0), TypeError);
  assert.throws(() => minimumArborescence(null, [], 0), TypeError);
  assert.throws(() => minimumArborescence(NaN, [], 0), TypeError);
});

test('vertexCount must be at least 1', () => {
  assert.throws(() => minimumArborescence(0, [], 0), RangeError);
  assert.throws(() => minimumArborescence(-2, [], 0), RangeError);
});

test('edges must be an array', () => {
  assert.throws(() => minimumArborescence(3, null, 0), TypeError);
  assert.throws(() => minimumArborescence(3, 'edges', 0), TypeError);
  assert.throws(() => minimumArborescence(3, {}, 0), TypeError);
});

test('root must be an integer', () => {
  assert.throws(() => minimumArborescence(3, [], 1.5), TypeError);
  assert.throws(() => minimumArborescence(3, [], '0'), TypeError);
  assert.throws(() => minimumArborescence(3, [], null), TypeError);
  assert.throws(() => minimumArborescence(3, [], NaN), TypeError);
});

test('root must be within [0, vertexCount)', () => {
  assert.throws(() => minimumArborescence(3, [], -1), RangeError);
  assert.throws(() => minimumArborescence(3, [], 3), RangeError);
});

test('each edge must be a well-formed object', () => {
  assert.throws(() => minimumArborescence(3, [null], 0), TypeError);
  assert.throws(() => minimumArborescence(3, ['not an edge'], 0), TypeError);
  assert.throws(() => minimumArborescence(3, [[0, 1, 2]], 0), TypeError, 'arrays are not accepted, only { from, to, weight } objects');
});

test('edge.from and edge.to must be integers', () => {
  assert.throws(() => minimumArborescence(3, [{ from: 0.5, to: 1, weight: 1 }], 0), TypeError);
  assert.throws(() => minimumArborescence(3, [{ from: 0, to: 1.5, weight: 1 }], 0), TypeError);
  assert.throws(() => minimumArborescence(3, [{ from: '0', to: 1, weight: 1 }], 0), TypeError);
  assert.throws(() => minimumArborescence(3, [{ from: 0, to: NaN, weight: 1 }], 0), TypeError);
});

test('edge.from and edge.to must be within [0, vertexCount)', () => {
  assert.throws(() => minimumArborescence(3, [{ from: -1, to: 1, weight: 1 }], 0), RangeError);
  assert.throws(() => minimumArborescence(3, [{ from: 0, to: 3, weight: 1 }], 0), RangeError);
});

test('edge.weight must be a number', () => {
  assert.throws(() => minimumArborescence(3, [{ from: 0, to: 1, weight: '1' }], 0), TypeError);
  assert.throws(() => minimumArborescence(3, [{ from: 0, to: 1, weight: null }], 0), TypeError);
  assert.throws(() => minimumArborescence(3, [{ from: 0, to: 1, weight: undefined }], 0), TypeError);
});

test('edge.weight must be finite (non-finite numbers are RangeError, not TypeError)', () => {
  assert.throws(() => minimumArborescence(3, [{ from: 0, to: 1, weight: NaN }], 0), RangeError);
  assert.throws(() => minimumArborescence(3, [{ from: 0, to: 1, weight: Infinity }], 0), RangeError);
  assert.throws(() => minimumArborescence(3, [{ from: 0, to: 1, weight: -Infinity }], 0), RangeError);
});

test('a weight of exactly 0, or a negative weight, is valid (not an error)', () => {
  assert.doesNotThrow(() => minimumArborescence(2, [{ from: 0, to: 1, weight: 0 }], 0));
  assert.doesNotThrow(() => minimumArborescence(2, [{ from: 0, to: 1, weight: -100 }], 0));
});

// ---- deterministic small-graph brute-force oracle test ----

test('seeded random small graphs: feasibility and weight match an exhaustive brute-force oracle', () => {
  const rand = mulberry32(20260807);
  const trialCount = 500;
  let checked = 0;
  for (let trial = 0; trial < trialCount; trial++) {
    const vertexCount = 1 + Math.floor(rand() * 5); // 1..5 (keeps brute force fast)
    const root = Math.floor(rand() * vertexCount);
    const edgeCount = Math.floor(rand() * (vertexCount * vertexCount));
    const edges = [];
    for (let i = 0; i < edgeCount; i++) {
      edges.push({
        from: Math.floor(rand() * vertexCount),
        to: Math.floor(rand() * vertexCount),
        weight: Math.floor(rand() * 21) - 10, // -10..10, includes negatives and zero
      });
    }

    const snapshot = edges.map((e) => ({ ...e }));
    const result = minimumArborescence(vertexCount, edges, root);
    assert.deepEqual(edges, snapshot, `trial ${trial}: edges must not be mutated`);

    const oracle = bruteForce(vertexCount, edges, root);
    assert.equal(
      result === null,
      oracle === null,
      `trial ${trial}: feasibility must match brute-force oracle (vertexCount=${vertexCount}, root=${root}, edges=${JSON.stringify(edges)})`
    );
    if (result !== null) {
      assert.equal(result.weight, oracle.weight, `trial ${trial}: weight must match brute-force oracle`);
      validateResult(vertexCount, edges, root, result);
    }
    checked++;
  }
  assert.equal(checked, trialCount);
});

test('seeded random small graphs: repeated calls stay identical (no hidden nondeterminism)', () => {
  const rand = mulberry32(424242);
  for (let trial = 0; trial < 60; trial++) {
    const vertexCount = 1 + Math.floor(rand() * 5);
    const root = Math.floor(rand() * vertexCount);
    const edgeCount = Math.floor(rand() * (vertexCount * vertexCount));
    const edges = [];
    for (let i = 0; i < edgeCount; i++) {
      edges.push({
        from: Math.floor(rand() * vertexCount),
        to: Math.floor(rand() * vertexCount),
        weight: Math.floor(rand() * 21) - 10,
      });
    }
    const first = minimumArborescence(vertexCount, edges, root);
    const second = minimumArborescence(vertexCount, edges, root);
    assert.deepEqual(second, first, `trial ${trial}: must be deterministic`);
  }
});
