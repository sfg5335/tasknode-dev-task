'use strict';

// Deterministic Merkle Mountain Range (MMR)
// ------------------------------------------
//
// An append-only, hash-based accumulator built from a forest of perfect
// binary trees ("mountains"), one per set bit in the binary expansion of
// the current leaf count. Appending a new leaf is exactly analogous to
// incrementing a binary counter: a new height-0 mountain is pushed, and
// consecutive equal-height mountains are merged (carried) from the right
// until no two adjacent mountains share a height. This gives amortized
// O(1) append and an O(log n) inclusion proof for any leaf, without ever
// needing to rebuild or rehash the whole structure.
//
// Every hash in this module is domain-separated by a leading tag byte, so
// a leaf hash, an internal parent hash, a peak-bagging step, and the final
// rooted hash can never collide with one another even if their remaining
// bytes happen to coincide:
//
//   leaf hash    = SHA-256(0x00 || uint64be(byteLength) || bytes)
//   parent hash  = SHA-256(0x01 || left || right)
//   peak bagging = SHA-256(0x02 || accumulator || nextPeak)
//   rooted hash  = SHA-256(0x03 || uint64be(size) || baggedPeaks)
//   empty root   = SHA-256(0x03 || uint64be(0))
//
// All hashes -- internal and returned -- are lowercase hexadecimal strings.

const crypto = require('crypto');

const HEX64_RE = /^[0-9a-f]{64}$/i;

function sha256(...buffers) {
  const h = crypto.createHash('sha256');
  for (const b of buffers) h.update(b);
  return h.digest();
}

// Encodes a non-negative integer (or bigint) as 8 bytes, big-endian.
// Uses BigInt throughout rather than JS's 32-bit bitwise operators, so
// values up to the full unsigned 64-bit range are represented exactly
// (see workflow convention: never use bitwise ops on values that might
// exceed 2^31/2^32 for something that needs to be exact).
function uint64be(n) {
  const big = typeof n === 'bigint' ? n : BigInt(n);
  if (big < 0n) throw new RangeError('uint64be: value must be non-negative');
  if (big > 0xffffffffffffffffn) throw new RangeError('uint64be: value exceeds 64 bits');
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(big);
  return buf;
}

function hex(buf) {
  return buf.toString('hex');
}

function fromHex(hexStr) {
  return Buffer.from(hexStr, 'hex');
}

function leafHash(bytes) {
  return hex(sha256(Buffer.from([0x00]), uint64be(bytes.length), Buffer.from(bytes)));
}

function parentHash(leftHex, rightHex) {
  return hex(sha256(Buffer.from([0x01]), fromHex(leftHex), fromHex(rightHex)));
}

function bagHash(accHex, nextPeakHex) {
  return hex(sha256(Buffer.from([0x02]), fromHex(accHex), fromHex(nextPeakHex)));
}

function rootBindHash(size, baggedPeaksHex) {
  if (baggedPeaksHex === null) {
    return hex(sha256(Buffer.from([0x03]), uint64be(size)));
  }
  return hex(sha256(Buffer.from([0x03]), uint64be(size), fromHex(baggedPeaksHex)));
}

// Folds an ordered, non-empty array of peak hashes into a single bagged
// hash. A single-element array folds to that element unchanged (bagging
// a one-mountain forest is the identity operation -- there is nothing to
// combine with).
function bagPeaks(peakHashes) {
  let acc = peakHashes[0];
  for (let i = 1; i < peakHashes.length; i++) {
    acc = bagHash(acc, peakHashes[i]);
  }
  return acc;
}

class MerkleMountainRange {
  constructor() {
    // Each mountain: { height, layers }. `layers[i]` (0 <= i <= height) is
    // an array of hex hashes at level i, ordered left-to-right; layers[0]
    // is the mountain's own leaves, layers[height] is a single-element
    // array holding the mountain's peak hash. Storing every level (not
    // just the peak) is what makes getProof() a simple array lookup
    // rather than a re-derivation, at the cost of O(n) memory -- an
    // acceptable trade-off for a reference/test-scale implementation.
    this._peaks = [];
    this._size = 0;
  }

