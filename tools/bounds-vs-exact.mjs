/**
 * P0 审计：比较「窄窗口根分数（可能为上界）」与「全窗口逐候选精确分数」的排序。
 * 用法：node tools/bounds-vs-exact.mjs <labels> <局面数> [输出json]
 */

import { readFileSync, writeFileSync } from "node:fs";
import { createState, applyAction } from "../src/rules.js";
import { debugRootScores } from "../src/ai-master.js";

const SRC = process.argv[2] || "_extract/labels-deep.jsonl";
const COUNT = Number(process.argv[3] || 6);
const OUT = process.argv[4] || "_extract/bounds-vs-exact.json";

const rows = readFileSync(SRC, "utf8").split("\n").filter(Boolean).slice(0, COUNT).map((l) => JSON.parse(l));

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

const key = (a) => (a.type === "move" ? "m:" + a.dir : "w:" + a.kind + ":" + a.c + ":" + a.r);

function ranks(xs) {
  const order = xs.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]);
  const r = new Array(xs.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[order[k][1]] = avg;
    i = j + 1;
  }
  return r;
}

function spearman(a, b) {
  const ra = ranks(a);
  const rb = ranks(b);
  const n = a.length;
  const ma = ra.reduce((x, y) => x + y, 0) / n;
  const mb = rb.reduce((x, y) => x + y, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    num += (ra[i] - ma) * (rb[i] - mb);
    da += (ra[i] - ma) ** 2;
    db += (rb[i] - mb) ** 2;
  }
  return da === 0 || db === 0 ? null : num / Math.sqrt(da * db);
}

const results = [];
for (const row of rows) {
  const s = buildState(row.state, row.first);
  const bounded = new Map(row.items.map((i) => [key(i.action), i.score]));
  const depth = row.depth;
  const t0 = Date.now();
  const exact = debugRootScores(s, { depth, candOpts: { netWalls: true }, routeWalls: 3 });
  const exactMap = new Map(exact.items.map((i) => [key(i.action), i.score]));
  const common = [...bounded.keys()].filter((k) => exactMap.has(k));
  if (common.length < 3) continue;
  const a = common.map((k) => bounded.get(k));
  const b = common.map((k) => exactMap.get(k));
  const rho = spearman(a, b);
  const bestB = common.reduce((x, k) => (bounded.get(k) > bounded.get(x) ? k : x), common[0]);
  const bestE = common.reduce((x, k) => (exactMap.get(k) > exactMap.get(x) ? k : x), common[0]);
  results.push({
    gid: row.gid,
    ply: row.ply,
    depth,
    n: common.length,
    spearman: rho,
    bestSame: bestB === bestE,
    elapsed: Date.now() - t0,
    exactRange: [Math.min(...b), Math.max(...b)],
    boundedRange: [Math.min(...a), Math.max(...a)],
  });
  console.log(
    `gid ${row.gid} ply ${row.ply} depth ${depth} 候选 ${common.length} ` +
    `Spearman ${rho === null ? "n/a" : rho.toFixed(3)} 最佳一致 ${bestB === bestE} ` +
    `${((Date.now() - t0) / 1000).toFixed(1)}s`,
  );
}

const valid = results.filter((r) => r.spearman !== null);
const avg = valid.reduce((s, r) => s + r.spearman, 0) / Math.max(1, valid.length);
console.log(`\n局面 ${results.length}：平均 Spearman ${avg.toFixed(3)}，最佳一致 ${results.filter((r) => r.bestSame).length}/${results.length}`);
writeFileSync(OUT, JSON.stringify(results, null, 1), "utf8");
console.log(`写入 ${OUT}`);
