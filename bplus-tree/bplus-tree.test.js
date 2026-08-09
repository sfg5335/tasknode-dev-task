'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { BPlusTree } = require('./bplus-tree.js');

// ---- deterministic PRNG (mulberry32), for the randomized differential test ----
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

// ---- trivial, structurally-independent reference oracle -----------------
// Deliberately a plain sorted array, NOT a Map and NOT reusing any part of
// BPlusTree's own logic, so a shared bug in the tree can't cancel out
// against the oracle.
class SimpleOrderedMap {
  constructor() {
    this._keys = [];
    this._values = [];
  }
  get size() {
    return this._keys.length;
  }
  set(key, value) {
    const i = this._keys.indexOf(key);
    if (i !== -1) {
      this._values[i] = value;
      return this;
    }
    let pos = 0;
    while (pos < this._keys.length && this._keys[pos] < key) pos++;
    this._keys.splice(pos, 0, key);
    this._values.splice(pos, 0, value);
    return this;
  }
  get(key) {
    const i = this._keys.indexOf(key);
    return i === -1 ? undefined : this._values[i];
  }
  has(key) {
    return this._keys.indexOf(key) !== -1;
  }
  delete(key) {
    const i = this._keys.indexOf(key);
    if (i === -1) return false;
    this._keys.splice(i, 1);
    this._values.splice(i, 1);
    return true;
  }
  range(lo, hi) {
    const out = [];
    for (let i = 0; i < this._keys.length; i++) {
      if (this._keys[i] >= lo && this._keys[i] <= hi) out.push([this._keys[i], this._values[i]]);
    }
    return out;
  }
}

// ---- independent whitebox structural-invariant checker ------------------
// Walks tree._root directly. Never calls get/has/size/range on the tree
// under test, so it cannot be fooled by a bug that corrupts both the
// structure and those accessor methods identically.
function checkInvariants(tree) {
  const maxKeys = tree._maxKeys;
  const minKeys = tree._minKeys;

  function walk(node, isRoot, depth, lowBound, highBound) {
    assert.ok(node.keys.length <= maxKeys, 'node exceeds maxKeys');
    if (!isRoot) {
      assert.ok(
        node.keys.length >= minKeys,
        `non-root node underflows minKeys (has ${node.keys.length}, need >= ${minKeys})`
      );
    }
    for (let i = 1; i < node.keys.length; i++) {
      assert.ok(node.keys[i - 1] < node.keys[i], 'node keys not strictly ascending');
    }
    if (lowBound !== null) {
      for (const k of node.keys) assert.ok(k >= lowBound, `key ${k} violates low bound ${lowBound}`);
    }
    if (highBound !== null) {
      for (const k of node.keys) assert.ok(k < highBound, `key ${k} violates high bound ${highBound}`);
    }
    if (node.leaf) {
      assert.strictEqual(node.keys.length, node.values.length, 'leaf keys/values length mismatch');
      return { depth, firstLeaf: node, lastLeaf: node };
    }
    assert.strictEqual(node.children.length, node.keys.length + 1, 'children/keys length mismatch');
    let leftmostDepth = null;
    let prevLastLeaf = null;
    let firstLeafOfNode = null;
    let lastLeafOfNode = null;
    for (let i = 0; i < node.children.length; i++) {
      const childLow = i === 0 ? lowBound : node.keys[i - 1];
      const childHigh = i === node.children.length - 1 ? highBound : node.keys[i];
      const sub = walk(node.children[i], false, depth + 1, childLow, childHigh);
      if (leftmostDepth === null) leftmostDepth = sub.depth;
      assert.strictEqual(sub.depth, leftmostDepth, 'unbalanced leaf depth');
      if (i === 0) firstLeafOfNode = sub.firstLeaf;
      lastLeafOfNode = sub.lastLeaf;
      if (prevLastLeaf !== null) {
        assert.strictEqual(prevLastLeaf.next, sub.firstLeaf, 'leaf linkage broken between children');
      }
      prevLastLeaf = sub.lastLeaf;
    }
    return { depth: leftmostDepth, firstLeaf: firstLeafOfNode, lastLeaf: lastLeafOfNode };
  }

  const summary = walk(tree._root, true, 0, null, null);

  let leaf = summary.firstLeaf;
  let seen = 0;
  let prevKey = -Infinity;
  const visited = new Set();
  while (leaf) {
    assert.ok(!visited.has(leaf), 'cycle detected in leaf chain');
    visited.add(leaf);
    for (const k of leaf.keys) {
      assert.ok(k > prevKey, 'leaf chain not strictly ascending across leaves');
      prevKey = k;
      seen++;
    }
    leaf = leaf.next;
  }
  assert.strictEqual(seen, tree.size, 'leaf-chain key count does not match tree.size');
}

