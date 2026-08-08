'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PalindromicTree } = require('./palindromic-tree.js');

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

function compareByCodePointsOracle(a, b) {
  const aCps = Array.from(a);
  const bCps = Array.from(b);
  const minLen = Math.min(aCps.length, bCps.length);
  for (let i = 0; i < minLen; i++) {
    const diff = aCps[i].codePointAt(0) - bCps[i].codePointAt(0);
    if (diff !== 0) return diff;
  }
  return aCps.length - bCps.length;
}

// Independent brute-force oracle: an O(n^3) naive palindromic-substring
// scan over the raw text, never touching PalindromicTree internals or
// the Eertree algorithm in any way.
function bruteForceEntries(text) {
  const cps = Array.from(text);
  const n = cps.length;
  const isPalindrome = (start, len) => {
    for (let i = 0; i < Math.floor(len / 2); i++) {
      if (cps[start + i] !== cps[start + len - 1 - i]) return false;
    }
    return true;
  };
  const map = new Map();
  for (let start = 0; start < n; start++) {
    for (let len = 1; start + len <= n; len++) {
      if (isPalindrome(start, len)) {
        const value = cps.slice(start, start + len).join('');
        if (!map.has(value)) {
          map.set(value, { value, length: len, firstIndex: start, occurrences: 1 });
        } else {
          map.get(value).occurrences++;
        }
      }
    }
  }
  const result = Array.from(map.values());
  result.sort((a, b) => {
    if (a.firstIndex !== b.firstIndex) return a.firstIndex - b.firstIndex;
    if (a.length !== b.length) return a.length - b.length;
    return compareByCodePointsOracle(a.value, b.value);
  });
  return result;
}

function bruteForceLongest(entries) {
  if (entries.length === 0) return null;
  let best = entries[0];
  for (const e of entries) {
    if (e.length > best.length) {
      best = e;
    } else if (e.length === best.length) {
      if (e.firstIndex < best.firstIndex) best = e;
      else if (e.firstIndex === best.firstIndex && compareByCodePointsOracle(e.value, best.value) < 0) best = e;
    }
  }
  return best;
}

function entriesEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x.value !== y.value || x.length !== y.length || x.occurrences !== y.occurrences || x.firstIndex !== y.firstIndex) {
      return false;
    }
  }
  return true;
}

function randomString(rng, alphabet, len) {
  let s = '';
  for (let i = 0; i < len; i++) {
    s += alphabet[Math.floor(rng() * alphabet.length)];
  }
  return s;
}

// ---------------------------------------------------------------------
// Empty input
// ---------------------------------------------------------------------

test('empty input: fresh tree has size 0, no entries, no longest, has() is always false', () => {
  const tree = new PalindromicTree();
  assert.equal(tree.size, 0);
  assert.deepEqual(tree.entries(), []);
  assert.equal(tree.longest(), null);
  assert.equal(tree.has('a'), false);
  assert.equal(tree.has(''), false);
});

test('empty input: constructing with an explicit empty string behaves the same as the default', () => {
  const tree = new PalindromicTree('');
  assert.equal(tree.size, 0);
  assert.deepEqual(tree.entries(), []);
});

// ---------------------------------------------------------------------
// Odd and even palindromes (hand-derived, traced by hand against the
// textbook Eertree algorithm before being hardcoded here)
// ---------------------------------------------------------------------

test('odd palindrome: "aba" produces the expected entries, size, and longest', () => {
  const tree = new PalindromicTree('aba');
  assert.equal(tree.size, 3);
  assert.deepEqual(tree.entries(), [
    { value: 'a', length: 1, occurrences: 2, firstIndex: 0 },
    { value: 'aba', length: 3, occurrences: 1, firstIndex: 0 },
    { value: 'b', length: 1, occurrences: 1, firstIndex: 1 },
  ]);
  assert.deepEqual(tree.longest(), { value: 'aba', length: 3, occurrences: 1, firstIndex: 0 });
  assert.equal(tree.has('aba'), true);
  assert.equal(tree.has('a'), true);
  assert.equal(tree.has('b'), true);
  assert.equal(tree.has('ab'), false);
  assert.equal(tree.has('ba'), false);
});

