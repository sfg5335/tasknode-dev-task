'use strict';

// Deterministic polynomial convolution modulo 998244353 via an iterative
// radix-2 Number-Theoretic Transform (NTT), with BigInt coefficients
// throughout.
//
// MOD = 998244353 = 119 * 2^23 + 1 is the standard "NTT-friendly" prime:
// its multiplicative group has order MOD - 1 = 119 * 2^23, so it contains
// primitive roots of unity of every power-of-two order up to 2^23. 3 is a
// primitive root of the full group modulo MOD (a well-known constant for
// this specific prime), so 3^((MOD-1)/n) is a primitive n-th root of unity
// for any power-of-two n <= 2^23.

const MOD = 998244353n;
const PRIMITIVE_ROOT = 3n;

// Largest power-of-two transform size supported without falling outside the
// multiplicative group's power-of-two subgroup (2^23 divides MOD - 1).
const MAX_TRANSFORM_LOG2 = 23;

/**
 * Reduce an arbitrary (possibly negative, possibly huge) BigInt into the
 * canonical representative range [0, MOD).
 */
function mod(x) {
  const r = x % MOD;
  return r < 0n ? r + MOD : r;
}

/**
 * Modular exponentiation: base^exp mod MOD (exp must be a non-negative
 * BigInt).
 */
function modPow(base, exp) {
  let b = mod(base);
  let e = exp;
  let result = 1n;
  while (e > 0n) {
    if (e & 1n) {
      result = (result * b) % MOD;
    }
    b = (b * b) % MOD;
    e >>= 1n;
  }
  return result;
}

/**
 * Modular multiplicative inverse via Fermat's little theorem (MOD is
 * prime, so x^(MOD-2) === x^-1 (mod MOD) for any x not divisible by MOD).
 */
function modInverse(x) {
  return modPow(x, MOD - 2n);
}

/** floor(log2(n)) for a positive integer n that the caller has already
 * guaranteed is an exact power of two (or 1). Uses Math.clz32, which
 * operates on exact 32-bit integers with no floating-point rounding, so
 * this is exact for every size this module ever constructs (up to
 * 2^MAX_TRANSFORM_LOG2, far below the 32-bit range).
 */
function log2PowerOfTwo(n) {
  return 31 - Math.clz32(n);
}

/**
 * Standard bit-reversal permutation used as the first stage of an
 * iterative (non-recursive) radix-2 FFT/NTT. Returns a fresh array; never
 * mutates the input.
 */
function bitReversalPermute(values) {
  const n = values.length;
  const bits = log2PowerOfTwo(n);
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    let rev = 0;
    let x = i;
    for (let b = 0; b < bits; b++) {
      rev = (rev << 1) | (x & 1);
      x >>= 1;
    }
    out[rev] = values[i];
  }
  return out;
}

/**
 * In-place-on-its-own-copy iterative radix-2 NTT (Cooley-Tukey decimation
 * in time). `values.length` must be a power of two (including 1).
 * `invert` selects the inverse transform (uses the modular-inverse root of
 * unity and divides every output by n at the end -- the "modular
 * normalization" step). Returns a fresh array; never mutates `values`.
 */
function ntt(values, invert) {
  const n = values.length;
  const a = bitReversalPermute(values);

  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    let wLen = modPow(PRIMITIVE_ROOT, (MOD - 1n) / BigInt(len));
    if (invert) {
      wLen = modInverse(wLen);
    }
    for (let start = 0; start < n; start += len) {
      let w = 1n;
      for (let j = 0; j < half; j++) {
        const u = a[start + j];
        const v = (a[start + j + half] * w) % MOD;
        a[start + j] = (u + v) % MOD;
        a[start + j + half] = mod(u - v);
        w = (w * wLen) % MOD;
      }
    }
  }

  if (invert) {
    const nInv = modInverse(BigInt(n));
    for (let i = 0; i < n; i++) {
      a[i] = (a[i] * nInv) % MOD;
    }
  }

  return a;
}

function validateCoefficients(value, name) {
  if (!Array.isArray(value)) {
    throw new TypeError(`${name} must be an array of BigInt coefficients`);
  }
  for (let i = 0; i < value.length; i++) {
    if (typeof value[i] !== 'bigint') {
      throw new TypeError(
        `${name}[${i}] must be a BigInt (got ${typeof value[i]})`
      );
    }
  }
}

/**
 * Multiply two polynomials (given as arrays of BigInt coefficients, index
 * i holding the coefficient of x^i) modulo MOD, via NTT-based convolution.
 *
 * - Returns `[]` if either `a` or `b` is empty.
 * - Otherwise returns an array of exactly `a.length + b.length - 1`
 *   BigInt coefficients (the full convolution length) -- trailing zero
 *   coefficients are never trimmed, so e.g. convolving two length-2
 *   polynomials always returns a length-3 array even if the true
 *   polynomial product has lower degree.
 * - Coefficients may be any BigInt (negative, zero, >= MOD); each is
 *   reduced into [0, MOD) before multiplying, and every output
 *   coefficient is in [0, MOD).
 * - Never mutates `a` or `b`.
 */
function convolve(a, b) {
  validateCoefficients(a, 'a');
  validateCoefficients(b, 'b');

  if (a.length === 0 || b.length === 0) {
    return [];
  }

  const resultLength = a.length + b.length - 1;

  let size = 1;
  while (size < resultLength) {
    size <<= 1;
  }
  if (log2PowerOfTwo(size) > MAX_TRANSFORM_LOG2) {
    throw new RangeError(
      `result length ${resultLength} requires a transform size of ${size}, ` +
        `which exceeds the largest supported power-of-two transform size ` +
        `2^${MAX_TRANSFORM_LOG2} for modulus ${MOD}`
    );
  }

  const fa = new Array(size).fill(0n);
  const fb = new Array(size).fill(0n);
  for (let i = 0; i < a.length; i++) {
    fa[i] = mod(a[i]);
  }
  for (let i = 0; i < b.length; i++) {
    fb[i] = mod(b[i]);
  }

  const faTransformed = ntt(fa, false);
  const fbTransformed = ntt(fb, false);

  const pointwise = new Array(size);
  for (let i = 0; i < size; i++) {
    pointwise[i] = (faTransformed[i] * fbTransformed[i]) % MOD;
  }

  const result = ntt(pointwise, true);
  return result.slice(0, resultLength);
}

module.exports = { MOD, convolve };
