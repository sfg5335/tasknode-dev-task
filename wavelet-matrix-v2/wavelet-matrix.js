'use strict';

/**
 * WaveletMatrix — a dependency-free, deterministic structure for range
 * queries over an array of safe integers (negative values and duplicates
 * both supported).
 *
 * Construction: coordinate-compresses the input's distinct values into
 * ranks 0..m-1 (rank order == numeric order, so value-range queries can be
 * answered by comparing ranks), then builds `numLevels = ceil(log2(m))`
 * bit vectors via an MSB-first stable radix partition of those ranks
 * (`numLevels === 0` when the array is empty or every element is equal).
 * The input array itself is copied on construction and never mutated.
 *
 * Position ranges (`end`, `[left, right)`) are HALF-OPEN and 0-based
 * throughout, per the task's own "half-open ranges" requirement.
 * `rank`/`select`/`quantile` occurrences and quantile ranks `k` are
 * 0-based (`select(v, 0)` is the first/leftmost occurrence of `v`;
 * `quantile(l, r, 0)` is the smallest value in `[l, r)`).
 *
 * `rangeFreq(left, right, min, max)`'s VALUE range `[min, max]` is
 * INCLUSIVE on both ends (unlike the half-open POSITION range) — chosen
 * because `min`/`max` name a closed interval by convention (unlike
 * `left`/`right`, which the task explicitly calls out as half-open), and
 * because it lets a caller ask for a single exact value via
 * `rangeFreq(l, r, v, v)`. `min`/`max` need not themselves be present in
 * the array.
 *
 * Every public method validates its own arguments: a wrong TYPE (not a
 * number, not an integer) throws TypeError; a right-typed value outside
 * its valid RANGE (out of bounds, not a safe integer, min > max, no such
 * occurrence) throws RangeError. See the `#validate*` helpers below.
 */
class WaveletMatrix {
  #length;
  #sortedDistinct; // number[], strictly increasing, the compressed alphabet
  #numLevels;
  #levelBits; // Uint8Array[numLevels], each of length #length
  #levelOnesPrefix; // Uint32Array[numLevels], each of length #length + 1
  #levelZeroCount; // Uint32Array, length numLevels

