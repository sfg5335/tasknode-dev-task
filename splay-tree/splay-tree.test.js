'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { SplayTree } = require('./splay-tree.js');

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

/** Walks the whole tree, asserting: the BST ordering invariant (every
 * node's key lies strictly between its open (lo, hi) bounds), every
 * node's `parent` pointer matches its actual parent, and every node's
 * `size` equals `1 + size(left) + size(right)`. Returns the subtree's
 * total node count (so the caller can also cross-check it against
 * `tree.size`). */
function assertInvariants(node, lo, hi, parent) {
  if (node === null) return 0;
  assert.equal(node.parent, parent, `parent pointer mismatch at key ${node.key}`);
  assert.ok(node.key > lo && node.key < hi, `BST ordering violated at key ${node.key} (bounds ${lo}, ${hi})`);
  const leftCount = assertInvariants(node.left, lo, node.key, node);
  const rightCount = assertInvariants(node.right, node.key, hi, node);
  const expectedSize = 1 + leftCount + rightCount;
  assert.equal(node.size, expectedSize, `size mismatch at key ${node.key}`);
  return expectedSize;
}

function checkTree(tree) {
  const count = assertInvariants(tree.root, -Infinity, Infinity, null);
  assert.equal(tree.size, count, 'tree.size does not match actual node count');
  if (tree.root !== null) assert.equal(tree.root.parent, null, 'root must have a null parent');
}

// ---- empty trees ----

test('empty tree: size, height, and every query report empty', () => {
  const t = new SplayTree();
  assert.equal(t.size, 0);
  assert.equal(t.height, -1);
  assert.equal(t.get(1), undefined);
  assert.equal(t.has(1), false);
  assert.equal(t.delete(1), false);
  assert.deepEqual(t.toArray(), []);
  assert.deepEqual(t.range(0, 10), []);
  checkTree(t);
});

test('empty tree: select throws RangeError for any index', () => {
  const t = new SplayTree();
  assert.throws(() => t.select(0), RangeError);
  assert.throws(() => t.select(-1), RangeError);
});

// ---- single-node operations ----

test('single node: set, get, has, size, height', () => {
  const t = new SplayTree();
  t.set(5, 'five');
  assert.equal(t.size, 1);
  assert.equal(t.height, 0);
  assert.equal(t.get(5), 'five');
  assert.equal(t.has(5), true);
  assert.equal(t.has(6), false);
  assert.equal(t.get(6), undefined);
  assert.deepEqual(t.toArray(), [[5, 'five']]);
  assert.deepEqual(t.select(0), [5, 'five']);
  checkTree(t);
});

test('single node: delete removes it and empties the tree', () => {
  const t = new SplayTree();
  t.set(5, 'five');
  assert.equal(t.delete(5), true);
  assert.equal(t.size, 0);
  assert.equal(t.height, -1);
  assert.equal(t.root, null);
  assert.equal(t.delete(5), false);
  checkTree(t);
});

// ---- splay-to-root behavior ----

test('get splays the found node to the root', () => {
  const t = new SplayTree();
  for (const k of [10, 5, 15, 3, 7, 12, 18]) t.set(k, `v${k}`);
  t.get(7);
  assert.equal(t.root.key, 7);
  checkTree(t);
});

test('get on a miss splays the last node reached during the search', () => {
  const t = new SplayTree();
  for (const k of [10, 5, 15]) t.set(k, `v${k}`);
  // Searching for 20 falls off the tree at 15 (the rightmost node).
  assert.equal(t.get(20), undefined);
  assert.equal(t.root.key, 15);
  checkTree(t);
});

test('has splays the found node to the root', () => {
  const t = new SplayTree();
  for (const k of [10, 5, 15, 3, 7]) t.set(k, `v${k}`);
  t.has(3);
  assert.equal(t.root.key, 3);
  checkTree(t);
});

test('set on an existing key updates the value and splays it to the root', () => {
  const t = new SplayTree();
  for (const k of [10, 5, 15]) t.set(k, `v${k}`);
  t.set(5, 'updated');
  assert.equal(t.root.key, 5);
  assert.equal(t.get(5), 'updated');
  assert.equal(t.size, 3);
  checkTree(t);
});

test('select splays the found node to the root', () => {
  const t = new SplayTree();
  for (const k of [10, 5, 15, 3, 7, 12, 18]) t.set(k, `v${k}`);
  const sorted = t.toArray().map(([k]) => k);
  const [key] = t.select(2);
  assert.equal(key, sorted[2]);
  assert.equal(t.root.key, sorted[2]);
  checkTree(t);
});

