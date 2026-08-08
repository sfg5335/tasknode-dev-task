'use strict';

/**
 * Dependency-free, single-file, deterministic Reduced Ordered Binary
 * Decision Diagram (`ROBDD`) over a fixed, caller-supplied variable order,
 * in JavaScript, with an automated `node:test` suite.
 *
 * new ROBDD(variableOrder)
 *   Constructs an empty diagram universe fixed to `variableOrder` (an
 *   array of distinct variable-name strings, index 0 = highest in the
 *   diagram, i.e. tested first from the root). All node handles produced
 *   by this instance (via `variable`/`not`/`apply`) are only meaningful
 *   relative to this same instance -- handles are plain non-negative
 *   integers indexing into this instance's private node table, and
 *   handles from two different `ROBDD` instances are never
 *   interchangeable, even if constructed with the same variable order.
 *
 * Fixed terminal handles (same across every instance):
 *   `ROBDD.FALSE` -- always `0`.
 *   `ROBDD.TRUE`  -- always `1`.
 *
 * Instance API (every method validates its arguments -- see below):
 *   `variable(name)` -- returns the handle for the elementary Boolean
 *   function "the value of variable `name`" (i.e. `low = FALSE,
 *   high = TRUE` at `name`'s rank).
 *   `not(handle)` -- returns the handle for the logical negation of the
 *   function `handle` represents.
 *   `apply(op, a, b)` -- returns the handle for combining the functions
 *   `a` and `b` represent with the binary Boolean operator `op`, which
 *   must be one of `'AND'`, `'OR'`, `'XOR'`.
 *   `evaluate(handle, assignment)` -- returns the boolean result of
 *   evaluating the function `handle` represents against a *complete*
 *   assignment (a plain object mapping every variable name in this
 *   instance's `variableOrder` to a strict boolean).
 *   `satCount(handle)` -- returns a `BigInt`: the exact number of
 *   distinct complete assignments (over all of `variableOrder`, not just
 *   the variables `handle`'s reachable nodes happen to test) that make
 *   the function `handle` represents evaluate to `true`.
 *   `nodeCount(handle)` -- returns a plain number: the count of distinct
 *   nodes reachable from `handle` (following `low`/`high` edges),
 *   including whichever terminal node(s) are reached (see Design notes
 *   in the accompanying README for why terminals are included).
 *
 * Canonicity: this instance hash-conses every non-terminal node it ever
 * creates in a unique table keyed by `(variableRank, low, high)`, and
 * collapses any node whose `low === high` directly to that shared child
 * handle instead of creating a new node. Consequently, two calls that
 * construct the *same* Boolean function -- even via completely different
 * sequences of `variable`/`not`/`apply` calls -- always end up returning
 * the exact same integer handle. This is the defining ROBDD property:
 * structural (node-identity) equality *is* semantic (function) equality.
 *
 * `not` and `apply` are both memoized (per-instance, keyed on their
 * operand handles and, for `apply`, the operator too) so that repeated
 * sub-computations inside a single recursive call -- and repeated calls
 * across the instance's lifetime -- are never recomputed from scratch.
 *
 * "Skipped" variables (a node whose function doesn't actually depend on
 * some variable that sits between its own rank and a rank it eventually
 * reaches lower in the diagram) are handled naturally by both `apply`'s
 * cofactor recursion (a node not at the current top rank simply
 * contributes its own handle unchanged to *both* the low and high
 * cofactors, exactly as the standard reduced-BDD `apply` algorithm
 * requires) and `satCount`'s `2^gap` multiplier (see that method for
 * detail) -- no special-casing is needed anywhere else.
 */

const OPS = new Set(['AND', 'OR', 'XOR']);

class ROBDD {
  static get FALSE() {
    return 0;
  }

  static get TRUE() {
    return 1;
  }

  constructor(variableOrder) {
    if (!Array.isArray(variableOrder)) {
      throw new TypeError('variableOrder must be an array');
    }
    variableOrder.forEach((name, i) => {
      if (typeof name !== 'string') {
        throw new TypeError(`variableOrder[${i}] must be a string`);
      }
    });
    const seen = new Set();
    for (const name of variableOrder) {
      if (seen.has(name)) {
        throw new RangeError(`variableOrder contains duplicate variable name: ${JSON.stringify(name)}`);
      }
      seen.add(name);
    }

    this._variableOrder = variableOrder.slice();
    this._varRank = new Map(this._variableOrder.map((name, i) => [name, i]));

    // Node table. Index 0 and 1 are the fixed terminal placeholders.
    // Non-terminal nodes store { varRank, low, high }.
    this._nodes = [
      { isTerminal: true, value: false },
      { isTerminal: true, value: true },
    ];

    // Hash-consing unique table for non-terminal nodes:
    // `${varRank}|${low}|${high}` -> handle.
    this._uniqueTable = new Map();

    this._notCache = new Map(); // handle -> handle
    this._applyCache = new Map(); // `${op}|${a}|${b}` -> handle

    this._varNodeCache = new Map(); // rank -> handle, for `variable()`
  }

  get variableOrder() {
    return this._variableOrder.slice();
  }

  variable(name) {
    if (typeof name !== 'string') {
      throw new TypeError('name must be a string');
    }
    const rank = this._varRank.get(name);
    if (rank === undefined) {
      throw new RangeError(`unknown variable: ${JSON.stringify(name)}`);
    }
    const cached = this._varNodeCache.get(rank);
    if (cached !== undefined) return cached;
    const handle = this._makeNode(rank, ROBDD.FALSE, ROBDD.TRUE);
    this._varNodeCache.set(rank, handle);
    return handle;
  }

  not(handle) {
    this._checkHandle(handle);
    return this._notRec(handle);
  }

