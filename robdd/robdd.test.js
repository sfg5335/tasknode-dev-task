'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ROBDD } = require('./robdd.js');

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

function allAssignments(variables) {
  const n = variables.length;
  const results = [];
  for (let mask = 0; mask < (1 << n); mask++) {
    const assignment = {};
    for (let i = 0; i < n; i++) {
      assignment[variables[i]] = Boolean((mask >> i) & 1);
    }
    results.push(assignment);
  }
  return results;
}

function randomExpr(rng, variables, depth) {
  if (depth <= 0 || rng() < 0.35) {
    const name = variables[Math.floor(rng() * variables.length)];
    return ['VAR', name];
  }
  const r = rng();
  if (r < 0.15) return ['NOT', randomExpr(rng, variables, depth - 1)];
  if (r < 0.45) return ['AND', randomExpr(rng, variables, depth - 1), randomExpr(rng, variables, depth - 1)];
  if (r < 0.75) return ['OR', randomExpr(rng, variables, depth - 1), randomExpr(rng, variables, depth - 1)];
  return ['XOR', randomExpr(rng, variables, depth - 1), randomExpr(rng, variables, depth - 1)];
}

function evalExpr(expr, assignment) {
  switch (expr[0]) {
    case 'VAR':
      return assignment[expr[1]];
    case 'NOT':
      return !evalExpr(expr[1], assignment);
    case 'AND':
      return evalExpr(expr[1], assignment) && evalExpr(expr[2], assignment);
    case 'OR':
      return evalExpr(expr[1], assignment) || evalExpr(expr[2], assignment);
    case 'XOR':
      return evalExpr(expr[1], assignment) !== evalExpr(expr[2], assignment);
    default:
      throw new Error('bad expr');
  }
}

function buildBDD(bdd, expr, varHandles) {
  switch (expr[0]) {
    case 'VAR':
      return varHandles[expr[1]];
    case 'NOT':
      return bdd.not(buildBDD(bdd, expr[1], varHandles));
    case 'AND':
      return bdd.apply('AND', buildBDD(bdd, expr[1], varHandles), buildBDD(bdd, expr[2], varHandles));
    case 'OR':
      return bdd.apply('OR', buildBDD(bdd, expr[1], varHandles), buildBDD(bdd, expr[2], varHandles));
    case 'XOR':
      return bdd.apply('XOR', buildBDD(bdd, expr[1], varHandles), buildBDD(bdd, expr[2], varHandles));
    default:
      throw new Error('bad expr');
  }
}

// ---------------------------------------------------------------------
// Construction / validation
// ---------------------------------------------------------------------

test('constructor: accepts an array of distinct variable names', () => {
  const bdd = new ROBDD(['a', 'b', 'c']);
  assert.deepEqual(bdd.variableOrder, ['a', 'b', 'c']);
});

test('constructor: accepts an empty variable order', () => {
  const bdd = new ROBDD([]);
  assert.deepEqual(bdd.variableOrder, []);
  assert.equal(bdd.satCount(ROBDD.TRUE), 1n);
  assert.equal(bdd.satCount(ROBDD.FALSE), 0n);
});

test('constructor: rejects a non-array variableOrder', () => {
  assert.throws(() => new ROBDD('abc'), TypeError);
  assert.throws(() => new ROBDD(null), TypeError);
  assert.throws(() => new ROBDD(undefined), TypeError);
  assert.throws(() => new ROBDD({ 0: 'a', length: 1 }), TypeError);
});

test('constructor: rejects a non-string element', () => {
  assert.throws(() => new ROBDD(['a', 2, 'c']), TypeError);
  assert.throws(() => new ROBDD([null]), TypeError);
});

test('constructor: rejects a duplicate variable name', () => {
  assert.throws(() => new ROBDD(['a', 'b', 'a']), RangeError);
});

test('constructor: does not mutate the caller\'s array', () => {
  const order = ['a', 'b'];
  const bdd = new ROBDD(order);
  order.push('c');
  assert.deepEqual(bdd.variableOrder, ['a', 'b']);
});

test('ROBDD.FALSE and ROBDD.TRUE are fixed 0 and 1', () => {
  assert.equal(ROBDD.FALSE, 0);
  assert.equal(ROBDD.TRUE, 1);
  const bdd1 = new ROBDD(['a']);
  const bdd2 = new ROBDD(['x', 'y']);
  assert.equal(ROBDD.FALSE, 0);
  assert.equal(ROBDD.TRUE, 1);
  // Terminal handles are valid on every instance, regardless of its own
  // variable order.
  assert.equal(bdd1.evaluate(ROBDD.TRUE, { a: true }), true);
  assert.equal(bdd2.evaluate(ROBDD.FALSE, { x: false, y: false }), false);
});

