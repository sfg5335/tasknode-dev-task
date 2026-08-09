'use strict';

/**
 * HashedTimingWheel — a dependency-free, deterministic deadline primitive.
 *
 * Entries are scheduled against an integer "tick" clock (not wall time).
 * The wheel is divided into `wheelSize` indexed buckets; an entry with due
 * tick `t` lives in bucket `t % wheelSize`. Because due ticks are stored in
 * full (not just as a bucket index), entries scheduled many revolutions
 * apart that happen to hash to the same bucket never collide — each bucket
 * keeps its entries grouped by their exact due tick, so advancing the wheel
 * one tick at a time only ever fires the entries whose due tick equals the
 * tick just reached.
 *
 * Firing order: whenever `advanceTo()` crosses one or more due ticks, fired
 * entries are returned in ascending due-tick order; entries that share the
 * same due tick fire in the order they were most recently placed at that
 * tick (i.e. `schedule()` order, or `reschedule()` order for an entry that
 * was moved). Every entry fires exactly once — once returned by
 * `advanceTo()`, it is removed from the wheel and cannot fire again.
 */
class HashedTimingWheel {
  #wheelSize;
  #currentTick;
  #buckets; // Array<Map<tick, Array<Entry>>>, indexed by tick % wheelSize
  #index; // Map<id, { tick, bucketIndex }> for O(1) lookup by id
  #size;

  /**
   * @param {object} [options]
   * @param {number} [options.startTick=0] - non-negative integer clock start
   * @param {number} [options.wheelSize=8] - positive integer bucket count
   */
  constructor(options = {}) {
    const { startTick = 0, wheelSize = 8 } = options;

    if (!Number.isInteger(startTick) || startTick < 0) {
      throw new RangeError('startTick must be a non-negative integer');
    }
    if (!Number.isInteger(wheelSize) || wheelSize < 1) {
      throw new RangeError('wheelSize must be a positive integer');
    }

    this.#wheelSize = wheelSize;
    this.#currentTick = startTick;
    this.#buckets = Array.from({ length: wheelSize }, () => new Map());
    this.#index = new Map();
    this.#size = 0;
  }

  /** Current position of the wheel's tick clock. */
  get currentTick() {
    return this.#currentTick;
  }

  /** Number of entries currently scheduled (not yet fired or cancelled). */
  get size() {
    return this.#size;
  }

  /** Number of buckets the wheel hashes due ticks into. */
  get wheelSize() {
    return this.#wheelSize;
  }

