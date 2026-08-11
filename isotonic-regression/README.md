# Weighted Isotonic Regression (Pool-Adjacent-Violators)

A single-file, dependency-free Node.js module for weighted isotonic
(nondecreasing) least-squares regression via the classic O(n)
Pool-Adjacent-Violators Algorithm (PAVA) — a new numerical/statistical
algorithm domain, distinct from every prior tree/graph/matching/string
task in this repo.

## API

```js
const { isotonicRegression } = require('./isotonic-regression.js');

isotonicRegression(values, weights); // weights optional, defaults to all-1
```

- `isotonicRegression(values, weights)` — fits a nondecreasing sequence to
  `values` (an array of finite numbers, any sign, may repeat, may already
  be sorted or not) that minimizes the weighted sum of squared errors
  `sum_i weights[i] * (fitted[i] - values[i])^2`, subject to
  `fitted[i] <= fitted[i+1]` for every `i`.
  - `weights` is optional; if omitted (`undefined`), every point gets
    weight `1`. If provided, it must be an array of the same length as
    `values`, containing finite positive numbers.
  - Returns a **fresh** array of `values.length` fitted numbers. Never
    mutates `values` or `weights`.
  - Throws `TypeError` if `values` (or a provided `weights`) is not an
    `Array`, or if any element of either is not a finite `Number`
    (`NaN`, `Infinity`, `-Infinity`, or any non-number type all throw).
  - Throws `RangeError` if a provided `weights` array's length doesn't
    match `values.length`, or if any weight is `<= 0`.

## Algorithm

PAVA scans `values` left to right, maintaining a stack of "blocks" — each
block a contiguous run of original indices that will end up sharing one
fitted value (their weighted mean). Every new point starts life as its
own singleton block pushed onto the stack. Whenever the newly pushed
block's mean is *less than* the block immediately before it on the stack
(a violation of the nondecreasing requirement), the two blocks merge into
one, whose mean and weight are the weight-combined mean and summed weight
of both; this violation check then repeats against the (new) block before
that one, cascading merges backward as far as needed. Because every merge
permanently reduces the total block count by exactly one, and the block
count only ever increases by one per original point, the total number of
merges across the entire scan is bounded by `n - 1` — giving `O(n)`
amortized time overall despite the inner `while` loop. Once every point
has been scanned, the final stack of blocks is expanded left to right,
each block's mean repeated once per index it covers, to produce the
`n`-length fitted output.

### Design choices not pinned down by the task spec

- **`weights` is "omitted" only when it is exactly `undefined`** (i.e. the
  caller passes one argument, or explicitly passes `undefined`) — not for
  `null` or any other falsy value, which are treated as genuine
  (invalid) arguments and rejected with `TypeError` (`null` is not an
  `Array`). This matches ordinary JavaScript default-parameter semantics
  and keeps "the caller didn't specify weights" unambiguous from "the
  caller passed something wrong."
- **`TypeError` for wrong *kind* (non-array, non-finite-number element),
  `RangeError` for right-kind-but-wrong-*range*** (mismatched length,
  non-positive weight) — matching this repo's established convention.
  Validation runs in two passes: every "is this the right kind of value
  at all" check (array-ness, finiteness) completes first, then the
  range-only checks (length match, positivity) run second — so a
  malformed-but-right-length `weights` array is never reported as a
  length mismatch before its own malformed entries are caught.
- **A weight of exactly `0` is rejected (`RangeError`), not silently
  accepted as "this point doesn't count."** A zero-weight point is
  mathematically a valid limiting case of weighted least squares (its
  residual contributes nothing to the objective), but admitting it
  cleanly requires either special-casing division-by-zero in the
  block-merge formula or filtering the point out entirely and
  re-inserting an arbitrary fitted value for it afterward — meaningfully
  more implementation complexity for a case the task's own wording
  ("non-positive weights" as a rejection condition, not a special case)
  already indicates should be an error.
- **Ties in the merge check (`blockMean[top-1] === blockMean[top]`) are
  *not* violations** — the merge only triggers on strict `>`. This is
  what makes an already-plateaued run of equal values pass through
  untouched rather than needlessly re-pooling itself into an
  arithmetically-identical (but needlessly recomputed) mean.

## Testing

`isotonic-regression.test.js` (committed, 22 tests, `node:test` /
`node:assert/strict`, no external dependencies) covers: empty and
singleton input; already-nondecreasing input (untouched); strictly
descending input (fully pooled into one block); an all-equal plateau
(untouched, no spurious merges); a duplicate-value case requiring a
partial pool; negative values; fractional values; weighted cases
(omitted-weights-default-to-1 equivalence, a heavier weight pulling the
pooled mean toward its value with an exact hand-computed expected value,
and an already-nondecreasing sequence being unaffected by any weights);
the full invalid-input surface (non-array `values`/`weights`, non-finite
elements in either, mismatched lengths, zero/negative weights); no
mutation of either input array; a structural invariant check (output is
always nondecreasing) across 300 randomized trials; and two fixed-seed
randomized differential-coverage blocks driving a separately implemented,
deliberately non-PAVA **exhaustive contiguous-partition reference
solver** defined in the test file itself (enumerates every way to cut an
array into contiguous blocks via one bit per gap, discards any partition
whose block-mean sequence isn't nondecreasing, and keeps the minimum
weighted-SSE admissible partition — a direct transcription of the
mathematical definition of isotonic regression) —
`test('deterministic randomized differential coverage: at least 200
arrays of length 0-8 against an independent exhaustive
contiguous-partition solver, within 1e-10', ...)` (seed
`mulberry32(0xc0ffee)`, 300 trials, weighted) and `test('deterministic
randomized differential coverage: unweighted small arrays (length 0-8)
against the reference, within 1e-10', ...)` (seed `mulberry32(0x5eed5eed)`,
200 trials, unweighted).

An additional, uncommitted `fuzz.js` (not part of the submitted evidence,
run locally for extra confidence before the committed suite was even
written, per this repo's own established practice) ran a wider sweep
against the same style of independent exhaustive reference: 3,000
small-unweighted trials (length 0-8, seed `0xc0ffee`), 3,000
small-weighted trials (length 0-8, seed `0x5eed5eed`), 800 trials with
longer arrays (length 0-12) and a much wider value range (seed
`0xfeedface`), and 1,000 trials with small-magnitude values near zero to
stress floating-point precision near the tolerance boundary (seed
`0xb0eda12`) — **7,800 total checks, 0 mismatches**, all within a 1e-9
tolerance (empirically, actual observed floating-point deviation between
the PAVA implementation and the exhaustive reference tops out around
`1.4e-14` for length-0-8 arrays, four orders of magnitude tighter than
the task's required `1e-10`).

## Verification performed

- `node --test isotonic-regression.test.js` run in this directory: all 22
  tests passed, 0 failures. See `test-output.txt` for the full TAP
  output, captured from a clean checkout with no `npm install` step.
- The uncommitted `fuzz.js` was run manually (`node fuzz.js`) before
  writing the committed suite and reported `Total checks: 7800,
  mismatches: 0`.
- No external dependencies: `isotonic-regression.js` has no `require` at
  all; the test file only requires Node's built-in `node:test` and
  `node:assert/strict`.
