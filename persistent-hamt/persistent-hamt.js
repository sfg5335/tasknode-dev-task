'use strict';

// Deterministic Persistent Hash-Array Mapped Trie (HAMT) -- an immutable,
// structurally-shared string-keyed map. See README.md for the full design
// writeup; this header covers just the essentials.
//
// - 32-way branching per level via 5-bit chunks of a 32-bit hash.
// - Node types:
//     * Leaf      -- a single key/value pair.
//     * Bitmap    -- a compact array-mapped branch node: a 32-bit bitmap
//                    marking which of the 32 possible child slots at this
//                    level are populated, plus a densely-packed `children`
//                    array (indexed by the popcount of the bits below the
//                    slot in question) holding only the *present* children.
//     * Collision -- used only once all 32 hash bits have been consumed
//                    (shift >= 32) and two or more distinct keys still
//                    share the exact same 32-bit hash; stores a flat list
//                    of [key, value] entries compared by linear scan.
// - Every mutating operation (`set`, `delete`) returns a brand-new
//   PersistentHamt instance; no existing node is ever mutated in place
//   (all node objects are frozen), so older instances/subtrees remain
//   valid and stay structurally shared with the new instance wherever
//   nothing changed underneath them.
// - A no-op `set` (key already maps to a `===`-equal value) or a `delete`
//   of an absent key returns the *exact same* PersistentHamt instance
//   (reference equality), not merely an equal one.

const BITS_PER_LEVEL = 5;
const LEVEL_MASK = (1 << BITS_PER_LEVEL) - 1; // 0x1f -- 32-way branching
const HASH_BITS = 32;

const NOT_FOUND = Symbol('persistent-hamt:not-found');

// ---------------------------------------------------------------------------
// Default hash: FNV-1a over the UTF-8 bytes of the key, folded to an
// unsigned 32-bit integer via Math.imul + `>>> 0`. Deterministic across
// runs/platforms (pure function of the string's content), and handles
// Unicode and the empty string uniformly because it hashes *bytes* (via
// TextEncoder's UTF-8 encoding), not UTF-16 code units or object identity.
const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const textEncoder = new TextEncoder();

function fnv1aHash(str) {
  const bytes = textEncoder.encode(str);
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i];
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}

