'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PersistentSegmentTree } = require('./persistent-segment-tree.js');

/** Direct O(n) reference sum over a plain array, for cross-checking. */
function refSum(arr, left, right) {
  let total = 0;
  for (let i = left; i <= right; i++) total += arr[i];
  return total;
}

function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

test('construction: version 0 exactly represents the input array', () => {
  const t = new PersistentSegmentTree([1, 2, 3, 4, 5]);
  assert.equal(t.length, 5);
  assert.equal(t.versionCount, 1);
  assert.equal(t.query(0, 0, 4), 15);
  assert.equal(t.query(0, 1, 3), 9);
  assert.equal(t.query(0, 0, 0), 1);
  assert.equal(t.query(0, 4, 4), 5);
});

test('empty input: length 0, one version, any query or update is out of range', () => {
  const t = new PersistentSegmentTree([]);
  assert.equal(t.length, 0);
  assert.equal(t.versionCount, 1);
  assert.throws(() => t.query(0, 0, 0), RangeError);
  assert.throws(() => t.update(0, 0, 1), RangeError);
});

test('singleton input: full-range query and update work at the one valid index', () => {
  const t = new PersistentSegmentTree([42]);
  assert.equal(t.length, 1);
  assert.equal(t.query(0, 0, 0), 42);
  const v1 = t.update(0, 0, 7);
  assert.equal(t.query(v1, 0, 0), 7);
  assert.equal(t.query(0, 0, 0), 42, 'version 0 must be untouched by the update');
});

test('update returns the new version number, and versionCount tracks it exactly', () => {
  const t = new PersistentSegmentTree([1, 2, 3]);
  assert.equal(t.versionCount, 1);
  const v1 = t.update(0, 0, 10);
  assert.equal(v1, 1);
  assert.equal(t.versionCount, 2);
  const v2 = t.update(v1, 1, 20);
  assert.equal(v2, 2);
  assert.equal(t.versionCount, 3);
});

test('branching updates: two versions built from the same base version are independent', () => {
  const t = new PersistentSegmentTree([1, 2, 3, 4, 5]);
  const v1 = t.update(0, 2, 100); // branch A from v0
  const v2 = t.update(0, 0, 999); // branch B, also from v0 (not from v1)
  assert.equal(t.query(0, 0, 4), 15, 'v0 unaffected by either branch');
  assert.equal(t.query(v1, 0, 4), 1 + 2 + 100 + 4 + 5);
  assert.equal(t.query(v2, 0, 4), 999 + 2 + 3 + 4 + 5);
  // Branch A never had index 0 touched; branch B never had index 2 touched.
  assert.equal(t.query(v1, 0, 0), 1);
  assert.equal(t.query(v2, 2, 2), 3);
});

test('unchanged historical versions: a chain of updates leaves every earlier version intact', () => {
  const t = new PersistentSegmentTree([0, 0, 0, 0]);
  const versions = [0];
  for (let i = 0; i < 4; i++) {
    versions.push(t.update(versions[versions.length - 1], i, i + 1));
  }
  // versions: [0]=[0,0,0,0], [1]=[1,0,0,0], [2]=[1,2,0,0], [3]=[1,2,3,0], [4]=[1,2,3,4]
  assert.equal(t.query(versions[0], 0, 3), 0);
  assert.equal(t.query(versions[1], 0, 3), 1);
  assert.equal(t.query(versions[2], 0, 3), 3);
  assert.equal(t.query(versions[3], 0, 3), 6);
  assert.equal(t.query(versions[4], 0, 3), 10);
  // Re-check version 0 again after all four updates -- still all zeros.
  assert.equal(t.query(versions[0], 0, 0), 0);
  assert.equal(t.query(versions[0], 3, 3), 0);
});

test('boundary ranges: single-element ranges at both ends and the full range', () => {
  const t = new PersistentSegmentTree([10, 20, 30, 40, 50]);
  assert.equal(t.query(0, 0, 0), 10);
  assert.equal(t.query(0, 4, 4), 50);
  assert.equal(t.query(0, 0, 4), 150);
  assert.equal(t.query(0, 3, 4), 90);
  assert.equal(t.query(0, 0, 1), 30);
});

