'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { minCostMaxFlow } = require('./min-cost-max-flow.js');

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

/** Exhaustive brute-force oracle: enumerates every integer flow
 * assignment (0..capacity per edge) satisfying flow conservation, and
 * keeps the one maximizing flow (capped at flowLimit) then minimizing
 * cost. Only usable for small graphs. Mirrors the real implementation's
 * "reachable from source" scoping for which edges can carry flow at all
 * -- an edge whose tail is not reachable from `source` via positive-
 * capacity edges can never legitimately be fed by any source-to-sink
 * path, so (like the real solver) it is never assigned nonzero flow
 * here either; this also means a negative-cost cycle *not* reachable
 * from source is correctly never exploited by the oracle, matching the
 * real solver's "reject reachable negative-cost cycles" scoping (not
 * "reject any negative-cost cycle anywhere in the graph"). Returns
 * `'REJECT'` if a negative-cost cycle is reachable from `source`. */
function bruteForce(vertexCount, edges, source, sink, flowLimit) {
  const limit = flowLimit === undefined ? Infinity : flowLimit;
  const m = edges.length;

  function hasReachableNegCycle() {
    const pos = edges.filter((e) => e.capacity > 0);
    const dist = new Array(vertexCount).fill(Infinity);
    dist[source] = 0;
    for (let it = 0; it < vertexCount - 1; it++) {
      let any = false;
      for (const e of pos) {
        if (dist[e.from] === Infinity) continue;
        if (dist[e.from] + e.cost < dist[e.to]) {
          dist[e.to] = dist[e.from] + e.cost;
          any = true;
        }
      }
      if (!any) break;
    }
    for (const e of pos) {
      if (dist[e.from] === Infinity) continue;
      if (dist[e.from] + e.cost < dist[e.to]) return true;
    }
    return false;
  }
  if (hasReachableNegCycle()) return 'REJECT';

  const reachable = new Array(vertexCount).fill(false);
  reachable[source] = true;
  {
    const posEdges = edges.filter((e) => e.capacity > 0);
    let changed = true;
    while (changed) {
      changed = false;
      for (const e of posEdges) {
        if (reachable[e.from] && !reachable[e.to]) {
          reachable[e.to] = true;
          changed = true;
        }
      }
    }
  }

  let bestFlow = -1;
  let bestCost = Infinity;
  const assignment = new Array(m).fill(0);

  function recurse(idx) {
    if (idx === m) {
      const net = new Array(vertexCount).fill(0);
      for (let i = 0; i < m; i++) {
        net[edges[i].from] -= assignment[i];
        net[edges[i].to] += assignment[i];
      }
      for (let v = 0; v < vertexCount; v++) {
        if (v === source || v === sink) continue;
        if (net[v] !== 0) return;
      }
      const flowValue = net[sink];
      if (flowValue < 0 || flowValue > limit) return;
      let cost = 0;
      for (let i = 0; i < m; i++) cost += assignment[i] * edges[i].cost;
      if (flowValue > bestFlow || (flowValue === bestFlow && cost < bestCost)) {
        bestFlow = flowValue;
        bestCost = cost;
      }
      return;
    }
    const maxF = reachable[edges[idx].from] ? edges[idx].capacity : 0;
    for (let f = 0; f <= maxF; f++) {
      assignment[idx] = f;
      recurse(idx + 1);
    }
    assignment[idx] = 0;
  }

  recurse(0);
  if (bestFlow === -1) return { flow: 0, cost: 0 };
  return { flow: bestFlow, cost: bestCost };
}

/** Validates that `result.edgeFlows` is internally consistent with
 * `result.flow`/`result.cost`: in-bounds, conserves flow at every
 * non-source/sink vertex, and its net inflow to sink / recomputed cost
 * match the reported totals. */
