'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { solveExactCover } = require('./dancing-links-exact-cover.js');

// ---------------------------------------------------------------------
// Deterministic seeded PRNG + brute-force reference, for the randomized
// differential coverage block below (step 4 of the task's own spec).
// ---------------------------------------------------------------------

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng, lo, hi) {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

// Exhaustive subset enumeration: try every subset of rows, keep those whose
// combined `columns` sets exactly partition the full column set.
function refSolve(columns, rows) {
  const n = rows.length;
  const solutions = [];
  for (let mask = 0; mask < (1 << n); mask += 1) {
    const coverCount = new Map();
    for (const c of columns) coverCount.set(c, 0);
    let ok = true;
    const chosen = [];
    for (let i = 0; i < n && ok; i += 1) {
      if ((mask & (1 << i)) === 0) continue;
      chosen.push(rows[i].id);
      for (const c of rows[i].columns) {
        coverCount.set(c, coverCount.get(c) + 1);
        if (coverCount.get(c) > 1) {
          ok = false;
          break;
        }
      }
    }
    if (!ok) continue;
    for (const c of columns) {
      if (coverCount.get(c) !== 1) {
        ok = false;
        break;
      }
    }
    if (ok) solutions.push(chosen);
  }
  return solutions;
}

// Canonicalize a solution list (sort row ids within each solution, then
// sort the list of solutions) so it can be compared for set-equality
// against a differently-ordered reference, independent of the solver's own
// (fully deterministic, but not sorted) search order.
function canonicalize(solutions) {
  return solutions
    .map((sol) => sol.slice().sort((a, b) => String(a).localeCompare(String(b))))
    .map((sol) => JSON.stringify(sol))
    .sort();
}

function assertSameSolutionSet(actual, expected, message) {
  assert.deepEqual(canonicalize(actual), canonicalize(expected), message);
}

// ---------------------------------------------------------------------
// Fixed-shape coverage
// ---------------------------------------------------------------------

test('empty columns and empty rows: the trivial empty selection is the only solution', () => {
  assert.deepEqual(solveExactCover([], []), [[]]);
});

test('columns present but no rows at all: impossible, no solutions', () => {
  assert.deepEqual(solveExactCover(['A', 'B'], []), []);
});

test('impossible: every column has zero candidate rows covering it', () => {
  // 'B' is never covered by any row.
  const rows = [{ id: 'r1', columns: ['A'] }];
  assert.deepEqual(solveExactCover(['A', 'B'], rows), []);
});

test('unique-solution instance', () => {
  const columns = ['A', 'B'];
  const rows = [
    { id: 'r1', columns: ['A'] },
    { id: 'r2', columns: ['B'] },
    // Deliberately no row covering both A and B (and no other row covering
    // A or B alone) -- {r1, r2} is the only possible exact cover.
  ];
  const result = solveExactCover(columns, rows);
  assertSameSolutionSet(result, [['r1', 'r2']], 'exactly one solution: {r1, r2}');
  assert.equal(result.length, 1);
});

test('multi-solution instance', () => {
  const columns = ['A', 'B'];
  const rows = [
    { id: 'r1', columns: ['A'] },
    { id: 'r2', columns: ['B'] },
    { id: 'r3', columns: ['A', 'B'] },
    { id: 'r4', columns: ['A'] },
  ];
  const result = solveExactCover(columns, rows);
  // Three solutions: {r1, r2}, {r4, r2}, and {r3} (which alone covers both
  // columns).
  assertSameSolutionSet(result, [
    ['r1', 'r2'],
    ['r4', 'r2'],
    ['r3'],
  ], 'three solutions total');
  assert.equal(result.length, 3);
});

test('classic Knuth Dancing-Links-paper example has a unique solution {r2, r4, r6}', () => {
  // The canonical worked example from Knuth's "Dancing Links" paper.
  const columns = [1, 2, 3, 4, 5, 6, 7];
  const rows = [
    { id: 'r1', columns: [1, 4, 7] },
    { id: 'r2', columns: [1, 4] },
    { id: 'r3', columns: [4, 5, 7] },
    { id: 'r4', columns: [3, 5, 6] },
    { id: 'r5', columns: [2, 3, 6, 7] },
    { id: 'r6', columns: [2, 7] },
  ];
  const result = solveExactCover(columns, rows);
  assertSameSolutionSet(result, [['r2', 'r4', 'r6']], 'the textbook unique solution');
  assert.equal(result.length, 1);
});

test('limit caps the number of solutions and matches the unlimited call\'s prefix', () => {
  const columns = ['A', 'B'];
  const rows = [
    { id: 'r1', columns: ['A'] },
    { id: 'r2', columns: ['B'] },
    { id: 'r3', columns: ['A', 'B'] },
    { id: 'r4', columns: ['A'] },
  ];
  const full = solveExactCover(columns, rows);
  assert.equal(full.length, 3);
  const limited1 = solveExactCover(columns, rows, { limit: 1 });
  const limited2 = solveExactCover(columns, rows, { limit: 2 });
  assert.equal(limited1.length, 1);
  assert.equal(limited2.length, 2);
  assert.deepEqual(limited1, full.slice(0, 1));
  assert.deepEqual(limited2, full.slice(0, 2));
});

test('limit larger than the total solution count returns every solution', () => {
  const columns = ['A'];
  const rows = [{ id: 'r1', columns: ['A'] }];
  const result = solveExactCover(columns, rows, { limit: 1000 });
  assert.deepEqual(result, [['r1']]);
});

test('backtracking: the smallest-remaining-column heuristic must abandon a dead-end partial choice', () => {
  // Columns A, B, C. Row r1 covers {A, B} (the smallest column A has only
  // r1 as a candidate, so the search commits to r1 first) but then column C
  // is left with zero candidates -- forcing a backtrack past r1 entirely to
  // find the real solution {r2, r3}.
  const columns = ['A', 'B', 'C'];
  const rows = [
    { id: 'r1', columns: ['A', 'B'] }, // dead end once chosen: C left uncoverable
    { id: 'r2', columns: ['A', 'C'] },
    { id: 'r3', columns: ['B'] },
  ];
  const result = solveExactCover(columns, rows);
  assertSameSolutionSet(result, [['r2', 'r3']], 'only reachable by backtracking past r1');
  assert.equal(result.length, 1);
});

test('deterministic order: repeated calls with the same input produce byte-identical output', () => {
  const columns = ['A', 'B', 'C'];
  const rows = [
    { id: 'r1', columns: ['A'] },
    { id: 'r2', columns: ['B', 'C'] },
    { id: 'r3', columns: ['A', 'B'] },
    { id: 'r4', columns: ['C'] },
    { id: 'r5', columns: ['A', 'C'] },
    { id: 'r6', columns: ['B'] },
  ];
  const first = solveExactCover(columns, rows);
  const second = solveExactCover(columns, rows);
  const third = solveExactCover(columns.slice(), rows.map((r) => ({ id: r.id, columns: r.columns.slice() })));
  assert.deepEqual(first, second);
  assert.deepEqual(first, third);
});

test('repeated-call behavior: shared input arrays/objects are never mutated across calls', () => {
  const columns = ['A', 'B'];
  const rows = [
    { id: 'r1', columns: ['A'] },
    { id: 'r2', columns: ['B'] },
    { id: 'r3', columns: ['A', 'B'] },
  ];
  const columnsSnapshot = JSON.stringify(columns);
  const rowsSnapshot = JSON.stringify(rows);
  const first = solveExactCover(columns, rows);
  const second = solveExactCover(columns, rows);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(columns), columnsSnapshot, 'columns array must not be mutated');
  assert.equal(JSON.stringify(rows), rowsSnapshot, 'rows array/objects must not be mutated');
});

