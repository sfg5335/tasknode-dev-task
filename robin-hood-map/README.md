# robin-hood-map

Dependency-free, single-file, deterministic Robin Hood open-addressing
hash map (`RobinHoodMap`) for string keys, in JavaScript, with an
automated `node:test` suite.

## Files

- `robin-hood-map.js` -- the implementation:
  `new RobinHoodMap()` constructs an empty map with a small initial
  power-of-two capacity (`RobinHoodMap.INITIAL_CAPACITY`, 8). Instance
  API: `size` (getter), `set(key, value)`, `get(key)`, `has(key)`,
  `delete(key)`, `clear()`. `set`/`delete`/`clear` return `this` for
  chaining. Every key-accepting method requires a string key -- a
  non-string key throws `TypeError`; the empty string `''` is a
  perfectly ordinary, valid key.

  Updating an already-present key (`set` on an existing key) changes
  only its stored value -- size, capacity, and every entry's probe
  distance are left untouched. Inserting a genuinely new key may
  trigger Robin Hood probe-distance-swapping displacement of existing
  entries, and may trigger a capacity-doubling growth/rehash first if
  the documented load-factor threshold (`RobinHoodMap.MAX_LOAD_FACTOR`,
  `0.9`) would otherwise be exceeded. Deletion uses backward-shift
  deletion -- no tombstones are ever left in the table.

  Algorithm: classic Robin Hood open-addressing hashing (Celis 1986)
  with linear probing. Keys are hashed with the standard 32-bit FNV-1a
  algorithm (also exported as `RobinHoodMap.fnv1aHash`, verified
  against the well-known standard test vectors: `fnv1a('') ===
  0x811c9dc5`, `fnv1a('a') === 0xe40c292c`). Insertion walks forward
  from a key's home slot (`hash % capacity`); at each occupied slot, if
  the entry currently being carried has probed *strictly farther* than
  the slot's occupant, they swap ("steal from the rich, give to the
  poor") and the displaced occupant continues probing in the carried
  entry's place -- an exact probe-distance tie does not swap, so a
  fixed operation sequence always produces the same deterministic
  table. Lookup uses the standard Robin Hood early-exit optimization:
  it can stop as soon as a visited slot's own stored probe distance is
  less than how far the search has already walked, without needing to
  reach an empty slot. Deletion removes the target entry, then
  repeatedly shifts the next slot's entry back by one position
  (decrementing its probe distance) as long as that entry isn't already
  at its own home slot, keeping the table tombstone-free throughout.

  Every input is validated: a non-string key to `set`/`get`/`has`/
  `delete` throws `TypeError`.

- `robin-hood-map.test.js` -- 22 `node:test` cases (no external
  dependencies): empty-map operations; in-place updates (including a
  direct whitebox check that updating a key changes no entry's probe
  distance); forced collisions using four keys independently confirmed
  offline to all hash to the same home bucket at the initial capacity,
  including a whitebox check that a full collision cluster produces
  probe distances `{0,1,2,3}`; a direct demonstration that reversing
  the insertion order of the same colliding keys produces a genuinely
  different table layout (proof that real Robin Hood swapping is
  happening, not just first-come-first-served queuing); a tie-break
  check that equal probe distances never swap; backward-shift cluster
  deletion (including a whitebox check that shifted entries' probe
  distances decrement by exactly one, and that no tombstone markers
  ever appear in the slot array); growth (capacity doubling exactly at
  the documented load-factor threshold, checked across 40 sequential
  inserts) and resize-retention (500 keys retained correctly across
  multiple growths, with and without interleaved deletes); `clear()`
  (resets both size and capacity, and the map remains fully usable
  afterward); a full `TypeError` sweep across nine different invalid
  key types for every key-accepting method; the empty string as a
  valid key (alone and coexisting with other keys); FNV-1a determinism
  against standard test vectors; and three seeded-PRNG (mulberry32,
  fixed seeds) differential suites against a native `Map` -- general
  random operation sequences (60 trials), small key pools specifically
  forcing heavy collisions and displacement chains (40 trials), and
  growth-heavy sequences of 200-600 keys with interleaved deletes (20
  trials) -- every differential trial also re-runs the whitebox
  invariant checker (`checkTableInvariants`, verifying every occupied
  slot's stored probe distance matches its actual displacement from its
  computed home slot, and that every live key is reachable via `has()`)
  in addition to comparing against `Map`.

