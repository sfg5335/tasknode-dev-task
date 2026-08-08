'use strict';

/**
 * Dependency-free, single-file, deterministic palindromic tree (Eertree)
 * (`PalindromicTree`) that incrementally tracks every distinct
 * palindromic substring of a Unicode code point sequence, in JavaScript,
 * with an automated `node:test` suite.
 *
 * new PalindromicTree(text = '')
 *   Constructs a tree pre-populated by appending every Unicode code
 *   point of `text`, in order (equivalent to calling `append` once per
 *   code point -- `for...of` over a JS string already iterates by code
 *   point, correctly keeping a surrogate pair together as one step, so
 *   supplementary-plane characters are never split mid-construction).
 *   `text` must be a string (`TypeError` otherwise); the default `''`
 *   builds an empty tree.
 *
 * Instance API:
 *   `size` -- a getter returning the number of *distinct* non-empty
 *   palindromic substrings tracked so far (mirrors the `Set`/`Map`
 *   convention of `.size` meaning "number of entries", not "length of
 *   input processed").
 *   `append(symbol)` -- appends exactly one more Unicode code point to
 *   the sequence and returns `this` (chainable). `symbol` must be a
 *   string containing exactly one Unicode code point -- not a UTF-16
 *   code *unit* count: a surrogate-pair character (e.g. an emoji) has
 *   `.length === 2` but is still exactly one code point and is a valid
 *   `append` argument, while a genuinely multi-code-point string or the
 *   empty string `''` is rejected. Throws `TypeError` for a non-string,
 *   the empty string, or a string spanning more than one code point.
 *   `has(value)` -- returns whether `value` (an arbitrary-length string)
 *   is one of the distinct non-empty palindromic substrings tracked so
 *   far. Throws `TypeError` for a non-string `value`. The empty string
 *   is never tracked as an entry (see Design notes), so `has('')` is
 *   always `false`.
 *   `longest()` -- returns the `{ value, length, occurrences,
 *   firstIndex }` entry for the longest tracked palindrome, or `null`
 *   if none has been observed yet. Ties are broken using the same
 *   ordering `entries()` uses, minus the (now-constant) length key:
 *   smallest `firstIndex` first, then smallest value in Unicode
 *   code-point lexical order.
 *   `entries()` -- returns a fresh array of `{ value, length,
 *   occurrences, firstIndex }` objects, one per distinct non-empty
 *   palindromic substring tracked so far, ordered by `firstIndex`
 *   ascending, then `length` ascending, then `value` in Unicode
 *   code-point lexical order (never JavaScript's default UTF-16
 *   code-unit string ordering -- see Design notes). `firstIndex` is the
 *   0-based *code-point* index at which that palindrome's earliest
 *   occurrence starts. `occurrences` counts every (possibly overlapping)
 *   occurrence of that exact palindrome as a substring anywhere in the
 *   sequence processed so far.
 *
 * Algorithm: a classic Eertree / palindromic tree (Rubinchik & Shur,
 * "EERTREE: An Efficient Data Structure for Processing Palindromes in
 * Strings"), built incrementally in amortized O(1) per appended code
 * point:
 *
 *   - Two fixed *imaginary* root nodes seed every tree: `length -1`
 *     (a self-looping sentinel whose suffix link points to itself,
 *     guaranteeing every suffix-link walk below terminates) and
 *     `length 0` (the empty palindrome, the suffix-link target for
 *     every length-1 palindrome). Neither root is ever reported by
 *     `entries()`/`size`/`has()` -- they exist purely as internal
 *     algorithmic scaffolding.
 *   - Every other node represents one distinct non-empty palindromic
 *     substring and stores: `length`; a `suffixLink` to the node for
 *     its own longest proper palindromic suffix (always strictly
 *     shorter); a `children` map of `symbol -> child node` (meaning
 *     "wrapping this palindrome in `symbol` on both sides yields the
 *     child's palindrome"); a raw hit `count` (see below); and the
 *     immutable `firstIndex`/`value` computed once at creation time.
 *   - Appending a new code point `c` at position `pos`: walk suffix
 *     links starting from the node for the current longest palindromic
 *     suffix (`_last`) until finding a node `X` whose palindrome, with
 *     `c` prepended and appended, is itself a palindromic suffix of the
 *     text processed so far (checked via `text[pos - X.length - 1] ===
 *     c`; the `length -1` root always satisfies this trivially, so the
 *     walk always terminates). If `X` already has a `c`-transition,
 *     that child is the (already-known) new longest palindromic suffix
 *     -- no new distinct palindrome was created, so only that node's
 *     raw `count` is incremented. Otherwise, a genuinely new distinct
 *     palindrome (length `X.length + 2`) is created as `X`'s
 *     `c`-transition; its own suffix link is found the same way, one
 *     level further out from `X`'s own suffix link (or fixed to the
 *     length-0 root for a new length-1 palindrome). This is the central
 *     Eertree theorem this implementation relies on: appending one code
 *     point creates **at most one** new distinct palindrome, and always
 *     at the position ending at the just-appended code point -- which
 *     is exactly why `firstIndex` (the *start* of that first
 *     occurrence) is well-defined and immutable the moment a node is
 *     created.
 *   - Occurrence counting: each node's raw `count` only reflects how
 *     many times it was *directly* the longest palindromic suffix at
 *     some append step. A palindrome's *true* total occurrence count
 *     also includes every occurrence of every longer palindrome that
 *     has it as a palindromic suffix (since wherever a longer
 *     palindrome ends, all of its own palindromic suffixes -- reachable
 *     by walking suffix links -- necessarily end there too). `entries`/
 *     `longest` compute this by processing all real nodes in
 *     *decreasing* length order and cascading each node's running count
 *     one hop down its suffix link (`occ[suffixLink] += occ[node]`);
 *     because suffix links always point to a strictly shorter node,
 *     this single left-to-right pass is guaranteed to have already
 *     finalized every upstream contribution by the time a node is
 *     reached as a source.
 */

