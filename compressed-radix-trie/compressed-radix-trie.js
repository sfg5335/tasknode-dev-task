'use strict';

/**
 * Dependency-free compressed radix trie (a.k.a. PATRICIA trie / radix tree)
 * mapping string keys to arbitrary values.
 *
 * Structural invariant maintained after every mutation ("compressed edges"):
 * every internal node has either zero children, two-or-more children, or
 * exactly one child while itself being an end-of-key node. In other words,
 * there is never a chain of single-child, non-end-of-key nodes -- inserts
 * split edges as needed, and deletes merge them back together.
 *
 * Keys are compared and sliced as plain JS strings (UTF-16 code units), so
 * "Unicode string keys" -- including keys containing surrogate-pair
 * characters such as emoji -- are supported the same way native String
 * indexing/slicing/comparison already supports them. "Lexicographic order"
 * below means the same order `<` / `Array.prototype.sort()` (no comparator)
 * would produce for these strings.
 *
 * Internal node shape: { children: Map<firstChar, Edge>, isEnd: boolean, value }
 * Edge shape:           { edge: string, node: Node }
 * The root node itself carries no incoming edge; `root.isEnd`/`root.value`
 * represent the empty-string key.
 */
class CompressedRadixTrie {
  constructor() {
    this.root = { children: new Map(), isEnd: false, value: undefined };
    this._size = 0;
  }

  static _requireString(value, name) {
    if (typeof value !== 'string') {
      throw new TypeError(`${name} must be a string`);
    }
  }

  /**
   * Insert or overwrite `key` with `value`. Returns `this` for chaining.
   */
  set(key, value) {
    CompressedRadixTrie._requireString(key, 'key');

    if (key === '') {
      if (!this.root.isEnd) this._size++;
      this.root.isEnd = true;
      this.root.value = value;
      return this;
    }

    let node = this.root;
    let remaining = key;

    for (;;) {
      const c = remaining[0];
      const entry = node.children.get(c);

      if (!entry) {
        node.children.set(c, {
          edge: remaining,
          node: { children: new Map(), isEnd: true, value },
        });
        this._size++;
        return this;
      }

      const maxLen = Math.min(remaining.length, entry.edge.length);
      let cpl = 0;
      while (cpl < maxLen && remaining[cpl] === entry.edge[cpl]) cpl++;

      if (cpl === entry.edge.length) {
        // Entire edge consumed -- descend and keep matching the rest of the key.
        remaining = remaining.slice(cpl);
        node = entry.node;
        if (remaining === '') {
          if (!node.isEnd) this._size++;
          node.isEnd = true;
          node.value = value;
          return this;
        }
        continue;
      }

      // Partial match: split the edge at the common-prefix length.
      const commonEdge = entry.edge.slice(0, cpl);
      const oldSuffix = entry.edge.slice(cpl);
      const oldChildNode = entry.node;

      const splitNode = { children: new Map(), isEnd: false, value: undefined };
      splitNode.children.set(oldSuffix[0], { edge: oldSuffix, node: oldChildNode });

      entry.edge = commonEdge;
      entry.node = splitNode;

      const newRemaining = remaining.slice(cpl);
      if (newRemaining === '') {
        splitNode.isEnd = true;
        splitNode.value = value;
      } else {
        splitNode.children.set(newRemaining[0], {
          edge: newRemaining,
          node: { children: new Map(), isEnd: true, value },
        });
      }
      this._size++;
      return this;
    }
  }

  /** Internal: walk to the exact node for `key`, or return null. */
  _findNode(key) {
    if (key === '') return this.root.isEnd ? this.root : null;
    let node = this.root;
    let remaining = key;
    while (remaining !== '') {
      const c = remaining[0];
      const entry = node.children.get(c);
      if (!entry || !remaining.startsWith(entry.edge)) return null;
      remaining = remaining.slice(entry.edge.length);
      node = entry.node;
    }
    return node.isEnd ? node : null;
  }

  /** Returns the value stored for `key`, or `undefined` if absent. */
  get(key) {
    CompressedRadixTrie._requireString(key, 'key');
    const node = this._findNode(key);
    return node ? node.value : undefined;
  }

