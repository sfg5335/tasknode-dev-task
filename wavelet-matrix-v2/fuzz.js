'use strict';

const { WaveletMatrix } = require('./wavelet-matrix.js');

// Simple deterministic seeded PRNG (mulberry32) so runs are reproducible.
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
  // inclusive lo, inclusive hi
  return lo + Math.floor(rng() * (hi - lo + 1));
}

// ---- reference (brute force) implementations ----
function refAccess(arr, index) {
  return arr[index];
}
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
  const slice = arr.slice(left, right).sort((a, b) => a - b);
  return slice[k];
}

let checks = 0;
let mismatches = 0;

function check(label, actual, expected, context) {
  checks += 1;
  const same = Number.isNaN(expected) && Number.isNaN(actual) ? true : actual === expected;
  if (!same) {
    mismatches += 1;
    console.log('MISMATCH', label, { actual, expected, context });
  }
}

function runCase(arr, rng, trials) {
  const wm = new WaveletMatrix(arr);
  const n = arr.length;
  check('length', wm.length, arr.length, { arr });

  for (let i = 0; i < n; i += 1) {
    check('access', wm.access(i), refAccess(arr, i), { arr, i });
  }

  const distinctValues = Array.from(new Set(arr));
  const probeValues = distinctValues.concat([
    Number.MIN_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER,
    0,
    -1,
    1,
  ]);

  for (const v of probeValues) {
    for (let end = 0; end <= n; end += 1) {
      check('rank', wm.rank(v, end), refRank(arr, v, end), { arr, v, end });
    }
  }

  for (const v of probeValues) {
    const total = refRank(arr, v, n);
    for (let occ = 0; occ < total; occ += 1) {
      check('select', wm.select(v, occ), refSelect(arr, v, occ), { arr, v, occ });
    }
    // out-of-range occurrence should throw
    let threw = false;
    try {
      wm.select(v, total);
    } catch (e) {
      threw = e instanceof RangeError;
    }
    check('select-oob-throws', threw, true, { arr, v, occ: total });
  }

  for (let t = 0; t < trials; t += 1) {
    const left = randInt(rng, 0, n);
    const right = randInt(rng, left, n);
    let minV = randInt(rng, -20, 20);
    let maxV = randInt(rng, -20, 20);
    if (minV > maxV) [minV, maxV] = [maxV, minV];
    check(
      'rangeFreq',
      wm.rangeFreq(left, right, minV, maxV),
      refRangeFreq(arr, left, right, minV, maxV),
      { arr, left, right, minV, maxV }
    );

    if (right > left) {
      const k = randInt(rng, 0, right - left - 1);
      check('quantile', wm.quantile(left, right, k), refQuantile(arr, left, right, k), {
        arr,
        left,
        right,
        k,
      });
    }
  }
}

const rng = mulberry32(0xC0FFEE);

// Edge cases
runCase([], rng, 5);
runCase([42], rng, 5);
runCase([5, 5, 5, 5], rng, 20);
runCase([1, 2, 3, 4, 5], rng, 20);
runCase([5, 4, 3, 2, 1], rng, 20);
runCase([-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5], rng, 30);
runCase([3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5], rng, 30);
runCase([Number.MIN_SAFE_INTEGER, 0, Number.MAX_SAFE_INTEGER], rng, 10);
runCase(
  Array.from({ length: 9 }, (_, i) => Number.MAX_SAFE_INTEGER - i),
  rng,
  15
);

// Randomized fuzz across many shapes/sizes
for (let trial = 0; trial < 400; trial += 1) {
  const n = randInt(rng, 0, 40);
  const valueSpread = randInt(rng, 1, 12);
  const arr = Array.from({ length: n }, () => randInt(rng, -valueSpread, valueSpread));
  runCase(arr, rng, 12);
}

console.log(`Total checks: ${checks}, mismatches: ${mismatches}`);
if (mismatches > 0) {
  process.exit(1);
}
