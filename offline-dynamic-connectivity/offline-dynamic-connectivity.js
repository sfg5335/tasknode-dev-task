'use strict';

// Deterministic OFFLINE dynamic graph connectivity via the classic
// "segment tree over time, with a rollback union-find" technique.
//
// The whole operation sequence is known in advance (hence "offline"). Each
// undirected edge is active during zero or more contiguous stretches of
// time between when it is added and when it is later removed (or the end
// of the sequence, if it is never removed). Rather than recomputing
// connectivity from scratch at every query -- or maintaining a fully
// dynamic (online) connectivity structure -- this implementation:
//
//   1. Makes one linear pass over the operations to compute each edge's
//      active-time interval(s) as half-open ranges [addIndex, removeIndex)
//      of operation indices.
//   2. Builds an implicit segment tree over the operation-index range
//      [0, operations.length) and, for each edge interval, attaches the
//      edge to the O(log Q) canonical segment-tree nodes that exactly
//      tile that interval (the standard "segment tree union" / "interval
//      add" decomposition).
//   3. Performs one DFS over the segment tree. Entering a node unions
//      every edge attached to it into a union-find structure; at a leaf,
//      any query at that operation index is answered from the union-find
//      state that is live at that point in the DFS (which reflects
//      exactly the edges whose interval covers this leaf, since an edge
//      is unioned at every ancestor node its interval was assigned to,
//      and every leaf under such a node is inside that edge's interval).
//      Leaving a node rolls the union-find back to its state on entry, so
//      sibling subtrees never see each other's unions.
//
// Total cost is O((Q + E) log Q log V): O(log Q) segment-tree nodes per
// edge interval, O(log V) per union/find (no path compression -- see
// below), and each of the O(Q log Q) total (node, edge) attachments does
// O(log V) work.

// ---------------------------------------------------------------------
// Rollback union-find (disjoint-set union).
//
// Deliberately does NOT use path compression: path compression can touch
// an unbounded number of parent pointers per find(), which would make
// "undo the last K structural changes" unbounded work too. Union by size
// alone still guarantees O(log V) tree height (a tree of size s can only
// result from merging two trees of size >= s/2, so height at most
// doubles... standard result: height <= floor(log2(V))), so find() stays
// O(log V) without path compression, and every union() mutates exactly
// one parent pointer and one size counter -- trivial to reverse.
//
// Tie-break rule (spec-mandated, otherwise unions would not be
// deterministic): when the two roots have equal size, the SMALLER root
// (by vertex index) wins, i.e. becomes the parent of the larger-indexed
// root. Combined with "larger size wins" when sizes differ, this gives a
// single total order: prefer the root with strictly greater size; break
// size ties by preferring the smaller index.
// ---------------------------------------------------------------------
class RollbackUnionFind {
  constructor(n) {
    this.parent = new Int32Array(n);
    for (let i = 0; i < n; i++) this.parent[i] = i;
    this.size = new Int32Array(n).fill(1);
    this.componentCount = n;
    // History is a flat stack of merge records. Each successful union
    // pushes one record; a no-op union (already same component) pushes
    // nothing, so history length is exactly the number of *structural*
    // changes made so far -- rollback() walks it back to a saved length.
    this.history = [];
  }

  find(x) {
    let root = x;
    while (this.parent[root] !== root) root = this.parent[root];
    return root;
  }

  // Returns true iff a structural merge happened (false if x and y were
  // already in the same component -- includes the self-loop case x===y).
  union(x, y) {
    const rx = this.find(x);
    const ry = this.find(y);
    if (rx === ry) return false;

    let winner = rx;
    let loser = ry;
    if (
      this.size[rx] < this.size[ry] ||
      (this.size[rx] === this.size[ry] && rx > ry)
    ) {
      winner = ry;
      loser = rx;
    }

    this.history.push({ loser, winner, winnerOldSize: this.size[winner] });
    this.parent[loser] = winner;
    this.size[winner] += this.size[loser];
    this.componentCount--;
    return true;
  }

  // Opaque snapshot token: just the current history length.
  snapshot() {
    return this.history.length;
  }

  // Undo every union performed since `token` was captured, in reverse
  // order, restoring parent pointers, sizes, and componentCount exactly.
  rollback(token) {
    while (this.history.length > token) {
      const { loser, winner, winnerOldSize } = this.history.pop();
      this.parent[loser] = loser;
      this.size[winner] = winnerOldSize;
      this.componentCount++;
    }
  }
}

