'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { HashedTimingWheel } = require('./hashed-timing-wheel.js');

test('constructor: defaults', () => {
  const wheel = new HashedTimingWheel();
  assert.equal(wheel.currentTick, 0);
  assert.equal(wheel.size, 0);
  assert.equal(wheel.wheelSize, 8);
});

test('constructor: custom startTick and wheelSize', () => {
  const wheel = new HashedTimingWheel({ startTick: 100, wheelSize: 4 });
  assert.equal(wheel.currentTick, 100);
  assert.equal(wheel.wheelSize, 4);
});

test('constructor: invalid startTick throws RangeError', () => {
  assert.throws(() => new HashedTimingWheel({ startTick: -1 }), RangeError);
  assert.throws(() => new HashedTimingWheel({ startTick: 1.5 }), RangeError);
  assert.throws(() => new HashedTimingWheel({ startTick: 'x' }), RangeError);
  assert.throws(() => new HashedTimingWheel({ startTick: NaN }), RangeError);
});

test('constructor: invalid wheelSize throws RangeError', () => {
  assert.throws(() => new HashedTimingWheel({ wheelSize: 0 }), RangeError);
  assert.throws(() => new HashedTimingWheel({ wheelSize: -3 }), RangeError);
  assert.throws(() => new HashedTimingWheel({ wheelSize: 2.5 }), RangeError);
  assert.throws(() => new HashedTimingWheel({ wheelSize: null }), RangeError);
});

test('empty state: peekNext is null, size is 0, advanceTo no-op returns []', () => {
  const wheel = new HashedTimingWheel({ wheelSize: 4 });
  assert.equal(wheel.peekNext(), null);
  assert.equal(wheel.size, 0);
  assert.deepEqual(wheel.advanceTo(0), []);
  assert.equal(wheel.currentTick, 0);
  assert.deepEqual(wheel.advanceTo(10), []);
  assert.equal(wheel.currentTick, 10);
});

test('schedule: returns id, increments size, peekNext reflects it', () => {
  const wheel = new HashedTimingWheel({ wheelSize: 4 });
  const returned = wheel.schedule('a', 3, 'payload-a');
  assert.equal(returned, 'a');
  assert.equal(wheel.size, 1);
  assert.deepEqual(wheel.peekNext(), { id: 'a', tick: 3, value: 'payload-a' });
});

test('schedule: duplicate id throws', () => {
  const wheel = new HashedTimingWheel({ wheelSize: 4 });
  wheel.schedule('a', 3, 1);
  assert.throws(() => wheel.schedule('a', 5, 2), /already scheduled/);
});

test('schedule: invalid id throws TypeError', () => {
  const wheel = new HashedTimingWheel({ wheelSize: 4 });
  assert.throws(() => wheel.schedule('', 3, 1), TypeError);
  assert.throws(() => wheel.schedule(42, 3, 1), TypeError);
  assert.throws(() => wheel.schedule(null, 3, 1), TypeError);
  assert.throws(() => wheel.schedule(undefined, 3, 1), TypeError);
});

test('schedule: non-future / non-safe-integer dueTick throws RangeError', () => {
  const wheel = new HashedTimingWheel({ wheelSize: 4 });
  assert.throws(() => wheel.schedule('a', 0, 1), RangeError); // == currentTick
  assert.throws(() => wheel.schedule('a', -1, 1), RangeError);
  assert.throws(() => wheel.schedule('a', 1.5, 1), RangeError);
  assert.throws(() => wheel.schedule('a', NaN, 1), RangeError);
  assert.throws(() => wheel.schedule('a', Number.MAX_SAFE_INTEGER + 10, 1), RangeError);
  assert.throws(() => wheel.schedule('a', Infinity, 1), RangeError);
});

test('schedule: dueTick exactly Number.MAX_SAFE_INTEGER is accepted', () => {
  const wheel = new HashedTimingWheel({ wheelSize: 4 });
  wheel.schedule('a', Number.MAX_SAFE_INTEGER, 'far-future');
  assert.equal(wheel.size, 1);
});

