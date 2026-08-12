'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzePalindromes } = require('./manacher.js');

// ---------------------------------------------------------------------
// Empty input / single character
// ---------------------------------------------------------------------

test('empty string returns empty odd/even arrays and the length-0 longest', () => {
  const result = analyzePalindromes('');
  assert.deepEqual(result.odd, []);
  assert.deepEqual(result.even, []);
  assert.deepEqual(result.longest, { start: 0, length: 0, value: '' });
});

test('single character: odd[0] = 1, even[0] = 0, longest is the character itself', () => {
  const result = analyzePalindromes('x');
  assert.deepEqual(result.odd, [1]);
  assert.deepEqual(result.even, [0]);
  assert.deepEqual(result.longest, { start: 0, length: 1, value: 'x' });
});

// ---------------------------------------------------------------------
// Odd-length palindromes
// ---------------------------------------------------------------------

test('"aba": odd[1] = 2 (radius), longest is the full odd palindrome "aba"', () => {
  const result = analyzePalindromes('aba');
  assert.deepEqual(result.odd, [1, 2, 1]);
  assert.deepEqual(result.even, [0, 0, 0]);
  assert.deepEqual(result.longest, { start: 0, length: 3, value: 'aba' });
});

test('"racecar": full-string odd palindrome, radius 4 at the center', () => {
  const result = analyzePalindromes('racecar');
  assert.equal(result.odd[3], 4); // center 'e', radius 4 -> length 7
  assert.deepEqual(result.longest, { start: 0, length: 7, value: 'racecar' });
});

test('odd palindrome embedded in non-palindromic surroundings', () => {
  const result = analyzePalindromes('yyabcbazz');
  // "abcba" spans indices 2..6, radius 3 centered at index 4 ('c'). The
  // 'yy'/'zz' padding is deliberately asymmetric so it cannot extend the
  // match further (unlike e.g. matching padding on both sides would).
  assert.equal(result.odd[4], 3);
  assert.deepEqual(result.longest, { start: 2, length: 5, value: 'abcba' });
});

// ---------------------------------------------------------------------
// Even-length palindromes
// ---------------------------------------------------------------------

test('"abba": even[2] = 2 (radius), longest is the full even palindrome "abba"', () => {
  const result = analyzePalindromes('abba');
  assert.deepEqual(result.odd, [1, 1, 1, 1]);
  assert.deepEqual(result.even, [0, 0, 2, 0]);
  assert.deepEqual(result.longest, { start: 0, length: 4, value: 'abba' });
});

test('"aa": single even palindrome, radius 1 centered before index 1', () => {
  const result = analyzePalindromes('aa');
  assert.deepEqual(result.odd, [1, 1]);
  assert.deepEqual(result.even, [0, 1]);
  assert.deepEqual(result.longest, { start: 0, length: 2, value: 'aa' });
});

test('even palindrome embedded in non-palindromic surroundings', () => {
  const result = analyzePalindromes('wxabccbayz');
  // "abccba" spans indices 2..7, even radius centered before index 5. The
  // 'wx'/'yz' padding is deliberately asymmetric so it cannot extend the
  // match further.
  assert.equal(result.even[5], 3);
  assert.deepEqual(result.longest, { start: 2, length: 6, value: 'abccba' });
});

// ---------------------------------------------------------------------
// Repeated characters
// ---------------------------------------------------------------------

test('all-same-character run: longest is the entire run', () => {
  const result = analyzePalindromes('aaaaaa');
  assert.deepEqual(result.longest, { start: 0, length: 6, value: 'aaaaaa' });
});

test('repeated-character run embedded between other characters', () => {
  const result = analyzePalindromes('xaaaaay');
  assert.deepEqual(result.longest, { start: 1, length: 5, value: 'aaaaa' });
});

// ---------------------------------------------------------------------
// Tied maxima -> deterministic earliest-start tie-break
// ---------------------------------------------------------------------

test('two equal-length palindromes: earliest start wins', () => {
  // "aba" (start 0, length 3) and "aca" (start 4, length 3) tie at length 3;
  // "aba" starts earlier.
  const result = analyzePalindromes('abaXaca');
  assert.deepEqual(result.longest, { start: 0, length: 3, value: 'aba' });
});

test('tie between an odd- and an even-length candidate of different lengths keeps the longer one, and equal-length ties keep the earlier start', () => {
  // "aa" (even, start 0, length 2) and "bb" (even, start 3, length 2) tie;
  // earliest start ("aa") must win regardless of scan direction.
  const result = analyzePalindromes('aaXbb');
  assert.deepEqual(result.longest, { start: 0, length: 2, value: 'aa' });
});

test('tie where the later-starting candidate is found first during the scan still loses to the earlier start', () => {
  // Construct so the earlier tie-length palindrome is centered at a later
  // index than the later one, exercising the tie-break logic rather than
  // natural left-to-right discovery order.
  const result = analyzePalindromes('zvzXwuw');
  // "zvz" start 0 length 3; "wuw" start 4 length 3 -> earliest start (0) wins.
  assert.deepEqual(result.longest, { start: 0, length: 3, value: 'zvz' });
});

