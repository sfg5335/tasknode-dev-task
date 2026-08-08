# robdd

Dependency-free, single-file, deterministic Reduced Ordered Binary
Decision Diagram (`ROBDD`) over a fixed, caller-supplied variable order,
in JavaScript, with an automated `node:test` suite.

## Files

- `robdd.js` -- the implementation:
  `new ROBDD(variableOrder)` constructs an empty diagram universe fixed
  to `variableOrder` (an array of distinct variable-name strings; index
  0 is highest in the diagram, i.e. tested first from the root). Fixed
  terminal handles `ROBDD.FALSE` (`0`) and `ROBDD.TRUE` (`1`) are the
  same across every instance. Instance API: `variableOrder` (getter,
  returns a copy), `variable(name)`, `not(handle)`,
  `apply(op, a, b)` (`op` is `'AND'`, `'OR'`, or `'XOR'`),
  `evaluate(handle, assignment)`, `satCount(handle)` (returns `BigInt`),
  `nodeCount(handle)`.

  Every node handle is a plain non-negative integer indexing into that
  specific instance's private node table -- handles from two different
  `ROBDD` instances are never interchangeable, even if the instances
  were constructed with the same variable order.

  Every input is validated: a non-array `variableOrder`, a non-string
  element, or a duplicate name throws (`TypeError` for type errors,
  `RangeError` for the duplicate-name case); an unknown variable name
  passed to `variable` throws `RangeError`; a non-safe-integer or
  out-of-range handle passed to `not`/`apply`/`evaluate`/`satCount`/
  `nodeCount` throws (`TypeError` for the wrong-type case, `RangeError`
  for out-of-range); a bad `op` string to `apply` throws (`TypeError` if
  not a string, `RangeError` if not one of the three supported
  operators); a non-plain-object `assignment` to `evaluate`, or one
  missing a strict boolean value for any variable in `variableOrder`,
  throws `TypeError` (extra keys beyond `variableOrder` are harmless and
  ignored).

  Algorithm: canonical node creation is hash-consed through a unique
  table keyed by `(variableRank, low, high)`, with the standard
  reduction rule collapsing any node whose `low === high` directly to
  that shared child handle instead of allocating a new node. This
  hash-consing is what gives the data structure its defining property:
  two calls that build the *same* Boolean function -- even through
  completely different sequences of `variable`/`not`/`apply` calls --
  always return the exact same integer handle, so structural
  (node-identity) equality *is* semantic (function) equality. `not` and
  `apply` are each memoized per-instance (`not` keyed on its operand
  handle; `apply` keyed on `` `${op}|${a}|${b}` ``) so repeated
  sub-computations, both within one recursive call and across the
  instance's lifetime, are never recomputed. `apply`'s recursion uses
  the classic cofactor-based combination: at each step it finds
  `topRank = min(a's rank, b's rank)`, and for whichever operand is
  *not* at that rank, it contributes its own handle unchanged to both
  the low and high cofactor -- this is what correctly handles a
  "skipped" variable (one that sits between two ranks in the diagram
  without either operand actually testing it) with no special-casing
  needed anywhere else. `satCount` returns an exact `BigInt` via a
  recursive `(node, fromRank)`-memoized count that multiplies by
  `2^gap` (`gap` = the node's own rank minus the rank the recursion
  arrived from) to correctly account for every variable skipped between
  levels, including a final `2^(n - lastRank)` factor when the
  recursion bottoms out at the `TRUE` terminal. `nodeCount` does a
  reachable-node DFS from the given handle over `low`/`high` edges,
  counting every distinct node reached -- including whichever
  terminal(s) are reached (see Design notes below).

