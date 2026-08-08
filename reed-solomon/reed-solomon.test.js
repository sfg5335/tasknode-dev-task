'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { encode, reconstruct } = require('./reed-solomon.js');

function bytes(...values) {
  return Uint8Array.from(values);
}

function allCombinations(arr, k) {
  const results = [];
  const combo = [];
  (function rec(start) {
    if (combo.length === k) {
      results.push(combo.slice());
      return;
    }
    for (let i = start; i < arr.length; i++) {
      combo.push(arr[i]);
      rec(i + 1);
      combo.pop();
    }
  })(0);
  return results;
}

function assertShardsEqual(actual, expected, label) {
  assert.equal(actual.length, expected.length, `${label}: shard count`);
  for (let i = 0; i < expected.length; i++) {
    assert.deepEqual(Array.from(actual[i]), Array.from(expected[i]), `${label}: shard ${i} bytes`);
  }
}

// ---------------------------------------------------------------------------
// Independent reference implementation via direct Lagrange interpolation
// over GF(256), deliberately structured completely differently from
// reed-solomon.js's approach (which builds a Vandermonde matrix and inverts
// it once via Gauss-Jordan elimination, then multiplies). This reference
// instead treats each byte position's k data bytes as the k values
// data[0]=P(1), data[1]=P(2), ..., data[k-1]=P(k) of an implicit unique
// polynomial P of degree < k, and evaluates P at further points 1..n via
// the textbook Lagrange interpolation formula directly, per-point,
// per-byte -- no matrix inversion at all. GF(256) inverse is found here by
// brute-force search (try every b in 1..255), not via log/antilog tables,
// so this reference shares no code or algorithmic technique with the
// module under test.
function independentGfMul(a, b) {
  let result = 0;
  let x = a;
  let y = b;
  for (let i = 0; i < 8; i++) {
    if (y & 1) result ^= x;
    const carry = x & 0x80;
    x = (x << 1) & 0xff;
    if (carry) x ^= 0x1d; // 0x11d truncated to 8 bits, since the 9th bit was already shifted out
    y >>= 1;
  }
  return result;
}
function independentGfInv(a) {
  for (let b = 1; b < 256; b++) {
    if (independentGfMul(a, b) === 1) return b;
  }
  throw new Error('no inverse found (unexpected for a nonzero GF(256) element)');
}
function independentGfDiv(a, b) {
  return independentGfMul(a, independentGfInv(b));
}
function lagrangeEval(values, x) {
  const k = values.length;
  let result = 0;
  for (let i = 0; i < k; i++) {
    const xi = i + 1;
    let num = 1;
    let den = 1;
    for (let j = 0; j < k; j++) {
      if (j === i) continue;
      const xj = j + 1;
      num = independentGfMul(num, x ^ xj); // (x - xj) === (x XOR xj) in GF(2^8)
      den = independentGfMul(den, xi ^ xj);
    }
    result ^= independentGfMul(values[i], independentGfDiv(num, den));
  }
  return result;
}
function independentEncode(dataShards, parityCount) {
  const k = dataShards.length;
  const shardLength = dataShards[0].length;
  const parity = [];
  for (let r = 0; r < parityCount; r++) {
    const x = k + r + 1; // evaluation points k+1..k+parityCount, matching reed-solomon.js's base=row+1
    const shard = new Uint8Array(shardLength);
    for (let t = 0; t < shardLength; t++) {
      shard[t] = lagrangeEval(dataShards.map((s) => s[t]), x);
    }
    parity.push(shard);
  }
  return parity;
}

test('fixed parity fixture: k=2, parityCount=2, shardLength=1, cross-checked against an independent Lagrange-interpolation reference', () => {
  const data = [bytes(3), bytes(7)];
  const full = encode(data, 2);
  assert.equal(full.length, 4);
  assertShardsEqual(full.slice(0, 2), data, 'data shards pass through unchanged');

  const independentParity = independentEncode(data, 2);
  assert.deepEqual(Array.from(full[2]), Array.from(independentParity[0]));
  assert.deepEqual(Array.from(full[3]), Array.from(independentParity[1]));
  // Exact hardcoded bytes (pinned down so a future accidental change to
  // either implementation is caught even if both happened to agree):
  assert.deepEqual(Array.from(full[2]), [240]);
  assert.deepEqual(Array.from(full[3]), [15]);
});

