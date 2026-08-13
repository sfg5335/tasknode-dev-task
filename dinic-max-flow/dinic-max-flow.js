'use strict';

/**
 * Dependency-free, single-file, deterministic maximum-flow solver for
 * directed graphs with per-edge capacities, using Dinic's algorithm:
 * repeated BFS level-graph construction followed by DFS blocking-flow
 * search with the classic current-arc optimization.
 *
 * dinicMaxFlow(vertexCount, edges, source, sink)
 *   `vertexCount` is the number of vertices, addressed `0..vertexCount-1`.
 *   Must be a safe integer >= 1.
 *
 *   `edges` is an array of `{ from, to, capacity }` objects (directed
 *   edge `from -> to`). `from`/`to` must be safe integers in
 *   `[0, vertexCount)`; `capacity` must be a safe integer `>= 0`.
 *   Parallel edges (repeated `from`/`to` pairs) are fully supported and
 *   tracked independently -- each gets its own residual arc and its own
 *   entry in the returned `edgeFlows`. Self-loops (`from === to`) are
 *   valid input; a self-loop can never lie on a shortest-path level
 *   graph (it would require `level[u] + 1 === level[u]`), so it always
 *   carries zero flow, with no special-casing needed anywhere in the
 *   algorithm.
 *
 *   `source` and `sink` must be distinct safe integers in
 *   `[0, vertexCount)`.
 *
 *   Returns `{ maxFlow, edgeFlows }`: `maxFlow` is the maximum total
 *   flow that can be pushed from `source` to `sink`; `edgeFlows` is an
 *   array parallel to `edges`, where `edgeFlows[i]` is the net flow
 *   carried by `edges[i]` in the returned maximum-flow solution (always
 *   in `[0, edges[i].capacity]`).
 *
 *   Every input is validated: a non-safe-integer `vertexCount`,
 *   `source`, `sink`, `edges[i].from`, `edges[i].to`, or
 *   `edges[i].capacity`, a non-array `edges`, or a non-object edge,
 *   throws `TypeError`; a correctly-typed `vertexCount < 1`,
 *   `source`/`sink`/`edges[i].from`/`edges[i].to` outside
 *   `[0, vertexCount)`, `source === sink`, or a negative
 *   `edges[i].capacity`, throws `RangeError`. Neither `edges` nor any
 *   edge object is ever mutated.
 *
 *   Determinism: edges are processed in input order when building the
 *   residual graph, each vertex's adjacency list of arc indices is
 *   therefore also in a fixed order, BFS scans a vertex's arcs in that
 *   same fixed order, and DFS (including the current-arc pointers) does
 *   too -- every run on the same input produces byte-for-byte identical
 *   `{ maxFlow, edgeFlows }`.
 *
 * Algorithm notes: each input edge `i` becomes a residual-arc pair --
 * arc `2*i` is the forward arc `{ to, cap: capacity, rev: 2*i+1 }` and
 * arc `2*i+1` is the paired reverse arc `{ to: from, cap: 0, rev: 2*i }`
 * (`rev` is the index, within the *other* endpoint's arc list, of the
 * arc going back the other way). A phase begins with a BFS from
 * `source` over arcs with positive residual capacity, assigning each
 * reachable vertex a `level` (its BFS distance from `source`); if
 * `sink` is unreachable the algorithm terminates -- there is no
 * augmenting path left, so the flow already found is maximum. Otherwise
 * one or more DFS blocking-flow searches are run over the level graph
 * (only ever stepping from a vertex at level `L` to a vertex at level
 * `L + 1`, and only along arcs with positive residual capacity),
 * pushing flow along `source -> sink` paths found this way until no
 * more exist in this level graph, before moving to the next phase's
 * fresh BFS. The current-arc optimization keeps a per-vertex index
 * (`iter[v]`) into that vertex's adjacency list, persisted across all
 * DFS calls within a single phase; `iter[v]` only ever advances past an
 * arc once that arc has been proven useless *for the rest of this
 * phase* -- either its residual capacity is exhausted, or a DFS
 * through it returned 0 (meaning everything reachable that way is
 * already saturated within the current level graph) -- never merely
 * because flow was successfully pushed through it once, since the same
 * arc can carry more augmenting paths later in the same phase as long
 * as residual capacity remains. This is what bounds Dinic's algorithm
 * to O(V) phases, each doing O(V*E) work, for O(V^2*E) overall.
 */

function isSafeInt(v) {
  return typeof v === 'number' && Number.isSafeInteger(v);
}

/** BFS from `source` over arcs with positive residual capacity. Returns
 * the `level` array (`level[v] = -1` if `v` is unreachable from
 * `source` in the current residual graph), scanning each vertex's
 * adjacency list (array of arc indices) in a fixed order. */
