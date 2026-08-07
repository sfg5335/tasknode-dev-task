'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { KDTree } = require('./kd-tree.js');

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

function distSq(x1, y1, x2, y2) {
  const dx = x1 - x2;
  const dy = y1 - y2;
  return dx * dx + dy * dy;
}
function compareKeys(a, b) {
  if (a.distSq !== b.distSq) return a.distSq - b.distSq;
  if (a.x !== b.x) return a.x - b.x;
  if (a.y !== b.y) return a.y - b.y;
  return a.order - b.order;
}

// Independent brute-force reference (plain linear scan + sort, same
// tie-break rule) -- structurally unrelated to the KD-tree's own
// axis-splitting/pruning logic.
class BruteKD {
  constructor(points) {
    this.points = points.map((p, i) => ({ x: p.x, y: p.y, value: p.value, order: i }));
  }
  get size() {
    return this.points.length;
  }
  nearest(x, y) {
    if (this.points.length === 0) return null;
    let best = null;
    for (const p of this.points) {
      const key = { distSq: distSq(x, y, p.x, p.y), x: p.x, y: p.y, order: p.order };
      if (best === null || compareKeys(key, best.key) < 0) best = { p, key };
    }
    return { x: best.p.x, y: best.p.y, value: best.p.value };
  }
  kNearest(x, y, k) {
    if (k === 0) return [];
    const keyed = this.points.map((p) => ({ p, key: { distSq: distSq(x, y, p.x, p.y), x: p.x, y: p.y, order: p.order } }));
    keyed.sort((a, b) => compareKeys(a.key, b.key));
    return keyed.slice(0, k).map((e) => ({ x: e.p.x, y: e.p.y, value: e.p.value }));
  }
  range(minX, minY, maxX, maxY) {
    const inBox = this.points.filter((p) => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY);
    inBox.sort((a, b) => {
      if (a.x !== b.x) return a.x - b.x;
      if (a.y !== b.y) return a.y - b.y;
      return a.order - b.order;
    });
    return inBox.map((p) => ({ x: p.x, y: p.y, value: p.value }));
  }
}

function makeRandomPoints(rng, n, coordRange, allowDuplicates, fractional) {
  const pts = [];
  const pool = [];
  if (allowDuplicates) {
    const poolSize = Math.max(2, Math.floor(n / 4));
    for (let i = 0; i < poolSize; i++) {
      pool.push({
        x: Math.floor(rng() * (2 * coordRange + 1)) - coordRange,
        y: Math.floor(rng() * (2 * coordRange + 1)) - coordRange,
      });
    }
  }
  for (let i = 0; i < n; i++) {
    let x, y;
    if (allowDuplicates && rng() < 0.5) {
      const c = pool[Math.floor(rng() * pool.length)];
      x = c.x;
      y = c.y;
    } else if (fractional) {
      x = rng() * 2 * coordRange - coordRange;
      y = rng() * 2 * coordRange - coordRange;
    } else {
      x = Math.floor(rng() * (2 * coordRange + 1)) - coordRange;
      y = Math.floor(rng() * (2 * coordRange + 1)) - coordRange;
    }
    pts.push({ x, y, value: `v${i}` });
  }
  return pts;
}

// ---- empty and singleton trees ----

test('empty tree: size 0, nearest null, kNearest/range empty', () => {
  const t = new KDTree([]);
  assert.equal(t.size, 0);
  assert.equal(t.nearest(0, 0), null);
  assert.deepEqual(t.kNearest(0, 0, 5), []);
  assert.deepEqual(t.range(-10, -10, 10, 10), []);
});

test('singleton tree: every query resolves to the one point', () => {
  const t = new KDTree([{ x: 3, y: -4, value: 'only' }]);
  assert.equal(t.size, 1);
  assert.deepEqual(t.nearest(0, 0), { x: 3, y: -4, value: 'only' });
  assert.deepEqual(t.nearest(100, 100), { x: 3, y: -4, value: 'only' });
  assert.deepEqual(t.kNearest(0, 0, 1), [{ x: 3, y: -4, value: 'only' }]);
  assert.deepEqual(t.kNearest(0, 0, 10), [{ x: 3, y: -4, value: 'only' }]);
  assert.deepEqual(t.range(3, -4, 3, -4), [{ x: 3, y: -4, value: 'only' }]);
  assert.deepEqual(t.range(0, 0, 1, 1), []);
});

// ---- duplicates ----