test('negative and fractional values are summed correctly', () => {
  const t = new PersistentSegmentTree([-5, 2.5, -1.5, 4]);
  assert.equal(t.query(0, 0, 3), -5 + 2.5 - 1.5 + 4);
  const v1 = t.update(0, 0, -100.25);
  assert.equal(t.query(v1, 0, 1), -100.25 + 2.5);
  assert.equal(t.query(0, 0, 1), -5 + 2.5, 'original version unaffected');
});

test('repeated queries return the same result every time (no mutation from querying)', () => {
  const t = new PersistentSegmentTree([1, 2, 3, 4, 5, 6, 7]);
  const first = t.query(0, 1, 5);
  const second = t.query(0, 1, 5);
  const third = t.query(0, 1, 5);
  assert.equal(first, second);
  assert.equal(second, third);
  assert.equal(first, 2 + 3 + 4 + 5 + 6);
});

test('does not mutate or retain the caller\'s input array', () => {
  const input = Object.freeze([1, 2, 3, 4]);
  assert.doesNotThrow(() => new PersistentSegmentTree(input));
  const t = new PersistentSegmentTree(input);
  assert.equal(t.query(0, 0, 3), 10);
  // Mutating a fresh copy afterward must not affect the tree (proves the
  // constructor copied values into leaves rather than referencing the array).
  const mutable = [1, 2, 3, 4];
  const t2 = new PersistentSegmentTree(mutable);
  mutable[0] = 999;
  assert.equal(t2.query(0, 0, 3), 10, 'tree must be unaffected by later mutation of the source array');
});

test('invalid constructor inputs throw TypeError', () => {
  assert.throws(() => new PersistentSegmentTree('not-an-array'), TypeError);
  assert.throws(() => new PersistentSegmentTree(null), TypeError);
  assert.throws(() => new PersistentSegmentTree(undefined), TypeError);
  assert.throws(() => new PersistentSegmentTree([1, 2, NaN]), TypeError);
  assert.throws(() => new PersistentSegmentTree([1, Infinity]), TypeError);
  assert.throws(() => new PersistentSegmentTree([1, -Infinity]), TypeError);
  assert.throws(() => new PersistentSegmentTree([1, '2']), TypeError);
  assert.throws(() => new PersistentSegmentTree([1, null]), TypeError);
  assert.throws(() => new PersistentSegmentTree([1, undefined]), TypeError);
  assert.throws(() => new PersistentSegmentTree([1, {}]), TypeError);
});

test('invalid update() arguments throw the appropriate error type', () => {
  const t = new PersistentSegmentTree([1, 2, 3]);
  // version: wrong type -> TypeError; out of range -> RangeError.
  assert.throws(() => t.update('0', 0, 1), TypeError);
  assert.throws(() => t.update(0.5, 0, 1), TypeError);
  assert.throws(() => t.update(NaN, 0, 1), TypeError);
  assert.throws(() => t.update(-1, 0, 1), RangeError);
  assert.throws(() => t.update(1, 0, 1), RangeError, 'version 1 does not exist yet');
  // index: wrong type -> TypeError; out of range -> RangeError.
  assert.throws(() => t.update(0, '0', 1), TypeError);
  assert.throws(() => t.update(0, 1.5, 1), TypeError);
  assert.throws(() => t.update(0, -1, 1), RangeError);
  assert.throws(() => t.update(0, 3, 1), RangeError, 'length is 3, so index 3 is out of range');
  // value: wrong type -> TypeError.
  assert.throws(() => t.update(0, 0, '5'), TypeError);
  assert.throws(() => t.update(0, 0, NaN), TypeError);
  assert.throws(() => t.update(0, 0, Infinity), TypeError);
  assert.throws(() => t.update(0, 0, -Infinity), TypeError);
  assert.throws(() => t.update(0, 0, null), TypeError);
  assert.throws(() => t.update(0, 0, undefined), TypeError);
  // A failed update must not create a new version.
  assert.equal(t.versionCount, 1);
});

