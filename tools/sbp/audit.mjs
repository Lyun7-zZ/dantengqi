/** SBP-0：截图局面重建、四方案规则验证与 H1+C 基线复核。 */

import { writeFileSync, mkdirSync } from "node:fs";
import { createState, applyAction, validateAction, legalActions, distanceOf } from "../../src/rules.js";
import { vIndex, hIndex } from "../../src/board.js";
import { debugPathCount, createMasterAI } from "../../src/ai-master.js";
import { createGrandmasterPlusConfig } from "../../src/plus-config.js";
import { makeRng } from "../p0/lib.mjs";

const OUT = "_extract/sbp";
mkdirSync(OUT, { recursive: true });

function fixture() {
  let s = createState(0);
  s.players = [{ c: 9, r: 11 }, { c: 0, r: 11 }]; // 橙 J12，绿 A12
  s.turn = 0;
  const walls = [
    { kind: "h", c: 0, r: 10 },  // A11-A12
    { kind: "h", c: 1, r: 9 },   // B10-B11
    { kind: "v", c: 7, r: 10 },  // H11-I11
    { kind: "v", c: 7, r: 11 },  // H12-I12
    { kind: "h", c: 9, r: 9 },   // J10-J11
  ];
  for (const w of walls) {
    const r = applyAction(s, { type: "wall", ...w });
    if (!r.ok) throw new Error("fixture wall illegal " + JSON.stringify(w));
    s = r.state;
  }
  s.turn = 0;
  return s;
}

const s0 = fixture();
const base = {
  distances: [distanceOf(s0, 0), distanceOf(s0, 1)],
  paths: [debugPathCount(s0, 0, 24), debugPathCount(s0, 1, 24)],
  exits: s0.topWall.filter((x) => x === 0).length,
  wallsUsed: s0.wallsUsed,
};

function legal(a, s = s0) { return validateAction(s, a).ok; }
const options = [
  { name: "self-v-I12J12", a: { type: "wall", kind: "v", c: 8, r: 11 } },
  { name: "self-h-J11J12", a: { type: "wall", kind: "h", c: 9, r: 10 } },
  { name: "self-h-I11I12", a: { type: "wall", kind: "h", c: 8, r: 10 } },
  { name: "self-v-I11J11", a: { type: "wall", kind: "v", c: 8, r: 10 } },
  { name: "move-left-I12", a: { type: "move", dir: "left" } },
  { name: "move-up-J11", a: { type: "move", dir: "up" } },
];

const results = [];
for (const o of options) {
  const ok = legal(o.a);
  let after = null;
  if (ok) {
    const r = applyAction(s0, o.a);
    after = { distances: [distanceOf(r.state, 0), distanceOf(r.state, 1)],
      paths: [debugPathCount(r.state, 0, 24), debugPathCount(r.state, 1, 24)] };
  }
  results.push({ ...o, legal: ok, after });
}

// 对手封堵检查：对自封后剩余关键边，尝试封堵是否合法
function edgeWall(a, b) {
  if (a.r === b.r) return { type: "wall", kind: "v", c: Math.min(a.c, b.c), r: a.r };
  return { type: "wall", kind: "h", c: a.c, r: Math.min(a.r, b.r) };
}
function bfsPath(s, player) {
  const start = s.players[player];
  const q = [[start.c, start.r]];
  const prev = new Map();
  const seen = new Set([`${start.c},${start.r}`]);
  let goal = null;
  while (q.length) {
    const [c, r] = q.shift();
    if (r === 0 && s.topWall[c] === 0) { goal = [c, r]; break; }
    const nbs = [];
    if (r === 0) { if (s.topWall[c] === 0) nbs.push([c, r - 1]); }
    else if (!s.hWall[hIndex(c, r - 1)]) nbs.push([c, r - 1]);
    if (r < 11 && !s.hWall[hIndex(c, r)]) nbs.push([c, r + 1]);
    if (c > 0 && !s.vWall[vIndex(c - 1, r)]) nbs.push([c - 1, r]);
    if (c < 9 && !s.vWall[vIndex(c, r)]) nbs.push([c + 1, r]);
    for (const [nc, nr] of nbs) {
      const k = `${nc},${nr}`;
      if (seen.has(k)) continue;
      seen.add(k);
      prev.set(k, `${c},${r}`);
      q.push([nc, nr]);
    }
  }
  if (!goal) return null;
  const out = [];
  let cur = `${goal[0]},${goal[1]}`;
  while (cur) {
    const [c, r] = cur.split(",").map(Number);
    out.push({ c, r });
    cur = prev.get(cur);
  }
  return out.reverse();
}
const blockChecks = [];
for (const o of results.filter((x) => x.name.startsWith("self") && x.legal)) {
  const r = applyAction(s0, o.a);
  const path = bfsPath(r.state, 0);
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i], b = path[i + 1];
    const w = b.r < 0 ? { type: "wall", kind: "top", c: b.c, r: 0 } : edgeWall(a, b);
    const can = validateAction(r.state, w).ok;
    blockChecks.push({ option: o.name, edge: `${a.c},${a.r}-${b.c},${b.r}`, wall: w, greenCanBlock: can });
  }
  const last = path[path.length - 1];
  if (last.r === 0) {
    const w = { type: "wall", kind: "top", c: last.c, r: 0 };
    blockChecks.push({ option: o.name, edge: `exit-${last.c}`, wall: w, greenCanBlock: validateAction(r.state, w).ok });
  }
}

// H1+C 基线
const trials = [];
for (let i = 0; i < 3; i++) {
  const ai = createMasterAI(createGrandmasterPlusConfig({ pathCache: true }));
  const a = ai(s0, makeRng(71000 + i));
  trials.push({ action: a, source: ai.stats.lastLog.source, tTotal: Math.round(ai.stats.lastLog.tTotal ?? 0),
    depth: ai.stats.lastLog.depthLast, score: ai.stats.lastLog.score });
}

const out = { base, options: results, blockChecks, trials };
writeFileSync(`${OUT}/sbp_proof.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
