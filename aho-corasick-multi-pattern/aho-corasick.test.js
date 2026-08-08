'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AhoCorasick } = require('./aho-corasick.js');

// ----------------------------------------------------------------------
// Independent oracle: a naive, structurally unrelated substring matcher.
// For every pattern, for every position in the text, does a direct
// String.prototype.slice comparison. O(patterns * text length * pattern
// length) -- far too slow for production use, but it shares no code or
// intermediate representation (no trie, no failure links) with the
// implementation under test, making it a genuine cross-check.
// ----------------------------------------------------------------------
function naiveMatch(patterns, text) {
  const matches = [];
  for (let patternIndex = 0; patternIndex < patterns.length; patternIndex++) {
    const pattern = patterns[patternIndex];
    for (let start = 0; start + pattern.length <= text.length; start++) {
      if (text.slice(start, start + pattern.length) === pattern) {
        matches.push({ pattern, patternIndex, start, end: start + pattern.length });
      }
    }
  }
  matches.sort((a, b) => a.end - b.end || a.start - b.start || a.patternIndex - b.patternIndex);
  return matches;
}

function checkAgainstOracle(patterns, text) {
  const ac = new AhoCorasick(patterns);
  const actual = ac.search(text);
  const expected = naiveMatch(patterns, text);
  assert.deepEqual(
    actual,
    expected,
    `mismatch for patterns=${JSON.stringify(patterns)} text=${JSON.stringify(text)}`,
  );
  return actual;
}

// ----------------------------------------------------------------------

test('empty pattern array is allowed and never matches anything', () => {
  const ac = new AhoCorasick([]);
  assert.deepEqual(ac.search(''), []);
  assert.deepEqual(ac.search('anything at all'), []);
});

test('empty search text with non-empty patterns yields no matches', () => {
  const ac = new AhoCorasick(['a', 'bb', 'ccc']);
  assert.deepEqual(ac.search(''), []);
});

test('empty pattern array against empty text', () => {
  const ac = new AhoCorasick([]);
  assert.deepEqual(ac.search(''), []);
});

test('a single pattern matches every occurrence, including immediately adjacent ones', () => {
  checkAgainstOracle(['aa'], 'aaaa');
});

test('classic failure-link example: he/she/his/hers in "ushers"', () => {
  // The textbook Aho-Corasick example. "she" is found first; matching
  // "he" starting one character later requires following a failure link
  // from deep inside the "she" branch of the trie back up to the "he"
  // branch, and "hers" requires following a further failure link chain
  // after "her" fails to extend into any existing pattern's "s".
  const actual = checkAgainstOracle(['he', 'she', 'his', 'hers'], 'ushers');
  assert.deepEqual(actual, [
    { pattern: 'she', patternIndex: 1, start: 1, end: 4 },
    { pattern: 'he', patternIndex: 0, start: 2, end: 4 },
    { pattern: 'hers', patternIndex: 3, start: 2, end: 6 },
  ]);
});

test('failure links chain through multiple levels: a/ab/bc/bca/c/caa in "abcaa"', () => {
  // Another standard textbook-style stress case for the failure function,
  // where matching a suffix of one pattern requires falling back through
  // several failure links before finding (or failing to find) a
  // continuation.
  checkAgainstOracle(['a', 'ab', 'bc', 'bca', 'c', 'caa'], 'abcaa');
});

test('overlapping matches at the same and different end positions', () => {
  const actual = checkAgainstOracle(['a', 'ab', 'b'], 'ab');
  assert.deepEqual(actual, [
    { pattern: 'a', patternIndex: 0, start: 0, end: 1 },
    { pattern: 'ab', patternIndex: 1, start: 0, end: 2 },
    { pattern: 'b', patternIndex: 2, start: 1, end: 2 },
  ]);
});

test('fully overlapping repeated-character patterns', () => {
  checkAgainstOracle(['aaa', 'aa', 'a'], 'aaaaa');
});

