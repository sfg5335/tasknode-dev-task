'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { CompressedRadixTrie } = require('./compressed-radix-trie.js');

// ---- Internal structural-invariant checker -------------------------------
//
// Verifies, by walking the trie's private fields directly, that:
//   1. Every Map key in `node.children` equals the first character of that
//      child's edge string (internal consistency).
//   2. No edge string is empty.
//   3. No node other than the root has exactly one child while itself not
//      being an end-of-key node -- i.e. edges stay maximally compressed
//      after every insertion and deletion.
//   4. The trie's `_size` field equals the number of isEnd:true nodes found
//      by an independent traversal.
function checkInvariant(trie) {
  let endCount = 0;

  const visit = (node, isRoot) => {
    if (node.isEnd) endCount++;
    if (!isRoot && node.children.size === 1 && !node.isEnd) {
      assert.fail('found an uncompressed single-child, non-end node');
    }
    for (const [firstChar, entry] of node.children) {
      assert.notEqual(entry.edge.length, 0, 'edge must not be empty');
      assert.equal(entry.edge[0], firstChar, 'children Map key must match edge first char');
      visit(entry.node, false);
    }
  };

  visit(trie.root, true);
  assert.equal(trie.size, endCount, 'trie.size must match the number of end-of-key nodes');
}

// ---------------------------------------------------------------------------

test('empty trie: size 0, get/has/delete/longestPrefixOf report absence, entriesWithPrefix is empty', () => {
  const t = new CompressedRadixTrie();
  assert.equal(t.size, 0);
  assert.equal(t.get('anything'), undefined);
  assert.equal(t.has('anything'), false);
  assert.equal(t.delete('anything'), false);
  assert.equal(t.longestPrefixOf('anything'), null);
  assert.deepEqual(t.entriesWithPrefix(''), []);
  assert.deepEqual(t.entriesWithPrefix('a'), []);
  checkInvariant(t);
});

test('single key round-trips through set/get/has, including the empty-string key', () => {
  const t = new CompressedRadixTrie();
  t.set('cat', 1);
  assert.equal(t.get('cat'), 1);
  assert.equal(t.has('cat'), true);
  assert.equal(t.has('ca'), false);
  assert.equal(t.has('caterpillar'), false);
  assert.equal(t.size, 1);
  checkInvariant(t);

  t.set('', 'root-value');
  assert.equal(t.get(''), 'root-value');
  assert.equal(t.has(''), true);
  assert.equal(t.size, 2);
  checkInvariant(t);
});

test('set() returns `this`, enabling chaining', () => {
  const t = new CompressedRadixTrie();
  const result = t.set('a', 1).set('b', 2).set('c', 3);
  assert.equal(result, t);
  assert.equal(t.size, 3);
  assert.equal(t.get('a'), 1);
  assert.equal(t.get('b'), 2);
  assert.equal(t.get('c'), 3);
});

test('overwriting an existing key updates the value without changing size', () => {
  const t = new CompressedRadixTrie();
  t.set('key', 'first');
  assert.equal(t.size, 1);
  t.set('key', 'second');
  assert.equal(t.size, 1);
  assert.equal(t.get('key'), 'second');
  checkInvariant(t);
});

test('shared-prefix insertion causes edge splitting, preserving both keys', () => {
  const t = new CompressedRadixTrie();
  t.set('test', 1);
  t.set('team', 2);
  t.set('tea', 3);
  assert.equal(t.get('test'), 1);
  assert.equal(t.get('team'), 2);
  assert.equal(t.get('tea'), 3);
  assert.equal(t.has('te'), false);
  assert.equal(t.has('t'), false);
  assert.equal(t.size, 3);
  checkInvariant(t);
});

test('branching: many keys sharing various prefixes all remain independently retrievable', () => {
  const t = new CompressedRadixTrie();
  const words = ['romane', 'romanus', 'romulus', 'rubens', 'ruber', 'rubicon', 'rubicundus'];
  words.forEach((w, i) => t.set(w, i));
  for (const [i, w] of words.entries()) {
    assert.equal(t.get(w), i, `expected ${w} -> ${i}`);
    assert.equal(t.has(w), true);
  }
  assert.equal(t.size, words.length);
  checkInvariant(t);
});