function validateEdgeFlows(vertexCount, edges, source, sink, result) {
  for (let i = 0; i < edges.length; i++) {
    assert.ok(result.edgeFlows[i] >= 0 && result.edgeFlows[i] <= edges[i].capacity, `edgeFlows[${i}] must be within [0, capacity]`);
  }
  const net = new Array(vertexCount).fill(0);
  for (let i = 0; i < edges.length; i++) {
    net[edges[i].from] -= result.edgeFlows[i];
    net[edges[i].to] += result.edgeFlows[i];
  }
  for (let v = 0; v < vertexCount; v++) {
    if (v === source || v === sink) continue;
    assert.equal(net[v], 0, `flow must be conserved at vertex ${v}`);
  }
  assert.equal(net[sink], result.flow, 'net inflow to sink must match reported flow');
  let recomputedCost = 0;
  for (let i = 0; i < edges.length; i++) recomputedCost += result.edgeFlows[i] * edges[i].cost;
  assert.equal(recomputedCost, result.cost, 'recomputed cost from edgeFlows must match reported cost');
}

// ---- basic flow ----

test('single path: flow limited by the tightest edge, cost is additive', () => {
  const edges = [
    { from: 0, to: 1, capacity: 5, cost: 1 },
    { from: 1, to: 2, capacity: 3, cost: 2 },
  ];
  const result = minCostMaxFlow(3, edges, 0, 2);
  assert.deepEqual(result, { flow: 3, cost: 9, edgeFlows: [3, 3] });
  validateEdgeFlows(3, edges, 0, 2, result);
});

test('two independent parallel paths: max flow uses both, cheaper path preferred first', () => {
  const edges = [
    { from: 0, to: 1, capacity: 3, cost: 1 },
    { from: 1, to: 3, capacity: 3, cost: 1 },
    { from: 0, to: 2, capacity: 3, cost: 5 },
    { from: 2, to: 3, capacity: 3, cost: 5 },
  ];
  const result = minCostMaxFlow(4, edges, 0, 3);
  assert.deepEqual(result, { flow: 6, cost: 36, edgeFlows: [3, 3, 3, 3] });
  validateEdgeFlows(4, edges, 0, 3, result);
  assert.deepEqual(bruteForce(4, edges, 0, 3, undefined), { flow: result.flow, cost: result.cost });
});

// ---- unreachable sinks ----

test('unreachable sink: zero flow, zero cost, not an error', () => {
  const edges = [{ from: 0, to: 1, capacity: 5, cost: 1 }];
  const result = minCostMaxFlow(3, edges, 0, 2);
  assert.deepEqual(result, { flow: 0, cost: 0, edgeFlows: [0] });
});

test('sink reachable only via zero-capacity edges: zero flow', () => {
  const edges = [
    { from: 0, to: 1, capacity: 0, cost: 1 },
    { from: 1, to: 2, capacity: 5, cost: 1 },
  ];
  const result = minCostMaxFlow(3, edges, 0, 2);
  assert.deepEqual(result, { flow: 0, cost: 0, edgeFlows: [0, 0] });
});

// ---- flow limits ----

test('flowLimit caps the pushed flow below the true max flow', () => {
  const edges = [
    { from: 0, to: 1, capacity: 5, cost: 1 },
    { from: 1, to: 2, capacity: 5, cost: 1 },
  ];
  const result = minCostMaxFlow(3, edges, 0, 2, 3);
  assert.deepEqual(result, { flow: 3, cost: 6, edgeFlows: [3, 3] });
});

test('flowLimit of 0 returns immediately with zero flow and cost', () => {
  const edges = [{ from: 0, to: 1, capacity: 5, cost: 1 }];
  const result = minCostMaxFlow(2, edges, 0, 1, 0);
  assert.deepEqual(result, { flow: 0, cost: 0, edgeFlows: [0] });
});

test('flowLimit above the true max flow has no effect (capped at true max)', () => {
  const edges = [{ from: 0, to: 1, capacity: 5, cost: 1 }];
  const result = minCostMaxFlow(2, edges, 0, 1, 1000);
  assert.deepEqual(result, { flow: 5, cost: 5, edgeFlows: [5] });
});

// ---- parallel edges ----

test('parallel edges between the same pair are tracked independently in edgeFlows', () => {
  const edges = [
    { from: 0, to: 1, capacity: 2, cost: 1 }, // cheaper, used first
    { from: 0, to: 1, capacity: 2, cost: 5 },
    { from: 1, to: 2, capacity: 3, cost: 0 },
  ];
  const result = minCostMaxFlow(3, edges, 0, 2);
  assert.deepEqual(result, { flow: 3, cost: 1 * 2 + 5 * 1, edgeFlows: [2, 1, 3] });
  validateEdgeFlows(3, edges, 0, 2, result);
});

