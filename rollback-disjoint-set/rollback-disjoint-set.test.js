'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { RollbackDisjointSet } = require('./rollback-disjoint-set.js');

test('constructor rejects invalid sizes', () => {
  assert.throws(() => new RollbackDisjointSet(-1), TypeError);
  assert.throws(() => new RollbackDisjointSet(1.5), TypeError);
  assert.throws(() => new RollbackDisjointSet('3'), TypeError);
  assert.throws(() => new RollbackDisjointSet(null), TypeError);
  assert.throws(() => new RollbackDisjointSet(NaN), TypeError);
});

test('empty set (size 0): componentCount is 0, any index access throws', () => {
  const dsu = new RollbackDisjointSet(0);
  assert.equal(dsu.componentCount, 0);
  assert.throws(() => dsu.find(0), TypeError);
  assert.throws(() => dsu.union(0, 0), TypeError);
});

test('singleton set (size 1): one component, self-connected, union(0,0) is a no-op', () => {
  const dsu = new RollbackDisjointSet(1);
  assert.equal(dsu.componentCount, 1);
  assert.equal(dsu.find(0), 0);
  assert.equal(dsu.connected(0, 0), true);
  assert.equal(dsu.componentSize(0), 1);
  assert.equal(dsu.union(0, 0), false);
  assert.equal(dsu.componentCount, 1);
});

test('every index starts as its own singleton component', () => {
  const dsu = new RollbackDisjointSet(5);
  assert.equal(dsu.componentCount, 5);
  for (let i = 0; i < 5; i++) {
    assert.equal(dsu.find(i), i);
    assert.equal(dsu.componentSize(i), 1);
  }
});

test('union() merges components, connected()/componentSize()/componentCount update, returns true', () => {
  const dsu = new RollbackDisjointSet(4);
  assert.equal(dsu.union(0, 1), true);
  assert.equal(dsu.connected(0, 1), true);
  assert.equal(dsu.componentSize(0), 2);
  assert.equal(dsu.componentCount, 3);
  assert.equal(dsu.connected(0, 2), false);
});

test('self-union and duplicate unions are no-ops returning false, without changing componentCount', () => {
  const dsu = new RollbackDisjointSet(3);
  assert.equal(dsu.union(1, 1), false); // self-union
  assert.equal(dsu.componentCount, 3);
  assert.equal(dsu.union(0, 1), true);
  assert.equal(dsu.componentCount, 2);
  assert.equal(dsu.union(0, 1), false); // duplicate union -- already connected
  assert.equal(dsu.union(1, 0), false); // duplicate union, reversed argument order
  assert.equal(dsu.componentCount, 2);
});

test('deterministic tie-breaking: on an exact size tie, the first argument\'s root wins', () => {
  const dsu = new RollbackDisjointSet(4);
  // 0 and 1 are both singletons (tied size 1) -- x's root (0) must win.
  dsu.union(0, 1);
  assert.equal(dsu.find(0), 0);
  assert.equal(dsu.find(1), 0);

  // 2 and 3 are both singletons -- x's root (2) must win.
  dsu.union(2, 3);
  assert.equal(dsu.find(2), 2);
  assert.equal(dsu.find(3), 2);

  // {0,1} (size 2) and {2,3} (size 2) are tied -- union(0, 2): x=0's root wins.
  dsu.union(0, 2);
  assert.equal(dsu.find(0), 0);
  assert.equal(dsu.find(1), 0);
  assert.equal(dsu.find(2), 0);
  assert.equal(dsu.find(3), 0);
  assert.equal(dsu.componentSize(0), 4);

  // Reversed argument order on a tie: union(y, x) should make y's root win instead.
  const dsu2 = new RollbackDisjointSet(2);
  dsu2.union(1, 0); // tie -- x=1's root must win this time
  assert.equal(dsu2.find(0), 1);
  assert.equal(dsu2.find(1), 1);
});

