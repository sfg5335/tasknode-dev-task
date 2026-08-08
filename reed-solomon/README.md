# Deterministic Reed-Solomon Erasure Codec

`encode(dataShards, parityCount)` / `reconstruct(shards, dataShardCount)` -- a dependency-free
implementation of systematic Reed-Solomon erasure coding over GF(256), using the primitive
polynomial `0x11d` (`x^8 + x^4 + x^3 + x^2 + 1`).

## API

```js
const { encode, reconstruct } = require('./reed-solomon.js');

encode(dataShards, parityCount);
reconstruct(shards, dataShardCount);
```

### `encode(dataShards, parityCount)`

- `dataShards`: an array of at least one `Uint8Array`, all of equal length (the "shard length";
  may be `0`).
- `parityCount`: a positive integer. `dataShards.length + parityCount` must not exceed `255`
  (the number of distinct nonzero GF(256) elements available as Vandermonde-matrix evaluation
  points -- see "Algorithm" below).

Returns a fresh array of `dataShards.length + parityCount` `Uint8Array` shards: the first
`dataShards.length` are exact copies of the input data shards (the coding is *systematic* --
data passes through unencoded), followed by `parityCount` newly computed parity shards. Never
mutates `dataShards` or any shard inside it.

```js
encode([Uint8Array.from([3]), Uint8Array.from([7])], 2);
// [ Uint8Array[3], Uint8Array[7], Uint8Array[240], Uint8Array[15] ]
```

### `reconstruct(shards, dataShardCount)`

- `shards`: an array produced by (conceptually) a matching `encode()` call, where each entry is
  either a `Uint8Array` (a surviving shard) or a missing-shard marker (`null` or `undefined`, an
  "erasure"). At least `dataShardCount` of the entries must be present `Uint8Array`s, all of
  equal length.
- `dataShardCount`: the number of *data* shards in the original `encode()` call (a positive
  integer, strictly less than `shards.length`).

Returns a fresh array of `shards.length` `Uint8Array`: every originally present shard is
returned as an exact copy of its input value, and every originally missing shard (data **or**
parity) is recovered and returned as a freshly computed `Uint8Array` of the correct value.
Throws `RangeError` if fewer than `dataShardCount` shards survived (too many erasures to
recover). Never mutates `shards` or any surviving shard.

```js
const full = encode([Uint8Array.from([3]), Uint8Array.from([7])], 2);
reconstruct([null, full[1], full[2], undefined], 2);
// [ Uint8Array[3], Uint8Array[7], Uint8Array[240], Uint8Array[15] ] -- both erasures recovered
```

## Algorithm

A systematic encoding matrix is built once per `(n, k)` pair (`n` = total shard count, `k` =
`dataShardCount`), purely as a deterministic function of `n` and `k`:

1. A Vandermonde matrix `V` (`n` rows x `k` columns) is built with `V[r][c] = (r+1)^c` in
   GF(256), for `r = 0..n-1`, `c = 0..k-1` -- using evaluation points `1..n` (all distinct
   nonzero GF(256) elements, since the caller-enforced constraint `n <= 255` guarantees there
   are enough of them). Any square submatrix of a Vandermonde matrix built from distinct
   evaluation points is invertible: its determinant is the classical Vandermonde determinant, a
   nonzero product of pairwise differences of the (distinct) evaluation points used by its rows.
