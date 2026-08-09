'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ScapegoatTree } = require('./scapegoat-tree.js');

const ALPHA = 2 / 3;

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

// ---------------------------------------------------------------------------
// Structural whitebox helpers (walk the tree's public `.root`/Node fields
// directly -- these are not encapsulated behind private (#) fields, so
// tests can inspect them for the structural claims the task's verification
// section calls out: subtree rebuilding and whole-tree rebuilding).
// ---------------------------------------------------------------------------

function computedSize(node) {
  if (node === null) return 0;
  return 1 + computedSize(node.left) + computedSize(node.right);
}

// Every node's `.size` field must equal 1 + size(left) + size(right).
function checkSizeInvariant(node) {
  if (node === null) return true;
  if (node.size !== 1 + computedSize(node.left) + computedSize(node.right)) return false;
  return checkSizeInvariant(node.left) && checkSizeInvariant(node.right);
}

// In-order key sequence must be strictly ascending (valid BST ordering).
function checkBstOrder(node, out) {
  if (node === null) return out;
  checkBstOrder(node.left, out);
  out.push(node.key);
  checkBstOrder(node.right, out);
  return out;
}

function isStrictlyAscending(arr) {
  for (let i = 1; i < arr.length; i++) {
    if (!(arr[i - 1] < arr[i])) return false;
  }
  return true;
}

// alpha-weight-balance at every node: size(child) <= alpha * size(node).
function checkFullyAlphaBalanced(node) {
  if (node === null) return true;
  const leftSize = node.left ? node.left.size : 0;
  const rightSize = node.right ? node.right.size : 0;
  const eps = 1e-9;
  if (leftSize > ALPHA * node.size + eps) return false;
  if (rightSize > ALPHA * node.size + eps) return false;
  return checkFullyAlphaBalanced(node.left) && checkFullyAlphaBalanced(node.right);
}

function idealHeightBound(n) {
  if (n <= 1) return 0;
  return Math.log(n) / Math.log(1 / ALPHA);
}

// -----------------------------------------------------------------------
// A minimal, independently-written sorted-array reference "oracle" used
// for the fixed-seed mixed-operations differential test. Deliberately
// structured completely differently from the tree (linear scan / splice
// on a plain array) so it can't share a bug with the implementation.
// -----------------------------------------------------------------------

class SortedArrayOracle {
  constructor() {
    this.entries = []; // array of [key, value], kept sorted by key ascending
  }

  _findIndex(key) {
    // Returns { index, found }: index is the insertion point (first index
    // whose key is >= `key`) via linear scan (deliberately not binary
    // search, to keep this oracle maximally simple/trustworthy).
    for (let i = 0; i < this.entries.length; i++) {
      if (this.entries[i][0] === key) return { index: i, found: true };
      if (this.entries[i][0] > key) return { index: i, found: false };
    }
    return { index: this.entries.length, found: false };
  }

  set(key, value) {
    const { index, found } = this._findIndex(key);
    if (found) {
      this.entries[index][1] = value;
    } else {
      this.entries.splice(index, 0, [key, value]);
    }
  }

  get(key) {
    const { index, found } = this._findIndex(key);
    return found ? this.entries[index][1] : undefined;
  }

  has(key) {
    return this._findIndex(key).found;
  }

  delete(key) {
    const { index, found } = this._findIndex(key);
    if (!found) return false;
    this.entries.splice(index, 1);
    return true;
  }

  rank(key) {
    const { index } = this._findIndex(key);
    return index;
  }

  select(k) {
    if (k < 0 || k >= this.entries.length) throw new RangeError('index out of range');
    return [this.entries[k][0], this.entries[k][1]];
  }

  range(lo, hi) {
    return this.entries.filter((e) => e[0] >= lo && e[0] <= hi).map((e) => [e[0], e[1]]);
  }

  toArray() {
    return this.entries.map((e) => [e[0], e[1]]);
  }

  size() {
    return this.entries.length;
  }
}

// =========================================================================
// Empty state
// =========================================================================

test('empty tree: size, height, and every query method behave correctly', () => {
  const t = new ScapegoatTree();
  assert.equal(t.size(), 0);
  assert.equal(t.height(), -1);
  assert.equal(t.get(5), undefined);
  assert.equal(t.has(5), false);
  assert.equal(t.rank(5), 0);
  assert.deepEqual(t.range(-10, 10), []);
  assert.deepEqual(t.toArray(), []);
  assert.equal(t.delete(5), false);
  assert.throws(() => t.select(0), RangeError);
});

