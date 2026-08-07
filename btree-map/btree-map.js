'use strict';

/**
 * Dependency-free deterministic 2-3-4 B-tree map (minimum degree t = 2)
 * mapping finite numeric keys to arbitrary values, kept in ascending order.
 *
 * Every non-root node holds between t-1 = 1 and 2t-1 = 3 keys; every
 * internal node has exactly keys.length + 1 children; every leaf is at
 * the same depth. Insertion proactively splits full nodes on the way
 * down (so a parent never needs to split a full child mid-recursion);
 * deletion proactively borrows-from-sibling or merges-with-sibling on
 * the way down (so every node it recurses into already has >= t keys),
 * following the standard CLRS single-pass top-down algorithms.
 *
 * Keys are compared with plain `<`/`>`/`===`, so `-0` and `0` compare
 * and hash as the same key (as they do for `===` and for `Map`'s own
 * SameValueZero key semantics) without any special-casing.
 *
 * Node shape: { leaf: boolean, keys: number[], values: any[], children: Node[] }
 * (children is always [] for a leaf, and always keys.length + 1 long
 * for an internal node.)
 */
class BTreeMap {
  constructor() {
    this.t = 2; // minimum degree
    this.maxKeys = 2 * this.t - 1; // 3
    this.root = { leaf: true, keys: [], values: [], children: [] };
    this._size = 0;
  }

  static _requireKey(key) {
    if (typeof key !== 'number' || !Number.isFinite(key)) {
      throw new TypeError('key must be a finite number');
    }
  }

  /** Internal: find { node, index } for `key`, or null if absent. Read-only. */
  _locate(key) {
    let node = this.root;
    for (;;) {
      let i = 0;
      while (i < node.keys.length && key > node.keys[i]) i++;
      if (i < node.keys.length && key === node.keys[i]) return { node, index: i };
      if (node.leaf) return null;
      node = node.children[i];
    }
  }

  get(key) {
    BTreeMap._requireKey(key);
    const loc = this._locate(key);
    return loc ? loc.node.values[loc.index] : undefined;
  }

  has(key) {
    BTreeMap._requireKey(key);
    return this._locate(key) !== null;
  }

  /** Splits the full child parent.children[i] (2t-1 keys) into two (t-1)-key
   *  nodes, promoting its median key/value up into `parent` at index i. */
  _splitChild(parent, i) {
    const t = this.t;
    const fullChild = parent.children[i];
    const midKey = fullChild.keys[t - 1];
    const midVal = fullChild.values[t - 1];

    const rightKeys = fullChild.keys.splice(t); // t-1 keys move right
    const rightValues = fullChild.values.splice(t);
    const rightChildren = fullChild.leaf ? [] : fullChild.children.splice(t); // t children move right

    fullChild.keys.splice(t - 1); // drop the (now-last) median from the left node
    fullChild.values.splice(t - 1);

    const newChild = { leaf: fullChild.leaf, keys: rightKeys, values: rightValues, children: rightChildren };

    parent.keys.splice(i, 0, midKey);
    parent.values.splice(i, 0, midVal);
    parent.children.splice(i + 1, 0, newChild);
  }

  /** Inserts a genuinely-new (key, value) into a subtree rooted at a node
   *  that is guaranteed not to be full. */
  _insertNonFull(node, key, value) {
    let i = 0;
    while (i < node.keys.length && key > node.keys[i]) i++;

    if (node.leaf) {
      node.keys.splice(i, 0, key);
      node.values.splice(i, 0, value);
      return;
    }
    if (node.children[i].keys.length === this.maxKeys) {
      this._splitChild(node, i);
      if (key > node.keys[i]) i++;
    }
    this._insertNonFull(node.children[i], key, value);
  }

  /** Inserts or overwrites `key` with `value`. Returns `this` for chaining. */
  set(key, value) {
    BTreeMap._requireKey(key);
    const loc = this._locate(key);
    if (loc) {
      loc.node.values[loc.index] = value;
      return this;
    }
    if (this.root.keys.length === this.maxKeys) {
      const newRoot = { leaf: false, keys: [], values: [], children: [this.root] };
      this._splitChild(newRoot, 0);
      this.root = newRoot;
    }
    this._insertNonFull(this.root, key, value);
    this._size++;
    return this;
  }