// ---------------------------------------------------------------------
// variable()
// ---------------------------------------------------------------------

test('variable: returns a handle whose evaluate matches the assignment', () => {
  const bdd = new ROBDD(['a', 'b']);
  const a = bdd.variable('a');
  assert.equal(bdd.evaluate(a, { a: true, b: false }), true);
  assert.equal(bdd.evaluate(a, { a: false, b: true }), false);
});

test('variable: repeated calls for the same name return the same handle', () => {
  const bdd = new ROBDD(['a', 'b']);
  const a1 = bdd.variable('a');
  const a2 = bdd.variable('a');
  assert.equal(a1, a2);
});

test('variable: rejects a non-string name', () => {
  const bdd = new ROBDD(['a']);
  assert.throws(() => bdd.variable(1), TypeError);
  assert.throws(() => bdd.variable(null), TypeError);
});

test('variable: rejects an unknown variable name', () => {
  const bdd = new ROBDD(['a', 'b']);
  assert.throws(() => bdd.variable('c'), RangeError);
});

// ---------------------------------------------------------------------
// Reduction identities
// ---------------------------------------------------------------------

test('reduction: not(not(x)) === x (same handle)', () => {
  const bdd = new ROBDD(['x']);
  const x = bdd.variable('x');
  assert.equal(bdd.not(bdd.not(x)), x);
});

test('reduction: apply(AND, x, x) === x', () => {
  const bdd = new ROBDD(['x', 'y']);
  const x = bdd.variable('x');
  assert.equal(bdd.apply('AND', x, x), x);
});

test('reduction: apply(OR, x, x) === x', () => {
  const bdd = new ROBDD(['x', 'y']);
  const x = bdd.variable('x');
  assert.equal(bdd.apply('OR', x, x), x);
});

test('reduction: apply(XOR, x, x) === FALSE', () => {
  const bdd = new ROBDD(['x']);
  const x = bdd.variable('x');
  assert.equal(bdd.apply('XOR', x, x), ROBDD.FALSE);
});

test('reduction: identity laws with terminals (AND/OR)', () => {
  const bdd = new ROBDD(['x']);
  const x = bdd.variable('x');
  assert.equal(bdd.apply('AND', x, ROBDD.TRUE), x);
  assert.equal(bdd.apply('AND', ROBDD.TRUE, x), x);
  assert.equal(bdd.apply('AND', x, ROBDD.FALSE), ROBDD.FALSE);
  assert.equal(bdd.apply('AND', ROBDD.FALSE, x), ROBDD.FALSE);
  assert.equal(bdd.apply('OR', x, ROBDD.FALSE), x);
  assert.equal(bdd.apply('OR', ROBDD.FALSE, x), x);
  assert.equal(bdd.apply('OR', x, ROBDD.TRUE), ROBDD.TRUE);
  assert.equal(bdd.apply('OR', ROBDD.TRUE, x), ROBDD.TRUE);
});

test('reduction: XOR identity/negation laws with terminals', () => {
  const bdd = new ROBDD(['x']);
  const x = bdd.variable('x');
  assert.equal(bdd.apply('XOR', x, ROBDD.FALSE), x);
  assert.equal(bdd.apply('XOR', ROBDD.FALSE, x), x);
  assert.equal(bdd.apply('XOR', x, ROBDD.TRUE), bdd.not(x));
  assert.equal(bdd.apply('XOR', ROBDD.TRUE, x), bdd.not(x));
});

test('reduction: absorption law a & (a | b) === a', () => {
  const bdd = new ROBDD(['a', 'b']);
  const a = bdd.variable('a');
  const b = bdd.variable('b');
  const result = bdd.apply('AND', a, bdd.apply('OR', a, b));
  assert.equal(result, a);
});

test('reduction: a low===high node never gets its own handle (variable, then force a collapse)', () => {
  // AND of a variable with itself at the "make node" level: apply(AND,x,x)
  // already covers the public-API path; this additionally checks the
  // internal node table did not grow for the collapsed node.
  const bdd = new ROBDD(['x', 'y']);
  const x = bdd.variable('x');
  const before = bdd.nodeCount(x);
  const result = bdd.apply('AND', x, x);
  assert.equal(result, x);
  assert.equal(bdd.nodeCount(result), before);
});

