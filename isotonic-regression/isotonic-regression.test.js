'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isotonicRegression } = require('./isotonic-regression.js');

// ---------------------------------------------------------------------------
// mulberry32 deterministic PRNG (fixed-seed, used for the randomized
// exhaustive-comparison block below).
// ---------------------------------------------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Independent exhaustive contiguous-partition reference solver -- for
// short arrays, enumerates every way to cut the array into contiguous
// blocks, keeps only partitions whose block weighted-means are
// nondecreasing, and returns the one with minimum weighted SSE. A direct
// transcription of the mathematical definition of isotonic regression;
// deliberately uses no merge-stack logic (unlike the module under test).
function referenceIsotonicRegression(values, weights) {
  const n = values.length;
  if (n === 0) return [];
  const w = weights || new Array(n).fill(1);
  const numGaps = n - 1;
  let bestSSE = Infinity;
  let bestFitted = null;
  const totalMasks = 1 << numGaps;
  for (let mask = 0; mask < totalMasks; mask++) {
    const blocks = [];
    let start = 0;
    for (let g = 0; g < numGaps; g++) {
      if (mask & (1 << g)) {
        blocks.push([start, g]);
        start = g + 1;
      }
    }
    blocks.push([start, n - 1]);

    const blockMeans = new Array(blocks.length);
    for (let b = 0; b < blocks.length; b++) {
      const [s, e] = blocks[b];
      let sumWV = 0;
      let sumW = 0;
      for (let k = s; k <= e; k++) {
        sumWV += w[k] * values[k];
        sumW += w[k];
      }
      blockMeans[b] = sumWV / sumW;
    }

    let admissible = true;
    for (let b = 1; b < blockMeans.length; b++) {
      if (blockMeans[b] < blockMeans[b - 1]) {
        admissible = false;
        break;
      }
    }
    if (!admissible) continue;

    let sse = 0;
    for (let b = 0; b < blocks.length; b++) {
      const [s, e] = blocks[b];
      const mean = blockMeans[b];
      for (let k = s; k <= e; k++) {
        const diff = values[k] - mean;
        sse += w[k] * diff * diff;
      }
    }

    if (sse < bestSSE) {
      bestSSE = sse;
      bestFitted = new Array(n);
      for (let b = 0; b < blocks.length; b++) {
        const [s, e] = blocks[b];
        for (let k = s; k <= e; k++) bestFitted[k] = blockMeans[b];
      }
    }
  }

  return bestFitted;
}

function maxAbsDiff(a, b) {
  assert.equal(a.length, b.length);
  let max = 0;
  for (let i = 0; i < a.length; i++) {
    max = Math.max(max, Math.abs(a[i] - b[i]));
  }
  return max;
}

function assertNondecreasing(arr) {
  for (let i = 1; i < arr.length; i++) {
    assert.ok(
      arr[i] >= arr[i - 1],
      `expected nondecreasing output, got arr[${i - 1}]=${arr[i - 1]} > arr[${i}]=${arr[i]}`
    );
  }
}

// ---------------------------------------------------------------------------
// Empty and singleton
// ---------------------------------------------------------------------------

test('empty input returns an empty array', () => {
  assert.deepEqual(isotonicRegression([]), []);
});

test('singleton input returns the single value unchanged', () => {
  assert.deepEqual(isotonicRegression([7]), [7]);
  assert.deepEqual(isotonicRegression([-3.5]), [-3.5]);
});

// ---------------------------------------------------------------------------
// Already sorted (nondecreasing) input: no merges, output equals input
// ---------------------------------------------------------------------------

test('already-nondecreasing input is returned unchanged', () => {
  assert.deepEqual(isotonicRegression([1, 2, 3, 4, 5]), [1, 2, 3, 4, 5]);
  assert.deepEqual(isotonicRegression([-5, -2, 0, 0, 3]), [-5, -2, 0, 0, 3]);
});

// ---------------------------------------------------------------------------
// Strictly descending: everything merges into one block
// ---------------------------------------------------------------------------

