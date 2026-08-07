'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { VanEmdeBoasSet } = require('./van-emde-boas-set.js');

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

// Reference helpers over a native Set -- used throughout as an
// independent (linear-scan) source of truth for predecessor/successor/
// minimum/maximum, structurally unrelated to the vEB tree's own
// min/max/cluster/summary bookkeeping.
function nativePredecessor(set, x) {
  for (let v = x - 1; v >= 0; v--) if (set.has(v)) return v;
  return null;
}
function nativeSuccessor(set, u, x) {
  for (let v = x + 1; v < u; v++) if (set.has(v)) return v;
  return null;
}
function nativeMin(set) {
  return set.size === 0 ? null : Math.min(...set);
}
function nativeMax(set) {
  return set.size === 0 ? null : Math.max(...set);
}

// ---- empty sets ----

test('a freshly constructed set is empty', () => {
  const s = new VanEmdeBoasSet(16);
  assert.equal(s.minimum(), null);
  assert.equal(s.maximum(), null);
  assert.equal(s.size(), 0);
  assert.equal(s.has(0), false);
  assert.equal(s.predecessor(8), null);
  assert.equal(s.successor(8), null);
});

// ---- universe boundaries: the u=2 base case, and the largest allowed universe ----

test('universeSize = 2 (the base-case leaf) supports both of its values', () => {
  const s = new VanEmdeBoasSet(2);
  assert.equal(s.minimum(), null);
  assert.equal(s.successor(0), null);
  assert.equal(s.predecessor(1), null);
  assert.equal(s.insert(0), true);
  assert.equal(s.insert(1), true);
  assert.deepEqual([s.minimum(), s.maximum(), s.size()], [0, 1, 2]);
  assert.equal(s.successor(0), 1);
  assert.equal(s.predecessor(1), 0);
  assert.equal(s.delete(0), true);
  assert.deepEqual([s.minimum(), s.maximum(), s.has(0), s.has(1)], [1, 1, false, true]);
});

test('universeSize = 2^32 constructs instantly and supports values near both ends', () => {
  const start = Date.now();
  const s = new VanEmdeBoasSet(2 ** 32);
  const ctorMs = Date.now() - start;
  assert.ok(ctorMs < 1000, `construction should be instant (lazy allocation), took ${ctorMs}ms`);
  const values = [0, 1, 2, 2 ** 31, 4000000000, 2 ** 32 - 2, 2 ** 32 - 1];
  for (const v of values) assert.equal(s.insert(v), true);
  for (const v of values) assert.equal(s.has(v), true, `expected ${v} to be present`);
  assert.equal(s.minimum(), 0);
  assert.equal(s.maximum(), 2 ** 32 - 1);
  assert.equal(s.size(), values.length);
  assert.equal(s.successor(0), 1);
  assert.equal(s.successor(1), 2);
  assert.equal(s.predecessor(2 ** 32 - 1), 2 ** 32 - 2);
  assert.equal(s.has(3), false);
  assert.equal(s.has(2 ** 32 - 3), false);
});

// ---- odd and even universe exponents (asymmetric vs. symmetric cluster splits) ----

test('odd universe exponent (universeSize = 8, k=3 -> upperSize=4, lowerSize=2)', () => {
  const s = new VanEmdeBoasSet(8);
  const native = new Set();
  for (const v of [0, 1, 3, 5, 7]) {
    s.insert(v);
    native.add(v);
  }
  for (let x = 0; x < 8; x++) {
    assert.equal(s.has(x), native.has(x), `has(${x})`);
    assert.equal(s.predecessor(x), nativePredecessor(native, x), `predecessor(${x})`);
    assert.equal(s.successor(x), nativeSuccessor(native, 8, x), `successor(${x})`);
  }
});

test('even universe exponent (universeSize = 16, k=4 -> upperSize=4, lowerSize=4)', () => {
  const s = new VanEmdeBoasSet(16);
  const native = new Set();
  for (const v of [2, 4, 6, 9, 13, 15]) {
    s.insert(v);
    native.add(v);
  }
  for (let x = 0; x < 16; x++) {
    assert.equal(s.has(x), native.has(x), `has(${x})`);
    assert.equal(s.predecessor(x), nativePredecessor(native, x), `predecessor(${x})`);
    assert.equal(s.successor(x), nativeSuccessor(native, 16, x), `successor(${x})`);
  }
});

// ---- duplicates and idempotency ----

test('inserting an already-present value is a harmless idempotent no-op', () => {
  const s = new VanEmdeBoasSet(32);
  assert.equal(s.insert(10), true);
  assert.equal(s.size(), 1);
  assert.equal(s.insert(10), false);
  assert.equal(s.size(), 1);
  assert.equal(s.minimum(), 10);
  assert.equal(s.maximum(), 10);
});

test('deleting an already-absent value is a harmless idempotent no-op', () => {
  const s = new VanEmdeBoasSet(32);
  s.insert(5);
  s.insert(20);
  assert.equal(s.delete(7), false);
  assert.equal(s.size(), 2);
  assert.equal(s.has(5), true);
  assert.equal(s.has(20), true);
  assert.equal(s.delete(7), false); // still idempotent on repeat
});

