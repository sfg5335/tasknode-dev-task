# lfu-cache

Dependency-free, single-file Least-Frequently-Used (LFU) cache in JavaScript, with an automated `node:test` suite.

## Files

- `lfu-cache.js` -- the implementation (`LFUCache` class): O(1) average-case `get(key)`/`put(key, value)`, a `size` getter, eviction of the least-frequently-used entry when full, with ties among equally-frequent entries broken by least-recent use.
- `lfu-cache.test.js` -- 13 `node:test` cases (no external dependencies).
- `test-output.txt` -- raw, unedited output of the exact run command below.

## Exact run command

```
node --test lfu-cache.test.js
```

Requires only the Node.js runtime (tested on Node v22.22.2) -- no `npm install`, no native build, no service to start. Run from inside this directory.
