'use strict';

// Deterministic multi-pattern string matcher via the Aho-Corasick algorithm
// (Aho & Corasick, 1975).
//
// A trie is built over every pattern; each trie node additionally gets a
// "failure link" pointing to the node representing the longest proper
// suffix of that node's own path that is also a prefix of some pattern
// (computed via a breadth-first traversal, since failure links always
// point to a strictly shallower node than the one they're attached to).
// Scanning the text once, following child edges where possible and falling
// back through failure links otherwise, visits every trie node whose path
// is a suffix of the text scanned so far -- and therefore, by walking each
// node's own recorded pattern endings plus (via a precomputed "merged
// output" list) every pattern ending recorded at any node reachable by
// failure links, discovers every occurrence of every pattern in one linear
// pass, without ever re-scanning the text.
//
// Construction is O(total pattern length). Search is O(text length +
// number of matches): although a single character can walk several
// failure links before landing on its next state, each such step strictly
// decreases trie depth while each matched child edge increases it by
// exactly one -- so, summed over the whole scan, the total number of
// failure-link steps can never exceed the total number of child-edge
// steps (a standard amortized/potential argument), keeping the whole scan
// linear.

class AhoCorasick {
  // patterns: array of non-empty strings. Duplicate strings are kept
  // distinct by their original index -- searching reports every pattern
  // index whose string matches at a given position, even if two or more
  // indices share the exact same pattern text.
  constructor(patterns) {
    if (!Array.isArray(patterns)) {
      throw new TypeError('patterns must be an array');
    }
    for (const pattern of patterns) {
      if (typeof pattern !== 'string') {
        throw new TypeError('every pattern must be a string');
      }
      if (pattern.length === 0) {
        throw new RangeError('every pattern must be a non-empty string');
      }
    }

    // Defensive copy: later mutation of the caller's array must not be
    // able to affect this instance's behavior.
    this._patterns = patterns.slice();
    this._root = buildAutomaton(this._patterns);
  }

  // text: a string to scan. Returns an array of
  // { pattern, patternIndex, start, end } objects, one per occurrence of
  // every pattern in the text -- start/end are UTF-16 code-unit offsets
  // into `text` (start inclusive, end exclusive; end - start ===
  // pattern.length), i.e. the same indexing convention as ordinary
  // JavaScript string indexing/slicing (`text.slice(start, end)`). Astral
  // (non-BMP) characters, represented as UTF-16 surrogate pairs, therefore
  // count as two code units, exactly as `String.prototype.length` does.
  //
  // Results are sorted by end offset, then start offset, then pattern
  // index, all ascending -- a deterministic order independent of pattern
  // insertion order or trie traversal order.
  //
  // This method holds no state beyond its own local variables: every call
  // starts a fresh scan from the automaton's root and returns an
  // independent result, so repeated or interleaved calls on the same
  // instance never affect one another.
  search(text) {
    if (typeof text !== 'string') {
      throw new TypeError('text must be a string');
    }

    const root = this._root;
    const patterns = this._patterns;
    const matches = [];
    let node = root;

    for (let i = 0; i < text.length; i++) {
      const c = text[i];

      while (node !== root && !node.children.has(c)) {
        node = node.fail;
      }
      const next = node.children.get(c);
      node = next !== undefined ? next : root;

      const end = i + 1;
      for (const patternIndex of node.allOutputs) {
        const pattern = patterns[patternIndex];
        matches.push({ pattern, patternIndex, start: end - pattern.length, end });
      }
    }

    matches.sort((a, b) => a.end - b.end || a.start - b.start || a.patternIndex - b.patternIndex);
    return matches;
  }
}

function createNode() {
  return { children: new Map(), output: [], allOutputs: null, fail: null };
}

function buildAutomaton(patterns) {
  const root = createNode();
  root.fail = root;
  root.allOutputs = [];

  // Trie construction: one root-to-leaf path per pattern, sharing any
  // common prefix with previously-inserted patterns. A pattern's own index
  // is recorded on the node reached by consuming its entire string, so two
  // identical pattern strings at different indices both get recorded on
  // that same shared node.
  patterns.forEach((pattern, patternIndex) => {
    let node = root;
    for (let i = 0; i < pattern.length; i++) {
      const c = pattern[i];
      let next = node.children.get(c);
      if (next === undefined) {
        next = createNode();
        node.children.set(c, next);
      }
      node = next;
    }
    node.output.push(patternIndex);
  });

  // Breadth-first failure-link construction. Root's direct children always
  // fail back to root (no proper non-empty suffix of a single character is
  // a shorter string). Every other node's failure link is found by walking
  // its parent's failure chain looking for a node that already has a child
  // edge for the same character; falling all the way back to root (which
  // has no failure-of-its-own to walk further) means no proper suffix of
  // this node's path is a prefix of any pattern.
  const queue = [];
  for (const child of root.children.values()) {
    child.fail = root;
    queue.push(child);
  }

  let head = 0;
  while (head < queue.length) {
    const u = queue[head++];
    // Failure links always point to a strictly shallower node, and this is
    // a breadth-first traversal, so u.fail's merged output list is always
    // already finalized by the time u itself is dequeued.
    u.allOutputs = u.fail.allOutputs.concat(u.output);

    for (const [c, v] of u.children) {
      let f = u.fail;
      while (f !== root && !f.children.has(c)) {
        f = f.fail;
      }
      const candidate = f.children.get(c);
      v.fail = candidate !== undefined ? candidate : root;
      queue.push(v);
    }
  }

  return root;
}

module.exports = { AhoCorasick };
