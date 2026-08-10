'use strict';

/**
 * solveExactCover(columns, rows, options) — a dependency-free, deterministic
 * exact-cover solver implementing Knuth's Algorithm X via Dancing Links
 * (DLX): column headers and row cells are linked into circular doubly-linked
 * lists (L/R horizontally within a row and across column headers, U/D
 * vertically within a column), so a column (and every row that touches it)
 * can be removed from and restored to the search in O(1) per cell via
 * `cover`/`uncover` — no re-scanning of the matrix is needed at any step.
 *
 * API
 * ---
 * `columns`: an array of distinct column names, each a `string` or `number`.
 * `rows`: an array of row descriptors `{ id, columns }`, where `id` is a
 *   distinct `string`/`number` and `columns` is a non-empty array of
 *   distinct values, each of which must appear in the `columns` array (the
 *   set of columns this row/candidate covers).
 * `options.limit` (optional): a positive integer capping how many solutions
 *   to find before stopping the search early. Omitted/undefined means "find
 *   every solution."
 *
 * Returns an array of solutions. Each solution is an array of row `id`s
 * whose combined `columns` sets exactly partition the full `columns` set
 * (every column covered by exactly one selected row). With zero columns,
 * the (only) solution is the empty selection `[]` — the classic Algorithm X
 * base case: no columns left to cover means the current partial selection
 * is already complete.
 *
 * Determinism: at every search step, the column with the FEWEST remaining
 * candidate rows is branched on first (Knuth's standard "S heuristic," which
 * both prunes dead ends fast and pins down a fully deterministic branching
 * order); ties are broken by each column's position in the original
 * `columns` array (leftmost first). For the chosen column, candidate rows
 * are tried in the order they appear in the original `rows` array. Both
 * within one call and across repeated calls with the same input, this
 * yields byte-identical output — solutions are returned in the exact order
 * the depth-first search discovers them (not sorted/canonicalized), and row
 * ids within a solution are in the order they were selected during the
 * search (also not sorted).
 *
 * Never mutates `columns`, `rows`, or any row object — a fresh internal
 * linked structure is built from the input on every call, so repeated calls
 * with the same (or shared) input arrays are fully independent and never
 * interfere with each other.
 *
 * Validation: a wrong-KIND argument (not an array, not a string/number,
 * not an integer) throws `TypeError`; a right-kind argument with an invalid
 * VALUE (a duplicate, an unknown column reference, an empty row, a
 * non-positive limit) throws `RangeError` — the same two-tier convention
 * used throughout this task set.
 */
function solveExactCover(columns, rows, options = {}) {
  if (!Array.isArray(columns)) {
    throw new TypeError('columns must be an array');
  }
  const columnSet = new Set();
  for (let i = 0; i < columns.length; i += 1) {
    const c = columns[i];
    if (typeof c !== 'string' && typeof c !== 'number') {
      throw new TypeError(`columns[${i}] must be a string or number`);
    }
    if (columnSet.has(c)) {
      throw new RangeError(`duplicate column: ${String(c)}`);
    }
    columnSet.add(c);
  }

  if (!Array.isArray(rows)) {
    throw new TypeError('rows must be an array');
  }
  const rowIdSet = new Set();
  const normalizedRows = [];
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (row === null || typeof row !== 'object' || Array.isArray(row)) {
      throw new TypeError(`rows[${i}] must be a plain object with { id, columns }`);
    }
    const { id } = row;
    const rowColumns = row.columns;
    if (typeof id !== 'string' && typeof id !== 'number') {
      throw new TypeError(`rows[${i}].id must be a string or number`);
    }
    if (rowIdSet.has(id)) {
      throw new RangeError(`duplicate row id: ${String(id)}`);
    }
    rowIdSet.add(id);
    if (!Array.isArray(rowColumns)) {
      throw new TypeError(`rows[${i}].columns must be an array`);
    }
    if (rowColumns.length === 0) {
      throw new RangeError(`rows[${i}].columns must be non-empty`);
    }
    const seenInRow = new Set();
    for (let k = 0; k < rowColumns.length; k += 1) {
      const col = rowColumns[k];
      if (typeof col !== 'string' && typeof col !== 'number') {
        throw new TypeError(`rows[${i}].columns[${k}] must be a string or number`);
      }
      if (!columnSet.has(col)) {
        throw new RangeError(`rows[${i}].columns[${k}] references unknown column: ${String(col)}`);
      }
      if (seenInRow.has(col)) {
        throw new RangeError(
          `rows[${i}].columns[${k}] duplicates column ${String(col)} within the same row`
        );
      }
      seenInRow.add(col);
    }
    normalizedRows.push({ id, columns: rowColumns.slice() });
  }

  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('options must be an object');
  }
  let limit = Infinity;
  if (options.limit !== undefined) {
    const l = options.limit;
    if (typeof l !== 'number' || !Number.isInteger(l)) {
      throw new TypeError('options.limit must be an integer');
    }
    if (l < 1) {
      throw new RangeError('options.limit must be >= 1');
    }
    limit = l;
  }

  const root = buildStructure(columns, normalizedRows);
  const results = [];
  search(root, [], results, limit);
  return results;
}

