'use strict';

/**
 * Dependency-free, single-file, deterministic Link-Cut Forest
 * (Sleator-Tarjan link-cut tree, one per connected component) over
 * zero-based, weighted vertices, supporting dynamic `link`/`cut` of
 * edges plus O(log n)-amortized `connected` and `pathSum` queries.
 *
 * new LinkCutForest(values)
 *   `values` must be an array of finite numbers; `values[i]` becomes the
 *   initial weight of vertex `i` (so the forest starts as `values.length`
 *   isolated singleton vertices with no edges).
 *
 * link(u, v)
 *   Adds an (undirected) edge between `u` and `v`, joining their two
 *   trees into one. Throws if `u === v` (a self-link), or if `u` and `v`
 *   are already connected (linking them would create a cycle, which a
 *   forest can never contain).
 *
 * cut(u, v)
 *   Removes the edge directly between `u` and `v`, splitting their tree
 *   in two. Throws if `u === v`, or if there is no direct edge between
 *   `u` and `v` (including when they're in different trees entirely).
 *
 * connected(u, v)
 *   True if `u` and `v` are in the same tree (same connected component).
 *   `connected(u, u)` is always `true`.
 *
 * setValue(u, value)
 *   Sets vertex `u`'s own weight to `value` (must be a finite number).
 *
 * pathSum(u, v)
 *   The sum of every vertex's weight along the unique path between `u`
 *   and `v` (inclusive of both endpoints). `pathSum(u, u)` is just
 *   `u`'s own weight. Throws if `u` and `v` are not connected (no path
 *   exists).
 *
 * size(u)
 *   The number of vertices in `u`'s connected component (including `u`
 *   itself). A freshly-constructed, never-linked vertex has size 1.
 *
 * Every method validates `u`/`v`: a non-integer (or non-number) vertex
 * throws `TypeError`; a correctly-typed vertex outside `[0, n)` throws
 * `RangeError`. Every other documented rejection above (self-link,
 * cycle-forming link, self-cut, non-edge cut, disconnected path query)
 * also throws `RangeError` -- they're all "well-typed, well-bounded, but
 * logically invalid" input combinations, the same bucket other
 * already-completed tasks in this series use RangeError for (e.g. an
 * empty required range, `min > max`).
 *
 * Internally: each vertex is a node in a splay tree representing its
 * *preferred path* (the standard link-cut-tree representation); the
 * n splay trees together, linked by "path-pointer" (virtual) parent
 * edges, represent the whole forest. `access`/`makeRoot`/`findRoot` are
 * the three standard link-cut-tree primitives everything else is built
 * from. A parallel, trivial adjacency-set structure (`_adj`) tracks the
 * forest's *real* edges (updated in lockstep by `link`/`cut`) purely so
 * `size(u)` can be answered by a plain BFS over real edges -- this
 * doesn't affect `link`/`cut`/`connected`/`pathSum`, which are answered
 * entirely by the splay-tree machinery.
 */

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

class LinkCutForest {
  constructor(values) {
    if (!Array.isArray(values)) throw new TypeError('values must be an array');
    for (let i = 0; i < values.length; i++) {
      if (!isFiniteNumber(values[i])) throw new TypeError(`values[${i}] must be a finite number`);
    }

    const n = values.length;
    this._n = n;

    // Splay-tree node arrays, indexed by vertex id. -1 is the "null" sentinel.
    this._parent = new Int32Array(n).fill(-1);
    this._left = new Int32Array(n).fill(-1);
    this._right = new Int32Array(n).fill(-1);
    this._rev = new Uint8Array(n); // lazy "reverse this splay-subtree" flag
    this._val = new Float64Array(n);
    this._sum = new Float64Array(n); // sum of val over this splay-subtree
    this._sz = new Int32Array(n); // count of nodes in this splay-subtree

    for (let i = 0; i < n; i++) {
      this._val[i] = values[i];
      this._sum[i] = values[i];
      this._sz[i] = 1;
    }

    // Real forest adjacency (undirected), used only to answer size(u).
    this._adj = Array.from({ length: n }, () => new Set());
  }

  _requireVertex(v, name) {
    if (typeof v !== 'number' || !Number.isInteger(v)) {
      throw new TypeError(`${name} must be an integer`);
    }
    if (v < 0 || v >= this._n) {
      throw new RangeError(`${name} out of range: ${v}`);
    }
  }

  // ---- splay-tree primitives ----

  _isSplayRoot(x) {
    const p = this._parent[x];
    return p === -1 || (this._left[p] !== x && this._right[p] !== x);
  }

  _pushUp(x) {
    const l = this._left[x];
    const r = this._right[x];
    this._sum[x] = this._val[x] + (l !== -1 ? this._sum[l] : 0) + (r !== -1 ? this._sum[r] : 0);
    this._sz[x] = 1 + (l !== -1 ? this._sz[l] : 0) + (r !== -1 ? this._sz[r] : 0);
  }

  _applyRev(x) {
    if (x === -1) return;
    const l = this._left[x];
    this._left[x] = this._right[x];
    this._right[x] = l;
    this._rev[x] ^= 1;
  }

  _pushDown(x) {
    if (this._rev[x]) {
      this._applyRev(this._left[x]);
      this._applyRev(this._right[x]);
      this._rev[x] = 0;
    }
  }

