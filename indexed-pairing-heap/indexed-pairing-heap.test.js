'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { IndexedPairingHeap } = require('./indexed-pairing-heap.js');

// ---------------------------------------------------------------------------
// Whitebox structural invariant checker: walks the internal child/sibling
// tree and verifies (a) heap order (every node's priority is <= all of its
// descendants' priorities, with ties allowed) and (b) that every `prev`
// pointer correctly means "parent, if leftmost child" or "left sibling,
// otherwise" -- i.e. the dual-purpose back-link the O(1) cut relies on is
// actually consistent. Also cross-checks the live node count against the
// heap's own `.size`.

function checkInvariants(heap) {
  let count = 0;

  function walk(node, parent, leftSibling, minAllowed) {
    if (node === null) return;
    count++;
    assert.ok(
      node.priority >= minAllowed,
      `heap-order violated: node priority ${node.priority} < ancestor priority ${minAllowed}`
    );
    assert.equal(node.removed, false, 'a removed node must not still be reachable from the root');

    if (leftSibling === null) {
      // node is the leftmost child of `parent` (or is the root, parent===null).
      assert.equal(node.prev, parent, "leftmost child's prev must point at its parent");
    } else {
      assert.equal(node.prev, leftSibling, "non-leftmost sibling's prev must point at its left sibling");
    }

    walk(node.child, node, null, node.priority);
    walk(node.sibling, parent, node, minAllowed);
  }

  walk(heap._root, null, null, -Infinity);
  assert.equal(count, heap.size, 'live reachable node count must match heap.size');
}

// ---------------------------------------------------------------------------

test('an empty heap has size 0 and peek()/pop() both throw RangeError', () => {
  const h = new IndexedPairingHeap();
  assert.equal(h.size, 0);
  assert.throws(() => h.peek(), RangeError);
  assert.throws(() => h.pop(), RangeError);
  checkInvariants(h);
});

test('insert() rejects non-finite priorities with TypeError, and never mutates the heap when it throws', () => {
  const h = new IndexedPairingHeap();
  for (const bad of [NaN, Infinity, -Infinity, '1', null, undefined, {}, [], true]) {
    assert.throws(() => h.insert(bad, 'x'), TypeError);
  }
  assert.equal(h.size, 0);
  checkInvariants(h);
});

test('single insert/peek/pop round-trips the exact priority and value', () => {
  const h = new IndexedPairingHeap();
  h.insert(5, 'hello');
  assert.equal(h.size, 1);
  assert.deepEqual(h.peek(), { priority: 5, value: 'hello' });
  assert.equal(h.size, 1, 'peek() must not remove anything');
  const popped = h.pop();
  assert.deepEqual(popped, { priority: 5, value: 'hello' });
  assert.equal(h.size, 0);
  assert.throws(() => h.peek(), RangeError);
});

test('popping several distinct priorities returns them in ascending order regardless of insertion order', () => {
  const h = new IndexedPairingHeap();
  const values = [50, 10, 40, 20, 30, 5, 100, 1];
  for (const v of values) h.insert(v, `v${v}`);
  checkInvariants(h);
  const popped = [];
  while (h.size > 0) {
    popped.push(h.pop().priority);
    checkInvariants(h);
  }
  assert.deepEqual(popped, [...values].sort((a, b) => a - b));
});

test('equal priorities are drained in FIFO insertion order', () => {
  const h = new IndexedPairingHeap();
  h.insert(7, 'a');
  h.insert(3, 'z');
  h.insert(7, 'b');
  h.insert(7, 'c');
  h.insert(3, 'y');
  // priority 3 items first (insertion order z, y), then priority 7 items (a, b, c).
  assert.equal(h.pop().value, 'z');
  assert.equal(h.pop().value, 'y');
  assert.equal(h.pop().value, 'a');
  assert.equal(h.pop().value, 'b');
  assert.equal(h.pop().value, 'c');
  assert.equal(h.size, 0);
});

test('a large batch of duplicate-priority inserts still drains in exact FIFO order among themselves', () => {
  const h = new IndexedPairingHeap();
  const labels = [];
  for (let i = 0; i < 200; i++) {
    h.insert(42, `item-${i}`);
    labels.push(`item-${i}`);
  }
  checkInvariants(h);
  const popped = [];
  while (h.size > 0) popped.push(h.pop().value);
  assert.deepEqual(popped, labels);
});

