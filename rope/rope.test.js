'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Rope, checkInvariants } = require('./rope.js');

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

const CHARS = 'abcdefghij 😀🙂 xyz';
function randomText(rand, maxLen) {
  const len = Math.floor(rand() * (maxLen + 1));
  let s = '';
  for (let i = 0; i < len; i++) s += CHARS[Math.floor(rand() * CHARS.length)];
  return s;
}

// ---- empty and boundary operations ----

test('an empty rope has length 0 and stringifies to the empty string', () => {
  const r = new Rope();
  assert.equal(r.length, 0);
  assert.equal(r.toString(), '');
  assert.equal(new Rope('').length, 0);
});

test('inserting into an empty rope, at index 0, works', () => {
  const r = new Rope();
  r.insert(0, 'hello');
  assert.equal(r.toString(), 'hello');
  assert.equal(r.length, 5);
});

test('inserting at index === length appends at the end', () => {
  const r = new Rope('abc');
  r.insert(3, 'def');
  assert.equal(r.toString(), 'abcdef');
});

test('inserting an empty string is a harmless no-op', () => {
  const r = new Rope('abc');
  r.insert(1, '');
  assert.equal(r.toString(), 'abc');
});

test('delete with start === end is a harmless empty-range no-op', () => {
  const r = new Rope('abcdef');
  r.delete(3, 3);
  assert.equal(r.toString(), 'abcdef');
});

test('delete(0, length) empties the rope', () => {
  const r = new Rope('abcdef');
  r.delete(0, r.length);
  assert.equal(r.toString(), '');
  assert.equal(r.length, 0);
});

test('substring with start === end returns the empty string', () => {
  const r = new Rope('abcdef');
  assert.equal(r.substring(2, 2), '');
});

test('substring(0, length) returns the whole content', () => {
  const r = new Rope('abcdef');
  assert.equal(r.substring(0, r.length), 'abcdef');
});

test('charAt at the first and last valid indexes', () => {
  const r = new Rope('abc');
  assert.equal(r.charAt(0), 'a');
  assert.equal(r.charAt(2), 'c');
});

// ---- cross-node edits (operations that must span multiple leaves/nodes) ----

test('substring spanning multiple leaves built up via separate inserts', () => {
  const r = new Rope('');
  r.insert(0, 'aaa').insert(3, 'bbb').insert(6, 'ccc').insert(9, 'ddd');
  assert.equal(r.toString(), 'aaabbbcccddd');
  assert.equal(r.substring(2, 8), 'abbbcc');
  assert.equal(r.substring(0, 12), 'aaabbbcccddd');
  checkInvariants(r);
});

test('insert into the middle of a multi-node rope, splitting an existing leaf', () => {
  const r = new Rope('');
  r.insert(0, 'aaaa').insert(4, 'bbbb').insert(8, 'cccc');
  r.insert(6, 'XY'); // lands in the middle of the 'bbbb' leaf
  assert.equal(r.toString(), 'aaaabbXYbbcccc');
  checkInvariants(r);
});

test('delete spanning multiple leaves removes exactly the requested range', () => {
  const r = new Rope('');
  r.insert(0, 'aaaa').insert(4, 'bbbb').insert(8, 'cccc').insert(12, 'dddd');
  r.delete(3, 13); // spans the end of 'aaaa' through most of 'cccc'
  assert.equal(r.toString(), 'aaaddd');
  checkInvariants(r);
});

test('charAt across a node boundary resolves to the correct leaf', () => {
  const r = new Rope('');
  r.insert(0, 'abc').insert(3, 'def');
  assert.equal(r.charAt(2), 'c'); // last char of first leaf
  assert.equal(r.charAt(3), 'd'); // first char of second leaf
});

// ---- Unicode code-unit behavior ----

test('length and indexing use UTF-16 code units, not code points (surrogate pairs count as 2)', () => {
  const s = 'a😀b'; // 😀 is a surrogate pair -- native length is 4
  const r = new Rope(s);
  assert.equal(r.length, s.length);
  assert.equal(r.length, 4);
  for (let i = 0; i < s.length; i++) {
    assert.equal(r.charAt(i), s[i], `charAt(${i})`);
  }
});

test('substring can split a surrogate pair, matching native string slicing exactly', () => {
  const s = 'a😀b';
  const r = new Rope(s);
  for (let start = 0; start <= s.length; start++) {
    for (let end = start; end <= s.length; end++) {
      assert.equal(r.substring(start, end), s.slice(start, end), `[${start},${end})`);
    }
  }
});

test('inserting text containing a surrogate pair across a node boundary preserves it intact', () => {
  const r = new Rope('');
  r.insert(0, 'abc').insert(3, 'def');
  r.insert(3, '😀'); // inserted exactly at the leaf boundary
  assert.equal(r.toString(), 'abc😀def');
  assert.equal(r.length, 'abc😀def'.length);
  checkInvariants(r);
});

// ---- chaining ----

test('insert and delete both return `this`, enabling method chaining', () => {
  const r = new Rope('');
  const result = r.insert(0, 'a').insert(1, 'b').delete(0, 1).insert(1, 'c');
  assert.equal(result, r);
  assert.equal(r.toString(), 'bc');
});