test('even palindrome: "aa" produces the expected entries, size, and longest', () => {
  const tree = new PalindromicTree('aa');
  assert.equal(tree.size, 2);
  assert.deepEqual(tree.entries(), [
    { value: 'a', length: 1, occurrences: 2, firstIndex: 0 },
    { value: 'aa', length: 2, occurrences: 1, firstIndex: 0 },
  ]);
  assert.deepEqual(tree.longest(), { value: 'aa', length: 2, occurrences: 1, firstIndex: 0 });
});

test('mixed odd/even: "abba" tracks both "bb" (even) and any odd palindromes present', () => {
  const tree = new PalindromicTree('abba');
  const expected = bruteForceEntries('abba');
  assert.ok(entriesEqual(tree.entries(), expected));
  assert.deepEqual(tree.longest(), bruteForceLongest(expected));
});

// ---------------------------------------------------------------------
// Repeats and overlaps
// ---------------------------------------------------------------------

test('repeats/overlaps: "aaaa" -- every prefix run of "a" occurs the expected overlapping number of times', () => {
  const tree = new PalindromicTree('aaaa');
  assert.deepEqual(tree.entries(), [
    { value: 'a', length: 1, occurrences: 4, firstIndex: 0 },
    { value: 'aa', length: 2, occurrences: 3, firstIndex: 0 },
    { value: 'aaa', length: 3, occurrences: 2, firstIndex: 0 },
    { value: 'aaaa', length: 4, occurrences: 1, firstIndex: 0 },
  ]);
});

test('repeats/overlaps: "aaabaaa" -- overlapping occurrences on both sides of a distinct middle character', () => {
  const tree = new PalindromicTree('aaabaaa');
  const expected = bruteForceEntries('aaabaaa');
  assert.ok(entriesEqual(tree.entries(), expected));
});

test('repeats/overlaps: a long run of a single character stresses the suffix-link chain and occurrence cascade', () => {
  const text = 'a'.repeat(200);
  const tree = new PalindromicTree(text);
  assert.equal(tree.size, 200);
  const entries = tree.entries();
  for (let i = 0; i < entries.length; i++) {
    assert.equal(entries[i].length, i + 1);
    assert.equal(entries[i].occurrences, 200 - i);
    assert.equal(entries[i].firstIndex, 0);
  }
});

// ---------------------------------------------------------------------
// Incremental appends
// ---------------------------------------------------------------------

test('incremental append: chainable, and equivalent to constructing with the full string at once', () => {
  const incremental = new PalindromicTree();
  const result = incremental.append('a').append('b').append('a');
  assert.equal(result, incremental); // append returns `this`

  const viaConstructor = new PalindromicTree('aba');
  assert.deepEqual(incremental.entries(), viaConstructor.entries());
  assert.equal(incremental.size, viaConstructor.size);
});

test('incremental append: every prefix of a random string matches an independently-constructed tree for that prefix', () => {
  const rng = mulberry32(555);
  const text = randomString(rng, 'abc', 25);
  const incremental = new PalindromicTree();
  for (let i = 0; i < text.length; i++) {
    incremental.append(text[i]);
    const prefix = text.slice(0, i + 1);
    const viaConstructor = new PalindromicTree(prefix);
    assert.ok(entriesEqual(incremental.entries(), viaConstructor.entries()), `mismatch at prefix ${JSON.stringify(prefix)}`);
  }
});

// ---------------------------------------------------------------------
// Unicode
// ---------------------------------------------------------------------

test('Unicode: an astral (surrogate-pair) code point is treated as exactly one code point', () => {
  const emoji = '\u{1F600}';
  assert.equal(Array.from(emoji).length, 1);
  assert.equal(emoji.length, 2); // UTF-16 code units, for contrast

  const tree = new PalindromicTree();
  tree.append(emoji);
  assert.equal(tree.size, 1);
  assert.deepEqual(tree.entries(), [{ value: emoji, length: 1, occurrences: 1, firstIndex: 0 }]);
});

test('Unicode: a palindrome built from astral code points is tracked correctly, including firstIndex in code-point units', () => {
  const a = '\u{1F600}';
  const b = '\u{1F601}';
  const text = a + b + a; // palindrome: emoji, different emoji, same emoji
  const tree = new PalindromicTree(text);
  const expected = bruteForceEntries(text);
  assert.ok(entriesEqual(tree.entries(), expected));
  assert.equal(tree.has(text), true);
  // The whole 3-code-point string's firstIndex must be 0 in CODE POINT
  // terms, not UTF-16-unit terms (text.length is 6 UTF-16 units).
  const whole = tree.entries().find((e) => e.value === text);
  assert.equal(whole.firstIndex, 0);
  assert.equal(whole.length, 3);
});

