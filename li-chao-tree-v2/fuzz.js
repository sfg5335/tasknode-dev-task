'use strict';

const { LiChaoTree } = require('./li-chao-tree.js');

// xorshift32 PRNG, matching this repo's established differential-test convention.
function xorshift32(seed) {
  let state = seed >>> 0;
  return function next() {
    state ^= state << 13; state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5; state >>>= 0;
    return state / 4294967296;
  };
}

// Independent reference: a plain array of {slope, intercept, label, seq},
// queried by a linear scan comparing (value, seq) exactly like the
// production LiChaoTree's `_better`, but with zero shared code/technique
// with the segment-tree-based implementation under test.
class ReferenceLineSet {
  constructor(minX, maxX) {
    this.minX = minX;
    this.maxX = maxX;
    this.lines = [];
  }
  addLine(slope, intercept, label) {
    this.lines.push({ slope, intercept, label, seq: this.lines.length });
  }
  query(x) {
    if (this.lines.length === 0) return null;
    let best = null;
    let bestVal = Infinity;
    let bestSeq = Infinity;
    for (const line of this.lines) {
      const val = line.slope * x + line.intercept;
      if (val < bestVal || (val === bestVal && line.seq < bestSeq)) {
        best = line;
        bestVal = val;
        bestSeq = line.seq;
      }
    }
    return { value: bestVal, label: best.label };
  }
}

function runBlock(name, seed, trials, domainSpan, coordSpan, numLinesMax, numQueriesPerTree) {
  const rand = xorshift32(seed);
  let checked = 0;
  let mismatches = 0;
  for (let t = 0; t < trials; t++) {
    const minX = Math.floor(rand() * coordSpan) - Math.floor(coordSpan / 2);
    const span = 1 + Math.floor(rand() * domainSpan);
    const maxX = minX + span;

    const tree = new LiChaoTree(minX, maxX);
    const ref = new ReferenceLineSet(minX, maxX);

    const numLines = 1 + Math.floor(rand() * numLinesMax);
    for (let i = 0; i < numLines; i++) {
      const slope = Math.floor(rand() * 21) - 10; // -10..10
      const intercept = Math.floor(rand() * 2001) - 1000; // -1000..1000
      const label = `L${i}`;
      tree.addLine(slope, intercept, label);
      ref.addLine(slope, intercept, label);
    }

    for (let q = 0; q < numQueriesPerTree; q++) {
      const x = minX + Math.floor(rand() * (maxX - minX + 1));
      const got = tree.query(x);
      const want = ref.query(x);
      checked++;
      const mismatch =
        (got === null) !== (want === null) ||
        (got !== null && (got.value !== want.value || got.label !== want.label));
      if (mismatch) {
        mismatches++;
        if (mismatches <= 5) {
          console.log(`MISMATCH [${name}] trial=${t} x=${x} minX=${minX} maxX=${maxX} numLines=${numLines}`);
          console.log('  got: ', JSON.stringify(got));
          console.log('  want:', JSON.stringify(want));
        }
      }
    }
  }
  console.log(`[${name}] checked=${checked} mismatches=${mismatches}`);
  return mismatches;
}

let total = 0;
total += runBlock('spec-scale small domain, seed 0xC0FFEE', 0xC0FFEE, 500, 30, 40, 12, 20);
total += runBlock('wide domain, seed 0x5eed5eed', 0x5eed5eed, 500, 2000, 4000000000, 20, 15);
total += runBlock('many-lines-same-tree, seed 0xfeedface', 0xfeedface, 300, 50, 200, 60, 30);
total += runBlock('tiny-domain-heavy-tie, seed 0xabc123', 0xabc123, 500, 3, 20, 15, 10);
total += runBlock('single-point-domain, seed 0xb0eda12', 0xb0eda12, 300, 0, 100, 10, 5);

// Dedicated tie-breaking stress: many lines through the exact same point,
// inserted in randomized order each trial, always expect the earliest
// inserted (seq 0 in insertion order) to win at that exact point.
{
  const rand = xorshift32(0x71e2711e);
  let checked = 0;
  let mismatches = 0;
  const trials = 500;
  for (let t = 0; t < trials; t++) {
    const minX = -50;
    const maxX = 50;
    const pivotX = Math.floor(rand() * (maxX - minX + 1)) + minX;
    const pivotY = Math.floor(rand() * 201) - 100;
    const numLines = 3 + Math.floor(rand() * 8);
    // Build numLines distinct lines all passing through (pivotX, pivotY).
    const specs = [];
    const seenSlopes = new Set();
    for (let i = 0; i < numLines; i++) {
      let slope;
      do {
        slope = Math.floor(rand() * 21) - 10;
      } while (seenSlopes.has(slope));
      seenSlopes.add(slope);
      const intercept = pivotY - slope * pivotX;
      specs.push({ slope, intercept, label: `T${i}` });
    }
    const tree = new LiChaoTree(minX, maxX);
    const ref = new ReferenceLineSet(minX, maxX);
    for (const s of specs) {
      tree.addLine(s.slope, s.intercept, s.label);
      ref.addLine(s.slope, s.intercept, s.label);
    }
    const got = tree.query(pivotX);
    const want = ref.query(pivotX);
    checked++;
    if (got.label !== 'T0' || got.value !== pivotY || got.label !== want.label) {
      mismatches++;
      console.log(`TIE MISMATCH trial=${t} pivotX=${pivotX} pivotY=${pivotY} got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
    }
  }
  console.log(`[dedicated-tie-stress] checked=${checked} mismatches=${mismatches}`);
  total += mismatches;
}

console.log(`TOTAL mismatches across all blocks: ${total}`);

// Invalid-input sweep
{
  const badInputs = [
    () => new LiChaoTree('0', 10),
    () => new LiChaoTree(0, '10'),
    () => new LiChaoTree(NaN, 10),
    () => new LiChaoTree(0, Infinity),
    () => new LiChaoTree(1.5, 10),
    () => new LiChaoTree(10, 0),
    () => { const t = new LiChaoTree(0, 10); t.addLine('1', 0, 'x'); },
    () => { const t = new LiChaoTree(0, 10); t.addLine(1, NaN, 'x'); },
    () => { const t = new LiChaoTree(0, 10); t.query('5'); },
    () => { const t = new LiChaoTree(0, 10); t.query(5.5); },
    () => { const t = new LiChaoTree(0, 10); t.query(11); },
    () => { const t = new LiChaoTree(0, 10); t.query(-1); },
  ];
  let ok = 0;
  for (const fn of badInputs) {
    try {
      fn();
      console.log('DID NOT THROW:', fn.toString());
    } catch (e) {
      if (e instanceof TypeError || e instanceof RangeError) ok++;
      else console.log('WRONG ERROR TYPE:', e);
    }
  }
  console.log(`invalid-input sweep: ${ok}/${badInputs.length} correctly threw`);
}
