'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isPrime64, factorize64, MAX_U64 } = require('./factor64.js');

function product(factors) {
  let p = 1n;
  for (const f of factors) p *= f;
  return p;
}

// Independent trial-division reference used to cross-check a range of
// small inputs, per this task's own explicit requirement ("compare a
// range of small inputs against trial division").
function trialIsPrime(n) {
  if (n < 2n) return false;
  if (n < 4n) return true;
  if (n % 2n === 0n) return false;
  for (let i = 3n; i * i <= n; i += 2n) {
    if (n % i === 0n) return false;
  }
  return true;
}
function trialFactorize(n) {
  if (n === 1n) return [];
  const factors = [];
  let m = n;
  let p = 2n;
  while (p * p <= m) {
    while (m % p === 0n) {
      factors.push(p);
      m /= p;
    }
    p += p === 2n ? 1n : 2n;
  }
  if (m > 1n) factors.push(m);
  return factors;
}

// ---------------------------------------------------------------------
// Small values, compared against trial division
// ---------------------------------------------------------------------

test('isPrime64 and factorize64 match trial division for every n in 1..5000', () => {
  for (let i = 1; i <= 5000; i++) {
    const n = BigInt(i);
    assert.equal(isPrime64(n), trialIsPrime(n), `isPrime64 mismatch at n=${n}`);
    assert.deepEqual(factorize64(n), trialFactorize(n), `factorize64 mismatch at n=${n}`);
  }
});

test('factorize64(1n) is an empty array', () => {
  assert.deepEqual(factorize64(1n), []);
});

test('isPrime64(1n) is false (1 is not prime by convention)', () => {
  assert.equal(isPrime64(1n), false);
});

test('small primes and composites are classified correctly', () => {
  assert.equal(isPrime64(2n), true);
  assert.equal(isPrime64(3n), true);
  assert.equal(isPrime64(4n), false);
  assert.equal(isPrime64(5n), true);
  assert.equal(isPrime64(9n), false);
  assert.equal(isPrime64(97n), true);
  assert.equal(isPrime64(100n), false);
});

// ---------------------------------------------------------------------
// Prime powers and repeated factors
// ---------------------------------------------------------------------

test('prime powers factor to the same prime repeated', () => {
  assert.deepEqual(factorize64(1024n), [2n, 2n, 2n, 2n, 2n, 2n, 2n, 2n, 2n, 2n]); // 2^10
  assert.deepEqual(factorize64(59049n), [3n, 3n, 3n, 3n, 3n, 3n, 3n, 3n, 3n, 3n]); // 3^10
  assert.deepEqual(factorize64(16807n), [7n, 7n, 7n, 7n, 7n]); // 7^5
});

test('repeated factors across distinct primes are all reported with correct multiplicity', () => {
  assert.deepEqual(factorize64(12n), [2n, 2n, 3n]); // 2^2 * 3
  assert.deepEqual(factorize64(360n), [2n, 2n, 2n, 3n, 3n, 5n]); // 2^3 * 3^2 * 5
  // 2^6 * 3^3 * 5^2 = 43200
  assert.deepEqual(factorize64(43200n),
    [2n, 2n, 2n, 2n, 2n, 2n, 3n, 3n, 3n, 5n, 5n]);
});

// ---------------------------------------------------------------------
// Carmichael numbers (composite numbers that pass Fermat's test for every
// coprime base -- Miller-Rabin must still correctly reject them)
// ---------------------------------------------------------------------

test('Carmichael numbers are correctly identified as composite', () => {
  const carmichaels = [561n, 1105n, 1729n, 2465n, 2821n, 6601n, 8911n, 10585n, 15841n, 29341n, 41041n, 46657n, 62745n, 63973n, 75361n, 101101n, 340561n];
  for (const c of carmichaels) {
    assert.equal(isPrime64(c), false, `Carmichael number ${c} incorrectly reported prime`);
    assert.equal(product(factorize64(c)), c, `Carmichael number ${c} factors don't reconstruct`);
  }
});

test('the smallest Carmichael number 561 factors as 3 x 11 x 17', () => {
  assert.deepEqual(factorize64(561n), [3n, 11n, 17n]);
});

// ---------------------------------------------------------------------
// Large primes, including boundary values
// ---------------------------------------------------------------------

test('large known primes are correctly identified, including near the 64-bit boundary', () => {
  const knownPrimes = [
    2147483647n, // 2^31 - 1, Mersenne prime
    4294967291n, // largest prime below 2^32
    2305843009213693951n, // 2^61 - 1, Mersenne prime
    18446744073709551557n, // largest prime below 2^64
  ];
  for (const p of knownPrimes) {
    assert.equal(isPrime64(p), true, `${p} should be prime`);
    assert.deepEqual(factorize64(p), [p]);
  }
});

