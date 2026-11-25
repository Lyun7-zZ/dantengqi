/** M1a 性能剖析：冻结代表状态，比较 GM / H0+ / H1+ 的阶段耗时与重复计算。 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { createMasterAI } from "../../src/ai-master.js";
import { createState, applyAction, validateAction, legalActions } from "../../src/rules.js";
import { createGrandmasterConfig, createGrandmasterPlusConfig, createGrandmasterPlusA0Config } from "../../src/plus-config.js";
import { makeOpenings, replayOpening, makeRng } from "../p0/lib.mjs";

const OUT = "_extract/m1a";
mkdirSync(OUT, { recursive: true });
const openings = makeOpenings(75);
const opMap = new Map(openings.map((o) => [o.id, o]));

function hash(s) {
  return createHash("sha256").update(JSON.stringify({
    v: Array.from(s.vWall), h: Array.from(s.hWall), t: Array.from(s.topWall),
    p: s.players, turn: s.turn, plies: s.plies, wu: s.wallsUsed,
  })).digest("hex").slice(0, 16);
}

function scripted(id, plies) {
  let s = replayOpening(opMap.get(id).actions);
  for (let i = 0; i < plies; i++) {
    const acts = legalActions(s);
    let a = acts[(i * 7 + 3) % acts.length];
    if (!a || !validateAction(s, a).ok) a = { type: "move", dir: "up" };
    const r = applyAction(s, a);
    if (!r.ok) break;
    s = r.state;
    if (s.winner !== null) break;
  }
  return s;
}

function endgame() {
  const s = createState(0);
  s.players = [{ c: 4, r: 1 }, { c: 5, r: 2 }];
  for (let c = 0; c < 10; c++) if (c !== 4 && c !== 5) s.topWall[c] = 1;
  for (let c = 0; c < 10; c++) s.hWall[c * 11 + 1] = 1;
  s.hWall[4 * 11 + 0] = 0;
  s.hWall[5 * 11 + 0] = 0;
  s.plies = 88;
  s.wallsUsed = [12, 11];
  s.wallsPlaced = 23;
  return s;
}

const states = [
  { name: "early-55", phase: "开局", state: replayOpening(opMap.get(55).actions) },
  { name: "early-65", phase: "开局", state: replayOpening(opMap.get(65).actions) },
  { name: "mid-56", phase: "中局", state: scripted(56, 26) },
  { name: "mid-61", phase: "中局", state: scripted(61, 34) },
  { name: "end-70", phase: "残局", state: scripted(70, 80) },
  { name: "end-synth", phase: "残局", state: endgame() },
];

const AIS = {
  GM: () => createMasterAI(createGrandmasterConfig({ trace: true })),
  "H0+": () => createMasterAI(createGrandmasterPlusA0Config({ trace: true })),
  "H1+": () => createMasterAI(createGrandmasterPlusConfig({ trace: true })),
};

const rows = [];
for (const st of states) {
  const stateHash = hash(st.state);
  for (let rep = 0; rep < 3; rep++) {
    for (const [name, make] of Object.entries(AIS)) {
      const ai = make();
      const a = ai(st.state, makeRng(40000 + rep * 97 + name.length));
      const log = ai.stats?.lastLog ?? {};
      rows.push({
        state: st.name, phase: st.phase, stateHash, rep, ai: name,
        action: a, source: log.source, depth: log.depthLast,
        tTotal: Math.round(log.tTotal ?? 0), tPlan: Math.round(log.tPlan ?? 0),
        tCandidate: Math.round(log.tCandidate ?? 0), tOrder: Math.round(log.tOrder ?? 0),
        tSearch: Math.round(log.tSearch ?? 0), nodes: log.nodes,
        candidateCount: log.candidateCount, searchedCount: log.searchedCount,
        trace: log.trace, returnBuffer: log.returnBuffer,
      });
    }
  }
}
writeFileSync(`${OUT}/profile_turns.jsonl`, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");

// 汇总
const summary = {};
for (const ai of Object.keys(AIS)) {
  const rs = rows.filter((r) => r.ai === ai);
  const avg = (fn) => Number((rs.reduce((s, r) => s + (Number(fn(r)) || 0), 0) / rs.length).toFixed(1));
  summary[ai] = {
    runs: rs.length,
    tTotal: avg((r) => r.tTotal), tPlan: avg((r) => r.tPlan), tCandidate: avg((r) => r.tCandidate),
    tOrder: avg((r) => r.tOrder), tSearch: avg((r) => r.tSearch),
    depth: Number((rs.reduce((s, r) => s + (r.depth || 0), 0) / rs.length).toFixed(2)),
    nodes: avg((r) => r.nodes), candidates: avg((r) => r.candidateCount),
    pathCalls: avg((r) => r.trace?.pathCalls), pathMs: avg((r) => r.trace?.pathMs),
    legalCalls: avg((r) => r.trace?.legalCalls), legalMs: avg((r) => r.trace?.legalMs),
    applyCalls: avg((r) => r.trace?.applyCalls), applyMs: avg((r) => r.trace?.applyMs),
    maxTotal: Math.max(...rs.map((r) => r.tTotal)),
    over3000: rs.filter((r) => r.tTotal > 3000).length,
  };
}
writeFileSync(`${OUT}/profile_summary.json`, JSON.stringify(summary, null, 1));

// 埋点开销：同状态，trace on/off 各 3 次
const overhead = [];
for (const name of ["H1+"]) {
  for (const trace of [false, true]) {
    for (let rep = 0; rep < 3; rep++) {
      const ai = createMasterAI(createGrandmasterPlusConfig({ trace }));
      const a = ai(states[2].state, makeRng(50000 + rep));
      const log = ai.stats?.lastLog ?? {};
      overhead.push({ ai: name, trace, rep, tTotal: Math.round(log.tTotal ?? 0), action: a });
    }
  }
}
writeFileSync(`${OUT}/trace_overhead.json`, JSON.stringify(overhead, null, 1));
console.log(JSON.stringify(summary, null, 1));
