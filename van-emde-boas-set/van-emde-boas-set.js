'use strict';

/**
 * Dependency-free, single-file, deterministic van Emde Boas tree for a
 * bounded integer universe `[0, universeSize)`, supporting
 * O(log log universeSize)-depth `insert`/`delete`/`has`/`predecessor`/
 * `successor`, plus O(1) `minimum`/`maximum`/`size`.
 *
 * new VanEmdeBoasSet(universeSize)
 *   `universeSize` must be a safe integer that is an exact power of two
 *   in `[2, 2^32]` (i.e. `2, 4, 8, ..., 2^32`). Elements are integers in
 *   `[0, universeSize)`.
 *
 *   Every element argument to `insert`/`delete`/`has`/`predecessor`/
 *   `successor` is validated the same way: a non-safe-integer throws
 *   `TypeError`; a correctly-typed value outside `[0, universeSize)`
 *   throws `RangeError`. An invalid `universeSize` (non-safe-integer, or
 *   a safe integer that isn't an exact power of two in `[2, 2^32]`)
 *   throws `TypeError`/`RangeError` respectively from the constructor.
 *
 *   `insert(x)`/`delete(x)` are idempotent: inserting an already-present
 *   value, or deleting an already-absent one, is a harmless no-op that
 *   returns `false` (both return `true` when they actually changed the
 *   set).
 *
 *   `predecessor(x)`/`successor(x)` are *strict*: they find the largest
 *   stored element `< x` / smallest stored element `> x` respectively
 *   (never `x` itself, even if `x` is a member), and return `null` when
 *   no such element exists. `x` need not itself be a member -- it only
 *   needs to be a valid universe value.
 *
 *   `minimum()`/`maximum()` return `null` when the set is empty.
 *   `size()` returns the current element count in O(1) (tracked
 *   incrementally, not recomputed by walking the structure).
 *
 * Algorithm: the classic van Emde Boas tree (Cormen/Leiserson/Rivest/
 * Stein's "vEB tree"). A universe of size `u > 2` is split into
 * `upperSize = 2^ceil(k/2)` top-level clusters, each itself a universe
 * of size `lowerSize = 2^floor(k/2)` (where `k = log2(u)`), plus a
 * `summary` sub-structure (itself a vEB tree of size `upperSize`)
 * tracking which clusters are currently non-empty. `u === 2` is the
 * base case (a "leaf" holding at most `{0, 1}` directly, no further
 * recursion). Every node's own `min` is kept *outside* its cluster
 * sub-structures (the standard optimization that gives worst-case, not
 * just amortized, `O(log log u)` operations): inserting into a
 * currently-empty cluster sets that cluster's `min`/`max` directly in
 * O(1) without any further recursion, since a single-element cluster
 * trivially has no internal structure worth building yet.
 *
 * Laziness: cluster and summary sub-structures are only ever allocated
 * the first time they are actually needed (via a `Map` keyed by cluster
 * index, not a full-width array) -- so constructing a `VanEmdeBoasSet`
 * for `universeSize = 2^32` is instant and touches no memory
 * proportional to `universeSize`; memory use stays proportional to how
 * many elements have actually been inserted (times the O(log log u)
 * recursion depth), never to the universe size itself.
 *
 * Internal design: `_VEBNode` implements the classic recursive
 * algorithm exactly as in the textbook -- its `insert`/`delete` methods
 * *assume* the element is respectively already-absent/already-present
 * (that's what the textbook pseudocode assumes; calling it on a
 * duplicate or a non-member produces a corrupted structure). The public
 * `VanEmdeBoasSet` wrapper is solely responsible for input validation,
 * the up-front `has()` check that makes `insert`/`delete` idempotent
 * per this task's own spec, and incremental `size` tracking -- keeping
 * the recursive engine itself a direct, easy-to-verify transcription of
 * the standard algorithm.
 */

function isSafeInt(v) {
  return typeof v === 'number' && Number.isSafeInteger(v);
}

/** Returns k such that 2**k === u, for a safe-integer u already known to
 * be >= 2, or null if u is not an exact power of two. Uses a rounded
 * log2 plus an exact re-check (rather than any bitwise op) specifically
 * so it stays correct up to u = 2**32, which is outside the 32-bit
 * range that JS's bitwise operators silently wrap to. */
function exactLog2(u) {
  const k = Math.round(Math.log2(u));
  if (k < 1 || 2 ** k !== u) return null;
  return k;
}

class _VEBNode {
  constructor(u) {
    this.u = u;
    this.min = null;
    this.max = null;
    if (u > 2) {
      // k = log2(u) is always exactly computable here: this constructor
      // is only ever called (from VanEmdeBoasSet or recursively from
      // itself) with a u that is already known to be an exact power of
      // two, so no re-validation/error-handling is needed internally.
      const k = Math.round(Math.log2(u));
      const half = k >> 1; // k <= 32 always, so 32-bit ops on k itself are safe
      this.lowerSize = 2 ** half;
      this.upperSize = 2 ** (k - half);
      this.summary = null; // lazily created _VEBNode(this.upperSize)
      this.clusters = new Map(); // high-index -> lazily created _VEBNode(this.lowerSize)
    }
  }

  high(x) {
    return Math.floor(x / this.lowerSize);
  }

  low(x) {
    return x - this.high(x) * this.lowerSize;
  }

  index(h, l) {
    return h * this.lowerSize + l;
  }

  isEmpty() {
    return this.min === null;
  }

  minimum() {
    return this.min;
  }