  /** Ensures node.children[idx] has at least t keys before we descend into
   *  it, by borrowing from a sibling or merging with one. Returns the
   *  (possibly shifted, if a left-merge happened) index to descend into. */
  _ensureChildHasMinKeys(node, idx) {
    const t = this.t;
    const child = node.children[idx];
    if (child.keys.length >= t) return idx;

    const leftSibling = idx > 0 ? node.children[idx - 1] : null;
    const rightSibling = idx < node.children.length - 1 ? node.children[idx + 1] : null;

    if (leftSibling && leftSibling.keys.length >= t) {
      // Rotate right: separator moves down into child, sibling's max moves up.
      child.keys.unshift(node.keys[idx - 1]);
      child.values.unshift(node.values[idx - 1]);
      if (!child.leaf) child.children.unshift(leftSibling.children.pop());
      node.keys[idx - 1] = leftSibling.keys.pop();
      node.values[idx - 1] = leftSibling.values.pop();
      return idx;
    }
    if (rightSibling && rightSibling.keys.length >= t) {
      // Rotate left: separator moves down into child, sibling's min moves up.
      child.keys.push(node.keys[idx]);
      child.values.push(node.values[idx]);
      if (!child.leaf) child.children.push(rightSibling.children.shift());
      node.keys[idx] = rightSibling.keys.shift();
      node.values[idx] = rightSibling.values.shift();
      return idx;
    }
    if (leftSibling) {
      // Merge child into left sibling (pull the separator down between them).
      leftSibling.keys.push(node.keys[idx - 1]);
      leftSibling.values.push(node.values[idx - 1]);
      leftSibling.keys.push(...child.keys);
      leftSibling.values.push(...child.values);
      if (!child.leaf) leftSibling.children.push(...child.children);
      node.keys.splice(idx - 1, 1);
      node.values.splice(idx - 1, 1);
      node.children.splice(idx, 1);
      return idx - 1;
    }
    // Merge right sibling into child.
    child.keys.push(node.keys[idx]);
    child.values.push(node.values[idx]);
    child.keys.push(...rightSibling.keys);
    child.values.push(...rightSibling.values);
    if (!child.leaf) child.children.push(...rightSibling.children);
    node.keys.splice(idx, 1);
    node.values.splice(idx, 1);
    node.children.splice(idx + 1, 1);
    return idx;
  }

  /** Deletes `key` from the subtree rooted at `node`, which must already be
   *  known to contain it. `node` (if not the tree root) is guaranteed to
   *  already have at least t keys when this is called. */
  _deleteFromNode(node, key) {
    let idx = 0;
    while (idx < node.keys.length && key > node.keys[idx]) idx++;

    if (idx < node.keys.length && key === node.keys[idx]) {
      if (node.leaf) {
        node.keys.splice(idx, 1);
        node.values.splice(idx, 1);
        return;
      }
      const leftChild = node.children[idx];
      const rightChild = node.children[idx + 1];

      if (leftChild.keys.length >= this.t) {
        let predNode = leftChild;
        while (!predNode.leaf) predNode = predNode.children[predNode.children.length - 1];
        const predKey = predNode.keys[predNode.keys.length - 1];
        const predVal = predNode.values[predNode.values.length - 1];
        node.keys[idx] = predKey;
        node.values[idx] = predVal;
        this._deleteFromNode(leftChild, predKey);
      } else if (rightChild.keys.length >= this.t) {
        let succNode = rightChild;
        while (!succNode.leaf) succNode = succNode.children[0];
        const succKey = succNode.keys[0];
        const succVal = succNode.values[0];
        node.keys[idx] = succKey;
        node.values[idx] = succVal;
        this._deleteFromNode(rightChild, succKey);
      } else {
        // Both children are minimal: merge them (with the separator) into one.
        leftChild.keys.push(node.keys[idx]);
        leftChild.values.push(node.values[idx]);
        leftChild.keys.push(...rightChild.keys);
        leftChild.values.push(...rightChild.values);
        if (!leftChild.leaf) leftChild.children.push(...rightChild.children);
        node.keys.splice(idx, 1);
        node.values.splice(idx, 1);
        node.children.splice(idx + 1, 1);
        this._deleteFromNode(leftChild, key);
      }
      return;
    }

    // key is not in this node; it must be in a child subtree.
    let childIdx = idx; // idx already advanced past every key < target key
    if (node.children[childIdx].keys.length < this.t) {
      childIdx = this._ensureChildHasMinKeys(node, childIdx);
    }
    this._deleteFromNode(node.children[childIdx], key);
  }

  /** Removes `key` if present. Returns whether it was present. */
  delete(key) {
    BTreeMap._requireKey(key);
    if (!this._locate(key)) return false;
    this._deleteFromNode(this.root, key);
    if (!this.root.leaf && this.root.keys.length === 0) {
      this.root = this.root.children[0]; // root contraction
    }
    this._size--;
    return true;
  }

  /** Returns every [key, value] pair in ascending key order. */
  entries() {
    const result = [];
    const visit = (node) => {
      if (node.leaf) {
        for (let i = 0; i < node.keys.length; i++) result.push([node.keys[i], node.values[i]]);
        return;
      }
      for (let i = 0; i < node.keys.length; i++) {
        visit(node.children[i]);
        result.push([node.keys[i], node.values[i]]);
      }
      visit(node.children[node.keys.length]);
    };
    visit(this.root);
    return result;
  }

  /** Number of keys currently stored. */
  get size() {
    return this._size;
  }
}

module.exports = { BTreeMap };