test('deleting from an empty set is a harmless idempotent no-op', () => {
  const s = new VanEmdeBoasSet(8);
  assert.equal(s.delete(3), false);
  assert.equal(s.size(), 0);
});

// ---- extrema deletion ----

test('deleting the minimum promotes the next-smallest element', () => {
  const s = new VanEmdeBoasSet(64);
  for (const v of [3, 7, 12, 40, 63]) s.insert(v);
  assert.equal(s.minimum(), 3);
  assert.equal(s.delete(3), true);
  assert.equal(s.minimum(), 7);
  assert.equal(s.delete(7), true);
  assert.equal(s.minimum(), 12);
});

test('deleting the maximum demotes to the next-largest element', () => {
  const s = new VanEmdeBoasSet(64);
  for (const v of [3, 7, 12, 40, 63]) s.insert(v);
  assert.equal(s.maximum(), 63);
  assert.equal(s.delete(63), true);
  assert.equal(s.maximum(), 40);
  assert.equal(s.delete(40), true);
  assert.equal(s.maximum(), 12);
});

test('deleting the only element empties the set', () => {
  const s = new VanEmdeBoasSet(16);
  s.insert(9);
  assert.equal(s.delete(9), true);
  assert.equal(s.minimum(), null);
  assert.equal(s.maximum(), null);
  assert.equal(s.size(), 0);
});

test('deleting the min when it is the sole remaining element after prior deletions', () => {
  const s = new VanEmdeBoasSet(16);
  s.insert(5);
  s.insert(9);
  assert.equal(s.delete(9), true); // deletes max, 5 remains as both min and max
  assert.equal(s.minimum(), 5);
  assert.equal(s.maximum(), 5);
  assert.equal(s.delete(5), true);
  assert.equal(s.size(), 0);
});

test('deleting the min whose cluster becomes empty picks the new min from the next non-empty cluster', () => {
  // universeSize=16 (lowerSize=4): cluster 0 covers [0,4), cluster 1 covers [4,8).
  const s = new VanEmdeBoasSet(16);
  s.insert(1); // sole occupant of cluster 0 -- and the overall min
  s.insert(6); // sole occupant of cluster 1
  assert.equal(s.minimum(), 1);
  assert.equal(s.delete(1), true); // cluster 0 becomes empty; new min must come from cluster 1
  assert.equal(s.minimum(), 6);
  assert.equal(s.maximum(), 6);
});

// ---- predecessor / successor: strictness and absence ----

test('predecessor and successor are strict (never return x itself, even if x is a member)', () => {
  const s = new VanEmdeBoasSet(16);
  for (const v of [4, 8, 12]) s.insert(v);
  assert.equal(s.predecessor(8), 4);
  assert.equal(s.successor(8), 12);
  assert.notEqual(s.predecessor(8), 8);
  assert.notEqual(s.successor(8), 8);
});

test('predecessor/successor at the universe boundaries return null when nothing qualifies', () => {
  const s = new VanEmdeBoasSet(16);
  for (const v of [4, 8, 12]) s.insert(v);
  assert.equal(s.predecessor(0), null);
  assert.equal(s.predecessor(4), null); // nothing strictly smaller than the min
  assert.equal(s.successor(15), null);
  assert.equal(s.successor(12), null); // nothing strictly larger than the max
});

test('predecessor/successor work for a query value that is not itself a member', () => {
  const s = new VanEmdeBoasSet(32);
  for (const v of [3, 10, 21, 30]) s.insert(v);
  assert.equal(s.predecessor(15), 10);
  assert.equal(s.successor(15), 21);
  assert.equal(s.predecessor(2), null);
  assert.equal(s.successor(31), null);
});

// ---- invalid inputs ----

test('universeSize must be a safe integer', () => {
  assert.throws(() => new VanEmdeBoasSet('16'), TypeError);
  assert.throws(() => new VanEmdeBoasSet(16.5), TypeError);
  assert.throws(() => new VanEmdeBoasSet(NaN), TypeError);
  assert.throws(() => new VanEmdeBoasSet(Infinity), TypeError);
  assert.throws(() => new VanEmdeBoasSet(null), TypeError);
});

test('universeSize must be a power of two in [2, 2^32]', () => {
  assert.throws(() => new VanEmdeBoasSet(0), RangeError);
  assert.throws(() => new VanEmdeBoasSet(1), RangeError);
  assert.throws(() => new VanEmdeBoasSet(-4), RangeError);
  assert.throws(() => new VanEmdeBoasSet(3), RangeError);
  assert.throws(() => new VanEmdeBoasSet(6), RangeError);
  assert.throws(() => new VanEmdeBoasSet(100), RangeError);
  assert.throws(() => new VanEmdeBoasSet(2 ** 32 + 1), RangeError);
  assert.throws(() => new VanEmdeBoasSet(2 ** 33), RangeError);
  assert.doesNotThrow(() => new VanEmdeBoasSet(2));
  assert.doesNotThrow(() => new VanEmdeBoasSet(2 ** 32));
});

