'use strict';

/**
 * Dependency-free, single-file, deterministic Robin Hood open-addressing
 * hash map (`RobinHoodMap`) for string keys, in JavaScript, with an
 * automated `node:test` suite.
 *
 * new RobinHoodMap()
 *   Constructs an empty map with a small initial power-of-two capacity
 *   (`INITIAL_CAPACITY`, currently 8).
 *
 * Instance API:
 *   `size` -- a getter returning the number of stored keys (never the
 *   table's current capacity).
 *   `set(key, value)` -- inserts or updates `key`. Updating an
 *   already-present key changes only its stored value, in place --
 *   table size, capacity, and every entry's probe distance are
 *   unaffected. Inserting a genuinely new key may trigger Robin Hood
 *   probe-distance-swapping displacement of existing entries, and may
 *   trigger a capacity-doubling growth/rehash first if the configured
 *   load-factor threshold would otherwise be exceeded. Returns `this`.
 *   `get(key)` -- returns the stored value, or `undefined` if `key`
 *   isn't present.
 *   `has(key)` -- returns whether `key` is present.
 *   `delete(key)` -- removes `key` if present (using backward-shift
 *   deletion -- no tombstones are ever left behind) and returns
 *   `true`; returns `false` if `key` wasn't present.
 *   `clear()` -- removes every entry and resets the table back to
 *   `INITIAL_CAPACITY`. Returns `this`.
 *
 *   Every key-accepting method (`set`, `get`, `has`, `delete`) requires
 *   a string key -- a non-string key (including `null`/`undefined`,
 *   numbers, objects, symbols) throws `TypeError`. The empty string
 *   `''` is a perfectly ordinary, valid key.
 *
 * Algorithm: classic Robin Hood open-addressing hashing (Celis 1986)
 * with linear probing, backward-shift deletion, and power-of-two
 * capacity growth:
 *
 *   - Hashing: keys are hashed with the standard 32-bit FNV-1a
 *     algorithm (`fnv1aHash`). FNV-1a is *defined* to operate modulo
 *     2^32 -- its per-character `XOR` then `multiply-by-the-FNV-prime`
 *     step is specified in terms of 32-bit unsigned wraparound
 *     arithmetic, so using `Math.imul` (a correct, non-precision-losing
 *     32-bit multiply) and a final `>>> 0` (to force an unsigned 32-bit
 *     result) here is the *correct*, spec-mandated implementation of
 *     the algorithm -- not the kind of accidental-wraparound bug that
 *     bitwise operators can cause elsewhere in this collection (e.g.
 *     this task's own bucket-index arithmetic below deliberately avoids
 *     `&`/`%`-via-bitmask in favor of plain `%`, since capacities here
 *     never need to represent a value anywhere near 2^32 the way, say,
 *     the Van Emde Boas task's universe size did).
 *   - Home slot: `hash % capacity` (capacity is always a power of two,
 *     but plain `%` is used for the modulo rather than a bitmask --
 *     both are mathematically equivalent for a power-of-two capacity,
 *     and `%` sidesteps any bitwise-operator wraparound concerns
 *     entirely, at a capacity range this task never gets close to
 *     needing them for).
 *   - Insertion ("Robin Hood" swapping): starting at the home slot,
 *     walk forward one slot at a time. If the current slot is empty,
 *     place the entry being carried there and stop. Otherwise, compare
 *     probe distances: if the entry being carried has probed *strictly
 *     farther* than the slot's current occupant, they swap -- the
 *     carried entry takes the slot, and the displaced occupant becomes
 *     the new "entry being carried," continuing the walk. Either way,
 *     whichever entry is now being carried has its probe distance
 *     incremented before advancing to the next slot. This is the
 *     "steal from the rich, give to the poor" rule that gives Robin
 *     Hood hashing its low probe-distance variance. An exact probe-
 *     distance tie does *not* swap, so a fixed sequence of operations
 *     always produces the same deterministic final table.
 *   - Lookup: walk forward from the home slot, but stop early --
 *     without needing to reach an empty slot -- as soon as a visited
 *     slot's own stored probe distance is *less than* how far the
 *     search has already probed. This is the standard Robin Hood
 *     lookup optimization: if the sought key were present any farther
 *     along, the Robin Hood invariant guarantees it would already have
 *     displaced (via the swap rule above) anything with a smaller
 *     probe distance sitting in front of it.
 *   - Deletion (backward-shift, no tombstones): remove the target
 *     entry, then repeatedly pull the *next* slot's entry back into the
 *     freshly-vacated gap -- decrementing its probe distance by one
 *     each time -- as long as that next entry is not already sitting in
 *     its own home slot (probe distance `> 0`). This keeps every
 *     remaining entry's probe distance minimal and the whole table
 *     tombstone-free, so lookups never have to skip over "deleted"
 *     markers.
 *   - Growth: capacity always doubles (staying a power of two).
 *     Growth is checked before inserting a genuinely new key: if
 *     `(size + 1) > capacity * MAX_LOAD_FACTOR`, the table doubles and
 *     every existing entry is re-inserted (via the same Robin Hood
 *     insertion routine, with its probe distance reset to 0 first) into
 *     the new, larger table before the new key is inserted.
 *     `MAX_LOAD_FACTOR` is `0.9` -- documented here and re-exported as
 *     `RobinHoodMap.MAX_LOAD_FACTOR` for tests -- deliberately higher
 *     than a typical linear-probing hash table's usual ~0.7, because
 *     Robin Hood hashing's whole point is that it tolerates high load
 *     factors gracefully (low probe-distance variance) where naive
 *     linear probing degrades badly.
 */

