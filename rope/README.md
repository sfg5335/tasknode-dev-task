# rope

Dependency-free, single-file, deterministic mutable-text `Rope`, backed
by an AVL-balanced binary tree of string leaves with cached subtree
lengths and heights, in JavaScript, with an automated `node:test` suite.

## Files

- `rope.js` -- the implementation:
  `new Rope(initial = '')` constructs a rope from an initial string.
  Instance API: `length` (getter, in UTF-16 code units -- the same
  units `String#length` itself uses), `insert(index, text)`,
  `delete(start, end)`, `substring(start, end)`, `charAt(index)`,
  `toString()`. `insert`/`delete` return `this` for chaining.
  `substring`/`charAt` never mutate the rope. `delete`/`substring` use
  half-open `[start, end)` ranges; `insert`'s valid `index` range is
  `[0, length]` (inclusive of the very end, for appending), while
  `charAt`'s valid `index` range is `[0, length)` (there is no
  character *at* position `length` itself) -- a deliberate, documented
  asymmetry between the two.

  Also exported: `checkInvariants(rope)`, an invariant checker (per
  this task's own spec) that walks the rope's internal tree bottom-up
  verifying every node's cached `length`/`height` are exactly correct,
  that the AVL balance property holds everywhere, and that overall tree
  height stays within a generous logarithmic bound for the rope's
  length. Throws a descriptive `Error` on any violation, returns `true`
  on success, and throws `TypeError` if not given a `Rope` instance.

  Algorithm: the classic rope-via-AVL-tree design. Each leaf holds a
  plain-string chunk directly; each internal node holds only its
  `left`/`right` children plus its own cached `length` (total code
  units in its subtree) and `height` (AVL height) -- content is *never*
  flattened to a single string for reads or edits (only `toString()`
  does that, by its very nature). `insert`/`delete` are both built from
  two fundamental primitives: `split(node, index)` (splits a subtree
  into two, at exactly `index` code units) and `concat(left, right)`
  (joins two subtrees into one AVL-balanced tree via standard
  rotations along the grafted spine). `substring`/`charAt` instead walk
  the tree directly -- using cached lengths to descend into only the
  relevant subtree at each level -- without ever splitting or
  rebuilding anything.

  Every input is validated: a non-string `initial`/`text` throws
  `TypeError`; a non-safe-integer `index`/`start`/`end` throws
  `TypeError`; a correctly-typed `start > end` ("reversed"), or any
  index/start/end outside its own operation's valid range, throws
  `RangeError`.

- `rope.test.js` -- 37 `node:test` cases (no external dependencies):
  empty-rope and boundary operations (insert at index 0 and at
  `length`, empty-string insert, empty-range delete/substring,
  `delete(0, length)`, first/last-index `charAt`); cross-node edits
  built up across separate `insert` calls, including one that lands
  mid-leaf and forces a split, and a delete spanning several leaves;
  Unicode code-unit behavior (a surrogate-pair emoji counted as 2 code
  units, matched index-by-index and for every `substring` sub-range
  against native string slicing -- including splitting the surrogate
  pair itself -- plus an insert that lands a surrogate pair exactly on
  a leaf boundary); chaining; a full `TypeError`/`RangeError`
  validation sweep including the `insert`-vs-`charAt` range-boundary
  asymmetry and `checkInvariants`'s own argument validation; AVL
  metadata checks (`checkInvariants` passing on fresh ropes of various
  sizes, staying logarithmic-height after 5,000 sequential appends
  *and* after 5,000 sequential prepends, and -- to prove the checker
  itself is not a rubber stamp -- three deliberately-corrupted-tree
  cases that each `checkInvariants` catches: a hand-corrupted cached
  length, a hand-corrupted cached height, and a hand-built, deliberately
  degenerate unbalanced chain bypassing the real API entirely);
  adversarial edits (3,000 alternating prepend/append operations with
  interleaved random deletes, and 500 rounds of insert-then-delete at
  the same fixed position); and two seeded-PRNG (mulberry32, fixed
  seeds) differential suites against a native JS string reference (one
  starting empty, one starting from random nonempty content), covering
  `insert`/`delete`/`substring`/`charAt` with `checkInvariants` re-run
  throughout the first suite.

- `test-output.txt` -- raw, unedited output of the exact run command
  below.

## Additional verification (not part of the committed suite)

Beyond the committed suite: a larger, uncommitted differential run
against native strings covering 200 trials from an empty start plus 60
longer trials from random nonempty starting content, a 5,000-append
AVL-height sanity check, and the same adversarial prepend/append/delete
sequence -- all folded into the committed suite's own versions once
verified clean, with 0 mismatches throughout.

## Exact run command

```
node --test rope.test.js
```

Requires only the Node.js runtime (tested on Node v22.22.2) -- no
`npm install`, no native build, no service to start. Run from inside
this directory, from a clean checkout. The full suite (including the
5,000-operation stress cases) completes in well under a second.

## Design notes

- AVL rotations mutate node objects in place (reassigning `.left`/
  `.right` pointers and refreshing cached `length`/`height`) rather
  than allocating fresh copies at every step. This is safe specifically
  because a `Rope` instance never shares tree nodes with any other
  `Rope` (there is no rope-to-rope operation in this task's API
  surface), and every `insert`/`delete` unconditionally discards its
  *entire* old `_root` in favor of a brand-new one as soon as the
  operation completes -- so mutating fragments of the old, now-orphaned
  tree during reconstruction is never observable. A fully persistent
  (copy-on-write) implementation would also be correct, just more
  complex, for no benefit this task's API actually needs.
- `insert`'s valid index range (`[0, length]`, inclusive of the end)
  and `charAt`'s valid index range (`[0, length)`, exclusive) are
  deliberately different, matching each operation's own natural
  semantics: you can insert *at* the position one-past-the-end (that's
  what "append" means), but there is no character stored *at* that same
  position to read.
- No leaf-size capping or leaf-merging is implemented: each `insert`
  call creates exactly one new leaf holding the entire inserted text,
  however long, and leaves are never merged back together after a
  `delete`. AVL balancing still keeps the tree's *height* logarithmic
  regardless of how fragmented the leaves become (verified directly by
  the 5,000-sequential-single-character-append/prepend tests), which is
  the specific invariant this task's spec asks for; a production-grade
  rope would additionally cap/merge leaf sizes for cache-friendliness,
  but that's a distinct, separable optimization outside this task's
  scope.
- Every read/edit operation (`insert`, `delete`, `substring`, `charAt`)
  operates on JavaScript UTF-16 code units throughout -- exactly what
  native `String#length`/`String#slice`/`str[i]` already do by default
  -- so no extra Unicode-aware logic was needed to satisfy "using
  JavaScript UTF-16 code-unit offsets"; a surrogate-pair character is
  correctly treated as 2 separate, independently-addressable units,
  including across a leaf-split point, matching native string behavior
  exactly (verified directly against `String#slice` for every
  sub-range of a surrogate-pair-containing string).