// ---- invalid inputs ----

test('constructor rejects a non-string initial value', () => {
  assert.throws(() => new Rope(5), TypeError);
  assert.throws(() => new Rope(null), TypeError);
  assert.throws(() => new Rope(['a']), TypeError);
  assert.doesNotThrow(() => new Rope());
  assert.doesNotThrow(() => new Rope('ok'));
});

test('insert rejects non-string text with TypeError', () => {
  const r = new Rope('abc');
  assert.throws(() => r.insert(0, 5), TypeError);
  assert.throws(() => r.insert(0, null), TypeError);
  assert.throws(() => r.insert(0, ['x']), TypeError);
});

test('insert rejects a non-integer index with TypeError', () => {
  const r = new Rope('abc');
  assert.throws(() => r.insert(1.5, 'x'), TypeError);
  assert.throws(() => r.insert('1', 'x'), TypeError);
  assert.throws(() => r.insert(NaN, 'x'), TypeError);
});

test('insert rejects an out-of-range index with RangeError', () => {
  const r = new Rope('abc');
  assert.throws(() => r.insert(-1, 'x'), RangeError);
  assert.throws(() => r.insert(4, 'x'), RangeError);
  assert.doesNotThrow(() => r.insert(3, 'x')); // index === length is valid
});

test('delete and substring reject non-integer start/end with TypeError', () => {
  const r = new Rope('abcdef');
  for (const method of ['delete', 'substring']) {
    assert.throws(() => r[method](1.5, 3), TypeError, `${method} start`);
    assert.throws(() => r[method](1, 3.5), TypeError, `${method} end`);
    assert.throws(() => r[method]('1', 3), TypeError, `${method} start type`);
  }
});

test('delete and substring reject reversed (start > end) ranges with RangeError', () => {
  const r = new Rope('abcdef');
  assert.throws(() => r.delete(4, 2), RangeError);
  assert.throws(() => r.substring(4, 2), RangeError);
  assert.doesNotThrow(() => r.substring(3, 3)); // equal is fine, not reversed
});

test('delete and substring reject out-of-range start/end with RangeError', () => {
  const r = new Rope('abcdef');
  for (const method of ['delete', 'substring']) {
    assert.throws(() => r[method](-1, 3), RangeError, `${method} negative start`);
    assert.throws(() => r[method](0, 100), RangeError, `${method} end beyond length`);
  }
});

test('charAt rejects a non-integer index with TypeError', () => {
  const r = new Rope('abc');
  assert.throws(() => r.charAt(1.5), TypeError);
  assert.throws(() => r.charAt('1'), TypeError);
});

test('charAt rejects an out-of-range index with RangeError, including index === length', () => {
  const r = new Rope('abc');
  assert.throws(() => r.charAt(-1), RangeError);
  assert.throws(() => r.charAt(3), RangeError); // length itself is NOT a valid charAt index
  assert.throws(() => r.charAt(100), RangeError);
  assert.doesNotThrow(() => r.charAt(2));
});

test('checkInvariants rejects a non-Rope argument with TypeError', () => {
  assert.throws(() => checkInvariants('not a rope'), TypeError);
  assert.throws(() => checkInvariants({}), TypeError);
  assert.throws(() => checkInvariants(null), TypeError);
});

// ---- AVL metadata ----

test('checkInvariants passes on a freshly constructed rope of any size', () => {
  assert.doesNotThrow(() => checkInvariants(new Rope('')));
  assert.doesNotThrow(() => checkInvariants(new Rope('x')));
  assert.doesNotThrow(() => checkInvariants(new Rope('a fairly long initial string of text')));
});

test('5,000 sequential single-character appends stay logarithmic height (no degenerate linked-list tree)', () => {
  const r = new Rope('');
  for (let i = 0; i < 5000; i++) r.insert(r.length, 'x');
  assert.equal(r.length, 5000);
  assert.doesNotThrow(() => checkInvariants(r), 'AVL balance must be maintained after many sequential appends');
});

test('5,000 sequential single-character prepends also stay balanced', () => {
  const r = new Rope('');
  for (let i = 0; i < 5000; i++) r.insert(0, 'x');
  assert.equal(r.length, 5000);
  assert.doesNotThrow(() => checkInvariants(r));
});

test('checkInvariants catches a hand-corrupted cached length', () => {
  const r = new Rope('');
  r.insert(0, 'aaaa').insert(4, 'bbbb');
  r._root.length += 1; // corrupt the cache directly
  assert.throws(() => checkInvariants(r), /length cache mismatch/);
});

test('checkInvariants catches a hand-corrupted cached height', () => {
  const r = new Rope('');
  r.insert(0, 'aaaa').insert(4, 'bbbb');
  r._root.height += 5; // corrupt the cache directly
  assert.throws(() => checkInvariants(r), /height cache mismatch/);
});

