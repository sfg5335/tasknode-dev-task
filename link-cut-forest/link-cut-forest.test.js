'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { LinkCutForest } = require('./link-cut-forest.js');

// ---- Naive reference forest model, used only by the differential tests
// below. Real (undirected) edges are stored in a plain adjacency-set
// structure; connectivity, path-finding, and sizing are all done by
// straightforward BFS over that structure -- an independent, much
// simpler implementation of the same semantics. ----

class NaiveForest {
  constructor(values) {
    this.n = values.length;
    this.val = values.slice();
    this.adj = Array.from({ length: this.n }, () => new Set());
  }
  _check(v, name) {
    if (typeof v !== 'number' || !Number.isInteger(v)) throw new TypeError(`${name} bad type`);
    if (v < 0 || v >= this.n) throw new RangeError(`${name} out of range`);
  }
  connected(u, v) {
    this._check(u, 'u');
    this._check(v, 'v');
    if (u === v) return true;
    const visited = new Set([u]);
    const queue = [u];
    let qi = 0;
    while (qi < queue.length) {
      const x = queue[qi++];
      for (const nb of this.adj[x]) {
        if (!visited.has(nb)) {
          visited.add(nb);
          queue.push(nb);
        }
      }
    }
    return visited.has(v);
  }
  link(u, v) {
    this._check(u, 'u');
    this._check(v, 'v');
    if (u === v) throw new RangeError('self-link');
    if (this.connected(u, v)) throw new RangeError('cycle');
    this.adj[u].add(v);
    this.adj[v].add(u);
  }
  cut(u, v) {
    this._check(u, 'u');
    this._check(v, 'v');
    if (u === v) throw new RangeError('self-cut');
    if (!this.adj[u].has(v)) throw new RangeError('not an edge');
    this.adj[u].delete(v);
    this.adj[v].delete(u);
  }
  setValue(u, value) {
    this._check(u, 'u');
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError('bad value');
    this.val[u] = value;
  }
  _pathVertices(u, v) {
    const parent = new Map([[u, -1]]);
    const queue = [u];
    let qi = 0;
    while (qi < queue.length) {
      const x = queue[qi++];
      if (x === v) break;
      for (const nb of this.adj[x]) {
        if (!parent.has(nb)) {
          parent.set(nb, x);
          queue.push(nb);
        }
      }
    }
    if (!parent.has(v)) return null;
    const path = [];
    let cur = v;
    while (cur !== -1) {
      path.push(cur);
      cur = parent.get(cur);
    }
    return path;
  }
  pathSum(u, v) {
    this._check(u, 'u');
    this._check(v, 'v');
    if (u !== v && !this.connected(u, v)) throw new RangeError('not connected');
    const path = this._pathVertices(u, v);
    let sum = 0;
    for (const x of path) sum += this.val[x];
    return sum;
  }
  size(u) {
    this._check(u, 'u');
    const visited = new Set([u]);
    const queue = [u];
    let qi = 0;
    while (qi < queue.length) {
      const x = queue[qi++];
      for (const nb of this.adj[x]) {
        if (!visited.has(nb)) {
          visited.add(nb);
          queue.push(nb);
        }
      }
    }
    return visited.size;
  }
}

function makeRng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

test('singleton vertex', () => {
  const f = new LinkCutForest([42]);
  assert.equal(f.size(0), 1);
  assert.equal(f.pathSum(0, 0), 42);
  assert.equal(f.connected(0, 0), true);
});

test('empty forest', () => {
  const f = new LinkCutForest([]);
  assert.throws(() => f.size(0), RangeError);
  assert.throws(() => f.connected(0, 0), RangeError);
  assert.throws(() => f.link(0, 0), RangeError);
});

test('chain: link builds a path, pathSum works both directions and for sub-ranges', () => {
  const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const n = values.length;
  const f = new LinkCutForest(values.slice());
  for (let i = 0; i < n - 1; i++) f.link(i, i + 1);

  const total = values.reduce((a, b) => a + b, 0);
  assert.equal(f.pathSum(0, n - 1), total);
  assert.equal(f.pathSum(n - 1, 0), total, 'pathSum must be symmetric');
  assert.equal(f.size(0), n);
  assert.equal(f.size(n - 1), n);

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const lo = Math.min(i, j);
      const hi = Math.max(i, j);
      const expected = values.slice(lo, hi + 1).reduce((a, b) => a + b, 0);
      assert.equal(f.pathSum(i, j), expected, `pathSum(${i},${j})`);
    }
  }
});

test('star: pathSum through the center for every leaf pair', () => {
  const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  const n = values.length;
  const f = new LinkCutForest(values.slice());
  for (let i = 1; i < n; i++) f.link(0, i);

  assert.equal(f.size(0), n);
  for (let i = 1; i < n; i++) {
    for (let j = 1; j < n; j++) {
      const expected = i === j ? values[i] : values[0] + values[i] + values[j];
      assert.equal(f.pathSum(i, j), expected, `pathSum(${i},${j})`);
    }
  }
});

