'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { dinicMaxFlow } = require('./dinic-max-flow.js');

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

/** Independent Edmonds-Karp (BFS augmenting-path) maximum-flow oracle,
 * used only as a differential-testing reference -- deliberately not
 * sharing any code with the Dinic's implementation under test. Returns
 * just the max-flow value (Dinic's and Edmonds-Karp can legitimately
 * disagree on the exact per-edge flow decomposition of an equally
 * optimal solution when parallel/alternate paths exist, so the flow
 * *value* is what's compared -- edge-level correctness of the
 * implementation under test is checked separately via
 * `assertValidFlow`). */
function edmondsKarpMaxFlow(vertexCount, edges, source, sink) {
  const arcTo = [];
  const arcCap = [];
  const arcRev = [];
  const adj = Array.from({ length: vertexCount }, () => []);
  for (const e of edges) {
    const fwd = arcTo.length;
    arcTo.push(e.to);
    arcCap.push(e.capacity);
    arcRev.push(fwd + 1);
    adj[e.from].push(fwd);

    const rev = arcTo.length;
    arcTo.push(e.from);
    arcCap.push(0);
    arcRev.push(fwd);
    adj[e.to].push(rev);
  }

  let maxFlow = 0;
  for (;;) {
    const parentArc = new Array(vertexCount).fill(-1);
    const visited = new Array(vertexCount).fill(false);
    visited[source] = true;
    const queue = [source];
    let head = 0;
    while (head < queue.length) {
      const u = queue[head++];
      if (u === sink) break;
      for (const a of adj[u]) {
        if (arcCap[a] <= 0) continue;
        const v = arcTo[a];
        if (visited[v]) continue;
        visited[v] = true;
        parentArc[v] = a;
        queue.push(v);
      }
    }
    if (!visited[sink]) break;

    let bottleneck = Infinity;
    let v = sink;
    while (v !== source) {
      const a = parentArc[v];
      bottleneck = Math.min(bottleneck, arcCap[a]);
      v = arcTo[arcRev[a]];
    }
    v = sink;
    while (v !== source) {
      const a = parentArc[v];
      arcCap[a] -= bottleneck;
      arcCap[arcRev[a]] += bottleneck;
      v = arcTo[arcRev[a]];
    }
    maxFlow += bottleneck;
  }
  return maxFlow;
}

/** Asserts that `result` (as returned by `dinicMaxFlow`) is a valid flow
 * for `edges`/`source`/`sink`: every edge's flow is a safe integer
 * within `[0, capacity]`, flow is conserved at every non-source/sink
 * vertex, and the net outflow from `source` / inflow to `sink` both
 * equal `result.maxFlow`. */
function assertValidFlow(vertexCount, edges, source, sink, result) {
  assert.equal(result.edgeFlows.length, edges.length);
  const net = new Array(vertexCount).fill(0);
  for (let i = 0; i < edges.length; i++) {
    const f = result.edgeFlows[i];
    assert.ok(Number.isSafeInteger(f), `edgeFlows[${i}] must be a safe integer`);
    assert.ok(f >= 0 && f <= edges[i].capacity, `edgeFlows[${i}]=${f} out of bounds [0, ${edges[i].capacity}]`);
    net[edges[i].from] -= f;
    net[edges[i].to] += f;
  }
  for (let v = 0; v < vertexCount; v++) {
    if (v === source || v === sink) continue;
    assert.equal(net[v], 0, `flow conservation violated at vertex ${v}`);
  }
  // `+ 0` normalizes a possible `-0` (e.g. when maxFlow is legitimately 0
  // and `net[source]`/`net[sink]` never accumulate a nonzero term) back to
  // `+0`, since strict-mode assert.equal distinguishes -0 from 0.
  assert.equal(net[sink] + 0, result.maxFlow, 'net inflow at sink must equal maxFlow');
  assert.equal(-net[source] + 0, result.maxFlow, 'net outflow at source must equal maxFlow');
}

// ---- basic correctness ----

test('classic textbook example: maxFlow equals the hand-verified min cut', () => {
  // 0->1 cap4, 0->2 cap3, 1->2 cap2, 1->3 cap3, 2->3 cap5.
  // Min cut is {0} vs rest: 4 + 3 = 7.
  const edges = [
    { from: 0, to: 1, capacity: 4 },
    { from: 0, to: 2, capacity: 3 },
    { from: 1, to: 2, capacity: 2 },
    { from: 1, to: 3, capacity: 3 },
    { from: 2, to: 3, capacity: 5 },
  ];
  const result = dinicMaxFlow(4, edges, 0, 3);
  assert.equal(result.maxFlow, 7);
  assertValidFlow(4, edges, 0, 3, result);
});