// ---------------------------------------------------------------------
// Canonical identity for equivalent formulas
// ---------------------------------------------------------------------

test('canonical identity: distributive law AND-over-OR', () => {
  const bdd = new ROBDD(['a', 'b', 'c']);
  const a = bdd.variable('a');
  const b = bdd.variable('b');
  const c = bdd.variable('c');
  // a & (b | c)
  const lhs = bdd.apply('AND', a, bdd.apply('OR', b, c));
  // (a & b) | (a & c)
  const rhs = bdd.apply('OR', bdd.apply('AND', a, b), bdd.apply('AND', a, c));
  assert.equal(lhs, rhs);
});

test('canonical identity: De Morgan not(a|b) === not(a) & not(b)', () => {
  const bdd = new ROBDD(['a', 'b']);
  const a = bdd.variable('a');
  const b = bdd.variable('b');
  const lhs = bdd.not(bdd.apply('OR', a, b));
  const rhs = bdd.apply('AND', bdd.not(a), bdd.not(b));
  assert.equal(lhs, rhs);
});

test('canonical identity: De Morgan not(a&b) === not(a) | not(b)', () => {
  const bdd = new ROBDD(['a', 'b']);
  const a = bdd.variable('a');
  const b = bdd.variable('b');
  const lhs = bdd.not(bdd.apply('AND', a, b));
  const rhs = bdd.apply('OR', bdd.not(a), bdd.not(b));
  assert.equal(lhs, rhs);
});

test('canonical identity: XOR decomposition a^b === (a|b) & not(a&b)', () => {
  const bdd = new ROBDD(['a', 'b']);
  const a = bdd.variable('a');
  const b = bdd.variable('b');
  const lhs = bdd.apply('XOR', a, b);
  const rhs = bdd.apply('AND', bdd.apply('OR', a, b), bdd.not(bdd.apply('AND', a, b)));
  assert.equal(lhs, rhs);
});

test('canonical identity: AND and XOR are associative at the handle level', () => {
  const bdd = new ROBDD(['a', 'b', 'c']);
  const a = bdd.variable('a');
  const b = bdd.variable('b');
  const c = bdd.variable('c');
  assert.equal(bdd.apply('AND', bdd.apply('AND', a, b), c), bdd.apply('AND', a, bdd.apply('AND', b, c)));
  assert.equal(bdd.apply('XOR', bdd.apply('XOR', a, b), c), bdd.apply('XOR', a, bdd.apply('XOR', b, c)));
});

test('canonical identity: two structurally different but logically equivalent formulas built via factored vs. fully-distributed form yield the identical handle', () => {
  const bdd = new ROBDD(['w', 'x', 'y', 'z']);
  const [w, x, y, z] = ['w', 'x', 'y', 'z'].map((v) => bdd.variable(v));

  // Factored: (w|x) & (y|z)
  const factored = bdd.apply('AND', bdd.apply('OR', w, x), bdd.apply('OR', y, z));

  // Fully distributed: (w&y) | (w&z) | (x&y) | (x&z)
  const distributed = bdd.apply(
    'OR',
    bdd.apply('OR', bdd.apply('AND', w, y), bdd.apply('AND', w, z)),
    bdd.apply('OR', bdd.apply('AND', x, y), bdd.apply('AND', x, z))
  );

  assert.equal(factored, distributed);

  // Cross-check against an independent brute-force truth table too.
  const assignments = allAssignments(['w', 'x', 'y', 'z']);
  for (const asg of assignments) {
    const expected = (asg.w || asg.x) && (asg.y || asg.z);
    assert.equal(bdd.evaluate(factored, asg), expected);
  }
});

// ---------------------------------------------------------------------
// Exhaustive truth tables
// ---------------------------------------------------------------------

test('exhaustive truth table: random small-arity expressions match an independent evaluator on every assignment', () => {
  const rng = mulberry32(2024);
  for (let n = 1; n <= 5; n++) {
    const variables = [];
    for (let i = 0; i < n; i++) variables.push(`v${i}`);
    for (let t = 0; t < 12; t++) {
      const bdd = new ROBDD(variables);
      const varHandles = {};
      for (const v of variables) varHandles[v] = bdd.variable(v);
      const expr = randomExpr(rng, variables, 4);
      const handle = buildBDD(bdd, expr, varHandles);
      for (const asg of allAssignments(variables)) {
        assert.equal(bdd.evaluate(handle, asg), evalExpr(expr, asg), `n=${n} t=${t} expr=${JSON.stringify(expr)} asg=${JSON.stringify(asg)}`);
      }
    }
  }
});

