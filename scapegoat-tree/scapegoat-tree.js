'use strict';

// Deterministic Scapegoat Search Tree
// ------------------------------------
//
// A classic weight-balanced binary search tree (Galperin & Rivest, 1993)
// that maintains an approximate balance invariant via a fixed alpha
// parameter (alpha = 2/3 here) instead of per-node balance metadata like
// AVL/red-black trees. Balance is restored by fully rebuilding the subtree
// rooted at the first "scapegoat" ancestor found to be unbalanced after an
// insertion, or by rebuilding the whole tree after enough deletions have
// been performed relative to the largest size seen since the last full
// rebuild.
//
// Keys must be finite JavaScript numbers (any finite double, including
// negative and fractional values). Values may be any JavaScript value,
// including undefined -- `has(key)` (not `get(key) !== undefined`) is the
// correct existence check.
//
// Exposed operations: set, get, has, delete, rank, select, range, toArray,
// size, height. Every mutating/query method validates its inputs and
// throws TypeError for malformed inputs (wrong type, non-finite number).
// There are no RangeError-worthy "invalid but well-typed" inputs for a
// numeric-keyed ordered map, EXCEPT `select(k)`, whose argument must be a
// valid index into the currently-stored key set -- an out-of-range index
// is a RangeError, matching the general convention that "wrong kind of
// value" is a TypeError while "right kind of value, wrong ordinal
// position/bounds" is a RangeError.

const ALPHA = 2 / 3;

// log_{1/alpha}(n), the classic scapegoat "ideal height" bound. Using
// Math.log(n) / Math.log(1/alpha) rather than any bit-trick keeps this
// exact for the full finite-integer range without 32-bit truncation
// concerns (n can exceed 2^31 for extremely large trees in principle).
function idealHeightBound(n) {
  if (n <= 1) return 0;
  return Math.log(n) / Math.log(1 / ALPHA);
}

function isFiniteNumber(x) {
  return typeof x === 'number' && Number.isFinite(x);
}

function isNonNegativeInteger(x) {
  return typeof x === 'number' && Number.isInteger(x) && x >= 0;
}

class Node {
  constructor(key, value) {
    this.key = key;
    this.value = value;
    this.left = null;
    this.right = null;
    this.size = 1;
  }
}

function sizeOf(node) {
  return node === null ? 0 : node.size;
}

// Flattens a subtree into an array of its nodes in ascending key order
// (in-order traversal), reusing the existing Node objects (values are
// preserved by reference/copy, not cloned) so identity of unrelated
// subtrees below the rebuilt one is preserved wherever the rebuild
// re-parents them.
function flattenInOrder(node, out) {
  if (node === null) return out;
  flattenInOrder(node.left, out);
  out.push(node);
  flattenInOrder(node.right, out);
  return out;
}

// Rebuilds a perfectly (or as-perfectly-as-possible) balanced BST from a
// sorted array of nodes (by key ascending), reusing the node objects
// themselves (just clearing/re-wiring left/right/size) rather than
// allocating fresh ones. "Always choose the lower midpoint during
// rebuilds": for an even-length range, the root is the node at the LOWER
// of the two middle indices, i.e. index `lo + floor((hi - lo) / 2)`, which
// biases extra nodes into the right subtree when a range has even length.
function buildBalanced(nodes, lo, hi) {
  if (lo > hi) return null;
  const mid = lo + Math.floor((hi - lo) / 2);
  const node = nodes[mid];
  node.left = buildBalanced(nodes, lo, mid - 1);
  node.right = buildBalanced(nodes, mid + 1, hi);
  node.size = sizeOf(node.left) + sizeOf(node.right) + 1;
  return node;
}

function rebuildSubtree(node) {
  const nodes = flattenInOrder(node, []);
  return buildBalanced(nodes, 0, nodes.length - 1);
}

class ScapegoatTree {
  constructor() {
    this.root = null;
    // The largest size the tree has held since the last full rebuild
    // (insertion-triggered scapegoat rebuilds do not reset this; only a
    // full-tree rebuild -- whether insertion- or deletion-triggered --
    // resets it to the tree's size immediately after that rebuild).
    this._maxSize = 0;
  }

  size() {
    return sizeOf(this.root);
  }

