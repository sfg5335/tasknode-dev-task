'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { earleyRecognize } = require('./earley-recognizer.js');

// ---------------------------------------------------------------------------
// Basic acceptance / rejection
// ---------------------------------------------------------------------------

test('accepts an exact terminal sequence', () => {
  const grammar = { S: [['a', 'b']] };
  assert.equal(earleyRecognize(grammar, 'S', ['a', 'b']), true);
});

test('rejects a mismatched terminal', () => {
  const grammar = { S: [['a', 'b']] };
  assert.equal(earleyRecognize(grammar, 'S', ['a', 'c']), false);
});

test('rejects a too-short input', () => {
  const grammar = { S: [['a', 'b']] };
  assert.equal(earleyRecognize(grammar, 'S', ['a']), false);
});

test('rejects a too-long input', () => {
  const grammar = { S: [['a', 'b']] };
  assert.equal(earleyRecognize(grammar, 'S', ['a', 'b', 'c']), false);
});

test('rejects when start nonterminal has zero productions (uninhabited, not an error)', () => {
  const grammar = { S: [], T: [['x']] };
  assert.equal(earleyRecognize(grammar, 'S', []), false);
  assert.equal(earleyRecognize(grammar, 'S', ['x']), false);
});

test('accepts choosing between alternative productions', () => {
  const grammar = { S: [['a'], ['b'], ['c']] };
  assert.equal(earleyRecognize(grammar, 'S', ['a']), true);
  assert.equal(earleyRecognize(grammar, 'S', ['b']), true);
  assert.equal(earleyRecognize(grammar, 'S', ['c']), true);
  assert.equal(earleyRecognize(grammar, 'S', ['d']), false);
});

// ---------------------------------------------------------------------------
// Symbols absent from grammar keys are terminals; exact string matching
// ---------------------------------------------------------------------------

test('a symbol not present as a grammar key is treated as a terminal', () => {
  const grammar = { S: [['x', 'y']] }; // x, y are never LHS keys
  assert.equal(earleyRecognize(grammar, 'S', ['x', 'y']), true);
});

test('terminal matching is exact-string, case-sensitive, no coercion', () => {
  const grammar = { S: [['a']] };
  assert.equal(earleyRecognize(grammar, 'S', ['A']), false);
  assert.equal(earleyRecognize(grammar, 'S', ['a ']), false);
  assert.equal(earleyRecognize(grammar, 'S', [' a']), false);
});

test('a terminal named like an Object.prototype member is not confused with a nonterminal', () => {
  // hasOwnProperty-based nonterminal detection must not be fooled by
  // inherited Object.prototype members (constructor, toString, etc.).
  const grammar = { S: [['constructor', 'toString', 'hasOwnProperty']] };
  assert.equal(
    earleyRecognize(grammar, 'S', ['constructor', 'toString', 'hasOwnProperty']),
    true
  );
  assert.equal(earleyRecognize(grammar, 'S', ['constructor']), false);
});

// ---------------------------------------------------------------------------
// Epsilon rules / nullable chains / nullable cycles
// ---------------------------------------------------------------------------

test('an epsilon production accepts the empty input', () => {
  const grammar = { S: [[]] };
  assert.equal(earleyRecognize(grammar, 'S', []), true);
  assert.equal(earleyRecognize(grammar, 'S', ['x']), false);
});

test('a nullable nonterminal reached via a chain of productions accepts the empty input', () => {
  const grammar = { S: [['A']], A: [[]] };
  assert.equal(earleyRecognize(grammar, 'S', []), true);
});

test('a nullable nonterminal in the middle of a production is correctly skippable', () => {
  const grammar = { S: [['x', 'A', 'y']], A: [[]] };
  assert.equal(earleyRecognize(grammar, 'S', ['x', 'y']), true);
  assert.equal(earleyRecognize(grammar, 'S', ['x', 'A', 'y']), false); // 'A' is a nonterminal, not literal text
});