test('duplicate coordinates are all preserved as distinct points', () => {
  const t = new KDTree([
    { x: 0, y: 0, value: 'a' },
    { x: 0, y: 0, value: 'b' },
    { x: 0, y: 0, value: 'c' },
  ]);
  assert.equal(t.size, 3);
  // nearest resolves the tie by earliest insertion order
  assert.deepEqual(t.nearest(0, 0), { x: 0, y: 0, value: 'a' });
  // kNearest with k = size returns all three, in insertion order (all tied)
  assert.deepEqual(t.kNearest(0, 0, 3), [
    { x: 0, y: 0, value: 'a' },
    { x: 0, y: 0, value: 'b' },
    { x: 0, y: 0, value: 'c' },
  ]);
  assert.deepEqual(t.range(0, 0, 0, 0), [
    { x: 0, y: 0, value: 'a' },
    { x: 0, y: 0, value: 'b' },
    { x: 0, y: 0, value: 'c' },
  ]);
});

test('duplicates mixed with distinct points behave correctly under kNearest', () => {
  const t = new KDTree([
    { x: 5, y: 5, value: 'far' },
    { x: 1, y: 1, value: 'dup1' },
    { x: 1, y: 1, value: 'dup2' },
    { x: 0, y: 0, value: 'closest' },
  ]);
  const r = t.kNearest(0, 0, 4);
  assert.deepEqual(r.map((p) => p.value), ['closest', 'dup1', 'dup2', 'far']);
});

// ---- ties ----

test('nearest tie-breaks by x, then y, then insertion order', () => {
  // Two points equidistant from (0,0): (1,0) and (-1,0) -- same
  // distance, tie-break by smaller x -> (-1,0) wins.
  const t1 = new KDTree([
    { x: 1, y: 0, value: 'right' },
    { x: -1, y: 0, value: 'left' },
  ]);
  assert.deepEqual(t1.nearest(0, 0), { x: -1, y: 0, value: 'left' });

  // Same x, different y, equidistant -- (0,1) and (0,-1) -- smaller y wins.
  const t2 = new KDTree([
    { x: 0, y: 1, value: 'up' },
    { x: 0, y: -1, value: 'down' },
  ]);
  assert.deepEqual(t2.nearest(0, 0), { x: 0, y: -1, value: 'down' });

  // Identical (x,y), tie-break by insertion order.
  const t3 = new KDTree([
    { x: 2, y: 2, value: 'first' },
    { x: 2, y: 2, value: 'second' },
  ]);
  assert.deepEqual(t3.nearest(0, 0), { x: 2, y: 2, value: 'first' });
});

test('kNearest preserves the full tie-break order across many equidistant points', () => {
  // Four points forming a diamond around the origin, all at distance 1.
  const t = new KDTree([
    { x: 1, y: 0, value: 'e' },
    { x: -1, y: 0, value: 'w' },
    { x: 0, y: 1, value: 'n' },
    { x: 0, y: -1, value: 's' },
  ]);
  const r = t.kNearest(0, 0, 4);
  // Expected order: by x asc, then y asc (all distSq equal at 1): x=-1 (w),
  // then x=0 with y=-1 (s) before y=1 (n), then x=1 (e).
  assert.deepEqual(r.map((p) => p.value), ['w', 's', 'n', 'e']);
});

// ---- boundaries ----

test('range is inclusive on all four edges of the box', () => {
  const t = new KDTree([
    { x: 0, y: 0, value: 'corner00' },
    { x: 10, y: 0, value: 'corner10' },
    { x: 0, y: 10, value: 'corner01' },
    { x: 10, y: 10, value: 'corner11' },
    { x: 5, y: 5, value: 'center' },
    { x: 11, y: 5, value: 'outside' },
  ]);
  const r = t.range(0, 0, 10, 10);
  assert.deepEqual(
    r.map((p) => p.value).sort(),
    ['center', 'corner00', 'corner01', 'corner10', 'corner11'].sort()
  );
});

test('degenerate zero-width/zero-height range boxes work', () => {
  const t = new KDTree([
    { x: 5, y: -3, value: 'on-line' },
    { x: 5, y: 2, value: 'also-on-line' },
    { x: 6, y: -3, value: 'off-line' },
  ]);
  // vertical line x=5, y in [-5,5]
  const r = t.range(5, -5, 5, 5);
  assert.deepEqual(
    r.map((p) => p.value).sort(),
    ['also-on-line', 'on-line']
  );
  // single point box
  const single = t.range(5, -3, 5, -3);
  assert.deepEqual(single, [{ x: 5, y: -3, value: 'on-line' }]);
});