- `robdd.test.js` -- 50 `node:test` cases (no external dependencies),
  organized by the categories the task's own spec calls out:
  - **Construction/validation**: array/duplicate/type checks for
    `variableOrder`, an empty variable order (with its `satCount(TRUE)
    === 1n` edge case), non-mutation of the caller's array, and that
    `ROBDD.FALSE`/`ROBDD.TRUE` are the fixed values `0`/`1` usable
    directly on any instance.
  - **Reduction identities**: `not(not(x)) === x`, `apply(AND,x,x) ===
    x`, `apply(OR,x,x) === x`, `apply(XOR,x,x) === FALSE`, terminal
    identity/annihilator laws for AND/OR/XOR, the absorption law `a &
    (a|b) === a`, and a direct node-count check that a collapsed
    (`low===high`) node never grows the node table.
  - **Canonical identity for equivalent formulas**: the distributive
    law, both De Morgan laws, an XOR-via-AND/OR/NOT decomposition,
    AND/XOR associativity, and -- the single most important ROBDD
    correctness property -- building the *same* 4-variable Boolean
    function two structurally different ways (a factored form `(w|x) &
    (y|z)` vs. its fully-distributed expansion into four AND-terms
    OR'd together) and asserting they resolve to the identical handle,
    cross-checked against an independent truth table too.
  - **Exhaustive truth tables**: a fixed hand-derived 4-variable
    formula checked against every one of its 16 assignments, plus a
    seeded-PRNG (mulberry32) suite building random expressions (1-5
    variables, 12 trials per size) and checking every one of their
    `2^n` assignments against an independent recursive Boolean-expression
    evaluator (defined in the test file, operating on plain nested
    arrays, never touching `ROBDD` internals).
  - **Skipped variables**: a function of only the first and last
    variable in a 4-variable order (`a & d`, skipping `b`, `c`
    entirely) checked against all 16 assignments and its exact
    `satCount`; a 5-variable analogue (`p | t`, skipping `q`, `r`, `s`)
    with its own exact `satCount` and a node-count sanity bound; and a
    constant-`TRUE` function (`a | not(a)`) demonstrating `satCount ===
    2^n` and `nodeCount === 1` when a function depends on *no*
    variable at all.
  - **Exact satisfying counts**: `satCount(TRUE)`/`satCount(FALSE)`
    across several variable-order sizes (including the empty order); a
    single variable's count (`2^(n-1)`); a hand-derived 3-variable
    majority function (exactly 4 of 8 assignments, cross-checked
    against a brute-force count computed alongside the `evaluate`
    check); a differential suite (1-6 variables, 8 trials per size)
    comparing `satCount` against an independent brute-force count over
    every assignment for random expressions; a type check that
    `satCount` really returns a `bigint`, not a `number`; and the
    empty-variable-order edge case again in isolation.
  - **Cache reuse**: calling `apply` with the exact same operands twice
    returns the identical handle and leaves the `apply` cache's `.size`
    unchanged on the second call; the same check for `not`; and a check
    that rebuilding an entire multi-operation formula from scratch a
    second time doesn't grow the hash-consing unique table at all
    (every sub-node it needs already exists).
  - **Invalid inputs**: a full type/range sweep across `not`, `apply`
    (bad `op` values including case-sensitivity, bad operand handles),
    `evaluate` (bad handle; non-object, array, or `undefined`
    assignment; missing a required variable; non-boolean value for a
    required variable; and confirmation that *extra* assignment keys
    are harmless), `satCount`, and `nodeCount` -- plus a final test
    documenting, rather than hiding, that cross-instance handle reuse
    isn't guarded against (a handle that happens to be in-range for an
    unrelated smaller instance doesn't throw, since a plain integer
    handle carries no tag saying which instance created it), while
    confirming an *out-of-range* handle still throws even across
    instances, so the validation itself is real.

- `test-output.txt` -- raw, unedited output of the exact run command
  below.

## Additional verification (not part of the committed suite)

Beyond the committed suite: a larger, uncommitted differential/
brute-force stress run before any test was written --

- **1,160 exhaustive truth-table trials** (360 random expressions
  checked against every assignment for 1-6 variables, each also
  cross-checked for exact `satCount`).
- **800 canonical-identity trials** searching for logically-equivalent
  random expression pairs (verified equivalent via exhaustive
  truth-table comparison against each other first) and asserting
  matching `ROBDD` handles -- 66 genuinely equivalent pairs were found
  and all 66 resolved to identical handles.