test('rerooting: pathSum is independent of which endpoint access starts from', () => {
  const values = [5, 10, 15, 20, 25];
  const f = new LinkCutForest(values.slice());
  f.link(0, 1);
  f.link(1, 2);
  f.link(2, 3);
  f.link(3, 4);

  // Repeatedly query in alternating directions; the result must always
  // be the same, and the internal structure must never end up broken by
  // the implicit rerooting each query performs.
  for (let i = 0; i < 5; i++) {
    assert.equal(f.pathSum(0, 4), 75);
    assert.equal(f.pathSum(4, 0), 75);
    assert.equal(f.pathSum(2, 0), 30);
    assert.equal(f.pathSum(0, 2), 30);
    assert.equal(f.pathSum(2, 4), 60);
  }
});

test('cut splits a tree into two independent components', () => {
  const f = new LinkCutForest([1, 2, 3, 4, 5]);
  f.link(0, 1);
  f.link(1, 2);
  f.link(2, 3);
  f.link(3, 4);
  assert.equal(f.connected(0, 4), true);
  assert.equal(f.size(0), 5);

  f.cut(2, 3);
  assert.equal(f.connected(0, 4), false);
  assert.equal(f.connected(0, 2), true);
  assert.equal(f.connected(3, 4), true);
  assert.equal(f.size(0), 3);
  assert.equal(f.size(3), 2);
  assert.equal(f.pathSum(0, 2), 6);
  assert.equal(f.pathSum(3, 4), 9);
  assert.throws(() => f.pathSum(0, 4), RangeError);
});

test('cut then relink reconnects (possibly differently) and queries stay correct', () => {
  const f = new LinkCutForest([1, 2, 3, 4]);
  f.link(0, 1);
  f.link(1, 2);
  f.link(2, 3);
  assert.equal(f.pathSum(0, 3), 10);

  f.cut(1, 2);
  assert.equal(f.connected(0, 3), false);

  // Relink the two halves in a different shape (star from 0 this time).
  f.link(0, 2);
  assert.equal(f.connected(0, 3), true);
  assert.equal(f.pathSum(0, 3), 1 + 3 + 4);
  assert.equal(f.pathSum(1, 3), 2 + 1 + 3 + 4);
  assert.equal(f.size(0), 4);
});

test('setValue updates are reflected in subsequent pathSum/queries, including repeated updates', () => {
  const f = new LinkCutForest([1, 1, 1, 1]);
  f.link(0, 1);
  f.link(1, 2);
  f.link(2, 3);
  assert.equal(f.pathSum(0, 3), 4);

  f.setValue(1, 100);
  assert.equal(f.pathSum(0, 3), 103);
  assert.equal(f.pathSum(0, 1), 101);

  f.setValue(1, -50);
  assert.equal(f.pathSum(0, 3), -47);

  f.setValue(3, 0.5);
  assert.equal(f.pathSum(2, 3), 1.5);
});

test('repeated queries are deterministic', () => {
  const f = new LinkCutForest([3, 1, 4, 1, 5]);
  f.link(0, 1);
  f.link(1, 2);
  f.link(2, 3);
  f.link(3, 4);
  const results = [];
  for (let i = 0; i < 5; i++) results.push(f.pathSum(0, 4));
  assert.ok(results.every((r) => r === results[0]));
  for (let i = 0; i < 5; i++) assert.equal(f.connected(0, 4), true);
  for (let i = 0; i < 5; i++) assert.equal(f.size(2), 5);
});

test('invalid operations throw the documented error types', () => {
  const f = new LinkCutForest([1, 2, 3, 4]);

  // constructor validation
  assert.throws(() => new LinkCutForest('nope'), TypeError);
  assert.throws(() => new LinkCutForest([1, 'x']), TypeError);
  assert.throws(() => new LinkCutForest([1, NaN]), TypeError);
  assert.throws(() => new LinkCutForest([1, Infinity]), TypeError);
  assert.throws(() => new LinkCutForest([1, -Infinity]), TypeError);

  // vertex validation (shared across methods)
  assert.throws(() => f.link(0, 1.5), TypeError);
  assert.throws(() => f.link(0, '1'), TypeError);
  assert.throws(() => f.link(0, 4), RangeError);
  assert.throws(() => f.link(-1, 0), RangeError);
  assert.throws(() => f.cut(0, 4), RangeError);
  assert.throws(() => f.connected(4, 0), RangeError);
  assert.throws(() => f.setValue(4, 1), RangeError);
  assert.throws(() => f.setValue(0, 'x'), TypeError);
});

test('setValue accepts any finite number including non-integers and negatives', () => {
  const f = new LinkCutForest([0]);
  f.setValue(0, 1.5);
  assert.equal(f.pathSum(0, 0), 1.5);
  f.setValue(0, -3.25);
  assert.equal(f.pathSum(0, 0), -3.25);
  assert.throws(() => f.setValue(0, NaN), TypeError);
  assert.throws(() => f.setValue(0, Infinity), TypeError);
  assert.throws(() => f.setValue(0, '1'), TypeError);
});