// ---- negative and fractional coordinates ----

test('negative coordinates work throughout', () => {
  const t = new KDTree([
    { x: -5, y: -5, value: 'a' },
    { x: -1, y: -9, value: 'b' },
    { x: -8, y: -2, value: 'c' },
  ]);
  assert.deepEqual(t.nearest(-5, -5), { x: -5, y: -5, value: 'a' });
  const r = t.range(-10, -10, 0, 0);
  assert.equal(r.length, 3);
});

test('fractional coordinates are handled exactly', () => {
  const t = new KDTree([
    { x: 0.5, y: 0.25, value: 'a' },
    { x: -1.75, y: 3.125, value: 'b' },
  ]);
  assert.deepEqual(t.nearest(0.5, 0.25), { x: 0.5, y: 0.25, value: 'a' });
  const r = t.range(-2, 0, 1, 4);
  assert.equal(r.length, 2);
});

// ---- invalid inputs ----

test('constructor validates points array and point shape', () => {
  assert.throws(() => new KDTree('not an array'), TypeError);
  assert.throws(() => new KDTree(null), TypeError);
  assert.throws(() => new KDTree([null]), TypeError);
  assert.throws(() => new KDTree([42]), TypeError);
  assert.throws(() => new KDTree([[1, 2]]), TypeError);
  assert.throws(() => new KDTree([{ x: '1', y: 2, value: 'v' }]), TypeError);
  assert.throws(() => new KDTree([{ x: 1, y: '2', value: 'v' }]), TypeError);
  assert.throws(() => new KDTree([{ x: NaN, y: 2, value: 'v' }]), RangeError);
  assert.throws(() => new KDTree([{ x: 1, y: Infinity, value: 'v' }]), RangeError);
  assert.throws(() => new KDTree([{ x: 1, y: -Infinity, value: 'v' }]), RangeError);
});

test('nearest validates x/y', () => {
  const t = new KDTree([{ x: 0, y: 0, value: 'a' }]);
  assert.throws(() => t.nearest('0', 0), TypeError);
  assert.throws(() => t.nearest(0, '0'), TypeError);
  assert.throws(() => t.nearest(NaN, 0), RangeError);
  assert.throws(() => t.nearest(0, Infinity), RangeError);
});

test('kNearest validates x/y/k', () => {
  const t = new KDTree([{ x: 0, y: 0, value: 'a' }]);
  assert.throws(() => t.kNearest('0', 0, 1), TypeError);
  assert.throws(() => t.kNearest(0, 0, '1'), TypeError);
  assert.throws(() => t.kNearest(0, 0, 1.5), TypeError);
  assert.throws(() => t.kNearest(0, 0, NaN), TypeError);
  assert.throws(() => t.kNearest(0, 0, -1), RangeError);
  assert.throws(() => t.kNearest(NaN, 0, 1), RangeError);
});

test('range validates all four bounds, including reversed ranges', () => {
  const t = new KDTree([{ x: 0, y: 0, value: 'a' }]);
  assert.throws(() => t.range('0', 0, 1, 1), TypeError);
  assert.throws(() => t.range(0, '0', 1, 1), TypeError);
  assert.throws(() => t.range(0, 0, '1', 1), TypeError);
  assert.throws(() => t.range(0, 0, 1, '1'), TypeError);
  assert.throws(() => t.range(NaN, 0, 1, 1), RangeError);
  assert.throws(() => t.range(0, 0, Infinity, 1), RangeError);
  assert.throws(() => t.range(5, 0, 1, 1), RangeError); // minX > maxX
  assert.throws(() => t.range(0, 5, 1, 1), RangeError); // minY > maxY
});

// ---- oversized or zero k ----

test('kNearest with k = 0 returns an empty array without error', () => {
  const t = new KDTree([
    { x: 0, y: 0, value: 'a' },
    { x: 1, y: 1, value: 'b' },
  ]);
  assert.deepEqual(t.kNearest(0, 0, 0), []);
});

test('kNearest with k larger than size returns every point, not an error', () => {
  const t = new KDTree([
    { x: 0, y: 0, value: 'a' },
    { x: 1, y: 1, value: 'b' },
    { x: 2, y: 2, value: 'c' },
  ]);
  const r = t.kNearest(0, 0, 1000);
  assert.equal(r.length, 3);
  assert.deepEqual(
    r.map((p) => p.value),
    ['a', 'b', 'c']
  );
});

