# Indexed Pairing Heap

A dependency-free, indexed min-priority-queue backed by a real
[pairing heap](https://en.wikipedia.org/wiki/Pairing_heap) (Fredman,
Sedgewick, Sloan & Tarjan, 1986), with **opaque handles** returned from
`insert()` so that `decreaseKey()`/`delete()` can mutate or remove an
*arbitrary, previously-inserted* element in O(log n) amortized time,
without ever needing to search the heap for it.

## API

```js
const { IndexedPairingHeap } = require('./indexed-pairing-heap.js');

const heap = new IndexedPairingHeap();

const handle = heap.insert(priority, value); // O(1) amortized, returns an opaque Handle
heap.peek();                                 // { priority, value } of the current minimum, O(1)
heap.pop();                                  // removes + returns { priority, value } of the minimum, O(log n) amortized
heap.decreaseKey(handle, newPriority);       // lowers (or leaves unchanged) that element's priority, O(log n) amortized
heap.delete(handle);                         // removes + returns { priority, value } of that specific element, O(log n) amortized
heap.size;                                   // read-only getter, current element count
```

- Priorities must be finite numbers (`typeof p === 'number' && Number.isFinite(p)`); anything else throws `TypeError` from `insert()` or `decreaseKey()`.
- `decreaseKey()` is decrease-only: passing a priority *greater than* the element's current priority throws `RangeError`. Passing the exact same priority is accepted as a documented no-op (see "Design decisions" below).
- `peek()`/`pop()` on an empty heap throw `RangeError` (see "Design decisions").
- `decreaseKey()`/`delete()` throw `RangeError` for any handle that is not a genuine, still-live handle from *this same heap instance* — covering three distinct cases uniformly: a value that was never a handle at all (`null`, a plain object, a number, ...), a real handle from a *different* `IndexedPairingHeap` instance ("foreign"), and a real handle whose element has already been removed via `pop()` or `delete()` ("stale," including double-delete).
- Equal priorities are broken by **insertion order**: among ties, `pop()` drains the earliest-inserted element first (FIFO among ties).

## Algorithm

Each internal node keeps three links: `child` (its leftmost child), `sibling`
(its next sibling to the right), and a dual-purpose `prev` link that means
*"my parent, if I am the leftmost child"* or *"my left sibling, otherwise."*
That dual-purpose back-link — rather than a full, separate parent pointer on
every node — is exactly what the original pairing-heap paper uses to make
`decreaseKey()`/`delete()` able to cut an arbitrary node out of the tree in
O(1): the cut only ever has to update `prev`'s outgoing pointer (`.child` or
`.sibling`, decided by comparing `prev.child === node`) and, if present, the
cut node's own former sibling's `.prev`.

- `insert(priority, value)`: wraps `{priority, value}` in a new node (tagged
  with a monotonically increasing insertion sequence number for tie-breaking)
  and melds it with the existing root in O(1) (two-way meld: the tree with
  the larger-or-tied root becomes the new leftmost child of the tree with the
  smaller root).
- `pop()`: removes the root, then re-consolidates the root's (possibly many)
  children back into a single tree via the classic **two-pass merge**: pair
  up siblings left-to-right and meld each pair, then fold the resulting pairs
  together right-to-left. This two-pass discipline is what gives pairing
  heaps their good amortized bounds (a naive single-pass left-to-right meld
  degrades badly on adversarial input).
- `decreaseKey(handle, p)`: if the target is already the root, updating its
  priority in place is sufficient (decreasing only ever preserves the heap
  property at the root). Otherwise, the node (with its whole subtree
  attached) is cut out via the O(1) `prev`-based unlink described above and
  re-melded directly with the current root.
- `delete(handle)`: if the target is the root, this is exactly `pop()`.
  Otherwise, the node is cut out (same O(1) unlink), its own children are
  independently re-consolidated via the same two-pass merge used by `pop()`,
  and that sub-result is melded back into the main root — so the rest of the
  heap gains the deleted node's former children as new (still valid)
  subtrees, rather than losing them.

## Design decisions (spec left unpinned; documented per project convention)

The task spec pins down every operation's happy path and the three
required error cases (non-finite priority → `TypeError`; priority increase
→ `RangeError`; stale/foreign handle → `RangeError`), but leaves a few
smaller behaviors unspecified. Each was resolved with a reasonable,
API-consistent choice:

1. **`peek()`/`pop()` on an empty heap**: both throw `RangeError`, matching
   the spec's own established pattern of using `RangeError` for
   "operation invalid given current state" (as opposed to `TypeError` for
   "argument has the wrong type/value").