test('encode matches the independent Lagrange-interpolation reference across many random shapes', () => {
  let state = 2463534242;
  function next() {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state |= 0;
    return ((state >>> 0) % 1000000) / 1000000;
  }
  let trials = 0;
  for (let t = 0; t < 60; t++) {
    const k = 1 + Math.floor(next() * 10);
    const parityCount = 1 + Math.floor(next() * 8);
    const shardLength = 1 + Math.floor(next() * 12);
    const data = [];
    for (let c = 0; c < k; c++) {
      const shard = new Uint8Array(shardLength);
      for (let i = 0; i < shardLength; i++) shard[i] = Math.floor(next() * 256);
      data.push(shard);
    }
    const full = encode(data, parityCount);
    const independentParity = independentEncode(data, parityCount);
    for (let r = 0; r < parityCount; r++) {
      assert.deepEqual(
        Array.from(full[k + r]),
        Array.from(independentParity[r]),
        `trial ${t}: parity row ${r} (k=${k}, parityCount=${parityCount}, shardLength=${shardLength})`
      );
    }
    trials++;
  }
  assert.equal(trials, 60);
});

// ---------------------------------------------------------------------------
// Exhaustive recoverable-erasure-combination sweep for a small shard set.
test('every recoverable erasure combination is correctly reconstructed (k=3, parityCount=2)', () => {
  const k = 3;
  const parityCount = 2;
  const n = k + parityCount;
  const data = [bytes(10, 20, 30), bytes(200, 150, 5), bytes(1, 2, 3)];
  const full = encode(data, parityCount);
  assert.equal(full.length, n);

  const indices = Array.from({ length: n }, (_, i) => i);
  let combinationsChecked = 0;
  for (let erasureCount = 0; erasureCount <= parityCount; erasureCount++) {
    for (const erased of allCombinations(indices, erasureCount)) {
      const shards = full.map((s) => Uint8Array.from(s));
      erased.forEach((idx, j) => {
        shards[idx] = j % 2 === 0 ? null : undefined;
      });
      const recovered = reconstruct(shards, k);
      assertShardsEqual(recovered, full, `erased=${JSON.stringify(erased)}`);
      combinationsChecked++;
    }
  }
  // C(5,0)+C(5,1)+C(5,2) = 1 + 5 + 10 = 16 combinations total.
  assert.equal(combinationsChecked, 16);
});

test('erasing more than parityCount shards throws RangeError (excessive erasures)', () => {
  const k = 3;
  const parityCount = 2;
  const data = [bytes(1, 2), bytes(3, 4), bytes(5, 6)];
  const full = encode(data, parityCount);
  const shards = full.map((s) => Uint8Array.from(s));
  shards[0] = null;
  shards[1] = null;
  shards[2] = null; // 3 missing > parityCount=2
  assert.throws(() => reconstruct(shards, k), RangeError);
});

test('erasing exactly all parity shards recovers them from data alone', () => {
  const data = [bytes(9, 8, 7), bytes(6, 5, 4)];
  const full = encode(data, 3);
  const shards = full.map((s) => Uint8Array.from(s));
  shards[2] = null;
  shards[3] = null;
  shards[4] = null;
  const recovered = reconstruct(shards, 2);
  assertShardsEqual(recovered, full, 'all-parity erasure recovery');
});

test('erasing exactly all data shards recovers them from parity alone (k=parityCount)', () => {
  const data = [bytes(1), bytes(2), bytes(3)];
  const full = encode(data, 3);
  const shards = full.map((s) => Uint8Array.from(s));
  shards[0] = null;
  shards[1] = null;
  shards[2] = null;
  const recovered = reconstruct(shards, 3);
  assertShardsEqual(recovered, full, 'all-data erasure recovery');
  assertShardsEqual(recovered.slice(0, 3), data, 'recovered data matches original input');
});

// ---------------------------------------------------------------------------
// Zero-length shards.
test('zero-length shards: encode and reconstruct both handle shardLength=0', () => {
  const data = [new Uint8Array(0), new Uint8Array(0)];
  const full = encode(data, 2);
  assert.equal(full.length, 4);
  for (const shard of full) assert.equal(shard.length, 0);

  const shards = full.map((s) => Uint8Array.from(s));
  shards[0] = null;
  shards[3] = null;
  const recovered = reconstruct(shards, 2);
  assertShardsEqual(recovered, full, 'zero-length recovery');
});

// ---------------------------------------------------------------------------
// Deterministic output.
test('encode is deterministic: identical inputs produce byte-identical outputs', () => {
  const data = [bytes(42, 17, 255, 0), bytes(1, 1, 1, 1), bytes(128, 64, 32, 16)];
  const a = encode(data, 4);
  const b = encode(data, 4);
  assertShardsEqual(a, b, 'repeated encode calls');
});

test('reconstruct is deterministic: identical erasure patterns produce byte-identical recoveries', () => {
  const data = [bytes(5, 6), bytes(7, 8)];
  const full = encode(data, 3);
  const shardsA = full.map((s) => Uint8Array.from(s));
  const shardsB = full.map((s) => Uint8Array.from(s));
  shardsA[0] = null;
  shardsA[2] = null;
  shardsB[0] = null;
  shardsB[2] = null;
  const recoveredA = reconstruct(shardsA, 2);
  const recoveredB = reconstruct(shardsB, 2);
  assertShardsEqual(recoveredA, recoveredB, 'repeated reconstruct calls');
});

