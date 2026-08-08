'use strict';

/**
 * Dependency-free, single-file, deterministic canonical Huffman byte codec
 * (`encode`/`decode`) for arbitrary `Uint8Array` byte streams, in
 * JavaScript (ES module), with an automated `node:test` suite.
 *
 * encode(data)
 *   `data` must be a `Uint8Array` (`TypeError` otherwise). Returns a new
 *   `Uint8Array` in the `CHUF` format described below. Never mutates
 *   `data`. Encoding the same input twice always produces byte-identical
 *   output (see Determinism below).
 *
 * decode(bytes)
 *   `bytes` must be a `Uint8Array` (`TypeError` otherwise). Returns a new
 *   `Uint8Array` containing the original decoded data, or throws
 *   `RangeError` if `bytes` is not a well-formed `CHUF` stream (bad
 *   magic, truncated header, a code-length table that doesn't form a
 *   valid prefix code, a payload that runs out of bits before every
 *   symbol is decoded, non-zero padding bits, or unexpected trailing
 *   bytes). Never mutates `bytes`.
 *
 * ## The `CHUF` byte format
 *
 *   Offset  Size        Contents
 *   0       4 bytes     Magic: ASCII "CHUF" (0x43 0x48 0x55 0x46)
 *   4       4 bytes     Original data length, 32-bit big-endian unsigned
 *   8       256 bytes   Code-length table: one byte per possible symbol
 *                       (0-255), giving that symbol's canonical Huffman
 *                       code length, or 0 if the symbol never appears
 *   264     variable    Payload: the Huffman-encoded bits of the
 *                       original data, packed MSB-first (the most
 *                       significant bit of each payload byte is the
 *                       earliest bit), zero-padded at the end to the
 *                       next whole byte
 *
 * ## Building the code-length table (encode side)
 *
 * Symbol frequencies are counted over `data`, then combined into a
 * Huffman tree by always merging the two lowest-weight nodes, exactly
 * like the textbook algorithm -- except node selection is fully
 * deterministic: nodes are ordered by `(weight, minSymbol)`, where
 * `minSymbol` is the smallest original byte value contained anywhere in
 * that node's subtree (a leaf's `minSymbol` is just its own symbol).
 * Since every currently-alive node's `minSymbol` is unique (each of the
 * up to 256 symbols belongs to exactly one live node at a time), this
 * pair is already a strict total order -- there is never an actual tie
 * left for e.g. insertion order to break, so the merge sequence for a
 * given frequency table is exactly reproducible every time. Only the
 * resulting *lengths* are read off the tree (as each leaf's depth); the
 * tree's own left/right bit assignment is discarded, because...
 *
 * ## Canonical code assignment (both encode and decode side)
 *
 * ...actual code bit-patterns are assigned afterward by the standard
 * *canonical* Huffman algorithm, a pure function of the length table
 * alone: symbols are grouped by length, and within each length ordered
 * by ascending symbol value; a running `code` value starts at 0, and for
 * each length from 1 up to the maximum, `code` is first doubled (a left
 * shift), then each symbol at that length is assigned the current
 * `code` value in ascending symbol order, incrementing `code` after
 * each assignment. This is exactly why decode can independently
 * reconstruct the same bit patterns encode used, from the length table
 * alone -- and why two structurally different trees that happen to
 * produce the same *lengths* always produce identical final codes.
 *
 * Because canonical code values can in principle require more than 32
 * bits (a maximally skewed 256-symbol Huffman tree can reach a code
 * length of up to 255), code values are tracked as `BigInt` throughout
 * -- never as plain JS numbers -- so correctness never silently
 * degrades for deeply skewed inputs the way a 32-bit-only
 * implementation's bit-shifts would.
 *
 * ## The single-symbol special case
 *
 * A Huffman tree needs at least two leaves to have any internal merge
 * step at all. When `data` contains exactly one distinct byte value,
 * that symbol is given the conventional code length 1 (a single bit,
 * always "0") directly, bypassing tree construction -- the decoder
 * never needs to distinguish it from anything else, since the header's
 * declared original length alone says exactly how many copies to
 * produce. This is the one legitimate case where the resulting "tree"
 * is intentionally incomplete (the "1" branch is simply never used);
 * `decode` validates that this specific, narrow case (exactly one
 * present symbol, at length exactly 1) is the *only* form of
 * incompleteness it will accept -- any other malformed/incomplete
 * length table is rejected.
 *
 * ## Determinism
 *
 * Encoding is fully deterministic end to end: frequency counting is
 * order-independent, tree construction's merge order is a strict total
 * order (see above, no real ties), and canonical code assignment is a
 * pure function of the length table. Two calls to `encode` with
 * identical input bytes always produce byte-identical output.
 */

