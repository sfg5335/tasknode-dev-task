'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { minimumEnclosingCircle } = require('./minimum-enclosing-circle.js');

// ---------------------------------------------------------------------------
// xorshift32 deterministic PRNG (fixed-seed, exact algorithm named in the
// task spec), used for the randomized exhaustive-comparison block below.
// ---------------------------------------------------------------------------
function xorshift32(seed) {
  let state = seed >>> 0;
  if (state === 0) state = 1;
  return function () {
    state ^= state << 13; state >>>= 0;
    state ^= state >>> 17; state >>>= 0;
    state ^= state << 5; state >>>= 0;
    return state >>> 0;
  };
}

function dist(ax, ay, bx, by) {
  const dx = ax - bx, dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

function circleFrom1(ax, ay) { return { x: ax, y: ay, radius: 0 }; }
function circleFrom2(ax, ay, bx, by) {
  const x = (ax + bx) / 2, y = (ay + by) / 2;
  return { x, y, radius: dist(ax, ay, x, y) };
}
function circumcircle(ax, ay, bx, by, cx, cy) {
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-9) return null; // collinear -- no finite circumcircle
  const a2 = ax * ax + ay * ay, b2 = bx * bx + by * by, c2 = cx * cx + cy * cy;
  const ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d;
  const uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d;
  return { x: ux, y: uy, radius: dist(ux, uy, ax, ay) };
}

// Independent exhaustive reference solver -- deliberately does NOT reuse
// any of the incremental boundary-fixing logic from the module under
// test. For a point set, enumerates every circle determined by exactly
// one, two, or three of the points (a well-known fact of the minimum
// enclosing circle problem: the optimum is always determined by at most
// 3 points of the input), discards any candidate that does not actually
// enclose every point, and returns the minimum-radius survivor.
function referenceMEC(points) {
  const n = points.length;
  if (n === 0) return null;
  const EPS = 1e-7;

  function encloses(c) {
    for (let i = 0; i < n; i++) {
      const [px, py] = points[i];
      if (dist(c.x, c.y, px, py) > c.radius + EPS) return false;
    }
    return true;
  }

  let best = null;
  function consider(c) {
    if (!c) return;
    if (!encloses(c)) return;
    if (best === null || c.radius < best.radius) best = c;
  }

  for (let i = 0; i < n; i++) {
    consider(circleFrom1(points[i][0], points[i][1]));
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      consider(circleFrom2(points[i][0], points[i][1], points[j][0], points[j][1]));
    }
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      for (let k = j + 1; k < n; k++) {
        consider(circumcircle(
          points[i][0], points[i][1],
          points[j][0], points[j][1],
          points[k][0], points[k][1]
        ));
      }
    }
  }
  return best;
}

function scaleAwareDiff(a, b) {
  return Math.abs(a - b) / Math.max(1, Math.abs(b));
}

function assertCircleClose(actual, expected, tol = 1e-9, msg = '') {
  assert.ok(actual !== null, `${msg} expected a circle, got null`);
  assert.ok(
    scaleAwareDiff(actual.x, expected.x) < tol,
    `${msg} x mismatch: actual=${actual.x} expected=${expected.x}`
  );
  assert.ok(
    scaleAwareDiff(actual.y, expected.y) < tol,
    `${msg} y mismatch: actual=${actual.y} expected=${expected.y}`
  );
  assert.ok(
    scaleAwareDiff(actual.radius, expected.radius) < tol,
    `${msg} radius mismatch: actual=${actual.radius} expected=${expected.radius}`
  );
}

// ---------------------------------------------------------------------------
// Empty input
// ---------------------------------------------------------------------------

test('empty array returns null', () => {
  assert.equal(minimumEnclosingCircle([]), null);
});

// ---------------------------------------------------------------------------
// Singleton and paired points
// ---------------------------------------------------------------------------

test('a single point returns a radius-0 circle centered on it', () => {
  assert.deepEqual(minimumEnclosingCircle([[3, 4]]), { x: 3, y: 4, radius: 0 });
  assert.deepEqual(minimumEnclosingCircle([[-7.5, 2.25]]), { x: -7.5, y: 2.25, radius: 0 });
});

test('two points: the circle has them as opposite ends of a diameter', () => {
  assertCircleClose(minimumEnclosingCircle([[0, 0], [4, 0]]), { x: 2, y: 0, radius: 2 });
  assertCircleClose(minimumEnclosingCircle([[1, 1], [1, 5]]), { x: 1, y: 3, radius: 2 });
});

// ---------------------------------------------------------------------------
// Acute and obtuse triangles
// ---------------------------------------------------------------------------

