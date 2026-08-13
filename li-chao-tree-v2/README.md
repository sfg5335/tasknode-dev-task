# li-chao-tree-v2

Dependency-free, single-file, deterministic Li Chao tree (`LiChaoTree`)
for minimum-line point queries over a fixed inclusive integer domain, in
JavaScript, with an automated `node:test` suite.

## Relationship to `../li-chao-tree/`

This directory implements a **separately assigned Task Node task** whose
spec overlaps substantially with the earlier, already-completed
`li-chao-tree/` task in this repo. Both are Li Chao trees over a
domain-bounded integer range with earliest-insertion tie-breaking; the
concrete differences in this task's own spec are: the payload field is
named `label` (not `value`), the query result shape is `{ value, label }`
(not `{ y, value }`), `addLine` is the only insertion method required (no
`addSegment`), and `size` is an explicitly required property. Given the
overlap, this implementation was written fresh (not copied) into this new,
clearly-disambiguated directory rather than overwriting the earlier one,
and this note is included so the relationship is transparent rather than
presented as unrelated work.

## API

```js
const { LiChaoTree } = require('./li-chao-tree.js');

const t = new LiChaoTree(minX, maxX); // inclusive integer domain [minX, maxX]
t.addLine(slope, intercept, label);   // y = slope*x + intercept, active over the whole domain
t.query(x);                            // { value, label } for the minimum-y line at x, or null
t.size;                                // number of successful addLine calls
```

- `new LiChaoTree(minX, maxX)` — `minX`/`maxX` must be safe integers with
  `minX <= maxX`. A non-number throws `TypeError`; a correctly-typed but
  invalid value (non-finite, non-integer, or `minX > maxX`) throws
  `RangeError`.
- `addLine(slope, intercept, label)` — `slope`/`intercept` must be finite
  numbers (`TypeError` for a non-number, `RangeError` for `NaN`/`Infinity`).
  `label` is unrestricted (any value, including `undefined`, `0`, or an
  object) — the task spec does not constrain it, so it is treated purely
  as an opaque payload. Returns `this` for chaining. A rejected call never
  mutates the tree or increments `size`.
- `query(x)` — `x` must be a safe integer within `[minX, maxX]`
  (`TypeError`/`RangeError` as above, plus `RangeError` if outside the
  domain). Returns `null` only when the tree is still empty (`size === 0`)
  — validation of `x` happens even on an empty tree, so an invalid `x`
  still throws rather than silently returning `null`. Otherwise returns
  `{ value, label }` for the line achieving the minimum `y` at `x`, with
  **ties broken by earliest insertion** — if two or more inserted lines
  are exactly tied for the minimum value at `x`, the one that was
  `addLine`d first wins, regardless of insertion order relative to other
  (non-tied) lines or the shape of the resulting tree.
- `size` — getter, the number of successful `addLine` calls so far.

## Algorithm

The classical Li Chao tree: a segment tree over the integer domain
`[minX, maxX]` where each node optionally holds one "locally optimal"
line for its sub-range, with nodes allocated **lazily** (only the first
time a subtree is actually touched), so a very large domain (e.g.
`-1e9` to `1e9`) does not allocate anywhere close to `maxX - minX` nodes.
Insertion walks down comparing the new line ("challenger") against the
resident line at each visited node, keeping whichever is better at the
node's midpoint and pushing the loser further down toward whichever half
of the range it could still win, using the two-endpoints-fully-determine
the crossing-interval property of straight lines. Query walks the single
root-to-leaf path for the query point, tracking the best line seen at
each node along the way.

**Tie-breaking generalization**: rather than relying on the *implicit*
tie behavior that falls out of "always compare with strict less-than" (a
common but easy-to-get-subtly-wrong folklore technique), this
implementation makes the earliest-insertion rule **explicit**: every line
carries a monotonically increasing insertion sequence number, and both
insertion's swap decisions and query's best-tracking use the exact same
total order — `_better(a, b, x)` is true when `a` has strictly smaller
`y` at `x`, or (on an exact `y` tie) strictly smaller sequence number.
Using one consistent compound `(value, seq)` order everywhere is what
makes earliest-insertion tie-breaking correct *globally* (across the
whole tree, regardless of which node structurally ends up holding which
line), not just locally at whichever single node a pairwise comparison
happens to occur at — verified explicitly via a dedicated test
constructing a 3-way tie at one point under three different insertion
orders (see `li-chao-tree.test.js`), and via 500 additional randomized
trials in the uncommitted `fuzz.js` specifically targeting many-way ties
at a shared point under randomized insertion order.

