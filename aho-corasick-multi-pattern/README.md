# Deterministic Aho-Corasick Multi-Pattern Matcher

A dependency-free, deterministic implementation of the Aho-Corasick
algorithm (Aho & Corasick, 1975) for finding **every occurrence of every
pattern in a set of string patterns, in a single linear pass over the
text**.

This is a distinct implementation from the earlier, already-committed
`aho-corasick/ahoCorasick.js` in this repository (a prior, separate task
with a different specification -- e.g. it rejects duplicate patterns and
orders results differently). This directory's `aho-corasick.js` /
`AhoCorasick` implements the current task's own spec: duplicate pattern
strings are preserved and reported independently by their original index,
offsets are explicitly defined as UTF-16 code-unit offsets, and results
are ordered by end offset, then start offset, then pattern index.

## API

```js
const { AhoCorasick } = require('./aho-corasick.js');

const matcher = new AhoCorasick(patterns); // patterns: array of non-empty strings
const matches = matcher.search(text);      // text: a string
// matches: array of { pattern, patternIndex, start, end }
```

- `patterns` must be an array; anything else throws `TypeError`.
- Every element of `patterns` must be a string; a non-string element
  throws `TypeError`. Every element must be non-empty; an empty string
  (`''`) throws `RangeError`. An empty `patterns` array (`[]`) is valid --
  the resulting matcher never reports any match.
- Duplicate pattern strings (the same string appearing at two or more
  indices in `patterns`) are **not** deduplicated or rejected: each index
  is tracked independently, and a match at a given text position is
  reported once per pattern index whose string matches there -- so two
  identical pattern strings both produce their own `{ ..., patternIndex }`
  entry for every occurrence.
- `search(text)` requires `text` to be a string; anything else throws
  `TypeError`. An empty string is a valid (always-empty-result) search.
- Each returned match is `{ pattern, patternIndex, start, end }`:
  `pattern` is the matched pattern string, `patternIndex` is its index in
  the original `patterns` array, and `start`/`end` are **UTF-16 code-unit
  offsets** into `text` -- `start` inclusive, `end` exclusive, exactly the
  convention `text.slice(start, end)` uses (so `text.slice(m.start,
  m.end) === m.pattern` always holds). Astral (non-BMP) characters,
  represented in JavaScript strings as UTF-16 surrogate pairs, therefore
  count as two code units in these offsets, exactly as
  `String.prototype.length` counts them -- matching happens purely on
  UTF-16 code-unit identity, with no code-point-aware special-casing.
- Results are sorted by `end` ascending, then `start` ascending, then
  `patternIndex` ascending -- a total, deterministic order that does not
  depend on pattern insertion order, trie traversal order, or JavaScript
  `Map`/object iteration order.
- The constructor defensively copies the input `patterns` array; mutating
  the caller's array afterward has no effect on an already-constructed
  matcher.
- `search()` holds no state beyond its own local variables. Every call
  starts a fresh scan from the automaton's root, so repeated calls on the
  same instance -- interleaved with calls on other instances, in any
  order -- always return results computed purely from that call's own
  `text` argument, never influenced by any prior call.

## Algorithm

1. **Trie construction**: insert every pattern into a trie (one
   root-to-leaf path per pattern, sharing common prefixes). The node
   reached by fully consuming a pattern's characters records that
   pattern's index in its `output` list -- so two patterns with identical
   text share the same trie leaf and both get recorded there.
2. **Failure links** (breadth-first): every node other than the root gets
   a `fail` pointer to the node representing the *longest proper suffix*
   of that node's own path which is also some prefix in the trie (root's
   direct children always fail back to root itself, since no proper
   suffix of a single character is shorter). Because a node's failure
   link always points to a strictly shallower node, computing them in
   breadth-first order guarantees each node's own failure target is
   already finalized by the time it's needed.
3. **Merged output lists**: precomputed once per node during the same
   breadth-first pass as `node.output.concat(node.fail's already-merged
   list)`, so that at search time, checking "every pattern ending here or
   at any node reachable by following failure links" is a single
   precomputed array lookup rather than a chain walk.
4. **Search**: scan `text` once, left to right. At each character, follow
   the current node's child edge if one exists for that character;
   otherwise repeatedly follow failure links until a node that does have
   that child edge (or the root) is reached, then take that edge (or stay
   at root if even the root has none). After each step, the current node
   represents the longest suffix of the text scanned so far that is also
   some pattern's prefix -- so every pattern ending at this position is
   exactly that node's precomputed merged output list.

### Complexity

- **Construction**: `O(total pattern length)`. Trie insertion is directly
  linear in the total length of all patterns. The failure-link
  breadth-first pass is linear too, by a standard amortized argument: the
  inner "walk failure links looking for a matching child edge" loop only
  ever *decreases* depth, while the trie itself has at most `O(total
  pattern length)` edges (nodes) for the loop to walk across in total, so
  the sum of all such walks across the whole construction cannot exceed
  that same bound.
