'use strict';

/**
 * Dependency-free, single-file, deterministic Li Chao tree
 * (`LiChaoTree`) for minimum-line range queries over a fixed integer
 * domain, in JavaScript, with an automated `node:test` suite.
 *
 * new LiChaoTree(minX, maxX)
 *   Constructs a Li Chao tree over the inclusive integer domain
 *   `[minX, maxX]`. Both must be safe integers with `minX <= maxX`.
 *
 * Instance API:
 *   `size` -- a getter returning the total number of lines/segments
 *   inserted so far (via either `addLine` or `addSegment`), tracked as
 *   a simple counter.
 *   `addLine(slope, intercept, value)` -- inserts a line `y = slope*x +
 *   intercept`, active across the *entire* domain `[minX, maxX]`,
 *   tagged with an arbitrary `value` returned by `query`. Returns
 *   `this`.
 *   `addSegment(slope, intercept, startX, endX, value)` -- inserts the
 *   same kind of line, but active only across the inclusive sub-range
 *   `[startX, endX]` (which must itself lie within `[minX, maxX]`,
 *   with `startX <= endX`). Returns `this`.
 *   `query(x)` -- returns `{ y, value }` for whichever inserted
 *   line/segment active at `x` currently attains the *minimum* `y` at
 *   that point, or `null` if no line/segment covers `x`. Ties (equal
 *   minimum `y`) are broken by insertion order -- the earliest-inserted
 *   line/segment wins.
 *
 *   Every input is validated: a non-finite-number `slope`/`intercept`
 *   throws `TypeError` (wrong type) or `RangeError` (right type but
 *   `NaN`/`Infinity`); a non-safe-integer domain coordinate (`minX`,
 *   `maxX`, `startX`, `endX`, or `query`'s `x`) throws `TypeError`; a
 *   correctly-typed `minX > maxX` or `startX > endX` ("reversed"), or a
 *   segment/query coordinate outside the tree's own domain, throws
 *   `RangeError`.
 *
 * Algorithm: the classic Li Chao tree (a segment tree over the domain
 * where each node optionally holds one "locally optimal" line),
 * adapted from the usual maximum-line convention to *minimum*-line, as
 * this task requires. Nodes are allocated **lazily** (only the first
 * time a subtree is actually touched, via plain `{line, left, right}`
 * objects) rather than up front, so the domain can be very large (e.g.
 * `-1e9` to `1e9`) without allocating anything close to `maxX - minX`
 * nodes -- memory use stays proportional to the number of `addLine`/
 * `addSegment` calls times the tree's `O(log(domain size))` depth.
 *
 * `addLine` is implemented as `addSegment` over the whole domain.
 * `addSegment` decomposes `[startX, endX]` into `O(log(domain size))`
 * canonical segment-tree nodes (the standard range-update
 * decomposition) and calls the core per-node insertion, `_insertLine`,
 * at each. `_insertLine(node, l, r, newLine)` is the standard swap-
 * based Li Chao insertion: compare `newLine` against whatever line is
 * already stored at `node` (if any) at both the segment's left
 * endpoint `l` and its midpoint `mid`, using the `isBetterAt(a, b, x)`
 * strict total order (smaller `y` wins; an exact `y` tie is itself
 * broken by insertion order) rather than plain numeric `<` -- whichever
 * line is better *at the midpoint* under that order is kept at `node`
 * and the other is pushed down; if the "better at `l`" and "better at
 * `mid`" results disagree, the pushed-down line still has a chance to
 * win within `[l, mid]`, so recursion continues there, otherwise it
 * continues into `[mid+1, r]`. `query(x)` walks the single root-to-leaf
 * path containing `x`, comparing every line stored along that path
 * directly (using the same `y`-then-`insertionIndex` ordering) -- this
 * is sufficient (does not need to inspect every node in the tree)
 * because the standard Li Chao invariant guarantees the true minimum at
 * `x`, among all inserted lines, is stored at some node on that exact
 * path.
 */

function isSafeInt(v) {
  return typeof v === 'number' && Number.isSafeInteger(v);
}

function evalLine(line, x) {
  return line.slope * x + line.intercept;
}

// Strict total order over lines at a given point `x`: `a` before `b`
// means "a is preferred at x" -- smaller y wins; an exact y tie is
// broken by insertion order (earlier `insertionIndex` wins). Because
// every line's `insertionIndex` is unique, this never itself ties, so
// it's a genuine strict total order, not just a partial one.
//
// Using this (rather than plain numeric `<`) as the swap-decision
// comparator inside `_insertLine` is what actually makes "earliest
// insertion wins exact ties" hold in general -- not merely in query()
// (see the Design notes in the README for why plain `<` is not
// enough).
function isBetterAt(a, b, x) {
  const ya = evalLine(a, x);
  const yb = evalLine(b, x);
  if (ya !== yb) return ya < yb;
  return a.insertionIndex < b.insertionIndex;
}