test('checkInvariants catches an artificially unbalanced tree', () => {
  const r = new Rope('a');
  // Build a deliberately degenerate right-leaning chain by hand,
  // bypassing the balanced insert/delete API entirely.
  let root = r._root;
  for (let i = 0; i < 10; i++) {
    root = { isLeaf: false, str: null, left: null, right: root, length: 0, height: 0 };
    root.length = (root.left ? root.left.length : 0) + root.right.length;
    root.height = 1 + Math.max(root.left ? root.left.height : 0, root.right.height);
  }
  r._root = root;
  assert.throws(() => checkInvariants(r), /AVL balance violated/);
});

// ---- adversarial edits ----

test('adversarial alternating prepend/append with interleaved deletes stays correct and balanced', () => {
  const rand = mulberry32(555);
  let native = '';
  const r = new Rope('');
  for (let i = 0; i < 3000; i++) {
    if (rand() < 0.5) {
      const text = randomText(rand, 4);
      r.insert(0, text);
      native = text + native;
    } else {
      const text = randomText(rand, 4);
      r.insert(r.length, text);
      native = native + text;
    }
    if (i % 7 === 0 && native.length > 10) {
      const a = Math.floor(rand() * native.length);
      const b = Math.floor(rand() * native.length);
      const start = Math.min(a, b);
      const end = Math.max(a, b);
      r.delete(start, end);
      native = native.slice(0, start) + native.slice(end);
    }
  }
  assert.equal(r.toString(), native);
  assert.equal(r.length, native.length);
  assert.doesNotThrow(() => checkInvariants(r));
});

test('adversarial repeated middle-insertion-then-deletion at the same position stays correct', () => {
  const r = new Rope('0123456789');
  let native = '0123456789';
  for (let i = 0; i < 500; i++) {
    r.insert(5, 'XYZ');
    native = native.slice(0, 5) + 'XYZ' + native.slice(5);
    r.delete(5, 8);
    native = native.slice(0, 5) + native.slice(8);
  }
  assert.equal(r.toString(), native);
  assert.doesNotThrow(() => checkInvariants(r));
});

// ---- seeded differential sequence against native strings ----

test('fixed-seed differential test against a native string, starting empty', () => {
  const rand = mulberry32(20260808);

  function runTrial(opCount, initial) {
    const rope = new Rope(initial);
    let native = initial;
    for (let i = 0; i < opCount; i++) {
      assert.equal(rope.length, native.length, `trial length mismatch at op ${i}`);
      assert.equal(rope.toString(), native, `trial toString mismatch at op ${i}`);
      checkInvariants(rope);

      const op = Math.floor(rand() * 4);
      if (op === 0) {
        const idx = Math.floor(rand() * (native.length + 1));
        const text = randomText(rand, 6);
        rope.insert(idx, text);
        native = native.slice(0, idx) + text + native.slice(idx);
      } else if (op === 1) {
        if (native.length === 0) continue;
        const a = Math.floor(rand() * (native.length + 1));
        const b = Math.floor(rand() * (native.length + 1));
        const start = Math.min(a, b);
        const end = Math.max(a, b);
        rope.delete(start, end);
        native = native.slice(0, start) + native.slice(end);
      } else if (op === 2) {
        const a = Math.floor(rand() * (native.length + 1));
        const b = Math.floor(rand() * (native.length + 1));
        const start = Math.min(a, b);
        const end = Math.max(a, b);
        assert.equal(rope.substring(start, end), native.slice(start, end), `substring(${start},${end}) at op ${i}`);
      } else {
        if (native.length === 0) continue;
        const idx = Math.floor(rand() * native.length);
        assert.equal(rope.charAt(idx), native[idx], `charAt(${idx}) at op ${i}`);
      }
    }
  }

  for (let t = 0; t < 40; t++) runTrial(150, '');
});

test('fixed-seed differential test against a native string, starting from random nonempty content', () => {
  const rand = mulberry32(9988);

  function runTrial(opCount, initial) {
    const rope = new Rope(initial);
    let native = initial;
    for (let i = 0; i < opCount; i++) {
      assert.equal(rope.length, native.length);
      assert.equal(rope.toString(), native);

      const op = Math.floor(rand() * 4);
      if (op === 0) {
        const idx = Math.floor(rand() * (native.length + 1));
        const text = randomText(rand, 6);
        rope.insert(idx, text);
        native = native.slice(0, idx) + text + native.slice(idx);
      } else if (op === 1) {
        if (native.length === 0) continue;
        const a = Math.floor(rand() * (native.length + 1));
        const b = Math.floor(rand() * (native.length + 1));
        const start = Math.min(a, b);
        const end = Math.max(a, b);
        rope.delete(start, end);
        native = native.slice(0, start) + native.slice(end);
      } else if (op === 2) {
        const a = Math.floor(rand() * (native.length + 1));
        const b = Math.floor(rand() * (native.length + 1));
        const start = Math.min(a, b);
        const end = Math.max(a, b);
        assert.equal(rope.substring(start, end), native.slice(start, end));
      } else {
        if (native.length === 0) continue;
        const idx = Math.floor(rand() * native.length);
        assert.equal(rope.charAt(idx), native[idx]);
      }
    }
    checkInvariants(rope);
  }

  for (let t = 0; t < 20; t++) runTrial(400, randomText(rand, 50));
});