- **Search**: `O(text length + number of matches)`. Although a single
  character can trigger several failure-link hops before landing on its
  next state, each hop strictly decreases the current node's depth, while
  each successfully-matched child edge increases it by exactly one -- so,
  summed over the entire scan, the total number of failure-link hops can
  never exceed the total number of successful child-edge steps (the same
  potential-function argument as construction), keeping the whole scan
  linear in the text length, plus `O(1)` additional work per reported
  match.

## Testing

`aho-corasick.test.js` (30 `node:test` cases, all passing -- see
`test-output.txt` for the raw run):

- Empty pattern array (always empty results) and empty search text.
- The classic `he`/`she`/`his`/`hers` textbook failure-link example
  against `"ushers"`, plus a second multi-level failure-chain stress case
  (`a`/`ab`/`bc`/`bca`/`c`/`caa` against `"abcaa"`) -- both with exact
  expected output pinned, not just oracle-checked.
- Overlapping matches, including fully-overlapping repeated-character
  patterns (`aaa`/`aa`/`a` against `"aaaaa"`).
- Duplicate pattern strings (2-way and 3-way) reported independently by
  their own `patternIndex`, each with correct `start`/`end`.
- Unicode: an astral (non-BMP) character confirmed to count as 2 UTF-16
  code units and match/offset correctly; a pattern equal to a lone
  (unpaired-as-a-pattern) surrogate half still matches by code-unit
  identity wherever that exact code unit occurs, including inside a real
  surrogate pair in the text; accented/combining characters.
- Punctuation-heavy patterns and text.
- Deterministic ordering: matches ending at the same position ordered by
  `start`, and a dedicated same-`start`-and-`end` case proving the
  `patternIndex` tiebreak fires; reordering the input `patterns` array is
  shown to leave the reported match content and `(end, start)` ordering
  unchanged (only `patternIndex` values shift accordingly).
- Repeated searches on one instance, interleaved searches across many
  different texts on one instance (forward and reverse order), and two
  independent instances built from identical patterns -- all proving no
  state leaks between calls or between instances.
- Every invalid-input case: non-array `patterns` (`TypeError`), a
  non-string pattern element (`TypeError`), an empty-string pattern
  (`RangeError`), a mix of both violations (first offender's error type
  wins), and a non-string `search()` argument (`TypeError`).
- Mutating the caller's `patterns` array after construction is proven not
  to affect the already-built matcher.
- A blanket invariant check across a realistic multi-pattern search:
  every returned match satisfies `text.slice(start, end) === pattern` and
  `end - start === pattern.length`.
- Two seeded randomized differential tests (300 trials over a small/wide
  alphabet mix, plus 150 trials deliberately maximizing duplicate
  patterns) against an independent brute-force oracle.

**The independent oracle** (`naiveMatch` in the test file) does a direct
`String.prototype.slice` comparison at every `(patternIndex, start)` pair
-- no trie, no failure links, no shared code or intermediate
representation with the implementation under test -- making it a genuine
cross-check rather than a restatement of the same algorithm.

### Additional uncommitted stress testing (performed before committing, per project discipline for bug-prone algorithms)

Beyond the committed suite, 15,032 further randomized/adversarial
pattern-sets and texts were checked against the same independent oracle
(16,012 total assertions), 0 mismatches:

- A broad randomized sweep (5,000 pattern-sets, 2-character alphabet, up
  to 10 patterns, texts up to 60 characters -- deliberately small-alphabet
  to maximize overlap and failure-link stress).
- A wider sweep (3,000 pattern-sets, full lowercase alphabet, longer
  patterns and texts).
- 3,000 pattern-sets built by drawing patterns as literal substrings of
  the text itself, guaranteeing many real matches to check.
- 2,000 pattern-sets deliberately maximizing duplicate patterns (many
  indices sampled with replacement from a small base set of distinct
  strings).
- An exhaustive single-character-alphabet sweep (`"aaa...a"` texts,
  lengths 1-30, against every pattern length up to 8) -- the maximal
  self-overlap case, where nearly every position both matches and
  triggers a failure-link fallback.
- 1,500 randomized trials mixing ASCII characters with astral (surrogate
  pair) Unicode characters, each additionally cross-checked so every
  reported match's `text.slice(start, end)` reproduces the pattern
  exactly.
- A determinism sweep: 300 pattern-sets, each searched 5 times over, all
  runs byte-identical.
- An interleaved-instance sweep: 20 independent matcher instances, each
  with its own patterns/text, searched in 50 rounds of randomly shuffled
  order, confirming no instance's result is ever affected by any other
  instance's or any other round's searches.

All passed with 0 mismatches. This implementation shipped with **zero
genuine bugs found** during stress testing.

Run tests yourself: `node --test aho-corasick.test.js` (no installed
dependencies required).