test('splaying the minimum of a long chain roughly halves the remaining depth (classic splay-tree behavior)', () => {
  const t = new SplayTree();
  const n = 2000;
  for (let i = 0; i < n; i++) t.set(i, i); // strictly ascending insertion builds a fully degenerate chain
  const heightBefore = t.height;
  assert.equal(heightBefore, n - 1); // fully degenerate: a linked list via right pointers
  t.get(0);
  assert.equal(t.root.key, 0);
  const heightAfter = t.height;
  assert.ok(heightAfter < heightBefore * 0.6, `expected splaying to substantially collapse the chain: before=${heightBefore} after=${heightAfter}`);
  checkTree(t);
});

// ---- sequential insertion ----

test('sequential ascending insertion keeps all keys retrievable in order', () => {
  const t = new SplayTree();
  const n = 500;
  for (let i = 0; i < n; i++) t.set(i, `v${i}`);
  assert.equal(t.size, n);
  const arr = t.toArray();
  assert.equal(arr.length, n);
  for (let i = 0; i < n; i++) assert.deepEqual(arr[i], [i, `v${i}`]);
  checkTree(t);
});

test('sequential descending insertion keeps all keys retrievable in order', () => {
  const t = new SplayTree();
  const n = 500;
  for (let i = n; i >= 1; i--) t.set(i, `v${i}`);
  const arr = t.toArray();
  assert.equal(arr.length, n);
  for (let i = 0; i < n; i++) assert.equal(arr[i][0], i + 1);
  checkTree(t);
});

// ---- duplicate key updates ----

test('setting the same key twice overwrites the value without growing size', () => {
  const t = new SplayTree();
  t.set(5, 'a');
  t.set(5, 'b');
  assert.equal(t.size, 1);
  assert.equal(t.get(5), 'b');
  checkTree(t);
});

test('has distinguishes a stored undefined value from a missing key', () => {
  const t = new SplayTree();
  t.set(1, undefined);
  assert.equal(t.has(1), true);
  assert.equal(t.get(1), undefined);
  assert.equal(t.has(2), false);
  assert.equal(t.get(2), undefined);
  checkTree(t);
});

// ---- range and select correctness ----

test('range returns keys in [lo, hi] inclusive, in ascending order', () => {
  const t = new SplayTree();
  for (const k of [5, 3, 8, 1, 4, 7, 9, 2, 6, 0]) t.set(k, `v${k}`);
  assert.deepEqual(t.range(3, 7), [[3, 'v3'], [4, 'v4'], [5, 'v5'], [6, 'v6'], [7, 'v7']]);
  assert.deepEqual(t.range(-5, 100), t.toArray());
  assert.deepEqual(t.range(2.5, 6.5), [[3, 'v3'], [4, 'v4'], [5, 'v5'], [6, 'v6']]);
  checkTree(t);
});

test('range returns an empty array for an inverted (lo > hi) bound rather than throwing', () => {
  const t = new SplayTree();
  t.set(5, 'v');
  assert.deepEqual(t.range(7, 3), []);
  checkTree(t);
});

test('range on an empty tree, and a range that matches nothing, both return []', () => {
  const t = new SplayTree();
  assert.deepEqual(t.range(0, 10), []);
  t.set(100, 'v');
  assert.deepEqual(t.range(0, 10), []);
});

test('select(k) returns the k-th smallest [key, value] pair for every valid k', () => {
  const t = new SplayTree();
  const keys = [5, 3, 8, 1, 4, 7, 9, 2, 6, 0];
  for (const k of keys) t.set(k, `v${k}`);
  const sorted = [...keys].sort((a, b) => a - b);
  for (let i = 0; i < sorted.length; i++) {
    assert.deepEqual(t.select(i), [sorted[i], `v${sorted[i]}`]);
  }
});

test('select throws RangeError for a negative or too-large index, TypeError for a non-integer', () => {
  const t = new SplayTree();
  t.set(1, 'a');
  t.set(2, 'b');
  assert.throws(() => t.select(-1), RangeError);
  assert.throws(() => t.select(2), RangeError);
  assert.throws(() => t.select(1.5), TypeError);
  assert.throws(() => t.select('0'), TypeError);
});

// ---- determinism ----

test('determinism: the same operation sequence produces byte-for-byte identical results every run', () => {
  function runSequence() {
    const t = new SplayTree();
    const results = [];
    for (const k of [10, 5, 15, 3, 7, 12, 18, 1, 4, 6, 8, 11, 13, 17, 19]) t.set(k, `v${k}`);
    results.push(t.get(7));
    results.push(t.has(13));
    results.push(t.delete(5));
    results.push(JSON.stringify(t.select(3)));
    results.push(JSON.stringify(t.range(5, 15)));
    results.push(JSON.stringify(t.toArray()));
    results.push(t.size);
    results.push(t.height);
    return JSON.stringify(results);
  }
  const first = runSequence();
  for (let i = 0; i < 10; i++) assert.equal(runSequence(), first);
});

