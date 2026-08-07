# minimum-arborescence

Dependency-free, single-file, deterministic minimum-weight spanning
arborescence solver for directed weighted graphs (Chu-Liu/Edmonds
algorithm) in JavaScript, with an automated `node:test` suite.

## Files

- `minimum-arborescence.js` -- the implementation:
  `minimumArborescence(vertexCount, edges, root)` returns
  `{ weight, edgeIndices }` for a minimum-weight spanning arborescence
  rooted at `root`, or `null` when none exists. Vertices are
  `0..vertexCount-1`; `edges` is an array of `{ from, to, weight }`
  objects (directed `from -> to`). Negative weights are fully supported.
  Parallel edges are fully supported. Self-loops (`from === to`) are
  valid input but always ignored, since a self-loop can never be any
  vertex's unique parent edge in a tree. `edgeIndices` is the ascending-
  sorted array of the selected edges' *original* indices into the input
  `edges` array; `weight` is the sum of their *original* (unadjusted)
  weights.

  Algorithm: the classic Chu-Liu/Edmonds algorithm, implemented
  recursively in its simplest one-cycle-at-a-time form (contract a single
  cycle, then restart the whole "pick cheapest incoming edge per vertex"
  step from scratch on the contracted graph) for clarity and correctness
  over raw speed -- appropriate for this task's scope. At each level: (1)
  pick every active non-root vertex's cheapest incoming edge (ties broken
  by smallest original edge index); fail immediately if some vertex has
  none. (2) Follow those "cheapest parent" pointers; if they form a
  cycle, contract the whole cycle into a single supernode (keeping the
  cycle's smallest vertex id as the representative, for determinism),
  reducing every edge that enters the cycle from outside by the weight of
  the cycle-internal edge it would replace at its entry point, dropping
  wholly-internal edges (which become self-loops on the supernode), and
  recursing on the contracted graph. (3) If no cycle is found, the
  cheapest-parent pointers already form the answer. (4) When unwinding a
  contraction, the recursive result names exactly one edge entering the
  supernode; that edge "breaks" the cycle at whichever vertex it actually
  enters, so every *other* cycle member keeps its own cheapest-parent
  edge in the final answer.

  Every input is validated: a non-integer/non-number `vertexCount`,
  `root`, `edge.from`, or `edge.to`, a non-array `edges`, a non-object
  edge, or a non-number `edge.weight`, throws `TypeError`; a correctly-
  typed `vertexCount < 1`, `root`/`edge.from`/`edge.to` outside
  `[0, vertexCount)`, or a non-finite (`NaN`/`Infinity`) `edge.weight`,
  throws `RangeError`. Neither `edges` nor any edge object is ever
  mutated.

- `minimum-arborescence.test.js` -- 33 `node:test` cases (no external
  dependencies), including a self-contained exhaustive brute-force oracle
  (tries every combination of one incoming edge per non-root vertex,
  keeping the cheapest acyclic one) and a result-validity checker used
  throughout: one-vertex graphs (including one with an ignored self-
  loop); simple trees (an already-a-tree graph, a star, and a case where
  routing through an intermediate vertex beats a direct edge); impossible
  graphs (a vertex with no incoming edge at all, a component fully
  disconnected from root, a vertex reachable only via a self-loop, and a
  vertex-pair that only has incoming edges from each other); parallel and
  tied edges (including a tie that only appears *after* a cycle
  contraction's weight reduction); negative weights (including inside a
  contracted cycle); a single 2-cycle and a single 3-cycle each requiring
  exactly one contraction; a hand-traced **nested contraction** (a 2-cycle
  contracts into a supernode that itself forms a second cycle with a
  third vertex, requiring a second round of contraction before the
  correct cheap direct entry is found) -- independently verified against
  the brute-force oracle and documented with the full contraction trace
  inline; repeatability; input immutability (single call and repeated
  calls with the same array); a full `TypeError`/`RangeError` validation
  sweep (`vertexCount`, `edges` type, `root`, each edge's shape/`from`/
  `to`/`weight`, explicitly confirming non-finite weights are
  `RangeError` per this task's spec); and two seeded-PRNG (mulberry32,
  fixed seed) randomized suites -- 500 small random graphs (1-5 vertices,
  weights -10..10 including negatives and zero) checked for exact
  feasibility and weight match against the brute-force oracle plus full
  result validity, and 60 further random graphs checked purely for
  repeat-call determinism.

- `test-output.txt` -- raw, unedited output of the exact run command
  below.

## Additional verification (not part of the committed suite)

Beyond the committed suite: a larger, uncommitted randomized differential
run against the same brute-force oracle covering 4,000 trials on graphs
of 1-5 vertices (with negative weights, 0 mismatches) plus a further
1,500 trials on graphs of 2-6 vertices with more edges (0 mismatches);
every hand-traced example in this README (the tie-through-contraction
case and the nested-contraction case in particular) was independently
verified against the brute-force oracle at the console, with the nested-
contraction case additionally verified by hand-tracing every contraction
step of the algorithm before being written into the test file.

## Exact run command

```
node --test minimum-arborescence.test.js
```

Requires only the Node.js runtime (tested on Node v22.22.2) -- no
`npm install`, no native build, no service to start. Run from inside this
directory, from a clean checkout.

## Design notes

- Implemented recursively, contracting and fully restarting on one cycle
  at a time, rather than the more optimized "contract all simultaneously-
  discovered cycles in one pass" variant some references use. This keeps
  each step's correctness easy to reason about (and to hand-trace for the
  nested-contraction test) at the cost of some extra recursion depth on
  pathological inputs -- a deliberate simplicity-over-asymptotics
  tradeoff appropriate for this task's scope, in the same spirit as
  earlier tasks in this series (e.g. `size()` in the link-cut-forest
  task).
- A contracted cycle's representative id is always its *smallest*
  original vertex id, and cycle detection always scans active vertices in
  ascending order -- both fixed, deterministic choices (not arbitrary
  Set/Map iteration order) so that results, including which side of a tie
  wins, are exactly reproducible run after run.
- The reported `weight` is always recomputed from the caller's original,
  unadjusted edge weights via `edgeIndices` at the very end -- the
  weight *reductions* used internally during cycle contraction (to make
  comparing entry points into a contracted cycle equivalent to comparing
  full alternatives on the original graph) are purely a comparison device
  and never themselves summed into the reported total.
- Per this task's own validation spec, a non-finite `weight` (`NaN`/
  `Infinity`) is a `RangeError` (a well-typed `number` with an invalid
  value), not a `TypeError` -- a different split than an earlier task in
  this series (Stoer-Wagner Min-Cut), which grouped non-finite weights
  under `TypeError` instead. Both are internally consistent with their
  own task's explicit wording; this task's description specifically pairs
  "non-finite weights" with `RangeError` in the same clause as "invalid
  vertex counts, endpoints, roots", so that's the rule implemented here.
- `vertexCount` may be as small as `1` (a single vertex, trivially its
  own arborescence with zero edges) -- unlike an undirected cut, which
  needs at least two vertices to mean anything, a rooted arborescence is
  perfectly well-defined for a single vertex.
