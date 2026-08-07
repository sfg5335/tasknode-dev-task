# persistent-segment-tree

Dependency-free, single-file persistent (fully-versioned) segment tree in
JavaScript for a fixed-length array of finite numbers, with an automated
`node:test` suite.

## Files

- `persistent-segment-tree.js` -- the implementation (`PersistentSegmentTree`
  class): `update(version, index, value)`, `query(version, left, right)`,
  a `length` getter, and a `versionCount` getter. Version 0 is built from
  the constructor's input array in O(n) (`build`); every `update` call
  creates a brand-new numbered version via structural sharing -- only the
  O(log n) nodes on the root-to-leaf path for `index` are freshly
  allocated (`updateNode`), every other node is shared by reference with
  the base version -- so `update` and `query` (`queryNode`) both run in
  O(log n) and no existing version is ever mutated. `update`'s `version`
  argument can be *any* existing version number, not just the most
  recently created one, so branching a new version off an older one never
  disturbs it or any other version. `update` returns the new version's
  number. All of `version`/`index`/`left`/`right` must be integers and
  `value` must be a finite number; wrong-typed arguments throw
  `TypeError`, correctly-typed but out-of-bounds ones (unknown version, an
  index or range outside `[0, length)`, `left > right`) throw
  `RangeError`. The constructor validates that its input is an array of
  finite numbers and never retains a reference to it (values are copied
  into leaves), so later mutating the caller's array cannot affect the
  tree.
- `persistent-segment-tree.test.js` -- 15 `node:test` cases (no external
  dependencies): version-0 construction correctness; the empty-array case
  (`length === 0`, one version, every query/update rejected as
  out-of-range); the singleton case; that `update` returns the correct new
  version number and `versionCount` tracks it exactly; branching updates
  (two versions built from the same base version stay independent of each
  other and of the base); a chain of updates checked to leave every
  earlier version in the chain intact; boundary ranges (both single-element
  ends and the full range); negative and fractional values; repeated
  queries returning identical results; non-mutation and non-retention of
  the caller's input array (including a frozen-input construction check
  and a separate check that mutating the source array *after*
  construction has no effect on the tree); a full sweep of `TypeError` vs.
  `RangeError` cases for the constructor, `update`, and `query`; a fixed,
  hand-specified multi-version branching sequence cross-checked at every
  step against parallel plain-array "shadow" copies over every possible
  `[left, right]` range (not just a few samples); and a 500-operation
  fixed-seed randomized cross-check against the same plain-array shadow
  model, with additional spot-checks after every operation and one final
  exhaustive sweep of all versions and all ranges.
- `test-output.txt` -- raw, unedited output of the exact run command below.

## Additional verification (not part of the committed suite)

Beyond the committed test file, a larger uncommitted stress run exercised
20,000 further update operations (random base version, index, and value
each step, wider value range, quarter-increment values to avoid float
rounding edge cases) against the same plain-array shadow model, with two
random range-sum spot-checks per step (40,000 checks total). Every check
matched exactly; final `versionCount` was 20,001 and `length` remained
unchanged throughout, as expected.

## Exact run command

```
node --test persistent-segment-tree.test.js
```

Requires only the Node.js runtime (tested on Node v22.22.2) -- no
`npm install`, no native build, no service to start. Run from inside this
directory, from a clean checkout.
