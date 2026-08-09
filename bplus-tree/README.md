# Deterministic In-Memory B+ Tree

A dependency-free, deterministic B+ tree over finite numeric keys — a
genuinely ordered, node-splitting/merging index, not a wrapper around
`Map` with per-query sorting.

## API

```js
const { BPlusTree } = require('./bplus-tree.js');

const tree = new BPlusTree(4);          // maxKeys per node (default 4)
tree.set(10, 'hello');                  // insert or upsert; returns the tree (chainable)
tree.get(10);                           // -> 'hello', or undefined if absent
tree.has(10);                           // -> true / false
tree.delete(10);                        // -> true if a key was removed, false otherwise
tree.size;                              // getter, current key count
tree.range(5, 15);                      // inclusive [lo, hi] -> [[key, value], ...] ascending
```

- `new BPlusTree(maxKeys = 4)` — `maxKeys` is the maximum number of keys any
  single node (leaf or internal) may hold before it must split. Must be an
  integer; a non-integer/non-number throws `TypeError`, a well-typed value
  `< 2` throws `RangeError` (a tree of order 1 cannot support a meaningful
  split — see "Design choices" below).
- `set(key, value)` — inserts a new key or updates an existing one
  (upsert); returns `this` so calls can be chained, matching `Map`'s own
  `set()` convention.
- `get(key)` / `has(key)` / `delete(key)` — same semantics as `Map`.
  `delete` returns a boolean indicating whether a key was actually present.
- `range(lo, hi)` — every stored `[key, value]` pair with `lo <= key <=
  hi` (both endpoints inclusive), in ascending key order. `lo > hi` simply
  returns `[]` rather than throwing.
- `size` — read-only getter, the current number of stored keys.

Keys must be finite JS numbers (`typeof key === 'number' &&
Number.isFinite(key)`); `NaN`, `Infinity`, `-Infinity`, and any non-number
all throw `TypeError` from every key-accepting method (`set`, `get`, `has`,
`delete`, and both bounds of `range`). Values are unrestricted.

## Structure

Leaves hold the actual `(key, value)` pairs in ascending order and are
linked left-to-right via a `next` pointer, so `range()` walks the leaf
chain directly after one O(log n) descent to find the starting leaf,
rather than sorting or rescanning every stored entry. Internal nodes hold
only routing separator keys plus child pointers
(`children.length === keys.length + 1`); for an internal node with keys
`[k0, k1, ..., k_{m-1}]` and children `[c0, c1, ..., c_m]`:

```
c0            holds all keys <  k0
c_i (0<i<m)   holds all keys in [k_{i-1}, k_i)
c_m           holds all keys >= k_{m-1}
```

## Design choices not pinned down by the task spec

The task specifies the public method names and the four required
structural mechanisms (splitting, separator maintenance, linked leaves,
borrowing/merging/root-collapse on delete), but leaves several concrete
choices open. Each was made deliberately:

- **`minKeys = Math.floor(maxKeys / 2)`, not `Math.ceil`.** This is the
  only formula that guarantees BOTH halves of every split land at or above
  the minimum immediately, for every `maxKeys >= 2` including odd values.
  With `ceil`, an odd `maxKeys` (e.g. 3) can produce a post-split leaf with
  only 1 key while `minKeys` would demand 2 — an invariant violation the
  instant the split completes. Concretely: after removing the promoted
  separator, `maxKeys` keys remain to redistribute; splitting them as
  `leftCount = ceil(maxKeys/2)` and `rightCount = floor(maxKeys/2)` means
  `rightCount` is exactly `minKeys`, and `leftCount >= rightCount = minKeys`
  — both sides always clear the bar.
- **`maxKeys >= 2` is required, not `>= 1`.** At `maxKeys = 1`, an internal
  split would be forced to produce a right node with *zero* keys but one
  child — a degenerate internal node that (outside the root, where it
  would trigger collapse) has no consistent meaning. Requiring `maxKeys >=
  2` keeps every non-root node's key count in a sane range at all times.
- **`set()` returns `this`; `delete()` returns a boolean.** Chosen to
  mirror `Map`'s own API exactly, since the task explicitly frames this as
  "a deterministic ordered index" in the spirit of `Map` rather than a
  wrapper around one — callers already familiar with `Map` get the
  expected return-value conventions for free.
- **`range(lo, hi)` with `lo > hi` returns `[]` rather than throwing.** An
  empty query window is not a malformed input — both bounds are still
  individually valid finite numbers — so it is treated as a valid,
  simply-empty result rather than an error.
- **Borrow-before-merge, left-sibling-preferred.** On underflow, a node
  first tries to borrow a key from a sibling that has more than `minKeys`
  (checking left before right), and only merges if neither sibling can
  spare one. This ordering is an arbitrary but consistent tie-break — see
  the dedicated tests below proving both borrow directions and the merge
  path are all independently reachable and correctly implemented, not just
  the first one tried.
