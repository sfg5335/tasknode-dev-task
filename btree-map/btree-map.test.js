'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { BTreeMap } = require('./btree-map.js');

// ---- Internal structural-invariant checker -------------------------------
//
// Walks the tree's private fields directly to verify, independently of the
// implementation's own logic, that every B-tree property holds:
//   1. Every non-root node has between t-1 and 2t-1 keys (root may have
//      between 0 and 2t-1; 0 only if it is also a leaf, i.e. an empty tree).
//   2. Every internal node has exactly keys.length + 1 children.
//   3. Keys within a node are strictly ascending, and every node's key
//      range is consistent with its position between its parent's
//      separator keys (a B-tree is a generalized BST).
//   4. Every leaf is at the same depth.
//   5. The tree's `_size` equals an independently-counted total key count.
function checkInvariant(bt) {
  const t = bt.t;
  const maxKeys = 2 * t - 1;
  let leafDepth = null;
  let count = 0;

  const visit = (node, isRoot, depth, lowerBound, upperBound) => {
    if (isRoot) {
      assert.ok(node.keys.length <= maxKeys, 'root exceeds max key count');
      if (node.keys.length === 0) assert.equal(node.leaf, true, 'root with 0 keys must be a leaf');
    } else {
      assert.ok(
        node.keys.length >= t - 1 && node.keys.length <= maxKeys,
        `non-root node key count out of bounds: ${node.keys.length}`
      );
    }
    for (let i = 0; i < node.keys.length; i++) {
      if (i > 0) assert.ok(node.keys[i] > node.keys[i - 1], 'keys not strictly ascending within a node');
      if (lowerBound !== null) assert.ok(node.keys[i] > lowerBound, 'key violates inherited lower bound');
      if (upperBound !== null) assert.ok(node.keys[i] < upperBound, 'key violates inherited upper bound');
    }
    count += node.keys.length;

    if (node.leaf) {
      assert.equal(node.children.length, 0, 'leaf must have no children');
      if (leafDepth === null) leafDepth = depth;
      else assert.equal(depth, leafDepth, 'not all leaves are at the same depth');
    } else {
      assert.equal(node.children.length, node.keys.length + 1, 'children.length must be keys.length + 1');
      for (let i = 0; i < node.children.length; i++) {
        const lb = i === 0 ? lowerBound : node.keys[i - 1];
        const ub = i === node.children.length - 1 ? upperBound : node.keys[i];
        visit(node.children[i], false, depth + 1, lb, ub);
      }
    }
  };

  visit(bt.root, true, 0, null, null);
  assert.equal(count, bt.size, 'bt.size must match an independently-counted key total');
}

// ---------------------------------------------------------------------------

test('empty tree: size 0, get/has/delete report absence, entries() is empty', () => {
  const bt = new BTreeMap();
  assert.equal(bt.size, 0);
  assert.equal(bt.get(1), undefined);
  assert.equal(bt.has(1), false);
  assert.equal(bt.delete(1), false);
  assert.deepEqual(bt.entries(), []);
  assert.equal(bt.root.leaf, true);
  checkInvariant(bt);
});

test('set() returns `this`, enabling chaining; basic get/has round-trip', () => {
  const bt = new BTreeMap();
  const result = bt.set(1, 'a').set(2, 'b').set(3, 'c');
  assert.equal(result, bt);
  assert.equal(bt.get(1), 'a');
  assert.equal(bt.get(2), 'b');
  assert.equal(bt.get(3), 'c');
  assert.equal(bt.has(1), true);
  assert.equal(bt.has(99), false);
  assert.equal(bt.size, 3);
  checkInvariant(bt);
});

test('overwriting an existing key updates the value without changing size', () => {
  const bt = new BTreeMap();
  bt.set(5, 'first');
  assert.equal(bt.size, 1);
  bt.set(5, 'second');
  assert.equal(bt.size, 1);
  assert.equal(bt.get(5), 'second');
  checkInvariant(bt);
});

