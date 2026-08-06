# aho-corasick

Dependency-free, single-file Aho-Corasick multi-pattern string matcher in JavaScript, with an automated `node:test` suite.

## Files

- `ahoCorasick.js` -- the implementation (`AhoCorasick` class): constructor accepts an array of unique, non-empty string patterns and builds a trie, BFS-computed failure links, and propagated output links. `search(text)` returns every `{ pattern, start, end }` match (end-exclusive indices), including overlapping and suffix matches, ordered by start index and then by original pattern-array order.
- `ahoCorasick.test.js` -- 17 `node:test` cases (no external dependencies), including a deterministic cross-check against an independent brute-force reference implementation.
- `test-output.txt` -- raw, unedited output of the exact run command below.

## Exact run command

```
node --test ahoCorasick.test.js
```

Requires only the Node.js runtime (tested on Node v22.22.2) -- no `npm install`, no native build, no service to start. Run from inside this directory, from a clean checkout.