function validateCoeffs(slope, intercept) {
  if (typeof slope !== 'number') throw new TypeError('slope must be a number');
  if (!Number.isFinite(slope)) throw new RangeError('slope must be finite');
  if (typeof intercept !== 'number') throw new TypeError('intercept must be a number');
  if (!Number.isFinite(intercept)) throw new RangeError('intercept must be finite');
}

class LiChaoTree {
  constructor(minX, maxX) {
    if (!isSafeInt(minX)) throw new TypeError('minX must be a safe integer');
    if (!isSafeInt(maxX)) throw new TypeError('maxX must be a safe integer');
    if (minX > maxX) throw new RangeError(`minX (${minX}) must not be greater than maxX (${maxX})`);
    this._minX = minX;
    this._maxX = maxX;
    this._root = { line: null, left: null, right: null };
    this._insertCount = 0;
  }

  get size() {
    return this._insertCount;
  }

  addLine(slope, intercept, value) {
    validateCoeffs(slope, intercept);
    const line = { slope, intercept, value, insertionIndex: this._insertCount++ };
    this._insertLine(this._root, this._minX, this._maxX, line);
    return this;
  }

  addSegment(slope, intercept, startX, endX, value) {
    validateCoeffs(slope, intercept);
    if (!isSafeInt(startX)) throw new TypeError('startX must be a safe integer');
    if (!isSafeInt(endX)) throw new TypeError('endX must be a safe integer');
    if (startX > endX) throw new RangeError(`startX (${startX}) must not be greater than endX (${endX})`);
    if (startX < this._minX || endX > this._maxX) {
      throw new RangeError(`[startX, endX] must be within [${this._minX}, ${this._maxX}]: [${startX}, ${endX}]`);
    }
    const line = { slope, intercept, value, insertionIndex: this._insertCount++ };
    this._addSegment(this._root, this._minX, this._maxX, startX, endX, line);
    return this;
  }

  query(x) {
    if (!isSafeInt(x)) throw new TypeError('x must be a safe integer');
    if (x < this._minX || x > this._maxX) {
      throw new RangeError(`x out of domain [${this._minX}, ${this._maxX}]: ${x}`);
    }
    let node = this._root;
    let l = this._minX;
    let r = this._maxX;
    let best = null;
    while (node) {
      if (node.line) {
        const y = evalLine(node.line, x);
        if (
          best === null ||
          y < best.y ||
          (y === best.y && node.line.insertionIndex < best.insertionIndex)
        ) {
          best = { y, value: node.line.value, insertionIndex: node.line.insertionIndex };
        }
      }
      if (l === r) break;
      const mid = l + Math.floor((r - l) / 2);
      if (x <= mid) {
        node = node.left;
        r = mid;
      } else {
        node = node.right;
        l = mid + 1;
      }
    }
    return best === null ? null : { y: best.y, value: best.value };
  }

  _insertLine(node, l, r, newLine) {
    if (!node.line) {
      node.line = newLine;
      return;
    }
    const mid = l + Math.floor((r - l) / 2);
    let curLine = node.line;
    const leftBetter = isBetterAt(newLine, curLine, l);
    const midBetter = isBetterAt(newLine, curLine, mid);
    if (midBetter) {
      node.line = newLine;
      newLine = curLine;
    }
    if (l === r) return;
    if (leftBetter !== midBetter) {
      if (!node.left) node.left = { line: null, left: null, right: null };
      this._insertLine(node.left, l, mid, newLine);
    } else {
      if (!node.right) node.right = { line: null, left: null, right: null };
      this._insertLine(node.right, mid + 1, r, newLine);
    }
  }

  _addSegment(node, l, r, segStart, segEnd, line) {
    if (segEnd < l || r < segStart) return;
    if (segStart <= l && r <= segEnd) {
      this._insertLine(node, l, r, line);
      return;
    }
    const mid = l + Math.floor((r - l) / 2);
    if (segStart <= mid) {
      if (!node.left) node.left = { line: null, left: null, right: null };
      this._addSegment(node.left, l, mid, segStart, segEnd, line);
    }
    if (segEnd > mid) {
      if (!node.right) node.right = { line: null, left: null, right: null };
      this._addSegment(node.right, mid + 1, r, segStart, segEnd, line);
    }
  }
}

module.exports = { LiChaoTree };
