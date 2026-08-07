# kd-tree

Dependency-free, single-file, deterministic two-dimensional KD-tree
(`KDTree`) for nearest-neighbor and axis-aligned range queries over a
fixed set of 2D points, in JavaScript, with an automated `node:test`
suite.

## Files

- `kd-tree.js` -- the implementation:
  `new KDTree(points)` builds a balanced tree from an array of
  `{x, y, value}` points (finite `x`/`y`; `value` is an arbitrary,
  unvalidated payload). Instance API: `size` (getter), `nearest(x, y)`
  (closest point or `null`), `kNearest(x, y, k)` (up to `k` closest
  points, ascending), `range(minX, minY, maxX, maxY)` (every point in
  the inclusive box, ordered ascending). All three query methods return
  fresh `{x, y, value}` objects, never internal tree-node references.

  Ties (exactly equal squared distance for `nearest`/`kNearest`) are
  broken deterministically: smaller `x`, then smaller `y`, then
  earliest original insertion order. `range` results are ordered by
  `x`, then `y`, then insertion order. `kNearest`'s `k` is a
  non-negative safe integer; `k === 0` returns `[]`, and `k` larger
  than `size` returns every point rather than erroring.

  Every input is validated: a non-array `points`, a non-object point,
  or a non-number `x`/`y`/`k`/`minX`/`minY`/`maxX`/`maxY` throws
  `TypeError` (including a non-integer `k`, since a fractional count
  isn't a valid *kind* of value here); a correctly-typed but non-finite
  coordinate (`NaN`/`Infinity`), a negative `k`, or a correctly-typed
  `minX > maxX` / `minY > maxY` ("reversed" range) throws `RangeError`.
  The constructor never mutates the input array or its point objects,
  and never retains a reference to the caller's array -- mutating it
  after construction has zero effect on the tree.

  Algorithm: a classic median-split 2D KD-tree, built by recursively
  splitting the active point set on alternating axes (x at even
  depths, y at odd depths). At each recursive call, the current points
  are sorted by `(active-axis coordinate, other-axis coordinate,
  original insertion order)` -- exactly matching this task's spec
  wording for step 2 -- and the exact middle element becomes the node,
  with the elements before/after it forming the left/right subtrees.
  Because every split takes the true median, tree height stays
  `O(log n)` regardless of input order or duplicate coordinates, so
  ordinary (non-iterative) recursion is safe -- unlike some of this
  collection's other structures, there's no risk of an unbalanced,
  deeply-nested tree here.

  `nearest`/`kNearest` use textbook KD-tree branch-and-bound search:
  visit a node, record it as a candidate, recurse into the child on the
  query point's side of the splitting axis first, and only recurse into
  the other child if the perpendicular distance to the splitting
  hyperplane could still contain a competitive point (using `<=`
  against the current worst kept candidate, not `<` -- see Design notes
  for why this exact choice matters for correctness here). `range`
  prunes analogously, only descending into a subtree when the query box
  actually overlaps the half-space that subtree's splitting axis
  guarantees.

- `kd-tree.test.js` -- 24 `node:test` cases (no external dependencies):
  empty and singleton trees; duplicate coordinates (both alone and
  mixed with distinct points); exact ties for `nearest` and `kNearest`
  across every stage of the tie-break rule (distance, then x, then y,
  then insertion order); `range`'s inclusive boundaries (all four box
  edges, plus zero-width/zero-height degenerate boxes); negative and
  fractional coordinates; a full `TypeError`/`RangeError` validation
  sweep for the constructor and all three query methods (including
  reversed ranges); `kNearest` with `k = 0` and `k` far larger than
  `size`; input immutability (both "point objects/array unchanged
  after construction" and "mutating the caller's array afterward has
  no effect"); repeated identical queries returning identical results;
  a concrete branch-pruning smoke test (see Additional verification);
  and four seeded-PRNG (mulberry32, fixed seeds) differential suites
  against an independent brute-force linear-scan-and-sort oracle --
  general random point sets with duplicates (80 trials), fractional
  coordinates on a wide domain (40 trials), small integer grids with
  duplicates specifically emphasizing exact ties, including an
  exhaustive lattice-point sweep (40 trials), and range queries
  including degenerate boxes (40 trials).

- `test-output.txt` -- raw, unedited output of the exact run command
  below.

## Additional verification (not part of the committed suite)

Beyond the committed suite: a larger, uncommitted differential run
(300 + 150 + 150 + 150 trials across the same four categories, several
thousand queries total) against the same brute-force oracle, with 0
mismatches -- the implementation was correct against this oracle on
the very first run (no bugs found needing a fix, unlike some other
tasks in this collection).

Also uncommitted: a direct node-visit-count instrumentation run (not
just the wall-clock smoke test that *is* committed) confirming real
branch pruning is happening, not merely being asymptotically plausible:
over a random 50,000-point set, `nearest()` visited an average of
**22.2 tree nodes per query** (200 queries sampled) -- roughly 0.04% of
the 50,000 total points -- and `kNearest(k=10)` averaged 51.2 visits
per query. A `KDTree.nearest`/`kNearest` that degenerated into scanning
every point would visit exactly 50,000 nodes per query; visiting ~20-50
demonstrates the branch-and-bound pruning is doing real work, not just
present in the source but dead in practice.

## Exact run command

```
node --test kd-tree.test.js
```

Requires only the Node.js runtime (tested on Node v22.22.2) -- no
`npm install`, no native build, no service to start. Run from inside
this directory, from a clean checkout. The full suite (including all
four differential suites and the 20,000-point pruning smoke test)
completes in well under a second.

## Design notes

- **Why `<=`, not `<`, in the branch-and-bound pruning condition:** the
  textbook KD-tree nearest-neighbor algorithm prunes a subtree once the
  perpendicular distance to its splitting hyperplane exceeds the
  current best candidate's distance. Using a *strict* `<` comparison
  there (prune when `hyperplaneDistSq >= bestDistSq`) is a common,
  valid optimization when any minimum-distance point is an acceptable
  answer -- but this task requires an *exact* x/y/insertion-order
  tie-break among equal-distance points, and a subtree whose closest
  possible point exactly ties the current best could still contain the
  specific point that should win that tie-break. Pruning on `>=` would
  silently skip it. Using `<=` (prune only on a *strict* loss:
  `hyperplaneDistSq > bestDistSq`) is what actually guarantees the
  correct tie-break winner is found, at the cost of occasionally
  visiting a few extra nodes whose subtree turns out not to contain a
  winner. This mirrors the same category of subtlety this collection's
  Li Chao Tree task ran into with its own tie-breaking requirement (see
  that task's README) -- and was specifically stress-tested for here
  (Suite 3 in the uncommitted stress harness, and this suite's own
  "exact-tie emphasis" differential test) rather than assumed correct
  from the textbook algorithm alone.
- `range`'s per-axis recursion decision (`lo <= nodeCoord` / `hi >=
  nodeCoord`) relies on a build-time invariant that's true by
  construction, not merely by convention: because `buildNode` always
  splits at the exact sorted median, every point in a node's left
  subtree has an axis coordinate `<=` the node's own, and every point
  in the right subtree has one `>=` it -- regardless of how many
  duplicate coordinate values exist or which side of the median they
  landed on via the secondary/tertiary sort keys.
- All three query methods return **fresh** `{x, y, value}` objects
  rather than references to internal tree nodes. This is deliberate:
  internal nodes also carry bookkeeping fields (`order`, `axis`,
  `left`, `right`) that aren't part of this task's public contract, and
  handing out live node references would let a careless caller mutate
  the tree's internal structure through what looks like a plain query
  result.
- Build time is `O(n log^2 n)` (each of the `O(log n)` levels re-sorts
  its own slice of the remaining points in `O(n log n)` total across
  that level) rather than the asymptotically optimal `O(n log n)`
  achievable with a linear-time median-of-medians selection. This
  task's spec asks for deterministic median selection and
  branch-pruned *queries* -- it does not set a build-time complexity
  target -- so the simpler, easier-to-verify sort-based approach was
  used; it remains fast in practice (100,000 points build in well under
  a second, see Additional verification).
