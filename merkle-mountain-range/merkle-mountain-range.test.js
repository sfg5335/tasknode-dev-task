'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { MerkleMountainRange } = require('./merkle-mountain-range.js');

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Independent "from scratch" root oracle: recursively splits each power-of
// -two chunk of leaves in half and re-derives its peak from nothing, rather
// than incrementally merging/carrying mountains the way the shipped
// implementation does. This is a genuinely different code path for the
// TREE-STRUCTURE bookkeeping (which leaves land in which mountain, in what
// order) -- the one part of this task that isn't fully pinned down by the
// task's own exact hash-format spec, and therefore the part worth
// differential-testing. The low-level hash formulas themselves (leaf/parent
// /bag/root) are reimplemented separately here rather than imported from the
// module under test, so a bug in the shipped hash helpers can't silently
// cancel out against this oracle.
// ---------------------------------------------------------------------------

function oracleLeafHash(bytes) {
  const h = crypto.createHash('sha256');
  h.update(Buffer.from([0x00]));
  const lenBuf = Buffer.alloc(8);
  lenBuf.writeBigUInt64BE(BigInt(bytes.length));
  h.update(lenBuf);
  h.update(Buffer.from(bytes));
  return h.digest('hex');
}

function oracleParentHash(leftHex, rightHex) {
  const h = crypto.createHash('sha256');
  h.update(Buffer.from([0x01]));
  h.update(Buffer.from(leftHex, 'hex'));
  h.update(Buffer.from(rightHex, 'hex'));
  return h.digest('hex');
}

function oracleBagHash(accHex, nextHex) {
  const h = crypto.createHash('sha256');
  h.update(Buffer.from([0x02]));
  h.update(Buffer.from(accHex, 'hex'));
  h.update(Buffer.from(nextHex, 'hex'));
  return h.digest('hex');
}

function oracleRootBind(size, baggedHex) {
  const h = crypto.createHash('sha256');
  h.update(Buffer.from([0x03]));
  const sizeBuf = Buffer.alloc(8);
  sizeBuf.writeBigUInt64BE(BigInt(size));
  h.update(sizeBuf);
  if (baggedHex !== null) h.update(Buffer.from(baggedHex, 'hex'));
  return h.digest('hex');
}

function oracleDecomposeSize(size) {
  const chunks = [];
  for (let bit = 31; bit >= 0; bit--) {
    const p = 1 << bit;
    if (size & p) chunks.push(p);
  }
  return chunks;
}

function oracleBuildPeak(leafHashesForChunk) {
  if (leafHashesForChunk.length === 1) return leafHashesForChunk[0];
  const mid = leafHashesForChunk.length / 2;
  const left = oracleBuildPeak(leafHashesForChunk.slice(0, mid));
  const right = oracleBuildPeak(leafHashesForChunk.slice(mid));
  return oracleParentHash(left, right);
}

function oracleRoot(payloads) {
  const size = payloads.length;
  if (size === 0) return oracleRootBind(0, null);
  const allLeafHashes = payloads.map(oracleLeafHash);
  const chunkSizes = oracleDecomposeSize(size);
  let offset = 0;
  const peaks = [];
  for (const cs of chunkSizes) {
    peaks.push(oracleBuildPeak(allLeafHashes.slice(offset, offset + cs)));
    offset += cs;
  }
  let acc = peaks[0];
  for (let i = 1; i < peaks.length; i++) acc = oracleBagHash(acc, peaks[i]);
  return oracleRootBind(size, acc);
}

function randomPayload(rand, maxLen) {
  const len = Math.floor(rand() * (maxLen + 1));
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = Math.floor(rand() * 256);
  return Buffer.from(bytes);
}

function flipHexChar(hexStr) {
  return (hexStr[0] === '0' ? '1' : '0') + hexStr.slice(1);
}

// =========================================================================
// Empty and single-leaf states
// =========================================================================

