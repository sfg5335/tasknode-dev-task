'use strict';

// Disjoint Sparse Table: answers range queries over ANY associative binary
// operator -- including non-commutative and non-idempotent ones (e.g.
// ordered string concatenation, matrix multiplication) -- in O(1) time per
// query after O(n log n) preprocessing. This is the key difference from a
// classic Sparse Table (used for RMQ-style problems): a classic sparse
// table answers a query by combining two OVERLAPPING power-of-two windows,
// which is only correct when the operator is idempotent (min/max/gcd...).
// A disjoint sparse table instead always combines two DISJOINT halves that
// exactly partition (and exactly cover, with no overlap) the query range,
// so it works for any associative operator, and always applies the
// operator with the operands in their original left-to-right order.
//
// Construction (standard technique): at level `level` (0-indexed), the
// array is conceptually partitioned into blocks of size 2^(level+1). Each
// block is split into a left half and a right half at its midpoint `mid`.
// table[level][i] for i in the left half holds combine(a[i], a[i+1], ...,
// a[mid-1]) (built right-to-left, ending exactly at mid-1). table[level][i]
// for i in the right half holds combine(a[mid], ..., a[i]) (built
// left-to-right, starting exactly at mid). For the last (possibly
// truncated) block when `size` isn't a power of two, only the portion that
// actually exists (< size) is built; if the truncation leaves no right
// half at all, that block is simply skipped at that level (queries can
// never land on it there, by construction -- see below).
//
// Query(left, right) over the half-open range [left, right):
//   - if right - left === 1, the range is a single element: return it
//     directly (no precomputed table needed at all for size <= 1 inputs).
//   - otherwise, `left` and `right - 1` differ in at least one bit. Let
//     `level` be the position of their HIGHEST differing bit. At that
//     level, `left` and `right - 1` are guaranteed to land in the same
//     block (their shared higher bits agree) but in different halves of
//     it (their bit at `level` differs) -- so table[level][left] holds
//     exactly combine(a[left..mid-1]) and table[level][right-1] holds
//     exactly combine(a[mid..right-1]), and combining those two disjoint,
//     already-correctly-ordered pieces gives exactly combine(a[left],
//     a[left+1], ..., a[right-1]) in the original left-to-right order.
//
// This query path is O(1): two array lookups plus a single call to the
// caller's `combine`, with no loop whose iteration count depends on the
// query range length -- entirely independent of (right - left).

function highestSetBitPosition(x) {
  // x is guaranteed > 0 here (see call sites). Returns floor(log2(x)).
  return 31 - Math.clz32(x);
}

class DisjointSparseTable {
  /**
   * @param {Array<*>} data - elements to index; copied, never mutated, and
   *   never affected by later mutation of the caller's original array.
   * @param {(a: *, b: *) => *} combine - an ASSOCIATIVE binary operator,
   *   i.e. combine(combine(a, b), c) === combine(a, combine(b, c)) for all
   *   a, b, c that can appear together in a range. Does not need to be
   *   commutative (combine(a, b) may differ from combine(b, a)) or
   *   idempotent. Always invoked as combine(leftOperand, rightOperand)
   *   with operands in their original array order.
   */
  constructor(data, combine) {
    if (!Array.isArray(data)) {
      throw new TypeError(`data must be an array, got ${typeof data}`);
    }
    if (typeof combine !== 'function') {
      throw new TypeError(`combine must be a function, got ${typeof combine}`);
    }
    // Copy (and freeze) so neither the caller's original array, nor this
    // instance's internal state, can be mutated out from under the other
    // after construction.
    this.data = Object.freeze(data.slice());
    this.size = this.data.length;
    this.combine = combine;
    this.table = DisjointSparseTable._build(this.data, combine);
    Object.freeze(this);
  }

  static _build(data, combine) {
    const n = data.length;
    if (n <= 1) return [];

    // Smallest LOG such that any pair of indices left, right-1 in [0, n)
    // (left !== right - 1) has its highest differing bit strictly below
    // LOG. Equivalently, the bit-length of (n - 1).
    const LOG = 32 - Math.clz32(n - 1);
    const table = new Array(LOG);

    for (let level = 0; level < LOG; level++) {
      const arr = new Array(n);
      const blockSize = 1 << (level + 1);
      const half = blockSize >> 1;
      for (let blockStart = 0; blockStart < n; blockStart += blockSize) {
        const mid = Math.min(blockStart + half, n);
        const blockEnd = Math.min(blockStart + blockSize, n);
        if (mid >= blockEnd) continue; // truncated block has no right half here

        // Left half: arr[mid-1] = data[mid-1], then extend leftward.
        arr[mid - 1] = data[mid - 1];
        for (let i = mid - 2; i >= blockStart; i--) {
          arr[i] = combine(data[i], arr[i + 1]);
        }
        // Right half: arr[mid] = data[mid], then extend rightward.
        arr[mid] = data[mid];
        for (let i = mid + 1; i < blockEnd; i++) {
          arr[i] = combine(arr[i - 1], data[i]);
        }
      }
      table[level] = arr;
    }
    return table;
  }

  /**
   * Combines data[left], data[left+1], ..., data[right-1] in that order,
   * over the half-open range [left, right). O(1) time for any valid,
   * non-empty range once the table is built.
   *
   * @param {number} left
   * @param {number} right
   * @returns {*}
   */
  query(left, right) {
    if (!Number.isInteger(left) || !Number.isInteger(right)) {
      throw new TypeError(
        `left and right must be integers, got left=${JSON.stringify(left)}, right=${JSON.stringify(right)}`
      );
    }
    if (left < 0 || right > this.size || left >= right) {
      throw new RangeError(
        `invalid range [${left}, ${right}) for a table of size ${this.size}: ` +
          `requires 0 <= left < right <= size`
      );
    }
    if (right - left === 1) return this.data[left];
    const level = highestSetBitPosition(left ^ (right - 1));
    return this.combine(this.table[level][left], this.table[level][right - 1]);
  }
}

module.exports = { DisjointSparseTable };
