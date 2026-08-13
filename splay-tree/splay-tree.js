'use strict';

/**
 * Dependency-free, single-file deterministic Splay Tree ordered map.
 *
 * A self-adjusting binary search tree (Sleator & Tarjan, 1985) keyed by
 * finite JavaScript numbers. Every point access -- `get`, `set`, `has`,
 * `delete`, and `select` -- splays the node it touches (the exact match,
 * or, on a miss for `get`/`has`/`delete`, the last node reached while
 * searching for the key) all the way to the root via bottom-up zig,
 * zig-zig, and zig-zag rotations, in both left and right orientations.
 * `range` and `toArray` are pure queries and do not splay anything.
 *
 * API:
 *   set(key, value)   -- insert or overwrite the value stored at `key`,
 *                         then splay that node to the root.
 *   get(key)           -- splay the search path for `key` to the root;
 *                         returns the stored value, or `undefined` if
 *                         `key` is not present. `has(key)` (not
 *                         `get(key) !== undefined`) is the correct
 *                         existence check, since a stored value may
 *                         itself be `undefined`.
 *   has(key)           -- splay the search path for `key` to the root;
 *                         returns whether `key` is present.
 *   delete(key)        -- splay the search path for `key` to the root;
 *                         if present, remove it (joining its left and
 *                         right subtrees) and return `true`, else
 *                         return `false` (the tree is still splayed
 *                         around the closest key reached, but nothing
 *                         is removed).
 *   select(k)          -- the `[key, value]` pair at zero-based sorted
 *                         position `k` (`k` counts from the smallest
 *                         key), then splay that node to the root.
 *                         Throws `RangeError` if `k` is out of
 *                         `[0, size)`.
 *   range(lo, hi)       -- every `[key, value]` pair with
 *                         `lo <= key <= hi`, in ascending order. Returns
 *                         `[]` if `lo > hi` rather than throwing, the
 *                         same way `Array.prototype.slice(5, 2)` returns
 *                         `[]` rather than erroring. Does not splay.
 *   toArray()          -- every stored `[key, value]` pair, in ascending
 *                         key order. Does not splay.
 *   size               -- getter, the number of keys currently stored.
 *   height             -- getter, the tree's height (longest root-to-
 *                         leaf edge count); `-1` for an empty tree, `0`
 *                         for a single node, matching this repo's
 *                         `scapegoat-tree` convention.
 *
 *   `key` must be a finite JavaScript number (any finite double,
 *   including negative and fractional values) -- a non-number or
 *   non-finite `key` throws `TypeError` from every method that takes
 *   one. `k` (for `select`) must be a safe integer -- a non-integer `k`
 *   throws `TypeError`; an in-range-typed but out-of-bounds `k` throws
 *   `RangeError`, matching this repo's general convention that "wrong
 *   kind of value" is a `TypeError` while "right kind of value, wrong
 *   ordinal position/bounds" is a `RangeError`. `lo`/`hi` (for `range`)
 *   must be finite numbers, each independently validated with
 *   `TypeError` before the `lo > hi` empty-range check runs. `value`
 *   (for `set`) may be any JavaScript value, including `undefined`, and
 *   is stored by reference -- this class never mutates a stored value,
 *   and never mutates any input.
 *
 *   Determinism: for any fixed sequence of calls, the resulting tree
 *   shape, every returned value, and every reported `size`/`height` are
 *   byte-for-byte reproducible -- there is no randomness anywhere in
 *   this implementation, and JavaScript number comparison is itself
 *   deterministic.
 *
 * Algorithm notes: each node stores `key`, `value`, `left`, `right`,
 * `parent`, and `size` (the count of nodes in the subtree rooted at that
 * node, including itself). Rotations (`_rotateLeft`/`_rotateRight`) are
 * the standard single BST rotations, updated to also fix `parent`
 * pointers and recompute `size` for the two nodes whose subtree
 * membership changed (child first, then the node that becomes its new
 * parent, since the parent's size depends on the already-updated
 * child's size). `_splay(x)` repeatedly classifies `x`'s position
 * relative to its parent `p` and grandparent `g` -- no grandparent
 * (zig, one rotation), same-side chain (zig-zig, two same-direction
 * rotations of `g` then `p`), or opposite-side chain (zig-zag, two
 * opposite-direction rotations of `p` then `g`) -- until `x` has no
 * parent left, at which point `x` is the new root. Because every
 * ancestor on `x`'s original root path participates in at least one
 * rotation before the loop ends, every node's `size` is left correct
 * once splaying completes, with no separate size-propagation pass
 * needed.
 *
 * `delete` splays the target to the root first, then joins its two
 * subtrees: if there is no left subtree, the right subtree (if any)
 * becomes the new root outright; otherwise the left subtree's maximum
 * (found by walking right pointers, then splayed to the top of the
 * *detached* left subtree via the same `_splay` routine) becomes the
 * new root, and the right subtree is attached as its right child --
 * this works because splaying the maximum of a subtree always leaves it
 * with no right child, exactly the empty slot the right subtree needs.
 */

