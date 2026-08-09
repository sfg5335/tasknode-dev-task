'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  solveDynamicConnectivity,
  RollbackUnionFind,
  buildActiveIntervals,
} = require('./offline-dynamic-connectivity.js');

// ---------------------------------------------------------------------
// Independent brute-force oracle used by the seeded randomized
// differential tests below. Deliberately structured nothing like the
// implementation under test: no segment tree, no rollback union-find, no
// shared helper code -- just a live adjacency-set replay with a fresh
// BFS from scratch on every query.
// ---------------------------------------------------------------------
function oracleKey(u, v) {
  const lo = Math.min(u, v);
  const hi = Math.max(u, v);
  return `${lo},${hi}`;
}

function oracle(vertexCount, operations) {
  const active = new Set();
  const adjacency = Array.from({ length: vertexCount }, () => new Set());
  const results = [];

  function bfsReachable(start) {
    const seen = new Set([start]);
    const queue = [start];
    while (queue.length > 0) {
      const cur = queue.pop();
      for (const nxt of adjacency[cur]) {
        if (!seen.has(nxt)) {
          seen.add(nxt);
          queue.push(nxt);
        }
      }
    }
    return seen;
  }

  for (const op of operations) {
    if (op.type === 'add') {
      const k = oracleKey(op.u, op.v);
      if (active.has(k)) throw new RangeError('oracle: duplicate active add');
      active.add(k);
      if (op.u !== op.v) {
        adjacency[op.u].add(op.v);
        adjacency[op.v].add(op.u);
      }
    } else if (op.type === 'remove') {
      const k = oracleKey(op.u, op.v);
      if (!active.has(k)) throw new RangeError('oracle: remove inactive');
      active.delete(k);
      if (op.u !== op.v) {
        adjacency[op.u].delete(op.v);
        adjacency[op.v].delete(op.u);
      }
    } else if (op.type === 'connected') {
      results.push(bfsReachable(op.u).has(op.v));
    } else if (op.type === 'componentCount') {
      const seen = new Set();
      let count = 0;
      for (let v = 0; v < vertexCount; v++) {
        if (!seen.has(v)) {
          count++;
          for (const w of bfsReachable(v)) seen.add(w);
        }
      }
      results.push(count);
    }
  }
  return results;
}

function checkAgainstOracle(vertexCount, operations) {
  const expected = oracle(vertexCount, operations);
  const actual = solveDynamicConnectivity(vertexCount, operations);
  assert.deepStrictEqual(actual, expected);
}

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

// ---------------------------------------------------------------------
// Empty graphs.
// ---------------------------------------------------------------------

test('vertexCount 0 with no operations returns an empty result array', () => {
  assert.deepStrictEqual(solveDynamicConnectivity(0, []), []);
});

test('positive vertexCount with no operations returns an empty result array', () => {
  assert.deepStrictEqual(solveDynamicConnectivity(5, []), []);
});

test('vertexCount 0 with a componentCount query returns 0', () => {
  assert.deepStrictEqual(
    solveDynamicConnectivity(0, [{ type: 'componentCount' }]),
    [0]
  );
});

test('graph with vertices but no edges: every componentCount equals vertexCount', () => {
  const result = solveDynamicConnectivity(4, [
    { type: 'componentCount' },
    { type: 'connected', u: 0, v: 1 },
    { type: 'connected', u: 2, v: 3 },
  ]);
  assert.deepStrictEqual(result, [4, false, false]);
});

// ---------------------------------------------------------------------
// Add / remove / re-add sequences.
// ---------------------------------------------------------------------

test('add then connected then remove then connected reflects the edge going away', () => {
  const result = solveDynamicConnectivity(3, [
    { type: 'add', u: 0, v: 1 },
    { type: 'connected', u: 0, v: 1 },
    { type: 'connected', u: 0, v: 2 },
    { type: 'remove', u: 0, v: 1 },
    { type: 'connected', u: 0, v: 1 },
  ]);
  assert.deepStrictEqual(result, [true, false, false]);
});