  maximum() {
    return this.max;
  }

  has(x) {
    if (this.min === null) return false;
    if (x === this.min || x === this.max) return true;
    if (this.u === 2) return false;
    const c = this.clusters.get(this.high(x));
    return c ? c.has(this.low(x)) : false;
  }

  // Classic textbook INSERT. Precondition: x is not already a member
  // (enforced by the VanEmdeBoasSet wrapper before calling in).
  insert(x) {
    if (this.min === null) {
      this.min = this.max = x;
      return;
    }
    if (x < this.min) {
      const tmp = x;
      x = this.min;
      this.min = tmp;
    }
    if (this.u > 2) {
      const h = this.high(x);
      const l = this.low(x);
      let c = this.clusters.get(h);
      if (!c) {
        c = new _VEBNode(this.lowerSize);
        this.clusters.set(h, c);
      }
      if (c.min === null) {
        // Cluster was empty: set its min/max directly in O(1) (no
        // recursion needed for a single-element cluster) and record it
        // as non-empty in the summary.
        if (!this.summary) this.summary = new _VEBNode(this.upperSize);
        this.summary.insert(h);
        c.min = c.max = l;
      } else {
        c.insert(l);
      }
    }
    if (x > this.max) this.max = x;
  }

  // Classic textbook DELETE. Precondition: x is currently a member.
  delete(x) {
    if (this.min === this.max) {
      // The one and only element -- becomes empty.
      this.min = this.max = null;
      return;
    }
    if (this.u === 2) {
      // Exactly one of {0, 1} is being deleted; the other remains.
      this.min = this.max = x === 0 ? 1 : 0;
      return;
    }
    if (x === this.min) {
      // Deleting the min: promote the smallest element of the
      // lowest-indexed non-empty cluster to be the new min, then fall
      // through to delete *that* value from its cluster (min itself is
      // never stored inside any cluster).
      const firstCluster = this.summary.minimum();
      const c0 = this.clusters.get(firstCluster);
      x = this.index(firstCluster, c0.minimum());
      this.min = x;
    }
    const h = this.high(x);
    const l = this.low(x);
    const c = this.clusters.get(h);
    c.delete(l);
    if (c.isEmpty()) {
      this.summary.delete(h);
      if (x === this.max) {
        const summaryMax = this.summary.maximum();
        if (summaryMax === null) {
          this.max = this.min; // no other clusters left -- only min remains
        } else {
          const cMax = this.clusters.get(summaryMax);
          this.max = this.index(summaryMax, cMax.maximum());
        }
      }
    } else if (x === this.max) {
      this.max = this.index(h, c.maximum());
    }
  }

  successor(x) {
    if (this.u === 2) {
      if (x === 0 && this.max === 1) return 1;
      return null;
    }
    if (this.min !== null && x < this.min) return this.min;
    const h = this.high(x);
    const l = this.low(x);
    const c = this.clusters.get(h);
    const maxLow = c ? c.maximum() : null;
    if (maxLow !== null && l < maxLow) {
      return this.index(h, c.successor(l));
    }
    const succCluster = this.summary ? this.summary.successor(h) : null;
    if (succCluster === null) return null;
    const cs = this.clusters.get(succCluster);
    return this.index(succCluster, cs.minimum());
  }

  predecessor(x) {
    if (this.u === 2) {
      if (x === 1 && this.min === 0) return 0;
      return null;
    }
    if (this.max !== null && x > this.max) return this.max;
    const h = this.high(x);
    const l = this.low(x);
    const c = this.clusters.get(h);
    const minLow = c ? c.minimum() : null;
    if (minLow !== null && l > minLow) {
      return this.index(h, c.predecessor(l));
    }
    const predCluster = this.summary ? this.summary.predecessor(h) : null;
    if (predCluster === null) {
      if (this.min !== null && x > this.min) return this.min;
      return null;
    }
    const cp = this.clusters.get(predCluster);
    return this.index(predCluster, cp.maximum());
  }
}

class VanEmdeBoasSet {
  constructor(universeSize) {
    if (!isSafeInt(universeSize)) throw new TypeError('universeSize must be a safe integer');
    if (universeSize < 2) throw new RangeError('universeSize must be at least 2');
    if (exactLog2(universeSize) === null || universeSize > 2 ** 32) {
      throw new RangeError('universeSize must be a power of two between 2 and 2^32 inclusive');
    }
    this._u = universeSize;
    this._root = new _VEBNode(universeSize);
    this._size = 0;
  }

  _validateElement(x) {
    if (!isSafeInt(x)) throw new TypeError('value must be a safe integer');
    if (x < 0 || x >= this._u) throw new RangeError(`value out of universe range [0, ${this._u}): ${x}`);
  }

  has(x) {
    this._validateElement(x);
    return this._root.has(x);
  }

  insert(x) {
    this._validateElement(x);
    if (this._root.has(x)) return false;
    this._root.insert(x);
    this._size++;
    return true;
  }

  delete(x) {
    this._validateElement(x);
    if (!this._root.has(x)) return false;
    this._root.delete(x);
    this._size--;
    return true;
  }

  minimum() {
    return this._root.minimum();
  }

  maximum() {
    return this._root.maximum();
  }

  predecessor(x) {
    this._validateElement(x);
    return this._root.predecessor(x);
  }

  successor(x) {
    this._validateElement(x);
    return this._root.successor(x);
  }

  size() {
    return this._size;
  }
}

module.exports = { VanEmdeBoasSet };
