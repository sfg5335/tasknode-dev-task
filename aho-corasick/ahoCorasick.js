'use strict';

/**
 * Aho-Corasick multi-pattern string matcher.
 *
 * Dependency-free. Given a set of unique, non-empty string patterns, the
 * constructor builds:
 *   1. A trie over all patterns.
 *   2. BFS-computed failure links (the trie generalization of KMP's
 *      failure function): fail[v] points to the longest proper suffix of
 *      the string spelled out by v that is also a prefix of some pattern
 *      (i.e. also a node in the trie).
 *   3. Propagated "output" links: each node's outputLink points to the
 *      nearest ancestor (by following fail links) that itself terminates
 *      a pattern, or -1 if none. This is what lets search() report every
 *      pattern ending at a given text position -- including patterns that
 *      are proper suffixes of a longer match (e.g. "he" inside "she") --
 *      without any extra scanning beyond the single pass over text.
 *
 * search(text) walks the automaton once over text: for each character it
 * follows fail links until a matching trie transition exists (or falls
 * back to the root), then reports every pattern ending at that position
 * by walking the node's own terminator (if any) plus its outputLink
 * chain. This is the standard O(|text| + |patterns| + matches) automaton
 * walk (each fail-link traversal during the main loop is amortized O(1)
 * because node depth strictly decreases along a fail chain and increases
 * by at most 1 per input character).
 */
class AhoCorasick {
  constructor(patterns) {
    if (!Array.isArray(patterns)) {
      throw new TypeError('patterns must be an array of strings');
    }
    const seen = new Set();
    for (const p of patterns) {
      if (typeof p !== 'string' || p.length === 0) {
        throw new TypeError('every pattern must be a non-empty string');
      }
      if (seen.has(p)) {
        throw new TypeError(`duplicate pattern: ${JSON.stringify(p)}`);
      }
      seen.add(p);
    }

    this._patterns = patterns.slice();

    // Trie storage, parallel arrays indexed by node id. Node 0 is the root.
    this._children = [new Map()]; // node -> Map<char, childNodeId>
    this._fail = [0]; // node -> failure-link node id
    this._patternAt = [-1]; // node -> index into this._patterns terminating here, or -1
    this._outputLink = [-1]; // node -> nearest ancestor-by-fail-chain that terminates a pattern, or -1

    // 1. Build the trie.
    for (let i = 0; i < patterns.length; i++) {
      let node = 0;
      for (const ch of patterns[i]) {
        let next = this._children[node].get(ch);
        if (next === undefined) {
          next = this._children.length;
          this._children.push(new Map());
          this._fail.push(0);
          this._patternAt.push(-1);
          this._outputLink.push(-1);
          this._children[node].set(ch, next);
        }
        node = next;
      }
      this._patternAt[node] = i;
    }

    // 2. BFS over the trie to compute fail links and output links.
    const queue = [];
    for (const child of this._children[0].values()) {
      this._fail[child] = 0;
      queue.push(child);
    }
    let qi = 0;
    while (qi < queue.length) {
      const u = queue[qi++];
      for (const [ch, v] of this._children[u]) {
        let f = this._fail[u];
        while (f !== 0 && !this._children[f].has(ch)) {
          f = this._fail[f];
        }
        const target = this._children[f].get(ch);
        this._fail[v] = target !== undefined && target !== v ? target : 0;

        const fv = this._fail[v];
        this._outputLink[v] = this._patternAt[fv] !== -1 ? fv : this._outputLink[fv];

        queue.push(v);
      }
    }
  }

  search(text) {
    if (typeof text !== 'string') {
      throw new TypeError('text must be a string');
    }

    const rawMatches = [];
    let node = 0;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      while (node !== 0 && !this._children[node].has(ch)) {
        node = this._fail[node];
      }
      const next = this._children[node].get(ch);
      node = next !== undefined ? next : 0;

      if (this._patternAt[node] !== -1) {
        rawMatches.push({ node, end: i + 1 });
      }
      let out = this._outputLink[node];
      while (out !== -1) {
        rawMatches.push({ node: out, end: i + 1 });
        out = this._outputLink[out];
      }
    }

    const results = rawMatches.map(({ node: n, end }) => {
      const patternIndex = this._patternAt[n];
      const pattern = this._patterns[patternIndex];
      return { pattern, start: end - pattern.length, end, patternIndex };
    });
    results.sort((a, b) => a.start - b.start || a.patternIndex - b.patternIndex);
    return results.map(({ pattern, start, end }) => ({ pattern, start, end }));
  }
}

module.exports = { AhoCorasick };