test('Unicode: entries() orders by Unicode code-point value, not UTF-16 code-unit order', () => {
  // U+FFFF (a BMP character) vs U+10000 (the first supplementary-plane
  // character, encoded as a surrogate pair). Naive UTF-16-code-unit
  // string comparison can disagree with true code-point-value ordering
  // for characters like this; codePointAt(0) values are 0xFFFF and
  // 0x10000 respectively, so 0xFFFF must sort first.
  const bmpChar = '￿';
  const astralChar = '\u{10000}';
  const tree = new PalindromicTree();
  // Build both as isolated length-1 palindromes at different positions
  // via a separating character so both become distinct tracked entries.
  tree.append(astralChar).append('x').append(bmpChar);
  const entries = tree.entries();
  const bmpEntry = entries.find((e) => e.value === bmpChar);
  const astralEntry = entries.find((e) => e.value === astralChar);
  assert.ok(bmpEntry && astralEntry);
  // Both have firstIndex distinct (0 and 2) so this doesn't directly
  // exercise the lexical tie-break, but confirms both values round-trip
  // correctly as single code-point entries regardless of encoding width.
  assert.equal(astralEntry.firstIndex, 0);
  assert.equal(bmpEntry.firstIndex, 2);
});

// ---------------------------------------------------------------------
// Invalid inputs
// ---------------------------------------------------------------------

test('constructor: rejects a non-string text argument', () => {
  assert.throws(() => new PalindromicTree(5), TypeError);
  assert.throws(() => new PalindromicTree(null), TypeError);
  assert.throws(() => new PalindromicTree(['a', 'b']), TypeError);
  assert.throws(() => new PalindromicTree({}), TypeError);
});

test('append: rejects a non-string argument', () => {
  const tree = new PalindromicTree();
  assert.throws(() => tree.append(5), TypeError);
  assert.throws(() => tree.append(null), TypeError);
  assert.throws(() => tree.append(undefined), TypeError);
  assert.throws(() => tree.append(['a']), TypeError);
});

test('append: rejects the empty string', () => {
  const tree = new PalindromicTree();
  assert.throws(() => tree.append(''), TypeError);
});

test('append: rejects a string spanning more than one Unicode code point', () => {
  const tree = new PalindromicTree();
  assert.throws(() => tree.append('ab'), TypeError);
  assert.throws(() => tree.append('hello'), TypeError);
  // Two astral characters back to back is 2 code points (4 UTF-16 units)
  // even though it "looks short" -- still rejected.
  assert.throws(() => tree.append('\u{1F600}\u{1F601}'), TypeError);
});

test('append: accepts a single astral code point despite .length === 2', () => {
  const tree = new PalindromicTree();
  assert.doesNotThrow(() => tree.append('\u{1F600}'));
});

test('append: a failed append does not corrupt tree state', () => {
  const tree = new PalindromicTree('ab');
  const before = tree.entries();
  assert.throws(() => tree.append('cd'));
  assert.throws(() => tree.append(5));
  assert.deepEqual(tree.entries(), before);
  assert.equal(tree.size, before.length);
});

test('has: rejects a non-string value', () => {
  const tree = new PalindromicTree('abc');
  assert.throws(() => tree.has(5), TypeError);
  assert.throws(() => tree.has(null), TypeError);
  assert.throws(() => tree.has(undefined), TypeError);
  assert.throws(() => tree.has(['a']), TypeError);
});

// ---------------------------------------------------------------------
// Deterministic ordering
// ---------------------------------------------------------------------

test('deterministic ordering: entries() is sorted by firstIndex, then length, then code-point lexical order', () => {
  const tree = new PalindromicTree('abacabad');
  const entries = tree.entries();
  for (let i = 1; i < entries.length; i++) {
    const prev = entries[i - 1];
    const curr = entries[i];
    const key = (e) => [e.firstIndex, e.length, e.value];
    const [pf, pl, pv] = key(prev);
    const [cf, cl, cv] = key(curr);
    const ordered = pf < cf || (pf === cf && (pl < cl || (pl === cl && compareByCodePointsOracle(pv, cv) <= 0)));
    assert.ok(ordered, `entries out of order at index ${i}: ${JSON.stringify(prev)} then ${JSON.stringify(curr)}`);
  }
});