const MAGIC = [0x43, 0x48, 0x55, 0x46]; // "CHUF"
const NUM_SYMBOLS = 256;
const HEADER_SIZE = 4 + 4 + NUM_SYMBOLS; // magic + original length + table

function checkUint8Array(value, name) {
  if (!(value instanceof Uint8Array)) {
    throw new TypeError(`${name} must be a Uint8Array`);
  }
}

// --- Huffman length construction (encode side only) --------------------

// Builds a Uint8Array(256) of canonical Huffman code lengths (0 = symbol
// absent) from a 256-entry frequency array, using deterministic
// (weight, minSymbol) merge ordering.
function buildLengths(freq) {
  const present = [];
  for (let s = 0; s < NUM_SYMBOLS; s++) {
    if (freq[s] > 0) present.push(s);
  }

  const lengths = new Uint8Array(NUM_SYMBOLS);

  if (present.length === 0) {
    return lengths;
  }
  if (present.length === 1) {
    lengths[present[0]] = 1;
    return lengths;
  }

  let nodes = present.map((s) => ({
    weight: freq[s],
    minSymbol: s,
    left: null,
    right: null,
    symbol: s,
  }));

  while (nodes.length > 1) {
    nodes.sort((a, b) => (a.weight !== b.weight ? a.weight - b.weight : a.minSymbol - b.minSymbol));
    const a = nodes.shift();
    const b = nodes.shift();
    nodes.push({
      weight: a.weight + b.weight,
      minSymbol: Math.min(a.minSymbol, b.minSymbol),
      left: a,
      right: b,
      symbol: -1,
    });
  }

  const root = nodes[0];
  (function walk(node, depth) {
    if (node.symbol !== -1) {
      lengths[node.symbol] = depth;
      return;
    }
    walk(node.left, depth + 1);
    walk(node.right, depth + 1);
  })(root, 0);

  return lengths;
}

// --- Canonical code assignment (shared by encode and decode) -----------

// Pure function of `lengths` (a 256-entry array-like of code lengths,
// 0 = absent). Returns { codes, maxLen, presentCount, overflowed,
// complete }: `codes` maps symbol -> { length, code: BigInt }.
// `overflowed` is true if some length has more symbols assigned to it
// than fit in the available code space at that length (an impossible,
// corrupt table). `complete` is true if the assigned codes exactly fill
// the code space at maxLen (a valid, decodable multi-symbol tree).
function assignCanonicalCodes(lengths) {
  const symbolsByLength = new Array(NUM_SYMBOLS + 1);
  for (let i = 0; i <= NUM_SYMBOLS; i++) symbolsByLength[i] = [];

  let maxLen = 0;
  let presentCount = 0;
  for (let s = 0; s < NUM_SYMBOLS; s++) {
    const len = lengths[s];
    if (len > 0) {
      symbolsByLength[len].push(s);
      if (len > maxLen) maxLen = len;
      presentCount++;
    }
  }

  const codes = new Map();
  let code = 0n;
  let overflowed = false;

  for (let len = 1; len <= maxLen; len++) {
    code <<= 1n;
    for (const s of symbolsByLength[len]) {
      codes.set(s, { length: len, code });
      code += 1n;
    }
    if (code > 1n << BigInt(len)) {
      overflowed = true;
      break;
    }
  }

  const complete = !overflowed && maxLen > 0 && code === 1n << BigInt(maxLen);

  return { codes, maxLen, presentCount, overflowed, complete };
}

// --- encode --------------------------------------------------------------

