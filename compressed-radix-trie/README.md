# compressed-radix-trie

Dependency-free, single-file compressed radix trie (a.k.a. PATRICIA trie /
radix tree) for string keys in JavaScript, with an automated `node:test`
suite.

## Files

- `compressed-radix-trie.js` -- the implementation (`CompressedRadixTrie`
  class): `set(key, value)`, `get(key)`, `has(key)`, `delete(key)`,
  `entriesWithPrefix(prefix)`, `longestPrefixOf(str)`, and a `size` getter.
  Every internal node other than the root either has zero children, two or
  more children, or exactly one child while itself marking the end of a
  key -- there is never a chain of single-child, non-end nodes. Inserts
  split edges as needed (`set`); deletes re-merge them (`delete`), so this
  invariant holds after every mutation, not just at construction. Keys are
  plain JS strings compared/sliced as UTF-16 code units, so Unicode keys
  (including surrogate-pair characters such as emoji) and the empty string
  `''` are all valid keys. `entriesWithPrefix` returns `[key, value]` pairs
  sorted in JavaScript lexicographic order (the same order `<` /
  `Array.prototype.sort()` with no comparator would give); `longestPrefixOf`
  returns the longest stored key that is a prefix of its argument, or
  `null`. All six public methods reject non-string arguments with
  `TypeError`.
- `compressed-radix-trie.test.js` -- 20 `node:test` cases (no external
  dependencies), including an internal structural-invariant checker (no
  uncompressed nodes, `children` Map keys match edge first characters,
  `size` matches an independent end-node count) run after nearly every
  mutating test, explicit coverage of empty state, overwrites, edge
  splitting on shared prefixes, branching, the empty-string key, Unicode
  keys (including a surrogate-pair emoji sharing a compressed prefix edge
  with another emoji-prefixed key), leaf and internal-node deletion with
  edge re-merging, lexicographic prefix-ordering, `TypeError` rejection for
  every method, and a 3000-operation fixed-seed cross-check against a plain
  `Map` reference model (with `entriesWithPrefix`/`longestPrefixOf`
  re-derived independently from the `Map`'s own keys each time, not from
  the trie).
- `test-output.txt` -- raw, unedited output of the exact run command below.

## Exact run command

```
node --test compressed-radix-trie.test.js
```

Requires only the Node.js runtime (tested on Node v22.22.2) -- no
`npm install`, no native build, no service to start. Run from inside this
directory, from a clean checkout.
