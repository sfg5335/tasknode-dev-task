'use strict';

/**
 * Dependency-free, single-file, deterministic maximum bipartite matcher
 * using the Hopcroft-Karp algorithm, plus a minimum vertex cover derived
 * from the resulting matching via Konig's theorem.
 *
 * maximumBipartiteMatching(leftCount, rightCount, edges)
 *   `leftCount`/`rightCount` must be non-negative integers -- the sizes of
 *   the two vertex partitions (left vertices `0 .. leftCount-1`, right
 *   vertices `0 .. rightCount-1`). `edges` must be an array of `[left,
 *   right]` integer pairs with `left` in `[0, leftCount)` and `right` in
 *   `[0, rightCount)`. The input `edges` array (and its element arrays)
 *   is never mutated or retained -- the function only ever reads from a
 *   sorted, deduplicated copy it builds internally, so the caller's data
 *   is fully preserved.
 *
 *   Edges are deduplicated and sorted ascending by `(left, right)` before
 *   running Hopcroft-Karp, and every adjacency traversal during the
 *   algorithm visits right-vertices in ascending order -- so the returned
 *   matching, vertex cover, and matching size are always exactly the same
 *   for a given graph regardless of the order `edges` was supplied in.
 *
 *   Returns `{ matchingSize, leftMatch, rightMatch, vertexCover }`:
 *     - `matchingSize`: the size of a maximum matching (a non-negative
 *       integer).
 *     - `leftMatch`: a fresh array of length `leftCount`; `leftMatch[l]`
 *       is the right-vertex `l` is matched to, or `-1` if `l` is
 *       unmatched.
 *     - `rightMatch`: a fresh array of length `rightCount`; `rightMatch[r]`
 *       is the left-vertex `r` is matched to, or `-1` if `r` is
 *       unmatched.
 *     - `vertexCover`: a fresh array of `{ side, index }` objects (`side`
 *       is `'left'` or `'right'`, `index` is the vertex's index within
 *       its partition) forming a minimum vertex cover -- by Konig's
 *       theorem, its size always equals `matchingSize` for bipartite
 *       graphs. Sorted with every `'left'` entry first (ascending
 *       `index`), then every `'right'` entry (ascending `index`), for a
 *       fully deterministic, canonical order.
 *
 *   Throws `TypeError` for wrong JS types (non-integer counts, a
 *   non-array `edges`, a malformed edge that isn't a 2-element array of
 *   integers) and `RangeError` for correctly-typed but out-of-bounds
 *   values (`leftCount`/`rightCount` negative, an edge endpoint outside
 *   its partition's valid range).
 */

function requireNonNegativeInteger(value, name) {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new TypeError(`${name} must be an integer`);
  }
  if (value < 0) {
    throw new RangeError(`${name} must be non-negative: ${value}`);
  }
}

function validateAndNormalizeEdges(edges, leftCount, rightCount) {
  if (!Array.isArray(edges)) throw new TypeError('edges must be an array');

  const normalized = [];
  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i];
    if (!Array.isArray(edge) || edge.length !== 2) {
      throw new TypeError(`edges[${i}] must be a 2-element array [left, right]`);
    }
    const [l, r] = edge;
    if (typeof l !== 'number' || !Number.isInteger(l)) {
      throw new TypeError(`edges[${i}][0] must be an integer`);
    }
    if (typeof r !== 'number' || !Number.isInteger(r)) {
      throw new TypeError(`edges[${i}][1] must be an integer`);
    }
    if (l < 0 || l >= leftCount) {
      throw new RangeError(`edges[${i}][0] out of range: ${l}`);
    }
    if (r < 0 || r >= rightCount) {
      throw new RangeError(`edges[${i}][1] out of range: ${r}`);
    }
    normalized.push([l, r]);
  }

  // Deduplicate then sort ascending by (left, right) so downstream
  // traversal order -- and therefore the whole result -- is independent
  // of the caller's original edge order.
  const seen = new Set();
  const deduped = [];
  for (const [l, r] of normalized) {
    const key = l * (rightCount + 1) + r;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push([l, r]);
    }
  }
  deduped.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  return deduped;
}

function maximumBipartiteMatching(leftCount, rightCount, edges) {
  requireNonNegativeInteger(leftCount, 'leftCount');
  requireNonNegativeInteger(rightCount, 'rightCount');
  const sortedEdges = validateAndNormalizeEdges(edges, leftCount, rightCount);

  // adj[l] = ascending-sorted list of right-vertices adjacent to left
  // vertex l. sortedEdges is already sorted by (left, right), so a
  // single linear pass preserves ascending order within each bucket.
  const adj = Array.from({ length: leftCount }, () => []);
  for (const [l, r] of sortedEdges) adj[l].push(r);

  const leftMatch = new Array(leftCount).fill(-1);
  const rightMatch = new Array(rightCount).fill(-1);
  const dist = new Array(leftCount).fill(0);
  const INF = Infinity;

  function bfs() {
    const queue = [];
    for (let l = 0; l < leftCount; l++) {
      if (leftMatch[l] === -1) {
        dist[l] = 0;
        queue.push(l);
      } else {
        dist[l] = INF;
      }
    }
    let foundAugmentingPath = false;
    let qi = 0;
    while (qi < queue.length) {
      const l = queue[qi++];
      for (const r of adj[l]) {
        const matchedLeft = rightMatch[r];
        if (matchedLeft === -1) {
          foundAugmentingPath = true;
        } else if (dist[matchedLeft] === INF) {
          dist[matchedLeft] = dist[l] + 1;
          queue.push(matchedLeft);
        }
      }
    }
    return foundAugmentingPath;
  }

  function dfs(l) {
    for (const r of adj[l]) {
      const matchedLeft = rightMatch[r];
      if (matchedLeft === -1 || (dist[matchedLeft] === dist[l] + 1 && dfs(matchedLeft))) {
        leftMatch[l] = r;
        rightMatch[r] = l;
        return true;
      }
    }
    dist[l] = INF;
    return false;
  }

  let matchingSize = 0;
  while (bfs()) {
    for (let l = 0; l < leftCount; l++) {
      if (leftMatch[l] === -1) {
        if (dfs(l)) matchingSize++;
      }
    }
  }

  // Konig's theorem: alternating reachability from unmatched left
  // vertices (via non-matching edges to the right, then matching edges
  // back to the left) determines the minimum vertex cover:
  //   cover = (left vertices NOT reachable) U (right vertices reachable)
  const visitedLeft = new Array(leftCount).fill(false);
  const visitedRight = new Array(rightCount).fill(false);
  const stack = [];
  for (let l = 0; l < leftCount; l++) {
    if (leftMatch[l] === -1) {
      visitedLeft[l] = true;
      stack.push(l);
    }
  }
  while (stack.length > 0) {
    const l = stack.pop();
    for (const r of adj[l]) {
      if (!visitedRight[r]) {
        visitedRight[r] = true;
        const matchedLeft = rightMatch[r];
        if (matchedLeft !== -1 && !visitedLeft[matchedLeft]) {
          visitedLeft[matchedLeft] = true;
          stack.push(matchedLeft);
        }
      }
    }
  }

  const vertexCover = [];
  for (let l = 0; l < leftCount; l++) {
    if (!visitedLeft[l]) vertexCover.push({ side: 'left', index: l });
  }
  for (let r = 0; r < rightCount; r++) {
    if (visitedRight[r]) vertexCover.push({ side: 'right', index: r });
  }

  return { matchingSize, leftMatch, rightMatch, vertexCover };
}

module.exports = { maximumBipartiteMatching };
