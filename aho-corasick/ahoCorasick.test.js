'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AhoCorasick } = require('./ahoCorasick.js');

test('constructor rejects invalid patterns arguments', () => {
  assert.throws(() => new AhoCorasick('nope'), TypeError); // not an array
  assert.throws(() => new AhoCorasick(null), TypeError);
  assert.throws(() => new AhoCorasick(undefined), TypeError);
  assert.throws(() => new AhoCorasick([1, 2]), TypeError); // non-string entries
  assert.throws(() => new AhoCorasick(['a', 5]), TypeError);
  assert.throws(() => new AhoCorasick(['a', null]), TypeError);
  assert.throws(() => new AhoCorasick(['']), TypeError); // empty-string pattern
  assert.throws(() => new AhoCorasick(['a', '']), TypeError);
});

test('constructor rejects duplicate patterns', () => {
  assert.throws(() => new AhoCorasick(['a', 'a']), TypeError);
  assert.throws(() => new AhoCorasick(['ab', 'cd', 'ab']), TypeError);
});

test('empty patterns array is valid: search() always returns no matches', () => {
  const ac = new AhoCorasick([]);
  assert.deepEqual(ac.search(''), []);
  assert.deepEqual(ac.search('anything at all'), []);
});

test('search() rejects a non-string text argument', () => {
  const ac = new AhoCorasick(['a']);
  assert.throws(() => ac.search(42), TypeError);
  assert.throws(() => ac.search(null), TypeError);
  assert.throws(() => ac.search(undefined), TypeError);
  assert.throws(() => ac.search(['a']), TypeError);
});

test('empty text input: search() returns no matches regardless of patterns', () => {
  const ac = new AhoCorasick(['a', 'bb', 'ccc']);
  assert.deepEqual(ac.search(''), []);
});

test('no patterns occur in text: search() returns no matches', () => {
  const ac = new AhoCorasick(['xyz', 'qrs']);
  assert.deepEqual(ac.search('the quick brown fox'), []);
});

test('canonical multi-pattern matching example (classic Aho-Corasick textbook case)', () => {
  // patterns: he, she, his, hers -- text: "ushers"
  // "she" matches [1,4), "he" matches [2,4) (inside "she"), "hers" matches [2,6).
  // "his" does not occur.
  const ac = new AhoCorasick(['he', 'she', 'his', 'hers']);
  const matches = ac.search('ushers');
  assert.deepEqual(matches, [
    { pattern: 'she', start: 1, end: 4 },
    { pattern: 'he', start: 2, end: 4 },
    { pattern: 'hers', start: 2, end: 6 },
  ]);
});

test('end-exclusive indices: match.end - match.start === pattern.length, and text.slice(start,end) === pattern', () => {
  const ac = new AhoCorasick(['he', 'she', 'his', 'hers']);
  const text = 'ushers';
  for (const m of ac.search(text)) {
    assert.equal(m.end - m.start, m.pattern.length);
    assert.equal(text.slice(m.start, m.end), m.pattern);
  }
});

test('overlapping matches of the same repeating pattern are all reported', () => {
  const ac = new AhoCorasick(['aa']);
  assert.deepEqual(ac.search('aaaa'), [
    { pattern: 'aa', start: 0, end: 2 },
    { pattern: 'aa', start: 1, end: 3 },
    { pattern: 'aa', start: 2, end: 4 },
  ]);
});

test('overlapping matches of different patterns at the same position are all reported', () => {
  // 'a', 'ab', 'abc' all start at index 0 in "abc" and each ends at a
  // different position -- all three must be reported.
  const ac = new AhoCorasick(['a', 'ab', 'abc']);
  const matches = ac.search('abc');
  assert.deepEqual(matches, [
    { pattern: 'a', start: 0, end: 1 },
    { pattern: 'ab', start: 0, end: 2 },
    { pattern: 'abc', start: 0, end: 3 },
  ]);
});

test('suffix matches: a pattern that is a proper suffix of another match is reported via the output-link chain', () => {
  // 'a', 'ba', 'cba' -- text 'cba': all three are suffixes of the full
  // text and all end at position 3. The automaton discovers them via a
  // single output-link walk from the deepest node ('cba') down to
  // shorter suffixes ('ba', then 'a') at that same text position, but
  // final results are sorted by ascending start index per the task spec
  // ("order results by start index and then original pattern order"),
  // so the reported order is 'cba' (start 0), 'ba' (start 1), 'a' (start 2).
  const ac = new AhoCorasick(['a', 'ba', 'cba']);
  const matches = ac.search('cba');
  assert.deepEqual(matches, [
    { pattern: 'cba', start: 0, end: 3 },
    { pattern: 'ba', start: 1, end: 3 },
    { pattern: 'a', start: 2, end: 3 },
  ]);
});

test('repeated searches on the same instance are stable and side-effect-free (no state leakage between calls)', () => {
  const ac = new AhoCorasick(['ab', 'b', 'bc']);
  const first = ac.search('abc');
  const second = ac.search('abc');
  const third = ac.search('abc');
  assert.deepEqual(first, second);
  assert.deepEqual(second, third);
  assert.deepEqual(first, [
    { pattern: 'ab', start: 0, end: 2 },
    { pattern: 'b', start: 1, end: 2 },
    { pattern: 'bc', start: 1, end: 3 },
  ]);

  // Searching a completely different string afterwards must not be
  // affected by the previous calls, and searching 'abc' again afterwards
  // must still produce the identical result.
  assert.deepEqual(ac.search('zzz'), []);
  assert.deepEqual(ac.search('abc'), first);
});

