# palindromic-tree

Dependency-free, single-file, deterministic palindromic tree (Eertree)
(`PalindromicTree`) that incrementally tracks every distinct palindromic
substring of a Unicode code point sequence, in JavaScript, with an
automated `node:test` suite.

## Files

- `palindromic-tree.js` -- the implementation:
  `new PalindromicTree(text = '')` builds a tree pre-populated by
  appending every Unicode code point of `text`, in order. Instance API:
  `size` (getter, number of distinct non-empty palindromic substrings
  tracked -- mirrors `Set`/`Map`'s `.size` convention, not "length of
  text processed"), `append(symbol)` (chainable, appends exactly one
  more Unicode code point), `has(value)` (whether `value` is one of the
  tracked distinct palindromes), `longest()` (the longest tracked
  palindrome's entry, or `null` if none), `entries()` (a fresh array of
  every tracked palindrome as `{ value, length, occurrences,
  firstIndex }`, deterministically ordered).

  `append` requires a string containing *exactly one Unicode code
  point* -- not one UTF-16 code unit: a surrogate-pair character (most
  emoji, and every character outside the Basic Multilingual Plane) has
  `.length === 2` in JavaScript but is still exactly one code point and
  a valid `append` argument, while the empty string or a genuinely
  multi-code-point string is rejected with `TypeError`. `has` requires
  a string of any length (`TypeError` otherwise); the constructor
  requires `text` to be a string if provided (`TypeError` otherwise).
  `entries()` is ordered by `firstIndex` (the 0-based *code-point*
  index at which that palindrome's earliest occurrence starts)
  ascending, then `length` ascending, then `value` in true Unicode
  code-point lexical order (not JavaScript's default UTF-16 code-unit
  string ordering -- see Design notes). `longest()` breaks equal-length
  ties using that same ordering, minus the now-constant length key.

  Algorithm: a classic Eertree / palindromic tree (Rubinchik & Shur),
  built incrementally in amortized O(1) per appended code point using
  two fixed imaginary roots (length -1 and length 0), per-node suffix
  links to the longest proper palindromic suffix, and per-node
  character transitions. Appending one code point creates *at most one*
  new distinct palindrome (the central Eertree theorem), found by
  walking suffix links from the current longest palindromic suffix.
  Overlapping occurrence counts are computed by cascading each node's
  raw "was I the longest suffix here" hit count down its suffix link,
  processed in decreasing length order, since every occurrence of a
  longer palindrome is automatically also an occurrence of each of its
  own palindromic suffixes at the same end position.

- `palindromic-tree.test.js` -- 27 `node:test` cases (no external
  dependencies), organized by the categories the task's own spec calls
  out:
  - **Empty input**: a fresh tree and one built from `''` both have
    size 0, empty `entries()`, `longest() === null`, and `has()`
    always `false` (including `has('')`, since the empty string is
    never itself a tracked entry).
  - **Odd and even palindromes**: `"aba"` and `"aa"` checked against
    exact, hand-traced expected `entries()`/`size`/`longest()`/`has()`
    values (traced step by step against the textbook Eertree
    construction before being hardcoded here), plus `"abba"` cross-
    checked against the brute-force oracle.
  - **Repeats and overlaps**: `"aaaa"`'s exact overlapping-occurrence
    counts hardcoded by hand; `"aaabaaa"` cross-checked against the
    oracle; a 200-character run of a single character stress-testing
    the suffix-link chain and occurrence cascade, with every one of its
    200 distinct-length entries checked programmatically.
  - **Incremental appends**: chainability (`append` returns `this`);
    building via `new PalindromicTree('aba')` vs. three chained
    `.append()` calls produces identical results; every prefix of a
    25-character random string built one `append()` at a time matches
    an independently-constructed tree for that exact prefix.
  - **Unicode**: an astral (surrogate-pair) code point is accepted as
    exactly one code point despite `.length === 2`; a 3-code-point
    palindrome built from two different astral characters is tracked
    correctly with a code-point-unit (not UTF-16-unit) `firstIndex`;
    a U+FFFF vs. U+10000 case demonstrating both round-trip correctly
    as distinct single-code-point entries regardless of UTF-16 encoding
    width.
  - **Invalid inputs**: a full `TypeError` sweep for the constructor
    (non-string `text`), `append` (non-string, empty string, and
    multi-code-point-string rejections, including a two-astral-
    character string that "looks short"), and `has` (non-string
    value); plus a check that a failed `append` call leaves the tree's
    state completely unchanged.
  - **Deterministic ordering**: a direct, general assertion that every
    consecutive pair in `entries()` satisfies the documented
    `(firstIndex, length, code-point-lexical-value)` ordering for a
    non-trivial string; that repeated `entries()` calls on an unchanged
    tree return equal but freshly-allocated arrays/objects (never
    shared references); and that building the same text two different
    ways (`new PalindromicTree(text)` vs. character-by-character
    `append`) produces identical `entries()`.
  - **Fixed exhaustive strings checked against a brute-force oracle**:
    every string of length <= 8 over `{a,b}` (511 strings) and every
    string of length <= 6 over `{a,b,c}` (1092 strings) -- truly
    exhaustive, not sampled -- each checked against an independent
    `bruteForceEntries` oracle (an O(n^3) naive palindromic-substring
    scan over the raw text, sharing no code with the Eertree
    implementation) for exact `entries()`, `size`, and `longest()`
    agreement.
  - Two further seeded-PRNG (mulberry32, fixed seeds) differential
    suites against the same oracle: general random strings across
    several alphabet sizes (60 trials, lengths up to 40), and random
    strings mixing astral and BMP Unicode code points (30 trials).

- `test-output.txt` -- raw, unedited output of the exact run command
  below.

## Additional verification (not part of the committed suite)

Beyond the committed suite: a larger, uncommitted differential/
exhaustive stress run before any test was written --

- **4,311 truly exhaustive strings** checked against the brute-force
  oracle: every string over a 1-letter alphabet up to length 10, every
  string over `{a,b}` up to length 9, and every string over `{a,b,c}`
  up to length 7 -- for each, exact `entries()`, `size`, `longest()`,
  and `has()` agreement (including confirming every oracle-reported
  entry value returns `has() === true`).
- **300 random-string differential trials** across five different
  alphabets (including skewed alphabets like `"aaab"` that bias toward
  long runs) and lengths up to 60.
- **60 incremental-append equivalence trials**: for each of 60 random
  25-40 character strings, every single prefix (not just the final
  string) was checked to match an independently-constructed tree for
  that exact prefix -- confirming the incremental algorithm's state is
  correct at every intermediate step, not just at the end.
- **100 Unicode differential trials** mixing four different astral
  characters with three BMP characters, plus an explicit check that
  every entry's `firstIndex`/`length` stay within the text's
  *code-point* length bounds (as opposed to its UTF-16 code-unit
  length, which is larger whenever astral characters are present).
- A dedicated repeats/overlaps suite: long single-character runs,
  periodic patterns (`"ab"`/`"aab"`/`"abc"` repeated many times), and a
  50/50 split of two different run characters.

**0 mismatches across all of it** -- the implementation was correct
against every one of these independent oracles on the very first run
(after fixing an unrelated JSON-key-ordering false alarm in the stress
harness itself, not in `PalindromicTree` -- see Design notes), making
this the fifth task in this collection in a row with no genuine
implementation bug found during stress testing, after the KD-Tree,
Robin Hood Hash Map, and ROBDD tasks (see those tasks' own READMEs).

## Exact run command

```
node --test palindromic-tree.test.js
```

Requires only the Node.js runtime (tested on Node v22.22.2) -- no
`npm install`, no native build, no service to start. Run from inside
this directory, from a clean checkout. The full suite (27 tests,
including two exhaustive-string suites covering over 1,600 strings and
two differential suites) completes in well under a second.

## Design notes

- **`entries()`/`longest()` use true Unicode code-point lexical
  ordering, never JavaScript's default string comparison.**
  JavaScript's `<`/`>` on strings compares UTF-16 *code units*, which
  disagrees with true code-point-value order for characters in the
  U+E000-U+FFFF range versus supplementary-plane characters (U+10000
  and above, encoded as surrogate pairs) -- exactly the class of
  encoding-vs-value mismatch this collection has hit real bugs from
  before (e.g. the Van Emde Boas task's `universeSize`). `entries()`
  instead compares code point *values* one at a time via
  `codePointAt(0)`, which is correct regardless of encoding width. A
  dedicated test (`entries() orders by Unicode code-point value, not
  UTF-16 code-unit order`) exercises this explicitly with a U+FFFF vs.
  U+10000 pair.
- **`firstIndex` is a *code-point* index, not a UTF-16 code-unit
  index.** Since the whole data structure is defined in terms of "the
  n-th Unicode code point appended," every position concept
  (`firstIndex`, and the internal `pos`/`testIndex` values used during
  construction) is consistently counted in code points throughout --
  never `string.length` or any other UTF-16-unit-based measurement,
  which would silently misalign as soon as any astral character
  appeared in the input.
- **`size` means "number of distinct palindromes," not "number of code
  points processed."** The task's own API list groups `size`/`has`/
  `entries` together, which reads as an intentional echo of the
  built-in `Set`/`Map` interface -- so `size` here follows that same
  convention (count of *entries*, i.e. distinct tracked palindromes)
  rather than, say, the total length of `text` appended so far
  (which would be a different, and differently-named, concept).
- **The empty string is never a tracked entry.** Eertree's own
  algorithmic scaffolding includes a "length 0" imaginary root
  representing the empty palindrome, but it exists purely as an
  internal suffix-link target for length-1 palindromes -- it's
  intentionally excluded from `entries()`/`size`/`has()`, since the
  empty string is a degenerate case that isn't a meaningful "palindromic
  substring" a caller would expect to query for. `has('')` is always
  `false`, by design, not by omission.
- **Occurrence counts are recomputed fresh on every `entries()`/
  `longest()` call, from each node's untouched raw hit count**, rather
  of being incrementally maintained and cached. This trades a bit of
  per-query CPU time (an O(size log size) sort-and-cascade pass) for a
  simpler, more obviously correct implementation with no risk of a
  stale cache after further `append` calls -- construction itself,
  which is the operation the task asks to be linear-time, is
  unaffected, since this cascade only runs when a query method is
  actually called.
- One development-time false alarm is worth recording precisely because
  it *wasn't* a `PalindromicTree` bug: the first run of the uncommitted
  stress harness reported hundreds of "mismatches" that were actually
  the harness comparing `JSON.stringify()` output between two
  differently-key-ordered-but-equal-valued object literals (the
  brute-force oracle happened to build its objects with a different
  property insertion order than `PalindromicTree` does). Switching the
  harness to a proper field-by-field equality check immediately
  resolved every one of them with zero changes to `palindromic-tree.js`
  itself -- a reminder that a differential test's *comparator* needs
  its own scrutiny, not just its oracle.
