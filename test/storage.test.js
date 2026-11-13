import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_SLOTS, loadSlots, saveSlot, deleteSlot, clearSlots,
  defaultSlotName, slotFileName,
} from "../src/storage.js";

function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

test("默认存档名精确到秒", () => {
  const d = new Date(2026, 10, 13, 9, 5, 7);
  assert.equal(defaultSlotName(d), "2026-11-13 09:05:07");
});

test("最多 3 个，超出返回 full", () => {
  const s = fakeStorage();
  for (let i = 0; i < MAX_SLOTS; i++) {
    const r = saveSlot({ name: `s${i}`, plies: i + 1 }, s);
    assert.equal(r.ok, true);
  }
  const over = saveSlot({ name: "x" }, s);
  assert.equal(over.ok, false);
  assert.equal(over.error, "full");
  assert.equal(loadSlots(s).length, MAX_SLOTS);
});

test("新存档排在最前，字段完整", () => {
  const s = fakeStorage();
  saveSlot({ name: "第一次", roomCode: "ABC123", plies: 7, actions: [{ ply: 1 }] }, s);
  const [slot] = loadSlots(s);
  assert.equal(slot.name, "第一次");
  assert.equal(slot.roomCode, "ABC123");
  assert.equal(slot.plies, 7);
  assert.equal(slot.actions.length, 1);
  assert.ok(slot.id);
  assert.ok(slot.savedAt);
});

test("删除后可以继续保存", () => {
  const s = fakeStorage();
  for (let i = 0; i < MAX_SLOTS; i++) saveSlot({ name: `s${i}` }, s);
  const [first] = loadSlots(s);
  deleteSlot(first.id, s);
  assert.equal(loadSlots(s).length, MAX_SLOTS - 1);
  assert.equal(saveSlot({ name: "新的" }, s).ok, true);
});

test("导出文件名包含房间码与时间", () => {
  const name = slotFileName({ roomCode: "ABC123", savedAt: "2026-11-13T09:05:07.000Z" });
  assert.match(name, /^danteng-ABC123-2026-11-13_09-05-07\.json$/);
});

test("损坏的存储内容不会抛错", () => {
  const s = fakeStorage();
  s.setItem("danteng.slots.v1", "{not json");
  assert.deepEqual(loadSlots(s), []);
});

test("clearSlots 清空", () => {
  const s = fakeStorage();
  saveSlot({ name: "a" }, s);
  clearSlots(s);
  assert.deepEqual(loadSlots(s), []);
});
