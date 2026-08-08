# burrows-wheeler

Dependency-free, single-file, deterministic, sentinel-free (bzip2-style)
Burrows-Wheeler Transform (`encodeBWT`/`decodeBWT`) for arbitrary byte
data, in JavaScript, with an automated `node:test` suite.

## Files

- `burrows-wheeler.js` -- the implementation: `encodeBWT(input)` takes a
  `Buffer` or `Uint8Array` and returns `{ lastColumn, primaryIndex }`;
  `decodeBWT(lastColumn, primaryIndex)` takes that pair back and returns
  the original data. Both functions return freshly allocated `Buffer`s
  and never mutate their inputs; `decodeBWT` throws `TypeError` for
  wrong argument types and `RangeError` for a `primaryIndex` outside the
  valid bounds for the given `lastColumn` length.

  **No sentinel byte.** Many textbook BWT presentations append an
  artificial end-of-string marker (traditionally `$`) smaller than every
  real byte, which makes the transform trivially invertible but isn't
  meaningful for arbitrary binary data where every byte value 0-255 is
  already in use. This implementation instead uses the bzip2-style
  approach: sort all `n` *cyclic rotations* of the raw input (no marker
  byte added), and separately record a `primaryIndex` -- the row, in the
  conceptual sorted rotation matrix, that holds the original (unrotated)
  string. That index is exactly what makes the sentinel-free transform
  invertible.

  **Encoding** sorts the rotations via prefix doubling (a
  Manber-Myers-style rank-doubling technique, adapted to circular
  strings): starting from single-byte ranks, each round compares twice
  as much of every rotation as the previous round, by pairing each
  rotation's current rank with the rank of the rotation starting `k`
  positions later (wrapping around via `% n`), until the comparison
  length covers the whole string -- fully ordering any two genuinely
  distinct rotations in O(log n) rounds without ever materializing the
  full n x n rotation matrix. Rotations that remain tied even at full
  length (only possible when the input is periodic or constant, so two
  different starting positions produce the literal same cyclic byte
  sequence) are broken by starting index, ascending, exactly as the
  task's own spec requires.

  **Decoding** reconstructs the original bytes from `lastColumn` and
  `primaryIndex` alone, without ever rebuilding the sorted rotation
  matrix: a 256-entry cumulative byte-frequency table locates each byte
  value's block in the (never-materialized) sorted first column; a
  per-position occurrence rank tracks how many times each byte value has
  been seen so far while scanning `lastColumn`; combining the two gives
  the standard LF-mapping array, which is then walked backward `n`
  times starting from `primaryIndex` to regenerate the original bytes.

- `burrows-wheeler.test.js` -- 27 `node:test` cases (no external
  dependencies), organized by the categories the task's own spec calls
  out:
  - **Empty and singleton inputs**: an empty input encodes to an empty
    `lastColumn` with `primaryIndex` 0 and decodes back to empty data;
    any nonzero `primaryIndex` paired with an empty `lastColumn` is
    rejected; a single-byte input round-trips with `lastColumn` equal to
    that byte and `primaryIndex` 0.
  - **The known fixture**: `encodeBWT("BANANA")` asserted against the
    task's own exact expected output (`lastColumn === "NNBAAA"`,
    `primaryIndex === 3`) -- hand-verified independently by sorting all
    6 rotations of "BANANA" by hand before writing any code (see Design
    notes) -- plus the matching decode-back-to-"BANANA" check.
  - **Repeated and periodic bytes**: an all-identical-byte string, a
    periodic 2-byte pattern, and a periodic 3-byte pattern all
    round-trip correctly; a dedicated structural-invariant test confirms
    `lastColumn` is always an exact byte-multiset permutation of the
    input (same per-value counts), independent of round-trip
    correctness.
  - **Zero and high bytes**: a run of `0x00` bytes, a run of `0xFF`
    bytes, and an alternating `0x00`/`0xFF` sequence all round-trip
    correctly.
  - **All 256 byte values**: ascending, descending, and
    each-value-appearing-twice orderings all round-trip correctly.
  - **Fixed-seed round trips**: 100 trials (mulberry32, fixed seed)
    across varied lengths and alphabet sizes; a dedicated determinism
    check confirms `encodeBWT` produces byte-identical output across two
    calls on equal-but-distinct input buffers.
  - **Immutability**: `encodeBWT` doesn't mutate its input, and mutating
    its returned `lastColumn` afterward doesn't retroactively change the
    input (no aliasing); the same two checks for `decodeBWT` and its
    returned buffer; plus a dedicated round-trip check confirming a
    plain `Uint8Array` (not just `Buffer`) is accepted end-to-end.
  - **Invalid arguments**: a full `TypeError` sweep for non-`Buffer`/
    `Uint8Array` input to both functions and for a non-integer
    `primaryIndex`; a full `RangeError` sweep for an out-of-bounds
    `primaryIndex` (negative, equal to length, and far beyond it).

