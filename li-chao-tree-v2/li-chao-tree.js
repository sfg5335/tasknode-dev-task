'use strict';

/**
 * Dependency-free, single-file, deterministic Li Chao tree for
 * minimum-line point queries over a fixed inclusive integer domain.
 *
 * `new LiChaoTree(minX, maxX)` builds a tree over the inclusive integer
 * domain `[minX, maxX]`. `addLine(slope, intercept, label)` inserts the
 * line `y = slope*x + intercept`, active across the entire domain, tagged
 * with an arbitrary `label`. `query(x)` returns `{ value, label }` for the
 * line with the minimum `y` at `x` (ties broken by earliest insertion), or
 * `null` if no line has been inserted yet. `size` is the number of
 * successful `addLine` calls so far.
 *
 * Every input is validated: a non-number argument throws `TypeError`; a
 * correctly-typed but invalid value (non-finite, non-safe-integer where an
 * integer is required, a reversed `[minX, maxX]`, or a query/domain
 * coordinate outside `[minX, maxX]`) throws `RangeError`. A validation
 * failure never mutates the tree or increments `size`.
 */
class LiChaoTree {
  constructor(minX, maxX) {
    if (typeof minX !== 'number' || typeof maxX !== 'number') {
      throw new TypeError('minX and maxX must be numbers');
    }
    if (!Number.isSafeInteger(minX) || !Number.isSafeInteger(maxX)) {
      throw new RangeError('minX and maxX must be safe integers');
    }
    if (minX > maxX) {
      throw new RangeError('minX must be <= maxX');
    }
    this._minX = minX;
    this._maxX = maxX;
    this._root = null;
    this._size = 0;
    this._seq = 0;
  }

  get size() {
    return this._size;
  }

  addLine(slope, intercept, label) {
    if (typeof slope !== 'number' || typeof intercept !== 'number') {
      throw new TypeError('slope and intercept must be numbers');
    }
    if (!Number.isFinite(slope) || !Number.isFinite(intercept)) {
      throw new RangeError('slope and intercept must be finite');
    }
    const line = { slope, intercept, label, seq: this._seq++ };
    this._root = this._insert(this._root, this._minX, this._maxX, line);
    this._size++;
    return this;
  }

  query(x) {
    if (typeof x !== 'number') {
      throw new TypeError('x must be a number');
    }
    if (!Number.isSafeInteger(x)) {
      throw new RangeError('x must be a safe integer');
    }
    if (x < this._minX || x > this._maxX) {
      throw new RangeError('x must lie within the tree domain');
    }
    if (this._size === 0) {
      return null;
    }

    let node = this._root;
    let lo = this._minX;
    let hi = this._maxX;
    let best = null;

    while (node !== null) {
      if (best === null || this._better(node.line, best, x)) {
        best = node.line;
      }
      if (lo === hi) {
        break;
      }
      const mid = lo + Math.floor((hi - lo) / 2);
      if (x <= mid) {
        node = node.left;
        hi = mid;
      } else {
        node = node.right;
        lo = mid + 1;
      }
    }

    return { value: this._evalLine(best, x), label: best.label };
  }

  _evalLine(line, x) {
    return line.slope * x + line.intercept;
  }

  // Total order used for both insertion swap decisions and query
  // best-tracking: strictly smaller y wins; an exact y tie is broken by
  // strictly smaller insertion sequence number (earliest insertion wins).
  // Using this same compound (value, seq) order everywhere -- rather than
  // relying on plain numeric comparison plus incidental traversal order --
  // is what makes earliest-insertion tie-breaking correct globally, not
  // just locally at a single node.
  _better(a, b, x) {
    const va = this._evalLine(a, x);
    const vb = this._evalLine(b, x);
    if (va !== vb) {
      return va < vb;
    }
    return a.seq < b.seq;
  }

  // Classic Li Chao tree insertion, generalized from "numeric less-than"
  // to the `_better` total order above. `node` is `{ line, left, right }`
  // or `null` (lazily allocated); `[lo, hi]` is the current node's
  // inclusive integer sub-range of the domain.
  _insert(node, lo, hi, line) {
    if (node === null) {
      return { line, left: null, right: null };
    }

    let challenger = line;
    const resident = node.line;
    const mid = lo + Math.floor((hi - lo) / 2);

    let challengerBetterAtLo = this._better(challenger, resident, lo);
    const challengerBetterAtMid = this._better(challenger, resident, mid);

    if (challengerBetterAtMid) {
      node.line = challenger;
      challenger = resident;
      challengerBetterAtLo = !challengerBetterAtLo;
    }

    if (lo === hi) {
      return node;
    }

    if (challengerBetterAtLo) {
      node.left = this._insert(node.left, lo, mid, challenger);
    } else {
      node.right = this._insert(node.right, mid + 1, hi, challenger);
    }

    return node;
  }
}

module.exports = { LiChaoTree };
