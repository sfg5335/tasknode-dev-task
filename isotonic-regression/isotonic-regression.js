'use strict';

// Weighted isotonic (nondecreasing) least-squares regression via the
// classic O(n) Pool-Adjacent-Violators Algorithm (PAVA).
//
// Given `values` (the observed y-values) and optional per-point positive
// `weights`, isotonicRegression returns a fresh array of the same length
// containing the fitted values that:
//   - are nondecreasing (fitted[i] <= fitted[i+1] for every i), and
//   - minimize the weighted sum of squared errors
//       sum_i weights[i] * (fitted[i] - values[i])^2
//     among all nondecreasing sequences.
//
// PAVA achieves this in O(n): it scans left to right, maintaining a stack
// of "blocks" (contiguous runs of indices that will share one fitted
// value, the weighted mean of their original values). A new point starts
// as its own singleton block; whenever the newly added block's mean is
// less than the mean of the block before it (a "violation" of the
// nondecreasing constraint), the two blocks are merged into one whose
// mean is the weight-combined mean of both, and this check repeats
// against the new previous block. Each merge permanently reduces the
// number of blocks by one, so across the whole scan there are at most
// n - 1 merges total, giving O(n) amortized time overall.

function validateFiniteNumberArray(value, name) {
  if (!Array.isArray(value)) {
    throw new TypeError(`${name} must be an array`);
  }
  for (let i = 0; i < value.length; i++) {
    if (typeof value[i] !== 'number' || !Number.isFinite(value[i])) {
      throw new TypeError(
        `${name}[${i}] must be a finite number (got ${String(value[i])})`
      );
    }
  }
}

/**
 * Weighted isotonic regression via PAVA.
 *
 * @param {number[]} values - observed values (any finite numbers, may be
 *   negative, fractional, duplicated, in any order).
 * @param {number[]} [weights] - positive finite per-point weights, same
 *   length as `values`. Omitted (`undefined`) defaults every weight to 1.
 * @returns {number[]} a fresh array of `values.length` fitted values,
 *   nondecreasing, minimizing weighted squared error. Never mutates
 *   `values` or `weights`.
 */
function isotonicRegression(values, weights) {
  validateFiniteNumberArray(values, 'values');

  const weightsProvided = weights !== undefined;
  if (weightsProvided) {
    validateFiniteNumberArray(weights, 'weights');
  }

  if (weightsProvided && weights.length !== values.length) {
    throw new RangeError(
      `weights.length (${weights.length}) must equal values.length (${values.length})`
    );
  }
  if (weightsProvided) {
    for (let i = 0; i < weights.length; i++) {
      if (weights[i] <= 0) {
        throw new RangeError(
          `weights[${i}] must be positive (got ${weights[i]})`
        );
      }
    }
  }

  const n = values.length;
  if (n === 0) {
    return [];
  }

  const w = weightsProvided ? weights : new Array(n).fill(1);

  // Stack-based block merging. blockMean/blockWeight/blockLength are
  // parallel arrays; indices 0..top (inclusive) hold the current stack of
  // blocks, in left-to-right order.
  const blockMean = new Array(n);
  const blockWeight = new Array(n);
  const blockLength = new Array(n);
  let top = -1;

  for (let i = 0; i < n; i++) {
    top++;
    blockMean[top] = values[i];
    blockWeight[top] = w[i];
    blockLength[top] = 1;

    while (top > 0 && blockMean[top - 1] > blockMean[top]) {
      const wPrev = blockWeight[top - 1];
      const wCurr = blockWeight[top];
      const mergedWeight = wPrev + wCurr;
      const mergedMean =
        (blockMean[top - 1] * wPrev + blockMean[top] * wCurr) / mergedWeight;
      const mergedLength = blockLength[top - 1] + blockLength[top];

      top--;
      blockMean[top] = mergedMean;
      blockWeight[top] = mergedWeight;
      blockLength[top] = mergedLength;
    }
  }

  const result = new Array(n);
  let idx = 0;
  for (let b = 0; b <= top; b++) {
    const mean = blockMean[b];
    const len = blockLength[b];
    for (let k = 0; k < len; k++) {
      result[idx++] = mean;
    }
  }

  return result;
}

module.exports = { isotonicRegression };