test('a nullable nonterminal can also still match its non-empty alternative', () => {
  const grammar = { S: [['A', 'end']], A: [['mid'], []] };
  assert.equal(earleyRecognize(grammar, 'S', ['mid', 'end']), true);
  assert.equal(earleyRecognize(grammar, 'S', ['end']), true);
});

test('nullable-chain ordering: a nonterminal that becomes nullable only transitively, ' +
  'referenced by an item constructed after that transitive nullability was already ' +
  'available, is still correctly resolved (regression test for a real algorithmic bug: ' +
  'a naive single-pass Earley worklist that only re-scans for completions when a ' +
  '*complete* item is processed can permanently miss this case; see the nullable-skip ' +
  'fix in the implementation)', () => {
  // S -> R Q ; R -> N ; Q -> M N ; M -> [] ; N -> [].
  // Verified directly (in the same investigation that produced this test) that an
  // implementation of this same chart algorithm MINUS the nullable-skip fix returns
  // false here -- i.e. this is not a hypothetical, it is a confirmed-reproducible bug
  // this test guards against.
  const grammar = {
    S: [['R', 'Q']],
    R: [['N']],
    Q: [['M', 'N']],
    M: [[]],
    N: [[]],
  };
  assert.equal(earleyRecognize(grammar, 'S', []), true);
});

test('nullable cycle: mutually-recursive nonterminals resolve to a nullable fixpoint ' +
  'without infinite-looping', () => {
  // A -> B | [] ; B -> A. A and B are each nullable only because of the OTHER.
  const grammar = { S: [['A']], A: [['B'], []], B: [['A']] };
  assert.equal(earleyRecognize(grammar, 'S', []), true);
});

test('nullable cycle with a non-nullable escape still recognizes non-empty input', () => {
  const grammar = { S: [['A']], A: [['B'], []], B: [['A'], ['x']] };
  assert.equal(earleyRecognize(grammar, 'S', ['x']), true);
  assert.equal(earleyRecognize(grammar, 'S', []), true);
  assert.equal(earleyRecognize(grammar, 'S', ['y']), false);
});

test('all-nullable long production resolves via chained nullable-skips', () => {
  const grammar = {
    S: [['A', 'B', 'C', 'D', 'E']],
    A: [[]],
    B: [[]],
    C: [[]],
    D: [[]],
    E: [[]],
  };
  assert.equal(earleyRecognize(grammar, 'S', []), true);
});

// ---------------------------------------------------------------------------
// Left recursion (direct and indirect)
// ---------------------------------------------------------------------------

test('direct left recursion: left-associative expression grammar', () => {
  const grammar = { E: [['E', '+', 'T'], ['T']], T: [['id']] };
  assert.equal(earleyRecognize(grammar, 'E', ['id']), true);
  assert.equal(earleyRecognize(grammar, 'E', ['id', '+', 'id']), true);
  assert.equal(earleyRecognize(grammar, 'E', ['id', '+', 'id', '+', 'id', '+', 'id']), true);
  assert.equal(earleyRecognize(grammar, 'E', ['id', '+']), false);
  assert.equal(earleyRecognize(grammar, 'E', ['+', 'id']), false);
});

test('indirect left recursion: A -> B x, B -> A y | z', () => {
  const grammar = { A: [['B', 'x']], B: [['A', 'y'], ['z']] };
  // Shortest derivation: A -> B x -> z x.
  assert.equal(earleyRecognize(grammar, 'A', ['z', 'x']), true);
  // A -> B x -> A y x -> B x y x -> z x y x.
  assert.equal(earleyRecognize(grammar, 'A', ['z', 'x', 'y', 'x']), true);
  assert.equal(earleyRecognize(grammar, 'A', ['z']), false);
});

// ---------------------------------------------------------------------------
// Ambiguous grammars
// ---------------------------------------------------------------------------

