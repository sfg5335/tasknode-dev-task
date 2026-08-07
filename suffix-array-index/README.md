# suffix-array-index

Dependency-free, single-file, deterministic suffix array index in
JavaScript, built via prefix doubling with Kasai's LCP construction, with
an automated `node:test` suite.

## Files

- `suffix-array-index.js` -- the implementation (`SuffixArrayIndex`
  class), constructed from a string: `suffixArray()`, `lcpArray()`, and
  `search(pattern)`. The suffix array (the permutation of
  `0 .. text.length-1` sorted ascending by suffix content) is built by
  prefix doubling (`buildSuffixArray`): each round doubles the comparison
  length by ranking every suffix on the pair `(rank[i], rank[i+k])`,
  refreshing ranks after each `Array.prototype.sort`, and exiting early
  once every rank is already distinct. The adjacent LCP array is then
  built in one linear pass via Kasai's algorithm (`buildLcpArray`),
  using the standard "h never decreases by more than 1 between
  consecutive text positions" trick; `lcp[0] = 0` by convention, since the
  first suffix in sorted order has no predecessor to compare against.
  `search(pattern)` finds the contiguous block of the suffix array whose
  suffixes start with `pattern` via two binary searches (`lowerBoundSA`/
  `upperBoundSA`, comparing each candidate suffix truncated to
  `pattern.length` code units against `pattern` using JS's native
  `<`/`<=` string comparison, which is already UTF-16-code-unit
  lexicographic -- no `localeCompare` anywhere), then returns the start
  offsets of that block sorted back into ascending numeric order (a
  suffix-array sub-range is sorted by *content*, not by original
  position, so this final re-sort is required to satisfy the spec's
  "ascending numeric order" requirement). The empty pattern is
  special-cased to return every boundary `0` through `text.length`
  inclusive (`n+1` positions), per spec -- distinct from
  `suffixArray()`/`lcpArray()`, which only ever concern non-empty
  suffixes. `suffixArray()`/`lcpArray()` always return fresh copies, never
  the live internal arrays, so callers can't mutate index state.
  Non-string arguments to the constructor or to `search` throw
  `TypeError`.
- `suffix-array-index.test.js` -- 15 `node:test` cases (no external
  dependencies): empty text (including the empty-pattern-on-empty-text
  boundary case, `search('') === [0]`); single-character text; repeated
  characters (`'aaaa'`, checked against the hand-derived suffix array and
  LCP array); overlapping matches (`'aaaaa'.search('aa')`,
  `'abababab'`'s overlapping `'aba'`/`'bab'` occurrences); absent
  patterns; a full-string match plus a pattern longer than the text;
  whitespace handling (single space, double space, tab); BMP Unicode
  handling (accented Latin and CJK characters, cross-checked against a
  brute-force reference); an explicit astral-character (surrogate-pair)
  test proving UTF-16-code-unit semantics -- the lone leading surrogate
  half of an emoji is independently matchable, cross-checked against
  brute-force too; a full `TypeError` sweep for both the constructor and
  `search` (across eight distinct bad types, including `Symbol`);
  repeated-call determinism; non-mutation and non-retention of returned
  arrays (mutating a returned `suffixArray()`/`lcpArray()`/`search()`
  result never affects the index's own state); a fixed deterministic
  comparison suite cross-checking 15 hand-picked strings (empty,
  single-char, repetitive, `'banana'`, `'mississippi'`, a sentence with
  spaces, etc.) against brute-force references for `suffixArray()`,
  `lcpArray()`, and `search()` across 12 patterns each; and a 60-trial
  fixed-seed randomized comparison suite against the same brute-force
  references, covering strings up to length 25 over three different
  alphabet sizes, with each trial exercising 6 random patterns (roughly
  evenly split between real substrings and arbitrary strings).
- `test-output.txt` -- raw, unedited output of the exact run command
  below.

## Additional verification (not part of the committed suite)

Beyond the committed test file, an uncommitted 5,000-trial randomized
stress run (fixed seed, strings up to length 80, five alphabet sizes from
1 to 26 distinct characters, 8 random patterns per trial) cross-checked
`suffixArray()`, `lcpArray()`, and `search()` against the same brute-force
references -- 50,000 individual checks, zero mismatches.

## Exact run command

```
node --test suffix-array-index.test.js
```

Requires only the Node.js runtime (tested on Node v22.22.2) -- no
`npm install`, no native build, no service to start. Run from inside this
directory, from a clean checkout.

## Design notes

- `search('')` (the empty pattern) matches every boundary from `0`
  through `text.length` inclusive, i.e. `n + 1` positions -- an explicit
  spec requirement, and a different convention from `suffixArray()`/
  `lcpArray()`, which are only ever defined over the `n` non-empty
  suffixes.
- Comparisons use plain JavaScript string relational operators
  (`<`/`<=`) throughout, which compare strings by UTF-16 code unit value
  -- never `localeCompare`, so ordering is locale-independent and
  astral characters (surrogate pairs) are compared as their constituent
  16-bit code units, exactly like the rest of the language does by
  default.
