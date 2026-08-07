'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { OrderStatisticMultiset } = require('./order-statistic-multiset.js');

// Recursively verifies BST ordering, AVL height-balance, and the
// height/size bookkeeping on every node of a multiset's internal tree.
// `_root` is a conventionally-private field (not a documented public
// API), but reading it directly in tests lets us assert the actual
// invariants a correct AVL implementation must maintain -- catching a
// broken rotation even in cases where rank()/select()/count() might
// happen to still return the right answer.
function checkInvariant(node) {
  if (node === null) return { height: 0, size: 0 };
  const l = checkInvariant(node.left);
  const r = checkInvariant(node.right);
  assert.equal(node.height, 1 + Math.max(l.height, r.height), `height bookkeeping wrong at node ${node.value}`);
  assert.equal(node.size, node.dup + l.size + r.size, `size bookkeeping wrong at node ${node.value}`);
  assert.ok(Math.abs(l.height - r.height) <= 1, `AVL balance violated at node ${node.value} (left height ${l.height}, right height ${r.height})`);
  if (node.left !== null) assert.ok(node.left.value < node.value, `BST property violated on the left of ${node.value}`);
  if (node.right !== null) assert.ok(node.right.value > node.value, `BST property violated on the right of ${node.value}`);
  assert.ok(node.dup >= 1, `dup count must stay >= 1 for a live node, got ${node.dup} at ${node.value}`);
  return { height: node.height, size: node.size };
}

function checkTree(multiset) {
  checkInvariant(multiset._root);
}

test('empty multiset: size 0, count/rank are 0, delete returns false, select throws', () => {
  const m = new OrderStatisticMultiset();
  assert.equal(m.size, 0);
  assert.equal(m.count(5), 0);
  assert.equal(m.rank(5), 0);
  assert.equal(m.delete(5), false);
  assert.throws(() => m.select(0), RangeError);
  checkTree(m);
});

test('add() rejects non-finite or non-number values with TypeError', () => {
  const m = new OrderStatisticMultiset();
  assert.throws(() => m.add(NaN), TypeError);
  assert.throws(() => m.add(Infinity), TypeError);
  assert.throws(() => m.add(-Infinity), TypeError);
  assert.throws(() => m.add('5'), TypeError);
  assert.throws(() => m.add(null), TypeError);
  assert.throws(() => m.add(undefined), TypeError);
  assert.throws(() => m.add([5]), TypeError);
});

test('delete()/count()/rank() also reject non-finite or non-number values with TypeError', () => {
  const m = new OrderStatisticMultiset();
  m.add(1);
  assert.throws(() => m.delete(NaN), TypeError);
  assert.throws(() => m.delete('1'), TypeError);
  assert.throws(() => m.count(Infinity), TypeError);
  assert.throws(() => m.count(null), TypeError);
  assert.throws(() => m.rank(NaN), TypeError);
  assert.throws(() => m.rank(undefined), TypeError);
});

test('select() throws RangeError for a non-integer or out-of-bounds index', () => {
  const m = new OrderStatisticMultiset();
  [1, 2, 3].forEach((v) => m.add(v));
  assert.throws(() => m.select(-1), RangeError);
  assert.throws(() => m.select(1.5), RangeError);
  assert.throws(() => m.select(m.size), RangeError); // one past the end
  assert.throws(() => m.select(NaN), RangeError);
  assert.throws(() => m.select('0'), RangeError);
  // valid indices still work after the above throws (no state corruption)
  assert.equal(m.select(0), 1);
  assert.equal(m.select(2), 3);
});

test('duplicates: add() the same value multiple times increments count and size without adding extra tree nodes', () => {
  const m = new OrderStatisticMultiset();
  m.add(5);
  m.add(5);
  m.add(5);
  assert.equal(m.count(5), 3);
  assert.equal(m.size, 3);
  assert.equal(m.rank(5), 0); // nothing strictly less than 5
  assert.equal(m.rank(6), 3); // all 3 copies are strictly less than 6
  assert.equal(m.select(0), 5);
  assert.equal(m.select(1), 5);
  assert.equal(m.select(2), 5);
  checkTree(m);
});

test('delete() decrements duplicate count before removing the node entirely, and returns true/false correctly', () => {
  const m = new OrderStatisticMultiset();
  m.add(5);
  m.add(5);
  m.add(5);
  assert.equal(m.delete(5), true);
  assert.equal(m.count(5), 2);
  assert.equal(m.size, 2);
  assert.equal(m.delete(5), true);
  assert.equal(m.count(5), 1);
  assert.equal(m.delete(5), true);
  assert.equal(m.count(5), 0);
  assert.equal(m.size, 0);
  assert.equal(m.delete(5), false); // now absent -- must return false, not throw
  checkTree(m);
});

test('all four AVL rotation patterns produce a correctly balanced, correctly ordered 3-node tree', () => {
  // For any insertion order of {1, 2, 3}, the only valid AVL-balanced
  // shape is 2 as root with 1 and 3 as children -- so asserting the
  // resulting root/children after each order directly confirms the
  // corresponding rotation fired correctly.
  const cases = [
    { label: 'RR (single left rotation)', order: [1, 2, 3] },
    { label: 'LL (single right rotation)', order: [3, 2, 1] },
    { label: 'LR (left rotation then right rotation)', order: [3, 1, 2] },
    { label: 'RL (right rotation then left rotation)', order: [1, 3, 2] },
  ];
  for (const { label, order } of cases) {
    const m = new OrderStatisticMultiset();
    order.forEach((v) => m.add(v));
    assert.equal(m._root.value, 2, `${label}: expected root 2 for insertion order ${order}`);
    assert.equal(m._root.left.value, 1, `${label}: expected left child 1`);
    assert.equal(m._root.right.value, 3, `${label}: expected right child 3`);
    assert.equal(m._root.height, 2, `${label}: expected a balanced height of 2`);
    checkTree(m);
    // Behavioral cross-check too, not just structural.
    assert.deepEqual([m.select(0), m.select(1), m.select(2)], [1, 2, 3], `${label}: select() order wrong`);
  }
});

