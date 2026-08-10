'use strict';

// Uncommitted differential/stress harness for solveExactCover. Not part of
// the committed node:test suite -- run manually via `node fuzz.js`. Kept in
// the repo for reference per this task set's established practice (see
// README's "Testing" section).

const assert = require('node:assert/strict');
const { solveExactCover } = require('./dancing-links-exact-cover.js');

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
  // inclusive [lo, hi]
  return lo + Math.floor(rng() * (hi - lo + 1));
}

// Brute-force reference: try every subset of rows, keep those whose
// combined columns exactly partition the full column set (every column
// covered by exactly one selected row).
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

function canonicalize(solutions) {
  return solutions
    .map((sol) => sol.slice().sort((a, b) => String(a).localeCompare(String(b))))
    .map((sol) => JSON.stringify(sol))
    .sort();
}

function assertSameSolutionSet(actual, expected, label) {
  const a = canonicalize(actual);
  const e = canonicalize(expected);
  assert.deepEqual(a, e, `${label}: canonicalized solution sets differ`);
}

let checks = 0;
let mismatches = 0;

function check(label, columns, rows) {
  checks += 1;
  let actual;
  try {
    actual = solveExactCover(columns, rows, {});
  } catch (err) {
    console.error(`FAIL (threw) ${label}:`, err);
    mismatches += 1;
    return;
  }
  const expected = refSolve(columns, rows);
  try {
    assertSameSolutionSet(actual, expected, label);
  } catch (err) {
    console.error(`FAIL ${label}:`, err.message, { columns, rows, actual, expected });
    mismatches += 1;
  }
}

// ---- Fixed edge cases ----
check('empty columns, empty rows', [], []);
check('columns present, no rows -> impossible', ['A', 'B'], []);
check('single column, single covering row', ['A'], [{ id: 'r1', columns: ['A'] }]);
check('classic unique 2x2 exact cover', ['A', 'B'], [
  { id: 'r1', columns: ['A'] },
  { id: 'r2', columns: ['B'] },
  { id: 'r3', columns: ['A', 'B'] },
]);
check('two disjoint solutions', ['A', 'B'], [
  { id: 'r1', columns: ['A'] },
  { id: 'r2', columns: ['B'] },
  { id: 'r3', columns: ['A', 'B'] },
  { id: 'r4', columns: ['A'] },
]);
// Classic Knuth example (from "Dancing Links"): 7 columns, 6 rows, unique solution {r2, r4, r5}.
check('Knuth DLX paper example', [1, 2, 3, 4, 5, 6, 7], [
  { id: 'r1', columns: [1, 4, 7] },
  { id: 'r2', columns: [1, 4] },
  { id: 'r3', columns: [4, 5, 7] },
  { id: 'r4', columns: [3, 5, 6] },
  { id: 'r5', columns: [2, 3, 6, 7] },
  { id: 'r6', columns: [2, 7] },
]);

// ---- Randomized differential trials ----
const SEED = 0xdecaf;
const rng = mulberry32(SEED);
const TRIALS = 4000;
for (let t = 0; t < TRIALS; t += 1) {
  const numCols = randInt(rng, 0, 7);
  const columns = Array.from({ length: numCols }, (_, i) => `C${i}`);
  const numRows = randInt(rng, 0, 12);
  const rows = [];
  for (let i = 0; i < numRows; i += 1) {
    if (numCols === 0) break; // no valid non-empty row possible
    const size = randInt(rng, 1, numCols);
    const picked = new Set();
    while (picked.size < size) {
      picked.add(`C${randInt(rng, 0, numCols - 1)}`);
    }
    rows.push({ id: `r${i}`, columns: Array.from(picked) });
  }
  check(`random trial ${t} (cols=${numCols}, rows=${rows.length})`, columns, rows);
}

// ---- limit semantics: solveExactCover(..., {limit}) must return exactly
// the first `limit` solutions in the same order as the unlimited call ----
for (let t = 0; t < 300; t += 1) {
  const numCols = randInt(rng, 1, 5);
  const columns = Array.from({ length: numCols }, (_, i) => `C${i}`);
  const numRows = randInt(rng, 1, 10);
  const rows = [];
  for (let i = 0; i < numRows; i += 1) {
    const size = randInt(rng, 1, numCols);
    const picked = new Set();
    while (picked.size < size) {
      picked.add(`C${randInt(rng, 0, numCols - 1)}`);
    }
    rows.push({ id: `r${i}`, columns: Array.from(picked) });
  }
  checks += 1;
  const full = solveExactCover(columns, rows, {});
  if (full.length > 0) {
    const limit = randInt(rng, 1, full.length);
    const limited = solveExactCover(columns, rows, { limit });
    if (limited.length !== limit) {
      console.error(`FAIL limit-count trial ${t}: expected ${limit} got ${limited.length}`);
      mismatches += 1;
    } else {
      for (let i = 0; i < limit; i += 1) {
        if (JSON.stringify(limited[i]) !== JSON.stringify(full[i])) {
          console.error(`FAIL limit-prefix trial ${t} at solution ${i}`, limited[i], full[i]);
          mismatches += 1;
          break;
        }
      }
    }
  }
}

// ---- repeated-call / no-mutation: calling twice with the same (shared)
// input arrays/objects must give identical results and not corrupt input ----
for (let t = 0; t < 50; t += 1) {
  const numCols = randInt(rng, 1, 5);
  const columns = Array.from({ length: numCols }, (_, i) => `C${i}`);
  const numRows = randInt(rng, 1, 8);
  const rows = [];
  for (let i = 0; i < numRows; i += 1) {
    const size = randInt(rng, 1, numCols);
    const picked = new Set();
    while (picked.size < size) {
      picked.add(`C${randInt(rng, 0, numCols - 1)}`);
    }
    rows.push({ id: `r${i}`, columns: Array.from(picked) });
  }
  const columnsBefore = JSON.stringify(columns);
  const rowsBefore = JSON.stringify(rows);
  checks += 1;
  const first = solveExactCover(columns, rows, {});
  const second = solveExactCover(columns, rows, {});
  if (JSON.stringify(first) !== JSON.stringify(second)) {
    console.error(`FAIL repeated-call trial ${t}: differing results across calls`);
    mismatches += 1;
  }
  if (JSON.stringify(columns) !== columnsBefore || JSON.stringify(rows) !== rowsBefore) {
    console.error(`FAIL mutation trial ${t}: input was mutated`);
    mismatches += 1;
  }
}

console.log(`${checks} checks, ${mismatches} mismatches`);
if (mismatches > 0) process.exitCode = 1;
