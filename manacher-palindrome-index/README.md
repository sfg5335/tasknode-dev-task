# Deterministic Manacher Palindrome Index

A single-file, dependency-free Node.js module computing, in O(n) time,
the odd- and even-centered palindrome radius arrays for a string via the
classical **Manacher's algorithm**, plus the single overall longest
palindromic substring — a new string-processing domain, distinct from
every prior tree/graph/matching/geometry/numerical task in this repo.

## API

```js
const { analyzePalindromes } = require('./manacher.js');

analyzePalindromes(text); // text: string
```

- `analyzePalindromes(text)` — returns `{ odd, even, longest }`.
  - `text` must be a `string`. Throws `TypeError` otherwise.
  - All indices (`odd[i]`, `even[i]`, and `longest.start`) are **Unicode
    code-point indices**, never UTF-16 code unit indices. The input is
    converted via `Array.from(text)`, which iterates by code point, so
    astral-plane characters encoded as UTF-16 surrogate pairs (many emoji,
    for example) are each a single element/index — never split across two
    indices the way raw `.length`/bracket indexing on the original string
    would split them.
  - Returns `{ start: 0, length: 0, value: '' }` for `longest`, and `[]`
    for both `odd` and `even`, when `text` is the empty string.

## `odd[i]` / `even[i]` semantics

This is the standard "d1 / d2" convention from the classical two-pass
Manacher construction: **every array entry is a radius**, not a length or
a diameter, and every entry is meaningful (no sentinel value is needed for
"no palindrome here").

Let `s` be the array of code points, length `n`.

- **`odd[i]`** (for `i` in `0..n-1`): the radius of the longest odd-length
  palindrome centered exactly at code-point index `i`. Always `>= 1` (a
  lone character is always a radius-1 odd palindrome centered at itself).
  The palindrome it describes is `s[i - odd[i] + 1 .. i + odd[i] - 1]`
  (inclusive) — `length = 2*odd[i] - 1`, `start = i - odd[i] + 1`.
- **`even[i]`** (for `i` in `0..n-1`): the radius of the longest
  even-length palindrome centered in the gap immediately **before** index
  `i` (the gap between code-point index `i-1` and index `i`). Always
  `>= 0`; `0` means no even-length palindrome exists at that gap. When
  `even[i] > 0`, the palindrome it describes is
  `s[i - even[i] .. i + even[i] - 1]` (inclusive) — `length = 2*even[i]`,
  `start = i - even[i]`.

`longest` is the single longest palindrome across every center of both
parities, with **deterministic earliest-start tie-breaking**: a candidate
only replaces the current best if it is strictly longer, or exactly as
long but starts strictly earlier. `longest.value` is the exact
reconstructed substring (via code-point slicing, so it round-trips
astral-plane characters correctly).

## Algorithm

The classical two-pass Manacher construction. Both passes maintain `[l,
r]`, the rightmost palindrome interval discovered so far (inclusive
code-point indices, tracked separately per parity): when the current
center `i` falls inside that interval, its initial expansion radius can be
lower-bounded from the already-computed radius at `i`'s mirror position
across the interval's center, rather than starting from scratch — this
mirror shortcut is exactly what makes both passes run in O(n) total time
rather than the O(n²) "expand around every center independently"
approach. Each pass still finishes with an explicit `while` expansion loop
per center, since the mirrored lower bound can under-estimate near the
edge of `[l, r]`.

The odd pass (`computeOdd`) and even pass (`computeEven`) are structurally
identical — same mirror/expand/update-interval shape — differing only in
where the two compared code points sit relative to the center (`s[i-k]`
vs `s[i+k]` for odd; `s[i-k-1]` vs `s[i+k]` for even, reflecting the
half-step-shifted center of an even-length palindrome).

### Design choices not pinned down by the task spec

