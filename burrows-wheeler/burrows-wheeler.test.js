'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { encodeBWT, decodeBWT } = require('./burrows-wheeler.js');

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function roundTrip(buf) {
  const { lastColumn, primaryIndex } = encodeBWT(buf);
  return decodeBWT(lastColumn, primaryIndex);
}

// ---------------------------------------------------------------------
// Empty and singleton inputs
// ---------------------------------------------------------------------

test('encodeBWT on empty input returns an empty lastColumn and primaryIndex 0', () => {
  const { lastColumn, primaryIndex } = encodeBWT(Buffer.alloc(0));
  assert.equal(lastColumn.length, 0);
  assert.equal(primaryIndex, 0);
});

test('decodeBWT on empty lastColumn with primaryIndex 0 returns empty data', () => {
  const decoded = decodeBWT(Buffer.alloc(0), 0);
  assert.equal(decoded.length, 0);
});

test('decodeBWT on empty lastColumn rejects any nonzero primaryIndex with RangeError', () => {
  assert.throws(() => decodeBWT(Buffer.alloc(0), 1), RangeError);
  assert.throws(() => decodeBWT(Buffer.alloc(0), -1), RangeError);
});

test('singleton input round-trips, with lastColumn equal to the single byte and primaryIndex 0', () => {
  const { lastColumn, primaryIndex } = encodeBWT(Buffer.from([200]));
  assert.equal(lastColumn.length, 1);
  assert.equal(lastColumn[0], 200);
  assert.equal(primaryIndex, 0);
  const decoded = decodeBWT(lastColumn, primaryIndex);
  assert.equal(Buffer.compare(decoded, Buffer.from([200])), 0);
});

// ---------------------------------------------------------------------
// The known fixture
// ---------------------------------------------------------------------

test('the known BANANA fixture produces exactly NNBAAA with primary index 3', () => {
  const { lastColumn, primaryIndex } = encodeBWT(Buffer.from('BANANA'));
  assert.equal(lastColumn.toString(), 'NNBAAA');
  assert.equal(primaryIndex, 3);
});

test('the known BANANA fixture decodes back to BANANA exactly', () => {
  const decoded = decodeBWT(Buffer.from('NNBAAA'), 3);
  assert.equal(decoded.toString(), 'BANANA');
});

// ---------------------------------------------------------------------
// Repeated and periodic bytes
// ---------------------------------------------------------------------

test('a string of all-identical bytes round-trips correctly', () => {
  const buf = Buffer.from('AAAAAAAAAA');
  const decoded = roundTrip(buf);
  assert.equal(Buffer.compare(decoded, buf), 0);
});

test('a periodic two-byte pattern round-trips correctly', () => {
  const buf = Buffer.from('ABABABABAB');
  const decoded = roundTrip(buf);
  assert.equal(Buffer.compare(decoded, buf), 0);
});

test('a periodic three-byte pattern round-trips correctly', () => {
  const buf = Buffer.from('ABCABCABCABC');
  const decoded = roundTrip(buf);
  assert.equal(Buffer.compare(decoded, buf), 0);
});

test('lastColumn is always a byte-multiset permutation of the input (structural invariant)', () => {
  const buf = Buffer.from('MISSISSIPPI');
  const { lastColumn } = encodeBWT(buf);
  const inputCounts = new Array(256).fill(0);
  const outputCounts = new Array(256).fill(0);
  for (const b of buf) inputCounts[b]++;
  for (const b of lastColumn) outputCounts[b]++;
  assert.deepEqual(outputCounts, inputCounts);
});

// ---------------------------------------------------------------------
// Zero and high bytes
// ---------------------------------------------------------------------

test('a run of zero bytes round-trips correctly', () => {
  const buf = Buffer.from([0, 0, 0, 0, 0]);
  const decoded = roundTrip(buf);
  assert.equal(Buffer.compare(decoded, buf), 0);
});

test('a run of 0xFF bytes round-trips correctly', () => {
  const buf = Buffer.from([255, 255, 255, 255]);
  const decoded = roundTrip(buf);
  assert.equal(Buffer.compare(decoded, buf), 0);
});

test('alternating 0x00/0xFF bytes round-trip correctly', () => {
  const buf = Buffer.from([0, 255, 0, 255, 0, 255, 0]);
  const decoded = roundTrip(buf);
  assert.equal(Buffer.compare(decoded, buf), 0);
});

// ---------------------------------------------------------------------
// All 256 byte values
// ---------------------------------------------------------------------

test('all 256 distinct byte values (ascending) round-trip correctly', () => {
  const buf = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
  const decoded = roundTrip(buf);
  assert.equal(Buffer.compare(decoded, buf), 0);
});

test('all 256 distinct byte values (descending) round-trip correctly', () => {
  const buf = Buffer.from(Array.from({ length: 256 }, (_, i) => 255 - i));
  const decoded = roundTrip(buf);
  assert.equal(Buffer.compare(decoded, buf), 0);
});