// ---------------------------------------------------------------------------
// Immutability.
test('encode does not mutate dataShards or its elements, and returns fresh arrays', () => {
  const data = [bytes(1, 2, 3), bytes(4, 5, 6)];
  Object.freeze(data);
  const before = data.map((s) => Array.from(s));
  const result = encode(data, 2);
  const after = data.map((s) => Array.from(s));
  assert.deepEqual(before, after, 'input contents unchanged');
  assert.notEqual(result[0], data[0], 'output shard 0 is a fresh array, not the same reference');
  assert.notEqual(result[1], data[1], 'output shard 1 is a fresh array, not the same reference');
});

test('reconstruct does not mutate shards or its elements, and returns fresh arrays', () => {
  const data = [bytes(11, 22), bytes(33, 44)];
  const full = encode(data, 2);
  const shards = full.map((s) => Uint8Array.from(s));
  shards[0] = null;
  Object.freeze(shards);
  const beforeSnapshot = shards.map((s) => (s === null ? null : Array.from(s)));
  const recovered = reconstruct(shards, 2);
  const afterSnapshot = shards.map((s) => (s === null ? null : Array.from(s)));
  assert.deepEqual(beforeSnapshot, afterSnapshot, 'input shards array/contents unchanged');
  assert.notEqual(recovered[1], shards[1], 'recovered present shard is a fresh array, not the same reference');
  assert.notEqual(recovered[0], full[0], 'recovered missing shard is a freshly computed array');
});

test('repeated calls do not leak state between them (independent EncodeMatrix per call)', () => {
  const first = encode([bytes(1, 2)], 2);
  const second = encode([bytes(9, 9)], 3);
  assert.equal(first.length, 3);
  assert.equal(second.length, 4);
  const third = encode([bytes(1, 2)], 2);
  assertShardsEqual(first, third, 'identical repeated call unaffected by an intervening different-shaped call');
});