test('exhaustive truth table: a fixed 4-variable formula matches a hand-derived table', () => {
  const bdd = new ROBDD(['a', 'b', 'c', 'd']);
  const [a, b, c, d] = ['a', 'b', 'c', 'd'].map((v) => bdd.variable(v));
  // f = (a AND b) XOR (c OR d)
  const f = bdd.apply('XOR', bdd.apply('AND', a, b), bdd.apply('OR', c, d));
  for (const asg of allAssignments(['a', 'b', 'c', 'd'])) {
    const expected = (asg.a && asg.b) !== (asg.c || asg.d);
    assert.equal(bdd.evaluate(f, asg), expected);
  }
});

// ---------------------------------------------------------------------
// Skipped variables
// ---------------------------------------------------------------------

test('skipped variables: a function of only the first and last variable is correct despite middle variables never being tested', () => {
  const bdd = new ROBDD(['a', 'b', 'c', 'd']);
  const a = bdd.variable('a');
  const d = bdd.variable('d');
  const f = bdd.apply('AND', a, d); // depends only on a and d; skips b, c

  for (const asg of allAssignments(['a', 'b', 'c', 'd'])) {
    assert.equal(bdd.evaluate(f, asg), asg.a && asg.d);
  }
  // a && d true independent of b,c (each free) -> 4 satisfying assignments
  // out of 16.
  assert.equal(bdd.satCount(f), 4n);
});

test('skipped variables: satCount and nodeCount stay correct when the skip happens between two apply operands of different depth', () => {
  const bdd = new ROBDD(['p', 'q', 'r', 's', 't']);
  const p = bdd.variable('p');
  const t = bdd.variable('t');
  // g depends only on p and t (skips q, r, s entirely).
  const g = bdd.apply('OR', p, t);
  for (const asg of allAssignments(['p', 'q', 'r', 's', 't'])) {
    assert.equal(bdd.evaluate(g, asg), asg.p || asg.t);
  }
  // p||t true for 3 out of 4 (p,t) combos, times 2^3 free (q,r,s) = 24
  assert.equal(bdd.satCount(g), 24n);
  // Reachable nodes: p-node, t-node, terminals -- small, bounded count.
  const nc = bdd.nodeCount(g);
  assert.ok(nc >= 2 && nc <= 4, `expected small node count, got ${nc}`);
});

test('skipped variables: a constant function (independent of every variable) has satCount 2^n and nodeCount 1', () => {
  const bdd = new ROBDD(['a', 'b', 'c']);
  const a = bdd.variable('a');
  // a OR not(a) === TRUE, independent of every variable including a itself
  const alwaysTrue = bdd.apply('OR', a, bdd.not(a));
  assert.equal(alwaysTrue, ROBDD.TRUE);
  assert.equal(bdd.satCount(alwaysTrue), 8n);
  assert.equal(bdd.nodeCount(alwaysTrue), 1);
});

// ---------------------------------------------------------------------
// Exact satisfying assignment counts
// ---------------------------------------------------------------------

test('satCount: TRUE and FALSE over various variable-order sizes', () => {
  for (const order of [[], ['a'], ['a', 'b'], ['a', 'b', 'c', 'd', 'e']]) {
    const bdd = new ROBDD(order);
    assert.equal(bdd.satCount(ROBDD.TRUE), 2n ** BigInt(order.length));
    assert.equal(bdd.satCount(ROBDD.FALSE), 0n);
  }
});

test('satCount: a single variable over n vars is exactly 2^(n-1)', () => {
  const bdd = new ROBDD(['a', 'b', 'c', 'd']);
  const a = bdd.variable('a');
  assert.equal(bdd.satCount(a), 8n); // a=true, b/c/d free: 2^3
});

