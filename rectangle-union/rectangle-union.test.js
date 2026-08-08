'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { rectangleUnionArea } = require('./rectangle-union.js');

// Independent brute-force reference used to cross-check structural and
// seeded-random cases, per this task's own explicit requirement ("seeded
// random cases checked against a brute-force oracle"). Deliberately uses a
// completely different technique (grid rasterization over the combined
// x/y compressed coordinates) rather than any form of sweep line or segment
// tree, so it is a meaningful independent check rather than a restatement
// of the same algorithm.
function bruteForceUnionArea(rectangles) {
  if (rectangles.length === 0) return 0n;
  const xsSet = new Set();
  const ysSet = new Set();
  for (const [x1, y1, x2, y2] of rectangles) {
    xsSet.add(x1); xsSet.add(x2);
    ysSet.add(y1); ysSet.add(y2);
  }
  const xs = Array.from(xsSet).sort((a, b) => a - b);
  const ys = Array.from(ysSet).sort((a, b) => a - b);
  let area = 0n;
  for (let i = 0; i < xs.length - 1; i++) {
    const cx1 = xs[i], cx2 = xs[i + 1];
    const dx = BigInt(cx2) - BigInt(cx1);
    for (let j = 0; j < ys.length - 1; j++) {
      const cy1 = ys[j], cy2 = ys[j + 1];
      let covered = false;
      for (const [x1, y1, x2, y2] of rectangles) {
        if (x1 <= cx1 && cx2 <= x2 && y1 <= cy1 && cy2 <= y2) { covered = true; break; }
      }
      if (covered) area += dx * (BigInt(cy2) - BigInt(cy1));
    }
  }
  return area;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------
// Empty input
// ---------------------------------------------------------------------

test('empty array returns 0n', () => {
  assert.equal(rectangleUnionArea([]), 0n);
  assert.equal(typeof rectangleUnionArea([]), 'bigint');
});

// ---------------------------------------------------------------------
// Structural cases named in the task's own requirements: disjoint,
// touching, overlapping, nested, duplicate, negative, large-coordinate
// ---------------------------------------------------------------------

test('single rectangle: area is exactly width * height', () => {
  assert.equal(rectangleUnionArea([[0, 0, 2, 3]]), 6n);
  assert.equal(rectangleUnionArea([[10, 20, 15, 25]]), 25n);
});

test('disjoint rectangles: areas simply add', () => {
  assert.equal(rectangleUnionArea([[0, 0, 2, 2], [5, 5, 7, 7]]), 8n);
});

test('touching rectangles (shared edge, zero-width overlap): areas simply add', () => {
  assert.equal(rectangleUnionArea([[0, 0, 2, 2], [2, 0, 4, 2]]), 8n);
  assert.equal(rectangleUnionArea([[0, 0, 2, 2], [0, 2, 2, 4]]), 8n);
});

test('touching at a single corner: areas simply add (zero-area intersection)', () => {
  assert.equal(rectangleUnionArea([[0, 0, 2, 2], [2, 2, 4, 4]]), 8n);
});

test('overlapping rectangles: union subtracts the double-counted intersection', () => {
  // Each is a 2x2=4 square; they overlap in a 1x1=1 square; union = 4+4-1 = 7.
  assert.equal(rectangleUnionArea([[0, 0, 2, 2], [1, 1, 3, 3]]), 7n);
});

test('nested rectangle contributes no extra area', () => {
  assert.equal(rectangleUnionArea([[0, 0, 10, 10], [2, 2, 4, 4]]), 100n);
});

test('duplicate rectangles do not double-count', () => {
  assert.equal(rectangleUnionArea([[0, 0, 2, 2], [0, 0, 2, 2]]), 4n);
  assert.equal(rectangleUnionArea([[0, 0, 5, 5], [0, 0, 5, 5], [0, 0, 5, 5]]), 25n);
});

test('negative-coordinate rectangles are handled correctly', () => {
  assert.equal(rectangleUnionArea([[-5, -5, 5, 5]]), 100n);
  assert.equal(rectangleUnionArea([[-10, -10, -5, -5], [5, 5, 10, 10]]), 50n);
});

test('a cross shape (two overlapping strips) computes the correct union', () => {
  // Vertical strip [2,0]-[4,6] area 12, horizontal strip [0,2]-[6,4] area 12,
  // overlap is the 2x2 square [2,2]-[4,4] area 4. Union = 12+12-4 = 20.
  assert.equal(rectangleUnionArea([[2, 0, 4, 6], [0, 2, 6, 4]]), 20n);
});

test('large-coordinate rectangles near the safe-integer boundary are exact', () => {
  const MAX = Number.MAX_SAFE_INTEGER;
  const got = rectangleUnionArea([[-MAX, -MAX, MAX, MAX]]);
  const want = (2n * BigInt(MAX)) * (2n * BigInt(MAX));
  assert.equal(got, want);
});

test('a coordinate span that would NOT be exact under plain float64 subtraction is still exact', () => {
  // x1 = -(2^53-1), x2 = 2^53-2: difference is 2^54-3, which is odd and
  // therefore not representable exactly as a float64 (only even integers
  // in [2^53, 2^54) are representable). A naive `x2 - x1` Number
  // subtraction would silently round this to an even neighbor. This test
  // confirms the implementation's BigInt-based length arithmetic sidesteps
  // that trap entirely.
  const x1 = -(2 ** 53 - 1);
  const x2 = 2 ** 53 - 2;
  const floatDiff = x2 - x1;
  assert.notEqual(BigInt(floatDiff), BigInt(x2) - BigInt(x1),
    'sanity check: this fixture should actually exercise the float64 imprecision trap');
  const got = rectangleUnionArea([[x1, 0, x2, 1]]);
  const want = BigInt(x2) - BigInt(x1);
  assert.equal(got, want);
});

// ---------------------------------------------------------------------
// Invalid inputs
// ---------------------------------------------------------------------

test('non-array top-level input throws TypeError', () => {
  for (const v of [null, undefined, 42, 'rects', {}, true]) {
    assert.throws(() => rectangleUnionArea(v), TypeError);
  }
});

test('a rectangle entry that is not a 4-element array throws TypeError', () => {
  assert.throws(() => rectangleUnionArea([[0, 0, 2]]), TypeError);
  assert.throws(() => rectangleUnionArea([[0, 0, 2, 2, 2]]), TypeError);
  assert.throws(() => rectangleUnionArea(['not-an-array']), TypeError);
  assert.throws(() => rectangleUnionArea([{ x1: 0, y1: 0, x2: 2, y2: 2 }]), TypeError);
  assert.throws(() => rectangleUnionArea([null]), TypeError);
});

test('non-safe-integer coordinates throw TypeError', () => {
  const badCoords = ['2', NaN, Infinity, -Infinity, 2.5, null, undefined, {}, [], true, Number.MAX_SAFE_INTEGER + 10, 10n];
  for (const bad of badCoords) {
    assert.throws(() => rectangleUnionArea([[0, 0, 2, bad]]), TypeError, `coord ${String(bad)} should throw TypeError`);
    assert.throws(() => rectangleUnionArea([[bad, 0, 2, 2]]), TypeError, `coord ${String(bad)} should throw TypeError`);
  }
});

test('zero or negative width/height throws RangeError', () => {
  assert.throws(() => rectangleUnionArea([[2, 0, 2, 2]]), RangeError); // zero width
  assert.throws(() => rectangleUnionArea([[3, 0, 2, 2]]), RangeError); // negative width
  assert.throws(() => rectangleUnionArea([[0, 2, 2, 2]]), RangeError); // zero height
  assert.throws(() => rectangleUnionArea([[0, 3, 2, 2]]), RangeError); // negative height
});

test('a valid rectangle earlier in the array does not mask an invalid one later', () => {
  assert.throws(() => rectangleUnionArea([[0, 0, 2, 2], [0, 0, 2, 0]]), RangeError);
  assert.throws(() => rectangleUnionArea([[0, 0, 2, 2], [0, 0, 2, 'x']]), TypeError);
});

// ---------------------------------------------------------------------
// Input is preserved (not mutated)
// ---------------------------------------------------------------------

test('the input array and its rectangles are not mutated', () => {
  const input = [[0, 0, 2, 2], [1, 1, 3, 3], [-5, -5, 5, 5]];
  const snapshot = JSON.parse(JSON.stringify(input));
  rectangleUnionArea(input);
  assert.deepEqual(input, snapshot);
});

// ---------------------------------------------------------------------
// Determinism / repeatability
// ---------------------------------------------------------------------

test('repeated calls on the same input produce identical results', () => {
  const rects = [[0, 0, 5, 5], [3, 3, 8, 8], [-2, -2, 2, 2]];
  const a = rectangleUnionArea(rects);
  const b = rectangleUnionArea(rects);
  assert.equal(a, b);
});

// ---------------------------------------------------------------------
// Seeded random cases checked against the brute-force oracle
// ---------------------------------------------------------------------

test('seeded random small rectangle sets match the brute-force oracle', () => {
  const rng = mulberry32(20260808);
  for (let trial = 0; trial < 300; trial++) {
    const n = 1 + Math.floor(rng() * 12);
    const coordRange = 20;
    const rects = [];
    for (let i = 0; i < n; i++) {
      const x1 = Math.floor(rng() * coordRange) - coordRange / 2;
      const x2 = x1 + 1 + Math.floor(rng() * coordRange);
      const y1 = Math.floor(rng() * coordRange) - coordRange / 2;
      const y2 = y1 + 1 + Math.floor(rng() * coordRange);
      rects.push([x1, y1, x2, y2]);
    }
    const got = rectangleUnionArea(rects);
    const want = bruteForceUnionArea(rects);
    assert.equal(got, want, `mismatch on trial ${trial}: ${JSON.stringify(rects)}`);
  }
});

test('seeded random medium rectangle sets (larger coordinate range) match the brute-force oracle', () => {
  const rng = mulberry32(97531);
  for (let trial = 0; trial < 80; trial++) {
    const n = 1 + Math.floor(rng() * 25);
    const coordRange = 200;
    const rects = [];
    for (let i = 0; i < n; i++) {
      const x1 = Math.floor(rng() * coordRange) - coordRange / 2;
      const x2 = x1 + 1 + Math.floor(rng() * coordRange);
      const y1 = Math.floor(rng() * coordRange) - coordRange / 2;
      const y2 = y1 + 1 + Math.floor(rng() * coordRange);
      rects.push([x1, y1, x2, y2]);
    }
    const got = rectangleUnionArea(rects);
    const want = bruteForceUnionArea(rects);
    assert.equal(got, want, `mismatch on trial ${trial}: ${JSON.stringify(rects)}`);
  }
});

test('many overlapping strips (dense overlap stress case) matches the brute-force oracle', () => {
  const rects = Array.from({ length: 20 }, (_, i) => [i, 0, i + 2, 10]);
  const got = rectangleUnionArea(rects);
  const want = bruteForceUnionArea(rects);
  assert.equal(got, want);
});