  #bucketIndexFor(tick) {
    return tick % this.#wheelSize;
  }

  #assertValidId(id) {
    if (typeof id !== 'string' || id.length === 0) {
      throw new TypeError('id must be a non-empty string');
    }
  }

  #assertFutureDueTick(dueTick) {
    if (!Number.isSafeInteger(dueTick)) {
      throw new RangeError('dueTick must be a safe integer');
    }
    if (dueTick <= this.#currentTick) {
      throw new RangeError(
        `dueTick (${dueTick}) must be strictly greater than the current tick (${this.#currentTick})`
      );
    }
  }

  #placeAt(id, tick, value) {
    const bucketIndex = this.#bucketIndexFor(tick);
    const bucket = this.#buckets[bucketIndex];
    let slot = bucket.get(tick);
    if (slot === undefined) {
      slot = [];
      bucket.set(tick, slot);
    }
    slot.push({ id, tick, value });
    this.#index.set(id, { tick, bucketIndex });
  }

  #removeFromWheel(id, entryRef) {
    const bucket = this.#buckets[entryRef.bucketIndex];
    const slot = bucket.get(entryRef.tick);
    const position = slot.findIndex((entry) => entry.id === id);
    slot.splice(position, 1);
    if (slot.length === 0) {
      bucket.delete(entryRef.tick);
    }
    this.#index.delete(id);
  }

  /**
   * Schedule a new entry.
   * @param {string} id - unique string identifier (must not already exist)
   * @param {number} dueTick - safe integer, strictly greater than currentTick
   * @param {*} [value] - arbitrary payload, returned unchanged when fired
   * @returns {string} the scheduled id, for convenience
   */
  schedule(id, dueTick, value) {
    this.#assertValidId(id);
    if (this.#index.has(id)) {
      throw new Error(`id "${id}" is already scheduled`);
    }
    this.#assertFutureDueTick(dueTick);

    this.#placeAt(id, dueTick, value);
    this.#size += 1;
    return id;
  }

  /**
   * Cancel a previously scheduled entry.
   * @param {string} id
   * @returns {boolean} true if an entry was found and removed, false if no
   *   such entry was scheduled (not an error — cancelling an id that has
   *   already fired, already been cancelled, or was never scheduled is a
   *   normal, well-defined outcome).
   */
  cancel(id) {
    if (typeof id !== 'string') {
      throw new TypeError('id must be a string');
    }
    const entryRef = this.#index.get(id);
    if (entryRef === undefined) {
      return false;
    }
    this.#removeFromWheel(id, entryRef);
    this.#size -= 1;
    return true;
  }

  /**
   * Move an already-scheduled entry to a new due tick, preserving its
   * originally scheduled value untouched.
   * @param {string} id
   * @param {number} newDueTick - safe integer, strictly greater than currentTick
   * @returns {boolean} true (throws instead of returning false; see below)
   */
  reschedule(id, newDueTick) {
    if (typeof id !== 'string') {
      throw new TypeError('id must be a string');
    }
    const entryRef = this.#index.get(id);
    if (entryRef === undefined) {
      throw new Error(`id "${id}" is not currently scheduled`);
    }
    this.#assertFutureDueTick(newDueTick);

    const oldBucket = this.#buckets[entryRef.bucketIndex];
    const oldSlot = oldBucket.get(entryRef.tick);
    const position = oldSlot.findIndex((entry) => entry.id === id);
    const [entry] = oldSlot.splice(position, 1);
    if (oldSlot.length === 0) {
      oldBucket.delete(entryRef.tick);
    }

    this.#placeAt(id, newDueTick, entry.value);
    return true;
  }

  /**
   * Look up the entry that would fire next, without mutating any state
   * (does not advance the tick, remove, or reorder anything).
   * @returns {{ id: string, tick: number, value: * } | null}
   */
  peekNext() {
    if (this.#size === 0) {
      return null;
    }

    let minTick = Infinity;
    for (const entryRef of this.#index.values()) {
      if (entryRef.tick < minTick) {
        minTick = entryRef.tick;
      }
    }

    const bucket = this.#buckets[this.#bucketIndexFor(minTick)];
    const slot = bucket.get(minTick);
    const first = slot[0];
    return { id: first.id, tick: first.tick, value: first.value };
  }

  /**
   * Advance the wheel's clock to `targetTick`, firing (removing and
   * returning) every entry whose due tick falls within
   * `(currentTick, targetTick]`, in ascending due-tick order with
   * same-tick ties broken by scheduling order.
   * @param {number} targetTick - safe integer >= currentTick
   * @returns {Array<{ id: string, tick: number, value: * }>} fired entries,
   *   in fire order. Empty if nothing was due.
   */
  advanceTo(targetTick) {
    if (!Number.isSafeInteger(targetTick)) {
      throw new RangeError('targetTick must be a safe integer');
    }
    if (targetTick < this.#currentTick) {
      throw new RangeError(
        `targetTick (${targetTick}) cannot be less than the current tick (${this.#currentTick})`
      );
    }

    const fired = [];
    for (let tick = this.#currentTick + 1; tick <= targetTick; tick += 1) {
      const bucket = this.#buckets[this.#bucketIndexFor(tick)];
      const slot = bucket.get(tick);
      if (slot === undefined) {
        continue;
      }
      for (const entry of slot) {
        fired.push({ id: entry.id, tick: entry.tick, value: entry.value });
        this.#index.delete(entry.id);
      }
      bucket.delete(tick);
      this.#size -= slot.length;
    }

    this.#currentTick = targetTick;
    return fired;
  }
}

module.exports = { HashedTimingWheel };
