import test from "node:test";
import assert from "node:assert/strict";

import { createState, applyAction, validateAction, normalizeState } from "../src/rules.js";
import { loadSlots, saveSlot } from "../src/storage.js";

function fakeStorage(initial) {
  const map = new Map(initial ? [["danteng.slots.v1", initial]] : []);
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, v),
  };
}

function stateAfterOneMove() {
  const s = createState(0);
  const r = applyAction(s, { type: "move", dir: "up" });
  assert.equal(r.ok, true);
  return r.state;
}

test("JSON 往返后 wallLimit 不会把墙全部禁掉", () => {
  const s = stateAfterOneMove();
  const restored = normalizeState(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(restored.wallLimit, [Infinity, Infinity]);
  const wall = validateAction(restored, { type: "wall", kind: "h", c: 0, r: 0 });
  assert.equal(wall.ok, true);
});

test("loadSlots 修复旧存档中的 wallLimit=null", () => {
  const s = stateAfterOneMove();
  const legacy = { id: "old", name: "旧存档", state: JSON.parse(JSON.stringify(s)), clocks: null };
  const storage = fakeStorage(JSON.stringify([legacy]));
  const [slot] = loadSlots(storage);
  assert.deepEqual(slot.state.wallLimit, [Infinity, Infinity]);
  assert.equal(validateAction(slot.state, { type: "wall", kind: "h", c: 0, r: 0 }).ok, true);
});

test("saveSlot 后重新读取仍可下墙", () => {
  const storage = fakeStorage();
  const s = stateAfterOneMove();
  const res = saveSlot({ name: "测试", state: s, actions: [] }, storage);
  assert.equal(res.ok, true);
  const [slot] = loadSlots(storage);
  assert.equal(validateAction(slot.state, { type: "wall", kind: "v", c: 3, r: 3 }).ok, true);
});
