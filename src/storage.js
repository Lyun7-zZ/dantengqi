/**
 * 本地存档位：最多 3 个，存未完成（掉线封存）的对局。
 *
 * 存储结构（localStorage，单 key）：
 *   [{ id, name, savedAt, roomCode, plies, stateHash, config, state, actions, clocks }]
 *
 * 之所以连 state 一起存，是因为续局功能还没做；将来续局时
 * actions + state 足以重建局面（也可用于回放）。
 */

export const MAX_SLOTS = 3;

const KEY = "danteng.slots.v1";

function store(storage) {
  return storage ?? globalThis.localStorage;
}

export function loadSlots(storage) {
  try {
    const raw = store(storage).getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function persist(slots, storage) {
  store(storage).setItem(KEY, JSON.stringify(slots));
}

/** 保存一个存档；满了返回 { ok:false, error:"full" }。 */
export function saveSlot(slot, storage) {
  const slots = loadSlots(storage);
  if (slots.length >= MAX_SLOTS) return { ok: false, error: "full", slots };
  const entry = {
    id: slot.id ?? `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: slot.name || defaultSlotName(),
    savedAt: slot.savedAt ?? new Date().toISOString(),
    roomCode: slot.roomCode ?? "",
    plies: slot.plies ?? 0,
    stateHash: slot.stateHash ?? "",
    config: slot.config ?? null,
    state: slot.state ?? null,
    actions: slot.actions ?? [],
    clocks: slot.clocks ?? null,
  };
  slots.unshift(entry);
  persist(slots, storage);
  return { ok: true, slot: entry, slots };
}

export function deleteSlot(id, storage) {
  const slots = loadSlots(storage).filter((s) => s.id !== id);
  persist(slots, storage);
  return slots;
}

export function clearSlots(storage) {
  persist([], storage);
}

/** 默认存档名：时间精确到秒。 */
export function defaultSlotName(date = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} `
    + `${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
}

/** 导出用的文件名。 */
export function slotFileName(slot) {
  const t = (slot.savedAt || "").replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
  return `danteng-${slot.roomCode || "local"}-${t || "slot"}.json`;
}
