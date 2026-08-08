'use strict';

// Deterministic maximum-cardinality matching for general (non-bipartite)
// undirected graphs, via Edmonds' blossom algorithm (1965).
//
// Unlike bipartite matching (augmenting paths alone suffice there), a
// general graph can contain odd-length cycles. An augmenting-path search
// that ignores this can get stuck alternating around an odd cycle forever
// without ever reaching a free vertex on the far side. Edmonds' insight:
// whenever the search discovers such an odd cycle ("blossom") growing out
// of the current alternating tree, CONTRACT it into a single pseudo-vertex
// (via a `base[]` union-find-like relabeling) and keep searching from
// there. If an augmenting path is eventually found through the contracted
// graph, it is expanded back out through each blossom by walking the two
// tree-paths from the entry point around to the blossom's own base.
//
// This file implements the classic O(V^3) two-nested-loop version of the
// algorithm (BFS-based alternating tree per free vertex, blossom detection
// via a "walk both branches, mark visited bases" LCA computation).

function maximumMatching(vertexCountInput, edgesInput) {
  const n = validateVertexCount(vertexCountInput);
  const normalizedEdges = validateAndNormalizeEdges(edgesInput, n);

  // Deduplicate (an undirected edge {a,b} may appear more than once, in
  // either endpoint order) and sort ascending so adjacency construction --
  // and therefore every scan order the algorithm performs -- is a pure
  // function of the (deduplicated, normalized) edge set, never of the
  // caller's original ordering.
  const dedupedEdges = dedupeAndSortEdges(normalizedEdges, n);

  const adjacency = buildSortedAdjacency(n, dedupedEdges);

  const match = runBlossomAlgorithm(n, adjacency);

  let cardinality = 0;
  for (let v = 0; v < n; v++) {
    if (match[v] !== -1) cardinality++;
  }
  cardinality = cardinality / 2;

  return { cardinality, mate: match };
}

function validateVertexCount(vertexCountInput) {
  if (typeof vertexCountInput !== 'number' || !Number.isInteger(vertexCountInput)) {
    throw new TypeError('vertexCount must be an integer');
  }
  if (vertexCountInput < 0) {
    throw new RangeError('vertexCount must be non-negative');
  }
  return vertexCountInput;
}

function validateAndNormalizeEdges(edgesInput, n) {
  if (!Array.isArray(edgesInput)) {
    throw new TypeError('edges must be an array');
  }
  const normalized = [];
  for (const edge of edgesInput) {
    if (!Array.isArray(edge) || edge.length !== 2) {
      throw new TypeError('each edge must be a 2-element array [u, v]');
    }
    const [u, v] = edge;
    if (typeof u !== 'number' || !Number.isInteger(u) || typeof v !== 'number' || !Number.isInteger(v)) {
      throw new TypeError('edge endpoints must be integers');
    }
    if (u < 0 || u >= n || v < 0 || v >= n) {
      throw new RangeError('edge endpoint out of range [0, vertexCount)');
    }
    if (u === v) {
      throw new RangeError('self-loops are not allowed');
    }
    normalized.push(u < v ? [u, v] : [v, u]);
  }
  return normalized;
}

function dedupeAndSortEdges(normalizedEdges, n) {
  const seen = new Set();
  const deduped = [];
  for (const [a, b] of normalizedEdges) {
    const key = a * n + b;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push([a, b]);
    }
  }
  deduped.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  return deduped;
}

function buildSortedAdjacency(n, dedupedEdges) {
  const adjacency = Array.from({ length: n }, () => []);
  for (const [a, b] of dedupedEdges) {
    adjacency[a].push(b);
    adjacency[b].push(a);
  }
  for (let i = 0; i < n; i++) adjacency[i].sort((x, y) => x - y);
  return adjacency;
}

function runBlossomAlgorithm(n, adjacency) {
  const match = new Array(n).fill(-1);
  const p = new Array(n).fill(-1); // alternating-tree parent pointer
  const base = new Array(n).fill(0); // current blossom-base representative
  const used = new Array(n).fill(false); // visited in the current BFS
  const blossomMark = new Array(n).fill(false); // scratch: vertices in a freshly-found blossom

  // Walk the alternating tree upward from a vertex's blossom-base,
  // through its matching partner's parent, to the next base up -- this is
  // exactly how the tree is threaded: unmatched root -> ... -> match[x]'s
  // parent -> ... -> root.
  function lowestCommonAncestor(a, b) {
    const markedBase = new Array(n).fill(false);
    let x = a;
    for (;;) {
      x = base[x];
      markedBase[x] = true;
      if (match[x] === -1) break;
      x = p[match[x]];
    }
    let y = b;
    for (;;) {
      y = base[y];
      if (markedBase[y]) return y;
      y = p[match[y]];
    }
  }

  // Mark every blossom-base on the path from v up to (but not including)
  // base b, re-threading parent pointers so the contracted vertices remain
  // reachable for path reconstruction after contraction.
  function markBlossomPath(v, b, child) {
    while (base[v] !== b) {
      blossomMark[base[v]] = true;
      blossomMark[base[match[v]]] = true;
      p[v] = child;
      child = match[v];
      v = p[match[v]];
    }
  }

  function findAugmentingPathFrom(root) {
    used.fill(false);
    p.fill(-1);
    for (let i = 0; i < n; i++) base[i] = i;

    used[root] = true;
    const queue = [root];
    let head = 0;
    while (head < queue.length) {
      const v = queue[head++];
      const neighbors = adjacency[v];
      for (let k = 0; k < neighbors.length; k++) {
        const to = neighbors[k];
        if (base[v] === base[to] || match[v] === to) continue;

        if (to === root || (match[to] !== -1 && p[match[to]] !== -1)) {
          // A back-edge into the current tree (or to the root itself)
          // closes an odd cycle: contract it into a single blossom.
          const commonBase = lowestCommonAncestor(v, to);
          blossomMark.fill(false);
          markBlossomPath(v, commonBase, to);
          markBlossomPath(to, commonBase, v);
          for (let i = 0; i < n; i++) {
            if (blossomMark[base[i]]) {
              base[i] = commonBase;
              if (!used[i]) {
                used[i] = true;
                queue.push(i);
              }
            }
          }
        } else if (p[to] === -1) {
          p[to] = v;
          if (match[to] === -1) {
            augmentAlongPath(match, p, to);
            return true;
          }
          used[match[to]] = true;
          queue.push(match[to]);
        }
      }
    }
    return false;
  }

  for (let v = 0; v < n; v++) {
    if (match[v] === -1) {
      findAugmentingPathFrom(v);
    }
  }

  return match;
}

// Flip every matched/unmatched edge along the tree path from `to` (a
// newly-reached free vertex) back to the search root, growing the
// matching by exactly one edge.
function augmentAlongPath(match, p, to) {
  let current = to;
  while (current !== -1) {
    const parent = p[current];
    const parentsPreviousMatch = match[parent];
    match[current] = parent;
    match[parent] = current;
    current = parentsPreviousMatch;
  }
}

module.exports = { maximumMatching };
