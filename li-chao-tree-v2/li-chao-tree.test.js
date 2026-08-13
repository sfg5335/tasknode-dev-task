'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { LiChaoTree } = require('./li-chao-tree.js');

test('empty tree: query returns null, size is 0', () => {
  const t = new LiChaoTree(0, 10);
  assert.equal(t.size, 0);
  assert.equal(t.query(0), null);
  assert.equal(t.query(10), null);
  assert.equal(t.query(5), null);
});

test('single line: query returns its value/label everywhere in domain', () => {
  const t = new LiChaoTree(-5, 5);
  t.addLine(2, 3, 'only'); // y = 2x + 3
  assert.equal(t.size, 1);
  assert.deepEqual(t.query(-5), { value: -7, label: 'only' });
  assert.deepEqual(t.query(0), { value: 3, label: 'only' });
  assert.deepEqual(t.query(5), { value: 13, label: 'only' });
});

test('one line dominates everywhere (no crossing in domain)', () => {
  const t = new LiChaoTree(0, 10);
  t.addLine(1, 0, 'low'); // y = x, max value 10 at x=10
  t.addLine(0, 100, 'high'); // y = 100 always
  assert.deepEqual(t.query(0), { value: 0, label: 'low' });
  assert.deepEqual(t.query(5), { value: 5, label: 'low' });
  assert.deepEqual(t.query(10), { value: 10, label: 'low' });
});

test('crossing lines: winner changes on either side of the crossing point', () => {
  const t = new LiChaoTree(0, 10);
  t.addLine(1, 0, 'a'); // y = x
  t.addLine(-1, 10, 'b'); // y = 10 - x, crosses 'a' at x=5 (both 5)
  assert.deepEqual(t.query(0), { value: 0, label: 'a' });
  assert.deepEqual(t.query(4), { value: 4, label: 'a' });
  assert.deepEqual(t.query(6), { value: 4, label: 'b' });
  assert.deepEqual(t.query(10), { value: 0, label: 'b' });
});

test('exact tie at the crossing point resolves to the earliest-inserted line', () => {
  const t = new LiChaoTree(0, 10);
  t.addLine(1, 0, 'a'); // y = x, inserted first
  t.addLine(-1, 10, 'b'); // y = 10 - x, inserted second, ties with 'a' at x=5
  assert.deepEqual(t.query(5), { value: 5, label: 'a' });

  // Reverse insertion order: now 'b' is earliest, so 'b' should win the tie.
  const t2 = new LiChaoTree(0, 10);
  t2.addLine(-1, 10, 'b');
  t2.addLine(1, 0, 'a');
  assert.deepEqual(t2.query(5), { value: 5, label: 'b' });
});

test('duplicate (identical) lines: earliest insertion wins every query', () => {
  const t = new LiChaoTree(0, 10);
  t.addLine(1, 0, 'first');
  t.addLine(1, 0, 'second');
  t.addLine(1, 0, 'third');
  assert.equal(t.size, 3);
  for (const x of [0, 3, 7, 10]) {
    assert.deepEqual(t.query(x), { value: x, label: 'first' });
  }
});

test('three-way tie at one point, regardless of insertion order or resulting tree depth', () => {
  // All three lines pass through (10, 100); inserted in three different orders.
  const orders = [
    [
      { slope: 0, intercept: 100, label: 'c1' },
      { slope: 5, intercept: 50, label: 'c2' },
      { slope: -5, intercept: 150, label: 'c3' },
    ],
    [
      { slope: -5, intercept: 150, label: 'c3' },
      { slope: 5, intercept: 50, label: 'c2' },
      { slope: 0, intercept: 100, label: 'c1' },
    ],
    [
      { slope: 5, intercept: 50, label: 'c2' },
      { slope: 0, intercept: 100, label: 'c1' },
      { slope: -5, intercept: 150, label: 'c3' },
    ],
  ];
  for (const order of orders) {
    const t = new LiChaoTree(0, 20);
    for (const line of order) t.addLine(line.slope, line.intercept, line.label);
    const result = t.query(10);
    assert.equal(result.value, 100);
    assert.equal(result.label, order[0].label, `earliest-inserted (${order[0].label}) should win the tie`);
  }
});

test('parallel lines (equal slope, different intercept): the lower one always wins', () => {
  const t = new LiChaoTree(-10, 10);
  t.addLine(2, 5, 'higher');
  t.addLine(2, -3, 'lower');
  for (const x of [-10, -1, 0, 1, 10]) {
    assert.deepEqual(t.query(x), { value: 2 * x - 3, label: 'lower' });
  }
});

