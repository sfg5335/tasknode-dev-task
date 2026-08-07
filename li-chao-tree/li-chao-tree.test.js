'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { LiChaoTree } = require('./li-chao-tree.js');

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

// Independent brute-force oracle: remembers every inserted
// (slope, intercept, startX, endX, value, insertionIndex) tuple and
// answers query(x) by a linear scan, taking the minimum y and breaking
// exact ties by insertion order -- structurally unrelated to the
// LiChaoTree's own node/swap bookkeeping.
class BruteLiChao {
  constructor(minX, maxX) {
    this.minX = minX;
    this.maxX = maxX;
    this.entries = [];
  }
  addLine(slope, intercept, value) {
    this.entries.push({ slope, intercept, startX: this.minX, endX: this.maxX, value, idx: this.entries.length });
  }
  addSegment(slope, intercept, startX, endX, value) {
    this.entries.push({ slope, intercept, startX, endX, value, idx: this.entries.length });
  }
  query(x) {
    let best = null;
    for (const e of this.entries) {
      if (x < e.startX || x > e.endX) continue;
      const y = e.slope * x + e.intercept;
      if (best === null || y < best.y || (y === best.y && e.idx < best.idx)) {
        best = { y, value: e.value, idx: e.idx };
      }
    }
    return best === null ? null : { y: best.y, value: best.value };
  }
}

// ---- basic construction / empty queries ----

test('empty tree returns null for every query', () => {
  const t = new LiChaoTree(-5, 5);
  for (let x = -5; x <= 5; x++) {
    assert.equal(t.query(x), null);
  }
  assert.equal(t.size, 0);
});

test('single-point domain works', () => {
  const t = new LiChaoTree(3, 3);
  assert.equal(t.query(3), null);
  t.addLine(2, 1, 'only');
  assert.deepEqual(t.query(3), { y: 7, value: 'only' });
});

test('size tracks number of addLine/addSegment calls', () => {
  const t = new LiChaoTree(0, 10);
  assert.equal(t.size, 0);
  t.addLine(1, 0, 'a');
  assert.equal(t.size, 1);
  t.addSegment(2, 0, 3, 7, 'b');
  assert.equal(t.size, 2);
  t.addLine(-1, 5, 'c');
  assert.equal(t.size, 3);
});

// ---- crossing and parallel lines ----

test('crossing lines: minimum switches sides at the intersection', () => {
  const t = new LiChaoTree(-10, 10);
  t.addLine(1, 0, 'y=x'); // y = x
  t.addLine(-1, 0, 'y=-x'); // y = -x
  // for x < 0, -x > x is false when x<0... check directly:
  // at x=-5: y=x gives -5, y=-x gives 5 -> min is y=x (-5)
  assert.deepEqual(t.query(-5), { y: -5, value: 'y=x' });
  // at x=5: y=x gives 5, y=-x gives -5 -> min is y=-x (-5)
  assert.deepEqual(t.query(5), { y: -5, value: 'y=-x' });
  // at x=0: both give 0 -> tie, earliest inserted (y=x) wins
  assert.deepEqual(t.query(0), { y: 0, value: 'y=x' });
});

test('parallel lines: the lower one always wins, never the higher', () => {
  const t = new LiChaoTree(-20, 20);
  t.addLine(3, 10, 'higher');
  t.addLine(3, -4, 'lower'); // same slope, strictly smaller at every x
  for (let x = -20; x <= 20; x++) {
    assert.deepEqual(t.query(x), { y: 3 * x - 4, value: 'lower' });
  }
});

test('three mutually-crossing lines pick the true lower envelope', () => {
  const t = new LiChaoTree(-10, 10);
  t.addLine(0, 5, 'flat'); // y = 5
  t.addLine(2, 0, 'up'); // y = 2x
  t.addLine(-2, 0, 'down'); // y = -2x
  for (let x = -10; x <= 10; x++) {
    // Use `===` rather than assert.equal/strictEqual here: strict-mode
    // assert compares via Object.is, which (correctly) distinguishes
    // +0 from -0, but `-2 * 0` is mathematically the same *value* as
    // `2 * 0` (both "zero") -- the sign-of-zero distinction isn't
    // meaningful for this test, so plain `===` (which treats them as
    // equal, like ordinary arithmetic) is what we actually want here.
    const expected = Math.min(5, 2 * x, -2 * x);
    assert.ok(t.query(x).y === expected, `x=${x}: got ${t.query(x).y}, expected ${expected}`);
  }
});

