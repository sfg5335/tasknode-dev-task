'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { immediateDominators } = require('./dominator-tree.js');

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

// Independent oracle based on the classical iterative-dataflow definition
// of dominator SETS: Dom(start) = {start}; Dom(v) = {v} union the
// intersection of Dom(p) over every predecessor p of v; solved by
// fixed-point iteration. This works correctly on any directed graph
// (reducible or not, with any mix of cycles/back edges/cross edges), and
// is structurally unrelated to Lengauer-Tarjan's semidominator/EVAL-LINK
// machinery, making it a genuine independent cross-check. The immediate
// dominator of v is then the unique strict dominator of v with the
// largest dominator set -- a classical theorem guarantees the strict
// dominators of any vertex are totally ordered by dominance, so this
// argmax is always unambiguous.
function bruteForceIdom(vertexCount, edges, start) {
  const adj = Array.from({ length: vertexCount }, () => []);
  for (const e of edges) adj[e.from].push(e.to);

  const reachable = new Array(vertexCount).fill(false);
  reachable[start] = true;
  const stack = [start];
  while (stack.length) {
    const v = stack.pop();
    for (const w of adj[v]) {
      if (!reachable[w]) {
        reachable[w] = true;
        stack.push(w);
      }
    }
  }

  const preds = Array.from({ length: vertexCount }, () => []);
  for (const e of edges) {
    if (reachable[e.from] && reachable[e.to]) preds[e.to].push(e.from);
  }

  const allReachable = [];
  for (let v = 0; v < vertexCount; v++) if (reachable[v]) allReachable.push(v);

  const dom = new Array(vertexCount).fill(null);
  for (const v of allReachable) {
    dom[v] = v === start ? new Set([start]) : new Set(allReachable);
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const v of allReachable) {
      if (v === start) continue;
      let inter = null;
      for (const p of preds[v]) {
        if (inter === null) {
          inter = new Set(dom[p]);
        } else {
          for (const x of [...inter]) {
            if (!dom[p].has(x)) inter.delete(x);
          }
        }
      }
      const newDom = inter === null ? new Set() : inter;
      newDom.add(v);
      if (newDom.size !== dom[v].size || [...newDom].some((x) => !dom[v].has(x))) {
        dom[v] = newDom;
        changed = true;
      }
    }
  }

  const idom = new Array(vertexCount).fill(null);
  idom[start] = start;
  for (const v of allReachable) {
    if (v === start) continue;
    const strict = [...dom[v]].filter((x) => x !== v);
    let best = null;
    for (const d of strict) {
      if (best === null || dom[d].size > dom[best].size) best = d;
    }
    idom[v] = best;
  }
  return idom;
}

// ---- hand-picked structural cases ----

test('single vertex: its own entry, no other vertices', () => {
  assert.deepEqual(immediateDominators(1, [], 0), [0]);
});

test('single vertex with a self-loop is still trivially its own idom', () => {
  assert.deepEqual(immediateDominators(1, [{ from: 0, to: 0 }], 0), [0]);
});

test('simple chain: each vertex is dominated by its unique predecessor', () => {
  const edges = [
    { from: 0, to: 1 },
    { from: 1, to: 2 },
    { from: 2, to: 3 },
  ];
  const result = immediateDominators(4, edges, 0);
  assert.deepEqual(result, [0, 0, 1, 2]);
  assert.deepEqual(result, bruteForceIdom(4, edges, 0));
});

test('diamond: the merge point is dominated by the shared ancestor, not either branch', () => {
  const edges = [
    { from: 0, to: 1 },
    { from: 0, to: 2 },
    { from: 1, to: 3 },
    { from: 2, to: 3 },
  ];
  const result = immediateDominators(4, edges, 0);
  assert.deepEqual(result, [0, 0, 0, 0]);
  assert.deepEqual(result, bruteForceIdom(4, edges, 0));
});

test('cycle with a back edge: dominance follows the forward structure, not the cycle', () => {
  // 0 -> 1 -> 2 -> 1 (back edge 2 -> 1)
  const edges = [
    { from: 0, to: 1 },
    { from: 1, to: 2 },
    { from: 2, to: 1 },
  ];
  const result = immediateDominators(3, edges, 0);
  assert.deepEqual(result, [0, 0, 1]);
  assert.deepEqual(result, bruteForceIdom(3, edges, 0));
});

test('irreducible-style loop with two entries into the cycle body', () => {
  // 0 -> 1, 0 -> 2, 1 -> 2, 2 -> 1, 2 -> 3 -- a loop (1,2) enterable from
  // both 1 and 2's own predecessor paths; only 0 dominates both 1 and 2.
  const edges = [
    { from: 0, to: 1 },
    { from: 0, to: 2 },
    { from: 1, to: 2 },
    { from: 2, to: 1 },
    { from: 2, to: 3 },
  ];
  const result = immediateDominators(4, edges, 0);
  assert.deepEqual(result, bruteForceIdom(4, edges, 0));
  assert.equal(result[0], 0);
  assert.equal(result[1], 0);
  assert.equal(result[2], 0);
  assert.equal(result[3], 2);
});

