/**
 * GL 棋谱库（本地）：统一格式、对局/局面保存、导入导出、复盘重放。
 *
 * 存储：localStorage 两个 key（games / positions），默认只本地，不上传。
 */

import { applyAction, normalizeState } from "./rules.js";

export const GL_SCHEMA_VERSION = 2;
const GAMES_KEY = "danteng.gamelib.games.v2";
const POS_KEY = "danteng.gamelib.positions.v2";

function store(s) { return s ?? globalThis.localStorage; }
function read(key, s) {
  try {
    const raw = store(s).getItem(key);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}
function write(key, arr, s) { store(s).setItem(key, JSON.stringify(arr)); }
function uid(prefix) { return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`; }

/** 状态 JSON 化：保留墙图数组；Infinity 由 JSON 变 null，导入时 normalize 恢复。 */
export function stateToJson(state) {
  return {
    cols: state.cols,
    rows: state.rows,
    vWall: Array.from(state.vWall),
    hWall: Array.from(state.hWall),
    topWall: Array.from(state.topWall),
    players: state.players.map((p) => ({ c: p.c, r: p.r })),
    turn: state.turn,
    firstPlayer: state.firstPlayer,
    drawMode: state.drawMode,
    tolerance: state.tolerance,
    wallLimit: state.wallLimit.map((x) => (Number.isFinite(x) ? x : "unlimited")),
    wallsUsed: state.wallsUsed.slice(),
    plies: state.plies,
    wallsPlaced: state.wallsPlaced,
    winner: state.winner,
  };
}
export function jsonToState(obj) {
  const s = JSON.parse(JSON.stringify(obj));
  s.vWall = Uint8Array.from(s.vWall);
  s.hWall = Uint8Array.from(s.hWall);
  s.topWall = Uint8Array.from(s.topWall);
  if (Array.isArray(s.wallLimit)) {
    s.wallLimit = s.wallLimit.map((x) => (x === "unlimited" || x === null ? Infinity : x));
  }
  normalizeState(s);
  return s;
}

export function createGameRecord({ mode = "local", seat = 0, firstPlayer = 0, state, config = null, source = "human" }) {
  return {
    schemaVersion: GL_SCHEMA_VERSION,
    kind: "game",
    gameId: uid("g"),
    createdAt: new Date().toISOString(),
    mode, seat, firstPlayer, source,
    config,
    initialState: stateToJson(state),
    actions: [],
    result: null,
    plies: 0,
  };
}

export function recordAction(rec, action, by) {
  rec.actions.push({ ply: rec.actions.length + 1, by, action });
  rec.plies = rec.actions.length;
  return rec;
}

export function finalizeGame(rec, state, endReason = "normal_terminal") {
  rec.result = {
    winner: state.winner,
    endReason,
    plies: state.plies,
    finalState: stateToJson(state),
  };
  rec.endedAt = new Date().toISOString();
  return rec;
}

export function replayGame(rec) {
  let s = jsonToState(rec.initialState);
  const states = [s];
  for (const step of rec.actions) {
    const r = applyAction(s, step.action);
    if (!r.ok) return { ok: false, error: `ply ${step.ply}: ${r.error}` };
    s = r.state;
    states.push(s);
  }
  return { ok: true, states, final: s };
}

export function saveGame(rec, storage) {
  const games = read(GAMES_KEY, storage);
  const i = games.findIndex((g) => g.gameId === rec.gameId);
  if (i >= 0) games[i] = rec; else games.unshift(rec);
  write(GAMES_KEY, games.slice(0, 500), storage);
  return rec;
}
export function loadGames(storage) { return read(GAMES_KEY, storage); }
export function deleteGame(id, storage) {
  const games = read(GAMES_KEY, storage).filter((g) => g.gameId !== id);
  write(GAMES_KEY, games, storage);
  return games;
}

export function createPositionRecord({ state, name = "", note = "", mode = "local", config = null }) {
  return {
    schemaVersion: GL_SCHEMA_VERSION,
    kind: "position",
    positionId: uid("p"),
    createdAt: new Date().toISOString(),
    name: name || defaultName(),
    note, mode, config,
    state: stateToJson(state),
  };
}
export function savePosition(pos, storage) {
  const arr = read(POS_KEY, storage);
  const i = arr.findIndex((p) => p.positionId === pos.positionId);
  if (i >= 0) arr[i] = pos; else arr.unshift(pos);
  write(POS_KEY, arr.slice(0, 300), storage);
  return pos;
}
export function loadPositions(storage) { return read(POS_KEY, storage); }
export function deletePosition(id, storage) {
  const arr = read(POS_KEY, storage).filter((p) => p.positionId !== id);
  write(POS_KEY, arr, storage);
  return arr;
}

export function defaultName(date = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}`;
}

/** 导入：识别 game/position，校验版本与动作可重放。 */
export function parseImport(text) {
  let obj;
  try { obj = JSON.parse(text); } catch { return { ok: false, error: "不是合法 JSON" }; }
  if (!obj || typeof obj !== "object") return { ok: false, error: "空对象" };
  if (obj.kind === "game") {
    if (obj.schemaVersion !== GL_SCHEMA_VERSION) return { ok: false, error: `schemaVersion ${obj.schemaVersion}` };
    const r = replayGame(obj);
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, kind: "game", record: obj };
  }
  if (obj.kind === "position") {
    if (obj.schemaVersion !== GL_SCHEMA_VERSION) return { ok: false, error: `schemaVersion ${obj.schemaVersion}` };
    try {
      const s = jsonToState(obj.state);
      if (!Number.isFinite(s.players[0].c)) return { ok: false, error: "局面字段缺失" };
      return { ok: true, kind: "position", record: obj, state: s };
    } catch { return { ok: false, error: "局面无法解析" }; }
  }
  return { ok: false, error: "未知 kind" };
}

export function fileName(rec) {
  const t = (rec.endedAt || rec.createdAt || "").replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
  return `danteng-${rec.kind}-${t || "export"}.json`;
}