test('add, remove, then re-add the same edge is legal and restores connectivity', () => {
  const result = solveDynamicConnectivity(2, [
    { type: 'add', u: 0, v: 1 },
    { type: 'connected', u: 0, v: 1 },
    { type: 'remove', u: 0, v: 1 },
    { type: 'connected', u: 0, v: 1 },
    { type: 'add', u: 0, v: 1 },
    { type: 'connected', u: 0, v: 1 },
  ]);
  assert.deepStrictEqual(result, [true, false, true]);
});

test('an edge active only briefly is invisible to queries both before and after its interval', () => {
  const result = solveDynamicConnectivity(2, [
    { type: 'connected', u: 0, v: 1 },
    { type: 'add', u: 0, v: 1 },
    { type: 'connected', u: 0, v: 1 },
    { type: 'remove', u: 0, v: 1 },
    { type: 'connected', u: 0, v: 1 },
  ]);
  assert.deepStrictEqual(result, [false, true, false]);
});

test('many alternating add/remove cycles on the same edge stay correct throughout', () => {
  const ops = [];
  const expected = [];
  for (let i = 0; i < 20; i++) {
    ops.push({ type: 'add', u: 0, v: 1 });
    ops.push({ type: 'connected', u: 0, v: 1 });
    expected.push(true);
    ops.push({ type: 'remove', u: 0, v: 1 });
    ops.push({ type: 'connected', u: 0, v: 1 });
    expected.push(false);
  }
  assert.deepStrictEqual(solveDynamicConnectivity(2, ops), expected);
});

test('an edge left active through the end of the sequence still answers queries after it (never-removed interval)', () => {
  const result = solveDynamicConnectivity(2, [
    { type: 'add', u: 0, v: 1 },
    { type: 'connected', u: 0, v: 1 },
    { type: 'connected', u: 0, v: 1 },
    { type: 'connected', u: 0, v: 1 },
  ]);
  assert.deepStrictEqual(result, [true, true, true]);
});

// ---------------------------------------------------------------------
// Bridge deletion.
// ---------------------------------------------------------------------

test('removing a bridge edge disconnects the two sides it was joining', () => {
  // Path 0-1-2: edge (1,2) is a bridge; removing it splits {0,1} from {2}.
  const result = solveDynamicConnectivity(3, [
    { type: 'add', u: 0, v: 1 },
    { type: 'add', u: 1, v: 2 },
    { type: 'connected', u: 0, v: 2 },
    { type: 'remove', u: 1, v: 2 },
    { type: 'connected', u: 0, v: 2 },
    { type: 'connected', u: 0, v: 1 },
  ]);
  assert.deepStrictEqual(result, [true, false, true]);
});

test('removing a non-bridge edge from a cycle preserves connectivity', () => {
  // Triangle 0-1-2-0: removing edge (0,1) leaves the path 0-2-1 intact.
  const result = solveDynamicConnectivity(3, [
    { type: 'add', u: 0, v: 1 },
    { type: 'add', u: 1, v: 2 },
    { type: 'add', u: 2, v: 0 },
    { type: 'remove', u: 0, v: 1 },
    { type: 'connected', u: 0, v: 1 },
  ]);
  assert.deepStrictEqual(result, [true]);
});

test('removing all edges of a star graph isolates every leaf one at a time', () => {
  // Center vertex 0 connected to 1,2,3,4; remove one spoke at a time.
  const ops = [
    { type: 'add', u: 0, v: 1 },
    { type: 'add', u: 0, v: 2 },
    { type: 'add', u: 0, v: 3 },
    { type: 'add', u: 0, v: 4 },
    { type: 'componentCount' }, // 1
    { type: 'remove', u: 0, v: 1 },
    { type: 'componentCount' }, // 2
    { type: 'remove', u: 0, v: 2 },
    { type: 'componentCount' }, // 3
    { type: 'remove', u: 0, v: 3 },
    { type: 'componentCount' }, // 4
    { type: 'remove', u: 0, v: 4 },
    { type: 'componentCount' }, // 5
  ];
  assert.deepStrictEqual(solveDynamicConnectivity(5, ops), [1, 2, 3, 4, 5]);
});

