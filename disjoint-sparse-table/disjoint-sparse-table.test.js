'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DisjointSparseTable } = require('./disjoint-sparse-table.js');

// Naive left-to-right FOLD reference used throughout: combine(combine(...
// combine(a[l], a[l+1])..., a[r-2]), a[r-1]). This is deliberately a
// completely different (O(range length) per query, no table) technique
// from the disjoint-sparse-table construction under test, so it is a
// meaningful independent cross-check rather than a restatement of the same
// algorithm. Crucially it applies `combine` in the SAME left-to-right
// order the table is supposed to reproduce, so it also serves as the
// order-sensitivity oracle for non-commutative operators.
function naiveFold(arr, l, r, combine) {
  let acc = arr[l];
  for (let i = l + 1; i < r; i++) acc = combine(acc, arr[i]);
  return acc;
}

function assertMatchesNaiveForAllRanges(arr, combine, label) {
  const dst = new DisjointSparseTable(arr, combine);
  for (let l = 0; l < arr.length; l++) {
    for (let r = l + 1; r <= arr.length; r++) {
      const got = dst.query(l, r);
      const want = naiveFold(arr, l, r, combine);
      assert.equal(got, want, `${label}: mismatch on range [${l}, ${r})`);
    }
  }
}

// ---------------------------------------------------------------------
// Empty and singleton inputs
// ---------------------------------------------------------------------

test('empty input: size is 0, and every query is rejected as out of range', () => {
  const dst = new DisjointSparseTable([], (a, b) => a + b);
  assert.equal(dst.size, 0);
  assert.throws(() => dst.query(0, 0), RangeError); // empty range also rejected
  assert.throws(() => dst.query(0, 1), RangeError);
});

test('singleton input: the only valid query returns the single element directly', () => {
  const dst = new DisjointSparseTable([42], (a, b) => a + b);
  assert.equal(dst.size, 1);
  assert.equal(dst.query(0, 1), 42);
  assert.throws(() => dst.query(0, 0), RangeError);
  assert.throws(() => dst.query(1, 2), RangeError);
});

test('singleton input never touches the combine function (no pair exists to combine)', () => {
  let calls = 0;
  const dst = new DisjointSparseTable(['only'], () => {
    calls++;
    return 'should not be called';
  });
  assert.equal(dst.query(0, 1), 'only');
  assert.equal(calls, 0);
});

// ---------------------------------------------------------------------
// Power-of-two and irregular lengths, checked against the naive-sum oracle
// across EVERY valid range (the task's own explicit requirement)
// ---------------------------------------------------------------------

test('every valid range matches naive sum, for power-of-two lengths', () => {
  for (const n of [1, 2, 4, 8, 16, 32, 64]) {
    const arr = Array.from({ length: n }, (_, i) => i + 1);
    assertMatchesNaiveForAllRanges(arr, (a, b) => a + b, `power-of-two n=${n}`);
  }
});

test('every valid range matches naive sum, for irregular (non-power-of-two) lengths', () => {
  for (const n of [3, 5, 6, 7, 9, 13, 17, 31, 33, 50, 100, 101, 257]) {
    const arr = Array.from({ length: n }, (_, i) => (i * 7 + 3) % 97);
    assertMatchesNaiveForAllRanges(arr, (a, b) => a + b, `irregular n=${n}`);
  }
});

test('every valid range matches naive sum, including negative numbers', () => {
  const arr = [5, -3, 0, 12, -8, -1, 7, -20, 4, 3, -6];
  assertMatchesNaiveForAllRanges(arr, (a, b) => a + b, 'negative numbers');
});

// ---------------------------------------------------------------------
// Ordered (non-commutative) string concatenation -- proves operand order
// is preserved, which the task explicitly requires ("operand order must
// remain correct for non-commutative operations")
// ---------------------------------------------------------------------