test('no-path graph: source cannot reach sink at all', () => {
  const edges = [{ from: 0, to: 1, capacity: 5 }];
  const result = dinicMaxFlow(3, edges, 0, 2);
  assert.deepEqual(result, { maxFlow: 0, edgeFlows: [0] });
});

test('no-path graph: sink can reach source but not vice versa', () => {
  const edges = [
    { from: 1, to: 0, capacity: 5 },
    { from: 1, to: 2, capacity: 5 },
  ];
  const result = dinicMaxFlow(3, edges, 0, 2);
  assert.equal(result.maxFlow, 0);
  assertValidFlow(3, edges, 0, 2, result);
});

test('empty edge list', () => {
  const result = dinicMaxFlow(2, [], 0, 1);
  assert.deepEqual(result, { maxFlow: 0, edgeFlows: [] });
});

test('single direct edge', () => {
  const edges = [{ from: 0, to: 1, capacity: 7 }];
  const result = dinicMaxFlow(2, edges, 0, 1);
  assert.deepEqual(result, { maxFlow: 7, edgeFlows: [7] });
});

test('zero-capacity edge never carries flow and does not enable a path', () => {
  const edges = [{ from: 0, to: 1, capacity: 0 }];
  const result = dinicMaxFlow(2, edges, 0, 1);
  assert.deepEqual(result, { maxFlow: 0, edgeFlows: [0] });
});

// ---- bottlenecks ----

test('bottleneck: a single low-capacity edge on the only path caps maxFlow', () => {
  const edges = [
    { from: 0, to: 1, capacity: 10 },
    { from: 1, to: 2, capacity: 1 },
    { from: 2, to: 3, capacity: 10 },
  ];
  const result = dinicMaxFlow(4, edges, 0, 3);
  assert.deepEqual(result, { maxFlow: 1, edgeFlows: [1, 1, 1] });
});

test('bottleneck: multiple disjoint paths each individually bottlenecked', () => {
  // Two vertex-disjoint 0->3 paths, each capped at a different bottleneck.
  const edges = [
    { from: 0, to: 1, capacity: 100 },
    { from: 1, to: 3, capacity: 2 },
    { from: 0, to: 2, capacity: 100 },
    { from: 2, to: 3, capacity: 5 },
  ];
  const result = dinicMaxFlow(4, edges, 0, 3);
  assert.equal(result.maxFlow, 7);
  assertValidFlow(4, edges, 0, 3, result);
});

// ---- parallel edges ----

test('parallel edges into the same vertex pair are tracked independently', () => {
  const edges = [
    { from: 0, to: 1, capacity: 3 },
    { from: 0, to: 1, capacity: 2 },
    { from: 1, to: 2, capacity: 5 },
  ];
  const result = dinicMaxFlow(3, edges, 0, 2);
  assert.deepEqual(result, { maxFlow: 5, edgeFlows: [3, 2, 5] });
});

test('parallel edges where downstream capacity is the bottleneck, not the parallel pair', () => {
  const edges = [
    { from: 0, to: 1, capacity: 10 },
    { from: 0, to: 1, capacity: 10 },
    { from: 1, to: 2, capacity: 3 },
  ];
  const result = dinicMaxFlow(3, edges, 0, 2);
  assert.equal(result.maxFlow, 3);
  assertValidFlow(3, edges, 0, 2, result);
});

test('parallel edges directly between source and sink', () => {
  const edges = [
    { from: 0, to: 1, capacity: 4 },
    { from: 0, to: 1, capacity: 6 },
    { from: 0, to: 1, capacity: 1 },
  ];
  const result = dinicMaxFlow(2, edges, 0, 1);
  assert.deepEqual(result, { maxFlow: 11, edgeFlows: [4, 6, 1] });
});

// ---- self-loops ----

test('self-loop is always inert: contributes zero flow regardless of capacity', () => {
  const edges = [
    { from: 0, to: 1, capacity: 5 },
    { from: 1, to: 1, capacity: 1000 },
    { from: 1, to: 2, capacity: 3 },
  ];
  const result = dinicMaxFlow(3, edges, 0, 2);
  assert.deepEqual(result, { maxFlow: 3, edgeFlows: [3, 0, 3] });
});

