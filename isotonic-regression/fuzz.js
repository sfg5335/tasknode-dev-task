'use strict';

// Uncommitted wide-sweep differential fuzz harness (workflow rule 19):
// compares isotonicRegression() against an independent, obviously-correct
// exhaustive contiguous-partition reference solver, BEFORE the committed
// node:test suite is written.

const { isotonicRegression } = require('./isotonic-regression.js');

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

// Independent exhaustive reference: for arrays short enough (length <=
// ~12, capped by caller), enumerates EVERY way to partition the array
// into contiguous blocks (one bit per gap between consecutive elements:
// "cut here" or "don't cut here"), computes each candidate partition's
// block weighted-means, discards any partition whose block-mean sequence
// is not nondecreasing (an inadmissible candidate), and returns the
// admissible partition with minimum weighted SSE. This is a direct,
// obviously-correct implementation of the mathematical definition of
// isotonic regression, deliberately using nothing resembling PAVA's
// merge-stack technique.
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
  let max = 0;
  for (let i = 0; i < a.length; i++) {
    max = Math.max(max, Math.abs(a[i] - b[i]));
  }
  return max;
}

let checks = 0;
let mismatches = 0;
const TOLERANCE = 1e-9;

function runBlock(seedTag, seed, trials, maxLen, weighted, valueScale) {
  const rand = mulberry32(seed);
  for (let t = 0; t < trials; t++) {
    const n = Math.floor(rand() * (maxLen + 1));
    const values = new Array(n);
    for (let i = 0; i < n; i++) {
      values[i] = (rand() - 0.5) * 2 * valueScale;
    }
    let weights;
    if (weighted) {
      weights = new Array(n);
      for (let i = 0; i < n; i++) {
        weights[i] = 0.01 + rand() * 10; // positive, wide range
      }
    }

    const actual = isotonicRegression(values, weights);
    const expected = referenceIsotonicRegression(values, weights);
    checks++;

    const diff = actual.length === expected.length ? maxAbsDiff(actual, expected) : Infinity;
    if (diff > TOLERANCE) {
      mismatches++;
      console.log(
        `MISMATCH [${seedTag} trial ${t}] n=${n} weighted=${weighted}\n` +
          `  values=${JSON.stringify(values)}\n` +
          `  weights=${JSON.stringify(weights)}\n` +
          `  expected=${JSON.stringify(expected)}\n` +
          `  actual=${JSON.stringify(actual)}\n` +
          `  maxAbsDiff=${diff}`
      );
    }
  }
}

// Small arrays (length 0-8), unweighted -- the exact scope the task's own
// step 4 specifies for the exhaustive comparison.
runBlock('small-unweighted', 0xc0ffee, 3000, 8, false, 10);

// Small arrays, weighted.
runBlock('small-weighted', 0x5eed5eed, 3000, 8, true, 10);

// Slightly larger arrays (still small enough for 2^(n-1) exhaustive
// enumeration to be fast), wider value range, weighted.
runBlock('medium-weighted-wide-range', 0xfeedface, 800, 12, true, 1e6);

// Values clustered near zero / small magnitude, to stress floating-point
// comparison near the tolerance boundary.
runBlock('small-magnitude', 0xb0eda12, 1000, 8, true, 1e-3);

console.log(`\nTotal checks: ${checks}, mismatches: ${mismatches}`);
if (mismatches > 0) {
  process.exitCode = 1;
}
