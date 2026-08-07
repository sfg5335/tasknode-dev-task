'use strict';

/**
 * Dependency-free, single-file, deterministic immediate-dominator solver
 * for directed graphs, using the (simple, path-compression-only)
 * Lengauer-Tarjan algorithm.
 *
 * immediateDominators(vertexCount, edges, start)
 *   `vertexCount` is the number of vertices, addressed `0..vertexCount-1`.
 *   Must be a safe integer >= 1.
 *
 *   `edges` is an array of `{ from, to }` objects (directed edge
 *   `from -> to`). `from`/`to` must be safe integers in
 *   `[0, vertexCount)`. Duplicate edges and self-loops (`from === to`)
 *   are valid input; duplicates are harmless redundancy and a self-loop
 *   can never be any vertex's dominance-relevant predecessor (a vertex
 *   is never reached along any *proper* path that passes through itself
 *   first), so both are always accepted, without crashing or needing
 *   any special-casing -- the algorithm naturally treats them as inert
 *   (see Design notes in the README).
 *
 *   `start` must be a safe integer in `[0, vertexCount)`.
 *
 *   Returns an array `idom` of length `vertexCount`: `idom[start]` is
 *   `start` itself; `idom[v]` for every other vertex `v` reachable from
 *   `start` is its unique immediate dominator (the closest strict
 *   dominator of `v` -- the last vertex every path from `start` to `v`
 *   must pass through); `idom[v]` is `null` for every vertex not
 *   reachable from `start`.
 *
 *   Every input is validated: a non-safe-integer `vertexCount` or
 *   `start`, a non-array `edges`, a non-object edge, or a non-safe-
 *   integer `edges[i].from`/`edges[i].to`, throws `TypeError`; a
 *   correctly-typed `vertexCount < 1`, or `start`/`edges[i].from`/
 *   `edges[i].to` outside `[0, vertexCount)`, throws `RangeError`.
 *   Neither `edges` nor any edge object is ever mutated.
 *
 *   Determinism: the result depends only on the graph's actual edge
 *   *set* (which ordered vertex pairs are connected), never on the
 *   input array's order -- dominance is a structural property of the
 *   graph, and while a different edge order can produce a differently
 *   shaped internal DFS tree, the Lengauer-Tarjan algorithm is proven
 *   to recover the same true immediate dominators regardless of DFS
 *   tree shape.
 *
 * Algorithm notes: (1) an iterative (explicit-stack) preorder DFS from
 * `start` assigns each reachable vertex a DFS number and DFS-tree
 * parent. (2) Vertices are processed in decreasing DFS-number order;
 * each vertex's *semidominator* is computed from its predecessors using
 * an EVAL/LINK auxiliary forest with (also iterative) path compression,
 * and each vertex is placed in a "bucket" keyed by its semidominator.
 * (3) Immediately after a vertex `w` is linked into the auxiliary
 * forest, every vertex bucketed under `w`'s *parent* has its candidate
 * immediate dominator resolved (either the parent itself, or a vertex
 * discovered via EVAL with a strictly smaller semidominator). (4) A
 * final forward pass over vertices in increasing DFS-number order fixes
 * up any vertex whose immediate dominator was tentatively set to some
 * vertex other than its own semidominator, per the semidominator
 * theorem. Both the DFS and the path-compression routine are written
 * iteratively (explicit stacks/loops, no recursion) specifically so
 * that long dependency chains (e.g. a 50,000-vertex chain graph) never
 * risk a call-stack overflow.
 */

function isSafeInt(v) {
  return typeof v === 'number' && Number.isSafeInteger(v);
}