test('empty MMR has size 0 and a fixed, spec-defined empty root', () => {
  const mmr = new MerkleMountainRange();
  assert.equal(mmr.size, 0);
  assert.equal(mmr.root(), 'dc4c8669df128318c5790c414c870cc76c585268552851e78d3ee8604dbec0e3');
  assert.equal(mmr.root(), oracleRoot([]));
});

test('single-leaf MMR: proof has no siblings, round-trips through verifyProof', () => {
  const mmr = new MerkleMountainRange();
  const payload = Buffer.from('a');
  const index = mmr.append(payload);
  assert.equal(index, 0);
  assert.equal(mmr.size, 1);
  const proof = mmr.getProof(0);
  assert.deepEqual(proof.siblings, []);
  assert.equal(proof.peaks.length, 1);
  assert.equal(proof.peakIndex, 0);
  assert.equal(mmr.root(), oracleRoot([payload]));
  assert.equal(MerkleMountainRange.verifyProof(payload, proof, mmr.root()), true);
});

// =========================================================================
// Pinned regression vector (hand-computed once via node -e, hardcoded here)
// =========================================================================

test('pinned regression vector: appending "a","b","c" yields an exact known root', () => {
  const mmr = new MerkleMountainRange();
  mmr.append(Buffer.from('a'));
  mmr.append(Buffer.from('b'));
  mmr.append(Buffer.from('c'));
  assert.equal(mmr.size, 3);
  assert.equal(mmr.root(), '9c0e146ce9b9de969c31243796cadcb302e78fba4ba7b3e49512dd6f2dd51e92');
  const proof0 = mmr.getProof(0);
  assert.deepEqual(proof0, {
    index: 0,
    size: 3,
    siblings: [{ hash: 'c2603e20db4a933b8f13a4146907caa2c4cd6fe260b26030726366ba36567fca', position: 'right' }],
    peaks: [
      'b3a32b93b5455c27f25f0f12725bc8bd8a0232280102bb1227a941243bbebb2d',
      '0ef02dc9fc15836614060b801484509b9720b0a6c412c16b143f6538602891f6',
    ],
    peakIndex: 0,
  });
});

// =========================================================================
// Sizes crossing power-of-two boundaries; proofs for every leaf
// =========================================================================

test('sequential appends from 0 through 20 leaves: root matches the independent oracle at every size', () => {
  const mmr = new MerkleMountainRange();
  const payloads = [];
  for (let i = 0; i < 20; i++) {
    const payload = Buffer.from([i, (i * 3) % 256, (i * 7) % 256]);
    payloads.push(payload);
    mmr.append(payload);
    assert.equal(mmr.size, i + 1);
    assert.equal(mmr.root(), oracleRoot(payloads), `mismatch at size ${i + 1}`);
  }
});

test('every leaf produces a verifying proof, for several sizes crossing power-of-two boundaries', () => {
  for (const n of [1, 2, 3, 4, 5, 7, 8, 9, 15, 16, 17, 31, 32, 33]) {
    const mmr = new MerkleMountainRange();
    const payloads = [];
    for (let i = 0; i < n; i++) {
      const payload = Buffer.from(`leaf-${i}`);
      payloads.push(payload);
      mmr.append(payload);
    }
    const root = mmr.root();
    assert.equal(root, oracleRoot(payloads), `root mismatch at n=${n}`);

    const expectedPeakCount = oracleDecomposeSize(n).length;
    for (let i = 0; i < n; i++) {
      const proof = mmr.getProof(i);
      assert.equal(proof.peaks.length, expectedPeakCount, `n=${n}, leaf=${i}: unexpected peak count`);
      assert.equal(
        MerkleMountainRange.verifyProof(payloads[i], proof, root),
        true,
        `n=${n}, leaf=${i}: proof failed to verify`
      );
    }
  }
});

// =========================================================================
// Duplicate and binary payloads
// =========================================================================