const INITIAL_CAPACITY = 8;
const MAX_LOAD_FACTOR = 0.9;
const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function fnv1aHash(str) {
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}

class RobinHoodMap {
  constructor() {
    this._capacity = INITIAL_CAPACITY;
    this._slots = new Array(this._capacity).fill(null);
    this._size = 0;
  }

  get size() {
    return this._size;
  }

  set(key, value) {
    RobinHoodMap._checkKey(key);
    const hash = fnv1aHash(key);
    const existingIdx = this._findSlotIndex(key, hash);
    if (existingIdx !== -1) {
      this._slots[existingIdx].value = value;
      return this;
    }
    this._maybeGrow();
    this._rawInsert({ key, hash, value, dist: 0 });
    this._size++;
    return this;
  }

  get(key) {
    RobinHoodMap._checkKey(key);
    const hash = fnv1aHash(key);
    const idx = this._findSlotIndex(key, hash);
    return idx === -1 ? undefined : this._slots[idx].value;
  }

  has(key) {
    RobinHoodMap._checkKey(key);
    const hash = fnv1aHash(key);
    return this._findSlotIndex(key, hash) !== -1;
  }

  delete(key) {
    RobinHoodMap._checkKey(key);
    const hash = fnv1aHash(key);
    const idx = this._findSlotIndex(key, hash);
    if (idx === -1) return false;
    this._backwardShiftDelete(idx);
    this._size--;
    return true;
  }

  clear() {
    this._capacity = INITIAL_CAPACITY;
    this._slots = new Array(this._capacity).fill(null);
    this._size = 0;
    return this;
  }

  static _checkKey(key) {
    if (typeof key !== 'string') throw new TypeError('key must be a string');
  }

  // Returns the slot index holding `key`, or -1 if absent. Uses the
  // Robin Hood early-exit optimization: stops as soon as a visited
  // slot's own probe distance is less than how far the search has
  // already walked, since the key (if present) can't be any farther.
  _findSlotIndex(key, hash) {
    const capacity = this._capacity;
    let idx = hash % capacity;
    let dist = 0;
    while (true) {
      const slot = this._slots[idx];
      if (slot === null) return -1;
      if (slot.dist < dist) return -1;
      if (slot.hash === hash && slot.key === key) return idx;
      idx = (idx + 1) % capacity;
      dist++;
    }
  }

  // Textbook Robin Hood insertion, assuming `newEntry.key` is not
  // already present in the table. `newEntry.dist` must start at 0.
  _rawInsert(newEntry) {
    const capacity = this._capacity;
    let idx = newEntry.hash % capacity;
    let carrying = newEntry;
    while (true) {
      const occupant = this._slots[idx];
      if (occupant === null) {
        this._slots[idx] = carrying;
        return;
      }
      if (carrying.dist > occupant.dist) {
        this._slots[idx] = carrying;
        carrying = occupant;
      }
      carrying.dist++;
      idx = (idx + 1) % capacity;
    }
  }

  _maybeGrow() {
    if (this._size + 1 > this._capacity * MAX_LOAD_FACTOR) {
      this._grow();
    }
  }

  _grow() {
    const oldSlots = this._slots;
    this._capacity *= 2;
    this._slots = new Array(this._capacity).fill(null);
    for (const entry of oldSlots) {
      if (entry !== null) {
        entry.dist = 0;
        this._rawInsert(entry);
      }
    }
  }

  // Backward-shift deletion: remove the entry at `deletedIdx`, then
  // pull each subsequent non-home-slot entry back by one position
  // (decrementing its probe distance) to fill the gap, stopping at the
  // first empty slot or the first entry already at its own home slot.
  _backwardShiftDelete(deletedIdx) {
    const capacity = this._capacity;
    let idx = deletedIdx;
    this._slots[idx] = null;
    let nextIdx = (idx + 1) % capacity;
    while (this._slots[nextIdx] !== null && this._slots[nextIdx].dist > 0) {
      this._slots[idx] = this._slots[nextIdx];
      this._slots[idx].dist--;
      this._slots[nextIdx] = null;
      idx = nextIdx;
      nextIdx = (idx + 1) % capacity;
    }
  }
}

RobinHoodMap.INITIAL_CAPACITY = INITIAL_CAPACITY;
RobinHoodMap.MAX_LOAD_FACTOR = MAX_LOAD_FACTOR;
RobinHoodMap.fnv1aHash = fnv1aHash;

module.exports = { RobinHoodMap };
