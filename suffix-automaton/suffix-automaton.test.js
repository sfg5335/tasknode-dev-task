'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { SuffixAutomaton } = require('./suffix-automaton.js');

/** O(n^2) reference: true iff pattern occurs as a substring of text. */
function bruteHas(text, pattern) {
  return text.includes(pattern);
}

/** O(n*m) reference: count of (possibly overlapping) occurrences. */
function bruteOccurrences(text, pattern) {
  if (pattern.length === 0) return text.length + 1;
  let count = 0;
  for (let i = 0; i + pattern.length <= text.length; i++) {
    if (text.slice(i, i + pattern.length) === pattern) count++;
  }
  return count;
}

/** O(n^3)-ish reference: number of distinct non-empty substrings, via a Set. */
function bruteDistinctSubstrings(text) {
  const set = new Set();
  for (let i = 0; i < text.length; i++) {
    for (let j = i + 1; j <= text.length; j++) set.add(text.slice(i, j));
  }
  return set.size;
}

/** O(m^3)-ish reference: longest common substring, scanning candidate
 * lengths from longest to shortest and, within a length, candidate start
 * positions in `other` from earliest to latest -- so the first match found
 * is automatically both maximal-length and earliest-in-`other`. */
function bruteLongestCommonSubstring(text, other) {
  for (let len = other.length; len >= 1; len--) {
    for (let start = 0; start + len <= other.length; start++) {
      const candidate = other.slice(start, start + len);
      if (text.includes(candidate)) return candidate;
    }
  }
  return '';
}

test('empty text: has/occurrences/countDistinctSubstrings/longestCommonSubstring all behave per spec', () => {
  const sam = new SuffixAutomaton('');
  assert.equal(sam.has(''), true, 'the empty pattern is always a substring, even of the empty string');
  assert.equal(sam.has('x'), false);
  assert.equal(sam.occurrences(''), 0 + 1, 'empty pattern occurrences = text.length + 1');
  assert.equal(sam.occurrences('x'), 0);
  assert.equal(sam.countDistinctSubstrings(), 0);
  assert.equal(sam.longestCommonSubstring(''), '');
  assert.equal(sam.longestCommonSubstring('abc'), '');
});

test('non-empty text against an empty `other`: longestCommonSubstring is always empty', () => {
  const sam = new SuffixAutomaton('abcdef');
  assert.equal(sam.longestCommonSubstring(''), '');
});

test('single-character text', () => {
  const sam = new SuffixAutomaton('a');
  assert.equal(sam.has('a'), true);
  assert.equal(sam.has(''), true);
  assert.equal(sam.has('b'), false);
  assert.equal(sam.has('aa'), false);
  assert.equal(sam.occurrences('a'), 1);
  assert.equal(sam.occurrences(''), 2);
  assert.equal(sam.countDistinctSubstrings(), 1);
});

test('unique-character text: every substring occurs exactly once', () => {
  const sam = new SuffixAutomaton('abcdefg');
  for (let i = 0; i < 7; i++) {
    for (let j = i + 1; j <= 7; j++) {
      const sub = 'abcdefg'.slice(i, j);
      assert.equal(sam.has(sub), true, sub);
      assert.equal(sam.occurrences(sub), 1, sub);
    }
  }
  // 7 + 6 + 5 + 4 + 3 + 2 + 1 = 28 distinct non-empty substrings, since no
  // two substrings of a strictly-increasing-character string can collide.
  assert.equal(sam.countDistinctSubstrings(), 28);
});

test('repeated and overlapping occurrences are counted correctly', () => {
  const sam = new SuffixAutomaton('aaaa');
  assert.equal(sam.occurrences('a'), 4);
  assert.equal(sam.occurrences('aa'), 3, 'overlapping: positions 0-1, 1-2, 2-3');
  assert.equal(sam.occurrences('aaa'), 2);
  assert.equal(sam.occurrences('aaaa'), 1);
  assert.equal(sam.occurrences('aaaaa'), 0, 'longer than the text itself');
  assert.equal(sam.countDistinctSubstrings(), 4, "'a', 'aa', 'aaa', 'aaaa'");

  const banana = new SuffixAutomaton('banana');
  assert.equal(banana.occurrences('a'), 3);
  assert.equal(banana.occurrences('an'), 2);
  assert.equal(banana.occurrences('ana'), 2, 'overlapping: banANAna and banaNAna');
  assert.equal(banana.occurrences('na'), 2);
  assert.equal(banana.occurrences('banana'), 1);
  assert.equal(banana.has('nan'), true);
  assert.equal(banana.occurrences('nan'), 1);
});

test('absent patterns: has() is false and occurrences() is 0', () => {
  const sam = new SuffixAutomaton('mississippi');
  for (const p of ['z', 'xyz', 'ssippian', 'mississippian', 'MISS']) {
    assert.equal(sam.has(p), false, p);
    assert.equal(sam.occurrences(p), 0, p);
  }
});