test('decreaseKey on the current root leaves it as the root and updates its priority', () => {
  const h = new IndexedPairingHeap();
  const hRoot = h.insert(1, 'root');
  h.insert(5, 'other');
  h.decreaseKey(hRoot, -10);
  checkInvariants(h);
  assert.equal(h.peek().priority, -10);
  assert.equal(h.peek().value, 'root');
});

test('decreaseKey on a non-root node can promote it to become the new minimum', () => {
  const h = new IndexedPairingHeap();
  h.insert(1, 'a');
  const hb = h.insert(50, 'b');
  h.insert(2, 'c');
  h.insert(3, 'd');
  checkInvariants(h);
  h.decreaseKey(hb, -100);
  checkInvariants(h);
  const popped = h.pop();
  assert.deepEqual(popped, { priority: -100, value: 'b' });
});

test('decreaseKey to the exact same priority is a documented no-op and does not disturb tie-break order', () => {
  const h = new IndexedPairingHeap();
  h.insert(5, 'first');
  const hb = h.insert(5, 'second');
  h.decreaseKey(hb, 5); // no-op: equal priority, not an "increase"
  checkInvariants(h);
  // 'first' was inserted earlier, so it must still come out first even
  // though decreaseKey touched 'second'.
  assert.equal(h.pop().value, 'first');
  assert.equal(h.pop().value, 'second');
});

test('decreaseKey rejects an actual priority increase with RangeError and leaves the heap unchanged', () => {
  const h = new IndexedPairingHeap();
  const ha = h.insert(5, 'a');
  assert.throws(() => h.decreaseKey(ha, 6), RangeError);
  assert.equal(h.peek().priority, 5, 'the rejected increase must not have taken effect');
});

test('decreaseKey rejects non-finite new priorities with TypeError', () => {
  const h = new IndexedPairingHeap();
  const ha = h.insert(5, 'a');
  for (const bad of [NaN, Infinity, -Infinity, 'x', null, {}]) {
    assert.throws(() => h.decreaseKey(ha, bad), TypeError);
  }
  assert.equal(h.peek().priority, 5);
});

test('delete() on a leaf node removes exactly that element and nothing else', () => {
  const h = new IndexedPairingHeap();
  h.insert(1, 'a');
  const hb = h.insert(2, 'b');
  h.insert(3, 'c');
  checkInvariants(h);
  const removed = h.delete(hb);
  assert.deepEqual(removed, { priority: 2, value: 'b' });
  checkInvariants(h);
  assert.equal(h.size, 2);
  const rest = [h.pop().value, h.pop().value];
  assert.deepEqual(rest.sort(), ['a', 'c']);
});

test('delete() on the current root behaves like pop() and re-consolidates its children', () => {
  const h = new IndexedPairingHeap();
  const ha = h.insert(1, 'a');
  h.insert(2, 'b');
  h.insert(3, 'c');
  h.insert(4, 'd');
  checkInvariants(h);
  const removed = h.delete(ha);
  assert.deepEqual(removed, { priority: 1, value: 'a' });
  checkInvariants(h);
  assert.equal(h.size, 3);
  const rest = [];
  while (h.size > 0) rest.push(h.pop().priority);
  assert.deepEqual(rest, [2, 3, 4]);
});

test('delete() on an internal (non-root, non-leaf) node reattaches its children to the rest of the heap', () => {
  const h = new IndexedPairingHeap();
  // Build a heap deep enough that some inserted node is very likely to end
  // up as an internal node with its own children by the time we delete it;
  // then confirm via full drain that no element is lost or duplicated.
  const handles = [];
  const expected = [];
  for (let i = 0; i < 30; i++) {
    const p = (i * 37) % 101;
    handles.push(h.insert(p, `n${i}`));
    expected.push([p, `n${i}`]);
  }
  checkInvariants(h);
  // Delete a handful of arbitrary elements (by handle, not necessarily the root).
  const toDelete = [handles[5], handles[12], handles[19], handles[0]];
  const deletedValues = new Set(toDelete.map((hd) => hd.node.value));
  for (const hd of toDelete) {
    h.delete(hd);
    checkInvariants(h);
  }
  assert.equal(h.size, 30 - toDelete.length);
  const remaining = [];
  while (h.size > 0) remaining.push(h.pop());
  const remainingValues = remaining.map((r) => r.value).sort();
  const expectedRemainingValues = expected
    .map(([, v]) => v)
    .filter((v) => !deletedValues.has(v))
    .sort();
  assert.deepEqual(remainingValues, expectedRemainingValues);
  // Confirm the drained order was still fully ascending by priority.
  for (let i = 1; i < remaining.length; i++) {
    assert.ok(remaining[i].priority >= remaining[i - 1].priority);
  }
});