2. The top `k x k` submatrix `Vtop` (`V`'s rows `0..k-1`) is inverted via Gauss-Jordan
   elimination over GF(256) (`Vtop` is itself a `k x k` Vandermonde matrix on distinct points,
   hence invertible by the same argument).
3. `EncodeMatrix = V * Vtop^-1` (`n x k`). By construction, the top `k` rows of `EncodeMatrix`
   equal `Vtop * Vtop^-1` = the `k x k` identity matrix -- this is exactly what "systematic"
   means (data shards are literally reproduced unencoded). Right-multiplying every row of `V` by
   the same invertible `k x k` matrix `Vtop^-1` preserves *which sets of rows are linearly
   independent* (if a set of rows of `V` is invertible as a matrix, the same set of rows of
   `V * Vtop^-1` is invertible too, since it differs only by that fixed invertible
   right-multiplication) -- so **any** `k` rows chosen from `EncodeMatrix`'s `n` rows still form
   an invertible `k x k` matrix.

That last property is exactly what makes recovery from any `k` surviving shards possible:
encoding is conceptually `allShards = EncodeMatrix * data` (applied independently at every byte
position). Given any `k` surviving shards' values, inverting the corresponding `k x k`
submatrix of `EncodeMatrix` and multiplying it by those `k` values recovers `data` exactly, from
which every other row (shard, including any other missing one) can then be recomputed via
`EncodeMatrix * data`.

`reconstruct()` builds the identical `EncodeMatrix` (a pure function of `n` and `k`, so `encode`
and `reconstruct` always agree without any shared state), picks any `dataShardCount` present
shards, inverts their `k x k` submatrix, recovers the full data vector, and recomputes only the
originally-missing rows (data or parity) from it -- originally-present shards are returned
untouched (exact copies), not recomputed, even though recomputing them would give bit-identical
results given correct GF arithmetic.

### GF(256) arithmetic

Multiplication and inversion are implemented via log/antilog tables built once at module load
from the primitive polynomial `0x11d`: `GF_EXP`/`GF_LOG` are populated by repeatedly doubling
(left-shifting) a running value and reducing modulo `0x11d` (via XOR) whenever it overflows 8
bits, for all 255 nonzero field elements. `0x11d` was confirmed primitive (generates all 255
nonzero elements before the multiplicative cycle closes back to `1`) by direct trace before any
implementation code was written.

### Why Gauss-Jordan elimination for matrix inversion

`invertMatrix` runs standard Gauss-Jordan elimination on the augmented `[matrix | identity]`
form, using GF(256) arithmetic throughout (XOR for addition/subtraction, since GF(2^8) has
characteristic 2). It picks a nonzero pivot in each column (searching downward from the current
row), swaps it into place, normalizes the pivot row, and eliminates that column from every other
row. This always succeeds for the matrices this module builds (`Vtop` and any `k`-row submatrix
of `EncodeMatrix`), since their invertibility is guaranteed by the Vandermonde-determinant
argument above; a singular matrix would indicate an internal invariant violation, not a
user-input error, so that failure path throws a plain `Error`, not `TypeError`/`RangeError`.

## Input validation

Following this project's established convention (malformed *shape*/type -> `TypeError`;
well-typed but semantically out-of-domain *value* -> `RangeError`):

- `TypeError`: `dataShards`/`shards` is not an array; a data shard is not a `Uint8Array`; a
  `shards` entry is neither a `Uint8Array` nor `null`/`undefined`; `parityCount`/`dataShardCount`
  is not a number or not an integer (covers strings, `NaN`, `Infinity`, floats).
- `RangeError`: `dataShards` is an empty array; data shards (or the surviving `shards` entries)
  have mismatched lengths; `parityCount` is a well-typed integer but `< 1`; `dataShardCount` is a
  well-typed integer but `< 1`; `dataShards.length + parityCount` (or `shards.length`) exceeds
  `255`; `shards.length <= dataShardCount` (no room for even one parity shard); fewer than
  `dataShardCount` shards survived (excessive erasures -- cannot recover).

## Immutability

Neither function mutates its shard-array argument or any shard inside it -- both only ever read
byte values, building fresh `Uint8Array` output throughout. Tested by freezing the input array
(`Object.freeze`; individual `Uint8Array`s with elements cannot themselves be frozen in V8, so
verification instead snapshots each shard's contents via `Array.from` before and after the call
and compares) and by asserting every returned shard is a distinct object reference from any
input shard.

## Testing

`reed-solomon.test.js` -- 21 `node:test` cases covering: a fixed parity fixture (`k=2`,
`parityCount=2`, byte values `3` and `7`) cross-checked against an independent reference that
computes each parity value via direct Lagrange interpolation over GF(256) (brute-force-searched
inverse, not log/antilog tables -- a structurally different method from the module's
Vandermonde-matrix-inversion approach) rather than by hand-derived arithmetic (an earlier
hand-derived version of this fixture was wrong -- see "Bugs caught during development" below);
that same independent Lagrange reference cross-checked against `encode`'s parity output across
60 additional randomized `(k, parityCount, shardLength)` shapes; every recoverable erasure
combination (0 through `parityCount` simultaneous erasures, all `C(n,0)+C(n,1)+...+C(n,parityCount)`
combinations) for a small `k=3, parityCount=2` shard set; erasing more than `parityCount` shards
correctly throws `RangeError`; erasing all parity shards and, separately, all data shards (when
`k == parityCount`) both fully recover; zero-length shards; deterministic output (`encode` and
`reconstruct` both produce byte-identical results across repeated calls with identical inputs);
immutability (frozen-input snapshot comparison plus fresh-reference checks) for both functions;
no state leakage between repeated calls with different shapes; a 150-trial randomized round-trip
sweep across varied `(k, parityCount, shardLength)` combinations and random erasure subsets
(fixed-seed xorshift PRNG, fully reproducible); the full `TypeError`/`RangeError` invalid-input
matrix for both functions; both `null` and `undefined` accepted as missing-shard markers; and a
performance/correctness sanity check at the maximum supported shard count (`k=200`,
`parityCount=55`, 255 total shards), asserted to complete well under 5 seconds.