test('duplicate-content leaves are distinguished by tree position, not by content', () => {
  const mmr = new MerkleMountainRange();
  const dup = Buffer.from('same-bytes');
  mmr.append(dup);
  mmr.append(dup);
  mmr.append(Buffer.from('different'));
  const root = mmr.root();
  const p0 = mmr.getProof(0);
  const p1 = mmr.getProof(1);
  // Leaf hashes for identical content are equal (expected -- the hash
  // formula has no positional salt), but each occurrence still produces a
  // structurally distinct, independently-verifying proof.
  assert.notDeepEqual(p0, p1);
  assert.equal(MerkleMountainRange.verifyProof(dup, p0, root), true);
  assert.equal(MerkleMountainRange.verifyProof(dup, p1, root), true);
});

test('binary payloads: zero bytes, high-bit bytes, and empty (0-length) payloads all work', () => {
  const mmr = new MerkleMountainRange();
  const payloads = [
    Buffer.from([0x00, 0x00, 0x00]),
    Buffer.from([0xff, 0xfe, 0xfd]),
    Buffer.from([0x00, 0xff, 0x80, 0x7f, 0x01]),
    Buffer.alloc(0),
  ];
  for (const p of payloads) mmr.append(p);
  const root = mmr.root();
  assert.equal(root, oracleRoot(payloads));
  for (let i = 0; i < payloads.length; i++) {
    assert.equal(MerkleMountainRange.verifyProof(payloads[i], mmr.getProof(i), root), true);
  }
});

// =========================================================================
// Deterministic roots
// =========================================================================

test('two independently built MMRs with the same append sequence produce byte-identical roots and proofs', () => {
  const rand = mulberry32(2026);
  const payloads = [];
  for (let i = 0; i < 25; i++) payloads.push(randomPayload(rand, 12));

  const mmrA = new MerkleMountainRange();
  const mmrB = new MerkleMountainRange();
  for (const p of payloads) {
    mmrA.append(Buffer.from(p));
    mmrB.append(Buffer.from(p));
  }
  assert.equal(mmrA.root(), mmrB.root());
  for (let i = 0; i < payloads.length; i++) {
    assert.deepEqual(mmrA.getProof(i), mmrB.getProof(i));
  }
});

test('calling getProof/root repeatedly for the same state returns byte-identical results', () => {
  const mmr = new MerkleMountainRange();
  for (let i = 0; i < 10; i++) mmr.append(Buffer.from(`x${i}`));
  const root1 = mmr.root();
  const root2 = mmr.root();
  assert.equal(root1, root2);
  const proof1 = mmr.getProof(4);
  const proof2 = mmr.getProof(4);
  assert.deepEqual(proof1, proof2);
});

// =========================================================================
// Mutation safety
// =========================================================================

test('mutating the bytes array after append() does not affect the stored leaf', () => {
  const mmr = new MerkleMountainRange();
  const bytes = Buffer.from([1, 2, 3]);
  mmr.append(bytes);
  const rootBefore = mmr.root();
  bytes[0] = 99;
  bytes[1] = 99;
  bytes[2] = 99;
  assert.equal(mmr.root(), rootBefore, 'mutating the caller-owned array after append must not change stored state');
  // The original (unmutated) content must still be provable.
  const proof = mmr.getProof(0);
  assert.equal(MerkleMountainRange.verifyProof(Buffer.from([1, 2, 3]), proof, rootBefore), true);
});

test('mutating a returned proof object does not corrupt the MMR internal state', () => {
  const mmr = new MerkleMountainRange();
  const payloads = [];
  for (let i = 0; i < 9; i++) {
    const p = Buffer.from(`p${i}`);
    payloads.push(p);
    mmr.append(p);
  }
  const rootBefore = mmr.root();
  const proof = mmr.getProof(5);
  proof.peaks.push('f'.repeat(64));
  proof.peaks[0] = 'a'.repeat(64);
  proof.siblings.push({ hash: 'b'.repeat(64), position: 'left' });
  proof.size = 999;
  proof.peakIndex = 999;

  assert.equal(mmr.root(), rootBefore, 'mutating a returned proof must not affect mmr.root()');
  const freshProof = mmr.getProof(5);
  assert.equal(MerkleMountainRange.verifyProof(payloads[5], freshProof, rootBefore), true);
});

