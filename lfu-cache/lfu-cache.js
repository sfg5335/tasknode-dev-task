'use strict';

/**
 * A dependency-free Least-Frequently-Used (LFU) cache with O(1) average-case
 * get()/put(), evicting the least-frequently-used entry when full and
 * breaking ties among equally-frequent entries by least-recent use.
 *
 * Design: each frequency has its own doubly linked list (most-recently-used
 * at the front, least-recently-used at the back). A key -> node Map gives
 * O(1) lookup, and a frequency -> list Map plus a running `minFreq` let both
 * "find the next eviction candidate" and "move a touched key to its new
 * frequency bucket" happen in O(1) without scanning all keys.
 *
 * API:
 *   new LFUCache(capacity) -- capacity must be a non-negative integer.
 *   get(key) -- returns the stored value, or null on a miss (including for
 *     a key of the wrong type -- get() never throws, it is a pure query).
 *     A hit counts as an access: the key's frequency increments and its
 *     recency is refreshed.
 *   put(key, value) -- key must be a non-empty string, value must not be
 *     null/undefined (throws TypeError otherwise, without mutating the
 *     cache). Updating an existing key's value also counts as an access
 *     (frequency increments, recency refreshes) but never grows size or
 *     duplicates the key. Inserting a new key when the cache is already at
 *     capacity evicts the least-recently-used key among those with the
 *     lowest frequency. With capacity 0, put() is a no-op (nothing is ever
 *     stored) and get() always misses.
 *   size -- getter, current number of entries.
 */

class DLLNode {
  constructor(key, value, freq) {
    this.key = key;
    this.value = value;
    this.freq = freq;
    this.prev = null;
    this.next = null;
  }
}

/** Doubly linked list with sentinel head/tail. Front = most-recently-used. */
class DoublyLinkedList {
  constructor() {
    this.head = new DLLNode(null, null, null);
    this.tail = new DLLNode(null, null, null);
    this.head.next = this.tail;
    this.tail.prev = this.head;
    this.length = 0;
  }

  addFront(node) {
    node.prev = this.head;
    node.next = this.head.next;
    this.head.next.prev = node;
    this.head.next = node;
    this.length++;
  }

  remove(node) {
    node.prev.next = node.next;
    node.next.prev = node.prev;
    node.prev = null;
    node.next = null;
    this.length--;
  }

  /** Removes and returns the least-recently-used node (the back of the list), or null if empty. */
  removeBack() {
    if (this.length === 0) return null;
    const node = this.tail.prev;
    this.remove(node);
    return node;
  }

  isEmpty() {
    return this.length === 0;
  }
}

class LFUCache {
  constructor(capacity) {
    if (!Number.isInteger(capacity) || capacity < 0) {
      throw new TypeError('capacity must be a non-negative integer');
    }
    this.capacity = capacity;
    /** @type {Map<string, DLLNode>} */
    this._keyMap = new Map();
    /** @type {Map<number, DoublyLinkedList>} */
    this._freqMap = new Map();
    this._minFreq = 0;
  }

  get size() {
    return this._keyMap.size;
  }

  get(key) {
    if (typeof key !== 'string' || key.length === 0) return null;
    const node = this._keyMap.get(key);
    if (!node) return null;
    this._touch(node);
    return node.value;
  }

  put(key, value) {
    if (typeof key !== 'string' || key.length === 0) {
      throw new TypeError('key must be a non-empty string');
    }
    if (value === null || value === undefined) {
      throw new TypeError('value must not be null or undefined');
    }
    if (this.capacity === 0) return; // nothing can ever be stored

    const existing = this._keyMap.get(key);
    if (existing) {
      existing.value = value;
      this._touch(existing);
      return;
    }

    if (this._keyMap.size >= this.capacity) {
      this._evict();
    }

    const node = new DLLNode(key, value, 1);
    this._keyMap.set(key, node);
    if (!this._freqMap.has(1)) this._freqMap.set(1, new DoublyLinkedList());
    this._freqMap.get(1).addFront(node);
    this._minFreq = 1;
  }

  // -- internals --------------------------------------------------

  /** Moves `node` to the front of the (freq + 1) bucket, updating minFreq as needed. */
  _touch(node) {
    const oldFreq = node.freq;
    const oldList = this._freqMap.get(oldFreq);
    oldList.remove(node);
    if (oldList.isEmpty()) {
      this._freqMap.delete(oldFreq);
      if (this._minFreq === oldFreq) this._minFreq = oldFreq + 1;
    }

    node.freq = oldFreq + 1;
    if (!this._freqMap.has(node.freq)) this._freqMap.set(node.freq, new DoublyLinkedList());
    this._freqMap.get(node.freq).addFront(node);
  }

  /** Evicts the least-recently-used entry among the lowest-frequency bucket. */
  _evict() {
    const minList = this._freqMap.get(this._minFreq);
    const evicted = minList.removeBack();
    this._keyMap.delete(evicted.key);
    if (minList.isEmpty()) this._freqMap.delete(this._minFreq);
  }
}

module.exports = { LFUCache };
