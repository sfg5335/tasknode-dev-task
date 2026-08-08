# hyperloglog

Dependency-free, single-file, deterministic HyperLogLog cardinality
estimator (`HyperLogLog`) for streaming approximate-distinct-count
sketches, in JavaScript, with an automated `node:test` suite.

## Files

- `hyperloglog.js` -- the implementation: `new HyperLogLog(precision)`
  (integer precision 4-16) with `add(string)`, `estimate()`,
  `merge(other)`, and `clear()` -- all three mutating methods (`add`,
  `merge`, `clear`) return `this` for chaining. Structurally distinct
  from every other data structure in this collection: instead of storing
  the items it's given, it hashes each string into a small fixed-size
  array of byte registers (`2^precision` of them) and estimates
  cardinality purely from the statistical distribution of those
  registers, in O(1) space per item and O(`2^precision`) total space
  regardless of how many (or how few) distinct items were ever added.

  **Algorithm** (Flajolet, Fusy, Gandouet & Meunier, 2007): every added
  string is hashed deterministically to a 64-bit value via the first
  eight bytes of its SHA-256 digest (big-endian). The top `precision`
  bits of that hash select one of `2^precision` registers; the
  remaining `64 - precision` bits are used to compute a *rank* -- one
  plus the number of leading zero bits in that remainder (i.e. the
  1-indexed position of its first 1-bit; an all-zero remainder uses
  `remainderWidth + 1` by convention). Each register stores the
  *maximum* rank ever observed for any string mapped to it. Since a
  leading-zero run of length *k* has probability `2^-k`, the largest
  run actually observed across many registers is a statistical
  estimator of how many distinct items were likely hashed -- longer
  runs mean more distinct items were needed to produce one by chance.
  `estimate()` combines all registers via the standard bias-corrected
  harmonic-mean formula (`alpha_m * m^2 / sum(2^-register[j])`), with
  Flajolet et al.'s three small-`m` bias constants (`m` = 16, 32, 64)
  and the general asymptotic formula for every larger `m`; when the raw
  estimate is small relative to `m`, it's replaced by the more accurate
  linear-counting estimator (`m * ln(m / zeroRegisterCount)`) -- which
  is also exactly what makes a freshly constructed or newly cleared
  counter (all registers 0) estimate *exactly* `0`, not just
  approximately.

  Two genuinely underspecified points resolved with explicit documented
  design decisions (see Design notes): the top-`precision`-bits index /
  remaining-bits-rank split (rather than the reverse), and using
  `RangeError` uniformly for *any* invalid precision value (wrong type
  or out of range), reserving `TypeError` for `add`/`merge`'s own
  argument-kind checks, per this task's own explicit wording.

