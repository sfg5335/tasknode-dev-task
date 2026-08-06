# rollback-disjoint-set

Dependency-free, single-file disjoint-set union (union-find) in JavaScript with snapshot/rollback support, and an automated `node:test` suite.

## Files

- `rollback-disjoint-set.js` -- the implementation (`RollbackDisjointSet` class): `find`, `union`, `connected`, `componentSize`, a `componentCount` getter, `snapshot`, and `rollback`. Union by size (no path compression, by design -- see the file's JSDoc for why), first-root-wins on exact size ties.
- `rollback-disjoint-set.test.js` -- 14 `node:test` cases (no external dependencies).
- `test-output.txt` -- raw, unedited output of the exact run command below.

## Exact run command

```
node --test rollback-disjoint-set.test.js
```

Requires only the Node.js runtime (tested on Node v22.22.2) -- no `npm install`, no native build, no service to start. Run from inside this directory, from a clean checkout.