test('every valid range matches ordered string concatenation (a normal, commutative-looking but order-sensitive combine)', () => {
  const words = ['the', 'quick', 'brown', 'fox', 'jumps', 'over', 'a', 'lazy', 'dog'];
  assertMatchesNaiveForAllRanges(words, (a, b) => a + '-' + b, 'string concat with separator');
});

test('a genuinely non-commutative combine (reverse-concatenation) is answered with the correct fold order, not the commuted one', () => {
  const letters = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];
  const reverseConcat = (a, b) => b + a; // associative, NOT commutative
  const dst = new DisjointSparseTable(letters, reverseConcat);

  // Directly confirm reverseConcat is genuinely associative (a prerequisite
  // for the whole data structure to be well-defined), and that a naive
  // fold with it does NOT equal a naive fold with plain '+' concatenation
  // for any range spanning more than one element -- otherwise this test
  // wouldn't actually be exercising order-sensitivity.
  assert.equal(reverseConcat(reverseConcat('a', 'b'), 'c'), reverseConcat('a', reverseConcat('b', 'c')));
  const plainConcat = (a, b) => a + b;
  assert.notEqual(
    naiveFold(letters, 0, 3, reverseConcat),
    naiveFold(letters, 0, 3, plainConcat),
    'sanity check: reverse-concat fold must differ from plain concat fold to be a meaningful order-sensitivity test'
  );

  for (let l = 0; l < letters.length; l++) {
    for (let r = l + 1; r <= letters.length; r++) {
      const got = dst.query(l, r);
      const want = naiveFold(letters, l, r, reverseConcat);
      assert.equal(got, want, `reverse-concat mismatch on [${l}, ${r})`);
    }
  }
  // Concrete worked example, independent of the loop above.
  assert.equal(dst.query(0, 3), 'cba');
  assert.equal(dst.query(2, 6), 'fedc');
});

test('combine is always invoked as combine(leftOperand, rightOperand) in original array order', () => {
  const arr = ['x', 'y', 'z', 'w'];
  const callLog = [];
  const recordingConcat = (a, b) => {
    callLog.push([a, b]);
    return a + b;
  };
  const dst = new DisjointSparseTable(arr, recordingConcat);
  callLog.length = 0; // ignore calls made during construction/preprocessing
  const result = dst.query(0, 4);
  assert.equal(result, 'xyzw');
  // Every recorded call must have its left operand's characters appearing
  // strictly before its right operand's characters in the original array.
  for (const [a, b] of callLog) {
    const aStart = arr.join('').indexOf(a);
    const bStart = arr.join('').indexOf(b, aStart);
    assert.ok(bStart >= aStart + a.length, `operands out of order: "${a}" then "${b}"`);
  }
});

// ---------------------------------------------------------------------
// Non-associative-looking but valid matrix-style combine, as a further
// structural check that only order (not commutativity) matters
// ---------------------------------------------------------------------

test('2x2 integer matrix multiplication (associative, non-commutative) over a range matches naive left-to-right product', () => {
  function matMul(A, B) {
    return [
      A[0] * B[0] + A[1] * B[2],
      A[0] * B[1] + A[1] * B[3],
      A[2] * B[0] + A[3] * B[2],
      A[2] * B[1] + A[3] * B[3],
    ];
  }
  const matrices = [
    [1, 1, 1, 0], // Fibonacci matrix
    [2, 0, 1, 3],
    [0, 1, 1, 0],
    [1, 2, 0, 1],
    [3, 1, 2, 2],
  ];
  const dst = new DisjointSparseTable(matrices, matMul);
  for (let l = 0; l < matrices.length; l++) {
    for (let r = l + 1; r <= matrices.length; r++) {
      const got = dst.query(l, r);
      const want = naiveFold(matrices, l, r, matMul);
      assert.deepEqual(got, want, `matrix product mismatch on [${l}, ${r})`);
    }
  }
});