// ---------------------------------------------------------------------------
// Larger round-trip sweep (still well within "small" but broader than the
// exhaustive-combination test above) to build confidence across many
// (k, parityCount, shardLength) shapes and random erasure subsets.
test('randomized round-trip sweep across many shapes (deterministic fixed seed)', () => {
  // Simple deterministic LCG so this test needs no external PRNG dependency
  // and is itself perfectly reproducible.
  let state = 88172645463325252n;
  function next() {
    state ^= state << 13n;
    state ^= state >> 7n;
    state ^= state << 17n;
    state &= 0xffffffffffffffffn;
    return Number(state % 1000000n) / 1000000;
  }

  let trials = 0;
  for (let t = 0; t < 150; t++) {
    const k = 1 + Math.floor(next() * 12);
    const parityCount = 1 + Math.floor(next() * 8);
    const shardLength = Math.floor(next() * 25);
    const data = [];
    for (let c = 0; c < k; c++) {
      const shard = new Uint8Array(shardLength);
      for (let i = 0; i < shardLength; i++) shard[i] = Math.floor(next() * 256);
      data.push(shard);
    }
    const full = encode(data, parityCount);
    const n = k + parityCount;

    const indices = Array.from({ length: n }, (_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    const erasureCount = Math.floor(next() * (parityCount + 1));
    const erased = indices.slice(0, erasureCount);
    const shards = full.map((s) => Uint8Array.from(s));
    for (const idx of erased) shards[idx] = null;

    const recovered = reconstruct(shards, k);
    assertShardsEqual(recovered, full, `trial ${t}: k=${k} parityCount=${parityCount} shardLength=${shardLength} erased=${JSON.stringify(erased)}`);
    trials++;
  }
  assert.equal(trials, 150);
});

// ---------------------------------------------------------------------------
// Invalid inputs: encode.
test('encode: invalid inputs throw TypeError for wrong types', () => {
  assert.throws(() => encode('nope', 2), TypeError);
  assert.throws(() => encode(null, 2), TypeError);
  assert.throws(() => encode([[1, 2, 3]], 2), TypeError, 'plain array is not a Uint8Array');
  assert.throws(() => encode([bytes(1, 2, 3)], 2.5), TypeError, 'non-integer parityCount');
  assert.throws(() => encode([bytes(1, 2, 3)], '2'), TypeError, 'string parityCount');
  assert.throws(() => encode([bytes(1, 2, 3)], NaN), TypeError, 'NaN parityCount');
  assert.throws(() => encode([bytes(1, 2, 3)], Infinity), TypeError, 'Infinity parityCount is not an integer');
});

test('encode: invalid inputs throw RangeError for well-typed out-of-domain values', () => {
  assert.throws(() => encode([], 2), RangeError, 'empty dataShards');
  assert.throws(() => encode([bytes(1, 2), bytes(1, 2, 3)], 2), RangeError, 'mismatched shard lengths');
  assert.throws(() => encode([bytes(1)], 0), RangeError, 'parityCount zero');
  assert.throws(() => encode([bytes(1)], -3), RangeError, 'parityCount negative');
  assert.throws(
    () => encode(new Array(250).fill(0).map(() => bytes(1)), 10),
    RangeError,
    'total shard count exceeds 255'
  );
});

// ---------------------------------------------------------------------------
// Invalid inputs: reconstruct.
test('reconstruct: invalid inputs throw TypeError for wrong types', () => {
  assert.throws(() => reconstruct('nope', 2), TypeError);
  assert.throws(() => reconstruct(null, 2), TypeError);
  assert.throws(() => reconstruct([bytes(1), null, bytes(1)], 2.5), TypeError, 'non-integer dataShardCount');
  assert.throws(() => reconstruct([bytes(1), null, bytes(1)], '2'), TypeError, 'string dataShardCount');
  assert.throws(() => reconstruct([123, null, bytes(1)], 2), TypeError, 'non-Uint8Array, non-null element');
  assert.throws(() => reconstruct([bytes(1), 'x', bytes(1)], 2), TypeError, 'string element is not a valid marker');
});

test('reconstruct: invalid inputs throw RangeError for well-typed out-of-domain values', () => {
  assert.throws(() => reconstruct([bytes(1), bytes(1)], 2), RangeError, 'dataShardCount >= shards.length');
  assert.throws(() => reconstruct([bytes(1), null, bytes(1)], 0), RangeError, 'dataShardCount zero');
  assert.throws(() => reconstruct([bytes(1), null, bytes(1)], -1), RangeError, 'dataShardCount negative');
  assert.throws(
    () => reconstruct([bytes(1), bytes(1, 2), bytes(1)], 2),
    RangeError,
    'mismatched present shard lengths'
  );
  assert.throws(() => reconstruct([null, null, bytes(1)], 2), RangeError, 'insufficient survivors');
  assert.throws(
    () => reconstruct(new Array(256).fill(bytes(1)), 2),
    RangeError,
    'shards.length exceeds 255'
  );
});

test('reconstruct: both null and undefined are accepted as missing-shard markers', () => {
  const full = encode([bytes(1), bytes(2)], 2);
  const withNull = full.map((s) => Uint8Array.from(s));
  withNull[0] = null;
  const withUndefined = full.map((s) => Uint8Array.from(s));
  withUndefined[0] = undefined;
  const recoveredNull = reconstruct(withNull, 2);
  const recoveredUndefined = reconstruct(withUndefined, 2);
  assertShardsEqual(recoveredNull, full, 'null marker recovery');
  assertShardsEqual(recoveredUndefined, full, 'undefined marker recovery');
});

test('TypeError and RangeError are distinct classes (not interchangeable)', () => {
  assert.notEqual(TypeError, RangeError);
  let typeErr;
  let rangeErr;
  try {
    encode('nope', 2);
  } catch (e) {
    typeErr = e;
  }
  try {
    encode([], 2);
  } catch (e) {
    rangeErr = e;
  }
  assert.ok(typeErr instanceof TypeError && !(typeErr instanceof RangeError));
  assert.ok(rangeErr instanceof RangeError && !(rangeErr instanceof TypeError));
});

// ---------------------------------------------------------------------------
// Larger scale sanity check: the maximum supported shard count (255).
test('performance/correctness sanity: 255 total shards (k=200, parityCount=55)', () => {
  const k = 200;
  const parityCount = 55;
  const shardLength = 64;
  const data = [];
  for (let c = 0; c < k; c++) {
    const shard = new Uint8Array(shardLength);
    for (let t = 0; t < shardLength; t++) shard[t] = (c * 7 + t * 13) % 256;
    data.push(shard);
  }
  const start = Date.now();
  const full = encode(data, parityCount);
  assert.equal(full.length, 255);

  const shards = full.map((s) => Uint8Array.from(s));
  const erased = [];
  for (let i = 0; i < parityCount; i++) erased.push((i * 47) % 255);
  const uniqueErased = [...new Set(erased)];
  for (const idx of uniqueErased) shards[idx] = null;

  const recovered = reconstruct(shards, k);
  assertShardsEqual(recovered, full, '255-shard round trip');
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 5000, `255-shard encode+reconstruct should complete well under 5s (took ${elapsed}ms)`);
});

test('256 total shards is rejected even though it would fit in a byte count sense', () => {
  const data = new Array(200).fill(0).map(() => bytes(1));
  assert.throws(() => encode(data, 56), RangeError);
});
