import test from 'node:test';
import assert from 'node:assert/strict';
import { myersDiff } from './myers-diff.mjs';

// Reconstructs `after` from the ops (equal + insert values, in order).
function reconstructAfter(ops) {
  return ops.filter((o) => o.type !== 'delete').map((o) => o.value);
}

// Reconstructs `before` from the ops (equal + delete values, in order).
function reconstructBefore(ops) {
  return ops.filter((o) => o.type !== 'insert').map((o) => o.value);
}

function editCount(ops) {
  return ops.filter((o) => o.type !== 'equal').length;
}

test('rejects non-array inputs with TypeError', () => {
  assert.throws(() => myersDiff('ab', ['a']), TypeError);
  assert.throws(() => myersDiff(['a'], 'ab'), TypeError);
  assert.throws(() => myersDiff(null, []), TypeError);
  assert.throws(() => myersDiff([], undefined), TypeError);
  assert.throws(() => myersDiff({ length: 0 }, []), TypeError);
  assert.throws(() => myersDiff(), TypeError);
});

test('both empty arrays: no operations', () => {
  assert.deepEqual(myersDiff([], []), []);
});

test('identical non-empty arrays: all equal operations, in order', () => {
  const ops = myersDiff([1, 2, 3], [1, 2, 3]);
  assert.deepEqual(ops, [
    { type: 'equal', value: 1 },
    { type: 'equal', value: 2 },
    { type: 'equal', value: 3 },
  ]);
});

test('pure insertion: before empty, after non-empty', () => {
  const ops = myersDiff([], ['a', 'b']);
  assert.deepEqual(ops, [
    { type: 'insert', value: 'a' },
    { type: 'insert', value: 'b' },
  ]);
});

test('pure deletion: before non-empty, after empty', () => {
  const ops = myersDiff(['a', 'b'], []);
  assert.deepEqual(ops, [
    { type: 'delete', value: 'a' },
    { type: 'delete', value: 'b' },
  ]);
});

test('insertion in the middle of an otherwise-identical array', () => {
  const ops = myersDiff([1, 3], [1, 2, 3]);
  assert.deepEqual(ops, [
    { type: 'equal', value: 1 },
    { type: 'insert', value: 2 },
    { type: 'equal', value: 3 },
  ]);
  assert.deepEqual(reconstructAfter(ops), [1, 2, 3]);
  assert.deepEqual(reconstructBefore(ops), [1, 3]);
});

test('deletion in the middle of an otherwise-identical array', () => {
  const ops = myersDiff([1, 2, 3], [1, 3]);
  assert.deepEqual(ops, [
    { type: 'equal', value: 1 },
    { type: 'delete', value: 2 },
    { type: 'equal', value: 3 },
  ]);
});

test('replacement (mix of delete and insert) in the middle', () => {
  const ops = myersDiff(['a', 'b', 'c'], ['a', 'x', 'c']);
  assert.deepEqual(reconstructBefore(ops), ['a', 'b', 'c']);
  assert.deepEqual(reconstructAfter(ops), ['a', 'x', 'c']);
  assert.equal(editCount(ops), 2); // delete 'b', insert 'x' -- minimal
  assert.deepEqual(
    ops.filter((o) => o.type === 'equal').map((o) => o.value),
    ['a', 'c']
  );
});

test('completely disjoint arrays of the same length: no equal operations', () => {
  const ops = myersDiff(['a', 'b'], ['x', 'y']);
  assert.equal(ops.some((o) => o.type === 'equal'), false);
  assert.deepEqual(reconstructBefore(ops), ['a', 'b']);
  assert.deepEqual(reconstructAfter(ops), ['x', 'y']);
});

test('repeated values: minimal edit script accounts for multiplicity correctly', () => {
  // before has three 1s, after has two 1s -- exactly one deletion needed,
  // not a wholesale replacement.
  const ops = myersDiff([1, 1, 1], [1, 1]);
  assert.deepEqual(reconstructBefore(ops), [1, 1, 1]);
  assert.deepEqual(reconstructAfter(ops), [1, 1]);
  assert.equal(editCount(ops), 1);
  assert.equal(ops.filter((o) => o.type === 'delete').length, 1);
});

test('repeated values with an insertion: before has two 1s, after has three', () => {
  const ops = myersDiff([1, 1], [1, 1, 1]);
  assert.deepEqual(reconstructBefore(ops), [1, 1]);
  assert.deepEqual(reconstructAfter(ops), [1, 1, 1]);
  assert.equal(editCount(ops), 1);
  assert.equal(ops.filter((o) => o.type === 'insert').length, 1);
});