test('negative slope and intercept coefficients', () => {
  const t = new LiChaoTree(-5, 5);
  t.addLine(-2, -3, 'neg'); // y = -2x - 3
  assert.deepEqual(t.query(-5), { value: 7, label: 'neg' });
  assert.deepEqual(t.query(0), { value: -3, label: 'neg' });
  assert.deepEqual(t.query(5), { value: -13, label: 'neg' });
});

test('boundary points of the domain are queryable without error', () => {
  const t = new LiChaoTree(-1000, 1000);
  t.addLine(1, 0, 'x');
  assert.deepEqual(t.query(-1000), { value: -1000, label: 'x' });
  assert.deepEqual(t.query(1000), { value: 1000, label: 'x' });
});

test('single-point domain (minX === maxX)', () => {
  const t = new LiChaoTree(7, 7);
  t.addLine(3, 1, 'a'); // y = 22 at x=7
  t.addLine(-1, 100, 'b'); // y = 93 at x=7
  assert.deepEqual(t.query(7), { value: 22, label: 'a' });
});

test('repeated queries at the same point are deterministic and side-effect-free', () => {
  const t = new LiChaoTree(0, 100);
  t.addLine(1, 0, 'a');
  t.addLine(-1, 50, 'b');
  const first = t.query(30);
  const second = t.query(30);
  const third = t.query(30);
  assert.deepEqual(first, second);
  assert.deepEqual(second, third);
  assert.equal(t.size, 2, 'querying must not change size');
});

test('size tracks only successful addLine calls, not failed/rejected ones', () => {
  const t = new LiChaoTree(0, 10);
  assert.equal(t.size, 0);
  t.addLine(1, 1, 'a');
  assert.equal(t.size, 1);
  t.addLine(2, 2, 'b');
  assert.equal(t.size, 2);
  assert.throws(() => t.addLine(NaN, 1, 'bad'), RangeError);
  assert.equal(t.size, 2, 'a rejected addLine must not increment size');
  assert.throws(() => t.addLine('1', 1, 'bad'), TypeError);
  assert.equal(t.size, 2);
});

test('addLine returns `this` for chaining', () => {
  const t = new LiChaoTree(0, 10);
  const result = t.addLine(1, 1, 'a').addLine(2, 2, 'b');
  assert.equal(result, t);
  assert.equal(t.size, 2);
});

test('label may be any value, including undefined, objects, and falsy values', () => {
  const t = new LiChaoTree(0, 100);
  t.addLine(1, 0, undefined);
  assert.equal(t.query(0).label, undefined);

  const t2 = new LiChaoTree(0, 100);
  t2.addLine(1, 0, 0);
  assert.equal(t2.query(0).label, 0);

  const marker = { id: 42 };
  const t3 = new LiChaoTree(0, 100);
  t3.addLine(1, 0, marker);
  assert.equal(t3.query(0).label, marker);
});

test('invalid constructor arguments throw the expected error types', () => {
  assert.throws(() => new LiChaoTree('0', 10), TypeError);
  assert.throws(() => new LiChaoTree(0, '10'), TypeError);
  assert.throws(() => new LiChaoTree(null, 10), TypeError);
  assert.throws(() => new LiChaoTree(0, undefined), TypeError);
  assert.throws(() => new LiChaoTree(NaN, 10), RangeError);
  assert.throws(() => new LiChaoTree(0, Infinity), RangeError);
  assert.throws(() => new LiChaoTree(-Infinity, 10), RangeError);
  assert.throws(() => new LiChaoTree(1.5, 10), RangeError);
  assert.throws(() => new LiChaoTree(0, 10.5), RangeError);
  assert.throws(() => new LiChaoTree(10, 0), RangeError, 'reversed domain');
});

test('invalid addLine arguments throw the expected error types', () => {
  const t = new LiChaoTree(0, 10);
  assert.throws(() => t.addLine('1', 0, 'x'), TypeError);
  assert.throws(() => t.addLine(1, '0', 'x'), TypeError);
  assert.throws(() => t.addLine(null, 0, 'x'), TypeError);
  assert.throws(() => t.addLine(NaN, 0, 'x'), RangeError);
  assert.throws(() => t.addLine(1, NaN, 'x'), RangeError);
  assert.throws(() => t.addLine(Infinity, 0, 'x'), RangeError);
  assert.throws(() => t.addLine(1, -Infinity, 'x'), RangeError);
  assert.equal(t.size, 0, 'no rejected call should have mutated the tree');
});