test('same-tick ordering: entries scheduled at the same due tick fire in schedule order', () => {
  const wheel = new HashedTimingWheel({ wheelSize: 8 });
  wheel.schedule('first', 5, 1);
  wheel.schedule('second', 5, 2);
  wheel.schedule('third', 5, 3);

  const fired = wheel.advanceTo(5);
  assert.deepEqual(
    fired.map((e) => e.id),
    ['first', 'second', 'third']
  );
  assert.deepEqual(
    fired.map((e) => e.value),
    [1, 2, 3]
  );
  assert.ok(fired.every((e) => e.tick === 5));
});

test('ordering across distinct ticks: fires in ascending due-tick order regardless of schedule order', () => {
  const wheel = new HashedTimingWheel({ wheelSize: 8 });
  wheel.schedule('late', 7, 'late');
  wheel.schedule('early', 2, 'early');
  wheel.schedule('mid', 4, 'mid');

  const fired = wheel.advanceTo(10);
  assert.deepEqual(
    fired.map((e) => e.id),
    ['early', 'mid', 'late']
  );
});

test('wraparound: entries hashing to the same bucket on different revolutions do not collide', () => {
  const wheel = new HashedTimingWheel({ wheelSize: 4 });
  // bucket index = tick % 4, so ticks 2, 6, 10 all land in bucket 2.
  wheel.schedule('rev0', 2, 'rev0');
  wheel.schedule('rev1', 6, 'rev1');
  wheel.schedule('rev2', 10, 'rev2');

  assert.deepEqual(wheel.advanceTo(2).map((e) => e.id), ['rev0']);
  assert.equal(wheel.size, 2);
  assert.deepEqual(wheel.advanceTo(5).map((e) => e.id), []); // still in bucket 2, wrong tick
  assert.deepEqual(wheel.advanceTo(6).map((e) => e.id), ['rev1']);
  assert.equal(wheel.size, 1);
  assert.deepEqual(wheel.advanceTo(9).map((e) => e.id), []);
  assert.deepEqual(wheel.advanceTo(10).map((e) => e.id), ['rev2']);
  assert.equal(wheel.size, 0);
});

test('multiple revolutions: many entries across many wraps fire at their exact tick, in order', () => {
  const wheelSize = 3;
  const wheel = new HashedTimingWheel({ wheelSize });
  const dueTicks = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
  for (const tick of dueTicks) {
    wheel.schedule(`t${tick}`, tick, tick);
  }

  const fired = wheel.advanceTo(15);
  assert.deepEqual(
    fired.map((e) => e.tick),
    dueTicks
  );
  assert.equal(wheel.size, 0);
});

test('cancellation: removes the entry so it never fires, and decrements size', () => {
  const wheel = new HashedTimingWheel({ wheelSize: 4 });
  wheel.schedule('a', 3, 'a');
  wheel.schedule('b', 3, 'b');
  assert.equal(wheel.cancel('a'), true);
  assert.equal(wheel.size, 1);

  const fired = wheel.advanceTo(3);
  assert.deepEqual(fired.map((e) => e.id), ['b']);
});

test('cancellation: unknown id returns false, does not throw', () => {
  const wheel = new HashedTimingWheel({ wheelSize: 4 });
  assert.equal(wheel.cancel('nope'), false);
  wheel.schedule('a', 3, 'a');
  wheel.advanceTo(3);
  assert.equal(wheel.cancel('a'), false); // already fired
});

test('cancellation: non-string id throws TypeError', () => {
  const wheel = new HashedTimingWheel({ wheelSize: 4 });
  assert.throws(() => wheel.cancel(42), TypeError);
  assert.throws(() => wheel.cancel(null), TypeError);
});

test('cancellation: an emptied bucket slot does not leave a stale next-event lookup', () => {
  const wheel = new HashedTimingWheel({ wheelSize: 4 });
  wheel.schedule('only', 3, 'x');
  wheel.cancel('only');
  assert.equal(wheel.peekNext(), null);
  assert.deepEqual(wheel.advanceTo(3), []);
});

