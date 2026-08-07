'use strict';

/**
 * Dependency-free, single-file, deterministic mutable-text `Rope`,
 * backed by an AVL-balanced binary tree of string leaves with cached
 * subtree lengths and heights -- never a single flat backing string --
 * in JavaScript, with an automated `node:test` suite.
 *
 * new Rope(initial = '')
 *   `initial` must be a string (the empty string by default); it
 *   becomes the rope's initial content, stored as a single leaf (or an
 *   empty tree, for `''`).
 *
 * Instance API:
 *   `length` -- a getter returning the current content length, in
 *   JavaScript UTF-16 code units (i.e. the same units `String#length`
 *   itself uses -- a surrogate-pair character such as an emoji counts
 *   as 2).
 *   `insert(index, text)` -- inserts `text` so that it starts at
 *   `index`; valid `index` range is `[0, length]` (inclusive of the
 *   very end). Returns `this`.
 *   `delete(start, end)` -- removes the half-open code-unit range
 *   `[start, end)`; `start === end` is a valid empty-range no-op.
 *   Returns `this`.
 *   `substring(start, end)` -- returns a plain JS string of the
 *   half-open code-unit range `[start, end)`, without mutating the
 *   rope.
 *   `charAt(index)` -- returns the single-code-unit string at `index`;
 *   valid range is `[0, length)` (there is no character *at* position
 *   `length` itself -- unlike `insert`'s range, which is inclusive of
 *   the end).
 *   `toString()` -- returns the full current content as a plain string
 *   (the one operation that's expected to flatten -- every other read/
 *   edit operation above works directly against the tree via cached
 *   subtree metadata, per this task's own spec, and never flattens).
 *
 *   Every input is validated: non-string `initial`/`text` throws
 *   `TypeError`; a non-safe-integer `index`/`start`/`end` throws
 *   `TypeError`; a correctly-typed `start > end` ("reversed"), or any
 *   index/start/end outside its operation's valid range, throws
 *   `RangeError`.
 *
 * checkInvariants(rope)
 *   An exported invariant checker (for tests, per this task's own
 *   spec): walks the rope's internal tree bottom-up, verifying every
 *   node's cached `length` and `height` are exactly correct, that the
 *   AVL balance property (`|leftHeight - rightHeight| <= 1`) holds at
 *   every node, and that the tree's overall height stays within a
 *   generous logarithmic bound for its length (catching a
 *   fundamentally broken/degenerate, effectively-linked-list tree).
 *   Returns `true` on success; throws a descriptive `Error` on any
 *   violation. Throws `TypeError` if not given a `Rope` instance.
 *
 * Algorithm: the classic rope-via-AVL-tree design. Each leaf node
 * holds a plain-string chunk directly; each internal node holds only
 * `left`/`right` children plus its own cached `length` (total code
 * units in its subtree) and `height` (AVL height). `insert`/`delete`
 * are both implemented via the two fundamental rope primitives,
 * `split(node, index)` (splits a subtree into two, at exactly `index`
 * code units) and `concat(left, right)` (joins two subtrees into one
 * balanced tree, rebalancing via standard AVL rotations along the
 * grafted spine) -- `insert` is `concat(concat(split(root,index)[0],
 * newLeaf), split(root,index)[1])`; `delete` is `concat(split(...)[0
 * of start], split(...)[1 of end])`. `substring`/`charAt` instead walk
 * the tree directly (using cached lengths to descend only into the
 * relevant subtree at each level) without ever splitting or
 * reconstructing anything, so they never mutate the rope.
 */

function isSafeInt(v) {
  return typeof v === 'number' && Number.isSafeInteger(v);
}

// ---- node helpers (a `null` node represents an empty subtree) ----

function nodeLength(node) {
  return node ? node.length : 0;
}

function nodeHeight(node) {
  return node ? node.height : 0;
}

function makeLeaf(str) {
  if (str.length === 0) return null;
  return { isLeaf: true, str, left: null, right: null, length: str.length, height: 1 };
}