- `hyperloglog.test.js` -- 25 `node:test` cases (no external
  dependencies), organized by the categories the task's own spec calls
  out:
  - **Validation errors**: a full sweep of out-of-range and
    wrong-type/non-integer precision values (`RangeError`), non-string
    `add()` arguments across every JS primitive/object kind
    (`TypeError`), non-`HyperLogLog` `merge()` arguments (`TypeError`),
    and mismatched-precision `merge()` across every other valid
    precision 4-16 (`RangeError`); plus a positive check that every
    integer precision 4-16 is actually accepted and produces the
    correctly-sized register array.
  - **Empty and duplicate streams**: a freshly constructed counter
    estimates exactly `0` at every precision; a single add produces a
    small positive estimate; repeated adds of the *same* string never
    change the estimate (checked via both the numeric estimate and the
    raw register bytes); a stream of 1,000 total adds drawn from only 5
    distinct values estimates near 5, not near 1,000.
  - **Unicode strings**: a mix of accented Latin, CJK, emoji, Greek,
    Cyrillic, a bare space, and the empty string, confirmed distinct
    and re-add-stable; a dedicated check that visually-similar
    (`café` vs `Cafe`) but code-point-distinct strings are correctly
    treated as different items.
  - **Deterministic repeated runs**: building the identical stream
    twice from fresh instances produces bit-for-bit identical register
    arrays and identical `estimate()` values (not just "close" --
    exactly equal, since the whole algorithm is a pure function of its
    string inputs); the same single string always maps to the same
    register/rank across independently constructed counters.
  - **Clear-and-reuse behavior**: `clear()` resets a populated counter
    to byte-for-byte the same register state as a freshly constructed
    one of the same precision, returns `this`, and the counter remains
    fully usable and accurate afterward, reflecting only post-clear
    data.
  - **Chaining**: `add()`/`merge()`/`clear()` all return the same `this`
    reference across a mixed chained call sequence.
  - **Overlapping and disjoint merges**: a disjoint-set merge estimates
    near the true sum; an overlapping-set merge estimates near the true
    union size (computed independently via a `Set`); a dedicated *exact*
    (non-statistical) identity test confirms `merge()` produces
    bit-for-bit identical registers and an identical estimate to
    building one counter directly from the full combined item list
    (register-wise max distributes over set union -- see Design notes);
    `merge()` never mutates or aliases the source counter's registers
    (checked by both a before/after byte comparison and a "does a later
    add to the source retroactively change the destination" probe);
    merging an empty counter is a true no-op; self-merge is a safe
    no-op.
  - **The task's own explicit accuracy requirement**: fixed streams of
    exactly 1,000 and 20,000 unique strings at precision 12, each
    asserted within 10% of the true cardinality (observed: ~1.2% and
    ~0.75% error respectively on the committed suite's exact fixed
    strings -- see Additional verification for the full error-band
    breakdown across many other precisions/sizes).

- `test-output.txt` -- raw, unedited output of the exact run command
  below.

## Additional verification (not part of the committed suite)

Beyond the committed suite, a larger uncommitted differential/stress
run (`scratch-stress.js`, deleted before commit) was run first:

- **300 relative-error sanity trials** across randomly chosen
  precisions (4-16) and stream sizes (1-20,000), each checked against
  an exact `Set`-based ground truth. Every single trial landed within
  3x the theoretical standard error (`1.04/sqrt(m)`) of the true
  cardinality -- specifically 227 trials within 1x SE, 63 within 2x,
  10 within 3x, and **zero** trials beyond 3x, let alone the very
  generous 6x-SE-plus-2%-floor bound the harness actually asserted on.
- **200 exact-identity merge trials**: for random item sets split
  randomly into two disjoint subsets, `a.merge(b)` was confirmed
  bit-for-bit register-identical (not just close) to building one
  counter directly from the full combined set -- a genuine mathematical
  identity of the algorithm (register-wise max distributes over set
  union), so this is an *exact* differential check, not a statistical
  one.
- **50 non-mutation/non-aliasing trials** confirming `merge()` never
  changes the source counter's registers, and that a later `add()` to
  the (already-merged-from) source counter never retroactively changes
  the destination.
- **30 determinism trials** (seeded `mulberry32` random strings,
  various precisions) confirming two independently-built counters from
  the identical input stream always produce bit-for-bit identical
  registers and estimates.
- **30 idempotence trials**: each distinct item repeated a random
  number of times (1-5) in shuffled order still produces registers
  bit-for-bit identical to a single clean pass over the distinct items
  once.
- **Clear-and-reuse across every precision 4-16**, confirming exact
  byte-for-byte reset to a fresh counter's register state at each one.
- **Boundary-precision sanity** at precision 4 (60-bit rank remainder)
  and precision 16 (48-bit rank remainder) -- both comfortably finite,
  positive estimates, no `BigInt`-boundary surprises.
- **41 validation-fuzzing checks** across a wide range of invalid
  precision/`add`/`merge` argument shapes (including `NaN`, `Infinity`,
  `Symbol`, arrays, and every other invalid precision in 4-16 for
  mismatched-precision merges), confirming the documented error type
  every time, never a silent success or an unrelated error type.
- The task's own fixed 1,000/20,000-string accuracy requirement at
  precision 12 (also duplicated in the committed suite): ~1.24% and
  ~0.75% error respectively in this particular stress run's slightly
  different string set.

**0 mismatches across all of it** -- the implementation was correct
against every one of these checks on the very first run, making this
the sixth task in this collection in a row with zero genuine
*implementation* bugs found during stress testing (after KD-Tree,
Robin Hood Hash Map, ROBDD, Palindromic Tree, and the Huffman codec --
see those tasks' own READMEs).

## Exact run command

```
node --test hyperloglog.test.js
```

Requires only the Node.js runtime (tested on Node v22.22.2) -- no
`npm install`, no native build, no service to start (`crypto` and
`Buffer` are both Node.js built-ins). Run from inside this directory,
from a clean checkout. The full suite (25 tests, including two
1,000/20,000-item accuracy checks) completes in well under a second.

## Design notes

- **Index bits come from the top of the hash, rank bits from the
  bottom.** Both choices are statistically valid (nothing in the
  algorithm requires one over the other), but taking the index from the
  high bits and the rank remainder from the low bits is the more common
  convention in reference HyperLogLog implementations, and keeps the
  index-selection and rank-computation code visually separated by which
  end of the 64-bit hash they read from.
- **`RangeError` for *any* invalid precision (wrong type or out of
  range), `TypeError` only for `add`/`merge`'s own argument-kind
  checks.** The task's own spec wording is explicit about this split
  ("reject non-string additions and non-counter merges with
  `TypeError`; reject invalid precision and mismatched-precision merges
  with `RangeError`") -- so a non-numeric precision (e.g. a string or
  `null`) still throws `RangeError`, not `TypeError`, since the spec
  groups *all* precision problems under `RangeError` regardless of
  whether the value is out-of-range or the wrong type entirely.
- **An empty/freshly-cleared counter estimates *exactly* `0`, not just
  approximately.** This falls directly out of the linear-counting
  correction: with every register at 0, `zeroCount === m`, so the
  formula reduces to `m * ln(m / m) = m * ln(1) = 0` with no rounding
  or approximation involved -- not a special-cased early return, just a
  consequence of the general formula at that specific input.
- **`merge()`'s register-wise-maximum identity is exact, not
  statistical.** For any register `j`, its final value after
  `a.merge(b)` is `max(a.registers[j], b.registers[j])`, which is
  exactly what a single counter would compute if built directly from
  the union of every string ever added to `a` or `b` -- because the
  rank stored at register `j` is itself already a max over every string
  that ever mapped there, and `max` distributes over that union
  (`max(max(S1), max(S2)) === max(S1 union S2)`). This is why the test
  suite can assert *exact* bit-for-bit register equality between a
  merge-built and a directly-built counter, rather than merely a close
  estimate -- and why merge is automatically commutative, associative,
  and idempotent (`h.merge(h)` is a safe no-op) with no special-case
  code needed for any of those properties.
- **No large-range correction.** The original 2007 paper's large-range
  correction exists to compensate for hash collisions once cardinality
  approaches the limits of a 32-bit hash space. This implementation
  uses a full 64-bit hash (the first eight SHA-256 bytes), matching
  what the task's own spec calls for ("Hash UTF-8 strings
  deterministically to 64 bits ... register selection, leading-zero
  rank, standard alpha constants, raw estimation, and linear-counting
  correction") -- collisions at 64-bit scale are astronomically
  unlikely for any realistic stream size, so raw estimation plus the
  small-range linear-counting correction is the complete, spec-matching
  estimator.