// ---- negative costs ----

test('negative-cost edges (with no reachable negative cycle) can drive total cost below zero', () => {
  const edges = [
    { from: 0, to: 1, capacity: 4, cost: -5 },
    { from: 1, to: 2, capacity: 4, cost: -3 },
  ];
  const result = minCostMaxFlow(3, edges, 0, 2);
  assert.deepEqual(result, { flow: 4, cost: 4 * (-5 - 3), edgeFlows: [4, 4] });
});

test('a negative-cost cycle NOT reachable from source is ignored, not exploited or rejected', () => {
  const edges = [
    { from: 0, to: 1, capacity: 5, cost: 1 }, // the only source-reachable part
    { from: 2, to: 3, capacity: 5, cost: -3 }, // disconnected negative cycle
    { from: 3, to: 2, capacity: 5, cost: 1 },
  ];
  const result = minCostMaxFlow(4, edges, 0, 1);
  assert.deepEqual(result, { flow: 5, cost: 5, edgeFlows: [5, 0, 0] });
});

test('a reachable negative-cost cycle is rejected with RangeError', () => {
  const edges = [
    { from: 0, to: 1, capacity: 5, cost: 1 },
    { from: 1, to: 2, capacity: 5, cost: -3 },
    { from: 2, to: 1, capacity: 5, cost: 1 },
  ];
  assert.throws(() => minCostMaxFlow(3, edges, 0, 2), RangeError);
});

test('a reachable negative-cost self-loop (a length-1 cycle) is rejected with RangeError', () => {
  const edges = [
    { from: 0, to: 1, capacity: 5, cost: 1 },
    { from: 1, to: 1, capacity: 1, cost: -1 },
  ];
  assert.throws(() => minCostMaxFlow(2, edges, 0, 1), RangeError);
});

test('a zero-capacity edge can never make an otherwise-negative cycle "reachable"', () => {
  const edges = [
    { from: 0, to: 1, capacity: 5, cost: 1 },
    { from: 1, to: 2, capacity: 0, cost: -3 }, // zero capacity -- can never carry flow
    { from: 2, to: 1, capacity: 5, cost: 1 },
  ];
  assert.doesNotThrow(() => minCostMaxFlow(3, edges, 0, 1));
});

// ---- deterministic ties ----

test('deterministic ties: repeated calls on a graph with equal-cost alternative paths always agree', () => {
  const edges = [
    { from: 0, to: 1, capacity: 2, cost: 2 },
    { from: 1, to: 3, capacity: 2, cost: 2 },
    { from: 0, to: 2, capacity: 2, cost: 2 },
    { from: 2, to: 3, capacity: 2, cost: 2 },
  ];
  const results = Array.from({ length: 5 }, () => minCostMaxFlow(4, edges, 0, 3));
  for (let i = 1; i < results.length; i++) {
    assert.deepEqual(results[i], results[0], `run ${i} must match run 0`);
  }
  validateEdgeFlows(4, edges, 0, 3, results[0]);
});

// ---- reverse-edge rerouting ----

test('reverse-edge rerouting is required to reach true max flow, and the solver finds it', () => {
  // Hand-derived (see README): phase 1's shortest path 0->1->2->3 (cost 3)
  // saturates edge 4 (1->2) forward. The ONLY way to push the second
  // (necessary, for max flow 2) unit of flow is 0->2->1->3, which must
  // travel the REVERSE of edge 4 (2->1) to "give back" that capacity. A
  // forward-only search would incorrectly stop at flow 1.
  const edges = [
    { from: 0, to: 1, capacity: 1, cost: 1 }, // 0
    { from: 1, to: 3, capacity: 1, cost: 3 }, // 1
    { from: 0, to: 2, capacity: 1, cost: 3 }, // 2
    { from: 2, to: 3, capacity: 1, cost: 1 }, // 3
    { from: 1, to: 2, capacity: 1, cost: 1 }, // 4 -- used forward in phase 1, reversed in phase 2
  ];
  const result = minCostMaxFlow(4, edges, 0, 3);
  assert.deepEqual(result, { flow: 2, cost: 8, edgeFlows: [1, 1, 1, 1, 0] });
  validateEdgeFlows(4, edges, 0, 3, result);
  assert.deepEqual(bruteForce(4, edges, 0, 3, undefined), { flow: 2, cost: 8 });
});

