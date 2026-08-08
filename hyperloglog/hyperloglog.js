'use strict';

// Deterministic HyperLogLog cardinality estimator.
//
// Streaming approximate-distinct-count sketch (Flajolet, Fusy, Gandouet,
// Meunier, 2007), using only Node.js built-ins (`crypto` for SHA-256,
// `Buffer` for UTF-8 encoding) -- no external dependencies.
//
// Overview: each added string is hashed deterministically to a 64-bit
// value. The top `precision` bits of the hash select one of `2^precision`
// registers; the remaining `64 - precision` bits are used to compute a
// "rank" (1 + the number of leading zero bits in that remainder, i.e. the
// position of the first 1-bit). Each register stores the *maximum* rank
// ever observed for any string that mapped to it. Longer leading-zero runs
// are exponentially rarer, so the maximum observed run length across many
// registers gives an estimate of how many distinct items were likely
// added, without ever storing the items themselves.

const crypto = require('crypto');

const MIN_PRECISION = 4;
const MAX_PRECISION = 16;
const HASH_BITS = 64n;

function checkPrecision(precision) {
  if (
    typeof precision !== 'number' ||
    !Number.isInteger(precision) ||
    precision < MIN_PRECISION ||
    precision > MAX_PRECISION
  ) {
    throw new RangeError(
      `precision must be an integer between ${MIN_PRECISION} and ${MAX_PRECISION}, got ${String(precision)}`
    );
  }
}

// Standard HyperLogLog bias-correction constant alpha_m, as a function of
// the register count m = 2^precision. The three small special cases
// (m = 16, 32, 64) match the original paper; the general asymptotic
// formula is used for every larger m (m >= 128, i.e. precision >= 7).
function alphaForM(m) {
  if (m === 16) return 0.673;
  if (m === 32) return 0.697;
  if (m === 64) return 0.709;
  return 0.7213 / (1 + 1.079 / m);
}

// Hash a UTF-8 string deterministically to a 64-bit unsigned BigInt, using
// the first eight bytes of its SHA-256 digest, interpreted big-endian
// (most significant byte first). SHA-256 is deterministic and stable
// across Node versions/platforms, which is what makes every downstream
// estimate exactly reproducible from the same input strings.
function hash64(str) {
  const digest = crypto.createHash('sha256').update(Buffer.from(str, 'utf8')).digest();
  let hash = 0n;
  for (let i = 0; i < 8; i++) {
    hash = (hash << 8n) | BigInt(digest[i]);
  }
  return hash;
}

// Position (1-indexed) of the leftmost 1-bit within a `width`-bit value,
// counting from the most significant bit. If the value is entirely zero
// (all `width` bits are zero -- astronomically rare for real hash
// outputs, but must still be handled), returns `width + 1` by convention,
// representing "a leading-zero run at least as long as the whole
// remainder".
function leadingOneRank(value, width) {
  if (value === 0n) return width + 1;
  let rank = 1;
  for (let bit = width - 1n; bit >= 0n; bit--) {
    if ((value >> bit) & 1n) return rank;
    rank++;
  }
  // Unreachable given the value !== 0n guard above, but keeps the
  // function total.
  return width + 1;
}

class HyperLogLog {
  constructor(precision) {
    checkPrecision(precision);
    this.precision = precision;
    this.m = 1 << precision; // 2^precision registers
    this.registers = new Uint8Array(this.m);
    this._alpha = alphaForM(this.m);
  }

  // Adds one string to the sketch. Mutates in place and returns `this` for
  // chaining. Adding the same string any number of times has the exact
  // same effect as adding it once (idempotent), since the same string
  // always hashes to the same register index and rank.
  add(value) {
    if (typeof value !== 'string') {
      throw new TypeError('value must be a string');
    }
    const hash = hash64(value);
    const p = BigInt(this.precision);
    const remainderWidth = HASH_BITS - p;
    const index = Number(hash >> remainderWidth);
    const remainder = hash & ((1n << remainderWidth) - 1n);
    const rank = leadingOneRank(remainder, remainderWidth);
    if (rank > this.registers[index]) {
      this.registers[index] = rank;
    }
    return this;
  }

  // Returns the current estimated cardinality (a non-negative number, not
  // necessarily an integer). A counter with nothing added to it always
  // estimates exactly 0.
  estimate() {
    let sumInverse = 0;
    let zeroCount = 0;
    for (let j = 0; j < this.m; j++) {
      const r = this.registers[j];
      sumInverse += Math.pow(2, -r);
      if (r === 0) zeroCount++;
    }
    const rawEstimate = (this._alpha * this.m * this.m) / sumInverse;

    // Small-range (linear counting) correction: when the raw estimate is
    // low relative to m, a meaningful fraction of registers are still at
    // 0, and linear counting is the more accurate estimator in that
    // regime. When every register is 0 (an empty/freshly cleared
    // counter), this reduces to m * ln(m / m) = m * ln(1) = 0 exactly.
    if (rawEstimate <= 2.5 * this.m && zeroCount > 0) {
      return this.m * Math.log(this.m / zeroCount);
    }
    return rawEstimate;
  }

  // Merges another HyperLogLog counter of the *same precision* into this
  // one (register-wise maximum -- the standard, lossless HLL merge
  // operation for equal-precision sketches). Mutates `this` and returns
  // it; `other` is left completely unchanged. The result is exactly as if
  // every string ever added to `other` had also been added to `this`
  // directly (merges are commutative, associative, and idempotent for
  // that reason).
  merge(other) {
    if (!(other instanceof HyperLogLog)) {
      throw new TypeError('other must be a HyperLogLog instance');
    }
    if (other.precision !== this.precision) {
      throw new RangeError(
        `cannot merge counters with different precision (this=${this.precision}, other=${other.precision})`
      );
    }
    for (let j = 0; j < this.m; j++) {
      const otherRank = other.registers[j];
      if (otherRank > this.registers[j]) {
        this.registers[j] = otherRank;
      }
    }
    return this;
  }

  // Resets every register to 0, discarding all previously added data.
  // Equivalent to (but cheaper than) constructing a fresh counter with the
  // same precision. Mutates in place and returns `this`.
  clear() {
    this.registers.fill(0);
    return this;
  }
}

module.exports = { HyperLogLog };