test('self-loop on the source vertex is also always inert', () => {
  const edges = [
    { from: 0, to: 0, capacity: 50 },
    { from: 0, to: 1, capacity: 4 },
  ];
  const result = dinicMaxFlow(2, edges, 0, 1);
  assert.deepEqual(result, { maxFlow: 4, edgeFlows: [0, 4] });
});

// ---- disconnected components ----

test('disconnected components: an unrelated component does not affect the result', () => {
  const edges = [
    { from: 0, to: 1, capacity: 6 },
    { from: 2, to: 3, capacity: 9 },
  ];
  const result = dinicMaxFlow(4, edges, 0, 1);
  assert.deepEqual(result, { maxFlow: 6, edgeFlows: [6, 0] });
});

test('disconnected components: isolated vertices with no incident edges are harmless', () => {
  const edges = [{ from: 0, to: 3, capacity: 2 }];
  const result = dinicMaxFlow(5, edges, 0, 3);
  assert.deepEqual(result, { maxFlow: 2, edgeFlows: [2] });
});

// ---- input immutability ----

test('input arrays and edge objects are never mutated', () => {
  const edges = [
    { from: 0, to: 1, capacity: 5 },
    { from: 1, to: 2, capacity: 3 },
    { from: 0, to: 2, capacity: 1 },
  ];
  const snapshot = edges.map((e) => ({ ...e }));
  Object.freeze(edges[0]);
  Object.freeze(edges[1]);
  Object.freeze(edges[2]);
  Object.freeze(edges);

  dinicMaxFlow(3, edges, 0, 2);

  assert.deepEqual(edges, snapshot);
});

// ---- determinism ----

test('determinism: repeated calls on the same input produce byte-for-byte identical results', () => {
  const edges = [
    { from: 0, to: 1, capacity: 4 },
    { from: 0, to: 2, capacity: 3 },
    { from: 1, to: 2, capacity: 2 },
    { from: 1, to: 3, capacity: 3 },
    { from: 2, to: 1, capacity: 1 },
    { from: 2, to: 3, capacity: 5 },
  ];
  const results = [];
  for (let i = 0; i < 25; i++) {
    results.push(JSON.stringify(dinicMaxFlow(4, edges, 0, 3)));
  }
  const first = results[0];
  for (const r of results) assert.equal(r, first);
});

test('determinism: a random battery of graphs each reproduce identically across repeated runs', () => {
  const rng = mulberry32(777);
  for (let t = 0; t < 40; t++) {
    const vertexCount = 2 + Math.floor(rng() * 6);
    const edgeCount = Math.floor(rng() * 12);
    const edges = [];
    for (let i = 0; i < edgeCount; i++) {
      edges.push({
        from: Math.floor(rng() * vertexCount),
        to: Math.floor(rng() * vertexCount),
        capacity: Math.floor(rng() * 8),
      });
    }
    let source = Math.floor(rng() * vertexCount);
    let sink = Math.floor(rng() * vertexCount);
    if (source === sink) sink = (sink + 1) % vertexCount;

    const first = JSON.stringify(dinicMaxFlow(vertexCount, edges, source, sink));
    for (let r = 0; r < 4; r++) {
      assert.equal(JSON.stringify(dinicMaxFlow(vertexCount, edges, source, sink)), first);
    }
  }
});

// ---- invalid inputs ----

test('rejects a non-safe-integer vertexCount with TypeError', () => {
  assert.throws(() => dinicMaxFlow('4', [], 0, 1), TypeError);
  assert.throws(() => dinicMaxFlow(4.5, [], 0, 1), TypeError);
  assert.throws(() => dinicMaxFlow(Number.MAX_SAFE_INTEGER + 10, [], 0, 1), TypeError);
});

test('rejects vertexCount < 1 with RangeError', () => {
  assert.throws(() => dinicMaxFlow(0, [], 0, 1), RangeError);
  assert.throws(() => dinicMaxFlow(-3, [], 0, 1), RangeError);
});

test('rejects a non-array edges argument with TypeError', () => {
  assert.throws(() => dinicMaxFlow(2, 'not-an-array', 0, 1), TypeError);
  assert.throws(() => dinicMaxFlow(2, {}, 0, 1), TypeError);
  assert.throws(() => dinicMaxFlow(2, null, 0, 1), TypeError);
});

