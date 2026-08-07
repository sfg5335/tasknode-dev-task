'use strict';

/**
 * Dependency-free, single-file persistent (fully-versioned) segment tree
 * over a fixed-length array of finite numbers, supporting O(log n) point
 * updates that create a brand-new numbered version (leaving every existing
 * version's values completely unchanged) and O(log n) inclusive range-sum
 * queries against any version.
 *
 * new PersistentSegmentTree(initialArray)
 *   `initialArray` is an array of finite numbers (may be empty). It becomes
 *   version 0. Building version 0 is O(n); the array itself is never
 *   mutated or retained by reference (its values are copied into leaves).
 *
 * update(version, index, value)
 *   Creates and records a new version whose contents equal `version`'s
 *   contents except index `index` is now `value`. `version` may be *any*
 *   existing version number, not just the most recently created one --
 *   branching off an older version never disturbs it or any other version.
 *   Only the O(log n) nodes on the root-to-leaf path are freshly allocated;
 *   every other node is shared by reference with the base version (and,
 *   transitively, with whatever earlier versions that base version itself
 *   shares nodes with). Returns the newly created version's number.
 *
 * query(version, left, right)
 *   Returns the inclusive sum of elements `left..right` (0-indexed) as
 *   they existed in `version`. O(log n).
 *
 * length (getter)
 *   The fixed number of elements every version holds (set once, at
 *   construction, from `initialArray.length`).
 *
 * versionCount (getter)
 *   How many versions exist so far, counting version 0 (so this starts at
 *   1 and increases by exactly 1 per successful `update` call).
 *
 * All of `version`, `index`, `left`, and `right` must be integers; `value`
 * must be a finite number. Wrong-type arguments throw TypeError; correctly
 * typed but out-of-bounds arguments (an unknown version, an index outside
 * `[0, length)`, or `left > right`) throw RangeError.
 */

function isFiniteNumber(x) {
  return typeof x === 'number' && Number.isFinite(x);
}

function isInteger(x) {
  return typeof x === 'number' && Number.isInteger(x);
}

/** A tree node: either a leaf (`isLeaf: true`, no children) holding one
 * element's current value in `sum`, or an internal node whose `sum` is the
 * total of its two children -- always kept consistent with its children at
 * construction time, since nodes are immutable once created. */
function makeLeaf(value) {
  return { sum: value, left: null, right: null, isLeaf: true };
}

function makeInternal(leftNode, rightNode) {
  return { sum: leftNode.sum + rightNode.sum, left: leftNode, right: rightNode, isLeaf: false };
}

function build(values, l, r) {
  if (l === r) return makeLeaf(values[l]);
  const mid = (l + r) >> 1;
  return makeInternal(build(values, l, mid), build(values, mid + 1, r));
}

function updateNode(node, l, r, index, value) {
  if (l === r) return makeLeaf(value);
  const mid = (l + r) >> 1;
  if (index <= mid) return makeInternal(updateNode(node.left, l, mid, index, value), node.right);
  return makeInternal(node.left, updateNode(node.right, mid + 1, r, index, value));
}

function queryNode(node, l, r, ql, qr) {
  if (qr < l || r < ql) return 0;
  if (ql <= l && r <= qr) return node.sum;
  const mid = (l + r) >> 1;
  return queryNode(node.left, l, mid, ql, qr) + queryNode(node.right, mid + 1, r, ql, qr);
}

class PersistentSegmentTree {
  constructor(initialArray) {
    if (!Array.isArray(initialArray)) throw new TypeError('initialArray must be an array');
    for (let i = 0; i < initialArray.length; i++) {
      if (!isFiniteNumber(initialArray[i])) {
        throw new TypeError(`initialArray[${i}] must be a finite number`);
      }
    }

    this._length = initialArray.length;
    // `_length === 0` is represented by a null root; every public method
    // that would need to touch it is guaranteed to reject first (there is
    // no valid index or [left, right] range when the array is empty).
    this._versions = [this._length === 0 ? null : build(initialArray, 0, this._length - 1)];
  }

  get length() {
    return this._length;
  }

  get versionCount() {
    return this._versions.length;
  }

  _requireVersion(version) {
    if (!isInteger(version)) throw new TypeError('version must be an integer');
    if (version < 0 || version >= this._versions.length) {
      throw new RangeError(`version out of range: ${version}`);
    }
  }

  _requireIndex(index) {
    if (!isInteger(index)) throw new TypeError('index must be an integer');
    if (index < 0 || index >= this._length) {
      throw new RangeError(`index out of range: ${index}`);
    }
  }

  _requireRange(left, right) {
    if (!isInteger(left)) throw new TypeError('left must be an integer');
    if (!isInteger(right)) throw new TypeError('right must be an integer');
    if (left < 0 || left >= this._length) throw new RangeError(`left out of range: ${left}`);
    if (right < 0 || right >= this._length) throw new RangeError(`right out of range: ${right}`);
    if (left > right) throw new RangeError(`left (${left}) must be <= right (${right})`);
  }

  update(version, index, value) {
    this._requireVersion(version);
    this._requireIndex(index);
    if (!isFiniteNumber(value)) throw new TypeError('value must be a finite number');

    const baseRoot = this._versions[version];
    const newRoot = updateNode(baseRoot, 0, this._length - 1, index, value);
    this._versions.push(newRoot);
    return this._versions.length - 1;
  }

  query(version, left, right) {
    this._requireVersion(version);
    this._requireRange(left, right);

    return queryNode(this._versions[version], 0, this._length - 1, left, right);
  }
}

module.exports = { PersistentSegmentTree };
