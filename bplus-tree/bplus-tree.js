'use strict';

// Deterministic, dependency-free in-memory B+ tree over finite numeric keys.
//
// Structural summary: leaves hold the actual (key, value) pairs in ascending
// order and are linked left-to-right via `next`, so an inclusive range scan
// walks the leaf chain directly rather than re-sorting or re-scanning every
// entry. Internal nodes hold only routing separator keys plus child
// pointers (children.length === keys.length + 1); for an internal node with
// keys [k0, k1, ..., k_{m-1}] and children [c0, c1, ..., c_m]:
//   c0            holds all keys <  k0
//   c_i (0<i<m)   holds all keys in [k_{i-1}, k_i)
//   c_m           holds all keys >= k_{m-1}
//
// `maxKeys` bounds how many keys a single node (leaf or internal) may hold
// before it must split. `minKeys = floor(maxKeys / 2)` is the minimum any
// non-root node may hold after an operation completes; this specific
// formula (floor, not ceil) is chosen deliberately (see README) because it
// is the only formula that makes both split halves >= minKeys immediately
// after every split, for every maxKeys >= 2 -- both odd and even.

class LeafNode {
  constructor() {
    this.leaf = true;
    this.keys = [];
    this.values = [];
    this.next = null; // next leaf in ascending key order, or null for the last leaf
  }
}

class InternalNode {
  constructor() {
    this.leaf = false;
    this.keys = []; // separator keys, length === children.length - 1
    this.children = [];
  }
}