test('NaN is treated as equal to NaN (Object.is semantics, unlike ===)', () => {
  const ops = myersDiff([NaN], [NaN]);
  assert.deepEqual(ops, [{ type: 'equal', value: NaN }]);
  // Sanity check that this is actually exercising Object.is, not ===:
  assert.equal(NaN === NaN, false);
  assert.equal(Object.is(NaN, NaN), true);
});

test('NaN in a longer array with other equal elements', () => {
  const ops = myersDiff([1, NaN, 3], [1, NaN, 3]);
  assert.deepEqual(ops, [
    { type: 'equal', value: 1 },
    { type: 'equal', value: NaN },
    { type: 'equal', value: 3 },
  ]);
});

test('+0 and -0 are treated as NOT equal (Object.is semantics, unlike ===)', () => {
  const ops = myersDiff([0], [-0]);
  assert.deepEqual(ops, [
    { type: 'delete', value: 0 },
    { type: 'insert', value: -0 },
  ]);
  // Sanity check: this only makes sense because === would disagree.
  assert.equal(0 === -0, true);
  assert.equal(Object.is(0, -0), false);
});

test('-0 vs -0 and +0 vs +0 are each treated as equal', () => {
  assert.deepEqual(myersDiff([-0], [-0]), [{ type: 'equal', value: -0 }]);
  assert.deepEqual(myersDiff([0], [0]), [{ type: 'equal', value: 0 }]);
});

test('deterministic tie-breaking: prefers delete over insert when equal-cost paths exist', () => {
  // before=['x'], after=['y']: the only two elements are unequal, so any
  // valid edit script needs exactly one delete and one insert (2 edits,
  // both orders reconstruct correctly and cost the same). Hand-traced
  // against this implementation's V-array tie-break condition
  // (`v.get(k-1) < v.get(k+1)`, strict '<') to confirm it resolves to
  // performing the delete first.
  const ops = myersDiff(['x'], ['y']);
  assert.deepEqual(ops, [
    { type: 'delete', value: 'x' },
    { type: 'insert', value: 'y' },
  ]);
});

test('deterministic tie-breaking is stable across repeated calls (same inputs -> same output)', () => {
  const a = ['x', 1, 'z'];
  const b = ['y', 1, 'w'];
  const first = myersDiff(a, b);
  const second = myersDiff(a, b);
  const third = myersDiff(a, b);
  assert.deepEqual(first, second);
  assert.deepEqual(second, third);
});

test('does not mutate either input array', () => {
  const before = [1, 2, 3];
  const after = [1, 2, 3, 4];
  const beforeCopy = [...before];
  const afterCopy = [...after];
  myersDiff(before, after);
  assert.deepEqual(before, beforeCopy);
  assert.deepEqual(after, afterCopy);
  assert.equal(before.length, 3);
  assert.equal(after.length, 4);
});

test('reconstruction round-trip holds for a moderately long mixed-edit case', () => {
  const before = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  const after = ['a', 'x', 'c', 'd', 'y', 'f', 'z', 'g'];
  const ops = myersDiff(before, after);
  assert.deepEqual(reconstructBefore(ops), before);
  assert.deepEqual(reconstructAfter(ops), after);
});

// ---- Bounded seeded random cross-check against a simple DP oracle ----

// Simple O(n*m) dynamic-programming edit-distance oracle (insert/delete
// only, no substitution -- i.e. the same edit model as myersDiff),
// computed independently of the Myers algorithm above. Returns just the
// minimal edit COUNT, which is what the cross-check below compares.
function dpEditCountOracle(a, b) {
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 0; i <= n; i++) dp[i][0] = i;
  for (let j = 0; j <= m; j++) dp[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (Object.is(a[i - 1], b[j - 1])) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  return dp[n][m];
}

// Deterministic seeded PRNG (LCG) so the "random" cases are reproducible.
function makeRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

test('bounded seeded cross-check: reconstruction + edit count match a DP oracle', () => {
  const rng = makeRng(20260807);
  const alphabet = ['a', 'b', 'c', 'd', 0, -0, NaN];

  for (let trial = 0; trial < 200; trial++) {
    const beforeLen = Math.floor(rng() * 8);
    const afterLen = Math.floor(rng() * 8);
    const before = Array.from({ length: beforeLen }, () => alphabet[Math.floor(rng() * alphabet.length)]);
    const after = Array.from({ length: afterLen }, () => alphabet[Math.floor(rng() * alphabet.length)]);

    const ops = myersDiff(before, after);

    assert.deepEqual(reconstructBefore(ops), before, `trial ${trial}: before mismatch`);
    assert.deepEqual(reconstructAfter(ops), after, `trial ${trial}: after mismatch`);

    const expectedEditCount = dpEditCountOracle(before, after);
    assert.equal(editCount(ops), expectedEditCount, `trial ${trial}: edit count mismatch for before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
  }
});
