'use strict';

// Deterministic Earley Recognizer for context-free grammars.
//
// Grammar format: a plain object mapping nonterminal names (strings) to an
// array of productions. Each production is itself an array of symbols
// (strings). An empty production array (`[]`) represents an epsilon
// (empty-string) production. Any symbol that is NOT a key of the grammar
// object is treated as a terminal, matched by exact string equality against
// the input tokens -- there is no separate "terminal alphabet" to declare.
//
// `earleyRecognize(grammar, start, tokens)` returns a boolean: true if
// `tokens` (an array of terminal strings) can be derived from the `start`
// nonterminal under `grammar`, false otherwise. It never mutates `grammar`
// or `tokens`, and it throws (rather than returning false) only for
// structurally invalid arguments -- see the validation section below.
//
// Algorithm: the classic Earley (1970) chart-parsing recognizer --
// prediction, scanning, and completion over per-position item sets ("chart
// entries") -- with the nullable-symbol fix described by Aycock & Horspool,
// "Practical Earley Parsing" (2002). That fix matters for correctness, not
// just performance: a naive single-pass worklist implementation that only
// triggers completion when a *complete* item is popped from the queue can
// permanently miss advancing an item that starts expecting an
// already-nullable nonterminal *after* that nonterminal's own epsilon
// completion has already been processed at the same chart position (see
// the "nullable chain ordering" design note further down for a concrete
// grammar that exposes this). The fix: precompute, once per call and
// independent of chart position, which nonterminals are NULLABLE (can
// derive the empty string), via a fixpoint over the whole grammar. Then,
// whenever prediction reaches an item expecting a nullable nonterminal B,
// immediately also add the item with B "skipped" (dot advanced past B) at
// the same chart position -- this happens unconditionally at prediction
// time, so it can never depend on completion processing order.
//
// Items are represented as { rule, dot, origin }, where `rule` is an index
// into a flat, call-local array of { lhs, rhs } productions (assigning a
// stable numeric identity to "which production, which right-hand side" is
// what lets item deduplication be a simple string-keyed Set lookup), `dot`
// is how many symbols of that production have been matched so far, and
// `origin` is the chart position where this item's match began. An item is
// "complete" when `dot === rhs.length`; the recognizer accepts iff
// chart[tokens.length] contains a complete item for the `start` symbol's
// own production with `origin === 0`.

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function validateGrammar(grammar) {
  if (!isPlainObject(grammar)) {
    throw new TypeError(
      `grammar must be a plain object mapping nonterminal names to arrays of productions, got ${grammar === null ? 'null' : Array.isArray(grammar) ? 'an array' : typeof grammar}`
    );
  }
  for (const lhs of Object.keys(grammar)) {
    const productions = grammar[lhs];
    if (!Array.isArray(productions)) {
      throw new TypeError(
        `grammar['${lhs}'] must be an array of productions, got ${productions === null ? 'null' : typeof productions}`
      );
    }
    productions.forEach((production, prodIdx) => {
      if (!Array.isArray(production)) {
        throw new TypeError(
          `grammar['${lhs}'][${prodIdx}] must be an array of symbols (use [] for an epsilon production), got ${production === null ? 'null' : typeof production}`
        );
      }
      production.forEach((symbol, symIdx) => {
        if (typeof symbol !== 'string') {
          throw new TypeError(
            `grammar['${lhs}'][${prodIdx}][${symIdx}] must be a string symbol, got ${typeof symbol}`
          );
        }
      });
    });
  }
}

function validateTokens(tokens) {
  if (!Array.isArray(tokens)) {
    throw new TypeError(`tokens must be an array of strings, got ${tokens === null ? 'null' : typeof tokens}`);
  }
  tokens.forEach((token, idx) => {
    if (typeof token !== 'string') {
      throw new TypeError(`tokens[${idx}] must be a string, got ${typeof token}`);
    }
  });
}

// Fixpoint computation of the set of nonterminals that can derive the empty
// string. A nonterminal is nullable iff at least one of its productions
// consists entirely of (already known, or vacuously -- for an empty
// production -- zero) nullable symbols. Terminals are never nullable (they
// never appear in the running `nullable` set, so any production containing
// a terminal is correctly excluded). Runs to a fixpoint rather than a
// single pass so that mutually-dependent ("nullable cycle") nonterminals
// like `A -> B`, `B -> A`, `A -> []` resolve correctly regardless of
// declaration order; termination is guaranteed because `nullable` only
// grows and is bounded by the finite number of nonterminals.
function computeNullable(grammar) {
  const nullable = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const lhs of Object.keys(grammar)) {
      if (nullable.has(lhs)) continue;
      const isNullable = grammar[lhs].some((production) =>
        production.every((symbol) => nullable.has(symbol))
      );
      if (isNullable) {
        nullable.add(lhs);
        changed = true;
      }
    }
  }
  return nullable;
}