test('strictly descending input merges into a single block (the weighted mean)', () => {
  assert.deepEqual(isotonicRegression([3, 2, 1]), [2, 2, 2]);
  assert.deepEqual(isotonicRegression([4, 3, 2, 1]), [2.5, 2.5, 2.5, 2.5]);
});

// ---------------------------------------------------------------------------
// Plateau: all-equal input has no violations, output equals input
// ---------------------------------------------------------------------------

test('all-equal (plateau) input has no violations and is returned unchanged', () => {
  assert.deepEqual(isotonicRegression([4, 4, 4, 4]), [4, 4, 4, 4]);
});

// ---------------------------------------------------------------------------
// Duplicate values mixed with violations
// ---------------------------------------------------------------------------

test('duplicate values mixed with a violation pool correctly', () => {
  // [1, 2, 1] -> the last two points pool to their mean, 1.5
  assert.deepEqual(isotonicRegression([1, 2, 1]), [1, 1.5, 1.5]);
});

// ---------------------------------------------------------------------------
// Negative values
// ---------------------------------------------------------------------------

test('negative values are handled correctly', () => {
  // [-1, -3, -2]: whole array must pool (mean = -2) to stay nondecreasing
  assert.deepEqual(isotonicRegression([-1, -3, -2]), [-2, -2, -2]);
});

// ---------------------------------------------------------------------------
// Fractional values
// ---------------------------------------------------------------------------

test('fractional values are handled correctly', () => {
  const result = isotonicRegression([1.5, 0.5]);
  assert.equal(result.length, 2);
  assert.ok(Math.abs(result[0] - 1) < 1e-12);
  assert.ok(Math.abs(result[1] - 1) < 1e-12);
});

// ---------------------------------------------------------------------------
// Weighted cases
// ---------------------------------------------------------------------------

test('omitted weights default to 1 for every point', () => {
  assert.deepEqual(
    isotonicRegression([3, 1, 2]),
    isotonicRegression([3, 1, 2], [1, 1, 1])
  );
});

test('a heavier weight pulls the pooled mean toward its value', () => {
  // [3, 1] must pool (descending). Weight 3 heavily favors the value 3.
  const heavy = isotonicRegression([3, 1], [10, 1]);
  const even = isotonicRegression([3, 1], [1, 1]);
  assert.ok(heavy[0] > even[0], 'heavier weight on the larger value should pull the pooled mean up');
  // Exact weighted mean: (3*10 + 1*1) / 11
  const expected = (3 * 10 + 1 * 1) / 11;
  assert.ok(Math.abs(heavy[0] - expected) < 1e-12);
  assert.ok(Math.abs(heavy[1] - expected) < 1e-12);
});

test('an already-nondecreasing sequence is unaffected by any weights', () => {
  assert.deepEqual(isotonicRegression([1, 2, 3], [100, 0.001, 5]), [1, 2, 3]);
});

// ---------------------------------------------------------------------------
// Invalid inputs
// ---------------------------------------------------------------------------

test('throws TypeError when values is not an array', () => {
  assert.throws(() => isotonicRegression(null), TypeError);
  assert.throws(() => isotonicRegression(undefined), TypeError);
  assert.throws(() => isotonicRegression('1,2,3'), TypeError);
  assert.throws(() => isotonicRegression(42), TypeError);
});

test('throws TypeError when values contains a non-finite entry', () => {
  assert.throws(() => isotonicRegression([1, NaN, 3]), TypeError);
  assert.throws(() => isotonicRegression([1, Infinity, 3]), TypeError);
  assert.throws(() => isotonicRegression([1, -Infinity, 3]), TypeError);
  assert.throws(() => isotonicRegression([1, '2', 3]), TypeError);
  assert.throws(() => isotonicRegression([1, null, 3]), TypeError);
});

test('throws TypeError when weights is provided but not an array', () => {
  assert.throws(() => isotonicRegression([1, 2], 'weights'), TypeError);
  assert.throws(() => isotonicRegression([1, 2], 42), TypeError);
});