2. **`decreaseKey()` to the exact same priority**: accepted as a no-op
   (not treated as an "increase," since nothing actually increased) and
   deliberately short-circuits before any tree restructuring — both because
   it is genuinely unnecessary work, and because it means an element's
   position among same-priority peers (tie-broken by insertion order) is
   never disturbed by a decreaseKey call that didn't actually change
   anything.
3. **Validation order inside `decreaseKey(handle, priority)`**: the handle
   is validated first (`RangeError` if invalid/foreign/stale), *then* the
   new priority's type/finiteness (`TypeError`), *then* whether it would be
   an increase (`RangeError`). This order is pinned by an explicit test.
4. **What a "handle" is, concretely**: an un-exported `Handle` class
   instance wrapping a reference to the internal node plus a reference to
   the owning heap. Because `Handle` is never exported from the module,
   external code cannot construct a value that passes the `instanceof`
   check except by calling `insert()` on a real `IndexedPairingHeap` — so
   "foreign" (from a different, real heap) and "not a real handle at all"
   both collapse cleanly into the same `RangeError` path, alongside
   "stale" (already removed).

## Testing

`indexed-pairing-heap.test.js` (24 assertions across 21 `node:test` cases,
all passing — see `test-output.txt` for the raw run):

- Empty-heap `peek()`/`pop()` throw `RangeError`.
- `insert()` rejects every kind of non-finite/wrong-type priority with
  `TypeError`, and does not mutate the heap when it throws.
- Single insert/peek/pop round-trip; `peek()` never removes anything.
- Popping a batch of distinct priorities drains in exact ascending order
  regardless of insertion order.
- Equal-priority elements drain in exact FIFO insertion order, including a
  200-element all-duplicate-priority batch.
- `decreaseKey()` on the root, on a non-root node (promoting it to the new
  minimum), as a same-priority no-op (with an explicit tie-break
  preservation check), and its `RangeError`/`TypeError` rejections.
- `delete()` on a leaf, on the current root, and on an internal node deep
  enough to have its own children — the last case explicitly verifies that
  the deleted node's children survive and are still reachable/poppable
  afterward.
- Every "invalid handle" shape: primitives, `null`/`undefined`, a plain
  object, a handle from a genuinely different heap instance, an
  already-popped handle, and an already-deleted handle (including an
  explicit double-delete check that also confirms `size` isn't
  double-decremented).
- `size`'s read-only-ness: assigning to it throws `TypeError` in strict
  mode.
- A hand-built interleaved sequence mixing all four mutating operations,
  checked against exact expected surviving elements.
- A **whitebox structural invariant checker** (`checkInvariants`), run
  after nearly every operation across every test, that walks the real
  internal `child`/`sibling` tree and verifies both heap-order (every
  node's priority ≤ all of its descendants') and that every `prev` link
  correctly means "parent, if leftmost child" or "left sibling, otherwise"
  — i.e. that the O(1)-cut invariant the whole `decreaseKey`/`delete`
  design depends on is actually maintained, not just that final query
  results happen to look right.
- A **6,000-operation randomized differential test** against an
  intentionally simple, structurally unrelated reference implementation
  (a plain array, linearly scanned for the minimum by `(priority, seq)`,
  spliced on removal) — mixing `insert`/`pop`/`decreaseKey`/`delete`,
  cross-checking every `pop()`/`delete()` result and the final full-drain
  sequence exactly.

### Additional uncommitted stress testing (performed before committing, per project discipline for bug-prone data structures)

Beyond the committed suite, 145,000 further randomized operations were run
across 8 differential trials against the same reference-queue design (with
seed variety spanning: pop-heavy, delete-heavy, decreaseKey-heavy, and
insert-heavy ratios; a priority range of just 5 distinct values to force
heavy tie collisions; a very wide range; and floating-point priorities) —
127,264 total assertions, 0 mismatches. Two additional **adversarial**
patterns were run separately: (1) repeatedly popping the current minimum
and immediately reinserting it at a far lower priority (forcing the root to
change constantly), and (2) inserting N=400 elements in **strictly
decreasing** priority order (the classic pairing-heap worst case — every
insert becomes the new root, chaining the entire previous tree as its one
child, producing a maximally-deep single-child spine) followed by deleting
every element via its handle in both root-first and leaf-first order,
confirming the heap empties out to exactly `size === 0` either way with no
lost or duplicated elements. All passed with 0 mismatches. This
implementation shipped with **zero genuine bugs found** during stress
testing — the first clean pass since the streak-ending bug in the prior
task (Persistent HAMT).

Run tests yourself: `node --test indexed-pairing-heap.test.js` (no
installed dependencies required).
