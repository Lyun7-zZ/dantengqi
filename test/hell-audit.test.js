import test from "node:test";
import assert from "node:assert/strict";

import { createMasterAI } from "../src/ai-master.js";
import { createState } from "../src/rules.js";

function ai() {
  return createMasterAI({ timeMs: 200, maxDepth: 4, usePlan: false, netWalls: true });
}

/** 只留 A、F 两个出口；先手 A1、后手 F1：直接越线是平，先封 F 才能赢。 */
test("能赢时不取平：不直接越线", () => {
  const s = createState(0, { drawMode: "firstOnly" });
  for (let c = 0; c < 10; c++) if (c !== 0 && c !== 5) s.topWall[c] = 1;
  s.players[0] = { c: 0, r: 0 };
  s.players[1] = { c: 5, r: 0 };
  s.turn = 0;
  const a = ai()(s, Math.random);
  assert.ok(a, "应返回动作");
  const isExit = a.type === "move" && a.dir === "up";
  assert.equal(isExit, false, "不应直接越线取平，应尝试封掉对手出口");
});

test("能直接赢时仍直接越线", () => {
  const s = createState(0, { drawMode: "firstOnly" });
  s.players[0] = { c: 0, r: 0 };
  s.players[1] = { c: 9, r: 11 };
  s.turn = 0;
  const a = ai()(s, Math.random);
  assert.deepEqual(a, { type: "move", dir: "up" });
});

test("逐手日志包含决策来源", () => {
  const s = createState(0, { drawMode: "firstOnly" });
  s.players[0] = { c: 0, r: 0 };
  s.players[1] = { c: 5, r: 0 };
  s.turn = 0;
  const bot = ai();
  bot(s, Math.random);
  assert.ok(bot.stats.lastLog, "应记录 lastLog");
  assert.ok(typeof bot.stats.lastLog.source === "string");
});