function dump(node, indent = '') {
  // Debug helper, unused in assertions -- kept only because it was useful
  // while hand-deriving the deletion-mechanism scenarios below, and costs
  // nothing to leave in for anyone re-verifying this suite interactively.
  if (node.leaf) return `${indent}LEAF ${JSON.stringify(node.keys)}`;
  return (
    `${indent}INTERNAL ${JSON.stringify(node.keys)}\n` +
    node.children.map((c) => dump(c, indent + '  ')).join('\n')
  );
}

// =====================================================================
// Empty-tree behavior
// =====================================================================

test('an empty tree has size 0 and reports every key as absent', () => {
  const t = new BPlusTree();
  assert.strictEqual(t.size, 0);
  assert.strictEqual(t.get(5), undefined);
  assert.strictEqual(t.has(5), false);
  assert.strictEqual(t.delete(5), false);
  assert.deepStrictEqual(t.range(-100, 100), []);
  checkInvariants(t);
});

// =====================================================================
// Odd and even node capacities
// =====================================================================

test('odd maxKeys=3 and even maxKeys=4 both split, merge, and stay valid across 200 randomized ops', () => {
  for (const maxKeys of [3, 4]) {
    const rand = mulberry32(7000 + maxKeys);
    const tree = new BPlusTree(maxKeys);
    const oracle = new SimpleOrderedMap();
    for (let op = 0; op < 200; op++) {
      const key = Math.floor(rand() * 50) - 15;
      const roll = rand();
      if (roll < 0.6) {
        const v = `v${op}`;
        tree.set(key, v);
        oracle.set(key, v);
      } else {
        assert.strictEqual(tree.delete(key), oracle.delete(key), `maxKeys=${maxKeys} op=${op}`);
      }
      assert.strictEqual(tree.size, oracle.size, `maxKeys=${maxKeys} op=${op}`);
      checkInvariants(tree);
    }
    assert.deepStrictEqual(tree.range(-1000, 1000), oracle.range(-1000, 1000), `maxKeys=${maxKeys} final range`);
  }
});

// =====================================================================
// Deep ascending and descending inserts (and matching drains)
// =====================================================================

test('deep ascending insert then ascending delete stays valid and empties cleanly', () => {
  const tree = new BPlusTree(4);
  for (let i = 0; i < 1000; i++) tree.set(i, i * 2);
  assert.strictEqual(tree.size, 1000);
  checkInvariants(tree);
  assert.deepStrictEqual(
    tree.range(0, 999).map(([k]) => k),
    Array.from({ length: 1000 }, (_, i) => i)
  );
  for (let i = 0; i < 1000; i++) {
    assert.strictEqual(tree.delete(i), true);
    checkInvariants(tree);
  }
  assert.strictEqual(tree.size, 0);
  assert.strictEqual(tree._root.leaf, true);
});

