'use strict';

// Minimum Enclosing Circle via the classical deterministic incremental
// boundary-point algorithm (the non-randomized "Welzl-style" incremental
// construction). Points are always processed in their given input order —
// never shuffled or reordered — so both the returned circle and the exact
// sequence of intermediate circles built along the way are fully
// deterministic for a given input array.
//
// The algorithm scans points left to right, maintaining a "current best"
// circle for the prefix scanned so far:
//   - If the next point already lies inside (or on) the current circle,
//     nothing changes.
//   - Otherwise that point MUST lie on the boundary of the true minimum
//     enclosing circle for the whole prefix including it (a point outside
//     every smaller enclosing circle can only be included by growing the
//     circle out to touch it). The algorithm fixes it as a boundary point
//     and re-scans the earlier prefix from scratch under that constraint,
//     recursing one level deeper (fixing a second, then a third boundary
///    point) whenever a further point is found outside the shrunk search.
//   - Because at most 3 points ever determine a circle in the plane, the
//     recursion bottoms out after fixing 3 boundary points, at which point
//     the circumcircle of those 3 points is exact and no further
//     escalation is possible.

const EPS = 1e-9;

function validatePoints(points) {
  if (!Array.isArray(points)) {
    throw new TypeError('points must be an array');
  }
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (!Array.isArray(p) || p.length !== 2) {
      throw new TypeError(`points[${i}] must be a [x, y] pair (an array of length 2)`);
    }
    const x = p[0];
    const y = p[1];
    if (typeof x !== 'number' || !Number.isFinite(x)) {
      throw new TypeError(`points[${i}][0] must be a finite number (got ${String(x)})`);
    }
    if (typeof y !== 'number' || !Number.isFinite(y)) {
      throw new TypeError(`points[${i}][1] must be a finite number (got ${String(y)})`);
    }
  }
}

// Converts -0 to 0; passes every other number through unchanged.
function normalizeZero(v) {
  return v === 0 ? 0 : v;
}

function dist(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

function circleFrom1(ax, ay) {
  return { x: ax, y: ay, radius: 0 };
}

function circleFrom2(ax, ay, bx, by) {
  const x = (ax + bx) / 2;
  const y = (ay + by) / 2;
  return { x, y, radius: dist(ax, ay, x, y) };
}

// Circumcircle of 3 points via the standard determinant formula. Falls
// back to the circle spanned by the two farthest-apart of the three
// points when they are (numerically) collinear -- that circle, having
// the longest pairwise distance as its diameter, necessarily also
// contains the third (collinear) point.
function circleFrom3(ax, ay, bx, by, cx, cy) {
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));

  if (Math.abs(d) < 1e-12) {
    const dab = dist(ax, ay, bx, by);
    const dbc = dist(bx, by, cx, cy);
    const dac = dist(ax, ay, cx, cy);
    const m = Math.max(dab, dbc, dac);
    if (m === dab) return circleFrom2(ax, ay, bx, by);
    if (m === dbc) return circleFrom2(bx, by, cx, cy);
    return circleFrom2(ax, ay, cx, cy);
  }

  const a2 = ax * ax + ay * ay;
  const b2 = bx * bx + by * by;
  const c2 = cx * cx + cy * cy;

  const ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d;
  const uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d;

  return { x: ux, y: uy, radius: dist(ux, uy, ax, ay) };
}

function inside(circle, px, py) {
  return dist(circle.x, circle.y, px, py) <= circle.radius + EPS;
}

// Re-derives the minimum circle enclosing pts[0..end-1] plus the two
// already-fixed boundary points (b1x,b1y) and (b2x,b2y), scanning the
// prefix in order and escalating to the 3-point circumcircle the moment
// a point is found outside the current 2-point circle.
function circleWith2Boundary(pts, end, b1x, b1y, b2x, b2y) {
  let circle = circleFrom2(b1x, b1y, b2x, b2y);
  for (let k = 0; k < end; k++) {
    const [px, py] = pts[k];
    if (!inside(circle, px, py)) {
      circle = circleFrom3(b1x, b1y, b2x, b2y, px, py);
    }
  }
  return circle;
}

// Re-derives the minimum circle enclosing pts[0..end-1] plus the single
// already-fixed boundary point (b1x,b1y), scanning the prefix in order
// and escalating to a 2-point (then possibly 3-point, via
// circleWith2Boundary) circle the moment a point is found outside.
function circleWith1Boundary(pts, end, b1x, b1y) {
  let circle = circleFrom1(b1x, b1y);
  for (let j = 0; j < end; j++) {
    const [px, py] = pts[j];
    if (!inside(circle, px, py)) {
      circle = circleWith2Boundary(pts, j, b1x, b1y, px, py);
    }
  }
  return circle;
}

/**
 * Computes the minimum enclosing circle of a set of 2D points via the
 * deterministic incremental boundary-point algorithm.
 *
 * @param {Array<[number, number]>} points - array of `[x, y]` pairs, each
 *   a finite number. May contain duplicates or collinear points, in any
 *   order. Never mutated.
 * @returns {{x: number, y: number, radius: number} | null} `null` for an
 *   empty input array; otherwise the smallest circle (by radius) that
 *   contains every point, either on its boundary or in its interior.
 *   `-0` is never returned for any field (normalized to `0`).
 * @throws {TypeError} if `points` is not an array, or any element is not
 *   a `[x, y]` pair of finite numbers.
 */
function minimumEnclosingCircle(points) {
  validatePoints(points);

  const n = points.length;
  if (n === 0) return null;

  // Defensive copy: read coordinates out into plain [x, y] pairs so the
  // caller's array/sub-arrays are never touched, and so every downstream
  // access is by identical extracted values.
  const pts = new Array(n);
  for (let i = 0; i < n; i++) {
    pts[i] = [points[i][0], points[i][1]];
  }

  let circle = circleFrom1(pts[0][0], pts[0][1]);
  for (let i = 1; i < n; i++) {
    const [px, py] = pts[i];
    if (!inside(circle, px, py)) {
      circle = circleWith1Boundary(pts, i, px, py);
    }
  }

  return {
    x: normalizeZero(circle.x),
    y: normalizeZero(circle.y),
    radius: normalizeZero(circle.radius),
  };
}

module.exports = { minimumEnclosingCircle };