// =========================================================================
// Replacements
// =========================================================================

test('set on an existing key replaces the value without changing size or structure', () => {
  const t = new ScapegoatTree();
  t.set(1, 'a');
  t.set(2, 'b');
  t.set(3, 'c');
  const rootBefore = t.root;
  const sizeBefore = t.size();
  t.set(2, 'B-updated');
  assert.equal(t.size(), sizeBefore);
  assert.equal(t.root, rootBefore, 'replacing a value must not restructure the tree');
  assert.equal(t.get(2), 'B-updated');
  assert.equal(t.get(1), 'a');
  assert.equal(t.get(3), 'c');
});

test('set can replace a value with undefined, and has() still reports true', () => {
  const t = new ScapegoatTree();
  t.set(1, 'a');
  t.set(1, undefined);
  assert.equal(t.has(1), true);
  assert.equal(t.get(1), undefined);
  assert.equal(t.size(), 1);
});

test('repeated replacement of the same key never grows size', () => {
  const t = new ScapegoatTree();
  for (let i = 0; i < 50; i++) t.set(7, `v${i}`);
  assert.equal(t.size(), 1);
  assert.equal(t.get(7), 'v49');
});

// =========================================================================
// Sorted and reverse insertions
// =========================================================================

test('ascending insertion of 0..N-1 keeps height well below the unbalanced N-1 worst case', () => {
  const t = new ScapegoatTree();
  const n = 500;
  for (let i = 0; i < n; i++) t.set(i, i * 10);
  assert.equal(t.size(), n);
  // An unbalanced right-chain BST built purely by ascending insertion would
  // have height n-1 = 499. The scapegoat mechanism must keep it far below
  // that -- generously bounded here at 3x the ideal log bound plus a
  // constant, to avoid a flaky test while still being a meaningful check.
  const bound = 3 * idealHeightBound(n) + 5;
  assert.ok(t.height() <= bound, `height ${t.height()} exceeds generous bound ${bound}`);
  assert.deepEqual(
    t.toArray().map((e) => e[0]),
    Array.from({ length: n }, (_, i) => i)
  );
});

test('descending insertion of N-1..0 keeps height well below the unbalanced N-1 worst case', () => {
  const t = new ScapegoatTree();
  const n = 500;
  for (let i = n - 1; i >= 0; i--) t.set(i, i * 10);
  assert.equal(t.size(), n);
  const bound = 3 * idealHeightBound(n) + 5;
  assert.ok(t.height() <= bound, `height ${t.height()} exceeds generous bound ${bound}`);
  assert.deepEqual(
    t.toArray().map((e) => e[0]),
    Array.from({ length: n }, (_, i) => i)
  );
});

// =========================================================================
// Every query method (small, hand-checkable trees)
// =========================================================================

test('get/has/size on a small fixed tree', () => {
  const t = new ScapegoatTree();
  const pairs = [[5, 'five'], [3, 'three'], [8, 'eight'], [1, 'one'], [4, 'four']];
  for (const [k, v] of pairs) t.set(k, v);
  assert.equal(t.size(), 5);
  for (const [k, v] of pairs) {
    assert.equal(t.has(k), true);
    assert.equal(t.get(k), v);
  }
  assert.equal(t.has(100), false);
  assert.equal(t.get(100), undefined);
  assert.equal(t.has(-1), false);
});

test('rank returns the count of keys strictly less than the queried key', () => {
  const t = new ScapegoatTree();
  for (const k of [10, 20, 30, 40, 50]) t.set(k, k);
  assert.equal(t.rank(5), 0);
  assert.equal(t.rank(10), 0);
  assert.equal(t.rank(15), 1);
  assert.equal(t.rank(30), 2);
  assert.equal(t.rank(50), 4);
  assert.equal(t.rank(1000), 5);
  assert.equal(t.rank(-1000), 0);
});

test('select returns the [key, value] pair at each ascending index', () => {
  const t = new ScapegoatTree();
  const pairs = [[10, 'a'], [40, 'd'], [20, 'b'], [50, 'e'], [30, 'c']];
  for (const [k, v] of pairs) t.set(k, v);
  const expected = [[10, 'a'], [20, 'b'], [30, 'c'], [40, 'd'], [50, 'e']];
  for (let i = 0; i < expected.length; i++) {
    assert.deepEqual(t.select(i), expected[i]);
  }
});