// ---------------------------------------------------------------------
// Validation surface
// ---------------------------------------------------------------------

test('columns must be an array', () => {
  assert.throws(() => solveExactCover('AB', []), TypeError);
  assert.throws(() => solveExactCover(null, []), TypeError);
  assert.throws(() => solveExactCover(undefined, []), TypeError);
});

test('each column must be a string or number', () => {
  assert.throws(() => solveExactCover([{ name: 'A' }], []), TypeError);
  assert.throws(() => solveExactCover([null], []), TypeError);
  assert.throws(() => solveExactCover([undefined], []), TypeError);
});

test('duplicate columns are rejected', () => {
  assert.throws(() => solveExactCover(['A', 'A'], []), RangeError);
  assert.throws(() => solveExactCover([1, 1], []), RangeError);
});

test('rows must be an array', () => {
  assert.throws(() => solveExactCover(['A'], 'not-an-array'), TypeError);
  assert.throws(() => solveExactCover(['A'], null), TypeError);
});

test('each row must be a plain object', () => {
  assert.throws(() => solveExactCover(['A'], ['not-an-object']), TypeError);
  assert.throws(() => solveExactCover(['A'], [null]), TypeError);
  assert.throws(() => solveExactCover(['A'], [['A']]), TypeError, 'an array is not a plain object');
});