function isSingleCodePoint(value) {
  if (typeof value !== 'string') return false;
  // Array.from a string iterates by Unicode code point (correctly
  // keeping a surrogate pair together as one element), unlike `.length`
  // which counts UTF-16 code *units* -- an astral character like an
  // emoji has `.length === 2` but is still exactly one code point.
  let count = 0;
  for (const _ of value) {
    count++;
    if (count > 1) return false;
  }
  return count === 1;
}

// Compares two strings by Unicode code point value, left to right, then
// by length if one is a code-point prefix of the other. Deliberately
// NOT plain `<`/`>` string comparison: JavaScript's default string
// ordering compares UTF-16 *code units*, which gives the wrong relative
// order between certain supplementary-plane characters (code points
// above U+FFFF, encoded as surrogate pairs starting around
// U+D800-U+DBFF) and ordinary BMP characters in the U+E000-U+FFFF
// range -- exactly the kind of encoding-vs-value mismatch this
// collection has hit real bugs from before.
function compareByCodePoints(a, b) {
  const aCps = Array.from(a);
  const bCps = Array.from(b);
  const minLen = Math.min(aCps.length, bCps.length);
  for (let i = 0; i < minLen; i++) {
    const diff = aCps[i].codePointAt(0) - bCps[i].codePointAt(0);
    if (diff !== 0) return diff;
  }
  return aCps.length - bCps.length;
}

const ROOT_NEG1 = 0;
const ROOT_ZERO = 1;

class PalindromicTree {
  constructor(text = '') {
    if (typeof text !== 'string') {
      throw new TypeError('text must be a string');
    }

    this._codePoints = [];
    this._nodes = [
      { length: -1, suffixLink: ROOT_NEG1, children: new Map(), count: 0, firstIndex: -1, value: null },
      { length: 0, suffixLink: ROOT_NEG1, children: new Map(), count: 0, firstIndex: -1, value: '' },
    ];
    this._last = ROOT_ZERO;
    this._values = new Set();

    for (const symbol of text) {
      this.append(symbol);
    }
  }

  get size() {
    return this._nodes.length - 2;
  }

