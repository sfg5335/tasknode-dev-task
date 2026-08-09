# Deterministic Merkle Mountain Range

A dependency-free, deterministic implementation of a Merkle Mountain Range
(MMR) — an append-only, hash-based accumulator built from a forest of
perfect binary trees ("mountains"), one per set bit in the binary expansion
of the current leaf count.

## API

```js
const { MerkleMountainRange } = require('./merkle-mountain-range.js');

const mmr = new MerkleMountainRange();
const index = mmr.append(Buffer.from('hello'));  // returns the new leaf's index
mmr.size;                                          // current leaf count (getter)
const root = mmr.root();                           // current root, lowercase hex
const proof = mmr.getProof(index);                 // inclusion proof for that leaf
MerkleMountainRange.verifyProof(Buffer.from('hello'), proof, root); // -> true
```

- `append(bytes: Uint8Array): number` — appends a new leaf, returns its
  0-based index.
- `size` (getter) — current leaf count.
- `root(): string` — current root as a 64-character lowercase hex string.
- `getProof(index: number): object` — inclusion proof for the leaf at
  `index`, generated against the tree's *current* state/root.
- `MerkleMountainRange.verifyProof(bytes, proof, expectedRoot): boolean` —
  static method; recomputes the root implied by `bytes` + `proof` and
  compares it against `expectedRoot`.

## Hash format (fixed by the task specification)

Every hash is domain-separated by a leading tag byte, so a leaf hash, an
internal parent hash, a peak-bagging step, and the final rooted hash can
never collide even if their remaining bytes happen to coincide:

```
leaf hash    = SHA-256(0x00 || uint64be(byteLength) || bytes)
parent hash  = SHA-256(0x01 || left || right)
peak bagging = SHA-256(0x02 || accumulator || nextPeak)
rooted hash  = SHA-256(0x03 || uint64be(size) || baggedPeaks)
empty root   = SHA-256(0x03 || uint64be(0))          -- special case, no
                                                          baggedPeaks at all
```

`uint64be(n)` encodes `n` as 8 bytes, big-endian, via `BigInt` (not JS's
32-bit bitwise operators), so values across the full unsigned 64-bit range
are represented exactly. All hashes — internal and returned — are lowercase
hexadecimal strings.

Peak bagging left-folds an ordered list of peak hashes: a single-mountain
forest's "bagged" value is that one peak unchanged (there is nothing to
combine with); a multi-mountain forest folds left-to-right via the bagging
formula above.

## Design choices not pinned down by the task spec

The task specifies the hash formulas exactly, but leaves a few things
open. Each was decided deliberately and is documented inline in the
source:

- **`append()`'s return value** — the new leaf's 0-based index. Without
  this, a caller has no way to learn which index to later pass to
  `getProof()` for the leaf it just appended, short of separately tracking
  `size - 1` itself.
- **Proof object shape** — `{ index, size, siblings, peaks, peakIndex }`.
  `siblings` is bottom-to-top; each entry's `position` describes the
  *sibling's* position relative to the node being climbed (`'left'` or
  `'right'`). `peaks` is every mountain's peak hash, left-to-right, at
  proof-generation time. `peakIndex` identifies which entry of `peaks`
  belongs to the proof's own mountain — the slot that verification
  recomputes and overwrites (see below).
- **Error-handling convention** — `TypeError` for wrong-*kind* inputs
  (`append`'s `bytes` not a `Uint8Array`; `verifyProof`'s `bytes` not a
  `Uint8Array`, or `proof`/`expectedRoot` malformed field-by-field).
  `RangeError` is reserved for `getProof`'s well-typed-but-out-of-bounds
  `index` — the only `RangeError` site in this module's public API. A
  well-typed but *wrong* proof or root (a tampered leaf, sibling, peak,
  size, or expected root) is not an error at all — it's exactly the
  "verification failed" outcome `verifyProof` exists to report, so it
  returns `false` rather than throwing.
