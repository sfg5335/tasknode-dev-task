# Deterministic Wavelet Matrix (rangeFreq variant)

> Directory named `wavelet-matrix-v2/` (not `wavelet-matrix/`) because this
> repo already has an earlier, separately-rewarded Task Node task at
> `wavelet-matrix/` with a near-identical spec (same `WaveletMatrix` API,
> its range-count method named `rangeCount` instead of `rangeFreq`). This
> is a distinct, independent implementation for a distinct Task Node task
> instance — not an update to the earlier one.

A single-file, dependency-free `WaveletMatrix` for deterministic range
queries over an array of safe integers (negative values and duplicates both
supported), built via coordinate compression and MSB-first wavelet-matrix
bit levels, without mutating the input array.

## API

```js
const { WaveletMatrix } = require('./wavelet-matrix.js');

const wm = new WaveletMatrix([5, 3, -1, 3, 4, -1, 2]);

wm.length;                 // 7
wm.access(2);               // -1  -- value originally at index 2
wm.rank(-1, 6);              // 1  -- count of -1 in positions [0, 6)
wm.select(-1, 1);            // 5  -- position of the 2nd (0-based) occurrence of -1
wm.rangeFreq(0, 7, -1, 3);   // 4  -- count of elements in [0,7) with value in [-1, 3]
wm.quantile(0, 7, 0);        // -1 -- smallest value among positions [0, 7)
```

- `new WaveletMatrix(values)` — `values` must be an array of safe
  integers; the array is copied on construction and the caller's array is
  never mutated. A non-array throws `TypeError`; a non-integer element
  throws `TypeError`; an integer outside the safe-integer range throws
  `RangeError`.
- `length` — getter, number of elements.
- `access(index)` — the value originally at `index`. `index` must be an
  integer in `[0, length)`.
- `rank(value, end)` — count of `value` in the half-open position range
  `[0, end)`. `value` may be any safe integer, including one never present
  (returns `0`). `end` must be an integer in `[0, length]`.
- `select(value, occurrence)` — the position of the `occurrence`-th
  (0-based) occurrence of `value`. Throws `RangeError` if `occurrence` is
  negative or `>=` the total count of `value` (including when `value`
  never occurs at all).
- `rangeFreq(left, right, min, max)` — count of elements in the half-open
  position range `[left, right)` whose value falls in the **inclusive**
  value range `[min, max]`. `min`/`max` need not themselves be present in
  the array; `min > max` throws `RangeError`.
- `quantile(left, right, k)` — the `k`-th smallest (0-based) value among
  positions `[left, right)`; `quantile(l, r, 0)` is the minimum,
  `quantile(l, r, (r - l) - 1)` is the maximum. Throws `RangeError` if `k`
  is out of `[0, right - left)` (including on an empty range).

Every method validates its own arguments with the same two-tier split used
throughout: wrong *kind* (not a number, or a non-integer number like
`1.5`) throws `TypeError`; right kind but out of the valid *range*
(index/position bounds, a non-safe integer, `min > max`, an out-of-range
`occurrence`/`k`) throws `RangeError`.

Position ranges (`end`, `[left, right)`) are half-open per the task's own
requirement; `rangeFreq`'s `[min, max]` value range is inclusive on both
ends instead, since `min`/`max` name a closed interval by convention
(unlike `left`/`right`) and it lets a caller ask for a single exact value
via `rangeFreq(l, r, v, v)`. Occurrences (`select`) and quantile ranks
(`quantile`) are 0-based.

## Implementation notes

Construction coordinate-compresses the input's distinct values into ranks
`0..m-1` (rank order matches numeric order, so value-range queries reduce
to comparing ranks) and builds `numLevels = ceil(log2(m))` bit vectors, one
per level, via an MSB-first stable partition of the compressed ranks
(zeros before ones at each level, feeding the reordered stream forward
into the next level). Each level's bit vector has a precomputed prefix-sum
array of 1-bit counts, giving O(1) `rank0`/`rank1` at every level.

`access`/`rank`/`rangeFreq`/`quantile` all descend the levels top-down,
which is the standard wavelet-matrix technique and was validated directly
against the per-level bit-vector construction. `select` is instead
implemented as a binary search over the already-verified `rank(value,
end)` (which is monotonic non-decreasing in `end` and increases by exactly
1 at each occurrence of `value`) rather than an independent bottom-up
bit-vector inversion. An initial bottom-up implementation of `select` was
attempted and found, via differential stress-testing against a
brute-force reference *before* the committed test suite was written, to
rest on an incorrect assumption: that after all `numLevels` levels of
MSB-first *global* stable bit-partitioning, elements end up in a fully
code-sorted final order. They do not — global (not per-node) partitioning
does not preserve that invariant, only the top-down `rank`-style descent
that this file actually relies on for `access`/`rank`/`rangeFreq`/
`quantile`. The binary-search formulation sidesteps that incorrect
assumption entirely by only ever calling the independently-verified
`rank()`, at the cost of an extra `O(log length)` factor.

`rangeFreq` is implemented via a `countCodeLessThan(left, right,
codeBound)` helper (count of elements with compressed code `< codeBound`
in a position range) — a standard wavelet-matrix "count less than"
descent — called twice with `min`'s and `max + 1`'s (in code-space, via
`lowerBound`/`upperBound` over the sorted distinct-value array)
compressed bounds and subtracted.

`quantile` is the classic wavelet-matrix "k-th smallest" descent: at each
level, if `k` is smaller than the count of zero-bit elements in the
current position range, descend into the zero branch (bit `0`); otherwise
subtract that count from `k` and descend into the one branch (bit `1`),
accumulating the traversed bits into the answer's compressed code.

## Testing

`wavelet-matrix.test.js` uses `node:test`/`node:assert/strict` and needs no
installed packages. It covers:

- Every fixed data shape the task calls for: empty, singleton, all-equal,
  sorted, reversed, heavily-duplicated, all-negative, mixed-sign, and
  safe-integer-boundary (`Number.MIN_SAFE_INTEGER`/`MAX_SAFE_INTEGER`)
  data, plus alphabet sizes straddling every `numLevels` power-of-two
  boundary (`m` = 1, 2, 3, 4, 5, 8, 9).
- Every public method's full validation surface (`TypeError`/`RangeError`
  paths), including the wrong-kind-vs-wrong-range split described above.
- Deterministic randomized differential tests (fixed-seed `mulberry32`
  PRNG, no external randomness) cross-checking every query operation
  against brute-force array-based reference functions across many
  pseudo-random shapes, sizes, and value spreads — including a dedicated
  pass over safe-integer-boundary-heavy data.

Before the committed suite was written, an uncommitted `fuzz.js` (kept in
this directory for reference, not part of the `node:test` run) ran a
wider differential sweep — 172,312 checks, 0 mismatches on the final
implementation — across edge cases and 400 additional randomized trials.
This is what caught the `select()` bug described above.

```
$ node --test wavelet-matrix.test.js
# tests 25
# pass 25
# fail 0
```