test('leaf deletion removes the node directly and rebalances correctly', () => {
  const m = new OrderStatisticMultiset();
  [5, 3, 8].forEach((v) => m.add(v));
  assert.equal(m._root.left.value, 3); // 3 is currently a leaf
  assert.equal(m.delete(3), true);
  assert.equal(m.count(3), 0);
  assert.equal(m.size, 2);
  checkTree(m);
});

test('two-child deletion (including deleting the root) replaces the value via the in-order successor and rebalances', () => {
  const m = new OrderStatisticMultiset();
  [5, 3, 8, 1, 4, 7, 9].forEach((v) => m.add(v));
  assert.equal(m._root.value, 5);
  assert.equal(m._root.left !== null && m._root.right !== null, true); // root has two children
  assert.equal(m.delete(5), true);
  assert.equal(m.count(5), 0);
  assert.equal(m.size, 6);
  assert.deepEqual(
    Array.from({ length: m.size }, (_, i) => m.select(i)),
    [1, 3, 4, 7, 8, 9]
  );
  checkTree(m);
});

test('rank() and select() are consistent inverses, and select() correctly spans duplicate runs', () => {
  const m = new OrderStatisticMultiset();
  const values = [5, 3, 8, 3, 1, 5, 9, 3, 7];
  values.forEach((v) => m.add(v));
  const sorted = [...values].sort((a, b) => a - b);
  assert.deepEqual(
    Array.from({ length: m.size }, (_, i) => m.select(i)),
    sorted
  );
  for (const v of new Set(values)) {
    assert.equal(m.rank(v), sorted.filter((x) => x < v).length, `rank(${v}) mismatch`);
  }
  // rank() also works for values never inserted.
  assert.equal(m.rank(0), 0);
  assert.equal(m.rank(100), sorted.length);
  assert.equal(m.rank(4), sorted.filter((x) => x < 4).length);
  checkTree(m);
});

test('deterministic mixed-operation sequence matches a sorted-array reference implementation', () => {
  // Reference model: a plain sorted array, using splice-based insertion
  // and single-element removal -- an obviously-correct O(n) multiset,
  // structurally unrelated to the AVL-tree-with-duplicate-counts
  // approach under test.
  class RefMultiset {
    constructor() {
      this.arr = [];
    }
    add(v) {
      let lo = 0;
      let hi = this.arr.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (this.arr[mid] < v) lo = mid + 1;
        else hi = mid;
      }
      this.arr.splice(lo, 0, v);
    }
    delete(v) {
      const idx = this.arr.indexOf(v);
      if (idx === -1) return false;
      this.arr.splice(idx, 1);
      return true;
    }
    count(v) {
      return this.arr.filter((x) => x === v).length;
    }
    rank(v) {
      return this.arr.filter((x) => x < v).length;
    }
    select(i) {
      return this.arr[i];
    }
    get size() {
      return this.arr.length;
    }
  }

  const ops = [
    ['add', 10], ['add', 5], ['add', 15], ['add', 5], ['add', 3], ['add', 20],
    ['add', 5], ['delete', 15], ['add', 12], ['add', 1], ['delete', 5],
    ['add', 30], ['add', 3], ['delete', 100], ['add', 8], ['delete', 20],
    ['add', 5], ['add', 5], ['delete', 3], ['delete', 3], ['add', 25],
    ['add', 0], ['add', -5], ['delete', 10], ['add', 18], ['add', 9],
    ['delete', 1], ['add', 40], ['add', 40], ['delete', 40], ['add', 22],
  ];

  const m = new OrderStatisticMultiset();
  const ref = new RefMultiset();

  for (const [kind, value] of ops) {
    if (kind === 'add') {
      m.add(value);
      ref.add(value);
    } else {
      const a = m.delete(value);
      const b = ref.delete(value);
      assert.equal(a, b, `delete(${value}) return-value mismatch`);
    }
    assert.equal(m.size, ref.size, `size mismatch after ${kind}(${value})`);
    checkTree(m);
  }

  // Full-state cross-check after all operations.
  assert.equal(m.size, ref.size);
  for (let i = 0; i < ref.size; i++) {
    assert.equal(m.select(i), ref.select(i), `select(${i}) mismatch`);
  }
  const distinctValues = [...new Set(ref.arr)];
  for (const v of distinctValues) {
    assert.equal(m.count(v), ref.count(v), `count(${v}) mismatch`);
    assert.equal(m.rank(v), ref.rank(v), `rank(${v}) mismatch`);
  }
  // A handful of never-inserted probe values too.
  for (const v of [-100, -6, 0.5, 50, 1000]) {
    assert.equal(m.rank(v), ref.rank(v), `rank(${v}) mismatch for an absent probe value`);
  }
});

test('size getter reflects insertions, duplicate increments, and deletions accurately throughout', () => {
  const m = new OrderStatisticMultiset();
  assert.equal(m.size, 0);
  m.add(1);
  assert.equal(m.size, 1);
  m.add(1);
  assert.equal(m.size, 2); // duplicate, still +1 to size
  m.add(2);
  assert.equal(m.size, 3);
  m.delete(1);
  assert.equal(m.size, 2);
  m.delete(1);
  assert.equal(m.size, 1);
  m.delete(2);
  assert.equal(m.size, 0);
  checkTree(m);
});