test('union() by size: the larger component always absorbs the smaller one, regardless of argument order', () => {
  const dsu = new RollbackDisjointSet(5);
  dsu.union(0, 1);
  dsu.union(0, 2); // {0,1,2} size 3
  // Merge the size-3 component with singleton 3, arguments reversed (y is the big one).
  dsu.union(3, 0);
  assert.equal(dsu.find(3), dsu.find(0));
  assert.equal(dsu.componentSize(0), 4);
});

test('snapshot()/rollback() restore parents, sizes, and componentCount to exactly the captured point', () => {
  const dsu = new RollbackDisjointSet(4);
  const s0 = dsu.snapshot();
  dsu.union(0, 1);
  dsu.union(2, 3);
  assert.equal(dsu.componentCount, 2);
  dsu.rollback(s0);
  assert.equal(dsu.componentCount, 4);
  for (let i = 0; i < 4; i++) {
    assert.equal(dsu.find(i), i);
    assert.equal(dsu.componentSize(i), 1);
  }
});

test('nested snapshots: rolling back to an inner snapshot only undoes operations after it', () => {
  const dsu = new RollbackDisjointSet(6);
  dsu.union(0, 1); // {0,1}
  const outer = dsu.snapshot();
  dsu.union(2, 3); // {2,3}
  const inner = dsu.snapshot();
  dsu.union(4, 5); // {4,5}
  assert.equal(dsu.componentCount, 3);

  dsu.rollback(inner);
  // {4,5} undone, but {0,1} and {2,3} (from before `inner`) remain.
  assert.equal(dsu.componentCount, 4);
  assert.equal(dsu.connected(0, 1), true);
  assert.equal(dsu.connected(2, 3), true);
  assert.equal(dsu.connected(4, 5), false);

  dsu.rollback(outer);
  // {2,3} also undone now, but {0,1} (from before `outer`) remains.
  assert.equal(dsu.componentCount, 5);
  assert.equal(dsu.connected(0, 1), true);
  assert.equal(dsu.connected(2, 3), false);
});

test('repeated rollbacks to the same token are idempotent and restore counts/sizes correctly', () => {
  const dsu = new RollbackDisjointSet(4);
  const s0 = dsu.snapshot();
  dsu.union(0, 1);
  dsu.union(0, 2);
  assert.equal(dsu.componentSize(0), 3);
  assert.equal(dsu.componentCount, 2);

  dsu.rollback(s0);
  assert.equal(dsu.componentCount, 4);
  assert.equal(dsu.componentSize(0), 1);

  // Rolling back to the same already-current token again must be a safe no-op.
  dsu.rollback(s0);
  assert.equal(dsu.componentCount, 4);
  assert.equal(dsu.componentSize(0), 1);
});

test('rollback() rejects invalid or already-invalidated snapshot tokens without mutating state', () => {
  const dsu = new RollbackDisjointSet(3);
  dsu.union(0, 1);
  const futureToken = dsu.snapshot(); // valid right now
  const before = { count: dsu.componentCount, size0: dsu.componentSize(0) };

  assert.throws(() => dsu.rollback(-1), TypeError);
  assert.throws(() => dsu.rollback(1.5), TypeError);
  assert.throws(() => dsu.rollback('0'), TypeError);
  assert.throws(() => dsu.rollback(null), TypeError);
  assert.throws(() => dsu.rollback(futureToken + 5), TypeError); // never issued

  assert.deepEqual({ count: dsu.componentCount, size0: dsu.componentSize(0) }, before);

  // Now invalidate `futureToken` by rolling back past it (to token 0, the
  // very start), then confirm reusing that now-stale token throws.
  dsu.rollback(0);
  assert.throws(() => dsu.rollback(futureToken), TypeError);
});