// ---------------------------------------------------------------------
// Repeated queries: determinism, and O(1)-shaped (no query-length-dependent
// looping) behavior -- checked via a combine-call counter, since a query
// over disjoint precomputed halves must call combine exactly once
// regardless of how wide the range is.
// ---------------------------------------------------------------------

test('repeated identical queries return identical (deep-equal) results', () => {
  const arr = [10, 20, 30, 40, 50, 60, 70];
  const dst = new DisjointSparseTable(arr, (a, b) => a + b);
  const first = dst.query(1, 6);
  for (let i = 0; i < 20; i++) {
    assert.equal(dst.query(1, 6), first);
  }
});

test('a non-empty multi-element query invokes combine EXACTLY ONCE, regardless of range width (O(1) query shape)', () => {
  const n = 200;
  const arr = Array.from({ length: n }, (_, i) => i);
  let calls = 0;
  const dst = new DisjointSparseTable(arr, (a, b) => {
    calls++;
    return a + b;
  });
  for (const [l, r] of [
    [0, n],
    [0, 2],
    [50, 150],
    [1, n - 1],
    [n - 2, n],
  ]) {
    calls = 0;
    dst.query(l, r);
    assert.equal(calls, 1, `expected exactly 1 combine call for range [${l}, ${r}), got ${calls}`);
  }
});

test('query timing does not grow with range width (coarse O(1) sanity check)', () => {
  const n = 1_000_000;
  const arr = Array.from({ length: n }, (_, i) => i);
  const dst = new DisjointSparseTable(arr, (a, b) => a + b);
  const trials = 20000;

  const t0 = process.hrtime.bigint();
  for (let i = 0; i < trials; i++) dst.query(0, 2); // narrowest possible multi-element range
  const t1 = process.hrtime.bigint();
  for (let i = 0; i < trials; i++) dst.query(0, n); // widest possible range
  const t2 = process.hrtime.bigint();

  const narrowMs = Number(t1 - t0) / 1e6;
  const wideMs = Number(t2 - t1) / 1e6;
  // Generous factor: a query whose cost scaled with range width would be
  // ~500,000x slower for the wide range, not merely a small constant
  // factor. Allow a very wide margin (100x) to keep this robust against
  // machine noise while still catching any accidental O(range) regression.
  assert.ok(
    wideMs < narrowMs * 100 + 50,
    `wide-range queries (${wideMs}ms) look range-width-dependent vs narrow-range queries (${narrowMs}ms)`
  );
});

// ---------------------------------------------------------------------
// Invalid constructor arguments
// ---------------------------------------------------------------------

test('non-array data throws TypeError', () => {
  for (const bad of [null, undefined, 42, 'abc', {}, new Set([1, 2, 3])]) {
    assert.throws(() => new DisjointSparseTable(bad, (a, b) => a + b), TypeError);
  }
});

test('non-function combine throws TypeError', () => {
  for (const bad of [null, undefined, 42, 'abc', {}, [], true]) {
    assert.throws(() => new DisjointSparseTable([1, 2, 3], bad), TypeError);
  }
});

// ---------------------------------------------------------------------
// Invalid query (range) arguments
// ---------------------------------------------------------------------

test('out-of-bounds or empty/reversed ranges throw RangeError', () => {
  const dst = new DisjointSparseTable([1, 2, 3, 4, 5], (a, b) => a + b);
  assert.throws(() => dst.query(-1, 3), RangeError); // negative left
  assert.throws(() => dst.query(0, 6), RangeError); // right beyond size
  assert.throws(() => dst.query(5, 5), RangeError); // empty range at the boundary
  assert.throws(() => dst.query(2, 2), RangeError); // empty range in the middle
  assert.throws(() => dst.query(3, 1), RangeError); // reversed (left > right)
  assert.throws(() => dst.query(-1, -1), RangeError);
  assert.throws(() => dst.query(6, 7), RangeError); // entirely beyond size
});