test('deep descending insert then descending delete stays valid and empties cleanly', () => {
  const tree = new BPlusTree(5);
  for (let i = 999; i >= 0; i--) tree.set(i, i * 3);
  assert.strictEqual(tree.size, 1000);
  checkInvariants(tree);
  assert.deepStrictEqual(
    tree.range(0, 999).map(([k]) => k),
    Array.from({ length: 1000 }, (_, i) => i)
  );
  for (let i = 999; i >= 0; i--) {
    assert.strictEqual(tree.delete(i), true);
    checkInvariants(tree);
  }
  assert.strictEqual(tree.size, 0);
  assert.strictEqual(tree._root.leaf, true);
});

// =====================================================================
// Updates (upsert)
// =====================================================================

test('set() on an existing key updates the value without changing size', () => {
  const tree = new BPlusTree(4);
  tree.set(10, 'first');
  assert.strictEqual(tree.size, 1);
  tree.set(10, 'second');
  assert.strictEqual(tree.size, 1);
  assert.strictEqual(tree.get(10), 'second');
  checkInvariants(tree);
});

test('repeated upserts across many keys never inflate size beyond the unique-key count', () => {
  const tree = new BPlusTree(3);
  for (let round = 0; round < 5; round++) {
    for (let k = 0; k < 30; k++) tree.set(k, `${round}-${k}`);
  }
  assert.strictEqual(tree.size, 30);
  for (let k = 0; k < 30; k++) assert.strictEqual(tree.get(k), `4-${k}`);
  checkInvariants(tree);
});

test('set() returns the tree instance itself (chainable, Map-like)', () => {
  const tree = new BPlusTree(4);
  assert.strictEqual(tree.set(1, 'a'), tree);
  assert.strictEqual(tree.set(1, 'a').set(2, 'b').set(3, 'c'), tree);
  assert.strictEqual(tree.size, 3);
});

// =====================================================================
// Range boundaries
// =====================================================================

test('range() is inclusive of both endpoints exactly', () => {
  const tree = new BPlusTree(4);
  for (const k of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) tree.set(k, `v${k}`);
  assert.deepStrictEqual(
    tree.range(3, 7).map(([k]) => k),
    [3, 4, 5, 6, 7]
  );
  assert.deepStrictEqual(
    tree.range(3, 3).map(([k]) => k),
    [3]
  );
  assert.deepStrictEqual(tree.range(3.0001, 3.9999), []);
});

test('range() with bounds entirely outside the stored keys returns an empty array', () => {
  const tree = new BPlusTree(4);
  for (const k of [10, 20, 30]) tree.set(k, `v${k}`);
  assert.deepStrictEqual(tree.range(-100, -1), []);
  assert.deepStrictEqual(tree.range(1000, 2000), []);
});

test('range() with lo > hi returns an empty array without throwing', () => {
  const tree = new BPlusTree(4);
  tree.set(1, 'a');
  tree.set(2, 'b');
  assert.deepStrictEqual(tree.range(2, 1), []);
  assert.deepStrictEqual(tree.range(100, -100), []);
});

test('range() spans multiple leaves via the linked-leaf chain and returns entries in ascending order', () => {
  const tree = new BPlusTree(3); // small capacity forces many leaves for 60 keys
  const oracle = new SimpleOrderedMap();
  for (let k = -30; k < 30; k++) {
    tree.set(k, `v${k}`);
    oracle.set(k, `v${k}`);
  }
  checkInvariants(tree);
  assert.deepStrictEqual(tree.range(-30, 29), oracle.range(-30, 29));
  assert.deepStrictEqual(tree.range(-5, 5), oracle.range(-5, 5));
  assert.deepStrictEqual(tree.range(29, 29), [[29, 'v29']]);
  assert.deepStrictEqual(tree.range(-30, -30), [[-30, 'v-30']]);
});

// =====================================================================
// Negative and fractional keys
// =====================================================================

