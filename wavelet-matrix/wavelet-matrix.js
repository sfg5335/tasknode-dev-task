'use strict';

/**
 * Dependency-free, single-file, immutable wavelet matrix over a fixed
 * array of safe integers (may include negatives and duplicates), built
 * via coordinate compression and per-level bit partitions with prefix
 * counts, supporting indexed and range queries.
 *
 * new WaveletMatrix(values)
 *   `values` must be an array of safe integers (may be empty). Coordinate
 *   compression maps the distinct values (sorted ascending) onto
 *   `0 .. distinctCount-1`; the matrix needs `ceil(log2(distinctCount))`
 *   bit levels (0 levels when there are 0 or 1 distinct values). Each
 *   level's bit array is a stable partition of the previous level's
 *   sequence by that level's bit (all 0-bits first, in their relative
 *   order, then all 1-bits, in their relative order) -- the standard
 *   wavelet-matrix construction. Per level, prefix zero-counts and
 *   explicit zero/one position lists are precomputed so every query
 *   below only ever does O(numLevels) work, never rescans the array.
 *
 * All positions (`index`, `left`, `right`) and value ranges (`min`,
 * `max`) are zero-based and half-open (`[left, right)`, `[min, max)`)
 * exactly as specified. `access`/`rank`/`select`/`rangeCount`/`quantile`
 * never mutate anything -- the instance is immutable once constructed.
 *
 * access(index)
 *   The value at `index`. O(numLevels).
 *
 * rank(value, end)
 *   How many times `value` occurs among positions `[0, end)`. Returns 0
 *   for a `value` that never occurs anywhere in the array (an "absent"
 *   value), rather than throwing. O(numLevels).
 *
 * select(value, occurrence)
 *   The position of the `occurrence`-th occurrence of `value`
 *   (zero-based: `occurrence = 0` is the first occurrence). Returns -1 if
 *   `value` has no such occurrence (including when `value` never occurs
 *   at all). O(numLevels).
 *
 * rangeCount(left, right, min, max)
 *   How many elements in position range `[left, right)` have a value in
 *   `[min, max)`. `min`/`max` need not themselves be values that occur in
 *   the array. O(numLevels).
 *
 * quantile(left, right, k)
 *   The `k`-th smallest value (zero-based: `k = 0` is the minimum) among
 *   elements in position range `[left, right)`, which must be non-empty
 *   (`left < right`). O(numLevels).
 *
 * Argument type violations (wrong JS type, non-integer, non-finite)
 * throw `TypeError`; correctly-typed but out-of-bounds arguments (index
 * or position outside `[0, length)`, `left >= right` where a non-empty
 * range is required, `min > max`, a negative `occurrence`, `k` outside
 * `[0, right-left)`) throw `RangeError`.
 */

function isSafeInteger(v) {
  return typeof v === 'number' && Number.isSafeInteger(v);
}

function requireSafeInteger(value, name) {
  if (!isSafeInteger(value)) throw new TypeError(`${name} must be a safe integer`);
}

/** Smallest index i such that sortedArray[i] >= target (i.e. the count of
 * elements in sortedArray strictly less than target). Standard binary
 * search lower bound. */
