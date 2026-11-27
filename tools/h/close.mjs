/** S1-close：attack-near 复现、后悔值分母与 fixture 核对。 */

import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { applyAction, validateAction, distanceOf } from "../../src/rules.js";
import { s1RootActions, s1Evaluate, s1Choose } from "../../src/s1-planner.js";
import { buildStates } from "../s0/states.mjs";

const OUT = "_extract/h";
mkdirSync(OUT, { recursive: true });
const rows = readFileSync("_extract/s1/cases.jsonl", "utf8").trim().split("\n").map((l) => JSON.parse(l));
const big = rows.filter((r) => r.regrets.s1 !== null && Math.abs(r.regrets.s1) > 1000);
const sev = big.map((r) => ({ name: r.name, regret: r.regrets.s1, refBest: r.bestRef,
  s1: r.arms.s1.action, h1: r.h1.action, h1Ref: r.refs.h1, s1Ref: r.refs.s1 }));

const states = buildStates();
const attack = states.find((x) => x.name === "attack-near").state;
const roots = s1RootActions(attack).map((x) => ({ action: x.a, source: x.source, legal: validateAction(attack, x.a).ok }));
const topWall = { type: "wall", kind: "top", c: 5, r: 0 };
const up = { type: "move", dir: "up" };
const evWall = s1Evaluate(attack, topWall, { depth: 3, timeMs: 20000 });
const evUp = s1Evaluate(attack, up, { depth: 3, timeMs: 20000 });
const chosen = s1Choose(attack, { timeMs: 3000, mode: "s1" });

const complex = states.find((x) => x.name === "complex-D12-H11").state;
const pocket = states.find((x) => x.name === "sbp-pocket").state;
const out = {
  head: "S1-close",
  regret: {
    cases: rows.length,
    sumS1: rows.reduce((s, r) => s + (r.regrets.s1 || 0), 0),
    avgS1: rows.reduce((s, r) => s + (r.regrets.s1 || 0), 0) / rows.length,
    over1000: sev,
    note: "平均后悔按全部 24 个开发状态为分母；两个 999,990 案例贡献 1,999,980/24=83,332.5。",
  },
  attackNear: {
    rootCount: roots.length,
    topWallGenerated: roots.some((r) => JSON.stringify(r.action) === JSON.stringify(topWall)),
    topWallSource: roots.find((r) => JSON.stringify(r.action) === JSON.stringify(topWall))?.source ?? null,
    evWall, evUp, chosen,
    distances: [distanceOf(attack, 0), distanceOf(attack, 1)],
  },
  fixtures: {
    complexUp: validateAction(complex, up),
    complexDistances: [distanceOf(complex, 0), distanceOf(complex, 1)],
    pocketDistances: [distanceOf(pocket, 0), distanceOf(pocket, 1)],
    pocketSelf: validateAction(pocket, { type: "wall", kind: "v", c: 8, r: 11 }),
  },
};
writeFileSync(`${OUT}/s1_close.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