test('invalid query() arguments throw the appropriate error type', () => {
  const t = new PersistentSegmentTree([1, 2, 3, 4]);
  assert.throws(() => t.query('0', 0, 1), TypeError);
  assert.throws(() => t.query(0.5, 0, 1), TypeError);
  assert.throws(() => t.query(1, 0, 1), RangeError, 'only version 0 exists');
  assert.throws(() => t.query(0, '0', 1), TypeError);
  assert.throws(() => t.query(0, 0, '1'), TypeError);
  assert.throws(() => t.query(0, 1.5, 2), TypeError);
  assert.throws(() => t.query(0, 0, 2.5), TypeError);
  assert.throws(() => t.query(0, -1, 2), RangeError);
  assert.throws(() => t.query(0, 0, 4), RangeError, 'length is 4, so right=4 is out of range');
  assert.throws(() => t.query(0, 3, 1), RangeError, 'left must be <= right');
});

test('fixed multi-version sequence, checked at every step against plain-array shadows', () => {
  const initial = [3, 1, 4, 1, 5, 9, 2, 6];
  const t = new PersistentSegmentTree(initial);
  // shadows[v] is the plain-array ground truth for version v.
  const shadows = [initial.slice()];

  function checkVersion(v) {
    const arr = shadows[v];
    for (let l = 0; l < arr.length; l++) {
      for (let r = l; r < arr.length; r++) {
        assert.equal(t.query(v, l, r), refSum(arr, l, r), `version ${v}, range [${l}, ${r}]`);
      }
    }
  }

  checkVersion(0);

  // A fixed, hand-specified branching sequence: base version, index, value.
  const ops = [
    [0, 0, 100], // v1, branches from v0
    [0, 7, -50], // v2, also branches from v0
    [1, 3, 42], // v3, branches from v1
    [2, 2, 0], // v4, branches from v2
    [3, 3, 7], // v5, branches from v3 (overwrites the same index again)
    [4, 0, -1], // v6, branches from v4
    [0, 4, 999], // v7, yet another branch straight from v0
  ];

  for (const [base, index, value] of ops) {
    const newVersion = t.update(base, index, value);
    const newShadow = shadows[base].slice();
    newShadow[index] = value;
    shadows[newVersion] = newShadow;
    assert.equal(newVersion, shadows.length - 1);
    checkVersion(newVersion);
  }

  // Re-verify every version once more at the end, to confirm nothing before
  // it was disturbed by any of the later branching updates.
  for (let v = 0; v < shadows.length; v++) checkVersion(v);
  assert.equal(t.versionCount, shadows.length);
});

test('randomized cross-check against a plain-array reference model (fixed seed)', () => {
  const n = 12;
  const initial = Array.from({ length: n }, (_, i) => i - 5);
  const t = new PersistentSegmentTree(initial);
  const shadows = [initial.slice()];

  const rng = makeRng(20260807);
  const OPS = 500;
  for (let step = 0; step < OPS; step++) {
    const base = Math.floor(rng() * shadows.length);
    const index = Math.floor(rng() * n);
    const value = Math.round((rng() * 200 - 100) * 4) / 4; // quarter-increments, avoids float noise
    const newVersion = t.update(base, index, value);
    const newShadow = shadows[base].slice();
    newShadow[index] = value;
    shadows[newVersion] = newShadow;
    assert.equal(newVersion, step + 1);

    // Spot-check a handful of random ranges on the just-created version and
    // on a random earlier version, every step.
    for (let c = 0; c < 3; c++) {
      const v = Math.floor(rng() * shadows.length);
      const l = Math.floor(rng() * n);
      const r = l + Math.floor(rng() * (n - l));
      assert.equal(t.query(v, l, r), refSum(shadows[v], l, r), `step ${step}, version ${v}, [${l},${r}]`);
    }
  }

  // Final full sweep: every version, every range.
  for (let v = 0; v < shadows.length; v++) {
    for (let l = 0; l < n; l++) {
      for (let r = l; r < n; r++) {
        assert.equal(t.query(v, l, r), refSum(shadows[v], l, r), `final sweep, version ${v}, [${l},${r}]`);
      }
    }
  }
  assert.equal(t.versionCount, OPS + 1);
});