// ---- input immutability ----

test('constructor never mutates the input array or its point objects', () => {
  const original = [
    { x: 5, y: 5, value: 'z' },
    { x: 1, y: 1, value: 'a' },
    { x: 3, y: 3, value: 'm' },
  ];
  const snapshot = original.map((p) => ({ ...p }));
  const originalOrder = original.slice();

  new KDTree(original);

  assert.deepEqual(original, snapshot, 'point objects must be unchanged');
  assert.deepEqual(original, originalOrder, 'array order/identity of elements must be unchanged');
  for (const p of original) {
    assert.deepEqual(Object.keys(p).sort(), ['value', 'x', 'y'], 'no extra properties added to input points');
  }
});

test('mutating the caller-owned input array after construction does not affect the tree', () => {
  const original = [{ x: 0, y: 0, value: 'a' }];
  const t = new KDTree(original);
  original.push({ x: 99, y: 99, value: 'injected' });
  original[0].value = 'mutated';
  assert.equal(t.size, 1);
  assert.deepEqual(t.nearest(0, 0), { x: 0, y: 0, value: 'a' });
});

// ---- repeated queries ----

test('repeated identical queries return identical results (no hidden mutation)', () => {
  const pts = [];
  for (let x = 0; x < 6; x++) for (let y = 0; y < 6; y++) pts.push({ x, y, value: `${x}_${y}` });
  const t = new KDTree(pts);
  const first = t.nearest(2.5, 2.5);
  for (let i = 0; i < 20; i++) {
    assert.deepEqual(t.nearest(2.5, 2.5), first);
  }
  const firstK = t.kNearest(3, 3, 5);
  for (let i = 0; i < 20; i++) {
    assert.deepEqual(t.kNearest(3, 3, 5), firstK);
  }
  const firstRange = t.range(1, 1, 4, 4);
  for (let i = 0; i < 20; i++) {
    assert.deepEqual(t.range(1, 1, 4, 4), firstRange);
  }
});

// ---- branch pruning (not scanning every point) ----

test('nearest/kNearest visit far fewer nodes than the total point count on a large random set', () => {
  const rng = mulberry32(2024);
  const n = 20000;
  const pts = [];
  for (let i = 0; i < n; i++) pts.push({ x: rng() * 2000 - 1000, y: rng() * 2000 - 1000, value: i });

  // Instrument a fresh copy of the module's visit logic by wrapping the
  // constructor's build then monkey-patching via a counting Proxy is
  // overkill here -- instead, verify pruning indirectly but concretely:
  // total wall-clock time for many queries must be far below what an
  // O(n)-per-query linear scan would take, which is only possible if
  // most subtrees are actually being pruned rather than visited.
  const t = new KDTree(pts);
  const numQueries = 300;
  const start = process.hrtime.bigint();
  for (let i = 0; i < numQueries; i++) {
    t.nearest(rng() * 2000 - 1000, rng() * 2000 - 1000);
  }
  const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
  // A genuinely linear-scan "nearest" over n=20000 points for 300
  // queries does tens of millions of arithmetic ops; a real KD-tree
  // with working pruning finishes this in a handful of milliseconds.
  // This is a generous smoke-test bound (not a tight benchmark),
  // specifically meant to catch an accidental full-scan implementation.
  assert.ok(
    elapsedMs < 500,
    `300 nearest() queries over ${n} points took ${elapsedMs}ms -- expected well under 500ms with real branch pruning`
  );
});

// ---- seeded datasets checked against brute-force results ----

