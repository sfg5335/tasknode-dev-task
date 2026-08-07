# link-cut-forest

Dependency-free, single-file, deterministic Link-Cut Forest (Sleator-Tarjan
splay-based link-cut tree, one per connected component) in JavaScript over
zero-based, weighted vertices, with an automated `node:test` suite.

## Files

- `link-cut-forest.js` -- the implementation (`LinkCutForest` class):
  `link(u, v)`, `cut(u, v)`, `connected(u, v)`, `setValue(u, value)`,
  `pathSum(u, v)`, `size(u)`. Each vertex is a node in a splay tree
  representing its *preferred path*; the whole forest is the standard
  link-cut-tree representation of `n` such splay trees, joined by
  "path-pointer" (virtual/light) parent edges. Three primitives everything
  else is built from: `_access` (exposes the path from a vertex's real
  root to itself as one splay tree -- the textbook "walk up through
  path-pointers, splaying and reattaching as we go" algorithm),
  `_makeRoot` (`_access` then a lazy whole-subtree reversal, so any
  vertex can become the new root of its tree in O(log n) amortized),
  and `_findRoot` (`_access` then descend to the *leftmost* node of the
  resulting splay tree with lazy-reversal pushdown along the way -- the
  real root is always leftmost, by construction of every rotation).
  `link`/`cut` reject self-links, cycle-forming links, self-cuts, and
  non-edge cuts; `pathSum` rejects a query between disconnected vertices.
  A parallel, trivial adjacency-set structure (updated in lockstep by
  `link`/`cut`) is all `size(u)` uses -- a plain BFS over real edges --
  which keeps that one query dead simple without needing the more
  elaborate "virtual subtree size" augmentation some link-cut-tree
  variants add for O(log n) subtree queries.

  Every method validates `u`/`v`: a non-integer/non-number vertex throws
  `TypeError`; a correctly-typed vertex outside `[0, n)` throws
  `RangeError`. Every other rejection (self-link, cycle-forming link,
  self-cut, non-edge cut, disconnected `pathSum`) also throws
  `RangeError` -- the same "well-typed, well-bounded, but logically
  invalid" bucket other already-completed tasks in this series use
  `RangeError` for.

- `link-cut-forest.test.js` -- 17 `node:test` cases (no external
  dependencies): a singleton vertex; the empty forest; a 10-vertex chain
  (built purely via `link`) with every one of its 100 `(i, j)` `pathSum`
  pairs checked against the hand-computed sub-range sum, in both
  directions; a 10-vertex star with every leaf-pair `pathSum` checked;
  explicit rerooting (repeated alternating-direction queries on the same
  5-vertex chain, checked for consistency across repeats); `cut` splitting
  a tree into two independent components (with `connected`/`size`/
  `pathSum` re-checked on both halves, and the old cross-component
  `pathSum` now rejected); cut-then-relink into a *different* shape
  (verifying the structure isn't left corrupted by a prior access/cut);
  `setValue` updates reflected immediately in later `pathSum` calls,
  including negative and fractional values and repeated overwrites;
  repeated-query determinism; a full `TypeError`/`RangeError` sweep
  (constructor validation including `NaN`/`Infinity` rejection, vertex
  bounds, self-link, self-cut, cycle-forming link in both argument
  orders, non-edge cuts including both "never linked" and "connected but
  indirect" and "different trees entirely" cases, disconnected
  `pathSum`); `setValue` explicitly accepting non-integer and negative
  finite values; a fixed 24-step differential comparison against an
  independently-written naive adjacency-list-plus-BFS reference forest
  model (mixing every operation, including cuts and relinks into new
  shapes); and a 60-trial fixed-seed randomized differential stress test
  against the same naive reference, comparing every operation's result
  (and whether it throws) directly.

- `test-output.txt` -- raw, unedited output of the exact run command
  below.

## Bugs found and fixed during development (via differential stress-testing, before any code was committed)

Two real correctness bugs were caught by cross-checking against the naive
reference model with randomized operation sequences, before the committed
test suite was even written:

1. **`cut`'s direct-edge check could false-positive across disconnected
   trees.** The check "after `makeRoot(u); access(v)`, is the resulting
   splay-subtree size at `v` exactly 2?" is a correct direct-edge test
   *only when `u` and `v` are already known to be connected* -- if they're
   in different trees, `access(v)` never touches `u` at all, and `v`'s own
   (unrelated) tree can coincidentally also have exactly 2 vertices,
   which looked identical to a genuine direct edge. Fixed by checking
   `connected(u, v)` explicitly before relying on the size-2 shortcut.
2. **`findRoot` incorrectly assumed `access(x)`'s internal bookkeeping
   variable (the last vertex reached while walking up through
   path-pointers) was always the tree's real root.** That's only true the
   *first* time a vertex is accessed after some path-pointer
   restructuring; on a second access of a vertex whose splay tree has
   already been fully merged with the root by a prior access, the
   walk-up loop terminates after a single step and that shortcut
   variable ends up being `x` itself, not the root. Fixed with the
   standard, reliable approach instead: after `access(x)`, the real root
   is always the *leftmost* node of the resulting splay tree (with lazy
   reversal pushed down along the way to descend correctly) --
   descending there directly, rather than trusting `access`'s return
   value.

Both were caught the same way: run `link`/`cut`/`connected`/`setValue`/
`pathSum`/`size` in random sequences on small forests, compare every
single call's result (and whether it throws, and with which error type)
against the naive reference forest, and stop at the first divergence.
After both fixes, a ~500,000-operation stress run (5,000 trials, forests
up to 15 vertices) plus a further ~110,000-operation run on larger
forests (20-80 vertices, 300-800 ops per trial) both passed with zero
mismatches, alongside explicit exhaustive chain and star pathSum checks.

## Additional verification (not part of the committed suite)

Beyond the committed test file: the two large differential stress runs
described above (zero mismatches after the fixes); a full validation
sweep of every documented `TypeError`/`RangeError` case run directly
against the implementation; and explicit exhaustive `pathSum` checks over
a 10-vertex chain (all 100 `(i,j)` pairs) and a 10-vertex star (all 81
leaf pairs), both matching hand-computed expected sums exactly.

## Exact run command

```
node --test link-cut-forest.test.js
```

Requires only the Node.js runtime (tested on Node v22.22.2) -- no
`npm install`, no native build, no service to start. Run from inside this
directory, from a clean checkout.

## Design notes

- `size(u)` returns the number of vertices in `u`'s whole connected
  component (not the size of any particular splay subtree), answered via
  a plain BFS over a parallel adjacency-set structure that `link`/`cut`
  keep in lockstep with the real forest edges. This is O(component size)
  rather than O(log n), since the task spec doesn't require an
  asymptotic bound for `size` and a plain BFS is far less bug-prone than
  the "virtual subtree size" augmentation some link-cut-tree variants
  add for O(log n) subtree queries -- given how bug-prone link-cut trees
  already are (see above), this was a deliberate simplicity-over-
  asymptotics tradeoff for the one query that didn't need it.
- `pathSum(u, u)` returns just `u`'s own value (a trivial length-1 path)
  rather than throwing, since a vertex is trivially connected to itself.
- Self-link, cycle-forming link, self-cut, non-edge cut, and disconnected
  `pathSum` are all `RangeError` (not a separate custom error class),
  for consistency with the "well-typed, well-bounded, but logically
  invalid combination" `RangeError` bucket used elsewhere in this task
  series (e.g. `min > max`, an empty required range).