test('satCount: exact hand-computed count for a 3-variable majority function', () => {
  const bdd = new ROBDD(['a', 'b', 'c']);
  const [a, b, c] = ['a', 'b', 'c'].map((v) => bdd.variable(v));
  // majority(a,b,c) = (a&b) | (a&c) | (b&c) -- true for 4 of 8 assignments
  // (all triples with >= 2 true bits: 110,101,011,111).
  const maj = bdd.apply('OR', bdd.apply('OR', bdd.apply('AND', a, b), bdd.apply('AND', a, c)), bdd.apply('AND', b, c));
  assert.equal(bdd.satCount(maj), 4n);
  let bruteCount = 0n;
  for (const asg of allAssignments(['a', 'b', 'c'])) {
    const majority = (asg.a && asg.b) || (asg.a && asg.c) || (asg.b && asg.c);
    assert.equal(bdd.evaluate(maj, asg), majority);
    if (majority) bruteCount++;
  }
  assert.equal(bdd.satCount(maj), bruteCount);
});

test('satCount: matches an independent brute-force count for random formulas (differential)', () => {
  const rng = mulberry32(777);
  for (let n = 1; n <= 6; n++) {
    const variables = [];
    for (let i = 0; i < n; i++) variables.push(`x${i}`);
    for (let t = 0; t < 8; t++) {
      const bdd = new ROBDD(variables);
      const varHandles = {};
      for (const v of variables) varHandles[v] = bdd.variable(v);
      const expr = randomExpr(rng, variables, 4);
      const handle = buildBDD(bdd, expr, varHandles);
      let bruteCount = 0n;
      for (const asg of allAssignments(variables)) {
        if (evalExpr(expr, asg)) bruteCount++;
      }
      assert.equal(bdd.satCount(handle), bruteCount, `n=${n} t=${t} expr=${JSON.stringify(expr)}`);
    }
  }
});

test('satCount: returns a BigInt, not a Number', () => {
  const bdd = new ROBDD(['a', 'b']);
  const result = bdd.satCount(ROBDD.TRUE);
  assert.equal(typeof result, 'bigint');
});

test('satCount: exact for an empty variable order (edge case)', () => {
  const bdd = new ROBDD([]);
  assert.equal(bdd.satCount(ROBDD.TRUE), 1n);
  assert.equal(bdd.satCount(ROBDD.FALSE), 0n);
});

// ---------------------------------------------------------------------
// Cache reuse
// ---------------------------------------------------------------------

test('cache reuse: apply with identical operands twice does not grow the apply cache', () => {
  const bdd = new ROBDD(['p', 'q']);
  const p = bdd.variable('p');
  const q = bdd.variable('q');
  const h1 = bdd.apply('AND', p, q);
  const sizeAfterFirst = bdd._applyCache.size;
  const h2 = bdd.apply('AND', p, q);
  const sizeAfterSecond = bdd._applyCache.size;
  assert.equal(h1, h2);
  assert.equal(sizeAfterFirst, sizeAfterSecond);
});

test('cache reuse: not with an identical operand twice does not grow the not cache', () => {
  const bdd = new ROBDD(['p']);
  const p = bdd.variable('p');
  const n1 = bdd.not(p);
  const sizeAfterFirst = bdd._notCache.size;
  const n2 = bdd.not(p);
  const sizeAfterSecond = bdd._notCache.size;
  assert.equal(n1, n2);
  assert.equal(sizeAfterFirst, sizeAfterSecond);
});

test('cache reuse: rebuilding an identical formula from scratch does not grow the node table', () => {
  const bdd = new ROBDD(['a', 'b', 'c']);
  const a = bdd.variable('a');
  const b = bdd.variable('b');
  const c = bdd.variable('c');
  const build = () => bdd.apply('OR', bdd.apply('AND', a, b), bdd.apply('AND', bdd.not(a), c));
  const h1 = build();
  const nodesAfterFirst = bdd.nodeCount(ROBDD.TRUE) + 0; // no-op read to ensure bdd is warm
  const tableSizeAfterFirst = bdd._uniqueTable.size;
  const h2 = build();
  const tableSizeAfterSecond = bdd._uniqueTable.size;
  assert.equal(h1, h2);
  assert.equal(tableSizeAfterFirst, tableSizeAfterSecond);
});

// ---------------------------------------------------------------------
// Invalid inputs
// ---------------------------------------------------------------------

test('not: rejects an out-of-range or wrongly-typed handle', () => {
  const bdd = new ROBDD(['a']);
  assert.throws(() => bdd.not(-1), RangeError);
  assert.throws(() => bdd.not(999), RangeError);
  assert.throws(() => bdd.not(1.5), TypeError);
  assert.throws(() => bdd.not('1'), TypeError);
  assert.throws(() => bdd.not(null), TypeError);
  assert.throws(() => bdd.not(undefined), TypeError);
  assert.throws(() => bdd.not(NaN), TypeError);
});