test('rejects non-safe-integer source or sink with TypeError', () => {
  assert.throws(() => dinicMaxFlow(3, [], '0', 1), TypeError);
  assert.throws(() => dinicMaxFlow(3, [], 0, 1.5), TypeError);
});

test('rejects out-of-range source or sink with RangeError', () => {
  assert.throws(() => dinicMaxFlow(3, [], -1, 1), RangeError);
  assert.throws(() => dinicMaxFlow(3, [], 0, 3), RangeError);
});

test('rejects source === sink with RangeError', () => {
  assert.throws(() => dinicMaxFlow(3, [], 1, 1), RangeError);
});

test('rejects a non-object edge with TypeError', () => {
  assert.throws(() => dinicMaxFlow(2, [null], 0, 1), TypeError);
  assert.throws(() => dinicMaxFlow(2, [42], 0, 1), TypeError);
  assert.throws(() => dinicMaxFlow(2, [[0, 1, 5]], 0, 1), TypeError);
});

test('rejects non-safe-integer edge fields with TypeError', () => {
  assert.throws(() => dinicMaxFlow(2, [{ from: 0.5, to: 1, capacity: 5 }], 0, 1), TypeError);
  assert.throws(() => dinicMaxFlow(2, [{ from: 0, to: '1', capacity: 5 }], 0, 1), TypeError);
  assert.throws(() => dinicMaxFlow(2, [{ from: 0, to: 1, capacity: 5.5 }], 0, 1), TypeError);
});

test('rejects out-of-range edge endpoints with RangeError', () => {
  assert.throws(() => dinicMaxFlow(2, [{ from: 0, to: 5, capacity: 1 }], 0, 1), RangeError);
  assert.throws(() => dinicMaxFlow(2, [{ from: -1, to: 1, capacity: 1 }], 0, 1), RangeError);
});

test('rejects negative edge capacity with RangeError', () => {
  assert.throws(() => dinicMaxFlow(2, [{ from: 0, to: 1, capacity: -1 }], 0, 1), RangeError);
});

// ---- fixed-seed differential comparison against an Edmonds-Karp BFS oracle ----

test('fixed-seed differential test: matches an independent Edmonds-Karp oracle across random graphs', () => {
  const rng = mulberry32(20260813);
  let trials = 0;
  for (let t = 0; t < 500; t++) {
    const vertexCount = 2 + Math.floor(rng() * 8); // 2..9
    const edgeCount = Math.floor(rng() * 20); // 0..19
    const maxCap = Math.floor(rng() * 10); // 0..9
    const edges = [];
    for (let i = 0; i < edgeCount; i++) {
      edges.push({
        from: Math.floor(rng() * vertexCount),
        to: Math.floor(rng() * vertexCount),
        capacity: Math.floor(rng() * (maxCap + 1)),
      });
    }
    let source = Math.floor(rng() * vertexCount);
    let sink = Math.floor(rng() * vertexCount);
    if (source === sink) sink = (sink + 1) % vertexCount;

    const result = dinicMaxFlow(vertexCount, edges, source, sink);
    const oracleFlow = edmondsKarpMaxFlow(vertexCount, edges, source, sink);

    assert.equal(
      result.maxFlow,
      oracleFlow,
      `maxFlow mismatch on trial ${t}: dinic=${result.maxFlow} oracle=${oracleFlow} graph=${JSON.stringify({ vertexCount, edges, source, sink })}`,
    );
    assertValidFlow(vertexCount, edges, source, sink, result);
    trials++;
  }
  assert.equal(trials, 500);
});

test('fixed-seed differential test on denser graphs with a larger vertex count', () => {
  const rng = mulberry32(424242);
  for (let t = 0; t < 100; t++) {
    const vertexCount = 10 + Math.floor(rng() * 6); // 10..15
    const edgeCount = 20 + Math.floor(rng() * 40); // 20..59
    const edges = [];
    for (let i = 0; i < edgeCount; i++) {
      edges.push({
        from: Math.floor(rng() * vertexCount),
        to: Math.floor(rng() * vertexCount),
        capacity: Math.floor(rng() * 20),
      });
    }
    const source = 0;
    const sink = vertexCount - 1;

    const result = dinicMaxFlow(vertexCount, edges, source, sink);
    const oracleFlow = edmondsKarpMaxFlow(vertexCount, edges, source, sink);
    assert.equal(result.maxFlow, oracleFlow, `trial ${t}`);
    assertValidFlow(vertexCount, edges, source, sink, result);
  }
});
