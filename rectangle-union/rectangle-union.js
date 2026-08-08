'use strict';

// Exact union area of axis-aligned rectangles, via an O(n log n) sweep line
// over compressed x-coordinates with a coordinate-compressed segment tree
// over the y-axis tracking exact covered y-length. The result is returned
// as a BigInt because the exact area of rectangles built from arbitrary
// JS safe integers can exceed both Number.MAX_SAFE_INTEGER and the range in
// which floating-point subtraction is guaranteed exact -- see the README
// for why plain Number arithmetic is not sufficient here.

function isSafeIntegerNumber(v) {
  return typeof v === 'number' && Number.isSafeInteger(v);
}

// Validates and normalizes a single rectangle entry, without mutating it.
// Throws TypeError for structurally/type-invalid input, RangeError for
// well-typed but non-positive-dimension input.
function validateRectangle(rect, index) {
  if (!Array.isArray(rect) || rect.length !== 4) {
    throw new TypeError(
      `rectangles[${index}] must be an array of 4 safe integers [x1, y1, x2, y2], got ${JSON.stringify(rect)}`
    );
  }
  const [x1, y1, x2, y2] = rect;
  const fields = { x1, y1, x2, y2 };
  for (const name of ['x1', 'y1', 'x2', 'y2']) {
    const v = fields[name];
    if (!isSafeIntegerNumber(v)) {
      throw new TypeError(
        `rectangles[${index}].${name} must be a safe integer number, got ${typeof v === 'number' ? v : typeof v}`
      );
    }
  }
  if (x2 <= x1) {
    throw new RangeError(
      `rectangles[${index}] must have x2 > x1 (positive width), got x1=${x1}, x2=${x2}`
    );
  }
  if (y2 <= y1) {
    throw new RangeError(
      `rectangles[${index}] must have y2 > y1 (positive height), got y1=${y1}, y2=${y2}`
    );
  }
  return { x1, y1, x2, y2 };
}

/**
 * Computes the exact area of the union of a set of axis-aligned rectangles.
 *
 * @param {Array<[number, number, number, number]>} rectangles - each entry
 *   is [x1, y1, x2, y2], all safe integers, with x2 > x1 and y2 > y1.
 * @returns {bigint} the exact union area. `0n` for an empty input array.
 */
function rectangleUnionArea(rectangles) {
  if (!Array.isArray(rectangles)) {
    throw new TypeError(`rectangles must be an array, got ${typeof rectangles}`);
  }
  if (rectangles.length === 0) return 0n;

  const rects = rectangles.map((r, i) => validateRectangle(r, i));

  // --- Coordinate-compress the y-axis. -----------------------------------
  const ySet = new Set();
  for (const { y1, y2 } of rects) {
    ySet.add(y1);
    ySet.add(y2);
  }
  const ys = Array.from(ySet).sort((a, b) => a - b);
  const yIndex = new Map();
  ys.forEach((y, i) => yIndex.set(y, i));
  const m = ys.length - 1; // number of elementary y-intervals; always >= 1 here

  // Exact BigInt length of each elementary y-interval [ys[i], ys[i+1]).
  // BigInt(safeInteger) is always an exact conversion, and BigInt subtraction
  // is always exact, so this never loses precision even when the y-span is
  // close to 2 * Number.MAX_SAFE_INTEGER (which plain `ys[i+1] - ys[i]` as a
  // Number subtraction is not guaranteed to represent exactly).
  const prefix = new Array(m + 1);
  prefix[0] = 0n;
  for (let i = 0; i < m; i++) {
    prefix[i + 1] = prefix[i] + (BigInt(ys[i + 1]) - BigInt(ys[i]));
  }
  function fullLen(lo, hi) {
    return prefix[hi] - prefix[lo];
  }

  // --- Segment tree over the m elementary y-intervals. --------------------
  // count[node]: number of "fully covering" add/remove updates currently
  //   applied exactly at this node (standard lazy-count sweep-line trick --
  //   no need for separate propagation since we only ever query the root).
  // covered[node]: exact BigInt covered y-length within this node's range,
  //   given the current count state of this node and its descendants.
  const size = 4 * m;
  const count = new Int32Array(size);
  const covered = new Array(size).fill(0n);

  function update(node, lo, hi, l, r, delta) {
    if (r <= lo || hi <= l) return; // no overlap
    if (l <= lo && hi <= r) {
      count[node] += delta;
    } else {
      const mid = (lo + hi) >> 1;
      update(2 * node, lo, mid, l, r, delta);
      update(2 * node + 1, mid, hi, l, r, delta);
    }
    if (count[node] > 0) {
      covered[node] = fullLen(lo, hi);
    } else if (hi - lo === 1) {
      covered[node] = 0n;
    } else {
      covered[node] = covered[2 * node] + covered[2 * node + 1];
    }
  }

  // --- Build sweep events: at x1 add [y1,y2) coverage, at x2 remove it. --
  const events = [];
  for (const { x1, y1, x2, y2 } of rects) {
    const l = yIndex.get(y1);
    const r = yIndex.get(y2);
    events.push([x1, l, r, 1]);
    events.push([x2, l, r, -1]);
  }
  events.sort((a, b) => a[0] - b[0]);

  // --- Sweep left to right, accumulating covered-length * x-gap. ---------
  let area = 0n;
  let idx = 0;
  let prevX = events[0][0];
  while (idx < events.length) {
    const x = events[idx][0];
    if (x !== prevX) {
      const coveredLen = covered[1];
      if (coveredLen > 0n) {
        area += coveredLen * (BigInt(x) - BigInt(prevX));
      }
      prevX = x;
    }
    while (idx < events.length && events[idx][0] === x) {
      const [, l, r, delta] = events[idx];
      update(1, 0, m, l, r, delta);
      idx++;
    }
  }

  return area;
}

module.exports = { rectangleUnionArea };
