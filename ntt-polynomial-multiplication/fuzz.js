'use strict';

// Uncommitted wide-sweep differential fuzz harness (per established
// workflow rule 19): compares convolve() against an independent, obviously
// -correct O(n^2) BigInt reference convolution across many randomized
// trials, BEFORE the committed node:test suite is written.

const { MOD, convolve } = require('./ntt-polynomial-multiplication.js');

// mulberry32 deterministic PRNG (same technique used across prior tasks).
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

// Independent O(n^2) reference convolution, deliberately implemented
// differently (direct double loop, no NTT, no bit tricks) from the
// module under test.
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

function randomCoeffArray(rand, length, magnitudeMode) {
  const arr = new Array(length);
  for (let i = 0; i < length; i++) {
    let v;
    const r = rand();
    if (magnitudeMode === 'wide') {
      // Exercise the full BigInt-reduction path: negative values, values
      // >= MOD, and huge multi-limb BigInts, not just small positives.
      if (r < 0.15) {
        v = 0n;
      } else if (r < 0.3) {
        v = BigInt(Math.floor(rand() * 20) - 10); // small, possibly negative
      } else if (r < 0.5) {
        v = -(BigInt(Math.floor(rand() * 1e9)) % MOD); // negative, large magnitude
      } else if (r < 0.7) {
        v = MOD + BigInt(Math.floor(rand() * 1e6)); // >= MOD
      } else if (r < 0.85) {
        v = (BigInt(Math.floor(rand() * 1e9)) * 1000000000n) + BigInt(Math.floor(rand() * 1e9)); // multi-limb huge
      } else {
        v = BigInt(Math.floor(rand() * Number(MOD)));
      }
    } else {
      v = BigInt(Math.floor(rand() * 20));
    }
    arr[i] = v;
  }
  return arr;
}

function arraysEqual(x, y) {
  if (x.length !== y.length) return false;
  for (let i = 0; i < x.length; i++) {
    if (x[i] !== y[i]) return false;
  }
  return true;
}

let checks = 0;
let mismatches = 0;

function runBlock(seedTag, seed, trials, maxLen, magnitudeMode) {
  const rand = mulberry32(seed);
  for (let t = 0; t < trials; t++) {
    const lenA = 1 + Math.floor(rand() * maxLen);
    const lenB = 1 + Math.floor(rand() * maxLen);
    const a = randomCoeffArray(rand, lenA, magnitudeMode);
    const b = randomCoeffArray(rand, lenB, magnitudeMode);
    const expected = referenceConvolve(a, b);
    const actual = convolve(a, b);
    checks++;
    if (!arraysEqual(expected, actual)) {
      mismatches++;
      console.log(
        `MISMATCH [${seedTag} trial ${t}] lenA=${lenA} lenB=${lenB}\n` +
          `  a=${JSON.stringify(a.map(String))}\n` +
          `  b=${JSON.stringify(b.map(String))}\n` +
          `  expected=${JSON.stringify(expected.map(String))}\n` +
          `  actual=${JSON.stringify(actual.map(String))}`
      );
    }
  }
}

// Small dense instances, small-magnitude coefficients.
runBlock('small-dense', 0xc0ffee, 4000, 12, 'small');

// Larger instances, small-magnitude coefficients, sweeping transform-size
// boundaries (result lengths crossing every power of two from 2 to 512).
runBlock('larger-sparse', 0x5eed5eed, 1500, 300, 'small');

// Wide-magnitude coefficients (negative, >= MOD, multi-limb huge BigInts)
// to exercise the modular-reduction path thoroughly.
runBlock('wide-magnitude', 0xfeedface, 2000, 40, 'wide');

// Deliberate exact-power-of-two and off-by-one-from-power-of-two result
// lengths, to specifically hammer transform-size boundary handling.
{
  const rand = mulberry32(0xb0eda12);
  const boundaryLens = [];
  for (let p = 0; p <= 9; p++) {
    const pow = 1 << p;
    boundaryLens.push(pow - 1, pow, pow + 1);
  }
  let boundaryChecks = 0;
  for (const totalLen of boundaryLens) {
    if (totalLen < 1) continue;
    // a.length + b.length - 1 === totalLen
    for (const lenA of [1, Math.max(1, Math.floor(totalLen / 2)), totalLen]) {
      const lenB = totalLen - lenA + 1;
      if (lenB < 1) continue;
      const a = randomCoeffArray(rand, lenA, 'small');
      const b = randomCoeffArray(rand, lenB, 'small');
      const expected = referenceConvolve(a, b);
      const actual = convolve(a, b);
      checks++;
      boundaryChecks++;
      if (!arraysEqual(expected, actual)) {
        mismatches++;
        console.log(
          `MISMATCH [boundary] lenA=${lenA} lenB=${lenB} totalLen=${totalLen}\n` +
            `  a=${JSON.stringify(a.map(String))}\n` +
            `  b=${JSON.stringify(b.map(String))}\n` +
            `  expected=${JSON.stringify(expected.map(String))}\n` +
            `  actual=${JSON.stringify(actual.map(String))}`
        );
      }
    }
  }
  console.log(`boundary checks: ${boundaryChecks}`);
}

console.log(`\nTotal checks: ${checks}, mismatches: ${mismatches}`);
if (mismatches > 0) {
  process.exitCode = 1;
}
