# suffix-automaton

Dependency-free, single-file deterministic suffix automaton (SAM) in
JavaScript, operating over a fixed input string's UTF-16 code units, with
an automated `node:test` suite.

## Files

- `suffix-automaton.js` -- the implementation (`SuffixAutomaton` class),
  constructed from a string: `has(pattern)`, `occurrences(pattern)`,
  `countDistinctSubstrings()`, and `longestCommonSubstring(other)`. Built
  on the standard online suffix-automaton "extend" construction
  (`_build`, O(n) states and transitions): `has`/`occurrences` walk
  transitions from the root in O(|pattern|); `occurrences` is backed by a
  one-time O(n) endpos-set-size propagation up the suffix-link tree after
  construction (`_computeEndposCounts`, seeding non-cloned states at
  `cnt=1` and cloned states at `0`, then adding each state's `cnt` into
  its link's, visited in order of strictly decreasing `len`); the empty
  pattern is special-cased to `text.length + 1` occurrences per spec
  rather than whatever the root state's own bookkeeping would produce.
  `countDistinctSubstrings()` is precomputed once at construction via the
  standard `sum(len[state] - len[link[state]])` identity over every
  non-root state (`_computeDistinctSubstringCount`), which naturally
  excludes the empty substring since the root itself is excluded from the
  sum. `longestCommonSubstring(other)` runs the classic single-pass
  automaton-walk-with-suffix-link-fallback algorithm over `other` in
  O(|other|), tracking the best match by strict length improvement only
  (so ties are broken by earliest starting position in `other`
  automatically, with no extra bookkeeping needed). Every method operates
  on plain JavaScript string indexing (`str.length`/`str[i]`/`str.slice`),
  i.e. UTF-16 code units, not Unicode code points -- an astral character
  (a surrogate pair) is treated as two separate units, exactly like the
  rest of the language already does by default. The constructor and every
  method validate their string arguments and throw `TypeError` otherwise.
- `suffix-automaton.test.js` -- 13 `node:test` cases (no external
  dependencies): the empty-text case (including that `has('')` is always
  `true` and `occurrences('')` on an empty text is `1`, not `0`);
  non-empty text against an empty `other`; the single-character case;
  a unique-character text (every substring occurs exactly once, and the
  count of 28 distinct substrings for a 7-unique-character string is
  checked against the closed-form `7+6+5+4+3+2+1`); repeated and
  overlapping occurrences (`'aaaa'.occurrences('aa') === 3`, `'banana'`'s
  overlapping `'ana'` occurrences, etc.); absent-pattern cases; Unicode
  handling (an explicit surrogate-pair test proving UTF-16-code-unit
  semantics -- the lone leading surrogate half is treated as its own
  matchable unit, cross-checked against the brute-force reference too);
  the `longestCommonSubstring` tie-break rule (two length-3 candidates
  tied for longest, proven to resolve to whichever starts earlier in
  `other`, checked in both orderings); basic `longestCommonSubstring`
  correctness beyond the tie-break case; a full `TypeError` sweep for the
  constructor and for every method's argument (across seven distinct bad
  types, including `Symbol`); repeated-call determinism; and a fixed
  deterministic comparison suite that cross-checks 15 hand-picked short
  strings (empty, single-char, repetitive, palindromic-ish, `'banana'`,
  `'mississippi'`, etc.) against brute-force references for every one of
  `has`/`occurrences`/`countDistinctSubstrings`, plus the full 15x15 cross
  product of `longestCommonSubstring` calls between every pair of those
  strings.
- `test-output.txt` -- raw, unedited output of the exact run command below.

## Additional verification (not part of the committed suite)

Beyond the committed test file, the implementation was cross-checked
against the same brute-force references across two randomized stress
runs (fixed seeds): 3,000 trials over a deliberately tiny 2-letter
alphabet (maximizing hash/substring collision pressure) with random text
and pattern lengths, and 500 further trials over a wider 10-letter
alphabet with longer strings (up to length 60). 24,000 total checks
across `has`, `occurrences`, `countDistinctSubstrings`, and
`longestCommonSubstring`; zero mismatches.

## Exact run command

```
node --test suffix-automaton.test.js
```

Requires only the Node.js runtime (tested on Node v22.22.2) -- no
`npm install`, no native build, no service to start. Run from inside this
directory, from a clean checkout.
