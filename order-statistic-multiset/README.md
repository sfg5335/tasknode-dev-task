# order-statistic-multiset

Dependency-free, single-file AVL-balanced order-statistic multiset of finite numbers in JavaScript, with an automated `node:test` suite.

## Files

- `order-statistic-multiset.js` -- the implementation (`OrderStatisticMultiset` class): `add(value)`, `delete(value)`, `count(value)`, `rank(value)`, `select(index)`, and a `size` getter. Each distinct value gets one AVL tree node carrying a duplicate count, plus per-node height and subtree-size bookkeeping so `rank`/`select` run in O(log n).
- `order-statistic-multiset.test.js` -- 12 `node:test` cases (no external dependencies), including internal AVL-invariant checks (BST ordering, height balance, height/size bookkeeping) and a deterministic cross-check against an independent sorted-array reference implementation.
- `test-output.txt` -- raw, unedited output of the exact run command below.

## Exact run command

```
node --test order-statistic-multiset.test.js
```

Requires only the Node.js runtime (tested on Node v22.22.2) -- no `npm install`, no native build, no service to start. Run from inside this directory, from a clean checkout.