test('negative and fractional keys are stored and ordered correctly', () => {
  const bt = new BTreeMap();
  [3.5, -2.25, 0.1, -10, 7, -0.5].forEach((k) => bt.set(k, `v${k}`));
  assert.deepEqual(
    bt.entries().map(([k]) => k),
    [-10, -2.25, -0.5, 0.1, 3.5, 7]
  );
  assert.equal(bt.get(-2.25), 'v-2.25');
  assert.equal(bt.get(0.1), 'v0.1');
  checkInvariant(bt);
});

test('-0 and 0 are treated as the same key (matching === / Map SameValueZero semantics)', () => {
  const bt = new BTreeMap();
  bt.set(-0, 'neg-zero-value');
  assert.equal(bt.get(0), 'neg-zero-value');
  assert.equal(bt.has(0), true);
  assert.equal(bt.size, 1);

  bt.set(0, 'overwritten-via-positive-zero');
  assert.equal(bt.size, 1); // still the same single key
  assert.equal(bt.get(-0), 'overwritten-via-positive-zero');

  assert.equal(bt.delete(-0), true);
  assert.equal(bt.size, 0);
  assert.equal(bt.has(0), false);
  checkInvariant(bt);
});

test('set/get/has/delete all reject non-finite or non-numeric keys with TypeError', () => {
  const bt = new BTreeMap();
  bt.set(1, 'seed');
  const badKeys = [NaN, Infinity, -Infinity, '5', null, undefined, {}, [], true, Symbol('x')];
  for (const bad of badKeys) {
    assert.throws(() => bt.set(bad, 'x'), TypeError, `set(${String(bad)})`);
    assert.throws(() => bt.get(bad), TypeError, `get(${String(bad)})`);
    assert.throws(() => bt.has(bad), TypeError, `has(${String(bad)})`);
    assert.throws(() => bt.delete(bad), TypeError, `delete(${String(bad)})`);
  }
  // Rejected calls must not have mutated the tree.
  assert.equal(bt.size, 1);
  assert.equal(bt.get(1), 'seed');
  checkInvariant(bt);
});

test('delete() returns false for absent keys without affecting size or other keys', () => {
  const bt = new BTreeMap();
  bt.set(1, 'a');
  bt.set(2, 'b');
  assert.equal(bt.delete(99), false);
  assert.equal(bt.size, 2);
  assert.equal(bt.get(1), 'a');
  assert.equal(bt.get(2), 'b');
  checkInvariant(bt);
});

test('repeated deletion: deleting the same key twice returns true then false, and every key can be removed in sequence', () => {
  const bt = new BTreeMap();
  const keys = [10, 20, 30, 40, 50, 60, 70];
  keys.forEach((k) => bt.set(k, `v${k}`));

  assert.equal(bt.delete(40), true);
  assert.equal(bt.delete(40), false); // already gone
  checkInvariant(bt);

  for (const k of keys) {
    if (k === 40) continue;
    assert.equal(bt.delete(k), true, `expected delete(${k}) to succeed`);
    checkInvariant(bt); // structural invariant re-checked after every single deletion
  }
  assert.equal(bt.size, 0);
  assert.equal(bt.root.leaf, true);
  assert.deepEqual(bt.entries(), []);
});

// ---- Structural transitions ------------------------------------------------
// Each of these was traced against the actual implementation before being
// committed here, and is additionally checked structurally (not just
// behaviorally) so a regression that produced the right *values* but the
// wrong *shape* would still be caught.