  append(symbol) {
    if (!isSingleCodePoint(symbol)) {
      throw new TypeError('symbol must be a string containing exactly one Unicode code point');
    }

    const pos = this._codePoints.length;
    this._codePoints.push(symbol);

    const curr = this._findSuffixPalindromeBase(this._last, pos, symbol);

    const existingChild = this._nodes[curr].children.get(symbol);
    if (existingChild !== undefined) {
      this._nodes[existingChild].count++;
      this._last = existingChild;
      return this;
    }

    const newLength = this._nodes[curr].length + 2;
    let suffixLink;
    if (newLength === 1) {
      suffixLink = ROOT_ZERO;
    } else {
      const suffixBase = this._findSuffixPalindromeBase(this._nodes[curr].suffixLink, pos, symbol);
      suffixLink = this._nodes[suffixBase].children.get(symbol);
    }

    const firstIndex = pos - newLength + 1;
    const value = this._codePoints.slice(firstIndex, firstIndex + newLength).join('');
    const newIndex = this._nodes.length;

    this._nodes.push({
      length: newLength,
      suffixLink,
      children: new Map(),
      count: 1,
      firstIndex,
      value,
    });
    this._nodes[curr].children.set(symbol, newIndex);
    this._values.add(value);
    this._last = newIndex;
    return this;
  }

  has(value) {
    if (typeof value !== 'string') {
      throw new TypeError('value must be a string');
    }
    return this._values.has(value);
  }

  entries() {
    const occurrences = this._computeOccurrences();
    const result = [];
    for (let i = 2; i < this._nodes.length; i++) {
      const node = this._nodes[i];
      result.push({
        value: node.value,
        length: node.length,
        occurrences: occurrences[i],
        firstIndex: node.firstIndex,
      });
    }
    result.sort((a, b) => {
      if (a.firstIndex !== b.firstIndex) return a.firstIndex - b.firstIndex;
      if (a.length !== b.length) return a.length - b.length;
      return compareByCodePoints(a.value, b.value);
    });
    return result;
  }

  longest() {
    if (this._nodes.length === 2) return null;

    let bestIndex = 2;
    for (let i = 3; i < this._nodes.length; i++) {
      const node = this._nodes[i];
      const best = this._nodes[bestIndex];
      if (node.length > best.length) {
        bestIndex = i;
      } else if (node.length === best.length) {
        if (node.firstIndex < best.firstIndex) {
          bestIndex = i;
        } else if (node.firstIndex === best.firstIndex && compareByCodePoints(node.value, best.value) < 0) {
          bestIndex = i;
        }
      }
    }

    const occurrences = this._computeOccurrences();
    const best = this._nodes[bestIndex];
    return {
      value: best.value,
      length: best.length,
      occurrences: occurrences[bestIndex],
      firstIndex: best.firstIndex,
    };
  }

  // Walks suffix links starting at `startNode` to find the node X such
  // that wrapping X's palindrome in `symbol` on both sides would itself
  // be a palindromic suffix of the text processed so far (checked via
  // `codePoints[pos - X.length - 1] === symbol`). The length -1 root
  // always satisfies this trivially (its test index is exactly `pos`,
  // which was just set to `symbol`), guaranteeing the walk terminates.
  _findSuffixPalindromeBase(startNode, pos, symbol) {
    let curr = startNode;
    while (true) {
      const len = this._nodes[curr].length;
      const testIndex = pos - len - 1;
      if (testIndex >= 0 && this._codePoints[testIndex] === symbol) {
        return curr;
      }
      curr = this._nodes[curr].suffixLink;
    }
  }

  // Returns an array (indexed by internal node index, including the two
  // roots, whose entries are unused) of true total occurrence counts,
  // computed fresh from each node's raw hit `count` by cascading
  // contributions down suffix links in decreasing-length order. Never
  // mutates the stored per-node `count`, so it's safe to call repeatedly
  // (including interleaved with further `append` calls) without ever
  // double-counting.
  _computeOccurrences() {
    const occ = this._nodes.map((n) => n.count);
    const order = [];
    for (let i = 2; i < this._nodes.length; i++) order.push(i);
    order.sort((a, b) => this._nodes[b].length - this._nodes[a].length);
    for (const idx of order) {
      occ[this._nodes[idx].suffixLink] += occ[idx];
    }
    return occ;
  }
}

module.exports = { PalindromicTree };