test('select throws RangeError for out-of-bounds indices, including on an empty tree', () => {
  const t = new ScapegoatTree();
  assert.throws(() => t.select(0), RangeError);
  t.set(1, 'a');
  t.set(2, 'b');
  assert.deepEqual(t.select(0), [1, 'a']);
  assert.deepEqual(t.select(1), [2, 'b']);
  assert.throws(() => t.select(2), RangeError);
  assert.throws(() => t.select(-1), TypeError);
});

test('rank and select are inverses of each other across a populated tree', () => {
  const t = new ScapegoatTree();
  const keys = [3, 1, 4, 1.5, 5, 9, 2, 6, -5, 0];
  const uniqueSorted = [...new Set(keys)].sort((a, b) => a - b);
  for (const k of keys) t.set(k, `v${k}`);
  for (let i = 0; i < uniqueSorted.length; i++) {
    const k = uniqueSorted[i];
    assert.equal(t.rank(k), i);
    assert.deepEqual(t.select(i), [k, `v${k}`]);
  }
});

test('range returns every entry within [lo, hi] inclusive, in ascending order', () => {
  const t = new ScapegoatTree();
  for (const k of [1, 3, 5, 7, 9, 11]) t.set(k, `v${k}`);
  assert.deepEqual(t.range(3, 9), [[3, 'v3'], [5, 'v5'], [7, 'v7'], [9, 'v9']]);
  assert.deepEqual(t.range(4, 8), [[5, 'v5'], [7, 'v7']]);
  assert.deepEqual(t.range(-100, 100), [[1, 'v1'], [3, 'v3'], [5, 'v5'], [7, 'v7'], [9, 'v9'], [11, 'v11']]);
  assert.deepEqual(t.range(100, 200), []);
  assert.deepEqual(t.range(1, 1), [[1, 'v1']]);
});

test('range with lo > hi returns an empty array rather than throwing', () => {
  const t = new ScapegoatTree();
  for (const k of [1, 2, 3]) t.set(k, k);
  assert.deepEqual(t.range(5, 1), []);
  assert.deepEqual(t.range(0.5, -0.5), []);
});

test('toArray returns every entry in ascending key order', () => {
  const t = new ScapegoatTree();
  const shuffledKeys = [50, 10, 90, 30, 70, 20, 80, 40, 60, 0];
  for (const k of shuffledKeys) t.set(k, `v${k}`);
  assert.deepEqual(
    t.toArray(),
    [0, 10, 20, 30, 40, 50, 60, 70, 80, 90].map((k) => [k, `v${k}`])
  );
});

// =========================================================================
// Deletion shapes
// =========================================================================

test('delete returns false for a key that was never present', () => {
  const t = new ScapegoatTree();
  t.set(1, 'a');
  assert.equal(t.delete(999), false);
  assert.equal(t.size(), 1);
});

test('delete of a leaf node removes exactly that key', () => {
  const t = new ScapegoatTree();
  for (const k of [5, 3, 8]) t.set(k, `v${k}`);
  // With this insertion order and alpha=2/3, 3 and 8 are leaves under root 5.
  assert.equal(t.delete(3), true);
  assert.equal(t.has(3), false);
  assert.equal(t.has(5), true);
  assert.equal(t.has(8), true);
  assert.equal(t.size(), 2);
});

test('delete of a node with exactly one child splices the child up', () => {
  const t = new ScapegoatTree();
  // Build a small tree by hand where node 5 has only a right child (7),
  // and node 5 itself is a left child of 10 -- deleting 5 should leave 7
  // wired directly under 10 in 5's old slot.
  t.set(10, 'ten');
  t.set(5, 'five');
  t.set(7, 'seven');
  assert.equal(t.get(5), 'five');
  assert.equal(t.delete(5), true);
  assert.equal(t.has(5), false);
  assert.equal(t.has(7), true);
  assert.equal(t.has(10), true);
  assert.deepEqual(t.toArray(), [[7, 'seven'], [10, 'ten']]);
});

