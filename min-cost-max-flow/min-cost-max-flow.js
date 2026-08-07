'use strict';

/**
 * Dependency-free, single-file, deterministic minimum-cost maximum-flow
 * solver for directed graphs with per-edge capacities and costs, using
 * the classic Successive Shortest (Augmenting) Paths algorithm over a
 * residual network, with Bellman-Ford for shortest-path search so that
 * negative edge costs are fully supported.
 *
 * minCostMaxFlow(vertexCount, edges, source, sink, flowLimit)
 *   `vertexCount` is the number of vertices, addressed `0..vertexCount-1`.
 *   Must be a safe integer >= 1.
 *
 *   `edges` is an array of `{ from, to, capacity, cost }` objects
 *   (directed edge `from -> to`). `from`/`to` must be safe integers in
 *   `[0, vertexCount)`; `capacity` must be a safe integer `>= 0`; `cost`
 *   must be a safe integer of either sign (negative costs are fully
 *   supported). Parallel edges (repeated `from`/`to` pairs) are fully
 *   supported and tracked independently. Self-loops (`from === to`) are
 *   valid input; a non-negative-cost self-loop is always inert (it can
 *   never appear on any shortest path), while a negative-cost self-loop
 *   with positive capacity is itself a length-1 negative-cost cycle (see
 *   below).
 *
 *   `source` and `sink` must be distinct safe integers in
 *   `[0, vertexCount)`.
 *
 *   `flowLimit` is optional. When provided it must be a safe integer
 *   `>= 0`, capping how much flow may be pushed; when omitted (or
 *   explicitly `undefined`), flow is pushed until no further augmenting
 *   path exists (true maximum flow).
 *
 *   Returns `{ flow, cost, edgeFlows }`: `flow` is the total flow pushed
 *   from `source` to `sink` (the maximum possible, capped at
 *   `flowLimit`); `cost` is the minimum total cost of achieving that
 *   flow value; `edgeFlows` is an array parallel to `edges`, where
 *   `edgeFlows[i]` is the net flow carried by `edges[i]` (always in
 *   `[0, edges[i].capacity]`).
 *
 *   Rejects (throws `RangeError`) whenever the *original* graph (edges
 *   with positive capacity only) contains a negative-cost cycle
 *   reachable from `source` -- such a cycle makes "the" minimum cost
 *   ill-defined for this algorithm (flow could always be shaved cheaper
 *   by circulating more around the cycle) rather than attempting the
 *   separate, harder negative-cycle-canceling problem.
 *
 *   Every input is validated: a non-safe-integer `vertexCount`, `source`,
 *   `sink`, `edges[i].from`, `edges[i].to`, `edges[i].capacity`,
 *   `edges[i].cost`, or `flowLimit` (when provided), a non-array
 *   `edges`, or a non-object edge, throws `TypeError`; a correctly-typed
 *   `vertexCount < 1`, `source`/`sink`/`edges[i].from`/`edges[i].to`
 *   outside `[0, vertexCount)`, `source === sink`, a negative
 *   `edges[i].capacity`, a negative `flowLimit`, or a reachable negative-
 *   cost cycle, throws `RangeError`. Neither `edges` nor any edge object
 *   is ever mutated.
 *
 *   Determinism: Bellman-Ford always relaxes arcs in one fixed order
 *   (each input edge's forward arc, then its reverse arc, in input
 *   order) and only ever updates a distance on a *strict* improvement,
 *   so whichever equally-short path is discovered first in that fixed
 *   scan order is the one kept -- every run on the same input produces
 *   byte-for-byte identical `{ flow, cost, edgeFlows }`.
 *
 * Algorithm notes: each input edge becomes a residual-arc pair (a
 * forward arc carrying up to `capacity` flow at `cost` per unit, and a
 * reverse arc, initially at zero residual capacity, that "gives back"
 * previously-sent flow at `-cost` per unit, enabling later augmenting
 * paths to reroute earlier flow -- the standard mechanism by which SSP
 * reaches the true minimum-cost solution). Each phase runs Bellman-Ford
 * from `source` over all arcs with positive residual capacity, and if
 * `sink` is reachable, pushes flow equal to the bottleneck residual
 * capacity along that shortest path (capped by any remaining
 * `flowLimit`). A classical theorem guarantees that as long as the
 * *original* graph has no negative-cost cycle reachable from `source`,
 * the residual graph never develops one either as long as every
 * augmentation is along a shortest path -- which is exactly what this
 * algorithm always does -- so a single upfront check suffices.
 */

function isSafeInt(v) {
  return typeof v === 'number' && Number.isSafeInteger(v);
}

/** Detects whether `source` can reach a negative-cost cycle using only
 * `positiveCapacityEdges` (plain { from, to, cost } triples). Standard
 * technique: run Bellman-Ford for `vertexCount - 1` rounds, then do one
 * more relaxation pass -- any edge that can still relax a *reachable*
 * vertex proves a negative cycle reachable from `source`. */
function hasReachableNegativeCycle(vertexCount, positiveCapacityEdges, source) {
  const dist = new Array(vertexCount).fill(Infinity);
  dist[source] = 0;
  for (let iter = 0; iter < vertexCount - 1; iter++) {
    let any = false;
    for (const e of positiveCapacityEdges) {
      if (dist[e.from] === Infinity) continue;
      const nd = dist[e.from] + e.cost;
      if (nd < dist[e.to]) {
        dist[e.to] = nd;
        any = true;
      }
    }
    if (!any) break;
  }
  for (const e of positiveCapacityEdges) {
    if (dist[e.from] === Infinity) continue;
    if (dist[e.from] + e.cost < dist[e.to]) return true;
  }
  return false;
}