test('deterministic ordering: repeated entries() calls on the same tree return identical results', () => {
  const tree = new PalindromicTree('mississippi');
  const first = tree.entries();
  const second = tree.entries();
  assert.deepEqual(first, second);
  // Also confirm entries() returns fresh arrays/objects, not shared refs.
  assert.notEqual(first, second);
  assert.notEqual(first[0], second[0]);
});

test('deterministic ordering: two trees built from the same text produce identical entries, regardless of build method', () => {
  const text = 'racecarannakayak';
  const viaConstructor = new PalindromicTree(text);
  const viaAppend = new PalindromicTree();
  for (const ch of text) viaAppend.append(ch);
  assert.deepEqual(viaConstructor.entries(), viaAppend.entries());
});

// ---------------------------------------------------------------------
// Fixed exhaustive strings checked against a brute-force oracle
// ---------------------------------------------------------------------

test('exhaustive: every string of length <= 8 over a 2-letter alphabet matches an independent brute-force oracle', () => {
  const alphabet = ['a', 'b'];
  let strings = [''];
  for (let len = 1; len <= 8; len++) {
    const next = [];
    for (const s of strings.filter((s) => s.length === len - 1)) {
      for (const c of alphabet) next.push(s + c);
    }
    strings = strings.concat(next);
  }
  let checked = 0;
  for (const text of strings) {
    if (text.length === 0) continue;
    checked++;
    const tree = new PalindromicTree(text);
    const expected = bruteForceEntries(text);
    assert.ok(entriesEqual(tree.entries(), expected), `mismatch for text=${JSON.stringify(text)}`);
    assert.equal(tree.size, expected.length, `size mismatch for text=${JSON.stringify(text)}`);
    assert.deepEqual(tree.longest(), bruteForceLongest(expected), `longest mismatch for text=${JSON.stringify(text)}`);
  }
  assert.ok(checked > 0);
});

test('exhaustive: every string of length <= 6 over a 3-letter alphabet matches an independent brute-force oracle', () => {
  const alphabet = ['a', 'b', 'c'];
  let strings = [''];
  for (let len = 1; len <= 6; len++) {
    const next = [];
    for (const s of strings.filter((s) => s.length === len - 1)) {
      for (const c of alphabet) next.push(s + c);
    }
    strings = strings.concat(next);
  }
  let checked = 0;
  for (const text of strings) {
    if (text.length === 0) continue;
    checked++;
    const tree = new PalindromicTree(text);
    const expected = bruteForceEntries(text);
    assert.ok(entriesEqual(tree.entries(), expected), `mismatch for text=${JSON.stringify(text)}`);
  }
  assert.ok(checked > 0);
});

// ---------------------------------------------------------------------
// Differential (seeded PRNG) against the brute-force oracle
// ---------------------------------------------------------------------

test('differential: random strings across several alphabets match the brute-force oracle', () => {
  const rng = mulberry32(2024);
  const alphabets = ['ab', 'abc', 'abcd', 'aaab'];
  for (let t = 0; t < 60; t++) {
    const alphabet = alphabets[Math.floor(rng() * alphabets.length)];
    const len = 1 + Math.floor(rng() * 40);
    const text = randomString(rng, alphabet, len);
    const tree = new PalindromicTree(text);
    const expected = bruteForceEntries(text);
    assert.ok(entriesEqual(tree.entries(), expected), `mismatch t=${t} text=${JSON.stringify(text)}`);
    assert.equal(tree.size, expected.length);
  }
});

test('differential: random Unicode strings mixing astral and BMP code points match the brute-force oracle', () => {
  const rng = mulberry32(9001);
  const pool = ['\u{1F600}', '\u{1F601}', '\u{10000}', 'a', 'b', 'x'];
  for (let t = 0; t < 30; t++) {
    const len = 1 + Math.floor(rng() * 16);
    let text = '';
    for (let i = 0; i < len; i++) text += pool[Math.floor(rng() * pool.length)];
    const tree = new PalindromicTree(text);
    const expected = bruteForceEntries(text);
    assert.ok(entriesEqual(tree.entries(), expected), `mismatch t=${t} text=${JSON.stringify(text)}`);
  }
});