function isFiniteNumber(x) {
  return typeof x === 'number' && Number.isFinite(x);
}

class Node {
  constructor(key, value) {
    this.key = key;
    this.value = value;
    this.left = null;
    this.right = null;
    this.parent = null;
    this.size = 1;
  }
}

function sizeOf(node) {
  return node === null ? 0 : node.size;
}

// Iterative (explicit-stack) height computation. A splay tree's
// worst-case single-operation shape is a fully degenerate chain (e.g.
// after inserting many keys in strictly ascending order, before any
// later access re-balances things via splaying) -- a naive recursive
// height function would blow JS's call stack on such a chain once it
// gets a few thousand nodes deep, so this stays iterative regardless of
// how skewed the tree currently is.
function heightOf(root) {
  if (root === null) return -1;
  let maxDepth = 0;
  const stack = [[root, 0]];
  while (stack.length > 0) {
    const [node, depth] = stack.pop();
    if (depth > maxDepth) maxDepth = depth;
    if (node.left !== null) stack.push([node.left, depth + 1]);
    if (node.right !== null) stack.push([node.right, depth + 1]);
  }
  return maxDepth;
}

function updateSize(node) {
  node.size = 1 + sizeOf(node.left) + sizeOf(node.right);
}

class SplayTree {
  constructor() {
    this.root = null;
  }

  get size() {
    return sizeOf(this.root);
  }

  get height() {
    return heightOf(this.root);
  }

  // Rotates `y` left: `y`'s right child `x` takes `y`'s place, `y`
  // becomes `x`'s left child, and `x`'s old left subtree becomes `y`'s
  // new right subtree. Fixes parent pointers on both sides and
  // recomputes size for `y` (now the child) before `x` (now the
  // parent), since `x`'s size depends on `y`'s just-updated size.
  // Deliberately does NOT touch `this.root` -- see `_splay`, which sets
  // it exactly once, after the full splay completes, so that splaying a
  // node within a temporarily-detached subtree (as `delete` does) never
  // has to reason about whether an intermediate rotation "looked like"
  // it was rooting the whole tree.
  _rotateLeft(y) {
    const x = y.right;
    y.right = x.left;
    if (x.left !== null) x.left.parent = y;
    x.parent = y.parent;
    if (y.parent !== null) {
      if (y === y.parent.left) y.parent.left = x;
      else y.parent.right = x;
    }
    x.left = y;
    y.parent = x;
    updateSize(y);
    updateSize(x);
  }

  // Mirror image of `_rotateLeft`.
  _rotateRight(y) {
    const x = y.left;
    y.left = x.right;
    if (x.right !== null) x.right.parent = y;
    x.parent = y.parent;
    if (y.parent !== null) {
      if (y === y.parent.right) y.parent.right = x;
      else y.parent.left = x;
    }
    x.right = y;
    y.parent = x;
    updateSize(y);
    updateSize(x);
  }

  // Bottom-up splay of `x` to the root of whatever tree/subtree it
  // currently belongs to, via zig (no grandparent), zig-zig (x and its
  // parent are both left children, or both right children -- rotate the
  // grandparent then the parent, same direction twice), or zig-zag (x
  // and its parent are on opposite sides -- rotate the parent then the
  // grandparent, opposite directions). Once the loop ends, `x` has no
  // parent, so it IS the root of its structure -- `this.root` is set
  // unconditionally to `x` here, which is correct both for the normal
  // case (x was reachable from `this.root`) and for `delete`'s internal
  // use (splaying the maximum of a subtree that isn't `this.root`'s
  // subtree yet -- `delete` overwrites `this.root` again right after,
  // once it has re-attached the other subtree, so this assignment is
  // simply harmless in that case, never wrong).
  _splay(x) {
    while (x.parent !== null) {
      const p = x.parent;
      const g = p.parent;
      if (g === null) {
        // Zig.
        if (x === p.left) this._rotateRight(p);
        else this._rotateLeft(p);
      } else if (p === g.left && x === p.left) {
        // Zig-zig, left-left.
        this._rotateRight(g);
        this._rotateRight(p);
      } else if (p === g.right && x === p.right) {
        // Zig-zig, right-right.
        this._rotateLeft(g);
        this._rotateLeft(p);
      } else if (p === g.left && x === p.right) {
        // Zig-zag, left-right.
        this._rotateLeft(p);
        this._rotateRight(g);
      } else {
        // Zig-zag, right-left.
        this._rotateRight(p);
        this._rotateLeft(g);
      }
    }
    this.root = x;
  }

