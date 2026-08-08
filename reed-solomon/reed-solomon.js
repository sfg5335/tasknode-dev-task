'use strict';

// Deterministic systematic Reed-Solomon erasure coding over GF(256), using
// the primitive polynomial 0x11d (x^8 + x^4 + x^3 + x^2 + 1). Dependency-free.
//
// encode(dataShards, parityCount):
//   - dataShards: an array of at least one Uint8Array, all of equal length
//     (the "shard length"; may be 0).
//   - parityCount: a positive integer. dataShards.length + parityCount must
//     not exceed 255 (the number of distinct nonzero GF(256) elements
//     available as Vandermonde-matrix evaluation points -- see below).
//   Returns a fresh array of (dataShards.length + parityCount) Uint8Array
//   shards: the first dataShards.length are exact copies of the input data
//   shards (the coding is "systematic" -- data passes through unchanged),
//   followed by parityCount newly computed parity shards. Never mutates
//   dataShards or any shard inside it.
//
// reconstruct(shards, dataShardCount):
//   - shards: an array produced by (conceptually) a matching encode() call,
//     where each entry is either a Uint8Array (a surviving shard) or a
//     missing-shard marker (null or undefined, an "erasure"). At least
//     dataShardCount of the entries must be present Uint8Arrays, all of
//     equal length.
//   - dataShardCount: the number of *data* shards in the original encode()
//     call (a positive integer, strictly less than shards.length).
//   Returns a fresh array of shards.length Uint8Array: every originally
//   present shard is returned as an exact copy of its input value, and
//   every originally missing shard (data OR parity) is recovered and
//   returned as a freshly computed Uint8Array of the correct value. Throws
//   RangeError if fewer than dataShardCount shards survived (too many
//   erasures to recover). Never mutates shards or any surviving shard.
//
// Algorithm
// ---------
// A systematic encoding matrix is built once per (n, k) pair (n = total
// shard count, k = dataShardCount), purely as a function of n and k:
//
//   1. A Vandermonde matrix V (n rows x k columns) is built with
//      V[r][c] = (r+1)^c in GF(256), for r = 0..n-1, c = 0..k-1 -- using
//      evaluation points 1..n (all distinct nonzero GF(256) elements,
//      since the caller-enforced constraint n <= 255 guarantees there are
//      enough of them). Any square submatrix of a Vandermonde matrix built
//      from distinct evaluation points is invertible: its determinant is
//      the classical Vandermonde determinant, a nonzero product of
//      pairwise differences of the (distinct) evaluation points used by
//      its rows.
//   2. The top k x k submatrix Vtop (V's rows 0..k-1) is inverted via
//      Gauss-Jordan elimination over GF(256) (Vtop is itself a k x k
//      Vandermonde matrix on distinct points, hence invertible by the same
//      argument).
//   3. EncodeMatrix = V * Vtop^-1 (n x k). By construction, the top k rows
//      of EncodeMatrix equal Vtop * Vtop^-1 = the k x k identity matrix --
//      this is exactly what "systematic" means (data shards are literally
//      reproduced unencoded). Right-multiplying every row of V by the same
//      invertible k x k matrix Vtop^-1 preserves *which sets of rows are
//      linearly independent* (if a set of rows of V is invertible as a
//      matrix, the same set of rows of V*Vtop^-1 is invertible too, since
//      it differs only by that fixed invertible right-multiplication) --
//      so ANY k rows chosen from EncodeMatrix's n rows still form an
//      invertible k x k matrix.
//
// That last property is exactly what makes recovery from any k surviving
// shards possible: encoding is conceptually `allShards = EncodeMatrix *
// data` (applied independently at every byte position). Given any k
// surviving shards' values, inverting the corresponding k x k submatrix of
// EncodeMatrix and multiplying it by those k values recovers `data`
// exactly, from which every other row (shard, including any other missing
// one) can then be recomputed via EncodeMatrix * data.

// ---------------------------------------------------------------------------
// GF(256) arithmetic, via log/antilog tables built from the primitive
// polynomial 0x11d.

const GF_EXP = new Uint8Array(512); // extended past 255 so gfMul needs no modulo
const GF_LOG = new Uint8Array(256);

(function buildGfTables() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255];
  }
})();

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function gfInv(a) {
  // Caller-internal helper; only ever invoked on pivot values already
  // proven nonzero by the Gauss-Jordan elimination logic below.
  return GF_EXP[255 - GF_LOG[a]];
}

// ---------------------------------------------------------------------------
// GF(256) matrix helpers. Matrices are represented as arrays of Uint8Array
// rows.

