/**
 * 蛋疼棋联机服务器（M1：静态页面 + 房间创建/加入 + 心跳）。
 *
 *   node server/index.js [--port 6657]
 *
 * 设计稿：docs/蛋疼棋_联机服务器设计_v1.0.md
 */

import http from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { WebSocketServer } from "ws";

import { serveStatic } from "./static.js";
import { Rooms } from "./rooms.js";
import {
  PROTOCOL_VERSION, RULES_VERSION, ERR,
  parseClientMessage, errorMessage, sendJson, normalizeRoomCode,
} from "./protocol.js";

const root = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PUBLIC = join(root, "..", "dist");

const HEARTBEAT_MS = 20000;
const MAX_PER_IP = 8;
const RATE_WINDOW_MS = 1000;
const RATE_LIMIT = 10;

export function startServer({
  port = 6657,
  host = "0.0.0.0",
  publicRoot = DEFAULT_PUBLIC,
  log = () => {},
} = {}) {
  const rooms = new Rooms();
  const conns = new Set();
  const perIp = new Map();

  const server = http.createServer((req, res) => {
    serveStatic(req, res, publicRoot).catch(() => {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Internal Error");
    });
  });

  const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 16 * 1024 });

  wss.on("connection", (ws, req) => {
    const ip = req.socket.remoteAddress || "unknown";
    const count = (perIp.get(ip) || 0) + 1;
    if (count > MAX_PER_IP) {
      ws.close(1008, "too-many-connections");
      return;
    }
    perIp.set(ip, count);

    const conn = {
      ws, ip,
      room: null, seat: null, token: null,
      greeted: false,
      alive: true,
      windowStart: Date.now(),
      windowCount: 0,
      client: null,
    };
    conns.add(conn);

    ws.on("pong", () => { conn.alive = true; });

    ws.on("message", (raw) => {
      if (!rateOk(conn)) {
        ws.send(errorMessage(ERR.RATE_LIMITED));
        return;
      }
      const parsed = parseClientMessage(raw.toString());
      if (!parsed.ok) {
        ws.send(errorMessage(parsed.error));
        return;
      }
      try {
        handleMessage(conn, parsed.msg);
      } catch (err) {
        log("handler error:", err?.message || err);
        ws.send(errorMessage(ERR.INTERNAL));
      }
    });

    ws.on("close", () => {
      conns.delete(conn);
      const n = (perIp.get(ip) || 1) - 1;
      if (n <= 0) perIp.delete(ip); else perIp.set(ip, n);

      const result = rooms.detach(conn);
      if (!result) return;
      if (result.closed) {
        for (const s of result.others) {
          sendJson(s.conn?.ws, { t: "room", phase: "closed", room: result.room.code });
        }
      } else {
        broadcastRoom(result.room, { t: "room", phase: result.room.phase, room: result.room.code });
      }
    });
  });

  const heartbeat = setInterval(() => {
    for (const conn of conns) {
      if (!conn.alive) {
        conn.ws.terminate();
        continue;
      }
      conn.alive = false;
      try { conn.ws.ping(); } catch { /* ignore */ }
    }
  }, HEARTBEAT_MS);

  const sweeper = setInterval(() => rooms.sweep(), 60 * 1000);

  function rateOk(conn) {
    const now = Date.now();
    if (now - conn.windowStart > RATE_WINDOW_MS) {
      conn.windowStart = now;
      conn.windowCount = 0;
    }
    conn.windowCount += 1;
    return conn.windowCount <= RATE_LIMIT;
  }

  function broadcastRoom(room, msg) {
    for (const s of room.seats) {
      if (s && s.conn) sendJson(s.conn.ws, msg);
    }
  }

  function handleMessage(conn, msg) {
    const ws = conn.ws;

    if (msg.t === "hello") {
      if (msg.version !== PROTOCOL_VERSION || msg.rules !== RULES_VERSION) {
        ws.send(errorMessage(ERR.VERSION, `server ${PROTOCOL_VERSION}/${RULES_VERSION}`));
        ws.close(1002, "version-mismatch");
        return;
      }
      conn.greeted = true;
      conn.client = typeof msg.client === "string" ? msg.client.slice(0, 40) : null;

      // 带房间码 + token 表示重连
      const code = normalizeRoomCode(msg.room);
      if (code && msg.token) {
        const r = rooms.reattach(code, msg.token, conn);
        if (!r.ok) { ws.send(errorMessage(r.error)); return; }
        sendJson(ws, {
          t: "welcome", room: code, seat: r.seat, token: msg.token,
          protocol: PROTOCOL_VERSION, rules: RULES_VERSION, resumed: true,
        });
        broadcastRoom(r.room, { t: "room", phase: r.room.phase, room: code });
        return;
      }
      sendJson(ws, { t: "welcome", protocol: PROTOCOL_VERSION, rules: RULES_VERSION });
      return;
    }

    if (!conn.greeted) {
      ws.send(errorMessage(ERR.BAD_MESSAGE, "hello first"));
      return;
    }

    if (msg.t === "create") {
      if (conn.room) { ws.send(errorMessage(ERR.BAD_MESSAGE, "already in room")); return; }
      const room = rooms.create(conn);
      sendJson(ws, {
        t: "welcome", room: room.code, seat: conn.seat, token: conn.token,
        protocol: PROTOCOL_VERSION, rules: RULES_VERSION, host: true,
      });
      broadcastRoom(room, { t: "room", phase: room.phase, room: room.code });
      log(`房间 ${room.code} 创建，房主座位 ${conn.seat}`);
      return;
    }

    if (msg.t === "join") {
      if (conn.room) { ws.send(errorMessage(ERR.BAD_MESSAGE, "already in room")); return; }
      const r = rooms.join(msg.room, conn);
      if (!r.ok) { ws.send(errorMessage(r.error)); return; }
      sendJson(ws, {
        t: "welcome", room: r.room.code, seat: r.seat, token: conn.token,
        protocol: PROTOCOL_VERSION, rules: RULES_VERSION,
      });
      broadcastRoom(r.room, { t: "room", phase: r.room.phase, room: r.room.code });
      log(`房间 ${r.room.code} 加入，座位 ${r.seat}`);
      return;
    }

    if (msg.t === "pong") { conn.alive = true; return; }

    // M2 起接管：action / undo / resign / rematch
    ws.send(errorMessage(ERR.BAD_MESSAGE, "not implemented yet"));
  }

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const addr = server.address();
      const actual = typeof addr === "object" && addr ? addr.port : port;
      log(`监听 http://${host}:${actual}`);
      resolve({
        port: actual,
        server,
        wss,
        rooms,
        close: () => new Promise((res) => {
          clearInterval(heartbeat);
          clearInterval(sweeper);
          for (const c of conns) { try { c.ws.terminate(); } catch { /* ignore */ } }
          for (const c of wss.clients) { try { c.terminate(); } catch { /* ignore */ } }
          wss.close(() => {
            server.closeAllConnections?.();
            server.close(() => res());
          });
        }),
      });
    });
  });
}

// 直接运行时启动
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const portArg = process.argv.indexOf("--port");
  const port = portArg > 0 ? Number(process.argv[portArg + 1]) : Number(process.env.PORT || 6657);
  startServer({ port, log: (...a) => console.log("[server]", ...a) })
    .then((s) => console.log(`蛋疼棋服务已启动：http://0.0.0.0:${s.port}`))
    .catch((err) => {
      console.error("启动失败：", err.message);
      process.exit(1);
    });
}