  height() {
    return heightOf(this.root);
  }

  has(key) {
    if (!isFiniteNumber(key)) throw new TypeError('key must be a finite number');
    return findNode(this.root, key) !== null;
  }

  get(key) {
    if (!isFiniteNumber(key)) throw new TypeError('key must be a finite number');
    const node = findNode(this.root, key);
    return node === null ? undefined : node.value;
  }

  set(key, value) {
    if (!isFiniteNumber(key)) throw new TypeError('key must be a finite number');

    // Replacement: key already present -- update value in place, no
    // structural change, no size/maxSize/rebalance bookkeeping needed.
    const existing = findNode(this.root, key);
    if (existing !== null) {
      existing.value = value;
      return this;
    }

    // Fresh insertion: standard BST insert, tracking the path (for size
    // increments and, if needed, scapegoat search) and the resulting
    // depth of the new node (root's children are depth 1).
    const path = [];
    let cur = this.root;
    let parent = null;
    let wentRight = false;
    while (cur !== null) {
      path.push(cur);
      parent = cur;
      if (key < cur.key) {
        cur = cur.left;
        wentRight = false;
      } else {
        cur = cur.right;
        wentRight = true;
      }
    }

    const newNode = new Node(key, value);
    if (parent === null) {
      this.root = newNode;
    } else if (wentRight) {
      parent.right = newNode;
    } else {
      parent.left = newNode;
    }
    path.push(newNode);
    for (const n of path) n.size += n === newNode ? 0 : 1;
    // (newNode itself already has size 1 from its constructor; every
    // ancestor on `path` gains exactly one to its size.)

    const depth = path.length - 1; // number of edges from root to newNode
    const currentSize = this.root.size; // n, right after this insertion

    // The insertion-triggered rebalance check compares the new node's
    // depth against the classic ideal-height bound for the tree's
    // CURRENT size (not `_maxSize`, which is reserved for the separate
    // deletion-triggered full-rebuild criterion below) -- this keeps the
    // two rebuild triggers cleanly independent and easy to reason about:
    // "is this insertion, right now, too deep for how many nodes we
    // actually have?" rather than referencing a possibly much larger
    // historical peak.
    if (depth > idealHeightBound(currentSize)) {
      // Walk from the new node's parent back up to the root, looking for
      // the first (deepest) ancestor that is not alpha-weight-balanced:
      // a node u is alpha-weight-balanced iff size(u.left) <= alpha *
      // size(u) AND size(u.right) <= alpha * size(u). Because we just
      // grew the path by one, at least one such ancestor is guaranteed
      // to exist once depth exceeds the ideal bound (classic scapegoat
      // theorem) -- fall back to rebuilding the whole tree defensively
      // if none is found (should not happen for a correct implementation,
      // but keeps the method total rather than silently doing nothing).
      let scapegoat = null;
      let scapegoatParent = null;
      for (let i = path.length - 2; i >= 0; i--) {
        const u = path[i];
        const left = sizeOf(u.left);
        const right = sizeOf(u.right);
        if (left > ALPHA * u.size || right > ALPHA * u.size) {
          scapegoat = u;
          scapegoatParent = i > 0 ? path[i - 1] : null;
          break;
        }
      }
      if (scapegoat !== null) {
        const rebuilt = rebuildSubtree(scapegoat);
        if (scapegoatParent === null) {
          this.root = rebuilt;
        } else if (scapegoatParent.left === scapegoat) {
          scapegoatParent.left = rebuilt;
        } else {
          scapegoatParent.right = rebuilt;
        }
      } else {
        this.root = rebuildSubtree(this.root);
      }
    }

    // `_maxSize` tracks the largest size the tree has held since the last
    // FULL rebuild (whether insertion- or deletion-triggered); it is
    // consulted only by `delete()` below. A local (non-root) scapegoat
    // rebuild here doesn't reset it -- only a deletion-triggered full
    // rebuild does, since that is the only event that re-establishes "the
    // whole tree is freshly, perfectly balanced at this size."
    this._maxSize = Math.max(this._maxSize, currentSize);

    return this;
  }

