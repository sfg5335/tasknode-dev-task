'use strict';

/**
 * Dependency-free, single-file, deterministic minimum-weight spanning
 * arborescence solver for directed weighted graphs, using the
 * Chu-Liu/Edmonds algorithm.
 *
 * minimumArborescence(vertexCount, edges, root)
 *   `vertexCount` is the number of vertices, addressed `0..vertexCount-1`.
 *   Must be an integer >= 1.
 *
 *   `edges` is an array of `{ from, to, weight }` objects (directed edge
 *   `from -> to`). `from`/`to` must be integers in `[0, vertexCount)`;
 *   `weight` must be a number (negative weights are explicitly allowed --
 *   the algorithm's correctness does not depend on non-negativity, unlike
 *   e.g. Dijkstra or the maximum-adjacency step of Stoer-Wagner). Each
 *   edge's *original* index in the input `edges` array is preserved and
 *   is what gets reported back in `edgeIndices`. Parallel edges (same
 *   `from`/`to` pair, appearing more than once) are fully supported.
 *   Self-loops (`from === to`) are valid input but are always ignored --
 *   a self-loop can never be any vertex's required unique parent edge in
 *   a tree.
 *
 *   `root` is the vertex the arborescence is rooted at; must be an
 *   integer in `[0, vertexCount)`.
 *
 *   Returns `{ weight, edgeIndices }` when a spanning arborescence rooted
 *   at `root` exists: a directed tree in which every vertex other than
 *   `root` has exactly one incoming edge (its unique parent edge) and
 *   every vertex is reachable from `root`. `weight` is the sum of the
 *   *original* weights of the selected edges; `edgeIndices` is the
 *   ascending-sorted array of their indices into the input `edges` array
 *   (there are always exactly `vertexCount - 1` of them). Returns `null`
 *   when no such arborescence exists (some vertex can never receive a
 *   valid parent edge, directly or through any chain of vertices,
 *   without eventually requiring an edge from outside the graph).
 *
 *   When more than one minimum-weight arborescence exists, ties are
 *   broken deterministically: at every point the algorithm must choose
 *   among multiple equal-weight candidate edges for the same vertex, it
 *   picks the one with the smallest original input index. Combined with
 *   the algorithm's otherwise fully deterministic structure (fixed
 *   vertex-scan order for cycle detection, fixed choice of cycle
 *   representative), this makes the result exactly reproducible for a
 *   given input, run after run.
 *
 *   Every input is validated: a non-integer/non-number `vertexCount`,
 *   `root`, `from`, or `to`, a non-object edge, or a non-number `weight`,
 *   throws `TypeError`; a correctly-typed `vertexCount < 1`, `root` or
 *   `from`/`to` outside `[0, vertexCount)`, or a non-finite (`NaN`/
 *   `Infinity`) `weight`, throws `RangeError`. Neither `edges` nor any of
 *   its elements is ever mutated.
 *
 * Algorithm: the classic Chu-Liu/Edmonds minimum spanning arborescence
 * algorithm, implemented recursively in its simplest (one-cycle-at-a-
 * time) form for clarity and correctness over raw speed:
 *
 *   1. For every active vertex other than `root`, pick its cheapest
 *      incoming edge (ties broken by smallest original index). If any
 *      active non-root vertex has no incoming edge at all, no
 *      arborescence exists -- fail.
 *   2. Follow those "cheapest parent" pointers from every vertex; if
 *      they ever form a cycle, that cycle can never all simultaneously
 *      keep their cheapest edge in a real tree (a tree has no cycles),
 *      so contract the whole cycle into a single supernode (keeping the
 *      cycle's smallest vertex id as the supernode's id, for
 *      determinism). Every edge entering the cycle from outside has its
 *      weight reduced by the weight of the cycle-internal edge it would
 *      "replace" at its entry point -- this is what makes comparing
 *      entry points on the contracted graph equivalent to comparing full
 *      alternatives on the original graph. Edges entirely inside the
 *      cycle become self-loops on the supernode and are dropped; edges
 *      leaving the cycle are carried over unchanged. Then recurse on the
 *      contracted graph.
 *   3. If no cycle is found, the "cheapest parent" pointers already form
 *      a valid arborescence directly -- done.
 *   4. When unwinding a contraction, the recursive result names exactly
 *      one edge entering the supernode (since the supernode needed
 *      exactly one incoming edge, like any other non-root vertex); that
 *      edge "breaks" the cycle at whichever original vertex it actually
 *      enters, so every *other* cycle member keeps its own original
 *      cheapest-parent edge, and all of those plus the entering edge
 *      become part of the final answer.
 *
 * The final reported `weight` is always computed by summing the
 * *original*, unadjusted weights of the selected edges from the
 * caller-supplied `edges` array -- the weight *reductions* used during
 * contraction are strictly an internal comparison device for picking the
 * cheapest entry point into a contracted cycle, never part of the
 * reported total.
 */

function isFiniteInteger(v) {
  return typeof v === 'number' && Number.isInteger(v);
}

/**
 * Solves one level of Chu-Liu/Edmonds over `activeVertices` (a Set of
 * currently-active vertex ids) and `workingEdges` (edges among active
 * vertices; `weight` may already be contraction-adjusted, `origIndex`
 * always refers to the original input edge). Returns a `Set` of the
 * selected edges' `origIndex` values, or `null` if infeasible.
 */