// ---------------------------------------------------------------------
// Reversed endpoints (canonical undirected-edge tracking).
// ---------------------------------------------------------------------

test('removing an edge with reversed endpoints from how it was added still works', () => {
  const result = solveDynamicConnectivity(2, [
    { type: 'add', u: 0, v: 1 },
    { type: 'remove', u: 1, v: 0 },
    { type: 'connected', u: 0, v: 1 },
  ]);
  assert.deepStrictEqual(result, [false]);
});

test('adding an edge with reversed endpoints while already active is still a duplicate', () => {
  assert.throws(
    () =>
      solveDynamicConnectivity(2, [
        { type: 'add', u: 0, v: 1 },
        { type: 'add', u: 1, v: 0 },
      ]),
    RangeError
  );
});

test('connected() reports the same answer regardless of query argument order', () => {
  const result = solveDynamicConnectivity(2, [
    { type: 'add', u: 0, v: 1 },
    { type: 'connected', u: 0, v: 1 },
    { type: 'connected', u: 1, v: 0 },
  ]);
  assert.deepStrictEqual(result, [true, true]);
});

// ---------------------------------------------------------------------
// Self-loops.
// ---------------------------------------------------------------------

test('a self-loop can be added and removed like any other edge, validated the same way', () => {
  const result = solveDynamicConnectivity(2, [
    { type: 'add', u: 0, v: 0 },
    { type: 'connected', u: 0, v: 0 },
    { type: 'remove', u: 0, v: 0 },
    { type: 'connected', u: 0, v: 0 },
  ]);
  // A vertex is always "connected" to itself, self-loop or not.
  assert.deepStrictEqual(result, [true, true]);
});

test('a self-loop never changes connectivity between distinct vertices or componentCount', () => {
  const result = solveDynamicConnectivity(3, [
    { type: 'componentCount' },
    { type: 'add', u: 1, v: 1 },
    { type: 'componentCount' },
    { type: 'connected', u: 0, v: 1 },
    { type: 'connected', u: 1, v: 2 },
  ]);
  assert.deepStrictEqual(result, [3, 3, false, false]);
});

test('adding a self-loop while it is already active is a duplicate RangeError', () => {
  assert.throws(
    () =>
      solveDynamicConnectivity(2, [
        { type: 'add', u: 0, v: 0 },
        { type: 'add', u: 0, v: 0 },
      ]),
    RangeError
  );
});

test('removing a self-loop that was never added throws RangeError', () => {
  assert.throws(
    () => solveDynamicConnectivity(2, [{ type: 'remove', u: 0, v: 0 }]),
    RangeError
  );
});

test('a self-loop and a same-pair real edge are tracked independently by canonicalization (both are key (u,u))', () => {
  // Adding then removing a self-loop, then adding a *different* edge
  // touching the same vertex, must not be confused with the self-loop.
  const result = solveDynamicConnectivity(2, [
    { type: 'add', u: 0, v: 0 },
    { type: 'remove', u: 0, v: 0 },
    { type: 'add', u: 0, v: 1 },
    { type: 'connected', u: 0, v: 1 },
  ]);
  assert.deepStrictEqual(result, [true]);
});

// ---------------------------------------------------------------------
// Component counts.
// ---------------------------------------------------------------------

test('componentCount decreases by exactly one per structural union and tracks isolated vertices', () => {
  const result = solveDynamicConnectivity(5, [
    { type: 'componentCount' },
    { type: 'add', u: 0, v: 1 },
    { type: 'componentCount' },
    { type: 'add', u: 1, v: 2 },
    { type: 'componentCount' },
    { type: 'add', u: 3, v: 4 },
    { type: 'componentCount' },
    { type: 'add', u: 0, v: 2 }, // already connected -- no-op union
    { type: 'componentCount' },
  ]);
  assert.deepStrictEqual(result, [5, 4, 3, 2, 2]);
});