test('verifyProof does not mutate the proof object or the bytes it is given', () => {
  const mmr = new MerkleMountainRange();
  const payloads = [];
  for (let i = 0; i < 9; i++) {
    const p = Buffer.from(`q${i}`);
    payloads.push(p);
    mmr.append(p);
  }
  const root = mmr.root();
  const proof = mmr.getProof(3);
  const proofSnapshot = JSON.parse(JSON.stringify(proof));
  const bytesSnapshot = Buffer.from(payloads[3]);

  MerkleMountainRange.verifyProof(payloads[3], proof, root);

  assert.deepEqual(proof, proofSnapshot, 'verifyProof must not mutate the proof it was given');
  assert.deepEqual(payloads[3], bytesSnapshot, 'verifyProof must not mutate the bytes it was given');
});

// =========================================================================
// Invalid inputs
// =========================================================================

test('append() rejects non-Uint8Array payloads with TypeError', () => {
  const mmr = new MerkleMountainRange();
  assert.throws(() => mmr.append('a string'), TypeError);
  assert.throws(() => mmr.append([1, 2, 3]), TypeError);
  assert.throws(() => mmr.append(null), TypeError);
  assert.throws(() => mmr.append(undefined), TypeError);
  assert.throws(() => mmr.append(42), TypeError);
  assert.throws(() => mmr.append({}), TypeError);
});

test('getProof() rejects non-integer indices with TypeError and out-of-range indices with RangeError', () => {
  const mmr = new MerkleMountainRange();
  for (let i = 0; i < 5; i++) mmr.append(Buffer.from(`i${i}`));
  assert.throws(() => mmr.getProof(1.5), TypeError);
  assert.throws(() => mmr.getProof('2'), TypeError);
  assert.throws(() => mmr.getProof(NaN), TypeError);
  assert.throws(() => mmr.getProof(null), TypeError);
  // Well-typed integers, but out of the [0, size) domain.
  assert.throws(() => mmr.getProof(-1), RangeError);
  assert.throws(() => mmr.getProof(5), RangeError);
  assert.throws(() => mmr.getProof(1000), RangeError);
});

test('getProof() on an empty MMR always throws RangeError (no valid index exists)', () => {
  const mmr = new MerkleMountainRange();
  assert.throws(() => mmr.getProof(0), RangeError);
});

test('verifyProof() rejects a non-Uint8Array bytes argument with TypeError', () => {
  const mmr = new MerkleMountainRange();
  mmr.append(Buffer.from('a'));
  const proof = mmr.getProof(0);
  const root = mmr.root();
  assert.throws(() => MerkleMountainRange.verifyProof('a', proof, root), TypeError);
  assert.throws(() => MerkleMountainRange.verifyProof(null, proof, root), TypeError);
});