test('2^64 - 1 is composite and matches its known factorization', () => {
  assert.equal(isPrime64(MAX_U64), false);
  assert.deepEqual(factorize64(MAX_U64), [3n, 5n, 17n, 257n, 641n, 65537n, 6700417n]);
  assert.equal(product(factorize64(MAX_U64)), MAX_U64);
});

// ---------------------------------------------------------------------
// Known semiprimes, including a hard 64-bit-boundary case
// ---------------------------------------------------------------------

test('known semiprimes factor into exactly their two prime factors', () => {
  assert.deepEqual(factorize64(15n), [3n, 5n]);
  assert.deepEqual(factorize64(999999929n * 999999937n), [999999929n, 999999937n]);
});

test('a hard 64-bit semiprime (product of two ~32-bit primes) factors correctly', () => {
  const p = 4294967279n;
  const q = 4294967291n;
  const n = p * q;
  assert.ok(n <= MAX_U64, 'sanity: semiprime must fit in 64 bits');
  assert.deepEqual(factorize64(n), [p, q]);
  assert.equal(isPrime64(n), false);
});

// ---------------------------------------------------------------------
// Invalid inputs
// ---------------------------------------------------------------------

test('isPrime64 rejects non-BigInt input with TypeError', () => {
  for (const v of [42, '42', null, undefined, {}, [], true, 3.14, NaN, Infinity]) {
    assert.throws(() => isPrime64(v), TypeError, `isPrime64(${String(v)}) should throw TypeError`);
  }
});

test('factorize64 rejects non-BigInt input with TypeError', () => {
  for (const v of [42, '42', null, undefined, {}, [], true, 3.14, NaN, Infinity]) {
    assert.throws(() => factorize64(v), TypeError, `factorize64(${String(v)}) should throw TypeError`);
  }
});

test('isPrime64 and factorize64 reject values outside [1, 2^64 - 1] with RangeError', () => {
  const invalid = [0n, -1n, -1000000n, MAX_U64 + 1n, MAX_U64 + 1000000n];
  for (const v of invalid) {
    assert.throws(() => isPrime64(v), RangeError, `isPrime64(${v}) should throw RangeError`);
    assert.throws(() => factorize64(v), RangeError, `factorize64(${v}) should throw RangeError`);
  }
});

test('boundary values 1n and 2^64 - 1 are accepted (no throw) as valid domain endpoints', () => {
  assert.doesNotThrow(() => isPrime64(1n));
  assert.doesNotThrow(() => isPrime64(MAX_U64));
  assert.doesNotThrow(() => factorize64(1n));
  assert.doesNotThrow(() => factorize64(MAX_U64));
});

// ---------------------------------------------------------------------
// Sorted output
// ---------------------------------------------------------------------

test('factorize64 always returns factors in ascending order', () => {
  const values = [2 * 3 * 5 * 7 * 11 * 13, 999999999989, 4294967291];
  for (const v of values) {
    const factors = factorize64(BigInt(v));
    for (let i = 1; i < factors.length; i++) {
      assert.ok(factors[i - 1] <= factors[i], `factors not sorted for ${v}: ${factors}`);
    }
  }
});

// ---------------------------------------------------------------------
// Repeatable results (determinism -- no randomness or time-based behavior)
// ---------------------------------------------------------------------

test('factorize64 and isPrime64 produce identical repeated results for the same input', () => {
  const values = [561n, 1729n, 4294967291n, MAX_U64, 999999999989n];
  for (const v of values) {
    assert.deepEqual(factorize64(v), factorize64(v));
    assert.equal(isPrime64(v), isPrime64(v));
  }
});

test('two independent factorizations of a hard semiprime are byte-for-byte identical', () => {
  const n = 4294967279n * 4294967291n;
  const a = factorize64(n);
  const b = factorize64(n);
  assert.deepEqual(a, b);
});

// ---------------------------------------------------------------------
// Structural invariant: reconstruction and all-factors-prime, across a
// spread of random-ish values at different magnitudes
// ---------------------------------------------------------------------

test('reconstructed product of factors always equals the original n, across many magnitudes', () => {
  const values = [
    2n, 3n, 4n, 100n, 1000n, 123456789n, 987654321n,
    4294967296n, // 2^32
    18446744073709551615n, // 2^64 - 1
    18446744073709551557n, // largest prime below 2^64
    999999999989n * 3n, // a large prime times a small one
  ];
  for (const n of values) {
    const factors = factorize64(n);
    assert.equal(product(factors), n, `reconstruction failed for ${n}: ${factors}`);
    for (const f of factors) {
      assert.equal(isPrime64(f), true, `factor ${f} of ${n} is not prime`);
    }
  }
});
