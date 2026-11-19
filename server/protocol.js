/**
 * 协议常量与消息校验。
 * 设计稿：docs/蛋疼棋_联机服务器设计_v1.0.md 第 4 节
 */

export const PROTOCOL_VERSION = 2;
export const RULES_VERSION = "1.3";

/** 单条消息上限（字节）。 */
export const MAX_MESSAGE_BYTES = 16 * 1024;

/** 客户端可发送的消息类型。 */
export const CLIENT_TYPES = new Set([
  "hello", "create", "join", "choice", "action", "undo", "resign", "rematch", "pong",
]);

export const ERR = {
  VERSION: "version-mismatch",
  BAD_MESSAGE: "bad-message",
  ROOM_NOT_FOUND: "room-not-found",
  ROOM_FULL: "room-full",
  TOKEN_INVALID: "token-invalid",
  RATE_LIMITED: "rate-limited",
  NOT_YOUR_TURN: "not-your-turn",
  ILLEGAL_ACTION: "illegal-action",
  STALE_PLY: "stale-ply",
  INTERNAL: "internal",
};

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** 房间码：6 位，去掉容易混淆的 0/O/1/I。 */
export function makeRoomCode(random = Math.random) {
  let s = "";
  for (let i = 0; i < 6; i++) s += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  return s;
}

export function normalizeRoomCode(v) {
  return String(v ?? "").trim().toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 6);
}

/** 只做结构校验；业务校验（行动是否合法）由 rules.js 负责。 */
export function parseClientMessage(raw) {
  if (typeof raw !== "string" || raw.length === 0) return { ok: false, error: ERR.BAD_MESSAGE };
  if (Buffer.byteLength(raw, "utf8") > MAX_MESSAGE_BYTES) return { ok: false, error: ERR.BAD_MESSAGE };

  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return { ok: false, error: ERR.BAD_MESSAGE };
  }
  if (!msg || typeof msg !== "object" || Array.isArray(msg)) return { ok: false, error: ERR.BAD_MESSAGE };
  if (typeof msg.t !== "string" || !CLIENT_TYPES.has(msg.t)) return { ok: false, error: ERR.BAD_MESSAGE };

  return { ok: true, msg };
}

export function errorMessage(code, message = "") {
  return JSON.stringify({ t: "error", code, message });
}

export function sendJson(ws, obj) {
  if (!ws || ws.readyState !== 1) return;
  ws.send(JSON.stringify(obj));
}
