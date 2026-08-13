# stoer-wagner-min-cut-v2

Dependency-free, single-file, deterministic global minimum-cut solver
(Stoer-Wagner algorithm) for undirected, non-negatively weighted graphs, in
JavaScript, with an automated `node:test` suite.

## Relationship to `../stoer-wagner-min-cut/`

This directory implements a **separately assigned Task Node task** whose
spec overlaps substantially with the earlier, already-completed
`stoer-wagner-min-cut/` task in this repo. Both solve global minimum cut
via the classic Stoer-Wagner contraction algorithm with deterministic
tie-breaking; the concrete differences in this task's own spec are:

- the exported function is named `globalMinCut` (not `stoerWagner`);
- edges are an array of `{ u, v, weight }` objects (not `[u, v, weight]`
  triples);
- the partition's canonical orientation is "whichever side contains vertex
  `0` is always reported first" (not "the lexicographically smaller
  side");
- self-loops (`edge.u === edge.v`) are **rejected outright** with a
  `RangeError` (not validated-then-ignored) -- this task's spec has no
  language suggesting self-loops should be silently tolerated, so they are
  treated as invalid input, consistent with this repo's general preference
  for surfacing likely-mistaken input rather than quietly discarding it.

Given the overlap, this implementation was written fresh (not copied) into
this new, clearly-disambiguated directory rather than overwriting the
earlier one, and this note is included so the relationship is transparent
rather than presented as unrelated work.

## API

```js
const { globalMinCut } = require('./stoer-wagner.js');

const result = globalMinCut(vertexCount, edges);
// result.weight    -- minimum total weight crossing some bipartition
// result.partition -- [sideA, sideB], sorted-ascending vertex-index arrays;
//                      sideA always contains vertex 0
```

- `vertexCount` -- number of vertices, labeled `0 .. vertexCount - 1`. Must
  be a safe integer `>= 2` (a cut needs two non-empty sides). Non-number
  throws `TypeError`; a correctly-typed but invalid value (non-integer,
  `< 2`) throws `RangeError`.
- `edges` -- an array of `{ u, v, weight }` objects. `u`/`v` must be safe
  integers in `[0, vertexCount)` with `u !== v` (self-loops rejected);
  `weight` must be a nonnegative safe integer. Parallel edges between the
  same pair are summed. The input array and its elements are never
  mutated. Wrong JS types throw `TypeError`; correctly-typed but invalid
  values (out-of-range index, self-loop, negative weight, non-integer)
  throw `RangeError`.
- Returns `{ weight, partition }`: `weight` is the minimum crossing weight
  over every possible non-trivial bipartition of the vertex set;
  `partition` is `[sideA, sideB]`, two disjoint, ascending-sorted,
  jointly-exhaustive arrays of vertex indices, with `sideA` always the
  side containing vertex `0` -- a fixed, deterministic output-labeling
  convention independent of which physical side the algorithm's internal
  bookkeeping happened to isolate.

## Algorithm

The classic O(V³) Stoer-Wagner formulation. Edges are first collapsed into
a dense `n x n` symmetric weight matrix (parallel edges pre-summed, so
input edge order and duplication never affect the result). Each of
`vertexCount - 1` "minimum cut phases" runs a maximum-adjacency-ordering
scan: starting from the smallest-indexed active vertex, repeatedly add
(to a growing set `A`) the not-yet-added active vertex most tightly
connected to `A` so far, until every active vertex has been added. The
last two vertices added in a phase, `s` then `t`, define that phase's "cut
of the phase": the total weight from `t` to everything added before it.
The Stoer-Wagner theorem guarantees the true global minimum cut is always
equal to the minimum "cut of the phase" over all `vertexCount - 1` phases,
with `t`'s current group (the set of original vertices merged into
super-vertex `t` by that point) being one side of an optimal partition.
After recording a phase's cut, `s` and `t` are merged into one
super-vertex (summing their weights to every other active vertex) and the
next phase begins over the contracted graph.

**Deterministic tie-breaking**, made explicit at every step rather than
left to incidental behavior:

- each phase's maximum-adjacency scan always starts from the
  smallest-indexed currently-active vertex;
- within a phase, ties in "most tightly connected to `A`" are broken by
  smallest vertex index -- the scan visits candidate vertices in ascending
  order and only replaces the running best on a **strict** improvement, so
  the first (smallest-indexed) vertex to reach the best-seen adjacency sum
  is never displaced by a later vertex merely tying it;
- across phases, the global best cut-of-the-phase is updated only on a
  **strict** improvement (`cutWeight < bestWeight`), so the first phase to
  reach a given minimum is the one whose partition is kept, never a later
  phase that ties it;
- the output partition's labeling (`sideA` = the side containing vertex
  `0`) is a fixed convention applied after the algorithm finishes, so it
  never depends on which physical side the internal contraction happened
  to isolate as `bestSide`.

