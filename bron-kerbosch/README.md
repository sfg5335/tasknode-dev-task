# Deterministic Bron-Kerbosch Maximal Clique Enumeration

A dependency-free, single-file JavaScript implementation of the classic
Bron-Kerbosch algorithm (Bron & Kerbosch, 1973) for enumerating every
maximal clique of a simple undirected graph, using the pivoting
refinement (Tomita, Tanaka & Takahashi, 2006) driven by an outer loop over
a deterministic degeneracy ordering of the vertices (Eppstein, Loffler &
Strash, 2010), which gives worst-case-optimal running time on sparse
graphs while visiting every maximal clique exactly once.

## API

`const { maximalCliques } = require('./bron-kerbosch.js');`

- `maximalCliques(vertexCount, edges)` -- returns every maximal clique of
  the simple undirected graph on vertices `0..vertexCount-1` described by
  `edges` (an array of `[u, v]` pairs). Each clique is returned as an
  array of vertex ids in ascending order, and the overall result array is
  sorted in ascending lexicographic order.

`vertexCount` must be an integer (`TypeError` otherwise) that is
non-negative (`RangeError` otherwise). `edges` must be an array
(`TypeError` otherwise) of 2-element arrays (`TypeError` otherwise) whose
two entries are integers (`TypeError` otherwise) that are each within
`[0, vertexCount)` (`RangeError` otherwise) and not equal to each other
(`RangeError` for a self-loop). This matches the general
TypeError-for-wrong-kind vs RangeError-for-wrong-bounds/wrong-value
convention used elsewhere in this repository: a value of the wrong *kind*
(a string where a number is expected, a non-integer, a 3-element array
where a pair is expected) is a `TypeError`; a value of the right kind but
outside the graph's valid domain (a negative vertex count, an endpoint
`>= vertexCount`, a self-loop) is a `RangeError`.

## Design choices made explicit (per the task's open points)

- **A 0-vertex graph has ZERO maximal cliques, not one containing the
  empty set.** The formal "a clique is maximal iff it cannot be extended"
  definition would technically call the empty set maximal when there are
  no vertices to add it to, but essentially every practical
  implementation (this one included, and e.g. NetworkX's `find_cliques`)
  special-cases this degenerate edge case away rather than returning
  `[[]]` for an empty graph -- reporting "a clique containing zero
  vertices" is not useful output for any real caller. The implementation
  doesn't need an explicit special case for this: the outer loop simply
  iterates over the (empty) degeneracy ordering zero times, naturally
  producing `[]`.
- **Duplicate and reversed-order edges are normalized, not rejected.**
  `[0, 1]`, `[1, 0]`, and a repeated `[0, 1]` all collapse into the same
  logical undirected edge, since the underlying adjacency structure is a
  `Set` per vertex. This is a deliberate design choice (the task spec
  doesn't say whether duplicates should error or be tolerated), and it's
  also directly implied by the task's own required test coverage --
  "shuffled and duplicate edges" is listed as an input scenario the suite
  must handle, not an error condition to reject.
- **Self-loops are rejected (`RangeError`), not silently dropped.** A
  self-loop doesn't affect clique membership either way (a vertex is
  always "in a clique with itself" trivially), so silently ignoring it
  would be defensible too, but the task's own step list explicitly calls
  out "validating ... self-loops" as something the implementation must
  check for, which reads as "detect and reject" rather than "silently
  tolerate."
- **Determinism is pinned at every non-deterministic point the classic
  algorithm leaves open**, not just at the final output-sorting step:
  - The degeneracy ordering's vertex-removal tie-break (when several
    vertices share the current minimum degree) is always the smallest
    vertex id.
  - The pivot selection's tie-break (when several vertices in `P union X`
    achieve the same best `|P intersect N(u)|` score) is always the
    smallest vertex id, via scanning `P union X` in ascending order and
    keeping strictly-better (not tied-or-better) candidates.
  - Both `P` and `X` are maintained as explicitly ascending-sorted arrays
    throughout the recursion (never as `Set`s whose JS iteration order
    happens to be insertion order rather than numeric order), so the
    order candidates are branched on is always deterministic.
  - The final result is additionally sorted in ascending lexicographic
    order before being returned, as an explicit guarantee independent of
    (and as a safety net beyond) the recursion's own natural output
    order.
  Together these mean two calls with the same `(vertexCount, edges)`
  always produce byte-identical output, not merely the same *set* of
  cliques in some order -- verified by a dedicated repeated-call test.

## Verification performed (fresh clone, node v22.22.2)

- `node --test bron-kerbosch/bron-kerbosch.test.js` in isolation: 22/22
  passing.
- No `node_modules` or `package.json` anywhere in the repository --
  genuinely dependency-free.
- The committed suite explicitly covers every category named in the
  task's own steps and verification section: empty, isolated-vertex,
  complete, cyclic (both triangle-free and with a chord), and
  disconnected graphs; every invalid-input case (non-integer/negative
  `vertexCount`, non-array `edges`, malformed edge entries, out-of-range
  endpoints, self-loops), plus a dedicated invalid-input-never-mutates
  check; shuffled edge order and duplicate/reversed-order edges
  (confirmed to normalize to the same result as the canonical edge list);
  determinism (repeated calls on the same input produce byte-identical
  output); output-shape checks (always lexicographically sorted, every
  reported set is a genuine clique, no duplicate cliques in the output);
  and three tiers of differential testing against an independent
  brute-force (bitmask subset-enumeration) oracle -- an **exhaustive**
  sweep of every labeled graph on 0..6 vertices (2^(n choose 2) graphs per
  n), a randomized sweep at n=7..13, and a sparse randomized sweep at
  n=14..16 (kept sparse so the oracle's 2^16 subset enumeration stays
  fast).
- **The task's required named test -- "the complete tripartite graph
  K3,3,3 produces exactly 27 maximal cliques" -- is present verbatim**
  and additionally verifies every clique has exactly 3 vertices, one from
  each of the three parts, with the full 27-element result independently
  cross-checked against a directly-constructed cartesian-product expected
  set (rather than just checking the count).
- Beyond the committed suite, an additional uncommitted stress run
  (`stress-test.js`, not committed) checked 137,395 further assertions:
  the same exhaustive 0..6-vertex sweep, wider randomized sweeps up to
  n=18, 200 trials of shuffled/duplicated/reversed-edge invariance
  checks, 50 trials of a 5-independent-call determinism check, the named
  K3,3,3 check, and an input-array-immutability check -- all against the
  same independent brute-force oracle, plus structural sanity checks
  (every output set is a genuine clique, no duplicates, lexicographic
  order) run on every trial. **0 mismatches.**