test('delete of a node with two children replaces it with its in-order successor', () => {
  const t = new ScapegoatTree();
  for (const k of [50, 30, 70, 20, 40, 60, 80]) t.set(k, `v${k}`);
  // Node 30 has two children (20 and 40); its in-order successor is 40.
  assert.equal(t.delete(30), true);
  assert.equal(t.has(30), false);
  for (const k of [50, 70, 20, 40, 60, 80]) assert.equal(t.has(k), true);
  assert.deepEqual(
    t.toArray().map((e) => e[0]),
    [20, 40, 50, 60, 70, 80]
  );
  assert.equal(checkBstOrder(t.root, []).every((_, i, a) => i === 0 || a[i - 1] < a[i]), true);
});

test('deleting every key one at a time empties the tree correctly', () => {
  const t = new ScapegoatTree();
  const keys = [15, 6, 23, 4, 10, 18, 30, 1, 8];
  for (const k of keys) t.set(k, `v${k}`);
  const shuffledDeleteOrder = [10, 30, 6, 1, 23, 4, 8, 18, 15];
  for (const k of shuffledDeleteOrder) {
    assert.equal(t.delete(k), true);
  }
  assert.equal(t.size(), 0);
  assert.equal(t.height(), -1);
  assert.equal(t.root, null);
  assert.deepEqual(t.toArray(), []);
});

// =========================================================================
// Rebuild-triggering sequences: subtree rebuild and whole-tree rebuild.
//
// Both scenarios below were traced interactively against the real
// implementation (via `node -e`) before being written here, per this
// project's established practice of hand-verifying structural claims
// rather than guessing at exact expected shapes.
// =========================================================================

test('ascending insertion of keys 0..4 triggers a SUBTREE rebuild scoped to root.right, leaving the root and its (empty) left subtree untouched', () => {
  const t = new ScapegoatTree();
  for (let i = 0; i <= 4; i++) t.set(i, `v${i}`);

  // The root itself was never a scapegoat here: node 0 stays the tree's
  // root, and its left subtree (always empty in this ascending-only
  // scenario) is untouched -- proving the rebuild that occurred was
  // confined to a strict subtree, not the whole tree.
  assert.equal(t.root.key, 0);
  assert.equal(t.root.left, null);
  assert.equal(t.root.size, 5);

  // The rebuild happened when key 4 was inserted: node 1 (which at that
  // point held {1,2,3,4}, size 4) was the first ancestor found to violate
  // alpha-weight-balance (its right subtree, {3,4}, had size 2 > (2/3)*4).
  // Rebuilding {1,2,3,4} with the "always choose the lower midpoint" rule
  // picks index floor((4-1)/2) = 1 of the sorted array [1,2,3,4], i.e. key
  // 2, as the new local subtree root.
  assert.equal(t.root.right.key, 2);
  assert.equal(t.root.right.size, 4);
  assert.equal(t.root.right.left.key, 1);
  assert.equal(t.root.right.right.key, 3);
  assert.equal(t.root.right.right.left, null);
  assert.equal(t.root.right.right.right.key, 4);

  // Contents and ordering are unaffected by the rebuild.
  assert.deepEqual(
    t.toArray(),
    [0, 1, 2, 3, 4].map((k) => [k, `v${k}`])
  );
  assert.equal(checkSizeInvariant(t.root), true);
  assert.equal(isStrictlyAscending(checkBstOrder(t.root, [])), true);
});

test('descending insertion of keys 4..0 also triggers a SUBTREE rebuild scoped to root.left, leaving the root and its (empty) right subtree untouched', () => {
  const t = new ScapegoatTree();
  for (let i = 4; i >= 0; i--) t.set(i, `v${i}`);

  // Traced interactively against the real implementation before writing
  // this assertion (this scenario is NOT a simple mirror image of the
  // ascending case above -- the exact insertion path differs because each
  // new node becomes the new root candidate at every step until the
  // scapegoat search actually fires, so the resulting shape has to be
  // independently verified rather than assumed by symmetry).
  assert.equal(t.root.key, 4);
  assert.equal(t.root.right, null);
  assert.equal(t.root.size, 5);
  assert.equal(t.root.left.key, 1);
  assert.equal(t.root.left.size, 4);
  assert.equal(t.root.left.left.key, 0);
  assert.equal(t.root.left.right.key, 2);
  assert.equal(t.root.left.right.left, null);
  assert.equal(t.root.left.right.right.key, 3);

  assert.deepEqual(
    t.toArray(),
    [0, 1, 2, 3, 4].map((k) => [k, `v${k}`])
  );
  assert.equal(checkSizeInvariant(t.root), true);
  assert.equal(isStrictlyAscending(checkBstOrder(t.root, [])), true);
});