  apply(op, a, b) {
    if (typeof op !== 'string') {
      throw new TypeError('op must be a string');
    }
    if (!OPS.has(op)) {
      throw new RangeError(`op must be one of 'AND', 'OR', 'XOR' (got ${JSON.stringify(op)})`);
    }
    this._checkHandle(a);
    this._checkHandle(b);
    return this._applyRec(op, a, b);
  }

  evaluate(handle, assignment) {
    this._checkHandle(handle);
    this._checkAssignment(assignment);
    let node = handle;
    while (node !== ROBDD.FALSE && node !== ROBDD.TRUE) {
      const n = this._nodes[node];
      const name = this._variableOrder[n.varRank];
      node = assignment[name] ? n.high : n.low;
    }
    return node === ROBDD.TRUE;
  }

  satCount(handle) {
    this._checkHandle(handle);
    const n = this._variableOrder.length;
    const memo = new Map();
    const rec = (node, fromRank) => {
      if (node === ROBDD.FALSE) return 0n;
      if (node === ROBDD.TRUE) return 2n ** BigInt(n - fromRank);
      const key = `${node}|${fromRank}`;
      const cached = memo.get(key);
      if (cached !== undefined) return cached;
      const nd = this._nodes[node];
      const gap = nd.varRank - fromRank;
      const result = 2n ** BigInt(gap) * (rec(nd.low, nd.varRank + 1) + rec(nd.high, nd.varRank + 1));
      memo.set(key, result);
      return result;
    };
    return rec(handle, 0);
  }

  nodeCount(handle) {
    this._checkHandle(handle);
    const visited = new Set();
    const stack = [handle];
    while (stack.length > 0) {
      const h = stack.pop();
      if (visited.has(h)) continue;
      visited.add(h);
      const n = this._nodes[h];
      if (!n.isTerminal) {
        stack.push(n.low, n.high);
      }
    }
    return visited.size;
  }

  // -- internal helpers -----------------------------------------------

  _checkHandle(handle) {
    if (!Number.isSafeInteger(handle)) {
      throw new TypeError('handle must be a safe integer');
    }
    if (handle < 0 || handle >= this._nodes.length) {
      throw new RangeError(`handle out of range: ${handle}`);
    }
  }

  _checkAssignment(assignment) {
    if (typeof assignment !== 'object' || assignment === null || Array.isArray(assignment)) {
      throw new TypeError('assignment must be a plain object');
    }
    for (const name of this._variableOrder) {
      if (typeof assignment[name] !== 'boolean') {
        throw new TypeError(`assignment[${JSON.stringify(name)}] must be a boolean`);
      }
    }
  }

  // Reduction rule: low === high collapses to that shared child (no new
  // node created). Otherwise hash-cons via the unique table so that any
  // two requests for the same (varRank, low, high) triple always return
  // the same handle.
  _makeNode(varRank, low, high) {
    if (low === high) return low;
    const key = `${varRank}|${low}|${high}`;
    const existing = this._uniqueTable.get(key);
    if (existing !== undefined) return existing;
    const handle = this._nodes.length;
    this._nodes.push({ isTerminal: false, varRank, low, high });
    this._uniqueTable.set(key, handle);
    return handle;
  }

  _notRec(handle) {
    if (handle === ROBDD.FALSE) return ROBDD.TRUE;
    if (handle === ROBDD.TRUE) return ROBDD.FALSE;
    const cached = this._notCache.get(handle);
    if (cached !== undefined) return cached;
    const n = this._nodes[handle];
    const result = this._makeNode(n.varRank, this._notRec(n.low), this._notRec(n.high));
    this._notCache.set(handle, result);
    return result;
  }

  _applyRec(op, a, b) {
    // Terminal shortcut cases, per operator -- these both correctly
    // short-circuit (never need to look at the other operand's structure)
    // and are what let recursion bottom out.
    const aIsFalse = a === ROBDD.FALSE;
    const aIsTrue = a === ROBDD.TRUE;
    const bIsFalse = b === ROBDD.FALSE;
    const bIsTrue = b === ROBDD.TRUE;

    if (op === 'AND') {
      if (aIsFalse || bIsFalse) return ROBDD.FALSE;
      if (aIsTrue) return b;
      if (bIsTrue) return a;
    } else if (op === 'OR') {
      if (aIsTrue || bIsTrue) return ROBDD.TRUE;
      if (aIsFalse) return b;
      if (bIsFalse) return a;
    } else {
      // XOR
      if (aIsFalse) return b;
      if (bIsFalse) return a;
      if (aIsTrue) return this._notRec(b);
      if (bIsTrue) return this._notRec(a);
    }

    if (a === b) {
      // AND/OR with itself is itself; XOR with itself is FALSE. The
      // terminal shortcuts above already handle every case where either
      // operand is a terminal, so by this point a === b implies both are
      // non-terminal handles for the identical function.
      return op === 'XOR' ? ROBDD.FALSE : a;
    }

    const cacheKey = `${op}|${a}|${b}`;
    const cached = this._applyCache.get(cacheKey);
    if (cached !== undefined) return cached;

    const nodeA = this._nodes[a];
    const nodeB = this._nodes[b];
    const topRank = Math.min(nodeA.varRank, nodeB.varRank);

    const aLow = nodeA.varRank === topRank ? nodeA.low : a;
    const aHigh = nodeA.varRank === topRank ? nodeA.high : a;
    const bLow = nodeB.varRank === topRank ? nodeB.low : b;
    const bHigh = nodeB.varRank === topRank ? nodeB.high : b;

    const low = this._applyRec(op, aLow, bLow);
    const high = this._applyRec(op, aHigh, bHigh);
    const result = this._makeNode(topRank, low, high);
    this._applyCache.set(cacheKey, result);
    return result;
  }
}

module.exports = { ROBDD };