test('deterministic ordering: matches are ordered by start index, then by original pattern-array order on ties', () => {
  // Any two distinct patterns that share a start position necessarily
  // differ in length (and thus in end position), so the automaton's
  // natural left-to-right discovery order alone would sort same-start
  // matches by ascending end position. To isolate the spec's actual
  // tie-break rule ("start index, then original pattern order") from
  // that natural end-position ordering, run the *same* same-start pair
  // ('a' and 'ab', both starting at index 0 in text "ab") under both
  // declaration orders and confirm the reported order flips to track
  // declaration order rather than staying fixed by pattern length.

  // 'a' declared first (index 0), 'ab' declared second (index 1):
  // original-pattern-order tie-break puts 'a' first.
  const ac1 = new AhoCorasick(['a', 'ab']);
  assert.deepEqual(ac1.search('ab'), [
    { pattern: 'a', start: 0, end: 1 },
    { pattern: 'ab', start: 0, end: 2 },
  ]);

  // 'ab' declared first (index 0), 'a' declared second (index 1): the
  // tie-break now puts 'ab' first -- the reverse of the case above,
  // proving the order is driven by declaration order and not by length
  // or end position (which are identical to the case above).
  const ac2 = new AhoCorasick(['ab', 'a']);
  assert.deepEqual(ac2.search('ab'), [
    { pattern: 'ab', start: 0, end: 2 },
    { pattern: 'a', start: 0, end: 1 },
  ]);
});

test('multiple distinct match positions across a longer text are all found, ordered by start', () => {
  const ac = new AhoCorasick(['cat', 'dog', 'at']);
  const text = 'the cat sat on the dog';
  const matches = ac.search(text);
  // 'cat' at 4-7, 'at' at 5-7 (inside 'cat'), 'at' at 9-11 (inside 'sat'), 'dog' at 19-22.
  assert.deepEqual(matches, [
    { pattern: 'cat', start: 4, end: 7 },
    { pattern: 'at', start: 5, end: 7 },
    { pattern: 'at', start: 9, end: 11 },
    { pattern: 'dog', start: 19, end: 22 },
  ]);
});

test('single-character patterns and a pattern equal to the entire text both work', () => {
  const ac = new AhoCorasick(['x']);
  assert.deepEqual(ac.search('xxx'), [
    { pattern: 'x', start: 0, end: 1 },
    { pattern: 'x', start: 1, end: 2 },
    { pattern: 'x', start: 2, end: 3 },
  ]);

  const ac2 = new AhoCorasick(['hello']);
  assert.deepEqual(ac2.search('hello'), [{ pattern: 'hello', start: 0, end: 5 }]);
});

test('deterministic cross-check against an independent brute-force reference implementation', () => {
  // Reference model: naive O(text * patterns * patternLength) scan --
  // for every start index and every pattern, check if it occurs there.
  // Deliberately simple/obviously-correct, structurally unrelated to the
  // trie+fail-links+output-links approach under test.
  function bruteForceSearch(patterns, text) {
    const out = [];
    for (let i = 0; i < text.length; i++) {
      for (let p = 0; p < patterns.length; p++) {
        const pat = patterns[p];
        if (text.startsWith(pat, i)) {
          out.push({ pattern: pat, start: i, end: i + pat.length, patternIndex: p });
        }
      }
    }
    out.sort((a, b) => a.start - b.start || a.patternIndex - b.patternIndex);
    return out.map(({ pattern, start, end }) => ({ pattern, start, end }));
  }

  const cases = [
    { patterns: ['he', 'she', 'his', 'hers'], text: 'ushers' },
    { patterns: ['a', 'ab', 'abc', 'bc', 'c'], text: 'abcabcabc' },
    { patterns: ['aa', 'aaa', 'a'], text: 'aaaaaa' },
    { patterns: ['cat', 'dog', 'at', 'og', 'the'], text: 'the cat sat on the dog with the cat' },
    { patterns: ['xyz'], text: 'no match here at all' },
    { patterns: ['ab', 'ba'], text: 'abababab' },
    { patterns: ['needle'], text: 'needleinahaystackneedle' },
    { patterns: [], text: 'abc' },
    { patterns: ['a'], text: '' },
  ];

  for (const { patterns, text } of cases) {
    const ac = new AhoCorasick(patterns);
    const actual = ac.search(text);
    const expected = bruteForceSearch(patterns, text);
    assert.deepEqual(actual, expected, `mismatch for patterns=${JSON.stringify(patterns)} text=${JSON.stringify(text)}`);
  }
});

test('unicode/multi-byte-ish characters are handled consistently between construction and search (code-unit based)', () => {
  // Not a Unicode-correctness claim (JS strings are UTF-16 code units,
  // and this implementation iterates by code unit like a plain string
  // index would) -- just verifying patterns and text with non-ASCII
  // characters still match correctly and indices stay consistent with
  // native string slicing.
  const ac = new AhoCorasick(['café', 'é']);
  const text = 'my café is nice';
  const matches = ac.search(text);
  for (const m of matches) {
    assert.equal(text.slice(m.start, m.end), m.pattern);
  }
  assert.deepEqual(
    matches.map((m) => m.pattern),
    ['café', 'é']
  );
});