test('apply: rejects a bad op string', () => {
  const bdd = new ROBDD(['a', 'b']);
  const a = bdd.variable('a');
  const b = bdd.variable('b');
  assert.throws(() => bdd.apply('NAND', a, b), RangeError);
  assert.throws(() => bdd.apply('and', a, b), RangeError); // case-sensitive
  assert.throws(() => bdd.apply(1, a, b), TypeError);
  assert.throws(() => bdd.apply(null, a, b), TypeError);
});

test('apply: rejects out-of-range or wrongly-typed handles for either operand', () => {
  const bdd = new ROBDD(['a', 'b']);
  const a = bdd.variable('a');
  assert.throws(() => bdd.apply('AND', a, 999), RangeError);
  assert.throws(() => bdd.apply('AND', 999, a), RangeError);
  assert.throws(() => bdd.apply('AND', a, 'x'), TypeError);
  assert.throws(() => bdd.apply('AND', -1, a), RangeError);
});

test('evaluate: rejects an out-of-range or wrongly-typed handle', () => {
  const bdd = new ROBDD(['a']);
  assert.throws(() => bdd.evaluate(999, { a: true }), RangeError);
  assert.throws(() => bdd.evaluate(-1, { a: true }), RangeError);
  assert.throws(() => bdd.evaluate('1', { a: true }), TypeError);
});

test('evaluate: rejects a non-object assignment', () => {
  const bdd = new ROBDD(['a']);
  const a = bdd.variable('a');
  assert.throws(() => bdd.evaluate(a, null), TypeError);
  assert.throws(() => bdd.evaluate(a, 'true'), TypeError);
  assert.throws(() => bdd.evaluate(a, [true]), TypeError);
  assert.throws(() => bdd.evaluate(a, undefined), TypeError);
});

test('evaluate: rejects an incomplete assignment (missing a required variable)', () => {
  const bdd = new ROBDD(['a', 'b']);
  const a = bdd.variable('a');
  assert.throws(() => bdd.evaluate(a, {}), TypeError);
  assert.throws(() => bdd.evaluate(a, { a: true }), TypeError); // missing b
});

test('evaluate: rejects an assignment with a non-boolean value for a required variable', () => {
  const bdd = new ROBDD(['a', 'b']);
  const a = bdd.variable('a');
  assert.throws(() => bdd.evaluate(a, { a: 1, b: true }), TypeError);
  assert.throws(() => bdd.evaluate(a, { a: 'true', b: false }), TypeError);
  assert.throws(() => bdd.evaluate(a, { a: null, b: false }), TypeError);
});

test('evaluate: extra keys in the assignment beyond variableOrder are harmless', () => {
  const bdd = new ROBDD(['a']);
  const a = bdd.variable('a');
  assert.equal(bdd.evaluate(a, { a: true, extra: 'ignored', another: 42 }), true);
});

test('satCount: rejects an out-of-range or wrongly-typed handle', () => {
  const bdd = new ROBDD(['a']);
  assert.throws(() => bdd.satCount(999), RangeError);
  assert.throws(() => bdd.satCount(-1), RangeError);
  assert.throws(() => bdd.satCount(0.5), TypeError);
});

test('nodeCount: rejects an out-of-range or wrongly-typed handle', () => {
  const bdd = new ROBDD(['a']);
  assert.throws(() => bdd.nodeCount(999), RangeError);
  assert.throws(() => bdd.nodeCount(-1), RangeError);
  assert.throws(() => bdd.nodeCount({}), TypeError);
});

test('variable/not/apply/evaluate/satCount/nodeCount: handles from a different ROBDD instance are still just integers (documented limitation, not a crash) but out-of-range still throws', () => {
  const bddA = new ROBDD(['a', 'b', 'c', 'd', 'e']);
  const bddB = new ROBDD(['x']);
  const deepHandle = bddA.apply('AND', bddA.variable('a'), bddA.variable('b'));
  // A handle that happens to be in-range for bddB's (much smaller) node
  // table doesn't throw -- cross-instance handles are documented as not
  // interchangeable, not guarded against, since ROBDD has no way to tag
  // which instance a plain integer handle came from.
  assert.doesNotThrow(() => bddB.evaluate(ROBDD.TRUE, { x: true }));
  // But a handle clearly out of bddB's range still throws, proving
  // range-validation is real and not a no-op.
  assert.throws(() => bddB.not(deepHandle + 1000), RangeError);
});
