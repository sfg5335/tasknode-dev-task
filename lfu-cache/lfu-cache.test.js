'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { LFUCache } = require('./lfu-cache.js');

test('constructor rejects invalid capacity', () => {
  assert.throws(() => new LFUCache(-1), TypeError);
  assert.throws(() => new LFUCache(1.5), TypeError);
  assert.throws(() => new LFUCache('3'), TypeError);
  assert.throws(() => new LFUCache(null), TypeError);
  assert.throws(() => new LFUCache(NaN), TypeError);
});

test('capacity 0: put() is always a no-op, get() always misses, size stays 0', () => {
  const cache = new LFUCache(0);
  cache.put('a', 1);
  assert.equal(cache.size, 0);
  assert.equal(cache.get('a'), null);
  cache.put('b', 2);
  cache.put('c', 3);
  assert.equal(cache.size, 0);
});

test('capacity 1: inserting a second key evicts the first', () => {
  const cache = new LFUCache(1);
  cache.put('a', 1);
  assert.equal(cache.get('a'), 1);
  cache.put('b', 2);
  assert.equal(cache.size, 1);
  assert.equal(cache.get('a'), null); // evicted
  assert.equal(cache.get('b'), 2);
});

test('get() on a missing key returns null', () => {
  const cache = new LFUCache(2);
  assert.equal(cache.get('nope'), null);
  cache.put('a', 1);
  assert.equal(cache.get('still-nope'), null);
});

test('get() with a non-string or empty-string key is a lenient miss, never throws', () => {
  const cache = new LFUCache(2);
  cache.put('a', 1);
  assert.equal(cache.get(42), null);
  assert.equal(cache.get(null), null);
  assert.equal(cache.get(undefined), null);
  assert.equal(cache.get(''), null);
  assert.equal(cache.size, 1); // unaffected
});

test('put() on an existing key updates its value without growing size or duplicating it', () => {
  const cache = new LFUCache(2);
  cache.put('a', 1);
  cache.put('a', 2);
  assert.equal(cache.size, 1);
  assert.equal(cache.get('a'), 2);
});

test('put()/get() reject invalid key or value without mutating the cache', () => {
  const cache = new LFUCache(2);
  cache.put('a', 1);
  // Snapshotting via get('a') itself bumps 'a's frequency/recency each call,
  // but that's not observable through size or the returned value, so
  // calling it twice (once for `before`, once again after the throws) is a
  // fair comparison for what this test actually asserts.
  const snapshot = () => ({ size: cache.size, a: cache.get('a') });
  const before = snapshot();

  assert.throws(() => cache.put('', 1), TypeError);
  assert.throws(() => cache.put(null, 1), TypeError);
  assert.throws(() => cache.put(42, 1), TypeError);
  assert.throws(() => cache.put('b', null), TypeError);
  assert.throws(() => cache.put('b', undefined), TypeError);

  assert.deepEqual(snapshot(), before);
  assert.equal(cache.get('b'), null); // 'b' was never actually inserted
});

test('frequency-based eviction: the least-frequently-used key is evicted first', () => {
  const cache = new LFUCache(2);
  cache.put('a', 1);
  cache.put('b', 2);
  cache.get('a'); // a: freq 2, b: freq 1
  cache.put('c', 3); // cache full, capacity 2 -- evict lowest freq -> 'b'
  assert.equal(cache.get('b'), null);
  assert.equal(cache.get('a'), 1);
  assert.equal(cache.get('c'), 3);
});

test('recency tie-breaking: among equal frequencies, the least-recently-used key is evicted', () => {
  const cache = new LFUCache(2);
  cache.put('a', 1); // freq 1
  cache.put('b', 2); // freq 1, both tied at freq 1, 'a' touched first (less recent)
  cache.put('c', 3); // capacity 2, both a and b at freq 1 -- evict the less-recent one, 'a'
  assert.equal(cache.get('a'), null);
  assert.equal(cache.get('b'), 2);
  assert.equal(cache.get('c'), 3);
});