test('duplicate pattern strings are each reported independently by their own index', () => {
  const ac = new AhoCorasick(['ab', 'ab', 'b']);
  const matches = ac.search('xaby');
  const abMatches = matches.filter((m) => m.pattern === 'ab');
  assert.equal(abMatches.length, 2, 'both duplicate ab entries must be reported');
  assert.deepEqual(
    abMatches.map((m) => m.patternIndex).sort(),
    [0, 1],
  );
  for (const m of abMatches) {
    assert.equal(m.start, 1);
    assert.equal(m.end, 3);
  }
  checkAgainstOracle(['ab', 'ab', 'b'], 'xaby');
});

test('three-way duplicate of the same pattern all report independently', () => {
  const ac = new AhoCorasick(['x', 'x', 'x']);
  const matches = ac.search('x');
  assert.equal(matches.length, 3);
  assert.deepEqual(
    matches.map((m) => m.patternIndex).sort((a, b) => a - b),
    [0, 1, 2],
  );
});

test('Unicode: astral (non-BMP) characters count as two UTF-16 code units', () => {
  const astral = '\u{1F600}'; // GRINNING FACE, a surrogate pair
  assert.equal(astral.length, 2);
  const ac = new AhoCorasick([astral, 'x']);
  const text = 'a' + astral + 'x';
  const actual = ac.search(text);
  assert.deepEqual(actual, [
    { pattern: astral, patternIndex: 0, start: 1, end: 3 },
    { pattern: 'x', patternIndex: 1, start: 3, end: 4 },
  ]);
  // Cross-check the offsets independently: text.slice(start, end) must
  // reproduce the matched pattern exactly, using ordinary UTF-16 slicing.
  for (const m of actual) {
    assert.equal(text.slice(m.start, m.end), m.pattern);
  }
});

test('Unicode: a pattern that is only half of a surrogate pair still matches by code unit', () => {
  // The lone high surrogate of the astral character above, as its own
  // one-code-unit pattern. This is a deliberately weird but well-defined
  // case: the matcher operates on UTF-16 code units, not code points, so
  // a lone (unpaired, as a *pattern*) surrogate is just another valid
  // one-length string and must match wherever that exact code unit
  // appears in the text -- including as the first half of a real
  // surrogate pair, since matching happens purely on code-unit identity.
  const astral = '\u{1F600}';
  const highSurrogate = astral[0];
  const ac = new AhoCorasick([highSurrogate]);
  const actual = ac.search('a' + astral + 'b');
  assert.deepEqual(actual, [{ pattern: highSurrogate, patternIndex: 0, start: 1, end: 2 }]);
});

test('Unicode: combining characters and accented letters are matched by code unit like any other', () => {
  checkAgainstOracle(['café', 'é', 'caf'], 'café au lait, café noir');
});

test('punctuation patterns and text', () => {
  checkAgainstOracle(
    ['...', '?!', 'e.g.', ', '],
    'Wait... really?! e.g., this works, right?',
  );
});

test('deterministic ordering: matches ending at the same position are ordered by start, then by pattern index', () => {
  const actual = checkAgainstOracle(['bc', 'abc', 'c'], 'xabc');
  assert.deepEqual(actual, [
    { pattern: 'abc', patternIndex: 1, start: 1, end: 4 },
    { pattern: 'bc', patternIndex: 0, start: 2, end: 4 },
    { pattern: 'c', patternIndex: 2, start: 3, end: 4 },
  ]);
});

test('deterministic ordering: pattern-index tiebreak fires when start and end both coincide', () => {
  // Two distinct pattern indices for the exact same string must be
  // ordered purely by patternIndex once start and end are identical.
  const actual = checkAgainstOracle(['zz', 'zz'], 'zz');
  assert.deepEqual(actual, [
    { pattern: 'zz', patternIndex: 0, start: 0, end: 2 },
    { pattern: 'zz', patternIndex: 1, start: 0, end: 2 },
  ]);
});

