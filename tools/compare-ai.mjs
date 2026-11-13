/**
 * 两套 AI 的对抗测试。
 *
 * 做法：从朋友的单文件里抽出「引擎 + 他家的 AI」，再把我方的 AI 注入同一引擎，
 * 这样两边看到的规则、状态、随机数完全一致，胜率才有可比性。
 *
 *   node tools/compare-ai.mjs --games 8 --ms 200
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const games = Number(arg("games", 8));
const ms = Number(arg("ms", 200));
const maxPlies = Number(arg("maxPlies", 400));
const ourMs = Number(arg("ourMs", 450));
const theirHardMs = Number(arg("theirHardMs", 350));
const theirMasterMs = Number(arg("theirMasterMs", 1200));
const only = arg("only", "all");

/* ---------- 1. 从朋友的 HTML 抽出引擎 + 他家 AI ---------- */

const html = await readFile(join(root, "蛋疼棋wwh-1.0.html"), "utf-8");
const lines = html.split("\n");
const start = lines.findIndex((l) => l.includes("===== src/config.js"));
const end = lines.findIndex((l) => l.trim().startsWith('window.__'));
if (start < 0 || end < 0) throw new Error("没找到引擎区块");
const engineSrc = lines.slice(start, end).join("\n");

const sandbox = new Function(`const window = {}; const document = { getElementById: () => null };
${engineSrc}
return { createState, cloneState, applyAction, distanceOf, legalDirs, legalActions, shortestPathWalls, stepTarget, validateAction, distanceToGoal, hasPath, allWallSlots, autoMove, setWall, wallPlaced, COLS, ROWS, V_COUNT, H_COUNT, TOP_COUNT, AI, createMasterAI };`)();

/* ---------- 2. 把我们自己的 AI 注入同一个引擎 ---------- */

const ourAiSrc = (await Promise.all(
  ["src/ai-random.js", "src/ai-master.js", "src/ai.js"]
    .map((f) => readFile(join(root, f), "utf-8")),
)).join("\n");
const stripped = ourAiSrc
  .split("\n")
  .filter((l) => !l.startsWith("import ") && !l.startsWith("export {"))
  .join("\n")
  .replace(/^export\s+(function|const|let|class)/gm, "$1");

const ourAI = new Function("deps", `
const { legalDirs, applyAction, distanceOf, shortestPathWalls, legalActions, stepTarget, validateAction, distanceToGoal, hasPath, allWallSlots, autoMove, setWall, wallPlaced, cloneState, createState, COLS, ROWS, V_COUNT, H_COUNT, TOP_COUNT } = deps;
${stripped}
return { AI, makeSearchAI };
`)({
  legalDirs: sandbox.legalDirs,
  applyAction: sandbox.applyAction,
  distanceOf: sandbox.distanceOf,
  legalActions: sandbox.legalActions,
  shortestPathWalls: sandbox.shortestPathWalls,
  stepTarget: sandbox.stepTarget,
  validateAction: sandbox.validateAction,
  cloneState: sandbox.cloneState,
  createState: sandbox.createState,
  V_COUNT: sandbox.V_COUNT,
  TOP_COUNT: sandbox.TOP_COUNT,
  distanceToGoal: sandbox.distanceToGoal,
  hasPath: sandbox.hasPath,
  allWallSlots: sandbox.allWallSlots,
  autoMove: sandbox.autoMove,
  setWall: sandbox.setWall,
  wallPlaced: sandbox.wallPlaced,
  COLS: sandbox.COLS,
  ROWS: sandbox.ROWS,
  H_COUNT: sandbox.H_COUNT,
});

/* ---------- 3. 对局 ---------- */

function playGame(aiA, aiB, firstSeat, rng) {
  aiA.reset?.();
  aiB.reset?.();
  let state = sandbox.createState(firstSeat);
  while (state.winner === null && state.plies < maxPlies) {
    const policy = state.turn === 0 ? aiA : aiB;
    const action = policy(state, rng);
    const res = sandbox.applyAction(state, action);
    if (!res.ok) throw new Error(`非法行动 ${JSON.stringify(action)}: ${res.error}`);
    state = res.state;
  }
  return state.winner; // 0 | 1 | "draw" | null
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function matchup(name, aiA, aiB) {
  // 交换先后手，抵消先手优势
  let aWin = 0, bWin = 0, draw = 0, timeout = 0;
  const half = Math.ceil(games / 2);
  for (let i = 0; i < games; i++) {
    const aFirst = i < half;
    const rng = mulberry32(1000 + i * 7919);
    const w = playGame(aFirst ? aiA : aiB, aFirst ? aiB : aiA, aFirst ? 0 : 1, rng);
    const aIsSeat0 = aFirst;
    if (w === null) timeout++;
    else if (w === "draw") draw++;
    else if ((w === 0) === aIsSeat0) aWin++;
    else bWin++;
  }
  console.log(
    `${name.padEnd(28)} A胜 ${String(aWin).padStart(2)}   B胜 ${String(bWin).padStart(2)}`
    + `   平 ${String(draw).padStart(2)}   超时 ${timeout}`
    + `   A胜率 ${((aWin / games) * 100).toFixed(0)}%`,
  );
  return { aWin, bWin, draw, timeout };
}

console.log(`比对：${games} 局/组；我方 ${ourMs}ms，对方困难 ${theirHardMs}ms、大师 ${theirMasterMs}ms\n`);

const theirMaster = sandbox.createMasterAI({ timeMs: theirMasterMs, maxDepth: 6, usePlan: true });
const theirHard = sandbox.createMasterAI({ timeMs: theirHardMs, maxDepth: 4, usePlan: false });
const ourHard = ourAI.makeSearchAI({ timeMs: ourMs });
const ourNormal = ourAI.AI.normal;
const ourMaster = ourAI.AI.master;

if (only === "all" || only === "control") matchup("对照：我方困难 vs 我方普通", ourHard, ourNormal);
if (only === "all" || only === "self") matchup("对照：我方困难(自引擎) vs 我方普通", ourAI.makeSearchAI({ timeMs: ourMs }), ourNormal);
if (only === "all" || only === "hard") matchup("我方困难 vs 对方困难", ourHard, theirHard);
if (only === "all" || only === "master") matchup("我方困难 vs 对方大师", ourHard, theirMaster);
if (only === "port") matchup("移植版大师 vs 对方大师（应接近 50%）", ourMaster, theirMaster);
