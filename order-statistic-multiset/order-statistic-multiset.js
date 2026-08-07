'use strict';

/**
 * AVL-balanced order-statistic multiset of finite numbers.
 *
 * Each tree node stores a distinct value plus a duplicate count (`dup`)
 * for that value, so repeated values don't create separate nodes -- the
 * tree has at most one node per distinct value, with `dup` tracking how
 * many times that value has been added. Every node also tracks its own
 * height (for AVL balancing) and `size` (total element count, including
 * duplicates, of the subtree rooted at that node) so that rank(value)
 * and select(index) can run in O(log n).
 *
 * API:
 *   add(value)      -- insert one occurrence of value (TypeError if not a finite number).
 *   delete(value)    -- remove one occurrence of value; returns true if
 *                        removed, false if value wasn't present (TypeError if not finite).
 *   count(value)     -- number of occurrences of value currently present (0 if absent).
 *   rank(value)      -- number of elements strictly less than value.
 *   select(index)    -- the value at zero-based sorted position `index`
 *                        (duplicates occupy consecutive indices). Throws
 *                        RangeError for a non-integer or out-of-bounds index.
 *   size             -- getter, total element count including duplicates.
 */

class Node {
  constructor(value) {
    this.value = value;
    this.dup = 1;
    this.height = 1;
    this.size = 1;
    this.left = null;
    this.right = null;
  }
}

function nodeHeight(node) {
  return node === null ? 0 : node.height;
}

function subtreeSize(node) {
  return node === null ? 0 : node.size;
}

function refresh(node) {
  node.height = 1 + Math.max(nodeHeight(node.left), nodeHeight(node.right));
  node.size = node.dup + subtreeSize(node.left) + subtreeSize(node.right);
}

function balanceFactor(node) {
  return nodeHeight(node.left) - nodeHeight(node.right);
}

function rotateRight(y) {
  const x = y.left;
  const t2 = x.right;
  x.right = y;
  y.left = t2;
  refresh(y);
  refresh(x);
  return x;
}

function rotateLeft(x) {
  const y = x.right;
  const t2 = y.left;
  y.left = x;
  x.right = t2;
  refresh(x);
  refresh(y);
  return y;
}

function rebalance(node) {
  const bf = balanceFactor(node);
  if (bf > 1) {
    if (balanceFactor(node.left) < 0) {
      node.left = rotateLeft(node.left); // LR case
    }
    return rotateRight(node); // LL case (or LR after the fix-up above)
  }
  if (bf < -1) {
    if (balanceFactor(node.right) > 0) {
      node.right = rotateRight(node.right); // RL case
    }
    return rotateLeft(node); // RR case (or RL after the fix-up above)
  }
  return node;
}

function findMin(node) {
  while (node.left !== null) node = node.left;
  return node;
}

function deleteMin(node) {
  if (node.left === null) return node.right;
  node.left = deleteMin(node.left);
  refresh(node);
  return rebalance(node);
}

class OrderStatisticMultiset {
  constructor() {
    this._root = null;
  }

  static _validateValue(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new TypeError('value must be a finite number');
    }
  }

  add(value) {
    OrderStatisticMultiset._validateValue(value);
    this._root = OrderStatisticMultiset._insert(this._root, value);
  }

  static _insert(node, value) {
    if (node === null) return new Node(value);
    if (value === node.value) {
      node.dup++;
    } else if (value < node.value) {
      node.left = OrderStatisticMultiset._insert(node.left, value);
    } else {
      node.right = OrderStatisticMultiset._insert(node.right, value);
    }
    refresh(node);
    return rebalance(node);
  }

  delete(value) {
    OrderStatisticMultiset._validateValue(value);
    let found = false;
    const helper = (node) => {
      if (node === null) return null;
      if (value < node.value) {
        node.left = helper(node.left);
      } else if (value > node.value) {
        node.right = helper(node.right);
      } else {
        found = true;
        if (node.dup > 1) {
          node.dup--;
        } else {
          if (node.left === null) return node.right;
          if (node.right === null) return node.left;
          const succ = findMin(node.right);
          node.value = succ.value;
          node.dup = succ.dup;
          node.right = deleteMin(node.right);
        }
      }
      refresh(node);
      return rebalance(node);
    };
    this._root = helper(this._root);
    return found;
  }

  count(value) {
    OrderStatisticMultiset._validateValue(value);
    let node = this._root;
    while (node !== null) {
      if (value === node.value) return node.dup;
      node = value < node.value ? node.left : node.right;
    }
    return 0;
  }

  rank(value) {
    OrderStatisticMultiset._validateValue(value);
    let node = this._root;
    let r = 0;
    while (node !== null) {
      if (value <= node.value) {
        node = node.left;
      } else {
        r += subtreeSize(node.left) + node.dup;
        node = node.right;
      }
    }
    return r;
  }

  select(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.size) {
      throw new RangeError(`index out of range: ${index}`);
    }
    let node = this._root;
    let idx = index;
    for (;;) {
      const leftSize = subtreeSize(node.left);
      if (idx < leftSize) {
        node = node.left;
      } else if (idx < leftSize + node.dup) {
        return node.value;
      } else {
        idx -= leftSize + node.dup;
        node = node.right;
      }
    }
  }

  get size() {
    return subtreeSize(this._root);
  }
}

module.exports = { OrderStatisticMultiset };
