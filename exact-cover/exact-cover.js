'use strict';

/**
 * Dependency-free deterministic exact-cover solver using Knuth's Algorithm X
 * with Dancing Links (DLX).
 *
 * solveExactCover(columns, rows, options)
 *   columns: array of unique column names (strings) -- the universe to cover.
 *   rows:    array of { id, cols } objects. `id` must be unique across rows;
 *            `cols` is the (possibly empty, no duplicates) array of column
 *            names (each must appear in `columns`) that this row covers.
 *   options: optional { limit } -- a positive integer, or Infinity (default),
 *            capping how many solutions are collected before search stops.
 *
 * Returns an array of solutions; each solution is an array of the selected
 * rows' `id`s, in the order Algorithm X selected them. Neither `columns`
 * nor `rows` (nor anything nested inside them) is ever mutated.
 *
 * Determinism: at each search step, the algorithm always branches on the
 * uncovered column with the fewest remaining candidate rows, breaking ties
 * by the column's position in the original `columns` array (the leftmost
 * tied column wins), and always tries that column's candidate rows in the
 * order they appear in the original `rows` array. Given the same inputs,
 * this produces the same solutions in the same order on every call.
 */

function validateInputs(columns, rows, options) {
  if (!Array.isArray(columns)) throw new TypeError('columns must be an array');
  const columnSet = new Set();
  for (const name of columns) {
    if (typeof name !== 'string') throw new TypeError('every column name must be a string');
    if (columnSet.has(name)) throw new TypeError(`duplicate column name: ${name}`);
    columnSet.add(name);
  }

  if (!Array.isArray(rows)) throw new TypeError('rows must be an array');
  const rowIds = new Set();
  for (const row of rows) {
    if (row === null || typeof row !== 'object') throw new TypeError('every row must be an object');
    if (typeof row.id !== 'string') throw new TypeError('every row.id must be a string');
    if (rowIds.has(row.id)) throw new TypeError(`duplicate row id: ${row.id}`);
    rowIds.add(row.id);
    if (!Array.isArray(row.cols)) throw new TypeError(`row.cols must be an array (row ${row.id})`);
    const seenInRow = new Set();
    for (const col of row.cols) {
      if (typeof col !== 'string') throw new TypeError(`row.cols entries must be strings (row ${row.id})`);
      if (!columnSet.has(col)) throw new TypeError(`row ${row.id} references unknown column: ${col}`);
      if (seenInRow.has(col)) throw new TypeError(`row ${row.id} lists column ${col} more than once`);
      seenInRow.add(col);
    }
  }

  if (options !== undefined) {
    if (options === null || typeof options !== 'object') throw new TypeError('options must be an object');
    if (options.limit !== undefined) {
      const limit = options.limit;
      const isValid = limit === Infinity || (typeof limit === 'number' && Number.isInteger(limit) && limit >= 1);
      if (!isValid) throw new TypeError('options.limit must be a positive integer or Infinity');
    }
  }
}

/** Builds the DLX toroidal structure. Returns the master root header. */
function buildStructure(columns, rows) {
  const root = { name: null, up: null, down: null, left: null, right: null, column: null, size: 0 };
  root.left = root;
  root.right = root;

  const headers = new Map();
  let prevHeader = root;
  for (const name of columns) {
    const header = { name, size: 0, up: null, down: null, left: null, right: null, column: null };
    header.up = header;
    header.down = header;
    header.column = header;
    header.left = prevHeader;
    prevHeader.right = header;
    prevHeader = header;
    headers.set(name, header);
  }
  prevHeader.right = root;
  root.left = prevHeader;

  for (const row of rows) {
    let firstInRow = null;
    let lastInRow = null;
    for (const colName of row.cols) {
      const header = headers.get(colName);
      const node = { rowId: row.id, column: header, up: null, down: null, left: null, right: null };

      // Vertical insert at the bottom of the column's ring.
      node.up = header.up;
      node.down = header;
      header.up.down = node;
      header.up = node;
      header.size++;

      // Horizontal insert into this row's ring.
      if (firstInRow === null) {
        firstInRow = node;
        node.left = node;
        node.right = node;
      } else {
        node.left = lastInRow;
        node.right = firstInRow;
        lastInRow.right = node;
        firstInRow.left = node;
      }
      lastInRow = node;
    }
  }

  return root;
}

function coverColumn(c) {
  c.right.left = c.left;
  c.left.right = c.right;
  for (let i = c.down; i !== c; i = i.down) {
    for (let j = i.right; j !== i; j = j.right) {
      j.down.up = j.up;
      j.up.down = j.down;
      j.column.size--;
    }
  }
}

function uncoverColumn(c) {
  for (let i = c.up; i !== c; i = i.up) {
    for (let j = i.left; j !== i; j = j.left) {
      j.column.size++;
      j.down.up = j;
      j.up.down = j;
    }
  }
  c.right.left = c;
  c.left.right = c;
}

function search(root, solutions, selected, limit) {
  if (solutions.length >= limit) return;

  if (root.right === root) {
    solutions.push(selected.slice());
    return;
  }

  // Smallest uncovered column; strict '<' means the first (leftmost, i.e.
  // earliest in original column-input order) minimum wins ties.
  let chosen = root.right;
  for (let h = root.right.right; h !== root; h = h.right) {
    if (h.size < chosen.size) chosen = h;
  }

  coverColumn(chosen);
  for (let r = chosen.down; r !== chosen; r = r.down) {
    selected.push(r.rowId);
    for (let j = r.right; j !== r; j = j.right) coverColumn(j.column);

    search(root, solutions, selected, limit);

    for (let j = r.left; j !== r; j = j.left) uncoverColumn(j.column);
    selected.pop();

    if (solutions.length >= limit) break;
  }
  uncoverColumn(chosen);
}

function solveExactCover(columns, rows, options) {
  validateInputs(columns, rows, options);
  const limit = options && options.limit !== undefined ? options.limit : Infinity;

  const root = buildStructure(columns, rows);
  const solutions = [];
  search(root, solutions, [], limit);
  return solutions;
}

module.exports = { solveExactCover };
