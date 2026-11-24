/**
 * 蛋疼棋联机服务器（M2：掷骰分边、行棋校验、服务端计时、超时代走）。
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
import {
  rollDice, resolveChoice, createGame, applyMove, tickGame, gameSnapshot,
} from "./game.js";
import {
  createAsyncGame, submitAction, fillTimeout, resolveRoundIfReady,
  tickGame as tickAsyncGame, snapshot as asyncSnapshot, toWireState,
} from "./async-game.js";

const root = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PUBLIC = join(root, "..", "dist");

const HEARTBEAT_MS = 20000;
const MAX_PER_IP = 8;
const RATE_WINDOW_MS = 1000;
const RATE_LIMIT = 10;
const TICK_MS = 100;
const CLOCK_BROADCAST_MS = 500;

export function startServer({
  port = 6657,
  host = "0.0.0.0",
  publicRoot = DEFAULT_PUBLIC,
  perMove = 30,
  bank = 300,
  random = Math.random,
  disconnectMs = 90000,
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
      if (result.paused) {
        broadcastRoom(result.room, {
          t: "room", phase: "paused", room: result.room.code, seat: result.leftSeat,
        });
        return;
      }
      if (result.playing) {
        startDisconnectWindow(result.room, result.leftSeat);
        broadcastRoom(result.room, {
          t: "room", phase: "paused", room: result.room.code, seat: result.leftSeat,
        });
        return;
      }
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

  // 计时推进：每 100ms 走一次，超时由服务端代走
  const ticker = setInterval(() => {
    const now = Date.now();
    for (const room of rooms.map.values()) {
      if (room.phase !== "playing" || !room.game) continue;
      const dt = Math.min(0.5, (now - (room.lastTick || now)) / 1000);
      room.lastTick = now;

      if (room.mode === "async") {
        const ta = tickAsyncGame(room.game, dt);
        if (!ta.timedOut.length) continue;
        for (const side of ta.timedOut) fillTimeout(room.game, side);
        const round = resolveRoundIfReady(room.game);
        if (!round.ok) continue;
        recordHistory(room);
        broadcastRoom(room, {
          t: "round",
          actions: round.actions,
          events: round.events,
          state: toWireState(round.state),
          hash: round.hash,
          reason: "timeout",
        });
        broadcastRoom(room, clockMsg(room));
        if (round.state.winner !== null) {
          finishRoom(room, {
            t: "result",
            winner: round.state.winner,
            reason: round.state.winner === "draw" ? "draw" : "timeout",
            plies: round.state.plies,
          });
        }
        continue;
      }

      const r = tickGame(room.game, dt);
      if (r.event) {
        recordHistory(room);
        broadcastRoom(room, r.event);
      }
      if (r.result) finishRoom(room, r.result);
    }
  }, TICK_MS);

  // 每 500ms 同步一次剩余时间
  const clockSync = setInterval(() => {
    for (const room of rooms.map.values()) {
      if (room.phase === "playing" && room.game) broadcastRoom(room, clockMsg(room));
    }
  }, CLOCK_BROADCAST_MS);

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

  function clockMsg(room) {
    const g = room.game;
    return {
      t: "clock",
      side: g.state.turn ?? -1,
      ply: g.state.plies,
      perMove: g.clocks.perMove,
      bank: g.clocks.bank,
      banks: g.clocks.banks.slice(),
      moveLeft: g.clocks.moveLeft,
      inBank: g.clocks.inBank,
      ...(room.mode === "async" && Array.isArray(g.think) ? { think: g.think.slice() } : {}),
    };
  }

  function finishRoom(room, result) {
    room.phase = "finished";
    room.updatedAt = Date.now();
    room.result = result;
    clearTimeout(room.disconnectTimer);
    room.disconnectTimer = null;
    broadcastRoom(room, result);
  }

  function recordHistory(room) {
    if (!room.history) room.history = [];
    if (room.mode === "async") {
      room.history.push(asyncSnapshot(room.game));
      if (room.history.length > 400) room.history.shift();
      return;
    }
    room.history.push({
      state: room.game.state,
      clocks: { banks: room.game.clocks.banks.slice(), moveLeft: room.game.clocks.moveLeft, inBank: room.game.clocks.inBank },
    });
    if (room.history.length > 400) room.history.shift();
  }

  /** 掉线 90 秒未回来：判掉线方负。 */
  function startDisconnectWindow(room, seat) {
    clearTimeout(room.disconnectTimer);
    room.disconnectSeat = seat;
    room.disconnectTimer = setTimeout(() => {
      room.disconnectTimer = null;
      if (room.phase !== "playing") return;
      if (room.seats[seat] && room.seats[seat].conn) return;
      const winner = 1 - room.sides[seat];
      finishRoom(room, {
        t: "result", winner, reason: "disconnect", plies: room.game?.state.plies ?? 0,
      });
    }, disconnectMs);
  }

  // ---------- 掷骰与选边 ----------

  function beginMatch(room) {
    if (room.mode === "async") {
      startPlay(room, { sides: [0, 1], firstSeat: 0 });
      return;
    }
    beginDice(room);
  }

  function beginDice(room) {
    const pts = rollDice(random);
    const chooser = pts[0] > pts[1] ? 0 : 1;
    room.phase = "dice";
    room.dice = { pts, chooser };
    room.pending = null;
    broadcastRoom(room, { t: "dice", stage: "priority", pts, chooser });
    log(`房间 ${room.code} 掷骰 ${pts.join(":")}，由座位 ${chooser} 先选`);
  }

  function startPlay(room, { sides, firstSeat }) {
    if (room.mode === "async") {
      room.sides = sides;
      room.firstSeat = firstSeat;
      room.game = createAsyncGame({ firstSide: sides[firstSeat], perMove, bank });
      room.phase = "playing";
      room.lastTick = Date.now();
      room.updatedAt = Date.now();
      room.undoLeft = [3, 3];
      room.pendingUndo = null;
      room.pendingRematch = null;
      room.history = [asyncSnapshot(room.game)];
      room.result = null;
      clearTimeout(room.disconnectTimer);
      room.disconnectTimer = null;
      const snap = asyncSnapshot(room.game);
      snap.sides = sides;
      snap.firstSeat = firstSeat;
      broadcastRoom(room, snap);
      broadcastRoom(room, clockMsg(room));
      log(`房间 ${room.code} 异步开局`);
      return;
    }
    room.sides = sides;
    room.firstSeat = firstSeat;
    room.game = createGame({ firstSide: sides[firstSeat], perMove, bank });
    room.phase = "playing";
    room.lastTick = Date.now();
    room.updatedAt = Date.now();
    room.undoLeft = [3, 3];
    room.pendingUndo = null;
    room.pendingRematch = null;
    room.history = [{
      state: room.game.state,
      clocks: { banks: room.game.clocks.banks.slice(), moveLeft: room.game.clocks.moveLeft, inBank: room.game.clocks.inBank },
    }];
    room.result = null;
    clearTimeout(room.disconnectTimer);
    room.disconnectTimer = null;

    const snap = gameSnapshot(room.game);
    snap.sides = sides;
    snap.firstSeat = firstSeat;
    broadcastRoom(room, snap);
    broadcastRoom(room, clockMsg(room));
    log(`房间 ${room.code} 开局：先手座位 ${firstSeat}（棋盘边 ${sides[firstSeat]}）`);
  }

  function handleChoice(conn, msg) {
    const room = conn.room;
    const ws = conn.ws;
    if (!room || room.phase !== "dice") { ws.send(errorMessage(ERR.BAD_MESSAGE, "not in dice")); return; }
    const seat = conn.seat;

    // 第一阶段：大点者选「先手」或「选边」
    if (room.pending === null) {
      if (seat !== room.dice.chooser) { ws.send(errorMessage("not-chooser")); return; }
      if (msg.priority === "first") {
        room.pending = "side";
        room.firstChooser = seat;
        broadcastRoom(room, { t: "dice", stage: "side", picker: 1 - seat });
        return;
      }
      if (msg.priority === "side") {
        const r = resolveChoice({ chooserSeat: seat, pickerSeat: 1 - seat, priority: "side", side: msg.side });
        if (!r.ok) { ws.send(errorMessage(r.error)); return; }
        startPlay(room, r);
        return;
      }
      ws.send(errorMessage(ERR.BAD_MESSAGE, "bad choice"));
      return;
    }

    // 第二阶段：对方选边
    if (msg.side === 0 || msg.side === 1) {
      if (seat !== 1 - room.firstChooser) { ws.send(errorMessage("not-picker")); return; }
      const r = resolveChoice({
        chooserSeat: room.firstChooser, pickerSeat: seat, priority: "first", side: msg.side,
      });
      if (!r.ok) { ws.send(errorMessage(r.error)); return; }
      startPlay(room, r);
      return;
    }
    ws.send(errorMessage(ERR.BAD_MESSAGE, "bad side"));
  }

  function handleAction(conn, msg) {
    const room = conn.room;
    const ws = conn.ws;
    if (!room || room.phase !== "playing" || !room.game) {
      ws.send(errorMessage(ERR.BAD_MESSAGE, "no game"));
      return;
    }
    if (msg.ply !== room.game.state.plies) {
      ws.send(errorMessage(ERR.STALE_PLY, `server ply ${room.game.state.plies}`));
      return;
    }
    const side = room.sides[conn.seat];
    if (side === null || side === undefined) {
      ws.send(errorMessage(ERR.NOT_YOUR_TURN));
      return;
    }

    if (room.mode === "async") {
      const r = submitAction(room.game, side, msg.action);
      if (!r.ok) { ws.send(errorMessage(r.error, r.reason || "")); return; }
      broadcastRoom(room, { t: "submitted", seat: conn.seat });
      if (!r.ready) return;
      const round = resolveRoundIfReady(room.game);
      if (!round.ok) { ws.send(errorMessage(round.error || "resolve-failed")); return; }
      recordHistory(room);
      broadcastRoom(room, {
        t: "round",
        actions: round.actions,
        events: round.events,
        state: toWireState(round.state),
        hash: round.hash,
      });
      broadcastRoom(room, clockMsg(room));
      if (round.state.winner !== null) {
        finishRoom(room, {
          t: "result",
          winner: round.state.winner,
          reason: round.state.winner === "draw" ? "draw" : "exit",
          plies: round.state.plies,
        });
      }
      return;
    }

    const r = applyMove(room.game, side, msg.action);
    if (!r.ok) {
      ws.send(errorMessage(r.error, r.reason || ""));
      return;
    }
    recordHistory(room);
    broadcastRoom(room, r.event);
    broadcastRoom(room, clockMsg(room));
    if (r.result) finishRoom(room, r.result);
  }

  // ---------- 悔棋 / 认输 / 再来一局 ----------

  function snapshotState(room) {
    const snap = gameSnapshot(room.game);
    snap.sides = room.sides;
    snap.firstSeat = room.firstSeat;
    return snap;
  }

  function handleUndo(conn, msg) {
    const room = conn.room;
    const ws = conn.ws;
    if (!room || room.phase !== "playing") { ws.send(errorMessage(ERR.BAD_MESSAGE, "no game")); return; }
    const seat = conn.seat;

    if (msg.op === "request") {
      if (room.pendingUndo) { ws.send(errorMessage("undo-pending")); return; }
      if ((room.undoLeft?.[seat] ?? 0) <= 0) { ws.send(errorMessage("no-undo")); return; }
      if ((room.history?.length ?? 0) < 2) { ws.send(errorMessage("nothing-to-undo")); return; }
      room.pendingUndo = { seat, at: Date.now() };
      clearTimeout(room.undoTimer);
      room.undoTimer = setTimeout(() => {
        if (!room.pendingUndo) return;
        room.pendingUndo = null;
        broadcastRoom(room, { t: "undo", op: "expired" });
      }, 30000);
      broadcastRoom(room, { t: "undo", op: "request", seat });
      return;
    }

    if (msg.op === "accept" || msg.op === "decline") {
      const pending = room.pendingUndo;
      if (!pending) { ws.send(errorMessage("no-undo-request")); return; }
      if (seat === pending.seat) { ws.send(errorMessage("self-answer")); return; }
      clearTimeout(room.undoTimer);
      room.pendingUndo = null;

      if (msg.op === "decline") {
        broadcastRoom(room, { t: "undo", op: "declined" });
        return;
      }

      // 回滚一手：恢复上一份快照
      const hist = room.history || [];
      if (hist.length < 2) { broadcastRoom(room, { t: "undo", op: "declined" }); return; }
      hist.pop();
      const prev = hist[hist.length - 1];
      room.game.state = prev.state;
      room.game.clocks.banks = prev.clocks.banks.slice();
      room.game.clocks.moveLeft = prev.clocks.moveLeft;
      room.game.clocks.inBank = prev.clocks.inBank;
      room.undoLeft[pending.seat] = (room.undoLeft[pending.seat] ?? 1) - 1;
      room.lastTick = Date.now();
      broadcastRoom(room, { t: "undo", op: "done", seat: pending.seat });
      broadcastRoom(room, snapshotState(room));
      broadcastRoom(room, clockMsg(room));
      return;
    }
  }

  function handleResign(conn) {
    const room = conn.room;
    if (!room || room.phase !== "playing") return;
    const seat = conn.seat;
    const winner = 1 - room.sides[seat];
    finishRoom(room, {
      t: "result", winner, reason: "resign", plies: room.game?.state.plies ?? 0,
    });
  }

  function handleRematch(conn, msg) {
    const room = conn.room;
    const ws = conn.ws;
    if (!room) return;
    if (room.phase !== "finished") { ws.send(errorMessage(ERR.BAD_MESSAGE, "not finished")); return; }
    const seat = conn.seat;

    if (msg.op === "request") {
      if (room.pendingRematch) { ws.send(errorMessage("rematch-pending")); return; }
      room.pendingRematch = { seat, at: Date.now() };
      broadcastRoom(room, { t: "rematch", op: "request", seat });
      return;
    }
    if (msg.op === "accept" || msg.op === "decline") {
      const pending = room.pendingRematch;
      if (!pending) { ws.send(errorMessage("no-rematch")); return; }
      if (seat === pending.seat) { ws.send(errorMessage("self-answer")); return; }
      room.pendingRematch = null;
      if (msg.op === "decline") {
        broadcastRoom(room, { t: "rematch", op: "declined" });
        return;
      }
      // 重开：清状态、重新掷骰
      room.game = null;
      room.history = [];
      room.undoLeft = [3, 3];
      room.result = null;
      room.sides = [null, null];
      room.firstSeat = null;
      room.phase = "ready";
      broadcastRoom(room, { t: "rematch", op: "accepted" });
      beginMatch(room);
      return;
    }
  }

  // ---------- 暂停 ----------

  function handlePause(conn, msg) {
    const room = conn.room;
    const ws = conn.ws;
    if (!room) return;
    const seat = conn.seat;
    const op = msg.op;

    if (op === "request") {
      if (room.phase !== "playing") { ws.send(errorMessage("not-playing")); return; }
      if (room.pendingPause) { ws.send(errorMessage("pause-pending")); return; }
      room.pendingPause = { seat };
      broadcastRoom(room, { t: "pause", op: "request", seat });
      return;
    }

    if (op === "accept" || op === "decline") {
      const pending = room.pendingPause;
      if (!pending) { ws.send(errorMessage("no-pause-request")); return; }
      if (seat === pending.seat) { ws.send(errorMessage("self-answer")); return; }
      room.pendingPause = null;
      if (op === "decline") {
        broadcastRoom(room, { t: "pause", op: "declined" });
        return;
      }
      room.phase = "paused";
      room.updatedAt = Date.now();
      broadcastRoom(room, { t: "pause", op: "paused" });
      return;
    }

    if (op === "resume") {
      if (room.phase !== "paused") { ws.send(errorMessage("not-paused")); return; }
      if (room.pendingResume) { ws.send(errorMessage("resume-pending")); return; }
      room.pendingResume = { seat };
      broadcastRoom(room, { t: "pause", op: "resume-request", seat });
      return;
    }

    if (op === "resume-accept" || op === "resume-decline") {
      const pending = room.pendingResume;
      if (!pending) { ws.send(errorMessage("no-resume-request")); return; }
      if (seat === pending.seat) { ws.send(errorMessage("self-answer")); return; }
      room.pendingResume = null;
      if (op === "resume-decline") {
        broadcastRoom(room, { t: "pause", op: "resume-declined" });
        return;
      }
      room.phase = "playing";
      room.lastTick = Date.now();
      room.updatedAt = Date.now();
      broadcastRoom(room, { t: "pause", op: "resumed" });
      return;
    }
  }

  // ---------- 消息分发 ----------

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

      const code = normalizeRoomCode(msg.room);
      if (code && msg.token) {
        const r = rooms.reattach(code, msg.token, conn);
        if (!r.ok) { ws.send(errorMessage(r.error)); return; }
        sendJson(ws, {
          t: "welcome", room: code, seat: r.seat, token: msg.token,
          protocol: PROTOCOL_VERSION, rules: RULES_VERSION, resumed: true,
        });
        broadcastRoom(r.room, { t: "room", phase: r.room.phase, room: code });
        clearTimeout(r.room.disconnectTimer);
        r.room.disconnectTimer = null;
        if (r.room.phase === "paused") {
          sendJson(ws, { t: "pause", op: "paused" });
        }
        if (r.room.phase === "finished" && r.room.result) {
          sendJson(ws, r.room.result);
        }
        if (r.room.phase === "playing" && r.room.game) {
          const snap = r.room.mode === "async"
            ? asyncSnapshot(r.room.game)
            : gameSnapshot(r.room.game);
          snap.sides = r.room.sides;
          snap.firstSeat = r.room.firstSeat;
          sendJson(ws, snap);
          sendJson(ws, clockMsg(r.room));
        }
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
      room.mode = msg.mode === "async" ? "async" : "turn";
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
      if (r.room.phase === "ready") beginMatch(r.room);
      return;
    }

    if (msg.t === "choice") { handleChoice(conn, msg); return; }
    if (msg.t === "action") { handleAction(conn, msg); return; }
    if (msg.t === "undo") { handleUndo(conn, msg); return; }
    if (msg.t === "resign") { handleResign(conn, msg); return; }
    if (msg.t === "rematch") { handleRematch(conn, msg); return; }
    if (msg.t === "pause") { handlePause(conn, msg); return; }
    if (msg.t === "pong") { conn.alive = true; return; }

    // M4 接管：undo / resign / rematch
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
          clearInterval(ticker);
          clearInterval(clockSync);
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
