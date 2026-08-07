/**
 * Dependency-free implementation of Myers' shortest-edit-script diff
 * algorithm (Eugene W. Myers, "An O(ND) Difference Algorithm and Its
 * Variations", 1986) for two arrays.
 *
 * myersDiff(before, after) returns an array of operation records:
 *   { type: 'equal',  value }  -- element present, unchanged, in both arrays
 *   { type: 'delete', value }  -- element present only in `before`
 *   { type: 'insert', value }  -- element present only in `after`
 *
 * Concatenating the values of all non-'delete' ops (equal + insert), in
 * order, reconstructs `after`. Concatenating the values of all non-'insert'
 * ops (equal + delete), in order, reconstructs `before`.
 *
 * - Element equality uses Object.is (so NaN is treated as equal to NaN,
 *   and +0/-0 are treated as *not* equal to each other -- unlike ===).
 * - Neither input array is mutated.
 * - When multiple edit scripts of the same (minimal) length exist, the
 *   algorithm deterministically prefers a 'delete' over an 'insert' at
 *   the tie point (see the strict '<' in the diagonal-choice condition
 *   below: an 'insert' branch is only taken when it is *strictly*
 *   better than the 'delete' branch, so ties fall through to 'delete').
 */

function shortestEditTrace(before, after) {
  const n = before.length;
  const m = after.length;
  const max = n + m;
  const v = new Map();
  v.set(1, 0);
  const trace = [];

  if (max === 0) {
    trace.push(new Map(v));
    return trace;
  }

  for (let d = 0; d <= max; d++) {
    trace.push(new Map(v));
    for (let k = -d; k <= d; k += 2) {
      let x;
      if (k === -d || (k !== d && v.get(k - 1) < v.get(k + 1))) {
        x = v.get(k + 1); // came from a vertical move (insert)
      } else {
        x = v.get(k - 1) + 1; // came from a horizontal move (delete)
      }
      let y = x - k;

      while (x < n && y < m && Object.is(before[x], after[y])) {
        x++;
        y++;
      }

      v.set(k, x);

      if (x >= n && y >= m) {
        return trace;
      }
    }
  }

  /* istanbul ignore next -- unreachable: the loop above always finds and
     returns a solution by d = n + m at the latest. */
  throw new Error('unreachable: no edit script found');
}

function backtrack(before, after, trace) {
  let x = before.length;
  let y = after.length;
  const ops = [];

  for (let d = trace.length - 1; d >= 0; d--) {
    const v = trace[d];
    const k = x - y;

    let prevK;
    if (k === -d || (k !== d && v.get(k - 1) < v.get(k + 1))) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }

    const prevX = v.get(prevK);
    const prevY = prevX - prevK;

    while (x > prevX && y > prevY) {
      ops.push({ type: 'equal', value: before[x - 1] });
      x--;
      y--;
    }

    if (d > 0) {
      if (x === prevX) {
        ops.push({ type: 'insert', value: after[y - 1] });
      } else {
        ops.push({ type: 'delete', value: before[x - 1] });
      }
      x = prevX;
      y = prevY;
    }
  }

  ops.reverse();
  return ops;
}

export function myersDiff(before, after) {
  if (!Array.isArray(before) || !Array.isArray(after)) {
    throw new TypeError('myersDiff requires two arrays');
  }

  const trace = shortestEditTrace(before, after);
  return backtrack(before, after, trace);
}
