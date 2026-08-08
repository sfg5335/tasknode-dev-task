# Deterministic Johnson All-Pairs Shortest Paths

`johnson(vertexCount, edges)` — a dependency-free implementation of Johnson's algorithm for
all-pairs shortest paths in a directed, weighted graph that may contain negative edge weights
(but must not contain a negative-weight cycle, since shortest paths are undefined in that case).

## API

```js
const { johnson } = require('./johnson.js');

johnson(vertexCount, edges);
```

- `vertexCount`: a non-negative integer. Vertices are numbered `0 .. vertexCount - 1`.
- `edges`: an array of `[from, to, weight]` triples. `from`/`to` must be integer vertex indices
  in range; `weight` must be a finite number (may be negative, zero, or a non-integer float).
  Parallel edges (more than one edge between the same ordered pair) and self-loops
  (`from === to`) are both explicitly supported.

Returns an `n x n` (`n = vertexCount`) matrix of shortest-path distances: `matrix[u][v]` is the
shortest distance from `u` to `v`. The diagonal is always exactly `0`. `matrix[u][v]` is
`Infinity` when `v` is not reachable from `u`. Throws `RangeError` if the graph contains a
negative-weight cycle anywhere (not just one reachable from a particular vertex).

```js
johnson(3, [[0, 1, -3], [1, 2, 2], [0, 2, 10]]);
// [[0, -3, -1], [Infinity, 0, 2], [Infinity, Infinity, 0]]
// (0 -> 2 direct costs 10, but 0 -> 1 -> 2 costs -3 + 2 = -1, which is cheaper)

johnson(2, [[0, 1, 1], [1, 0, -2]]);
// throws RangeError -- the cycle 0 -> 1 -> 0 has total weight 1 + (-2) = -1 < 0
```

## Algorithm

The classic three-stage Johnson's algorithm (as presented in CLRS, *Introduction to
Algorithms*, Chapter 25):

1. **Reweighting potentials `h(v)`** (Bellman-Ford stage). Conceptually: add a virtual source
   vertex connected to every real vertex by a zero-weight edge, then run Bellman-Ford from that
   virtual source to compute `h(v)` = shortest distance from the virtual source to `v`. This is
   implemented without materializing the virtual vertex, via the standard simplification of
   initializing every `h(v) = 0` (equivalent to "one round of relaxation" from a
   zero-weight-edge source that reaches every vertex directly) and then running ordinary
   Bellman-Ford relaxation over the real edges for `vertexCount` further rounds. A
   `vertexCount + 1`-th pass that still finds a relaxable edge proves a negative cycle exists
   (reachable from the virtual source — which, since it connects directly to every vertex, means
   a negative cycle exists *anywhere* in the graph) and `johnson` throws `RangeError`.
2. **Reweighting.** Every edge `(u, v, w)` is reweighted to `w'(u, v) = w + h(u) - h(v)`. A
   standard triangle-inequality argument (using the fact that `h(v)` is itself a shortest-path
   distance from the virtual source, so `h(v) <= h(u) + w(u, v)` for every edge, since otherwise
   Bellman-Ford would have found a shorter path to `v` through `u`) shows every reweighted edge
   has `w'(u, v) >= 0`, given no negative cycle. This is what makes stage 3 valid.
3. **Dijkstra, once per source.** For each vertex `u`, run Dijkstra's algorithm (binary min-heap,
   lazy-deletion in place of decrease-key) over the reweighted graph to get `d'(u, v)` for every
   `v`. The true distance is recovered via `d(u, v) = d'(u, v) + h(v) - h(u)` — the `h` terms
   telescope away along any path from `u` to `v`, so this identity holds for the shortest path
   specifically (not just some arbitrary path), and it correctly stays `Infinity` when `v` is
   unreachable from `u` (no arithmetic is done on the `Infinity` sentinel in that case, it's
   passed through as-is).

Complexity: O(V · E) for the Bellman-Ford reweighting stage, plus O(V · (E + V) log V) for `V`
runs of binary-heap Dijkstra — the same overall bound as the textbook presentation.

### Why a binary heap for Dijkstra (not a plain array scan)

The task explicitly calls for "binary-heap Dijkstra." `MinHeap` in `johnson.js` is a real binary
min-heap (sift-up on push, sift-down on pop) over parallel `_keys`/`_values` arrays, not a
disguised O(V²) linear scan. Decrease-key is implemented via lazy deletion: a vertex can be
pushed multiple times with different (successively smaller) keys as shorter distances are
discovered, and a popped entry whose key no longer matches the vertex's current best-known
distance is simply skipped — a standard, simple alternative to an in-place decrease-key
operation that would require an auxiliary position index into the heap array.

### Self-loops and parallel edges

Both fall out of the algorithm with no special-casing:

- **Parallel edges** are never deduplicated; Bellman-Ford relaxation and Dijkstra's edge
  relaxation both naturally consider every edge independently, so the cheapest of several
  parallel edges is what ultimately survives in the shortest-path computation.
- **A self-loop with non-negative weight** never improves any shortest path (relaxing
  `h[v] + weight < h[v]` requires `weight < 0`), so it's accepted but has no effect.
- **A self-loop with negative weight is itself a negative cycle** (a cycle of length 1 with
  negative total weight) and is correctly caught by the same negative-cycle detection pass that
  catches longer negative cycles — no separate check was needed or added.

## Input validation

Following this project's established convention (malformed *shape*/type → `TypeError`;
well-typed but semantically out-of-domain *value* → `RangeError`):