export function encode(data) {
  checkUint8Array(data, 'data');

  const freq = new Array(NUM_SYMBOLS).fill(0);
  for (let i = 0; i < data.length; i++) freq[data[i]]++;

  const lengths = buildLengths(freq);
  const { codes } = assignCanonicalCodes(lengths);

  let totalBits = 0n;
  for (let i = 0; i < data.length; i++) {
    totalBits += BigInt(codes.get(data[i]).length);
  }
  const payloadByteLen = Number((totalBits + 7n) / 8n);

  const out = new Uint8Array(HEADER_SIZE + payloadByteLen);
  out[0] = MAGIC[0];
  out[1] = MAGIC[1];
  out[2] = MAGIC[2];
  out[3] = MAGIC[3];

  const n = data.length;
  out[4] = (n >>> 24) & 0xff;
  out[5] = (n >>> 16) & 0xff;
  out[6] = (n >>> 8) & 0xff;
  out[7] = n & 0xff;

  out.set(lengths, 8);

  let bitPos = 0;
  const payloadStart = HEADER_SIZE;
  for (let i = 0; i < data.length; i++) {
    const { length, code } = codes.get(data[i]);
    for (let b = length - 1; b >= 0; b--) {
      const bit = (code >> BigInt(b)) & 1n;
      if (bit) {
        const byteIndex = payloadStart + (bitPos >> 3);
        out[byteIndex] |= 0x80 >> (bitPos & 7);
      }
      bitPos++;
    }
  }

  return out;
}

// --- decode --------------------------------------------------------------

export function decode(bytes) {
  checkUint8Array(bytes, 'bytes');

  if (bytes.length < HEADER_SIZE) {
    throw new RangeError('malformed stream: too short for header');
  }
  if (bytes[0] !== MAGIC[0] || bytes[1] !== MAGIC[1] || bytes[2] !== MAGIC[2] || bytes[3] !== MAGIC[3]) {
    throw new RangeError('malformed stream: bad magic (expected "CHUF")');
  }

  const originalLength = ((bytes[4] << 24) | (bytes[5] << 16) | (bytes[6] << 8) | bytes[7]) >>> 0;
  const lengths = bytes.slice(8, 8 + NUM_SYMBOLS);
  const payloadStart = HEADER_SIZE;

  if (originalLength === 0) {
    for (let s = 0; s < NUM_SYMBOLS; s++) {
      if (lengths[s] !== 0) {
        throw new RangeError('malformed stream: non-empty code-length table for zero-length payload');
      }
    }
    if (bytes.length !== payloadStart) {
      throw new RangeError('malformed stream: unexpected trailing bytes after empty payload');
    }
    return new Uint8Array(0);
  }

  const { codes, maxLen, presentCount, overflowed, complete } = assignCanonicalCodes(lengths);

  if (presentCount === 0) {
    throw new RangeError('malformed stream: empty code-length table but non-zero original length');
  }
  if (overflowed) {
    throw new RangeError('malformed stream: code-length table does not form a valid prefix code (overflow)');
  }
  if (presentCount === 1) {
    const entry = codes.values().next().value;
    if (entry.length !== 1) {
      throw new RangeError('malformed stream: a single-symbol code-length table must use length 1');
    }
  } else if (!complete) {
    throw new RangeError('malformed stream: code-length table is not a complete prefix code');
  }

  const decodeMap = new Map();
  for (const [symbol, { length, code }] of codes) {
    decodeMap.set(`${length}:${code}`, symbol);
  }

  const payloadBits = (bytes.length - payloadStart) * 8;
  if (originalLength > payloadBits) {
    throw new RangeError('malformed stream: declared original length exceeds available payload bits');
  }

  const result = new Uint8Array(originalLength);
  let bitPos = 0;

  for (let outIdx = 0; outIdx < originalLength; outIdx++) {
    let curLen = 0;
    let curCode = 0n;
    let matched = false;
    while (!matched) {
      if (bitPos >= payloadBits) {
        throw new RangeError('malformed stream: payload ended before all symbols were decoded');
      }
      const byteIndex = payloadStart + (bitPos >> 3);
      const bit = (bytes[byteIndex] >> (7 - (bitPos & 7))) & 1;
      curCode = (curCode << 1n) | BigInt(bit);
      curLen++;
      bitPos++;

      if (curLen > maxLen) {
        throw new RangeError('malformed stream: payload bits do not match any known code');
      }
      const key = `${curLen}:${curCode}`;
      if (decodeMap.has(key)) {
        result[outIdx] = decodeMap.get(key);
        matched = true;
      }
    }
  }

  const expectedPayloadByteLen = Math.ceil(bitPos / 8);
  if (bytes.length - payloadStart !== expectedPayloadByteLen) {
    throw new RangeError('malformed stream: unexpected trailing bytes after payload');
  }
  for (let i = bitPos; i < expectedPayloadByteLen * 8; i++) {
    const byteIndex = payloadStart + (i >> 3);
    const bit = (bytes[byteIndex] >> (7 - (i & 7))) & 1;
    if (bit !== 0) {
      throw new RangeError('malformed stream: non-zero padding bits');
    }
  }

  return result;
}
