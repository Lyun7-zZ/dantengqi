/**
 * 调试：我方大师 vs 朋友大师（同一引擎），打印每步耗时与行动。
 *   node tools/debug-master.mjs --ms 200
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
return { createState, cloneState, applyAction, distanceOf, legalDirs, legalActions, shortestPathWalls, stepTarget, validateAction, distanceToGoal, hasPath, allWallSlots, autoMove, setWall, wallPlaced, COLS, ROWS, V_COUNT, H_COUNT, TOP_COUNT, AI, createMasterAI };`)();

const ourAiSrc = (await Promise.all(
  ["src/ai-random.js", "src/ai-master.js", "src/ai.js"].map((f) => readFile(join(root, f), "utf-8")),
)).join("\n");
const stripped = ourAiSrc
  .split("\n")
  .filter((l) => !l.startsWith("import ") && !l.startsWith("export {"))
  .join("\n")
  .replace(/^export\s+(function|const|let|class)/gm, "$1");

const ourAI = new Function("deps", `
const { legalDirs, applyAction, distanceOf, shortestPathWalls, legalActions, stepTarget, validateAction, distanceToGoal, hasPath, allWallSlots, autoMove, setWall, wallPlaced, cloneState, createState, COLS, ROWS, V_COUNT, H_COUNT, TOP_COUNT } = deps;
${stripped}
return { AI, makeSearchAI, createMasterAI };
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

const ms = Number(process.argv[process.argv.indexOf("--ms") + 1] || 200);
const ours = ourAI.createMasterAI({ timeMs: ms, maxDepth: 6, usePlan: true });
const theirs = sandbox.createMasterAI({ timeMs: ms, maxDepth: 6, usePlan: true });

let state = sandbox.createState(0);
let ply = 0;
while (state.winner === null && ply < 300) {
  const isOurs = state.turn === 0;
  const ai = isOurs ? ours : theirs;
  const t0 = Date.now();
  const action = ai(state, Math.random);
  const dt = Date.now() - t0;
  const res = sandbox.applyAction(state, action);
  if (!res.ok) {
    console.log(`第 ${ply} 手 ${isOurs ? "我方" : "对方"} 非法: ${res.error}`, action);
    break;
  }
  if (ply < 12 || res.state.winner !== null) {
    console.log(`第 ${String(ply).padStart(3)} 手 ${isOurs ? "我方" : "对方"} ${dt}ms ${JSON.stringify(action)}`);
  }
  state = res.state;
  ply++;
}
console.log("结果:", state.winner, "手数:", state.plies);
