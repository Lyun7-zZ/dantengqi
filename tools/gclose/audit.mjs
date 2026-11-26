/** G-close：成本归因、规则标签与证据清单。 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createState, applyAction } from "../../src/rules.js";
import { staticRaceResult } from "../../src/ai-master.js";

const OUT = "_extract/g0";
mkdirSync(OUT, { recursive: true });
const bench = JSON.parse(readFileSync("_extract/m2c/bench_interleaved.json", "utf8"));
const states = [...new Set(bench.map((b) => b.key))];

const med = (xs) => { const a = [...xs].sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; };
const byState = {};
for (const k of states) {
  const lg = bench.filter((b) => b.key === k && b.mode === "legacy");
  const rc = bench.filter((b) => b.key === k && b.mode === "race");
  byState[k] = {
    legacyMs: med(lg.map((b) => b.wall)), raceMs: med(rc.map((b) => b.wall)),
    legacyNodes: med(lg.map((b) => b.nodes)), raceNodes: med(rc.map((b) => b.nodes)),
    msRatio: Number((med(rc.map((b) => b.wall)) / med(lg.map((b) => b.wall))).toFixed(3)),
    nodeRatio: Number((med(rc.map((b) => b.nodes)) / med(lg.map((b) => b.nodes))).toFixed(3)),
  };
  // 逐次配对比（同一 state、rep，忽略交错顺序）
  const pair = [];
  for (let rep = 0; rep < 5; rep++) {
    const a = lg.find((b) => b.rep === rep), c = rc.find((b) => b.rep === rep);
    if (a && c) pair.push(c.wall / a.wall);
  }
  byState[k].pairedMsRatioMedian = Number(med(pair).toFixed(3));
}

const allLeg = bench.filter((b) => b.mode === "legacy");
const allRace = bench.filter((b) => b.mode === "race");
const ratioOfMedians = med(allRace.map((b) => b.wall)) / med(allLeg.map((b) => b.wall));
const medianOfRatios = med(states.map((k) => byState[k].msRatio));
const perPair = [];
for (const k of states) for (let rep = 0; rep < 5; rep++) {
  const a = allLeg.find((b) => b.key === k && b.rep === rep);
  const c = allRace.find((b) => b.key === k && b.rep === rep);
  if (a && c) perPair.push(c.wall / a.wall);
}

// 留一法：去掉 112-0 后的中位耗时比
const rest = states.filter((k) => k !== "112-0");
const loo = med(rest.map((k) => byState[k].raceMs)) / med(rest.map((k) => byState[k].legacyMs));

// 规则标签
function caseDraw() { const s = createState(0); s.players = [{ c: 5, r: 0 }, { c: 6, r: 0 }]; return s; }
function caseWin() { const s = createState(0); s.players = [{ c: 5, r: 0 }, { c: 5, r: 1 }]; return s; }
function caseSecond() { const s = createState(0); s.players = [{ c: 5, r: 1 }, { c: 6, r: 0 }]; s.turn = 1; return s; }
const ruleCases = [["true-draw", caseDraw()], ["old-win", caseWin()], ["second-win", caseSecond()]].map(([name, s]) => {
  const r = applyAction(s, { type: "move", dir: "up" });
  return { name, static: staticRaceResult(s), engine: r.ok ? r.state.winner : "illegal" };
});

const out = {
  head: (() => { try { return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim(); } catch { return "unknown"; } })(),
  medians: { legacyMs: med(allLeg.map((b) => b.wall)), raceMs: med(allRace.map((b) => b.wall)),
    ratioOfMedians: Number(ratioOfMedians.toFixed(4)),
    medianOfStateRatios: Number(medianOfRatios.toFixed(4)),
    medianOfPairedRatios: Number(med(perPair).toFixed(4)),
    leaveOneOut112: Number(loo.toFixed(4)) },
  byState,
  ruleCases,
  files: Object.fromEntries(["src/ai-master.js", "src/path.js", "src/rules.js", "tools/m2c/close.mjs",
    "_extract/m2c/bench_interleaved.json"].map((f) => [f, (() => { try { return createHash("sha256").update(readFileSync(f)).digest("hex"); } catch { return null; } })()])),
};
writeFileSync(`${OUT}/gclose.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
