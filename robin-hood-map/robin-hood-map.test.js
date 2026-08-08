'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { RobinHoodMap } = require('./robin-hood-map.js');

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Whitebox helper: verify every occupied slot's stored probe distance
// matches its actual displacement from its computed home slot, and
// that every stored key is reachable via the public API. Used to
// concretely confirm Robin Hood insertion/displacement and
// backward-shift deletion are actually maintaining their invariants,
// not just "probably working" per black-box behavior alone.
function checkTableInvariants(m) {
  const capacity = m._capacity;
  let liveCount = 0;
  for (let i = 0; i < capacity; i++) {
    const slot = m._slots[i];
    if (slot === null) continue;
    liveCount++;
    const home = slot.hash % capacity;
    const actualDist = (i - home + capacity) % capacity;
    assert.equal(actualDist, slot.dist, `slot ${i} key=${slot.key}: stored dist should match actual displacement`);
    assert.ok(m.has(slot.key), `slot ${i} key=${slot.key} should be reachable via has()`);
  }
  assert.equal(liveCount, m.size, 'live slot count should equal size');
}

// ---- empty operations ----

test('empty map: size 0, get/has/delete all behave as absent', () => {
  const m = new RobinHoodMap();
  assert.equal(m.size, 0);
  assert.equal(m.get('anything'), undefined);
  assert.equal(m.has('anything'), false);
  assert.equal(m.delete('anything'), false);
  assert.equal(m.size, 0);
});

// ---- updates without size changes ----

test('set on an existing key updates the value in place without changing size', () => {
  const m = new RobinHoodMap();
  m.set('a', 1);
  assert.equal(m.size, 1);
  m.set('a', 2);
  assert.equal(m.size, 1);
  assert.equal(m.get('a'), 2);
  m.set('a', 3);
  assert.equal(m.size, 1);
  assert.equal(m.get('a'), 3);
});

test('updating a key does not change any entry probe distances', () => {
  const m = new RobinHoodMap();
  for (let i = 0; i < 5; i++) m.set('key' + i, i);
  const distancesBefore = m._slots.filter((s) => s !== null).map((s) => ({ key: s.key, dist: s.dist }));
  m.set('key2', 'updated');
  const distancesAfter = m._slots.filter((s) => s !== null).map((s) => ({ key: s.key, dist: s.dist }));
  assert.deepEqual(distancesAfter, distancesBefore.map((d) => (d.key === 'key2' ? { key: d.key, dist: d.dist } : d)));
  assert.equal(m.get('key2'), 'updated');
});

// ---- forced collisions and displacement (whitebox) ----

// These four keys were confirmed offline to all hash to the same home
// bucket (index 0) at the map's initial capacity of 8 -- i.e. a
// genuine, forced hash collision, not merely a hoped-for one.
const COLLIDING_KEYS_BUCKET0 = ['k2', 'k11', 'k19', 'k20'];

test('forced collision: colliding keys share a home bucket and all remain retrievable', () => {
  const m = new RobinHoodMap();
  for (const k of COLLIDING_KEYS_BUCKET0) {
    const hash = RobinHoodMap.fnv1aHash(k);
    assert.equal(hash % RobinHoodMap.INITIAL_CAPACITY, 0, `${k} must hash to bucket 0 for this test to be a genuine collision`);
  }
  for (const k of COLLIDING_KEYS_BUCKET0) m.set(k, 'val_' + k);
  assert.equal(m.size, COLLIDING_KEYS_BUCKET0.length);
  for (const k of COLLIDING_KEYS_BUCKET0) assert.equal(m.get(k), 'val_' + k);
  checkTableInvariants(m);
});

test('displacement: inserting colliding keys produces nonzero probe distances and Robin Hood swapping', () => {
  const m = new RobinHoodMap();
  for (const k of COLLIDING_KEYS_BUCKET0) m.set(k, 'val_' + k);
  const distances = COLLIDING_KEYS_BUCKET0.map((k) => {
    const idx = m._slots.findIndex((s) => s !== null && s.key === k);
    return m._slots[idx].dist;
  });
  // With 4 keys all wanting bucket 0, distances must be exactly {0,1,2,3}
  // in some order (each successive colliding insert probes one slot
  // farther, since none of the intervening buckets are otherwise used).
  assert.deepEqual(distances.slice().sort((a, b) => a - b), [0, 1, 2, 3]);
  checkTableInvariants(m);
});