// ---- ties and duplicate lines ----

test('exact tie at a single point breaks by insertion order', () => {
  const t = new LiChaoTree(0, 20);
  t.addLine(1, 0, 'first'); // y = x
  t.addLine(2, -10, 'second'); // y = 2x - 10; crosses first exactly at x=10 (y=10)
  assert.deepEqual(t.query(10), { y: 10, value: 'first' });
  // off the crossing point, whichever is smaller wins normally: at
  // x=0, first gives 0 and second gives -10, so second (the smaller
  // value) wins here -- insertion order only matters exactly at the
  // tie point (x=10) above.
  assert.deepEqual(t.query(0), { y: -10, value: 'second' });
});

test('duplicate identical lines: earliest insertion always wins, everywhere', () => {
  const t = new LiChaoTree(-15, 15);
  t.addLine(3, -2, 'v1');
  t.addLine(3, -2, 'v2'); // exact duplicate
  t.addLine(3, -2, 'v3'); // exact duplicate again
  for (let x = -15; x <= 15; x++) {
    assert.deepEqual(t.query(x), { y: 3 * x - 2, value: 'v1' });
  }
});

test('duplicate lines inserted out of "value order" still resolve by insertion order, not value', () => {
  const t = new LiChaoTree(0, 5);
  t.addLine(0, 7, 'z-inserted-first');
  t.addLine(0, 7, 'a-inserted-second');
  for (let x = 0; x <= 5; x++) {
    assert.equal(t.query(x).value, 'z-inserted-first');
  }
});

test('many lines tying at exactly one shared point resolve to the earliest', () => {
  const t = new LiChaoTree(-10, 10);
  const crossX = 4;
  const crossY = 3;
  // slopes -5..5 excluding 0 duplicates aside, all lines pass through (crossX, crossY)
  const slopes = [-5, -3, -1, 1, 2, 5];
  for (const slope of slopes) {
    const intercept = crossY - slope * crossX;
    t.addLine(slope, intercept, `slope${slope}`);
  }
  // earliest inserted is slope -5
  assert.deepEqual(t.query(crossX), { y: crossY, value: 'slope-5' });
});

// ---- partial segments ----

test('addSegment only affects its declared sub-range', () => {
  const t = new LiChaoTree(0, 100);
  t.addLine(0, 1000, 'ceiling');
  t.addSegment(1, 0, 10, 20, 'seg'); // y = x, active only on [10,20]
  assert.deepEqual(t.query(5), { y: 1000, value: 'ceiling' });
  assert.deepEqual(t.query(9), { y: 1000, value: 'ceiling' });
  assert.deepEqual(t.query(10), { y: 10, value: 'seg' });
  assert.deepEqual(t.query(15), { y: 15, value: 'seg' });
  assert.deepEqual(t.query(20), { y: 20, value: 'seg' });
  assert.deepEqual(t.query(21), { y: 1000, value: 'ceiling' });
  assert.deepEqual(t.query(100), { y: 1000, value: 'ceiling' });
});

test('addSegment with startX === endX affects only that single point', () => {
  const t = new LiChaoTree(0, 20);
  t.addLine(0, 100, 'base');
  t.addSegment(0, -50, 7, 7, 'point');
  assert.deepEqual(t.query(6), { y: 100, value: 'base' });
  assert.deepEqual(t.query(7), { y: -50, value: 'point' });
  assert.deepEqual(t.query(8), { y: 100, value: 'base' });
});

test('overlapping segments compose correctly (lower one wins in overlap)', () => {
  const t = new LiChaoTree(0, 30);
  t.addSegment(0, 5, 0, 20, 'left'); // y=5 on [0,20]
  t.addSegment(0, 2, 10, 30, 'right'); // y=2 on [10,30]
  assert.deepEqual(t.query(5), { y: 5, value: 'left' }); // only left covers
  assert.deepEqual(t.query(15), { y: 2, value: 'right' }); // both cover, right lower
  assert.deepEqual(t.query(25), { y: 2, value: 'right' }); // only right covers
});