Together, these make the whole computation exactly reproducible: running
`globalMinCut` twice on the same input always returns byte-identical
output (verified explicitly -- see `stoer-wagner.test.js`'s repeatability
test and `fuzz.js`'s dedicated repeatability block).

### Design choices not pinned down by the task spec

- **`vertexCount < 2` throws `RangeError`** rather than returning a
  degenerate result, since a "cut" is only meaningful when the graph can
  actually be split into two non-empty sides.
- **Self-loops throw `RangeError`** (see "Relationship to
  `../stoer-wagner-min-cut/`" above for the reasoning).
- **Negative edge weights are rejected** (`RangeError`): the
  maximum-adjacency greedy step that the Stoer-Wagner correctness proof
  depends on assumes non-negative weights, so silently accepting negative
  weights would produce a result with no correctness guarantee.
- **`RangeError` reserved for correctly-typed-but-invalid values**
  (non-integer, out-of-range index, self-loop, negative weight),
  `TypeError` for wrong JS type -- matching this repo's established
  convention.
- **The output `partition`'s canonical orientation is "contains vertex
  0"** rather than a content-based rule like lexicographic ordering --
  simpler to state and equally deterministic, and distinct from the prior
  task's own (also valid, but different) lexicographic convention, per
  this task's own spec wording.

## Testing

`stoer-wagner.test.js` (committed, 23 tests, `node:test` /
`node:assert/strict`, no external dependencies) covers: a two-vertex graph
with a single edge and with no edge; a path graph where the lightest edge
is the minimum cut (both a 3-vertex and a longer 5-vertex chain); a
4-cycle with equal weights; a triangle with equal weights; complete graphs
K4 and K5 with unit weights (isolating a single vertex); a disconnected
graph and a fully edgeless graph (min cut weight 0); zero-weight edges
(both mixed-with-nonzero and an all-zero complete graph); parallel edges
(both a direct summation check and an equivalence check against the
pre-summed single-edge graph, including edges given in both `(u,v)` and
`(v,u)` order); a competing-equal-cut "barbell" graph cross-checked
against the exhaustive oracle; repeatability (same input run twice, exact
match); input-immutability (edges array and elements untouched); the
classic 8-vertex Stoer-Wagner paper example (known minimum cut weight 4,
cross-checked against the exhaustive oracle and against the paper's own
known answer); the full invalid-input surface for `vertexCount`, the
`edges` array shape, and individual edge fields (including the self-loop
rejection this task's spec requires and a check that a weight of exactly
`0` is accepted, not mistakenly treated as falsy/invalid); and the task's
required fixed-seed exhaustive-oracle differential block -- `test('...
xorshift32(0xC0FFEE), a seeded exhaustive oracle enumerating all cuts for
>= 500 random graphs of up to eight vertices', ...)` (550 trials,
exceeding the required 500), which for every trial (a) compares the
returned minimum weight against a from-scratch brute-force enumeration of
every non-trivial vertex bipartition (`2^(n-1) - 1` candidates, summing
crossing-edge weight directly from the raw edge list), (b) checks the
returned partition is complete and disjoint (every vertex appears exactly
once across the two sides), and (c) independently recomputes the crossing
weight of the *returned* partition from the raw edge list and checks it
equals the reported `weight` -- i.e. not just "some cut has this weight
somewhere" but "the specific cut you handed back really does have the
weight you claim."

An additional, uncommitted `fuzz.js` (not part of the submitted evidence,
run locally for extra confidence before the committed suite was written,
per this repo's own established practice) ran a wider sweep: the same
kind of seeded exhaustive-oracle block at larger scale (seed `0xC0FFEE`,
600 trials, 2-8 vertices, weight/partition-completeness/crossing-weight
all checked, 0 mismatches); a larger-graph internal-consistency block
(seed `0xbeefcafe`, 200 trials, 9-20 vertices, where full brute-force
enumeration is no longer tractable, so partition completeness/
disjointness and reported-weight-matches-recomputed-crossing-weight are
checked instead, 0 mismatches); a permutation-invariance block (seed
`0x5eed5eed`, 400 trials, 3-8 vertices, checking that relabeling every
vertex under a random permutation never changes the minimum weight found,
0 mismatches); a dedicated repeatability block (seed `0xfeedface`, 300
trials, checking byte-identical output across two calls with the same
input, 0 mismatches); a 14-case invalid-input sweep (all correctly
rejected); and an explicit input-non-mutation check.

## Verification performed

- `node --test stoer-wagner.test.js` run in this directory: all 23 tests
  passed, 0 failures. See `test-output.txt` for the full TAP output,
  captured from a clean checkout with no `npm install` step.
- Before writing the committed suite, the implementation was hand-traced
  against 8 cases run interactively at the console: a two-vertex single
  edge, a 3-vertex path (light edge wins), a triangle with equal weights,
  a disconnected graph, parallel edges (summed correctly), a 4-cycle with
  equal weights, complete graph K4, and the full 8-vertex Stoer-Wagner
  paper example -- every result matched hand-computed/known-published
  expected values, including the paper example's known partition
  `{1,2,5,6}` vs `{3,4,7,8}` (1-indexed in the original paper; `{0,1,4,5}`
  vs `{2,3,6,7}` here).
- The uncommitted `fuzz.js` was run manually (`node fuzz.js`) and reported
  `TOTAL mismatches across all blocks: 0` across 1,500 total trials over
  four blocks, plus 14/14 correct invalid-input rejections and a clean
  input-non-mutation check.
- No external dependencies: `stoer-wagner.js` has no `require` at all; the
  test file only requires Node's built-in `node:test` and
  `node:assert/strict`.

## Exact run command

```
node --test stoer-wagner.test.js
```

Requires only the Node.js runtime -- no `npm install`, no native build, no
service to start. Run from inside this directory, from a clean checkout.
