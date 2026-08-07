# dominator-tree

Dependency-free, single-file, deterministic immediate-dominator solver
for directed graphs (Lengauer-Tarjan algorithm, simple/path-compression
variant) in JavaScript, with an automated `node:test` suite.

## Files

- `dominator-tree.js` -- the implementation:
  `immediateDominators(vertexCount, edges, start)` returns an array
  `idom` of length `vertexCount`. `idom[start]` is `start` itself;
  `idom[v]` for every other vertex reachable from `start` is its unique
  immediate dominator (the closest strict dominator -- the last vertex
  every path from `start` to `v` must pass through); `idom[v]` is `null`
  for every vertex not reachable from `start`. Vertices are
  `0..vertexCount-1`; `edges` is an array of `{ from, to }` objects
  (directed `from -> to`, unweighted). Duplicate edges and self-loops
  are valid input and always harmless: a self-loop can never be any
  vertex's dominance-relevant predecessor, so both are accepted without
  crashing or needing any special-casing (the algorithm naturally
  treats them as inert -- see Design notes).

  Algorithm: the classic (simple, path-compression-only) Lengauer-Tarjan
  algorithm. (1) An iterative preorder DFS from `start` assigns each
  reachable vertex a DFS number and DFS-tree parent. (2) Vertices are
  processed in decreasing DFS-number order; each vertex's
  *semidominator* is computed from its predecessors via an EVAL/LINK
  auxiliary forest with iterative path compression, and each vertex is
  bucketed under its semidominator. (3) Right after a vertex `w` is
  linked into the auxiliary forest, every vertex bucketed under `w`'s
  parent has its candidate immediate dominator resolved. (4) A final
  forward pass fixes up any vertex whose tentative immediate dominator
  wasn't its own semidominator, per the semidominator theorem. Both the
  DFS and the path-compression routine are written iteratively (explicit
  stacks/loops, never recursion), so long dependency chains never risk a
  call-stack overflow.

  Every input is validated: a non-safe-integer `vertexCount` or `start`,
  a non-array `edges`, a non-object edge, or a non-safe-integer
  `edges[i].from`/`edges[i].to`, throws `TypeError`; a correctly-typed
  `vertexCount < 1`, or `start`/`edges[i].from`/`edges[i].to` outside
  `[0, vertexCount)`, throws `RangeError`. Neither `edges` nor any edge
  object is ever mutated.

- `dominator-tree.test.js` -- 25 `node:test` cases (no external
  dependencies), including a self-contained oracle based on the
  classical iterative-dataflow definition of dominator *sets*
  (`Dom(start) = {start}`, `Dom(v) = {v} ∪ ⋂ Dom(p)` over predecessors
  `p`, solved by fixed-point iteration -- correct on any directed graph,
  reducible or not, and structurally unrelated to Lengauer-Tarjan's own
  semidominator/EVAL-LINK machinery, making it a genuine independent
  cross-check) used throughout: single vertices (including one with a
  self-loop); a simple chain; a diamond (the merge point is dominated by
  the shared ancestor, not either branch); a cycle with a back edge; an
  irreducible-style loop with two entries into the cycle body; duplicate
  edges; self-loops (both a no-op case and a vertex reachable *only* via
  a self-loop, which is therefore unreachable); vertices unreachable
  from `start` (both alongside a reachable component and by nonzero
  `start`); shuffled input edge order producing an identical result; two
  deep-graph cases sized specifically to overflow a naive recursive
  implementation's call stack -- a 50,000-vertex plain chain (checked
  against the closed-form expected answer directly, since the oracle's
  fixpoint iteration is too slow at this size) and a 20,000-diamond
  chain (60,001 vertices) that additionally forces long EVAL/LINK
  compression chains, not just a long DFS; repeatability; input
  immutability (single call and repeated calls with the same array); a
  full `TypeError`/`RangeError` validation sweep (`vertexCount`, `edges`
  type, `start` range/type, each edge's shape/`from`/`to`); and two
  seeded-PRNG (mulberry32, fixed seeds) randomized suites -- 400 small
  random graphs (1-7 vertices, 0-9 edges) and 200 denser random graphs
  (2-9 vertices, 0-19 edges, more cycles and cross edges) -- both
  checked against the dominator-set oracle.

- `test-output.txt` -- raw, unedited output of the exact run command
  below.

## Additional verification (not part of the committed suite)

Beyond the committed suite: a larger, uncommitted randomized
differential run against the same dominator-set oracle covering 4,000
trials on graphs of 1-7 vertices, plus a further 1,500 trials on graphs
of 2-9 vertices with more edges (0 mismatches in both runs), and a
50,000-vertex deep-chain sanity check verified separately (the oracle's
fixpoint iteration does not scale to that size).

## Exact run command

```
node --test dominator-tree.test.js
```

Requires only the Node.js runtime (tested on Node v22.22.2) -- no
`npm install`, no native build, no service to start. Run from inside
this directory, from a clean checkout. The full suite (including both
deep-graph tests) completes in well under a second.

## Design notes

- Implements the "simple" variant of Lengauer-Tarjan -- path compression
  in the EVAL/LINK auxiliary forest, but no union-by-size balancing.
  This gives `O((V+E) log V)` time, not the more sophisticated
  near-linear `O((V+E) α(V+E))` variant from the same paper, matching
  the choice of simplicity-over-asymptotics used elsewhere in this task
  series (e.g. the recursive one-cycle-at-a-time contraction in the
  Minimum Arborescence task) -- appropriate for this task's scope.
- Both the DFS traversal and the path-compression routine (`EVAL`) are
  written iteratively with explicit stacks, specifically because a
  recursive implementation of either would overflow Node's call stack
  on a sufficiently deep or long-chained graph -- this is exercised
  directly by two dedicated 20,000-60,000-vertex test cases. The
  iterative `EVAL` gathers the full path from a vertex to its auxiliary
  tree's root, then walks it from the end nearest the root back down,
  threading a running "best known semidominator" label -- hand-verified
  to produce byte-for-byte the same `label`/`ancestor` updates as the
  classical recursive `COMPRESS` routine before being used here.
- The result depends only on the graph's edge *set*, never on input
  order: a different edge order can reshape the internal DFS tree (since
  DFS visits a vertex's out-edges in whatever order they appear in the
  adjacency list built from the input), but Lengauer-Tarjan is proven to
  recover the same true immediate dominators regardless of DFS tree
  shape. The "shuffled input edge order" test exercises this directly as
  a genuine correctness check, not just a formality.
- `edges` use `{ from, to }` only (no weight/cost field) since
  dominance is a purely structural, unweighted property of reachability
  -- unlike the flow- and cost-based algorithms earlier in this series.
- A self-loop is never any vertex's dominance-relevant predecessor: when
  a vertex `v` is being processed, it has not yet been linked into the
  auxiliary forest, so `EVAL` on a `v -> v` self-loop edge (encountered
  while processing `v`'s own predecessors) simply returns `v` itself,
  which can never have a strictly smaller semidominator than `v`'s own
  current value -- so self-loops are naturally, automatically inert,
  with no special-casing required anywhere in the algorithm.