test('addLine is equivalent to addSegment over the full domain', () => {
  const a = new LiChaoTree(-5, 5);
  const b = new LiChaoTree(-5, 5);
  a.addLine(2, 3, 'x');
  b.addSegment(2, 3, -5, 5, 'x');
  for (let x = -5; x <= 5; x++) {
    assert.deepEqual(a.query(x), b.query(x));
  }
});

// ---- domain boundaries ----

test('domain boundary queries at minX and maxX work', () => {
  const t = new LiChaoTree(-3, 3);
  t.addLine(4, 1, 'line');
  assert.deepEqual(t.query(-3), { y: -11, value: 'line' });
  assert.deepEqual(t.query(3), { y: 13, value: 'line' });
});

test('segment exactly matching the full domain equals addLine', () => {
  const t = new LiChaoTree(-4, 4);
  t.addSegment(1, 1, -4, 4, 's');
  for (let x = -4; x <= 4; x++) {
    assert.deepEqual(t.query(x), { y: x + 1, value: 's' });
  }
});

test('segment touching only the domain boundary point', () => {
  const t = new LiChaoTree(0, 50);
  t.addLine(0, 9, 'base');
  t.addSegment(0, -1, 50, 50, 'edge');
  assert.deepEqual(t.query(49), { y: 9, value: 'base' });
  assert.deepEqual(t.query(50), { y: -1, value: 'edge' });
});

// ---- negative coordinates ----

test('fully negative domain works throughout', () => {
  const t = new LiChaoTree(-100, -50);
  t.addLine(2, 10, 'a');
  t.addLine(-1, -20, 'b');
  for (let x = -100; x <= -50; x++) {
    const expected = Math.min(2 * x + 10, -x - 20);
    assert.equal(t.query(x).y, expected);
  }
});

test('domain and segment bounds spanning negative to positive', () => {
  const t = new LiChaoTree(-50, 50);
  t.addSegment(1, 0, -50, -1, 'neg-half'); // y=x on [-50,-1]
  t.addSegment(-1, 0, 0, 50, 'pos-half'); // y=-x on [0,50]
  assert.deepEqual(t.query(-25), { y: -25, value: 'neg-half' });
  assert.deepEqual(t.query(0), { y: 0, value: 'pos-half' });
  assert.deepEqual(t.query(25), { y: -25, value: 'pos-half' });
});

// ---- fractional coefficients ----

test('fractional slope and intercept are evaluated exactly (within float precision)', () => {
  const t = new LiChaoTree(-10, 10);
  t.addLine(0.5, 1.25, 'frac');
  const r = t.query(4);
  assert.equal(r.y, 0.5 * 4 + 1.25);
  assert.equal(r.value, 'frac');
});

test('fractional lines cross and select correctly like integer ones', () => {
  const t = new LiChaoTree(-20, 20);
  t.addLine(0.25, -1.5, 'a');
  t.addLine(-0.75, 3.5, 'b');
  for (let x = -20; x <= 20; x++) {
    const ya = 0.25 * x - 1.5;
    const yb = -0.75 * x + 3.5;
    const expected = Math.min(ya, yb);
    assert.ok(Math.abs(t.query(x).y - expected) < 1e-9);
  }
});

// ---- invalid inputs ----

test('constructor validates minX/maxX types and ordering', () => {
  assert.throws(() => new LiChaoTree(1.5, 10), TypeError);
  assert.throws(() => new LiChaoTree(NaN, 10), TypeError);
  assert.throws(() => new LiChaoTree('0', 10), TypeError);
  assert.throws(() => new LiChaoTree(0, 1.5), TypeError);
  assert.throws(() => new LiChaoTree(0, '10'), TypeError);
  assert.throws(() => new LiChaoTree(10, 0), RangeError);
});

test('addLine validates slope/intercept', () => {
  const t = new LiChaoTree(0, 10);
  assert.throws(() => t.addLine('1', 0, 'v'), TypeError);
  assert.throws(() => t.addLine(1, '0', 'v'), TypeError);
  assert.throws(() => t.addLine(NaN, 0, 'v'), RangeError);
  assert.throws(() => t.addLine(1, NaN, 'v'), RangeError);
  assert.throws(() => t.addLine(Infinity, 0, 'v'), RangeError);
  assert.throws(() => t.addLine(1, -Infinity, 'v'), RangeError);
});

