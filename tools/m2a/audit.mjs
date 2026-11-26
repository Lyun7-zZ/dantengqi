/** B2b-close + M2a：证据审计、轨迹分类与机制判定。 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { summarize } from "../p0/lib.mjs";
import { applyAction, validateAction, distanceOf } from "../../src/rules.js";
import { replayOpening } from "../p0/lib.mjs";

const OUT = "_extract/m2a";
mkdirSync(OUT, { recursive: true });
const load = (f) => readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

const rows = load("_extract/b2b/games_raw.jsonl");
const h0 = rows.filter((r) => r.arm === "H0C");
const h1 = rows.filter((r) => r.arm === "H1C");
const key = (r) => `${r.openingId}-${r.seat}`;
const i0 = new Map(h0.map((r) => [key(r), r]));
const i1 = new Map(h1.map((r) => [key(r), r]));

const problems = [];
if (h0.length !== 40 || h1.length !== 40) problems.push("count");
if (new Set(h0.map(key)).size !== 40 || new Set(h1.map(key)).size !== 40) problems.push("duplicate");
for (const k of i0.keys()) if (!i1.has(k)) problems.push("missing " + k);
const openingIds = [...new Set(rows.map((r) => r.openingId))].sort((a, b) => a - b);
if (openingIds.length !== 20) problems.push("openings " + openingIds.length);
const b2Openings = [...new Set(load("_extract/b2/games_raw.jsonl").map((r) => r.openingId))];
const overlap = openingIds.filter((id) => b2Openings.includes(id));

// 配置审计
const cfgs = [];
for (const f of ["H0C-s0", "H1C-s0"]) {
  const p = `_extract/b2b/runs/b2b/config_${f}.json`;
  if (existsSync(p)) cfgs.push(JSON.parse(readFileSync(p, "utf8")));
}
const cfgCheck = cfgs.map((c) => ({
  arm: c.arm, routeWalls: c.candCfg.routeWalls, pathCache: !!c.candCfg.pathCache,
  timeMs: c.candCfg.timeMs, returnBuffer: c.candCfg.returnBuffer,
  sourceCommit: c.sourceCommit, dirtyTracked: c.dirtyTracked,
}));

const pts = (r, u = 0) => (r.result === "hell_win" ? 1 : r.result === "draw" ? 0.5 : r.result === "unfinished" ? u : 0);
const keys = [...i0.keys()].sort();
const diffs = keys.map((k) => pts(i1.get(k)) - pts(i0.get(k)));

const RES = ["hell_win", "draw", "hell_loss", "unfinished"];
const tr = {};
for (const a of RES) tr[a] = Object.fromEntries(RES.map((b) => [b, 0]));
for (const k of keys) tr[i0.get(k).result][i1.get(k).result]++;

// 轨迹重放分类
function hashState(s) {
  return createHash("sha256").update(JSON.stringify({
    v: Array.from(s.vWall), h: Array.from(s.hWall), t: Array.from(s.topWall),
    p: s.players, turn: s.turn, wu: s.wallsUsed, plies: s.plies,
  })).digest("hex").slice(0, 12);
}
function replay(r) {
  let s = replayOpening(Array.from({ length: 0 })); // placeholder
  return null;
}
const opMap = new Map();
{
  const openings = readFileSync("_extract/b2b/runs/b2b/openings_95_114.jsonl", "utf8")
    .trim().split("\n").map((l) => JSON.parse(l));
  for (const o of openings) opMap.set(o.id, o);
}

function trajectory(r) {
  let s = replayOpening(opMap.get(r.openingId).actions);
  const seen = new Map();
  const dists = [];
  for (const a of r.actions) {
    seen.set(hashState(s), (seen.get(hashState(s)) || 0) + 1);
    dists.push([distanceOf(s, 0), distanceOf(s, 1)]);
    const rr = applyAction(s, a);
    if (!rr.ok) break;
    s = rr.state;
  }
  const final = {
    plies: s.plies, winner: s.winner, players: s.players,
    dist: [distanceOf(s, 0), distanceOf(s, 1)],
    exits: s.topWall.filter((x) => x === 0).length,
    wallsUsed: s.wallsUsed.slice(),
  };
  const repeated = [...seen.values()].filter((n) => n > 1).reduce((x, y) => x + (y - 1), 0);
  const maxRep = Math.max(1, ...seen.values());
  const last = dists.slice(-30);
  const progress = last.length > 1 ? last[last.length - 1][r.seat] - last[0][r.seat] : 0;
  return { final, repeated, maxRep, progress, states: dists.length };
}

const failures = [];
for (const r of h1.filter((x) => x.result === "hell_loss" || x.result === "unfinished")) {
  const o = i0.get(key(r));
  const t = trajectory(r);
  const common = o.result !== "hell_win";
  let kind;
  const cd = t.final.dist[r.seat];
  const od = t.final.dist[1 - r.seat];
  if (r.result === "unfinished") {
    kind = t.repeated >= 3 ? "未完成-重复局面" : (t.progress >= 0 ? "未完成-无进展" : "未完成-上限");
  } else if (t.repeated >= 3) kind = "负-循环";
  else if (cd <= 6) kind = "负-收官/终局竞速";
  else if (cd <= 15) kind = "负-中局被拉开";
  else kind = "负-战略/路径崩溃";
  failures.push({
    key: key(r), openingId: r.openingId, seat: r.seat, result: r.result,
    h0: o.result, common, kind, plies: r.plies, tMax: r.tMax,
    finalDist: t.final.dist, candDist: cd, oppDist: od,
    exits: t.final.exits, repeated: t.repeated,
    maxRep: t.maxRep, progressLast30: t.progress,
    evidence: "轨迹重放（无 AI 内部状态）",
  });
}
const gains = h0.filter((r) => r.result === "hell_loss" || r.result === "unfinished")
  .map((r) => ({ key: key(r), h0: r.result, h1: i1.get(key(r)).result }))
  .filter((g) => i1.get(g.key).result === "hell_win");
const controls = h1.filter((r) => r.result === "hell_win").slice(0, 4)
  .map((r) => ({ key: key(r), plies: r.plies, depth: r.depthAvg }));

const typeCount = {};
for (const f of failures) typeCount[f.kind] = (typeCount[f.kind] || 0) + 1;

const out = {
  integrity: { problems, games: rows.length, openings: openingIds, overlapWithB2: overlap },
  config: cfgCheck,
  summary: { H0C: summarize(h0), H1C: summarize(h1) },
  paired: {
    mean: Number((diffs.reduce((x, y) => x + y, 0) / diffs.length).toFixed(4)),
    u: [0, 0.5, 1].map((u) => ({
      u, mean: Number((keys.reduce((s, k) => s + pts(i1.get(k), u) - pts(i0.get(k), u), 0) / keys.length).toFixed(4)),
    })),
    changedCategories: keys.filter((k) => i0.get(k).result !== i1.get(k).result).length,
  },
  transitions: tr,
  failures, gains, controls,
  typeCount,
};
writeFileSync(`${OUT}/m2a_summary.json`, JSON.stringify(out, null, 1));
const tsv = ["key\tresult\th0\tcommon\tkind\tplies\ttMax\tcandDist\toppDist\texits\trepeated\tmaxRep\tprogress30"];
for (const f of failures) {
  tsv.push([f.key, f.result, f.h0, f.common, f.kind, f.plies, f.tMax,
    f.candDist, f.oppDist, f.exits, f.repeated, f.maxRep, f.progressLast30].join("\t"));
}
writeFileSync(`${OUT}/m2a_failure_cases.tsv`, tsv.join("\n") + "\n");
console.log(JSON.stringify({ problems, overlap, typeCount, failures: failures.length, gains: gains.length, controls: controls.length }, null, 1));
