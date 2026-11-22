/**
 * Stage 1：从已保存对局中抽样局面，跑固定深度教师搜索，导出根候选分数与动作特征。
 *
 * 用法：node tools/label-positions.mjs <位置数> <输出jsonl> [深度] [每局最多位置数]
 */

import { readFileSync, writeFileSync } from "node:fs";
import { createState, applyAction, legalDirs, distanceOf } from "../src/rules.js";
import { debugRootScores, debugPathCount } from "../src/ai-master.js";
import { COLS, ROWS } from "../src/board.js";

const TARGET = Number(process.argv[2] || 300);
const OUT = process.argv[3] || "_extract/labels.jsonl";
const DEPTH = Number(process.argv[4] || 8);
const PER_GAME = Number(process.argv[5] || 3);
const SRC = process.argv[6] || "_extract/sp2/all.jsonl";

const lines = readFileSync(SRC, "utf8").split("\n").filter(Boolean);
const games = new Map();
for (const line of lines) {
  const r = JSON.parse(line);
  if (!games.has(r.g)) games.set(r.g, { moves: [] });
  if (!("result" in r)) games.get(r.g).moves.push(r);
}

function feats(state, side, before) {
  const me = state.players[side];
  const opp = state.players[1 - side];
  const dMe = distanceOf(state, side);
  const dOpp = distanceOf(state, 1 - side);
  return {
    dMe, dOpp, margin: dOpp - dMe,
    exits: state.topWall.filter((v) => v === 0).length,
    pathsMe: debugPathCount(state, side),
    pathsOpp: debugPathCount(state, 1 - side),
    movesMe: legalDirs(state, me.c, me.r).length,
    movesOpp: legalDirs(state, opp.c, opp.r).length,
    wallsPlaced: state.wallsPlaced,
    gainMe: before ? dMe - before.dMe : 0,
    gainOpp: before ? dOpp - before.dOpp : 0,
    net: before ? (dOpp - before.dOpp) - (dMe - before.dMe) : 0,
    cut: before ? before.pathsOpp - debugPathCount(state, 1 - side) : 0,
    isMove: 0,
  };
}

const out = [];
let picked = 0;
const pliesToSample = [20, 45, 70, 95, 120];

for (const [gid, g] of games) {
  if (picked >= TARGET) break;
  if (!g.moves.length) continue;
  const first = g.moves[0].first;
  let s = createState(first, { drawMode: "firstOnly" });
  let taken = 0;
  for (const m of g.moves) {
    if (taken < PER_GAME && pliesToSample.includes(m.ply) && picked < TARGET) {
      const side = s.turn;
      const before = feats(s, side, null);
      const res = debugRootScores(s, {
        depth: DEPTH,
        candOpts: { netWalls: true },
        routeWalls: 3,
      });
      const items = [];
      for (const it of res.items) {
        const r = applyAction(s, it.action);
        if (!r.ok) continue;
        const f = feats(r.state, side, before);
        f.isMove = it.action.type === "move" ? 1 : 0;
        items.push({ action: it.action, score: it.score, f });
      }
      if (items.length >= 2) {
        out.push({
          gid,
          ply: m.ply,
          side,
          first,
          state: {
            vWall: Array.from(s.vWall),
            hWall: Array.from(s.hWall),
            topWall: Array.from(s.topWall),
            players: s.players.map((p) => ({ c: p.c, r: p.r })),
            turn: s.turn,
            firstPlayer: s.firstPlayer,
            wallsPlaced: s.wallsPlaced,
          },
          chosen: m.action,
          depth: res.depth,
          nodes: res.nodes,
          items,
        });
        picked++;
        taken++;
      }
    }
    const r = applyAction(s, m.action);
    if (!r.ok) break;
    s = r.state;
  }
}

writeFileSync(OUT, out.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
console.log(`写入 ${OUT}：${out.length} 个局面，深度 ${DEPTH}`);