test('duplicate edges do not change the result', () => {
  const edges = [
    { from: 0, to: 1 },
    { from: 0, to: 1 },
    { from: 0, to: 1 },
    { from: 1, to: 2 },
  ];
  const result = immediateDominators(3, edges, 0);
  assert.deepEqual(result, [0, 0, 1]);
});

test('self-loops are accepted and have no effect on the result', () => {
  const withoutLoop = immediateDominators(3, [{ from: 0, to: 1 }, { from: 1, to: 2 }], 0);
  const withLoop = immediateDominators(
    3,
    [{ from: 0, to: 1 }, { from: 1, to: 1 }, { from: 1, to: 2 }, { from: 2, to: 2 }],
    0,
  );
  assert.deepEqual(withLoop, withoutLoop);
});

test('vertices unreachable from start get null, reachable ones are unaffected', () => {
  // 0 -> 1 is one component; 2 -> 3 is a wholly separate, unreachable one.
  const edges = [
    { from: 0, to: 1 },
    { from: 2, to: 3 },
  ];
  const result = immediateDominators(4, edges, 0);
  assert.deepEqual(result, [0, 0, null, null]);
});

test('a vertex reachable only via a self-loop is unreachable from start', () => {
  const edges = [
    { from: 0, to: 1 },
    { from: 2, to: 2 },
  ];
  const result = immediateDominators(3, edges, 0);
  assert.deepEqual(result, [0, 0, null]);
});

test('nonzero start: only vertices reachable from the actual start are dominated', () => {
  const edges = [
    { from: 0, to: 1 },
    { from: 1, to: 2 },
    { from: 2, to: 3 },
  ];
  const result = immediateDominators(4, edges, 2);
  assert.deepEqual(result, [null, null, 2, 2]);
  assert.deepEqual(result, bruteForceIdom(4, edges, 2));
});

test('shuffled input edge order produces an identical result', () => {
  const edges = [
    { from: 0, to: 1 },
    { from: 0, to: 2 },
    { from: 1, to: 3 },
    { from: 2, to: 3 },
    { from: 3, to: 4 },
    { from: 1, to: 4 },
  ];
  const shuffled = [edges[4], edges[1], edges[5], edges[0], edges[3], edges[2]];
  const a = immediateDominators(5, edges, 0);
  const b = immediateDominators(5, shuffled, 0);
  assert.deepEqual(a, b);
  assert.deepEqual(a, bruteForceIdom(5, edges, 0));
});

test('a deep chain (50,000 vertices) does not overflow the call stack', () => {
  const V = 50000;
  const edges = [];
  for (let i = 0; i < V - 1; i++) edges.push({ from: i, to: i + 1 });
  const result = immediateDominators(V, edges, 0);
  assert.equal(result.length, V);
  assert.equal(result[0], 0);
  for (let i = 1; i < V; i++) {
    assert.equal(result[i], i - 1, `vertex ${i} should be dominated by ${i - 1}`);
  }
});

test('a deep diamond-chain (dense predecessor sets) also does not overflow the call stack', () => {
  // A chain of 20,000 diamonds: 3k -> 3k+1, 3k -> 3k+2, 3k+1 -> 3k+3, 3k+2 -> 3k+3, ...
  // exercises deep EVAL/LINK compression chains, not just a plain path.
  const diamonds = 20000;
  const edges = [];
  for (let k = 0; k < diamonds; k++) {
    const base = 3 * k;
    edges.push({ from: base, to: base + 1 });
    edges.push({ from: base, to: base + 2 });
    edges.push({ from: base + 1, to: base + 3 });
    edges.push({ from: base + 2, to: base + 3 });
  }
  const V = 3 * diamonds + 1;
  const result = immediateDominators(V, edges, 0);
  for (let k = 0; k < diamonds; k++) {
    const base = 3 * k;
    assert.equal(result[base + 1], base);
    assert.equal(result[base + 2], base);
    assert.equal(result[base + 3], base);
  }
});

// ---- determinism / repeatability ----

test('repeated calls on the same graph always agree', () => {
  const edges = [
    { from: 0, to: 1 },
    { from: 1, to: 2 },
    { from: 0, to: 2 },
    { from: 2, to: 1 },
  ];
  const first = immediateDominators(3, edges, 0);
  for (let i = 0; i < 5; i++) {
    assert.deepEqual(immediateDominators(3, edges, 0), first);
  }
});

// ---- input immutability ----

test('does not mutate the edges array or any edge object', () => {
  const edges = [
    { from: 0, to: 1 },
    { from: 1, to: 2 },
  ];
  const snapshot = edges.map((e) => ({ ...e }));
  immediateDominators(3, edges, 0);
  assert.deepEqual(edges, snapshot);
  assert.equal(edges.length, 2);
});

