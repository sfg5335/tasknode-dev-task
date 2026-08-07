'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { WaveletMatrix } = require('./wavelet-matrix.js');

function bruteAccess(arr, index) {
  return arr[index];
}
function bruteRank(arr, value, end) {
  let count = 0;
  for (let i = 0; i < end; i++) if (arr[i] === value) count++;
  return count;
}
function bruteSelect(arr, value, occurrence) {
  let count = 0;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] === value) {
      if (count === occurrence) return i;
      count++;
    }
  }
  return -1;
}
function bruteRangeCount(arr, left, right, min, max) {
  let count = 0;
  for (let i = left; i < right; i++) if (arr[i] >= min && arr[i] < max) count++;
  return count;
}
function bruteQuantile(arr, left, right, k) {
  const slice = arr.slice(left, right).sort((a, b) => a - b);
  return slice[k];
}

function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

test('empty input: length 0, and every method behaves per its documented empty-array semantics', () => {
  const wm = new WaveletMatrix([]);
  assert.equal(wm.length, 0);
  assert.throws(() => wm.access(0), RangeError);
  assert.equal(wm.rank(5, 0), 0, 'rank on the only valid end (0) of an empty array is 0');
  assert.throws(() => wm.rank(5, 1), RangeError, 'end=1 exceeds length=0');
  assert.equal(wm.select(5, 0), -1);
  assert.equal(wm.rangeCount(0, 0, -10, 10), 0);
  assert.throws(() => wm.quantile(0, 0, 0), RangeError, 'the only position range [0,0) is empty, which quantile rejects');
});

test('single distinct value, repeated, including negative values', () => {
  const wm = new WaveletMatrix([-5, -5, -5, -5]);
  assert.equal(wm.length, 4);
  for (let i = 0; i < 4; i++) assert.equal(wm.access(i), -5);
  assert.equal(wm.rank(-5, 4), 4);
  assert.equal(wm.rank(-5, 2), 2);
  assert.equal(wm.rank(-5, 0), 0);
  assert.equal(wm.rank(0, 4), 0, 'a value that never occurs has rank 0, not an error');
  assert.equal(wm.select(-5, 0), 0);
  assert.equal(wm.select(-5, 3), 3);
  assert.equal(wm.select(-5, 4), -1, 'only 4 occurrences exist (indices 0-3)');
  assert.equal(wm.rangeCount(0, 4, -10, 0), 4);
  assert.equal(wm.rangeCount(0, 4, 0, 10), 0);
  assert.equal(wm.quantile(0, 4, 0), -5);
  assert.equal(wm.quantile(0, 4, 3), -5);
});

test('access: matches plain array indexing for every position, duplicates and negatives included', () => {
  const arr = [3, -1, 4, -1, 5, 9, -2, 6, -1];
  const wm = new WaveletMatrix(arr);
  for (let i = 0; i < arr.length; i++) assert.equal(wm.access(i), bruteAccess(arr, i));
});

test('rank: counts occurrences in [0, end), including absent values and boundary ends', () => {
  const arr = [3, 1, 4, 1, 5, 9, 2, 6, 1];
  const wm = new WaveletMatrix(arr);
  assert.equal(wm.rank(1, 0), 0);
  assert.equal(wm.rank(1, 2), 1);
  assert.equal(wm.rank(1, 4), 2);
  assert.equal(wm.rank(1, 9), 3, 'full-array rank uses end === length');
  assert.equal(wm.rank(100, 9), 0, 'a value absent from the array has rank 0 everywhere');
  assert.equal(wm.rank(9, 6), 1);
  assert.equal(wm.rank(9, 5), 0, 'the occurrence of 9 is at index 5, which is excluded by end=5 (half-open)');
});

test('select: zero-based occurrence index, -1 when there is no such occurrence', () => {
  const arr = [7, 2, 7, 2, 7, 7, 2];
  const wm = new WaveletMatrix(arr);
  assert.equal(wm.select(7, 0), 0);
  assert.equal(wm.select(7, 1), 2);
  assert.equal(wm.select(7, 2), 4);
  assert.equal(wm.select(7, 3), 5);
  assert.equal(wm.select(7, 4), -1, 'only 4 occurrences of 7 exist');
  assert.equal(wm.select(2, 0), 1);
  assert.equal(wm.select(2, 2), 6);
  assert.equal(wm.select(99, 0), -1, 'a value absent from the array always returns -1');
});