// Inverts a `size x size` GF(256) matrix via Gauss-Jordan elimination on the
// augmented [matrix | identity] form. Never mutates `matrix`. Throws
// (internal invariant violation, not a user-facing input error) if the
// matrix turns out to be singular -- this should never happen for the
// Vandermonde-derived submatrices this module builds.
function invertMatrix(matrix, size) {
  const aug = new Array(size);
  for (let r = 0; r < size; r++) {
    const row = new Uint8Array(size * 2);
    row.set(matrix[r], 0);
    row[size + r] = 1;
    aug[r] = row;
  }

  for (let col = 0; col < size; col++) {
    let pivot = -1;
    for (let r = col; r < size; r++) {
      if (aug[r][col] !== 0) {
        pivot = r;
        break;
      }
    }
    if (pivot === -1) {
      throw new Error('internal invariant violated: attempted to invert a singular matrix');
    }
    if (pivot !== col) {
      const tmp = aug[pivot];
      aug[pivot] = aug[col];
      aug[col] = tmp;
    }

    const pivotRow = aug[col];
    const pivotVal = pivotRow[col];
    if (pivotVal !== 1) {
      const inv = gfInv(pivotVal);
      for (let c = 0; c < size * 2; c++) {
        pivotRow[c] = gfMul(pivotRow[c], inv);
      }
    }

    for (let r = 0; r < size; r++) {
      if (r === col) continue;
      const factor = aug[r][col];
      if (factor === 0) continue;
      const row = aug[r];
      for (let c = 0; c < size * 2; c++) {
        row[c] ^= gfMul(pivotRow[c], factor);
      }
    }
  }

  const inverse = new Array(size);
  for (let r = 0; r < size; r++) {
    inverse[r] = aug[r].slice(size, size * 2);
  }
  return inverse;
}

// Builds the n x k systematic Reed-Solomon encoding matrix described above.
// Purely a function of (n, k); called identically by encode() and
// reconstruct() so both always agree on the same matrix.
function buildEncodeMatrix(n, k) {
  const v = new Array(n);
  for (let r = 0; r < n; r++) {
    const row = new Uint8Array(k);
    const base = r + 1; // evaluation points 1..n: distinct nonzero GF(256) elements
    let acc = 1; // base^0
    for (let c = 0; c < k; c++) {
      row[c] = acc;
      acc = gfMul(acc, base);
    }
    v[r] = row;
  }

  const vTop = v.slice(0, k);
  const vTopInv = invertMatrix(vTop, k);

  const encodeMatrix = new Array(n);
  for (let r = 0; r < n; r++) {
    const row = new Uint8Array(k);
    for (let c = 0; c < k; c++) {
      let acc = 0;
      for (let m = 0; m < k; m++) {
        acc ^= gfMul(v[r][m], vTopInv[m][c]);
      }
      row[c] = acc;
    }
    encodeMatrix[r] = row;
  }
  return encodeMatrix;
}

// ---------------------------------------------------------------------------
// Input validation.

function describe(value) {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'number' && Number.isNaN(value)) return 'NaN';
  if (Array.isArray(value)) return `Array(${value.length})`;
  if (value instanceof Uint8Array) return `Uint8Array(${value.length})`;
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') {
    return String(value);
  }
  return typeof value;
}

function isUint8Array(value) {
  return value instanceof Uint8Array;
}

function validateEncodeInputs(dataShards, parityCount) {
  if (!Array.isArray(dataShards)) {
    throw new TypeError(`dataShards must be an array, got ${describe(dataShards)}`);
  }
  if (dataShards.length === 0) {
    throw new RangeError('dataShards must contain at least one shard');
  }
  dataShards.forEach((shard, i) => {
    if (!isUint8Array(shard)) {
      throw new TypeError(`dataShards[${i}] must be a Uint8Array, got ${describe(shard)}`);
    }
  });
  const shardLength = dataShards[0].length;
  dataShards.forEach((shard, i) => {
    if (shard.length !== shardLength) {
      throw new RangeError(
        `dataShards[${i}] has length ${shard.length}, expected ${shardLength} ` +
          '(all data shards must have equal length)'
      );
    }
  });
  if (!(typeof parityCount === 'number' && Number.isInteger(parityCount))) {
    throw new TypeError(`parityCount must be an integer, got ${describe(parityCount)}`);
  }
  if (parityCount < 1) {
    throw new RangeError(`parityCount must be at least 1, got ${parityCount}`);
  }
  const total = dataShards.length + parityCount;
  if (total > 255) {
    throw new RangeError(
      `dataShards.length + parityCount (= ${total}) must not exceed 255 total shards`
    );
  }
}

