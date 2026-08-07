'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { maximumBipartiteMatching } = require('./hopcroft-karp-matcher.js');

// ---- Reference (brute-force / naive) implementations, used only by the
// deterministic and randomized comparison suites below. ----

/** Kuhn's algorithm (simple augmenting-path matcher, not Hopcroft-Karp) --
 * an independently-written reference for maximum matching *size* only. */
function bruteForceMaxMatchingSize(leftCount, rightCount, edges) {
  const adj = Array.from({ length: leftCount }, () => []);
  for (const [l, r] of edges) {
    if (!adj[l].includes(r)) adj[l].push(r);
  }
  const rightOwner = new Array(rightCount).fill(-1);
  const rightUsed = new Array(rightCount).fill(false);

  function tryAugment(l) {
    for (const r of adj[l]) {
      if (!rightUsed[r]) {
        rightUsed[r] = true;
        if (rightOwner[r] === -1 || tryAugment(rightOwner[r])) {
          rightOwner[r] = l;
          return true;
        }
      }
    }
    return false;
  }

  let size = 0;
  for (let l = 0; l < leftCount; l++) {
    rightUsed.fill(false);
    if (tryAugment(l)) size++;
  }
  return size;
}

function validateResult(leftCount, rightCount, edges, result) {
  const { matchingSize, leftMatch, rightMatch, vertexCover } = result;

  assert.equal(leftMatch.length, leftCount);
  assert.equal(rightMatch.length, rightCount);

  let countMatched = 0;
  for (let l = 0; l < leftCount; l++) {
    const r = leftMatch[l];
    if (r !== -1) {
      countMatched++;
      assert.equal(rightMatch[r], l, `rightMatch[${r}] should point back to ${l}`);
      assert.ok(
        edges.some(([el, er]) => el === l && er === r),
        `matched pair (${l},${r}) must be a real edge`
      );
    }
  }
  for (let r = 0; r < rightCount; r++) {
    const l = rightMatch[r];
    if (l !== -1) assert.equal(leftMatch[l], r, `leftMatch[${l}] should point back to ${r}`);
  }
  assert.equal(countMatched, matchingSize, 'matchingSize must equal the number of matched pairs');

  // Every edge must be covered by the returned vertex cover.
  const coverLeft = new Set(vertexCover.filter((v) => v.side === 'left').map((v) => v.index));
  const coverRight = new Set(vertexCover.filter((v) => v.side === 'right').map((v) => v.index));
  for (const [l, r] of edges) {
    assert.ok(
      coverLeft.has(l) || coverRight.has(r),
      `edge (${l},${r}) must be covered by the vertex cover`
    );
  }
  // Konig's theorem: minimum vertex cover size equals maximum matching size
  // for bipartite graphs.
  assert.equal(vertexCover.length, matchingSize, 'vertex cover size must equal matchingSize');

  // Canonical ordering: all 'left' entries first (ascending index), then
  // all 'right' entries (ascending index).
  let seenRight = false;
  let prevIndex = -1;
  for (const v of vertexCover) {
    if (v.side === 'left') {
      assert.equal(seenRight, false, 'all left entries must precede right entries');
      assert.ok(v.index > prevIndex, 'left entries must be ascending');
      prevIndex = v.index;
    } else {
      if (!seenRight) {
        seenRight = true;
        prevIndex = -1;
      }
      assert.ok(v.index > prevIndex, 'right entries must be ascending');
      prevIndex = v.index;
    }
  }
}

test('empty graph (0 left, 0 right, no edges)', () => {
  const result = maximumBipartiteMatching(0, 0, []);
  assert.equal(result.matchingSize, 0);
  assert.deepEqual(result.leftMatch, []);
  assert.deepEqual(result.rightMatch, []);
  assert.deepEqual(result.vertexCover, []);
});

test('non-empty partitions with no edges', () => {
  const result = maximumBipartiteMatching(3, 4, []);
  assert.equal(result.matchingSize, 0);
  assert.deepEqual(result.leftMatch, [-1, -1, -1]);
  assert.deepEqual(result.rightMatch, [-1, -1, -1, -1]);
  assert.deepEqual(result.vertexCover, []);
  validateResult(3, 4, [], result);
});

