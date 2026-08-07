'use strict';

/**
 * Dependency-free, single-file, deterministic suffix array index over a
 * fixed input string, built via prefix doubling with Kasai's LCP
 * construction, supporting O(|pattern| * log n) pattern search via binary
 * search over the suffix array. Operates on plain JavaScript string
 * indexing (UTF-16 code units, native ordering -- no locale comparison
 * anywhere).
 *
 * new SuffixArrayIndex(text)
 *   `text` must be a string. Builds the suffix array (the permutation of
 *   `0 .. text.length-1` -- the start offsets of every non-empty suffix --
 *   sorted ascending by suffix content under native UTF-16 code-unit
 *   ordering) via prefix doubling, and the adjacent LCP array (length
 *   equal to the suffix array's, `lcp[0] = 0` by convention since the
 *   first suffix in sorted order has no predecessor) via Kasai's
 *   algorithm.
 *
 * suffixArray()
 *   A fresh copy of the suffix array (never the live internal array, so
 *   callers can't mutate index state).
 *
 * lcpArray()
 *   A fresh copy of the LCP array, `lcp[i]` = length of the longest common
 *   prefix between the suffixes at sorted positions `i-1` and `i`
 *   (`lcp[0] = 0`).
 *
 * search(pattern)
 *   `pattern` must be a string. Returns every start position where
 *   `pattern` occurs in `text`, as an ascending-sorted array of numbers,
 *   including overlapping matches. The empty pattern is defined to match
 *   every boundary from `0` through `text.length` inclusive (`n+1`
 *   positions), per spec -- a distinct convention from `suffixArray()`/
 *   `lcpArray()`, which only ever concern non-empty suffixes.
 *
 * Non-string arguments to the constructor or to `search` throw
 * `TypeError`.
 */

function buildSuffixArray(text) {
  const n = text.length;
  if (n === 0) return [];

  let sa = Array.from({ length: n }, (_, i) => i);
  let rank = Array.from({ length: n }, (_, i) => text.charCodeAt(i));
  const tmp = new Array(n);

  for (let k = 1; k < n; k *= 2) {
    const rankAt = (i, offset) => {
      const j = i + offset;
      return j < n ? rank[j] : -1;
    };
    const cmp = (a, b) => {
      if (rank[a] !== rank[b]) return rank[a] - rank[b];
      return rankAt(a, k) - rankAt(b, k);
    };
    sa.sort(cmp);

    tmp[sa[0]] = 0;
    for (let i = 1; i < n; i++) {
      tmp[sa[i]] = tmp[sa[i - 1]] + (cmp(sa[i - 1], sa[i]) < 0 ? 1 : 0);
    }
    rank = tmp.slice();

    if (rank[sa[n - 1]] === n - 1) break; // every rank already distinct
  }

  return sa;
}

function buildLcpArray(text, sa) {
  const n = sa.length;
  const lcp = new Array(n).fill(0);
  if (n === 0) return lcp;

  const rankOf = new Array(n);
  for (let i = 0; i < n; i++) rankOf[sa[i]] = i;

  let h = 0;
  for (let i = 0; i < n; i++) {
    if (rankOf[i] > 0) {
      const j = sa[rankOf[i] - 1];
      while (i + h < n && j + h < n && text[i + h] === text[j + h]) h++;
      lcp[rankOf[i]] = h;
      if (h > 0) h--;
    } else {
      h = 0;
    }
  }

  return lcp;
}

/** Smallest index i in sa (0..sa.length) such that the suffix at sa[i]
 * is >= pattern under native UTF-16-code-unit lexicographic order,
 * comparing only the first pattern.length code units of the suffix
 * (JS's default string comparison already truncation-handles a suffix
 * shorter than the pattern correctly, since a proper prefix sorts before
 * a longer string that extends it). */
function lowerBoundSA(sa, text, pattern) {
  let lo = 0;
  let hi = sa.length;
  const plen = pattern.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const start = sa[mid];
    const suf = text.length - start >= plen ? text.slice(start, start + plen) : text.slice(start);
    if (suf < pattern) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Smallest index i in sa (0..sa.length) such that the suffix at sa[i]
 * is > pattern (see lowerBoundSA for the truncated-comparison rationale). */
function upperBoundSA(sa, text, pattern) {
  let lo = 0;
  let hi = sa.length;
  const plen = pattern.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const start = sa[mid];
    const suf = text.length - start >= plen ? text.slice(start, start + plen) : text.slice(start);
    if (suf <= pattern) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

class SuffixArrayIndex {
  constructor(text) {
    if (typeof text !== 'string') throw new TypeError('text must be a string');
    this._text = text;
    this._n = text.length;
    this._sa = buildSuffixArray(text);
    this._lcp = buildLcpArray(text, this._sa);
  }

  suffixArray() {
    return this._sa.slice();
  }

  lcpArray() {
    return this._lcp.slice();
  }

  search(pattern) {
    if (typeof pattern !== 'string') throw new TypeError('pattern must be a string');

    if (pattern.length === 0) {
      const result = new Array(this._n + 1);
      for (let i = 0; i <= this._n; i++) result[i] = i;
      return result;
    }

    if (pattern.length > this._n) return [];

    const lo = lowerBoundSA(this._sa, this._text, pattern);
    const hi = upperBoundSA(this._sa, this._text, pattern);
    const positions = this._sa.slice(lo, hi);
    positions.sort((a, b) => a - b);
    return positions;
  }
}

module.exports = { SuffixArrayIndex };