test('an ambiguous grammar (multiple valid parses) still recognizes correctly', () => {
  const grammar = { E: [['E', '+', 'E'], ['id']] };
  assert.equal(earleyRecognize(grammar, 'E', ['id']), true);
  assert.equal(earleyRecognize(grammar, 'E', ['id', '+', 'id']), true);
  // Genuinely ambiguous: id+id+id parses as (id+id)+id or id+(id+id).
  assert.equal(earleyRecognize(grammar, 'E', ['id', '+', 'id', '+', 'id']), true);
  assert.equal(earleyRecognize(grammar, 'E', ['id', '+', 'id', '+', 'id', '+', 'id', '+', 'id']), true);
  assert.equal(earleyRecognize(grammar, 'E', ['id', '+']), false);
});

test('an ambiguous grammar with an epsilon alternative does not spuriously accept', () => {
  const grammar = { S: [['S', 'S'], ['a'], []] };
  assert.equal(earleyRecognize(grammar, 'S', []), true);
  assert.equal(earleyRecognize(grammar, 'S', ['a']), true);
  assert.equal(earleyRecognize(grammar, 'S', ['a', 'a', 'a']), true);
  assert.equal(earleyRecognize(grammar, 'S', ['a', 'b']), false);
});

// ---------------------------------------------------------------------------
// Recursive nesting
// ---------------------------------------------------------------------------

test('recursive nesting: balanced-parenthesis grammar accepts deep nesting', () => {
  const grammar = { S: [['(', 'S', ')'], []] };
  for (const depth of [0, 1, 2, 5, 20]) {
    const tokens = [...Array(depth).fill('('), ...Array(depth).fill(')')];
    assert.equal(earleyRecognize(grammar, 'S', tokens), true, `depth ${depth} should accept`);
  }
});

test('recursive nesting: balanced-parenthesis grammar rejects imbalance', () => {
  const grammar = { S: [['(', 'S', ')'], []] };
  assert.equal(earleyRecognize(grammar, 'S', ['(', '(', ')']), false);
  assert.equal(earleyRecognize(grammar, 'S', ['(', ')', ')']), false);
  assert.equal(earleyRecognize(grammar, 'S', [')', '(']), false);
});

test('recursive nesting: a grammar for nested lists of digits', () => {
  const grammar = {
    List: [['[', 'Items', ']']],
    Items: [['Item'], ['Item', ',', 'Items'], []],
    Item: [['0'], ['1'], ['List']],
  };
  assert.equal(earleyRecognize(grammar, 'List', ['[', ']']), true);
  assert.equal(earleyRecognize(grammar, 'List', ['[', '0', ']']), true);
  assert.equal(earleyRecognize(grammar, 'List', ['[', '0', ',', '1', ',', '0', ']']), true);
  assert.equal(
    earleyRecognize(grammar, 'List', ['[', '[', '0', ',', '1', ']', ',', '[', ']', ']']),
    true
  );
  // Trailing comma is actually legal under this grammar (Items -> Item , Items,
  // and Items itself can be empty) -- confirmed interactively before writing this
  // assertion, per the project's "trace before asserting" discipline. Genuinely
  // invalid strings for this grammar instead: a leading comma (Items can never
  // start with a literal ',' token) or a double comma (same reason, mid-list).
  assert.equal(earleyRecognize(grammar, 'List', ['[', '0', ',', ']']), true);
  assert.equal(earleyRecognize(grammar, 'List', ['[', ',', '0', ']']), false);
  assert.equal(earleyRecognize(grammar, 'List', ['[', '0', ',', ',', '1', ']']), false);
});

// ---------------------------------------------------------------------------
// Repeated calls (no leaked/shared state between invocations)
// ---------------------------------------------------------------------------

test('repeated calls with the same grammar produce consistent results', () => {
  const grammar = { S: [['a', 'S', 'b'], []] };
  for (let i = 0; i < 5; i++) {
    assert.equal(earleyRecognize(grammar, 'S', ['a', 'a', 'b', 'b']), true);
    assert.equal(earleyRecognize(grammar, 'S', ['a', 'b', 'b']), false);
  }
});