test('negative, fractional, and mixed-sign keys are stored and ordered correctly', () => {
  const tree = new BPlusTree(4);
  const oracle = new SimpleOrderedMap();
  const keys = [-5.5, -5, -0.25, 0.25, 1.5, -100.125, 3, -3, 0.1, -0.1];
  for (const k of keys) {
    tree.set(k, `v${k}`);
    oracle.set(k, `v${k}`);
  }
  checkInvariants(tree);
  assert.strictEqual(tree.size, keys.length);
  for (const k of keys) assert.strictEqual(tree.get(k), `v${k}`);
  assert.deepStrictEqual(tree.range(-1000, 1000), oracle.range(-1000, 1000));
  // confirm strictly ascending order in the range output
  const orderedKeys = tree.range(-1000, 1000).map(([k]) => k);
  for (let i = 1; i < orderedKeys.length; i++) assert.ok(orderedKeys[i - 1] < orderedKeys[i]);
});

test('-0 and 0 are treated as the same numeric key (standard JS number equality)', () => {
  const tree = new BPlusTree(4);
  tree.set(-0, 'neg');
  assert.strictEqual(tree.size, 1);
  tree.set(0, 'pos');
  assert.strictEqual(tree.size, 1);
  assert.strictEqual(tree.get(-0), 'pos');
  assert.strictEqual(tree.get(0), 'pos');
  assert.strictEqual(tree.has(-0), true);
  assert.strictEqual(tree.delete(0), true);
  assert.strictEqual(tree.has(-0), false);
});

// =====================================================================
// Invalid inputs
// =====================================================================

test('constructor rejects a non-integer maxKeys with TypeError', () => {
  assert.throws(() => new BPlusTree('4'), TypeError);
  assert.throws(() => new BPlusTree(1.5), TypeError);
  assert.throws(() => new BPlusTree(null), TypeError);
  assert.throws(() => new BPlusTree(NaN), TypeError);
  assert.throws(() => new BPlusTree(Infinity), TypeError);
  assert.throws(() => new BPlusTree({}), TypeError);
});

test('constructor rejects a well-typed but too-small maxKeys with RangeError', () => {
  assert.throws(() => new BPlusTree(1), RangeError);
  assert.throws(() => new BPlusTree(0), RangeError);
  assert.throws(() => new BPlusTree(-5), RangeError);
});

test('constructor accepts maxKeys omitted or explicitly undefined via the default parameter (maxKeys=4)', () => {
  assert.strictEqual(new BPlusTree()._maxKeys, 4);
  assert.strictEqual(new BPlusTree(undefined)._maxKeys, 4);
});

test('constructor accepts every integer maxKeys >= 2', () => {
  for (const n of [2, 3, 4, 5, 10, 100]) {
    assert.strictEqual(new BPlusTree(n)._maxKeys, n);
  }
});

test('get/has/delete/set/range all reject non-finite or non-numeric keys with TypeError', () => {
  const tree = new BPlusTree(4);
  tree.set(1, 'a');
  for (const bad of [NaN, Infinity, -Infinity, '5', null, undefined, {}, [], true, () => {}]) {
    assert.throws(() => tree.get(bad), TypeError, `get(${String(bad)})`);
    assert.throws(() => tree.has(bad), TypeError, `has(${String(bad)})`);
    assert.throws(() => tree.delete(bad), TypeError, `delete(${String(bad)})`);
    assert.throws(() => tree.set(bad, 1), TypeError, `set(${String(bad)}, 1)`);
    assert.throws(() => tree.range(bad, 10), TypeError, `range(${String(bad)}, 10)`);
    assert.throws(() => tree.range(0, bad), TypeError, `range(0, ${String(bad)})`);
  }
  // the tree must be untouched by all the rejected calls above
  assert.strictEqual(tree.size, 1);
  assert.strictEqual(tree.get(1), 'a');
});

// =====================================================================
// Deletions that trigger both borrowing directions, merging, and root
// collapse -- each scenario below was hand-derived and traced
// interactively before being pinned here (see the development notes in
// the README), so the exact intermediate structure asserted is not a
// guess.
// =====================================================================