test('delete() and decreaseKey() both throw RangeError on a null/undefined/plain-object/primitive "handle"', () => {
  const h = new IndexedPairingHeap();
  h.insert(1, 'a');
  for (const bad of [null, undefined, {}, 42, 'handle', [], true]) {
    assert.throws(() => h.delete(bad), RangeError);
    assert.throws(() => h.decreaseKey(bad, 0), RangeError);
  }
});

test('delete() and decreaseKey() throw RangeError for a genuine handle from a DIFFERENT heap instance', () => {
  const h1 = new IndexedPairingHeap();
  const h2 = new IndexedPairingHeap();
  const foreignHandle = h2.insert(1, 'from h2');
  h1.insert(5, 'in h1');
  assert.throws(() => h1.delete(foreignHandle), RangeError);
  assert.throws(() => h1.decreaseKey(foreignHandle, 0), RangeError);
  // The foreign handle must still work correctly on its OWN heap.
  assert.deepEqual(h2.pop(), { priority: 1, value: 'from h2' });
});

test('delete() and decreaseKey() throw RangeError for a stale handle (already popped)', () => {
  const h = new IndexedPairingHeap();
  const ha = h.insert(1, 'a');
  h.insert(2, 'b');
  h.pop(); // pops 'a', which invalidates ha
  assert.throws(() => h.delete(ha), RangeError);
  assert.throws(() => h.decreaseKey(ha, -5), RangeError);
});

test('delete() and decreaseKey() throw RangeError for a stale handle (already deleted, including double-delete)', () => {
  const h = new IndexedPairingHeap();
  const ha = h.insert(1, 'a');
  h.insert(2, 'b');
  h.delete(ha);
  assert.throws(() => h.delete(ha), RangeError, 'deleting the same handle twice must throw, not double-count size');
  assert.throws(() => h.decreaseKey(ha, -5), RangeError);
  assert.equal(h.size, 1);
});

test('size is a read-only getter: attempting to assign it throws in strict mode', () => {
  const h = new IndexedPairingHeap();
  h.insert(1, 'a');
  assert.throws(() => {
    h.size = 999;
  }, TypeError);
  assert.equal(h.size, 1);
});

test('a long interleaved sequence of insert/pop/decreaseKey/delete stays internally consistent throughout', () => {
  const h = new IndexedPairingHeap();
  const live = new Map(); // value label -> handle
  let counter = 0;

  function ins(p) {
    const label = `x${counter++}`;
    const hd = h.insert(p, label);
    live.set(label, { handle: hd, priority: p });
    checkInvariants(h);
  }

  ins(10);
  ins(3);
  ins(7);
  ins(1);
  ins(9);
  checkInvariants(h);

  assert.equal(h.pop().value, 'x3'); // priority 1

  const entry = live.get('x0'); // priority 10
  h.decreaseKey(entry.handle, -5);
  checkInvariants(h);
  assert.equal(h.peek().value, 'x0');

  ins(2);
  ins(4);

  const toDeleteEntry = live.get('x2'); // priority 7
  h.delete(toDeleteEntry.handle);
  checkInvariants(h);

  const drained = [];
  while (h.size > 0) drained.push(h.pop());
  const priorities = drained.map((d) => d.priority);
  for (let i = 1; i < priorities.length; i++) {
    assert.ok(priorities[i] >= priorities[i - 1], 'must drain in non-decreasing priority order');
  }
  const drainedLabels = drained.map((d) => d.value).sort();
  // x3 popped explicitly, x2 deleted explicitly; everything else must appear exactly once.
  assert.deepEqual(drainedLabels, ['x0', 'x1', 'x4', 'x5', 'x6'].sort());
});