test('repeated calls with different grammars do not interfere with each other', () => {
  const grammarA = { S: [['a']] };
  const grammarB = { S: [['b']] };
  assert.equal(earleyRecognize(grammarA, 'S', ['a']), true);
  assert.equal(earleyRecognize(grammarB, 'S', ['b']), true);
  assert.equal(earleyRecognize(grammarA, 'S', ['b']), false);
  assert.equal(earleyRecognize(grammarB, 'S', ['a']), false);
  assert.equal(earleyRecognize(grammarA, 'S', ['a']), true);
});

// ---------------------------------------------------------------------------
// Input immutability
// ---------------------------------------------------------------------------

test('does not mutate the grammar object, its production arrays, or its symbol strings', () => {
  const grammar = {
    S: [['A', 'x'], []],
    A: [['y', 'A'], []],
  };
  const snapshot = JSON.parse(JSON.stringify(grammar));
  earleyRecognize(grammar, 'S', ['y', 'y', 'x']);
  earleyRecognize(grammar, 'S', []);
  earleyRecognize(grammar, 'S', ['bogus']);
  assert.deepEqual(grammar, snapshot);
});

test('does not mutate the tokens array', () => {
  const grammar = { S: [['a', 'b', 'c']] };
  const tokens = ['a', 'b', 'c'];
  const snapshot = tokens.slice();
  earleyRecognize(grammar, 'S', tokens);
  assert.deepEqual(tokens, snapshot);
});

test('mutating the caller-side grammar/tokens after a call does not retroactively affect ' +
  'that already-returned result', () => {
  const grammar = { S: [['a']] };
  const tokens = ['a'];
  const result = earleyRecognize(grammar, 'S', tokens);
  grammar.S.push(['b']);
  tokens.push('extra');
  assert.equal(result, true); // the primitive boolean already returned is of course unaffected
});

// ---------------------------------------------------------------------------
// Empty input
// ---------------------------------------------------------------------------

test('empty input is rejected against a grammar with no nullable path', () => {
  const grammar = { S: [['a']] };
  assert.equal(earleyRecognize(grammar, 'S', []), false);
});

test('empty input is accepted against a directly-nullable start symbol', () => {
  const grammar = { S: [[]] };
  assert.equal(earleyRecognize(grammar, 'S', []), true);
});

// ---------------------------------------------------------------------------
// Malformed grammars -> TypeError
// ---------------------------------------------------------------------------

test('throws TypeError when grammar is not a plain object', () => {
  for (const bad of [null, undefined, 42, 'S', true, ['S'], () => {}]) {
    assert.throws(() => earleyRecognize(bad, 'S', []), TypeError);
  }
});

test('throws TypeError when a grammar entry is not an array of productions', () => {
  assert.throws(() => earleyRecognize({ S: 'not-an-array' }, 'S', []), TypeError);
  assert.throws(() => earleyRecognize({ S: null }, 'S', []), TypeError);
  assert.throws(() => earleyRecognize({ S: { 0: ['a'] } }, 'S', []), TypeError);
});

test('throws TypeError when a production is not an array of symbols', () => {
  assert.throws(() => earleyRecognize({ S: ['not-an-array'] }, 'S', []), TypeError);
  assert.throws(() => earleyRecognize({ S: [null] }, 'S', []), TypeError);
  assert.throws(() => earleyRecognize({ S: [42] }, 'S', []), TypeError);
});

test('throws TypeError when a symbol within a production is not a string', () => {
  assert.throws(() => earleyRecognize({ S: [[42]] }, 'S', []), TypeError);
  assert.throws(() => earleyRecognize({ S: [[null]] }, 'S', []), TypeError);
  assert.throws(() => earleyRecognize({ S: [[['nested']]] }, 'S', []), TypeError);
  assert.throws(() => earleyRecognize({ S: [[{ toString: () => 'x' }]] }, 'S', []), TypeError);
});

test('throws TypeError when start is not a string', () => {
  const grammar = { S: [['a']] };
  for (const bad of [42, null, undefined, ['S'], { S: true }]) {
    assert.throws(() => earleyRecognize(grammar, bad, []), TypeError);
  }
});

// ---------------------------------------------------------------------------
// Missing start symbol -> RangeError
// ---------------------------------------------------------------------------