test('verifyProof() rejects malformed proof shapes with TypeError, field by field', () => {
  const mmr = new MerkleMountainRange();
  const payloads = [];
  for (let i = 0; i < 9; i++) {
    const p = Buffer.from(`m${i}`);
    payloads.push(p);
    mmr.append(p);
  }
  const root = mmr.root();
  const goodProof = mmr.getProof(3);
  const bytes = payloads[3];

  assert.throws(() => MerkleMountainRange.verifyProof(bytes, null, root), TypeError);
  assert.throws(() => MerkleMountainRange.verifyProof(bytes, 'not an object', root), TypeError);
  assert.throws(() => MerkleMountainRange.verifyProof(bytes, {}, root), TypeError);
  assert.throws(() => MerkleMountainRange.verifyProof(bytes, { ...goodProof, size: -1 }, root), TypeError);
  assert.throws(() => MerkleMountainRange.verifyProof(bytes, { ...goodProof, size: 1.5 }, root), TypeError);
  assert.throws(() => MerkleMountainRange.verifyProof(bytes, { ...goodProof, peaks: [] }, root), TypeError);
  assert.throws(() => MerkleMountainRange.verifyProof(bytes, { ...goodProof, peaks: 'nope' }, root), TypeError);
  assert.throws(() => MerkleMountainRange.verifyProof(bytes, { ...goodProof, peaks: ['not-hex'] }, root), TypeError);
  assert.throws(
    () => MerkleMountainRange.verifyProof(bytes, { ...goodProof, peakIndex: goodProof.peaks.length + 5 }, root),
    TypeError
  );
  assert.throws(() => MerkleMountainRange.verifyProof(bytes, { ...goodProof, peakIndex: -1 }, root), TypeError);
  assert.throws(() => MerkleMountainRange.verifyProof(bytes, { ...goodProof, siblings: 'nope' }, root), TypeError);
  assert.throws(
    () => MerkleMountainRange.verifyProof(bytes, { ...goodProof, siblings: [{ hash: 'bad', position: 'left' }] }, root),
    TypeError
  );
  assert.throws(
    () =>
      MerkleMountainRange.verifyProof(
        bytes,
        { ...goodProof, siblings: [{ hash: 'a'.repeat(64), position: 'up' }] },
        root
      ),
    TypeError
  );
});

test('verifyProof() rejects a malformed expectedRoot with TypeError', () => {
  const mmr = new MerkleMountainRange();
  mmr.append(Buffer.from('a'));
  const proof = mmr.getProof(0);
  assert.throws(() => MerkleMountainRange.verifyProof(Buffer.from('a'), proof, 'not-hex'), TypeError);
  assert.throws(() => MerkleMountainRange.verifyProof(Buffer.from('a'), proof, 'aa'), TypeError);
  assert.throws(() => MerkleMountainRange.verifyProof(Buffer.from('a'), proof, 123), TypeError);
  assert.throws(() => MerkleMountainRange.verifyProof(Buffer.from('a'), proof, null), TypeError);
});

test('verifyProof() accepts an uppercase-hex expectedRoot as a case-insensitive match (documented leniency)', () => {
  const mmr = new MerkleMountainRange();
  mmr.append(Buffer.from('a'));
  const proof = mmr.getProof(0);
  const root = mmr.root();
  assert.equal(MerkleMountainRange.verifyProof(Buffer.from('a'), proof, root.toUpperCase()), true);
});

// =========================================================================
// Rejection of tampered leaves, paths, peaks, sizes, and roots
// =========================================================================

test('verifyProof() rejects a tampered leaf (wrong bytes)', () => {
  const mmr = new MerkleMountainRange();
  const payloads = [];
  for (let i = 0; i < 9; i++) {
    const p = Buffer.from(`t${i}`);
    payloads.push(p);
    mmr.append(p);
  }
  const root = mmr.root();
  const proof = mmr.getProof(4);
  assert.equal(MerkleMountainRange.verifyProof(Buffer.from('wrong-bytes'), proof, root), false);
});

test('verifyProof() rejects a tampered sibling hash in the path', () => {
  const mmr = new MerkleMountainRange();
  const payloads = [];
  for (let i = 0; i < 9; i++) {
    const p = Buffer.from(`s${i}`);
    payloads.push(p);
    mmr.append(p);
  }
  const root = mmr.root();
  const proof = mmr.getProof(4);
  assert.ok(proof.siblings.length > 0, 'test requires a leaf with at least one sibling in its path');
  proof.siblings[0] = { ...proof.siblings[0], hash: flipHexChar(proof.siblings[0].hash) };
  assert.equal(MerkleMountainRange.verifyProof(payloads[4], proof, root), false);
});

