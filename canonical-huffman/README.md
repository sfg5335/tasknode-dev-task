# canonical-huffman

Dependency-free, single-file, deterministic canonical Huffman byte codec
(`encode`/`decode`) for arbitrary `Uint8Array` byte streams, in
JavaScript (ES module), with an automated `node:test` suite.

## Files

- `canonical-huffman.mjs` -- the implementation: `encode(data)` takes a
  `Uint8Array` and returns a `Uint8Array` in the self-describing `CHUF`
  format (see below); `decode(bytes)` takes a `Uint8Array` in that
  format and returns the original `Uint8Array`, throwing `RangeError`
  on any structurally malformed stream and `TypeError` on any
  non-`Uint8Array` input to either function.

  **Format (`CHUF`)**: a 4-byte magic (`0x43 0x48 0x55 0x46`, ASCII
  `"CHUF"`), a 4-byte big-endian original-length field, a 256-byte
  code-length table (one byte per possible byte value 0-255, `0`
  meaning "not present in the input"), then the bit-packed payload
  (MSB-first within each byte, zero-padded to the next byte boundary).

  **Algorithm**: classic canonical Huffman coding. First build a
  standard Huffman merge tree over per-symbol frequencies, using a
  strict `(weight, minSymbol)` total order to pick merge pairs
  deterministically -- `minSymbol` (the smallest original byte value
  present in a node's subtree) is always unique across a node set at
  every step, since it's inherited unchanged from the two children and
  no two live nodes can share a minimum symbol, so ties never need a
  third tiebreaker. Depths from that tree become each symbol's code
  *length* (not its code value). Canonical codes are then assigned
  independently of the tree shape, purely from the length table:
  process lengths from shortest to longest, assigning consecutive
  integer code values in ascending symbol order within each length,
  left-shifting the running code by one bit whenever the length
  increases. This is what makes the format self-describing with only a
  length table (not full code values) in the header -- `decode` runs
  the exact same `assignCanonicalCodes` procedure to reconstruct
  identical codes from the transmitted lengths alone.

  **Single-symbol special case**: an input using exactly one distinct
  byte value has no merge step at all (`buildLengths` short-circuits
  it to length 1), matching the natural expectation that repeating one
  byte 1000 times should cost ~1 bit per byte, not the 0 bits a
  literal one-node "tree" would suggest. This makes that one symbol's
  code deliberately *incomplete* in the Kraft sense (only `"0"` is
  ever assigned; `"1"` is never valid) -- `decode` special-cases
  `presentCount === 1` accordingly, both when validating the table and
  implicitly through the bit-matching loop (see Design notes).

  **`BigInt` code values throughout**: code lengths for a 256-symbol
  Huffman tree can theoretically reach up to 255 bits (a maximally
  skewed/Fibonacci-weighted frequency distribution), far past
  JavaScript's 32-bit-safe bitwise-operator range. All code value
  arithmetic (`assignCanonicalCodes`, encoding's bit-packing loop,
  decoding's bit-matching loop) uses `BigInt` exclusively to stay
  correct arbitrarily deep -- see Design notes for the empirical check
  that actually exercises this beyond 32 bits.

- `canonical-huffman.test.mjs` -- 30 `node:test` cases (no external
  dependencies, ES module `import`/`export` syntax as the task
  requires), organized by the categories the task's own spec calls
  out:
  - **Golden byte vectors** (fixed expected encoded bytes, not just
    round-trip checks): `[65,65,65]` (single repeated symbol) asserted
    against its exact expected header
    (`4348554600000003` + all-zero table except byte 65 = `01`) and
    exact expected payload byte (`00`); `[0,1,0,0]` (skewed 2-symbol
    input) hand-traced through the full canonical-code algorithm and
    asserted against its exact expected header and payload byte
    (`40`); and empty input asserted against its exact expected header
    (`4348554600000000`) with an explicitly all-zero 256-byte table
    and zero-length payload.
  - **Empty and single-symbol inputs**: empty round-trips to a
    zero-length `Uint8Array`; a single repeated byte value at several
    lengths (including length 1) round-trips and always uses code
    length 1.
  - **All 256 byte values**: a uniform distribution (each value once)
    and a skewed distribution (value *i* appears *i+1* times), both
    round-tripped exactly.
  - **Repeated/seeded-random round trips**: 40 trials (mulberry32,
    fixed seed) across varied lengths and alphabet sizes.
  - **Deep tree (Fibonacci-weighted frequencies)**: 26 symbols with
    Fibonacci-sized frequency counts, forcing a genuinely unbalanced
    tree with a non-trivial max code length, round-tripped and checked
    for exact input-length preservation.
  - **Determinism**: 20 trials confirming `encode` called twice on
    identical (but distinct-reference) input produces byte-identical
    output.
  - **Input immutability**: `encode` does not mutate its input array;
    `decode` does not mutate its input array; `encode`'s output does
    not alias/retain a live reference to the input buffer (mutating
    the input after encoding doesn't change the encoded bytes).
  - **Invalid input types**: `encode` and `decode` both reject any
    non-`Uint8Array` input (including the similar-but-distinct
    `Int8Array` and `Uint8ClampedArray` typed arrays, plain arrays,
    and non-array values) with `TypeError`.
  - **Malformed headers**: a stream too short to contain a full
    header; wrong magic bytes at each of the 4 magic-byte positions;
    a declared original length inconsistent with (exceeding) the
    available payload bits.
  - **Malformed code-length tables**: an overflowed table (5 symbols
    forced to claim length 1, impossible since only 2 length-1 codes
    can exist); a hand-constructed incomplete-but-not-single-symbol
    table (Kraft sum 3/4 < 1); a single-symbol table whose one entry
    claims a length other than 1; a non-empty table paired with a
    declared original length of zero; an all-zero table paired with a
    non-zero declared original length.
  - **Malformed payloads**: a payload truncated mid-symbol; payload
    bits that can never match any known code (see Design notes for why
    this specifically requires the single-symbol case, not an
    arbitrary corrupted multi-symbol tree).
  - **Malformed padding**: non-zero padding bits in both a
    single-byte-payload and a multi-byte-payload stream (handling the
    edge case where the corrupting bit-flip could coincidentally land
    on real data rather than padding).
  - **Malformed trailing bytes**: an extra byte appended after an
    otherwise-valid payload; an extra byte appended after an
    otherwise-valid *empty* payload.

- `test-output.txt` -- raw, unedited output of the exact run command
  below.

## Additional verification (not part of the committed suite)

Beyond the committed suite, a larger uncommitted differential/fuzz
stress run (`scratch-stress.mjs`, deleted before commit) was run
first:

- **500 random round-trip trials** (mulberry32, fixed seed) across
  varied lengths (0-2000 bytes) and alphabet sizes (1-256 symbols).
- **100 determinism trials** confirming byte-identical output across
  repeated `encode` calls on distinct-but-equal input copies.
- **All 256 byte values**, two distributions (uniform, skewed),
  both round-tripped exactly.
- **A genuinely deep 34-symbol Fibonacci-weighted tree** (14,930,351
  total input bytes) -- confirmed the actual maximum code length
  produced was **33 bits**, past the 32-bit boundary where plain
  JavaScript bitwise operators silently wrap, empirically validating
  the `BigInt`-throughout design decision rather than just arguing for
  it theoretically. (This exact case is reproduced in the committed
  suite at a smaller scale -- 26 symbols instead of 34 -- purely to
  keep the committed suite's runtime well under a second; the 34-symbol
  version alone took roughly 6 seconds to encode and decode.)
- **360 malformed-stream fuzz throw-checks** (60 trials x 6 corruption
  strategies: bad magic, truncated header, truncated table, truncated
  payload, trailing byte, corrupted overflow table) -- confirmed every
  one throws `RangeError` specifically (never hangs, never throws an
  unrelated error type, never silently returns wrong data).
- A dedicated corrupted-padding-bit robustness check across 60 further
  trials, confirming `decode` never crashes with a non-`RangeError` and
  never hangs even when a flipped bit happens to land ambiguously.
- The hand-constructed incomplete-table and wrong-single-symbol-length
  rejection cases (now also in the committed suite).

**0 mismatches across all of it** -- the implementation was correct
against every one of these checks on the very first run (after fixing
an unrelated `RangeError: Invalid array length` crash in the stress
harness's own Fibonacci-array construction, not in `canonical-huffman
.mjs` -- switching from `Array.push()` in a 40-symbol loop to a
pre-allocated `Uint8Array.fill()` at a reduced 34-symbol count
resolved it with zero changes to the codec itself), making this the
sixth task in this collection in a row with no genuine implementation
bug found during stress testing, after the KD-Tree, Robin Hood Hash
Map, ROBDD, and Palindromic Tree tasks (see those tasks' own READMEs).

One genuine **test-authoring** bug did surface, in the *committed*
suite rather than the stress harness -- see Design notes.

## Exact run command

```
node --test canonical-huffman.test.mjs
```

Requires only the Node.js runtime (tested on Node v22.22.2) -- no
`npm install`, no native build, no service to start. Run from inside
this directory, from a clean checkout. The full suite (30 tests)
completes in well under a second.

## Design notes

- **A canonical Huffman code with 2+ distinct symbols is always
  *complete* in the Kraft sense (`sum(2^-length) === 1` exactly,
  realized as an actual full binary tree with no missing branches)**,
  because it comes from a genuine Huffman merge tree where every
  internal node has exactly two children. A direct consequence: no
  bit string of any length -- corrupted or not -- can ever fail to
  match some leaf within `maxLen` bits, for any table with 2+ symbols.
  This was originally missed while writing the "payload bits that
  never match any known code" test: the first version corrupted a
  payload byte to `0xFF` inside a 3-symbol tree, expecting an
  unmatchable pattern, but since that tree's code was complete, `0xFF`
  just decoded as four repetitions of the length-2 code `"11"` and
  `decode` correctly returned data instead of throwing -- a genuine
  test bug, not an implementation bug, confirmed by first reasoning
  through the Kraft-completeness argument above and then empirically
  checking both branches with `node -e` before touching the
  implementation. The fix uses the **single-symbol special case**
  instead, whose code is deliberately incomplete (only `"0"` is ever
  assigned) precisely because a lone repeated byte shouldn't cost 0
  bits per occurrence -- corrupting one payload bit to `1` there
  reliably drives the decode walk past `maxLen` without a match.
- **`TypeError` vs. `RangeError` split mirrors JavaScript convention**:
  `TypeError` for "the argument is not the right kind of value at
  all" (non-`Uint8Array` input to either function), `RangeError` for
  "the argument is the right kind of value but its *content* is
  structurally invalid" (every malformed-stream case in `decode`) --
  the same distinction most of this collection's other tasks with a
  validating parse step have used.
- **The 256-byte code-length table is always transmitted in full**,
  even though most inputs use far fewer than 256 distinct byte values.
  This trades a small fixed 256-byte header overhead (irrelevant for
  anything but tiny inputs) for a simpler, unambiguous format with no
  separate "which symbols are present" encoding step -- consistent
  with the task's implied self-describing-header framing.
- **`buildLengths`'s merge order is fully deterministic** via the
  `(weight, minSymbol)` total order described above, which is why
  `encode` is deterministic across repeated calls on equal-but-
  distinct input buffers (verified directly in the test suite).
- **`assignCanonicalCodes` is shared, unmodified, between `encode` and
  `decode`** -- `encode` calls it after building lengths from its own
  frequency-driven tree, `decode` calls it after reading lengths
  straight from the wire, with no other path to producing code values
  in either direction. This means any code-assignment bug would
  necessarily break round-tripping (there's no way for the two call
  sites to silently disagree), rather than being a source of the kind
  of encoder/decoder-drift bug a format with two independent code-
  assignment implementations could hide.
