# van-emde-boas-set

Dependency-free, single-file, deterministic van Emde Boas tree
(`VanEmdeBoasSet`) for a bounded integer universe, in JavaScript, with
an automated `node:test` suite.

## Files

- `van-emde-boas-set.js` -- the implementation:
  `new VanEmdeBoasSet(universeSize)` constructs a set over the integer
  universe `[0, universeSize)`. `universeSize` must be a safe integer
  that is an exact power of two in `[2, 2^32]`. Supported operations:
  `has(x)`, `insert(x)`, `delete(x)`, `minimum()`, `maximum()`,
  `predecessor(x)`, `successor(x)`, `size()`.

  `insert`/`delete` are **idempotent**: inserting an already-present
  value or deleting an already-absent one is a harmless no-op that
  returns `false` (both return `true` when they actually changed the
  set). `predecessor(x)`/`successor(x)` are **strict** -- they find the
  largest stored element `< x` / smallest stored element `> x`
  respectively (never `x` itself, even if `x` is currently a member) --
  and return `null` when no such element exists; `x` need not itself be
  a member, only a valid universe value. `minimum()`/`maximum()` return
  `null` on an empty set. `size()` is O(1) (tracked incrementally, never
  recomputed by walking the structure).

  Algorithm: the classic van Emde Boas tree (as in Cormen/Leiserson/
  Rivest/Stein). A universe of size `u > 2` splits into `upperSize =
  2^ceil(k/2)` top-level clusters, each itself a universe of size
  `lowerSize = 2^floor(k/2)` (`k = log2(u)`), plus a `summary`
  sub-structure (itself a smaller vEB tree, of size `upperSize`)
  tracking which clusters are currently non-empty. `u === 2` is the base
  case: a leaf holding at most `{0, 1}` directly, with no further
  recursion. Every node's own `min` is kept *outside* its cluster
  sub-structures -- inserting into a currently-empty cluster sets that
  cluster's `min`/`max` directly in O(1) with no further recursion,
  since a single-element cluster trivially needs no internal structure
  yet. This is the standard optimization that gives every operation a
  **worst-case** (not merely amortized) `O(log log u)` bound.

  Clusters and summaries are allocated **lazily** -- only the first time
  they're actually needed, via a `Map` keyed by cluster index rather
  than a full-width array -- so constructing a `VanEmdeBoasSet` for
  `universeSize = 2^32` is instant and touches no memory proportional to
  `universeSize`; memory use stays proportional to how many elements
  have actually been inserted (times the shallow `O(log log u)`
  recursion depth, e.g. only ~6 levels even at `u = 2^32`), never to the
  universe size itself.

  Every input is validated: a non-safe-integer `universeSize` or element
  argument throws `TypeError`; a correctly-typed `universeSize` that
  isn't an exact power of two in `[2, 2^32]`, or a correctly-typed
  element outside `[0, universeSize)`, throws `RangeError`.

- `van-emde-boas-set.test.js` -- 23 `node:test` cases (no external
  dependencies): an empty set's initial state; the `universeSize = 2`
  base case exercised end to end (insert both values, query, delete
  one); `universeSize = 2^32` (confirming sub-second/instant
  construction and correct operations on values near both ends of the
  universe, including values not near any earlier-touched cluster); an
  odd universe exponent (`u=8`, asymmetric `upperSize=4`/`lowerSize=2`
  cluster split) and an even one (`u=16`, symmetric `4`/`4` split), both
  cross-checked against a native `Set` for every value in the universe;
  duplicate insertion and missing/repeated deletion idempotency
  (including deleting from an empty set); four extrema-deletion cases
  (deleting the min, deleting the max, deleting the sole element, and
  deleting the min specifically when doing so empties its own cluster
  and the new min must be promoted from the *next* non-empty cluster);
  predecessor/successor strictness, universe-boundary absence, and
  querying a non-member value; a full `TypeError`/`RangeError`
  validation sweep for both `universeSize` and every element-accepting
  method; and three seeded-PRNG (mulberry32, fixed seeds) differential
  suites against a native `Set` (using independent linear-scan
  reference implementations of predecessor/successor/minimum/maximum,
  structurally unrelated to the vEB tree's own bookkeeping) -- one
  across universe sizes 2 through 256 (120 trials x 300 ops), one on
  larger universes 1,024 through 65,536 (9 trials x 500 ops), and one
  exhaustively sweeping every universe exponent from `2^1` through
  `2^14` (56 trials x 200 ops).

- `test-output.txt` -- raw, unedited output of the exact run command
  below.

## Additional verification (not part of the committed suite)

Beyond the committed suite: a larger, uncommitted differential run
against a native `Set` covering the same universe-size sweep with
additional trial counts, plus a `2^32`-universe sanity check confirming
sub-millisecond construction and correct operations on values scattered
across the full range (`0`, `1`, `2`, `2^31`, `4000000000`, `2^32-2`,
`2^32-1`) -- all folded into the committed suite's own `2^32` test once
verified clean.

## Exact run command

```
node --test van-emde-boas-set.test.js
```

Requires only the Node.js runtime (tested on Node v22.22.2) -- no
`npm install`, no native build, no service to start. Run from inside
this directory, from a clean checkout. The full suite (including the
`2^32`-universe test and all three differential suites) completes in
well under a second.

## Design notes

- The public `VanEmdeBoasSet` class and the internal recursive
  `_VEBNode` engine are deliberately split: `_VEBNode.insert`/`.delete`
  are direct, unmodified transcriptions of the classic textbook
  pseudocode, which *assumes* the element being inserted is not already
  present (respectively, that the element being deleted currently is)
  -- calling either on a violating input would silently corrupt the
  `min`-is-excluded-from-clusters invariant. Rather than complicating
  the textbook algorithm itself to special-case duplicates, the public
  wrapper does a cheap `has(x)` check up front and only calls into the
  raw recursive engine when the operation will genuinely change the
  set -- which is what actually makes `insert`/`delete` idempotent per
  this task's own spec, while keeping the recursive engine itself easy
  to verify against the standard reference algorithm.
- `universeSize`'s power-of-two validation avoids JavaScript's bitwise
  operators entirely (`Math.round(Math.log2(u))` plus an exact
  `2 ** k !== u` re-check, rather than e.g. `u & (u - 1)`), because
  bitwise operators coerce their operands to 32-bit integers -- and
  `2^32` itself, the largest universe size this task requires
  supporting, would silently wrap to `0` under that coercion and be
  misjudged as a power of two of the wrong magnitude (or not a power of
  two at all). All other internal arithmetic (`high`/`low`/`index`
  computations, cluster-size splitting) similarly uses plain
  floating-point-safe integer arithmetic rather than bitwise ops, for
  the same reason -- every value involved stays exactly representable
  as a JS number (well under `Number.MAX_SAFE_INTEGER`) even at the
  largest allowed universe size, so no precision is lost either way.
- `size()` is tracked as a plain incrementing/decrementing counter on
  the public wrapper (updated only when `insert`/`delete` actually
  change membership), rather than computed by walking the vEB
  structure -- the classic vEB tree has no native O(1) way to answer
  "how many elements are stored" by inspecting `min`/`max`/`summary`
  alone, so a counter is both the simplest and the fastest option, and
  composes naturally with the idempotency-check wrapper.