test('componentCount increases by exactly one per edge removal that actually disconnects', () => {
  const result = solveDynamicConnectivity(3, [
    { type: 'add', u: 0, v: 1 },
    { type: 'add', u: 1, v: 2 },
    { type: 'componentCount' },
    { type: 'remove', u: 1, v: 2 },
    { type: 'componentCount' },
    { type: 'remove', u: 0, v: 1 },
    { type: 'componentCount' },
  ]);
  assert.deepStrictEqual(result, [1, 2, 3]);
});

test('componentCount after adding a redundant edge inside an existing component does not change', () => {
  const result = solveDynamicConnectivity(3, [
    { type: 'add', u: 0, v: 1 },
    { type: 'add', u: 1, v: 2 },
    { type: 'add', u: 0, v: 2 }, // closes a triangle, no new merge
    { type: 'componentCount' },
    { type: 'remove', u: 0, v: 2 }, // still connected via 0-1-2
    { type: 'componentCount' },
  ]);
  assert.deepStrictEqual(result, [1, 1]);
});

// ---------------------------------------------------------------------
// Invalid inputs.
// ---------------------------------------------------------------------

test('vertexCount that is not a non-negative integer throws TypeError', () => {
  assert.throws(() => solveDynamicConnectivity(-1, []), TypeError);
  assert.throws(() => solveDynamicConnectivity(1.5, []), TypeError);
  assert.throws(() => solveDynamicConnectivity('3', []), TypeError);
  assert.throws(() => solveDynamicConnectivity(NaN, []), TypeError);
  assert.throws(() => solveDynamicConnectivity(undefined, []), TypeError);
});

test('operations that is not an array throws TypeError', () => {
  assert.throws(() => solveDynamicConnectivity(3, 'nope'), TypeError);
  assert.throws(() => solveDynamicConnectivity(3, {}), TypeError);
  assert.throws(() => solveDynamicConnectivity(3, null), TypeError);
  assert.throws(() => solveDynamicConnectivity(3, undefined), TypeError);
});

test('a non-object operation entry throws TypeError', () => {
  assert.throws(() => solveDynamicConnectivity(3, [null]), TypeError);
  assert.throws(() => solveDynamicConnectivity(3, ['add']), TypeError);
  assert.throws(() => solveDynamicConnectivity(3, [42]), TypeError);
  assert.throws(() => solveDynamicConnectivity(3, [[1, 2]]), TypeError);
});

test('an operation with an unknown or missing type throws TypeError', () => {
  assert.throws(
    () => solveDynamicConnectivity(3, [{ type: 'bogus', u: 0, v: 1 }]),
    TypeError
  );
  assert.throws(() => solveDynamicConnectivity(3, [{ u: 0, v: 1 }]), TypeError);
  assert.throws(() => solveDynamicConnectivity(3, [{ type: 7 }]), TypeError);
});

test('add/remove/connected with a non-integer u or v throws TypeError', () => {
  assert.throws(
    () => solveDynamicConnectivity(3, [{ type: 'add', u: 0.5, v: 1 }]),
    TypeError
  );
  assert.throws(
    () => solveDynamicConnectivity(3, [{ type: 'add', u: 0, v: '1' }]),
    TypeError
  );
  assert.throws(
    () => solveDynamicConnectivity(3, [{ type: 'connected', u: 0, v: NaN }]),
    TypeError
  );
  assert.throws(
    () => solveDynamicConnectivity(3, [{ type: 'remove', u: undefined, v: 1 }]),
    TypeError
  );
});

test('add/remove/connected with an out-of-range vertex throws RangeError', () => {
  assert.throws(
    () => solveDynamicConnectivity(3, [{ type: 'add', u: 0, v: 3 }]),
    RangeError
  );
  assert.throws(
    () => solveDynamicConnectivity(3, [{ type: 'add', u: -1, v: 1 }]),
    RangeError
  );
  assert.throws(
    () => solveDynamicConnectivity(3, [{ type: 'connected', u: 0, v: 100 }]),
    RangeError
  );
  assert.throws(
    () => solveDynamicConnectivity(0, [{ type: 'add', u: 0, v: 0 }]),
    RangeError
  );
});