function makeInternal(left, right) {
  return {
    isLeaf: false,
    str: null,
    left,
    right,
    length: nodeLength(left) + nodeLength(right),
    height: 1 + Math.max(nodeHeight(left), nodeHeight(right)),
  };
}

// Recomputes a mutated internal node's own cached length/height from
// its (possibly just-changed) children. Never called on leaves, whose
// cached fields are fixed forever at construction time.
function refresh(node) {
  node.length = nodeLength(node.left) + nodeLength(node.right);
  node.height = 1 + Math.max(nodeHeight(node.left), nodeHeight(node.right));
}

function balanceFactor(node) {
  return nodeHeight(node.left) - nodeHeight(node.right);
}

// Standard AVL rotations. These mutate the node objects in place
// (reassigning `.left`/`.right` and refreshing cached metadata) rather
// than allocating fresh copies -- safe here because a Rope instance
// never shares tree nodes with any other Rope, and every insert/delete
// unconditionally discards its old `_root` in favor of a brand-new one
// once the operation completes (see the README's Design notes).
function rotateLeft(node) {
  const newRoot = node.right;
  node.right = newRoot.left;
  newRoot.left = node;
  refresh(node);
  refresh(newRoot);
  return newRoot;
}

function rotateRight(node) {
  const newRoot = node.left;
  node.left = newRoot.right;
  newRoot.right = node;
  refresh(node);
  refresh(newRoot);
  return newRoot;
}

function rebalance(node) {
  refresh(node);
  const bf = balanceFactor(node);
  if (bf > 1) {
    if (balanceFactor(node.left) < 0) node.left = rotateLeft(node.left);
    return rotateRight(node);
  }
  if (bf < -1) {
    if (balanceFactor(node.right) > 0) node.right = rotateRight(node.right);
    return rotateLeft(node);
  }
  return node;
}

// Joins two subtrees (either may be `null`) into one AVL-balanced tree.
function concat(left, right) {
  if (!left) return right;
  if (!right) return left;
  const lh = nodeHeight(left);
  const rh = nodeHeight(right);
  if (Math.abs(lh - rh) <= 1) return makeInternal(left, right);
  if (lh > rh) {
    const newRight = concat(left.right, right);
    return rebalance(makeInternal(left.left, newRight));
  }
  const newLeft = concat(left, right.left);
  return rebalance(makeInternal(newLeft, right.right));
}

// Splits `node`'s subtree into two, at exactly `index` code units from
// its start: `[firstIndexCodeUnits, remainder]`.
function split(node, index) {
  if (!node) return [null, null];
  if (node.isLeaf) return [makeLeaf(node.str.slice(0, index)), makeLeaf(node.str.slice(index))];
  const leftLen = nodeLength(node.left);
  if (index <= leftLen) {
    const [a, b] = split(node.left, index);
    return [a, concat(b, node.right)];
  }
  const [a, b] = split(node.right, index - leftLen);
  return [concat(node.left, a), b];
}

function charAtNode(node, index) {
  if (node.isLeaf) return node.str[index];
  const leftLen = nodeLength(node.left);
  if (index < leftLen) return charAtNode(node.left, index);
  return charAtNode(node.right, index - leftLen);
}

function collectRange(node, start, end) {
  if (!node || start >= end) return '';
  if (node.isLeaf) return node.str.slice(start, end);
  const leftLen = nodeLength(node.left);
  let out = '';
  if (start < leftLen) out += collectRange(node.left, start, Math.min(end, leftLen));
  if (end > leftLen) out += collectRange(node.right, Math.max(start, leftLen) - leftLen, end - leftLen);
  return out;
}

function collectAll(node, parts) {
  if (!node) return;
  if (node.isLeaf) {
    parts.push(node.str);
    return;
  }
  collectAll(node.left, parts);
  collectAll(node.right, parts);
}

class Rope {
  constructor(initial = '') {
    if (typeof initial !== 'string') throw new TypeError('initial must be a string');
    this._root = makeLeaf(initial);
  }