test('deleting enough elements after a large ascending build triggers a WHOLE-TREE rebuild (root identity changes)', () => {
  const t = new ScapegoatTree();
  for (let i = 0; i < 20; i++) t.set(i, `v${i}`);
  assert.equal(t._maxSize, 20);
  assert.equal(t.root.key, 0, 'root stays key 0 through the ascending build (never itself the scapegoat here)');

  // Delete the top 6 keys (19..14) one at a time -- size drops from 20 to
  // 14, still >= (2/3)*20 = 13.33, so no full rebuild yet.
  for (let i = 19; i >= 14; i--) {
    assert.equal(t.delete(i), true);
  }
  assert.equal(t.size(), 14);
  assert.equal(t._maxSize, 20, 'maxSize is untouched by deletions that do not cross the rebuild threshold');
  assert.equal(t.root.key, 0, 'still the original root immediately before the triggering delete');
  const rootBeforeTrigger = t.root;

  // Deleting key 13 brings size to 13, which is < (2/3)*20 = 13.33... --
  // this is the exact delete that must trigger a full-tree rebuild.
  assert.equal(t.delete(13), true);
  assert.equal(t.size(), 13);
  assert.notEqual(t.root, rootBeforeTrigger, 'a whole-tree rebuild must produce a new root object');
  assert.equal(t.root.key, 6, 'lower-midpoint rebuild of the 13 surviving keys (0..12) roots at index 6');
  assert.equal(t._maxSize, 13, 'maxSize resets to the post-rebuild size');

  // After a full rebuild the ENTIRE tree (not just a subtree) must satisfy
  // strict alpha-weight-balance at every node -- a much stronger property
  // than the approximate bound scapegoat trees guarantee between rebuilds,
  // and one that could only hold here because of a genuine full rebuild.
  assert.equal(checkFullyAlphaBalanced(t.root), true);
  assert.equal(checkSizeInvariant(t.root), true);
  assert.deepEqual(
    t.toArray().map((e) => e[0]),
    Array.from({ length: 13 }, (_, i) => i)
  );
});

test('the whole-tree rebuild above is preceded by ordinary subtree-scale work: height stays bounded throughout the ascending build, not just at the very end', () => {
  const t = new ScapegoatTree();
  const heights = [];
  for (let i = 0; i < 100; i++) {
    t.set(i, i);
    heights.push(t.height());
  }
  // At every checkpoint from a reasonable size onward, height must be
  // within a generous constant multiple of the ideal bound -- if rebuilds
  // only ever happened once "at the end" (or never), some prefix would
  // show an unbounded (linear) height growth instead.
  for (let i = 20; i < 100; i++) {
    const bound = 3 * idealHeightBound(i + 1) + 5;
    assert.ok(heights[i] <= bound, `at n=${i + 1}, height ${heights[i]} exceeds bound ${bound}`);
  }
});

test('deleting down to a single element and back up still leaves a valid, correctly-balanced tree', () => {
  const t = new ScapegoatTree();
  for (let i = 0; i < 50; i++) t.set(i, i);
  for (let i = 0; i < 49; i++) t.delete(i);
  assert.equal(t.size(), 1);
  assert.equal(t.has(49), true);
  assert.equal(t.root.key, 49);
  assert.equal(t.root.left, null);
  assert.equal(t.root.right, null);
  for (let i = 0; i < 49; i++) t.set(i, `back-${i}`);
  assert.equal(t.size(), 50);
  assert.equal(checkSizeInvariant(t.root), true);
  assert.equal(isStrictlyAscending(checkBstOrder(t.root, [])), true);
});

// =========================================================================
// Negative and fractional keys
// =========================================================================

test('negative and fractional keys are ordered correctly by get/has/rank/select/range/toArray', () => {
  const t = new ScapegoatTree();
  const keys = [-10.5, -3, 0, 0.25, 2.75, 5, -100, 100.001, -0.5];
  const sorted = [...keys].sort((a, b) => a - b);
  for (const k of keys) t.set(k, `v${k}`);
  assert.deepEqual(
    t.toArray().map((e) => e[0]),
    sorted
  );
  for (let i = 0; i < sorted.length; i++) {
    assert.equal(t.rank(sorted[i]), i);
    assert.deepEqual(t.select(i), [sorted[i], `v${sorted[i]}`]);
    assert.equal(t.has(sorted[i]), true);
  }
  assert.deepEqual(t.range(-3, 2.75), [[-3, 'v-3'], [-0.5, 'v-0.5'], [0, 'v0'], [0.25, 'v0.25'], [2.75, 'v2.75']]);
});