  /** Returns whether `key` is present. */
  has(key) {
    CompressedRadixTrie._requireString(key, 'key');
    return this._findNode(key) !== null;
  }

  /**
   * Removes `key` if present, re-merging compressed edges as needed so the
   * structural invariant holds afterwards. Returns whether it was present.
   */
  delete(key) {
    CompressedRadixTrie._requireString(key, 'key');

    if (key === '') {
      if (!this.root.isEnd) return false;
      this.root.isEnd = false;
      this.root.value = undefined;
      this._size--;
      return true;
    }

    // Record the path of {node, keyChar} pairs walked, where `node` was
    // reached from its predecessor via predecessor.children.get(keyChar).
    const path = [{ node: this.root, keyChar: null }];
    let node = this.root;
    let remaining = key;
    while (remaining !== '') {
      const c = remaining[0];
      const entry = node.children.get(c);
      if (!entry || !remaining.startsWith(entry.edge)) return false;
      remaining = remaining.slice(entry.edge.length);
      node = entry.node;
      path.push({ node, keyChar: c });
    }

    if (!node.isEnd) return false;
    node.isEnd = false;
    node.value = undefined;
    this._size--;

    // Bottom-up cleanup: drop dead leaves, then re-merge a lone surviving
    // single-child non-end node with its child so no compression is lost.
    let i = path.length - 1;
    while (i > 0) {
      const current = path[i].node;
      const keyChar = path[i].keyChar;
      const parentNode = path[i - 1].node;

      if (current.children.size === 0 && !current.isEnd) {
        parentNode.children.delete(keyChar);
        i--;
        continue;
      }
      if (current.children.size === 1 && !current.isEnd) {
        const childEntry = current.children.values().next().value;
        const parentEntry = parentNode.children.get(keyChar);
        parentEntry.edge += childEntry.edge;
        parentEntry.node = childEntry.node;
      }
      break;
    }

    return true;
  }

  /**
   * Returns every stored [key, value] pair whose key starts with `prefix`,
   * as an array sorted in JavaScript lexicographic key order. `prefix: ''`
   * returns every entry in the trie.
   */
  entriesWithPrefix(prefix) {
    CompressedRadixTrie._requireString(prefix, 'prefix');

    let node = this.root;
    let remaining = prefix;
    let acc = '';

    while (remaining !== '') {
      const c = remaining[0];
      const entry = node.children.get(c);
      if (!entry) return [];

      if (remaining.length <= entry.edge.length) {
        if (!entry.edge.startsWith(remaining)) return [];
        acc += entry.edge;
        node = entry.node;
        remaining = '';
        break;
      }
      if (!remaining.startsWith(entry.edge)) return [];
      acc += entry.edge;
      remaining = remaining.slice(entry.edge.length);
      node = entry.node;
    }

    const results = [];
    const stack = [[node, acc]];
    while (stack.length > 0) {
      const [n, prefixSoFar] = stack.pop();
      if (n.isEnd) results.push([prefixSoFar, n.value]);
      for (const entry of n.children.values()) {
        stack.push([entry.node, prefixSoFar + entry.edge]);
      }
    }
    results.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    return results;
  }

  /**
   * Returns the longest stored key that is a prefix of `str`, or `null` if
   * no stored key is a prefix of `str` (the empty-string key counts as a
   * prefix of everything, including `''` itself, if it has been set).
   */
  longestPrefixOf(str) {
    CompressedRadixTrie._requireString(str, 'str');

    let best = this.root.isEnd ? '' : null;
    let node = this.root;
    let remaining = str;
    let acc = '';

    while (remaining !== '') {
      const c = remaining[0];
      const entry = node.children.get(c);
      if (!entry) break;

      const maxLen = Math.min(remaining.length, entry.edge.length);
      let matchLen = 0;
      while (matchLen < maxLen && remaining[matchLen] === entry.edge[matchLen]) matchLen++;

      if (matchLen < entry.edge.length) break; // partial edge match: can't descend further

      acc += entry.edge;
      remaining = remaining.slice(entry.edge.length);
      node = entry.node;
      if (node.isEnd) best = acc;
    }

    return best;
  }

  /** Number of keys currently stored. */
  get size() {
    return this._size;
  }
}

module.exports = { CompressedRadixTrie };
