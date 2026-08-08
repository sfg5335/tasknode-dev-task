# Persistent Hash-Array Mapped Trie (HAMT)

`empty(hashFn?)` -- a dependency-free, immutable, string-keyed map backed by a real
32-way bitmap-indexed hash-array mapped trie (not copied `Map` instances or plain
objects), using deterministic FNV-1a hashing by default. Instances expose `.set(key,
value)`, `.get(key)`, `.has(key)`, `.delete(key)`, `.entries()`, and a `.size` getter.
Every mutating operation returns a brand-new instance via structural sharing; no
existing node is ever mutated after creation (every node object is frozen).

## API

```js
const { empty, fnv1aHash } = require('./persistent-hamt.js');

let m = empty();               // empty map, default FNV-1a hash
m = m.set('a', 1).set('b', 2); // returns a NEW instance each time
m.get('a');                    // 1
m.has('c');                    // false
m.size;                        // 2
m.entries();                   // [['a', 1], ['b', 2]] -- ascending JS string order
const m2 = m.delete('a');      // another new instance; m itself is untouched
m.has('a');                    // still true -- m was never mutated

const collisionProne = empty((key) => 0); // forces every key into one bucket
```

- Keys must be strings (`TypeError` otherwise, from every accessor).
- `empty(hashFn)` accepts an optional custom hash function `(key: string) => number`;
  its return value is coerced to an unsigned 32-bit integer via `>>> 0` before use.
  Omitting it (or passing `undefined`) uses the built-in FNV-1a hash.
- A `set()` that would leave both the key *and* the value unchanged (`===`-equal to
  what's already stored) returns the *exact same instance* (`newMap === oldMap`), not
  merely an equal one. Likewise, `delete()` of an absent key returns the same instance.
  Every other mutation returns a genuinely new instance.
- `entries()` returns a fresh array of fresh `[key, value]` pairs (no aliasing of
  internal storage), sorted by plain JavaScript `<` on the key (UTF-16 code-unit
  order -- no locale-awareness or Unicode normalization).

## Algorithm

A HAMT combines a hash table's O(1)-ish lookup with a trie's structural-sharing
friendliness. Each key's hash is split into 5-bit chunks (`0..31`, i.e. 32-way
branching per level); at each level, a **bitmap-indexed branch node** stores a
32-bit bitmap marking which of the 32 possible child slots are actually populated,
plus a densely-packed `children` array holding *only* the present children (indexed
by `popcount(bitmap & (mask - 1))`, a classic array-mapped-trie compaction — no
wasted slots for absent children, unlike a naive 32-element array per node).

Three node shapes:

- **Leaf** -- `{ type: 'leaf', hash, key, value }`, a single key/value pair.
- **Bitmap** -- `{ type: 'bitmap', bitmap, children }`, a compact branch node.
- **Collision** -- `{ type: 'collision', hash, entries }`, used only once all 32 hash
  bits have been consumed (`shift >= 32`) and two or more distinct keys still share
  the exact same 32-bit hash. `entries` is a flat array of `[key, value]` pairs
  compared by linear scan (there is no more hash information left to discriminate
  them with).

`set`, `get`, and `delete` all walk the trie 5 bits at a time (`shift = 0, 5, 10,
...`), using `(hash >>> shift) & 0x1f` to pick a bit/slot at each level.