test('addSegment validates coefficients, coordinate types, ordering, and domain containment', () => {
  const t = new LiChaoTree(-10, 10);
  assert.throws(() => t.addSegment('1', 0, 0, 5, 'v'), TypeError);
  assert.throws(() => t.addSegment(1, 0, 0.5, 5, 'v'), TypeError);
  assert.throws(() => t.addSegment(1, 0, 0, 5.5, 'v'), TypeError);
  assert.throws(() => t.addSegment(1, 0, 5, 0, 'v'), RangeError); // reversed
  assert.throws(() => t.addSegment(1, 0, -20, 5, 'v'), RangeError); // startX < minX
  assert.throws(() => t.addSegment(1, 0, 0, 20, 'v'), RangeError); // endX > maxX
  assert.throws(() => t.addSegment(1, 0, -20, 20, 'v'), RangeError); // both out
});

test('query validates x type and domain containment', () => {
  const t = new LiChaoTree(-5, 5);
  t.addLine(1, 0, 'v');
  assert.throws(() => t.query(1.5), TypeError);
  assert.throws(() => t.query(NaN), TypeError);
  assert.throws(() => t.query('0'), TypeError);
  assert.throws(() => t.query(-6), RangeError);
  assert.throws(() => t.query(6), RangeError);
});

test('addLine/addSegment do not increment size or mutate state when validation throws', () => {
  const t = new LiChaoTree(0, 10);
  t.addLine(1, 0, 'ok');
  assert.equal(t.size, 1);
  assert.throws(() => t.addLine(NaN, 0, 'bad'));
  assert.equal(t.size, 1);
  assert.throws(() => t.addSegment(1, 0, 20, 30, 'bad'));
  assert.equal(t.size, 1);
});

// ---- brute-force comparison across many deterministic insertion sequences ----

test('differential: many small random domains, mixed addLine/addSegment, full-domain query sweep', () => {
  for (let seed = 1; seed <= 150; seed++) {
    const rng = mulberry32(seed * 7919 + 13);
    const minX = Math.floor(rng() * 21) - 10;
    const span = Math.floor(rng() * 40) + 1;
    const maxX = minX + span;
    const real = new LiChaoTree(minX, maxX);
    const brute = new BruteLiChao(minX, maxX);
    const numOps = 20 + Math.floor(rng() * 30);
    for (let i = 0; i < numOps; i++) {
      const isSegment = rng() < 0.5;
      const slope = Math.floor(rng() * 21) - 10;
      const intercept = Math.floor(rng() * 21) - 10;
      const value = `v${seed}_${i}`;
      if (isSegment) {
        const a = minX + Math.floor(rng() * (maxX - minX + 1));
        const b = minX + Math.floor(rng() * (maxX - minX + 1));
        const startX = Math.min(a, b);
        const endX = Math.max(a, b);
        real.addSegment(slope, intercept, startX, endX, value);
        brute.addSegment(slope, intercept, startX, endX, value);
      } else {
        real.addLine(slope, intercept, value);
        brute.addLine(slope, intercept, value);
      }
    }
    for (let x = minX; x <= maxX; x++) {
      assert.deepEqual(real.query(x), brute.query(x), `seed=${seed} x=${x}`);
    }
  }
});

test('differential: duplicate-line-heavy sequences (small distinct-line pool, many repeats)', () => {
  for (let seed = 1; seed <= 100; seed++) {
    const rng = mulberry32(seed * 104729 + 3);
    const minX = -20;
    const maxX = 20;
    const real = new LiChaoTree(minX, maxX);
    const brute = new BruteLiChao(minX, maxX);
    const poolSize = 2 + Math.floor(rng() * 3);
    const pool = [];
    for (let p = 0; p < poolSize; p++) {
      pool.push({ slope: Math.floor(rng() * 7) - 3, intercept: Math.floor(rng() * 7) - 3 });
    }
    const numOps = 15 + Math.floor(rng() * 25);
    for (let i = 0; i < numOps; i++) {
      const pick = pool[Math.floor(rng() * pool.length)];
      const value = `dup${seed}_${i}`;
      const isSegment = rng() < 0.4;
      if (isSegment) {
        const a = minX + Math.floor(rng() * (maxX - minX + 1));
        const b = minX + Math.floor(rng() * (maxX - minX + 1));
        const startX = Math.min(a, b);
        const endX = Math.max(a, b);
        real.addSegment(pick.slope, pick.intercept, startX, endX, value);
        brute.addSegment(pick.slope, pick.intercept, startX, endX, value);
      } else {
        real.addLine(pick.slope, pick.intercept, value);
        brute.addLine(pick.slope, pick.intercept, value);
      }
    }
    for (let x = minX; x <= maxX; x++) {
      assert.deepEqual(real.query(x), brute.query(x), `seed=${seed} x=${x}`);
    }
  }
});