  // Appends a new leaf holding `bytes` (a Uint8Array). Returns the new
  // leaf's 0-based index -- a deliberate, documented design choice (the
  // task spec doesn't say what append() returns): the caller has no other
  // way to learn which index to later pass to getProof() for the leaf it
  // just appended, short of separately tracking `size - 1` itself.
  //
  // The original `bytes` reference is never retained: it is hashed
  // immediately (via a fresh Buffer copy, see leafHash/Buffer.from) and
  // discarded, so later external mutation of the caller's array has no
  // effect on the MMR's internal state -- true "mutation safety" by
  // construction, not by defensive copying of stored data.
  append(bytes) {
    if (!(bytes instanceof Uint8Array)) {
      throw new TypeError('append: bytes must be a Uint8Array');
    }

    const index = this._size;
    this._size += 1;

    let mountain = { height: 0, layers: [[leafHash(bytes)]] };
    this._peaks.push(mountain);

    while (
      this._peaks.length >= 2 &&
      this._peaks[this._peaks.length - 1].height === this._peaks[this._peaks.length - 2].height
    ) {
      const right = this._peaks.pop();
      const left = this._peaks.pop();
      const newHeight = left.height + 1;
      const layers = [];
      for (let i = 0; i <= left.height; i++) {
        layers.push(left.layers[i].concat(right.layers[i]));
      }
      layers.push([parentHash(left.layers[left.height][0], right.layers[right.height][0])]);
      this._peaks.push({ height: newHeight, layers });
    }

    return index;
  }

  // Current leaf count. A getter (not a method) -- the task spec lists
  // `size` alongside `append(bytes)`/`root()`/`getProof(index)` without
  // parentheses, distinguishing it as a property.
  get size() {
    return this._size;
  }

  // Returns the current root as a lowercase hex string. The empty-MMR
  // root is the fixed value SHA-256(0x03 || uint64be(0)) with no bagged
  // -peaks component at all (there is nothing to bag when there are no
  // mountains) -- distinct from, and not derivable from, the general
  // n>=1 formula, exactly as the task spec defines it.
  root() {
    if (this._size === 0) {
      return rootBindHash(0, null);
    }
    const peakHashes = this._peaks.map((m) => m.layers[m.height][0]);
    return rootBindHash(this._size, bagPeaks(peakHashes));
  }

  // Returns an inclusion proof for the leaf at `index` (0-based), against
  // the tree's CURRENT state. Like any Merkle proof, a proof generated at
  // one size is tied to that size/root and is not expected to verify
  // against a different (e.g. later, larger) root.
  //
  // Proof shape (order and field names are the entire contract that
  // verifyProof() below understands; not specified by the task, so this
  // is a deliberate, documented design choice):
  //   {
  //     index:     the leaf index this proof is for,
  //     size:      the MMR size (leaf count) this proof was generated
  //                against -- needed to reproduce the root-binding step,
  //     siblings:  bottom-to-top list of { hash, position } needed to
  //                climb from the leaf to its own mountain's peak;
  //                `position` is the SIBLING's position relative to the
  //                node being climbed ('left' or 'right'),
  //     peaks:     every mountain's peak hash, left-to-right, at proof
  //                -generation time,
  //     peakIndex: which entry of `peaks` corresponds to this leaf's own
  //                mountain (the one whose peak gets replaced by the
  //                recomputed value during verification).
  //   }
  //
  // Every array/object here is freshly constructed from immutable hex
  // strings -- never a reference to this MMR's internal `layers` arrays
  // -- so mutating a returned proof can never corrupt the MMR's own
  // state, and vice versa.
  getProof(index) {
    if (typeof index !== 'number' || !Number.isInteger(index)) {
      throw new TypeError('getProof: index must be an integer');
    }
    if (index < 0 || index >= this._size) {
      throw new RangeError(`getProof: index ${index} out of range for size ${this._size}`);
    }

    let base = 0;
    let mountainIdx = -1;
    let local = -1;
    for (let m = 0; m < this._peaks.length; m++) {
      const leafCount = 1 << this._peaks[m].height;
      if (index < base + leafCount) {
        mountainIdx = m;
        local = index - base;
        break;
      }
      base += leafCount;
    }

    const mountain = this._peaks[mountainIdx];
    const siblings = [];
    let cur = local;
    for (let level = 0; level < mountain.height; level++) {
      const siblingIndex = cur ^ 1;
      const position = cur % 2 === 0 ? 'right' : 'left';
      siblings.push({ hash: mountain.layers[level][siblingIndex], position });
      cur = cur >> 1;
    }

    const peaks = this._peaks.map((m) => m.layers[m.height][0]);

    return {
      index,
      size: this._size,
      siblings,
      peaks,
      peakIndex: mountainIdx,
    };
  }