test('deleting a key forces the underflowing leaf to borrow from its LEFT sibling', () => {
  const tree = new BPlusTree(4); // minKeys = floor(4/2) = 2
  for (const k of [1, 2, 3, 4, 5]) tree.set(k, `v${k}`);
  // after inserting 1..5: root INTERNAL[4] -> LEAF[1,2,3], LEAF[4,5]
  assert.strictEqual(tree._root.leaf, false);
  assert.deepStrictEqual(tree._root.keys, [4]);
  assert.deepStrictEqual(tree._root.children[0].keys, [1, 2, 3]);
  assert.deepStrictEqual(tree._root.children[1].keys, [4, 5]);

  tree.delete(5);
  checkInvariants(tree);
  // right leaf underflowed to [4] (1 key < minKeys 2); its only sibling is
  // the left leaf [1,2,3], which has more than minKeys -- borrow-from-left.
  assert.strictEqual(tree._root.leaf, false, 'root should still be internal after a borrow (no collapse)');
  assert.deepStrictEqual(tree._root.keys, [3], 'separator should become the borrowed leaf\'s new first key');
  assert.deepStrictEqual(tree._root.children[0].keys, [1, 2]);
  assert.deepStrictEqual(tree._root.children[1].keys, [3, 4]);
  assert.strictEqual(tree.size, 4);
  assert.strictEqual(tree.get(3), 'v3');
  assert.strictEqual(tree.get(4), 'v4');
  assert.strictEqual(tree.has(5), false);
});

test('a further deletion merges the two remaining leaves and collapses the root', () => {
  const tree = new BPlusTree(4);
  for (const k of [1, 2, 3, 4, 5]) tree.set(k, `v${k}`);
  tree.delete(5); // borrow-from-left, see the dedicated test above
  tree.delete(4); // both leaves now at exactly minKeys=2; merge is forced
  checkInvariants(tree);
  // right leaf [3,4] loses 4 -> [3] (underflow); left sibling [1,2] has
  // exactly minKeys (2), so it cannot lend -- merge instead. The merge
  // empties the root's only separator, so the merged leaf becomes the new
  // root directly (height decreases by one).
  assert.strictEqual(tree._root.leaf, true, 'root should collapse to a bare leaf');
  assert.deepStrictEqual(tree._root.keys, [1, 2, 3]);
  assert.strictEqual(tree.size, 3);
  assert.deepStrictEqual(
    tree.range(-100, 100).map(([k]) => k),
    [1, 2, 3]
  );
});

test('deleting keys from the LEFTMOST leaf forces it to borrow from its RIGHT sibling', () => {
  const tree = new BPlusTree(4);
  for (const k of [1, 2, 3, 4, 5, 6]) tree.set(k, `v${k}`);
  // after inserting 1..6: root INTERNAL[4] -> LEAF[1,2,3], LEAF[4,5,6]
  assert.deepStrictEqual(tree._root.keys, [4]);
  assert.deepStrictEqual(tree._root.children[0].keys, [1, 2, 3]);
  assert.deepStrictEqual(tree._root.children[1].keys, [4, 5, 6]);

  tree.delete(1);
  checkInvariants(tree);
  assert.deepStrictEqual(tree._root.children[0].keys, [2, 3]); // exactly minKeys, no rebalance yet

  tree.delete(2);
  checkInvariants(tree);
  // left leaf underflowed to [3] (1 key); it is the leftmost child so it
  // has no left sibling at all -- the rebalance must borrow from the right.
  assert.deepStrictEqual(tree._root.keys, [5], 'separator should become the post-borrow right sibling\'s new first key');
  assert.deepStrictEqual(tree._root.children[0].keys, [3, 4]);
  assert.deepStrictEqual(tree._root.children[1].keys, [5, 6]);
  assert.strictEqual(tree.size, 4);
  assert.strictEqual(tree.has(1), false);
  assert.strictEqual(tree.has(2), false);
});

