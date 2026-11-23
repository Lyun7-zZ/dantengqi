/**
 * D1-R：从原始对局重放，导出 78 个「墙更优」局面的完整真实状态。
 * 用法：node tools/rl/export-positions.mjs [最多局面数]
 */

import { readFileSync, writeFileSync } from "node:fs";
import { createState, applyAction, distanceOf, validateAction } from "../../src/rules.js";

const MAX = Number(process.argv[2] || 120);
const SRC = "_extract/sp2/all.jsonl";
const LABELS = "_extract/labels2-all.jsonl";
const OUT = "_extract/rl2/diag/d1r-positions.jsonl";

const games = new Map();
for (const line of readFileSync(SRC, "utf8").split("\n")) {
  if (!line.trim()) continue;
  const r = JSON.parse(line);
  if (!games.has(r.g)) games.set(r.g, []);
  if (!("result" in r)) games.get(r.g).push(r);
}

// 选局面：教师最佳着法为墙，且领先最佳走子 >= 50
const wanted = [];
for (const line of readFileSync(LABELS, "utf8").split("\n")) {
  if (!line.trim()) continue;
  const row = JSON.parse(line);
  const items = [...row.items].sort((a, b) => b.score - a.score);
  const best = items[0];
  if (best.action.type === "move") continue;
  const bestMove = Math.max(...items.filter((i) => i.action.type === "move").map((i) => i.score), -Infinity);
  if (!Number.isFinite(bestMove) || best.score - bestMove < 50) continue;
  wanted.push({ gid: row.gid, ply: row.ply, side: row.side, items: row.items, teacher: best.action, gap: best.score - bestMove });
  if (wanted.length >= MAX) break;
}

const byGame = new Map();
for (const w of wanted) {
  if (!byGame.has(w.gid)) byGame.set(w.gid, []);
  byGame.get(w.gid).push(w);
}

const out = [];
for (const [gid, targets] of byGame) {
  const moves = games.get(gid);
  if (!moves || !moves.length) continue;
  let s = createState(moves[0].first, { drawMode: "firstOnly" });
  const targetSet = new Map(targets.map((t) => [t.ply, t]));
  for (const mv of moves) {
    const t = targetSet.get(mv.ply);
    if (t) {
      const legal = validateAction(s, t.teacher);
      out.push({
        gid, ply: t.ply, side: t.side,
        state: {
          vWall: Array.from(s.vWall), hWall: Array.from(s.hWall), topWall: Array.from(s.topWall),
          players: s.players.map((p) => ({ c: p.c, r: p.r })),
          turn: s.turn, firstPlayer: s.firstPlayer, wallsPlaced: s.wallsPlaced,
          wallLimit: s.wallLimit.map((v) => (Number.isFinite(v) ? v : 9999)),
          wallsUsed: [...s.wallsUsed], tolerance: s.tolerance, drawMode: s.drawMode,
          winner: s.winner, plies: s.plies,
          dist: [distanceOf(s, 0), distanceOf(s, 1)],
        },
        teacher: t.teacher,
        teacherLegal: legal.ok,
        gap: t.gap,
        items: t.items,
      });
    }
    const r = applyAction(s, mv.action);
    if (!r.ok) break;
    s = r.state;
  }
}
writeFileSync(OUT, out.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
console.log(`导出 ${out.length} 个局面（目标 ${wanted.length}），教师最佳墙合法 ${out.filter((r) => r.teacherLegal).length} 个`);
