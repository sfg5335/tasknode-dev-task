'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { StablePriorityQueue } = require('./stable-priority-queue.js');

test('empty queue: size 0, has() false, peek()/pop() return undefined', () => {
  const q = new StablePriorityQueue();
  assert.equal(q.size, 0);
  assert.equal(q.has('x'), false);
  assert.equal(q.peek(), undefined);
  assert.equal(q.pop(), undefined);
  assert.equal(q.size, 0); // pop() on empty must not throw or change size
});

test('pop() returns entries in strictly increasing priority order', () => {
  const q = new StablePriorityQueue();
  q.upsert('c', 30, 'C');
  q.upsert('a', 10, 'A');
  q.upsert('b', 20, 'B');
  assert.equal(q.size, 3);
  assert.deepEqual(q.pop(), { key: 'a', priority: 10, value: 'A' });
  assert.deepEqual(q.pop(), { key: 'b', priority: 20, value: 'B' });
  assert.deepEqual(q.pop(), { key: 'c', priority: 30, value: 'C' });
  assert.equal(q.size, 0);
});

test('equal priorities pop in original insertion order (stability)', () => {
  const q = new StablePriorityQueue();
  q.upsert('first', 5, 1);
  q.upsert('second', 5, 2);
  q.upsert('third', 5, 3);
  assert.deepEqual(q.pop(), { key: 'first', priority: 5, value: 1 });
  assert.deepEqual(q.pop(), { key: 'second', priority: 5, value: 2 });
  assert.deepEqual(q.pop(), { key: 'third', priority: 5, value: 3 });
});

test('updating a key to a lower priority (upward move) is reflected immediately', () => {
  const q = new StablePriorityQueue();
  q.upsert('a', 10, 'A');
  q.upsert('b', 20, 'B');
  q.upsert('c', 5, 'C');
  // Move 'b' down to priority 1 -- it should now be the minimum.
  q.upsert('b', 1, 'B2');
  assert.equal(q.size, 3);
  assert.deepEqual(q.pop(), { key: 'b', priority: 1, value: 'B2' });
  assert.deepEqual(q.pop(), { key: 'c', priority: 5, value: 'C' });
  assert.deepEqual(q.pop(), { key: 'a', priority: 10, value: 'A' });
});

test('updating a key to a higher priority (downward move) is reflected immediately', () => {
  const q = new StablePriorityQueue();
  q.upsert('a', 1, 'A');
  q.upsert('b', 2, 'B');
  q.upsert('c', 3, 'C');
  // Push 'a' past everything else.
  q.upsert('a', 10, 'A2');
  assert.deepEqual(q.pop(), { key: 'b', priority: 2, value: 'B' });
  assert.deepEqual(q.pop(), { key: 'c', priority: 3, value: 'C' });
  assert.deepEqual(q.pop(), { key: 'a', priority: 10, value: 'A2' });
});

test('delete() on the root (current minimum) promotes the correct next minimum', () => {
  const q = new StablePriorityQueue();
  q.upsert('a', 1, 'A');
  q.upsert('b', 2, 'B');
  q.upsert('c', 3, 'C');
  assert.equal(q.peek().key, 'a');
  assert.equal(q.delete('a'), true);
  assert.equal(q.size, 2);
  assert.equal(q.has('a'), false);
  assert.deepEqual(q.pop(), { key: 'b', priority: 2, value: 'B' });
  assert.deepEqual(q.pop(), { key: 'c', priority: 3, value: 'C' });
});

test('delete() on a middle key and on the most-recently-inserted key both preserve the rest', () => {
  const q = new StablePriorityQueue();
  ['a', 'b', 'c', 'd', 'e'].forEach((k, i) => q.upsert(k, (i + 1) * 10, k.toUpperCase()));
  // a:10 b:20 c:30 d:40 e:50 (e is both highest-priority and last-inserted)
  assert.equal(q.delete('c'), true); // a "middle" key by priority
  assert.equal(q.delete('e'), true); // the most-recently-inserted key
  assert.equal(q.size, 3);
  assert.deepEqual(q.pop(), { key: 'a', priority: 10, value: 'A' });
  assert.deepEqual(q.pop(), { key: 'b', priority: 20, value: 'B' });
  assert.deepEqual(q.pop(), { key: 'd', priority: 40, value: 'D' });
  assert.equal(q.size, 0);
});

test('delete() on an absent key returns false and does not change size', () => {
  const q = new StablePriorityQueue();
  q.upsert('a', 1, 'A');
  assert.equal(q.delete('nope'), false);
  assert.equal(q.size, 1);
});

test('repeated upsert on the same key updates in place without duplicating it', () => {
  const q = new StablePriorityQueue();
  q.upsert('a', 5, 'v1');
  q.upsert('a', 5, 'v2');
  q.upsert('a', 3, 'v3');
  assert.equal(q.size, 1);
  assert.equal(q.has('a'), true);
  assert.deepEqual(q.pop(), { key: 'a', priority: 3, value: 'v3' });
});

test('deleting then re-upserting a key gives it a fresh (later) tie-break order', () => {
  const q = new StablePriorityQueue();
  q.upsert('x', 5, 'X1'); // inserted first
  q.upsert('y', 5, 'Y1'); // inserted second, same priority -- x is ahead of y
  q.delete('x');
  q.upsert('x', 5, 'X2'); // re-insert x -- it is now logically *after* y
  assert.deepEqual(q.pop(), { key: 'y', priority: 5, value: 'Y1' });
  assert.deepEqual(q.pop(), { key: 'x', priority: 5, value: 'X2' });
});