/** One Bellman-Ford shortest-path search over the current residual
 * graph, scanning `arcs` in a fixed order every call. Returns
 * `{ dist, parentArc }`; `parentArc[v]` is the arc index used to reach
 * `v` on the (deterministically chosen) shortest path from `source`. */
function bellmanFord(vertexCount, arcs, residualCap, source) {
  const dist = new Array(vertexCount).fill(Infinity);
  const parentArc = new Array(vertexCount).fill(-1);
  dist[source] = 0;
  for (let iter = 0; iter < vertexCount - 1; iter++) {
    let any = false;
    for (let a = 0; a < arcs.length; a++) {
      if (residualCap[a] <= 0) continue;
      const arc = arcs[a];
      if (dist[arc.from] === Infinity) continue;
      const nd = dist[arc.from] + arc.cost;
      if (nd < dist[arc.to]) {
        dist[arc.to] = nd;
        parentArc[arc.to] = a;
        any = true;
      }
    }
    if (!any) break;
  }
  return { dist, parentArc };
}

function minCostMaxFlow(vertexCount, edges, source, sink, flowLimit) {
  if (!isSafeInt(vertexCount)) throw new TypeError('vertexCount must be a safe integer');
  if (vertexCount < 1) throw new RangeError('vertexCount must be at least 1');
  if (!Array.isArray(edges)) throw new TypeError('edges must be an array');
  if (!isSafeInt(source)) throw new TypeError('source must be a safe integer');
  if (!isSafeInt(sink)) throw new TypeError('sink must be a safe integer');
  if (source < 0 || source >= vertexCount) throw new RangeError(`source out of range: ${source}`);
  if (sink < 0 || sink >= vertexCount) throw new RangeError(`sink out of range: ${sink}`);
  if (source === sink) throw new RangeError('source and sink must be distinct');

  let limit = Infinity;
  if (flowLimit !== undefined) {
    if (!isSafeInt(flowLimit)) throw new TypeError('flowLimit must be a safe integer when provided');
    if (flowLimit < 0) throw new RangeError('flowLimit must be non-negative');
    limit = flowLimit;
  }

  const parsedEdges = edges.map((e, i) => {
    if (typeof e !== 'object' || e === null || Array.isArray(e)) {
      throw new TypeError(`edges[${i}] must be an object of the form { from, to, capacity, cost }`);
    }
    const { from, to, capacity, cost } = e;
    if (!isSafeInt(from)) throw new TypeError(`edges[${i}].from must be a safe integer`);
    if (!isSafeInt(to)) throw new TypeError(`edges[${i}].to must be a safe integer`);
    if (from < 0 || from >= vertexCount) throw new RangeError(`edges[${i}].from out of range: ${from}`);
    if (to < 0 || to >= vertexCount) throw new RangeError(`edges[${i}].to out of range: ${to}`);
    if (!isSafeInt(capacity)) throw new TypeError(`edges[${i}].capacity must be a safe integer`);
    if (capacity < 0) throw new RangeError(`edges[${i}].capacity must be non-negative`);
    if (!isSafeInt(cost)) throw new TypeError(`edges[${i}].cost must be a safe integer`);
    return { from, to, capacity, cost };
  });

  const positiveCapacityEdges = parsedEdges.filter((e) => e.capacity > 0);
  if (hasReachableNegativeCycle(vertexCount, positiveCapacityEdges, source)) {
    throw new RangeError('a negative-cost cycle is reachable from source');
  }

  // Build the residual arc-pair array: arcs[2*i] is edge i's forward arc,
  // arcs[2*i + 1] is its reverse arc. residualCap tracks mutable residual
  // capacity separately from the (never-mutated) parsed edge data.
  const arcs = [];
  const residualCap = [];
  for (const e of parsedEdges) {
    arcs.push({ from: e.from, to: e.to, cost: e.cost });
    residualCap.push(e.capacity);
    arcs.push({ from: e.to, to: e.from, cost: -e.cost });
    residualCap.push(0);
  }

  let totalFlow = 0;
  let totalCost = 0;

  while (totalFlow < limit) {
    const { dist, parentArc } = bellmanFord(vertexCount, arcs, residualCap, source);
    if (dist[sink] === Infinity) break; // sink unreachable in the current residual graph -- max flow reached

    let bottleneck = limit - totalFlow;
    let v = sink;
    while (v !== source) {
      const a = parentArc[v];
      bottleneck = Math.min(bottleneck, residualCap[a]);
      v = arcs[a].from;
    }

    v = sink;
    while (v !== source) {
      const a = parentArc[v];
      const pair = a % 2 === 0 ? a + 1 : a - 1;
      residualCap[a] -= bottleneck;
      residualCap[pair] += bottleneck;
      v = arcs[a].from;
    }

    totalFlow += bottleneck;
    totalCost += bottleneck * dist[sink];
  }

  const edgeFlows = parsedEdges.map((e, i) => e.capacity - residualCap[2 * i]);

  return { flow: totalFlow, cost: totalCost, edgeFlows };
}

module.exports = { minCostMaxFlow };