  delete(key) {
    if (!isFiniteNumber(key)) throw new TypeError('key must be a finite number');
    if (findNode(this.root, key) === null) return false;

    this.root = deleteFromSubtree(this.root, key);

    const n = sizeOf(this.root);
    if (n === 0) {
      this._maxSize = 0;
    } else if (n < ALPHA * this._maxSize) {
      this.root = rebuildSubtree(this.root);
      this._maxSize = n;
    }
    return true;
  }

  // Number of stored keys strictly less than `key` (order-statistic rank,
  // 0-indexed). `key` need not itself be present in the tree.
  rank(key) {
    if (!isFiniteNumber(key)) throw new TypeError('key must be a finite number');
    let count = 0;
    let cur = this.root;
    while (cur !== null) {
      if (key <= cur.key) {
        cur = cur.left;
      } else {
        count += sizeOf(cur.left) + 1;
        cur = cur.right;
      }
    }
    return count;
  }

  // Returns the [key, value] pair at 0-indexed position `k` in ascending
  // key order. Throws RangeError if k is out of [0, size()) bounds.
  select(k) {
    if (!isNonNegativeInteger(k)) throw new TypeError('index must be a non-negative integer');
    if (k >= this.size()) throw new RangeError('index out of range');
    let cur = this.root;
    let remaining = k;
    while (cur !== null) {
      const leftSize = sizeOf(cur.left);
      if (remaining < leftSize) {
        cur = cur.left;
      } else if (remaining === leftSize) {
        return [cur.key, cur.value];
      } else {
        remaining -= leftSize + 1;
        cur = cur.right;
      }
    }
    /* istanbul ignore next -- unreachable given the bounds check above */
    throw new RangeError('index out of range');
  }

  // Returns every [key, value] pair with lo <= key <= hi, in ascending
  // order. Returns an empty array if lo > hi rather than throwing --
  // a query over an empty (inverted) range is well-defined and simply
  // matches nothing, the same way Array.prototype.slice(5, 2) returns []
  // rather than erroring.
  range(lo, hi) {
    if (!isFiniteNumber(lo)) throw new TypeError('lo must be a finite number');
    if (!isFiniteNumber(hi)) throw new TypeError('hi must be a finite number');
    const out = [];
    if (lo > hi) return out;
    collectRange(this.root, lo, hi, out);
    return out;
  }

  // Every stored [key, value] pair, in ascending key order.
  toArray() {
    const out = [];
    let stack = [];
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

function findNode(node, key) {
  let cur = node;
  while (cur !== null) {
    if (key === cur.key) return cur;
    cur = key < cur.key ? cur.left : cur.right;
  }
  return null;
}

function heightOf(node) {
  if (node === null) return -1;
  // Iterative-free recursion is fine here: height is only requested by
  // callers, not on the hot insert/delete path, and the tree's height is
  // bounded by O(log n) thanks to the scapegoat invariant (never close to
  // JS's recursion-depth limits for any realistic tree size).
  return 1 + Math.max(heightOf(node.left), heightOf(node.right));
}

function collectRange(node, lo, hi, out) {
  if (node === null) return;
  if (lo < node.key) collectRange(node.left, lo, hi, out);
  if (node.key >= lo && node.key <= hi) out.push([node.key, node.value]);
  if (hi > node.key) collectRange(node.right, lo, hi, out);
}

// Standard BST delete by key, with size bookkeeping maintained on every
// node along the path that survives (i.e. every ancestor of the deleted
// node, decremented by exactly one). Returns the new subtree root.
function deleteFromSubtree(node, key) {
  if (node === null) return null;
  if (key < node.key) {
    node.left = deleteFromSubtree(node.left, key);
    node.size -= 1;
    return node;
  }
  if (key > node.key) {
    node.right = deleteFromSubtree(node.right, key);
    node.size -= 1;
    return node;
  }
  // key === node.key: this is the node to remove.
  if (node.left === null) return node.right;
  if (node.right === null) return node.left;
  // Two children: replace this node's key/value with its in-order
  // successor (leftmost node of the right subtree), then delete that
  // successor from the right subtree.
  let successor = node.right;
  while (successor.left !== null) successor = successor.left;
  node.key = successor.key;
  node.value = successor.value;
  node.right = deleteFromSubtree(node.right, successor.key);
  node.size -= 1;
  return node;
}

module.exports = { ScapegoatTree };
