'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { MOD, convolve } = require('./ntt-polynomial-multiplication.js');

// ---------------------------------------------------------------------------
// mulberry32 deterministic PRNG (fixed-seed, used for the randomized
// differential coverage blocks below).
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

function mod(x) {
  const r = x % MOD;
  return r < 0n ? r + MOD : r;
}

// Independent O(n^2) reference convolution -- a direct double loop with no
// NTT and no bit tricks, deliberately implemented differently from the
// module under test, per the task's own required verification approach.
function referenceConvolve(a, b) {
  if (a.length === 0 || b.length === 0) return [];
  const out = new Array(a.length + b.length - 1).fill(0n);
  for (let i = 0; i < a.length; i++) {
    if (a[i] === 0n) continue;
    for (let j = 0; j < b.length; j++) {
      out[i + j] = mod(out[i + j] + mod(a[i]) * mod(b[j]));
    }
  }
  return out;
}

function randomCoeffArray(rand, length) {
  const arr = new Array(length);
  for (let i = 0; i < length; i++) {
    const r = rand();
    if (r < 0.1) {
      arr[i] = 0n;
    } else if (r < 0.3) {
      arr[i] = -(BigInt(Math.floor(rand() * 1000))); // negative
    } else if (r < 0.5) {
      arr[i] = MOD + BigInt(Math.floor(rand() * 1000)); // >= MOD
    } else {
      arr[i] = BigInt(Math.floor(rand() * 1000));
    }
  }
  return arr;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

test('MOD is the expected NTT-friendly prime, exported as a BigInt', () => {
  assert.equal(typeof MOD, 'bigint');
  assert.equal(MOD, 998244353n);
});

// ---------------------------------------------------------------------------
// Empty inputs
// ---------------------------------------------------------------------------

test('convolve returns [] when the first input is empty', () => {
  assert.deepEqual(convolve([], [1n, 2n, 3n]), []);
});

test('convolve returns [] when the second input is empty', () => {
  assert.deepEqual(convolve([1n, 2n, 3n], []), []);
});

test('convolve returns [] when both inputs are empty', () => {
  assert.deepEqual(convolve([], []), []);
});

// ---------------------------------------------------------------------------
// Zero and identity products
// ---------------------------------------------------------------------------

test('convolving with an all-zero polynomial produces an all-zero result of the full product length', () => {
  const result = convolve([0n, 0n], [1n, 2n, 3n]);
  assert.deepEqual(result, [0n, 0n, 0n, 0n]);
});

test('convolving with the multiplicative identity [1n] returns the other polynomial unchanged (mod-reduced)', () => {
  assert.deepEqual(convolve([1n], [1n, 2n, 3n]), [1n, 2n, 3n]);
  assert.deepEqual(convolve([5n, 6n, 7n], [1n]), [5n, 6n, 7n]);
});

test('a hand-derived small product: (1 + 2x) * (3 + 4x) = 3 + 10x + 8x^2', () => {
  assert.deepEqual(convolve([1n, 2n], [3n, 4n]), [3n, 10n, 8n]);
});

// ---------------------------------------------------------------------------
// Unequal lengths
// ---------------------------------------------------------------------------

test('convolve handles unequal-length inputs, result length is a.length + b.length - 1', () => {
  const a = [1n, 2n, 3n, 4n, 5n];
  const b = [6n, 7n];
  const result = convolve(a, b);
  assert.equal(result.length, a.length + b.length - 1);
  assert.deepEqual(result, referenceConvolve(a, b));
});

// ---------------------------------------------------------------------------
// Trailing zeros: the result must never be trimmed below the full
// a.length + b.length - 1 length, even when the true polynomial product
// has strictly lower degree.
// ---------------------------------------------------------------------------

test('trailing zero coefficients in the result are preserved, not trimmed', () => {
  // (1 + 0x) * (1 + 0x) = 1 -- a degree-0 polynomial -- but the required
  // result length is 2 + 2 - 1 = 3.
  const result = convolve([1n, 0n], [1n, 0n]);
  assert.equal(result.length, 3);
  assert.deepEqual(result, [1n, 0n, 0n]);
});

test('trailing zero coefficients survive across a larger unequal-length product', () => {
  // Only the constant terms are nonzero, so the true product has degree 0,
  // but a.length + b.length - 1 = 4 + 3 - 1 = 6 trailing entries are
  // expected, all but the first zero.
  const a = [5n, 0n, 0n, 0n];
  const b = [7n, 0n, 0n];
  const result = convolve(a, b);
  assert.equal(result.length, 6);
  assert.deepEqual(result, [35n, 0n, 0n, 0n, 0n, 0n]);
});

// ---------------------------------------------------------------------------
// Boundary coefficients
// ---------------------------------------------------------------------------

test('boundary coefficient MOD - 1 behaves as -1 under the modulus: (MOD-1)*(MOD-1) = 1', () => {
  assert.deepEqual(convolve([MOD - 1n], [MOD - 1n]), [1n]);
});

test('negative BigInt coefficients are reduced correctly: (-1) * (-1) = 1 (mod MOD)', () => {
  assert.deepEqual(convolve([-1n], [-1n]), [1n]);
});

test('a coefficient exactly equal to MOD reduces to 0', () => {
  assert.deepEqual(convolve([MOD], [5n]), [0n]);
});

test('a coefficient several multiples of MOD past zero still reduces correctly', () => {
  const huge = MOD * 7n + 3n; // reduces to 3n
  assert.deepEqual(convolve([huge], [2n]), [6n]);
});

test('boundary coefficients cross-checked against the independent reference over a mixed vector', () => {
  const a = [MOD - 1n, 0n, MOD, -1n, 123456789n];
  const b = [1n, MOD - 1n, -5n];
  assert.deepEqual(convolve(a, b), referenceConvolve(a, b));
});

// ---------------------------------------------------------------------------
// Repeatability / determinism / no input mutation
// ---------------------------------------------------------------------------

test('convolve is repeatable: identical inputs produce byte-identical (BigInt-identical) output every call', () => {
  const a = [1n, 2n, 3n, 4n];
  const b = [5n, 6n, 7n];
  const first = convolve(a, b);
  const second = convolve(a, b);
  const third = convolve(a.slice(), b.slice());
  assert.deepEqual(first, second);
  assert.deepEqual(first, third);
});

test('convolve never mutates its input arrays', () => {
  const a = [1n, 2n, 3n];
  const b = [4n, 5n];
  const aCopy = a.slice();
  const bCopy = b.slice();
  convolve(a, b);
  assert.deepEqual(a, aCopy);
  assert.deepEqual(b, bCopy);
});

// ---------------------------------------------------------------------------
// Invalid inputs
// ---------------------------------------------------------------------------

test('convolve throws TypeError when the first argument is not an array', () => {
  assert.throws(() => convolve(null, [1n]), TypeError);
  assert.throws(() => convolve('1,2,3', [1n]), TypeError);
  assert.throws(() => convolve(undefined, [1n]), TypeError);
  assert.throws(() => convolve(42, [1n]), TypeError);
});

test('convolve throws TypeError when the second argument is not an array', () => {
  assert.throws(() => convolve([1n], null), TypeError);
  assert.throws(() => convolve([1n], {}), TypeError);
});

test('convolve throws TypeError when an array element is not a BigInt', () => {
  assert.throws(() => convolve([1, 2n], [1n]), TypeError); // plain Number
  assert.throws(() => convolve([1n], [2n, '3']), TypeError); // string
  assert.throws(() => convolve([1n], [2n, null]), TypeError);
  assert.throws(() => convolve([1n], [2n, undefined]), TypeError);
  assert.throws(() => convolve([1n], [2n, NaN]), TypeError);
});

// ---------------------------------------------------------------------------
// Products crossing several transform-size boundaries
//
// The internal NTT transform size is the smallest power of two >= the
// result length (a.length + b.length - 1). These cases deliberately probe
// result lengths immediately below, at, and immediately above several
// consecutive power-of-two boundaries (2, 4, 8, 16, 32, 64), each
// cross-checked against the independent O(n^2) reference.
// ---------------------------------------------------------------------------

test('result lengths crossing power-of-two transform-size boundaries all match the reference', () => {
  const rand = mulberry32(0xb0eda12);
  const boundaryLens = [];
  for (let p = 1; p <= 6; p++) {
    const pow = 1 << p;
    boundaryLens.push(pow - 1, pow, pow + 1);
  }
  for (const totalLen of boundaryLens) {
    for (const lenA of [1, Math.max(1, Math.floor(totalLen / 2)), totalLen]) {
      const lenB = totalLen - lenA + 1;
      if (lenB < 1) continue;
      const a = randomCoeffArray(rand, lenA);
      const b = randomCoeffArray(rand, lenB);
      const actual = convolve(a, b);
      const expected = referenceConvolve(a, b);
      assert.equal(
        actual.length,
        totalLen,
        `lenA=${lenA} lenB=${lenB} totalLen=${totalLen}`
      );
      assert.deepEqual(
        actual,
        expected,
        `lenA=${lenA} lenB=${lenB} totalLen=${totalLen}`
      );
    }
  }
});

test('single-coefficient polynomials (the degenerate size-1 transform) multiply correctly', () => {
  assert.deepEqual(convolve([7n], [6n]), [42n]);
  assert.deepEqual(convolve([0n], [6n]), [0n]);
});

// ---------------------------------------------------------------------------
// Fixed-seed randomized differential coverage: at least 500 small
// polynomial pairs, every result compared against a separately
// implemented O(n^2) BigInt reference convolution.
// ---------------------------------------------------------------------------

test('deterministic randomized differential coverage: at least 500 small polynomial pairs against an independent O(n^2) BigInt reference', () => {
  const rand = mulberry32(0xc0ffee);
  const trials = 600;
  let checked = 0;
  for (let t = 0; t < trials; t++) {
    const lenA = 1 + Math.floor(rand() * 12);
    const lenB = 1 + Math.floor(rand() * 12);
    const a = randomCoeffArray(rand, lenA);
    const b = randomCoeffArray(rand, lenB);
    const actual = convolve(a, b);
    const expected = referenceConvolve(a, b);
    assert.deepEqual(
      actual,
      expected,
      `trial ${t}: lenA=${lenA} lenB=${lenB} a=${a} b=${b}`
    );
    checked++;
  }
  assert.equal(checked, trials);
  assert.ok(checked >= 500);
});

test('deterministic randomized differential coverage: larger polynomial pairs (sparse sampling of sizes) against the reference', () => {
  const rand = mulberry32(0x5eed5eed);
  const trials = 150;
  for (let t = 0; t < trials; t++) {
    const lenA = 1 + Math.floor(rand() * 80);
    const lenB = 1 + Math.floor(rand() * 80);
    const a = randomCoeffArray(rand, lenA);
    const b = randomCoeffArray(rand, lenB);
    const actual = convolve(a, b);
    const expected = referenceConvolve(a, b);
    assert.deepEqual(
      actual,
      expected,
      `trial ${t}: lenA=${lenA} lenB=${lenB}`
    );
  }
});