**Immutability and structural sharing**: every node object is `Object.freeze`d at
construction and never mutated afterward. `set`/`delete` build a new node only along
the *path* from the root down to the point of change; every sibling subtree that
wasn't touched is reused by reference in the new tree. Combined with the no-op
short-circuit (`===` comparisons all the way up the call stack -- see `nodeSet`'s and
`nodeDelete`'s doc comments), a `set`/`delete` that changes nothing at all returns
the identical instance it started from.

**Branch collapse on delete**: whenever removing (or recursively collapsing) a child
leaves a bitmap node with exactly one remaining child that is a leaf or a collision
node, the bitmap wrapper is discarded and that child is returned directly in its
place. This cascades correctly through the recursive unwind of `nodeDelete`, so a
long chain of single-child bitmap levels (as arises naturally from two keys with a
long common hash prefix, or a full hash collision) collapses all the way back to a
bare leaf -- and eventually to `null` -- as entries are removed. This is what keeps
the trie's shape minimal after deletions rather than accumulating dead single-child
chains forever.

**Combining two "hash-homogeneous units"**: whenever an insertion needs to combine
something that already exists (a leaf, or -- see the bug write-up below -- a
collision node) with a brand-new leaf under a different key, `combineByHash` treats
both sides as opaque units, each associated with exactly one hash value (a leaf's own
hash, or a collision node's shared hash). If the two hashes still agree at the
current bit-chunk, the *whole* unit rides down together inside a single-child
bitmap; they are only pulled apart into sibling slots once their hashes' bit-chunks
actually diverge, or merged into one collision node if they turn out to be fully
hash-equal (`shift >= 32`, no further bits to compare).

## Default hash function

FNV-1a over the key's UTF-8 bytes (via the global `TextEncoder`, no `require`/`import`
needed at all), folded to an unsigned 32-bit integer with `Math.imul` + `>>> 0`. Hashing
bytes rather than UTF-16 code units means Unicode keys (including astral-plane
characters encoded as surrogate pairs, combining marks, and even lone/unpaired
surrogates) and the empty string all hash deterministically and uniformly, with no
special-casing needed anywhere in the trie logic.

## Testing

`persistent-hamt.test.js` (24 `node:test` cases, all passing -- see `test-output.txt`
for the raw run) covers: empty-map behavior; basic set/get/has round-trips; the
no-op-returns-same-instance contract for both `set` and `delete`; `undefined` as a
distinct valid value (vs. key-absent); many distinct keys under the default hash;
Unicode and empty-string keys (accents, CJK, an astral-plane emoji, a lone surrogate,
a combining-mark sequence that must NOT be conflated with its precomposed
equivalent); ascending-string-order `entries()`; forced full-hash collisions via a
constant custom hash function (with a whitebox walk confirming the expected 7-level
single-child bitmap chain terminating in an actual `collision` node); collapsing a
collision node down through deletion, all the way to `null`; two explicit,
hand-traced branch-expansion and branch-collapse scenarios across two bitmap levels
with an exact hash lookup table (bit positions and node shapes asserted precisely,
not just behaviorally); a persistence test threading a chain of five derived
versions and re-checking every earlier one at the end; frozen-node immutability;
`TypeError` validation for non-string keys and non-function `hashFn`; a
determinism check on the default hash; two seeded differential stress sequences
(3,000 and 1,500 operations respectively) cross-checked against a native `Map` at
every step, including periodic persistence snapshots re-verified at the end; and a
dedicated regression test (see below) for the collision-node-hoisting bug found
during development.

Beyond the committed suite, an **uncommitted** differential/stress harness was run
before committing: 70,000 randomized set/delete operations across 65 trials (varying
key alphabets including a Unicode-heavy one, varying default/custom hash functions
including several small-modulus collision-forcing ones), cross-checked against a
native `Map` at every single operation (216,090 total checks, 0 mismatches);
a structural-invariant sweep (900 checks) walking the actual tree after every
operation and verifying bitmap-child-count-matches-popcount, no dangling empty
bitmaps, no uncollapsed single-child-bitmap-wrapping-a-bare-leaf, and (critically)
*routing consistency* -- that every leaf/collision node's hash is actually
consistent with the bit-chunks the path taken to reach it represents; and an
isolated full-collapse sweep (57 checks) that builds pure collision groups of
various sizes and deletion orders and confirms, after every single deletion, that
literally zero single-child bitmaps remain anywhere in the (otherwise unshared) tree.

## Bug caught during development (a genuine implementation bug, not a test-authoring one)

Unlike most of this project's prior tasks (see the repository root README's log --
this streak had reached thirteen consecutive tasks with zero implementation bugs
found by stress testing), this task's uncommitted stress harness caught a real bug
in the first implementation, before anything was committed.

**The bug**: the original `nodeSet` treated reaching a `collision`-type node with a
hash that didn't match the key being inserted as an unrecoverable internal-invariant
violation, and threw. The reasoning behind that assumption seemed sound in isolation:
a collision node is only ever *created* once all 32 hash bits have been consumed
(`shift >= 32`), and two different 32-bit hash values are mathematically guaranteed
to diverge at some shift below 32 -- so it seemed like any key reaching a collision
node via the trie's bit-chunk routing must necessarily share that node's exact hash.