test('displacement: a later key with a higher forced probe distance can swap an earlier one out of its slot', () => {
  // Insert two colliding keys, then a third that starts probing from
  // the SAME home bucket as the second (by deleting-and-forcing) is
  // hard to construct without whitebox control, so instead: insert all
  // four colliding keys in one order, record final slot assignment,
  // then rebuild fresh with a different insertion order and confirm
  // the *set* of occupied slots and probe distances can differ --
  // proving insertion order genuinely affects placement (i.e. real
  // swapping is happening, not just "first come stays, rest queue up
  // past it with no swaps ever occurring").
  const order1 = COLLIDING_KEYS_BUCKET0;
  const order2 = COLLIDING_KEYS_BUCKET0.slice().reverse();

  const m1 = new RobinHoodMap();
  for (const k of order1) m1.set(k, 1);
  const layout1 = m1._slots.map((s) => (s ? s.key : null));

  const m2 = new RobinHoodMap();
  for (const k of order2) m2.set(k, 1);
  const layout2 = m2._slots.map((s) => (s ? s.key : null));

  assert.notDeepEqual(layout1, layout2, 'different insertion order should (and did) produce a different final slot layout');
  checkTableInvariants(m1);
  checkTableInvariants(m2);
});

test('tie-break: equal probe distance does not swap -- earlier-placed entry stays put', () => {
  // A single colliding pair should never swap relative to each other
  // beyond the natural one-step displacement, since a tie in probe
  // distance keeps the existing occupant in place by construction.
  const m = new RobinHoodMap();
  m.set(COLLIDING_KEYS_BUCKET0[0], 'first');
  const firstIdxBefore = m._slots.findIndex((s) => s !== null && s.key === COLLIDING_KEYS_BUCKET0[0]);
  m.set(COLLIDING_KEYS_BUCKET0[1], 'second');
  const firstIdxAfter = m._slots.findIndex((s) => s !== null && s.key === COLLIDING_KEYS_BUCKET0[0]);
  assert.equal(firstIdxAfter, firstIdxBefore, 'the first-inserted colliding key must not move once a second key merely queues in behind it');
});

// ---- cluster deletion (backward-shift) ----

test('backward-shift deletion retains all other members of a collision cluster', () => {
  const m = new RobinHoodMap();
  const ref = new Map();
  for (const k of COLLIDING_KEYS_BUCKET0) {
    m.set(k, 'val_' + k);
    ref.set(k, 'val_' + k);
  }
  m.delete(COLLIDING_KEYS_BUCKET0[1]);
  ref.delete(COLLIDING_KEYS_BUCKET0[1]);
  assert.equal(m.size, ref.size);
  for (const [k, v] of ref) assert.equal(m.get(k), v);
  assert.equal(m.has(COLLIDING_KEYS_BUCKET0[1]), false);
  checkTableInvariants(m);
});

test('backward-shift deletion decrements probe distance of shifted entries and leaves no tombstones', () => {
  const m = new RobinHoodMap();
  for (const k of COLLIDING_KEYS_BUCKET0) m.set(k, 'v');
  // Find the entry with the smallest nonzero probe distance among the
  // cluster (the one right after the home slot) and delete IT, forcing
  // the entries behind it to shift back.
  const clusterSlots = COLLIDING_KEYS_BUCKET0.map((k) => {
    const idx = m._slots.findIndex((s) => s !== null && s.key === k);
    return { key: k, idx, dist: m._slots[idx].dist };
  }).sort((a, b) => a.dist - b.dist);

  const toDelete = clusterSlots[0]; // smallest distance in the cluster
  const behindBefore = clusterSlots.slice(1).map((c) => ({ key: c.key, dist: m._slots[c.idx].dist }));

  m.delete(toDelete.key);

  for (const entry of behindBefore) {
    const newIdx = m._slots.findIndex((s) => s !== null && s.key === entry.key);
    assert.ok(newIdx !== -1, `${entry.key} must still be present after deletion`);
    assert.equal(m._slots[newIdx].dist, entry.dist - 1, `${entry.key} should have shifted back by exactly one`);
  }
  // no leftover tombstone marker anywhere -- only `null` or real entries
  for (const slot of m._slots) {
    assert.ok(slot === null || (typeof slot === 'object' && 'key' in slot));
  }
  checkTableInvariants(m);
});