test('empty string key coexists correctly with non-empty keys sharing no special treatment', () => {
  const t = new CompressedRadixTrie();
  t.set('', 'empty');
  t.set('a', 'single-char');
  t.set('ab', 'two-char');
  assert.equal(t.get(''), 'empty');
  assert.equal(t.get('a'), 'single-char');
  assert.equal(t.get('ab'), 'two-char');
  assert.deepEqual(
    t.entriesWithPrefix('').sort((a, b) => (a[0] < b[0] ? -1 : 1)),
    [['', 'empty'], ['a', 'single-char'], ['ab', 'two-char']]
  );
  checkInvariant(t);
});

test('Unicode keys, including surrogate-pair (astral) characters, are supported', () => {
  const t = new CompressedRadixTrie();
  t.set('café', 'accent'); // "café"
  t.set('😀-face', 'grinning-face-prefixed'); // "😀-face" (surrogate pair + suffix)
  t.set('😀-cry', 'grinning-then-cry'); // shares the "😀-" edge prefix
  t.set('你好', 'nihao'); // "你好"

  assert.equal(t.get('café'), 'accent');
  assert.equal(t.get('😀-face'), 'grinning-face-prefixed');
  assert.equal(t.get('😀-cry'), 'grinning-then-cry');
  assert.equal(t.get('你好'), 'nihao');
  assert.equal(t.has('😀'), false); // the lone surrogate pair alone was never set
  assert.equal(t.size, 4);

  const withEmojiPrefix = t.entriesWithPrefix('😀-');
  assert.deepEqual(
    withEmojiPrefix,
    [['😀-cry', 'grinning-then-cry'], ['😀-face', 'grinning-face-prefixed']]
  );
  checkInvariant(t);
});

test('delete() returns false for absent keys and does not affect size or other keys', () => {
  const t = new CompressedRadixTrie();
  t.set('present', 1);
  assert.equal(t.delete('absent'), false);
  assert.equal(t.delete('pres'), false); // prefix of a real key, but not itself a key
  assert.equal(t.delete('presentation'), false); // real key is a prefix of this, not equal
  assert.equal(t.size, 1);
  assert.equal(t.get('present'), 1);
  checkInvariant(t);
});

test('deleting a leaf key removes it and re-merges (compresses) the remaining single-child chain', () => {
  const t = new CompressedRadixTrie();
  t.set('test', 1);
  t.set('team', 2);
  // Shared edge "te" splits into a branch node with children "st" and "am".
  checkInvariant(t);

  assert.equal(t.delete('test'), true);
  assert.equal(t.has('test'), false);
  assert.equal(t.get('team'), 2);
  assert.equal(t.size, 1);
  checkInvariant(t); // the branch node must have re-merged into a single "team" edge

  // Structural check: after re-merging, "team" must be reachable as one hop
  // from the root (no leftover intermediate non-end node).
  const firstEntry = t.root.children.get('t');
  assert.equal(firstEntry.edge, 'team');
});

test('deleting an internal (non-leaf) end-of-key node keeps its children intact', () => {
  const t = new CompressedRadixTrie();
  t.set('tea', 1);
  t.set('team', 2);
  t.set('teapot', 3);
  checkInvariant(t);

  assert.equal(t.delete('tea'), true);
  assert.equal(t.has('tea'), false);
  assert.equal(t.get('team'), 2);
  assert.equal(t.get('teapot'), 3);
  assert.equal(t.size, 2);
  checkInvariant(t);
});

test('deleting every key restores an empty trie with no leftover structure', () => {
  const t = new CompressedRadixTrie();
  const words = ['alpha', 'alpine', 'alter', 'beta', 'bear'];
  words.forEach((w, i) => t.set(w, i));
  checkInvariant(t);

  for (const w of words) {
    assert.equal(t.delete(w), true);
  }
  assert.equal(t.size, 0);
  assert.equal(t.root.children.size, 0);
  checkInvariant(t);
});

