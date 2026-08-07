# wavelet-matrix

Dependency-free, single-file, immutable wavelet matrix in JavaScript over
a fixed array of safe integers (negatives and duplicates allowed), with an
automated `node:test` suite.

## Files

- `wavelet-matrix.js` -- the implementation (`WaveletMatrix` class):
  `access(index)`, `rank(value, end)`, `select(value, occurrence)`,
  `rangeCount(left, right, min, max)`, `quantile(left, right, k)`, and a
  read-only `length` getter. Construction does coordinate compression
  (the distinct input values, sorted ascending, become the codebook
  `0 .. distinctCount-1`) and then builds `ceil(log2(distinctCount))` bit
  levels (0 levels for 0 or 1 distinct values) via the standard
  wavelet-matrix construction: each level's bit array is a *stable*
  partition of the previous level's sequence by that level's bit (all
  0-bits first, in relative order, then all 1-bits, in relative order).
  Per level, prefix zero-counts and explicit zero-position/one-position
  lists are precomputed once, so every query is O(numLevels): `access`
  and `rank` walk down the levels using prefix counts;
  `select` first finds the compressed value's whole occurrence range via
  the same top-down walk as `rank`, then walks back *up* through the
  levels from the target occurrence's position, using the precomputed
  position lists to invert each level's partition step; `rangeCount` is
  built from a `_countLessThan` primitive (the standard "how many
  elements in this position range have compressed value below this
  threshold" wavelet-matrix query, applied twice via inclusion-exclusion
  for the value range `[min, max)`); `quantile` is the standard top-down
  "k-th smallest in a position range" walk, picking the zero- or
  one-partition each level based on how many zeros fall in the current
  position range versus the running `k`. All positions and value ranges
  are zero-based and half-open, exactly as specified. Every method
  validates its arguments: wrong JS type (non-number, non-integer,
  non-finite) throws `TypeError`; correctly-typed but out-of-bounds
  values (an index/position outside `[0, length)`, an empty range where
  `quantile` requires a non-empty one, `min > max`, a negative
  `occurrence` or `k`) throw `RangeError`. `rank`/`select` handle a value
  that never occurs in the array gracefully (`rank` returns 0, `select`
  returns `-1`) rather than treating it as an error. The instance never
  retains a reference to the caller's input array, and no method ever
  mutates instance state, so a `WaveletMatrix` is fully immutable once
  constructed.
- `wavelet-matrix.test.js` -- 13 `node:test` cases (no external
  dependencies): the empty-array case (every method's documented
  empty-input behavior, including that `rank`'s only valid `end` is 0
  and `quantile` always rejects the only available range `[0,0)` as
  empty); a single-repeated-negative-value array; `access` matching plain
  array indexing across duplicates and negatives; `rank` boundary/absent-
  value behavior; `select`'s zero-based occurrence indexing and `-1`
  cases; `rangeCount`'s half-open-on-both-axes semantics (including that
  `min === max` is a legal empty value range, not an error); `quantile`
  correctness including a full-array sorted-order check and a
  sub-range check; a full `TypeError` sweep for the constructor; a
  combined `TypeError`/`RangeError` sweep across every method's
  arguments; repeated-call determinism; non-mutation and non-retention of
  the caller's input array; a fixed hand-picked 13-element array
  (mixing repeats, negatives, and zero) cross-checked exhaustively
  against brute-force/naive-array reference implementations of all five
  operations -- every `(value, end)` and `(value, occurrence)` pair for
  `rank`/`select` across a wide value range, every `(left, right,
  min, max)` combination for `rangeCount`, and every `(left, right, k)`
  combination for `quantile`; and a 60-trial fixed-seed randomized
  comparison suite against the same brute-force references, covering
  arrays up to length 20 with a wide value range.
- `test-output.txt` -- raw, unedited output of the exact run command below.

## Additional verification (not part of the committed suite)

Beyond the committed test file, an uncommitted 2,000-trial randomized
stress run (fixed seed, arrays up to length 30, value ranges up to 20)
cross-checked every method against the same brute-force references --
over 2.09 million individual assertions, zero mismatches.

## Exact run command

```
node --test wavelet-matrix.test.js
```

Requires only the Node.js runtime (tested on Node v22.22.2) -- no
`npm install`, no native build, no service to start. Run from inside this
directory, from a clean checkout.

## Design notes (documented since they're not fully pinned down by the task spec)

- `select(value, occurrence)` uses a zero-based `occurrence` (the first
  occurrence is `occurrence = 0`), for consistency with the zero-based
  positions used everywhere else in this API.
- `rangeCount`'s value range `[min, max)` is half-open on the value axis
  too, matching the half-open position axis; `min` and `max` need not
  themselves be values that occur in the array, and `min === max` is a
  legal (empty) value range rather than an error.
- `quantile` requires a non-empty position range (`left < right`, not
  just `left <= right`), since there is no well-defined k-th smallest
  element of an empty range.