test('reordering the pattern list preserves match content and (end, start) sort order; only patternIndex changes', () => {
  const forward = new AhoCorasick(['bc', 'abc', 'c']).search('xabc');
  const reversed = new AhoCorasick(['c', 'abc', 'bc']).search('xabc');
  const stripIndex = (arr) => arr.map(({ pattern, start, end }) => ({ pattern, start, end }));
  // Same underlying matches regardless of pattern insertion order.
  assert.deepEqual(stripIndex(forward), stripIndex(reversed));
  // And the sequence really is sorted by (end, start) ascending in both.
  for (const arr of [forward, reversed]) {
    for (let i = 1; i < arr.length; i++) {
      assert.ok(
        arr[i - 1].end < arr[i].end || (arr[i - 1].end === arr[i].end && arr[i - 1].start <= arr[i].start),
      );
    }
  }
});

test('repeated searches on the same instance are independent (no state leakage)', () => {
  const ac = new AhoCorasick(['foo', 'bar']);
  const first = ac.search('foobar');
  const second = ac.search('barfoo');
  const firstAgain = ac.search('foobar');
  assert.deepEqual(first, [
    { pattern: 'foo', patternIndex: 0, start: 0, end: 3 },
    { pattern: 'bar', patternIndex: 1, start: 3, end: 6 },
  ]);
  assert.deepEqual(second, [
    { pattern: 'bar', patternIndex: 1, start: 0, end: 3 },
    { pattern: 'foo', patternIndex: 0, start: 3, end: 6 },
  ]);
  // Critically: calling search on a *different* text in between did not
  // leak any residual automaton position or accumulated match list into
  // this repeat of the very first call.
  assert.deepEqual(first, firstAgain);
});

test('interleaving many searches with different texts never cross-contaminates results', () => {
  const ac = new AhoCorasick(['a', 'ab', 'abc', 'b', 'bc', 'c']);
  const texts = ['abc', 'cba', 'aabbcc', 'a', 'b', 'c', '', 'abcabc'];
  const expectedPerText = texts.map((t) => naiveMatch(['a', 'ab', 'abc', 'b', 'bc', 'c'], t));
  // Round 1, in order.
  for (let i = 0; i < texts.length; i++) {
    assert.deepEqual(ac.search(texts[i]), expectedPerText[i]);
  }
  // Round 2, reversed order -- still must match the same per-text
  // expectations, proving no cross-call state accumulated.
  for (let i = texts.length - 1; i >= 0; i--) {
    assert.deepEqual(ac.search(texts[i]), expectedPerText[i]);
  }
});

test('two independent instances built from the same patterns never share mutable state', () => {
  const a = new AhoCorasick(['x', 'y']);
  const b = new AhoCorasick(['x', 'y']);
  a.search('xxxxxxxxxx');
  assert.deepEqual(b.search('y'), [{ pattern: 'y', patternIndex: 1, start: 0, end: 1 }]);
});

test('patterns argument that is not an array throws TypeError', () => {
  for (const bad of ['abc', 123, null, undefined, {}, new Set(['a'])]) {
    assert.throws(() => new AhoCorasick(bad), TypeError);
  }
});

test('a pattern element that is not a string throws TypeError', () => {
  for (const bad of [123, null, undefined, {}, [], true, Symbol('x')]) {
    assert.throws(() => new AhoCorasick(['ok', bad]), TypeError);
  }
});

test('an empty-string pattern throws RangeError, not TypeError', () => {
  assert.throws(() => new AhoCorasick(['']), RangeError);
  assert.throws(() => new AhoCorasick(['ok', '']), RangeError);
  assert.throws(() => new AhoCorasick(['', 'ok']), RangeError);
});

test('validation rejects the first offending element even when mixed with valid ones', () => {
  assert.throws(() => new AhoCorasick(['ok', 42, '']), TypeError);
  assert.throws(() => new AhoCorasick(['ok', '', 42]), RangeError);
});