- **Case-insensitive `expectedRoot`** — this module always *produces*
  lowercase hex, but `verifyProof`'s `expectedRoot` argument is only
  required to be valid hex, not specifically lowercase: comparison is
  `recomputedRoot === expectedRoot.toLowerCase()`. A non-hex-shaped
  `expectedRoot` still throws `TypeError`.

## A non-obvious proof-verification semantic (documented, not a bug)

`verifyProof` climbs the sibling path from the leaf up to its own
mountain's peak, then substitutes that *recomputed* peak into
`proof.peaks[proof.peakIndex]` before folding all peaks together and
comparing against `expectedRoot`. This means the *original* value stored
at `proof.peaks[proof.peakIndex]` is never actually read as an input — it
is simply overwritten before use.

Consequently, tampering `proof.peaks[proof.peakIndex]` (the proof's own
mountain's peak slot) before calling `verifyProof` is a legitimate
**no-op**: verification still succeeds, because that slot is an *output*
of the climb (the thing being proven), not an independent input being
checked. This is correct, standard Merkle-proof behavior, not a missed
security check. Tampering any *other* peak, any sibling, the size, or the
expected root is correctly detected and rejected. Both the committed test
suite and the uncommitted stress test verify this distinction explicitly,
for multiple leaves and multiple tree sizes.

## Mutation safety

`append()` never retains a reference to the caller's `bytes` — it is
hashed immediately via a fresh `Buffer.from(bytes)` copy and then
discarded (MMRs conventionally never store original leaf data, only
hashes), so later external mutation of the caller's array has no effect
on stored state. `getProof()` only extracts immutable hex *strings* into
freshly-built arrays/objects — never a reference to the tree's internal
per-mountain `layers` arrays — so mutating a returned proof can never
corrupt the tree's own state, and vice versa. `verifyProof()` copies
`proof.peaks` via `.slice()` before mutating the copy during verification,
so the caller's own proof object is never mutated by a `verifyProof` call.
These guarantees hold *by construction*, not through additional defensive
copying beyond what's described above.

## Testing

`merkle-mountain-range.test.js` (committed, 26 tests) includes an
independent "from-scratch" oracle that recursively splits each
power-of-two chunk of leaves in half (divide-and-conquer) to re-derive
each peak completely fresh, rather than via the module's own incremental
merge/carry bookkeeping — a structurally different code path for the one
part of this task not fully pinned down by the spec (the tree-structure
bookkeeping), while still reimplementing the fixed hash formulas
independently (not imported from the module under test) so a shared
hash-helper bug can't cancel out against the oracle.

Covers: empty/single-leaf state, a pinned regression vector (exact
hardcoded root + proof for a known input), a sequential 0→20 append sweep
cross-checked against the oracle at every step, every-leaf-proof
verification across many sizes, duplicate-content and binary/empty
payloads, determinism (independent rebuilds + repeated calls), mutation
safety, invalid-input handling (every malformed proof field individually),
case-insensitive `expectedRoot`, tamper rejection for every proof field —
plus the dedicated own-`peakIndex`-no-op documentation test above — and a
40-trial randomized differential sweep against the oracle.

An additional, uncommitted `stress-test.js` (not part of the submitted
evidence, run locally for extra confidence before committing) performs a
heavier differential/stress pass: an exhaustive n=0..64 sweep, a
randomized sweep up to n=500, 30 determinism trials, an exhaustive tamper
matrix across 10 sizes, and 100 mutation-safety fuzzing trials — 8,220
checks total, 0 mismatches.

## Verification performed

- `node --test merkle-mountain-range.test.js` run in this directory: all
  26 tests passed, 0 failures. See `test-output.txt` for the full TAP
  output.
- The uncommitted `stress-test.js` was run manually (`node stress-test.js`)
  before committing and reported `STRESS TEST PASSED` with 0 mismatches
  across all five phases.
- No external dependencies: `merkle-mountain-range.js` only requires
  Node's built-in `crypto` module; the test file only requires Node's
  built-in `node:test`, `node:assert`, and `crypto` modules.
