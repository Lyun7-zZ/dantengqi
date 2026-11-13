/**
 * 自对弈平衡测试。
 *
 * 用法：
 *   node tools/balance.js                          # 默认：容差 0/1/2，各 400 局
 *   node tools/balance.js --games 1000 --ai greedy --tolerance 1
 *   node tools/balance.js --games 400 --wallLimit 10
 */

import { runBatch } from "../src/selfplay.js";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const games = Number(arg("games", 400));
const onlyRaw = arg("ai", null);
const only = onlyRaw ? (onlyRaw.includes(",") ? onlyRaw.split(",") : onlyRaw) : null;
const seed = Number(arg("seed", 20261112));
const maxPlies = Number(arg("maxPlies", 600));
const tolArg = arg("tolerance", null);
const limitArg = arg("wallLimit", null);

const configs = only ? [only] : ["greedy", "random"];
const tolerances = tolArg !== null ? [Number(tolArg)] : [0, 1, 2];
const drawMode = arg("drawMode", "symmetric");
const wallLimitRaw = arg("wallLimit", null);
const wallLimit = wallLimitRaw
  ? (wallLimitRaw.includes(",") ? wallLimitRaw.split(",").map(Number) : Number(wallLimitRaw))
  : Infinity;

const width = (s) => [...String(s)].reduce((n, ch) => n + (ch.charCodeAt(0) > 0x2e80 ? 2 : 1), 0);
const pad = (s, w) => String(s) + " ".repeat(Math.max(0, w - width(s)));

const head = ["AI", "容差", "墙上限", "先手胜", "后手胜", "平局", "先手胜率", "平局率", "平均回合", "平均墙数"];
console.log(`自对弈：${games} 局/配置，seed=${seed}，maxPlies=${maxPlies}，墙上限=${wallLimit}\n`);
console.log(head.map((s) => pad(s, 11)).join(""));

for (const ai of configs) {
  for (const tolerance of tolerances) {
    const t0 = Date.now();
    const r = runBatch(games, { ai, seed, maxPlies, tolerance, wallLimit, drawMode });
    const ms = Date.now() - t0;
    const row = [
      Array.isArray(ai) ? ai.join(" vs ") : ai,
      tolerance,
      Number.isFinite(wallLimit) ? wallLimit : "不限",
      r.win0,
      r.win1,
      r.draw,
      r.firstPlayerWinRateAmongDecided ?? "-",
      r.drawRate,
      r.avgPlies,
      r.avgWalls,
    ];
    console.log(row.map((s) => pad(s, 11)).join("") + `(${ms}ms)`);
  }
}

console.log("\n判读标准：先手胜率 45%–55%、平局率 < 35% 视为平衡。");