// ---------------------------------------------------------------------
// Input parsing / validation.
//
// TypeError: malformed inputs -- wrong argument types/shapes, unknown
//   operation `type`, non-integer or missing `u`/`v`.
// RangeError: values that are the right *type* but violate a graph-level
//   constraint -- a vertex index outside [0, vertexCount - 1], adding an
//   edge that is already active, or removing an edge that is not active.
// ---------------------------------------------------------------------
const VALID_TYPES = new Set(['add', 'remove', 'connected', 'componentCount']);

function parseOperations(vertexCount, operations) {
  const parsed = new Array(operations.length);
  for (let i = 0; i < operations.length; i++) {
    const op = operations[i];
    if (op === null || typeof op !== 'object' || Array.isArray(op)) {
      throw new TypeError(`operations[${i}] must be a plain object`);
    }
    const type = op.type;
    if (typeof type !== 'string' || !VALID_TYPES.has(type)) {
      throw new TypeError(
        `operations[${i}].type must be one of 'add', 'remove', 'connected', 'componentCount'`
      );
    }
    if (type === 'componentCount') {
      parsed[i] = { type };
      continue;
    }
    const { u, v } = op;
    if (!Number.isInteger(u) || !Number.isInteger(v)) {
      throw new TypeError(
        `operations[${i}] of type '${type}' must have integer u and v`
      );
    }
    if (u < 0 || u >= vertexCount || v < 0 || v >= vertexCount) {
      throw new RangeError(
        `operations[${i}] references a vertex outside [0, ${vertexCount - 1}]`
      );
    }
    parsed[i] = { type, u, v };
  }
  return parsed;
}

// Canonical undirected-edge key: order-independent, so (u, v) and (v, u)
// always refer to the same tracked edge (including the u === v self-loop
// case, where lo === hi trivially).
function edgeKey(u, v) {
  const lo = u < v ? u : v;
  const hi = u < v ? v : u;
  return `${lo},${hi}`;
}

// One forward pass over the parsed operations: applies 'add'/'remove' to
// a map of currently-active edges (keyed canonically), validating
// duplicate-active-addition / remove-of-inactive-edge as it goes, and
// closes off each edge's active interval(s) as [start, end) pairs. Any
// edge still active when the pass ends gets a final interval that
// extends to `operations.length` (the end of time).
function buildActiveIntervals(parsedOperations) {
  const activeStart = new Map(); // canonical key -> operation index it was added at
  const activeEndpoints = new Map(); // canonical key -> { u, v } (canonical lo/hi)
  const intervals = [];

  for (let i = 0; i < parsedOperations.length; i++) {
    const op = parsedOperations[i];
    if (op.type !== 'add' && op.type !== 'remove') continue;
    const key = edgeKey(op.u, op.v);
    if (op.type === 'add') {
      if (activeStart.has(key)) {
        throw new RangeError(
          `operations[${i}] adds edge (${op.u}, ${op.v}) which is already active`
        );
      }
      activeStart.set(key, i);
      const lo = op.u < op.v ? op.u : op.v;
      const hi = op.u < op.v ? op.v : op.u;
      activeEndpoints.set(key, { u: lo, v: hi });
    } else {
      if (!activeStart.has(key)) {
        throw new RangeError(
          `operations[${i}] removes edge (${op.u}, ${op.v}) which is not active`
        );
      }
      const start = activeStart.get(key);
      const { u, v } = activeEndpoints.get(key);
      activeStart.delete(key);
      activeEndpoints.delete(key);
      if (start < i) intervals.push({ u, v, start, end: i });
    }
  }

  for (const [key, start] of activeStart) {
    const { u, v } = activeEndpoints.get(key);
    if (start < parsedOperations.length) {
      intervals.push({ u, v, start, end: parsedOperations.length });
    }
  }

  return intervals;
}