test('rescheduling: moves the due tick and preserves the original value', () => {
  const wheel = new HashedTimingWheel({ wheelSize: 4 });
  wheel.schedule('a', 3, { payload: 'original' });
  assert.equal(wheel.reschedule('a', 9), true);

  assert.deepEqual(wheel.advanceTo(3), []); // not due yet at old tick
  const fired = wheel.advanceTo(9);
  assert.deepEqual(fired, [{ id: 'a', tick: 9, value: { payload: 'original' } }]);
});

test('rescheduling: unknown id throws', () => {
  const wheel = new HashedTimingWheel({ wheelSize: 4 });
  assert.throws(() => wheel.reschedule('ghost', 5), /not currently scheduled/);
});

test('rescheduling: non-string id throws TypeError', () => {
  const wheel = new HashedTimingWheel({ wheelSize: 4 });
  assert.throws(() => wheel.reschedule(42, 5), TypeError);
});

test('rescheduling: non-future newDueTick throws RangeError', () => {
  const wheel = new HashedTimingWheel({ wheelSize: 4 });
  wheel.schedule('a', 5, 'x');
  assert.throws(() => wheel.reschedule('a', 0), RangeError);
  assert.throws(() => wheel.reschedule('a', -1), RangeError);
  assert.throws(() => wheel.reschedule('a', 1.2), RangeError);
  // entry must still be intact and fire normally after the failed attempts
  const fired = wheel.advanceTo(5);
  assert.deepEqual(fired, [{ id: 'a', tick: 5, value: 'x' }]);
});

test('rescheduling: an already-fired id cannot be rescheduled', () => {
  const wheel = new HashedTimingWheel({ wheelSize: 4 });
  wheel.schedule('a', 3, 'x');
  wheel.advanceTo(3);
  assert.throws(() => wheel.reschedule('a', 10), /not currently scheduled/);
});

test('rescheduling: same-tick ordering reflects reschedule as the new placement order', () => {
  const wheel = new HashedTimingWheel({ wheelSize: 8 });
  wheel.schedule('a', 5, 'a');
  wheel.schedule('b', 5, 'b');
  wheel.schedule('c', 9, 'c'); // parked elsewhere first
  wheel.reschedule('c', 5); // now placed after a and b at tick 5

  const fired = wheel.advanceTo(5);
  assert.deepEqual(
    fired.map((e) => e.id),
    ['a', 'b', 'c']
  );
});

test('rescheduling: moving within the same bucket (different revolution) still lands at the right tick', () => {
  const wheel = new HashedTimingWheel({ wheelSize: 4 });
  wheel.schedule('a', 2, 'a'); // bucket 2
  wheel.reschedule('a', 6); // still bucket 2 (6 % 4 === 2), different revolution
  assert.deepEqual(wheel.advanceTo(2), []);
  assert.deepEqual(wheel.advanceTo(6), [{ id: 'a', tick: 6, value: 'a' }]);
});

test('peekNext: non-mutating — does not change size, currentTick, or the entry set', () => {
  const wheel = new HashedTimingWheel({ wheelSize: 4 });
  wheel.schedule('a', 5, 'a');
  wheel.schedule('b', 3, 'b');

  const first = wheel.peekNext();
  const second = wheel.peekNext();
  assert.deepEqual(first, { id: 'b', tick: 3, value: 'b' });
  assert.deepEqual(second, first);
  assert.equal(wheel.size, 2);
  assert.equal(wheel.currentTick, 0);

  // mutating the returned object must not affect internal state
  first.value = 'tampered';
  assert.deepEqual(wheel.peekNext(), { id: 'b', tick: 3, value: 'b' });
});

test('peekNext: reflects cancellation and rescheduling immediately', () => {
  const wheel = new HashedTimingWheel({ wheelSize: 4 });
  wheel.schedule('a', 3, 'a');
  wheel.schedule('b', 5, 'b');
  assert.equal(wheel.peekNext().id, 'a');

  wheel.cancel('a');
  assert.equal(wheel.peekNext().id, 'b');

  wheel.schedule('c', 4, 'c');
  wheel.reschedule('c', 1);
  assert.equal(wheel.peekNext().id, 'c');
});

