'use strict';

/**
 * A stable, indexed, binary-min-heap priority queue keyed by string.
 *
 * "Stable" means: among entries with equal priority, the one that has been
 * logically present in the queue the longest (by insertion order) is
 * returned first. Updating an existing key's priority/value via upsert()
 * does NOT reset its insertion order -- only a brand-new insertion (a key
 * that has never been added, or one that was deleted and is now being
 * re-added) gets a fresh, later insertion order.
 *
 * "Indexed" means delete(key)/has(key)/upsert(key, ...) on an existing key
 * are O(log n), backed by an internal key -> heap-index map, rather than
 * requiring a linear scan of the heap.
 *
 * API:
 *   upsert(key, priority, value) -- insert a new key, or update an existing
 *     one's priority/value in place. Throws TypeError (without mutating the
 *     queue) if key is not a non-empty string or priority is not a finite
 *     number.
 *   peek() -- returns {key, priority, value} for the current minimum-
 *     priority entry, or undefined if the queue is empty. Does not remove it.
 *   pop() -- removes and returns {key, priority, value} for the current
 *     minimum-priority entry, or undefined if the queue is empty.
 *   delete(key) -- removes `key` if present, returning true/false. Throws
 *     TypeError (without mutating the queue) if key is not a non-empty
 *     string.
 *   has(key) -- returns true iff `key` is currently present. Never throws;
 *     any non-string or absent key simply returns false.
 *   size -- getter, current number of entries.
 */
class StablePriorityQueue {
  constructor() {
    /** @type {Array<{key: string, priority: number, value: *, seq: number}>} */
    this._heap = [];
    /** @type {Map<string, number>} key -> current index in _heap */
    this._indexOf = new Map();
    this._nextSeq = 0;
  }

  get size() {
    return this._heap.length;
  }

  has(key) {
    return typeof key === 'string' && this._indexOf.has(key);
  }

  upsert(key, priority, value) {
    if (typeof key !== 'string' || key.length === 0) {
      throw new TypeError('key must be a non-empty string');
    }
    if (typeof priority !== 'number' || !Number.isFinite(priority)) {
      throw new TypeError('priority must be a finite number');
    }

    const existingIndex = this._indexOf.get(key);
    if (existingIndex !== undefined) {
      const entry = this._heap[existingIndex];
      entry.priority = priority;
      entry.value = value;
      // seq is intentionally left unchanged: an update to an existing key
      // is not a new insertion, so its tie-break order does not move.
      this._repair(existingIndex);
      return;
    }

    const entry = { key, priority, value, seq: this._nextSeq++ };
    this._heap.push(entry);
    const index = this._heap.length - 1;
    this._indexOf.set(key, index);
    this._siftUp(index);
  }

  peek() {
    if (this._heap.length === 0) return undefined;
    const { key, priority, value } = this._heap[0];
    return { key, priority, value };
  }

  pop() {
    if (this._heap.length === 0) return undefined;
    const min = this._heap[0];
    const last = this._heap.pop();
    this._indexOf.delete(min.key);
    if (this._heap.length > 0) {
      this._heap[0] = last;
      this._indexOf.set(last.key, 0);
      this._siftDown(0);
    }
    return { key: min.key, priority: min.priority, value: min.value };
  }

  delete(key) {
    if (typeof key !== 'string' || key.length === 0) {
      throw new TypeError('key must be a non-empty string');
    }
    const index = this._indexOf.get(key);
    if (index === undefined) return false;

    const last = this._heap.pop();
    this._indexOf.delete(key);
    if (index < this._heap.length) {
      this._heap[index] = last;
      this._indexOf.set(last.key, index);
      this._repair(index);
    }
    return true;
  }

  // -- internal heap mechanics --------------------------------------

  _less(a, b) {
    if (a.priority !== b.priority) return a.priority < b.priority;
    return a.seq < b.seq;
  }

  _swap(i, j) {
    const heap = this._heap;
    const tmp = heap[i];
    heap[i] = heap[j];
    heap[j] = tmp;
    this._indexOf.set(heap[i].key, i);
    this._indexOf.set(heap[j].key, j);
  }

  _siftUp(i) {
    const heap = this._heap;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this._less(heap[i], heap[parent])) {
        this._swap(i, parent);
        i = parent;
      } else {
        break;
      }
    }
    return i;
  }

  _siftDown(i) {
    const heap = this._heap;
    const n = heap.length;
    for (;;) {
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      let smallest = i;
      if (left < n && this._less(heap[left], heap[smallest])) smallest = left;
      if (right < n && this._less(heap[right], heap[smallest])) smallest = right;
      if (smallest === i) break;
      this._swap(i, smallest);
      i = smallest;
    }
    return i;
  }

  /**
   * After the entry at index `i` has changed (a priority update, or a
   * swap-in of the former last element during delete()), restore the heap
   * property starting from `i`. Only one direction can actually be
   * necessary (the rest of the heap was already valid), so we try sifting
   * up first and only sift down if the element didn't move up.
   */
  _repair(i) {
    const before = i;
    const after = this._siftUp(i);
    if (after === before) {
      this._siftDown(i);
    }
  }
}

module.exports = { StablePriorityQueue };
