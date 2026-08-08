# disjoint-sparse-table

Dependency-free, single-file JavaScript implementation of a **Disjoint
Sparse Table** (`DisjointSparseTable`), a data structure that answers range
queries over **any associative binary operator** -- including
non-commutative ones (ordered string concatenation, matrix multiplication,
etc.), not just commutative/idempotent ones like `min`/`max`/`gcd` -- in
O(1) time per query after O(n log n) preprocessing, with an automated
`node:test` suite.

## Files

- `disjoint-sparse-table.js` -- the implementation. `new
  DisjointSparseTable(data, combine)` copies `data` (never mutates the
  caller's array, and is itself immune to later mutation of it), exposes a
  `size` property, and `query(left, right)` combines `data[left],
  data[left+1], ..., data[right-1]` (the half-open range `[left, right)`)
  in that exact order using `combine`, in O(1) time. `combine` must be
  associative but need not be commutative; it is always invoked as
  `combine(leftOperand, rightOperand)` with operands in original array
  order. Both the returned instance and its internal copy of `data` are
  `Object.freeze`d.

  **Why a *disjoint* sparse table, not a classic sparse table**: a classic
  Sparse Table (the standard structure for O(1) Range-Minimum-Query-style
  problems) answers a query by combining two possibly-*overlapping*
  power-of-two windows that together cover the query range. That's only
  correct when the operator is idempotent (`combine(x, x) === x`, as with
  `min`/`max`/`gcd`/bitwise `and`/`or`) -- overlap silently double-counts
  elements otherwise, which is simply wrong for `+`, string concatenation,
  matrix multiplication, and so on. A Disjoint Sparse Table instead always
  combines two **disjoint** halves that exactly partition the query range
  with no overlap, so it works correctly for *any* associative operator,
  and never needs the operator to be idempotent or commutative.

  **Construction** (the standard technique for this structure): conceptually
  partition the array into blocks of size `2^(level+1)` at each level
  `level = 0, 1, ..., LOG-1`. Split each block at its midpoint `mid`.
  `table[level][i]` for `i` in the block's left half holds
  `combine(data[i], data[i+1], ..., data[mid-1])`, built by extending
  *leftward* from `mid-1` (`arr[i] = combine(data[i], arr[i+1])`) so the
  fold order is preserved. `table[level][i]` for `i` in the right half
  holds `combine(data[mid], ..., data[i])`, built by extending *rightward*
  from `mid` (`arr[i] = combine(arr[i-1], data[i])`), likewise
  order-preserving. When `size` isn't a power of two, the last block at
  each level is simply truncated to the array's actual bounds; if that
  truncation leaves no right half at all, the block is skipped at that
  level (no query can ever land on it there -- see below), so no special
  casing is needed elsewhere.

  **Query**: for `right - left === 1` (single element), the element is
  returned directly with no table lookup at all. Otherwise, `left` and
  `right - 1` necessarily differ in at least one bit; let `level` be the
  position of their **highest differing bit**
  (`31 - Math.clz32(left ^ (right - 1))`). At that level, `left` and
  `right - 1` are guaranteed (by construction of the block/level
  hierarchy) to land in the *same* block -- their shared higher bits agree
  -- but in *different halves* of it, since their bit at `level` differs.
  So `table[level][left]` holds exactly `combine(data[left..mid-1])` and
  `table[level][right-1]` holds exactly `combine(data[mid..right-1])`;
  combining those two disjoint, already-correctly-ordered pieces with one
  more `combine` call gives exactly `combine(data[left], data[left+1],
  ..., data[right-1])` in the original left-to-right order. This query
  path performs exactly one `combine` call and two array lookups,
  independent of `right - left` -- genuinely O(1), not merely "fast": see
  the dedicated combine-call-counting test below.

- `disjoint-sparse-table.test.js` -- 23 `node:test` cases, organized by the
  categories the task's own spec calls out:
  - **Empty and singleton inputs**: an empty table rejects every query
    (including the empty range `[0, 0)`, since there's no defined identity
    element for an arbitrary associative operator); a singleton table's
    only valid query returns the element directly and never even calls
    `combine`.
  - **Power-of-two and irregular lengths**, checked against a naive
    left-to-right fold reference across *every* valid range (the task's
    own explicit requirement) -- separately for power-of-two sizes (1, 2,
    4, ..., 64) and irregular sizes (3, 5, 6, 7, 9, 13, 17, 31, 33, 50,
    100, 101, 257), plus a dedicated negative-number case.
  - **Ordered (non-commutative) combine functions**, proving operand order
    is preserved exactly as the task requires ("operand order must remain
    correct for non-commutative operations"): every valid range of a
    9-word array checked against separator-joined string concatenation;
    a genuinely non-commutative reverse-concatenation operator
    (`combine(a, b) = b + a`, verified associative but NOT commutative,
    with an explicit sanity check that its fold *differs* from plain
    concatenation so the test is actually exercising order-sensitivity)
    checked against every valid range, plus a concrete worked example
    (`query(0, 3) === 'cba'`); a call-recording combine that asserts every
    invocation's left operand's characters precede its right operand's
    characters in the original array; and a 2x2 integer-matrix-
    multiplication combine (associative, famously non-commutative) checked
    against every valid range with `assert.deepEqual`.
  - **Repeated queries**: determinism (repeated identical queries return
    identical results); an explicit combine-call-counter test proving a
    non-empty multi-element query invokes `combine` **exactly once**
    regardless of range width (the structural proof that query truly is
    O(1), not merely fast in practice); and a coarse wall-clock timing
    sanity check (`n = 1,000,000`, comparing the narrowest vs. widest
    possible query, with a generous 100x-plus-50ms margin to stay robust
    against machine noise while still catching an accidental O(range)
    regression).
  - **Invalid constructor arguments**: non-array `data`, non-function
    `combine`.
  - **Invalid query arguments**: negative `left`, `right` beyond `size`,
    empty ranges (`left === right`, both mid-array and at the boundary),
    reversed ranges (`left > right`), and a full sweep of non-integer /
    non-numeric `left`/`right` values (`NaN`, `Infinity`, floats, strings,
    `null`, `undefined`, objects, arrays, booleans, `BigInt`) -- plus a
    check that one individually-valid-looking argument doesn't mask a
    problem with the other.
  - **Input preservation**: the constructor never mutates the caller's
    array; mutating the caller's array *after* construction never affects
    the table; and the table's own internal copy plus the instance itself
    are both genuinely frozen (`Object.isFrozen`, with an explicit
    strict-mode `assert.throws` on an attempted mutation).
  - **`size` property** reflects the input length exactly, across several
    sizes including 0.
  - **Seeded random differential stress** against the naive-fold oracle
    (mulberry32 PRNG for reproducibility), across three combine functions
    (`sum`, `max`, `concat`) and many random array sizes and random valid
    ranges.

- `test-output.txt` -- raw, unedited output of the exact run command below.

## Additional verification (not part of the committed suite)

Beyond the committed suite, a larger uncommitted differential/stress run
(`dst-stress.js`, deleted before commit) was run first, totaling
**4,718,238 checks, 0 mismatches**:

- An **exhaustive** sweep (not just random sampling) over every array size
  from 0 to 300 and *every single valid range* within each, checked against
  a naive-sum fold.
- **Seeded-random stress** (mulberry32) across six different combine
  functions -- `sum`, `min`, `max`, bitwise `xor`, non-commutative
  reverse-concatenation, and modular 2x2 matrix multiplication -- each with
  200 trials of random array sizes up to 500 and 30 random valid ranges per
  trial.
- A **large-scale single-instance** stress: one million-element array,
  5,000 random-range queries checked against an O(1)-per-query prefix-sum
  reference (a third, independent computation path from both the sparse
  table and the naive fold).
- An **edge-size sweep** around every power-of-two boundary from 1 up to
  257 (1, 2, 3, 4, 5, 7, 8, 9, 15, 16, 17, ..., 255, 256, 257), every valid
  range in each.

**One genuine near-miss during stress-test authoring, correctly diagnosed
as a harness bug and not an implementation bug** (documented here in the
interest of transparency, matching this collection's established practice
of auditing every stress-test mismatch before assuming the implementation
is at fault): the first version of the matrix-multiplication stress case
used unbounded integer matrix entries, and after ~500 repeated
multiplications the values grew to ~1e96 magnitude, where ordinary
float64 rounding noise (relative error ~2^-52, confirmed directly by
comparing the two mismatching values) made two *mathematically identical*
results compare unequal -- nothing to do with the sparse table's
correctness. Fixed by switching to modular matrix multiplication (mod a
small constant chosen so every intermediate product stays exactly
representable in float64) so results are bounded and exactly comparable.
After that fix, a second, unrelated harness bug briefly surfaced: a
leftover string-literal comparison (`name === 'matmul2x2'`) from before the
combine was renamed to `'matmul2x2-mod'`, which silently fell through to
JavaScript's reference-equality `===` on two different array objects --
always `false`, regardless of their contents. Fixing the name string to
match resolved it, and the full 4.7M-check run then passed with 0
mismatches. Both issues were entirely in the stress harness's own
comparison logic, not in `disjoint-sparse-table.js`.

## Exact run command

```
node --test disjoint-sparse-table.test.js
```

Requires only the Node.js runtime (tested on Node v22.22.2) -- no `npm
install`, no native build, no service to start, and no external
dependencies of any kind. Run from inside this directory, from a clean
checkout. The full suite (23 tests) completes in about a second.

## Design notes

- **Why the empty range `[left, left)` is rejected rather than silently
  supported**: an arbitrary associative operator has no guaranteed
  identity element (e.g. non-empty string concatenation has none), so
  there is no universally correct value to return for a zero-length range.
  The task's own spec scopes the O(1) guarantee to "non-empty queries",
  consistent with rejecting empty ranges outright (`RangeError`) rather
  than inventing an unsound answer.
- **Why `size <= 1` skips building any table at all**: with 0 or 1
  elements, every valid query is either rejected (0 elements) or a direct
  single-element lookup (1 element, `right - left === 1`) -- no multi-
  element combination is ever possible, so there is nothing for a sparse
  table to precompute, and `combine` is correctly never invoked at all in
  that case (verified directly by a call-counting test).
- **Truncated final blocks need no special-case code at query time**:
  when `size` isn't a power of two, a block near the end of the array may
  be truncated so short that it has no right half at all. Such a block is
  simply skipped during construction (its `table[level]` entries for that
  region stay `undefined`). This is safe with no extra bookkeeping because
  the query-time level/block selection is computed purely from `left` and
  `right - 1`'s own bit patterns (via `Math.clz32`), which by the
  structure's own correctness argument can only ever select a block that
  *did* get built at that level.
- **`Math.clz32` is used for O(1) "find highest differing bit"** rather
  than any loop-based bit scan, keeping the query path genuinely branch-
  count-O(1) rather than merely "no asymptotic dependence on range width"
  (`clz32` is a single hardware-backed instruction on all realistic
  JavaScript engines).
- **The table is copied and frozen defensively** (`Object.freeze` on both
  the copied `data` array and the instance itself) so that neither
  external mutation of the original input after construction, nor
  accidental external mutation of the table's own internal state, can
  silently produce different answers from the same `query` call over time
  -- consistent with `size` and `data` behaving as genuinely immutable,
  trustworthy properties of a constructed instance.