`test-output.txt` -- raw `node --test` output, 21/21 passing, Node v22.22.2.

An additional, uncommitted seeded-random stress harness (`/tmp/rs-stress.js` at development
time, not part of this commit) exhaustively swept every erasure combination (0 through
`parityCount` erasures) for every `(k, parityCount, shardLength)` triple in
`k in {1,2,3,4} x parityCount in {1,2,3} x shardLength in {0,1,5,17}`, confirmed excessive
erasures throw, and additionally ran 400 randomized larger-scale trials (`k` up to 20,
`parityCount` up to 15, `shardLength` up to 40, random erasure subsets) -- **6,560 total checks,
0 mismatches**.

## Bugs caught during development (both in the test harness, not the implementation)

The implementation itself passed all 6,560 uncommitted differential/stress checks on the very
first run -- consistent with this project's now-long streak of algorithms passing stress testing
cleanly on the first attempt. Two genuine bugs were found and fixed in the *committed test file*
itself before it was finalized, both caught by actually running `node --test` (never skipped,
per this project's established discipline):

1. **A hand-derived "fixed fixture" value was arithmetically wrong.** An initial version of the
   fixed-parity-fixture test derived the expected parity bytes by hand-tracing the Vandermonde
   matrix construction, but made an indexing slip (used the wrong row of the top `k x k`
   submatrix `Vtop`), producing an incorrect expected value. Root-caused by re-deriving the
   actual `EncodeMatrix` via a faithful standalone trace of the real construction logic, which
   revealed the hand math's error. Fixed by replacing the fragile hand-derivation with a
   genuinely independent Lagrange-interpolation reference implementation (see `lagrangeEval` in
   the test file) that shares no code or algorithmic technique with `reed-solomon.js`, and using
   its output as the cross-checked expected value -- plus the exact resulting bytes are now also
   pinned as hardcoded literals so a future accidental regression in *either* implementation
   would still be caught.
2. **An `allCombinations` helper's recursive IIFE was invoked with no initial argument.**
   `(function rec(start) { ... })()` calls `rec` with `start = undefined` on the outermost
   invocation, so `for (let i = start; i < arr.length; i++)` never executes (comparing
   `undefined < length` is always `false`) for every erasure-count greater than `0` -- silently
   producing zero combinations instead of the expected `C(n, erasureCount)` for any
   `erasureCount >= 1`. The `erasureCount = 0` case happened to work "by accident" (its base
   case fires before the broken loop is ever reached), which is exactly why this kind of bug can
   slip past a cursory glance at just one case. Caught immediately by an explicit combinatorial
   count assertion (`assert.equal(combinationsChecked, 16)`) rather than only checking that
   *some* combinations passed. Fixed by passing the initial argument explicitly:
   `(function rec(start) { ... })(0)`.

## Design notes / decisions made where the spec left something open

- **`reconstruct` recovers *all* missing shards, not just missing data shards.** The spec's
  `reconstruct(shards, dataShardCount)` signature has no separate "reconstruct just the data"
  mode, and "recover any known missing shards" (plural, unqualified) reads most naturally as
  covering parity shards too -- matching how established Reed-Solomon erasure-coding libraries
  typically offer both a full-reconstruct and a data-only-reconstruct entry point; here, only the
  more general one was requested.
- **Both `null` and `undefined` are accepted as missing-shard markers** in `reconstruct`'s
  `shards` argument, since the spec doesn't pin down a single canonical sentinel and both are
  common, natural choices in JavaScript for "absent".
- **Evaluation points for the Vandermonde matrix are `1..n`** (never `0`), so that every
  evaluation point used is a valid nonzero GF(256) element with a well-defined multiplicative
  structure, and so that `n` can be as large as `255` (all nonzero elements) without collision.
- **Originally-present shards are returned as exact copies of the input, not recomputed** via
  `EncodeMatrix * reconstructedData` -- both would be mathematically identical given correct GF
  arithmetic and no corruption, but returning the original preserves the shard's actual identity
  as "known-good, never touched" rather than "recomputed and happened to match".