function earleyRecognize(grammar, start, tokens) {
  validateGrammar(grammar);
  if (typeof start !== 'string') {
    throw new TypeError(`start must be a string symbol, got ${typeof start}`);
  }
  validateTokens(tokens);
  if (!hasOwn(grammar, start)) {
    throw new RangeError(
      `start symbol ${JSON.stringify(start)} has no productions defined in grammar (missing start symbol)`
    );
  }

  const isNonterminal = (symbol) => hasOwn(grammar, symbol);
  const nullable = computeNullable(grammar);

  // Flatten the grammar into a stable, call-local, numerically-indexed rule
  // list. Each production gets its own defensive copy so that later
  // mutation of the caller's arrays (or of `grammar` itself, between calls)
  // can never affect a recognition already in progress or already returned.
  const rules = [];
  const rulesByLhs = new Map();
  for (const lhs of Object.keys(grammar)) {
    rulesByLhs.set(lhs, []);
  }
  for (const lhs of Object.keys(grammar)) {
    for (const production of grammar[lhs]) {
      const ruleIndex = rules.length;
      rules.push({ lhs, rhs: production.slice() });
      rulesByLhs.get(lhs).push(ruleIndex);
    }
  }

  const n = tokens.length;
  const chart = Array.from({ length: n + 1 }, () => []);
  const seenKeys = Array.from({ length: n + 1 }, () => new Set());

  function addItem(position, ruleIndex, dot, origin) {
    const key = ruleIndex + '|' + dot + '|' + origin;
    if (seenKeys[position].has(key)) return;
    seenKeys[position].add(key);
    chart[position].push({ rule: ruleIndex, dot, origin });
  }

  // Seed: every start-symbol production, dot at 0, origin at chart position 0.
  for (const ruleIndex of rulesByLhs.get(start)) {
    addItem(0, ruleIndex, 0, 0);
  }

  for (let i = 0; i <= n; i++) {
    const items = chart[i];
    // `items.length` is re-read every iteration on purpose: prediction and
    // completion below both append new items to this very array, and this
    // loop must keep going until a fixpoint is reached for position i
    // (no more items can be added) before moving on to position i + 1.
    for (let qi = 0; qi < items.length; qi++) {
      const item = items[qi];
      const rule = rules[item.rule];
      if (item.dot < rule.rhs.length) {
        const nextSymbol = rule.rhs[item.dot];
        if (isNonterminal(nextSymbol)) {
          // Prediction: add every production of nextSymbol as a fresh
          // dot-0 item at this same position.
          for (const ruleIndex of rulesByLhs.get(nextSymbol)) {
            addItem(i, ruleIndex, 0, i);
          }
          // Nullable-skip fix (see file header): if nextSymbol can derive
          // the empty string, immediately advance the current item past it
          // too, at this same position -- deterministically, independent
          // of whether nextSymbol's own epsilon completion has been (or
          // ever will be) processed yet.
          if (nullable.has(nextSymbol)) {
            addItem(i, item.rule, item.dot + 1, item.origin);
          }
        } else if (i < n && tokens[i] === nextSymbol) {
          // Scanning: nextSymbol is a terminal; consume tokens[i] via exact
          // string equality (no coercion, no partial/regex matching) and
          // schedule the advanced item for the *next* chart position.
          addItem(i + 1, item.rule, item.dot + 1, item.origin);
        }
      } else {
        // Completion: this item is `rule.lhs -> rule.rhs .`, spanning
        // [item.origin, i). Advance every item in chart[item.origin] that
        // was waiting for rule.lhs next. (When item.origin === i this
        // scans the very array `items` being iterated here; that's safe --
        // and, given the nullable-skip fix above, provably redundant for
        // origin === i specifically, since anything completable with zero
        // width has an LHS that is by definition in `nullable`, so every
        // waiting item was already advanced directly by the fix. It is
        // kept anyway as a uniform, harmless -- addItem dedupes -- code
        // path rather than special-casing origin === i out.)
        const originItems = chart[item.origin];
        for (let oi = 0; oi < originItems.length; oi++) {
          const originItem = originItems[oi];
          const originRule = rules[originItem.rule];
          if (
            originItem.dot < originRule.rhs.length &&
            originRule.rhs[originItem.dot] === rule.lhs
          ) {
            addItem(i, originItem.rule, originItem.dot + 1, originItem.origin);
          }
        }
      }
    }
  }

  return chart[n].some((item) => {
    const rule = rules[item.rule];
    return item.origin === 0 && item.dot === rule.rhs.length && rule.lhs === start;
  });
}

module.exports = { earleyRecognize };
