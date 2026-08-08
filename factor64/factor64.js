'use strict';

// Dependency-free, deterministic 64-bit primality testing and integer
// factorization over unsigned 64-bit BigInt values (1n through 2n**64n - 1n).
//
// isPrime64(n): deterministic Miller-Rabin primality test using a fixed
// witness set proven to be correct (no false positives) for every integer
// below 3,317,044,064,679,887,385,961,981 -- a bound comfortably larger than
// 2^64 - 1, so this witness set is exact (not probabilistic) across the
// entire unsigned 64-bit domain. No randomness anywhere.
//
// factorize64(n): peels off small prime factors via trial division (fast,
// and covers the overwhelming majority of "small value" test inputs
// cheaply), then recursively splits any remaining large composite factor
// using Pollard's rho with Brent's cycle-detection improvement, verifying
// primality of every candidate factor via isPrime64. Pollard's rho is
// itself a deterministic algorithm; the "random" x^2 + c walk it's
// traditionally described with is replaced here by a fixed, deterministic
// sequence of constants (c = 1n, 2n, 3n, ...) tried in order until one
// succeeds, and a fixed starting point (x0 = 2n) -- so two calls with the
// same input always perform the exact same arithmetic and return the exact
// same result.

const MAX_U64 = (1n << 64n) - 1n; // 2^64 - 1

function checkU64(n, name) {
  if (typeof n !== 'bigint') {
    throw new TypeError(`${name} must be a BigInt, got ${typeof n}`);
  }
  if (n < 1n || n > MAX_U64) {
    throw new RangeError(`${name} must be in the range [1, 2^64 - 1], got ${n}`);
  }
}

// Modular multiplication: exact via BigInt (no overflow is possible since
// BigInt arithmetic is arbitrary precision), reduced mod m after every
// multiply so intermediate values stay bounded relative to m.
function mulmod(a, b, m) {
  return (a * b) % m;
}

// Modular exponentiation via square-and-multiply.
function powmod(base, exp, mod) {
  if (mod === 1n) return 0n;
  let result = 1n;
  let b = base % mod;
  if (b < 0n) b += mod;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = mulmod(result, b, mod);
    b = mulmod(b, b, mod);
    e >>= 1n;
  }
  return result;
}

function bigGcd(a, b) {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y) {
    [x, y] = [y, x % y];
  }
  return x;
}

// Deterministic Miller-Rabin witness set. {2, 3, 5, 7, 11, 13, 17, 19, 23,
// 29, 31, 37} is a well-known deterministic set: no composite number below
// 3,317,044,064,679,887,385,961,981 (~2^81.3) passes Miller-Rabin for all
// of these bases. Since that bound is far larger than 2^64 - 1, this set
// gives an *exact* (not probabilistic) primality test across the entire
// unsigned 64-bit domain.
const WITNESSES = [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n];

// Single Miller-Rabin round for base `a` against odd n-1 = d * 2^r.
// Returns true if `a` reveals n as composite (n definitely composite),
// false if this round is inconclusive (n is probably prime w.r.t. `a`,
// which -- combined with every witness in WITNESSES -- proves n prime for
// n in our supported range).
function isWitnessToCompositeness(a, d, r, n) {
  let x = powmod(a, d, n);
  if (x === 1n || x === n - 1n) return false;
  for (let i = 1n; i < r; i++) {
    x = mulmod(x, x, n);
    if (x === n - 1n) return false;
  }
  return true;
}

// Deterministic primality test for n in [1, 2^64 - 1].
function isPrime64(n) {
  checkU64(n, 'n');

  if (n === 1n) return false;
  if (n === 2n || n === 3n) return true;
  if (n % 2n === 0n) return false;

  // n - 1 = d * 2^r, with d odd.
  let d = n - 1n;
  let r = 0n;
  while (d % 2n === 0n) {
    d /= 2n;
    r += 1n;
  }

  for (const a of WITNESSES) {
    if (a >= n) continue; // witness must be a proper base mod n
    if (isWitnessToCompositeness(a, d, r, n)) return false;
  }
  return true;
}