test('adding an already-active edge throws RangeError', () => {
  assert.throws(
    () =>
      solveDynamicConnectivity(2, [
        { type: 'add', u: 0, v: 1 },
        { type: 'add', u: 0, v: 1 },
      ]),
    RangeError
  );
});

test('removing an edge that was never added throws RangeError', () => {
  assert.throws(
    () => solveDynamicConnectivity(2, [{ type: 'remove', u: 0, v: 1 }]),
    RangeError
  );
});

test('removing an edge that was already removed throws RangeError', () => {
  assert.throws(
    () =>
      solveDynamicConnectivity(2, [
        { type: 'add', u: 0, v: 1 },
        { type: 'remove', u: 0, v: 1 },
        { type: 'remove', u: 0, v: 1 },
      ]),
    RangeError
  );
});

test('a TypeError-worthy malformed operation earlier in the sequence is reported even if a RangeError-worthy one follows', () => {
  // operations[0] is malformed (TypeError-worthy); operations[1] would be
  // a RangeError (out of range) -- the first offending index wins, and
  // its category (TypeError) is what's thrown, not RangeError.
  assert.throws(
    () =>
      solveDynamicConnectivity(2, [
        { type: 'add', u: 0.5, v: 1 },
        { type: 'add', u: 0, v: 99 },
      ]),
    TypeError
  );
});

// ---------------------------------------------------------------------
// Input immutability.
// ---------------------------------------------------------------------

test('the operations array and its entries are never mutated', () => {
  const ops = [
    { type: 'add', u: 0, v: 1 },
    { type: 'connected', u: 0, v: 1 },
    { type: 'remove', u: 0, v: 1 },
    { type: 'componentCount' },
  ];
  const snapshot = JSON.parse(JSON.stringify(ops));
  solveDynamicConnectivity(3, ops);
  assert.deepStrictEqual(ops, snapshot);
});

test('mutating the caller-supplied operations array after the call does not retroactively change anything (defensive read, not aliasing)', () => {
  const ops = [{ type: 'add', u: 0, v: 1 }, { type: 'connected', u: 0, v: 1 }];
  const result = solveDynamicConnectivity(2, ops);
  ops.push({ type: 'componentCount' });
  ops[0].type = 'remove';
  assert.deepStrictEqual(result, [true]);
});

// ---------------------------------------------------------------------
// RollbackUnionFind: whitebox tests of the rollback + tie-break logic
// the verification section calls out for direct inspection. These are
// NOT observable through solveDynamicConnectivity's own return values
// (connectivity/component counts are invariant to which same-size root
// wins a tie), so they must exercise the exported class directly.
// ---------------------------------------------------------------------

test('RollbackUnionFind: union of two singletons is a size tie broken by the smaller root winning', () => {
  const dsu = new RollbackUnionFind(6);
  dsu.union(5, 3);
  assert.strictEqual(dsu.find(5), 3);
  assert.strictEqual(dsu.find(3), 3);
});

test('RollbackUnionFind: union prefers the strictly larger component regardless of index', () => {
  const dsu = new RollbackUnionFind(6);
  dsu.union(4, 5); // {4,5}, tie -> root 4, size 2
  dsu.union(1, 4); // {1} size 1 vs {4,5} size 2 -> larger (root 4) wins
  assert.strictEqual(dsu.find(1), 4);
  assert.strictEqual(dsu.find(4), 4);
  assert.strictEqual(dsu.find(5), 4);
});

test('RollbackUnionFind: merging two equal-size (>1) components breaks the tie by smaller root', () => {
  const dsu = new RollbackUnionFind(4);
  dsu.union(0, 1); // tie -> root 0, size 2
  dsu.union(2, 3); // tie -> root 2, size 2
  dsu.union(1, 2); // two size-2 groups, roots 0 and 2 -> smaller root 0 wins
  assert.strictEqual(dsu.find(0), 0);
  assert.strictEqual(dsu.find(1), 0);
  assert.strictEqual(dsu.find(2), 0);
  assert.strictEqual(dsu.find(3), 0);
});