test('rangeCount: half-open on both positions and values', () => {
  const arr = [5, 1, 8, 3, 9, 2, 7, 4, 6, 0];
  const wm = new WaveletMatrix(arr);
  // Full array, full value range: every element counts.
  assert.equal(wm.rangeCount(0, 10, -100, 100), 10);
  // Positions [2,7) are [8,3,9,2,7]; values in [3,9) are 8,3,7 -> but 9 is
  // excluded since the value range is half-open at 9.
  assert.equal(wm.rangeCount(2, 7, 3, 9), 3);
  // A value range that touches nothing.
  assert.equal(wm.rangeCount(0, 10, 100, 200), 0);
  // A position range that is empty ([4,4)) always counts 0, regardless of value range.
  assert.equal(wm.rangeCount(4, 4, -100, 100), 0);
  // min===max is a legal empty value range -> 0, not an error.
  assert.equal(wm.rangeCount(0, 10, 5, 5), 0);
});

test('quantile: k-th smallest (0-indexed) within a position range', () => {
  const arr = [5, 1, 8, 3, 9, 2, 7, 4, 6, 0];
  const wm = new WaveletMatrix(arr);
  // Full array sorted is 0..9, so quantile(k) === k for the whole array.
  for (let k = 0; k < 10; k++) assert.equal(wm.quantile(0, 10, k), k);
  // Sub-range [2,7) is [8,3,9,2,7] -> sorted [2,3,7,8,9].
  assert.equal(wm.quantile(2, 7, 0), 2);
  assert.equal(wm.quantile(2, 7, 2), 7);
  assert.equal(wm.quantile(2, 7, 4), 9);
  // Single-element range.
  assert.equal(wm.quantile(4, 5, 0), 9);
});

test('invalid constructor input throws TypeError', () => {
  assert.throws(() => new WaveletMatrix('not-an-array'), TypeError);
  assert.throws(() => new WaveletMatrix(null), TypeError);
  assert.throws(() => new WaveletMatrix(undefined), TypeError);
  assert.throws(() => new WaveletMatrix([1, 2.5]), TypeError, 'non-integer number');
  assert.throws(() => new WaveletMatrix([1, NaN]), TypeError);
  assert.throws(() => new WaveletMatrix([1, Infinity]), TypeError);
  assert.throws(() => new WaveletMatrix([1, -Infinity]), TypeError);
  assert.throws(() => new WaveletMatrix([1, '2']), TypeError);
  assert.throws(() => new WaveletMatrix([1, null]), TypeError);
  assert.throws(() => new WaveletMatrix([1, undefined]), TypeError);
  assert.throws(() => new WaveletMatrix([1, {}]), TypeError);
  assert.throws(() => new WaveletMatrix([1, Number.MAX_SAFE_INTEGER + 10]), TypeError, 'not a safe integer');
});

test('invalid method arguments throw TypeError for wrong types and RangeError for out-of-bounds', () => {
  const wm = new WaveletMatrix([3, 1, 4, 1, 5, 9, 2, 6]); // length 8

  assert.throws(() => wm.access(1.5), TypeError);
  assert.throws(() => wm.access('0'), TypeError);
  assert.throws(() => wm.access(-1), RangeError);
  assert.throws(() => wm.access(8), RangeError, 'length is 8, so index 8 is out of range');

  assert.throws(() => wm.rank('x', 2), TypeError);
  assert.throws(() => wm.rank(NaN, 2), TypeError);
  assert.throws(() => wm.rank(1, 1.5), TypeError);
  assert.throws(() => wm.rank(1, -1), RangeError);
  assert.throws(() => wm.rank(1, 9), RangeError, 'end may be at most length=8');
  assert.doesNotThrow(() => wm.rank(1, 8), 'end===length is the valid upper boundary');

  assert.throws(() => wm.select('x', 0), TypeError);
  assert.throws(() => wm.select(1, 1.5), TypeError);
  assert.throws(() => wm.select(1, -1), RangeError);
  assert.doesNotThrow(() => wm.select(1, 0));

  assert.throws(() => wm.rangeCount(1.5, 2, 0, 10), TypeError);
  assert.throws(() => wm.rangeCount(0, 2.5, 0, 10), TypeError);
  assert.throws(() => wm.rangeCount(0, 2, 'x', 10), TypeError);
  assert.throws(() => wm.rangeCount(0, 2, 0, NaN), TypeError);
  assert.throws(() => wm.rangeCount(-1, 2, 0, 10), RangeError);
  assert.throws(() => wm.rangeCount(0, 9, 0, 10), RangeError, 'right may be at most length=8');
  assert.throws(() => wm.rangeCount(5, 2, 0, 10), RangeError, 'left must be <= right');
  assert.throws(() => wm.rangeCount(0, 8, 10, 0), RangeError, 'min must be <= max');
  assert.doesNotThrow(() => wm.rangeCount(0, 8, 0, 0), 'min===max is a legal empty value range');

  assert.throws(() => wm.quantile(1.5, 2, 0), TypeError);
  assert.throws(() => wm.quantile(0, 2, 0.5), TypeError);
  assert.throws(() => wm.quantile(-1, 2, 0), RangeError);
  assert.throws(() => wm.quantile(0, 9, 0), RangeError, 'right may be at most length=8');
  assert.throws(() => wm.quantile(2, 2, 0), RangeError, 'left===right is an empty range, which quantile rejects');
  assert.throws(() => wm.quantile(3, 2, 0), RangeError, 'left must be < right');
  assert.throws(() => wm.quantile(0, 8, -1), RangeError, 'k must be non-negative');
  assert.throws(() => wm.quantile(0, 8, 8), RangeError, 'k must be < right-left');
});