test('right triangle: the circumcircle (diameter = hypotenuse) is the MEC', () => {
  // (0,0),(4,0),(0,3): right angle at the origin, hypotenuse (4,0)-(0,3).
  assertCircleClose(
    minimumEnclosingCircle([[0, 0], [4, 0], [0, 3]]),
    { x: 2, y: 1.5, radius: 2.5 }
  );
});

test('obtuse triangle: the MEC is the circle over the longest side alone, excluding the circumcircle', () => {
  // (0,0),(10,0),(5,1): the angle at (5,1) is obtuse (very close to the
  // (0,0)-(10,0) line), so the MEC is just the diameter-(0,0)-(10,0)
  // circle -- the circumcircle would be much larger.
  assertCircleClose(
    minimumEnclosingCircle([[0, 0], [10, 0], [5, 1]]),
    { x: 5, y: 0, radius: 5 }
  );
});

test('acute (equilateral) triangle: the MEC is the true circumcircle through all 3 vertices', () => {
  const s3 = Math.sqrt(3);
  assertCircleClose(
    minimumEnclosingCircle([[0, 0], [2, 0], [1, s3]]),
    { x: 1, y: s3 / 3, radius: 2 / s3 }
  );
});

// ---------------------------------------------------------------------------
// Collinear sets
// ---------------------------------------------------------------------------

test('collinear points: the MEC has the two extreme points as its diameter', () => {
  assertCircleClose(
    minimumEnclosingCircle([[0, 0], [1, 0], [2, 0]]),
    { x: 1, y: 0, radius: 1 }
  );
  // Extremes not in sorted order in the input.
  assertCircleClose(
    minimumEnclosingCircle([[5, 5], [-5, -5], [0, 0], [2, 2]]),
    { x: 0, y: 0, radius: Math.sqrt(50) }
  );
});

// ---------------------------------------------------------------------------
// Duplicates
// ---------------------------------------------------------------------------

test('all-duplicate points collapse to a radius-0 circle', () => {
  assert.deepEqual(
    minimumEnclosingCircle([[5, 5], [5, 5], [5, 5]]),
    { x: 5, y: 5, radius: 0 }
  );
});

test('a duplicated point mixed with distinct points does not change the result', () => {
  const withDup = minimumEnclosingCircle([[0, 0], [4, 0], [0, 3], [0, 0]]);
  const withoutDup = minimumEnclosingCircle([[0, 0], [4, 0], [0, 3]]);
  assertCircleClose(withDup, withoutDup);
});

// ---------------------------------------------------------------------------
// Interior and boundary points
// ---------------------------------------------------------------------------

test('a point strictly inside the MEC of the other points does not change the result', () => {
  assertCircleClose(
    minimumEnclosingCircle([[0, 0], [4, 0], [0, 3], [1, 1]]),
    { x: 2, y: 1.5, radius: 2.5 }
  );
});

test('a point exactly on the boundary of the MEC does not change the result', () => {
  // (2, -0.5) lies exactly on the circle {x:2, y:1.5, radius:2.5}
  // (distance from (2,1.5) is exactly 2).
  const onBoundary = [2, 1.5 - 2.5];
  assertCircleClose(
    minimumEnclosingCircle([[0, 0], [4, 0], [0, 3], onBoundary]),
    { x: 2, y: 1.5, radius: 2.5 }
  );
});

// ---------------------------------------------------------------------------
// Negative and fractional coordinates
// ---------------------------------------------------------------------------

test('negative coordinates are handled correctly', () => {
  assertCircleClose(minimumEnclosingCircle([[-4, 0], [0, 0]]), { x: -2, y: 0, radius: 2 });
  assertCircleClose(
    minimumEnclosingCircle([[-3, -3], [-1, -3], [-3, -1]]),
    { x: -2, y: -2, radius: Math.sqrt(2) }
  );
});

test('fractional coordinates are handled correctly', () => {
  assertCircleClose(
    minimumEnclosingCircle([[0.5, 0.5], [2.5, 0.5]]),
    { x: 1.5, y: 0.5, radius: 1 }
  );
});

// ---------------------------------------------------------------------------
// Invalid inputs
// ---------------------------------------------------------------------------

test('throws TypeError when points is not an array', () => {
  assert.throws(() => minimumEnclosingCircle(null), TypeError);
  assert.throws(() => minimumEnclosingCircle(undefined), TypeError);
  assert.throws(() => minimumEnclosingCircle('points'), TypeError);
  assert.throws(() => minimumEnclosingCircle(42), TypeError);
});

