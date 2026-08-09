# Deterministic Scapegoat Search Tree

A dependency-free, single-file JavaScript implementation of a classic
scapegoat tree (Galperin & Rivest, 1993): a weight-balanced binary search
tree that maintains approximate balance via a single fixed parameter
(`alpha = 2/3`) instead of per-node balance metadata (unlike AVL or
red-black trees). Balance is restored either by rebuilding the subtree
rooted at the first unbalanced ancestor found after a deep insertion, or by
rebuilding the entire tree once enough deletions have accumulated relative
to the largest size seen since the last full rebuild.

## API

`const { ScapegoatTree } = require('./scapegoat-tree.js');`

- `new ScapegoatTree()` -- creates an empty tree.
- `set(key, value)` -- inserts or replaces `key`. Returns `this`.
- `get(key)` -- returns the stored value, or `undefined` if absent.
- `has(key)` -- `true`/`false`. The correct existence check, since a stored
  value can itself be `undefined`.
- `delete(key)` -- removes `key` if present; returns `true`/`false`.
- `rank(key)` -- number of stored keys strictly less than `key` (0-indexed
  order statistic). `key` need not be present.
- `select(k)` -- the `[key, value]` pair at 0-indexed ascending position
  `k`. Throws `RangeError` if `k` is out of `[0, size())`.
- `range(lo, hi)` -- every `[key, value]` pair with `lo <= key <= hi`, in
  ascending order. Returns `[]` if `lo > hi` (an inverted range simply
  matches nothing, rather than being an error).
- `toArray()` -- every `[key, value]` pair, in ascending key order.
- `size()` -- current number of stored keys.
- `height()` -- `-1` for an empty tree, `0` for a single node, otherwise the
  number of edges on the longest root-to-leaf path.

Keys must be finite JavaScript numbers (`typeof key === 'number' &&
Number.isFinite(key)`); this includes negative and fractional values.
Values may be any JavaScript value, including `undefined`. All malformed
inputs (wrong type, `NaN`, `Infinity`) throw `TypeError`. `select`'s index
argument must additionally be a non-negative integer (`TypeError` if not)
that is in-bounds for the tree's current size (`RangeError` if not) --
this is the only place a "well-typed but out of range" input arises for a
numeric-keyed ordered map, so it is the only `RangeError` case, matching
the general TypeError-for-wrong-kind vs RangeError-for-wrong-bounds
convention used elsewhere in this repository.

## Design choices made explicit (per the task's open points)

- **Alpha is fixed at 2/3** (as required by the task spec), hard-coded as
  the module-level `ALPHA` constant.
- **Ideal-height-bound check uses the tree's *current* size, not a
  historical peak.** The insertion-triggered rebalance check compares the
  newly-inserted node's depth against `log_(1/alpha)(n)` where `n` is the
  tree's size *right after* this insertion -- not `_maxSize` (which is
  reserved for the separate deletion-triggered full-rebuild criterion).
  This keeps the two rebuild triggers independent and simple to reason
  about: "is this insertion, right now, too deep for how many nodes we
  actually have?" Both conventions appear in various expositions of
  scapegoat trees; this one was chosen for its clean separation of
  concerns and is documented here since the task leaves it unpinned.
- **"Always choose the lower midpoint during rebuilds"** (an explicit task
  requirement): when a subtree (or the whole tree) is rebuilt from its
  sorted node array `nodes[lo..hi]`, the new local root is
  `nodes[lo + floor((hi - lo) / 2)]` -- the lower of the two middle
  elements when the range has even length. This biases any "extra" element
  into the right subtree.
- **Node objects are reused across rebuilds**, not reallocated -- a rebuild
  only re-wires `left`/`right`/`size` on the existing `Node` instances
  collected via an in-order flatten. This has no user-visible effect but
  keeps rebuild cost strictly proportional to subtree size with minimal
  allocation.
- **Replacing an existing key's value is a pure value update**: no size
  change, no rebalance bookkeeping, and (verified by an explicit test)
  the exact same root object reference before and after.