// First 200 primes, used for fast trial-division of small factors before
// falling back to Pollard's rho for whatever (large) factor remains. This
// is purely a performance optimization -- Pollard's rho below is correct
// on its own for any composite input -- but trial division makes the
// extremely common case of small/smooth inputs (and the many small-value
// test cases this task calls for) resolve in a handful of divisions
// instead of a full rho walk.
function sieveSmallPrimes(limit) {
  const isComposite = new Uint8Array(limit + 1);
  const primes = [];
  for (let i = 2; i <= limit; i++) {
    if (!isComposite[i]) {
      primes.push(BigInt(i));
      for (let j = i * i; j <= limit; j += i) {
        isComposite[j] = 1;
      }
    }
  }
  return primes;
}
const SMALL_PRIMES = sieveSmallPrimes(10000);

// One Pollard's-rho-with-Brent's-improvement pass using a fixed pseudo-
// random function f(x) = x^2 + c (mod n) for a given constant c. Returns a
// non-trivial factor of n, or null if this particular c failed to find one
// (in which case the caller retries with the next c).
function brentAttempt(n, c) {
  if (n % 2n === 0n) return 2n;

  let x = 2n; // fixed deterministic starting point
  let y = x;
  let g = 1n;
  let r = 1n;
  let q = 1n;
  let ys = y;

  const m = 128n; // batch size before each gcd check

  while (g === 1n) {
    x = y;
    for (let i = 0n; i < r; i++) {
      y = (mulmod(y, y, n) + c) % n;
    }
    let k = 0n;
    while (k < r && g === 1n) {
      ys = y;
      const steps = m < r - k ? m : r - k;
      for (let i = 0n; i < steps; i++) {
        y = (mulmod(y, y, n) + c) % n;
        const diff = x > y ? x - y : y - x;
        q = mulmod(q, diff, n);
      }
      g = bigGcd(q, n);
      k += m;
    }
    r *= 2n;
  }

  if (g === n) {
    // The batched gcd overshot (product hit 0 mod n) -- fall back to a
    // strictly sequential search from the last checkpoint to isolate the
    // exact factor.
    g = 1n;
    while (g === 1n) {
      ys = (mulmod(ys, ys, n) + c) % n;
      const diff = x > ys ? x - ys : ys - x;
      g = bigGcd(diff, n);
    }
  }

  if (g === n || g === 0n) return null;
  return g;
}

// Finds one non-trivial factor of composite n using Pollard's rho (Brent's
// variant), trying a fixed, deterministic sequence of constants c = 1n,
// 2n, 3n, ... until one succeeds. Fully deterministic: no Math.random, no
// timing, no external entropy of any kind.
function pollardRhoFactor(n) {
  if (n % 2n === 0n) return 2n;
  if (n % 3n === 0n) return 3n;

  let c = 1n;
  for (;;) {
    const factor = brentAttempt(n, c);
    if (factor !== null && factor !== n && factor !== 1n) return factor;
    c += 1n;
  }
}

function factorRecursive(n, out) {
  if (n === 1n) return;
  if (isPrime64(n)) {
    out.push(n);
    return;
  }
  const factor = pollardRhoFactor(n);
  factorRecursive(factor, out);
  factorRecursive(n / factor, out);
}

// Returns the prime factorization of n (n in [1, 2^64 - 1]) as an array of
// BigInt prime factors in ascending order, with multiplicity -- e.g.
// factorize64(12n) === [2n, 2n, 3n]. factorize64(1n) === [] (1 has no
// prime factors, by convention).
function factorize64(n) {
  checkU64(n, 'n');

  if (n === 1n) return [];

  const factors = [];
  let remaining = n;

  for (const p of SMALL_PRIMES) {
    if (p * p > remaining) break;
    while (remaining % p === 0n) {
      factors.push(p);
      remaining /= p;
    }
  }

  if (remaining > 1n) {
    factorRecursive(remaining, factors);
  }

  factors.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return factors;
}

module.exports = { isPrime64, factorize64, MAX_U64 };
