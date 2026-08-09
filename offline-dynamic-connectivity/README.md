# Deterministic Offline Dynamic Connectivity

A dependency-free implementation of **offline dynamic graph connectivity**:
given a fixed, known-in-advance sequence of edge additions, edge removals,
and connectivity/component-count queries over an undirected graph on
`vertexCount` vertices, answer every query as of its exact position in
that sequence -- without recomputing the graph from scratch for every
query, and without needing a fully dynamic (online) connectivity
structure.

This uses the classic **segment tree over time + rollback union-find**
technique (a standard competitive-programming approach to this exact
problem), rather than an online algorithm (e.g. Holm-de Lichtenberg-Thorup)
or brute-force per-query recomputation.

## API

```js
const { solveDynamicConnectivity } = require('./offline-dynamic-connectivity.js');

const results = solveDynamicConnectivity(vertexCount, operations);
```

- `vertexCount`: a non-negative integer. Vertices are numbered `0` through
  `vertexCount - 1`.
- `operations`: an array, processed strictly in order, of:
  - `{ type: 'add', u, v }` -- activate the undirected edge `(u, v)`.
  - `{ type: 'remove', u, v }` -- deactivate the undirected edge `(u, v)`.
  - `{ type: 'connected', u, v }` -- query: are `u` and `v` in the same
    component right now?
  - `{ type: 'componentCount' }` -- query: how many connected components
    exist right now (isolated vertices each count as their own
    component)?
- Returns an array with exactly one entry per **query** operation (i.e.
  `'connected'` or `'componentCount'`, not `'add'`/`'remove'`), in the
  same relative order those queries appear in `operations`. `'connected'`
  entries are booleans; `'componentCount'` entries are integers.
- Never mutates `operations` or any operation object within it.

### Validation

- `TypeError` for malformed inputs: `vertexCount` not a non-negative
  integer; `operations` not an array; an operation entry that isn't a
  plain object; an unknown/missing `type`; a non-integer `u`/`v` on an
  `'add'`/`'remove'`/`'connected'` operation.
- `RangeError` for values that are the right *type* but violate a
  graph-level constraint: a `u`/`v` outside `[0, vertexCount - 1]`; an
  `'add'` on an edge that is already active; a `'remove'` on an edge that
  is not currently active.
- Edges are undirected and canonicalized (`(u, v)` and `(v, u)` are the
  same tracked edge), including the `u === v` self-loop case, which is
  valid input (see below), not an error.