// ---------------------------------------------------------------------------
// Randomized differential test against an intentionally simple, structurally
// unrelated reference priority queue: a plain array, scanned linearly for
// the minimum (by priority, then by insertion sequence for ties), and
// spliced on removal. O(n) per operation, but its correctness is obvious by
// inspection -- exactly the property we want in an oracle.

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class ReferenceQueue {
  constructor() {
    this._items = []; // { seq, priority, value, id, alive }
    this._nextSeq = 0;
  }
  get size() {
    return this._items.length;
  }
  insert(priority, value, id) {
    this._items.push({ seq: this._nextSeq++, priority, value, id });
  }
  _minIndex() {
    let best = -1;
    for (let i = 0; i < this._items.length; i++) {
      if (
        best === -1 ||
        this._items[i].priority < this._items[best].priority ||
        (this._items[i].priority === this._items[best].priority && this._items[i].seq < this._items[best].seq)
      ) {
        best = i;
      }
    }
    return best;
  }
  peek() {
    const i = this._minIndex();
    const it = this._items[i];
    return { priority: it.priority, value: it.value };
  }
  pop() {
    const i = this._minIndex();
    const [it] = this._items.splice(i, 1);
    return { priority: it.priority, value: it.value, id: it.id };
  }
  decreaseKey(id, priority) {
    const it = this._items.find((x) => x.id === id);
    it.priority = priority;
  }
  delete(id) {
    const i = this._items.findIndex((x) => x.id === id);
    const [it] = this._items.splice(i, 1);
    return { priority: it.priority, value: it.value };
  }
}

test('randomized differential stress test against a simple linear-scan reference queue', () => {
  const rand = mulberry32(20260808);
  const h = new IndexedPairingHeap();
  const ref = new ReferenceQueue();
  const liveIds = []; // ids currently present in both structures
  const handleById = new Map(); // id -> real heap Handle
  let nextId = 0;
  const totalOps = 6000;
  let inserted = 0;
  let popped = 0;
  let decreased = 0;
  let deleted = 0;

  for (let i = 0; i < totalOps; i++) {
    const roll = rand();
    if (roll < 0.45 || liveIds.length === 0) {
      // insert
      const priority = Math.floor(rand() * 2000) - 1000;
      const id = nextId++;
      const value = `v${id}`;
      const hd = h.insert(priority, value);
      ref.insert(priority, value, id);
      handleById.set(id, hd);
      liveIds.push(id);
      inserted++;
    } else if (roll < 0.65) {
      // pop
      assert.equal(h.size, ref.size, `size mismatch before pop at op ${i}`);
      const got = h.pop();
      const want = ref.pop();
      assert.equal(got.priority, want.priority, `pop priority mismatch at op ${i}`);
      assert.equal(got.value, want.value, `pop value mismatch at op ${i}`);
      const idx = liveIds.indexOf(want.id);
      liveIds.splice(idx, 1);
      handleById.delete(want.id);
      popped++;
    } else if (roll < 0.85) {
      // decreaseKey on a random live element, by an amount that guarantees
      // it is a real (or zero) decrease relative to its CURRENT priority.
      const idx = Math.floor(rand() * liveIds.length);
      const id = liveIds[idx];
      const hd = handleById.get(id);
      const currentPriority = hd.node.priority;
      const delta = Math.floor(rand() * 50); // 0..49, always >= 0
      const newPriority = currentPriority - delta;
      h.decreaseKey(hd, newPriority);
      ref.decreaseKey(id, newPriority);
      decreased++;
    } else {
      // delete a random live element (not necessarily the minimum).
      const idx = Math.floor(rand() * liveIds.length);
      const id = liveIds[idx];
      const hd = handleById.get(id);
      const got = h.delete(hd);
      const want = ref.delete(id);
      assert.equal(got.priority, want.priority, `delete priority mismatch at op ${i}`);
      assert.equal(got.value, want.value, `delete value mismatch at op ${i}`);
      liveIds.splice(idx, 1);
      handleById.delete(id);
      deleted++;
    }

    if (i % 250 === 0) checkInvariants(h);
  }

  checkInvariants(h);
  assert.equal(h.size, ref.size, 'final size mismatch');

  // Fully drain both and compare the entire output sequence exactly.
  const gotAll = [];
  const wantAll = [];
  while (h.size > 0) gotAll.push(h.pop());
  while (ref.size > 0) wantAll.push(ref.pop());
  assert.equal(gotAll.length, wantAll.length);
  for (let i = 0; i < gotAll.length; i++) {
    assert.equal(gotAll[i].priority, wantAll[i].priority, `final drain priority mismatch at index ${i}`);
    assert.equal(gotAll[i].value, wantAll[i].value, `final drain value mismatch at index ${i}`);
  }

  assert.ok(inserted >= 2000, 'expected a healthy number of inserts to have actually run');
  assert.ok(popped >= 500, 'expected a healthy number of pops to have actually run');
  assert.ok(decreased >= 500, 'expected a healthy number of decreaseKeys to have actually run');
  assert.ok(deleted >= 500, 'expected a healthy number of deletes to have actually run');
});