test('positive zero and negative zero are treated as the same key', () => {
  const t = new ScapegoatTree();
  t.set(0, 'positive-zero');
  t.set(-0, 'negative-zero');
  assert.equal(t.size(), 1);
  assert.equal(t.get(0), 'negative-zero');
  assert.equal(t.get(-0), 'negative-zero');
  assert.equal(t.has(-0), true);
});

test('very small and very large finite fractional keys are handled without precision-induced misordering', () => {
  const t = new ScapegoatTree();
  const keys = [1e-10, 1e10, -1e10, 3.14159265358979, -3.14159265358979, Number.MIN_VALUE, Number.MAX_VALUE, -Number.MAX_VALUE];
  const sorted = [...keys].sort((a, b) => a - b);
  for (const k of keys) t.set(k, String(k));
  assert.deepEqual(
    t.toArray().map((e) => e[0]),
    sorted
  );
});

// =========================================================================
// Invalid inputs
// =========================================================================

test('set/get/has/delete/rank throw TypeError for non-finite-number keys', () => {
  const t = new ScapegoatTree();
  const badKeys = ['5', null, undefined, NaN, Infinity, -Infinity, {}, [], true, false, () => {}, Symbol('x')];
  for (const bad of badKeys) {
    assert.throws(() => t.set(bad, 1), TypeError, `set(${String(bad)})`);
    assert.throws(() => t.get(bad), TypeError, `get(${String(bad)})`);
    assert.throws(() => t.has(bad), TypeError, `has(${String(bad)})`);
    assert.throws(() => t.delete(bad), TypeError, `delete(${String(bad)})`);
    assert.throws(() => t.rank(bad), TypeError, `rank(${String(bad)})`);
  }
});

test('range throws TypeError for non-finite-number bounds', () => {
  const t = new ScapegoatTree();
  t.set(1, 'a');
  const bad = ['5', null, undefined, NaN, Infinity, -Infinity, {}];
  for (const b of bad) {
    assert.throws(() => t.range(b, 10), TypeError);
    assert.throws(() => t.range(0, b), TypeError);
  }
});

test('select throws TypeError for non-integer or non-number indices, RangeError for out-of-bounds integers', () => {
  const t = new ScapegoatTree();
  for (let i = 0; i < 5; i++) t.set(i, i);
  const typeErrors = ['0', null, undefined, NaN, Infinity, 1.5, -1, {}, []];
  for (const bad of typeErrors) {
    assert.throws(() => t.select(bad), TypeError, `select(${String(bad)})`);
  }
  assert.throws(() => t.select(5), RangeError);
  assert.throws(() => t.select(1000), RangeError);
});

test('invalid inputs never mutate the tree', () => {
  const t = new ScapegoatTree();
  t.set(1, 'a');
  t.set(2, 'b');
  const before = t.toArray();
  for (const bad of ['x', null, NaN]) {
    try { t.set(bad, 'z'); } catch (e) { /* expected */ }
    try { t.get(bad); } catch (e) { /* expected */ }
    try { t.delete(bad); } catch (e) { /* expected */ }
  }
  assert.deepEqual(t.toArray(), before);
});

// =========================================================================
// Deterministic ordering
// =========================================================================

test('the same sequence of operations produces byte-identical toArray/select/range/rank output across independent fresh instances', () => {
  const buildAndSnapshot = () => {
    const t = new ScapegoatTree();
    const rand = mulberry32(20260809);
    for (let i = 0; i < 300; i++) {
      const key = Math.floor(rand() * 1000) - 500;
      t.set(key, `v${key}`);
      if (i % 5 === 0 && t.size() > 0) {
        const k = Math.floor(rand() * t.size());
        try { t.delete(t.select(k)[0]); } catch (e) { /* size may have changed */ }
      }
    }
    return {
      toArray: t.toArray(),
      selects: Array.from({ length: t.size() }, (_, i) => t.select(i)),
      ranks: t.toArray().map((e) => t.rank(e[0])),
      range: t.range(-100, 100),
      size: t.size(),
      height: t.height(),
    };
  };
  const first = buildAndSnapshot();
  for (let trial = 0; trial < 4; trial++) {
    const again = buildAndSnapshot();
    assert.deepEqual(again, first, `trial ${trial} diverged from the first run`);
  }
});