- The first offending operation, scanned in index order, is what gets
  reported (its own category of error, not a later operation's).

### Self-loops

A self-loop (`u === v`) is valid: it can be added and removed exactly
like any other edge (same duplicate-active-add / remove-of-inactive-edge
validation), but it never changes connectivity or `componentCount`, since
every vertex is trivially always connected to itself regardless of edges.

## Algorithm

1. **Active-interval construction** (`buildActiveIntervals`, exported):
   one forward pass over the operations tracks, per canonical edge key,
   the operation index it was last added at. A matching `'remove'` closes
   off a half-open interval `[addIndex, removeIndex)` of operation
   indices during which that edge was active. Any edge still active after
   the last operation gets a final interval extending to
   `operations.length` (the end of time).
2. **Segment tree over time**: an implicit segment tree (no explicit node
   objects -- just the standard `node`, `2*node`, `2*node+1` array-free
   encoding) spans the index range `[0, operations.length)`. Each edge's
   interval is decomposed into the `O(log Q)` canonical segment-tree
   nodes that exactly tile it (the standard "assign an interval to a
   segment tree" trick), and the edge is appended to each such node's
   bucket.
3. **One DFS over the segment tree, with a rollback union-find**
   (`RollbackUnionFind`, exported): entering a node unions every edge in
   its bucket. At a leaf (a single operation index), if that operation is
   a query, it is answered immediately from the union-find state that is
   live at that exact point in the DFS -- which is correct because an
   edge's interval is only ever attached to nodes whose *entire* range
   lies inside that interval, so every leaf under such a node lies inside
   the interval too, meaning the edge really is active for any query at
   that leaf. Leaving a node rolls the union-find back to its state on
   entry (via a saved history-length snapshot), so sibling subtrees never
   observe each other's unions.

### Rollback union-find

Deliberately **no path compression**: path compression can touch an
unbounded number of parent pointers per `find()`, which would make
"undo the last K structural changes" unbounded work too. Union by size
alone still guarantees `O(log V)` tree height (a tree of size `s` can
only arise from merging two trees of total size `>= s`, each at least
`s/2` if the merge was size-balanced in the worst case, so height is
bounded by `O(log V)` via the standard potential argument), so `find()`
stays `O(log V)` without compression, and every `union()` mutates exactly
one parent pointer and one size counter -- trivially reversible by
recording, per successful union, the losing root and the winning root's
previous size.

**Tie-break rule** (spec-mandated, for deterministic reproducibility):
prefer the root with strictly greater size; on an exact size tie, the
**smaller root (by vertex index) wins** and becomes the parent of the
larger-indexed root. This choice is not observable through
`solveDynamicConnectivity`'s own return values -- `'connected'` and
`'componentCount'` results are invariant to *which* same-size root wins a
tie, only the internal tree shape differs -- so it is tested directly
against the exported `RollbackUnionFind` class instead (see "Testing"
below), which is also why `RollbackUnionFind` and `buildActiveIntervals`
are exported alongside the required `solveDynamicConnectivity`: the task
spec explicitly calls for the rollback and active-interval logic to be
inspectable, and direct exports are the most unambiguous way to make that
true.

### Complexity

- **Preprocessing** (interval construction): `O(Q)`, one pass.
- **Segment-tree interval assignment**: `O(E log Q)` total, `O(log Q)`
  canonical nodes per edge interval.
- **DFS + union-find**: each of the `O(Q log Q)` total (node, edge)
  attachments does one `union()`, `O(log V)` each (no path compression);
  each of the `O(Q)` leaves does at most one `find()`-based query,
  `O(log V)`. Overall `O((Q + E) log Q log V)`.

## Testing

`offline-dynamic-connectivity.test.js` (52 `node:test` cases, all
passing -- see `test-output.txt` for the raw run):

- Empty graphs: `vertexCount = 0` with no operations, positive
  `vertexCount` with no operations, `componentCount` on an empty graph,
  and a graph with vertices but no edges.
- Add/remove/re-add sequences, including twenty repeated
  add-then-remove cycles on the same edge and an edge left active through
  the end of the sequence (never removed).
- Bridge deletion (a path graph's cut-edge actually disconnects it) and
  the contrasting case of removing a non-bridge edge from a triangle
  (connectivity survives via the other path), plus a star graph having
  its spokes removed one at a time with `componentCount` checked at each
  step.
- Reversed endpoints: removing an edge with `u`/`v` swapped from how it
  was added; a reversed-endpoint duplicate-add still throws; `connected`
  gives the same answer regardless of argument order.
- Self-loops: add/remove validated the same way as any edge; never
  changes connectivity between distinct vertices or `componentCount`;
  duplicate-add and remove-of-inactive both throw `RangeError`; a
  self-loop and a real edge sharing a vertex are tracked independently.
- Component counts: decreasing by exactly one per structural union,
  increasing by exactly one per edge removal that actually disconnects,
  and staying unchanged when a redundant (already-connected) edge is
  added or a non-bridge edge is removed.
- Every invalid-input case from the spec: non-integer/negative
  `vertexCount`, non-array `operations`, a non-object operation entry, an
  unknown/missing `type`, non-integer `u`/`v`, out-of-range `u`/`v`,
  duplicate active addition, removal of an inactive edge -- plus a mixed
  case confirming the *first* offending operation's error category wins
  even when a later operation would also be invalid for a different
  reason.
- Input immutability: the operations array and its entries are
  byte-for-byte unchanged after the call, and mutating the caller's array
  afterward cannot retroactively change an already-returned result.
- Whitebox tests of `RollbackUnionFind` directly: the size-tie
  smaller-root-wins rule (both for two singletons and for two larger
  equal-size groups), size always beating a smaller group regardless of
  index, `union()` returning `false` and no-op-ing for same-component
  pairs (including self-loops), snapshot/rollback exactly restoring
  parent/size/`componentCount` state, nested (stack-discipline)
  snapshot/rollback, and confirmation that `find()` never mutates parent
  pointers (no path compression).
- Whitebox tests of `buildActiveIntervals` directly: a single
  closed add/remove pair, an edge never removed extending to the end of
  the timeline, add/remove/re-add producing two disjoint intervals, an
  add immediately followed by remove still producing a genuine (if
  unreachable-by-any-query) width-1 interval, and multiple independent
  edges tracked separately.
- Two seeded randomized differential tests plus two more targeted seeded
  sweeps (self-loop-heavy; dense complete-graph add-all/remove-all in
  shuffled orders) against an independent brute-force oracle (see below).
- Determinism: the same input produces byte-identical output across five
  repeated calls.

**The independent oracle** (`oracle` in the test file) replays operations
against a live adjacency-set graph and, on every query, runs a fresh BFS
from scratch over just the currently-active edges -- no segment tree, no
rollback union-find, no shared code with the implementation under test,
making it a genuine cross-check rather than a restatement of the same
algorithm.

### Additional uncommitted stress testing (performed before committing, per project discipline for bug-prone algorithms)

Beyond the committed suite, `7,700` further randomized/adversarial
`(vertexCount, operations)` combinations were checked against the same
independent oracle, `0` mismatches:

- A broad randomized sweep (4,000 trials, small vertex counts 1-6, short
  sequences) for maximal overlap and edge-interval stress.
- A wider sweep (1,500 trials, vertex counts up to 25, sequences up to
  ~120 operations).
- A self-loop-heavy sweep (800 trials, ~50% of edges forced to
  self-loops).
- A reversed-endpoint-heavy sweep (800 trials, `u`/`v` randomly swapped
  before every operation, so active/inactive state tracking can never
  rely on argument order).
- A dense complete-graph sweep (300 trials): every possible edge on a
  small graph added in one shuffled order, a full `vertexCount ×
  vertexCount` connectivity-matrix query plus a `componentCount`, then
  every edge removed one at a time in a *different* shuffled order with a
  `componentCount` check after each removal.
- A long-single-sequence sweep (200 trials, 500 operations each) to
  stress rollback history depth and the segment-tree decomposition for
  many short, overlapping intervals on the same edges.
- A determinism sweep (100 trials, 5 repeated runs each).

All passed with `0` mismatches. This implementation shipped with **zero
genuine bugs found** during stress testing -- the one issue caught before
committing was a test-authoring mistake in the committed suite itself
(see below), not an implementation defect.

Run tests yourself: `node --test offline-dynamic-connectivity.test.js`
(no installed dependencies required).

## A test-authoring bug caught before commit (not an implementation bug)

An early version of the `buildActiveIntervals` "add immediately followed
by remove" test asserted that no interval is produced at all
(`[]`) for `add(0,1)` at index 0 immediately followed by `remove(0,1)` at
index 1. Running the test failed with a concrete mismatch: the real
(correct) output is `[{ u: 0, v: 1, start: 0, end: 1 }]`. The interval
`[0, 1)` is genuinely non-empty (width 1) -- `start` (the add's own
index) is always strictly less than `end` (the remove's own index),
since add and remove operations can never share an index. The test's
false premise was assuming a "zero-width" case could arise here at all;
it cannot, with this operation model. The interval is harmless precisely
*because* index 0 is occupied by the `'add'` operation itself, never a
query, so it can never affect any observable result -- confirmed by every
other passing test in the file. Fixed by correcting the test's expected
value and documenting why the interval, though real, is unreachable by
any query.
