'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { WaveletMatrix } = require('./wavelet-matrix.js');

// ---- deterministic seeded PRNG (mulberry32) so randomized tests are
// fully reproducible across every run, with no external randomness. ----
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function randInt(rng, lo, hi) {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

// ---- brute-force array-based reference implementations, used for
// differential testing against the WaveletMatrix under test. ----
function refRank(arr, value, end) {
  let c = 0;
  for (let i = 0; i < end; i += 1) if (arr[i] === value) c += 1;
  return c;
}
function refSelect(arr, value, occurrence) {
  let seen = 0;
  for (let i = 0; i < arr.length; i += 1) {
    if (arr[i] === value) {
      if (seen === occurrence) return i;
      seen += 1;
    }
  }
  throw new RangeError('occurrence out of range');
}
function refRangeFreq(arr, left, right, min, max) {
  let c = 0;
  for (let i = left; i < right; i += 1) {
    if (arr[i] >= min && arr[i] <= max) c += 1;
  }
  return c;
}
function refQuantile(arr, left, right, k) {
  return arr.slice(left, right).sort((a, b) => a - b)[k];
}

/** Asserts every public operation of `wm` (built from `arr`) matches the
 * brute-force reference, across all in-range arguments. Used both by the
 * fixed-data-shape tests and the randomized differential tests below. */
function assertMatchesReference(arr, wm) {
  const n = arr.length;
  assert.equal(wm.length, n);

  for (let i = 0; i < n; i += 1) {
    assert.equal(wm.access(i), arr[i], `access(${i})`);
  }

  const probeValues = Array.from(
    new Set([...arr, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 0, -1, 1])
  );
  for (const v of probeValues) {
    for (let end = 0; end <= n; end += 1) {
      assert.equal(wm.rank(v, end), refRank(arr, v, end), `rank(${v}, ${end})`);
    }
    const total = refRank(arr, v, n);
    for (let occ = 0; occ < total; occ += 1) {
      assert.equal(wm.select(v, occ), refSelect(arr, v, occ), `select(${v}, ${occ})`);
    }
    assert.throws(() => wm.select(v, total), RangeError, `select(${v}, ${total}) should be out of range`);
  }

  for (let left = 0; left <= n; left += 1) {
    for (let right = left; right <= n; right += 1) {
      const min = -3;
      const max = 3;
      assert.equal(
        wm.rangeFreq(left, right, min, max),
        refRangeFreq(arr, left, right, min, max),
        `rangeFreq(${left}, ${right}, ${min}, ${max})`
      );
      if (right > left) {
        for (let k = 0; k < right - left; k += 1) {
          assert.equal(
            wm.quantile(left, right, k),
            refQuantile(arr, left, right, k),
            `quantile(${left}, ${right}, ${k})`
          );
        }
      }
    }
  }
}

// ---------------------------------------------------------------------
// Fixed data-shape coverage (step 3): empty, singleton, all-equal,
// sorted, reversed, duplicate, negative, and safe-integer-boundary data.
// ---------------------------------------------------------------------

test('empty array', () => {
  const wm = new WaveletMatrix([]);
  assert.equal(wm.length, 0);
  assertMatchesReference([], wm);
});

test('singleton array', () => {
  const wm = new WaveletMatrix([42]);
  assertMatchesReference([42], wm);
});

test('all-equal data', () => {
  const arr = [7, 7, 7, 7, 7, 7];
  assertMatchesReference(arr, new WaveletMatrix(arr));
});

test('sorted ascending data', () => {
  const arr = [-3, -1, 0, 2, 4, 4, 9, 12];
  assertMatchesReference(arr, new WaveletMatrix(arr));
});

test('reversed (sorted descending) data', () => {
  const arr = [12, 9, 4, 4, 2, 0, -1, -3];
  assertMatchesReference(arr, new WaveletMatrix(arr));
});

test('data with many duplicates', () => {
  const arr = [3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5, 1, 4, 1];
  assertMatchesReference(arr, new WaveletMatrix(arr));
});

test('all-negative data', () => {
  const arr = [-9, -2, -7, -2, -100, -1, -50];
  assertMatchesReference(arr, new WaveletMatrix(arr));
});

test('mixed positive/negative/zero data', () => {
  const arr = [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5];
  assertMatchesReference(arr, new WaveletMatrix(arr));
});

test('safe-integer boundary values', () => {
  const arr = [
    Number.MIN_SAFE_INTEGER,
    Number.MIN_SAFE_INTEGER + 1,
    0,
    Number.MAX_SAFE_INTEGER - 1,
    Number.MAX_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER,
    Number.MIN_SAFE_INTEGER,
  ];
  assertMatchesReference(arr, new WaveletMatrix(arr));
});

test('power-of-two and non-power-of-two alphabet sizes', () => {
  // exercise numLevels boundaries: m = 1, 2, 3, 4, 5, 8, 9
  for (const m of [1, 2, 3, 4, 5, 8, 9]) {
    const arr = Array.from({ length: m * 3 }, (_, i) => i % m);
    assertMatchesReference(arr, new WaveletMatrix(arr));
  }
});

// ---------------------------------------------------------------------
// Construction validation
// ---------------------------------------------------------------------

test('constructor rejects a non-array', () => {
  assert.throws(() => new WaveletMatrix('nope'), TypeError);
  assert.throws(() => new WaveletMatrix(123), TypeError);
  assert.throws(() => new WaveletMatrix(null), TypeError);
  assert.throws(() => new WaveletMatrix(undefined), TypeError);
});

test('constructor rejects a non-number element', () => {
  assert.throws(() => new WaveletMatrix([1, 'two', 3]), TypeError);
  assert.throws(() => new WaveletMatrix([1, null, 3]), TypeError);
});

test('constructor rejects a non-safe-integer element', () => {
  assert.throws(() => new WaveletMatrix([1, 1.5, 3]), TypeError, '1.5 is not an integer at all');
  assert.throws(() => new WaveletMatrix([1, NaN, 3]), TypeError, 'NaN is not an integer at all');
  assert.throws(() => new WaveletMatrix([1, Infinity, 3]), TypeError, 'Infinity is not an integer at all');
  assert.throws(() => new WaveletMatrix([Number.MAX_SAFE_INTEGER + 1]), RangeError, 'an integer past the safe range');
});

test('constructor does not mutate the input array', () => {
  const input = [3, 1, 4, 1, 5];
  const snapshot = input.slice();
  const wm = new WaveletMatrix(input);
  assert.deepEqual(input, snapshot, 'input array must be untouched');
  // also confirm the matrix doesn't merely hold a reference to `input`
  input[0] = 999;
  assert.equal(wm.access(0), 3, 'wavelet matrix must have copied the data');
});

// ---------------------------------------------------------------------
// access() validation
// ---------------------------------------------------------------------

test('access validates its argument', () => {
  const wm = new WaveletMatrix([10, 20, 30]);
  assert.throws(() => wm.access(1.5), TypeError);
  assert.throws(() => wm.access('1'), TypeError);
  assert.throws(() => wm.access(-1), RangeError);
  assert.throws(() => wm.access(3), RangeError);
  assert.equal(wm.access(0), 10);
  assert.equal(wm.access(2), 30);
});

// ---------------------------------------------------------------------
// rank() validation
// ---------------------------------------------------------------------

test('rank validates its arguments', () => {
  const wm = new WaveletMatrix([1, 2, 2, 3]);
  assert.throws(() => wm.rank('2', 4), TypeError);
  assert.throws(() => wm.rank(1.5, 4), TypeError, '1.5 is not an integer at all');
  assert.throws(() => wm.rank(2, 1.5), TypeError);
  assert.throws(() => wm.rank(2, -1), RangeError);
  assert.throws(() => wm.rank(2, 5), RangeError);
});

test('rank of a value never present returns 0 everywhere', () => {
  const wm = new WaveletMatrix([1, 2, 2, 3]);
  for (let end = 0; end <= 4; end += 1) {
    assert.equal(wm.rank(999, end), 0);
    assert.equal(wm.rank(-999, end), 0);
  }
});

// ---------------------------------------------------------------------
// select() validation
// ---------------------------------------------------------------------

test('select validates its arguments', () => {
  const wm = new WaveletMatrix([1, 2, 2, 3]);
  assert.throws(() => wm.select('2', 0), TypeError);
  assert.throws(() => wm.select(2, 0.5), TypeError);
  assert.throws(() => wm.select(2, -1), RangeError);
  assert.throws(() => wm.select(2, 2), RangeError, 'only 2 occurrences of value 2 exist (indices 1,2)');
  assert.throws(() => wm.select(999, 0), RangeError, 'value never present has 0 occurrences');
});

// ---------------------------------------------------------------------
// rangeFreq() validation and semantics
// ---------------------------------------------------------------------

test('rangeFreq validates its arguments', () => {
  const wm = new WaveletMatrix([1, 2, 3, 4]);
  assert.throws(() => wm.rangeFreq(1.5, 3, 1, 4), TypeError);
  assert.throws(() => wm.rangeFreq(-1, 3, 1, 4), RangeError);
  assert.throws(() => wm.rangeFreq(3, 1, 1, 4), RangeError, 'left must be <= right');
  assert.throws(() => wm.rangeFreq(0, 5, 1, 4), RangeError, 'right must be <= length');
  assert.throws(() => wm.rangeFreq(0, 4, '1', 4), TypeError);
  assert.throws(() => wm.rangeFreq(0, 4, 1.5, 4), TypeError, '1.5 is not an integer at all');
  assert.throws(() => wm.rangeFreq(0, 4, 3, 1), RangeError, 'min must be <= max');
});

test('rangeFreq treats [min, max] as inclusive on both ends', () => {
  const wm = new WaveletMatrix([1, 2, 3, 4, 5]);
  assert.equal(wm.rangeFreq(0, 5, 2, 4), 3, 'values 2,3,4 -> 3 elements');
  assert.equal(wm.rangeFreq(0, 5, 3, 3), 1, 'exact single value via min===max');
  assert.equal(wm.rangeFreq(0, 5, -100, 100), 5, 'a value range wider than the data covers everything');
  assert.equal(wm.rangeFreq(0, 5, 100, 200), 0, 'a value range disjoint from the data is empty');
});

// ---------------------------------------------------------------------
// quantile() validation and semantics
// ---------------------------------------------------------------------

test('quantile validates its arguments', () => {
  const wm = new WaveletMatrix([5, 3, 1, 4, 2]);
  assert.throws(() => wm.quantile(1.5, 3, 0), TypeError);
  assert.throws(() => wm.quantile(-1, 3, 0), RangeError);
  assert.throws(() => wm.quantile(3, 1, 0), RangeError);
  assert.throws(() => wm.quantile(0, 5, '0'), TypeError);
  assert.throws(() => wm.quantile(0, 5, -1), RangeError);
  assert.throws(() => wm.quantile(0, 5, 5), RangeError, 'k must be < right-left');
  assert.throws(() => wm.quantile(2, 2, 0), RangeError, 'empty position range has no valid k');
});

test('quantile is 0-indexed (k=0 is the minimum of the range)', () => {
  const wm = new WaveletMatrix([5, 3, 1, 4, 2]);
  assert.equal(wm.quantile(0, 5, 0), 1, 'smallest of the whole array');
  assert.equal(wm.quantile(0, 5, 4), 5, 'largest of the whole array');
  assert.equal(wm.quantile(1, 4, 0), 1, 'smallest of positions [1,4) = {3,1,4}');
  assert.equal(wm.quantile(1, 4, 2), 4, 'largest of positions [1,4) = {3,1,4}');
});

// ---------------------------------------------------------------------
// Deterministic randomized differential tests (step 4) — every public
// query operation is cross-checked against a brute-force array
// implementation across many pseudo-random shapes, using a fixed seed
// so this suite is exactly reproducible on every run.
// ---------------------------------------------------------------------

test('deterministic randomized differential coverage: small dense arrays', () => {
  const rng = mulberry32(0xC0FFEE);
  for (let trial = 0; trial < 60; trial += 1) {
    const n = randInt(rng, 0, 25);
    const spread = randInt(rng, 1, 8);
    const arr = Array.from({ length: n }, () => randInt(rng, -spread, spread));
    assertMatchesReference(arr, new WaveletMatrix(arr));
  }
});

test('deterministic randomized differential coverage: larger sparse arrays', () => {
  const rng = mulberry32(0x5EED5EED);
  for (let trial = 0; trial < 20; trial += 1) {
    const n = randInt(rng, 50, 150);
    const spread = randInt(rng, 100, 5000);
    const arr = Array.from({ length: n }, () => randInt(rng, -spread, spread));
    const wm = new WaveletMatrix(arr);
    assert.equal(wm.length, n);
    for (let i = 0; i < n; i += 1) {
      assert.equal(wm.access(i), arr[i]);
    }
    for (let q = 0; q < 40; q += 1) {
      const left = randInt(rng, 0, n);
      const right = randInt(rng, left, n);
      let min = randInt(rng, -spread, spread);
      let max = randInt(rng, -spread, spread);
      if (min > max) [min, max] = [max, min];
      assert.equal(wm.rangeFreq(left, right, min, max), refRangeFreq(arr, left, right, min, max));
      if (right > left) {
        const k = randInt(rng, 0, right - left - 1);
        assert.equal(wm.quantile(left, right, k), refQuantile(arr, left, right, k));
      }
      const v = arr[randInt(rng, 0, n - 1)];
      const total = refRank(arr, v, n);
      const occ = randInt(rng, 0, total - 1);
      assert.equal(wm.select(v, occ), refSelect(arr, v, occ));
      const end = randInt(rng, 0, n);
      assert.equal(wm.rank(v, end), refRank(arr, v, end));
    }
  }
});

test('deterministic randomized differential coverage: safe-integer-boundary-heavy data', () => {
  const rng = mulberry32(0xFEEDFACE);
  const boundaryPool = [
    Number.MIN_SAFE_INTEGER,
    Number.MIN_SAFE_INTEGER + 1,
    -1,
    0,
    1,
    Number.MAX_SAFE_INTEGER - 1,
    Number.MAX_SAFE_INTEGER,
  ];
  for (let trial = 0; trial < 15; trial += 1) {
    const n = randInt(rng, 1, 20);
    const arr = Array.from({ length: n }, () => boundaryPool[randInt(rng, 0, boundaryPool.length - 1)]);
    assertMatchesReference(arr, new WaveletMatrix(arr));
  }
});