test('search/query methods do not mutate state between repeated calls', () => {
  const t = new ScapegoatTree();
  for (let i = 0; i < 30; i++) t.set(i, i);
  const before = t.toArray();
  for (let i = 0; i < 5; i++) {
    t.get(15);
    t.has(200);
    t.rank(15);
    t.select(3);
    t.range(5, 25);
    t.toArray();
    t.size();
    t.height();
  }
  assert.deepEqual(t.toArray(), before);
});

// =========================================================================
// Height bounds
// =========================================================================

test('height stays within a generous constant multiple of the ideal log_(1/alpha)(n) bound across a large randomized build', () => {
  const rand = mulberry32(777);
  const t = new ScapegoatTree();
  const seen = new Set();
  let n = 0;
  while (n < 3000) {
    const key = Math.floor(rand() * 1000000);
    if (!seen.has(key)) {
      seen.add(key);
      t.set(key, key);
      n++;
      if (n % 250 === 0) {
        const bound = 3 * idealHeightBound(n) + 5;
        assert.ok(t.height() <= bound, `at n=${n}, height ${t.height()} exceeds bound ${bound}`);
      }
    }
  }
});

test('height of a single-node tree is 0, and of a two-node tree is 1', () => {
  const t = new ScapegoatTree();
  assert.equal(t.height(), -1);
  t.set(1, 'a');
  assert.equal(t.height(), 0);
  t.set(2, 'b');
  assert.equal(t.height(), 1);
});

// =========================================================================
// Fixed-seed mixed operations against a sorted-array oracle
// =========================================================================

test('fixed-seed randomized mixed set/get/has/delete/rank/select/range/toArray operations exactly match a sorted-array oracle', () => {
  const rand = mulberry32(424242);
  const t = new ScapegoatTree();
  const oracle = new SortedArrayOracle();
  const KEY_SPACE = 400; // deliberately small to force frequent replacements/collisions

  let checksPerformed = 0;
  for (let step = 0; step < 20000; step++) {
    const op = rand();
    const key = Math.floor(rand() * KEY_SPACE) - KEY_SPACE / 2 + (rand() < 0.1 ? rand() : 0); // sometimes fractional
    if (op < 0.45) {
      const value = `v${step}`;
      t.set(key, value);
      oracle.set(key, value);
    } else if (op < 0.65) {
      assert.equal(t.delete(key), oracle.delete(key));
      checksPerformed++;
    } else if (op < 0.75) {
      assert.equal(t.get(key), oracle.get(key));
      checksPerformed++;
    } else if (op < 0.85) {
      assert.equal(t.has(key), oracle.has(key));
      checksPerformed++;
    } else if (op < 0.92) {
      assert.equal(t.rank(key), oracle.rank(key));
      checksPerformed++;
    } else if (op < 0.97) {
      if (oracle.size() > 0) {
        const idx = Math.floor(rand() * oracle.size());
        assert.deepEqual(t.select(idx), oracle.select(idx));
        checksPerformed++;
      }
    } else {
      const lo = Math.floor(rand() * KEY_SPACE) - KEY_SPACE / 2;
      const hi = lo + Math.floor(rand() * 50);
      assert.deepEqual(t.range(lo, hi), oracle.range(lo, hi));
      checksPerformed++;
    }

    // Periodically cross-check full state and internal structural
    // invariants, not just the single op's return value.
    if (step % 500 === 0) {
      assert.deepEqual(t.toArray(), oracle.toArray());
      assert.equal(t.size(), oracle.size());
      assert.equal(checkSizeInvariant(t.root), true);
      assert.equal(isStrictlyAscending(checkBstOrder(t.root, [])), true);
      const bound = 3 * idealHeightBound(Math.max(t.size(), 1)) + 8;
      assert.ok(t.height() <= bound, `at step ${step} (size ${t.size()}), height ${t.height()} exceeds bound ${bound}`);
      checksPerformed++;
    }
  }

  assert.deepEqual(t.toArray(), oracle.toArray());
  assert.equal(t.size(), oracle.size());
  assert.ok(checksPerformed > 10000, `expected substantial coverage, only performed ${checksPerformed} checks`);
});
