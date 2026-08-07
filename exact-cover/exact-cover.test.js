'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { solveExactCover } = require('./exact-cover.js');

// Deep-freezes an object/array tree so any attempted mutation throws
// immediately (in strict mode), rather than silently succeeding and only
// being caught by a before/after comparison.
function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

test('Knuth\'s classic exact-cover example has exactly one solution: {B, D, F}', () => {
  // Universe {1..7}; rows as in Knuth's "Dancing Links" paper.
  const columns = ['1', '2', '3', '4', '5', '6', '7'];
  const rows = [
    { id: 'A', cols: ['1', '4', '7'] },
    { id: 'B', cols: ['1', '4'] },
    { id: 'C', cols: ['4', '5', '7'] },
    { id: 'D', cols: ['3', '5', '6'] },
    { id: 'E', cols: ['2', '3', '6', '7'] },
    { id: 'F', cols: ['2', '7'] },
  ];
  const solutions = solveExactCover(columns, rows);
  assert.deepEqual(solutions, [['B', 'D', 'F']]);
});

test('empty columns and empty rows: the empty selection is the one trivial solution', () => {
  assert.deepEqual(solveExactCover([], []), [[]]);
});

test('empty columns with non-empty rows: still just the empty selection (no column ever needs covering)', () => {
  const solutions = solveExactCover([], [{ id: 'X', cols: [] }, { id: 'Y', cols: [] }]);
  assert.deepEqual(solutions, [[]]);
});

test('non-empty columns with zero rows: unsatisfiable, no solutions', () => {
  assert.deepEqual(solveExactCover(['1', '2'], []), []);
});

test('unsatisfiable: a column no row covers yields no solutions', () => {
  const columns = ['1', '2'];
  const rows = [{ id: 'A', cols: ['1'] }]; // nothing covers column '2'
  assert.deepEqual(solveExactCover(columns, rows), []);
});

test('single-solution case with extra unusable rows still finds exactly one solution', () => {
  const columns = ['1', '2', '3'];
  const rows = [
    { id: 'A', cols: ['1', '2'] },
    { id: 'B', cols: ['3'] },
    // C and D are distractors: each overlaps the correct pair (A, B) on one
    // column, AND overlaps each other on column '3', so no combination
    // involving C or D can ever complete a full exact cover -- {A, B} is
    // the only one. (Confirmed by tracing the real solver, not hand-derived:
    // a naive distractor pair that only overlaps A -- e.g. C: ['1'],
    // D: ['2'] -- would NOT be safe here: B, C, and D would then be
    // pairwise non-overlapping and jointly cover {1,2,3}, making {B,C,D} a
    // *second* valid exact cover alongside {A,B}.)
    { id: 'C', cols: ['1', '3'] },
    { id: 'D', cols: ['2', '3'] },
  ];
  assert.deepEqual(solveExactCover(columns, rows), [['A', 'B']]);
});

test('multiple-solution case: all valid exact covers are returned', () => {
  const columns = ['1', '2'];
  const rows = [
    { id: 'A', cols: ['1'] },
    { id: 'B', cols: ['2'] },
    { id: 'C', cols: ['1', '2'] },
  ];
  // {A,B} and {C} are the only two exact covers of {1,2} from these rows.
  const solutions = solveExactCover(columns, rows);
  assert.equal(solutions.length, 2);
  const asSets = solutions.map((s) => [...s].sort());
  assert.deepEqual(
    asSets.sort((a, b) => (a.join() < b.join() ? -1 : 1)),
    [['A', 'B'], ['C']]
  );
});

test('options.limit caps the number of solutions collected', () => {
  const columns = ['1', '2'];
  const rows = [
    { id: 'A', cols: ['1'] },
    { id: 'B', cols: ['2'] },
    { id: 'C', cols: ['1', '2'] },
  ];
  assert.equal(solveExactCover(columns, rows, { limit: 1 }).length, 1);
  assert.equal(solveExactCover(columns, rows, { limit: 2 }).length, 2);
  assert.equal(solveExactCover(columns, rows, { limit: Infinity }).length, 2);
  assert.equal(solveExactCover(columns, rows).length, 2, 'default limit must behave as Infinity');
});

test('options.limit is respected even across many candidate rows in a single column', () => {
  const columns = ['1'];
  const rows = Array.from({ length: 20 }, (_, i) => ({ id: `R${i}`, cols: ['1'] }));
  // Every single row alone is a full exact cover of {1}; there are 20 of them.
  assert.equal(solveExactCover(columns, rows).length, 20);
  assert.equal(solveExactCover(columns, rows, { limit: 5 }).length, 5);
  assert.equal(solveExactCover(columns, rows, { limit: 1 }).length, 1);
});

test('deterministic ordering: ties are broken by column input order, not by name/value', () => {
  // Two independent columns, each with two candidate single-column rows --
  // whichever column appears first in `columns` must be the one Algorithm X
  // branches on first, which is directly observable in the order rows are
  // selected within each returned solution.
  const rows = [
    { id: 'Z1', cols: ['z'] },
    { id: 'Z2', cols: ['z'] },
    { id: 'A1', cols: ['a'] },
    { id: 'A2', cols: ['a'] },
  ];

  const zFirst = solveExactCover(['z', 'a'], rows);
  assert.deepEqual(zFirst, [
    ['Z1', 'A1'],
    ['Z1', 'A2'],
    ['Z2', 'A1'],
    ['Z2', 'A2'],
  ]);

  const aFirst = solveExactCover(['a', 'z'], rows);
  assert.deepEqual(aFirst, [
    ['A1', 'Z1'],
    ['A1', 'Z2'],
    ['A2', 'Z1'],
    ['A2', 'Z2'],
  ]);
});

