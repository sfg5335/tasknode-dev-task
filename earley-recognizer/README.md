# Deterministic Earley Recognizer

`earleyRecognize(grammar, start, tokens)` — a dependency-free implementation of the classic
Earley (1970) chart-parsing algorithm, used here purely as a *recognizer* (accept/reject a
token sequence against a context-free grammar), not a full parser (no parse forest/tree is
built or returned).

## Grammar format

`grammar` is a plain object mapping nonterminal names (strings) to an array of productions.
Each production is itself an array of symbols (strings). An empty production array (`[]`)
represents an epsilon (empty-string) production. Any symbol that is **not** a key of the
grammar object is treated as a terminal, matched by exact string equality against the input
tokens — there is no separate terminal-alphabet declaration.

```js
const grammar = {
  E: [['E', '+', 'T'], ['T']],
  T: [['id'], ['(', 'E', ')']],
};
earleyRecognize(grammar, 'E', ['id', '+', 'id']); // true
earleyRecognize(grammar, 'E', ['id', '+']);        // false
```

`earleyRecognize` returns a plain `boolean`. It throws (rather than returning `false`) only
for structurally invalid arguments — see **Input validation** below.

## Algorithm

The standard Earley chart-parsing recognizer: for each input position `i` (`0..tokens.length`),
maintain a deduplicated set of items `{ rule, dot, origin }` (`rule` identifies which
production, `dot` is how far into that production's right-hand side we've matched, `origin` is
the chart position this match began at), built up via three operations applied to a fixpoint at
each position:

- **Prediction**: for an item expecting a nonterminal `B` next, add every one of `B`'s own
  productions as a fresh dot-0 item at the same position.
- **Scanning**: for an item expecting a terminal next, if it exactly matches the current input
  token, advance the item into the *next* chart position.
- **Completion**: when an item is complete (`dot === rhs.length`, spanning `[origin, i)`),
  advance every item in `chart[origin]` that was waiting for this item's left-hand side next.

The input is accepted iff `chart[tokens.length]` contains a complete item for a `start`-symbol
production with `origin === 0`.

### The nullable-symbol fix (why this matters for *correctness*, not just style)

A naive version of the above — one that only re-scans for completions when a *complete* item is
popped off the per-position work queue — has a genuine, reproducible bug for grammars where a
nonterminal becomes nullable only *transitively*, and an item that will end up expecting that
nonterminal is constructed (via some other completion) *after* the nonterminal's own epsilon
completion has already run its one-time completion scan at that position. Concretely:

```js
// S -> R Q ; R -> N ; Q -> M N ; M -> [] ; N -> [].
const grammar = { S: [['R', 'Q']], R: [['N']], Q: [['M', 'N']], M: [[]], N: [[]] };
```

`S` can derive the empty string (`R` derives `N` derives `ε`; `Q` derives `M N` derives `ε ε`).
An implementation of the exact same chart algorithm *minus* the fix below was built and run
against this grammar during development, purely to confirm the bug is real rather than
hypothetical — it returns `false`, incorrectly rejecting the empty string. (That confirmation
script is not part of the committed test suite, since it exists to test a *removed* code path,
not this implementation — but the grammar above is used as `earley-recognizer.test.js`'s
dedicated "nullable-chain ordering" regression test, which does pass against the real,
fixed implementation.)

**The fix** (following Aycock & Horspool, "Practical Earley Parsing", 2002): precompute, once
per call and independent of chart position, the set of nonterminals that can derive the empty
string (a standard grammar-level fixpoint: a nonterminal is nullable if it has an epsilon
production, or a production consisting entirely of already-nullable symbols — iterated until no
more nonterminals are added, which also correctly resolves mutually-dependent "nullable cycles"
like `A -> B`, `B -> A`, `A -> []`). Then, during prediction, whenever the next expected symbol
`B` is nullable, *immediately* also add the item with `B` skipped (dot advanced past it) at the
same chart position — unconditionally, at prediction time, so it can never depend on whether
some other item's completion step has or hasn't run yet. This is provably sufficient on its own
(traced by hand for the example grammar above during development); the classic completion-based
path is kept anyway as a harmless, deduplication-protected, uniform code path rather than
special-casing `origin === i` out of it.

