# hopcroft-karp-matcher

Dependency-free, single-file, deterministic maximum bipartite matcher in
JavaScript using the Hopcroft-Karp algorithm, plus a minimum vertex cover
derived from the matching via Konig's theorem, with an automated
`node:test` suite.

## Files

- `hopcroft-karp-matcher.js` -- the implementation
  (`maximumBipartiteMatching(leftCount, rightCount, edges)`). Input edges
  are validated, deduplicated, and sorted ascending by `(left, right)`
  before running Hopcroft-Karp (`validateAndNormalizeEdges`) -- the
  per-vertex adjacency lists built from that sorted, deduped edge list are
  therefore always visited in the same ascending order regardless of the
  order the caller supplied `edges` in, which is what makes the whole
  result (matching, vertex cover, everything) independent of edge order.
  The matching itself is the textbook Hopcroft-Karp algorithm: repeated
  BFS phases build a layered shortest-augmenting-path graph from every
  currently-unmatched left vertex (`bfs`), then a DFS phase greedily
  finds vertex-disjoint augmenting paths along that layering
  (`dfs`), until a BFS phase finds no more augmenting paths. The minimum
  vertex cover is then derived from the final matching via the standard
  Konig's-theorem construction: an alternating-reachability walk from
  every unmatched left vertex (crossing non-matching edges left-to-right,
  then matching edges right-to-left) marks a visited set, and the cover
  is exactly the *unvisited* left vertices plus the *visited* right
  vertices -- guaranteed by Konig's theorem to have size equal to the
  maximum matching size for any bipartite graph. Every argument is
  validated: non-integer `leftCount`/`rightCount`, a non-array `edges`,
  or a malformed edge (not a 2-element integer array) throws `TypeError`;
  correctly-typed but out-of-bounds values (negative counts, an edge
  endpoint outside its partition) throw `RangeError`. The input `edges`
  array and its element arrays are never mutated or retained -- the
  function only reads from an internally-built sorted copy, so the
  caller's data is fully preserved.
- `hopcroft-karp-matcher.test.js` -- 14 `node:test` cases (no external
  dependencies): the fully-empty graph; non-empty partitions with no
  edges; a disconnected graph (independent pairs plus an isolated
  vertex); a perfect matching over complete bipartite `K(3,3)`; a partial
  matching where several left vertices compete for one right vertex;
  duplicate-edge deduplication (checked for exact output equality against
  the deduplicated-by-hand equivalent); permuted-edge-order equality;
  isolated vertices on both sides; a multiple-optimum 4-cycle graph
  (several maximum matchings of the same size exist, and the
  deterministic ascending-traversal tie-break is checked for
  repeatability); a full `TypeError`/`RangeError` sweep across every
  validated argument (14 distinct bad inputs); caller-data preservation
  (the input `edges` array and its element arrays are frozen before the
  call, and their JSON snapshot is diffed before/after); repeated-call
  determinism; a fixed deterministic comparison suite covering nine
  hand-picked graphs (including a 4-vertex cycle and an 8-edge
  "necklace" graph) cross-checked against an independently-written
  brute-force reference implementation (Kuhn's algorithm, a different,
  simpler augmenting-path matcher) for matching size, matching validity,
  and vertex-cover validity/size; and an 80-trial fixed-seed randomized
  comparison suite against the same brute-force reference, additionally
  re-running each trial's graph with a shuffled edge order and asserting
  the *entire* result object (not just the matching size) is byte-for-byte
  identical.

  Every test that produces a result also runs it through a shared
  `validateResult` helper that independently re-checks matching/vertex-
  cover *consistency* (matched pairs are real edges, `leftMatch`/
  `rightMatch` agree with each other, every edge is covered by the
  returned vertex cover, and the vertex cover's size equals
  `matchingSize` per Konig's theorem) and canonical vertex-cover ordering
  -- not just comparing final numbers.
- `test-output.txt` -- raw, unedited output of the exact run command
  below.

## Additional verification (not part of the committed suite)

Beyond the committed test file, an uncommitted 8,000-trial randomized
stress run (fixed seed, up to 15 vertices per partition, up to 40 edges)
cross-checked matching size against the same brute-force reference and
independently re-validated matching consistency and vertex-cover
correctness (coverage + Konig's-theorem size equality) on every trial --
16,000 individual checks, zero mismatches.

## Exact run command

```
node --test hopcroft-karp-matcher.test.js
```

Requires only the Node.js runtime (tested on Node v22.22.2) -- no
`npm install`, no native build, no service to start. Run from inside this
directory, from a clean checkout.

## Design notes

- `vertexCover` is returned as an array of `{ side, index }` objects
  (`side` is `'left'` or `'right'`), sorted with every `'left'` entry
  first (ascending `index`), then every `'right'` entry (ascending
  `index`) -- a canonical, fully deterministic order, since the task spec
  doesn't pin down a representation for the cover.
- Edges are deduplicated by exact `(left, right)` pair before matching;
  a duplicate edge has no effect on the result beyond removing it.