function lowerBound(sortedArray, target) {
  let lo = 0;
  let hi = sortedArray.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sortedArray[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

class WaveletMatrix {
  constructor(values) {
    if (!Array.isArray(values)) throw new TypeError('values must be an array');
    for (let i = 0; i < values.length; i++) {
      requireSafeInteger(values[i], `values[${i}]`);
    }

    const n = values.length;
    this._length = n;

    const distinctSorted = Array.from(new Set(values)).sort((a, b) => a - b);
    this._distinctSorted = distinctSorted;
    const valueToCompressed = new Map();
    for (let i = 0; i < distinctSorted.length; i++) valueToCompressed.set(distinctSorted[i], i);
    this._valueToCompressed = valueToCompressed;

    const distinctCount = distinctSorted.length;
    let numLevels = 0;
    let capacity = 1;
    while (capacity < distinctCount) {
      capacity *= 2;
      numLevels++;
    }
    this._numLevels = numLevels;

    // Per level L (0 = least significant bit .. numLevels-1 = most
    // significant bit): prefixZero[L][i] = count of 0-bits among
    // bits[0..i-1] at that level; zeroPos[L]/onePos[L] = sorted lists of
    // the positions (in that level's own input order) holding a 0-bit /
    // 1-bit, used by select() to walk back up through the levels.
    const prefixZero = new Array(numLevels);
    const zeroPos = new Array(numLevels);
    const onePos = new Array(numLevels);
    const zeroCount = new Array(numLevels);

    let seq = values.map((v) => valueToCompressed.get(v));
    for (let L = numLevels - 1; L >= 0; L--) {
      const bits = new Uint8Array(n);
      for (let i = 0; i < n; i++) bits[i] = (seq[i] >> L) & 1;

      const pz = new Int32Array(n + 1);
      const zp = [];
      const op = [];
      for (let i = 0; i < n; i++) {
        pz[i + 1] = pz[i] + (bits[i] === 0 ? 1 : 0);
        if (bits[i] === 0) zp.push(i);
        else op.push(i);
      }
      prefixZero[L] = pz;
      zeroPos[L] = zp;
      onePos[L] = op;
      zeroCount[L] = pz[n];

      const nextSeq = new Array(n);
      let zi = 0;
      let oi = zp.length;
      for (let i = 0; i < n; i++) {
        if (bits[i] === 0) nextSeq[zi++] = seq[i];
        else nextSeq[oi++] = seq[i];
      }
      seq = nextSeq;
    }

    this._prefixZero = prefixZero;
    this._zeroPos = zeroPos;
    this._onePos = onePos;
    this._zeroCount = zeroCount;
  }

  get length() {
    return this._length;
  }

  access(index) {
    if (!Number.isInteger(index)) throw new TypeError('index must be an integer');
    if (index < 0 || index >= this._length) throw new RangeError(`index out of range: ${index}`);

    let pos = index;
    let result = 0;
    for (let L = this._numLevels - 1; L >= 0; L--) {
      const pz = this._prefixZero[L];
      const zerosBefore = pz[pos];
      const bit = pz[pos + 1] - pz[pos] === 0 ? 1 : 0; // no new zero added at `pos` => it's a 1-bit
      if (bit === 0) {
        pos = zerosBefore;
      } else {
        result |= 1 << L;
        pos = this._zeroCount[L] + (pos - zerosBefore);
      }
    }
    return this._distinctSorted[result];
  }

  rank(value, end) {
    requireSafeInteger(value, 'value');
    if (!Number.isInteger(end)) throw new TypeError('end must be an integer');
    if (end < 0 || end > this._length) throw new RangeError(`end out of range: ${end}`);

    const cv = this._valueToCompressed.get(value);
    if (cv === undefined) return 0;

    let l = 0;
    let r = end;
    for (let L = this._numLevels - 1; L >= 0; L--) {
      const bit = (cv >> L) & 1;
      const pz = this._prefixZero[L];
      if (bit === 0) {
        l = pz[l];
        r = pz[r];
      } else {
        l = this._zeroCount[L] + (l - pz[l]);
        r = this._zeroCount[L] + (r - pz[r]);
      }
    }
    return r - l;
  }

  select(value, occurrence) {
    requireSafeInteger(value, 'value');
    if (!Number.isInteger(occurrence)) throw new TypeError('occurrence must be an integer');
    if (occurrence < 0) throw new RangeError(`occurrence must be non-negative: ${occurrence}`);

    const cv = this._valueToCompressed.get(value);
    if (cv === undefined) return -1;

    let l = 0;
    let r = this._length;
    for (let L = this._numLevels - 1; L >= 0; L--) {
      const bit = (cv >> L) & 1;
      const pz = this._prefixZero[L];
      if (bit === 0) {
        l = pz[l];
        r = pz[r];
      } else {
        l = this._zeroCount[L] + (l - pz[l]);
        r = this._zeroCount[L] + (r - pz[r]);
      }
    }
    if (occurrence >= r - l) return -1;

    let p = l + occurrence;
    for (let L = 0; L < this._numLevels; L++) {
      if (p < this._zeroCount[L]) {
        p = this._zeroPos[L][p];
      } else {
        p = this._onePos[L][p - this._zeroCount[L]];
      }
    }
    return p;
  }

  /** Count of elements in position range [l, r) whose compressed value is
   * strictly less than `upperExclusive` (a compressed-domain threshold,
   * i.e. already the count of distinct values below some original
   * value -- see rangeCount). Standard wavelet-matrix "count less than"
   * primitive. */
  _countLessThan(l, r, upperExclusive) {
    if (upperExclusive <= 0) return 0;
    const capacity = 1 << this._numLevels;
    if (this._numLevels === 0 || upperExclusive >= capacity) return r - l;

    let total = 0;
    for (let L = this._numLevels - 1; L >= 0; L--) {
      const bit = (upperExclusive >> L) & 1;
      const pz = this._prefixZero[L];
      if (bit === 1) {
        total += pz[r] - pz[l];
        l = this._zeroCount[L] + (l - pz[l]);
        r = this._zeroCount[L] + (r - pz[r]);
      } else {
        l = pz[l];
        r = pz[r];
      }
    }
    return total;
  }

  rangeCount(left, right, min, max) {
    if (!Number.isInteger(left)) throw new TypeError('left must be an integer');
    if (!Number.isInteger(right)) throw new TypeError('right must be an integer');
    requireSafeInteger(min, 'min');
    requireSafeInteger(max, 'max');
    if (left < 0 || left > this._length) throw new RangeError(`left out of range: ${left}`);
    if (right < 0 || right > this._length) throw new RangeError(`right out of range: ${right}`);
    if (left > right) throw new RangeError(`left (${left}) must be <= right (${right})`);
    if (min > max) throw new RangeError(`min (${min}) must be <= max (${max})`);

    const minIdx = lowerBound(this._distinctSorted, min);
    const maxIdx = lowerBound(this._distinctSorted, max);
    return this._countLessThan(left, right, maxIdx) - this._countLessThan(left, right, minIdx);
  }

  quantile(left, right, k) {
    if (!Number.isInteger(left)) throw new TypeError('left must be an integer');
    if (!Number.isInteger(right)) throw new TypeError('right must be an integer');
    if (!Number.isInteger(k)) throw new TypeError('k must be an integer');
    if (left < 0 || left > this._length) throw new RangeError(`left out of range: ${left}`);
    if (right < 0 || right > this._length) throw new RangeError(`right out of range: ${right}`);
    if (left >= right) throw new RangeError(`range [${left}, ${right}) must be non-empty`);
    if (k < 0 || k >= right - left) throw new RangeError(`k out of range: ${k}`);

    let l = left;
    let r = right;
    let result = 0;
    for (let L = this._numLevels - 1; L >= 0; L--) {
      const pz = this._prefixZero[L];
      const zerosInRange = pz[r] - pz[l];
      if (k < zerosInRange) {
        l = pz[l];
        r = pz[r];
      } else {
        k -= zerosInRange;
        result |= 1 << L;
        l = this._zeroCount[L] + (l - pz[l]);
        r = this._zeroCount[L] + (r - pz[r]);
      }
    }
    return this._distinctSorted[result];
  }
}

module.exports = { WaveletMatrix };