// ---- input immutability ----

test('does not mutate the edges array or any edge object', () => {
  const edges = [
    { from: 0, to: 1, capacity: 4, cost: 2 },
    { from: 1, to: 2, capacity: 3, cost: -1 },
  ];
  const snapshot = edges.map((e) => ({ ...e }));
  minCostMaxFlow(3, edges, 0, 2);
  assert.deepEqual(edges, snapshot, 'edges array/objects must be unchanged after the call');
  assert.equal(edges.length, 2);
});

test('does not mutate edges across multiple calls with the same array', () => {
  const edges = [
    { from: 0, to: 1, capacity: 5, cost: 1 },
    { from: 1, to: 2, capacity: 5, cost: 1 },
  ];
  const snapshot = edges.map((e) => ({ ...e }));
  minCostMaxFlow(3, edges, 0, 2);
  minCostMaxFlow(3, edges, 0, 2, 2);
  minCostMaxFlow(3, edges, 0, 2);
  assert.deepEqual(edges, snapshot);
});

// ---- invalid inputs ----

test('vertexCount must be a safe integer', () => {
  assert.throws(() => minCostMaxFlow(2.5, [], 0, 1), TypeError);
  assert.throws(() => minCostMaxFlow('3', [], 0, 1), TypeError);
  assert.throws(() => minCostMaxFlow(NaN, [], 0, 1), TypeError);
  assert.throws(() => minCostMaxFlow(2 ** 60, [], 0, 1), TypeError, 'not a safe integer');
});

test('vertexCount must be at least 1', () => {
  assert.throws(() => minCostMaxFlow(0, [], 0, 0), RangeError);
});

test('edges must be an array', () => {
  assert.throws(() => minCostMaxFlow(3, null, 0, 1), TypeError);
  assert.throws(() => minCostMaxFlow(3, 'edges', 0, 1), TypeError);
});

test('source and sink must be safe integers within [0, vertexCount)', () => {
  assert.throws(() => minCostMaxFlow(3, [], 1.5, 0), TypeError);
  assert.throws(() => minCostMaxFlow(3, [], 0, '1'), TypeError);
  assert.throws(() => minCostMaxFlow(3, [], -1, 0), RangeError);
  assert.throws(() => minCostMaxFlow(3, [], 0, 3), RangeError);
});

test('source and sink must be distinct', () => {
  assert.throws(() => minCostMaxFlow(3, [], 1, 1), RangeError);
});

test('each edge must be a well-formed object', () => {
  assert.throws(() => minCostMaxFlow(3, [null], 0, 1), TypeError);
  assert.throws(() => minCostMaxFlow(3, [[0, 1, 2, 3]], 0, 1), TypeError, 'arrays are not accepted');
});

test('edge.from and edge.to must be safe integers within [0, vertexCount)', () => {
  assert.throws(() => minCostMaxFlow(3, [{ from: 0.5, to: 1, capacity: 1, cost: 1 }], 0, 1), TypeError);
  assert.throws(() => minCostMaxFlow(3, [{ from: 0, to: 3, capacity: 1, cost: 1 }], 0, 1), RangeError);
  assert.throws(() => minCostMaxFlow(3, [{ from: -1, to: 1, capacity: 1, cost: 1 }], 0, 1), RangeError);
});

test('edge.capacity must be a non-negative safe integer', () => {
  assert.throws(() => minCostMaxFlow(3, [{ from: 0, to: 1, capacity: 1.5, cost: 1 }], 0, 1), TypeError);
  assert.throws(() => minCostMaxFlow(3, [{ from: 0, to: 1, capacity: '1', cost: 1 }], 0, 1), TypeError);
  assert.throws(() => minCostMaxFlow(3, [{ from: 0, to: 1, capacity: -1, cost: 1 }], 0, 1), RangeError);
});