test('negative and fractional priorities are ordered correctly', () => {
  const q = new StablePriorityQueue();
  q.upsert('a', 0.5, 'A');
  q.upsert('b', -3.25, 'B');
  q.upsert('c', -3, 'C');
  q.upsert('d', 2, 'D');
  assert.deepEqual(q.pop(), { key: 'b', priority: -3.25, value: 'B' });
  assert.deepEqual(q.pop(), { key: 'c', priority: -3, value: 'C' });
  assert.deepEqual(q.pop(), { key: 'a', priority: 0.5, value: 'A' });
  assert.deepEqual(q.pop(), { key: 'd', priority: 2, value: 'D' });
});

test('invalid upsert/delete inputs throw TypeError and never mutate the queue', () => {
  const q = new StablePriorityQueue();
  q.upsert('a', 1, 'A');
  const snapshot = () => ({ size: q.size, has: q.has('a'), peek: q.peek() });
  const before = snapshot();

  assert.throws(() => q.upsert('', 1, 'x'), TypeError);
  assert.throws(() => q.upsert(null, 1, 'x'), TypeError);
  assert.throws(() => q.upsert(undefined, 1, 'x'), TypeError);
  assert.throws(() => q.upsert(42, 1, 'x'), TypeError);
  assert.throws(() => q.upsert('b', 'not-a-number', 'x'), TypeError);
  assert.throws(() => q.upsert('b', NaN, 'x'), TypeError);
  assert.throws(() => q.upsert('b', Infinity, 'x'), TypeError);
  assert.throws(() => q.upsert('b', -Infinity, 'x'), TypeError);
  assert.throws(() => q.delete(''), TypeError);
  assert.throws(() => q.delete(null), TypeError);
  assert.throws(() => q.delete(7), TypeError);

  // Query-only has() never throws, even for garbage input.
  assert.equal(q.has(null), false);
  assert.equal(q.has(123), false);

  assert.deepEqual(snapshot(), before);
});

test('deterministic mixed-operation sequence matches a simple reference-model implementation', () => {
  // Reference model: a plain array of {key, priority, value, seq}, with the
  // same semantics as StablePriorityQueue (linear scan instead of a heap).
  // This cross-checks the heap implementation against an obviously-correct,
  // much simpler O(n) implementation over a fixed, reproducible sequence of
  // operations (no randomness).
  const ref = [];
  let refSeq = 0;

  function refUpsert(key, priority, value) {
    const existing = ref.find((e) => e.key === key);
    if (existing) {
      existing.priority = priority;
      existing.value = value;
    } else {
      ref.push({ key, priority, value, seq: refSeq++ });
    }
  }
  function refMinIndex() {
    let bi = -1;
    for (let i = 0; i < ref.length; i++) {
      if (bi === -1) {
        bi = i;
        continue;
      }
      const a = ref[i];
      const b = ref[bi];
      if (a.priority < b.priority || (a.priority === b.priority && a.seq < b.seq)) bi = i;
    }
    return bi;
  }
  function refPeek() {
    const i = refMinIndex();
    if (i === -1) return undefined;
    const { key, priority, value } = ref[i];
    return { key, priority, value };
  }
  function refPop() {
    const i = refMinIndex();
    if (i === -1) return undefined;
    const [e] = ref.splice(i, 1);
    return { key: e.key, priority: e.priority, value: e.value };
  }
  function refDelete(key) {
    const i = ref.findIndex((e) => e.key === key);
    if (i === -1) return false;
    ref.splice(i, 1);
    return true;
  }

  const q = new StablePriorityQueue();

  // Fixed, deterministic sequence -- no randomness, fully reproducible.
  const ops = [
    ['upsert', 'a', 5, 'A1'],
    ['upsert', 'b', 3, 'B1'],
    ['upsert', 'c', 5, 'C1'],
    ['peek'],
    ['upsert', 'd', 1, 'D1'],
    ['pop'],
    ['upsert', 'b', 1, 'B2'],
    ['pop'],
    ['delete', 'c'],
    ['has', 'c'],
    ['upsert', 'c', 5, 'C2'],
    ['upsert', 'e', 5, 'E1'],
    ['peek'],
    ['delete', 'nonexistent'],
    ['upsert', 'a', -2, 'A2'],
    ['pop'],
    ['pop'],
    ['pop'],
    ['upsert', 'f', 0, 'F1'],
    ['delete', 'f'],
    ['upsert', 'f', 0, 'F2'],
    ['upsert', 'g', 0, 'G1'],
    ['pop'],
    ['pop'],
  ];

  for (const op of ops) {
    const [kind, ...args] = op;
    if (kind === 'upsert') {
      const [key, priority, value] = args;
      q.upsert(key, priority, value);
      refUpsert(key, priority, value);
      assert.equal(q.size, ref.length, `size mismatch after upsert(${key})`);
    } else if (kind === 'pop') {
      assert.deepEqual(q.pop(), refPop(), 'pop() mismatch');
      assert.equal(q.size, ref.length, 'size mismatch after pop()');
    } else if (kind === 'peek') {
      assert.deepEqual(q.peek(), refPeek(), 'peek() mismatch');
    } else if (kind === 'delete') {
      const [key] = args;
      assert.equal(q.delete(key), refDelete(key), `delete(${key}) mismatch`);
      assert.equal(q.size, ref.length, 'size mismatch after delete()');
    } else if (kind === 'has') {
      const [key] = args;
      assert.equal(q.has(key), ref.some((e) => e.key === key), `has(${key}) mismatch`);
    }
  }

  // Drain both fully and confirm they agree all the way to empty.
  for (;;) {
    const a = q.pop();
    const b = refPop();
    assert.deepEqual(a, b, 'final drain mismatch');
    if (a === undefined) break;
  }
  assert.equal(q.size, 0);
});
