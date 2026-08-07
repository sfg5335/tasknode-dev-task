# exact-cover

Dependency-free, single-file deterministic exact-cover solver in JavaScript
using Knuth's Algorithm X with Dancing Links (DLX), with an automated
`node:test` suite.

## Files

- `exact-cover.js` -- the implementation (`solveExactCover(columns, rows,
  options)`). `columns` is an array of unique column-name strings (the
  universe to cover); `rows` is an array of `{ id, cols }` objects, where
  `id` is a unique string and `cols` is the (possibly empty, duplicate-free)
  array of column names that row covers; `options.limit` optionally caps how
  many solutions are collected (a positive integer, or `Infinity`, the
  default). Returns an array of solutions, each an array of the selected
  rows' `id`s in selection order. Built on the classic DLX toroidal
  doubly-linked-list structure (`coverColumn`/`uncoverColumn` remove/restore
  links in O(1) per affected cell; `search` recurses on the minimum-size
  uncovered column). Determinism is by design, not incidental: at every
  search step the column with the fewest remaining candidate rows is chosen,
  ties broken by earliest position in the original `columns` array, and a
  chosen column's candidate rows are always tried in the order they appear
  in the original `rows` array -- so identical inputs always produce
  identical output, in the same order, on every call. Neither `columns` nor
  `rows` (nor anything nested inside them) is ever mutated. All inputs are
  validated up front and rejected with `TypeError` (duplicate column names,
  duplicate row ids, a row referencing an unknown or duplicated column,
  wrong argument types, or a malformed `options.limit`).
- `exact-cover.test.js` -- 21 `node:test` cases (no external dependencies):
  Knuth's own classic 7-column/6-row worked example (exactly one solution,
  `{B, D, F}`); empty-columns/empty-rows edge cases; the zero-rows and
  no-covering-row unsatisfiable cases; a single-solution case with
  distractor rows that was traced against the real solver before being
  committed (a first draft's distractor pair was found, via that trace, to
  actually admit a second valid exact cover -- the test was corrected to a
  distractor pair that mutually overlaps and truly can't combine into an
  alternate solution, per the newly-adopted practice of tracing structural
  scenarios against the real implementation rather than hand-deriving them);
  a multiple-solution case (order-independent set-of-sets assertion);
  `options.limit` capping (including across 20 identical single-row
  candidates, and confirming the unset default behaves as `Infinity`);
  deterministic tie-breaking by column input order (both orderings of the
  same two columns produce mirrored, exactly-asserted solution sequences);
  deterministic candidate-row-within-a-column ordering (row input order
  reversed produces reversed solution order); repeated-call determinism;
  non-mutation of frozen inputs via a recursive `deepFreeze` helper (throws
  immediately on any attempted mutation, a stronger check than an
  after-the-fact equality comparison); and 10 malformed-input scenarios
  (duplicate column/row names and ids, unknown-column references,
  in-row duplicate columns, wrong argument types for `columns`/`rows`/
  `row.cols`/column names/row ids/`cols` entries, seven invalid `options.limit`
  values, and a non-object `options` argument).
- `test-output.txt` -- raw, unedited output of the exact run command below.

## Additional verification (not part of the committed suite)

Beyond the committed test file, the solver was cross-checked against an
independent brute-force reference (exhaustive power-set search over
candidate rows, checking each subset covers every column exactly once)
across 8,000 randomly generated small instances (two fixed seeds, 1-6
columns, 0-10 rows per instance, every generated row forced to cover at
least one column so brute force and the solver are compared under the same
semantics -- a row with zero columns is a documented no-op that the solver
never selects, since it never appears in any column's ring). Every trial's
full solution set matched the brute-force reference exactly (as an
order-independent set of sets), and every individual solution the solver
returned was independently re-verified to be a genuine exact cover. Zero
mismatches across all 8,000 trials.

## Exact run command

```
node --test exact-cover.test.js
```

Requires only the Node.js runtime (tested on Node v22.22.2) -- no
`npm install`, no native build, no service to start. Run from inside this
directory, from a clean checkout.