test('throws RangeError when start symbol has no key in grammar', () => {
  const grammar = { S: [['a']] };
  assert.throws(() => earleyRecognize(grammar, 'T', ['a']), RangeError);
  assert.throws(() => earleyRecognize(grammar, '', ['a']), RangeError);
});

test('missing-start-symbol RangeError is distinct from the TypeError cases above', () => {
  const grammar = { S: [['a']] };
  assert.throws(() => earleyRecognize(grammar, 'nonexistent', []), (err) => err instanceof RangeError && !(err instanceof TypeError));
});

// ---------------------------------------------------------------------------
// Invalid token arrays -> TypeError
// ---------------------------------------------------------------------------

test('throws TypeError when tokens is not an array', () => {
  const grammar = { S: [['a']] };
  for (const bad of [null, undefined, 'a', 42, { 0: 'a', length: 1 }]) {
    assert.throws(() => earleyRecognize(grammar, 'S', bad), TypeError);
  }
});

test('throws TypeError when tokens contains a non-string element', () => {
  const grammar = { S: [['a']] };
  assert.throws(() => earleyRecognize(grammar, 'S', [42]), TypeError);
  assert.throws(() => earleyRecognize(grammar, 'S', [null]), TypeError);
  assert.throws(() => earleyRecognize(grammar, 'S', ['a', undefined]), TypeError);
  assert.throws(() => earleyRecognize(grammar, 'S', [['a']]), TypeError);
});

// ---------------------------------------------------------------------------
// Differential / brute-force cross-check for a bounded grammar family
// ---------------------------------------------------------------------------

test('matches a brute-force reference recognizer for every binary string up to length 12 ' +
  'against an "equal count of 0s and 1s" context-free grammar', () => {
  // Classic non-regular CFL: S -> [] | 0 S 1 | 1 S 0 | S S.
  const grammar = { S: [[], ['0', 'S', '1'], ['1', 'S', '0'], ['S', 'S']] };

  function bruteForceEqualCount(tokens) {
    if (tokens.length % 2 !== 0) return false;
    let zeros = 0;
    for (const t of tokens) {
      if (t === '0') zeros++;
      else if (t === '1') { /* count implicitly via length - zeros */ }
      else return false;
    }
    // Equal-count-of-0s-and-1s is a necessary condition for this grammar's
    // language, and (for this specific well-known grammar) also sufficient.
    return zeros === tokens.length / 2;
  }

  function* allBinaryStrings(maxLen) {
    for (let len = 0; len <= maxLen; len++) {
      const total = 2 ** len;
      for (let mask = 0; mask < total; mask++) {
        const tokens = [];
        for (let bit = len - 1; bit >= 0; bit--) {
          tokens.push((mask >> bit) & 1 ? '1' : '0');
        }
        yield tokens;
      }
    }
  }

  let checked = 0;
  for (const tokens of allBinaryStrings(12)) {
    const expected = bruteForceEqualCount(tokens);
    const actual = earleyRecognize(grammar, 'S', tokens);
    assert.equal(actual, expected, `mismatch on ${JSON.stringify(tokens)}`);
    checked++;
  }
  assert.equal(checked, 2 ** 13 - 1); // sum of 2^0 .. 2^12
});

// ---------------------------------------------------------------------------
// Performance sanity check: dedup keeps a highly ambiguous grammar fast
// ---------------------------------------------------------------------------

test('a highly ambiguous grammar with exponentially many parses still recognizes ' +
  'a moderately long input quickly (chart deduplication keeps the state space polynomial)', () => {
  const grammar = { E: [['E', '+', 'E'], ['id']] };
  const tokens = [];
  for (let i = 0; i < 60; i++) {
    if (i > 0) tokens.push('+');
    tokens.push('id');
  }
  const start = Date.now();
  const result = earleyRecognize(grammar, 'E', tokens);
  const elapsedMs = Date.now() - start;
  assert.equal(result, true);
  assert.ok(elapsedMs < 2000, `expected well under 2000ms for a polynomial-size chart, took ${elapsedMs}ms`);
});
