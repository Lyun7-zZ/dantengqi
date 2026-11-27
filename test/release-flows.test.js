import test from "node:test";
import assert from "node:assert/strict";
import { createState, applyAction } from "../src/rules.js";
import {
  createGameRecord, recordAction, finalizeGame, replayGame, saveGame, loadGames,
  createPositionRecord, savePosition, loadPositions, parseImport,
} from "../src/game-library.js";

function mem() {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
}
function step(rec, s, action) {
  const by = s.turn;
  const r = applyAction(s, action);
  assert.ok(r.ok);
  recordAction(rec, action, by);
  return r.state;
}

function terminal(winnerSeat, kind = "exit", firstPlayer = 0) {
  let s = createState(firstPlayer);
  if (kind === "draw") {
    s.players = [{ c: 5, r: 0 }, { c: 6, r: 0 }];
    s.turn = firstPlayer;
  } else if (winnerSeat === 0) {
    s.players = [{ c: 5, r: 0 }, { c: 0, r: 11 }];
    s.turn = 0;
  } else {
    s.players = [{ c: 0, r: 11 }, { c: 5, r: 0 }];
    s.turn = 0;
  }
  const rec = createGameRecord({ mode: "local", seat: winnerSeat, firstPlayer, state: s });
  if (kind === "draw") {
    s = step(rec, s, { type: "move", dir: "up" });
  } else if (winnerSeat === 0) {
    s = step(rec, s, { type: "move", dir: "up" });
  } else {
    s = step(rec, s, { type: "move", dir: "right" });
    if (s.winner === null) s = step(rec, s, { type: "move", dir: "up" });
  }
  return { rec, s };
}

test("12 局产品流程：胜/平/负、双座位、退出、保存/导入/复盘", () => {
  const store = mem();
  const cases = [
    ["seat0-win", 0, "exit", 0], ["seat1-win", 1, "exit", 0],
    ["seat0-loss", 1, "exit", 0], ["seat1-loss", 0, "exit", 0],
    ["draw-0", 0, "draw", 0], ["draw-1", 1, "draw", 0],
    ["seat0-win-fp1", 0, "exit", 1], ["seat1-win-fp1", 1, "exit", 1],
    ["seat0-loss-fp1", 1, "exit", 1], ["seat1-loss-fp1", 0, "exit", 1],
    ["draw-fp1-0", 0, "draw", 1], ["draw-fp1-1", 1, "draw", 1],
  ];
  for (const [name, seat, kind, fp] of cases) {
    const { rec, s } = terminal(seat, kind, fp);
    assert.equal(s.winner, kind === "draw" ? "draw" : seat, name);
    finalizeGame(rec, s);
    const rp = replayGame(rec);
    assert.ok(rp.ok, name);
    assert.equal(rp.final.winner, s.winner, name);
    saveGame(rec, store);
    const loaded = loadGames(store).find((g) => g.gameId === rec.gameId);
    assert.ok(loaded, name);
    const imp = parseImport(JSON.stringify(loaded));
    assert.ok(imp.ok, name);
  }

  // 生命周期：局面保存/读取
  const posState = createState(0);
  const pos = createPositionRecord({ state: posState, name: "流程局面" });
  savePosition(pos, store);
  assert.equal(loadPositions(store).length, 1);
  assert.ok(parseImport(JSON.stringify(pos)).ok);

  // 复盘跳转：首/中/尾状态与动作一致
  const { rec, s } = terminal(0);
  const rp = replayGame(rec);
  assert.equal(rp.states.length, rec.actions.length + 1);
  assert.deepEqual(rp.states[0].players, rec.initialState.players);
  assert.equal(rp.states[rp.states.length - 1].winner, s.winner);

  // 导入拒绝非法动作
  const bad = JSON.parse(JSON.stringify(rec));
  bad.actions[0].action = { type: "move", dir: "bad" };
  assert.equal(parseImport(JSON.stringify(bad)).ok, false);
});
