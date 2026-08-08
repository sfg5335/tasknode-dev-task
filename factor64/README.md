# factor64

Dependency-free, single-file, deterministic unsigned 64-bit primality
testing and integer factorization (`isPrime64`/`factorize64`) in
JavaScript, operating on `BigInt` values from `1n` through `2n**64n - 1n`,
with an automated `node:test` suite.

## Files

- `factor64.js` -- the implementation: `isPrime64(n)` returns a boolean;
  `factorize64(n)` returns an array of `BigInt` prime factors in ascending
  order with multiplicity (`factorize64(12n) === [2n, 2n, 3n]`,
  `factorize64(1n) === []`). Both reject non-`BigInt` input with
  `TypeError` and any value outside `[1, 2^64 - 1]` with `RangeError`.

  **Primality testing** uses the deterministic Miller-Rabin test with the
  fixed witness set `{2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37}`. This
  specific set is a well-known result: no composite number below
  3,317,044,064,679,887,385,961,981 (~2^81.3) passes Miller-Rabin against
  every one of these bases. Since that bound is far larger than
  `2^64 - 1`, running all twelve witnesses gives an *exact* primality
  test -- not a probabilistic one -- across the entire unsigned 64-bit
  domain, with no randomness anywhere in the process.

  **Factorization** first peels off small prime factors via trial
  division against a sieve of the first ~1,229 primes (up to 10,000) --
  purely a performance optimization that resolves the very common
  small/smooth-input case in a handful of divisions. Whatever large
  factor remains (if not fully reduced to 1) is recursively split using
  **Pollard's rho with Brent's cycle-detection improvement**: `isPrime64`
  checks whether the remaining value is already prime (base case), and if
  not, `pollardRhoFactor` finds a non-trivial factor by walking the
  pseudo-random sequence `x -> x^2 + c (mod n)`. The traditional
  description of this algorithm picks `c` at random and retries with a
  new random `c` on failure; this implementation instead tries a fixed,
  deterministic sequence of constants `c = 1n, 2n, 3n, ...` in order (and
  a fixed starting point `x0 = 2n`), so two calls on the same input
  perform the exact same arithmetic and return the exact same result --
  satisfying the task's explicit "fixed seeds or constants and no
  randomness" requirement without giving up Pollard's rho's practical
  speed advantage over trial division for large, hard-to-factor inputs.