- **`TypeError` vs `RangeError`, one `RangeError` site.** Every
  wrong-*kind* input (`maxKeys` not an integer; any key not a finite
  number) throws `TypeError`. The only `RangeError` in the whole module is
  a well-typed-but-too-small `maxKeys` (`< 2`) in the constructor — there
  is no `RangeError` anywhere else, since every other operation (a missing
  key, an empty range window, `lo > hi`) is a normal, well-defined outcome
  rather than an error.

## Development notes: hand-deriving the deletion-mechanism test scenarios

Before writing the committed tests for borrowing (both directions), merging,
and root collapse, each exact scenario below was traced interactively
against the real implementation (dumping `tree._root`'s actual structure at
each step) rather than guessed, then pinned as a regression test asserting
the exact intermediate structure observed:

- **Borrow-from-left, then merge + root collapse** (`maxKeys = 4`): insert
  `1..5` → one leaf split → root `INTERNAL[4]` over `LEAF[1,2,3]` /
  `LEAF[4,5]`. Deleting `5` underflows the right leaf to `[4]`; its left
  sibling has 3 keys (`> minKeys=2`), so it borrows — root becomes
  `INTERNAL[3]` over `LEAF[1,2]` / `LEAF[3,4]`. Deleting `4` then
  underflows the right leaf to `[3]`; the left sibling is now at exactly
  `minKeys` and cannot lend, so the two leaves merge into `[1,2,3]`, which
  empties the root's only separator and collapses the root directly to
  that merged leaf (height drops from 2 to 1).
- **Borrow-from-right** (`maxKeys = 4`): insert `1..6` → root `INTERNAL[4]`
  over `LEAF[1,2,3]` / `LEAF[4,5,6]`. Deleting `1` then `2` underflows the
  *leftmost* leaf to `[3]`; being leftmost, it has no left sibling at all,
  so it must borrow from the right — root becomes `INTERNAL[5]` over
  `LEAF[3,4]` / `LEAF[5,6]`.
- **Internal-level (not just leaf-level) borrow and merge** (`maxKeys =
  3`, height 4 over keys `1..40`): deleting `37, 38, 39, 40, 35, 36` in
  that order was confirmed, by temporarily instrumenting
  `_borrowFromLeft`/`_mergeChildren` to log when the node being rebalanced
  is itself internal (not a leaf), to force one internal-level
  borrow-from-left (triggered by deleting `39`) and one internal-level
  merge (triggered by deleting `35`) — proving rebalancing genuinely
  propagates upward through more than one level, not just at the leaves.

## Testing

`bplus-tree.test.js` (committed, 24 tests) includes an independent
whitebox structural-invariant checker (walks `tree._root` directly,
verifying max/min key bounds per node, strict key ordering, correct
`children.length === keys.length + 1`, uniform leaf depth, and that the
linked-leaf chain visits every leaf exactly once in strictly ascending
order matching `tree.size` — all without ever calling `get`/`has`/`range`
on the tree under test, so it cannot be fooled by a bug that corrupts the
structure and those accessors identically), a structurally-independent
`SimpleOrderedMap` oracle (a plain sorted array, sharing no logic with the
tree) for a 400-operation-per-configuration randomized differential sweep
across 5 different `maxKeys` values, and the four hand-derived
deletion-mechanism scenarios described above. Covers: empty-tree behavior,
odd (3) and even (4) `maxKeys`, deep ascending and descending
insert/delete sweeps (1000 keys each), upsert/chaining semantics, range
boundary conditions (exact endpoints, `lo > hi`, out-of-range windows,
multi-leaf spans), negative/fractional keys and the `-0`/`0` collision,
full invalid-input coverage across every key-accepting method plus the
constructor's `TypeError`/`RangeError` split, and a full single-key-at-a-
time drain (in a shuffled, non-monotonic order) across three different
`maxKeys` values ending in an empty bare-leaf root.

An additional, uncommitted `stress-test.js` (not part of the submitted
evidence, run locally for extra confidence before committing) runs the
same differential-plus-structural approach far more widely: 8 different
`maxKeys` values (2 through 11) x 20 randomized trials x 300 operations
each, a wide-sparse-key-universe sweep (4000 keys per `maxKeys` across a
[-1,000,000, 1,000,000] range), ascending/descending 500-key build-and-
drain sweeps across 4 `maxKeys` values, and a fractional/negative/`-0`
sweep — **90,574 total checks, 0 mismatches**.

## Verification performed

- `node --test bplus-tree.test.js` run in this directory: all 24 tests
  passed, 0 failures. See `test-output.txt` for the full TAP output.
- The uncommitted `stress-test.js` was run manually (`node stress-test.js`)
  before committing and reported `STRESS TEST PASSED: 90574 total checks,
  0 mismatches`.
- No external dependencies: `bplus-tree.js` uses no `require` at all; the
  test file only requires Node's built-in `node:test` and `node:assert`.