test('deleting the empty-string key only clears it, leaving other keys untouched', () => {
  const t = new CompressedRadixTrie();
  t.set('', 'root');
  t.set('x', 1);
  assert.equal(t.delete(''), true);
  assert.equal(t.has(''), false);
  assert.equal(t.delete(''), false); // already gone
  assert.equal(t.get('x'), 1);
  assert.equal(t.size, 1);
  checkInvariant(t);
});

test('entriesWithPrefix returns matches in JavaScript lexicographic order, including exact-key and mid-edge prefixes', () => {
  const t = new CompressedRadixTrie();
  ['car', 'card', 'care', 'cart', 'careful', 'dog'].forEach((w, i) => t.set(w, i));

  assert.deepEqual(t.entriesWithPrefix('car'), [
    ['car', 0],
    ['card', 1],
    ['care', 2],
    ['careful', 4],
    ['cart', 3],
  ]);
  // A prefix that ends partway through a compressed edge still works.
  assert.deepEqual(t.entriesWithPrefix('ca'), [
    ['car', 0],
    ['card', 1],
    ['care', 2],
    ['careful', 4],
    ['cart', 3],
  ]);
  // A prefix with no matches returns an empty array.
  assert.deepEqual(t.entriesWithPrefix('xyz'), []);
  // A prefix longer than any stored key that shares its start returns [].
  assert.deepEqual(t.entriesWithPrefix('cars-are-great'), []);
  checkInvariant(t);
});

test('entriesWithPrefix("") returns every entry in the trie, sorted', () => {
  const t = new CompressedRadixTrie();
  ['banana', 'apple', 'cherry', ''].forEach((w, i) => t.set(w, i));
  assert.deepEqual(t.entriesWithPrefix(''), [
    ['', 3],
    ['apple', 1],
    ['banana', 0],
    ['cherry', 2],
  ]);
});

test('longestPrefixOf finds the longest stored key that prefixes the input, or null', () => {
  const t = new CompressedRadixTrie();
  t.set('a', 1);
  t.set('ab', 2);
  t.set('abc', 3);
  t.set('abcdex', 4); // deliberately NOT a prefix of "abcde" below

  assert.equal(t.longestPrefixOf('abcde'), 'abc');
  assert.equal(t.longestPrefixOf('abc'), 'abc');
  assert.equal(t.longestPrefixOf('ab'), 'ab');
  assert.equal(t.longestPrefixOf('a'), 'a');
  assert.equal(t.longestPrefixOf(''), null); // nothing is a prefix of nothing here
  assert.equal(t.longestPrefixOf('xyz'), null); // no stored key at all is a prefix
  assert.equal(t.longestPrefixOf('abcdex'), 'abcdex'); // exact longer match wins
});

test('longestPrefixOf: the empty-string key counts as a prefix of everything once set', () => {
  const t = new CompressedRadixTrie();
  t.set('', 'root');
  assert.equal(t.longestPrefixOf('anything'), '');
  assert.equal(t.longestPrefixOf(''), '');
  t.set('any', 'val');
  assert.equal(t.longestPrefixOf('anything'), 'any');
});

test('longestPrefixOf stops correctly on a partial mid-edge mismatch', () => {
  const t = new CompressedRadixTrie();
  t.set('helicopter', 1);
  t.set('hello', 2);
  // "help" shares "hel" with both, then diverges from each ("licopter" vs "lo").
  assert.equal(t.longestPrefixOf('help'), null);
  assert.equal(t.longestPrefixOf('hello world'), 'hello');
  assert.equal(t.longestPrefixOf('helicopters'), 'helicopter');
});

test('set/get/has/delete/entriesWithPrefix/longestPrefixOf all reject non-string arguments with TypeError', () => {
  const t = new CompressedRadixTrie();
  t.set('seed', 1);
  for (const bad of [42, null, undefined, {}, [], true, Symbol('x')]) {
    assert.throws(() => t.set(bad, 1), TypeError, `set(${String(bad)})`);
    assert.throws(() => t.get(bad), TypeError, `get(${String(bad)})`);
    assert.throws(() => t.has(bad), TypeError, `has(${String(bad)})`);
    assert.throws(() => t.delete(bad), TypeError, `delete(${String(bad)})`);
    assert.throws(() => t.entriesWithPrefix(bad), TypeError, `entriesWithPrefix(${String(bad)})`);
    assert.throws(() => t.longestPrefixOf(bad), TypeError, `longestPrefixOf(${String(bad)})`);
  }
  // The trie must be untouched by the rejected calls.
  assert.equal(t.size, 1);
  assert.equal(t.get('seed'), 1);
});