test('every byte value appearing exactly twice round-trips correctly', () => {
  const buf = Buffer.from(Array.from({ length: 512 }, (_, i) => i % 256));
  const decoded = roundTrip(buf);
  assert.equal(Buffer.compare(decoded, buf), 0);
});

// ---------------------------------------------------------------------
// Fixed-seed round trips
// ---------------------------------------------------------------------

test('fixed-seed random round trips across varied lengths and alphabet sizes', () => {
  const rng = mulberry32(12345);
  for (let t = 0; t < 100; t++) {
    const len = Math.floor(rng() * 300);
    const alphabetSize = 1 + Math.floor(rng() * 256);
    const buf = Buffer.alloc(len);
    for (let i = 0; i < len; i++) buf[i] = Math.floor(rng() * alphabetSize);
    const decoded = roundTrip(buf);
    assert.equal(Buffer.compare(decoded, buf), 0, `mismatch at trial ${t}, len=${len}`);
  }
});

test('fixed-seed round trips are exactly reproducible across repeated runs', () => {
  const rng1 = mulberry32(999);
  const buf = Buffer.alloc(200);
  for (let i = 0; i < 200; i++) buf[i] = Math.floor(rng1() * 256);

  const first = encodeBWT(buf);
  const second = encodeBWT(Buffer.from(buf));
  assert.equal(Buffer.compare(first.lastColumn, second.lastColumn), 0);
  assert.equal(first.primaryIndex, second.primaryIndex);
});

// ---------------------------------------------------------------------
// Immutability
// ---------------------------------------------------------------------

test('encodeBWT does not mutate its input', () => {
  const original = Buffer.from('BANANA');
  const copy = Buffer.from(original);
  encodeBWT(original);
  assert.equal(Buffer.compare(original, copy), 0);
});

test("encodeBWT's returned lastColumn does not alias the input buffer", () => {
  const original = Buffer.from('BANANA');
  const copy = Buffer.from(original);
  const { lastColumn } = encodeBWT(original);
  lastColumn[0] = 0;
  assert.equal(Buffer.compare(original, copy), 0);
});

test('decodeBWT does not mutate its lastColumn input', () => {
  const lc = Buffer.from('NNBAAA');
  const copy = Buffer.from(lc);
  decodeBWT(lc, 3);
  assert.equal(Buffer.compare(lc, copy), 0);
});

test("decodeBWT's returned buffer does not alias the lastColumn input", () => {
  const lc = Buffer.from('NNBAAA');
  const copy = Buffer.from(lc);
  const decoded = decodeBWT(lc, 3);
  decoded[0] = 0;
  assert.equal(Buffer.compare(lc, copy), 0);
});

test('accepts and round-trips a plain Uint8Array in addition to Buffer', () => {
  const u8 = new Uint8Array([66, 65, 78, 65, 78, 65]); // "BANANA"
  const { lastColumn, primaryIndex } = encodeBWT(u8);
  assert.equal(Buffer.from(lastColumn).toString(), 'NNBAAA');
  assert.equal(primaryIndex, 3);
  const decoded = decodeBWT(new Uint8Array(lastColumn), primaryIndex);
  assert.equal(Buffer.compare(Buffer.from(decoded), Buffer.from(u8)), 0);
});

// ---------------------------------------------------------------------
// Invalid arguments
// ---------------------------------------------------------------------

test('encodeBWT rejects non-Buffer/Uint8Array input with TypeError', () => {
  for (const v of [42, 'string', null, undefined, {}, [], true]) {
    assert.throws(() => encodeBWT(v), TypeError, `encodeBWT(${JSON.stringify(v)}) should throw TypeError`);
  }
});

test('decodeBWT rejects non-Buffer/Uint8Array lastColumn with TypeError', () => {
  for (const v of [42, 'string', null, undefined, {}, [], true]) {
    assert.throws(() => decodeBWT(v, 0), TypeError, `decodeBWT(${JSON.stringify(v)}, 0) should throw TypeError`);
  }
});

test('decodeBWT rejects a non-integer primaryIndex with TypeError', () => {
  const lc = Buffer.from('NNBAAA');
  for (const v of [1.5, NaN, Infinity, '3', null, undefined, {}, [3]]) {
    assert.throws(() => decodeBWT(lc, v), TypeError, `decodeBWT(lc, ${JSON.stringify(v)}) should throw TypeError`);
  }
});

test('decodeBWT rejects an out-of-bounds primaryIndex with RangeError', () => {
  const lc = Buffer.from('NNBAAA'); // length 6, valid range [0, 6)
  assert.throws(() => decodeBWT(lc, -1), RangeError);
  assert.throws(() => decodeBWT(lc, 6), RangeError);
  assert.throws(() => decodeBWT(lc, 1000), RangeError);
});
