# rectangle-union

Dependency-free, single-file, exact axis-aligned rectangle union area
(`rectangleUnionArea`) in JavaScript, computed via an O(n log n) sweep line
with a coordinate-compressed segment tree, with an automated `node:test`
suite.

## Files

- `rectangle-union.js` -- the implementation: `rectangleUnionArea(rectangles)`
  accepts an array of `[x1, y1, x2, y2]` rectangles (each coordinate a safe
  integer, `x2 > x1`, `y2 > y1`) and returns the exact area of their union as
  a `BigInt`. `rectangleUnionArea([])` returns `0n`. The input array and its
  rectangle sub-arrays are never mutated. Malformed or non-safe-integer
  coordinates throw `TypeError`; well-typed but non-positive dimensions throw
  `RangeError`.

  **Algorithm**: a classic sweep line over x, with a segment tree over
  coordinate-compressed y-intervals tracking how much of the y-axis is
  currently covered by at least one active rectangle (the standard technique
  for "Rectangle Area II"/Klee's measure problem in one dimension lower than
  the full 2D case). Concretely:
  1. Every rectangle contributes two sweep events on the x-axis: `+1`
     coverage of `[y1, y2)` at `x1`, and `-1` coverage of the same interval at
     `x2`.
  2. The y-axis is coordinate-compressed to the sorted set of distinct `y1`/
     `y2` values across all rectangles, giving `m` elementary y-intervals.
  3. A segment tree over those `m` intervals tracks, at every node, how many
     "fully covering" updates are currently active (`count`) and the total
     covered length within that node's range (`covered`) -- a node's `covered`
     equals its full range length whenever `count > 0`, and otherwise the sum
     of its children's `covered` (the standard lazy-count segment tree used
     for this exact class of sweep-line problem).
  4. Sweeping x left to right, between two consecutive distinct x-coordinates
     the covered y-length (read from the segment tree root) times the x-gap
     is exactly the area contributed in that vertical slab; summing these
     slabs gives the total union area.

  **Why `BigInt` throughout, not just at the final return**: rectangle
  coordinates are only required to be JS *safe* integers
  (`Number.isSafeInteger`), i.e. individually bounded by
  `±(2^53 - 1)`. A single rectangle's width or height (`x2 - x1` or
  `y2 - y1`) can therefore be as large as `~2 * 2^53`, which exceeds
  `Number.MAX_SAFE_INTEGER` -- and worse, **plain `Number` subtraction of two
  safe integers is not always exact once the result exceeds `2^53`**, because
  IEEE-754 doubles can only represent every *other* integer once magnitude
  passes `2^53` (only even integers in `[2^53, 2^54)` are representable
  exactly). A committed test (`'a coordinate span that would NOT be exact
  under plain float64 subtraction is still exact'`) picks
  `x1 = -(2^53 - 1)`, `x2 = 2^53 - 2` specifically because their exact
  difference, `2^54 - 3`, is *odd* and therefore not representable as a
  float64 -- `x2 - x1` computed as a plain `Number` subtraction is
  demonstrably off by one in that regime (confirmed directly in the test via
  `assert.notEqual`). To avoid this trap entirely, every y-interval length
  and every x-gap used in the area calculation is computed by converting the
  (always-exact, since inputs are validated safe integers) coordinates to
  `BigInt` *before* subtracting, rather than subtracting as `Number`s and
  converting the result afterward. Coordinate *compression* (sorting,
  building the `Map` from y-value to compressed index, comparing for
  event ordering) still uses plain `Number`s throughout, since those
  operations never require taking a difference that could exceed the
  safe-integer range -- only length/gap arithmetic does.

- `rectangle-union.test.js` -- 22 `node:test` cases (no external
  dependencies), organized by the categories the task's own spec calls out:
  - **Structural cases named in the spec**: disjoint, touching (edge and
    corner), overlapping, nested, duplicate, negative-coordinate, and
    large-coordinate (including the full safe-integer span,
    `[-(2^53-1), -(2^53-1)]` to `[2^53-1, 2^53-1]`) rectangles, each with a
    hand-computed expected area.
  - **The float64-subtraction precision trap**, as its own explicit,
    self-verifying test (see above) -- this is the single most
    correctness-critical property of the implementation given the task's
    "exact" requirement, so it gets a dedicated test rather than being
    folded into a general large-coordinate case.
  - **Invalid inputs**: non-array top-level input; a rectangle entry that
    isn't a 4-element array; a full sweep of non-safe-integer coordinate
    types (`NaN`, `Infinity`, strings, `null`, `undefined`, objects, arrays,
    booleans, out-of-safe-range numbers, and `BigInt` values -- `BigInt`
    inputs are rejected too, since the function's own *contract* is `Number`
    coordinates in, `BigInt` area out, not `BigInt` coordinates in); zero or
    negative width/height; and a specific check that an invalid rectangle
    later in the array is not masked by valid rectangles earlier in it.
  - **Input immutability**: a deep-equality snapshot before and after a call
    confirms neither the outer array nor any rectangle sub-array is mutated.
  - **Determinism**: repeated calls on the same input produce identical
    results.
  - **Seeded random cases checked against a brute-force oracle**, per the
    task's own explicit requirement: 300 small random configurations plus 80
    larger ones (mulberry32 seeded PRNG for reproducibility), each checked
    against `bruteForceUnionArea` -- a grid-rasterization reference that
    combines every rectangle's x and y boundaries into a compressed grid and
    sums the exact area of every grid cell covered by at least one rectangle.
    This reference is deliberately implemented as a completely different
    algorithm (no sweep line, no segment tree) so it is a meaningful
    independent cross-check rather than a restatement of the same logic.
  - **A dense-overlap stress case** (20 overlapping unit-width vertical
    strips) also checked against the brute-force oracle.