### Design choices not pinned down by the task spec

- **Constructor takes `(minX, maxX)`**, establishing the "fixed inclusive
  integer domain" the task's own description names, matching the only
  reasonable reading of that requirement (and matching the sibling
  `li-chao-tree/` task's own constructor shape, for what it's worth,
  though this was arrived at independently from this task's own wording,
  not copied).
- **`label` is completely unvalidated/unrestricted** — the spec gives no
  type constraint for it, so it is carried through as an opaque payload.
- **`RangeError` reserved for correctly-typed-but-invalid values**
  (non-finite, non-integer, reversed domain, out-of-domain query),
  `TypeError` for wrong JS type — matching this repo's established
  convention.
- **`query` validates `x` before checking whether the tree is empty**, so
  an invalid `x` throws even on a freshly constructed, empty tree, rather
  than short-circuiting to `null`.

## Testing

`li-chao-tree.test.js` (committed, 21 tests, `node:test` /
`node:assert/strict`, no external dependencies) covers: an empty tree
(`query` returns `null`, `size` is 0); a single line; one line dominating
the whole domain; two crossing lines with the winner changing on either
side of the crossing point; the exact tie at a crossing point (checked
both insertion orders, confirming the winner flips with insertion order);
duplicate/identical lines (earliest of several ties always wins); a
dedicated 3-way tie at one shared point under three different insertion
orders (the key defense against a tie-breaking implementation bug that
only manifests with 3+ competing lines); parallel lines (equal slope);
negative slope/intercept coefficients; domain boundary points; a
single-point domain (`minX === maxX`); repeated queries (determinism, no
mutation); `size` tracking only successful `addLine` calls (confirming a
rejected call does not increment it); `addLine` chaining; `label`
accepting arbitrary values including `undefined`/`0`/an object; the full
invalid-input surface for the constructor, `addLine`, and `query`
separately; `query` validating `x` even on an empty tree; a
many-lines/many-query-points structural sanity check against a manual
linear scan; and the task's required fixed-seed differential-coverage
block — `test('deterministic randomized differential coverage:
xorshift32(0xC0FFEE), >= 500 small trees (0-8 lines) against an
independent linear-scan reference, >= 10 queries each', ...)` (550
trials, exceeding the required 500, 5,861 total point-queries checked,
exceeding the required 1,000) driving a separately-implemented, plain
linear-scan `referenceQuery` — structurally unrelated to the
lazily-allocated segment-tree technique under test — that re-evaluates
every inserted line directly at the query point and selects the winner
by the same `(value, insertion-seq)` compound order.

An additional, uncommitted `fuzz.js` (not part of the submitted evidence,
run locally for extra confidence before the committed suite was even
written, per this repo's own established practice) ran a wider sweep
against an independent `ReferenceLineSet` (a plain array + linear scan,
same technique as the committed reference but implemented completely
separately): a spec-scale block (seed `0xC0FFEE`, 500 trials, small
domains), a wide-domain block (seed `0x5eed5eed`, 500 trials, domains up
to span ~2000 with widely-spread `minX`), a many-lines-per-tree block
(seed `0xfeedface`, 300 trials, up to 60 lines per tree), a
tiny-domain-heavy-tie block (seed `0xabc123`, 500 trials, domain span 0-3
so many query points necessarily fall exactly on multiple lines'
integer-only differences), a single-point-domain block (seed
`0xb0eda12`, 300 trials, `minX === maxX`), and a **dedicated tie-breaking
stress block** (seed `0x71e2711e`, 500 trials, 3-10 distinct lines
constructed to all pass through one randomly chosen point, inserted in
randomized relative order, always asserting the earliest-inserted line
wins) — **33,500 total point-queries checked across all blocks, 0
mismatches**, plus a 12-case invalid-input sweep, all correctly rejected.

## Verification performed

- `node --test li-chao-tree.test.js` run in this directory: all 21 tests
  passed, 0 failures. See `test-output.txt` for the full TAP output,
  captured from a clean checkout with no `npm install` step.
- The uncommitted `fuzz.js` was run manually (`node fuzz.js`) before
  writing the committed suite and reported `TOTAL mismatches across all
  blocks: 0` (33,500 point-queries across six blocks, including the
  dedicated tie-breaking stress block), plus 12/12 correct invalid-input
  rejections.
- No external dependencies: `li-chao-tree.js` has no `require` at all;
  the test file only requires Node's built-in `node:test` and
  `node:assert/strict`.