test('element arguments must be safe integers, TypeError otherwise', () => {
  const s = new VanEmdeBoasSet(16);
  for (const method of ['has', 'insert', 'delete', 'predecessor', 'successor']) {
    assert.throws(() => s[method]('3'), TypeError, `${method} with string`);
    assert.throws(() => s[method](2.5), TypeError, `${method} with non-integer`);
    assert.throws(() => s[method](NaN), TypeError, `${method} with NaN`);
    assert.throws(() => s[method](null), TypeError, `${method} with null`);
    assert.throws(() => s[method](undefined), TypeError, `${method} with undefined`);
  }
});

test('element arguments must be within [0, universeSize), RangeError otherwise', () => {
  const s = new VanEmdeBoasSet(16);
  for (const method of ['has', 'insert', 'delete', 'predecessor', 'successor']) {
    assert.throws(() => s[method](-1), RangeError, `${method}(-1)`);
    assert.throws(() => s[method](16), RangeError, `${method}(16)`);
    assert.throws(() => s[method](1000), RangeError, `${method}(1000)`);
  }
  assert.doesNotThrow(() => s.has(0));
  assert.doesNotThrow(() => s.has(15));
});

// ---- fixed-seed differential tests against a native Set ----

test('fixed-seed differential test against a native Set across small universe sizes', () => {
  const rand = mulberry32(20260808);
  const universeSizes = [2, 4, 8, 16, 32, 64, 128, 256];
  let totalOps = 0;
  for (const u of universeSizes) {
    for (let trial = 0; trial < 15; trial++) {
      const veb = new VanEmdeBoasSet(u);
      const native = new Set();
      for (let i = 0; i < 300; i++) {
        totalOps++;
        const op = Math.floor(rand() * 6);
        const x = Math.floor(rand() * u);
        if (op === 0) {
          const expected = !native.has(x);
          assert.equal(veb.insert(x), expected, `u=${u} insert(${x})`);
          native.add(x);
        } else if (op === 1) {
          const expected = native.has(x);
          assert.equal(veb.delete(x), expected, `u=${u} delete(${x})`);
          native.delete(x);
        } else if (op === 2) {
          assert.equal(veb.has(x), native.has(x), `u=${u} has(${x})`);
        } else if (op === 3) {
          assert.equal(veb.predecessor(x), nativePredecessor(native, x), `u=${u} predecessor(${x})`);
        } else if (op === 4) {
          assert.equal(veb.successor(x), nativeSuccessor(native, u, x), `u=${u} successor(${x})`);
        } else {
          assert.equal(veb.minimum(), nativeMin(native), `u=${u} minimum`);
          assert.equal(veb.maximum(), nativeMax(native), `u=${u} maximum`);
          assert.equal(veb.size(), native.size, `u=${u} size`);
        }
      }
    }
  }
  assert.ok(totalOps > 0);
});

test('fixed-seed differential test against a native Set on larger universe sizes', () => {
  const rand = mulberry32(777123);
  for (const u of [1024, 4096, 65536]) {
    for (let trial = 0; trial < 3; trial++) {
      const veb = new VanEmdeBoasSet(u);
      const native = new Set();
      for (let i = 0; i < 500; i++) {
        const op = Math.floor(rand() * 5);
        const x = Math.floor(rand() * u);
        if (op === 0) {
          const expected = !native.has(x);
          assert.equal(veb.insert(x), expected);
          native.add(x);
        } else if (op === 1) {
          const expected = native.has(x);
          assert.equal(veb.delete(x), expected);
          native.delete(x);
        } else if (op === 2) {
          assert.equal(veb.has(x), native.has(x));
        } else if (op === 3) {
          assert.equal(veb.predecessor(x), nativePredecessor(native, x));
        } else {
          assert.equal(veb.successor(x), nativeSuccessor(native, u, x));
        }
      }
      assert.equal(veb.minimum(), nativeMin(native));
      assert.equal(veb.maximum(), nativeMax(native));
      assert.equal(veb.size(), native.size);
    }
  }
});

test('fixed-seed differential test sweeping every universe exponent from 2^1 to 2^14', () => {
  const rand = mulberry32(999999);
  for (let k = 1; k <= 14; k++) {
    const u = 2 ** k;
    for (let trial = 0; trial < 4; trial++) {
      const veb = new VanEmdeBoasSet(u);
      const native = new Set();
      for (let i = 0; i < 200; i++) {
        const op = Math.floor(rand() * 5);
        const x = Math.floor(rand() * u);
        if (op === 0) {
          const expected = !native.has(x);
          assert.equal(veb.insert(x), expected, `u=${u}`);
          native.add(x);
        } else if (op === 1) {
          const expected = native.has(x);
          assert.equal(veb.delete(x), expected, `u=${u}`);
          native.delete(x);
        } else if (op === 2) {
          assert.equal(veb.has(x), native.has(x), `u=${u}`);
        } else if (op === 3) {
          assert.equal(veb.predecessor(x), nativePredecessor(native, x), `u=${u}`);
        } else {
          assert.equal(veb.successor(x), nativeSuccessor(native, u, x), `u=${u}`);
        }
      }
    }
  }
});