test('disconnected graph (two separate components)', () => {
  // {0-0} and {1-1} are independent pairs; 2 is isolated.
  const edges = [[0, 0], [1, 1]];
  const result = maximumBipartiteMatching(3, 3, edges);
  assert.equal(result.matchingSize, 2);
  assert.equal(result.leftMatch[0], 0);
  assert.equal(result.leftMatch[1], 1);
  assert.equal(result.leftMatch[2], -1);
  validateResult(3, 3, edges, result);
});

test('perfect matching (complete bipartite K(3,3))', () => {
  const edges = [];
  for (let l = 0; l < 3; l++) for (let r = 0; r < 3; r++) edges.push([l, r]);
  const result = maximumBipartiteMatching(3, 3, edges);
  assert.equal(result.matchingSize, 3);
  assert.ok(result.leftMatch.every((r) => r !== -1));
  assert.ok(result.rightMatch.every((l) => l !== -1));
  validateResult(3, 3, edges, result);
});

test('partial matching (more left vertices than can be matched)', () => {
  // 3 left vertices all only connect to the single right vertex 0.
  const edges = [[0, 0], [1, 0], [2, 0]];
  const result = maximumBipartiteMatching(3, 1, edges);
  assert.equal(result.matchingSize, 1);
  validateResult(3, 1, edges, result);
});

test('duplicate edges are deduplicated (no effect on matching)', () => {
  const withDupes = [[0, 0], [0, 0], [0, 0], [1, 1], [1, 1]];
  const withoutDupes = [[0, 0], [1, 1]];
  const r1 = maximumBipartiteMatching(2, 2, withDupes);
  const r2 = maximumBipartiteMatching(2, 2, withoutDupes);
  assert.deepEqual(r1, r2);
  validateResult(2, 2, withDupes, r1);
});

test('permuted edge order produces identical output', () => {
  const edges = [[0, 1], [2, 0], [1, 2], [0, 0], [2, 2], [1, 1]];
  const shuffled = [[1, 1], [0, 0], [2, 2], [1, 2], [2, 0], [0, 1]];
  const r1 = maximumBipartiteMatching(3, 3, edges);
  const r2 = maximumBipartiteMatching(3, 3, shuffled);
  assert.deepEqual(r1, r2);
});

test('isolated vertices on both sides', () => {
  // left 2 and right 2 are isolated; only 0-0 and 1-1 connect.
  const edges = [[0, 0], [1, 1]];
  const result = maximumBipartiteMatching(3, 3, edges);
  assert.equal(result.matchingSize, 2);
  assert.equal(result.leftMatch[2], -1);
  assert.equal(result.rightMatch[2], -1);
  validateResult(3, 3, edges, result);
});

test('multiple-optimum graph (several maximum matchings exist)', () => {
  // A 4-cycle: 0-0, 0-1, 1-0, 1-1 has two maximum matchings of size 2:
  // {(0,0),(1,1)} or {(0,1),(1,0)}. Ascending traversal must pick
  // deterministically and consistently.
  const edges = [[0, 0], [0, 1], [1, 0], [1, 1]];
  const r1 = maximumBipartiteMatching(2, 2, edges);
  const r2 = maximumBipartiteMatching(2, 2, edges.slice());
  assert.equal(r1.matchingSize, 2);
  assert.deepEqual(r1, r2, 'repeated calls on the same graph must be identical');
  validateResult(2, 2, edges, r1);
});

test('invalid inputs throw TypeError or RangeError as appropriate', () => {
  assert.throws(() => maximumBipartiteMatching(-1, 2, []), RangeError);
  assert.throws(() => maximumBipartiteMatching(2, -1, []), RangeError);
  assert.throws(() => maximumBipartiteMatching(1.5, 2, []), TypeError);
  assert.throws(() => maximumBipartiteMatching(2, 1.5, []), TypeError);
  assert.throws(() => maximumBipartiteMatching('2', 2, []), TypeError);
  assert.throws(() => maximumBipartiteMatching(2, 2, null), TypeError);
  assert.throws(() => maximumBipartiteMatching(2, 2, 'notarray'), TypeError);
  assert.throws(() => maximumBipartiteMatching(2, 2, {}), TypeError);
  assert.throws(() => maximumBipartiteMatching(2, 2, [[0]]), TypeError);
  assert.throws(() => maximumBipartiteMatching(2, 2, [[0, 0, 0]]), TypeError);
  assert.throws(() => maximumBipartiteMatching(2, 2, [[0.5, 0]]), TypeError);
  assert.throws(() => maximumBipartiteMatching(2, 2, [[0, 'x']]), TypeError);
  assert.throws(() => maximumBipartiteMatching(2, 2, [[2, 0]]), RangeError);
  assert.throws(() => maximumBipartiteMatching(2, 2, [[0, 2]]), RangeError);
  assert.throws(() => maximumBipartiteMatching(2, 2, [[-1, 0]]), RangeError);
  assert.throws(() => maximumBipartiteMatching(2, 2, [[0, -1]]), RangeError);
});