test('differential: many lines deliberately crossing at exactly one shared checkpoint, random insertion order', () => {
  for (let seed = 1; seed <= 100; seed++) {
    const rng = mulberry32(seed * 65599 + 101);
    const minX = -15;
    const maxX = 15;
    const crossX = minX + Math.floor(rng() * (maxX - minX + 1));
    const crossY = Math.floor(rng() * 11) - 5;
    const real = new LiChaoTree(minX, maxX);
    const brute = new BruteLiChao(minX, maxX);
    const numLines = 3 + Math.floor(rng() * 6);
    const usedSlopes = new Set();
    const lines = [];
    while (lines.length < numLines) {
      const slope = Math.floor(rng() * 13) - 6;
      if (usedSlopes.has(slope)) continue;
      usedSlopes.add(slope);
      const intercept = crossY - slope * crossX;
      lines.push({ slope, intercept });
    }
    const shuffled = lines.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    for (let i = 0; i < shuffled.length; i++) {
      const value = `cross${seed}_${i}`;
      real.addLine(shuffled[i].slope, shuffled[i].intercept, value);
      brute.addLine(shuffled[i].slope, shuffled[i].intercept, value);
      if (rng() < 0.3) {
        const a = minX + Math.floor(rng() * (maxX - minX + 1));
        const b = minX + Math.floor(rng() * (maxX - minX + 1));
        const startX = Math.min(a, b);
        const endX = Math.max(a, b);
        const rslope = Math.floor(rng() * 9) - 4;
        const rintercept = Math.floor(rng() * 9) - 4;
        const rvalue = `noise${seed}_${i}`;
        real.addSegment(rslope, rintercept, startX, endX, rvalue);
        brute.addSegment(rslope, rintercept, startX, endX, rvalue);
      }
    }
    for (let x = minX; x <= maxX; x++) {
      assert.deepEqual(real.query(x), brute.query(x), `seed=${seed} x=${x}`);
    }
    assert.deepEqual(real.query(crossX), brute.query(crossX), `final cross seed=${seed}`);
  }
});

test('differential: wide domain with fractional coefficients, sparse point sampling', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const rng = mulberry32(seed * 998244353 + 17);
    const minX = -1000;
    const maxX = 1000;
    const real = new LiChaoTree(minX, maxX);
    const brute = new BruteLiChao(minX, maxX);
    const numOps = 30 + Math.floor(rng() * 30);
    const sampleXs = [];
    for (let s = 0; s < 40; s++) sampleXs.push(minX + Math.floor(rng() * (maxX - minX + 1)));
    for (let i = 0; i < numOps; i++) {
      const isSegment = rng() < 0.5;
      const slope = rng() * 20 - 10;
      const intercept = rng() * 20 - 10;
      const value = `frac${seed}_${i}`;
      if (isSegment) {
        const a = minX + Math.floor(rng() * (maxX - minX + 1));
        const b = minX + Math.floor(rng() * (maxX - minX + 1));
        const startX = Math.min(a, b);
        const endX = Math.max(a, b);
        real.addSegment(slope, intercept, startX, endX, value);
        brute.addSegment(slope, intercept, startX, endX, value);
      } else {
        real.addLine(slope, intercept, value);
        brute.addLine(slope, intercept, value);
      }
    }
    for (const x of sampleXs) {
      assert.deepEqual(real.query(x), brute.query(x), `seed=${seed} x=${x}`);
    }
  }
});