test('structural: inserting the 4th key into a 3-key leaf root triggers a root split', () => {
  const bt = new BTreeMap();
  bt.set(1, 'a').set(2, 'b').set(3, 'c');
  assert.equal(bt.root.leaf, true);
  assert.deepEqual(bt.root.keys, [1, 2, 3]);
  checkInvariant(bt);

  bt.set(4, 'd');
  assert.equal(bt.root.leaf, false, 'root must have split into an internal node');
  assert.equal(bt.root.keys.length, 1, 'split root promotes exactly one median key');
  assert.equal(bt.root.children.length, 2);
  checkInvariant(bt);

  // Values must all still be correct after the split.
  for (const [k, v] of [[1, 'a'], [2, 'b'], [3, 'c'], [4, 'd']]) {
    assert.equal(bt.get(k), v);
  }
});

test('structural: deleting from an underfull leaf borrows from a right sibling with spare keys', () => {
  const bt = new BTreeMap();
  [1, 2, 3, 4].forEach((k) => bt.set(k, `v${k}`));
  // Known shape at this point: root [2], children leaf[1], leaf[3,4].
  assert.deepEqual(bt.root.keys, [2]);
  assert.deepEqual(bt.root.children[0].keys, [1]);
  assert.deepEqual(bt.root.children[1].keys, [3, 4]);

  bt.delete(1);
  checkInvariant(bt);
  // The right sibling's smallest key (3) must have rotated up through the
  // separator, and the old separator (2) must have rotated down.
  assert.deepEqual(bt.root.keys, [3]);
  assert.deepEqual(bt.root.children[0].keys, [2]);
  assert.deepEqual(bt.root.children[1].keys, [4]);
  assert.equal(bt.size, 3);
  assert.deepEqual(bt.entries().map(([k]) => k), [2, 3, 4]);
});

test('structural: deleting from an underfull leaf borrows from a left sibling with spare keys', () => {
  const bt = new BTreeMap();
  [10, 20, 30, 40, 5].forEach((k) => bt.set(k, `v${k}`));
  // Known shape: root [20], children leaf[5,10], leaf[30,40].
  assert.deepEqual(bt.root.keys, [20]);
  assert.deepEqual(bt.root.children[0].keys, [5, 10]);
  assert.deepEqual(bt.root.children[1].keys, [30, 40]);

  bt.delete(30); // right leaf: [40], still >= t-1, no fix needed yet
  checkInvariant(bt);
  bt.delete(40); // right leaf now empty; left sibling has 2 keys -> borrow left
  checkInvariant(bt);

  assert.deepEqual(bt.root.keys, [10]);
  assert.deepEqual(bt.root.children[0].keys, [5]);
  assert.deepEqual(bt.root.children[1].keys, [20]);
  assert.equal(bt.size, 3);
  assert.deepEqual(bt.entries().map(([k]) => k), [5, 10, 20]);
});

test('structural: deleting from two underfull leaf siblings with no spare keys merges them', () => {
  const bt = new BTreeMap();
  [1, 2, 3, 4, 5, 6].forEach((k) => bt.set(k, `v${k}`));
  // Known shape: root [2,4], children leaf[1], leaf[3], leaf[5,6].
  assert.deepEqual(bt.root.keys, [2, 4]);
  assert.deepEqual(bt.root.children.map((c) => c.keys), [[1], [3], [5, 6]]);

  bt.delete(1); // left leaf empties; right sibling leaf[3] also has only 1 key -> merge
  checkInvariant(bt);

  assert.deepEqual(bt.root.keys, [4], 'the separator (2) must have been absorbed into the merge');
  assert.equal(bt.root.children.length, 2);
  assert.deepEqual(bt.root.children[0].keys, [2, 3], 'merged node holds the old separator plus both leaves\' keys');
  assert.deepEqual(bt.root.children[1].keys, [5, 6]);
  assert.equal(bt.size, 5);
  assert.deepEqual(bt.entries().map(([k]) => k), [2, 3, 4, 5, 6]);
});