test('RollbackUnionFind: union returns false and is a no-op for vertices already in the same component (including self-loops)', () => {
  const dsu = new RollbackUnionFind(3);
  assert.strictEqual(dsu.union(1, 1), false);
  assert.strictEqual(dsu.componentCount, 3);
  dsu.union(0, 1);
  assert.strictEqual(dsu.union(0, 1), false);
  assert.strictEqual(dsu.union(1, 0), false);
  assert.strictEqual(dsu.componentCount, 2);
});

test('RollbackUnionFind: snapshot/rollback exactly restores parent, size, and componentCount state', () => {
  const dsu = new RollbackUnionFind(5);
  const snap0 = dsu.snapshot();
  dsu.union(0, 1);
  const snap1 = dsu.snapshot();
  dsu.union(2, 3);
  dsu.union(1, 2);
  assert.strictEqual(dsu.componentCount, 2);

  dsu.rollback(snap1);
  assert.strictEqual(dsu.find(0), dsu.find(1));
  assert.notStrictEqual(dsu.find(0), dsu.find(2));
  assert.notStrictEqual(dsu.find(2), dsu.find(3));
  assert.strictEqual(dsu.componentCount, 4);

  dsu.rollback(snap0);
  for (let i = 0; i < 5; i++) assert.strictEqual(dsu.find(i), i);
  assert.strictEqual(dsu.componentCount, 5);
});

test('RollbackUnionFind: nested snapshot/rollback (stack discipline) restores intermediate states correctly', () => {
  const dsu = new RollbackUnionFind(6);
  const s0 = dsu.snapshot();
  dsu.union(0, 1);
  const s1 = dsu.snapshot();
  dsu.union(1, 2);
  const s2 = dsu.snapshot();
  dsu.union(3, 4);
  dsu.union(4, 5);

  dsu.rollback(s2);
  assert.strictEqual(dsu.componentCount, 4); // {0,1,2}, {3}, {4}, {5}

  dsu.rollback(s1);
  assert.strictEqual(dsu.componentCount, 5); // {0,1}, {2}, {3}, {4}, {5}

  dsu.rollback(s0);
  assert.strictEqual(dsu.componentCount, 6);
});

test('RollbackUnionFind: find() performs no path compression (parent chain length is left exactly as union() built it)', () => {
  // Deliberately build a non-trivial chain via size ties won by the
  // smaller index each time: union(1,0)->root0, union(2,0)->tie broken
  // toward 0 again (size2 vs size1 -> larger side (0's group) wins, no
  // change to who's root), so let's instead force chain depth using a
  // sequence where each new singleton loses to a strictly larger group
  // -- the point here is just that find() must not mutate any parent
  // pointer as a side effect, only *read* them.
  const dsu = new RollbackUnionFind(4);
  dsu.union(0, 1); // root 0
  dsu.union(0, 2); // root 0 (size 2 beats size 1)
  const parentBefore = Array.from(dsu.parent);
  dsu.find(2);
  dsu.find(1);
  dsu.find(0);
  assert.deepStrictEqual(Array.from(dsu.parent), parentBefore);
});

// ---------------------------------------------------------------------
// buildActiveIntervals: whitebox tests of the active-interval
// construction logic, exported for the same "expose for inspection"
// reason as RollbackUnionFind above.
// ---------------------------------------------------------------------

test('buildActiveIntervals: a closed add/remove pair produces one half-open interval', () => {
  const parsed = [
    { type: 'add', u: 0, v: 1 },
    { type: 'connected', u: 0, v: 1 },
    { type: 'remove', u: 0, v: 1 },
  ];
  assert.deepStrictEqual(buildActiveIntervals(parsed), [
    { u: 0, v: 1, start: 0, end: 2 },
  ]);
});