test('caller data is preserved (no mutation of edges array or its elements)', () => {
  const edges = [[1, 0], [0, 1], [0, 0]];
  const frozenEdges = Object.freeze(edges.map((e) => Object.freeze(e.slice())));
  const originalSnapshot = JSON.parse(JSON.stringify(frozenEdges));
  const result = maximumBipartiteMatching(2, 2, frozenEdges);
  assert.deepEqual(JSON.parse(JSON.stringify(frozenEdges)), originalSnapshot);
  validateResult(2, 2, frozenEdges, result);
});

test('repeated calls are deterministic', () => {
  const edges = [[0, 1], [1, 0], [1, 1], [2, 2]];
  const r1 = maximumBipartiteMatching(3, 3, edges);
  const r2 = maximumBipartiteMatching(3, 3, edges);
  assert.deepEqual(r1, r2);
});

test('deterministic comparison against a brute-force oracle, fixed small graphs', () => {
  const cases = [
    { leftCount: 0, rightCount: 0, edges: [] },
    { leftCount: 1, rightCount: 1, edges: [] },
    { leftCount: 1, rightCount: 1, edges: [[0, 0]] },
    { leftCount: 2, rightCount: 2, edges: [[0, 0], [1, 1]] },
    { leftCount: 2, rightCount: 2, edges: [[0, 0], [0, 1], [1, 0], [1, 1]] },
    { leftCount: 3, rightCount: 2, edges: [[0, 0], [1, 0], [2, 1]] },
    { leftCount: 4, rightCount: 4, edges: [[0, 1], [1, 2], [2, 3], [3, 0]] },
    {
      leftCount: 5,
      rightCount: 3,
      edges: [[0, 0], [1, 0], [2, 1], [3, 1], [4, 2]],
    },
    {
      leftCount: 4,
      rightCount: 4,
      edges: [[0, 0], [0, 1], [1, 1], [1, 2], [2, 2], [2, 3], [3, 3], [3, 0]],
    },
  ];

  for (const { leftCount, rightCount, edges } of cases) {
    const result = maximumBipartiteMatching(leftCount, rightCount, edges);
    validateResult(leftCount, rightCount, edges, result);
    const bruteSize = bruteForceMaxMatchingSize(leftCount, rightCount, edges);
    assert.equal(
      result.matchingSize,
      bruteSize,
      `matching size mismatch for leftCount=${leftCount} rightCount=${rightCount} edges=${JSON.stringify(edges)}`
    );
  }
});

test('fixed-seed randomized comparison against a brute-force oracle', () => {
  function makeRng(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  const rng = makeRng(20260807);

  for (let trial = 0; trial < 80; trial++) {
    const leftCount = Math.floor(rng() * 7);
    const rightCount = Math.floor(rng() * 7);
    const numEdges = Math.floor(rng() * 12);
    const edges = [];
    for (let i = 0; i < numEdges; i++) {
      if (leftCount === 0 || rightCount === 0) break;
      edges.push([Math.floor(rng() * leftCount), Math.floor(rng() * rightCount)]);
    }

    const result = maximumBipartiteMatching(leftCount, rightCount, edges);
    validateResult(leftCount, rightCount, edges, result);
    const bruteSize = bruteForceMaxMatchingSize(leftCount, rightCount, edges);
    assert.equal(
      result.matchingSize,
      bruteSize,
      `matching size mismatch for leftCount=${leftCount} rightCount=${rightCount} edges=${JSON.stringify(edges)}`
    );

    // Edge-order independence: shuffle and re-check for exact equality.
    const shuffled = edges.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const result2 = maximumBipartiteMatching(leftCount, rightCount, shuffled);
    assert.deepEqual(result, result2, 'shuffled edge order must produce identical output');
  }
});