test('self-links and self-cuts are rejected', () => {
  const f = new LinkCutForest([1, 2, 3]);
  assert.throws(() => f.link(1, 1), RangeError);
  assert.throws(() => f.cut(1, 1), RangeError);
});

test('cycle-forming links are rejected in both argument orders', () => {
  const f = new LinkCutForest([1, 2, 3]);
  f.link(0, 1);
  f.link(1, 2);
  assert.throws(() => f.link(0, 2), RangeError);
  assert.throws(() => f.link(2, 0), RangeError);
});

test('non-edge cuts are rejected, including between disconnected vertices and indirectly-connected vertices', () => {
  const f = new LinkCutForest([1, 2, 3, 4]);
  // never linked at all
  assert.throws(() => f.cut(0, 1), RangeError);

  f.link(0, 1);
  f.link(1, 2);
  f.link(2, 3);
  // connected, but not a direct edge
  assert.throws(() => f.cut(0, 2), RangeError);
  assert.throws(() => f.cut(0, 3), RangeError);
  // still disconnected pair after building a separate isolated vertex
  const g = new LinkCutForest([1, 2, 3]);
  g.link(0, 1);
  assert.throws(() => g.cut(0, 2), RangeError, '0 and 2 are in different trees entirely');
});

test('pathSum on disconnected vertices throws RangeError', () => {
  const f = new LinkCutForest([1, 2, 3, 4]);
  f.link(0, 1);
  assert.throws(() => f.pathSum(0, 2), RangeError);
  assert.throws(() => f.pathSum(2, 3), RangeError);
});

test('deterministic differential comparison against a naive adjacency-list forest, fixed operation sequence', () => {
  const values = [51, 95, -78, 20, -62, -8, 33, -14];
  const n = values.length;
  const real = new LinkCutForest(values.slice());
  const naive = new NaiveForest(values.slice());

  const ops = [
    ['link', 0, 1],
    ['link', 1, 2],
    ['connected', 0, 2],
    ['pathSum', 0, 2],
    ['link', 3, 4],
    ['connected', 0, 3],
    ['link', 2, 3],
    ['connected', 0, 4],
    ['pathSum', 0, 4],
    ['setValue', 2, 1000],
    ['pathSum', 0, 4],
    ['cut', 2, 3],
    ['connected', 0, 4],
    ['size', 0],
    ['size', 3],
    ['link', 5, 6],
    ['link', 6, 7],
    ['cut', 6, 7],
    ['link', 3, 6],
    ['connected', 6, 4],
    ['pathSum', 4, 6],
    ['link', 0, 7],
    ['pathSum', 7, 6],
    ['size', 0],
  ];

  for (const [opName, ...args] of ops) {
    let r1, e1;
    try {
      r1 = real[opName](...args);
    } catch (e) {
      e1 = e;
    }
    let r2, e2;
    try {
      r2 = naive[opName](...args);
    } catch (e) {
      e2 = e;
    }
    assert.equal(!!e1, !!e2, `op ${opName}(${args}) throw-mismatch`);
    if (!e1) assert.equal(r1, r2, `op ${opName}(${args}) value-mismatch`);
  }
  assert.equal(n, values.length);
});

test('fixed-seed randomized differential stress test against a naive adjacency-list forest', () => {
  const rng = makeRng(20260807);

  for (let trial = 0; trial < 60; trial++) {
    const n = 1 + Math.floor(rng() * 12);
    const values = Array.from({ length: n }, () => Math.floor(rng() * 200) - 100);
    const real = new LinkCutForest(values.slice());
    const naive = new NaiveForest(values.slice());

    const numOps = 30 + Math.floor(rng() * 40);
    for (let op = 0; op < numOps; op++) {
      const u = Math.floor(rng() * n);
      const v = Math.floor(rng() * n);
      const choice = rng();
      let opName, args;
      if (choice < 0.25) {
        opName = 'link';
        args = [u, v];
      } else if (choice < 0.45) {
        opName = 'cut';
        args = [u, v];
      } else if (choice < 0.6) {
        opName = 'connected';
        args = [u, v];
      } else if (choice < 0.75) {
        opName = 'setValue';
        args = [u, Math.floor(rng() * 200) - 100];
      } else if (choice < 0.92) {
        opName = 'pathSum';
        args = [u, v];
      } else {
        opName = 'size';
        args = [u];
      }

      let r1, e1;
      try {
        r1 = real[opName](...args);
      } catch (e) {
        e1 = e;
      }
      let r2, e2;
      try {
        r2 = naive[opName](...args);
      } catch (e) {
        e2 = e;
      }
      assert.equal(
        !!e1,
        !!e2,
        `trial ${trial} op ${op} ${opName}(${args}) throw-mismatch: real=${e1 && e1.message} naive=${e2 && e2.message}`
      );
      if (!e1) assert.equal(r1, r2, `trial ${trial} op ${op} ${opName}(${args}) value-mismatch`);
    }
  }
});