// ---------------------------------------------------------------------
// Dancing Links internals (module-private)
// ---------------------------------------------------------------------

/** A circular doubly-linked node: L/R within a row (or the header row),
 * U/D within a column. `C` points to the owning column header; `rowId` is
 * set only on row-body cells (column headers use `rowId = undefined`). */
function makeNode() {
  const node = { L: null, R: null, U: null, D: null, C: null, rowId: undefined, size: undefined, name: undefined };
  node.L = node;
  node.R = node;
  node.U = node;
  node.D = node;
  return node;
}

function buildStructure(columns, rows) {
  const root = makeNode();
  const headerByName = new Map();

  for (let i = 0; i < columns.length; i += 1) {
    const h = makeNode();
    h.C = h;
    h.name = columns[i];
    h.size = 0;
    // Append h just to the left of root (root.L is the current last header).
    h.L = root.L;
    h.R = root;
    root.L.R = h;
    root.L = h;
    headerByName.set(columns[i], h);
  }

  for (let r = 0; r < rows.length; r += 1) {
    const row = rows[r];
    const rowNodes = [];
    for (let k = 0; k < row.columns.length; k += 1) {
      const h = headerByName.get(row.columns[k]);
      const node = makeNode();
      node.C = h;
      node.rowId = row.id;
      // Insert node as the new bottom of column h (just above h itself),
      // so h.D..h.U walks the column top-to-bottom in original row order.
      node.U = h.U;
      node.D = h;
      h.U.D = node;
      h.U = node;
      h.size += 1;
      rowNodes.push(node);
    }
    // Link this row's cells into a circular list, in column order.
    for (let k = 0; k < rowNodes.length; k += 1) {
      const node = rowNodes[k];
      const next = rowNodes[(k + 1) % rowNodes.length];
      node.R = next;
      next.L = node;
    }
  }

  return root;
}

function cover(c) {
  c.R.L = c.L;
  c.L.R = c.R;
  for (let i = c.D; i !== c; i = i.D) {
    for (let j = i.R; j !== i; j = j.R) {
      j.D.U = j.U;
      j.U.D = j.D;
      j.C.size -= 1;
    }
  }
}

function uncover(c) {
  for (let i = c.U; i !== c; i = i.U) {
    for (let j = i.L; j !== i; j = j.L) {
      j.C.size += 1;
      j.D.U = j;
      j.U.D = j;
    }
  }
  c.R.L = c;
  c.L.R = c;
}

/** Depth-first Algorithm X search. Returns `true` once `results.length`
 * has reached `limit` (a "stop" signal that unwinds the recursion), `false`
 * otherwise. Always restores every `cover()` it performs via a matching
 * `uncover()` before returning, at every level, so the structure is left
 * exactly as found regardless of whether the search stopped early. */
function search(root, path, results, limit) {
  if (root.R === root) {
    results.push(path.slice());
    return results.length >= limit;
  }

  let c = root.R;
  for (let j = root.R.R; j !== root; j = j.R) {
    if (j.size < c.size) {
      c = j;
    }
  }
  if (c.size === 0) {
    return false;
  }

  cover(c);
  let stop = false;
  for (let r = c.D; r !== c && !stop; r = r.D) {
    path.push(r.rowId);
    for (let j = r.R; j !== r; j = j.R) {
      cover(j.C);
    }
    stop = search(root, path, results, limit);
    for (let j = r.L; j !== r; j = j.L) {
      uncover(j.C);
    }
    path.pop();
  }
  uncover(c);
  return stop;
}

module.exports = { solveExactCover };
