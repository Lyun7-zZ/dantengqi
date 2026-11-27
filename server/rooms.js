/**
 * 房间表与房间生命周期（M1：创建 / 加入 / 离开 / 回收）。
 *
 * 一期只把「等人 → 双方就绪」这段跑通，对局逻辑在 M2 接入。
 */

import { randomBytes } from "node:crypto";
import { makeRoomCode, normalizeRoomCode } from "./protocol.js";

const WAITING_TTL_MS = 10 * 60 * 1000;   // 等人房间 10 分钟回收
const FINISHED_TTL_MS = 5 * 60 * 1000;   // 结束后保留 5 分钟

export function makeToken() {
  return randomBytes(24).toString("base64url");
}

export class Rooms {
  constructor({ now = () => Date.now(), random = Math.random } = {}) {
    this.map = new Map();
    this.now = now;
    this.random = random;
  }

  get size() {
    return this.map.size;
  }

  get(code) {
    return this.map.get(normalizeRoomCode(code)) || null;
  }

  /** 创建房间：创建者成为房主，座位随机。 */
  create(conn, { cols = 10, rows = 12 } = {}) {
    let code = makeRoomCode(this.random);
    let guard = 0;
    while (this.map.has(code) && guard++ < 100) code = makeRoomCode(this.random);

    const seat = this.random() < 0.5 ? 0 : 1;
    const room = {
      code,
      createdAt: this.now(),
      updatedAt: this.now(),
      phase: "waiting",
      hostSeat: seat,
      cols, rows,
      seats: [null, null],
      dice: null,
      pending: null,
      firstChooser: null,
      sides: [null, null],
      firstSeat: null,
      game: null,
      lastTick: 0,
    };
    room.seats[seat] = { token: makeToken(), conn };
    conn.room = room;
    conn.seat = seat;
    conn.token = room.seats[seat].token;
    this.map.set(code, room);
    return room;
  }

  /** 加入房间：占另一个空位。 */
  join(code, conn) {
    const room = this.get(code);
    if (!room) return { ok: false, error: "room-not-found" };
    if (room.phase !== "waiting") return { ok: false, error: "room-full" };

    const free = room.seats[0] ? (room.seats[1] ? -1 : 1) : 0;
    if (free < 0) return { ok: false, error: "room-full" };

    room.seats[free] = { token: makeToken(), conn };
    conn.room = room;
    conn.seat = free;
    conn.token = room.seats[free].token;
    room.phase = "ready";
    room.updatedAt = this.now();
    return { ok: true, room, seat: free };
  }

  /** 用 token 恢复座位（重连）。 */
  reattach(code, token, conn) {
    const room = this.get(code);
    if (!room) return { ok: false, error: "room-not-found" };
    const seat = room.seats.findIndex((s) => s && s.token === token);
    if (seat < 0) return { ok: false, error: "token-invalid" };

    room.seats[seat].conn = conn;
    conn.room = room;
    conn.seat = seat;
    conn.token = token;
    room.updatedAt = this.now();
    return { ok: true, room, seat };
  }

  /**
   * 连接断开：房主离开 → 关房；对手离开 → 回到等待并保留房间。
   * 返回 { room, closed } 供调用方广播。
   */
  detach(conn) {
    const room = conn.room;
    if (!room) return null;

    const seat = conn.seat;
    conn.room = null;
    conn.seat = null;
    conn.token = null;

    const entry = room.seats[seat];
    if (entry) entry.conn = null;
    room.updatedAt = this.now();

    const others = room.seats.filter((s) => s && s.conn);

    // 对局中：保留房间，交给上层开 90 秒重连窗口
    if (room.phase === "playing") {
      return { room, closed: false, others, leftSeat: seat, playing: true };
    }
    // 暂停中：时长无限，不判负、不关房
    if (room.phase === "paused") {
      return { room, closed: false, others, leftSeat: seat, paused: true };
    }

    if (seat === room.hostSeat) {
      this.map.delete(room.code);
      room.phase = "closed";
      return { room, closed: true, others };
    }
    // 对手离开：房间回到等待，保留房主
    room.phase = "waiting";
    return { room, closed: false, others, leftSeat: seat };
  }

  /** 回收过期房间。 */
  sweep() {
    const now = this.now();
    for (const [code, room] of this.map) {
      const ttl = room.phase === "finished"
        ? FINISHED_TTL_MS
        : room.phase === "paused" ? 12 * 60 * 60 * 1000 : WAITING_TTL_MS;
      if (now - room.updatedAt > ttl && room.phase !== "playing") {
        this.map.delete(code);
      }
    }
  }
}