// ---------------------------------------------------------------------
// Implicit segment tree over operation-index range [0, timelineSize).
// `buckets` maps a segment-tree node id (1-indexed, node 1 is the root,
// node k's children are 2k and 2k+1 -- the standard array-free encoding)
// to the list of edges assigned to exactly that node's range.
// ---------------------------------------------------------------------
function addIntervalToTree(buckets, node, nodeLo, nodeHi, lo, hi, edge) {
  // [lo, hi) does not intersect this node's [nodeLo, nodeHi) at all.
  if (hi <= nodeLo || nodeHi <= lo) return;
  // This node's range is fully covered by [lo, hi): stop here, don't
  // recurse further -- this is what gives the O(log Q) decomposition.
  if (lo <= nodeLo && nodeHi <= hi) {
    let list = buckets.get(node);
    if (list === undefined) {
      list = [];
      buckets.set(node, list);
    }
    list.push(edge);
    return;
  }
  const mid = nodeLo + ((nodeHi - nodeLo) >> 1);
  addIntervalToTree(buckets, 2 * node, nodeLo, mid, lo, hi, edge);
  addIntervalToTree(buckets, 2 * node + 1, mid, nodeHi, lo, hi, edge);
}

function dfsAndAnswer(buckets, dsu, parsedOperations, results, node, nodeLo, nodeHi) {
  const snapshot = dsu.snapshot();
  const list = buckets.get(node);
  if (list !== undefined) {
    for (const edge of list) dsu.union(edge.u, edge.v);
  }

  if (nodeHi - nodeLo === 1) {
    // Leaf: nodeLo is a single operation index. Only query-type
    // operations produce a result; add/remove already did their job
    // during interval construction and need no action here.
    const op = parsedOperations[nodeLo];
    if (op.type === 'connected') {
      results[nodeLo] = dsu.find(op.u) === dsu.find(op.v);
    } else if (op.type === 'componentCount') {
      results[nodeLo] = dsu.componentCount;
    }
  } else {
    const mid = nodeLo + ((nodeHi - nodeLo) >> 1);
    dfsAndAnswer(buckets, dsu, parsedOperations, results, 2 * node, nodeLo, mid);
    dfsAndAnswer(buckets, dsu, parsedOperations, results, 2 * node + 1, mid, nodeHi);
  }

  dsu.rollback(snapshot);
}

// solveDynamicConnectivity(vertexCount, operations) -> Array<boolean|number>
//
// vertexCount: non-negative integer; vertices are numbered 0..vertexCount-1.
// operations: array of
//   { type: 'add',            u, v }
//   { type: 'remove',         u, v }
//   { type: 'connected',      u, v }
//   { type: 'componentCount'          }
// processed strictly in input order, as if each 'add'/'remove' mutated a
// live graph and each 'connected'/'componentCount' query were answered
// against the graph's state at that exact point in the sequence.
//
// Returns one entry per query operation (type 'connected' or
// 'componentCount'), in the same relative order those queries appear in
// `operations` -- 'connected' entries are booleans, 'componentCount'
// entries are integers. Never mutates `operations` or any operation
// object within it.
function solveDynamicConnectivity(vertexCount, operations) {
  if (!Number.isInteger(vertexCount) || vertexCount < 0) {
    throw new TypeError('vertexCount must be a non-negative integer');
  }
  if (!Array.isArray(operations)) {
    throw new TypeError('operations must be an array');
  }

  const parsedOperations = parseOperations(vertexCount, operations);
  const timelineSize = parsedOperations.length;
  const intervals = buildActiveIntervals(parsedOperations);

  const results = new Array(timelineSize);

  if (timelineSize > 0) {
    const buckets = new Map();
    for (const edge of intervals) {
      addIntervalToTree(buckets, 1, 0, timelineSize, edge.start, edge.end, edge);
    }
    const dsu = new RollbackUnionFind(vertexCount);
    dfsAndAnswer(buckets, dsu, parsedOperations, results, 1, 0, timelineSize);
  }

  const output = [];
  for (let i = 0; i < timelineSize; i++) {
    const type = parsedOperations[i].type;
    if (type === 'connected' || type === 'componentCount') {
      output.push(results[i]);
    }
  }
  return output;
}

// `RollbackUnionFind` and `buildActiveIntervals` are exported alongside the
// required `solveDynamicConnectivity` so the rollback union-find and the
// active-interval-construction logic can each be inspected and tested
// directly, not just indirectly through solveDynamicConnectivity's
// black-box return values (which, by construction, are invariant to the
// union tie-break policy -- connectivity and component counts don't
// depend on *which* root of an equal-size pair wins, only test cases that
// call union() directly can observe that choice).
module.exports = {
  solveDynamicConnectivity,
  RollbackUnionFind,
  buildActiveIntervals,
};