test('deterministic ordering: candidate rows within a column are tried in row input order', () => {
  const columns = ['1'];
  const rows = [
    { id: 'third', cols: ['1'] },
  ];
  // Reordering unrelated non-overlapping rows before/after must not change
  // anything about a single-row-per-solution case, but does prove ordering
  // for the multi-row-single-column case above; this test instead checks
  // that swapping row input order swaps solution order for a >1-row column.
  const rowsAB = [
    { id: 'first', cols: ['1'] },
    { id: 'second', cols: ['1'] },
  ];
  const rowsBA = [
    { id: 'second', cols: ['1'] },
    { id: 'first', cols: ['1'] },
  ];
  assert.deepEqual(solveExactCover(columns, rowsAB), [['first'], ['second']]);
  assert.deepEqual(solveExactCover(columns, rowsBA), [['second'], ['first']]);
  void rows; // (unused placeholder row set, kept out of the solved calls above)
});

test('repeated calls with the same inputs produce identical results every time', () => {
  const columns = ['1', '2', '3', '4', '5', '6', '7'];
  const rows = [
    { id: 'A', cols: ['1', '4', '7'] },
    { id: 'B', cols: ['1', '4'] },
    { id: 'C', cols: ['4', '5', '7'] },
    { id: 'D', cols: ['3', '5', '6'] },
    { id: 'E', cols: ['2', '3', '6', '7'] },
    { id: 'F', cols: ['2', '7'] },
  ];
  const first = solveExactCover(columns, rows);
  const second = solveExactCover(columns, rows);
  const third = solveExactCover(columns, rows);
  assert.deepEqual(first, second);
  assert.deepEqual(second, third);
});

test('does not mutate columns, rows, or anything nested inside them', () => {
  const columns = deepFreeze(['1', '2']);
  const rows = deepFreeze([
    { id: 'A', cols: ['1'] },
    { id: 'B', cols: ['2'] },
    { id: 'C', cols: ['1', '2'] },
  ]);
  // deepFreeze recurses into arrays/objects, so row.cols arrays are frozen
  // too; any attempted mutation during solving would throw here.
  assert.doesNotThrow(() => solveExactCover(columns, rows));
  const solutions = solveExactCover(columns, rows);
  assert.equal(solutions.length, 2);
});

test('malformed inputs: duplicate column names throw TypeError', () => {
  assert.throws(() => solveExactCover(['a', 'a'], []), TypeError);
});

test('malformed inputs: duplicate row ids throw TypeError', () => {
  assert.throws(
    () => solveExactCover(['a'], [{ id: 'r', cols: ['a'] }, { id: 'r', cols: [] }]),
    TypeError
  );
});

test('malformed inputs: a row referencing an unknown column throws TypeError', () => {
  assert.throws(() => solveExactCover(['a'], [{ id: 'r', cols: ['b'] }]), TypeError);
});

test('malformed inputs: a row listing the same column twice throws TypeError', () => {
  assert.throws(() => solveExactCover(['a'], [{ id: 'r', cols: ['a', 'a'] }]), TypeError);
});

test('malformed inputs: non-array columns/rows throw TypeError', () => {
  assert.throws(() => solveExactCover('not-an-array', []), TypeError);
  assert.throws(() => solveExactCover(['a'], 'not-an-array'), TypeError);
  assert.throws(() => solveExactCover(['a'], [{ id: 'r', cols: 'not-an-array' }]), TypeError);
});

test('malformed inputs: non-string column names, row ids, and row.cols entries throw TypeError', () => {
  assert.throws(() => solveExactCover([1, 2], []), TypeError);
  assert.throws(() => solveExactCover(['a'], [{ id: 42, cols: [] }]), TypeError);
  assert.throws(() => solveExactCover(['a'], [{ id: 'r', cols: [42] }]), TypeError);
});

test('malformed inputs: options.limit must be a positive integer or Infinity', () => {
  const columns = ['a'];
  const rows = [{ id: 'r', cols: ['a'] }];
  for (const badLimit of [0, -1, 1.5, '5', null, NaN, -Infinity]) {
    assert.throws(
      () => solveExactCover(columns, rows, { limit: badLimit }),
      TypeError,
      `limit ${String(badLimit)} should throw`
    );
  }
  // Valid limits must not throw.
  assert.doesNotThrow(() => solveExactCover(columns, rows, { limit: 1 }));
  assert.doesNotThrow(() => solveExactCover(columns, rows, { limit: Infinity }));
});

test('malformed inputs: a non-object options argument throws TypeError', () => {
  const columns = ['a'];
  const rows = [{ id: 'r', cols: ['a'] }];
  assert.throws(() => solveExactCover(columns, rows, 'not-an-object'), TypeError);
  assert.throws(() => solveExactCover(columns, rows, null), TypeError);
});
