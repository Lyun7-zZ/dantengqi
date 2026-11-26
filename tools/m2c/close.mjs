/** E1a-close：唯一动作变化、8 状态交错成本、模式恢复与保护检查。 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createMasterAI, getEvalRaceMode } from "../../src/ai-master.js";
import { createState, applyAction, validateAction } from "../../src/rules.js";
import { createGrandmasterPlusConfig } from "../../src/plus-config.js";
import { makeOpenings, replayOpening, makeRng } from "../p0/lib.mjs";

const OUT = "_extract/m2c";
mkdirSync(OUT, { recursive: true });
const load = (f) => readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const rows = load("_extract/b2b/games_raw.jsonl");
const h1 = rows.filter((r) => r.arm === "H1C");
const opMap = new Map();
for (const l of readFileSync("_extract/b2b/runs/b2b/openings_95_114.jsonl", "utf8").trim().split("\n")) {
  const o = JSON.parse(l);
  opMap.set(o.id, o);
}
function stateAt(r, frac) {
  let s = replayOpening(opMap.get(r.openingId).actions);
  const n = Math.max(0, Math.min(r.actions.length - 1, Math.floor(r.actions.length * frac)));
  for (let i = 0; i < n; i++) {
    const rr = applyAction(s, r.actions[i]);
    if (!rr.ok || rr.state.winner !== null) break;
    s = rr.state;
  }
  return s;
}
const byKey = new Map(h1.map((r) => [`${r.openingId}-${r.seat}`, r]));

const cases = [];
for (const key of ["112-0", "95-0", "106-0", "96-0", "113-0"]) {
  cases.push({ key, state: stateAt(byKey.get(key), 0.7) });
}
cases.push({ key: "rule-first-draw", state: (() => { const s = createState(0); s.players = [{ c: 5, r: 0 }, { c: 6, r: 0 }]; return s; })() });
cases.push({ key: "rule-second-win", state: (() => { const s = createState(0); s.players = [{ c: 5, r: 1 }, { c: 6, r: 0 }]; s.turn = 1; return s; })() });
cases.push({ key: "rule-threat", state: (() => { const s = createState(0); s.players = [{ c: 3, r: 1 }, { c: 6, r: 0 }]; return s; })() });

function run(mode, state, depth, seed) {
  const ai = createMasterAI(createGrandmasterPlusConfig({ timeMs: 120000, maxDepth: depth, evalRaceMode: mode }));
  const t0 = Date.now();
  const a = ai(state, makeRng(seed));
  return { mode, action: a, score: ai.stats.lastLog.score, nodes: ai.stats.lastLog.nodes,
    wall: Date.now() - t0, restored: getEvalRaceMode() };
}

const bench = [];
for (const c of cases) {
  for (let rep = 0; rep < 5; rep++) {
    const order = rep % 2 === 0 ? ["legacy", "race"] : ["race", "legacy"];
    for (const mode of order) bench.push({ key: c.key, rep, ...run(mode, c.state, 6, 31000 + rep) });
  }
}
writeFileSync(`${OUT}/bench_interleaved.json`, JSON.stringify(bench, null, 1));

// 唯一动作变化解释
const r112 = byKey.get("112-0");
const s112 = stateAt(r112, 0.7);
const legacy112 = run("legacy", s112, 6, 32000);
const race112 = run("race", s112, 6, 32001);
const change = {
  key: "112-0",
  legacy: { action: legacy112.action, score: legacy112.score, legal: validateAction(s112, legacy112.action).ok },
  race: { action: race112.action, score: race112.score, legal: validateAction(s112, race112.action).ok },
  sameValueClass: Math.sign(legacy112.score) === Math.sign(race112.score),
  restored: legacy112.restored === "legacy" && race112.restored === "legacy",
};

// 模式恢复：交替多次
let restoreOk = true;
for (let i = 0; i < 6; i++) {
  run("race", cases[1].state, 5, 33000 + i);
  if (getEvalRaceMode() !== "legacy") restoreOk = false;
  run("legacy", cases[1].state, 5, 33100 + i);
  if (getEvalRaceMode() !== "legacy") restoreOk = false;
}

// 保护检查
const protect = [];
for (const c of cases.filter((x) => x.key.startsWith("rule-"))) {
  const race = run("race", c.state, 6, 34000);
  const imm = (() => {
    const p = c.state.players[c.state.turn];
    if (p.r !== 0) return null;
    const r = applyAction(c.state, { type: "move", dir: "up" });
    return r.ok && r.state.winner !== null ? r.state.winner : null;
  })();
  protect.push({ key: c.key, immediate: imm, action: race.action, legal: validateAction(c.state, race.action).ok });
}

const median = (xs) => { const a = [...xs].sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; };
const leg = bench.filter((b) => b.mode === "legacy");
const rac = bench.filter((b) => b.mode === "race");
const out = {
  head: (() => { try { return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim(); } catch { return "unknown"; } })(),
  change,
  cost: {
    legacyMedianMs: median(leg.map((b) => b.wall)),
    raceMedianMs: median(rac.map((b) => b.wall)),
    legacyMedianNodes: median(leg.map((b) => b.nodes)),
    raceMedianNodes: median(rac.map((b) => b.nodes)),
    legacyPerNode: Number((median(leg.map((b) => b.wall / Math.max(1, b.nodes)))).toFixed(4)),
    racePerNode: Number((median(rac.map((b) => b.wall / Math.max(1, b.nodes)))).toFixed(4)),
  },
  restoreOk,
  protect,
  files: Object.fromEntries([
    "tools/m2b1/oracle.mjs", "tools/m2b1/qualify.mjs",
    "src/ai-master.js", "src/plus-config.js",
    "_extract/m2b1/rule_oracle.json", "_extract/m2b1/eval_trace.jsonl",
  ].map((f) => [f, (() => { try { return createHash("sha256").update(readFileSync(f)).digest("hex"); } catch { return null; } })()])),
};
out.cost.overheadPct = Number((((out.cost.raceMedianMs - out.cost.legacyMedianMs) / out.cost.legacyMedianMs) * 100).toFixed(2));
writeFileSync(`${OUT}/e1a_close.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