test('invalid query arguments throw the expected error types', () => {
  const t = new LiChaoTree(0, 10);
  t.addLine(1, 0, 'x');
  assert.throws(() => t.query('5'), TypeError);
  assert.throws(() => t.query(null), TypeError);
  assert.throws(() => t.query(undefined), TypeError);
  assert.throws(() => t.query(NaN), RangeError);
  assert.throws(() => t.query(Infinity), RangeError);
  assert.throws(() => t.query(5.5), RangeError, 'non-integer');
  assert.throws(() => t.query(11), RangeError, 'above domain');
  assert.throws(() => t.query(-1), RangeError, 'below domain');
});

test('query validates x even on an empty tree (before checking emptiness)', () => {
  const t = new LiChaoTree(0, 10);
  assert.throws(() => t.query(-1), RangeError);
  assert.throws(() => t.query('5'), TypeError);
  assert.equal(t.query(5), null, 'a genuinely valid query on an empty tree still returns null');
});

test('many lines in one tree resolve correctly at many query points (structural sanity)', () => {
  const t = new LiChaoTree(-20, 20);
  const lines = [
    [1, 0, 'l0'],
    [-1, 0, 'l1'],
    [0, 10, 'l2'],
    [2, -5, 'l3'],
    [-2, 5, 'l4'],
    [0, -10, 'l5'],
  ];
  for (const [slope, intercept, label] of lines) {
    t.addLine(slope, intercept, label);
  }
  for (let x = -20; x <= 20; x++) {
    let bestVal = Infinity;
    let bestLabel = null;
    for (const [slope, intercept, label] of lines) {
      const v = slope * x + intercept;
      if (v < bestVal) {
        bestVal = v;
        bestLabel = label;
      }
    }
    const result = t.query(x);
    assert.equal(result.value, bestVal, `value mismatch at x=${x}`);
    assert.equal(result.label, bestLabel, `label mismatch at x=${x}`);
  }
});

// --- Deterministic randomized differential coverage -------------------
//
// xorshift32(0xC0FFEE), >= 500 randomly generated trees (0-8 code lines,
// randomized domain), each queried at >= 10 points, checked against an
// independent linear-scan reference (`referenceQuery`, defined below in
// this file) that re-evaluates every inserted line directly and picks the
// minimum by (value, insertion-seq) -- structurally unrelated to the
// segment-tree/lazy-node decomposition technique under test.

function xorshift32(seed) {
  let state = seed >>> 0;
  return function next() {
    state ^= state << 13; state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5; state >>>= 0;
    return state / 4294967296;
  };
}

function referenceQuery(lines, x) {
  if (lines.length === 0) return null;
  let bestVal = Infinity;
  let bestSeq = Infinity;
  let bestLabel = null;
  lines.forEach((line, seq) => {
    const val = line.slope * x + line.intercept;
    if (val < bestVal || (val === bestVal && seq < bestSeq)) {
      bestVal = val;
      bestSeq = seq;
      bestLabel = line.label;
    }
  });
  return { value: bestVal, label: bestLabel };
}

test('deterministic randomized differential coverage: xorshift32(0xC0FFEE), >= 500 small trees (0-8 lines) against an independent linear-scan reference, >= 10 queries each', () => {
  const rand = xorshift32(0xC0FFEE);
  const trials = 550;
  let checked = 0;

  for (let trial = 0; trial < trials; trial++) {
    const minX = Math.floor(rand() * 41) - 20; // -20..20
    const span = Math.floor(rand() * 41); // 0..40
    const maxX = minX + span;

    const tree = new LiChaoTree(minX, maxX);
    const refLines = [];
    const numLines = Math.floor(rand() * 9); // 0..8

    for (let i = 0; i < numLines; i++) {
      const slope = Math.floor(rand() * 21) - 10; // -10..10
      const intercept = Math.floor(rand() * 401) - 200; // -200..200
      const label = `l${i}`;
      tree.addLine(slope, intercept, label);
      refLines.push({ slope, intercept, label });
    }

    assert.equal(tree.size, numLines, `size mismatch for trial ${trial}`);

    const numQueries = 10 + Math.floor(rand() * 10); // 10..19
    for (let q = 0; q < numQueries; q++) {
      const x = minX + Math.floor(rand() * (maxX - minX + 1));
      const got = tree.query(x);
      const want = referenceQuery(refLines, x);
      assert.deepEqual(
        got,
        want,
        `mismatch trial=${trial} x=${x} minX=${minX} maxX=${maxX} numLines=${numLines}`
      );
      checked++;
    }
  }

  assert.ok(checked >= 1000, `expected at least 1000 checks, got ${checked}`);
});
