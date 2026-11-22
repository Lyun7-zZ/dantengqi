/**
 * 用全窗口精确分数重标局面（固定深度），供排序模型训练。
 * 用法：node tools/relabel-exact.mjs <输入labels> <输出> <局面数> [深度]
 */

import { readFileSync, writeFileSync } from "node:fs";
import { createState, applyAction, legalDirs, distanceOf } from "../src/rules.js";
import { debugRootScores, debugPathCount } from "../src/ai-master.js";

const SRC = process.argv[2] || "_extract/labels-300.jsonl";
const OUT = process.argv[3] || "_extract/labels-exact.jsonl";
const COUNT = Number(process.argv[4] || 300);
const DEPTH = Number(process.argv[5] || 8);

const rows = readFileSync(SRC, "utf8").split("\n").filter(Boolean).slice(0, COUNT).map((l) => JSON.parse(l));

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

function buildState(st, first) {
  const s = createState(first, { drawMode: "firstOnly" });
  s.vWall.set(st.vWall);
  s.hWall.set(st.hWall);
  s.topWall.set(st.topWall);
  s.players = st.players.map((p) => ({ c: p.c, r: p.r }));
  s.turn = st.turn;
  s.firstPlayer = st.firstPlayer;
  s.wallsPlaced = st.wallsPlaced;
  return s;
}

const out = [];
const t0 = Date.now();
for (const row of rows) {
  const s = buildState(row.state, row.first);
  const side = s.turn;
  const before = feats(s, side, null);
  const res = debugRootScores(s, { depth: DEPTH, candOpts: { netWalls: true }, routeWalls: 3 });
  const items = [];
  for (const it of res.items) {
    const r = applyAction(s, it.action);
    if (!r.ok) continue;
    const f = feats(r.state, side, before);
    f.isMove = it.action.type === "move" ? 1 : 0;
    items.push({ action: it.action, score: it.score, f });
  }
  out.push({ ...row, depth: DEPTH, exact: true, items });
  if (out.length % 20 === 0) {
    console.log(`已标注 ${out.length}/${rows.length}，用时 ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
}
writeFileSync(OUT, out.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
console.log(`完成 ${out.length} 个局面，深度 ${DEPTH}，总耗时 ${((Date.now() - t0) / 1000).toFixed(0)}s`);
