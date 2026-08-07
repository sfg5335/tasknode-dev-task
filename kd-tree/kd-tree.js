'use strict';

/**
 * Dependency-free, single-file, deterministic two-dimensional KD-tree
 * (`KDTree`) for nearest-neighbor and axis-aligned range queries over a
 * fixed set of 2D points, in JavaScript, with an automated `node:test`
 * suite.
 *
 * new KDTree(points)
 *   `points` must be an array of `{x, y, value}` objects, each with
 *   finite `x`/`y` coordinates (`value` may be anything, including
 *   `undefined`, and is never validated -- it's an arbitrary payload
 *   carried alongside each point). The input array and its element
 *   objects are never mutated or retained by reference -- the
 *   constructor copies everything it needs up front, tagging each
 *   point with its original array index (`order`) for deterministic
 *   tie-breaking. Duplicate coordinates are fully preserved as
 *   separate points (never merged or dropped).
 *
 * Instance API:
 *   `size` -- a getter returning the number of points in the tree.
 *   `nearest(x, y)` -- returns the single closest point to `(x, y)` as
 *   a fresh `{x, y, value}` object, or `null` if the tree is empty.
 *   Ties (multiple points at the same minimum squared distance) are
 *   broken deterministically: smallest `x`, then smallest `y`, then
 *   earliest original insertion order.
 *   `kNearest(x, y, k)` -- returns an array of up to `k` closest
 *   points to `(x, y)`, each a fresh `{x, y, value}` object, ordered
 *   ascending by squared distance then the same `x`/`y`/insertion-order
 *   tie-break as `nearest`. `k` must be a non-negative safe integer;
 *   `k === 0` returns `[]`; `k` larger than `size` returns every point
 *   (fewer than `k` results, not an error).
 *   `range(minX, minY, maxX, maxY)` -- returns every point whose
 *   coordinates fall within the *inclusive* box
 *   `[minX, maxX] x [minY, maxY]`, each a fresh `{x, y, value}` object,
 *   ordered ascending by `x`, then `y`, then original insertion order.
 *   `minX <= maxX` and `minY <= maxY` are required.
 *
 *   Every input is validated: a non-array `points`, a non-object point,
 *   or a non-number `x`/`y`/`k`/`minX`/`minY`/`maxX`/`maxY` throws
 *   `TypeError` (this also covers a non-integer `k`, since `k` counts
 *   results and a fractional count isn't a valid *kind* of value here);
 *   a correctly-typed but non-finite coordinate (`NaN`/`Infinity`), a
 *   negative `k`, or a correctly-typed `minX > maxX` / `minY > maxY`
 *   ("reversed" range) throws `RangeError`.
 *
 * Algorithm: a classic median-split 2D KD-tree. `new KDTree(points)`
 * builds a perfectly balanced tree by recursively splitting the active
 * point set on alternating axes (x at even depths, y at odd depths):
 * at each recursive call the current points are sorted by
 * (active-axis coordinate, other-axis coordinate, original insertion
 * order) -- this exact three-key order is what step 2 of this task's
 * spec calls "selecting medians deterministically by active
 * coordinate, other coordinate, then original insertion order" -- the
 * middle element (`Math.floor(n / 2)`) becomes the node, and the
 * elements before/after it become the left/right subtrees (recursing
 * on the other axis). Because every split always takes the exact
 * median of however many points remain, the tree's height is always
 * `O(log n)` regardless of input order or duplicate coordinates, so
 * (unlike some of this collection's other structures) there's no need
 * for an iterative/explicit-stack traversal here -- plain recursion's
 * call-stack depth is already bounded logarithmically.
 *
 * `nearest`/`kNearest` are implemented as textbook KD-tree
 * branch-and-bound search: visit a node, record/insert it as a
 * candidate, recurse into whichever child is on the query point's side
 * of the node's splitting axis first ("near" child), and only recurse
 * into the other ("far") child if the perpendicular distance from the
 * query point to the splitting hyperplane could still contain a
 * competitive point -- i.e. if `hyperplaneDistanceSquared <=` the
 * current worst kept candidate's squared distance. Using `<=` here
 * (not the more aggressive `<`) is deliberate and required for
 * correctness under this task's *exact* tie-break rule: a subtree
 * whose closest possible point exactly ties the current worst distance
 * could still contain a point that wins on the x/y/insertion-order
 * tie-break, so it can never be safely skipped on a tie, only on a
 * strict loss. `range` prunes analogously: a subtree is only descended
 * into when the query box actually overlaps the half-space that
 * subtree's splitting axis guarantees (`points-before-median` are
 * always `<=` the node's axis coordinate, `points-after-median` are
 * always `>=` it, by construction).
 */