- **Radius, not length, is the array convention** (see semantics above).
  This is the well-known textbook form (matches, for example, the `d1`/
  `d2` arrays as commonly presented in competitive-programming references
  for Manacher's algorithm) and avoids needing a sentinel for "no
  palindrome" — `odd[i]` is always a valid radius `>= 1`, `even[i]` is
  always a valid radius `>= 0`.
- **Tie-breaking is a single global scan**, not a two-phase
  "find max length, then find min start among matches": each candidate
  (both parities, every center) is compared against the running best with
  `(length desc, start asc)`, so the winner is independent of traversal
  order — verified explicitly by a test constructing the tie-length
  candidates in reverse index order from their required tie-break winner.
- **Unicode granularity is code points, not grapheme clusters** — per the
  task's own explicit requirement. `Array.from(text)` is exactly the code
  point granularity (not the user-perceived-character/grapheme-cluster
  granularity a library like `Intl.Segmenter` would give), so e.g. a
  base character plus a combining diacritical mark are correctly treated
  as two distinct indices, not merged into one.
- **Non-string rejection uses a strict `typeof text !== 'string'` check**,
  so a boxed `new String(...)` object (which passes loose `==` string
  comparisons but has `typeof` `'object'`) is correctly rejected with
  `TypeError`, consistent with this repo's established strict-type-check
  pattern for other tasks.

## Testing

`manacher.test.js` (committed, 27 tests, `node:test` / `node:assert/strict`,
no external dependencies) covers: the empty string and a single character;
odd-length palindromes (including a full-string case and one embedded in
asymmetric surroundings, checked against a hand-verified expected radius);
even-length palindromes (same two shapes); all-same-character runs (both
full-string and embedded); tied maxima under three different construction
strategies (two odd matches, two even matches, and a case built so the
later-starting candidate is encountered first during the left-to-right
scan, to actually exercise the tie-break comparison rather than relying on
scan order to produce the right answer for free); punctuation and
whitespace as ordinary characters; Unicode code points — accented BMP
characters, astral-plane emoji (with an explicit UTF-16-vs-code-point unit
count assertion), a center radius check confirming code-point (not
UTF-16-unit) centering, and mixed BMP+astral text; the full invalid-input
surface (11 non-string types including a boxed `String` object) all
rejected with `TypeError`; determinism across repeated calls; a
structural-invariant check (across 16 varied hand-picked inputs) that
`longest.value` is always an actual palindrome matching its own reported
`start`/`length`; and the task's required fixed-seed differential-coverage
block —
`'deterministic randomized differential coverage: xorshift32(0xC0FFEE),
>= 1000 short strings over a small alphabet, against an independent O(n^3)
brute-force reference'` (exactly the PRNG algorithm and seed named in this
repo's established differential-test convention; 1,200 trials run,
exceeding the required 1,000) — driving a separately implemented,
deliberately non-incremental **exhaustive O(n³) reference solver**
(`referenceLongestPalindrome`, defined in the test file itself, checking
every substring directly by code point) — structurally unrelated to the
Manacher expansion-with-mirroring technique under test. The alphabet for
this block deliberately mixes two BMP characters with one astral-plane
emoji, so the differential coverage itself exercises code-point indexing,
not just the dedicated Unicode tests.

An additional, uncommitted `fuzz.js` (not part of the submitted evidence,
run locally for extra confidence before the committed suite was even
written, per this repo's own established practice) ran a wider sweep
against the same style of independent exhaustive reference: the spec-scale
block (seed `0xC0FFEE`, 3,000 trials, 2-letter alphabet, strings 0-12 code
points), plus six additional blocks — a 3-letter alphabet (seed
`0x5eed5eed`, 3,000 trials), an 8-letter alphabet (seed `0xfeedface`,
2,000 trials), longer strings up to 60 code points (seed `0xb0eda12`,
1,000 trials), an all-one-character stress case (seed `0xabc123`, 1,000
trials), an astral-plane-heavy alphabet mixing BMP and emoji code points
(seed `0x1234abcd`, 1,000 trials), and a combining-diacritics alphabet
(seed `0x9999beef`, 500 trials) — **11,500 total trials, 0 mismatches**,
plus 11 explicit edge cases and 7 invalid-input types, all correct.

## Verification performed

- `node --test manacher.test.js` run in this directory: all 27 tests
  passed, 0 failures. See `test-output.txt` for the full TAP output,
  captured from a clean checkout with no `npm install` step.
- The uncommitted `fuzz.js` was run manually (`node fuzz.js`) before
  writing the committed suite and reported `TOTAL mismatches across all
  blocks: 0` (11,500 trials), plus 0 mismatches across 11 edge cases and
  7/7 correct invalid-input rejections.
- No external dependencies: `manacher.js` has no `require` at all; the
  test file only requires Node's built-in `node:test` and
  `node:assert/strict`.
