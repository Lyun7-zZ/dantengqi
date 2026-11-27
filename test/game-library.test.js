import test from "node:test";
import assert from "node:assert/strict";
import { createState, applyAction, legalActions, validateAction } from "../src/rules.js";
import {
  createGameRecord, recordAction, finalizeGame, replayGame, saveGame, loadGames,
  createPositionRecord, savePosition, loadPositions, parseImport, stateToJson,
} from "../src/game-library.js";

function mem() {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
}

test("GL：记录、重放与导入导出一致", () => {
  let s = createState(0);
  const rec = createGameRecord({ mode: "local", seat: 0, firstPlayer: 0, state: s });
  for (let i = 0; i < 8; i++) {
    const acts = legalActions(s).filter((a) => validateAction(s, a).ok);
    const a = acts[0];
    const by = s.turn;
    const r = applyAction(s, a);
    assert.ok(r.ok);
    recordAction(rec, a, by);
    s = r.state;
    if (s.winner !== null) break;
  }
  finalizeGame(rec, s);
  const rp = replayGame(rec);
  assert.ok(rp.ok);
  assert.deepEqual(stateToJson(rp.final), stateToJson(s));
  const imp = parseImport(JSON.stringify(rec));
  assert.ok(imp.ok);
  assert.equal(imp.kind, "game");
});

test("GL：本地保存/读取对局与局面", () => {
  const st = mem();
  const s = createState(0);
  const rec = createGameRecord({ mode: "local", seat: 1, firstPlayer: 0, state: s });
  saveGame(rec, st);
  assert.equal(loadGames(st).length, 1);
  const pos = createPositionRecord({ state: s, name: "测试局面" });
  savePosition(pos, st);
  assert.equal(loadPositions(st).length, 1);
  const imp = parseImport(JSON.stringify(pos));
  assert.ok(imp.ok);
  assert.equal(imp.kind, "position");
});

test("GL：非法导入被拒绝", () => {
  const bad = parseImport(JSON.stringify({ kind: "game", schemaVersion: 1, actions: [] }));
  assert.equal(bad.ok, false);
  const bad2 = parseImport("not-json");
  assert.equal(bad2.ok, false);
});