test('size tracks insertions and evictions correctly', () => {
  const cache = new LFUCache(3);
  assert.equal(cache.size, 0);
  cache.put('a', 1);
  assert.equal(cache.size, 1);
  cache.put('b', 2);
  cache.put('c', 3);
  assert.equal(cache.size, 3);
  cache.put('a', 10); // update, not an insert
  assert.equal(cache.size, 3);
  cache.put('d', 4); // full -- triggers an eviction, net size unchanged
  assert.equal(cache.size, 3);
});

test('get() changes access order/eviction risk (touching a key protects it from eviction)', () => {
  const cache = new LFUCache(2);
  cache.put('a', 1);
  cache.put('b', 2); // a and b both freq 1, a inserted first (less recent)
  cache.get('a'); // touch a -- a now freq 2, more recent than b at freq 1
  cache.put('c', 3); // full -- evict lowest freq, which is now b (freq 1) not a
  assert.equal(cache.get('b'), null);
  assert.equal(cache.get('a'), 1);
  assert.equal(cache.get('c'), 3);
});

test('an update via put() also counts as an access for both frequency and recency', () => {
  const cache = new LFUCache(2);
  cache.put('a', 1);
  cache.put('b', 2); // a, b both freq 1; a less recent
  cache.put('a', 100); // update -- counts as an access: a now freq 2, most recent
  cache.put('c', 3); // full -- evict lowest freq among {a: freq2, b: freq1} -> b
  assert.equal(cache.get('b'), null);
  assert.equal(cache.get('a'), 100);
  assert.equal(cache.get('c'), 3);
});

test('deterministic mixed-operation sequence matches a simple reference-model implementation', () => {
  // Reference model: O(n) implementation with the same semantics (a plain
  // Map of {value, freq, seq}, eviction by linear scan for min freq then
  // min seq), used to cross-check the O(1) heap-and-buckets implementation
  // over a fixed, reproducible sequence of operations (no randomness).
  class RefLFU {
    constructor(capacity) {
      this.capacity = capacity;
      this.map = new Map();
      this.seq = 0;
    }
    get(key) {
      if (typeof key !== 'string' || key.length === 0) return null;
      const e = this.map.get(key);
      if (!e) return null;
      e.freq++;
      e.seq = this.seq++;
      return e.value;
    }
    put(key, value) {
      if (typeof key !== 'string' || key.length === 0) throw new TypeError('key');
      if (value === null || value === undefined) throw new TypeError('value');
      if (this.capacity === 0) return;
      const existing = this.map.get(key);
      if (existing) {
        existing.value = value;
        existing.freq++;
        existing.seq = this.seq++;
        return;
      }
      if (this.map.size >= this.capacity) {
        let evictKey = null;
        let evictE = null;
        for (const [k, e] of this.map) {
          if (evictE === null || e.freq < evictE.freq || (e.freq === evictE.freq && e.seq < evictE.seq)) {
            evictKey = k;
            evictE = e;
          }
        }
        this.map.delete(evictKey);
      }
      this.map.set(key, { value, freq: 1, seq: this.seq++ });
    }
    get size() {
      return this.map.size;
    }
  }

  const cache = new LFUCache(3);
  const ref = new RefLFU(3);

  const ops = [
    ['put', 'a', 1],
    ['put', 'b', 2],
    ['put', 'c', 3],
    ['get', 'a'],
    ['get', 'a'],
    ['put', 'd', 4], // full at freq: a=3,b=1,c=1 -> evict b (tie a/c n/a, b lowest freq)
    ['get', 'c'],
    ['put', 'e', 5], // full: a=3,c=2,d=1 -> evict d
    ['get', 'nonexistent'],
    ['put', 'a', 100], // update a
    ['get', 'e'],
    ['get', 'e'],
    ['put', 'f', 6], // full: a, c, e all present -- evict lowest freq/least recent
    ['get', 'a'],
    ['get', 'c'],
    ['get', 'f'],
    ['put', 'g', 7],
    ['get', 'g'],
  ];

  for (const [kind, key, value] of ops) {
    if (kind === 'put') {
      cache.put(key, value);
      ref.put(key, value);
    } else {
      assert.equal(cache.get(key), ref.get(key), `get(${key}) mismatch`);
    }
    assert.equal(cache.size, ref.size, `size mismatch after ${kind}(${key})`);
  }
});