test('a row missing (or wrongly-typed) id is rejected', () => {
  assert.throws(() => solveExactCover(['A'], [{ columns: ['A'] }]), TypeError);
  assert.throws(() => solveExactCover(['A'], [{ id: {}, columns: ['A'] }]), TypeError);
});

test('duplicate row ids are rejected', () => {
  const rows = [
    { id: 'r1', columns: ['A'] },
    { id: 'r1', columns: ['A'] },
  ];
  assert.throws(() => solveExactCover(['A'], rows), RangeError);
});

test('a row missing (or wrongly-typed) columns is rejected', () => {
  assert.throws(() => solveExactCover(['A'], [{ id: 'r1' }]), TypeError);
  assert.throws(() => solveExactCover(['A'], [{ id: 'r1', columns: 'A' }]), TypeError);
});

test('a row with an empty columns array is rejected', () => {
  assert.throws(() => solveExactCover(['A'], [{ id: 'r1', columns: [] }]), RangeError);
});

test('a row column entry must be a string or number', () => {
  assert.throws(() => solveExactCover(['A'], [{ id: 'r1', columns: [{}] }]), TypeError);
});

test('a row referencing an unknown column is rejected', () => {
  assert.throws(() => solveExactCover(['A'], [{ id: 'r1', columns: ['B'] }]), RangeError);
});

test('a row that lists the same column twice is rejected', () => {
  assert.throws(() => solveExactCover(['A'], [{ id: 'r1', columns: ['A', 'A'] }]), RangeError);
});

test('options must be an object when provided', () => {
  assert.throws(() => solveExactCover(['A'], [], 5), TypeError);
  assert.throws(() => solveExactCover(['A'], [], []), TypeError);
  assert.throws(() => solveExactCover(['A'], [], null), TypeError);
});

test('options.limit must be a positive integer', () => {
  assert.throws(() => solveExactCover(['A'], [], { limit: 1.5 }), TypeError);
  assert.throws(() => solveExactCover(['A'], [], { limit: '1' }), TypeError);
  assert.throws(() => solveExactCover(['A'], [], { limit: 0 }), RangeError);
  assert.throws(() => solveExactCover(['A'], [], { limit: -1 }), RangeError);
});

// ---------------------------------------------------------------------
// Deterministic randomized differential coverage (step 4 of the task spec):
// canonicalized solver results vs. exhaustive subset enumeration.
// ---------------------------------------------------------------------

test('deterministic randomized differential coverage: small dense instances', () => {
  const rng = mulberry32(0xc0ffee);
  for (let t = 0; t < 300; t += 1) {
    const numCols = randInt(rng, 0, 6);
    const columns = Array.from({ length: numCols }, (_, i) => `C${i}`);
    const numRows = numCols === 0 ? 0 : randInt(rng, 0, 10);
    const rows = [];
    for (let i = 0; i < numRows; i += 1) {
      const size = randInt(rng, 1, numCols);
      const picked = new Set();
      while (picked.size < size) {
        picked.add(`C${randInt(rng, 0, numCols - 1)}`);
      }
      rows.push({ id: `r${i}`, columns: Array.from(picked) });
    }
    const actual = solveExactCover(columns, rows);
    const expected = refSolve(columns, rows);
    assertSameSolutionSet(actual, expected, `trial ${t} (cols=${numCols}, rows=${rows.length})`);
  }
});

test('deterministic randomized differential coverage: larger sparse instances', () => {
  const rng = mulberry32(0x5eed5eed);
  for (let t = 0; t < 150; t += 1) {
    const numCols = randInt(rng, 1, 8);
    const columns = Array.from({ length: numCols }, (_, i) => `X${i}`);
    const numRows = randInt(rng, 1, 12);
    const rows = [];
    for (let i = 0; i < numRows; i += 1) {
      const size = randInt(rng, 1, Math.min(3, numCols));
      const picked = new Set();
      while (picked.size < size) {
        picked.add(`X${randInt(rng, 0, numCols - 1)}`);
      }
      rows.push({ id: `row${i}`, columns: Array.from(picked) });
    }
    const actual = solveExactCover(columns, rows);
    const expected = refSolve(columns, rows);
    assertSameSolutionSet(actual, expected, `trial ${t} (cols=${numCols}, rows=${rows.length})`);
  }
});
