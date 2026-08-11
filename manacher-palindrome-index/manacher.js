'use strict';

// Deterministic Manacher palindrome index — a single dependency-free module
// computing, in O(n) time (n = number of Unicode code points in the input),
// the odd- and even-centered palindrome radius arrays for a string, plus the
// single overall longest palindromic substring with deterministic
// earliest-start tie-breaking among equal-length candidates.
//
// All indices (odd[i], even[i], and the returned longest.start) are Unicode
// CODE POINT indices, never UTF-16 code unit indices. The input is first
// converted via `Array.from(text)`, which iterates the string by its
// Unicode code points (not UTF-16 code units), so astral-plane characters
// that are encoded as UTF-16 surrogate pairs (e.g. many emoji) are each a
// single element of the working array and are never split across two
// indices the way raw `.length`/bracket indexing on the original string
// would split them.
//
// ---------------------------------------------------------------------
// odd[i] / even[i] semantics (the convention this module commits to):
// ---------------------------------------------------------------------
//
// Let `s` be the array of code points, length n.
//
//   odd[i]  — for i in 0..n-1: the RADIUS (not the length) of the longest
//             odd-length palindrome centered exactly at code-point index i.
//             odd[i] is always >= 1 (a lone character is always a radius-1
//             odd palindrome centered at itself). The palindrome it
//             describes is s[i - odd[i] + 1 .. i + odd[i] - 1] (inclusive),
//             i.e. length = 2*odd[i] - 1, start = i - odd[i] + 1.
//
//   even[i] — for i in 0..n-1: the RADIUS of the longest even-length
//             palindrome centered in the gap immediately BEFORE index i
//             (i.e. the gap between code-point index i-1 and index i).
//             even[i] is always >= 0; a value of 0 means no even-length
//             palindrome exists at that gap (s[i-1] and s[i] don't match,
//             or i is 0 / i is out of range on one side). The palindrome
//             it describes, when even[i] > 0, is
//             s[i - even[i] .. i + even[i] - 1] (inclusive), i.e.
//             length = 2*even[i], start = i - even[i].
//
// This is the standard "d1 / d2" convention from the classical two-pass
// Manacher construction (each array entry is a RADIUS, not a length or a
// diameter), chosen because it is the well-known textbook form and keeps
// every array entry meaningful even where the palindrome is trivial
// (odd[i] = 1 for an isolated character; even[i] = 0 for "no even
// palindrome here") rather than needing a sentinel value.
//
// For n = 0 (empty input), odd and even are both empty arrays.

/**
 * @param {string} text
 * @returns {{
 *   odd: number[],
 *   even: number[],
 *   longest: { start: number, length: number, value: string }
 * }}
 * @throws {TypeError} if `text` is not a string.
 */
function analyzePalindromes(text) {
  if (typeof text !== 'string') {
    throw new TypeError('text must be a string');
  }

  const s = Array.from(text);
  const n = s.length;

  if (n === 0) {
    return { odd: [], even: [], longest: { start: 0, length: 0, value: '' } };
  }

  const odd = computeOdd(s, n);
  const even = computeEven(s, n);
  const longest = findLongest(s, odd, even, n);

  return { odd, even, longest };
}

// Classical Manacher first pass: odd-length palindromes, radius convention.
// [l, r] tracks the rightmost odd palindrome interval discovered so far
// (inclusive code-point indices), letting later centers inside it start
// their expansion from a mirror-derived lower bound instead of from
// scratch, which is what makes the whole two-pass algorithm O(n) rather
// than the O(n^2) naive "expand around every center" approach.
function computeOdd(s, n) {
  const odd = new Array(n);
  let l = 0;
  let r = -1;
  for (let i = 0; i < n; i++) {
    let k = i > r ? 1 : Math.min(odd[l + r - i], r - i + 1);
    while (i - k >= 0 && i + k < n && s[i - k] === s[i + k]) {
      k++;
    }
    odd[i] = k;
    if (i + k - 1 > r) {
      l = i - k + 1;
      r = i + k - 1;
    }
  }
  return odd;
}

// Classical Manacher second pass: even-length palindromes, radius
// convention, centered in the gap immediately before index i. Structurally
// identical to computeOdd, just with the center shifted by half a step
// (the comparison is s[i-k-1] vs s[i+k], and the mirror index is
// l+r-i+1 rather than l+r-i).
function computeEven(s, n) {
  const even = new Array(n);
  let l = 0;
  let r = -1;
  for (let i = 0; i < n; i++) {
    let k = i > r ? 0 : Math.min(even[l + r - i + 1], r - i + 1);
    while (i - k - 1 >= 0 && i + k < n && s[i - k - 1] === s[i + k]) {
      k++;
    }
    even[i] = k;
    if (i + k - 1 > r) {
      l = i - k;
      r = i + k - 1;
    }
  }
  return even;
}

// Scans every center (both parities) once, tracking the longest palindrome
// found so far and applying deterministic earliest-start tie-breaking:
// a candidate only replaces the current best if it is strictly longer, or
// exactly as long but starts strictly earlier. Centers are visited in
// increasing index order and, at each index, odd is checked before even,
// but that visitation order never itself decides a tie — only
// (length desc, start asc) does, so the result is independent of
// traversal order.
function findLongest(s, odd, even, n) {
  // s[0] is always a valid odd palindrome of length 1 at start 0, and no
  // palindrome can ever be shorter than 1 for a non-empty string, so this
  // is a safe seed rather than a special case.
  let bestStart = 0;
  let bestLength = 1;

  for (let i = 0; i < n; i++) {
    const oddLength = 2 * odd[i] - 1;
    const oddStart = i - odd[i] + 1;
    if (oddLength > bestLength || (oddLength === bestLength && oddStart < bestStart)) {
      bestLength = oddLength;
      bestStart = oddStart;
    }

    const evenLength = 2 * even[i];
    if (evenLength > 0) {
      const evenStart = i - even[i];
      if (evenLength > bestLength || (evenLength === bestLength && evenStart < bestStart)) {
        bestLength = evenLength;
        bestStart = evenStart;
      }
    }
  }

  return {
    start: bestStart,
    length: bestLength,
    value: s.slice(bestStart, bestStart + bestLength).join(''),
  };
}

module.exports = { analyzePalindromes };