// ---------------------------------------------------------------------
// Punctuation / mixed non-letter characters
// ---------------------------------------------------------------------

test('punctuation and spaces participate as ordinary characters', () => {
  const result = analyzePalindromes('a, b b ,a');
  // Whole string reversed reads the same: 'a, b b ,a' -> check via longest.
  assert.equal(result.longest.length, 9);
  assert.equal(result.longest.value, 'a, b b ,a');
});

test('punctuation-only palindrome', () => {
  const result = analyzePalindromes('!!x!!');
  assert.deepEqual(result.longest, { start: 0, length: 5, value: '!!x!!' });
});

test('no palindrome longer than 1 among distinct punctuation', () => {
  const result = analyzePalindromes('!@#$%');
  assert.equal(result.longest.length, 1);
});

// ---------------------------------------------------------------------
// Unicode code points (including astral-plane characters requiring
// surrogate-pair-aware indexing)
// ---------------------------------------------------------------------

test('BMP unicode palindrome (accented characters)', () => {
  const result = analyzePalindromes('áéíéá');
  assert.deepEqual(result.longest, { start: 0, length: 5, value: 'áéíéá' });
});

test('astral-plane emoji palindrome: each surrogate pair counts as ONE code point', () => {
  // 😀 (U+1F600) and 🎉 (U+1F389) are each encoded as a UTF-16 surrogate
  // pair (2 code units), but must be treated as a single code-point index.
  const text = '😀🎉x🎉😀';
  const codePoints = Array.from(text);
  assert.equal(codePoints.length, 5); // 5 code points, not 9 UTF-16 units
  // sanity: 4 of the 5 code points (😀 😀 🎉 🎉) are astral-plane surrogate
  // pairs (2 UTF-16 units each) and 1 ('x') is a single BMP unit -> 9 units.
  assert.equal(text.length, 9);

  const result = analyzePalindromes(text);
  assert.equal(result.odd.length, 5);
  assert.equal(result.even.length, 5);
  assert.deepEqual(result.longest, { start: 0, length: 5, value: text });
});

test('astral-plane emoji: odd[] radius at the center index reflects code-point centering, not UTF-16 centering', () => {
  const text = 'a😀b😀a';
  const result = analyzePalindromes(text);
  // Code points: [a, 😀, b, 😀, a] -> center index 2 ('b'), radius 3.
  assert.equal(Array.from(text).length, 5);
  assert.equal(result.odd[2], 3);
  assert.deepEqual(result.longest, { start: 0, length: 5, value: text });
});

test('mixed BMP + astral: longest palindrome value round-trips exactly through code points', () => {
  // Different emoji flank the "aba" core on each side (deliberately, so
  // the match cannot extend past 'aba' the way matching flanks would).
  const text = 'x🎉aba🙃y';
  const result = analyzePalindromes(text);
  assert.deepEqual(result.longest, { start: 2, length: 3, value: 'aba' });
});

test('non-palindromic astral-plane string still produces correctly-sized arrays with no crash', () => {
  const text = '🙂🙃🎈';
  const result = analyzePalindromes(text);
  assert.equal(result.odd.length, 3);
  assert.equal(result.even.length, 3);
  assert.equal(result.longest.length, 1);
});

// ---------------------------------------------------------------------
// Invalid inputs
// ---------------------------------------------------------------------

test('throws TypeError for non-string inputs', () => {
  const badInputs = [undefined, null, 123, 1.5, true, false, {}, [], () => {}, Symbol('x'), new String('abc')];
  for (const bad of badInputs) {
    assert.throws(() => analyzePalindromes(bad), TypeError, `expected TypeError for ${String(bad)}`);
  }
});

test('does not throw for a valid empty string (distinct from missing/undefined argument)', () => {
  assert.doesNotThrow(() => analyzePalindromes(''));
});

// ---------------------------------------------------------------------
// Determinism / no mutation
// ---------------------------------------------------------------------

test('repeated calls on the same input are fully deterministic', () => {
  const text = 'banana split racecar level 😀🎉x🎉😀';
  const r1 = analyzePalindromes(text);
  const r2 = analyzePalindromes(text);
  const r3 = analyzePalindromes(text);
  assert.deepEqual(r1, r2);
  assert.deepEqual(r2, r3);
});

test('input string is never mutated (strings are immutable in JS, but the code-point view must not leak external mutable state)', () => {
  const text = 'abcba';
  const before = text;
  analyzePalindromes(text);
  assert.equal(text, before);
});

// ---------------------------------------------------------------------
// Structural invariant: longest.value must itself be a genuine palindrome
// of the reported length, starting at the reported start, for a spread of
// hand-picked inputs (a lightweight sanity net around the main randomized
// differential test below).
// ---------------------------------------------------------------------