test('a capacity of exactly 0 is valid, not an error', () => {
  assert.doesNotThrow(() => minCostMaxFlow(2, [{ from: 0, to: 1, capacity: 0, cost: 1 }], 0, 1));
});

test('edge.cost must be a safe integer (any sign is otherwise valid)', () => {
  assert.throws(() => minCostMaxFlow(3, [{ from: 0, to: 1, capacity: 1, cost: 1.5 }], 0, 1), TypeError);
  assert.throws(() => minCostMaxFlow(3, [{ from: 0, to: 1, capacity: 1, cost: NaN }], 0, 1), TypeError);
  assert.throws(() => minCostMaxFlow(3, [{ from: 0, to: 1, capacity: 1, cost: Infinity }], 0, 1), TypeError);
  assert.doesNotThrow(() => minCostMaxFlow(3, [{ from: 0, to: 1, capacity: 1, cost: -1000 }], 0, 1));
});

test('flowLimit, when provided, must be a non-negative safe integer', () => {
  assert.throws(() => minCostMaxFlow(2, [], 0, 1, 1.5), TypeError);
  assert.throws(() => minCostMaxFlow(2, [], 0, 1, '3'), TypeError);
  assert.throws(() => minCostMaxFlow(2, [], 0, 1, null), TypeError, 'null is rejected, unlike omitting the argument entirely');
  assert.throws(() => minCostMaxFlow(2, [], 0, 1, -1), RangeError);
});

test('omitting flowLimit (undefined) means "no limit", not zero', () => {
  const edges = [{ from: 0, to: 1, capacity: 5, cost: 1 }];
  assert.deepEqual(minCostMaxFlow(2, edges, 0, 1), { flow: 5, cost: 5, edgeFlows: [5] });
  assert.deepEqual(minCostMaxFlow(2, edges, 0, 1, undefined), { flow: 5, cost: 5, edgeFlows: [5] });
});

// ---- small fixed-seed cases checked against a brute-force solver ----

test('seeded random small graphs: flow, cost, and edgeFlows validity match an exhaustive brute-force oracle', () => {
  const rand = mulberry32(20260807);
  const trialCount = 300;
  let checked = 0;
  for (let trial = 0; trial < trialCount; trial++) {
    const vertexCount = 2 + Math.floor(rand() * 3); // 2..4 (keeps brute force fast)
    const source = Math.floor(rand() * vertexCount);
    let sink = Math.floor(rand() * vertexCount);
    if (sink === source) sink = (sink + 1) % vertexCount;
    const edgeCount = Math.floor(rand() * 5); // 0..4
    const edges = [];
    for (let i = 0; i < edgeCount; i++) {
      edges.push({
        from: Math.floor(rand() * vertexCount),
        to: Math.floor(rand() * vertexCount),
        capacity: Math.floor(rand() * 3), // 0..2
        cost: Math.floor(rand() * 7) - 3, // -3..3
      });
    }
    const useLimit = rand() < 0.3;
    const flowLimit = useLimit ? Math.floor(rand() * 4) : undefined;

    const snapshot = edges.map((e) => ({ ...e }));
    let result;
    let threw = null;
    try {
      result = minCostMaxFlow(vertexCount, edges, source, sink, flowLimit);
    } catch (err) {
      threw = err;
    }
    assert.deepEqual(edges, snapshot, `trial ${trial}: edges must not be mutated`);

    const oracle = bruteForce(vertexCount, edges, source, sink, flowLimit);
    if (oracle === 'REJECT') {
      assert.ok(threw instanceof RangeError, `trial ${trial}: expected RangeError for a reachable negative cycle`);
    } else {
      assert.equal(threw, null, `trial ${trial}: unexpected throw: ${threw && threw.stack}`);
      assert.equal(result.flow, oracle.flow, `trial ${trial}: flow mismatch (vertexCount=${vertexCount}, source=${source}, sink=${sink}, flowLimit=${flowLimit}, edges=${JSON.stringify(edges)})`);
      assert.equal(result.cost, oracle.cost, `trial ${trial}: cost mismatch`);
      validateEdgeFlows(vertexCount, edges, source, sink, result);
    }
    checked++;
  }
  assert.equal(checked, trialCount);
});