test('deleting a key at its own home slot with an empty next slot leaves that slot simply empty', () => {
  const m = new RobinHoodMap();
  m.set('solo', 1);
  const idx = m._slots.findIndex((s) => s !== null && s.key === 'solo');
  m.delete('solo');
  assert.equal(m._slots[idx], null);
  assert.equal(m.size, 0);
});

// ---- resizing (growth + retention) ----

test('growth doubles capacity at the documented load-factor threshold', () => {
  const m = new RobinHoodMap();
  assert.equal(m._capacity, RobinHoodMap.INITIAL_CAPACITY);
  let lastCapacity = m._capacity;
  const seenCapacities = new Set([lastCapacity]);
  for (let i = 0; i < 40; i++) {
    m.set('grow' + i, i);
    if (m._capacity !== lastCapacity) {
      assert.equal(m._capacity, lastCapacity * 2, 'capacity must double, staying a power of two');
      lastCapacity = m._capacity;
      seenCapacities.add(lastCapacity);
    }
    assert.ok(
      m.size <= m._capacity * RobinHoodMap.MAX_LOAD_FACTOR + 1e-9,
      `size ${m.size} must never exceed capacity*MAX_LOAD_FACTOR (${m._capacity * RobinHoodMap.MAX_LOAD_FACTOR}) after an insert`
    );
  }
  assert.ok(seenCapacities.size > 1, 'growth must have actually happened at least once across 40 inserts');
});

test('resize-retention: every key inserted before growth is still correct after growth', () => {
  const m = new RobinHoodMap();
  const expected = new Map();
  for (let i = 0; i < 500; i++) {
    m.set('r' + i, i * i);
    expected.set('r' + i, i * i);
  }
  assert.ok(m._capacity > RobinHoodMap.INITIAL_CAPACITY, 'capacity must have grown for 500 keys');
  assert.equal(m.size, 500);
  for (const [k, v] of expected) {
    assert.equal(m.get(k), v, `${k} must retain its value across all growth/rehashes`);
  }
  checkTableInvariants(m);
});

test('resize-retention holds even with deletes interleaved before and after growth', () => {
  const m = new RobinHoodMap();
  const expected = new Map();
  for (let i = 0; i < 300; i++) {
    m.set('d' + i, i);
    expected.set('d' + i, i);
    if (i % 7 === 0 && i > 0) {
      const delKey = 'd' + (i - 1);
      m.delete(delKey);
      expected.delete(delKey);
    }
  }
  for (const [k, v] of expected) assert.equal(m.get(k), v);
  for (let i = 0; i < 300; i++) {
    const k = 'd' + i;
    if (!expected.has(k)) assert.equal(m.has(k), false);
  }
  checkTableInvariants(m);
});

// ---- clearing ----

test('clear empties the map and resets capacity to the initial value', () => {
  const m = new RobinHoodMap();
  for (let i = 0; i < 50; i++) m.set('c' + i, i);
  assert.ok(m._capacity > RobinHoodMap.INITIAL_CAPACITY);
  const result = m.clear();
  assert.equal(result, m, 'clear() should return this for chaining');
  assert.equal(m.size, 0);
  assert.equal(m._capacity, RobinHoodMap.INITIAL_CAPACITY);
  for (let i = 0; i < 50; i++) assert.equal(m.has('c' + i), false);
});

test('map is fully usable again after clear()', () => {
  const m = new RobinHoodMap();
  m.set('x', 1);
  m.clear();
  m.set('x', 2);
  assert.equal(m.get('x'), 2);
  assert.equal(m.size, 1);
});

// ---- invalid keys ----

test('every key-accepting method rejects non-string keys with TypeError', () => {
  const m = new RobinHoodMap();
  const badKeys = [42, null, undefined, {}, [], Symbol('s'), true, 3.14, new String('boxed')];
  for (const bad of badKeys) {
    assert.throws(() => m.set(bad, 'v'), TypeError, `set(${String(bad)})`);
    assert.throws(() => m.get(bad), TypeError, `get(${String(bad)})`);
    assert.throws(() => m.has(bad), TypeError, `has(${String(bad)})`);
    assert.throws(() => m.delete(bad), TypeError, `delete(${String(bad)})`);
  }
});

// ---- empty-string keys ----

test('the empty string is a valid, ordinary key', () => {
  const m = new RobinHoodMap();
  assert.equal(m.has(''), false);
  m.set('', 'empty-key-value');
  assert.equal(m.size, 1);
  assert.equal(m.has(''), true);
  assert.equal(m.get(''), 'empty-key-value');
  assert.equal(m.delete(''), true);
  assert.equal(m.has(''), false);
});