test('throws TypeError when weights contains a non-finite entry', () => {
  assert.throws(() => isotonicRegression([1, 2], [1, NaN]), TypeError);
  assert.throws(() => isotonicRegression([1, 2], [1, Infinity]), TypeError);
});

test('throws RangeError when weights.length does not match values.length', () => {
  assert.throws(() => isotonicRegression([1, 2, 3], [1, 1]), RangeError);
  assert.throws(() => isotonicRegression([1, 2], [1, 1, 1]), RangeError);
  assert.throws(() => isotonicRegression([], [1]), RangeError);
});

test('throws RangeError when a weight is zero or negative', () => {
  assert.throws(() => isotonicRegression([1, 2], [1, 0]), RangeError);
  assert.throws(() => isotonicRegression([1, 2], [1, -1]), RangeError);
  assert.throws(() => isotonicRegression([1, 2], [0, 1]), RangeError);
});

// ---------------------------------------------------------------------------
// Immutable input: never mutates values or weights
// ---------------------------------------------------------------------------

test('never mutates the values array', () => {
  const values = [3, 1, 2];
  const copy = values.slice();
  isotonicRegression(values);
  assert.deepEqual(values, copy);
});

test('never mutates the weights array', () => {
  const values = [3, 1, 2];
  const weights = [2, 5, 1];
  const weightsCopy = weights.slice();
  isotonicRegression(values, weights);
  assert.deepEqual(weights, weightsCopy);
});

// ---------------------------------------------------------------------------
// Output is always nondecreasing (structural invariant), across a spread
// of randomized inputs.
// ---------------------------------------------------------------------------

test('output is always nondecreasing across randomized inputs', () => {
  const rand = mulberry32(0xa11cafe);
  for (let t = 0; t < 300; t++) {
    const n = Math.floor(rand() * 15);
    const values = Array.from({ length: n }, () => (rand() - 0.5) * 100);
    const weights = Array.from({ length: n }, () => 0.01 + rand() * 5);
    assertNondecreasing(isotonicRegression(values, weights));
  }
});

// ---------------------------------------------------------------------------
// Fixed-seed exhaustive differential comparison: at least 200 arrays of
// length 0-8, compared against the independent exhaustive
// contiguous-partition reference solver, within 1e-10.
// ---------------------------------------------------------------------------

test('deterministic randomized differential coverage: at least 200 arrays of length 0-8 against an independent exhaustive contiguous-partition solver, within 1e-10', () => {
  const rand = mulberry32(0xc0ffee);
  const trials = 300;
  let checked = 0;
  for (let t = 0; t < trials; t++) {
    const n = Math.floor(rand() * 9); // length 0..8 inclusive
    const values = Array.from({ length: n }, () => (rand() - 0.5) * 200);
    const weights = Array.from({ length: n }, () => 0.01 + rand() * 10);
    const actual = isotonicRegression(values, weights);
    const expected = referenceIsotonicRegression(values, weights);
    const diff = maxAbsDiff(actual, expected);
    assert.ok(
      diff < 1e-10,
      `trial ${t}: n=${n} values=${values} weights=${weights} maxAbsDiff=${diff}`
    );
    checked++;
  }
  assert.equal(checked, trials);
  assert.ok(checked >= 200);
});

test('deterministic randomized differential coverage: unweighted small arrays (length 0-8) against the reference, within 1e-10', () => {
  const rand = mulberry32(0x5eed5eed);
  const trials = 200;
  for (let t = 0; t < trials; t++) {
    const n = Math.floor(rand() * 9);
    const values = Array.from({ length: n }, () => (rand() - 0.5) * 50);
    const actual = isotonicRegression(values);
    const expected = referenceIsotonicRegression(values);
    const diff = maxAbsDiff(actual, expected);
    assert.ok(diff < 1e-10, `trial ${t}: n=${n} values=${values} maxAbsDiff=${diff}`);
  }
});
