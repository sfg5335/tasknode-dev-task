# btree-map

Dependency-free, single-file deterministic 2-3-4 B-tree map (minimum degree
t = 2) for finite numeric keys in JavaScript, with an automated `node:test`
suite.

## Files

- `btree-map.js` -- the implementation (`BTreeMap` class): `set(key, value)`,
  `get(key)`, `has(key)`, `delete(key)`, `entries()`, and a `size` getter.
  Implements the standard single-pass top-down CLRS B-tree algorithms:
  insertion proactively splits any full node it is about to descend into
  (so a parent never needs to split a full child mid-recursion), and
  deletion proactively borrows a key from a sibling or merges with one
  before descending (so every node it recurses into already has at least
  `t` keys), including root splitting and root contraction. Keys are
  compared with plain `<`/`>`/`===`, so `-0` and `0` compare as the same
  key -- the same semantics `===` and `Map`'s own SameValueZero key
  equality already have, with no special-casing needed. `set`/`get`/
  `has`/`delete` all reject non-finite or non-numeric keys with
  `TypeError`. `entries()` returns every `[key, value]` pair in ascending
  numeric order.
- `btree-map.test.js` -- 15 `node:test` cases (no external dependencies),
  including an internal structural-invariant checker (non-root key-count
  bounds, children-count-equals-keys-plus-one, strict per-node key
  ordering consistent with inherited parent bounds, uniform leaf depth,
  and an independently-counted size) run after nearly every mutating
  test; explicit, structurally-asserted (not just behaviorally-asserted)
  coverage of a root split, a right-sibling borrow, a left-sibling borrow,
  a sibling merge, a merge that triggers root contraction, and an
  internal-node deletion via predecessor replacement -- each traced
  against the real implementation before being committed, not
  hand-derived; overwrites; negative and fractional keys; the `-0`/`0`
  key-identity case; `TypeError` rejection for every method; repeated
  deletion of an already-deleted key; and a 4000-operation fixed-seed
  differential cross-check against a plain `Map` reference model (whose
  own SameValueZero key semantics already match this task's `-0`/`0`
  requirement, so no special-casing was needed in the reference model
  either).
- `test-output.txt` -- raw, unedited output of the exact run command below.

## Exact run command

```
node --test btree-map.test.js
```

Requires only the Node.js runtime (tested on Node v22.22.2) -- no
`npm install`, no native build, no service to start. Run from inside this
directory, from a clean checkout.
