'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { SuffixArrayIndex } = require('./suffix-array-index.js');

// ---- Reference (naive/brute-force) implementations, used only by the
// deterministic comparison suite at the bottom of this file. ----

function naiveSuffixArray(text) {
  const n = text.length;
  const idx = Array.from({ length: n }, (_, i) => i);
  idx.sort((a, b) => {
    const sa = text.slice(a);
    const sb = text.slice(b);
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  });
  return idx;
}

function naiveLcpArray(text, sa) {
  const n = sa.length;
  const lcp = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const a = text.slice(sa[i - 1]);
    const b = text.slice(sa[i]);
    let l = 0;
    while (l < a.length && l < b.length && a[l] === b[l]) l++;
    lcp[i] = l;
  }
  return lcp;
}

function naiveSearch(text, pattern) {
  if (pattern.length === 0) {
    const r = [];
    for (let i = 0; i <= text.length; i++) r.push(i);
    return r;
  }
  const r = [];
  for (let i = 0; i + pattern.length <= text.length; i++) {
    if (text.slice(i, i + pattern.length) === pattern) r.push(i);
  }
  return r;
}

test('empty text', () => {
  const idx = new SuffixArrayIndex('');
  assert.deepEqual(idx.suffixArray(), []);
  assert.deepEqual(idx.lcpArray(), []);
  // empty pattern on empty text: boundary 0 through text.length(=0) inclusive => [0]
  assert.deepEqual(idx.search(''), [0]);
  // any non-empty pattern can't occur in empty text
  assert.deepEqual(idx.search('a'), []);
  assert.deepEqual(idx.search('xyz'), []);
});

test('single-character text', () => {
  const idx = new SuffixArrayIndex('a');
  assert.deepEqual(idx.suffixArray(), [0]);
  assert.deepEqual(idx.lcpArray(), [0]);
  assert.deepEqual(idx.search('a'), [0]);
  assert.deepEqual(idx.search('b'), []);
  assert.deepEqual(idx.search(''), [0, 1]);
  assert.deepEqual(idx.search('aa'), []); // pattern longer than text
});

test('repeated characters', () => {
  const idx = new SuffixArrayIndex('aaaa');
  // suffixes: "aaaa"(0) "aaa"(1) "aa"(2) "a"(3) -- sorted ascending: shortest-first
  // since every suffix is a prefix of a longer one, shorter sorts first.
  assert.deepEqual(idx.suffixArray(), [3, 2, 1, 0]);
  assert.deepEqual(idx.lcpArray(), [0, 1, 2, 3]);
  assert.deepEqual(idx.search('a'), [0, 1, 2, 3]);
  assert.deepEqual(idx.search('aa'), [0, 1, 2]);
  assert.deepEqual(idx.search('aaa'), [0, 1]);
  assert.deepEqual(idx.search('aaaa'), [0]);
  assert.deepEqual(idx.search('aaaaa'), []);
});

test('overlapping matches are all reported', () => {
  const idx = new SuffixArrayIndex('aaaaa');
  assert.deepEqual(idx.search('aa'), [0, 1, 2, 3]);
  const idx2 = new SuffixArrayIndex('abababab');
  assert.deepEqual(idx2.search('aba'), [0, 2, 4]);
  assert.deepEqual(idx2.search('bab'), [1, 3, 5]);
});

test('absent patterns return empty array', () => {
  const idx = new SuffixArrayIndex('mississippi');
  assert.deepEqual(idx.search('z'), []);
  assert.deepEqual(idx.search('xyz'), []);
  assert.deepEqual(idx.search('ssiss'), [2]);
  assert.deepEqual(idx.search('ppp'), []); // 'pp' occurs but not 'ppp'
});

test('full-string match', () => {
  const idx = new SuffixArrayIndex('banana');
  assert.deepEqual(idx.search('banana'), [0]);
  assert.deepEqual(idx.search('banana!'), []); // longer than text
});

test('whitespace handling', () => {
  const idx = new SuffixArrayIndex('foo bar  baz\tqux');
  assert.deepEqual(idx.search(' '), naiveSearch('foo bar  baz\tqux', ' '));
  assert.deepEqual(idx.search('  '), naiveSearch('foo bar  baz\tqux', '  '));
  assert.deepEqual(idx.search('\t'), naiveSearch('foo bar  baz\tqux', '\t'));
  assert.deepEqual(idx.search('bar'), [4]);
});

test('BMP Unicode handling', () => {
  const text = 'café niño 日本語 日本語';
  const idx = new SuffixArrayIndex(text);
  assert.deepEqual(idx.suffixArray(), naiveSuffixArray(text));
  assert.deepEqual(idx.lcpArray(), naiveLcpArray(text, idx.suffixArray()));
  assert.deepEqual(idx.search('é'), naiveSearch(text, 'é'));
  assert.deepEqual(idx.search('日本語'), naiveSearch(text, '日本語'));
  assert.deepEqual(idx.search('日本語'), [10, 14]);
  assert.deepEqual(idx.search('ñ'), [7]);
});