test('repeated advancement: stepping tick-by-tick fires the same set, in the same order, as one big jump', () => {
  const makeLoaded = () => {
    const wheel = new HashedTimingWheel({ wheelSize: 5 });
    wheel.schedule('a', 2, 'a');
    wheel.schedule('b', 2, 'b');
    wheel.schedule('c', 7, 'c');
    wheel.schedule('d', 12, 'd');
    wheel.schedule('e', 4, 'e');
    return wheel;
  };

  const bigJump = makeLoaded();
  const bigJumpFired = bigJump.advanceTo(20);

  const stepped = makeLoaded();
  let steppedFired = [];
  for (let t = 1; t <= 20; t += 1) {
    steppedFired = steppedFired.concat(stepped.advanceTo(t));
  }

  assert.deepEqual(steppedFired, bigJumpFired);
  assert.equal(stepped.currentTick, bigJump.currentTick);
  assert.equal(stepped.size, bigJump.size);
});

test('repeated advancement: calling advanceTo with the current tick again is a no-op', () => {
  const wheel = new HashedTimingWheel({ wheelSize: 4 });
  wheel.schedule('a', 3, 'a');
  const fired = wheel.advanceTo(3);
  assert.equal(fired.length, 1);
  assert.deepEqual(wheel.advanceTo(3), []);
  assert.equal(wheel.currentTick, 3);
});

test('exactly-once firing: an entry returned by advanceTo never appears again', () => {
  const wheel = new HashedTimingWheel({ wheelSize: 4 });
  wheel.schedule('a', 3, 'a');
  const firstAdvance = wheel.advanceTo(3);
  const secondAdvance = wheel.advanceTo(20);
  assert.deepEqual(firstAdvance.map((e) => e.id), ['a']);
  assert.deepEqual(secondAdvance, []);
  assert.equal(wheel.size, 0);
});

test('exactly-once firing: overlapping/adjacent advanceTo calls never double-fire, across many entries', () => {
  const wheel = new HashedTimingWheel({ wheelSize: 6 });
  const total = 60;
  for (let i = 0; i < total; i += 1) {
    wheel.schedule(`e${i}`, i + 1, i);
  }

  const seen = new Set();
  for (let t = 1; t <= total; t += 1) {
    const fired = wheel.advanceTo(t);
    for (const entry of fired) {
      assert.equal(seen.has(entry.id), false, `${entry.id} fired more than once`);
      seen.add(entry.id);
    }
  }
  assert.equal(seen.size, total);
  assert.equal(wheel.size, 0);
});

test('advanceTo: invalid targetTick throws RangeError', () => {
  const wheel = new HashedTimingWheel({ wheelSize: 4, startTick: 5 });
  assert.throws(() => wheel.advanceTo(4), RangeError); // backward
  assert.throws(() => wheel.advanceTo(5.5), RangeError);
  assert.throws(() => wheel.advanceTo(NaN), RangeError);
  assert.throws(() => wheel.advanceTo(Infinity), RangeError);
});

test('advanceTo: skipping over an untouched tick range with nothing scheduled is safe', () => {
  const wheel = new HashedTimingWheel({ wheelSize: 4 });
  assert.deepEqual(wheel.advanceTo(1_000_000), []);
  assert.equal(wheel.currentTick, 1_000_000);
});

test('integration: schedule, cancel, reschedule, and advance interleaved across wraps', () => {
  const wheel = new HashedTimingWheel({ wheelSize: 3, startTick: 0 });
  wheel.schedule('keep1', 1, 'keep1');
  wheel.schedule('cancelMe', 1, 'cancelMe');
  wheel.schedule('keep2', 4, 'keep2'); // bucket 1, next revolution
  wheel.schedule('rescheduleMe', 2, 'orig');

  wheel.cancel('cancelMe');
  wheel.reschedule('rescheduleMe', 7); // bucket 1, two revolutions out

  const fired = wheel.advanceTo(10);
  assert.deepEqual(
    fired.map((e) => ({ id: e.id, tick: e.tick, value: e.value })),
    [
      { id: 'keep1', tick: 1, value: 'keep1' },
      { id: 'keep2', tick: 4, value: 'keep2' },
      { id: 'rescheduleMe', tick: 7, value: 'orig' },
    ]
  );
  assert.equal(wheel.size, 0);
});