test('deletions propagate rebalancing through an INTERNAL node (not just a leaf), in a deep tree', () => {
  const tree = new BPlusTree(3); // minKeys = 1, order 3 -> reaches height 4 with 40 keys
  for (let i = 1; i <= 40; i++) tree.set(i, `v${i}`);
  checkInvariants(tree);

  function depthOf(node) {
    return node.leaf ? 1 : 1 + depthOf(node.children[0]);
  }
  const before = depthOf(tree._root);

  // Hand-verified sequence (see development notes in the README): deleting
  // 39 forces an INTERNAL-level borrow-from-left (not merely a leaf-level
  // one), and subsequently deleting 35 forces an INTERNAL-level merge.
  for (const k of [37, 38, 39, 40, 35, 36]) {
    tree.delete(k);
    checkInvariants(tree);
  }

  assert.strictEqual(tree.size, 34);
  for (const k of [37, 38, 39, 40, 35, 36]) assert.strictEqual(tree.has(k), false);
  for (let k = 1; k <= 34; k++) assert.strictEqual(tree.get(k), `v${k}`);
  assert.deepStrictEqual(
    tree.range(1, 40).map(([k]) => k),
    Array.from({ length: 34 }, (_, i) => i + 1)
  );
  // the tree should not have grown any taller from these deletions
  assert.ok(depthOf(tree._root) <= before);
});

test('deleting every key one at a time from a large tree always leaves a valid structure, ending in an empty bare-leaf root', () => {
  for (const maxKeys of [2, 3, 6]) {
    const tree = new BPlusTree(maxKeys);
    const n = 200;
    for (let i = 0; i < n; i++) tree.set(i, i);
    // delete in an order that is neither ascending nor descending, to mix
    // borrow-left, borrow-right, and merge across the whole run
    const order = [];
    for (let i = 0; i < n; i++) order.push((i * 37) % n);
    for (const k of order) {
      assert.strictEqual(tree.delete(k), true, `maxKeys=${maxKeys} deleting ${k}`);
      checkInvariants(tree);
    }
    assert.strictEqual(tree.size, 0);
    assert.strictEqual(tree._root.leaf, true, `maxKeys=${maxKeys} root should end as a bare leaf`);
    assert.deepStrictEqual(tree._root.keys, []);
  }
});

// =====================================================================
// Randomized differential sweep against the independent oracle
// =====================================================================

test('randomized fixed-seed differential sweep against SimpleOrderedMap, with structural checks throughout', () => {
  for (const maxKeys of [2, 3, 4, 5, 8]) {
    const rand = mulberry32(20260809 + maxKeys);
    const tree = new BPlusTree(maxKeys);
    const oracle = new SimpleOrderedMap();
    for (let op = 0; op < 400; op++) {
      const key = Number((rand() * 80 - 40).toFixed(2));
      const roll = rand();
      if (roll < 0.5) {
        const v = { op, key };
        tree.set(key, v);
        oracle.set(key, v);
      } else if (roll < 0.8) {
        assert.strictEqual(tree.delete(key), oracle.delete(key), `maxKeys=${maxKeys} op=${op} delete(${key})`);
      } else {
        assert.deepStrictEqual(tree.get(key), oracle.get(key), `maxKeys=${maxKeys} op=${op} get(${key})`);
        assert.strictEqual(tree.has(key), oracle.has(key), `maxKeys=${maxKeys} op=${op} has(${key})`);
      }
      assert.strictEqual(tree.size, oracle.size, `maxKeys=${maxKeys} op=${op} size`);
      if (op % 23 === 0) checkInvariants(tree);
      if (op % 41 === 0) {
        const lo = Number((rand() * 90 - 45).toFixed(2));
        const hi = lo + Math.floor(rand() * 30);
        assert.deepStrictEqual(tree.range(lo, hi), oracle.range(lo, hi), `maxKeys=${maxKeys} op=${op} range`);
      }
    }
    checkInvariants(tree);
    assert.deepStrictEqual(tree.range(-1000, 1000), oracle.range(-1000, 1000), `maxKeys=${maxKeys} final full range`);
  }
});

void dump; // debug helper retained for interactive re-verification, not exercised by any assertion