test('astral (surrogate-pair) characters use UTF-16 code-unit semantics', () => {
  // U+1F600 (grinning face) is a surrogate pair in UTF-16: two code units.
  const text = '\u{1F600}\u{1F600}x';
  const idx = new SuffixArrayIndex(text);
  assert.equal(text.length, 5); // 2 + 2 + 1 code units
  assert.deepEqual(idx.suffixArray(), naiveSuffixArray(text));
  assert.deepEqual(idx.lcpArray(), naiveLcpArray(text, idx.suffixArray()));
  // the lone leading surrogate half (text[0] === text[2]) is independently matchable
  const leadHalf = text[0];
  assert.deepEqual(idx.search(leadHalf), naiveSearch(text, leadHalf));
  assert.deepEqual(idx.search(leadHalf), [0, 2]);
  assert.deepEqual(idx.search('\u{1F600}'), [0, 2]);
});

test('invalid constructor input throws TypeError', () => {
  const badInputs = [123, null, undefined, {}, [], true, Symbol('x'), 1.5];
  for (const bad of badInputs) {
    assert.throws(() => new SuffixArrayIndex(bad), TypeError);
  }
});

test('invalid search input throws TypeError', () => {
  const idx = new SuffixArrayIndex('hello world');
  const badInputs = [123, null, undefined, {}, [], true, Symbol('x'), 1.5];
  for (const bad of badInputs) {
    assert.throws(() => idx.search(bad), TypeError);
  }
});

test('repeated calls are deterministic and idempotent', () => {
  const idx = new SuffixArrayIndex('mississippi');
  const sa1 = idx.suffixArray();
  const sa2 = idx.suffixArray();
  assert.deepEqual(sa1, sa2);
  const lcp1 = idx.lcpArray();
  const lcp2 = idx.lcpArray();
  assert.deepEqual(lcp1, lcp2);
  const s1 = idx.search('issi');
  const s2 = idx.search('issi');
  assert.deepEqual(s1, s2);
});

test('returned arrays are fresh copies (mutation does not affect the index)', () => {
  const idx = new SuffixArrayIndex('banana');
  const sa = idx.suffixArray();
  sa[0] = 999;
  sa.push(12345);
  assert.notDeepEqual(idx.suffixArray(), sa);
  assert.equal(idx.suffixArray()[0] === 999, false);

  const lcp = idx.lcpArray();
  lcp[0] = 999;
  lcp.push(12345);
  assert.notDeepEqual(idx.lcpArray(), lcp);

  const searched = idx.search('an');
  const originalLen = searched.length;
  searched.push(999999);
  assert.equal(idx.search('an').length, originalLen);
});

test('deterministic comparison against naive oracle, fixed set of strings', () => {
  const strings = [
    '',
    'a',
    'aa',
    'ab',
    'aaaa',
    'abab',
    'abcabc',
    'banana',
    'mississippi',
    'abcdefg',
    'aaaaaaaaaa',
    'zyxwvutsrqponmlkjihgfedcba',
    'the quick brown fox jumps over the lazy dog',
    'aabbccaabbcc',
    'xyzxyzxyzxyz',
  ];

  const patterns = ['', 'a', 'b', 'ab', 'ba', 'abc', 'xyz', 'issi', 'z', 'aa', 'the', ' '];

  for (const text of strings) {
    const idx = new SuffixArrayIndex(text);
    const expectedSA = naiveSuffixArray(text);
    assert.deepEqual(idx.suffixArray(), expectedSA, `suffixArray mismatch for ${JSON.stringify(text)}`);
    const expectedLcp = naiveLcpArray(text, expectedSA);
    assert.deepEqual(idx.lcpArray(), expectedLcp, `lcpArray mismatch for ${JSON.stringify(text)}`);

    for (const pattern of patterns) {
      const got = idx.search(pattern);
      const want = naiveSearch(text, pattern);
      assert.deepEqual(
        got,
        want,
        `search mismatch for text=${JSON.stringify(text)} pattern=${JSON.stringify(pattern)}`
      );
    }
  }
});

test('fixed-seed randomized comparison against naive oracle', () => {
  // Simple deterministic LCG so this test is reproducible without any
  // external randomness dependency.
  function makeRng(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  const rng = makeRng(20260807);
  const alphabets = ['ab', 'abc', 'abcdefghij'];

  for (let trial = 0; trial < 60; trial++) {
    const alphabet = alphabets[Math.floor(rng() * alphabets.length)];
    const len = Math.floor(rng() * 25);
    let text = '';
    for (let i = 0; i < len; i++) text += alphabet[Math.floor(rng() * alphabet.length)];

    const idx = new SuffixArrayIndex(text);
    assert.deepEqual(idx.suffixArray(), naiveSuffixArray(text));
    const sa = idx.suffixArray();
    assert.deepEqual(idx.lcpArray(), naiveLcpArray(text, sa));

    for (let p = 0; p < 6; p++) {
      let pattern;
      if (rng() < 0.5 && text.length > 0) {
        const start = Math.floor(rng() * text.length);
        const plen = Math.floor(rng() * (text.length - start + 1));
        pattern = text.slice(start, start + plen);
      } else {
        const plen = Math.floor(rng() * 4);
        pattern = '';
        for (let i = 0; i < plen; i++) pattern += alphabet[Math.floor(rng() * alphabet.length)];
      }
      assert.deepEqual(
        idx.search(pattern),
        naiveSearch(text, pattern),
        `search mismatch for text=${JSON.stringify(text)} pattern=${JSON.stringify(pattern)}`
      );
    }
  }
});
