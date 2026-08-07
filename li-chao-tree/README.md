# li-chao-tree

Dependency-free, single-file, deterministic Li Chao tree (`LiChaoTree`)
for minimum-line range queries over a fixed integer domain, in
JavaScript, with an automated `node:test` suite.

## Files

- `li-chao-tree.js` -- the implementation:
  `new LiChaoTree(minX, maxX)` constructs a tree over the inclusive
  integer domain `[minX, maxX]` (both must be safe integers,
  `minX <= maxX`). Instance API: `size` (getter -- total number of
  `addLine`/`addSegment` calls so far), `addLine(slope, intercept,
  value)` (a line `y = slope*x + intercept`, active across the entire
  domain), `addSegment(slope, intercept, startX, endX, value)` (the
  same, but active only on the inclusive sub-range `[startX, endX]`,
  which must itself lie within `[minX, maxX]`), and `query(x)` (returns
  `{ y, value }` for the minimum-`y` line/segment covering `x`, or
  `null` if none does). `addLine`/`addSegment` return `this` for
  chaining. Ties (equal minimum `y`) are broken by insertion order --
  the earliest-inserted line/segment wins, even across duplicate
  insertions of the exact same line and across multiple distinct lines
  that happen to cross at exactly the same integer point.

  Every input is validated: a non-number `slope`/`intercept` throws
  `TypeError`, a non-finite one (`NaN`/`Infinity`) throws `RangeError`;
  a non-safe-integer domain coordinate (`minX`, `maxX`, `startX`,
  `endX`, or `query`'s `x`) throws `TypeError`; a correctly-typed
  `minX > maxX` or `startX > endX` ("reversed"), or a segment/query
  coordinate outside the tree's own domain, throws `RangeError`. A
  validation failure never mutates the tree or increments `size`.

  Algorithm: the classic Li Chao tree -- a segment tree over the
  integer domain where each node optionally holds one "locally
  optimal" line -- adapted from the usual maximum-line convention to
  *minimum*-line, per this task's spec. Nodes are allocated **lazily**
  (only the first time a subtree is actually touched) rather than up
  front, so the domain can be very large (e.g. `-1e9` to `1e9`) without
  allocating anything close to `maxX - minX` nodes. `addLine` is
  literally `addSegment` over the whole domain; `addSegment` decomposes
  its range into `O(log(domain size))` canonical segment-tree nodes
  (the standard range-update decomposition) and inserts the line at
  each via the core per-node routine, `_insertLine`. `query(x)` walks
  the single root-to-leaf path containing `x`, combining every line
  seen along that path.

- `li-chao-tree.test.js` -- 30 `node:test` cases (no external
  dependencies): empty-tree and single-point-domain queries; `size`
  tracking; crossing lines (including the exact intersection point),
  parallel lines, and a three-line lower envelope; exact ties (a
  same-value crossing point) and duplicate/repeated-identical-line
  insertion order, including many distinct lines deliberately built to
  all cross at one shared checkpoint; `addSegment` partial-range
  coverage (including a single-point segment and overlapping segments)
  and its equivalence to `addLine` over the full domain; domain-boundary
  queries and a segment covering only the boundary point; fully-negative
  and negative-to-positive domains/segments; fractional slope/intercept
  coefficients; a full `TypeError`/`RangeError` validation sweep for the
  constructor, `addLine`, `addSegment`, and `query`, plus confirmation
  that a rejected call never mutates state; and four seeded-PRNG
  (mulberry32, fixed seeds) differential suites against an independent
  brute-force linear-scan oracle -- one over many small random domains
  with mixed `addLine`/`addSegment` calls queried at every domain point
  (150 trials), one emphasizing duplicate/near-duplicate lines drawn
  from a small pool (100 trials), one emphasizing many distinct lines
  deliberately constructed to cross at exactly one shared integer
  checkpoint in random insertion order (100 trials), and one on a wider
  domain (`-1000..1000`) with fractional coefficients and sparse point
  sampling (40 trials).

- `test-output.txt` -- raw, unedited output of the exact run command
  below.

## Additional verification (not part of the committed suite)

Beyond the committed suite: a larger, uncommitted differential run of
1,000 trials (~44,000 operations total) against the same brute-force
oracle, covering random domains, mixed `addLine`/`addSegment` calls,
and a full-domain query sweep after every trial, with 0 mismatches.
This uncommitted run is what actually caught the tie-breaking bug
described below, before any of it was folded into the committed test
suite.

## Exact run command

```
node --test li-chao-tree.test.js
```

Requires only the Node.js runtime (tested on Node v22.22.2) -- no
`npm install`, no native build, no service to start. Run from inside
this directory, from a clean checkout. The full suite (including all
four differential suites) completes in well under a second.

## Design notes

- **A genuine bug found and fixed during stress testing (not merely a
  test-authoring mistake, unlike several earlier tasks in this
  collection):** the very first draft of `_insertLine` used plain
  numeric `<` to decide, at each node, whether the newly-inserted line
  was "better" than the line already stored there (comparing at the
  node's segment-left endpoint `l` and midpoint `mid`). This is the
  textbook Li Chao insertion algorithm, and it is correct for the usual
  "report the minimum value" query -- but this task additionally
  requires ties to resolve by insertion order, and plain `<` does not
  guarantee that. The randomized stress harness (before any committed
  test existed) found a concrete counterexample: with three lines
  inserted whose values only ever tie in pairs at different points, the
  *later*-inserted of two lines tied exactly at a queried `x` was
  returned instead of the earlier one. The root cause: the Li Chao
  correctness proof only guarantees *some* minimum-value line ends up
  stored on the query path for every `x` -- when multiple inserted
  lines are tied at a given `x`, plain `<` treats them as
  interchangeable during the swap decision, so *which* of the tied
  lines survives onto the path is unspecified, and `query()`'s own
  insertion-order tie-break is powerless if the earlier-inserted tied
  line was never even stored on that path to begin with. The fix:
  replace plain `<` with a strict total order comparator,
  `isBetterAt(a, b, x)`, that falls back to comparing `insertionIndex`
  whenever two lines evaluate to the exact same `y` at the checkpoint,
  and use that same comparator consistently at *both* checkpoints (`l`
  and `mid`) inside `_insertLine`. Since every line's `insertionIndex`
  is unique, this comparator never itself ties, restoring the
  well-definedness the original Li Chao correctness argument depends
  on -- and after this fix, 1,000 stress trials (~44,000 ops) including
  suites specifically designed to hammer duplicate lines and multi-line
  exact-crossing-points found zero further mismatches.
- Nodes are plain `{ line, left, right }` objects allocated lazily,
  mirroring the lazy-allocation approach already used for this
  collection's Van Emde Boas tree and (implicitly) its persistent
  segment tree -- appropriate here for the same reason: a Li Chao
  tree's domain can be enormous (this task doesn't bound `minX`/`maxX`
  beyond the safe-integer range) while the number of actually-inserted
  lines is typically far smaller, so eagerly allocating a full
  `O(domain size)` node array would be wasteful or outright infeasible.
- `addLine(slope, intercept, value)` is implemented as literally
  `addSegment(slope, intercept, this._minX, this._maxX, value)` --
  there is no separate insertion path for "whole-domain" lines, which
  keeps the two operations trivially consistent with each other (also
  verified directly by a dedicated test).
- `query(x)`'s use of `insertionIndex` for tie-breaking is stored as
  part of each internal `line` record but deliberately *not* exposed on
  the object `query` returns (only `{ y, value }` is), since it's
  implementation bookkeeping, not part of this task's public contract.
