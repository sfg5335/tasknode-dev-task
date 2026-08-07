# myers-diff

Dependency-free, single-file ES module implementation of Myers' shortest-edit-script diff algorithm for two arrays, with an automated `node:test` suite.

## Files

- `myers-diff.mjs` -- exports `myersDiff(before, after)`, returning an array of `{ type: 'equal' | 'delete' | 'insert', value }` records. Element equality uses `Object.is` (so `NaN` matches `NaN`, and `+0`/`-0` do *not* match each other). Neither input array is mutated. When multiple minimal-length edit scripts exist, the algorithm deterministically prefers `delete` over `insert` at the tie point.
- `myers-diff.test.mjs` -- 20 `node:test` cases: empty/identical arrays, pure insertion/deletion, mid-array insertion/deletion, replacement, disjoint arrays, repeated values (both directions), `NaN` equality, signed-zero inequality, deterministic tie-breaking (including a hand-traced case and a repeated-call stability check), input-immutability, a longer mixed round-trip case, and a 200-trial seeded-PRNG bounded cross-check against an independent O(n·m) dynamic-programming edit-count oracle.
- `test-output.txt` -- raw, unedited output of the exact run command below.

## Exact run command

```
node --test myers-diff.test.mjs
```

Requires only the Node.js runtime (tested on Node v22.22.2) -- no `npm install`, no native build, no service to start. Run from inside this directory, from a clean checkout.