test('Unicode: operates on UTF-16 code units, so an astral character (surrogate pair) is two units', () => {
  const emoji = '\u{1F600}'; // '😀', a single Unicode code point, two UTF-16 code units
  assert.equal(emoji.length, 2);
  const text = `a${emoji}b${emoji}c`;
  const sam = new SuffixAutomaton(text);
  assert.equal(sam.has(emoji), true);
  assert.equal(sam.occurrences(emoji), 2);
  // The lone leading surrogate half is itself a valid "pattern" under
  // UTF-16-code-unit semantics (not a Unicode-code-point view), and it
  // occurs twice too, since it's the first unit of each emoji occurrence.
  const highSurrogate = emoji[0];
  assert.equal(sam.has(highSurrogate), true);
  assert.equal(sam.occurrences(highSurrogate), 2);
  assert.equal(sam.has(emoji + 'b'), true);
  assert.equal(sam.occurrences(emoji + 'b'), 1);
  // Cross-checked against the brute-force reference, which also operates
  // on plain JS string slicing (i.e. UTF-16 code units) by construction.
  for (const p of [emoji, highSurrogate, emoji[1], 'a' + emoji, emoji + 'c', 'nonexistent']) {
    assert.equal(sam.occurrences(p), bruteOccurrences(text, p), p);
  }
});

test('longestCommonSubstring: tie-breaking picks the earliest position in `other`', () => {
  const sam = new SuffixAutomaton('ABCXYZ');
  // 'ABC' and 'XYZ' are both length-3 substrings of the automaton's text.
  // In `other`, 'ABC' starts at index 0 and 'XYZ' starts at index 5 -- the
  // earlier one, 'ABC', must be returned even though both are tied for
  // longest.
  const other = 'ABCwwXYZ';
  assert.equal(sam.longestCommonSubstring(other), 'ABC');

  // Reversed: now 'XYZ' comes first in `other`, so it must win instead,
  // even though it's the exact same pair of candidate substrings.
  const otherReversed = 'XYZwwABC';
  assert.equal(sam.longestCommonSubstring(otherReversed), 'XYZ');
});

test('longestCommonSubstring: basic correctness beyond the tie-break case', () => {
  const sam = new SuffixAutomaton('ABABC');
  assert.equal(sam.longestCommonSubstring('BABCD'), 'BABC');
  assert.equal(sam.longestCommonSubstring('ZZZ'), '');
  assert.equal(sam.longestCommonSubstring('C'), 'C');
  assert.equal(sam.longestCommonSubstring('ABABC'), 'ABABC', 'a string is its own longest common substring with itself');
});

test('invalid constructor input throws TypeError', () => {
  assert.throws(() => new SuffixAutomaton(123), TypeError);
  assert.throws(() => new SuffixAutomaton(null), TypeError);
  assert.throws(() => new SuffixAutomaton(undefined), TypeError);
  assert.throws(() => new SuffixAutomaton(['a', 'b']), TypeError);
  assert.throws(() => new SuffixAutomaton({}), TypeError);
  assert.throws(() => new SuffixAutomaton(true), TypeError);
});

test('invalid method arguments throw TypeError', () => {
  const sam = new SuffixAutomaton('hello world');
  for (const bad of [123, null, undefined, ['h'], {}, true, Symbol('x')]) {
    assert.throws(() => sam.has(bad), TypeError, `has(${String(bad)})`);
    assert.throws(() => sam.occurrences(bad), TypeError, `occurrences(${String(bad)})`);
    assert.throws(() => sam.longestCommonSubstring(bad), TypeError, `longestCommonSubstring(${String(bad)})`);
  }
});

test('repeated calls are side-effect-free and always agree with each other', () => {
  const sam = new SuffixAutomaton('abracadabra');
  const first = [sam.has('abra'), sam.occurrences('abra'), sam.countDistinctSubstrings(), sam.longestCommonSubstring('cadabrax')];
  const second = [sam.has('abra'), sam.occurrences('abra'), sam.countDistinctSubstrings(), sam.longestCommonSubstring('cadabrax')];
  assert.deepEqual(first, second);
});

test('fixed deterministic comparisons against brute-force results for short strings', () => {
  const texts = [
    '',
    'a',
    'aa',
    'aaa',
    'ab',
    'aba',
    'abab',
    'abcabcabc',
    'banana',
    'mississippi',
    'abcdefg',
    'aaaaaaaaaa',
    'xyzxyzxyz',
    'zzzzzzzzzzzz',
    'abracadabra',
  ];

  for (const text of texts) {
    const sam = new SuffixAutomaton(text);

    // Every substring of `text`, plus a couple of guaranteed-absent
    // patterns, checked against the brute-force has()/occurrences().
    const patterns = new Set(['', 'not_in_any_of_these_texts', 'q']);
    for (let i = 0; i <= text.length; i++) {
      for (let j = i; j <= text.length; j++) patterns.add(text.slice(i, j));
    }
    for (const pattern of patterns) {
      assert.equal(sam.has(pattern), bruteHas(text, pattern), `has: text=${JSON.stringify(text)} pattern=${JSON.stringify(pattern)}`);
      assert.equal(
        sam.occurrences(pattern),
        bruteOccurrences(text, pattern),
        `occurrences: text=${JSON.stringify(text)} pattern=${JSON.stringify(pattern)}`
      );
    }

    assert.equal(
      sam.countDistinctSubstrings(),
      bruteDistinctSubstrings(text),
      `countDistinctSubstrings: text=${JSON.stringify(text)}`
    );

    // Cross product against every other fixed text as the `other` argument.
    for (const other of texts) {
      assert.equal(
        sam.longestCommonSubstring(other),
        bruteLongestCommonSubstring(text, other),
        `longestCommonSubstring: text=${JSON.stringify(text)} other=${JSON.stringify(other)}`
      );
    }
  }
});