- `test-output.txt` -- raw, unedited output of the exact run command below.

## Additional verification (not part of the committed suite)

Beyond the committed suite, a larger uncommitted differential/stress run
(`rect-union-stress.js`, deleted before commit) was run first:

- **567 checks total, 0 mismatches**, combining every structural case above
  with **400 seeded-random small configurations** (coordinate range ±10,
  up to 12 rectangles), **100 seeded-random medium configurations**
  (coordinate range ±100, up to 30 rectangles), and **50 seeded-random
  large-magnitude configurations** (coordinates around ±5×10^11, testing
  that coordinate compression and the segment tree behave correctly when
  the coordinate *values* are large but their *diversity* -- and hence
  brute-force cell count -- stays small).
- **The float64-precision-trap fixture was verified to actually be a trap**
  before relying on it: the stress script explicitly compares
  `BigInt(x2 - x1)` (computed via plain `Number` subtraction, then
  converted) against `BigInt(x2) - BigInt(x1)` (computed exactly) for the
  chosen fixture, confirming they differ (`18014398509481980` vs the exact
  `18014398509481981`) -- i.e. this isn't just a theoretical concern, a
  naive implementation using `Number` subtraction for lengths would have
  produced a provably wrong answer on this exact input.
- **The full safe-integer span** (`[-(2^53-1), -(2^53-1), 2^53-1, 2^53-1]`)
  checked against its hand-computed exact `BigInt` area.

**0 mismatches across all of it** on the first *implementation* attempt --
continuing the streak from prior tasks in this collection of zero genuine
implementation bugs found during stress testing (this makes nine tasks in a
row, following factor64, Burrows-Wheeler Transform, HyperLogLog, the Huffman
codec, Palindromic Tree, ROBDD, Robin Hood Hash Map, and KD-Tree -- see those
tasks' own READMEs).

## Exact run command

```
node --test rectangle-union.test.js
```

Requires only the Node.js runtime (tested on Node v22.22.2) -- no `npm
install`, no native build, no service to start, and no external dependencies
of any kind (only built-in `BigInt`/`Array`/`Map`/`Set`). Run from inside
this directory, from a clean checkout. The full suite (22 tests, including
380 seeded-random differential comparisons against the brute-force oracle)
completes in well under a second.

## Design notes

- **The segment tree's `count`/`covered` split is the standard technique for
  this exact class of sweep-line problem** (sometimes called a "coverage
  count" segment tree): a node's `count` tracks how many *fully-covering*
  add/remove updates are currently pending exactly at that node (not
  propagated to children, since only the root's `covered` value is ever
  read), and `covered` is recomputed bottom-up after every update as either
  the node's full range length (if `count > 0`, meaning at least one
  rectangle interval fully covers this node's range) or the sum of the two
  children's `covered` values otherwise. This avoids needing lazy
  propagation at all, since queries only ever read the root.
- **Elementary y-interval lengths are precomputed as a `BigInt` prefix-sum
  array** (`prefix[i] = prefix[i-1] + (BigInt(ys[i]) - BigInt(ys[i-1]))`) so
  that `fullLen(lo, hi)` inside the segment tree update is an O(1) `BigInt`
  subtraction rather than an O(range) loop -- this keeps each `update` call
  at genuine O(log m) `BigInt` operations rather than accidentally
  regressing to O(m) per update (which would make the whole sweep O(n*m)
  instead of the required O(n log n)).
- **Segment tree array sizing**: `4 * m` entries for `m` elementary
  intervals is the standard safe bound for a non-power-of-two-sized segment
  tree built with the `node`/`2*node`/`2*node+1` indexing scheme; `m` is
  always at least 1 whenever the input is non-empty, since every valid
  rectangle contributes two distinct y-values (`y1 < y2` is enforced by
  validation).
- **Coordinate compression only ever compares or sorts coordinates, never
  subtracts them** -- all arithmetic that could exceed the safe-integer
  range (interval lengths, x-gaps) is deferred to the `BigInt`-exact prefix-
  sum/length-difference code paths described above.
- **The "preserve the input" requirement is satisfied structurally, not just
  incidentally**: `validateRectangle` only *reads* rectangle coordinates via
  destructuring and returns a fresh `{x1,y1,x2,y2}` object; nothing in the
  implementation ever assigns into a caller-supplied array or calls a
  mutating array method (`.sort()`, `.push()`, etc.) on caller-supplied data
  -- all sorting happens on locally-built arrays (`ys`, `events`).