test('structural: merging the last two children of a 1-key root contracts the root back to a leaf', () => {
  const bt = new BTreeMap();
  [1, 2, 3, 4].forEach((k) => bt.set(k, `v${k}`));
  assert.equal(bt.root.leaf, false);

  bt.delete(4); // right leaf: [3], no fix needed
  checkInvariant(bt);
  bt.delete(3); // right leaf empties; left sibling leaf[1] also minimal -> merge -> root has 0 keys -> contract
  checkInvariant(bt);

  assert.equal(bt.root.leaf, true, 'root must have contracted back to a single leaf');
  assert.deepEqual(bt.root.keys, [1, 2]);
  assert.equal(bt.root.children.length, 0);
  assert.equal(bt.size, 2);
  assert.deepEqual(bt.entries(), [[1, 'v1'], [2, 'v2']]);
});

test('structural: deleting a key stored in an internal (non-leaf) node uses predecessor/successor replacement', () => {
  const bt = new BTreeMap();
  for (let i = 1; i <= 20; i++) bt.set(i, `v${i}`);
  checkInvariant(bt);
  // Traced independently: after inserting 1..20 in order, key 8 is stored
  // as a separator in an internal node (bt.root.keys === [8]), not in a leaf.
  assert.deepEqual(bt.root.keys, [8]);
  assert.equal(bt.root.leaf, false);

  assert.equal(bt.delete(8), true);
  checkInvariant(bt);
  assert.equal(bt.has(8), false);
  assert.equal(bt.size, 19);

  const expected = [];
  for (let i = 1; i <= 20; i++) if (i !== 8) expected.push(i);
  assert.deepEqual(bt.entries().map(([k]) => k), expected);
  for (const k of expected) assert.equal(bt.get(k), `v${k}`);
});

// ---- Fixed-seed differential cross-check against a `Map` reference model --
//
// A plain Map<number, value> is an obviously-correct reference for
// set/get/has/delete/entries semantics -- structurally unrelated to the
// B-tree splitting/merging logic under test. Map's own key equality
// (SameValueZero) already treats -0 and 0 as the same key, matching this
// task's spec, so no special-casing is needed in the reference model.

function makeRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

test('fixed-seed differential cross-check: 4000 random set/get/has/delete ops match a Map reference model', () => {
  const rng = makeRng(20260807);
  const keyPool = [];
  for (let i = 0; i < 60; i++) {
    // A mix of integers, negatives, fractions, and a couple of explicit
    // zero-sign variants, biased toward a small range so keys collide and
    // get overwritten/deleted/re-inserted often (exercises more structural
    // transitions than a huge sparse key space would).
    const kind = Math.floor(rng() * 4);
    if (kind === 0) keyPool.push(Math.floor(rng() * 40) - 20);
    else if (kind === 1) keyPool.push(rng() * 40 - 20);
    else if (kind === 2) keyPool.push(-0);
    else keyPool.push(0);
  }

  const bt = new BTreeMap();
  const ref = new Map();

  for (let op = 0; op < 4000; op++) {
    const key = keyPool[Math.floor(rng() * keyPool.length)];
    const roll = rng();

    if (roll < 0.5) {
      const value = Math.floor(rng() * 1e6);
      bt.set(key, value);
      ref.set(key, value);
      assert.equal(bt.get(key), ref.get(key), `set/get mismatch for ${key}`);
    } else if (roll < 0.75) {
      const a = bt.delete(key);
      const b = ref.delete(key);
      assert.equal(a, b, `delete() return-value mismatch for ${key}`);
    } else {
      assert.equal(bt.has(key), ref.has(key), `has mismatch for ${key}`);
      assert.equal(bt.get(key), ref.get(key), `get mismatch for ${key}`);
    }

    assert.equal(bt.size, ref.size, `size mismatch after op ${op}`);
    if (op % 25 === 0) checkInvariant(bt); // periodic structural check keeps the loop fast
  }

  checkInvariant(bt);

  // Full-state cross-check after all 4000 ops, including ascending order.
  assert.equal(bt.size, ref.size);
  const expectedEntries = [...ref.entries()].sort((a, b) => a[0] - b[0]);
  assert.deepEqual(bt.entries(), expectedEntries);
});