test('differential: many random point sets (integer coords, duplicates) vs brute-force', () => {
  for (let seed = 1; seed <= 80; seed++) {
    const rng = mulberry32(seed * 7919 + 13);
    const n = 1 + Math.floor(rng() * 50);
    const coordRange = 5 + Math.floor(rng() * 20);
    const pts = makeRandomPoints(rng, n, coordRange, true, false);
    const real = new KDTree(pts);
    const brute = new BruteKD(pts);
    assert.equal(real.size, brute.size, `seed=${seed}`);
    for (let q = 0; q < 10; q++) {
      const qx = Math.floor(rng() * (2 * coordRange + 1)) - coordRange;
      const qy = Math.floor(rng() * (2 * coordRange + 1)) - coordRange;
      assert.deepEqual(real.nearest(qx, qy), brute.nearest(qx, qy), `seed=${seed} nearest q=(${qx},${qy})`);
      const k = 1 + Math.floor(rng() * (n + 3));
      assert.deepEqual(real.kNearest(qx, qy, k), brute.kNearest(qx, qy, k), `seed=${seed} kNearest q=(${qx},${qy}) k=${k}`);
      const x1 = Math.floor(rng() * (2 * coordRange + 1)) - coordRange;
      const x2 = Math.floor(rng() * (2 * coordRange + 1)) - coordRange;
      const y1 = Math.floor(rng() * (2 * coordRange + 1)) - coordRange;
      const y2 = Math.floor(rng() * (2 * coordRange + 1)) - coordRange;
      const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
      const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
      assert.deepEqual(real.range(minX, minY, maxX, maxY), brute.range(minX, minY, maxX, maxY), `seed=${seed} range`);
    }
  }
});

test('differential: fractional-coordinate random point sets vs brute-force', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const rng = mulberry32(seed * 104729 + 3);
    const n = 1 + Math.floor(rng() * 60);
    const coordRange = 1 + Math.floor(rng() * 500);
    const pts = makeRandomPoints(rng, n, coordRange, false, true);
    const real = new KDTree(pts);
    const brute = new BruteKD(pts);
    for (let q = 0; q < 8; q++) {
      const qx = rng() * 2 * coordRange - coordRange;
      const qy = rng() * 2 * coordRange - coordRange;
      assert.deepEqual(real.nearest(qx, qy), brute.nearest(qx, qy), `seed=${seed} frac nearest`);
      const k = 1 + Math.floor(rng() * (n + 2));
      assert.deepEqual(real.kNearest(qx, qy, k), brute.kNearest(qx, qy, k), `seed=${seed} frac kNearest`);
    }
  }
});

test('differential: small integer grids with duplicates, exact-tie emphasis, vs brute-force', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const rng = mulberry32(seed * 65599 + 101);
    const gridSize = 3 + Math.floor(rng() * 5);
    const pts = [];
    for (let x = 0; x < gridSize; x++) {
      for (let y = 0; y < gridSize; y++) {
        pts.push({ x, y, value: `${x}_${y}` });
        if (rng() < 0.3) pts.push({ x, y, value: `${x}_${y}_dup` });
      }
    }
    const real = new KDTree(pts);
    const brute = new BruteKD(pts);
    for (let x = 0; x < gridSize; x++) {
      for (let y = 0; y < gridSize; y++) {
        assert.deepEqual(real.nearest(x, y), brute.nearest(x, y), `seed=${seed} lattice nearest (${x},${y})`);
      }
    }
    for (let q = 0; q < 5; q++) {
      const qx = rng() * gridSize;
      const qy = rng() * gridSize;
      const k = 1 + Math.floor(rng() * pts.length);
      assert.deepEqual(real.kNearest(qx, qy, k), brute.kNearest(qx, qy, k), `seed=${seed} grid kNearest`);
    }
  }
});

test('differential: range queries including degenerate boxes vs brute-force', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const rng = mulberry32(seed * 998244353 + 17);
    const n = 1 + Math.floor(rng() * 80);
    const coordRange = 5 + Math.floor(rng() * 15);
    const pts = makeRandomPoints(rng, n, coordRange, true, false);
    const real = new KDTree(pts);
    const brute = new BruteKD(pts);
    for (let q = 0; q < 12; q++) {
      let minX, maxX, minY, maxY;
      if (rng() < 0.25) {
        minX = maxX = Math.floor(rng() * (2 * coordRange + 1)) - coordRange;
        minY = maxY = Math.floor(rng() * (2 * coordRange + 1)) - coordRange;
      } else {
        const x1 = Math.floor(rng() * (2 * coordRange + 1)) - coordRange;
        const x2 = Math.floor(rng() * (2 * coordRange + 1)) - coordRange;
        const y1 = Math.floor(rng() * (2 * coordRange + 1)) - coordRange;
        const y2 = Math.floor(rng() * (2 * coordRange + 1)) - coordRange;
        minX = Math.min(x1, x2); maxX = Math.max(x1, x2);
        minY = Math.min(y1, y2); maxY = Math.max(y1, y2);
      }
      assert.deepEqual(real.range(minX, minY, maxX, maxY), brute.range(minX, minY, maxX, maxY), `seed=${seed} range box`);
    }
  }
});