test('verifyProof() rejects a tampered peak belonging to a DIFFERENT mountain than the one being proven', () => {
  // Tampering the peak slot at proof.peakIndex itself is a documented no-op
  // (see below) since that slot is exactly what verifyProof recomputes and
  // overwrites -- so this test deliberately targets one of the OTHER
  // peaks, which genuinely feeds into the bagging computation.
  const mmr = new MerkleMountainRange();
  const payloads = [];
  for (let i = 0; i < 9; i++) {
    const p = Buffer.from(`u${i}`);
    payloads.push(p);
    mmr.append(p);
  }
  const root = mmr.root();
  const proof = mmr.getProof(3);
  assert.ok(proof.peaks.length >= 2, 'test requires a size with more than one mountain');
  const otherIndex = proof.peakIndex === 0 ? 1 : 0;
  proof.peaks[otherIndex] = flipHexChar(proof.peaks[otherIndex]);
  assert.equal(MerkleMountainRange.verifyProof(payloads[3], proof, root), false);
});

test("tampering the peak slot at the proof's OWN peakIndex is a documented no-op, not a security hole", () => {
  // verifyProof always overwrites peaksForFold[proof.peakIndex] with the
  // hash it just recomputed by climbing the sibling path -- so whatever
  // value originally sat in proof.peaks[proof.peakIndex] is never actually
  // read for verification purposes. This is standard, correct Merkle-proof
  // behavior (that slot is what's being PROVEN, not an independent input),
  // documented explicitly here so it is never mistaken for a missed
  // tamper-detection case.
  const mmr = new MerkleMountainRange();
  const payloads = [];
  for (let i = 0; i < 9; i++) {
    const p = Buffer.from(`v${i}`);
    payloads.push(p);
    mmr.append(p);
  }
  const root = mmr.root();
  const proof = mmr.getProof(3);
  proof.peaks[proof.peakIndex] = flipHexChar(proof.peaks[proof.peakIndex]);
  assert.equal(MerkleMountainRange.verifyProof(payloads[3], proof, root), true);
});

test('verifyProof() rejects a tampered size', () => {
  const mmr = new MerkleMountainRange();
  const payloads = [];
  for (let i = 0; i < 9; i++) {
    const p = Buffer.from(`w${i}`);
    payloads.push(p);
    mmr.append(p);
  }
  const root = mmr.root();
  const proof = mmr.getProof(4);
  proof.size += 1;
  assert.equal(MerkleMountainRange.verifyProof(payloads[4], proof, root), false);
});

test('verifyProof() rejects a tampered expectedRoot', () => {
  const mmr = new MerkleMountainRange();
  const payloads = [];
  for (let i = 0; i < 9; i++) {
    const p = Buffer.from(`y${i}`);
    payloads.push(p);
    mmr.append(p);
  }
  const root = mmr.root();
  const proof = mmr.getProof(4);
  const tamperedRoot = flipHexChar(root);
  assert.equal(MerkleMountainRange.verifyProof(payloads[4], proof, tamperedRoot), false);
});

// =========================================================================
// Randomized differential sweep against the independent oracle
// =========================================================================

test('randomized fixed-seed comparisons against the independent from-scratch oracle', () => {
  const rand = mulberry32(31415);
  for (let trial = 0; trial < 40; trial++) {
    const n = Math.floor(rand() * 40);
    const mmr = new MerkleMountainRange();
    const payloads = [];
    for (let i = 0; i < n; i++) {
      const p = randomPayload(rand, 20);
      payloads.push(p);
      mmr.append(Buffer.from(p));
    }
    assert.equal(mmr.root(), oracleRoot(payloads), `trial ${trial}, n=${n}`);
    if (n > 0) {
      const leafIndex = Math.floor(rand() * n);
      const proof = mmr.getProof(leafIndex);
      assert.equal(
        MerkleMountainRange.verifyProof(Buffer.from(payloads[leafIndex]), proof, mmr.root()),
        true,
        `trial ${trial}: leaf ${leafIndex} of ${n} failed to verify`
      );
    }
  }
});