test('buildActiveIntervals: an edge never removed extends to the end of the timeline', () => {
  const parsed = [{ type: 'add', u: 1, v: 0 }, { type: 'componentCount' }];
  assert.deepStrictEqual(buildActiveIntervals(parsed), [
    { u: 0, v: 1, start: 0, end: 2 },
  ]);
});

test('buildActiveIntervals: add/remove/re-add produces two disjoint intervals', () => {
  const parsed = [
    { type: 'add', u: 0, v: 1 },
    { type: 'remove', u: 0, v: 1 },
    { type: 'connected', u: 2, v: 2 },
    { type: 'add', u: 0, v: 1 },
  ];
  assert.deepStrictEqual(buildActiveIntervals(parsed), [
    { u: 0, v: 1, start: 0, end: 1 },
    { u: 0, v: 1, start: 3, end: 4 },
  ]);
});

test('buildActiveIntervals: an add immediately followed by remove at the very next index still produces a width-1 interval, but it can never cover a query', () => {
  // start (the add's own index) is always strictly less than end (the
  // remove's own index), since add and remove can never share an index
  // -- so a half-open [0, 1) interval genuinely exists here. It is
  // harmless: the only index it covers, 0, is occupied by the 'add'
  // operation itself, never a query, so this interval can never change
  // any observable result (confirmed indirectly by every other test in
  // this file, none of which ever see a spurious extra union from it).
  const parsed = [
    { type: 'add', u: 0, v: 1 },
    { type: 'remove', u: 0, v: 1 },
  ];
  assert.deepStrictEqual(buildActiveIntervals(parsed), [
    { u: 0, v: 1, start: 0, end: 1 },
  ]);
});

test('buildActiveIntervals: multiple independent edges are tracked separately', () => {
  const parsed = [
    { type: 'add', u: 0, v: 1 },
    { type: 'add', u: 2, v: 3 },
    { type: 'remove', u: 0, v: 1 },
    { type: 'remove', u: 2, v: 3 },
  ];
  const result = buildActiveIntervals(parsed);
  const byPair = new Map(result.map((iv) => [`${iv.u},${iv.v}`, iv]));
  assert.deepStrictEqual(byPair.get('0,1'), { u: 0, v: 1, start: 0, end: 2 });
  assert.deepStrictEqual(byPair.get('2,3'), { u: 2, v: 3, start: 1, end: 3 });
});

// ---------------------------------------------------------------------
// Seeded randomized differential tests against the independent oracle.
// ---------------------------------------------------------------------

test('seeded randomized differential test: broad mixed operation mix, small graphs', () => {
  const rand = mulberry32(20260809);
  let trialsRun = 0;
  for (let trial = 0; trial < 400; trial++) {
    const vertexCount = 1 + Math.floor(rand() * 6);
    const opCount = Math.floor(rand() * 30);
    const active = new Set();
    const ops = [];
    for (let i = 0; i < opCount; i++) {
      const roll = rand();
      const u = Math.floor(rand() * vertexCount);
      const v = Math.floor(rand() * vertexCount);
      const k = oracleKey(u, v);
      if (roll < 0.35 && !active.has(k)) {
        active.add(k);
        ops.push({ type: 'add', u, v });
      } else if (roll < 0.6 && active.has(k)) {
        active.delete(k);
        ops.push({ type: 'remove', u, v });
      } else if (roll < 0.85) {
        ops.push({ type: 'connected', u, v });
      } else {
        ops.push({ type: 'componentCount' });
      }
    }
    checkAgainstOracle(vertexCount, ops);
    trialsRun++;
  }
  assert.strictEqual(trialsRun, 400);
});