test('find()/union()/connected()/componentSize() reject invalid indices without mutating state', () => {
  const dsu = new RollbackDisjointSet(3);
  dsu.union(0, 1);
  const before = { count: dsu.componentCount, size0: dsu.componentSize(0) };

  assert.throws(() => dsu.find(-1), TypeError);
  assert.throws(() => dsu.find(3), TypeError);
  assert.throws(() => dsu.find(1.5), TypeError);
  assert.throws(() => dsu.find('0'), TypeError);
  assert.throws(() => dsu.find(null), TypeError);
  assert.throws(() => dsu.union(0, 3), TypeError);
  assert.throws(() => dsu.union(-1, 0), TypeError);
  assert.throws(() => dsu.connected(0, 3), TypeError);
  assert.throws(() => dsu.componentSize(3), TypeError);

  assert.deepEqual({ count: dsu.componentCount, size0: dsu.componentSize(0) }, before);
});

test('deterministic multi-operation sequence matches an independent reference-model implementation', () => {
  // Reference model: same union-by-size + first-root-wins-ties semantics,
  // but with a completely different (and obviously-correct) rollback
  // strategy -- snapshot() deep-copies the full parent/size/count state,
  // rollback() just restores the copy -- rather than the real
  // implementation's history-stack-of-diffs approach. Cross-checking
  // find()/componentSize()/componentCount after every operation against
  // this independent strategy is a strong correctness signal for the
  // real (more efficient) implementation.
  class RefDSU {
    constructor(size) {
      this.parent = Array.from({ length: size }, (_, i) => i);
      this.sz = new Array(size).fill(1);
      this.count = size;
    }
    find(x) {
      let root = x;
      while (this.parent[root] !== root) root = this.parent[root];
      return root;
    }
    componentSize(x) {
      return this.sz[this.find(x)];
    }
    union(x, y) {
      const rx = this.find(x);
      const ry = this.find(y);
      if (rx === ry) return false;
      let winner;
      let loser;
      if (this.sz[rx] >= this.sz[ry]) {
        winner = rx;
        loser = ry;
      } else {
        winner = ry;
        loser = rx;
      }
      this.parent[loser] = winner;
      this.sz[winner] += this.sz[loser];
      this.count--;
      return true;
    }
    snapshot() {
      return { parent: this.parent.slice(), sz: this.sz.slice(), count: this.count };
    }
    rollback(snap) {
      this.parent = snap.parent.slice();
      this.sz = snap.sz.slice();
      this.count = snap.count;
    }
  }

  const SIZE = 8;
  const dsu = new RollbackDisjointSet(SIZE);
  const ref = new RefDSU(SIZE);
  const dsuTokens = new Map();
  const refTokens = new Map();

  function assertMatch(label) {
    assert.equal(dsu.componentCount, ref.count, `componentCount mismatch ${label}`);
    for (let i = 0; i < SIZE; i++) {
      assert.equal(dsu.find(i), ref.find(i), `find(${i}) mismatch ${label}`);
      assert.equal(dsu.componentSize(i), ref.componentSize(i), `componentSize(${i}) mismatch ${label}`);
    }
  }

  const ops = [
    ['union', 0, 1],
    ['union', 2, 3],
    ['snapshot', 'A'],
    ['union', 0, 2],
    ['union', 4, 5],
    ['snapshot', 'B'],
    ['union', 4, 0],
    ['union', 6, 6],
    ['union', 6, 7],
    ['rollback', 'B'],
    ['union', 6, 7],
    ['snapshot', 'C'],
    ['union', 1, 6],
    ['rollback', 'A'],
    ['union', 5, 6],
    ['union', 5, 7],
  ];

  for (const op of ops) {
    if (op[0] === 'union') {
      const [, x, y] = op;
      const a = dsu.union(x, y);
      const b = ref.union(x, y);
      assert.equal(a, b, `union(${x},${y}) return-value mismatch`);
    } else if (op[0] === 'snapshot') {
      const [, label] = op;
      dsuTokens.set(label, dsu.snapshot());
      refTokens.set(label, ref.snapshot());
    } else if (op[0] === 'rollback') {
      const [, label] = op;
      dsu.rollback(dsuTokens.get(label));
      ref.rollback(refTokens.get(label));
    }
    assertMatch(`after ${JSON.stringify(op)}`);
  }
});
