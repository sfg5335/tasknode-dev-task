# min-cost-max-flow

Dependency-free, single-file, deterministic minimum-cost maximum-flow
solver for directed graphs with per-edge capacities and costs, in
JavaScript, with an automated `node:test` suite.

## Files

- `min-cost-max-flow.js` -- the implementation:
  `minCostMaxFlow(vertexCount, edges, source, sink, flowLimit)` returns
  `{ flow, cost, edgeFlows }`. Vertices are `0..vertexCount-1`; `edges`
  is an array of `{ from, to, capacity, cost }` objects (directed edge
  `from -> to`). `capacity` must be a non-negative safe integer; `cost`
  may be any safe integer, including negative. Parallel edges are fully
  supported and tracked independently; self-loops are valid input (an
  inert one if non-negative cost, or a length-1 negative cycle if
  negative cost and positive capacity). `flowLimit` is optional -- when
  omitted, flow is pushed until no augmenting path remains (true max
  flow); when provided, it caps the pushed flow.

  `flow` is the total flow pushed from `source` to `sink` (the maximum
  possible, capped at `flowLimit`); `cost` is the minimum total cost of
  achieving that flow value; `edgeFlows` is an array parallel to `edges`
  giving the net flow carried by each edge (always in
  `[0, edges[i].capacity]`).

  Algorithm: the classic Successive Shortest (Augmenting) Paths method
  over a residual network, using Bellman-Ford (not Dijkstra) for the
  shortest-path search in every phase so that negative edge costs are
  fully supported without needing Johnson's reduced-cost trick. Each
  input edge becomes a residual arc pair: a forward arc carrying up to
  `capacity` flow at `cost` per unit, and a reverse arc (initially zero
  residual capacity) that "gives back" previously-sent flow at `-cost`
  per unit -- the standard mechanism that lets a later augmenting path
  reroute flow committed by an earlier one. Each phase runs Bellman-Ford
  from `source` over all arcs with positive residual capacity; if `sink`
  is reachable, it pushes flow equal to the bottleneck residual capacity
  along that shortest path (capped by any remaining `flowLimit`), and
  repeats until `sink` is unreachable or `flowLimit` is hit. A classical
  theorem guarantees that as long as the *original* graph has no
  negative-cost cycle reachable from `source`, the residual graph never
  develops one either as long as every augmentation follows a shortest
  path (which SSP always does) -- so a single upfront check suffices;
  `minCostMaxFlow` throws `RangeError` whenever the original graph
  (positive-capacity edges only) has a negative-cost cycle reachable
  from `source`, rather than attempting the separate, harder negative-
  cycle-canceling problem.

  Determinism: Bellman-Ford always relaxes arcs in one fixed order (each
  input edge's forward arc, then its reverse arc, in input order) and
  only updates a distance on a *strict* improvement, so whichever
  equally-short path is discovered first in that fixed scan order is the
  one kept -- every run on the same input produces byte-for-byte
  identical `{ flow, cost, edgeFlows }`.

  Every input is validated: a non-safe-integer `vertexCount`, `source`,
  `sink`, `edges[i].from`, `edges[i].to`, `edges[i].capacity`,
  `edges[i].cost`, or `flowLimit` (when provided), a non-array `edges`,
  or a non-object edge, throws `TypeError`; a correctly-typed
  `vertexCount < 1`, `source`/`sink`/`edges[i].from`/`edges[i].to`
  outside `[0, vertexCount)`, `source === sink`, a negative
  `edges[i].capacity`, a negative `flowLimit`, or a reachable negative-
  cost cycle, throws `RangeError`. Neither `edges` nor any edge object is
  ever mutated.

- `min-cost-max-flow.test.js` -- 30 `node:test` cases (no external
  dependencies), including a self-contained exhaustive brute-force oracle
  and a result-validity checker (`validateEdgeFlows`, checking bounds,
  per-vertex flow conservation, net-inflow-to-sink matches reported flow,
  and recomputed cost matches reported cost) used throughout: basic
  single- and multi-path flow; unreachable sinks (both a genuinely
  disconnected sink and one reachable only via zero-capacity edges);
  `flowLimit` behavior (below, at, and above true max flow, including
  exactly 0); parallel edges tracked independently; negative-cost edges
  driving cost below zero when no reachable negative cycle exists; a
  negative-cost cycle *not* reachable from `source` (correctly ignored,
  neither rejected nor exploited); a reachable negative-cost cycle and a
  reachable negative-cost self-loop (both rejected with `RangeError`); a
  zero-capacity edge that can never make an otherwise-negative cycle
  "reachable"; deterministic-tie repeatability on a graph with equal-cost
  alternative paths; a hand-derived **reverse-edge rerouting** case
  (documented below) proving the solver reaches true max flow rather than
  stopping short; input immutability (single call and repeated calls with
  the same array); a full `TypeError`/`RangeError` validation sweep
  (`vertexCount`, `edges` type, `source`/`sink` range and distinctness,
  each edge's shape/`from`/`to`/`capacity`/`cost`, `flowLimit` including
  the `null`-vs-`undefined` distinction); and a seeded-PRNG (mulberry32,
  fixed seed) randomized suite of 300 small graphs (2-4 vertices, 0-4
  edges, capacities 0-2, costs -3..3, `flowLimit` sometimes applied)
  checked for exact `flow`/`cost` match plus full `edgeFlows` validity
  against the brute-force oracle, with input-immutability re-checked on
  every trial.

- `test-output.txt` -- raw, unedited output of the exact run command
  below.

## Additional verification (not part of the committed suite)

Beyond the committed suite: a larger, uncommitted randomized differential
run against the same brute-force oracle covering 3,000 trials on graphs
of 2-4 vertices, plus a further 1,200 trials on graphs of 2-5 vertices
with more edges (0 mismatches in both runs). This uncovered and fixed a
bug in the *oracle itself*, not the implementation (see Design notes
below) before any of it was folded into the committed suite. The
reverse-edge-rerouting example below was also independently hand-derived
and checked against both the implementation and the brute-force oracle
at the console before being written into the test file.

### Reverse-edge rerouting example (hand-derived)

Graph (4 vertices, `source=0`, `sink=3`):

```
edge 0: 0 -> 1, capacity 1, cost 1
edge 1: 1 -> 3, capacity 1, cost 3
edge 2: 0 -> 2, capacity 1, cost 3
edge 3: 2 -> 3, capacity 1, cost 1
edge 4: 1 -> 2, capacity 1, cost 1
```

Phase 1's shortest path is `0 -> 1 -> 3` (cost `1 + 3 = 4`)... but
Bellman-Ford's fixed arc-scan order actually finds `0 -> 1 -> 2 -> 3`
(cost `1 + 1 + 1 = 3`) first, since it is strictly shorter, saturating
edge 4 (`1 -> 2`) forward along with edges 0 and 3. The true maximum
flow is 2 (both `0 -> 1` and `0 -> 2` can carry one unit into `3` in
parallel), but after phase 1, edge 4 is fully saturated forward and
edges 1 (`1 -> 3`) and 2 (`0 -> 2`) are still open. The only way to push
the second unit is `0 -> 2 -> 1 -> 3` (cost `3 + (-1) + 3 = 5`), which
must travel the **reverse** of edge 4 (`2 -> 1`, cost `-1`) to give back
the capacity edge 4 committed in phase 1. A forward-only search (ignoring
reverse residual arcs) would incorrectly stop at flow 1 after phase 1,
since no all-forward path from `0` to `3` remains. `minCostMaxFlow`
correctly finds both phases and returns
`{ flow: 2, cost: 8, edgeFlows: [1, 1, 1, 1, 0] }` (total cost
`3 + 5 = 8`), matching the brute-force oracle exactly.

## Exact run command

```
node --test min-cost-max-flow.test.js
```

Requires only the Node.js runtime (tested on Node v22.22.2) -- no
`npm install`, no native build, no service to start. Run from inside this
directory, from a clean checkout.

## Design notes

- Bellman-Ford, not Dijkstra, is used for every phase's shortest-path
  search, even though Dijkstra with Johnson's reduced-cost potentials is
  the faster standard approach for SSP. Plain Bellman-Ford is simpler to
  reason about and verify correctness for at this task's scope, and its
  fixed relaxation order is what makes tie-breaking (and therefore the
  whole algorithm) trivially deterministic.
- The upfront reachable-negative-cycle check only considers edges with
  positive capacity, exactly matching which edges could ever actually
  carry flow -- an edge with capacity 0 can never be part of any real
  augmenting path, so a "negative cycle" that only exists by including a
  zero-capacity edge is correctly never rejected.
- `source === sink` is rejected with `RangeError` rather than silently
  returning some degenerate "infinite free flow" answer, since a self-
  loop source/sink pair does not have a well-defined maximum flow under
  this task's model.
- `flowLimit` distinguishes `undefined` (no limit -- the argument was
  omitted or explicitly passed as `undefined`) from any other value,
  including `null`; a `null` `flowLimit` is treated as an invalid,
  non-safe-integer value and throws `TypeError`, since silently
  treating `null` the same as "omitted" would make an accidental `null`
  from calling code fail silently instead of loudly.
- The differential stress-testing process caught a genuine bug in the
  test harness's own brute-force oracle, not the implementation: the
  oracle initially enumerated every possible per-edge flow assignment
  checking only flow-conservation at non-source/sink vertices, with no
  regard for reachability from `source`. This let it exploit negative-
  cost cycles (including negative-cost self-loops) sitting in parts of
  the graph totally disconnected from `source`, artificially lowering
  its computed "optimal" cost -- something no real source-to-sink flow
  algorithm would ever do, since it only ever pushes flow along actual
  `source`-to-`sink` paths. The fix was to compute which vertices are
  reachable from `source` via positive-capacity edges (the same
  reachability notion the real implementation's negative-cycle check
  uses) and restrict the oracle's per-edge flow enumeration to only
  edges whose tail is reachable -- after which all 4,200-plus stress
  trials passed with 0 mismatches, confirming the implementation was
  correct all along and only the oracle needed correction. This mirrors
  a discipline established earlier in this task series: a brute-force
  mismatch does not automatically indict the implementation under test;
  the oracle's own edge-case semantics need auditing too.
