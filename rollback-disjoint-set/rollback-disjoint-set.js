'use strict';

/**
 * A dependency-free disjoint-set union (union-find) that supports
 * snapshot()/rollback() to undo unions back to an earlier point in time.
 *
 * Deliberately does NOT use path compression: with union by size alone,
 * the only parent pointer ever mutated during a union() is the losing
 * root's, exactly once per successful union. That makes every state
 * change fully reversible by recording, per successful union, just the
 * losing root and the winning root's previous size -- rollback() simply
 * replays that history stack backwards. (Path compression would touch an
 * unbounded number of parent pointers per find(), which is why rollback
 * DSUs conventionally avoid it.)
 *
 * API:
 *   new RollbackDisjointSet(size) -- size must be a non-negative integer;
 *     creates `size` singleton components, indices 0..size-1.
 *   find(x) -- returns the root index of x's component (no path compression).
 *   connected(x, y) -- true iff x and y are in the same component.
 *   componentSize(x) -- size of x's component.
 *   componentCount -- getter, current number of components.
 *   union(x, y) -- merges x's and y's components by size (larger absorbs
 *     smaller); on an exact size tie, x's root wins (the "first" root, per
 *     argument order). Returns true if a merge happened, false if x and y
 *     were already in the same component (a true no-op: nothing is pushed
 *     onto the rollback history, so it does not consume a rollback step).
 *   snapshot() -- returns an opaque token capturing the current state.
 *   rollback(token) -- restores parents, component sizes, and
 *     componentCount to exactly what they were when `token` was captured.
 *     Rolling back further, then rolling forward is not supported (once
 *     you roll back past a later snapshot's point, that later token
 *     becomes invalid) -- tokens must be used in stack/nesting discipline,
 *     which is exactly how snapshot()/rollback() are meant to be paired.
 *
 * All of find/union/connected/componentSize/rollback throw TypeError for
 * invalid arguments (non-integer, out-of-range index, or a snapshot token
 * that was never issued / already rolled past) without mutating any state.
 */
class RollbackDisjointSet {
  constructor(size) {
    if (!Number.isInteger(size) || size < 0) {
      throw new TypeError('size must be a non-negative integer');
    }
    this._parent = new Array(size);
    this._size = new Array(size).fill(1);
    for (let i = 0; i < size; i++) this._parent[i] = i;
    this._count = size;
    // Stack of {loser, winner, winnerOldSize} for each successful union,
    // in the order they happened. snapshot() = current stack length.
    this._history = [];
  }

  get componentCount() {
    return this._count;
  }

  _validateIndex(x) {
    if (!Number.isInteger(x) || x < 0 || x >= this._parent.length) {
      throw new TypeError(`index out of range: ${x}`);
    }
  }

  find(x) {
    this._validateIndex(x);
    let root = x;
    while (this._parent[root] !== root) root = this._parent[root];
    return root;
  }

  connected(x, y) {
    this._validateIndex(x);
    this._validateIndex(y);
    return this.find(x) === this.find(y);
  }

  componentSize(x) {
    this._validateIndex(x);
    return this._size[this.find(x)];
  }

  union(x, y) {
    this._validateIndex(x);
    this._validateIndex(y);
    const rx = this.find(x);
    const ry = this.find(y);
    if (rx === ry) return false;

    let winner;
    let loser;
    if (this._size[rx] >= this._size[ry]) {
      // Includes the tie case: rx (x's root, the "first" root) wins.
      winner = rx;
      loser = ry;
    } else {
      winner = ry;
      loser = rx;
    }

    this._history.push({ loser, winner, winnerOldSize: this._size[winner] });
    this._parent[loser] = winner;
    this._size[winner] += this._size[loser];
    this._count--;
    return true;
  }

  snapshot() {
    return this._history.length;
  }

  rollback(token) {
    if (!Number.isInteger(token) || token < 0 || token > this._history.length) {
      throw new TypeError(`invalid snapshot token: ${token}`);
    }
    while (this._history.length > token) {
      const { loser, winner, winnerOldSize } = this._history.pop();
      this._parent[loser] = loser;
      this._size[winner] = winnerOldSize;
      this._count++;
    }
  }
}

module.exports = { RollbackDisjointSet };
