# Deterministic Splay Tree Ordered Map

A dependency-free, single-file JavaScript implementation of a splay tree
(Sleator & Tarjan, 1985): a self-adjusting binary search tree keyed by
finite numbers, where every point access -- `get`, `set`, `has`, `delete`,
and `select` -- splays the node it touches all the way to the root via
bottom-up zig, zig-zig, and zig-zag rotations. `range` and `toArray` are
pure queries and never splay.

## API

`const { SplayTree } = require('./splay-tree.js');`

- `new SplayTree()` -- creates an empty tree.
- `set(key, value)` -- inserts or overwrites `key`, then splays that node
  to the root.
- `get(key)` -- splays the search path for `key` to the root; returns the
  stored value, or `undefined` if absent. `has(key)` (not
  `get(key) !== undefined`) is the correct existence check, since a stored
  value can itself be `undefined`.
- `has(key)` -- splays the search path for `key` to the root; returns
  `true`/`false`.
- `delete(key)` -- splays the search path for `key` to the root; if
  present, removes it (joining its left and right subtrees) and returns
  `true`, else returns `false`.
- `select(k)` -- the `[key, value]` pair at 0-indexed ascending position
  `k`, then splays that node to the root. Throws `RangeError` if `k` is
  out of `[0, size)`, `TypeError` if `k` isn't an integer.
- `range(lo, hi)` -- every `[key, value]` pair with `lo <= key <= hi`, in
  ascending order. Returns `[]` if `lo > hi` (an inverted range simply
  matches nothing, rather than being an error). Does not splay.
- `toArray()` -- every `[key, value]` pair, in ascending key order. Does
  not splay.
- `size` -- getter, current number of stored keys.
- `height` -- getter, the tree's height (longest root-to-leaf edge count);
  `-1` for an empty tree, `0` for a single node.

`key` must be a finite JavaScript number (any finite double, including
negative and fractional values) -- a non-number or non-finite `key` throws
`TypeError` from every method that takes one. `lo`/`hi` (for `range`) must
independently be finite numbers, validated with `TypeError` before the
`lo > hi` empty-range check runs. `value` (for `set`) may be any
JavaScript value, including `undefined`, and is stored by reference --
this class never mutates a stored value, and never mutates any input.

## Determinism

For any fixed sequence of calls, the resulting tree shape, every returned
value, and every reported `size`/`height` are byte-for-byte reproducible.
There is no randomness anywhere in the implementation.

## Algorithm

Each node stores `key`, `value`, `left`, `right`, `parent`, and `size` (the
node count of the subtree rooted there, including itself). Rotations
(`_rotateLeft`/`_rotateRight`) are the standard single BST rotations,
extended to fix `parent` pointers and recompute `size` for the two nodes
whose subtree membership changed (child first, then its new parent, since
the parent's size depends on the child's just-updated size).

`_splay(x)` repeatedly classifies `x`'s position relative to its parent
`p` and grandparent `g`:

- **Zig** -- no grandparent: one rotation of `p`.
- **Zig-zig** -- `x` and `p` are both left children, or both right
  children: two same-direction rotations, `g` then `p`.
- **Zig-zag** -- `x` and `p` are on opposite sides: two opposite-direction
  rotations, `p` then `g`.

This repeats until `x` has no parent left, at which point `x` is the new
root. Because every ancestor on `x`'s original root path participates in
at least one rotation before the loop ends, every node's `size` is left
correct once splaying completes -- no separate size-propagation pass is
needed. `_splay` sets `this.root = x` exactly once, after the loop, rather
than inside the rotation helpers -- this keeps the rotation code identical
whether it's splaying a node reachable from the tree's real root or (as
`delete` does internally) a node within a temporarily-detached subtree.

`delete` splays the target to the root first, then joins its two
subtrees: with no left subtree, the right subtree (if any) becomes the new
root outright; otherwise the left subtree's maximum (found by walking
right pointers, then splayed to the top of the *detached* left subtree)
becomes the new root, with the right subtree attached as its right child
-- this works because splaying a subtree's maximum always leaves it with
no right child, exactly the slot the right subtree needs.

`get`/`has`/`delete` on a miss still splay the last node reached while
descending toward the target key (the node whose missing child would be
the key's insertion point) -- the standard splay-tree behavior that keeps
even failed searches amortized efficient, matching Sleator & Tarjan's
original algorithm.

`height` and `range`/`toArray`'s traversals are all implemented
iteratively with an explicit stack rather than recursion. This matters in
practice: an adversarial-but-entirely-legitimate access pattern (e.g.
inserting many keys in strictly ascending order, before any subsequent
access re-balances things via splaying) produces a fully degenerate,
linked-list-shaped tree whose depth equals its size -- a naive recursive
height/traversal function would exceed JavaScript's call stack on such a
tree once it reaches a few thousand nodes. The committed test suite
exercises exactly this shape and confirms the iterative implementations
handle it correctly.

## Testing

`node --test` (26 tests):

- Empty-tree and single-node behavior for every method.
- Splay-to-root verification after `get`/`has`/`set`/`select` (a
  structural check, not just a return-value check) -- including a
  dedicated test confirming that splaying the minimum of a 2,000-node
  fully degenerate chain roughly halves the remaining tree depth, the
  classic path-halving behavior that gives splay trees their amortized
  efficiency guarantees.
- Sequential ascending and descending insertion.
- Duplicate-key `set` (overwrites without growing `size`) and the
  `has`-vs-`get(key) !== undefined` distinction for a stored `undefined`
  value.
- `range` and `select` correctness, including an inverted `range(hi, lo)`
  and a range/tree that matches nothing.
- Determinism: one fixed operation sequence run 10 times, plus 20
  independently-seeded random 50-operation sequences each run 3 times --
  all byte-for-byte identical across runs.
- Every input-validation branch (non-number/non-finite keys across every
  key-taking method, non-finite `lo`/`hi`, non-integer/out-of-range
  `select` index).
- Input immutability (a stored value object is never mutated, even after
  being overwritten by a later `set`).
- A fixed-seed differential test running 6,000 randomly-mixed
  `set`/`get`/`has`/`delete`/`select`/`range` operations against an
  independent reference `Map`, with periodic full-tree structural
  invariant checks (BST ordering, parent-pointer correctness, and
  bottom-up `size` correctness at every node) throughout.

Beyond the committed suite, an uncommitted stress harness ran 20,000
further randomly-mixed operations against the same `Map` oracle with
structural invariant checks every 500 operations (0 mismatches), plus
targeted checks confirming `height`/`toArray`/`range` all handle a
100,000-node fully degenerate chain without recursion-depth issues.