function validateReconstructInputs(shards, dataShardCount) {
  if (!Array.isArray(shards)) {
    throw new TypeError(`shards must be an array, got ${describe(shards)}`);
  }
  if (!(typeof dataShardCount === 'number' && Number.isInteger(dataShardCount))) {
    throw new TypeError(`dataShardCount must be an integer, got ${describe(dataShardCount)}`);
  }
  if (dataShardCount < 1) {
    throw new RangeError(`dataShardCount must be at least 1, got ${dataShardCount}`);
  }
  if (shards.length <= dataShardCount) {
    throw new RangeError(
      `shards.length (${shards.length}) must be greater than dataShardCount ` +
        `(${dataShardCount}) -- at least one parity shard slot is required`
    );
  }
  if (shards.length > 255) {
    throw new RangeError(`shards.length (${shards.length}) must not exceed 255`);
  }
  shards.forEach((shard, i) => {
    if (shard !== null && shard !== undefined && !isUint8Array(shard)) {
      throw new TypeError(
        `shards[${i}] must be a Uint8Array, or null/undefined for a missing shard, got ${describe(shard)}`
      );
    }
  });
  const presentIndices = [];
  shards.forEach((shard, i) => {
    if (shard !== null && shard !== undefined) presentIndices.push(i);
  });
  if (presentIndices.length < dataShardCount) {
    throw new RangeError(
      `only ${presentIndices.length} shard(s) survived but reconstruction requires at ` +
        `least dataShardCount=${dataShardCount}; too many erasures to recover`
    );
  }
  const shardLength = shards[presentIndices[0]].length;
  presentIndices.forEach((i) => {
    if (shards[i].length !== shardLength) {
      throw new RangeError(
        `shards[${i}] has length ${shards[i].length}, expected ${shardLength} ` +
          '(all surviving shards must have equal length)'
      );
    }
  });
}

// ---------------------------------------------------------------------------
// Public API.

function encode(dataShards, parityCount) {
  validateEncodeInputs(dataShards, parityCount);
  const k = dataShards.length;
  const n = k + parityCount;
  const shardLength = dataShards[0].length;
  const matrix = buildEncodeMatrix(n, k);

  const result = new Array(n);
  for (let c = 0; c < k; c++) {
    result[c] = Uint8Array.from(dataShards[c]);
  }
  for (let r = k; r < n; r++) {
    const row = matrix[r];
    const shard = new Uint8Array(shardLength);
    for (let t = 0; t < shardLength; t++) {
      let acc = 0;
      for (let c = 0; c < k; c++) {
        acc ^= gfMul(row[c], dataShards[c][t]);
      }
      shard[t] = acc;
    }
    result[r] = shard;
  }
  return result;
}

function reconstruct(shards, dataShardCount) {
  validateReconstructInputs(shards, dataShardCount);
  const n = shards.length;
  const k = dataShardCount;

  const presentIndices = [];
  const missingIndices = [];
  for (let i = 0; i < n; i++) {
    if (shards[i] === null || shards[i] === undefined) {
      missingIndices.push(i);
    } else {
      presentIndices.push(i);
    }
  }

  const result = new Array(n);
  for (const i of presentIndices) {
    result[i] = Uint8Array.from(shards[i]);
  }
  if (missingIndices.length === 0) {
    return result;
  }

  const shardLength = shards[presentIndices[0]].length;
  const matrix = buildEncodeMatrix(n, k);

  const chosen = presentIndices.slice(0, k);
  const subMatrix = chosen.map((i) => matrix[i]);
  const subInverse = invertMatrix(subMatrix, k);

  const dataShards = new Array(k);
  for (let c = 0; c < k; c++) dataShards[c] = new Uint8Array(shardLength);

  const value = new Uint8Array(k);
  for (let t = 0; t < shardLength; t++) {
    for (let i = 0; i < k; i++) value[i] = shards[chosen[i]][t];
    for (let c = 0; c < k; c++) {
      let acc = 0;
      const invRow = subInverse[c];
      for (let i = 0; i < k; i++) {
        acc ^= gfMul(invRow[i], value[i]);
      }
      dataShards[c][t] = acc;
    }
  }

  for (const m of missingIndices) {
    if (m < k) {
      result[m] = dataShards[m];
      continue;
    }
    const row = matrix[m];
    const shard = new Uint8Array(shardLength);
    for (let t = 0; t < shardLength; t++) {
      let acc = 0;
      for (let c = 0; c < k; c++) {
        acc ^= gfMul(row[c], dataShards[c][t]);
      }
      shard[t] = acc;
    }
    result[m] = shard;
  }

  return result;
}

module.exports = { encode, reconstruct };