// Standard SWAR popcount for a 32-bit unsigned integer.
function popcount32(x) {
  x = x - ((x >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  x = (x + (x >>> 4)) & 0x0f0f0f0f;
  return (x * 0x01010101) >>> 24;
}

// ---------------------------------------------------------------------------
// Node constructors. Plain frozen objects tagged with `type`; never mutated
// after creation -- every "change" allocates new node(s) and reuses
// whichever subtrees didn't change.

function makeLeaf(hash, key, value) {
  return Object.freeze({ type: 'leaf', hash, key, value });
}

function makeCollision(hash, entries) {
  return Object.freeze({ type: 'collision', hash, entries: Object.freeze(entries) });
}

function makeBitmap(bitmap, children) {
  return Object.freeze({ type: 'bitmap', bitmap, children: Object.freeze(children) });
}

// A leaf's [key, value] pair, or a collision node's full entry list --
// either way, every entry under `node` shares exactly the one hash `hash`.
function nodeEntryList(node) {
  return node.type === 'leaf' ? [[node.key, node.value]] : node.entries;
}

// Combine two hash-homogeneous units (each either a leaf or a collision
// node -- i.e. every entry beneath each one shares its associated hash)
// into a subtree rooted at `shift`. `hashA`/`hashB` are passed explicitly
// (rather than read off nodeA.hash/nodeB.hash) so this also works when
// merging a *new* leaf that isn't wrapped yet.
//
// This function does the real work behind both "a leaf already lives here
// and a different key needs to go in beside it" AND "a collision node that
// was hoisted to a shallower depth by an earlier delete's collapse turns
// out not to match this new key's hash after all, and needs re-expanding".
// Either way, nodeA/nodeB are treated as opaque, indivisible units: if
// their hashes still agree at some shift, the WHOLE unit (all its entries,
// for a collision node) rides down together inside a single-child bitmap;
// they are only actually pulled apart once their hashes diverge.
function combineByHash(nodeA, hashA, nodeB, hashB, shift) {
  if (shift >= HASH_BITS) {
    // All 32 hash bits are exhausted and the units still collide. This is
    // only reachable when hashA === hashB exactly, since two different
    // 32-bit hash values are guaranteed to diverge at some shift < 32
    // (each level consumes 5 previously-unexamined bits).
    return makeCollision(hashA, nodeEntryList(nodeA).concat(nodeEntryList(nodeB)));
  }
  const bitA = (hashA >>> shift) & LEVEL_MASK;
  const bitB = (hashB >>> shift) & LEVEL_MASK;
  if (bitA === bitB) {
    const child = combineByHash(nodeA, hashA, nodeB, hashB, shift + BITS_PER_LEVEL);
    return makeBitmap(1 << bitA, [child]);
  }
  const bitmap = (1 << bitA) | (1 << bitB);
  const children = bitA < bitB ? [nodeA, nodeB] : [nodeB, nodeA];
  return makeBitmap(bitmap, children);
}

// ---------------------------------------------------------------------------
// Core recursive operations. `node` is either `null` (empty subtree) or one
// of the three node shapes above.

// Returns { node, delta }. `delta` is 1 if a brand-new key was added, 0 if
// the key already existed (whether or not its value actually changed).
// When absolutely nothing changes (key already present with a `===`-equal
// value), the returned `node` is the *exact same reference* passed in, so
// callers can detect true no-ops via `===` and skip allocating a new
// wrapper/instance.
function nodeSet(node, shift, hash, key, value) {
  if (node === null) {
    return { node: makeLeaf(hash, key, value), delta: 1 };
  }
  if (node.type === 'leaf') {
    if (node.hash === hash && node.key === key) {
      if (node.value === value) return { node, delta: 0 };
      return { node: makeLeaf(hash, key, value), delta: 0 };
    }
    return { node: combineByHash(node, node.hash, makeLeaf(hash, key, value), hash, shift), delta: 1 };
  }
  if (node.type === 'collision') {
    if (node.hash !== hash) {
      // The collision node's hash doesn't match the key being inserted.
      // This is legitimate (not an invariant violation): a collision node
      // is only guaranteed to sit at shift>=32 *at the moment it is
      // created*. A later `delete` can collapse an ancestor bitmap whose
      // only remaining child is this collision node, hoisting it up to a
      // shallower position in the tree (see nodeDelete). From there, a
      // subsequent `set` for a key whose hash merely shares this node's
      // low-order bits down to the *current* shift -- but diverges deeper
      // -- reaches this node while shift < 32. Re-expand it alongside the
      // new leaf via additional bitmap levels until the hashes diverge
      // (or, in the case of a true full-hash match, merge into it).
      return { node: combineByHash(node, node.hash, makeLeaf(hash, key, value), hash, shift), delta: 1 };
    }
    const idx = node.entries.findIndex((entry) => entry[0] === key);
    if (idx === -1) {
      const entries = node.entries.concat([[key, value]]);
      return { node: makeCollision(hash, entries), delta: 1 };
    }
    if (node.entries[idx][1] === value) return { node, delta: 0 };
    const entries = node.entries.slice();
    entries[idx] = [key, value];
    return { node: makeCollision(hash, entries), delta: 0 };
  }
  // bitmap
  const bit = (hash >>> shift) & LEVEL_MASK;
  const mask = 1 << bit;
  const idx = popcount32(node.bitmap & (mask - 1));
  if ((node.bitmap & mask) === 0) {
    const children = node.children.slice();
    children.splice(idx, 0, makeLeaf(hash, key, value));
    return { node: makeBitmap(node.bitmap | mask, children), delta: 1 };
  }
  const child = node.children[idx];
  const result = nodeSet(child, shift + BITS_PER_LEVEL, hash, key, value);
  if (result.node === child) return { node, delta: 0 };
  const children = node.children.slice();
  children[idx] = result.node;
  return { node: makeBitmap(node.bitmap, children), delta: result.delta };
}

function nodeGet(node, shift, hash, key) {
  if (node === null) return NOT_FOUND;
  if (node.type === 'leaf') {
    return node.hash === hash && node.key === key ? node.value : NOT_FOUND;
  }
  if (node.type === 'collision') {
    if (node.hash !== hash) return NOT_FOUND;
    const entry = node.entries.find((e) => e[0] === key);
    return entry === undefined ? NOT_FOUND : entry[1];
  }
  // bitmap
  const bit = (hash >>> shift) & LEVEL_MASK;
  const mask = 1 << bit;
  if ((node.bitmap & mask) === 0) return NOT_FOUND;
  const idx = popcount32(node.bitmap & (mask - 1));
  return nodeGet(node.children[idx], shift + BITS_PER_LEVEL, hash, key);
}

// Returns { node, deleted }. `node` is `null` if the whole subtree became
// empty; otherwise the (possibly node-collapsed) replacement subtree. When
// `deleted` is false, `node` is always the exact same reference passed in
// (the key was not present anywhere below this point).
//
// Collapsing: whenever removing (or recursively collapsing) a child leaves
// a bitmap node with exactly one remaining child that is itself a leaf or
// collision node, the bitmap wrapper is discarded and that child is
// returned directly in its place -- this is what keeps the trie's shape
// minimal after deletions ("branch collapse") rather than accumulating
// single-child bitmap chains forever.
function nodeDelete(node, shift, hash, key) {
  if (node === null) return { node: null, deleted: false };
  if (node.type === 'leaf') {
    if (node.hash === hash && node.key === key) return { node: null, deleted: true };
    return { node, deleted: false };
  }
  if (node.type === 'collision') {
    if (node.hash !== hash) return { node, deleted: false };
    const idx = node.entries.findIndex((entry) => entry[0] === key);
    if (idx === -1) return { node, deleted: false };
    const remaining = node.entries.slice(0, idx).concat(node.entries.slice(idx + 1));
    if (remaining.length === 1) {
      return { node: makeLeaf(node.hash, remaining[0][0], remaining[0][1]), deleted: true };
    }
    return { node: makeCollision(node.hash, remaining), deleted: true };
  }
  // bitmap
  const bit = (hash >>> shift) & LEVEL_MASK;
  const mask = 1 << bit;
  if ((node.bitmap & mask) === 0) return { node, deleted: false };
  const idx = popcount32(node.bitmap & (mask - 1));
  const child = node.children[idx];
  const result = nodeDelete(child, shift + BITS_PER_LEVEL, hash, key);
  if (!result.deleted) return { node, deleted: false };

  if (result.node === null) {
    const newBitmap = node.bitmap & ~mask;
    if (newBitmap === 0) return { node: null, deleted: true };
    const children = node.children.slice(0, idx).concat(node.children.slice(idx + 1));
    if (children.length === 1 && children[0].type !== 'bitmap') {
      return { node: children[0], deleted: true };
    }
    return { node: makeBitmap(newBitmap, children), deleted: true };
  }

  const children = node.children.slice();
  children[idx] = result.node;
  if (children.length === 1 && children[0].type !== 'bitmap') {
    return { node: children[0], deleted: true };
  }
  return { node: makeBitmap(node.bitmap, children), deleted: true };
}

function collectEntries(node, out) {
  if (node === null) return;
  if (node.type === 'leaf') {
    out.push([node.key, node.value]);
    return;
  }
  if (node.type === 'collision') {
    for (const entry of node.entries) out.push([entry[0], entry[1]]);
    return;
  }
  for (const child of node.children) collectEntries(child, out);
}

function validateKey(key) {
  if (typeof key !== 'string') {
    throw new TypeError(`key must be a string, got ${typeof key}`);
  }
}

// ---------------------------------------------------------------------------
// Public immutable map.

class PersistentHamt {
  constructor(root, size, hashFn) {
    this._root = root;
    this._size = size;
    this._hashFn = hashFn;
  }

  get size() {
    return this._size;
  }

  set(key, value) {
    validateKey(key);
    const hash = this._hashFn(key) >>> 0;
    const result = nodeSet(this._root, 0, hash, key, value);
    if (result.node === this._root) return this;
    return new PersistentHamt(result.node, this._size + result.delta, this._hashFn);
  }

  get(key) {
    validateKey(key);
    const hash = this._hashFn(key) >>> 0;
    const value = nodeGet(this._root, 0, hash, key);
    return value === NOT_FOUND ? undefined : value;
  }

  has(key) {
    validateKey(key);
    const hash = this._hashFn(key) >>> 0;
    return nodeGet(this._root, 0, hash, key) !== NOT_FOUND;
  }

  delete(key) {
    validateKey(key);
    const hash = this._hashFn(key) >>> 0;
    const result = nodeDelete(this._root, 0, hash, key);
    if (!result.deleted) return this;
    return new PersistentHamt(result.node, this._size - 1, this._hashFn);
  }

  // Fresh array of [key, value] pairs (fresh arrays too -- never aliases
  // internal storage), sorted in ascending plain-JS-`<` string order.
  entries() {
    const out = [];
    collectEntries(this._root, out);
    out.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    return out;
  }
}

function empty(hashFn) {
  if (hashFn !== undefined && typeof hashFn !== 'function') {
    throw new TypeError('hashFn must be a function when provided');
  }
  return new PersistentHamt(null, 0, hashFn === undefined ? fnv1aHash : hashFn);
}

module.exports = { empty, PersistentHamt, fnv1aHash };
