/**
 * Q0/Q1 审计：完整性、配对统计、聚类 bootstrap、未完成敏感性与负向翻转首次分歧。
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { createState, applyAction } from "../../src/rules.js";
import { debugCandidates } from "../../src/ai-master.js";
import { replayOpening } from "./lib.mjs";

const DIR = "_extract/p0";
const OUT = `${DIR}/q0q1`;
mkdirSync(OUT, { recursive: true });
const load = (f) => readFileSync(`${DIR}/${f}`, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const a0 = load("03_games_raw_A0e.jsonl");
const a1 = load("03_games_raw_A1e.jsonl");
const openings = load("openings.jsonl");
const opMap = new Map(openings.map((o) => [o.id, o]));

const pts = (r) => (r.result === "hell_win" ? 1 : r.result === "draw" ? 0.5 : 0);
const key = (r) => `${r.openingId}-${r.seat}`;
const idx0 = new Map(a0.map((r) => [key(r), r]));
const idx1 = new Map(a1.map((r) => [key(r), r]));

const problems = [];
for (const [k, r] of idx0) if (!idx1.has(k)) problems.push(`A1 missing ${k}`);
for (const [k, r] of idx1) if (!idx0.has(k)) problems.push(`A0 missing ${k}`);
for (const [k, r] of [...idx0, ...idx1]) {
  if (r.openingId < 10 || r.openingId > 24) problems.push(`bad opening ${k}`);
  if (r.seat !== 0 && r.seat !== 1) problems.push(`bad seat ${k}`);
}
const counts = (rs) => rs.reduce((m, r) => (m[r.result] = (m[r.result] ?? 0) + 1, m), {});
const keys = [...idx0.keys()].sort();
const deltas = keys.map((k) => pts(idx1.get(k)) - pts(idx0.get(k)));

function mean(xs) { return xs.reduce((a, b) => a + b, 0) / xs.length; }
function wilson(p, n) {
  if (!n) return [0, 0];
  const z = 1.96, d = 1 + z * z / n;
  const c = (p + z * z / (2 * n)) / d;
  const h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d;
  return [c - h, c + h];
}
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const byOpening = new Map();
for (const k of keys) {
  const id = idx0.get(k).openingId;
  if (!byOpening.has(id)) byOpening.set(id, []);
  byOpening.get(id).push(pts(idx1.get(k)) - pts(idx0.get(k)));
}
const clusters = [...byOpening.values()];
const rng = mulberry32(12345);
const boots = [];
for (let i = 0; i < 5000; i++) {
  const picked = [];
  for (let j = 0; j < clusters.length; j++) picked.push(clusters[Math.floor(rng() * clusters.length)]);
  boots.push(mean(picked.flat()));
}
boots.sort((a, b) => a - b);

const c0 = counts(a0), c1 = counts(a1);
const n = keys.length;
const rate = (c, k) => (c[k] ?? 0) / n;
const summary = {
  pairs: n,
  a0: { W: c0.hell_win ?? 0, D: c0.draw ?? 0, L: c0.hell_loss ?? 0, U: c0.unfinished ?? 0,
    winRate: rate(c0, "hell_win"), lossRate: rate(c0, "hell_loss"),
    winCI: wilson(rate(c0, "hell_win"), n), lossCI: wilson(rate(c0, "hell_loss"), n) },
  a1: { W: c1.hell_win ?? 0, D: c1.draw ?? 0, L: c1.hell_loss ?? 0, U: c1.unfinished ?? 0,
    winRate: rate(c1, "hell_win"), lossRate: rate(c1, "hell_loss"),
    winCI: wilson(rate(c1, "hell_win"), n), lossCI: wilson(rate(c1, "hell_loss"), n) },
  meanDelta: mean(deltas),
  bootstrap95: [boots[Math.floor(boots.length * 0.025)], boots[Math.floor(boots.length * 0.975)]],
  sensitivity: {
    u0: { a0: mean(a0.map(pts)), a1: mean(a1.map(pts)) },
    u05: { a0: mean(a0.map((r) => (r.result === "unfinished" ? 0.5 : pts(r)))),
           a1: mean(a1.map((r) => (r.result === "unfinished" ? 0.5 : pts(r)))) },
    u1: { a0: mean(a0.map((r) => (r.result === "unfinished" ? 1 : pts(r)))),
          a1: mean(a1.map((r) => (r.result === "unfinished" ? 1 : pts(r)))) },
  },
  flips: keys.map((k) => ({ key: k, a0: idx0.get(k).result, a1: idx1.get(k).result, delta: pts(idx1.get(k)) - pts(idx0.get(k)) }))
    .filter((x) => x.delta !== 0),
  problems,
};
writeFileSync(`${OUT}/audit.json`, JSON.stringify(summary, null, 1));

// 负向翻转首次分歧
const targets = [
  { id: 17, seat: 0 },
  { id: 20, seat: 0 },
  { id: 23, seat: 0 },
];
const flips = [];
for (const t of targets) {
  const r0 = idx0.get(`${t.id}-${t.seat}`);
  const r1 = idx1.get(`${t.id}-${t.seat}`);
  const op = opMap.get(t.id);
  let s = replayOpening(op.actions);
  const a0a = r0.actions, a1a = r1.actions;
  let i = 0;
  while (i < a0a.length && i < a1a.length && JSON.stringify(a0a[i]) === JSON.stringify(a1a[i])) {
    const r = applyAction(s, a0a[i]); s = r.state; i++;
  }
  const before = {
    ply: s.plies, turn: s.turn, players: s.players,
    dist: [requireDist(s, 0), requireDist(s, 1)],
    exits: s.topWall.filter((v) => v === 0).length,
    wallsPlaced: s.wallsPlaced,
  };
  const cands = debugCandidates(s, { netWalls: true });
  flips.push({
    ...t,
    firstDiffIndex: i,
    a0Action: a0a[i],
    a1Action: a1a[i],
    state: before,
    candidates: cands.length,
  });
}
writeFileSync(`${OUT}/negative-flips.json`, JSON.stringify(flips, null, 1));

function requireDist(state, side) {
  // 简单 BFS
  const rows = 12, cols = 10;
  const p = state.players[side];
  const seen = new Set([`${p.c},${p.r}`]);
  const q = [[p.c, p.r, 0]];
  for (let h = 0; h < q.length; h++) {
    const [c, r, d] = q[h];
    if (r === 0 && state.topWall[c] === 0) return d + 1;
    const nbs = [];
    if (r > 0 && state.hWall[c * 11 + (r - 1)] === 0) nbs.push([c, r - 1]);
    if (r < 11 && state.hWall[c * 11 + r] === 0) nbs.push([c, r + 1]);
    if (c > 0 && state.vWall[(c - 1) * 12 + r] === 0) nbs.push([c - 1, r]);
    if (c < 9 && state.vWall[c * 12 + r] === 0) nbs.push([c + 1, r]);
    for (const [nc, nr] of nbs) {
      const k = `${nc},${nr}`;
      if (!seen.has(k)) { seen.add(k); q.push([nc, nr, d + 1]); }
    }
  }
  return 30;
}

console.log(JSON.stringify(summary, null, 1));
console.log(JSON.stringify(flips, null, 1));