  /**
   * @param {number[]} values - array of safe integers; copied, never mutated.
   */
  constructor(values) {
    if (!Array.isArray(values)) {
      throw new TypeError('values must be an array');
    }
    for (let i = 0; i < values.length; i += 1) {
      const v = values[i];
      // Same two-tier split used everywhere else in this class: wrong
      // kind (not a number, or a non-integer number like 1.5) -> TypeError;
      // right kind but out of the representable safe-integer range ->
      // RangeError.
      if (typeof v !== 'number' || !Number.isInteger(v)) {
        throw new TypeError(`values[${i}] must be an integer`);
      }
      if (!Number.isSafeInteger(v)) {
        throw new RangeError(`values[${i}] must be a safe integer`);
      }
    }

    const input = values.slice(); // never touch the caller's array
    this.#length = input.length;

    const sortedDistinct = Array.from(new Set(input)).sort((a, b) => a - b);
    this.#sortedDistinct = sortedDistinct;
    const m = sortedDistinct.length;

    let numLevels = 0;
    while ((1 << numLevels) < m) {
      numLevels += 1;
    }
    this.#numLevels = numLevels;

    const codes = input.map((v) => WaveletMatrix.#lowerBound(sortedDistinct, v));

    const n = this.#length;
    const levelBits = [];
    const levelOnesPrefix = [];
    const levelZeroCount = new Uint32Array(numLevels);

    let current = codes;
    for (let level = 0; level < numLevels; level += 1) {
      const bitPos = numLevels - 1 - level;
      const bits = new Uint8Array(n);
      const onesPrefix = new Uint32Array(n + 1);
      const zeros = [];
      const ones = [];
      for (let i = 0; i < n; i += 1) {
        const bit = (current[i] >> bitPos) & 1;
        bits[i] = bit;
        onesPrefix[i + 1] = onesPrefix[i] + bit;
        if (bit === 0) {
          zeros.push(current[i]);
        } else {
          ones.push(current[i]);
        }
      }
      levelBits.push(bits);
      levelOnesPrefix.push(onesPrefix);
      levelZeroCount[level] = zeros.length;
      current = zeros.concat(ones);
    }

    this.#levelBits = levelBits;
    this.#levelOnesPrefix = levelOnesPrefix;
    this.#levelZeroCount = levelZeroCount;
  }

  /** Number of elements the wavelet matrix was built from. */
  get length() {
    return this.#length;
  }

  // ---- validation helpers -------------------------------------------

  static #validateInteger(value, name) {
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      throw new TypeError(`${name} must be an integer`);
    }
  }

  static #validateSafeInteger(value, name) {
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      throw new TypeError(`${name} must be an integer`);
    }
    if (!Number.isSafeInteger(value)) {
      throw new RangeError(`${name} must be a safe integer`);
    }
  }

  #validateIndex(index, name) {
    WaveletMatrix.#validateInteger(index, name);
    if (index < 0 || index >= this.#length) {
      throw new RangeError(`${name} out of range [0, ${this.#length})`);
    }
  }

  /** Validates a half-open position bound in [0, length]. */
  #validatePositionBound(pos, name) {
    WaveletMatrix.#validateInteger(pos, name);
    if (pos < 0 || pos > this.#length) {
      throw new RangeError(`${name} out of range [0, ${this.#length}]`);
    }
  }

  #validatePositionRange(left, right) {
    this.#validatePositionBound(left, 'left');
    this.#validatePositionBound(right, 'right');
    if (left > right) {
      throw new RangeError('left must be <= right');
    }
  }

  // ---- static coordinate-compression helpers -------------------------

  /** Index of the first element >= target (a.k.a. lower_bound). */
  static #lowerBound(sorted, target) {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (sorted[mid] < target) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    return lo;
  }

  /** Index of the first element > target (a.k.a. upper_bound). */
  static #upperBound(sorted, target) {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (sorted[mid] <= target) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    return lo;
  }

  /** code of `value` if present, else -1. */
  #codeOf(value) {
    const idx = WaveletMatrix.#lowerBound(this.#sortedDistinct, value);
    if (idx < this.#sortedDistinct.length && this.#sortedDistinct[idx] === value) {
      return idx;
    }
    return -1;
  }

  // ---- level bit-vector primitives ------------------------------------

  /** count of 1-bits in level's bit array over [0, pos). */
  #rank1(level, pos) {
    return this.#levelOnesPrefix[level][pos];
  }

  /** count of 0-bits in level's bit array over [0, pos). */
  #rank0(level, pos) {
    return pos - this.#levelOnesPrefix[level][pos];
  }

  /** Maps a position forward by one level, following the branch for `bit`. */
  #descend(level, pos, bit) {
    if (bit === 0) {
      return this.#rank0(level, pos);
    }
    return this.#levelZeroCount[level] + this.#rank1(level, pos);
  }

  // ---- public query operations ----------------------------------------

  /** Value originally at `index`. */
  access(index) {
    this.#validateIndex(index, 'index');
    let pos = index;
    let code = 0;
    for (let level = 0; level < this.#numLevels; level += 1) {
      const bit = this.#levelBits[level][pos];
      code = (code << 1) | bit;
      pos = this.#descend(level, pos, bit);
    }
    return this.#sortedDistinct[code];
  }

  /** Count of `value` in position range [0, end). */
  rank(value, end) {
    WaveletMatrix.#validateSafeInteger(value, 'value');
    this.#validatePositionBound(end, 'end');

    const code = this.#codeOf(value);
    if (code === -1) {
      return 0;
    }

    let left = 0;
    let right = end;
    for (let level = 0; level < this.#numLevels; level += 1) {
      const bitPos = this.#numLevels - 1 - level;
      const bit = (code >> bitPos) & 1;
      left = this.#descend(level, left, bit);
      right = this.#descend(level, right, bit);
    }
    return right - left;
  }

  /**
   * Position of the `occurrence`-th (0-based) occurrence of `value`.
   *
   * Implemented as a binary search over `rank(value, end)`, which is
   * monotonic non-decreasing in `end` and increases by exactly 1 at each
   * occurrence of `value` — this reuses the already-verified `rank()`
   * descent rather than an independent bottom-up bit-vector inversion,
   * trading an extra O(log length) factor for a much smaller, more
   * obviously-correct implementation.
   */
  select(value, occurrence) {
    WaveletMatrix.#validateSafeInteger(value, 'value');
    WaveletMatrix.#validateInteger(occurrence, 'occurrence');

    const total = this.rank(value, this.#length);
    if (occurrence < 0 || occurrence >= total) {
      throw new RangeError(`occurrence out of range [0, ${total})`);
    }

    // Smallest pos such that rank(value, pos + 1) > occurrence is exactly
    // the (occurrence)-th 0-indexed occurrence's position.
    let lo = 0;
    let hi = this.#length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.rank(value, mid + 1) > occurrence) {
        hi = mid;
      } else {
        lo = mid + 1;
      }
    }
    return lo;
  }

  /** Count of elements in [left, right) with value in [min, max] (inclusive). */
  rangeFreq(left, right, min, max) {
    this.#validatePositionRange(left, right);
    WaveletMatrix.#validateSafeInteger(min, 'min');
    WaveletMatrix.#validateSafeInteger(max, 'max');
    if (min > max) {
      throw new RangeError('min must be <= max');
    }

    const loCode = WaveletMatrix.#lowerBound(this.#sortedDistinct, min);
    const hiCode = WaveletMatrix.#upperBound(this.#sortedDistinct, max);
    return this.#countCodeLessThan(left, right, hiCode) - this.#countCodeLessThan(left, right, loCode);
  }

  /** Count of elements in [left, right) whose code is < codeBound. */
  #countCodeLessThan(left, right, codeBound) {
    const m = this.#sortedDistinct.length;
    if (codeBound <= 0) {
      return 0;
    }
    if (codeBound >= m) {
      return right - left;
    }

    let count = 0;
    let l = left;
    let r = right;
    for (let level = 0; level < this.#numLevels; level += 1) {
      const bitPos = this.#numLevels - 1 - level;
      const boundBit = (codeBound >> bitPos) & 1;
      const l0 = this.#rank0(level, l);
      const r0 = this.#rank0(level, r);
      if (boundBit === 1) {
        // Every element whose bit is 0 here (same prefix so far) is now
        // guaranteed strictly less than codeBound; count them and keep
        // descending into the 1-branch to resolve the rest.
        count += r0 - l0;
        l = this.#levelZeroCount[level] + this.#rank1(level, l);
        r = this.#levelZeroCount[level] + this.#rank1(level, r);
      } else {
        // Elements whose bit is 1 here are already >= codeBound; only the
        // 0-branch can still contain elements < codeBound.
        l = l0;
        r = r0;
      }
    }
    return count;
  }

  /** k-th smallest (0-based) value among positions [left, right). */
  quantile(left, right, k) {
    this.#validatePositionRange(left, right);
    WaveletMatrix.#validateInteger(k, 'k');
    const count = right - left;
    if (k < 0 || k >= count) {
      throw new RangeError(`k out of range [0, ${count})`);
    }

    let l = left;
    let r = right;
    let code = 0;
    let remaining = k;
    for (let level = 0; level < this.#numLevels; level += 1) {
      const l0 = this.#rank0(level, l);
      const r0 = this.#rank0(level, r);
      const zerosInRange = r0 - l0;
      if (remaining < zerosInRange) {
        l = l0;
        r = r0;
        code = code << 1;
      } else {
        remaining -= zerosInRange;
        l = this.#levelZeroCount[level] + this.#rank1(level, l);
        r = this.#levelZeroCount[level] + this.#rank1(level, r);
        code = (code << 1) | 1;
      }
    }
    return this.#sortedDistinct[code];
  }
}

module.exports = { WaveletMatrix };