function solve(activeVertices, workingEdges, root) {
  // Step 1: cheapest incoming edge for every active vertex except root.
  const minIn = new Map();
  for (const v of activeVertices) {
    if (v === root) continue;
    let best = null;
    for (const e of workingEdges) {
      if (e.to !== v || e.from === v) continue; // wrong target, or a self-loop
      if (
        best === null ||
        e.weight < best.weight ||
        (e.weight === best.weight && e.origIndex < best.origIndex)
      ) {
        best = e;
      }
    }
    if (best === null) return null; // v can never receive a parent edge
    minIn.set(v, best);
  }

  // Step 2: detect a cycle among the minIn predecessor pointers, scanning
  // active vertices in a fixed (ascending) order for full determinism.
  const state = new Map(); // 0 = unvisited, 1 = in-progress, 2 = done
  const sortedActive = Array.from(activeVertices).sort((a, b) => a - b);
  for (const v of sortedActive) state.set(v, v === root ? 2 : 0);

  let cycleStart = null;
  for (const start of sortedActive) {
    if (state.get(start) !== 0) continue;
    const path = [];
    let u = start;
    while (state.get(u) === 0) {
      state.set(u, 1);
      path.push(u);
      u = minIn.get(u).from;
    }
    if (state.get(u) === 1) cycleStart = u;
    for (const x of path) state.set(x, 2);
    if (cycleStart !== null) break;
  }

  if (cycleStart === null) {
    // No cycle: the cheapest-parent pointers already form the arborescence.
    const edgeIndices = new Set();
    for (const v of activeVertices) {
      if (v === root) continue;
      edgeIndices.add(minIn.get(v).origIndex);
    }
    return edgeIndices;
  }

  // Extract the cycle's members by following minIn from cycleStart.
  const cycleMembers = [];
  {
    let u = cycleStart;
    do {
      cycleMembers.push(u);
      u = minIn.get(u).from;
    } while (u !== cycleStart);
  }
  const cycleSet = new Set(cycleMembers);
  const superId = Math.min(...cycleMembers); // deterministic representative

  const newActive = new Set();
  for (const v of activeVertices) {
    if (!cycleSet.has(v)) newActive.add(v);
  }
  newActive.add(superId);

  const newEdges = [];
  const enteringVertexByOrigIndex = new Map();
  for (const e of workingEdges) {
    const fromInCycle = cycleSet.has(e.from);
    const toInCycle = cycleSet.has(e.to);
    if (fromInCycle && toInCycle) continue; // wholly internal -> becomes a self-loop, drop
    const newFrom = fromInCycle ? superId : e.from;
    const newTo = toInCycle ? superId : e.to;
    if (newFrom === newTo) continue; // defensive: would be a self-loop on the supernode

    if (toInCycle) {
      const reducedWeight = e.weight - minIn.get(e.to).weight;
      newEdges.push({ from: newFrom, to: newTo, weight: reducedWeight, origIndex: e.origIndex });
      enteringVertexByOrigIndex.set(e.origIndex, e.to);
    } else {
      newEdges.push({ from: newFrom, to: newTo, weight: e.weight, origIndex: e.origIndex });
    }
  }

  const subResult = solve(newActive, newEdges, root);
  if (subResult === null) return null;

  let enteringOrigIndex = null;
  for (const origIndex of subResult) {
    if (enteringVertexByOrigIndex.has(origIndex)) {
      enteringOrigIndex = origIndex;
      break;
    }
  }
  // subResult is a valid arborescence of the contracted graph, so the
  // supernode (a non-root active vertex there) always has exactly one
  // selected incoming edge, and every edge with to === superId came from
  // the toInCycle branch above -- enteringOrigIndex is always found.

  const brokenVertex = enteringVertexByOrigIndex.get(enteringOrigIndex);

  const finalEdgeIndices = new Set(subResult);
  for (const member of cycleMembers) {
    if (member !== brokenVertex) {
      finalEdgeIndices.add(minIn.get(member).origIndex);
    }
  }
  return finalEdgeIndices;
}

function minimumArborescence(vertexCount, edges, root) {
  if (!isFiniteInteger(vertexCount)) {
    throw new TypeError('vertexCount must be an integer');
  }
  if (vertexCount < 1) {
    throw new RangeError('vertexCount must be at least 1');
  }
  if (!Array.isArray(edges)) {
    throw new TypeError('edges must be an array');
  }
  if (!isFiniteInteger(root)) {
    throw new TypeError('root must be an integer');
  }
  if (root < 0 || root >= vertexCount) {
    throw new RangeError(`root out of range: ${root}`);
  }

  const workingEdges = edges.map((e, i) => {
    if (typeof e !== 'object' || e === null || Array.isArray(e)) {
      throw new TypeError(`edges[${i}] must be an object of the form { from, to, weight }`);
    }
    const { from, to, weight } = e;
    if (!isFiniteInteger(from)) throw new TypeError(`edges[${i}].from must be an integer`);
    if (!isFiniteInteger(to)) throw new TypeError(`edges[${i}].to must be an integer`);
    if (from < 0 || from >= vertexCount) throw new RangeError(`edges[${i}].from out of range: ${from}`);
    if (to < 0 || to >= vertexCount) throw new RangeError(`edges[${i}].to out of range: ${to}`);
    if (typeof weight !== 'number') throw new TypeError(`edges[${i}].weight must be a number`);
    if (!Number.isFinite(weight)) throw new RangeError(`edges[${i}].weight must be finite`);
    return { from, to, weight, origIndex: i };
  });

  const activeVertices = new Set();
  for (let v = 0; v < vertexCount; v++) activeVertices.add(v);

  const selected = solve(activeVertices, workingEdges, root);
  if (selected === null) return null;

  const edgeIndices = Array.from(selected).sort((a, b) => a - b);
  let weight = 0;
  for (const i of edgeIndices) weight += edges[i].weight; // sum ORIGINAL weights, never adjusted ones
  return { weight, edgeIndices };
}

module.exports = { minimumArborescence };