// First index i such that keys[i] >= target (i.e. keys.length if none).
function lowerBound(keys, target) {
  let lo = 0;
  let hi = keys.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (keys[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// First index i such that keys[i] > target (i.e. keys.length if none).
// Used to pick which child to descend into: child index === upperBound.
function upperBound(keys, target) {
  let lo = 0;
  let hi = keys.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (keys[mid] <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function checkKey(key) {
  if (typeof key !== 'number' || !Number.isFinite(key)) {
    throw new TypeError('key must be a finite number');
  }
}

class BPlusTree {
  constructor(maxKeys = 4) {
    if (typeof maxKeys !== 'number' || !Number.isInteger(maxKeys)) {
      throw new TypeError('maxKeys must be an integer');
    }
    if (maxKeys < 2) {
      throw new RangeError('maxKeys must be >= 2');
    }
    this._maxKeys = maxKeys;
    this._minKeys = Math.floor(maxKeys / 2);
    this._root = new LeafNode();
    this._size = 0;
  }

  get size() {
    return this._size;
  }

  // ---- lookup helpers -----------------------------------------------

  _findLeaf(key) {
    let node = this._root;
    while (!node.leaf) {
      const i = upperBound(node.keys, key);
      node = node.children[i];
    }
    return node;
  }

  get(key) {
    checkKey(key);
    const leaf = this._findLeaf(key);
    const i = lowerBound(leaf.keys, key);
    return i < leaf.keys.length && leaf.keys[i] === key ? leaf.values[i] : undefined;
  }

  has(key) {
    checkKey(key);
    const leaf = this._findLeaf(key);
    const i = lowerBound(leaf.keys, key);
    return i < leaf.keys.length && leaf.keys[i] === key;
  }

  // ---- insertion ------------------------------------------------------

  set(key, value) {
    checkKey(key);
    const result = this._insert(this._root, key, value);
    if (result) {
      const newRoot = new InternalNode();
      newRoot.keys = [result.sepKey];
      newRoot.children = [this._root, result.rightNode];
      this._root = newRoot;
    }
    return this;
  }

  // Returns null if no split happened at this node, otherwise
  // { sepKey, rightNode } describing the split the caller must absorb.
  _insert(node, key, value) {
    if (node.leaf) {
      const i = lowerBound(node.keys, key);
      if (i < node.keys.length && node.keys[i] === key) {
        node.values[i] = value; // upsert, size unchanged
        return null;
      }
      node.keys.splice(i, 0, key);
      node.values.splice(i, 0, value);
      this._size++;
      return node.keys.length > this._maxKeys ? this._splitLeaf(node) : null;
    }

    const i = upperBound(node.keys, key);
    const result = this._insert(node.children[i], key, value);
    if (!result) return null;
    node.keys.splice(i, 0, result.sepKey);
    node.children.splice(i + 1, 0, result.rightNode);
    return node.keys.length > this._maxKeys ? this._splitInternal(node) : null;
  }

  // Leaf split: every key is retained across the two leaves (a leaf never
  // discards data); the separator promoted to the parent is a COPY of the
  // right leaf's first key, which also stays behind in the right leaf.
  _splitLeaf(node) {
    const leftCount = Math.ceil(node.keys.length / 2); // keys.length === maxKeys+1 here
    const right = new LeafNode();
    right.keys = node.keys.slice(leftCount);
    right.values = node.values.slice(leftCount);
    right.next = node.next;
    node.keys.length = leftCount;
    node.values.length = leftCount;
    node.next = right;
    return { sepKey: right.keys[0], rightNode: right };
  }

  // Internal split: the middle key is promoted and REMOVED from both
  // resulting nodes (unlike a leaf split, an internal separator is never
  // duplicated). leftCount = ceil(maxKeys/2) is chosen so that, combined
  // with minKeys = floor(maxKeys/2), both halves are guaranteed >= minKeys
  // immediately after the split for every maxKeys >= 2.
  _splitInternal(node) {
    const leftCount = Math.ceil(this._maxKeys / 2);
    const sepKey = node.keys[leftCount];
    const right = new InternalNode();
    right.keys = node.keys.slice(leftCount + 1);
    right.children = node.children.slice(leftCount + 1);
    node.keys.length = leftCount;
    node.children.length = leftCount + 1;
    return { sepKey, rightNode: right };
  }

  // ---- deletion ---------------------------------------------------------

  delete(key) {
    checkKey(key);
    const found = this._delete(this._root, key);
    if (found && !this._root.leaf && this._root.keys.length === 0) {
      // The root's only remaining child becomes the new root; height -1.
      this._root = this._root.children[0];
    }
    return found;
  }

  _delete(node, key) {
    if (node.leaf) {
      const i = lowerBound(node.keys, key);
      if (i >= node.keys.length || node.keys[i] !== key) return false;
      node.keys.splice(i, 1);
      node.values.splice(i, 1);
      this._size--;
      return true;
    }

    const i = upperBound(node.keys, key);
    const child = node.children[i];
    const found = this._delete(child, key);
    if (found && child.keys.length < this._minKeys) {
      this._rebalance(node, i);
    }
    return found;
  }

  // Fixes an underflowing child at parent.children[i] by borrowing from a
  // sibling that has spare keys, or merging with a sibling otherwise.
  // Left sibling is preferred when it is eligible, purely as a documented
  // tie-break -- both directions are real, independently reachable code
  // paths depending on which sibling (if any) has keys to spare.
  _rebalance(parent, i) {
    const leftSib = i > 0 ? parent.children[i - 1] : null;
    const rightSib = i < parent.children.length - 1 ? parent.children[i + 1] : null;

    if (leftSib && leftSib.keys.length > this._minKeys) {
      this._borrowFromLeft(parent, i);
    } else if (rightSib && rightSib.keys.length > this._minKeys) {
      this._borrowFromRight(parent, i);
    } else if (leftSib) {
      this._mergeChildren(parent, i - 1); // merge children[i] into children[i-1]
    } else {
      this._mergeChildren(parent, i); // merge children[i+1] into children[i]
    }
  }

  _borrowFromLeft(parent, i) {
    const child = parent.children[i];
    const leftSib = parent.children[i - 1];
    if (child.leaf) {
      child.keys.unshift(leftSib.keys.pop());
      child.values.unshift(leftSib.values.pop());
      parent.keys[i - 1] = child.keys[0];
    } else {
      const borrowedChild = leftSib.children.pop();
      const risingKey = leftSib.keys.pop();
      child.keys.unshift(parent.keys[i - 1]);
      child.children.unshift(borrowedChild);
      parent.keys[i - 1] = risingKey;
    }
  }

  _borrowFromRight(parent, i) {
    const child = parent.children[i];
    const rightSib = parent.children[i + 1];
    if (child.leaf) {
      child.keys.push(rightSib.keys.shift());
      child.values.push(rightSib.values.shift());
      parent.keys[i] = rightSib.keys[0];
    } else {
      const borrowedChild = rightSib.children.shift();
      const risingKey = rightSib.keys.shift();
      child.keys.push(parent.keys[i]);
      child.children.push(borrowedChild);
      parent.keys[i] = risingKey;
    }
  }

  // Merges parent.children[idx + 1] into parent.children[idx], then removes
  // the now-redundant separator parent.keys[idx] and the emptied child.
  _mergeChildren(parent, idx) {
    const left = parent.children[idx];
    const right = parent.children[idx + 1];
    if (left.leaf) {
      left.keys.push(...right.keys);
      left.values.push(...right.values);
      left.next = right.next;
    } else {
      left.keys.push(parent.keys[idx], ...right.keys);
      left.children.push(...right.children);
    }
    parent.keys.splice(idx, 1);
    parent.children.splice(idx + 1, 1);
  }

  // ---- range scan -------------------------------------------------------

  // Inclusive range scan: returns [key, value] pairs for every stored key
  // k with lo <= k <= hi, in ascending order, by walking the linked leaf
  // chain starting from the leaf that would contain `lo` -- never sorts or
  // rescans the whole tree, and never touches internal nodes past the
  // initial descent.
  range(lo, hi) {
    checkKey(lo);
    checkKey(hi);
    const result = [];
    if (lo > hi) return result;
    let leaf = this._findLeaf(lo);
    let i = lowerBound(leaf.keys, lo);
    while (leaf) {
      while (i < leaf.keys.length) {
        const k = leaf.keys[i];
        if (k > hi) return result;
        result.push([k, leaf.values[i]]);
        i++;
      }
      leaf = leaf.next;
      i = 0;
    }
    return result;
  }
}

module.exports = { BPlusTree };