function immediateDominators(vertexCount, edges, start) {
  if (!isSafeInt(vertexCount)) throw new TypeError('vertexCount must be a safe integer');
  if (vertexCount < 1) throw new RangeError('vertexCount must be at least 1');
  if (!Array.isArray(edges)) throw new TypeError('edges must be an array');
  if (!isSafeInt(start)) throw new TypeError('start must be a safe integer');
  if (start < 0 || start >= vertexCount) throw new RangeError(`start out of range: ${start}`);

  const parsedEdges = edges.map((e, i) => {
    if (typeof e !== 'object' || e === null || Array.isArray(e)) {
      throw new TypeError(`edges[${i}] must be an object of the form { from, to }`);
    }
    const { from, to } = e;
    if (!isSafeInt(from)) throw new TypeError(`edges[${i}].from must be a safe integer`);
    if (!isSafeInt(to)) throw new TypeError(`edges[${i}].to must be a safe integer`);
    if (from < 0 || from >= vertexCount) throw new RangeError(`edges[${i}].from out of range: ${from}`);
    if (to < 0 || to >= vertexCount) throw new RangeError(`edges[${i}].to out of range: ${to}`);
    return { from, to };
  });

  // Adjacency (forward) and reverse-adjacency (predecessor) lists, built
  // in input order (this can shape the DFS tree, but never the final
  // idom result -- see module doc comment above).
  const adj = Array.from({ length: vertexCount }, () => []);
  const preds = Array.from({ length: vertexCount }, () => []);
  for (const e of parsedEdges) {
    adj[e.from].push(e.to);
    preds[e.to].push(e.from);
  }

  // --- Iterative preorder DFS from `start`: assigns dfn (DFS number),
  // vertexOfPre (dfn -> vertex), and parent (DFS-tree parent vertex),
  // using an explicit frame stack instead of recursion. ---
  const dfn = new Array(vertexCount).fill(-1);
  const vertexOfPre = [];
  const parent = new Array(vertexCount).fill(-1);
  const frameVertex = [start];
  const frameIndex = [0];
  dfn[start] = 0;
  vertexOfPre.push(start);
  while (frameVertex.length > 0) {
    const top = frameVertex.length - 1;
    const v = frameVertex[top];
    const i = frameIndex[top];
    if (i < adj[v].length) {
      frameIndex[top] = i + 1;
      const w = adj[v][i];
      if (dfn[w] === -1) {
        dfn[w] = vertexOfPre.length;
        vertexOfPre.push(w);
        parent[w] = v;
        frameVertex.push(w);
        frameIndex.push(0);
      }
    } else {
      frameVertex.pop();
      frameIndex.pop();
    }
  }
  const n = vertexOfPre.length; // number of reachable vertices, including start

  // --- EVAL/LINK auxiliary forest, with iterative path compression. ---
  const ancestor = new Array(vertexCount).fill(-1);
  const label = new Array(vertexCount);
  for (let v = 0; v < vertexCount; v++) label[v] = v;
  const semiNum = new Array(vertexCount).fill(-1); // dfn of each vertex's current-best-known semidominator
  for (let i = 0; i < n; i++) semiNum[vertexOfPre[i]] = i;

  // EVAL(v): returns the vertex with minimal semiNum on the path from
  // `v` up to the root of its current auxiliary tree, compressing that
  // path (and updating `label` along it) as a side effect. Written
  // iteratively: gather the full path from `v` to its tree root first,
  // then walk it from the end nearest the root back down to `v`,
  // threading a running "best so far" label -- this produces byte-for-
  // byte the same `label`/`ancestor` updates as the classical recursive
  // COMPRESS routine (hand-verified by tracing both side by side), just
  // without recursing, so arbitrarily long chains never risk a stack
  // overflow.
  function evalVertex(v) {
    if (ancestor[v] === -1) return label[v];
    const path = [];
    let x = v;
    while (ancestor[x] !== -1) {
      path.push(x);
      x = ancestor[x];
    }
    const root = x;
    let best = label[path[path.length - 1]];
    for (let i = path.length - 1; i >= 0; i--) {
      const node = path[i];
      if (i !== path.length - 1 && semiNum[label[node]] < semiNum[best]) {
        best = label[node];
      }
      label[node] = best;
      ancestor[node] = root;
    }
    return label[v];
  }

  // --- Main semidominator / bucket pass, in decreasing DFS-number order. ---
  const bucket = Array.from({ length: vertexCount }, () => []);
  const idom = new Array(vertexCount).fill(null);

  for (let i = n - 1; i >= 1; i--) {
    const w = vertexOfPre[i];
    for (const v of preds[w]) {
      if (dfn[v] === -1) continue; // predecessor not reachable from start: irrelevant to dominance
      const u = evalVertex(v);
      if (semiNum[u] < semiNum[w]) semiNum[w] = semiNum[u];
    }
    bucket[vertexOfPre[semiNum[w]]].push(w);
    ancestor[w] = parent[w]; // LINK(parent[w], w)

    const p = parent[w];
    const bp = bucket[p];
    for (const v of bp) {
      const u = evalVertex(v);
      idom[v] = semiNum[u] < semiNum[v] ? u : p;
    }
    bucket[p] = [];
  }

  // --- Final fix-up pass, in increasing DFS-number order: per the
  // semidominator theorem, any vertex whose tentative idom isn't its
  // own semidominator actually shares its idom with that tentative
  // value's own (by-now-final) idom. ---
  for (let i = 1; i < n; i++) {
    const w = vertexOfPre[i];
    if (idom[w] !== vertexOfPre[semiNum[w]]) {
      idom[w] = idom[idom[w]];
    }
  }
  idom[start] = start;

  return idom;
}

module.exports = { immediateDominators };
