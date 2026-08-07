'use strict';

/**
 * Dependency-free, single-file deterministic suffix automaton (SAM) over a
 * fixed input string, operating on JavaScript UTF-16 code units (not
 * Unicode code points -- a surrogate pair counts as two units, exactly
 * like `str.length`/`str[i]`/`str.slice` already treat it).
 *
 * new SuffixAutomaton(text)
 *   `text` must be a string (may be empty). Builds the automaton in O(n)
 *   states/transitions via the standard online SAM "extend" construction,
 *   then precomputes each state's endpos-set size (`occurrences` needs
 *   this) and the total distinct-non-empty-substring count in one O(n)
 *   pass over the states.
 *
 * has(pattern)
 *   True iff `pattern` occurs as a substring of `text` (the empty string
 *   always occurs, so `has('')` is always `true`). O(|pattern|).
 *
 * occurrences(pattern)
 *   How many times `pattern` occurs as a substring of `text`, counting
 *   overlapping occurrences. By convention the empty pattern is counted as
 *   `text.length + 1` (the number of gaps/positions it could sit in),
 *   rather than whatever the automaton's own root-state bookkeeping would
 *   otherwise produce. O(|pattern|).
 *
 * countDistinctSubstrings()
 *   The number of distinct *non-empty* substrings of `text` (the empty
 *   substring is not counted). O(1) after construction.
 *
 * longestCommonSubstring(other)
 *   The longest string that occurs as a substring of both `text` and
 *   `other`. Ties (multiple substrings of the same maximal length) are
 *   broken by earliest starting position *in `other`*. Returns `''` if
 *   there is no common non-empty substring (including whenever `text` or
 *   `other` is empty). O(|other|).
 *
 * `text` (constructor) and `pattern`/`other` (method arguments) must all
 * be strings; anything else throws `TypeError`.
 */

class SuffixAutomaton {
  constructor(text) {
    if (typeof text !== 'string') throw new TypeError('text must be a string');
    this._text = text;
    this._build(text);
    this._computeEndposCounts();
    this._computeDistinctSubstringCount();
  }

  has(pattern) {
    SuffixAutomaton._requireString(pattern, 'pattern');
    return this._walk(pattern) !== -1;
  }

  occurrences(pattern) {
    SuffixAutomaton._requireString(pattern, 'pattern');
    if (pattern.length === 0) return this._text.length + 1;
    const state = this._walk(pattern);
    if (state === -1) return 0;
    return this._cnt[state];
  }

  countDistinctSubstrings() {
    return this._distinctCount;
  }

  longestCommonSubstring(other) {
    SuffixAutomaton._requireString(other, 'other');

    let state = 0;
    let length = 0;
    let bestLength = 0;
    let bestEnd = -1; // index (in `other`) of the last character of the best match so far

    for (let i = 0; i < other.length; i++) {
      const c = other[i];
      while (state !== 0 && !this._trans[state].has(c)) {
        state = this._link[state];
        length = this._len[state];
      }
      if (this._trans[state].has(c)) {
        state = this._trans[state].get(c);
        length++;
      } else {
        // state === 0 (root) and it has no transition on c either.
        length = 0;
      }
      if (length > bestLength) {
        bestLength = length;
        bestEnd = i;
      }
    }

    if (bestLength === 0) return '';
    return other.slice(bestEnd - bestLength + 1, bestEnd + 1);
  }

  static _requireString(value, name) {
    if (typeof value !== 'string') throw new TypeError(`${name} must be a string`);
  }

  /** Walks `pattern` from the root; returns the final state index, or -1 if
   * `pattern` is not a substring of the automaton's text. */
  _walk(pattern) {
    let state = 0;
    for (let i = 0; i < pattern.length; i++) {
      const next = this._trans[state].get(pattern[i]);
      if (next === undefined) return -1;
      state = next;
    }
    return state;
  }

  /** Standard online suffix-automaton construction (Blumer et al. / the
   * commonly-taught "extend" algorithm). Builds parallel arrays indexed by
   * state number rather than one object per state, plus `_isClone` so
   * `_computeEndposCounts` knows which states seed with cnt=1 vs cnt=0. */
  _build(text) {
    const n = text.length;
    const maxStates = 2 * n + 1;
    this._len = new Array(maxStates);
    this._link = new Array(maxStates);
    this._trans = new Array(maxStates);
    this._isClone = new Array(maxStates).fill(false);

    this._len[0] = 0;
    this._link[0] = -1;
    this._trans[0] = new Map();
    let size = 1;
    let last = 0;

    for (let i = 0; i < n; i++) {
      const c = text[i];
      const cur = size++;
      this._len[cur] = this._len[last] + 1;
      this._link[cur] = -1;
      this._trans[cur] = new Map();

      let p = last;
      while (p !== -1 && !this._trans[p].has(c)) {
        this._trans[p].set(c, cur);
        p = this._link[p];
      }

      if (p === -1) {
        this._link[cur] = 0;
      } else {
        const q = this._trans[p].get(c);
        if (this._len[p] + 1 === this._len[q]) {
          this._link[cur] = q;
        } else {
          const clone = size++;
          this._len[clone] = this._len[p] + 1;
          this._link[clone] = this._link[q];
          this._trans[clone] = new Map(this._trans[q]);
          this._isClone[clone] = true;
          while (p !== -1 && this._trans[p].get(c) === q) {
            this._trans[p].set(c, clone);
            p = this._link[p];
          }
          this._link[q] = clone;
          this._link[cur] = clone;
        }
      }
      last = cur;
    }

    this._size = size;
  }

  /** Propagates endpos-set sizes up the suffix-link tree: every
   * non-cloned state starts with cnt=1 (it was created as the direct
   * result of appending one specific text position), every cloned state
   * starts at 0, then each state adds its cnt into its link's cnt, visited
   * in order of strictly decreasing `len` (a valid topological order of
   * the suffix-link tree, since a child's len is always > its link's). */
  _computeEndposCounts() {
    const size = this._size;
    const cnt = new Array(size);
    for (let i = 0; i < size; i++) cnt[i] = this._isClone[i] || i === 0 ? 0 : 1;

    const order = new Array(size);
    for (let i = 0; i < size; i++) order[i] = i;
    order.sort((a, b) => this._len[b] - this._len[a]);

    for (const state of order) {
      if (state === 0) continue;
      cnt[this._link[state]] += cnt[state];
    }

    this._cnt = cnt;
  }

  /** Every state except the root contributes (len[state] - len[link[state]])
   * distinct substrings to the total (the standard suffix-automaton
   * distinct-substring-count identity); the empty substring is never
   * counted since the root itself is excluded from the sum. */
  _computeDistinctSubstringCount() {
    let total = 0;
    for (let state = 1; state < this._size; state++) {
      total += this._len[state] - this._len[this._link[state]];
    }
    this._distinctCount = total;
  }
}

module.exports = { SuffixAutomaton };