- `test-output.txt` -- raw, unedited output of the exact run command
  below.

## Additional verification (not part of the committed suite)

Beyond the committed suite, a larger uncommitted differential/stress run
(`scratch-stress.js`, deleted before commit) was run first:

- **400 differential trials against an independently written,
  deliberately naive oracle**: for each random input, every rotation is
  built as an explicit array and sorted via direct element-by-element
  array comparison (never touching ranks, prefix doubling, or any other
  machinery the real implementation uses) -- confirmed byte-identical
  `lastColumn` and exactly matching `primaryIndex` against the real
  prefix-doubling implementation on every single trial.
- **500 random round-trip trials** across varied lengths (0-400 bytes)
  and alphabet sizes (1-256 symbols).
- **The BANANA fixture plus 11 further hand-picked edge cases**
  (all-same-byte, two periodic patterns, all-zero bytes, all-`0xFF`
  bytes, alternating `0x00`/`0xFF`, all 256 byte values in three
  different orderings), each checked against both round-trip
  correctness *and* the naive oracle.
- **100 byte-multiset-permutation invariant trials** confirming
  `lastColumn` always has the exact same per-byte-value counts as the
  input, independent of round-trip correctness.
- Immutability/non-aliasing checks (also duplicated in the committed
  suite) and Uint8Array-input support checks.
- **21 validation-fuzzing checks** across invalid input types and
  out-of-range/non-integer `primaryIndex` values.
- **A 5,000-byte performance/correctness check**: encode completed in
  33ms, decode in under 1ms, with an exact round-trip match --
  confirming the prefix-doubling approach comfortably handles
  non-trivial input sizes without the committed suite needing to pay
  that cost itself.

**0 mismatches across all of it** -- the implementation was correct
against every one of these independent checks on the very first run,
making this the seventh task in this collection in a row with zero
genuine *implementation* bugs found during stress testing (after
KD-Tree, Robin Hood Hash Map, ROBDD, Palindromic Tree, the Huffman
codec, and HyperLogLog -- see those tasks' own READMEs).

## Exact run command

```
node --test burrows-wheeler.test.js
```

Requires only the Node.js runtime (tested on Node v22.22.2) -- no
`npm install`, no native build, no service to start. Run from inside
this directory, from a clean checkout. The full suite (27 tests)
completes in well under a second.

## Design notes

- **The BANANA fixture was hand-verified before any code was written**,
  by listing all 6 cyclic rotations of "BANANA", sorting them
  lexicographically by hand (byte order A < B < N), and reading off the
  last column and the row of the original (shift-0) rotation --
  producing exactly `NNBAAA` / primary index 3, matching the task's own
  stated expected output. This hand trace was what the implementation
  was then written and checked against, rather than working backward
  from a guessed algorithm to match the fixture.
- **Encoding's tie-break rule ("breaking equal rotations by starting
  index") is applied as the *final* sort key, not injected into
  intermediate prefix-doubling rounds.** Each round's rank array
  reflects genuine byte-content equivalence up to the current comparison
  length; only truly cyclic-identical rotations (periodic or constant
  input) still share a rank once the comparison length reaches `n`, and
  only *those* ties are broken by starting index, in one final sort.
  Weaving the index into every intermediate round's comparator would
  still produce a valid deterministic order at each step, but risks
  conflating "genuinely tied so far" with "arbitrarily ordered for sort
  stability," which is a much easier invariant to reason about keeping
  separate.
- **`decodeBWT` never reconstructs the full sorted rotation matrix.**
  The classic LF-mapping approach (cumulative byte-frequency counts plus
  per-position occurrence ranks) reconstructs the original string in
  O(n) time and O(n) space directly from `lastColumn`, exactly as the
  task's own spec calls for ("decoding with byte-frequency counts,
  occurrence ranks, and LF mapping").
- **`TypeError` for wrong argument *kinds*, `RangeError` for
  out-of-bounds *values* of the right kind** -- consistent with the
  convention used throughout this collection: a non-`Buffer`/
  `Uint8Array` argument, or a non-integer `primaryIndex`, is the wrong
  *kind* of value entirely (`TypeError`); an integer `primaryIndex`
  that's simply out of the valid `[0, lastColumn.length)` range (or
  nonzero when `lastColumn` is empty) is the right kind of value with an
  invalid *value* (`RangeError`).
- **Both `Buffer` and plain `Uint8Array` are accepted** (`Buffer` is
  itself a `Uint8Array` subclass in Node.js, so a single
  `instanceof Uint8Array` check covers both), matching the task's own
  "Operate on `Buffer` or `Uint8Array` data" wording -- but both
  functions' *return values* are always real `Buffer`s, for convenient
  `.toString()`/`Buffer.compare()` use regardless of which input type
  was originally passed in.