- `test-output.txt` -- raw, unedited output of the exact run command
  below.

## Additional verification (not part of the committed suite)

Beyond the committed suite: a larger, uncommitted differential run (200
+ 150 + 60 + 60 trials across four categories, ~60,000 operations
total, plus a dedicated explicit-collision-cluster scenario) against a
native `Map`, with the same whitebox invariant checker re-run after
every single operation in the heavy-collision suite specifically (not
just at the end of each trial) -- 0 mismatches throughout. The
implementation was correct against this oracle on the very first run,
with no implementation bugs needing a fix.

## Exact run command

```
node --test robin-hood-map.test.js
```

Requires only the Node.js runtime (tested on Node v22.22.2) -- no
`npm install`, no native build, no service to start. Run from inside
this directory, from a clean checkout. The full suite (including all
three differential suites and the 500-key growth-retention test)
completes in well under a second.

## Design notes

- **FNV-1a's own bitwise/wraparound arithmetic is correct here, not a
  bug risk.** This collection has previously run into real bugs from
  JavaScript's bitwise operators silently wrapping values at 2^31/2^32
  (e.g. the Van Emde Boas task's `universeSize` needing to represent
  exactly `2^32`). FNV-1a is different: the algorithm's own definition
  *is* "XOR then multiply, modulo 2^32" -- so using `Math.imul` (a
  correct, non-precision-losing 32-bit multiply) and a final `>>> 0`
  here is the literal, spec-mandated implementation of FNV-1a, not an
  accidental side effect to guard against. This distinction is worth
  calling out explicitly precisely because the *general* rule ("avoid
  bitwise ops near 2^31/2^32") from earlier tasks doesn't blanket-apply
  here -- the difference is whether the algorithm being implemented
  itself requires modular 32-bit arithmetic (FNV-1a does) or needs to
  represent an exact value that could reach that range (vEB's universe
  size did, and bitwise ops would have silently corrupted it).
- Bucket-index arithmetic (`hash % capacity`), by contrast, deliberately
  uses plain `%` rather than the more common power-of-two bitmask trick
  (`hash & (capacity - 1)`). Both are mathematically equivalent for a
  power-of-two capacity and this task's capacities never come close to
  any 32-bit-wraparound danger zone -- `%` was simply chosen as the
  simpler, more obviously-correct option with zero bitwise-operator
  surface area to reason about at all, at no performance cost that
  matters for this task's scope.
- `MAX_LOAD_FACTOR = 0.9` (documented and re-exported as
  `RobinHoodMap.MAX_LOAD_FACTOR` for tests) is deliberately higher than
  a typical linear-probing hash table's conventional ~0.7. Robin Hood
  hashing's entire value proposition is that it keeps probe-distance
  variance low even at high load factors, where naive linear probing
  degrades sharply -- so using a lower, more conservative threshold
  here would undersell exactly the property this data structure is
  supposed to demonstrate.
- `clear()` resets capacity all the way back down to
  `INITIAL_CAPACITY` rather than keeping the table's current (possibly
  much larger) capacity. This is a deliberate, documented design choice
  where the task's spec left the behavior unpinned: resetting fully
  reclaims memory and gives `clear()` a simple, easy-to-verify
  postcondition (`size === 0 && capacity === INITIAL_CAPACITY`,
  directly asserted in the test suite) at the cost of needing to regrow
  from scratch if the map is immediately reused at scale -- a
  reasonable tradeoff for this task's scope, and no less valid than the
  alternative (keep current capacity) that a different implementation
  might choose instead.
- The test suite's whitebox invariant checker and several of the
  forced-collision/displacement/backward-shift tests reach directly
  into `RobinHoodMap`'s internal `_slots`/`_capacity` fields rather
  than treating the class as a pure black box. This is deliberate,
  matching the task's own verification requirement that "the reviewer
  must be able to inspect the commit for Robin Hood insertion,
  backward-shift deletion, collision tests, and resize-retention
  tests" -- directly asserting on stored probe distances and slot
  contents makes it unambiguous that these specific mechanisms are
  implemented and exercised, rather than relying solely on black-box
  behavioral equivalence with a `Map` (which the differential suites
  also cover, as the primary correctness signal).