test('search() text argument that is not a string throws TypeError', () => {
  const ac = new AhoCorasick(['a']);
  for (const bad of [123, null, undefined, {}, [], true, ['a']]) {
    assert.throws(() => ac.search(bad), TypeError);
  }
});

test('mutating the caller-supplied patterns array after construction does not affect the instance', () => {
  const patterns = ['a', 'b'];
  const ac = new AhoCorasick(patterns);
  patterns.push('c');
  patterns[0] = 'z';
  assert.deepEqual(ac.search('abc'), [
    { pattern: 'a', patternIndex: 0, start: 0, end: 1 },
    { pattern: 'b', patternIndex: 1, start: 1, end: 2 },
  ]);
});

test('a long pattern that never matches produces no output and does not affect other patterns', () => {
  checkAgainstOracle(['nonexistent-pattern-xyz', 'a'], 'aaaa');
});

test('every returned match satisfies text.slice(start, end) === pattern', () => {
  const patterns = ['he', 'she', 'his', 'hers', 's', 'her'];
  const text = 'ushers say she is his usher, hers too';
  const ac = new AhoCorasick(patterns);
  const matches = ac.search(text);
  assert.ok(matches.length > 0);
  for (const m of matches) {
    assert.equal(text.slice(m.start, m.end), m.pattern);
    assert.equal(m.end - m.start, m.pattern.length);
    assert.equal(m.pattern, patterns[m.patternIndex]);
  }
});

// ----------------------------------------------------------------------
// Seeded randomized differential test against the independent naive
// oracle, across many random pattern sets and texts.
// ----------------------------------------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('seeded randomized differential test against the naive oracle', () => {
  const rand = mulberry32(20260808);
  const alphabet = 'ab'; // small alphabet maximizes overlap/failure-link stress
  const alphabetWide = 'abcdefghij';

  function randomString(rng, alpha, minLen, maxLen) {
    const len = minLen + Math.floor(rng() * (maxLen - minLen + 1));
    let s = '';
    for (let i = 0; i < len; i++) {
      s += alpha[Math.floor(rng() * alpha.length)];
    }
    return s;
  }

  let trialsRun = 0;
  for (let trial = 0; trial < 300; trial++) {
    const useWide = trial % 3 === 0;
    const alpha = useWide ? alphabetWide : alphabet;
    const patternCount = Math.floor(rand() * 8); // 0..7, including empty pattern-set trials
    const patterns = [];
    for (let i = 0; i < patternCount; i++) {
      patterns.push(randomString(rand, alpha, 1, 5));
    }
    const text = randomString(rand, alpha, 0, 40);
    checkAgainstOracle(patterns, text);
    trialsRun++;
  }
  assert.equal(trialsRun, 300);
});

test('seeded randomized differential test with deliberately many duplicate patterns', () => {
  const rand = mulberry32(987654321);
  function randomString(rng, alpha, minLen, maxLen) {
    const len = minLen + Math.floor(rng() * (maxLen - minLen + 1));
    let s = '';
    for (let i = 0; i < len; i++) {
      s += alpha[Math.floor(rng() * alpha.length)];
    }
    return s;
  }

  let trialsRun = 0;
  for (let trial = 0; trial < 150; trial++) {
    const basePatternCount = 1 + Math.floor(rand() * 4);
    const basePatterns = [];
    for (let i = 0; i < basePatternCount; i++) {
      basePatterns.push(randomString(rand, 'ab', 1, 4));
    }
    // Build a patterns array with deliberate duplicates by sampling (with
    // replacement) from the small base set.
    const patterns = [];
    const dupCount = 3 + Math.floor(rand() * 6);
    for (let i = 0; i < dupCount; i++) {
      patterns.push(basePatterns[Math.floor(rand() * basePatterns.length)]);
    }
    const text = randomString(rand, 'ab', 0, 30);
    checkAgainstOracle(patterns, text);
    trialsRun++;
  }
  assert.equal(trialsRun, 150);
});