function isNumber(v) {
  return typeof v === 'number';
}

function isFiniteNumber(v) {
  return isNumber(v) && Number.isFinite(v);
}

function isSafeInt(v) {
  return isNumber(v) && Number.isSafeInteger(v);
}

function validatePoint(p, i) {
  if (typeof p !== 'object' || p === null || Array.isArray(p)) {
    throw new TypeError(`points[${i}] must be a plain object with finite x and y`);
  }
  if (!isNumber(p.x)) throw new TypeError(`points[${i}].x must be a number`);
  if (!Number.isFinite(p.x)) throw new RangeError(`points[${i}].x must be finite`);
  if (!isNumber(p.y)) throw new TypeError(`points[${i}].y must be a number`);
  if (!Number.isFinite(p.y)) throw new RangeError(`points[${i}].y must be finite`);
}

function distSq(x1, y1, x2, y2) {
  const dx = x1 - x2;
  const dy = y1 - y2;
  return dx * dx + dy * dy;
}

// Strict total order over query-result candidates: smaller squared
// distance wins; an exact distance tie is broken by x, then y, then
// original insertion order. Every point's `order` is unique, so this
// never itself ties.
function compareKeys(a, b) {
  if (a.distSq !== b.distSq) return a.distSq - b.distSq;
  if (a.x !== b.x) return a.x - b.x;
  if (a.y !== b.y) return a.y - b.y;
  return a.order - b.order;
}

function buildNode(items, depth) {
  if (items.length === 0) return null;
  const axis = depth % 2; // 0 = split on x, 1 = split on y
  const sorted = items.slice().sort((a, b) => {
    const av = axis === 0 ? a.x : a.y;
    const bv = axis === 0 ? b.x : b.y;
    if (av !== bv) return av - bv;
    const ao = axis === 0 ? a.y : a.x;
    const bo = axis === 0 ? b.y : b.x;
    if (ao !== bo) return ao - bo;
    return a.order - b.order;
  });
  const mid = Math.floor(sorted.length / 2);
  const median = sorted[mid];
  return {
    x: median.x,
    y: median.y,
    value: median.value,
    order: median.order,
    axis,
    left: buildNode(sorted.slice(0, mid), depth + 1),
    right: buildNode(sorted.slice(mid + 1), depth + 1),
  };
}

function toPublicPoint(node) {
  return { x: node.x, y: node.y, value: node.value };
}

class KDTree {
  constructor(points) {
    if (!Array.isArray(points)) throw new TypeError('points must be an array');
    points.forEach(validatePoint);
    const items = points.map((p, i) => ({ x: p.x, y: p.y, value: p.value, order: i }));
    this._size = items.length;
    this._root = buildNode(items, 0);
  }

  get size() {
    return this._size;
  }