test('non-integer or non-numeric left/right throw TypeError', () => {
  const dst = new DisjointSparseTable([1, 2, 3, 4, 5], (a, b) => a + b);
  const badValues = [1.5, NaN, Infinity, -Infinity, '1', null, undefined, {}, [], true, 10n];
  for (const bad of badValues) {
    assert.throws(() => dst.query(bad, 3), TypeError, `left=${String(bad)} should throw TypeError`);
    assert.throws(() => dst.query(0, bad), TypeError, `right=${String(bad)} should throw TypeError`);
  }
});

test('an earlier valid-looking argument does not mask a later invalid one', () => {
  const dst = new DisjointSparseTable([1, 2, 3, 4, 5], (a, b) => a + b);
  // left is valid on its own, but right is not an integer.
  assert.throws(() => dst.query(0, 2.5), TypeError);
  // both individually in-range as numbers, but left >= right.
  assert.throws(() => dst.query(4, 4), RangeError);
});

// ---------------------------------------------------------------------
// Input is preserved (not mutated), and the table's own construction
// does not mutate the caller's array either
// ---------------------------------------------------------------------

test('the constructor does not mutate the input array', () => {
  const input = [5, 3, 8, 1, 9, 2, 7];
  const snapshot = input.slice();
  new DisjointSparseTable(input, (a, b) => a + b);
  assert.deepEqual(input, snapshot);
});

test('mutating the caller array after construction does not affect the table', () => {
  const input = [1, 2, 3];
  const dst = new DisjointSparseTable(input, (a, b) => a + b);
  input[0] = 999;
  input.push(1000);
  assert.equal(dst.query(0, 1), 1); // unaffected by later mutation
  assert.equal(dst.size, 3); // unaffected by later push
});

test('the table copies data into a frozen internal array, and the instance itself is frozen', () => {
  const dst = new DisjointSparseTable([1, 2, 3], (a, b) => a + b);
  assert.ok(Object.isFrozen(dst.data));
  assert.ok(Object.isFrozen(dst));
  assert.throws(() => {
    'use strict';
    dst.data[0] = 999;
  }, TypeError);
  assert.throws(() => {
    'use strict';
    dst.size = 999;
  }, TypeError);
});

// ---------------------------------------------------------------------
// size property
// ---------------------------------------------------------------------

test('size property reflects the input length exactly', () => {
  for (const n of [0, 1, 2, 5, 100]) {
    const dst = new DisjointSparseTable(new Array(n).fill(0), (a, b) => a + b);
    assert.equal(dst.size, n);
  }
});

// ---------------------------------------------------------------------
// Seeded random differential stress against the naive-fold oracle, across
// several combine functions, several sizes, and full-coverage of ranges
// ---------------------------------------------------------------------

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

test('seeded random arrays and random valid ranges match the naive-fold oracle (sum, max, and string concat)', () => {
  const rng = mulberry32(20260808);
  const combines = [
    { name: 'sum', combine: (a, b) => a + b, gen: () => Math.floor(rng() * 2000) - 1000 },
    { name: 'max', combine: (a, b) => Math.max(a, b), gen: () => Math.floor(rng() * 2000) - 1000 },
    {
      name: 'concat',
      combine: (a, b) => a + '|' + b,
      gen: () => String.fromCharCode(97 + Math.floor(rng() * 26)),
    },
  ];
  for (const { name, combine, gen } of combines) {
    for (let trial = 0; trial < 40; trial++) {
      const n = 1 + Math.floor(rng() * 60);
      const arr = Array.from({ length: n }, gen);
      const dst = new DisjointSparseTable(arr, combine);
      for (let q = 0; q < 20; q++) {
        const l = Math.floor(rng() * n);
        const r = l + 1 + Math.floor(rng() * (n - l));
        const got = dst.query(l, r);
        const want = naiveFold(arr, l, r, combine);
        assert.equal(got, want, `[${name}] trial ${trial}, range [${l}, ${r}) over n=${n}`);
      }
    }
  }
});
