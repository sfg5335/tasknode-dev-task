'use strict';

// Dependency-free, sentinel-free (bzip2-style) Burrows-Wheeler Transform
// over raw bytes.
//
// encodeBWT(input) sorts all n cyclic rotations of `input` (no appended
// end-of-string marker) and returns the transform's last column plus a
// "primary index" recording which sorted row holds the original,
// unrotated string -- this primary index is what makes the transform
// invertible without a sentinel byte.
//
// The rotations are sorted via prefix doubling (Manber-Myers-style rank
// doubling, adapted to circular strings): starting from single-byte
// ranks, each round compares 2x as much of the rotation as the previous
// round by pairing each rotation's current rank with the current rank of
// the rotation starting `k` positions later (wrapping around), until the
// comparison length covers the whole string -- this fully orders any two
// distinct rotations in O(log n) rounds without ever materializing the
// full n x n rotation matrix. Rotations that remain tied even at full
// length (only possible for periodic/constant input, where two distinct
// starting positions produce the literal same cyclic byte sequence) are
// broken by starting index, ascending.

function checkBytes(value, name) {
  if (!(value instanceof Uint8Array)) {
    throw new TypeError(`${name} must be a Buffer or Uint8Array`);
  }
}

// One round of prefix-doubling rank refinement. `rank` holds each
// rotation's current equivalence class (same rank = identical for every
// byte compared so far). Returns the next round's rank array, where two
// indices share a rank iff their (rank[i], rank[(i+k) mod n]) pairs are
// identical -- i.e. iff the rotations starting at those indices are
// identical for the next `2*k` bytes.
function refineRanks(rank, k, n) {
  const order = Array.from({ length: n }, (_, i) => i);
  const keyOf = (i) => [rank[i], rank[(i + k) % n]];
  order.sort((a, b) => {
    const ka = keyOf(a);
    const kb = keyOf(b);
    if (ka[0] !== kb[0]) return ka[0] - kb[0];
    if (ka[1] !== kb[1]) return ka[1] - kb[1];
    return a - b; // deterministic tie-break for sort stability only
  });

  const newRank = new Array(n);
  newRank[order[0]] = 0;
  for (let j = 1; j < n; j++) {
    const prev = order[j - 1];
    const cur = order[j];
    const samePair = rank[prev] === rank[cur] && rank[(prev + k) % n] === rank[(cur + k) % n];
    newRank[cur] = samePair ? newRank[prev] : newRank[prev] + 1;
  }
  return newRank;
}

// Sorts all n cyclic rotations of a byte sequence (given as a plain
// array of byte values, length n >= 2) and returns the sorted array of
// starting indices, using full prefix doubling followed by a final
// index-tie-broken sort (needed for genuinely periodic/constant input,
// where rank alone can never fully distinguish two different starting
// positions).
function sortRotations(bytes, n) {
  let rank = bytes.slice();
  for (let k = 1; k < n; k *= 2) {
    rank = refineRanks(rank, k, n);
    // Every rotation already in its own equivalence class: no further
    // round can change the order, so stop early.
    if (rank[rank.length - 1] === n - 1 && new Set(rank).size === n) break;
  }
  const order = Array.from({ length: n }, (_, i) => i);
  order.sort((a, b) => {
    if (rank[a] !== rank[b]) return rank[a] - rank[b];
    return a - b; // final, explicit "break equal rotations by starting index"
  });
  return order;
}

// Encodes `input` (a Buffer or Uint8Array) via the sentinel-free
// Burrows-Wheeler Transform. Returns `{ lastColumn, primaryIndex }`
// where `lastColumn` is a freshly allocated Buffer of the same length as
// `input`, and `primaryIndex` is the 0-based row (in the conceptual
// sorted rotation matrix) holding the original, unrotated string.
// `input` is never mutated.
function encodeBWT(input) {
  checkBytes(input, 'input');
  const n = input.length;

  if (n === 0) {
    return { lastColumn: Buffer.alloc(0), primaryIndex: 0 };
  }
  if (n === 1) {
    return { lastColumn: Buffer.from(input), primaryIndex: 0 };
  }

  const bytes = Array.from(input);
  const order = sortRotations(bytes, n);

  const lastColumn = Buffer.alloc(n);
  let primaryIndex = -1;
  for (let row = 0; row < n; row++) {
    const start = order[row];
    lastColumn[row] = bytes[(start - 1 + n) % n];
    if (start === 0) primaryIndex = row;
  }

  return { lastColumn, primaryIndex };
}

// Decodes `lastColumn` (a Buffer or Uint8Array, the BWT's last column)
// plus its `primaryIndex` back to the original byte sequence, returning
// a freshly allocated Buffer. `lastColumn` is never mutated.
function decodeBWT(lastColumn, primaryIndex) {
  checkBytes(lastColumn, 'lastColumn');
  const n = lastColumn.length;

  if (!Number.isInteger(primaryIndex)) {
    throw new TypeError('primaryIndex must be an integer');
  }
  if (n === 0) {
    if (primaryIndex !== 0) {
      throw new RangeError('primaryIndex must be 0 for empty data');
    }
    return Buffer.alloc(0);
  }
  if (primaryIndex < 0 || primaryIndex >= n) {
    throw new RangeError(`primaryIndex must be in [0, ${n}), got ${primaryIndex}`);
  }

  // Cumulative count table: cumulative[c] = number of bytes in
  // lastColumn strictly less than byte value c -- i.e. the row at which
  // byte value c's block would begin in the (never explicitly built)
  // sorted first column.
  const count = new Array(256).fill(0);
  for (let i = 0; i < n; i++) count[lastColumn[i]]++;
  const cumulative = new Array(256);
  let total = 0;
  for (let c = 0; c < 256; c++) {
    cumulative[c] = total;
    total += count[c];
  }

  // Occurrence rank: occRank[i] = how many times lastColumn[i]'s byte
  // value has appeared in lastColumn[0..i], inclusive (1-indexed).
  const seen = new Array(256).fill(0);
  const occRank = new Array(n);
  for (let i = 0; i < n; i++) {
    const b = lastColumn[i];
    seen[b]++;
    occRank[i] = seen[b];
  }

  // LF mapping: next[i] is the row (in the sorted rotation matrix) whose
  // first column holds this same occurrence of this same byte value --
  // i.e. the row obtained by moving row i's last character to the
  // front.
  const next = new Array(n);
  for (let i = 0; i < n; i++) {
    next[i] = cumulative[lastColumn[i]] + occRank[i] - 1;
  }

  // Walking `next` starting from primaryIndex regenerates the original
  // string one character per step, from the last character back to the
  // first.
  const result = Buffer.alloc(n);
  let row = primaryIndex;
  for (let i = n - 1; i >= 0; i--) {
    result[i] = lastColumn[row];
    row = next[row];
  }
  return result;
}

module.exports = { encodeBWT, decodeBWT };