### Left recursion and ambiguity

Both are handled for free by the chart/dedup approach: left recursion (direct, e.g. `E -> E + T`,
or indirect, e.g. `A -> B x`, `B -> A y`) does not infinite-loop because each `(rule, dot, origin)`
triple is only ever added to a chart position once; ambiguity (multiple valid derivations of the
same span) does not cause incorrect results or a combinatorial blowup in *recognition* time
because the recognizer never enumerates parse trees — it only tracks item *sets*, and the
deduplicated state space per position is bounded by `O(#rules * maxProductionLength)`,
independent of how many distinct derivations exist. A dedicated test exercises a grammar with
exponentially many parses (`E -> E + E | id` over 60 `id` tokens) to confirm recognition stays
fast in practice, not just in theory.

## Input validation

- `grammar` must be a plain object (not `null`, not an array); each value must be an array of
  productions; each production must be an array of string symbols. Any violation throws
  `TypeError`.
- `start` must be a string. Otherwise: `TypeError`.
- `start` must be a key of `grammar` (i.e. have productions defined, even if that array is
  empty — an empty array is treated as "this nonterminal is a valid but currently uninhabited
  nonterminal", not an error, and simply means nothing can ever derive from it). If `start` is
  not present as a key at all: `RangeError` ("missing start symbol").
- `tokens` must be an array of strings. Any violation throws `TypeError`.

Nonterminal-vs-terminal detection uses `Object.prototype.hasOwnProperty.call(grammar, symbol)`
rather than `symbol in grammar` or property access, so a terminal symbol that happens to share a
name with an inherited `Object.prototype` member (`constructor`, `toString`,
`hasOwnProperty`, ...) is still correctly treated as an ordinary terminal — tested explicitly.

## Immutability

`earleyRecognize` never mutates `grammar`, its nested production arrays, or `tokens`. Internally
it takes its own defensive copy of every production (`production.slice()`) before use, and only
ever *reads* from the caller's `tokens` array (`tokens[i] === nextSymbol`). Tested by taking a
deep snapshot before several calls (including calls that throw) and asserting deep-equality
against the snapshot afterward, and separately by mutating the caller's own grammar/tokens
*after* a call returns and confirming the call is unaffected (trivially true for an already-
returned primitive, included for completeness/documentation of the guarantee).

## Complexity and implementation notes

- Time: the standard Earley bounds apply — O(n³) worst case for arbitrary context-free
  grammars, O(n²) for unambiguous grammars, O(n) for a bounded-state ("LR-regular"-like)
  subclass — where n is `tokens.length`. Space: O(n²) chart entries worst case.
  Deduplication (`Set` keyed by `` `${rule}|${dot}|${origin}` ``) is what keeps ambiguous
  grammars from blowing up the item count.
- The algorithm is iterative (an outer loop over chart positions, an inner growing-worklist
  loop over each position's items), never recursive — so there is no call-stack-depth risk
  from deeply nested or deeply left-recursive grammars, unlike a naive recursive-descent
  parser.
- Rule identity: all of `grammar`'s productions are flattened once per call into a flat,
  numerically-indexed array (`rules`), giving every `(lhs, production)` pair a stable integer
  id used as part of each item's dedup key. This is purely an internal, call-local
  implementation detail; it is not observable from the public API.

## Testing

`earley-recognizer.test.js` — 42 `node:test` cases: basic acceptance/rejection (exact match,
too-short, too-long, alternative productions, uninhabited start symbol); symbols absent from
grammar keys as terminals with exact case-sensitive string matching (including an
`Object.prototype`-member-named terminal, guarding the `hasOwnProperty`-based nonterminal
check); epsilon rules, nullable chains, and nullable cycles, including the dedicated
nullable-chain-ordering regression test described above and an all-nullable five-symbol
production exercising chained nullable-skips; direct and indirect left recursion; ambiguous
grammars (including one with both a binary-alternative production and an epsilon alternative,
checked for no spurious acceptance); recursive nesting (balanced parentheses to depth 20,
imbalance rejection, a nested-list-of-digits grammar); repeated calls with the same and with
different grammars (no shared/leaked state); input immutability (grammar, productions, tokens);
empty input, both accepted and rejected depending on the grammar; the full malformed-grammar /
missing-start-symbol / invalid-token-array error matrix (`TypeError` vs. `RangeError`, verified
distinct); an exhaustive differential cross-check against an independent brute-force reference
recognizer for every binary string up to length 12 (8191 strings) against a classic
non-regular "equal count of 0s and 1s" context-free grammar; and a performance sanity check for
a highly ambiguous 60-token input.

`test-output.txt` — raw `node --test` output, 42/42 passing, Node v22.22.2.

An additional, uncommitted seeded-random + exhaustive-small-alphabet differential stress
harness (`/tmp/earley-stress.js` at development time, not part of this commit) cross-checked
`earleyRecognize` against an independently-implemented, structurally different reference
recognizer (a memoized "does this span derive this substring" checker trying every split point,
deliberately *not* chart/Earley-based) across 7 hand-picked grammars swept exhaustively over
their small alphabets up to length 8 (or 6 for the most combinatorially expensive one) plus 300
seeded-random small grammars against random short token strings — **90,309 total checks, 0
mismatches** — the eleventh task in a row with zero genuine *implementation* bugs found during
stress testing (see "Design notes" below for the one genuine bug this development process did
catch, which was in a hand-written *test fixture*, not the implementation).

## Design notes / decisions made where the spec left something open

- **"Recognizer" (not parser)**: the task title and `earleyRecognize` naming both indicate a
  boolean accept/reject function, not a parse-tree builder — implemented accordingly. No parse
  forest, derivation, or ambiguity count is constructed or returned.
- **Uninhabited-but-declared start symbol** (`grammar[start] = []`, zero productions) is treated
  as a valid grammar (always rejects, since nothing can ever derive from it) rather than an
  error, distinct from a start symbol that isn't a key in `grammar` at all (which *is* an error
  — "missing start symbol", `RangeError`). This distinction seemed like the more useful, more
  precisely-diagnosable behavior than collapsing both cases into one error type.
- **`TypeError` vs. `RangeError`**: malformed *shape* (wrong JS types anywhere in `grammar`,
  `start`, or `tokens`) throws `TypeError`; a well-shaped grammar that is missing the specific
  `start` key throws `RangeError`, since that's a value-domain problem (this particular grammar
  doesn't define this particular symbol) rather than a type problem — consistent with this
  project's established convention of deriving the `TypeError`-vs-`RangeError` split from each
  task's own spec wording (here: "missing start symbols" is called out as its own listed test
  category, distinct from "malformed grammars").

## One genuine bug found during development — in a hand-written test fixture, not the implementation

While first writing the "recursive nesting: a grammar for nested lists of digits" test, an
assertion claimed `['[', '0', ',', ']']` (i.e. `[0,]`, a trailing comma) should be *rejected* by
the grammar `Items: [['Item'], ['Item', ',', 'Items'], []]`. Interactively tracing it (per this
project's "trace before asserting" discipline) showed the opposite: `Items -> Item , Items`
with the trailing `Items` matching its own `[]` (epsilon) alternative means `Item ,` — i.e. a
single item followed by a trailing comma and nothing else — **is** a valid derivation under this
specific grammar, so `earleyRecognize` returning `true` for `[0,]` was correct, and the test's
original expectation was the actual bug. Fixed by correcting the test to assert `true` there,
and adding two separately-verified genuinely-invalid fixtures (`[,0]`, leading comma; and
`[0,,1]`, doubled comma) as the negative cases instead. Caught before any code was committed,
consistent with the project's "run `node --test` before commit, never skip this step" rule.