// ---- Fixed-seed cross-check against a `Map` reference model --------------
//
// A plain Map<string, value> is an obviously-correct reference for
// set/get/has/delete. entriesWithPrefix/longestPrefixOf are derived from
// the Map's own keys on the fly (O(n) per query, independent of the trie's
// edge-compression logic), so agreement confirms the trie's prefix
// operations against ground truth, not just against themselves.

function makeRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

function refEntriesWithPrefix(map, prefix) {
  const out = [];
  for (const [k, v] of map) {
    if (k.startsWith(prefix)) out.push([k, v]);
  }
  out.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return out;
}

function refLongestPrefixOf(map, str) {
  let best = null;
  for (const k of map.keys()) {
    if (str.startsWith(k) && (best === null || k.length > best.length)) best = k;
  }
  return best;
}

test('fixed-seed cross-check: 3000 random set/get/has/delete/prefix ops match a Map reference model', () => {
  const rng = makeRng(20260807);
  const alphabet = ['a', 'b', 'c', 'ab', 'ba', 'x', ''];
  const keyPool = [];
  for (let i = 0; i < 40; i++) {
    const len = 1 + Math.floor(rng() * 3);
    let k = '';
    for (let j = 0; j < len; j++) k += alphabet[Math.floor(rng() * alphabet.length)];
    keyPool.push(k);
  }
  // Guarantee at least one occurrence of the true empty string in the pool.
  keyPool.push('');

  const trie = new CompressedRadixTrie();
  const ref = new Map();

  for (let op = 0; op < 3000; op++) {
    const key = keyPool[Math.floor(rng() * keyPool.length)];
    const roll = rng();

    if (roll < 0.45) {
      const value = Math.floor(rng() * 1000);
      trie.set(key, value);
      ref.set(key, value);
      assert.equal(trie.get(key), ref.get(key), `set/get mismatch for ${JSON.stringify(key)}`);
    } else if (roll < 0.65) {
      const a = trie.delete(key);
      const b = ref.delete(key);
      assert.equal(a, b, `delete() return-value mismatch for ${JSON.stringify(key)}`);
    } else if (roll < 0.8) {
      assert.equal(trie.has(key), ref.has(key), `has mismatch for ${JSON.stringify(key)}`);
      assert.equal(trie.get(key), ref.get(key), `get mismatch for ${JSON.stringify(key)}`);
    } else if (roll < 0.9) {
      const prefix = key.slice(0, Math.max(0, key.length - 1));
      assert.deepEqual(
        trie.entriesWithPrefix(prefix),
        refEntriesWithPrefix(ref, prefix),
        `entriesWithPrefix mismatch for prefix ${JSON.stringify(prefix)}`
      );
    } else {
      const probe = key + alphabet[Math.floor(rng() * alphabet.length)];
      assert.equal(
        trie.longestPrefixOf(probe),
        refLongestPrefixOf(ref, probe),
        `longestPrefixOf mismatch for ${JSON.stringify(probe)}`
      );
    }

    assert.equal(trie.size, ref.size, `size mismatch after op ${op}`);
    if (op % 50 === 0) checkInvariant(trie); // periodic structural check keeps the loop fast
  }

  checkInvariant(trie);

  // Full-state cross-check after all 3000 ops.
  assert.equal(trie.size, ref.size);
  for (const [k, v] of ref) {
    assert.equal(trie.get(k), v, `final get mismatch for ${JSON.stringify(k)}`);
    assert.equal(trie.has(k), true);
  }
  assert.deepEqual(trie.entriesWithPrefix(''), refEntriesWithPrefix(ref, ''));
});