- `TypeError`: `vertexCount` is not a number, or not an integer (e.g. `2.5`, `Infinity`); `edges`
  is not an array; an element of `edges` is not an array of exactly 3 elements; an edge's `from`
  or `to` is not an integer; an edge's `weight` is not a finite number (covers non-numbers, `NaN`,
  `Infinity`, and `-Infinity` — the spec calls for "finite numeric weights", so non-finite values
  are treated as the wrong *kind* of value entirely, not merely out of range).
- `RangeError`: `vertexCount` is a well-typed integer but negative; an edge's `from` or `to` is a
  well-typed integer but outside the valid `[0, vertexCount - 1]` range; the graph contains a
  negative-weight cycle (a well-formed graph whose shortest-path *answer* is undefined, which is
  a value-domain problem specific to this task, not a shape problem).

## Immutability

`johnson` never mutates `edges`, its nested edge arrays, or `vertexCount`. It only ever reads
`edges[i][0]`/`[1]`/`[2]`, building its own internal adjacency-list copy. Tested by freezing both
the `edges` array and every individual edge sub-array (`Object.freeze`) before calling `johnson`
in strict-mode test code — any attempted mutation would throw immediately — plus a snapshot-based
deep-equality check before/after the call as a second, independent confirmation.

## Testing

`johnson.test.js` — 38 `node:test` cases covering: basic positive-weight graphs; the diagonal
always being exactly `0`; the empty graph (`vertexCount = 0`) and a single vertex with no edges;
disconnected graphs (`Infinity` for unreachable pairs, in both directions, including a fully
edgeless graph); negative edges without a cycle (including a case where a longer negative-weight
path beats a shorter positive-weight one); parallel edges (including combined with a cheaper
indirect path); self-loops (non-negative has no effect, weight-exactly-zero is accepted, negative
is a detected negative cycle); negative cycles of length > 1, including one not reachable from
every vertex (must still be detected, since a negative cycle anywhere invalidates all-pairs
shortest paths); the classic CLRS Chapter 25 example graph with its exact expected 5×5 matrix
(independently cross-checked against the Floyd-Warshall reference below, not merely transcribed
from memory); a Floyd-Warshall-oracle comparison across hand-picked graphs and 300 seeded-random
small integer-weight graphs (exact match expected, since integer arithmetic in this range is
exact in IEEE-754 double precision); edge-order independence (shuffled/reversed edge arrays,
including with parallel edges and self-loops present, produce identical results); input
immutability (frozen-array mutation guard plus snapshot comparison); repeated-call
determinism/no-leaked-state; matrix dimensions for a range of vertex counts; the full
`TypeError`/`RangeError` invalid-input matrix; and a 60-vertex sparse random graph performance
sanity check (cross-checked against Floyd-Warshall, asserted to complete in well under a second).

`test-output.txt` — raw `node --test` output, 38/38 passing, Node v22.22.2.

An additional, uncommitted seeded-random stress harness (`/tmp/johnson-stress.js` at development
time, not part of this commit) cross-checked `johnson` against the same independent
Floyd-Warshall reference across the classic CLRS graph, several hand-picked edge cases, 4,000
seeded-random small integer-weight graphs (1-6 vertices, weights -10..10, exact-equality
comparison), and 1,000 seeded-random small floating-point-weight graphs (epsilon-tolerant
comparison — see "A floating-point-comparison bug caught during development" below) —
**5,007 total checks, 0 mismatches**.

## A floating-point-comparison bug caught during development (in the stress harness, not the implementation)

The first run of the floating-point-weight stress sweep reported dozens of "mismatches" between
`johnson` and the Floyd-Warshall reference, all differing from the reference only in the last 1-2
significant digits (e.g. `12.953483152668923` vs `12.953483152668918`). Tracing this by hand
confirmed it is expected IEEE-754 floating-point behavior, not an algorithmic bug: `johnson`
computes each distance as `d'(u,v) + h(v) - h(u)` (three floating-point operations layered on top
of Dijkstra's own internal summations), while the Floyd-Warshall reference computes the same
distance via direct path-weight summation with a different operation order and grouping —
different orderings of floating-point addition/subtraction are not required to produce bit-identical
results even when they're mathematically equal. This matches this project's established rule
(rule 34 in the tracker doc): exact `!==`/`assert.deepEqual` is not a valid comparison for
floating-point results computed via two structurally different arithmetic paths. Fixed by
switching the floating-point-weight portion of the stress harness to an epsilon-tolerant (relative
+ absolute) comparison, while keeping exact-equality comparison for the integer-weight portion
(where JavaScript's doubles represent every value in this test's range exactly, so exact equality
*is* the correct check there). The committed test suite's own Floyd-Warshall-oracle tests
(`assertMatchesFloydWarshall`) use integer weights exclusively for exactly this reason — exact
equality is both correct and appropriately strict for them.

## Design notes / decisions made where the spec left something open

- **Parallel-edge and self-loop semantics** aren't pinned down further than "support" in the
  spec; the natural, no-special-casing behavior of relaxation-based algorithms (cheapest parallel
  edge wins; non-negative self-loop is inert; negative self-loop is a negative cycle) was kept
  rather than adding any extra dedup/filtering logic, since it's both the simplest and the
  standard textbook behavior.
- **Weights need not be integers.** The spec says "finite numeric weights," so `weight` accepts
  any finite JS number, including non-integer floats — only `vertexCount`, `from`, and `to` are
  required to be integers (they're used as array indices).
- **Negative-cycle detection scope**: the spec says to detect negative cycles, without further
  qualification, so `johnson` detects a negative cycle *anywhere* in the graph — not only one
  reachable from a specific vertex — which is exactly what the virtual-source Bellman-Ford
  construction guarantees (see the dedicated test for a negative cycle isolated from vertex 0).