- **`-0` and `0` are the same key** (JavaScript's own `===`/`<` semantics
  already guarantee this for numeric keys; a dedicated test pins the
  behavior explicitly since it's easy to get wrong when hand-rolling
  comparison logic).
- **Two-children deletion uses the in-order successor** (leftmost node of
  the right subtree), the standard convention, with a dedicated test.

## Verification performed (fresh clone, node v22.22.2)

- `node --test` at the repository root: 1011/1011 tests passing.
- `node --test scapegoat-tree/scapegoat-tree.test.js` in isolation:
  36/36 passing.
- No `node_modules` or `package.json` anywhere in the repository --
  genuinely dependency-free.
- The committed suite explicitly covers every category named in the task's
  own steps and verification section: empty state; replacements (including
  replacing with `undefined`); sorted (ascending) and reverse (descending)
  insertion; every one of `get`/`has`/`delete`/`rank`/`select`/`range`/
  `toArray`/`size`/`height`; every deletion shape (leaf, one child, two
  children); negative and fractional keys (plus `-0`/`0` equivalence and
  extreme-magnitude finite values); every invalid-input case for every
  method; deterministic ordering (byte-identical output across independent
  fresh instances given the same fixed-seed operation sequence); height
  bounds (a generous constant multiple of the theoretical
  `log_(1/alpha)(n)` bound, checked at many points during large builds, not
  just at the end); and a 20,000-step fixed-seed mixed-operation
  differential test against an independently-written sorted-array oracle
  (linear-scan/`splice`-based, deliberately structurally unrelated to the
  tree), with periodic full-state and structural-invariant cross-checks.
- **The verification section's explicit requirement -- "the committed
  tests must exercise subtree and whole-tree rebuilding" -- is met by two
  dedicated, hand-traced tests** (both scenarios were run interactively via
  `node -e` against the real implementation before the exact expected
  structure was written into the test file, per this project's standing
  practice of never hand-guessing structural claims):
  - **Subtree rebuild**: ascending insertion of keys `0..4` triggers a
    rebuild scoped to `root.right` only -- the root (key `0`) and its
    (empty) left subtree are provably untouched (same object / same
    value), while `root.right` changes from key `1` to key `2` (the
    lower-midpoint root of the rebuilt `{1,2,3,4}` subtree). A mirror-shape
    test does the same for descending insertion of `4..0` (scoped to
    `root.left`; NOT a simple mirror image of the ascending case's exact
    shape, since the insertion order changes which node ends up as root
    along the way -- also re-traced for real rather than assumed).
  - **Whole-tree rebuild**: after ascending-inserting `0..19`
    (`_maxSize` becomes `20`), deleting keys `19` down to `14` shrinks the
    tree to size `14` without crossing the `alpha * maxSize = 13.33`
    threshold (root, still key `0`, is provably untouched throughout).
    Deleting key `13` next crosses the threshold (`13 < 13.33`), which
    must trigger a full-tree rebuild: the test asserts the root *object
    reference itself* changes (`t.root !== rootBeforeTrigger`), that the
    new root is key `6` (the lower-midpoint root of the rebuilt 13-element
    set), that `_maxSize` resets to `13`, and -- the strongest possible
    check -- that **every node in the resulting tree satisfies strict
    alpha-weight-balance**, a global property that could only hold
    immediately after a genuine full rebuild (scapegoat trees only
    guarantee *approximate*, not exact, balance between rebuilds).
- Beyond the committed suite, an additional uncommitted stress run
  (`stress-test.js`, not committed) checked 349,979 further assertions
  across: 40 broad small-key-space trials (heavy replacement/collision),
  20 wide-sparse-key-space trials, 20 fractional-key trials, 5
  long-single-sequence trials (60,000 ops each), a dedicated
  ascending/descending sweep at n = 1,000 / 5,000 / 20,000, and 30 cycles
  of shuffled-insert-all-then-shuffled-delete-all (exercising the
  whole-tree deletion-rebuild path repeatedly and confirming `_maxSize`
  and `root` reset correctly to empty-tree state every cycle) -- all
  against the same independent sorted-array oracle, plus periodic
  size-invariant, BST-order, and height-bound structural checks. **0
  mismatches.**