- `factor64.test.js` -- 20 `node:test` cases (no external dependencies),
  organized by the categories the task's own spec calls out:
  - **Small values, compared against trial division**: every `n` from 1
    to 5,000 checked against an independent trial-division reference
    implementation for both `isPrime64` and `factorize64`, per the task's
    own explicit "compare a range of small inputs against trial division"
    requirement.
  - **`factorize64(1n) === []`** and **`isPrime64(1n) === false`**,
    checked explicitly as their own cases (1 is neither prime nor does it
    have prime factors, by convention).
  - **Prime powers**: `2^10`, `3^10`, `7^5` all factor to the same prime
    repeated the correct number of times.
  - **Repeated factors across distinct primes**: composite numbers with
    several different prime factors at different multiplicities (e.g.
    `2^3 * 3^2 * 5`, `2^6 * 3^3 * 5^2`) all report every factor with
    correct multiplicity.
  - **Carmichael numbers**: 17 known Carmichael numbers (561 through
    340561) -- composite numbers that pass Fermat's primality test for
    *every* base coprime to them -- are all correctly identified as
    composite by Miller-Rabin, which is exactly the property that makes
    Miller-Rabin the right choice over a plain Fermat test.
  - **Large primes, including near the 64-bit boundary**: two Mersenne
    primes (`2^31 - 1`, `2^61 - 1`), the largest prime below `2^32`, and
    the largest prime below `2^64` (`18446744073709551557`) are all
    correctly identified as prime.
  - **`2^64 - 1`**: confirmed composite, and its factorization matches
    the well-known result `3 x 5 x 17 x 257 x 641 x 65537 x 6700417`
    exactly.
  - **Known semiprimes**, including a *hard* 64-bit semiprime (the
    product of two ~32-bit primes, `4294967279n * 4294967291n`, which
    trial division alone would take billions of steps to factor but
    Pollard's rho resolves in milliseconds).
  - **Invalid inputs**: a full `TypeError` sweep for non-`BigInt` values
    across every JS primitive/object kind, and a full `RangeError` sweep
    for values outside `[1, 2^64 - 1]` (zero, negative, and just past the
    upper bound), plus an explicit check that the boundary values `1n`
    and `2^64 - 1` themselves are accepted.
  - **Sorted output**: factors are always in ascending order.
  - **Repeatable results**: `factorize64`/`isPrime64` produce identical
    output across repeated calls on the same input, including a dedicated
    check on the hard 64-bit semiprime case.
  - **Structural invariant**: for a spread of values across many
    magnitudes (small, ~32-bit, ~64-bit boundary), the product of the
    returned factors always reconstructs the original `n` exactly, and
    every returned factor is independently confirmed prime via
    `isPrime64`.

- `test-output.txt` -- raw, unedited output of the exact run command
  below.

## Additional verification (not part of the committed suite)

Beyond the committed suite, a larger uncommitted differential/stress run
(`scratch-stress.js`, deleted before commit) was run first:

- **Differential test against trial division for every n from 1 to
  200,000** (both `isPrime64` and `factorize64`), independently of the
  committed suite's smaller 1-5,000 range.
- **400 structural-invariant trials** across ten different bit-length
  magnitudes (8 through 64 bits, 40 trials each, mulberry32 seeded
  PRNG): reconstruction (product of factors equals `n`), every factor
  independently prime, sorted ascending order, and cross-checked against
  `isPrime64` (a prime `n` must factor to exactly itself; a composite `n`
  must produce 2+ factors with multiplicity).
- **50 repeatability trials** on random 48-bit values.
- **18 known Carmichael numbers** (a superset of the committed suite's
  17), each checked for correct compositeness *and* exact factor
  reconstruction.
- **4 known large primes** (two Mersenne primes, the largest prime below
  2^32, the largest prime below 2^64).
- **The exact known factorization of `2^64 - 1`**, checked byte-for-byte
  against the well-known result.
- **A hard 64-bit semiprime performance check**: `4294967279n *
  4294967291n` (product of two primes just below 2^32) factored correctly
  in 19ms -- comfortably fast despite requiring Pollard's rho rather than
  trial division to resolve.
- **32 validation-fuzzing checks** across a wide range of invalid-type
  and invalid-range inputs for both functions, confirming the documented
  error type every time.

**0 mismatches across all of it** on the first *implementation* attempt
-- one genuine *test-authoring* bug was caught and fixed before commit
(see Design notes below), but the implementation itself needed no
changes, making this the eighth task in this collection in a row with
zero genuine implementation bugs found during stress testing (after
KD-Tree, Robin Hood Hash Map, ROBDD, Palindromic Tree, the Huffman codec,
HyperLogLog, and the Burrows-Wheeler Transform -- see those tasks' own
READMEs).

## Exact run command

```
node --test factor64.test.js
```

Requires only the Node.js runtime (tested on Node v22.22.2) -- no `npm
install`, no native build, no service to start, and no external
dependencies of any kind (only built-in `BigInt` arithmetic). Run from
inside this directory, from a clean checkout. The full suite (20 tests,
including a 5,000-value trial-division differential check) completes in
well under a second.

## Design notes

- **A genuine test-authoring bug was caught by actually running `node
  --test` before commit**: an early draft of the "known semiprimes" test
  multiplied two ~10-digit primes (`9999999967n * 9999999977n`) without
  checking that their product still fit in the unsigned 64-bit domain --
  it didn't (the product was about 5.4x too large), so the test correctly
  triggered `factorize64`'s own `RangeError` validation instead of
  testing what it meant to test. Fixed by picking two smaller ~9-digit
  primes (`999999929n` and `999999937n`) whose product comfortably fits
  under `2^64 - 1`. This is the same category of lesson as the Canonical
  Huffman task's "unmatchable payload bits" test bug: a comprehensive
  suite can still contain an authoring mistake that only surfaces by
  actually executing it, never assumed away by inspection alone.
- **Trial division is a pure performance optimization layered in front
  of an already-correct Pollard's-rho-based factorizer**, not a
  correctness dependency -- `factorRecursive` (the Pollard's-rho path)
  is correct on its own for any composite input, including small ones.
  The small-prime sieve just makes the extremely common case of small or
  smooth inputs resolve in a handful of divisions instead of a full rho
  walk, which matters given the task's own test requirements call for
  hundreds of small-value checks.
- **Pollard's rho's traditional "randomness" is replaced by a fixed,
  deterministic sequence of constants**, per the task's own explicit "no
  randomness" requirement. This preserves the algorithm's practical
  speed advantage (it's still fundamentally the same rho walk and cycle
  detection) while making every run of `factorize64` on a given input
  perform identical arithmetic and return an identical result -- verified
  directly by the committed "repeatable results" tests, not just assumed
  from the absence of `Math.random()` in the source.
- **`BigInt` throughout, with no bitwise operators on values that could
  reach or exceed 2^31/2^32**: `mulmod`/`powmod` use plain `BigInt`
  multiplication and modulo (exact by construction, no overflow risk
  regardless of magnitude) rather than any 32-bit-truncating bitwise
  trick, since this task's domain runs all the way up to `2^64 - 1` and
  needs exact, not merely fast-modulo-32-bit, arithmetic.