That reasoning misses one thing: **branch collapse on `delete` can hoist a collision
node to a shallower depth than the one it was created at.** If a collision node's
siblings along its single-child ancestor chain get deleted away, `nodeDelete`'s
cascading collapse correctly discards the now-redundant bitmap wrappers and returns
the collision node directly -- placing it at whatever (possibly much shallower)
position its nearest surviving ancestor bitmap occupies. A collision node reached
that way is *not* guaranteed to sit at `shift >= 32` anymore. A later `set()` for a
brand-new key whose hash merely shares the hoisted collision node's low-order bits
down to the *current* shift -- but diverges at some deeper bit -- then reaches the
collision node directly, at `shift < 32`, and the old code's "this can never happen"
assumption fired incorrectly.

**Root-caused** via the uncommitted stress harness's small-modulus custom hash
trials (specifically `hash(key) = fnvLikeSum(key) % 33`): with mod 33, two different
string hashes (e.g. `0` and `32`) can share identical low-order bits at shift 0
(`32 & 0x1f === 0`) while differing at shift 5, which is exactly the shape needed to
trigger the bug once a same-hash collision group had been partially deleted earlier
in the same randomized sequence. Traced interactively (`node -e`) down to a minimal
3-line reproduction: build a 3-way full-hash collision, delete one member (which
collapses the entire single-child ancestor chain and hoists the 2-remaining-entry
collision node all the way up to the bare map root), then insert an unrelated key
with a different hash -- which hit the `throw` immediately.

**Fixed** by replacing the old leaf-only `twoLeavesToNode` helper with a more general
`combineByHash(nodeA, hashA, nodeB, hashB, shift)` that treats a leaf *or* a
collision node as an opaque "hash-homogeneous unit" (everything under it shares one
hash value) and re-expands it alongside a new leaf via ordinary bit-chunk comparison
-- exactly the same logic that already handled two colliding leaves, generalized to
also handle "an existing collision node that turns out not to match after all."
`nodeSet`'s collision-node branch now calls this instead of throwing whenever the
hash doesn't match. A permanent regression test (`persistent-hamt.test.js`, "a
collision node hoisted to a shallow depth by delete is correctly re-expanded by a
later diverging set()") pins the exact minimal reproduction, asserting the precise
resulting tree shape, not just black-box behavior.

While fixing this, the uncommitted stress harness's own structural-invariant checker
needed two corrections in turn (both harness bugs, not implementation bugs, per this
project's established "audit the harness before blaming the implementation"
discipline): it originally asserted that *any* single-child bitmap wrapping a
collision node was invalid (true only immediately after a `delete`, not after plain
insertions -- which legitimately produce exactly this shape for two keys sharing a
long hash prefix, as confirmed by direct tracing), and that a collision node could
never appear at `shift < 32` (true only at the moment of creation, not after
delete-driven hoisting, as this very bug demonstrated). Both were replaced with the
correct, more precise invariant: a *routing-consistency* check verifying that every
leaf/collision node's hash is actually consistent with the bit-chunks decided along
the path used to reach it, at any depth.

## Design notes

- `reconstruct`-style "recover from partial information" doesn't apply here (this is
  a map, not an erasure code); the closest analogous design decision was how deeply
  to trust the "collision nodes only exist at `shift >= 32`" assumption -- see the bug
  write-up above for why that turned out to be true only at creation time, not
  universally.
- The default hash function hashes UTF-8 *bytes*, not UTF-16 code units or code
  points, specifically so Unicode edge cases (surrogate pairs, lone surrogates, the
  empty string) never need special-casing anywhere else in the implementation.
- `entries()` intentionally does no Unicode normalization: a combining-mark sequence
  (`"a" + U+0301`) and its precomposed equivalent (`"á"`) are treated as different
  strings, matching plain JavaScript string semantics rather than introducing an
  implicit dependency on `String.prototype.normalize`.
- Values may legitimately be `undefined`; `has()` (not `get() !== undefined`) is the
  correct way to test presence, exactly as with the native `Map`.