  // Validates `bytes`/`proof`/`expectedRoot` against a genuine leaf,
  // recomputing the root the proof implies and comparing it against
  // `expectedRoot`. Returns a boolean -- true only if the recomputed root
  // exactly matches (case-insensitively; see below).
  //
  // Error-handling convention (matches the rest of this repository):
  // a value of the wrong *kind* -- `bytes` not a Uint8Array, `proof`
  // missing/malformed fields, `expectedRoot` not a 64-character hex
  // string -- is a TypeError, since that is a caller/programmer error,
  // not a legitimate verification outcome. A well-typed but WRONG proof
  // or root (a tampered leaf, sibling, peak, size, or expected root that
  // is still shaped correctly) is not an error at all -- it is exactly
  // the "verification failed" case this method exists to report, so it
  // simply returns `false` rather than throwing.
  static verifyProof(bytes, proof, expectedRoot) {
    if (!(bytes instanceof Uint8Array)) {
      throw new TypeError('verifyProof: bytes must be a Uint8Array');
    }
    validateProofShape(proof);
    if (typeof expectedRoot !== 'string' || !HEX64_RE.test(expectedRoot)) {
      throw new TypeError('verifyProof: expectedRoot must be a 64-character hexadecimal string');
    }

    let cur = leafHash(bytes);
    for (const sib of proof.siblings) {
      cur = sib.position === 'left' ? parentHash(sib.hash, cur) : parentHash(cur, sib.hash);
    }

    const peaksForFold = proof.peaks.slice();
    peaksForFold[proof.peakIndex] = cur;

    const recomputedRoot = rootBindHash(proof.size, bagPeaks(peaksForFold));

    // Comparison is case-insensitive: this module always PRODUCES
    // lowercase hex (per the task spec), but a caller-supplied
    // `expectedRoot` is only required to be valid hex, not specifically
    // lowercase -- a documented, deliberate leniency on the input side.
    return recomputedRoot === expectedRoot.toLowerCase();
  }
}

function validateProofShape(proof) {
  if (proof === null || typeof proof !== 'object') {
    throw new TypeError('verifyProof: proof must be an object');
  }
  if (!Number.isInteger(proof.size) || proof.size < 0) {
    throw new TypeError('verifyProof: proof.size must be a non-negative integer');
  }
  if (!Number.isInteger(proof.peakIndex) || proof.peakIndex < 0) {
    throw new TypeError('verifyProof: proof.peakIndex must be a non-negative integer');
  }
  if (!Array.isArray(proof.peaks) || proof.peaks.length === 0) {
    throw new TypeError('verifyProof: proof.peaks must be a non-empty array');
  }
  if (proof.peakIndex >= proof.peaks.length) {
    throw new TypeError('verifyProof: proof.peakIndex out of range for proof.peaks');
  }
  for (const p of proof.peaks) {
    if (typeof p !== 'string' || !HEX64_RE.test(p)) {
      throw new TypeError('verifyProof: every entry of proof.peaks must be a 64-character hexadecimal string');
    }
  }
  if (!Array.isArray(proof.siblings)) {
    throw new TypeError('verifyProof: proof.siblings must be an array');
  }
  for (const sib of proof.siblings) {
    if (sib === null || typeof sib !== 'object') {
      throw new TypeError('verifyProof: every entry of proof.siblings must be an object');
    }
    if (typeof sib.hash !== 'string' || !HEX64_RE.test(sib.hash)) {
      throw new TypeError('verifyProof: every sibling hash must be a 64-character hexadecimal string');
    }
    if (sib.position !== 'left' && sib.position !== 'right') {
      throw new TypeError('verifyProof: every sibling position must be "left" or "right"');
    }
  }
}

module.exports = { MerkleMountainRange };
