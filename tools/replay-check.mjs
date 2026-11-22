/**
 * 验证已保存对局可完整重放：按记录的动作序列重建局面，对比每手哈希。
 * 用法：node tools/replay-check.mjs _extract/sp2/all.jsonl
 */

import { readFileSync } from "node:fs";
import { createState, applyAction } from "../src/rules.js";

const path = process.argv[2] || "_extract/sp2/all.jsonl";
const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);

function hash(state) {
  let h = 0x811c9dc5;
  const mix = (n) => { h ^= n & 0xff; h = Math.imul(h, 0x01000193); };
  for (const p of state.players) { mix(p.c); mix(p.r); }
  for (const v of state.vWall) mix(v);
  for (const v of state.hWall) mix(v);
  for (const v of state.topWall) mix(v);
  mix(state.turn);
  return (h >>> 0).toString(16);
}

const games = new Map();
for (const line of lines) {
  const r = JSON.parse(line);
  if (!games.has(r.g)) games.set(r.g, { moves: [], result: null });
  const g = games.get(r.g);
  if ("result" in r) g.result = r;
  else g.moves.push(r);
}

let ok = 0, bad = 0, skipped = 0, plies = 0;
const failures = [];
for (const [gid, g] of games) {
  if (!g.moves.length) { skipped++; continue; }
  const first = g.moves[0].first;
  if (first === undefined) { skipped++; continue; }
  let s = createState(first, { drawMode: "firstOnly" });
  let gameOk = true;
  for (const m of g.moves) {
    if (m.hash && hash(s) !== m.hash) {
      gameOk = false;
      failures.push({ gid, ply: m.ply, want: m.hash, got: hash(s) });
      break;
    }
    const r = applyAction(s, m.action);
    if (!r.ok) {
      gameOk = false;
      failures.push({ gid, ply: m.ply, error: r.error });
      break;
    }
    s = r.state;
    plies++;
  }
  if (gameOk) ok++; else bad++;
}

console.log(`对局 ${games.size}：重放成功 ${ok}，失败 ${bad}，跳过 ${skipped}；共重放 ${plies} 手`);
if (failures.length) {
  console.log("失败样例：", failures.slice(0, 3));
}