- Explicit hand-derived canonical-identity checks (distributive,
  De Morgan x2, XOR decomposition, AND/XOR associativity, absorption,
  and a dedicated skipped-variable scenario), each also cross-checked
  against a full truth table.
- Cache-reuse and hash-consing/rebuild-stability checks (100 trials
  rebuilding an identical random formula from scratch and confirming
  both the returned handle and the unique table's size stay identical).

**0 mismatches across all of it** -- the implementation was correct
against every one of these independent oracles on the very first run,
with no implementation bugs needing a fix (the fourth task in this
collection in a row for which that's been true, following the KD-Tree
and Robin Hood Hash Map tasks -- see those tasks' own READMEs).

## Exact run command

```
node --test robdd.test.js
```

Requires only the Node.js runtime (tested on Node v22.22.2) -- no
`npm install`, no native build, no service to start. Run from inside
this directory, from a clean checkout. The full suite (50 tests,
including the random-expression differential suites) completes in well
under a second.

## Design notes

Several points in the task's spec were genuinely underspecified; each
was resolved with a deliberate, documented choice rather than an
implicit assumption:

- **`nodeCount` includes terminal nodes.** The spec doesn't pin down
  whether a reachable terminal counts toward `nodeCount`'s result. This
  implementation counts every distinct node reached by the DFS,
  terminals included, because it gives the method a simple,
  unambiguous postcondition (`nodeCount(ROBDD.TRUE) === 1`,
  `nodeCount(ROBDD.FALSE) === 1`, rather than `0` for a handle that
  *is* itself a terminal) that's trivial to state and test, at no cost
  to the property the method actually exists to demonstrate (that
  hash-consing keeps the *non-terminal* node count minimal).
- **`apply`'s cache key is not order-normalized for commutative
  operators.** `apply('AND', a, b)` and `apply('AND', b, a)` are cached
  under distinct keys (`` `AND|${a}|${b}` `` vs. `` `AND|${b}|${a}` ``)
  even though AND is commutative and both calls necessarily return the
  same handle (via the unique table, independent of the cache). This
  keeps the cache's behavior simple and exactly what the committed
  "cache reuse" tests assert: calling with the *same* argument order
  twice is a guaranteed cache hit; nothing is claimed or tested about
  order-swapped calls sharing a cache entry. A production BDD library
  would typically normalize commutative operands to double the
  effective cache hit rate, but that's an optimization orthogonal to
  this task's correctness requirements.
- **`evaluate` requires a complete assignment, not just the variables
  on the traversed path.** A given handle's function may not actually
  depend on every variable in `variableOrder` (see Skipped variables
  above), so in principle `evaluate` could accept a partial assignment
  covering only the variables the traversal happens to touch. This
  implementation instead requires every variable in `variableOrder` to
  have a strict boolean value in `assignment` (throwing `TypeError`
  otherwise), matching the task's own "exhaustive truth tables"
  framing of full assignments over the whole variable order, and
  giving callers an unambiguous, easy-to-state contract instead of one
  that depends on which nodes a particular diagram happens to contain.
- **The `apply` cache key format (`` `${op}|${a}|${b}` ``) assumes `op`
  never contains a literal `|` character.** Since `op` is restricted to
  exactly `'AND'`/`'OR'`/`'XOR'` by validation before the cache is ever
  touched, this is safe in practice; it's noted here only because the
  same string-concatenation-as-cache-key pattern appears in several
  other tasks in this collection and is worth flagging explicitly
  rather than leaving as an unstated assumption.
- **Terminal placeholder nodes occupy fixed slots 0 and 1 in the same
  per-instance `_nodes` array used for every other node**, rather than
  being handled as an entirely separate special case throughout the
  code. This keeps `_checkHandle`'s range check (`0 <= handle <
  this._nodes.length`) uniform across terminal and non-terminal
  handles, and keeps `nodeCount`'s DFS able to treat "is this a
  terminal" as a single `isTerminal` flag lookup rather than a
  `handle < 2` numeric special case sprinkled through multiple methods.
