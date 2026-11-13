/**
 * 联机会话：握手 → 掷骰 → 对局 → 掉线/恢复。
 *
 * 职责边界：
 *   - 本类只处理“消息语义与同步校验”，不直接改棋盘；
 *   - 落子统一走外部注入的 apply(action)，保证本地/远程走同一条路径；
 *   - 任何“双方必须一致”的东西都带 stateHash，不一致即上报 desync。
 */

import { message, parseMessage, checkHandshake, stateHash, PROTOCOL_VERSION, RULES_VERSION } from "./protocol.js";

export const PHASE = {
  IDLE: "idle",
  HANDSHAKE: "handshake",
  READY: "ready",     // 握手完成，等待掷骰
  DICE: "dice",       // 掷骰中
  STARTED: "started", // 已定先后手，可以落子
  PAUSED: "paused",   // 网络异常，暂停
  CLOSED: "closed",
};

/** 轻量哈希，用于掷骰的 commit-reveal（不是密码学用途）。 */
export function nonceHash(nonce, value) {
  let h = 0x811c9dc5;
  const s = `${nonce}:${value}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export class Session {
  /**
   * @param {object} opts
   * @param {import('./transport.js').Transport} opts.transport
   * @param {'host'|'guest'} opts.role
   * @param {{perMove:number, bank:number, configHash:string}} opts.config
   * @param {() => any} opts.getState        当前棋盘状态
   * @param {(action:any) => {ok:boolean, error?:string, state?:any}} opts.apply 应用行动
   * @param {(evt:object) => void} opts.onEvent
   */
  constructor({ transport, role, config, getState, apply, validate, resolve, onEvent, random = Math.random, heartbeat = {} }) {
    this.transport = transport;
    this.role = role;
    this.config = config;
    this.getState = getState;
    this.apply = apply;
    this.validate = validate;
    this.resolve = resolve;
    this.onEvent = onEvent ?? (() => {});
    this.random = random;
    this.hbInterval = heartbeat.intervalMs ?? 3000;
    this.hbTimeout = heartbeat.timeoutMs ?? 10000;

    this.me = role === "host" ? 0 : 1;
    this.them = 1 - this.me;
    this.phase = PHASE.IDLE;
    this.resuming = false;
    this.pending = [null, null];
    this.snapshotProvider = null;
    this.remote = null;
    this.lastSeen = Date.now();
    this.pingTimer = null;
    this.outbox = [];

    // 掷骰
    this.myNonce = null;
    this.myValue = null;
    this.myCommit = null;
    this.theirCommit = null;
    this.theirValue = null;
    this.dice = null;          // { mine, theirs, chooser }
    this.firstPerson = null;   // 0 host / 1 guest
    this.sideActor = null;
    this.seats = null;         // { 0: seat, 1: seat }
    this.firstSeat = null;

    this._attach(transport);
  }

  _attach(transport) {
    this.transport = transport;
    transport.onMessage = (raw) => this._onMessage(raw);
    transport.onClose = (reason) => this._onClose(reason);
    transport.onOpen = () => this._flushOutbox();
    if (transport.state === "open") this._flushOutbox();
  }

  _flushOutbox() {
    while (this.outbox.length && this.transport.state === "open") {
      const msg = this.outbox.shift();
      try { this.transport.send(msg); } catch { /* 交给 onClose 处理 */ }
    }
  }

  /* ------------------------------------------------------------ 生命周期 */

  start() {
    if (this.phase !== PHASE.IDLE) return;
    this.phase = PHASE.HANDSHAKE;
    this._send(message("hello", {
      rules: RULES_VERSION,
      config: this.config.configHash,
      role: this.role,
    }));
    this._startHeartbeat();
    this._emit({ type: "phase", phase: this.phase });
  }

  close(reason = "local") {
    clearInterval(this.pingTimer);
    this.pingTimer = null;
    if (this.phase === PHASE.CLOSED) return;
    this.phase = PHASE.CLOSED;
    try { this.transport.close(reason); } catch { /* ignore */ }
    this._emit({ type: "phase", phase: this.phase, reason });
  }

  _onClose(reason) {
    if (this.phase === PHASE.CLOSED) return;
    clearInterval(this.pingTimer);
    this.phase = PHASE.PAUSED;
    this._emit({ type: "offline", reason });
  }

  /** 重连后重新挂载传输并重新握手。 */
  setSnapshotProvider(fn) {
    this.snapshotProvider = fn;
  }

  /** 重连后重新挂载传输：握手时带 resume，双方交换快照而不是重新掷骰。 */
  reattach(transport) {
    this._attach(transport);
    this.resuming = true;
    this.phase = PHASE.HANDSHAKE;
    this._send(message("hello", {
      rules: RULES_VERSION,
      config: this.config.configHash,
      role: this.role,
      resume: true,
    }));
    this._startHeartbeat();
    this._emit({ type: "phase", phase: this.phase });
  }

  /* ------------------------------------------------------------ 心跳 */

  _startHeartbeat() {
    clearInterval(this.pingTimer);
    this.lastSeen = Date.now();
    this.pingTimer = setInterval(() => {
      if (this.phase === PHASE.CLOSED) return;
      if (Date.now() - this.lastSeen > this.hbTimeout) {
        this._emit({ type: "timeout" });
        clearInterval(this.pingTimer);
        return;
      }
      this._send(message("ping", { at: Date.now() }));
    }, this.hbInterval);
  }

  /* ------------------------------------------------------------ 收发 */

  _send(msg) {
    if (this.transport.state === "closed") {
      this._emit({ type: "error", code: "send-failed", detail: "transport closed" });
      return;
    }
    if (this.transport.state !== "open") {
      this.outbox.push(msg);
      return;
    }
    try {
      this.transport.send(msg);
    } catch (e) {
      this._emit({ type: "error", code: "send-failed", detail: String(e?.message ?? e) });
    }
  }

  _emit(evt) {
    this.onEvent({ ...evt, phase: this.phase });
  }

  _onMessage(raw) {
    const parsed = parseMessage(raw);
    if (!parsed.ok) {
      this._emit({ type: "error", code: parsed.error });
      return;
    }
    const msg = parsed.msg;
    this.lastSeen = Date.now();

    switch (msg.t) {
      case "ping": return;
      case "hello": return this._onHello(msg);
      case "diceCommit": return this._onDiceCommit(msg);
      case "diceReveal": return this._onDiceReveal(msg);
      case "priority": return this._onPriority(msg);
      case "side": return this._onSide(msg);
      case "start": return this._onStart(msg);
      case "commit": return this._onCommit(msg);
      case "action": return this._onCommit(msg);
      case "snapshot": return this._onSnapshot(msg);
      case "undoReq": return this._emit({ type: "undoReq" });
      case "undoRes": return this._emit({ type: "undoRes", accept: !!msg.accept });
      case "undoDo": return this._emit({ type: "undoDo", ply: msg.ply });
      case "resign": return this._emit({ type: "resign", by: "them" });
      case "rematchReq": return this._emit({ type: "rematchReq" });
      case "rematchRes":
        this._emit({ type: "rematchRes", accept: !!msg.accept });
        if (msg.accept) this._startRematch();
        return;
      case "bye": return this._emit({ type: "bye", reason: msg.reason });
      default:
        this._emit({ type: "error", code: "unknown-message", detail: msg.t });
    }
  }

  /* ------------------------------------------------------------ 握手 */

  _onHello(msg) {
    const res = checkHandshake({ config: this.config.configHash }, msg);
    if (!res.ok) {
      this._emit({ type: "error", code: "handshake:" + res.error, detail: res.detail });
      this.close("handshake-failed");
      return;
    }
    this.remote = { role: msg.role, config: msg.config };
    if (msg.resume) {
      this.resuming = true;
      this.phase = PHASE.HANDSHAKE;
      this._emit({ type: "resuming" });
      if (this.snapshotProvider) this.sendSnapshot(this.snapshotProvider());
      return;
    }
    this.phase = PHASE.READY;
    this._emit({ type: "ready", remoteRole: msg.role });
    this._beginDice();
  }

  /* ------------------------------------------------------------ 掷骰 */

  _beginDice() {
    if (this.phase !== PHASE.READY) return;
    this.phase = PHASE.DICE;
    this._emit({ type: "phase", phase: this.phase });

    this.myNonce = this.random().toString(36).slice(2, 10);
    this.myValue = 1 + Math.floor(this.random() * 6);
    this.myCommit = nonceHash(this.myNonce, this.myValue);
    this.theirCommit = null;
    this.theirValue = null;

    this._send(message("diceCommit", { hash: this.myCommit }));
    if (this.theirCommit) this._sendReveal();
  }

  _onDiceCommit(msg) {
    if (typeof msg.hash !== "string") return this._emit({ type: "error", code: "bad-dice-commit" });
    this.theirCommit = msg.hash;
    if (this.myCommit) this._sendReveal();
  }

  _sendReveal() {
    if (this._revealed) return;
    this._revealed = true;
    this._send(message("diceReveal", { nonce: this.myNonce, value: this.myValue }));
  }

  _onDiceReveal(msg) {
    if (nonceHash(msg.nonce, msg.value) !== this.theirCommit) {
      this._emit({ type: "error", code: "dice-cheat" });
      this.close("dice-cheat");
      return;
    }
    this.theirValue = msg.value;
    this._maybeResolveDice();
  }

  _maybeResolveDice() {
    if (this.theirValue == null || this.myValue == null) return;
    if (this.theirValue === this.myValue) {
      this._emit({ type: "dice-tie", mine: this.myValue, theirs: this.theirValue });
      // 双方同时重掷
      this._revealed = false;
      this._beginDice();
      return;
    }

    const mine = this.myValue;
    const theirs = this.theirValue;
    const iWin = mine > theirs;
    const chooserPerson = iWin ? this.me : this.them;
    this.dice = { mine, theirs, iWin, chooserPerson };
    this._emit({ type: "dice", mine, theirs, iWin, chooserPerson, iAmChooser: chooserPerson === this.me });
    this.phase = PHASE.DICE;
  }

  /* ------------------------------------------------------------ 选先手 / 选边 */

  choosePriority(kind) {
    this._send(message("priority", { kind }));
    this._onPriority({ kind, local: true });
  }

  _onPriority(msg) {
    const kind = msg.kind;
    if (kind !== "first" && kind !== "side") return;
    const chooser = this.dice?.chooserPerson;
    if (chooser == null) return;

    if (kind === "first") {
      this.firstPerson = chooser;
      this.sideActor = 1 - chooser;
    } else {
      this.firstPerson = 1 - chooser;
      this.sideActor = chooser;
    }
    this._emit({ type: "priority", kind, firstPerson: this.firstPerson, sideActor: this.sideActor });
  }

  chooseSide(side) {
    this._send(message("side", { side }));
    this._onSide({ side, local: true });
  }

  _onSide(msg) {
    const side = msg.side === 1 ? 1 : 0;
    const seats = {};
    seats[this.sideActor] = side;
    seats[1 - this.sideActor] = 1 - side;
    this.seats = seats;
    this.firstSeat = seats[this.firstPerson];

    if (this.role === "host") {
      this._send(message("start", { seats, firstSeat: this.firstSeat }));
      this._onStart({ seats, firstSeat: this.firstSeat, local: true });
    }
  }

  _onStart(msg) {
    this.seats = msg.seats;
    this.firstSeat = msg.firstSeat;
    this.phase = PHASE.STARTED;
    this._emit({ type: "start", seats: msg.seats, firstSeat: msg.firstSeat });
  }

  /* ------------------------------------------------------------ 行动同步 */

  /** 提交本回合行动。双方都到齐后才结算。 */
  localAction(action, elapsedMs = 0) {
    const seat = this.mySeat;
    if (seat == null) return { ok: false, error: "not-started" };
    const st = this.getState();
    const check = this.validate(st, seat, action);
    if (!check.ok) return check;
    if (this.pending[seat]) return { ok: false, error: "already-locked" };
    this.pending[seat] = action;
    this._send(message("commit", {
      ply: st.plies,
      seat,
      action,
      elapsedMs,
    }));
    return this._maybeResolve() ?? { ok: true, pending: true };
  }

  _onCommit(msg) {
    const before = this.getState();
    if (msg.ply !== before.plies) {
      this._emit({ type: "error", code: "ply-mismatch", detail: `${msg.ply} != ${before.plies}` });
      this.close("desync");
      return;
    }
    const seat = msg.seat === 1 ? 1 : 0;
    const check = this.validate(before, seat, msg.action);
    if (!check.ok) {
      this._emit({ type: "error", code: "illegal-remote-action", detail: check.error });
      this.close("desync");
      return;
    }
    this.pending[seat] = msg.action;
    this._maybeResolve();
  }

  _maybeResolve() {
    if (!this.pending[0] || !this.pending[1]) return null;
    const actions = this.pending;
    this.pending = [null, null];
    const res = this.resolve(actions);
    if (!res.ok) {
      this._emit({ type: "error", code: "illegal-remote-action", detail: res.error });
      this.close("desync");
      return res;
    }
    this._emit({ type: "resolved", actions, events: res.events, elapsedMs: 0 });
    return res;
  }

  /* ------------------------------------------------------------ 快照 */

  sendSnapshot(snapshot) {
    this._send(message("snapshot", { snapshot, hash: snapshot.stateHash }));
  }

  _onSnapshot(msg) {
    this._emit({ type: "snapshot", snapshot: msg.snapshot });
    if (this.resuming) {
      this.resuming = false;
      this.phase = PHASE.STARTED;
      this._emit({ type: "resumed" });
    }
  }

  get mySeat() {
    return this.seats ? this.seats[this.me] : null;
  }

  get isMyTurn() {
    return this.mySeat != null && this.getState().winner == null && !this.pending[this.mySeat];
  }

  /* ---------------------------------------------------------- 悔棋 / 认输 / 再来一局 */

  requestUndo() {
    this._send(message("undoReq"));
    this._emit({ type: "undoReqLocal" });
  }

  answerUndo(accept) {
    this._send(message("undoRes", { accept: !!accept }));
    if (!accept) return;
    this._send(message("undoDo", { ply: this.getState().plies }));
    this._emit({ type: "undoDo", ply: this.getState().plies, local: true });
  }

  resign() {
    this._send(message("resign"));
    this._emit({ type: "resign", by: "me" });
  }

  requestRematch() {
    this._send(message("rematchReq"));
  }

  answerRematch(accept) {
    this._send(message("rematchRes", { accept: !!accept }));
    if (accept) this._startRematch();
  }

  _startRematch() {
    this.phase = PHASE.READY;
    this.pending = [null, null];
    this.dice = null;
    this.firstPerson = null;
    this.sideActor = null;
    this.seats = null;
    this.firstSeat = null;
    this._revealed = false;
    this.theirCommit = null;
    this.theirValue = null;
    this._emit({ type: "rematch" });
    this.phase = PHASE.READY;
    this._beginDice();
  }

  send(type, payload = {}) {
    this._send(message(type, payload));
  }
}