test('determinism: a battery of random operation sequences each reproduce identically across repeated runs', () => {
  const rng = mulberry32(13579);
  const scripts = [];
  for (let s = 0; s < 20; s++) {
    const script = [];
    for (let i = 0; i < 50; i++) {
      const key = Math.floor(rng() * 40) - 20;
      const kind = Math.floor(rng() * 4);
      script.push([kind, key]);
    }
    scripts.push(script);
  }

  function runScript(script) {
    const t = new SplayTree();
    const out = [];
    for (const [kind, key] of script) {
      if (kind === 0) { t.set(key, key * 2); out.push('set'); }
      else if (kind === 1) out.push(t.get(key));
      else if (kind === 2) out.push(t.has(key));
      else out.push(t.delete(key));
    }
    return JSON.stringify({ out, arr: t.toArray(), size: t.size, height: t.height });
  }

  for (const script of scripts) {
    const first = runScript(script);
    for (let r = 0; r < 3; r++) assert.equal(runScript(script), first);
  }
});

// ---- input validation ----

test('rejects a non-number or non-finite key with TypeError, from every key-taking method', () => {
  const t = new SplayTree();
  t.set(1, 'a');
  const badKeys = ['1', null, undefined, {}, [], NaN, Infinity, -Infinity];
  for (const key of badKeys) {
    assert.throws(() => t.set(key, 'x'), TypeError, `set(${String(key)})`);
    assert.throws(() => t.get(key), TypeError, `get(${String(key)})`);
    assert.throws(() => t.has(key), TypeError, `has(${String(key)})`);
    assert.throws(() => t.delete(key), TypeError, `delete(${String(key)})`);
  }
});

test('rejects a non-finite lo or hi in range with TypeError', () => {
  const t = new SplayTree();
  t.set(1, 'a');
  assert.throws(() => t.range('0', 10), TypeError);
  assert.throws(() => t.range(0, '10'), TypeError);
  assert.throws(() => t.range(NaN, 10), TypeError);
  assert.throws(() => t.range(0, Infinity), TypeError);
});

test('accepts negative and fractional finite keys', () => {
  const t = new SplayTree();
  t.set(-5.5, 'a');
  t.set(0, 'b');
  t.set(3.25, 'c');
  assert.deepEqual(t.toArray(), [[-5.5, 'a'], [0, 'b'], [3.25, 'c']]);
});

// ---- input immutability ----

test('set never mutates a stored value object, even when later overwritten', () => {
  const original = { a: 1 };
  const t = new SplayTree();
  t.set(1, original);
  t.set(1, { a: 2 });
  assert.deepEqual(original, { a: 1 });
});

// ---- fixed-seed differential test against a reference Map, 5,000+ mixed operations ----

test('fixed-seed differential test: matches a reference Map across 5,000+ mixed operations', () => {
  const rng = mulberry32(20260813);
  const tree = new SplayTree();
  const oracle = new Map();
  const KEY_RANGE = 300;
  const OPS = 6000;

  for (let i = 0; i < OPS; i++) {
    const roll = rng();
    const key = Math.floor(rng() * KEY_RANGE) - KEY_RANGE / 2;

    if (roll < 0.3) {
      const value = `v${i}`;
      tree.set(key, value);
      oracle.set(key, value);
    } else if (roll < 0.5) {
      assert.equal(tree.get(key), oracle.has(key) ? oracle.get(key) : undefined, `get(${key}) at op ${i}`);
    } else if (roll < 0.65) {
      assert.equal(tree.has(key), oracle.has(key), `has(${key}) at op ${i}`);
    } else if (roll < 0.8) {
      const expected = oracle.has(key);
      assert.equal(tree.delete(key), expected, `delete(${key}) at op ${i}`);
      oracle.delete(key);
    } else if (roll < 0.9) {
      if (oracle.size > 0) {
        const idx = Math.floor(rng() * oracle.size);
        const sortedKeys = [...oracle.keys()].sort((a, b) => a - b);
        const expectedKey = sortedKeys[idx];
        assert.deepEqual(tree.select(idx), [expectedKey, oracle.get(expectedKey)], `select(${idx}) at op ${i}`);
      }
    } else {
      const lo = Math.floor(rng() * KEY_RANGE) - KEY_RANGE / 2;
      const hi = Math.floor(rng() * KEY_RANGE) - KEY_RANGE / 2;
      const expected = [...oracle.entries()].filter(([k]) => k >= lo && k <= hi).sort((a, b) => a[0] - b[0]);
      assert.deepEqual(tree.range(lo, hi), expected, `range(${lo},${hi}) at op ${i}`);
    }

    if (i % 500 === 0) {
      assert.equal(tree.size, oracle.size, `size mismatch at op ${i}`);
      assert.deepEqual(tree.toArray(), [...oracle.entries()].sort((a, b) => a[0] - b[0]), `toArray mismatch at op ${i}`);
      checkTree(tree);
    }
  }

  assert.equal(tree.size, oracle.size);
  assert.deepEqual(tree.toArray(), [...oracle.entries()].sort((a, b) => a[0] - b[0]));
  checkTree(tree);
});
