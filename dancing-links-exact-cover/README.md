# Deterministic Dancing Links Exact Cover

A dependency-free, deterministic exact-cover solver implementing Knuth's
Algorithm X via **Dancing Links (DLX)**: column headers and row cells are
linked into circular doubly-linked lists (L/R across column headers and
within a row, U/D within a column), so a column — and every row that
touches it — can be removed from and restored to the search in O(1) per
cell via `cover`/`uncover`, with no re-scanning of the matrix at any step.
This is a distinct task/implementation from the earlier, separately
completed `exact-cover/` solver in this repo — that one is a plain
backtracking Algorithm X solver; this one specifically implements the
Dancing Links linked-list technique with the deterministic "smallest
remaining column" branching heuristic described below.

## API

```js
const { solveExactCover } = require('./dancing-links-exact-cover.js');

const columns = ['A', 'B'];
const rows = [
  { id: 'r1', columns: ['A'] },
  { id: 'r2', columns: ['B'] },
];

solveExactCover(columns, rows);
// -> [['r1', 'r2']]
```

- `columns`: an array of distinct column names, each a `string` or
  `number`.
- `rows`: an array of row descriptors `{ id, columns }`, where `id` is a
  distinct `string`/`number` and `columns` is a non-empty array of
  distinct values, each of which must appear in the `columns` array — the
  set of columns this row/candidate covers.
- `options.limit` (optional): a positive integer capping how many
  solutions to find before stopping the search early. Omitted means "find
  every solution."

Returns an array of solutions. Each solution is an array of row `id`s
whose combined `columns` sets exactly partition the full `columns` set
(every column covered by exactly one selected row). With zero columns,
the only solution is the empty selection `[]` — the classic Algorithm X
base case: no columns left to cover means the current partial selection
is already complete.

Every argument is validated: a wrong-*kind* value (not an array, not a
string/number, not an integer) throws `TypeError`; a right-kind value with
an invalid *value* (a duplicate column or row id, an unknown column
reference, a duplicate column reference within one row, an empty row, a
non-positive `limit`) throws `RangeError`.

## Determinism

At every search step, the column with the **fewest remaining candidate
rows** is branched on first (Knuth's standard "S heuristic" — it both
prunes dead ends fast and pins down a fully deterministic branching
order); ties are broken by each column's position in the original
`columns` array (leftmost first). For the chosen column, candidate rows
are tried in the order they appear in the original `rows` array (this
falls out naturally from how each column's linked list is built — see
"Implementation notes" below, no separate sort is needed).

Both within one call and across repeated calls with the same input, this
yields byte-identical output: solutions are returned in the exact order
the depth-first search discovers them (not sorted or otherwise
canonicalized), and row ids within a solution are in the order they were
selected during the search (also not sorted). `solveExactCover` never
mutates `columns`, `rows`, or any row object — a fresh internal linked
structure is built from the input on every call, so repeated calls with
the same (or shared) input arrays are fully independent.

## Implementation notes

The matrix is represented purely as a graph of plain-object nodes with
`L`/`R`/`U`/`D` pointers (no arrays/typed-arrays for the matrix itself,
per the classic Dancing Links technique):

- Column headers are linked into one circular horizontal list anchored at
  a sentinel `root` node, in original `columns` order.
- Each row's cells are linked into their own circular horizontal list (in
  the order that row lists its columns), and each cell is also linked
  into its column's circular vertical list. Cells are always inserted as
  the new *bottom* of their column's list (just above the header), so a
  column's vertical list, walked top-to-bottom from the header, visits
  rows in the exact order they were passed to `solveExactCover` — this is
  what gives "original row order for candidates" for free, with no
  separate sort needed.

`cover(c)` unlinks column `c` from the header row, then for every row
`c` still has cells in, unlinks every *other* cell in that row from its
own column (shrinking those columns' candidate counts) — this is what
removes both the column and every row that would conflict with selecting
one of its candidates, in one O(cells touched) pass. `uncover(c)` reverses
exactly that, in exactly reverse order, which is what makes backtracking
O(1) per cell instead of needing to rebuild any state.

The search itself is a straightforward recursive Algorithm X: if no
columns remain, the current partial selection is a complete solution;
otherwise pick the minimum-size column, and for each of its candidate
rows, cover every column that row touches, recurse, then uncover them
again in reverse order before trying the next candidate row (or
backtracking further up if there are none left). A boolean "stop" signal
threads back up through the recursion once `results.length` reaches
`options.limit`, so the search can exit early — but every `cover()`
already performed is still matched with an `uncover()` before returning
at each level, leaving the (discarded, per-call) structure internally
consistent regardless of whether the search ran to completion or stopped
early.

## Testing

`dancing-links-exact-cover.test.js` uses `node:test`/`node:assert/strict`
and needs no installed packages. It covers:

- Fixed shapes: empty input (the trivial empty-selection solution),
  columns with no rows at all, an unreachable column (impossible), a
  genuinely unique-solution instance, a multi-solution instance, the
  classic worked example from Knuth's own "Dancing Links" paper (7
  columns / 6 candidate rows, unique solution `{r2, r4, r6}` — confirmed
  by hand: `{1,4} ∪ {3,5,6} ∪ {2,7}` covers all 7 columns with zero
  overlap), `limit` capping behavior (including a limit larger than the
  total solution count), a deliberately-constructed backtracking scenario
  (the smallest-column heuristic first commits to a row that leaves
  another column uncoverable, forcing the search to backtrack past it to
  reach the real solution), deterministic-order (repeated calls, and a
  call with freshly-copied input, all producing byte-identical output),
  and repeated-call/no-mutation behavior (shared input arrays/objects are
  never mutated across two calls).
- The full `TypeError`/`RangeError` validation surface described above.
- Two deterministic randomized differential test blocks (fixed-seed
  `mulberry32` PRNG, no external randomness) cross-checking
  `solveExactCover`'s (canonicalized) output against an exhaustive
  subset-enumeration reference implementation, across small dense and
  larger sparse randomly-generated instances.

Before the committed suite was written, an uncommitted `fuzz.js` (kept in
this directory for reference, not part of the `node:test` run) ran a
wider differential sweep — 4,356 checks, 0 mismatches on the final
implementation — including dedicated blocks for `limit` prefix-consistency
and repeated-call/no-mutation behavior at larger trial counts than the
committed suite.

One genuine test-authoring bug was caught and fixed while running this
suite before commit: the original "unique-solution instance" test used
the same three-row shape as the "multi-solution instance" test just below
it (a lone row covering both columns), so it actually had two solutions,
not one — the solver was correct, the test's own fixture was wrong. Fixed
by removing the "covers both columns" row from that fixture, leaving a
genuinely unique-solution instance.

```
$ node --test dancing-links-exact-cover.test.js
# tests 27
# pass 27
# fail 0
```