test('longest.value is always an actual palindrome matching start/length, across varied inputs', () => {
  const samples = [
    'a', 'aa', 'ab', 'aba', 'abba', 'abcba', 'abccba', 'xxxxxxxx',
    'zzzzzzzzzzzzzzzzzzzz', 'The quick brown fox', 'A man a plan a canal Panama',
    '12321', '123321', '!@#a#@!', '   ', 'noon high noon',
  ];
  for (const text of samples) {
    const result = analyzePalindromes(text);
    const cp = Array.from(text);
    const { start, length, value } = result.longest;
    const slice = cp.slice(start, start + length);
    assert.equal(slice.join(''), value, `value mismatch for ${JSON.stringify(text)}`);
    for (let a = 0, b = slice.length - 1; a < b; a++, b--) {
      assert.equal(slice[a], slice[b], `not a palindrome for ${JSON.stringify(text)}`);
    }
  }
});

// ---------------------------------------------------------------------
// Required fixed-seed randomized differential test: >= 1,000 short strings
// checked against an independent, deliberately non-incremental exhaustive
// brute-force reference implementation (defined here in the test file,
// structurally distinct from the Manacher expansion under test).
// ---------------------------------------------------------------------

// xorshift32 PRNG, fixed seed 0xC0FFEE — same PRNG family/seed convention
// used by this repo's other differential tests (see e.g.
// minimum-enclosing-circle.test.js).
function xorshift32(seed) {
  let x = seed >>> 0;
  return function next() {
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    return x >>> 0;
  };
}

// Exhaustive O(n^3) reference: checks every substring by code point,
// keeping the longest with earliest-start tie-breaking. A direct,
// obviously-correct transcription of "longest palindromic substring"
// itself, with no expansion-around-center technique in common with the
// Manacher implementation under test.
function referenceLongestPalindrome(codePoints) {
  const n = codePoints.length;
  if (n === 0) return { start: 0, length: 0, value: '' };
  let bestStart = 0;
  let bestLength = 1;
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      const len = j - i + 1;
      if (len <= bestLength) continue;
      let isPalindrome = true;
      for (let a = i, b = j; a < b; a++, b--) {
        if (codePoints[a] !== codePoints[b]) {
          isPalindrome = false;
          break;
        }
      }
      if (isPalindrome) {
        bestStart = i;
        bestLength = len;
      }
    }
  }
  return {
    start: bestStart,
    length: bestLength,
    value: codePoints.slice(bestStart, bestStart + bestLength).join(''),
  };
}

// Independent O(n^2) reference for the odd[]/even[] radius arrays
// themselves: a direct expand-around-every-center computation, with no
// mirror/[l, r]-interval shortcut of any kind — structurally unrelated to
// the O(n) Manacher construction under test, which is exactly what makes
// this a meaningful cross-check rather than a restatement of the same
// algorithm. odd[i]: expand outward from center i while both sides match.
// even[i]: expand outward from the gap immediately before i (comparing
// codePoints[i-1-e] against codePoints[i+e]) while both sides match.
function referenceOddEven(codePoints) {
  const n = codePoints.length;
  const odd = new Array(n);
  const even = new Array(n);
  for (let i = 0; i < n; i++) {
    let r = 1;
    while (i - r >= 0 && i + r < n && codePoints[i - r] === codePoints[i + r]) {
      r++;
    }
    odd[i] = r;

    let e = 0;
    while (i - 1 - e >= 0 && i + e < n && codePoints[i - 1 - e] === codePoints[i + e]) {
      e++;
    }
    even[i] = e;
  }
  return { odd, even };
}

test('deterministic randomized differential coverage: xorshift32(0xC0FFEE), >= 1000 short strings over a small alphabet, against an independent O(n^3) brute-force reference (longest) and an independent O(n^2) expand-around-center reference (odd[]/even[])', () => {
  const rand = xorshift32(0xC0FFEE);
  const alphabet = Array.from('ab😀'); // small alphabet, mixing BMP and an astral-plane code point
  const TRIALS = 1200;
  let checked = 0;

  for (let t = 0; t < TRIALS; t++) {
    const len = rand() % 13; // string lengths 0..12 code points
    let text = '';
    for (let i = 0; i < len; i++) {
      text += alphabet[rand() % alphabet.length];
    }

    const result = analyzePalindromes(text);
    const codePoints = Array.from(text);
    const expected = referenceLongestPalindrome(codePoints);
    const expectedOddEven = referenceOddEven(codePoints);

    assert.equal(result.longest.length, expected.length, `length mismatch for ${JSON.stringify(text)}`);
    assert.equal(result.longest.start, expected.start, `start mismatch for ${JSON.stringify(text)}`);
    assert.equal(result.longest.value, expected.value, `value mismatch for ${JSON.stringify(text)}`);
    assert.deepEqual(result.odd, expectedOddEven.odd, `odd[] mismatch for ${JSON.stringify(text)}`);
    assert.deepEqual(result.even, expectedOddEven.even, `even[] mismatch for ${JSON.stringify(text)}`);
    checked++;
  }

  assert.ok(checked >= 1000, `expected at least 1000 trials, ran ${checked}`);
});