  nearest(x, y) {
    if (!isNumber(x)) throw new TypeError('x must be a number');
    if (!Number.isFinite(x)) throw new RangeError('x must be finite');
    if (!isNumber(y)) throw new TypeError('y must be a number');
    if (!Number.isFinite(y)) throw new RangeError('y must be finite');
    if (this._root === null) return null;

    let bestNode = null;
    let bestKey = null;

    const visit = (node) => {
      if (!node) return;
      const key = { distSq: distSq(x, y, node.x, node.y), x: node.x, y: node.y, order: node.order };
      if (bestKey === null || compareKeys(key, bestKey) < 0) {
        bestNode = node;
        bestKey = key;
      }
      const axis = node.axis;
      const qCoord = axis === 0 ? x : y;
      const nodeCoord = axis === 0 ? node.x : node.y;
      const diff = qCoord - nodeCoord;
      const nearChild = diff <= 0 ? node.left : node.right;
      const farChild = diff <= 0 ? node.right : node.left;
      visit(nearChild);
      const hyperDistSq = diff * diff;
      if (hyperDistSq <= bestKey.distSq) visit(farChild);
    };
    visit(this._root);
    return bestNode ? toPublicPoint(bestNode) : null;
  }

  kNearest(x, y, k) {
    if (!isNumber(x)) throw new TypeError('x must be a number');
    if (!Number.isFinite(x)) throw new RangeError('x must be finite');
    if (!isNumber(y)) throw new TypeError('y must be a number');
    if (!Number.isFinite(y)) throw new RangeError('y must be finite');
    if (!isSafeInt(k)) throw new TypeError('k must be a safe integer');
    if (k < 0) throw new RangeError('k must not be negative');
    if (k === 0 || this._root === null) return [];

    const found = []; // kept sorted ascending by compareKeys, length capped at k

    const tryInsert = (node, key) => {
      let idx = found.length;
      while (idx > 0 && compareKeys(key, found[idx - 1].key) < 0) idx--;
      found.splice(idx, 0, { node, key });
      if (found.length > k) found.pop();
    };

    const visit = (node) => {
      if (!node) return;
      const key = { distSq: distSq(x, y, node.x, node.y), x: node.x, y: node.y, order: node.order };
      tryInsert(node, key);
      const axis = node.axis;
      const qCoord = axis === 0 ? x : y;
      const nodeCoord = axis === 0 ? node.x : node.y;
      const diff = qCoord - nodeCoord;
      const nearChild = diff <= 0 ? node.left : node.right;
      const farChild = diff <= 0 ? node.right : node.left;
      visit(nearChild);
      if (found.length < k) {
        visit(farChild);
        return;
      }
      const worstDistSq = found[found.length - 1].key.distSq;
      const hyperDistSq = diff * diff;
      if (hyperDistSq <= worstDistSq) visit(farChild);
    };
    visit(this._root);
    return found.map((f) => toPublicPoint(f.node));
  }

  range(minX, minY, maxX, maxY) {
    const bounds = [
      ['minX', minX],
      ['minY', minY],
      ['maxX', maxX],
      ['maxY', maxY],
    ];
    for (const [name, v] of bounds) {
      if (!isNumber(v)) throw new TypeError(`${name} must be a number`);
      if (!Number.isFinite(v)) throw new RangeError(`${name} must be finite`);
    }
    if (minX > maxX) throw new RangeError(`minX (${minX}) must not be greater than maxX (${maxX})`);
    if (minY > maxY) throw new RangeError(`minY (${minY}) must not be greater than maxY (${maxY})`);

    const results = [];
    const visit = (node) => {
      if (!node) return;
      if (node.x >= minX && node.x <= maxX && node.y >= minY && node.y <= maxY) {
        results.push(node);
      }
      const axis = node.axis;
      const nodeCoord = axis === 0 ? node.x : node.y;
      const lo = axis === 0 ? minX : minY;
      const hi = axis === 0 ? maxX : maxY;
      if (lo <= nodeCoord) visit(node.left);
      if (hi >= nodeCoord) visit(node.right);
    };
    visit(this._root);
    results.sort((a, b) => {
      if (a.x !== b.x) return a.x - b.x;
      if (a.y !== b.y) return a.y - b.y;
      return a.order - b.order;
    });
    return results.map(toPublicPoint);
  }
}

module.exports = { KDTree };