  _rotate(x) {
    const p = this._parent[x];
    const g = this._parent[p];
    const pWasSplayRoot = this._isSplayRoot(p);
    const pIsLeftOfG = this._left[g] === p;

    if (this._left[p] === x) {
      this._left[p] = this._right[x];
      if (this._right[x] !== -1) this._parent[this._right[x]] = p;
      this._right[x] = p;
    } else {
      this._right[p] = this._left[x];
      if (this._left[x] !== -1) this._parent[this._left[x]] = p;
      this._left[x] = p;
    }
    this._parent[p] = x;
    this._parent[x] = g;
    if (!pWasSplayRoot) {
      if (pIsLeftOfG) this._left[g] = x;
      else if (this._right[g] === p) this._right[g] = x;
      // else: g's child pointer didn't reference p (p was itself only a
      // path-pointer child of g) -- x inherits that same path-pointer role,
      // no structural change needed on g's side.
    }
    this._pushUp(p);
    this._pushUp(x);
  }

  _splay(x) {
    // Resolve every pending reversal along the current splay-tree path
    // top-down before any rotation (rotations assume pushDown is current).
    const stack = [];
    let y = x;
    while (true) {
      stack.push(y);
      if (this._isSplayRoot(y)) break;
      y = this._parent[y];
    }
    while (stack.length > 0) this._pushDown(stack.pop());

    while (!this._isSplayRoot(x)) {
      const p = this._parent[x];
      const g = this._parent[p];
      if (!this._isSplayRoot(p)) {
        const zigZig = (this._left[g] === p) === (this._left[p] === x);
        if (zigZig) this._rotate(p);
        else this._rotate(x);
      }
      this._rotate(x);
    }
  }

  /** Exposes the path from the real root of x's tree to x as a single
   * splay tree (the standard link-cut-tree "access" operation), and
   * returns the real root's vertex id. */
  _access(x) {
    let last = -1;
    let y = x;
    while (y !== -1) {
      this._splay(y);
      this._right[y] = last;
      this._pushUp(y);
      last = y;
      y = this._parent[y];
    }
    this._splay(x);
  }

  _makeRoot(x) {
    this._access(x);
    this._applyRev(x);
  }

  /** access(x) exposes the path from the real root to x as a single
   * splay tree rooted at x -- but it does NOT reliably tell us which
   * vertex is the real root: the very first access after some path-
   * pointer restructuring walks up through distinct splay trees and the
   * last one reached is the root, but on a *subsequent* access of a
   * vertex that's already fully merged into one splay tree with the
   * root, the walk-up loop terminates immediately and never revisits
   * that history. The reliable way to find the root is the standard one:
   * after access(x), the real root is always the *leftmost* node of the
   * resulting splay tree (left = closer to root, right = closer to x,
   * by construction of every rotation/attachment above). */
  _findRoot(x) {
    this._access(x);
    let y = x;
    this._pushDown(y);
    while (this._left[y] !== -1) {
      y = this._left[y];
      this._pushDown(y);
    }
    this._splay(y);
    return y;
  }

  // ---- public API ----

  link(u, v) {
    this._requireVertex(u, 'u');
    this._requireVertex(v, 'v');
    if (u === v) throw new RangeError('cannot link a vertex to itself');
    if (this.connected(u, v)) throw new RangeError(`link(${u}, ${v}) would create a cycle`);

    this._makeRoot(u);
    this._parent[u] = v;
    this._adj[u].add(v);
    this._adj[v].add(u);
  }

  cut(u, v) {
    this._requireVertex(u, 'u');
    this._requireVertex(v, 'v');
    if (u === v) throw new RangeError(`(${u}, ${v}) is not an edge (self-cut)`);
    // Connectivity must be checked *before* relying on the sz[v] === 2
    // shortcut below: if u and v are in different trees, access(v) never
    // touches u at all, and v's own (unrelated) tree can coincidentally
    // also have exactly 2 vertices, which would otherwise look just like
    // a direct u-v edge. Confirming connectivity first rules that out.
    if (!this.connected(u, v)) throw new RangeError(`(${u}, ${v}) is not an edge`);

    this._makeRoot(u);
    this._access(v);
    // After makeRoot(u); access(v), the splay tree rooted at v represents
    // exactly the path from u to v. A direct edge exists iff that path has
    // exactly 2 vertices (u and v, with nothing in between).
    if (this._sz[v] !== 2) {
      throw new RangeError(`(${u}, ${v}) is not an edge`);
    }
    const uNode = this._left[v];
    this._parent[uNode] = -1;
    this._left[v] = -1;
    this._pushUp(v);

    this._adj[u].delete(v);
    this._adj[v].delete(u);
  }

  connected(u, v) {
    this._requireVertex(u, 'u');
    this._requireVertex(v, 'v');
    if (u === v) return true;
    return this._findRoot(u) === this._findRoot(v);
  }

  setValue(u, value) {
    this._requireVertex(u, 'u');
    if (!isFiniteNumber(value)) throw new TypeError('value must be a finite number');

    this._access(u);
    this._val[u] = value;
    this._pushUp(u);
  }

  pathSum(u, v) {
    this._requireVertex(u, 'u');
    this._requireVertex(v, 'v');
    if (u !== v && !this.connected(u, v)) {
      throw new RangeError(`${u} and ${v} are not connected`);
    }
    this._makeRoot(u);
    this._access(v);
    return this._sum[v];
  }

  size(u) {
    this._requireVertex(u, 'u');
    const visited = new Set([u]);
    const queue = [u];
    let qi = 0;
    while (qi < queue.length) {
      const x = queue[qi++];
      for (const nb of this._adj[x]) {
        if (!visited.has(nb)) {
          visited.add(nb);
          queue.push(nb);
        }
      }
    }
    return visited.size;
  }
}

module.exports = { LinkCutForest };
