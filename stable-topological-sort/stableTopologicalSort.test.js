'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { stableTopologicalSort } = require('./stableTopologicalSort.js');

test('empty graph returns an empty order', () => {
  assert.deepEqual(stableTopologicalSort([], []), []);
});

test('linear chain is ordered from root to leaf', () => {
  const nodes = ['a', 'b', 'c', 'd'];
  const edges = [
    ['a', 'b'],
    ['b', 'c'],
    ['c', 'd'],
  ];
  assert.deepEqual(stableTopologicalSort(nodes, edges), ['a', 'b', 'c', 'd']);
});

test('disconnected and tied nodes follow original nodes order', () => {
  // No edges at all: every node is available from the start, so the
  // result must simply mirror the input order.
  const nodes = ['c', 'a', 'b'];
  assert.deepEqual(stableTopologicalSort(nodes, []), ['c', 'a', 'b']);
});

test('ties among available nodes prefer the earliest position in nodes', () => {
  // b and c both depend only on a; once a is processed, b and c are both
  // available. b appears before c in `nodes`, so b must come first even
  // though d (independent) appears even earlier in some later step logic.
  const nodes = ['a', 'd', 'c', 'b'];
  const edges = [
    ['a', 'b'],
    ['a', 'c'],
  ];
  // Available at start: a, d (a is earliest -> picked first).
  // Then available: d, c, b -> d is earliest -> picked.
  // Then available: c, b -> c appears before b in nodes -> picked.
  // Then: b.
  assert.deepEqual(stableTopologicalSort(nodes, edges), ['a', 'd', 'c', 'b']);
});

test('duplicate edges are treated as a single edge', () => {
  const nodes = ['a', 'b'];
  const edges = [
    ['a', 'b'],
    ['a', 'b'],
    ['a', 'b'],
  ];
  assert.deepEqual(stableTopologicalSort(nodes, edges), ['a', 'b']);
});

test('rejects non-array nodes and edges', () => {
  assert.throws(() => stableTopologicalSort(null, []), TypeError);
  assert.throws(() => stableTopologicalSort(undefined, []), TypeError);
  assert.throws(() => stableTopologicalSort('a,b', []), TypeError);
  assert.throws(() => stableTopologicalSort([], null), TypeError);
  assert.throws(() => stableTopologicalSort([], 'a-b'), TypeError);
});

test('rejects non-string or empty-string node values', () => {
  assert.throws(() => stableTopologicalSort(['a', 1], []), TypeError);
  assert.throws(() => stableTopologicalSort(['a', ''], []), TypeError);
  assert.throws(() => stableTopologicalSort(['a', null], []), TypeError);
});

test('rejects duplicate node names', () => {
  assert.throws(
    () => stableTopologicalSort(['a', 'b', 'a'], []),
    TypeError,
  );
});

test('rejects malformed edge entries', () => {
  const nodes = ['a', 'b'];
  assert.throws(() => stableTopologicalSort(nodes, [['a']]), TypeError);
  assert.throws(() => stableTopologicalSort(nodes, [['a', 'b', 'c']]), TypeError);
  assert.throws(() => stableTopologicalSort(nodes, ['a-b']), TypeError);
  assert.throws(() => stableTopologicalSort(nodes, [[1, 'b']]), TypeError);
  assert.throws(() => stableTopologicalSort(nodes, [['a', '']]), TypeError);
});

test('rejects edges referencing unknown nodes', () => {
  const nodes = ['a', 'b'];
  assert.throws(() => stableTopologicalSort(nodes, [['a', 'z']]), TypeError);
  assert.throws(() => stableTopologicalSort(nodes, [['z', 'a']]), TypeError);
});

test('throws on a self-loop cycle', () => {
  const nodes = ['a'];
  const edges = [['a', 'a']];
  assert.throws(
    () => stableTopologicalSort(nodes, edges),
    (err) => err instanceof Error && err.message === 'Graph contains a cycle',
  );
});

test('throws on a larger cycle', () => {
  const nodes = ['a', 'b', 'c'];
  const edges = [
    ['a', 'b'],
    ['b', 'c'],
    ['c', 'a'],
  ];
  assert.throws(
    () => stableTopologicalSort(nodes, edges),
    (err) => err instanceof Error && err.message === 'Graph contains a cycle',
  );
});

test('never mutates the nodes or edges inputs', () => {
  const nodes = Object.freeze(['a', 'b', 'c']);
  const edges = Object.freeze([
    Object.freeze(['a', 'b']),
    Object.freeze(['b', 'c']),
  ]);

  const before = { nodes: [...nodes], edges: edges.map((e) => [...e]) };
  const result = stableTopologicalSort(nodes, edges);

  assert.deepEqual(result, ['a', 'b', 'c']);
  assert.deepEqual([...nodes], before.nodes);
  assert.deepEqual(edges.map((e) => [...e]), before.edges);
});
