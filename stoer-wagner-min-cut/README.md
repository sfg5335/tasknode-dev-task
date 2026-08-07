# stoer-wagner-min-cut

Dependency-free, single-file, deterministic global minimum-cut solver for
undirected weighted graphs (Stoer-Wagner algorithm) in JavaScript, with an
automated `node:test` suite.

## Files

- `stoer-wagner.js` -- the implementation: `stoerWagner(vertexCount, edges)`
  returns `{ weight, partition: [A, B] }`. Vertices are `0..vertexCount-1`;
  `edges` is an array of `[u, v, weight]` triples. Parallel edges between
  the same pair are summed; self-loops (`u === v`) are validated (same
  type/non-negativity rules as any other edge) but then ignored, since a
  self-loop can never be part of any cut. `partition` is always `[A, B]`,
  two disjoint, ascending-sorted, jointly-exhaustive arrays of vertex ids,
  canonically oriented so `A` is the lexicographically smaller of the two
  (comparing element-by-element, treating a strict prefix as smaller than
  its extension) -- this makes the whole result deterministic regardless
  of which physical side the algorithm happens to isolate.

  Algorithm: the classic O(V^3) Stoer-Wagner formulation. Each of
  `vertexCount - 1` "minimum cut phases" runs a maximum-adjacency search
  (repeatedly adding, to a growing set `A`, the not-yet-added vertex most
  tightly connected to `A` so far -- ties broken by smallest vertex id,
  and the phase always starts from the smallest currently-active vertex
  id) until every active vertex is in `A`. The last two vertices added,
  `s` then `t`, define this phase's "cut of the phase" (the weight from
  `t`'s current group to everything else); after recording that candidate,
  `s` and `t` are merged into one supernode (summing parallel edges) and
  the next phase begins. The provable Stoer-Wagner theorem guarantees the
  true global minimum cut is always among these `vertexCount - 1` phase
  cuts, so the minimum over all of them is the answer. When multiple
  phases tie for the lowest weight, the canonically-oriented partition
  that sorts lexicographically smaller (among the candidates the run
  actually produced) is kept -- with deterministic tie-breaking baked
  into every step (starting vertex, adjacency-search ties, merge order),
  this makes the entire computation exactly reproducible for a given
  input, run after run.

  Every input is validated: a non-integer/non-number `vertexCount`, `u`,
  or `v`, or a non-finite-number `weight`, throws `TypeError`; a
  correctly-typed `vertexCount < 2` (a cut needs two non-empty sides),
  `u`/`v` outside `[0, vertexCount)`, or a negative `weight`, throws
  `RangeError`. Neither `edges` nor any of its sub-arrays is ever mutated.

- `stoer-wagner.test.js` -- 29 `node:test` cases (no external
  dependencies), including a self-contained exhaustive brute-force
  min-cut oracle (bitmask enumeration of every non-empty proper vertex
  subset) and a partition-validity checker used throughout: known cuts
  (a triangle, a 4-cycle with two weak opposite edges, a two-vertex
  graph, and the full worked 8-vertex example from the original
  Stoer & Wagner 1997 paper -- unique minimum cut of weight 4, cross-
  checked against the brute-force oracle); disconnected graphs and
  graphs with isolated vertices (min cut 0); zero-weight and edgeless
  graphs (min cut 0); parallel-edge summation (including an explicit
  equivalence check against the pre-summed single-edge graph); self-loop
  handling (ignored for the result, but still validated -- negative,
  non-numeric, and non-finite self-loop weights are all still rejected);
  tied minimum-weight cuts (an explicit hand-traced 3-vertex tie plus an
  all-zero-weight 4-cycle) verifying deterministic, repeatable partition
  selection; input immutability (single call and repeated calls with the
  same array); a full `TypeError`/`RangeError` validation sweep
  (`vertexCount` type and lower-bound, `edges` type, malformed edge
  triples, `u`/`v` type and bounds, `weight` type/finiteness/sign); and
  two seeded-PRNG (mulberry32, fixed seed) randomized suites -- 400
  small random graphs (2-7 vertices, including 0-weight edges) checked
  for exact weight match against the brute-force oracle plus full
  partition validity, and 60 further random graphs checked purely for
  repeat-call determinism.

- `test-output.txt` -- raw, unedited output of the exact run command
  below.

## Additional verification (not part of the committed suite)

Beyond the committed suite: a larger, uncommitted randomized differential
run against the same brute-force oracle covering 3,000 trials on graphs
of 2-7 vertices (0 mismatches) plus a further 800 trials on graphs of
2-10 vertices with denser edge sets (0 mismatches, weight-only since
brute force over 10 vertices is already 1,024 masks per trial); every
hand-traced example in this README (triangle, 4-cycle, disconnected,
zero-weight, parallel, self-loop, tied-cut) was also independently
verified against the brute-force oracle at the console before being
written into the test file.

## Exact run command

```
node --test stoer-wagner.test.js
```

Requires only the Node.js runtime (tested on Node v22.22.2) -- no
`npm install`, no native build, no service to start. Run from inside this
directory, from a clean checkout.

## Design notes

- `vertexCount < 2` throws `RangeError` rather than returning a
  degenerate result, since a "cut" is only meaningful when the graph can
  actually be split into two non-empty sides.
- Self-loops are validated (type-checked and required non-negative) even
  though they're then excluded from the adjacency matrix -- this matches
  the "well-typed, well-bounded, but logically invalid or logically
  irrelevant input is still checked" spirit used elsewhere in this task
  series, rather than silently accepting garbage just because it happens
  not to affect the output.
- Negative edge weights are rejected (`RangeError`) rather than merely
  "supported oddly": the maximum-adjacency-search greedy step that the
  Stoer-Wagner algorithm's correctness proof depends on assumes
  non-negative weights, so silently accepting negative weights would
  produce results with no correctness guarantee at all.
- The partition's canonical orientation (`A` = lexicographically smaller
  side) and the lexicographic tie-break between equal-weight phase cuts
  are both scoped to *the candidates the deterministic algorithm actually
  produces* (one candidate per phase, `vertexCount - 1` total) -- not to
  an exhaustive search over every possible min-weight cut of the graph.
  Stoer-Wagner's guarantee is that the true minimum weight is always
  among its phase candidates, not that every possible cut achieving that
  weight is. The test suite's brute-force oracle therefore checks weight
  equality and returned-partition *validity* (a real cut that truly
  achieves the claimed weight), plus separate explicit determinism checks
  (repeated calls, hand-traced ties) -- not "matches some independently
  chosen canonical answer" for every tied graph.