function bfsLevels(vertexCount, adj, arcTo, arcCap, source) {
  const level = new Array(vertexCount).fill(-1);
  level[source] = 0;
  const queue = [source];
  let head = 0;
  while (head < queue.length) {
    const u = queue[head++];
    const list = adj[u];
    for (let k = 0; k < list.length; k++) {
      const a = list[k];
      if (arcCap[a] <= 0) continue;
      const v = arcTo[a];
      if (level[v] !== -1) continue;
      level[v] = level[u] + 1;
      queue.push(v);
    }
  }
  return level;
}

/** DFS blocking-flow search from `u` toward `sink`, bounded by `pushed`,
 * using and advancing the shared current-arc pointers in `iter`. Only
 * steps along arcs with positive residual capacity that lead to a
 * vertex exactly one level deeper. Returns the amount of flow actually
 * pushed (0 if none). */
function dfsBlockingFlow(u, sink, pushed, adj, arcTo, arcCap, arcRev, level, iter) {
  if (u === sink) return pushed;
  const list = adj[u];
  while (iter[u] < list.length) {
    const a = list[iter[u]];
    const v = arcTo[a];
    if (arcCap[a] > 0 && level[v] === level[u] + 1) {
      const got = dfsBlockingFlow(v, sink, Math.min(pushed, arcCap[a]), adj, arcTo, arcCap, arcRev, level, iter);
      if (got > 0) {
        arcCap[a] -= got;
        arcCap[arcRev[a]] += got;
        return got;
      }
    }
    // This arc cannot contribute anything more for the rest of this
    // phase (either its capacity is exhausted, it doesn't lead to the
    // next level, or everything past it is already saturated) -- advance
    // past it for good.
    iter[u]++;
  }
  return 0;
}

function dinicMaxFlow(vertexCount, edges, source, sink) {
  if (!isSafeInt(vertexCount)) throw new TypeError('vertexCount must be a safe integer');
  if (vertexCount < 1) throw new RangeError('vertexCount must be at least 1');
  if (!Array.isArray(edges)) throw new TypeError('edges must be an array');
  if (!isSafeInt(source)) throw new TypeError('source must be a safe integer');
  if (!isSafeInt(sink)) throw new TypeError('sink must be a safe integer');
  if (source < 0 || source >= vertexCount) throw new RangeError(`source out of range: ${source}`);
  if (sink < 0 || sink >= vertexCount) throw new RangeError(`sink out of range: ${sink}`);
  if (source === sink) throw new RangeError('source and sink must be distinct');

  const parsedEdges = edges.map((e, i) => {
    if (typeof e !== 'object' || e === null || Array.isArray(e)) {
      throw new TypeError(`edges[${i}] must be an object of the form { from, to, capacity }`);
    }
    const { from, to, capacity } = e;
    if (!isSafeInt(from)) throw new TypeError(`edges[${i}].from must be a safe integer`);
    if (!isSafeInt(to)) throw new TypeError(`edges[${i}].to must be a safe integer`);
    if (from < 0 || from >= vertexCount) throw new RangeError(`edges[${i}].from out of range: ${from}`);
    if (to < 0 || to >= vertexCount) throw new RangeError(`edges[${i}].to out of range: ${to}`);
    if (!isSafeInt(capacity)) throw new TypeError(`edges[${i}].capacity must be a safe integer`);
    if (capacity < 0) throw new RangeError(`edges[${i}].capacity must be non-negative`);
    return { from, to, capacity };
  });

  // Build the residual arc-pair arrays: arc 2*i is edge i's forward arc,
  // arc 2*i+1 is its reverse arc. adj[v] lists, in fixed input order, the
  // arc indices leaving v.
  const arcTo = [];
  const arcCap = [];
  const arcRev = [];
  const adj = Array.from({ length: vertexCount }, () => []);
  for (const e of parsedEdges) {
    const fwd = arcTo.length;
    arcTo.push(e.to);
    arcCap.push(e.capacity);
    arcRev.push(fwd + 1);
    adj[e.from].push(fwd);

    const rev = arcTo.length;
    arcTo.push(e.from);
    arcCap.push(0);
    arcRev.push(fwd);
    adj[e.to].push(rev);
  }

  let maxFlow = 0;
  for (;;) {
    const level = bfsLevels(vertexCount, adj, arcTo, arcCap, source);
    if (level[sink] === -1) break; // sink unreachable -- no augmenting path left, flow is maximum

    const iter = new Array(vertexCount).fill(0);
    for (;;) {
      const pushed = dfsBlockingFlow(source, sink, Infinity, adj, arcTo, arcCap, arcRev, level, iter);
      if (pushed <= 0) break;
      maxFlow += pushed;
    }
  }

  const edgeFlows = parsedEdges.map((e, i) => e.capacity - arcCap[2 * i]);

  return { maxFlow, edgeFlows };
}

module.exports = { dinicMaxFlow };