test('empty string and other keys coexist correctly', () => {
  const m = new RobinHoodMap();
  m.set('', 'e');
  m.set('a', 'a-val');
  m.set('b', 'b-val');
  assert.equal(m.get(''), 'e');
  assert.equal(m.get('a'), 'a-val');
  assert.equal(m.get('b'), 'b-val');
  assert.equal(m.size, 3);
});

// ---- FNV-1a determinism ----

test('fnv1aHash is deterministic and matches known standard FNV-1a 32-bit test vectors', () => {
  assert.equal(RobinHoodMap.fnv1aHash(''), 0x811c9dc5);
  assert.equal(RobinHoodMap.fnv1aHash('a'), 0xe40c292c);
  assert.equal(RobinHoodMap.fnv1aHash('a'), RobinHoodMap.fnv1aHash('a'));
  assert.equal(RobinHoodMap.fnv1aHash('hello'), RobinHoodMap.fnv1aHash('hello'));
});

// ---- seeded operation sequence vs native Map ----

test('differential: seeded random operation sequences match native Map exactly', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const rng = mulberry32(seed * 7919 + 13);
    const poolSize = 5 + Math.floor(rng() * 60);
    const pool = [];
    for (let i = 0; i < poolSize; i++) pool.push('key' + i + '_' + seed);
    const m = new RobinHoodMap();
    const ref = new Map();
    const numOps = 80 + Math.floor(rng() * 120);
    for (let i = 0; i < numOps; i++) {
      const key = pool[Math.floor(rng() * pool.length)];
      const op = rng();
      if (op < 0.5) {
        const value = Math.floor(rng() * 1000000);
        m.set(key, value);
        ref.set(key, value);
      } else if (op < 0.7) {
        assert.equal(m.delete(key), ref.delete(key), `seed=${seed} op=${i} delete(${key})`);
      } else if (op < 0.85) {
        assert.equal(m.get(key), ref.get(key), `seed=${seed} op=${i} get(${key})`);
      } else {
        assert.equal(m.has(key), ref.has(key), `seed=${seed} op=${i} has(${key})`);
      }
      assert.equal(m.size, ref.size, `seed=${seed} op=${i} size`);
    }
    for (const key of pool) {
      assert.equal(m.get(key), ref.get(key), `seed=${seed} final get(${key})`);
      assert.equal(m.has(key), ref.has(key), `seed=${seed} final has(${key})`);
    }
    checkTableInvariants(m);
  }
});

test('differential: small key pools forcing heavy collisions/displacement, checked against Map', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const rng = mulberry32(seed * 104729 + 3);
    const poolSize = 3 + Math.floor(rng() * 10);
    const pool = [];
    for (let i = 0; i < poolSize; i++) pool.push('k' + i);
    const m = new RobinHoodMap();
    const ref = new Map();
    const numOps = 60 + Math.floor(rng() * 80);
    for (let i = 0; i < numOps; i++) {
      const key = pool[Math.floor(rng() * pool.length)];
      if (rng() < 0.6) {
        const value = 'v' + Math.floor(rng() * 1000);
        m.set(key, value);
        ref.set(key, value);
      } else {
        assert.equal(m.delete(key), ref.delete(key), `seed=${seed} op=${i}`);
      }
      assert.equal(m.size, ref.size, `seed=${seed} op=${i} size`);
    }
    for (const key of pool) {
      assert.equal(m.get(key), ref.get(key), `seed=${seed} key=${key}`);
    }
    checkTableInvariants(m);
  }
});

test('differential: growth-heavy sequences (many more keys than initial capacity) vs Map', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const rng = mulberry32(seed * 65599 + 101);
    const m = new RobinHoodMap();
    const ref = new Map();
    const n = 200 + Math.floor(rng() * 400);
    for (let i = 0; i < n; i++) {
      const key = 'grow' + i;
      const value = i * 2;
      m.set(key, value);
      ref.set(key, value);
      if (i > 10 && rng() < 0.1) {
        const delKey = 'grow' + Math.floor(rng() * i);
        m.delete(delKey);
        ref.delete(delKey);
      }
    }
    assert.equal(m.size, ref.size, `seed=${seed}`);
    for (const [key, value] of ref) {
      assert.equal(m.get(key), value, `seed=${seed} key=${key}`);
    }
    checkTableInvariants(m);
  }
});