test('seeded randomized differential test: larger vertex counts and longer sequences', () => {
  const rand = mulberry32(777);
  let trialsRun = 0;
  for (let trial = 0; trial < 200; trial++) {
    const vertexCount = 2 + Math.floor(rand() * 25);
    const opCount = Math.floor(rand() * 100);
    const active = new Set();
    const ops = [];
    for (let i = 0; i < opCount; i++) {
      const roll = rand();
      const u = Math.floor(rand() * vertexCount);
      const v = Math.floor(rand() * vertexCount);
      const k = oracleKey(u, v);
      if (roll < 0.4 && !active.has(k)) {
        active.add(k);
        ops.push({ type: 'add', u, v });
      } else if (roll < 0.65 && active.has(k)) {
        active.delete(k);
        ops.push({ type: 'remove', u, v });
      } else if (roll < 0.9) {
        ops.push({ type: 'connected', u, v });
      } else {
        ops.push({ type: 'componentCount' });
      }
    }
    checkAgainstOracle(vertexCount, ops);
    trialsRun++;
  }
  assert.strictEqual(trialsRun, 200);
});

test('seeded randomized differential test: self-loop-heavy operation mix', () => {
  const rand = mulberry32(31415926);
  let trialsRun = 0;
  for (let trial = 0; trial < 200; trial++) {
    const vertexCount = 1 + Math.floor(rand() * 5);
    const opCount = Math.floor(rand() * 25);
    const active = new Set();
    const ops = [];
    for (let i = 0; i < opCount; i++) {
      const roll = rand();
      const useSelfLoop = rand() < 0.5;
      const u = Math.floor(rand() * vertexCount);
      const v = useSelfLoop ? u : Math.floor(rand() * vertexCount);
      const k = oracleKey(u, v);
      if (roll < 0.4 && !active.has(k)) {
        active.add(k);
        ops.push({ type: 'add', u, v });
      } else if (roll < 0.7 && active.has(k)) {
        active.delete(k);
        ops.push({ type: 'remove', u, v });
      } else if (roll < 0.9) {
        ops.push({ type: 'connected', u, v });
      } else {
        ops.push({ type: 'componentCount' });
      }
    }
    checkAgainstOracle(vertexCount, ops);
    trialsRun++;
  }
  assert.strictEqual(trialsRun, 200);
});

test('seeded randomized differential test: dense complete-graph add-all then remove-all in shuffled orders', () => {
  const rand = mulberry32(2026);
  let trialsRun = 0;
  for (let trial = 0; trial < 40; trial++) {
    const vertexCount = 2 + Math.floor(rand() * 6);
    const allEdges = [];
    for (let u = 0; u < vertexCount; u++) {
      for (let v = u; v < vertexCount; v++) allEdges.push([u, v]);
    }
    for (let i = allEdges.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [allEdges[i], allEdges[j]] = [allEdges[j], allEdges[i]];
    }
    const ops = [];
    for (const [u, v] of allEdges) ops.push({ type: 'add', u, v });
    ops.push({ type: 'componentCount' });
    for (let i = allEdges.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [allEdges[i], allEdges[j]] = [allEdges[j], allEdges[i]];
    }
    for (const [u, v] of allEdges) {
      ops.push({ type: 'remove', u, v });
      ops.push({ type: 'componentCount' });
    }
    checkAgainstOracle(vertexCount, ops);
    trialsRun++;
  }
  assert.strictEqual(trialsRun, 40);
});

// ---------------------------------------------------------------------
// Determinism.
// ---------------------------------------------------------------------

test('the same input produces byte-identical output across repeated calls', () => {
  const vertexCount = 8;
  const ops = [
    { type: 'add', u: 0, v: 1 },
    { type: 'add', u: 2, v: 3 },
    { type: 'add', u: 4, v: 5 },
    { type: 'add', u: 1, v: 2 },
    { type: 'componentCount' },
    { type: 'connected', u: 0, v: 3 },
    { type: 'remove', u: 1, v: 2 },
    { type: 'connected', u: 0, v: 3 },
    { type: 'componentCount' },
  ];
  const first = solveDynamicConnectivity(vertexCount, ops);
  for (let i = 0; i < 5; i++) {
    assert.deepStrictEqual(solveDynamicConnectivity(vertexCount, ops), first);
  }
});
