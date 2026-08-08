'use strict';

// A dependency-free, indexed (min-)pairing heap.
//
// "Indexed" here means every insert() returns an opaque Handle object that
// can later be used with decreaseKey()/delete() to mutate or remove that
// exact element in O(log n) amortized time, without needing to search the
// heap for it. Handles are private-class instances (Handle is never
// exported), so external code cannot forge one -- any object that isn't a
// genuine Handle created by *this* heap is rejected as "foreign."
//
// Classic two-pass pairing-heap merge (Fredman, Sedgewick, Sloan & Tarjan,
// 1986): each node keeps a `child` pointer (its leftmost child), a
// `sibling` pointer (its next sibling to the right), and a `prev` pointer
// that means "parent, if this node is the leftmost child of that parent"
// or "left sibling, otherwise." That dual-purpose `prev` link is what lets
// decreaseKey()/delete() cut an arbitrary node out of the tree in O(1),
// without maintaining a full parent pointer on every node.

const NOT_A_NUMBER_MESSAGE = 'priority must be a finite number';

class Node {
  constructor(priority, value, seq) {
    this.priority = priority;
    this.value = value;
    this.seq = seq; // insertion order, used to break priority ties
    this.child = null;
    this.sibling = null;
    this.prev = null; // parent (if leftmost child) or left sibling, else null for the root
    this.removed = false;
  }
}

// Not exported: only IndexedPairingHeap#insert can mint one of these, so a
// Handle instanceof check alone proves it was genuinely created by *some*
// IndexedPairingHeap. The extra `heap` field lets us additionally reject a
// real handle used against a *different* heap instance ("foreign handle").
class Handle {
  constructor(heap, node) {
    this.heap = heap;
    this.node = node;
  }
}

function isValidPriority(priority) {
  return typeof priority === 'number' && Number.isFinite(priority);
}

// True if node `a` should end up above (closer to the root than) node `b`
// when the two are merged -- i.e. `a` is "less than or equal to" `b`.
// Ties (equal priority) are broken by insertion order: the earlier-inserted
// node counts as smaller, so pop() drains equal-priority elements in FIFO
// order.
function hasPriorityOver(a, b) {
  if (a.priority !== b.priority) return a.priority < b.priority;
  return a.seq < b.seq;
}

// Meld two heap-ordered trees (each already detached: no sibling, no prev)
// into one heap-ordered tree, in O(1). Returns the new root.
function mergeTrees(a, b) {
  if (a === null) return b;
  if (b === null) return a;
  let winner, loser;
  if (hasPriorityOver(a, b)) {
    winner = a;
    loser = b;
  } else {
    winner = b;
    loser = a;
  }
  // Attach loser as winner's new leftmost child.
  loser.prev = winner;
  loser.sibling = winner.child;
  if (winner.child !== null) winner.child.prev = loser;
  winner.child = loser;
  winner.prev = null;
  winner.sibling = null;
  return winner;
}

// Two-pass pairing merge of a sibling list (the children of a node that was
// just removed). `first` is the leftmost child; every node reachable via
// `.sibling` from `first` is detached from its old parent/sibling context
// (the caller is responsible for that -- this function only follows and
// clears `.sibling`/`.prev` as it consumes the list). Returns the single
// merged root, or null if `first` was null.
function twoPassMerge(first) {
  if (first === null) return null;
  if (first.sibling === null) {
    first.prev = null;
    return first;
  }

  // First pass: pair up siblings left-to-right, merging each pair.
  const pairs = [];
  let cur = first;
  while (cur !== null) {
    const a = cur;
    const b = a.sibling;
    if (b !== null) {
      cur = b.sibling;
      a.sibling = null;
      a.prev = null;
      b.sibling = null;
      b.prev = null;
      pairs.push(mergeTrees(a, b));
    } else {
      a.sibling = null;
      a.prev = null;
      pairs.push(a);
      cur = null;
    }
  }

  // Second pass: fold the pairs together from right to left.
  let result = pairs[pairs.length - 1];
  for (let i = pairs.length - 2; i >= 0; i--) {
    result = mergeTrees(pairs[i], result);
  }
  return result;
}

// Cuts `node` (known non-root: `node.prev` is non-null) out of its current
// position in its parent's child list, in O(1). Leaves `node` detached
// (sibling = prev = null); does not touch `node.child`.
function cutFromSiblingList(node) {
  const p = node.prev;
  if (p.child === node) {
    // node was the leftmost child of parent p.
    p.child = node.sibling;
  } else {
    // node was some later sibling; p is its left sibling.
    p.sibling = node.sibling;
  }
  if (node.sibling !== null) node.sibling.prev = p;
  node.prev = null;
  node.sibling = null;
}

class IndexedPairingHeap {
  constructor() {
    this._root = null;
    this._size = 0;
    this._nextSeq = 0;
  }

  get size() {
    return this._size;
  }

  insert(priority, value) {
    if (!isValidPriority(priority)) throw new TypeError(NOT_A_NUMBER_MESSAGE);
    const node = new Node(priority, value, this._nextSeq++);
    this._root = mergeTrees(this._root, node);
    this._size++;
    return new Handle(this, node);
  }

  peek() {
    if (this._root === null) throw new RangeError('cannot peek() an empty heap');
    return { priority: this._root.priority, value: this._root.value };
  }

  pop() {
    if (this._root === null) throw new RangeError('cannot pop() an empty heap');
    const root = this._root;
    const result = { priority: root.priority, value: root.value };
    this._root = twoPassMerge(root.child);
    root.removed = true;
    root.child = null;
    this._size--;
    return result;
  }

  decreaseKey(handle, priority) {
    const node = this._validateHandle(handle);
    if (!isValidPriority(priority)) throw new TypeError(NOT_A_NUMBER_MESSAGE);
    if (priority > node.priority) {
      throw new RangeError('decreaseKey cannot increase a priority');
    }
    if (priority === node.priority) return; // no-op: nothing to restructure
    node.priority = priority;
    if (node === this._root) return; // already the root; still the min
    cutFromSiblingList(node);
    this._root = mergeTrees(this._root, node);
  }

  delete(handle) {
    const node = this._validateHandle(handle);
    const result = { priority: node.priority, value: node.value };
    if (node === this._root) {
      this._root = twoPassMerge(node.child);
    } else {
      cutFromSiblingList(node);
      const orphans = twoPassMerge(node.child);
      this._root = mergeTrees(this._root, orphans);
    }
    node.removed = true;
    node.child = null;
    this._size--;
    handle.node = null;
    return result;
  }

  _validateHandle(handle) {
    if (
      !(handle instanceof Handle) ||
      handle.heap !== this ||
      handle.node === null ||
      handle.node.removed
    ) {
      throw new RangeError('handle is stale, foreign, or invalid');
    }
    return handle.node;
  }
}

module.exports = { IndexedPairingHeap };