  // Descends from the root toward `key`, stopping either at the exact
  // match or at the last node reached before falling off the tree
  // (i.e. the node whose missing child would be `key`'s insertion
  // point). Splays whichever node that is to the root and returns it
  // (always `=== this.root` afterward). Only valid to call when
  // `this.root !== null`.
  _findAndSplay(key) {
    let cur = this.root;
    for (;;) {
      if (key === cur.key) break;
      const next = key < cur.key ? cur.left : cur.right;
      if (next === null) break;
      cur = next;
    }
    this._splay(cur);
    return cur;
  }

  set(key, value) {
    if (!isFiniteNumber(key)) throw new TypeError('key must be a finite number');
    if (this.root === null) {
      this.root = new Node(key, value);
      return;
    }
    let cur = this.root;
    for (;;) {
      if (key === cur.key) {
        cur.value = value;
        this._splay(cur);
        return;
      }
      if (key < cur.key) {
        if (cur.left === null) {
          const node = new Node(key, value);
          node.parent = cur;
          cur.left = node;
          this._splay(node);
          return;
        }
        cur = cur.left;
      } else {
        if (cur.right === null) {
          const node = new Node(key, value);
          node.parent = cur;
          cur.right = node;
          this._splay(node);
          return;
        }
        cur = cur.right;
      }
    }
  }

  get(key) {
    if (!isFiniteNumber(key)) throw new TypeError('key must be a finite number');
    if (this.root === null) return undefined;
    const node = this._findAndSplay(key);
    return node.key === key ? node.value : undefined;
  }

  has(key) {
    if (!isFiniteNumber(key)) throw new TypeError('key must be a finite number');
    if (this.root === null) return false;
    const node = this._findAndSplay(key);
    return node.key === key;
  }

  delete(key) {
    if (!isFiniteNumber(key)) throw new TypeError('key must be a finite number');
    if (this.root === null) return false;
    const node = this._findAndSplay(key);
    if (node.key !== key) return false;

    const left = this.root.left;
    const right = this.root.right;
    if (left !== null) left.parent = null;
    if (right !== null) right.parent = null;

    if (left === null) {
      this.root = right;
    } else {
      let maxNode = left;
      while (maxNode.right !== null) maxNode = maxNode.right;
      this._splay(maxNode); // brings maxNode to the root of the detached left subtree
      maxNode.right = right;
      if (right !== null) right.parent = maxNode;
      updateSize(maxNode);
      this.root = maxNode;
    }
    if (this.root !== null) this.root.parent = null;
    return true;
  }

  select(k) {
    if (!Number.isInteger(k)) throw new TypeError('index must be an integer');
    if (k < 0 || k >= sizeOf(this.root)) throw new RangeError(`index out of range: ${k}`);
    let cur = this.root;
    let remaining = k;
    for (;;) {
      const leftSize = sizeOf(cur.left);
      if (remaining < leftSize) {
        cur = cur.left;
      } else if (remaining === leftSize) {
        break;
      } else {
        remaining -= leftSize + 1;
        cur = cur.right;
      }
    }
    this._splay(cur);
    return [cur.key, cur.value];
  }

  range(lo, hi) {
    if (!isFiniteNumber(lo)) throw new TypeError('lo must be a finite number');
    if (!isFiniteNumber(hi)) throw new TypeError('hi must be a finite number');
    const out = [];
    if (lo > hi) return out;
    // Iterative in-order traversal, pruning subtrees that can't overlap
    // [lo, hi], so this stays well clear of JS's recursion-depth limit
    // even on a temporarily long splay chain.
    const stack = [];
    let cur = this.root;
    while (cur !== null || stack.length > 0) {
      while (cur !== null) {
        stack.push(cur);
        cur = cur.key >= lo ? cur.left : null; // only descend left if it could contain keys >= lo
      }
      cur = stack.pop();
      if (cur.key > hi) break; // ascending order: nothing further can be in range
      if (cur.key >= lo) out.push([cur.key, cur.value]);
      cur = cur.key <= hi ? cur.right : null; // only descend right if it could contain keys <= hi
    }
    return out;
  }

  toArray() {
    const out = [];
    const stack = [];
    let cur = this.root;
    while (cur !== null || stack.length > 0) {
      while (cur !== null) {
        stack.push(cur);
        cur = cur.left;
      }
      cur = stack.pop();
      out.push([cur.key, cur.value]);
      cur = cur.right;
    }
    return out;
  }
}

module.exports = { SplayTree };