test('repeated calls are side-effect-free (the matrix is immutable)', () => {
  const wm = new WaveletMatrix([3, 1, 4, 1, 5, 9, 2, 6]);
  const first = [wm.access(2), wm.rank(1, 8), wm.select(1, 1), wm.rangeCount(0, 8, 1, 5), wm.quantile(0, 8, 3)];
  const second = [wm.access(2), wm.rank(1, 8), wm.select(1, 1), wm.rangeCount(0, 8, 1, 5), wm.quantile(0, 8, 3)];
  assert.deepEqual(first, second);
});

test('does not mutate the caller\'s input array', () => {
  const input = Object.freeze([5, 1, 8, 3, 9, 2, 7, 4, 6, 0]);
  assert.doesNotThrow(() => new WaveletMatrix(input));
  const wm = new WaveletMatrix(input);
  assert.equal(wm.access(0), 5);

  const mutable = [5, 1, 8, 3, 9];
  const wm2 = new WaveletMatrix(mutable);
  mutable[0] = 999;
  assert.equal(wm2.access(0), 5, 'the matrix must be unaffected by later mutation of the source array');
});

test('fixed deterministic comparisons against naive array operations for a hand-picked array', () => {
  const arr = [5, -3, 5, 0, -3, 8, 5, -1, 0, 8, 2, -3, 6];
  const wm = new WaveletMatrix(arr);
  assert.equal(wm.length, arr.length);

  for (let i = 0; i < arr.length; i++) {
    assert.equal(wm.access(i), bruteAccess(arr, i));
  }

  const candidateValues = new Set(arr);
  for (let v = -6; v <= 10; v++) candidateValues.add(v);
  for (const v of candidateValues) {
    for (let end = 0; end <= arr.length; end++) {
      assert.equal(wm.rank(v, end), bruteRank(arr, v, end), `rank(${v}, ${end})`);
    }
    for (let occurrence = 0; occurrence < arr.length + 1; occurrence++) {
      assert.equal(wm.select(v, occurrence), bruteSelect(arr, v, occurrence), `select(${v}, ${occurrence})`);
    }
  }

  for (let left = 0; left <= arr.length; left++) {
    for (let right = left; right <= arr.length; right++) {
      for (let min = -7; min <= 9; min += 2) {
        for (let max = min; max <= 10; max += 2) {
          assert.equal(
            wm.rangeCount(left, right, min, max),
            bruteRangeCount(arr, left, right, min, max),
            `rangeCount(${left}, ${right}, ${min}, ${max})`
          );
        }
      }
      if (right > left) {
        for (let k = 0; k < right - left; k++) {
          assert.equal(wm.quantile(left, right, k), bruteQuantile(arr, left, right, k), `quantile(${left}, ${right}, ${k})`);
        }
      }
    }
  }
});

test('randomized fixed-seed comparisons against naive array operations', () => {
  const rng = makeRng(20260807);
  const TRIALS = 60;
  for (let t = 0; t < TRIALS; t++) {
    const len = Math.floor(rng() * 20);
    const arr = [];
    for (let i = 0; i < len; i++) arr.push(Math.floor(rng() * 21) - 10);
    const wm = new WaveletMatrix(arr);

    for (let i = 0; i < len; i++) assert.equal(wm.access(i), bruteAccess(arr, i), `trial ${t} access(${i})`);

    for (let v = -12; v <= 12; v++) {
      const end = Math.floor(rng() * (len + 1));
      assert.equal(wm.rank(v, end), bruteRank(arr, v, end), `trial ${t} rank(${v}, ${end})`);
      const occurrence = Math.floor(rng() * (len + 2));
      assert.equal(wm.select(v, occurrence), bruteSelect(arr, v, occurrence), `trial ${t} select(${v}, ${occurrence})`);
    }

    for (let c = 0; c < 15; c++) {
      const left = Math.floor(rng() * (len + 1));
      const right = left + Math.floor(rng() * (len - left + 1));
      const min = Math.floor(rng() * 25) - 12;
      const max = min + Math.floor(rng() * 15);
      assert.equal(
        wm.rangeCount(left, right, min, max),
        bruteRangeCount(arr, left, right, min, max),
        `trial ${t} rangeCount(${left}, ${right}, ${min}, ${max})`
      );
      if (right > left) {
        const k = Math.floor(rng() * (right - left));
        assert.equal(wm.quantile(left, right, k), bruteQuantile(arr, left, right, k), `trial ${t} quantile(${left}, ${right}, ${k})`);
      }
    }
  }
});