test('throws TypeError when an element is not a [x, y] pair', () => {
  assert.throws(() => minimumEnclosingCircle([[1, 2], 'bad']), TypeError);
  assert.throws(() => minimumEnclosingCircle([[1, 2], [1]]), TypeError);
  assert.throws(() => minimumEnclosingCircle([[1, 2], [1, 2, 3]]), TypeError);
  assert.throws(() => minimumEnclosingCircle([null]), TypeError);
});

test('throws TypeError when a coordinate is non-finite or non-numeric', () => {
  assert.throws(() => minimumEnclosingCircle([[1, NaN]]), TypeError);
  assert.throws(() => minimumEnclosingCircle([[Infinity, 1]]), TypeError);
  assert.throws(() => minimumEnclosingCircle([[1, -Infinity]]), TypeError);
  assert.throws(() => minimumEnclosingCircle([['1', 2]]), TypeError);
  assert.throws(() => minimumEnclosingCircle([[1, null]]), TypeError);
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

test('repeated calls on the same input produce identical output', () => {
  const points = [[0, 0], [4, 0], [0, 3], [2, 2], [1, 1], [-1, 4], [3, -2]];
  const r1 = minimumEnclosingCircle(points);
  const r2 = minimumEnclosingCircle(points);
  const r3 = minimumEnclosingCircle(points);
  assert.deepEqual(r1, r2);
  assert.deepEqual(r2, r3);
});

// ---------------------------------------------------------------------------
// Input immutability
// ---------------------------------------------------------------------------

test('never mutates the points array or its sub-arrays', () => {
  const points = [[1, 2], [3, 4], [-5, 6]];
  const snapshot = points.map((p) => p.slice());
  minimumEnclosingCircle(points);
  assert.deepEqual(points, snapshot);
});

// ---------------------------------------------------------------------------
// Negative-zero normalization
// ---------------------------------------------------------------------------

test('never returns -0 for any field', () => {
  const r = minimumEnclosingCircle([[-1, 0], [1, 0]]);
  assert.deepEqual(r, { x: 0, y: 0, radius: 1 });
  assert.equal(Object.is(r.x, -0), false);
  assert.equal(Object.is(r.y, -0), false);
  assert.equal(Object.is(r.radius, -0), false);
});

// ---------------------------------------------------------------------------
// Structural invariant: the returned circle actually encloses every
// input point (within a small numerical tolerance), across a spread of
// randomized inputs.
// ---------------------------------------------------------------------------

test('the returned circle always encloses every input point', () => {
  const rand = xorshift32(0xa11cafe);
  for (let t = 0; t < 300; t++) {
    const n = rand() % 12;
    const points = Array.from({ length: n }, () => [
      (rand() % 201) - 100,
      (rand() % 201) - 100,
    ]);
    const circle = minimumEnclosingCircle(points);
    if (n === 0) {
      assert.equal(circle, null);
      continue;
    }
    for (const [px, py] of points) {
      const d = dist(circle.x, circle.y, px, py);
      assert.ok(
        d <= circle.radius + 1e-6,
        `point (${px},${py}) lies outside circle ${JSON.stringify(circle)} (dist=${d})`
      );
    }
  }
});

// ---------------------------------------------------------------------------
// Fixed-seed exhaustive differential comparison (task spec, step 4):
// xorshift32 seeded with 0xC0FFEE, at least 500 sets of 0-8 integer
// points, compared within a scale-aware 1e-9 tolerance against an
// independent brute-force reference that enumerates circles defined by
// one, two, or three points.
// ---------------------------------------------------------------------------

test('deterministic randomized differential coverage: xorshift32(0xC0FFEE), >=500 sets of 0-8 integer points, against an independent 1/2/3-point brute-force reference, within a scale-aware 1e-9 tolerance', () => {
  const rand = xorshift32(0xc0ffee);
  const trials = 600;
  let checked = 0;
  for (let t = 0; t < trials; t++) {
    const n = rand() % 9; // 0..8 inclusive
    const points = Array.from({ length: n }, () => [
      (rand() % 41) - 20, // integer coordinates in [-20, 20]
      (rand() % 41) - 20,
    ]);

    const actual = minimumEnclosingCircle(points);
    const expected = referenceMEC(points);

    if (n === 0) {
      assert.equal(actual, null, `trial ${t}: expected null for empty input`);
    } else {
      assertCircleClose(actual, expected, 1e-9, `trial ${t} (n=${n}, points=${JSON.stringify(points)}):`);
    }
    checked++;
  }
  assert.equal(checked, trials);
  assert.ok(checked >= 500);
});