test('does not mutate edges across multiple calls with the same array', () => {
  const edges = [
    { from: 0, to: 1 },
    { from: 0, to: 2 },
    { from: 1, to: 3 },
    { from: 2, to: 3 },
  ];
  const snapshot = edges.map((e) => ({ ...e }));
  immediateDominators(4, edges, 0);
  immediateDominators(4, edges, 0);
  immediateDominators(4, edges, 0);
  assert.deepEqual(edges, snapshot);
});

// ---- invalid inputs ----

test('vertexCount must be a safe integer', () => {
  assert.throws(() => immediateDominators('1', [], 0), TypeError);
  assert.throws(() => immediateDominators(1.5, [], 0), TypeError);
  assert.throws(() => immediateDominators(NaN, [], 0), TypeError);
  assert.throws(() => immediateDominators(Infinity, [], 0), TypeError);
  assert.throws(() => immediateDominators(2 ** 53, [], 0), TypeError);
});

test('vertexCount must be at least 1', () => {
  assert.throws(() => immediateDominators(0, [], 0), RangeError);
  assert.throws(() => immediateDominators(-1, [], 0), RangeError);
});

test('edges must be an array', () => {
  assert.throws(() => immediateDominators(2, 'nope', 0), TypeError);
  assert.throws(() => immediateDominators(2, {}, 0), TypeError);
  assert.throws(() => immediateDominators(2, null, 0), TypeError);
  assert.doesNotThrow(() => immediateDominators(2, [], 0));
});

test('start must be a safe integer within [0, vertexCount)', () => {
  assert.throws(() => immediateDominators(3, [], '0'), TypeError);
  assert.throws(() => immediateDominators(3, [], 1.5), TypeError);
  assert.throws(() => immediateDominators(3, [], null), TypeError);
  assert.throws(() => immediateDominators(3, [], -1), RangeError);
  assert.throws(() => immediateDominators(3, [], 3), RangeError);
});

test('each edge must be a well-formed object', () => {
  assert.throws(() => immediateDominators(2, [null], 0), TypeError);
  assert.throws(() => immediateDominators(2, ['x'], 0), TypeError);
  assert.throws(() => immediateDominators(2, [[0, 1]], 0), TypeError);
  assert.throws(() => immediateDominators(2, [5], 0), TypeError);
});

test('edge.from and edge.to must be safe integers within [0, vertexCount)', () => {
  assert.throws(() => immediateDominators(2, [{ from: '0', to: 1 }], 0), TypeError);
  assert.throws(() => immediateDominators(2, [{ from: 0, to: 1.5 }], 0), TypeError);
  assert.throws(() => immediateDominators(2, [{ from: 0, to: NaN }], 0), TypeError);
  assert.throws(() => immediateDominators(2, [{ from: -1, to: 1 }], 0), RangeError);
  assert.throws(() => immediateDominators(2, [{ from: 0, to: 2 }], 0), RangeError);
});

// ---- seeded random graphs checked against the brute-force oracle ----

test('seeded random small graphs match an exhaustive dominator-set oracle', () => {
  const rand = mulberry32(20260808);
  const trialCount = 400;
  for (let trial = 0; trial < trialCount; trial++) {
    const vertexCount = 1 + Math.floor(rand() * 7); // 1..7
    const start = Math.floor(rand() * vertexCount);
    const edgeCount = Math.floor(rand() * 10); // 0..9
    const edges = [];
    for (let i = 0; i < edgeCount; i++) {
      edges.push({
        from: Math.floor(rand() * vertexCount),
        to: Math.floor(rand() * vertexCount),
      });
    }

    const snapshot = edges.map((e) => ({ ...e }));
    const result = immediateDominators(vertexCount, edges, start);
    assert.deepEqual(edges, snapshot, `trial ${trial}: edges must not be mutated`);

    const oracle = bruteForceIdom(vertexCount, edges, start);
    assert.deepEqual(
      result,
      oracle,
      `trial ${trial}: vertexCount=${vertexCount} start=${start} edges=${JSON.stringify(edges)}`,
    );
  }
});

test('seeded random denser graphs (more cycles and cross edges) match the oracle', () => {
  const rand = mulberry32(999123);
  const trialCount = 200;
  for (let trial = 0; trial < trialCount; trial++) {
    const vertexCount = 2 + Math.floor(rand() * 8); // 2..9
    const start = Math.floor(rand() * vertexCount);
    const edgeCount = Math.floor(rand() * 20); // 0..19
    const edges = [];
    for (let i = 0; i < edgeCount; i++) {
      edges.push({
        from: Math.floor(rand() * vertexCount),
        to: Math.floor(rand() * vertexCount),
      });
    }

    const result = immediateDominators(vertexCount, edges, start);
    const oracle = bruteForceIdom(vertexCount, edges, start);
    assert.deepEqual(
      result,
      oracle,
      `trial ${trial}: vertexCount=${vertexCount} start=${start} edges=${JSON.stringify(edges)}`,
    );
  }
});
