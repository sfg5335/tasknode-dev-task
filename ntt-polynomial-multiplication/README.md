# Deterministic NTT Polynomial Multiplication

A single-file, dependency-free Node.js module for polynomial convolution
modulo `998244353`, computed via an iterative radix-2 Number-Theoretic
Transform (NTT) over BigInt coefficients — a new computational-algebra
artifact, distinct from every prior tree/matching/flow/string-index task in
this repo.

## API

```js
const { MOD, convolve } = require('./ntt-polynomial-multiplication.js');

MOD; // 998244353n

convolve(a, b); // a, b: arrays of BigInt coefficients, index i = coefficient of x^i
```

- `MOD` — the modulus, exported as the exact `BigInt` `998244353n`. This is
  the standard "NTT-friendly" prime: `998244353 = 119 * 2^23 + 1`, so its
  multiplicative group (order `998244352 = 119 * 2^23`) contains a
  primitive root of unity of every power-of-two order up to `2^23`. `3` is
  a primitive root of the full group modulo this prime (a well-known
  constant specific to `998244353`), so `3^((MOD-1)/n)` is a primitive
  `n`-th root of unity for any power-of-two `n <= 2^23`.
- `convolve(a, b)` — multiplies two polynomials given as arrays of `BigInt`
  coefficients (`a[i]`/`b[i]` is the coefficient of `x^i`), modulo `MOD`.
  - Returns `[]` if either `a` or `b` is empty.
  - Otherwise returns an array of exactly `a.length + b.length - 1`
    `BigInt` coefficients — the full convolution length. Trailing zero
    coefficients are **never trimmed**: convolving two length-2
    polynomials always returns a length-3 array, even when the true
    polynomial product has lower degree (e.g. `(1 + 0x) * (1 + 0x) = 1`
    still returns `[1n, 0n, 0n]`, not `[1n]`).
  - Coefficients may be any `BigInt` — negative, zero, or `>= MOD` — and
    each is reduced into the canonical range `[0, MOD)` before
    multiplying; every output coefficient is likewise in `[0, MOD)`.
  - Never mutates `a` or `b`.
  - Throws `TypeError` if `a` or `b` is not an `Array`, or if any element
    of either is not a `bigint` (a plain `Number`, `string`, `null`, etc.
    all throw — `BigInt` is the required coefficient type throughout,
    matching the task's own "BigInt coefficients" requirement).
  - Throws `RangeError` if the required transform size would exceed
    `2^23` (the largest power-of-two order this modulus' multiplicative
    group supports) — i.e. if `a.length + b.length - 1` exceeds `2^23`.
    Not reachable by the "small inputs" this task targets; documented for
    completeness.

## Algorithm

`convolve` pads both inputs (after reducing every coefficient into
`[0, MOD)`) with zeros out to `size`, the smallest power of two at least as
large as the true result length `a.length + b.length - 1`. It then:

1. Runs the forward NTT on each padded array (`ntt(fa, false)`,
   `ntt(fb, false)`).
2. Multiplies the two transforms pointwise, mod `MOD`.
3. Runs the inverse NTT on the pointwise product (`ntt(product, true)`),
   which internally multiplies every output by the modular inverse of
   `size` (Fermat's-little-theorem inverse, since `MOD` is prime) — the
   "modular normalization" step.
4. Truncates the result to the true `a.length + b.length - 1` coefficients
   (this is where trailing zero coefficients are deliberately *not*
   further trimmed).

The transform itself (`ntt`) is the standard iterative (non-recursive)
Cooley-Tukey decimation-in-time butterfly network: a bit-reversal
permutation first, then `log2(size)` butterfly stages, each stage `i`
combining pairs of elements `2^i` apart using powers of the primitive
`len`-th root of unity `3^((MOD-1)/len)` (or its modular inverse, for the
inverse transform). It operates entirely on a fresh copy of its input
(`bitReversalPermute` always allocates a new array), so `ntt`, and by
extension `convolve`, never mutates the caller's arrays.

### Design choices not pinned down by the task spec

- **Coefficient type is exactly `bigint`, checked with `typeof`.** The
  task's description explicitly calls for "BigInt coefficients," and using
  the strict `bigint` primitive type throughout (rather than accepting
  plain numbers and auto-converting) means there is never an ambiguous
  "is this integer safe to convert" question — every coefficient one
  `BigInt(...)` call away from being an exact input, and every rejection
  is an unambiguous `TypeError`. Since `BigInt` values are always
  integers by construction, there is no separate "non-integer" failure
  mode to distinguish (unlike this repo's `Number`-coefficient tasks,
  which need a `TypeError`-vs-`RangeError` split for that) — invalid
  *type* is the only rejection case, so it is uniformly `TypeError`.
- **Out-of-canonical-range coefficients (negative, or `>= MOD`) are
  silently reduced, not rejected.** The task explicitly requires "modular
  normalization" as an implementation step and describes convolution
  "modulo 998244353," i.e. the whole computation is inherently a mod-`MOD`
  ring operation — an input coefficient of `-1n` or `MOD + 5n` is a
  perfectly well-defined ring element (`MOD - 1n` and `5n` respectively),
  not an error. This is exercised directly by the "boundary coefficients"
  tests.
- **`RangeError` for a transform size beyond `2^23`.** This modulus'
  multiplicative group only contains power-of-two roots of unity up to
  order `2^23` (`998244352 = 119 * 2^23`); a result length whose next
  power of two exceeds that has no primitive root available under this
  specific modulus, so it is rejected explicitly with a clear message
  rather than silently producing a wrong answer or throwing an opaque
  internal error. This ceiling (over 8 million coefficients) is far
  beyond anything the task's "small inputs" scope would ever reach.

## Testing

`ntt-polynomial-multiplication.test.js` (committed, 24 tests, `node:test` /
`node:assert/strict`, no external dependencies) covers: the exported `MOD`
constant; empty-input handling (either or both arrays empty); zero and
identity products (an all-zero polynomial, multiplying by `[1n]`, one
hand-derived small example); unequal-length inputs; trailing-zero
preservation (both a minimal 2x2 case and a larger unequal-length case);
boundary coefficients (`MOD - 1n` behaving as `-1`, negative BigInts,
`MOD` itself reducing to `0n`, a coefficient several multiples of `MOD`
past zero, and a mixed vector cross-checked against the reference);
repeatability/determinism and no-input-mutation; the full invalid-input
surface (non-array arguments, non-BigInt elements including `Number`,
`string`, `null`, `undefined`, `NaN`); a dedicated sweep of result lengths
immediately below, at, and immediately above six consecutive power-of-two
transform-size boundaries (`2` through `64`), each cross-checked against
the independent reference; the degenerate size-1 transform; and two
fixed-seed randomized differential-coverage blocks —
`test('deterministic randomized differential coverage: at least 500 small
polynomial pairs against an independent O(n^2) BigInt reference', ...)`
(seed `mulberry32(0xc0ffee)`, 600 trials, coefficient lengths up to 12) and
`test('deterministic randomized differential coverage: larger polynomial
pairs (sparse sampling of sizes) against the reference', ...)` (seed
`mulberry32(0x5eed5eed)`, 150 trials, coefficient lengths up to 80) — both
driving a separately implemented, deliberately naive `referenceConvolve`
(a direct `O(n^2)` double loop, no NTT, no bit tricks) defined in the test
file itself.

An additional, uncommitted `fuzz.js` (not part of the submitted evidence,
run locally for extra confidence before the committed suite was even
written, per this repo's own established practice) ran a wider sweep
against the same kind of independent `O(n^2)` reference: 4,000 small-dense
trials (seed `0xc0ffee`, lengths up to 12), 1,500 larger trials (seed
`0x5eed5eed`, lengths up to 300), 2,000 wide-magnitude trials exercising
negative/`>= MOD`/multi-limb-huge BigInt coefficients (seed `0xfeedface`),
and 87 deliberately-constructed exact-power-of-two /
off-by-one-from-power-of-two boundary cases (seed `0xb0eda12`) — **7,587
total checks, 0 mismatches**.

## Verification performed

- `node --test ntt-polynomial-multiplication.test.js` run in this
  directory: all 24 tests passed, 0 failures. See `test-output.txt` for
  the full TAP output, captured from a clean checkout with no `npm
  install` step.
- The uncommitted `fuzz.js` was run manually (`node fuzz.js`) before
  writing the committed suite and reported `Total checks: 7587,
  mismatches: 0`.
- No external dependencies: `ntt-polynomial-multiplication.js` has no
  `require` at all; the test file only requires Node's built-in
  `node:test` and `node:assert/strict`.