  get length() {
    return nodeLength(this._root);
  }

  insert(index, text) {
    if (typeof text !== 'string') throw new TypeError('text must be a string');
    if (!isSafeInt(index)) throw new TypeError('index must be a safe integer');
    if (index < 0 || index > this.length) throw new RangeError(`index out of range [0, ${this.length}]: ${index}`);
    if (text.length === 0) return this;
    const [left, right] = split(this._root, index);
    this._root = concat(concat(left, makeLeaf(text)), right);
    return this;
  }

  delete(start, end) {
    if (!isSafeInt(start)) throw new TypeError('start must be a safe integer');
    if (!isSafeInt(end)) throw new TypeError('end must be a safe integer');
    if (start > end) throw new RangeError(`start (${start}) must not be greater than end (${end})`);
    if (start < 0 || end > this.length) {
      throw new RangeError(`[start, end) out of range [0, ${this.length}]: [${start}, ${end})`);
    }
    if (start === end) return this;
    const [left, mid] = split(this._root, start);
    const [, right] = split(mid, end - start);
    this._root = concat(left, right);
    return this;
  }

  substring(start, end) {
    if (!isSafeInt(start)) throw new TypeError('start must be a safe integer');
    if (!isSafeInt(end)) throw new TypeError('end must be a safe integer');
    if (start > end) throw new RangeError(`start (${start}) must not be greater than end (${end})`);
    if (start < 0 || end > this.length) {
      throw new RangeError(`[start, end) out of range [0, ${this.length}]: [${start}, ${end})`);
    }
    return collectRange(this._root, start, end);
  }

  charAt(index) {
    if (!isSafeInt(index)) throw new TypeError('index must be a safe integer');
    if (index < 0 || index >= this.length) {
      throw new RangeError(`index out of range [0, ${this.length}): ${index}`);
    }
    return charAtNode(this._root, index);
  }

  toString() {
    const parts = [];
    collectAll(this._root, parts);
    return parts.join('');
  }
}

function checkInvariants(rope) {
  if (!(rope instanceof Rope)) throw new TypeError('checkInvariants expects a Rope instance');

  function walk(node) {
    if (!node) return { length: 0, height: 0 };
    if (node.isLeaf) {
      if (typeof node.str !== 'string' || node.str.length === 0) {
        throw new Error('leaf must hold a non-empty string');
      }
      if (node.left !== null || node.right !== null) throw new Error('leaf must have no children');
      if (node.length !== node.str.length) throw new Error('leaf length cache mismatch');
      if (node.height !== 1) throw new Error('leaf height must be exactly 1');
      return { length: node.length, height: node.height };
    }
    const l = walk(node.left);
    const r = walk(node.right);
    const expectedLength = l.length + r.length;
    const expectedHeight = 1 + Math.max(l.height, r.height);
    if (node.length !== expectedLength) {
      throw new Error(`length cache mismatch: got ${node.length}, expected ${expectedLength}`);
    }
    if (node.height !== expectedHeight) {
      throw new Error(`height cache mismatch: got ${node.height}, expected ${expectedHeight}`);
    }
    const bf = l.height - r.height;
    if (Math.abs(bf) > 1) throw new Error(`AVL balance violated: balance factor ${bf}`);
    return { length: node.length, height: node.height };
  }

  const result = walk(rope._root);
  if (result.length !== rope.length) throw new Error("computed length doesn't match rope.length");

  // Generous logarithmic bound (the true AVL worst case is roughly
  // 1.44 * log2(n + 2)) -- this is a smoke test against a genuinely
  // degenerate (effectively unbalanced/linked-list) tree, not a tight
  // mathematical proof check.
  const n = Math.max(rope.length, 1);
  const maxAllowedHeight = Math.ceil(2 * Math.log2(n + 2)) + 5;
  if (result.height > maxAllowedHeight) {
    throw new Error(`tree height ${result.height} exceeds logarithmic bound ${maxAllowedHeight} for length ${rope.length}`);
  }

  return true;
}

module.exports = { Rope, checkInvariants };
