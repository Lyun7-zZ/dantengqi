/**
 * 同一引擎、同一思考预算下，我方大师 vs 朋友大师。
 * 每局重建实例，避免计划状态跨局泄漏。
 *
 *   node tools/master-vs-master.mjs --games 6 --ms 150
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const html = await readFile(join(root, "蛋疼棋wwh-1.0.html"), "utf-8");
const lines = html.split("\n");
const start = lines.findIndex((l) => l.includes("===== src/config.js"));
const end = lines.findIndex((l) => l.trim().startsWith("window.__"));
const engineSrc = lines.slice(start, end).join("\n");

const sandbox = new Function(`const window = {}; const document = { getElementById: () => null };
${engineSrc}
return { createState, cloneState, applyAction, distanceOf, legalDirs, legalActions, shortestPathWalls, stepTarget, validateAction, distanceToGoal, hasPath, allWallSlots, autoMove, setWall, wallPlaced, COLS, ROWS, V_COUNT, H_COUNT, TOP_COUNT, createMasterAI };`)();

const src = (await Promise.all(
  ["src/ai-random.js", "src/ai-master.js", "src/ai.js"].map((f) => readFile(join(root, f), "utf-8")),
)).join("\n");
const stripped = src
  .split("\n")
  .filter((l) => !l.startsWith("import ") && !l.startsWith("export {"))
  .join("\n")
  .replace(/^export\s+(function|const|let|class)/gm, "$1");

const ourMod = new Function("deps", `
const { legalDirs, applyAction, distanceOf, shortestPathWalls, legalActions, stepTarget, validateAction, distanceToGoal, hasPath, allWallSlots, autoMove, setWall, wallPlaced, cloneState, createState, COLS, ROWS, V_COUNT, H_COUNT, TOP_COUNT } = deps;
${stripped}
return { createMasterAI };
`)({
  legalDirs: sandbox.legalDirs,
  applyAction: sandbox.applyAction,
  distanceOf: sandbox.distanceOf,
  legalActions: sandbox.legalActions,
  shortestPathWalls: sandbox.shortestPathWalls,
  stepTarget: sandbox.stepTarget,
  validateAction: sandbox.validateAction,
  distanceToGoal: sandbox.distanceToGoal,
  hasPath: sandbox.hasPath,
  allWallSlots: sandbox.allWallSlots,
  autoMove: sandbox.autoMove,
  setWall: sandbox.setWall,
  wallPlaced: sandbox.wallPlaced,
  cloneState: sandbox.cloneState,
  createState: sandbox.createState,
  COLS: sandbox.COLS,
  ROWS: sandbox.ROWS,
  V_COUNT: sandbox.V_COUNT,
  H_COUNT: sandbox.H_COUNT,
  TOP_COUNT: sandbox.TOP_COUNT,
});

const games = Number(process.argv[process.argv.indexOf("--games") + 1] || 6);
const ms = Number(process.argv[process.argv.indexOf("--ms") + 1] || 150);

let ourWins = 0;
let theirWins = 0;
let draws = 0;

for (let i = 0; i < games; i++) {
  const ourSeat = i % 2; // 交替先后手
  const ours = ourMod.createMasterAI({ timeMs: ms, maxDepth: 6, usePlan: true });
  const theirs = sandbox.createMasterAI({ timeMs: ms, maxDepth: 6, usePlan: true });

  const bySeat = [null, null];
  bySeat[ourSeat] = ours;
  bySeat[1 - ourSeat] = theirs;

  let state = sandbox.createState(0);
  let plies = 0;
  while (state.winner === null && plies < 400) {
    const ai = bySeat[state.turn];
    const res = sandbox.applyAction(state, ai(state, Math.random));
    if (!res.ok) throw new Error(`非法行动 ${res.error}`);
    state = res.state;
    plies++;
  }

  if (state.winner === "draw") draws++;
  else if (state.winner === ourSeat) ourWins++;
  else theirWins++;
  console.log(`第 ${i + 1} 局：我方执${ourSeat === 0 ? "先" : "后"}，${state.winner === "draw" ? "平局" : state.winner === ourSeat ? "我方胜" : "对方胜"}（${plies} 手）`);
}

console.log(`\n合计：我方 ${ourWins} 胜 / 对方 ${theirWins} 胜 / 平 ${draws}`);
