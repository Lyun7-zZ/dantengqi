/**
 * 联机协议：版本、哈希、消息编解码。
 *
 * 设计目标：消息尽量小、可校验、可演进。
 * 每条消息都有 v（协议版本）与 t（类型）；对局消息额外带 ply 与 stateHash。
 */

export const PROTOCOL_VERSION = 1;
export const RULES_VERSION = "1.2";

/** 对局参数指纹：两端必须一致，否则拒绝开局。 */
export function configHash(config) {
  const s = [
    config.perMove, config.bank, RULES_VERSION,
    // 棋盘与规则常量（与内核保持一致）
    10, 12, 228, 1,
  ].join("|");
  return fnv1a(s);
}

/** 局面指纹：棋子、墙位、轮次、墙数、容差。任何不一致都会被发现。 */
export function stateHash(state) {
  let h = 0x811c9dc5;
  const mix = (n) => {
    h ^= n & 0xff;
    h = Math.imul(h, 0x01000193);
  };
  for (const p of state.players) {
    mix(p.c);
    mix(p.r);
  }
  for (const v of state.vWall) mix(v);
  for (const v of state.hWall) mix(v);
  for (const v of state.topWall) mix(v);
  mix(state.turn);
  mix(state.wallsPlaced);
  mix(state.tolerance);
  return (h >>> 0).toString(16).padStart(8, "0");
}

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function message(type, payload = {}) {
  return { v: PROTOCOL_VERSION, t: type, ...payload };
}

/** 接收端校验：版本不符或字段缺失都视为脏消息。 */
export function parseMessage(raw) {
  let msg;
  try {
    msg = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return { ok: false, error: "bad-json" };
  }
  if (!msg || typeof msg !== "object") return { ok: false, error: "bad-message" };
  if (msg.v !== PROTOCOL_VERSION) return { ok: false, error: "version-mismatch" };
  if (typeof msg.t !== "string") return { ok: false, error: "bad-type" };
  return { ok: true, msg };
}

/** 握手：比较版本、规则与对局参数。 */
export function checkHandshake(local, remote) {
  if (remote.v !== PROTOCOL_VERSION) return { ok: false, error: "protocol", detail: remote.v };
  if (remote.rules !== RULES_VERSION) return { ok: false, error: "rules", detail: remote.rules };
  if (remote.config !== local.config) return { ok: false, error: "config", detail: remote.config };
  return { ok: true };
}

/** 房间码：去掉 0/O/1/I 等易混字符，6 位。 */
const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function makeRoomCode(len = 6, random = Math.random) {
  let out = "";
  for (let i = 0; i < len; i++) {
    out += ROOM_ALPHABET[Math.floor(random() * ROOM_ALPHABET.length)];
  }
  return out;
}

export function normalizeRoomCode(input) {
  return String(input ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/O/g, "0")
    .replace(/I/g, "1")
    .slice(0, 6);
}
