/**
 * M2：棋盘与本地同屏对局界面。
 * 只负责渲染与输入，规则全部来自 src/ 下的内核。
 */

import {
  createState, applyAction, validateAction,
  legalDirs, stepTarget, distanceOf, autoMove,
} from "./src/rules.js";
import { COL_NAMES, COLS, ROWS, wallName } from "./src/board.js";
import {
  createClock, tickClock, resetTurn, displayTime,
  clockSnapshot, clockRestore,
} from "./src/clock.js";
import { GAME_CONFIG } from "./src/config.js";
import { AI } from "./src/ai.js";
import { Session } from "./src/net/session.js";
import { createPeerHost, joinPeerRoom, reconnectPeerRoom } from "./src/net/peer.js";
import { createManualOffer, answerManualOffer } from "./src/net/manual.js";
import {
  loadSlots, saveSlot, deleteSlot, defaultSlotName, slotFileName, MAX_SLOTS,
} from "./src/storage.js";
import { makeRoomCode, normalizeRoomCode, configHash } from "./src/net/protocol.js";

const CELL_W = 10;          // 每列宽度（%）
const CELL_H = 100 / ROWS;  // 每行高度（%）

const el = (id) => document.getElementById(id);
const boardEl = el("board");
const cellsEl = el("cells");
const wallsEl = el("walls");
const piecesEl = el("pieces");
const colLabelsEl = el("colLabels");
const rowLabelsEl = el("rowLabels");
const metaEl = el("meta");
const statusEl = el("status");
const confirmBtn = el("confirm");
const cancelBtn = el("cancel");
const undoBtn = el("undo");
const restartBtn = el("restart");
const overlay = el("overlay");
const homeOverlay = el("homeOverlay");
const homeMain = el("homeMain");
const homeAI = el("homeAI");
const homeFine = el("homeFine");
const rulesOverlay = el("rulesOverlay");
const rulesBtn = el("rulesBtn");
const rulesClose = el("rulesClose");
const settingsOverlay = el("settingsOverlay");
const setMove = el("setMove");
const setBank = el("setBank");
const setUndo = el("setUndo");
const settingsSave = el("settingsSave");
const settingsCancel = el("settingsCancel");
const toHomeBtn = el("toHome");
const resignBtn = el("resign");
const dropOverlay = el("dropOverlay");
const dropCount = el("dropCount");
const dropEnd = el("dropEnd");
const dropSave = el("dropSave");
const saveOverlay = el("saveOverlay");
const saveName = el("saveName");
const slotsOverlay = el("slotsOverlay");
const slotList = el("slotList");
const netOverlay = el("netOverlay");
const netMain = el("netMain");
const netJoin = el("netJoin");
const netRoom = el("netRoom");
const roomInput = el("roomInput");
const roomCodeEl = el("roomCode");
const netStatusEl = el("netStatus");
const netHintEl = el("netHint");
const netManual = el("netManual");
const manualHost = el("manualHost");
const manualGuest = el("manualGuest");
const manualOfferOut = el("manualOfferOut");
const manualAnswerIn = el("manualAnswerIn");
const manualOfferIn = el("manualOfferIn");
const manualAnswerOut = el("manualAnswerOut");
const manualHint = el("manualHint");
const copyOffer = el("copyOffer");
const copyAnswer = el("copyAnswer");
const diceOverlay = el("diceOverlay");
const diceEls = [el("dice0"), el("dice1")];
const diceNameEls = [el("diceName0"), el("diceName1")];
const diceDesc = el("diceDesc");
const diceChoices = el("diceChoices");
const undoOverlay = el("undoOverlay");
const undoDesc = el("undoDesc");
const undoYes = el("undoYes");
const undoNo = el("undoNo");
const panelIcon = el("panelIcon");
const panelTitle = el("panelTitle");
const panelDesc = el("panelDesc");
const againBtn = el("again");
const toastEl = el("toast");

const clockEls = [el("clock0"), el("clock1")];
const clkEls = [el("clk0"), el("clk1")];
const bankEls = [el("bank0"), el("bank1")];

const NO_DICE = new URLSearchParams(location.search).has("nodice") || window.__DSH_NODICE === true;

const S = {
  state: null,
  clocks: null,
  settings: loadSettings(),
  started: false,  // 开局后才计时、才接受操作
  mode: "local",   // local | easy | normal | hard
  aiSeat: null,    // 电脑坐哪一边（0 左 / 1 右）；本地双人为 null
  firstSeat: 0,    // 先手坐哪一边
  pendingMode: "local",
  diceChooser: 0,
  diceFirst: 0,
  aiThinking: false,
  preview: null,   // { action, valid, label }
  gameOver: false,
  history: [],     // [{ state, clocks }]
  undoLeft: [3, 3],
  pendingUndo: null,
  undoOverlayOpen: false,
  toastTimer: null,
  lastTs: 0,
  net: null,        // { session, role, code }
  mySeat: null,
  turnStartedAt: 0,
  undoTimer: null,
};

const cellEls = new Map();   // "c,r"
const slotEls = new Map();   // "v:c:r" | "h:c:r" | "t:c"
const colLabelEls = new Map(); // 列标签（只用于越线提示）
const pieceEls = [];
let ghostEl = null;
let exitBadge = null;

const slotKey = (kind, c, r) => (kind === "top" ? `t:${c}` : `${kind}:${c}:${r}`);
const cellKey = (c, r) => `${c},${r}`;

/* ---------------------------------------------------------------- 构建 */

function buildBoard() {
  cellsEl.innerHTML = "";
  wallsEl.innerHTML = "";
  colLabelsEl.innerHTML = "";
  rowLabelsEl.innerHTML = "";
  cellEls.clear();
  slotEls.clear();
  colLabelEls.clear();

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const d = document.createElement("div");
      d.className = "cell" + ((c + r) % 2 ? " odd" : "");
      d.style.left = `${c * CELL_W}%`;
      d.style.top = `${r * CELL_H}%`;
      d.dataset.c = c;
      d.dataset.r = r;
      d.addEventListener("click", () => onCellClick(c, r));
      cellsEl.appendChild(d);
      cellEls.set(cellKey(c, r), d);
    }
  }

  // 列标签：只显示坐标，站在第 1 行时可点击越线
  for (let c = 0; c < COLS; c++) {
    const d = document.createElement("div");
    d.className = "colSlot";
    d.dataset.c = c;
    d.textContent = COL_NAMES[c];
    d.addEventListener("click", () => onColLabelClick(c));
    colLabelsEl.appendChild(d);
    colLabelEls.set(c, d);
  }

  for (let r = 0; r < ROWS; r++) {
    const d = document.createElement("div");
    d.className = "rowSlot";
    d.textContent = String(r + 1);
    rowLabelsEl.appendChild(d);
  }

  for (let c = 0; c < COLS - 1; c++) {
    for (let r = 0; r < ROWS; r++) {
      const d = document.createElement("div");
      d.className = "slot slot-v";
      d.dataset.kind = "v";
      d.dataset.c = c;
      d.dataset.r = r;
      d.style.left = `${(c + 1) * CELL_W}%`;
      d.style.top = `${r * CELL_H}%`;
      d.innerHTML = `<i class="bar"></i>`;
      d.addEventListener("click", () => onWallClick("v", c, r));
      wallsEl.appendChild(d);
      slotEls.set(slotKey("v", c, r), d);
    }
  }

  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS - 1; r++) {
      const d = document.createElement("div");
      d.className = "slot slot-h";
      d.dataset.kind = "h";
      d.dataset.c = c;
      d.dataset.r = r;
      d.style.left = `${c * CELL_W}%`;
      d.style.top = `${(r + 1) * CELL_H}%`;
      d.innerHTML = `<i class="bar"></i>`;
      d.addEventListener("click", () => onWallClick("h", c, r));
      wallsEl.appendChild(d);
      slotEls.set(slotKey("h", c, r), d);
    }
  }

  // 上端格线：与其他墙位一样压在格线上
  for (let c = 0; c < COLS; c++) {
    const d = document.createElement("div");
    d.className = "slot slot-top";
    d.dataset.kind = "top";
    d.dataset.c = c;
    d.dataset.r = 0;
    d.style.left = `${c * CELL_W}%`;
    d.style.top = "0";
    d.innerHTML = `<i class="bar"></i>`;
    d.addEventListener("click", () => onTopSlotClick(c));
    wallsEl.appendChild(d);
    slotEls.set(slotKey("top", c, 0), d);
  }

  piecesEl.innerHTML = "";
  pieceEls.length = 0;
  for (let p = 0; p < 2; p++) {
    const d = document.createElement("div");
    d.className = `piece p${p}`;
    piecesEl.appendChild(d);
    pieceEls.push(d);
  }

  ghostEl = document.createElement("div");
  ghostEl.className = "piece ghost";
  ghostEl.style.display = "none";
  piecesEl.appendChild(ghostEl);

  exitBadge = document.createElement("div");
  exitBadge.className = "exitBadge";
  exitBadge.style.display = "none";
  exitBadge.innerHTML = "<span>▲ 越线</span>";
  exitBadge.addEventListener("click", () => {
    const me = S.state?.players?.[S.state.turn];
    if (!me) return;
    if (me.r !== 0 || S.state.topWall[me.c] === 1) return;
    if (S.preview && S.preview.action.type === "move" && S.preview.action.dir === "up") {
      commit();
      return;
    }
    setPreview({ type: "move", dir: "up" }, "越线");
  });
  piecesEl.appendChild(exitBadge);
}

/* ---------------------------------------------------------------- 渲染 */

function paint() {
  const st = S.state;

  for (const [, d] of cellEls) d.classList.remove("move-target", "preview", "p1", "exit-cell");
  for (const [, d] of slotEls) {
    d.classList.remove("preview", "invalid", "p1");
  }
  for (const [, d] of colLabelEls) {
    d.classList.remove("can-exit", "exit-target", "p1");
  }
  if (ghostEl) ghostEl.style.display = "none";
  if (exitBadge) {
    exitBadge.style.display = "none";
    exitBadge.classList.remove("p1");
  }

  if (!st) return;

  for (const [key, d] of slotEls) {
    const parts = key.split(":");
    let placed = false;
    if (parts[0] === "v") placed = st.vWall[+parts[1] * ROWS + +parts[2]] === 1;
    else if (parts[0] === "h") placed = st.hWall[+parts[1] * (ROWS - 1) + +parts[2]] === 1;
    else placed = st.topWall[+parts[1]] === 1;
    d.classList.toggle("placed", placed);
  }

  for (let p = 0; p < 2; p++) {
    const { c, r } = st.players[p];
    pieceEls[p].style.left = `${c * CELL_W}%`;
    pieceEls[p].style.top = `${r * CELL_H}%`;
  }
  const [a, b] = st.players;
  const same = a.c === b.c && a.r === b.r;
  pieceEls[0].classList.toggle("shift-left", same);
  pieceEls[1].classList.toggle("shift-right", same);

  // 合法落点
  // 合法落点始终显示（预选时也保留，方便改主意）
  if (!S.gameOver) {
    const me = st.players[st.turn];
    const pclass = st.turn === 1 ? " p1" : "";
    for (const dir of legalDirs(st, me.c, me.r)) {
      const t = stepTarget(st, me.c, me.r, dir);
      if (!t || t.exit) continue;
      const cell = cellEls.get(cellKey(t.c, t.r));
      if (!cell) continue;
      cell.classList.add("move-target");
      if (pclass) cell.classList.add("p1");
    }
    if (me.r === 0 && st.topWall[me.c] === 0) {
      const label = colLabelEls.get(me.c);
      if (label) {
        label.classList.add("can-exit", "exit-target");
        if (st.turn === 1) label.classList.add("p1");
      }
      // 自己所在的格子同时作为“越线”大按钮
      const own = cellEls.get(cellKey(me.c, me.r));
      if (own) {
        own.classList.add("exit-cell");
        if (st.turn === 1) own.classList.add("p1");
      }
    }
  }

  // 越线徽标：挂在终点线上（预览中仍显示）
  if (exitBadge && !S.gameOver) {
    const me = st.players[st.turn];
    if (me.r === 0 && st.topWall[me.c] === 0) {
      exitBadge.style.display = "flex";
      exitBadge.style.left = `${me.c * CELL_W}%`;
      exitBadge.classList.toggle("p1", st.turn === 1);
    }
  }

  // 预览
  if (S.preview) {
    const { action, valid } = S.preview;
    if (action.type === "wall") {
      const slot = slotEls.get(slotKey(action.kind, action.c, action.r));
      if (slot) slot.classList.add(valid ? "preview" : "invalid");
    } else if (action.type === "move") {
      const me = st.players[st.turn];
      const t = stepTarget(st, me.c, me.r, action.dir);
      if (t && t.exit) {
        const own = cellEls.get(cellKey(me.c, me.r));
        if (own) {
          own.classList.add("exit-cell");
          if (st.turn === 1) own.classList.add("p1");
        }
      } else if (t) {
        const cell = cellEls.get(cellKey(t.c, t.r));
        if (cell) {
          cell.classList.add("preview");
          if (st.turn === 1) cell.classList.add("p1");
        }
        ghostEl.style.display = "block";
        ghostEl.className = `piece ghost p${st.turn}`;
        ghostEl.style.left = `${t.c * CELL_W}%`;
        ghostEl.style.top = `${t.r * CELL_H}%`;
      }
    }
  }

  const name = st.turn === 0 ? "左方（青）" : "右方（橙）";
  metaEl.textContent = `第 ${st.plies + 1} 手 · 墙 ${st.wallsPlaced}`;
  statusEl.textContent = S.aiThinking
    ? "电脑思考中…"
    : S.preview
      ? (S.preview.valid ? `确认${S.preview.label}？` : "这里会封死通路，换个位置")
      : `${name}：点击高亮格移动，或点击格线放墙`;

  confirmBtn.disabled = !S.preview || !S.preview.valid || S.gameOver;
  cancelBtn.disabled = !S.preview;
  undoBtn.textContent = `悔棋 ${S.undoLeft[st.turn]}`;
  undoBtn.disabled = S.gameOver || S.aiThinking
    || (S.mode === "online" && (S.state.turn !== S.mySeat || !S.net))
    || S.undoLeft[st.turn] <= 0 || S.history.length < 2;

  resignBtn.hidden = !S.started || S.gameOver;
  paintClocks();
}

function paintClocks() {
  if (!S.clocks || !S.state) return;
  const c = S.clocks;
  const turn = S.state.turn;
  for (let p = 0; p < 2; p++) {
    const box = clockEls[p];
    // 大数字统一表示“本步可用时间”：轮到自己时是真实倒计时，否则显示下一步的初始额度
    const main = p === turn ? displayTime(c, turn) : c.perMove;
    const mainSec = Math.max(0, Math.ceil(main));
    clkEls[p].textContent = String(mainSec);
    bankEls[p].textContent = `库 ${Math.ceil(c.banks[p])}`;
    box.classList.toggle("active", p === turn && !S.gameOver);
    box.classList.toggle("p1", p === 1);
    box.classList.toggle("warn", p === turn && mainSec <= 5 && !S.gameOver);
    box.classList.toggle("inbank", p === turn && c.inBank && !S.gameOver);
  }
}

/* ---------------------------------------------------------------- 交互 */

function setPreview(action, label) {
  const check = validateAction(S.state, action);
  S.preview = { action, valid: check.ok, label };
  if (!check.ok && check.error === "blocks-path") {
    toast("这面墙会封死通路（双方都必须留有到终点的路）", true);
  }
  paint();
}

function clearPreview() {
  S.preview = null;
  paint();
}

function onCellClick(c, r) {
  if (S.gameOver || !S.started || S.aiThinking) return;
  if (S.mode === "online" && S.state.turn !== S.mySeat) return;
  const st = S.state;
  const me = st.players[st.turn];

  // 站在第 1 行且出口未封：点自己的格子 = 越线（大热区）
  if (c === me.c && r === me.r) {
    if (me.r === 0 && st.topWall[me.c] === 0) {
      if (S.preview && S.preview.action.type === "move" && S.preview.action.dir === "up") {
        commit();
        return;
      }
      setPreview({ type: "move", dir: "up" }, "越线");
    }
    return;
  }

  if (S.preview && S.preview.action.type === "move") {
    const t = stepTarget(st, me.c, me.r, S.preview.action.dir);
    if (t && !t.exit && t.c === c && t.r === r && S.preview.valid) {
      commit();
      return;
    }
  }

  if (Math.abs(c - me.c) + Math.abs(r - me.r) !== 1) {
    if (c !== me.c || r !== me.r) toast("一次只能走一格");
    return;
  }

  let dir = null;
  if (c === me.c && r === me.r - 1) dir = "up";
  else if (c === me.c && r === me.r + 1) dir = "down";
  else if (c === me.c - 1 && r === me.r) dir = "left";
  else if (c === me.c + 1 && r === me.r) dir = "right";
  if (!dir) return;

  const t = stepTarget(st, me.c, me.r, dir);
  if (!t) {
    toast("这个方向有墙或已到边界", true);
    return;
  }
  setPreview({ type: "move", dir }, t.exit ? "越线" : "移动");
}

function onWallClick(kind, c, r) {
  if (S.gameOver || !S.started || S.aiThinking) return;
  if (S.mode === "online" && S.state.turn !== S.mySeat) return;
  const st = S.state;

  if (S.preview && S.preview.action.type === "wall") {
    const a = S.preview.action;
    if (a.kind === kind && a.c === c && a.r === r && S.preview.valid) {
      commit();
      return;
    }
  }

  const placed = kind === "v"
    ? st.vWall[c * ROWS + r] === 1
    : st.hWall[c * (ROWS - 1) + r] === 1;
  if (placed) return;

  setPreview({ type: "wall", kind, c, r }, `封墙 ${wallName(kind, c, r)}`);
}

function onTopSlotClick(c) {
  if (S.gameOver || !S.started || S.aiThinking) return;
  if (S.mode === "online" && S.state.turn !== S.mySeat) return;
  const st = S.state;
  const me = st.players[st.turn];

  if (me.c === c && me.r === 0 && st.topWall[c] === 0) {
    if (S.preview && S.preview.action.type === "move" && S.preview.action.dir === "up") {
      commit();
      return;
    }
    setPreview({ type: "move", dir: "up" }, "越线");
    return;
  }

  if (st.topWall[c] === 1) return;
  if (S.preview && S.preview.action.type === "wall"
      && S.preview.action.kind === "top" && S.preview.action.c === c) {
    if (S.preview.valid) commit();
    return;
  }
  setPreview({ type: "wall", kind: "top", c, r: 0 }, `封顶 ${COL_NAMES[c]}-0`);
}

/** 列标签：只在可以越线时可点，作为更大的越线热区。 */
function onColLabelClick(c) {
  if (S.gameOver || !S.started || S.aiThinking) return;
  if (S.mode === "online" && S.state.turn !== S.mySeat) return;
  const st = S.state;
  const me = st.players[st.turn];
  if (me.c !== c || me.r !== 0 || st.topWall[c] === 1) return;
  if (S.preview && S.preview.action.type === "move" && S.preview.action.dir === "up") {
    commit();
    return;
  }
  setPreview({ type: "move", dir: "up" }, "越线");
}

function commit() {
  if (!S.preview || !S.preview.valid) return;
  const label = S.preview.label;
  const pendingAction = S.preview.action;

  if (S.mode === "online") {
    if (!S.net || S.state.turn !== S.mySeat) {
      toast("还没轮到你", true);
      return;
    }
    const elapsed = Math.round(performance.now() - S.turnStartedAt);
    const res = S.net.session.localAction(S.preview.action, elapsed);
    S.preview = null;
    if (!res.ok) {
      toast("非法操作：" + res.error, true);
      return;
    }
    advance(res.state, label, pendingAction);
    return;
  }

  const res = applyAction(S.state, S.preview.action);
  if (!res.ok) {
    toast("非法操作：" + res.error, true);
    return;
  }
  S.preview = null;
  advance(res.state, label, pendingAction);
}

/** 应用一步后的收尾：重置本方计时、记录历史、处理终局。 */
function advance(nextState, label = "行动", action = null) {
  const by = S.state.turn;
  S.state = nextState;
  resetTurn(S.clocks);
  S.turnStartedAt = performance.now();
  S.history.push({ state: nextState, clocks: clockSnapshot(S.clocks), by, label, action });

  if (nextState.winner !== null) {
    S.gameOver = true;
    S.aiThinking = false;
    paint();
    setTimeout(showResult, 320);
    return;
  }
  paint();
  maybeAI();
}

function actionLabel(action, before) {
  if (action.type === "move") {
    const p = before.players[before.turn];
    const t = stepTarget(before, p.c, p.r, action.dir);
    return t && t.exit ? "越线" : "移动";
  }
  return action.kind === "top"
    ? `封顶 ${COL_NAMES[action.c]}-0`
    : `封墙 ${wallName(action.kind, action.c, action.r)}`;
}

/** 人机模式：轮到电脑时自动走一步。 */
function maybeAI() {
  if (S.aiSeat === null || S.gameOver || !S.started) return;
  if (S.state.turn !== S.aiSeat || S.aiThinking) return;

  S.aiThinking = true;
  paint();
  const plies = S.state.plies;

  setTimeout(() => {
    if (S.gameOver || !S.started || S.state.turn !== S.aiSeat || S.state.plies !== plies) {
      S.aiThinking = false;
      paint();
      return;
    }
    const before = S.state;
    const action = AI[S.mode](before, Math.random);
    const res = applyAction(before, action);
    S.aiThinking = false;
    if (!res.ok) {
      paint();
      return;
    }
    advance(res.state, actionLabel(action, before));
  }, S.mode === "master" ? 280 : GAME_CONFIG.aiDelay);
}

/** 超时：BFS 最短路代走（同长优先向上）。 */
function onTimeout() {
  if (S.gameOver || !S.state) return;
  const mv = autoMove(S.state);
  if (!mv) return;
  const res = applyAction(S.state, mv);
  if (!res.ok) return;
  S.preview = null;
  toast("超时，系统代走");
  advance(res.state, "超时代走");
}

/** 悔棋：撤销最近一手，由对方在确认框中同意。 */
function undo() {
  if (S.gameOver || !S.started || S.aiThinking) return;
  if (S.aiSeat !== null && S.state.turn === S.aiSeat) {
    toast("等电脑走完再悔棋");
    return;
  }
  if (S.undoOverlayOpen) return;

  if (S.mode === "online") {
    if (!S.net || S.state.turn !== S.mySeat) { toast("只能在自己的回合悔棋", true); return; }
    if (S.history.length < 2) { toast("还没有可以悔的棋"); return; }
    S.net.session.requestUndo();
    toast("已发送悔棋请求，等待对方回应（30 秒）");
    clearTimeout(S.undoTimer);
    S.undoTimer = setTimeout(() => toast("对方未回应，悔棋请求已过期", true), 30000);
    return;
  }

  try {
    const p = S.state.turn;
    if (S.undoLeft[p] <= 0) {
      toast("本局悔棋次数已用完", true);
      return;
    }
    if (S.history.length < 2) {
      toast("还没有可以悔的棋");
      return;
    }

    const last = S.history[S.history.length - 1];
    const who = last.by === 0 ? "左方" : "右方";
    S.pendingUndo = { last, requester: p };
    S.undoOverlayOpen = true;
    undoDesc.textContent = `撤销${who}的「${last.label}」？\n（本方可悔 ${S.undoLeft[p]} 次）`;
    undoOverlay.hidden = false;
  } catch (e) {
    toast("悔棋失败：" + e.message, true);
  }
}

function finishUndo(agree) {
  const req = S.pendingUndo;
  S.pendingUndo = null;
  S.undoOverlayOpen = false;
  undoOverlay.hidden = true;
  if (!agree || !req) return;

  const { last, requester } = req;

  if (S.aiSeat === null) {
    S.history.pop();
  } else {
    // 人机：回到人类上一次行棋之前的局面（撤销自己一手 + 电脑应手）
    const humanSeat = 1 - S.aiSeat;
    let idx = -1;
    for (let i = S.history.length - 2; i >= 0; i--) {
      if (S.history[i].state.turn === humanSeat) { idx = i; break; }
    }
    if (idx >= 0) S.history = S.history.slice(0, idx + 1);
    else S.history.pop();
  }

  const target = S.history[S.history.length - 1];
  S.state = target.state;
  clockRestore(S.clocks, target.clocks);
  AI[S.mode]?.reset?.();
  S.undoLeft[requester] -= 1;
  S.preview = null;
  S.lastTs = performance.now();
  paint();
  toast(`已撤销${last.by === 0 ? "左方" : "右方"}的「${last.label}」`);
}

/* ---------------------------------------------------------------- 结算 */

function showResult() {
  const st = S.state;
  if (st.winner === "draw") {
    panelIcon.textContent = "🤝";
    panelTitle.textContent = "平局";
    panelDesc.textContent = "对手下一手同样可以越线，按“1 手容差”判和。";
  } else {
    panelIcon.textContent = "🏁";
    if (S.mode === "online") {
      panelTitle.textContent = st.winner === S.mySeat ? "你赢了" : "你输了";
    } else {
      panelTitle.textContent = st.winner === 0 ? "左方获胜" : "右方获胜";
    }
    const loser = 1 - st.winner;
    panelDesc.textContent = S.endReason === "resign"
      ? `认输结束。共 ${st.plies} 手，封墙 ${st.wallsPlaced} 面。`
      : `对手距终点还剩 ${distanceOf(st, loser)} 步。共 ${st.plies} 手，封墙 ${st.wallsPlaced} 面。`;
  }
  overlay.hidden = false;
}

/* ---------------------------------------------------------------- 其他 */

function overlaysOpen() {
  return !homeOverlay.hidden || !overlay.hidden || !undoOverlay.hidden
    || !rulesOverlay.hidden || !settingsOverlay.hidden;
}

function toast(msg, isError = false) {
  toastEl.textContent = msg;
  toastEl.classList.toggle("error", isError);
  toastEl.classList.add("show");
  clearTimeout(S.toastTimer);
  S.toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2000);
}

const SETTINGS_KEY = "danteng.settings.v1";

function clamp(v, lo, hi) {
  const n = Number(v);
  return Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));
}

function loadSettings() {
  const base = {
    perMove: GAME_CONFIG.perMove,
    bank: GAME_CONFIG.bank,
    undoLimit: GAME_CONFIG.undoLimit,
  };
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    return {
      perMove: clamp(saved.perMove ?? base.perMove, 5, 120),
      bank: clamp(saved.bank ?? base.bank, 0, 900),
      undoLimit: clamp(saved.undoLimit ?? base.undoLimit, 0, 10),
    };
  } catch {
    return base;
  }
}

function paintHomeFine() {
  const s = S.settings;
  homeFine.textContent = `每步 ${s.perMove} 秒 · 时间库 ${s.bank} 秒 · 悔棋 ${s.undoLimit} 次`;
}

function newGame(announce = false) {
  for (const k of Object.keys(AI)) AI[k]?.reset?.();
  S.state = createState(S.firstSeat);
  S.clocks = createClock({ perMove: S.settings.perMove, bank: S.settings.bank });
  S.history = [{ state: S.state, clocks: clockSnapshot(S.clocks) }];
  S.undoLeft = [S.settings.undoLimit, S.settings.undoLimit];
  S.preview = null;
  S.gameOver = false;
  S.aiThinking = false;
  S.endReason = null;
  S.pendingUndo = null;
  S.undoOverlayOpen = false;
  S.lastTs = performance.now();
  overlay.hidden = true;
  undoOverlay.hidden = true;
  paint();
  if (announce) toast("已重新开始");
}

/** 从主菜单开局。 */
function startGame(mode) {
  S.pendingMode = mode;
  S.mode = mode;
  S.aiPerson = mode === "local" ? null : 1;

  if (NO_DICE) {
    finishDice(0, 0, 0);
    return;
  }

  diceOverlay.hidden = false;
  renderChoices([]);
  rollDice();
}

function personNames() {
  return S.pendingMode === "local" ? ["玩家 1", "玩家 2"] : ["你", "电脑"];
}

function renderChoices(items) {
  diceChoices.innerHTML = "";
  diceChoices.hidden = items.length === 0;
  for (const it of items) {
    const b = document.createElement("button");
    b.className = "btn " + (it.primary ? "primary" : "ghost");
    b.textContent = it.label;
    if (it.priority) b.dataset.priority = it.priority;
    if (it.side !== undefined) b.dataset.side = String(it.side);
    b.addEventListener("click", it.onClick);
    diceChoices.appendChild(b);
  }
}

function rollDice() {
  const names = personNames();
  diceNameEls[0].textContent = names[0];
  diceNameEls[1].textContent = names[1];
  diceDesc.textContent = "掷骰中…";
  for (const d of diceEls) {
    d.classList.add("rolling");
    d.classList.remove("win");
  }

  const timer = setInterval(() => {
    for (const d of diceEls) d.textContent = String(1 + Math.floor(Math.random() * 6));
  }, 60);

  setTimeout(() => {
    clearInterval(timer);
    const a = 1 + Math.floor(Math.random() * 6);
    const b = 1 + Math.floor(Math.random() * 6);
    diceEls[0].textContent = String(a);
    diceEls[1].textContent = String(b);
    for (const d of diceEls) d.classList.remove("rolling");

    if (a === b) {
      diceDesc.textContent = `都是 ${a} 点，重掷`;
      setTimeout(rollDice, 650);
      return;
    }

    S.diceChooser = a > b ? 0 : 1;
    S.diceLoser = 1 - S.diceChooser;
    diceEls[S.diceChooser].classList.add("win");
    showPriority();
  }, GAME_CONFIG.diceDelay);
}

/** 点数大者：先手 或 选边，二选一。 */
function showPriority() {
  const names = personNames();
  const chooser = S.diceChooser;
  diceDesc.textContent = `${names[chooser]} 点数更大：选择先手，或选择执子方向`;
  renderChoices([
    { label: "我要先手", priority: "first", primary: true, onClick: () => choosePriority("first") },
    { label: "我要选边", priority: "side", onClick: () => choosePriority("side") },
  ]);

  if (S.aiPerson === chooser) {
    diceDesc.textContent += "（电脑选择中…）";
    setTimeout(() => choosePriority(Math.random() < 0.6 ? "first" : "side"), 700);
  }
}

function choosePriority(kind) {
  const chooser = S.diceChooser;
  const loser = S.diceLoser;
  const names = personNames();

  S.diceFirstPerson = kind === "first" ? chooser : loser;
  S.diceSideActor = kind === "first" ? loser : chooser;

  diceDesc.textContent = kind === "first"
    ? `${names[chooser]} 先手，${names[loser]} 选择执子方向`
    : `${names[chooser]} 选择执子方向，${names[loser]} 先手`;

  renderChoices([
    { label: "执左（A-12）", side: 0, primary: true, onClick: () => chooseSide(0) },
    { label: "执右（J-12）", side: 1, onClick: () => chooseSide(1) },
  ]);

  if (S.aiPerson === S.diceSideActor) {
    diceDesc.textContent += "（电脑选择中…）";
    setTimeout(() => chooseSide(Math.random() < 0.5 ? 0 : 1), 700);
  }
}

function chooseSide(side) {
  finishDice(side, S.diceSideActor, S.diceFirstPerson);
}

/**
 * side: 选边者选择的方向（0 左 / 1 右）。
 * firstPerson: 先手的人。
 */
function finishDice(side, sidePicker, firstPerson) {
  const seatOfPerson = [0, 0];
  seatOfPerson[sidePicker] = side;
  seatOfPerson[1 - sidePicker] = 1 - side;

  S.aiSeat = S.aiPerson === null ? null : seatOfPerson[S.aiPerson];
  S.firstSeat = seatOfPerson[firstPerson];

  diceOverlay.hidden = true;
  renderChoices([]);
  homeOverlay.hidden = true;
  homeMain.hidden = false;
  homeAI.hidden = true;

  newGame();
  S.started = true;
  S.lastTs = performance.now();
  paint();

  const firstSeat = S.firstSeat;
  const firstWho = S.aiSeat === null
    ? (firstSeat === 0 ? "左方" : "右方")
    : (firstSeat === S.aiSeat ? "电脑" : "你");
  toast(`${firstWho}先手`);
  maybeAI();
}

function goHome() {
  closeDrop();
  clearTimeout(S.handshakeTimer);
  stopNet();
  S.started = false;
  S.preview = null;
  overlay.hidden = true;
  undoOverlay.hidden = true;
  rulesOverlay.hidden = true;
  settingsOverlay.hidden = true;
  diceOverlay.hidden = true;
  homeOverlay.hidden = false;
  homeMain.hidden = false;
  homeAI.hidden = true;
  paintHomeFine();
  paint();
}

function openRules() {
  rulesOverlay.hidden = false;
}

function openSettings() {
  setMove.value = S.settings.perMove;
  setBank.value = S.settings.bank;
  setUndo.value = S.settings.undoLimit;
  settingsOverlay.hidden = false;
}

function saveSettings() {
  S.settings = {
    perMove: clamp(setMove.value, 5, 120),
    bank: clamp(setBank.value, 0, 900),
    undoLimit: clamp(setUndo.value, 0, 10),
  };
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(S.settings));
  } catch { /* 隐私模式下忽略 */ }
  settingsOverlay.hidden = true;
  paintHomeFine();
  toast("设置已保存，下一局生效");
}

confirmBtn.addEventListener("click", commit);
cancelBtn.addEventListener("click", clearPreview);
undoBtn.addEventListener("click", undo);
undoYes.addEventListener("click", () => {
  if (S.mode === "online") {
    undoOverlay.hidden = true;
    S.net.session.answerUndo(true);
    return;
  }
  finishUndo(true);
});
undoNo.addEventListener("click", () => {
  if (S.mode === "online") {
    undoOverlay.hidden = true;
    S.net.session.answerUndo(false);
    return;
  }
  finishUndo(false);
});

el("menuLocal").addEventListener("click", () => startGame("local"));
el("menuAI").addEventListener("click", () => {
  homeMain.hidden = true;
  homeAI.hidden = false;
});
el("aiBack").addEventListener("click", () => {
  homeAI.hidden = true;
  homeMain.hidden = false;
});
homeAI.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-level]");
  if (btn) startGame(btn.dataset.level);
});
el("menuNet").addEventListener("click", () => { homeOverlay.hidden = true; openNet(); });
el("netBack").addEventListener("click", () => { netOverlay.hidden = true; homeOverlay.hidden = false; });
el("netCreate").addEventListener("click", createRoom);
el("netJoinBtn").addEventListener("click", () => { netMain.hidden = true; netJoin.hidden = false; roomInput.focus(); });
el("netManualBtn").addEventListener("click", showManualPanel);
el("manualHostBtn").addEventListener("click", manualBecomeHost);
el("manualGuestBtn").addEventListener("click", () => { manualGuest.hidden = false; manualHost.hidden = true; });
el("manualFinish").addEventListener("click", manualFinishHost);
el("manualMakeAnswer").addEventListener("click", manualMakeAnswer);
el("manualBack").addEventListener("click", () => { netManual.hidden = true; netMain.hidden = false; });
copyOffer.addEventListener("click", () => {
  navigator.clipboard?.writeText(manualOfferOut.value).then(
    () => toast("邀请码已复制"),
    () => toast("复制失败，请手动选中复制", true),
  );
});
copyAnswer.addEventListener("click", () => {
  navigator.clipboard?.writeText(manualAnswerOut.value).then(
    () => toast("应答码已复制"),
    () => toast("复制失败，请手动选中复制", true),
  );
});
el("joinBack").addEventListener("click", () => { netJoin.hidden = true; netMain.hidden = false; });
el("joinGo").addEventListener("click", joinRoom);
el("copyRoom").addEventListener("click", copyRoomLink);
el("cancelRoom").addEventListener("click", () => { stopNet(); netOverlay.hidden = true; homeOverlay.hidden = false; });
el("menuRules").addEventListener("click", openRules);
el("menuSlots").addEventListener("click", openSlots);
el("slotsClose").addEventListener("click", () => { slotsOverlay.hidden = true; });
el("saveCancel").addEventListener("click", () => { saveOverlay.hidden = true; });
el("saveConfirm").addEventListener("click", confirmSave);
el("dropSave").addEventListener("click", openSaveDialog);
el("dropEnd").addEventListener("click", () => { closeDrop(); endOnlineGame(S.mySeat); });
el("menuSettings").addEventListener("click", openSettings);
rulesBtn.addEventListener("click", openRules);
el("homeBtn").addEventListener("click", () => {
  if (S.state && S.state.plies > 0 && !S.gameOver && !window.confirm("返回主菜单将放弃当前对局，确定？")) return;
  goHome();
});
rulesClose.addEventListener("click", () => { rulesOverlay.hidden = true; });
settingsSave.addEventListener("click", saveSettings);
settingsCancel.addEventListener("click", () => { settingsOverlay.hidden = true; });
toHomeBtn.addEventListener("click", goHome);

restartBtn.addEventListener("click", () => {
  if (S.state && S.state.plies > 0 && !window.confirm("当前对局还没结束，确定重新开始？")) return;
  newGame(true);
  S.started = true;
  S.lastTs = performance.now();
});
let resignArmedAt = 0;
resignBtn.addEventListener("click", () => {
  if (!S.started || S.gameOver) return;
  if (Date.now() - resignArmedAt > 3000) {
    resignArmedAt = Date.now();
    toast("再点一次确认认输", true);
    return;
  }

  S.endReason = "resign";

  if (S.mode === "online" && S.net) {
    S.net.session.resign();
    endOnlineGame(1 - S.mySeat);
    return;
  }

  // 人机：认输的是人类；本地：认输的是当前行棋方
  const loser = S.aiSeat !== null ? 1 - S.aiSeat : S.state.turn;
  endLocalGame(1 - loser);
});

againBtn.addEventListener("click", () => {
  if (S.mode === "online" && S.net) {
    S.net.session.requestRematch();
    toast("已请求再来一局，等待对方同意");
    return;
  }
  newGame(true);
  S.started = true;
  S.lastTs = performance.now();
});
boardEl.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  clearPreview();
});
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (!rulesOverlay.hidden) { rulesOverlay.hidden = true; return; }
    if (!settingsOverlay.hidden) { settingsOverlay.hidden = true; return; }
    clearPreview();
  }
  if (e.key === "Enter" && S.preview && S.preview.valid) commit();
});

// 计时循环：100ms 一跳，用真实时间差推进，避免定时器漂移
setInterval(() => {
  const now = performance.now();
  const dt = (now - S.lastTs) / 1000;
  S.lastTs = now;
  if (!S.state || !S.clocks || !S.started || S.gameOver || overlaysOpen() || document.hidden) return;
  if (S.mode === "online" && (S.state.turn !== S.mySeat || !S.net)) return;
  if (dt <= 0) return;
  const r = tickClock(S.clocks, S.state.turn, Math.min(dt, 0.5));
  paintClocks();
  if (r.timedOut) onTimeout();
}, 100);


/* ---------------------------------------------------------------- 联机 */

let netCode = "";

const NET_STATUS = {
  signaling: "正在连接信令服务器…",
  waiting: "等待对手加入…",
  dialing: "正在连接对手…",
  connected: "已连接，正在握手…",
};

function openNet() {
  netOverlay.hidden = false;
  netMain.hidden = false;
  netJoin.hidden = true;
  netRoom.hidden = true;
  roomInput.value = "";
}

function stopNet() {
  if (S.net?.session) {
    try { S.net.session.close("local"); } catch { /* ignore */ }
  }
  S.net = null;
  S.mySeat = null;
  if (S.mode === "online") S.mode = "local";
}

async function createRoom() {
  const code = makeRoomCode();
  netCode = code;
  netMain.hidden = true;
  netJoin.hidden = true;
  netRoom.hidden = false;
  roomCodeEl.textContent = code;
  netStatusEl.textContent = NET_STATUS.signaling;
  netHintEl.textContent = "把房间码发给对方，或复制链接";

  try {
    const transport = await createPeerHost(code, {
      onStatus: (st) => { netStatusEl.textContent = NET_STATUS[st] ?? st; },
    });
    attachSession(transport, "host", code);
  } catch (e) {
    netStatusEl.textContent = "创建失败：" + e.message;
    toast(e.message, true);
  }
}

async function joinRoom() {
  const code = normalizeRoomCode(roomInput.value);
  if (code.length !== 6) {
    toast("房间码是 6 位", true);
    return;
  }
  netCode = code;
  netMain.hidden = true;
  netJoin.hidden = true;
  netRoom.hidden = false;
  roomCodeEl.textContent = code;
  netStatusEl.textContent = NET_STATUS.signaling;

  try {
    const transport = await joinPeerRoom(code, {
      onStatus: (st) => { netStatusEl.textContent = NET_STATUS[st] ?? st; },
    });
    attachSession(transport, "guest", code);
  } catch (e) {
    netStatusEl.textContent = "连接失败：" + e.message;
    toast(e.message, true);
  }
}

function attachSession(transport, role, code) {
  const cfg = { perMove: S.settings.perMove, bank: S.settings.bank };
  const session = new Session({
    transport,
    role,
    config: { ...cfg, configHash: configHash(cfg) },
    getState: () => S.state,
    apply: (action) => {
      const res = applyAction(S.state, action);
      if (!res.ok) return { ok: false, error: res.error };
      S.state = res.state;
      return { ok: true, state: res.state };
    },
    onEvent: handleNetEvent,
  });
  S.net = { session, role, code, hostTransport: role === "host" ? transport : null };
  netStatusEl.textContent = role === "guest" ? "等待对方完成连接…" : "正在建立通道…";

  // 传输层打开 → 提示已建立通道
  const enterRoom = () => {
    if (netRoom.hidden) {
      netManual.hidden = true;
      netRoom.hidden = false;
      roomCodeEl.textContent = "手动";
    }
  };
  session.onTransportOpen = () => {
    enterRoom();
    netStatusEl.textContent = "通道已建立，正在握手…";
  };
  if (transport.state === "open") enterRoom();
  // 握手超时：避免“已连接但没反应”的死等
  clearTimeout(S.handshakeTimer);
  S.handshakeTimer = setTimeout(() => {
    if (S.net?.session !== session) return;
    if (session.phase === "handshake" || session.phase === "idle") {
      toast("握手超时：请确认对方已粘贴应答码并点击完成", true);
      netStatusEl.textContent = "握手超时，请重试或改用房间码";
    }
  }, 25000);
  session.setSnapshotProvider(() => ({
    firstSeat: S.firstSeat,
    plies: S.state.plies,
    actions: S.history.slice(1).map((h) => h.action).filter(Boolean),
    clocks: { banks: S.clocks.banks.slice(), moveLeft: S.clocks.moveLeft },
    undoLeft: S.undoLeft.slice(),
  }));
  session.start();
  netStatusEl.textContent = "已连接，正在握手…";
}

function handleNetEvent(evt) {
  switch (evt.type) {
    case "ready":
      clearTimeout(S.handshakeTimer);
      netStatusEl.textContent = "对手已就位，开始掷骰";
      return;
    case "dice":
      showOnlineDice(evt);
      return;
    case "priority":
      showOnlinePriority(evt);
      return;
    case "start":
      startOnlineGame(evt.firstSeat);
      return;
    case "remoteAction":
      advance(S.state, "对手行动", evt.action);
      return;
    case "undoReq":
      undoDesc.textContent = "对方请求悔棋，是否同意？";
      undoOverlay.hidden = false;
      return;
    case "undoRes":
      if (evt.accept) {
        toast("对方同意悔棋");
      } else {
        clearTimeout(S.undoTimer);
        toast("对方拒绝了悔棋", true);
      }
      return;
    case "undoDo":
      clearTimeout(S.undoTimer);
      rollbackOnline();
      return;
    case "snapshot":
      lastSnapshot = evt.snapshot;
      return;
    case "resuming":
      netStatusEl.textContent = "正在恢复对局…";
      return;
    case "resumed":
      onResumed();
      return;
    case "resign":
      endOnlineGame(S.mySeat);
      return;
    case "rematchReq":
      if (window.confirm("对方请求再来一局，是否同意？")) {
        S.net.session.answerRematch(true);
      } else {
        S.net.session.answerRematch(false);
      }
      return;
    case "rematchRes":
      if (!evt.accept) toast("对方拒绝了再来一局", true);
      return;
    case "rematch":
      overlay.hidden = true;
      return;
    case "offline":
      toast("对手连接断开，正在尝试重连…", true);
      tryReconnect();
      return;
    case "timeout":
      toast("对手无响应", true);
      tryReconnect();
      return;
    case "error":
      if (String(evt.code).startsWith("handshake")) {
        netStatusEl.textContent = "规则或参数不一致，请确认双方版本与设置相同";
        toast("握手失败：" + evt.code, true);
      } else {
        toast("联机错误：" + (evt.code ?? "unknown"), true);
      }
      return;
    default:
      return;
  }
}

function showOnlineDice(evt) {
  diceOverlay.hidden = false;
  diceNameEls[0].textContent = "你";
  diceNameEls[1].textContent = "对手";
  diceEls[0].textContent = String(evt.mine);
  diceEls[1].textContent = String(evt.theirs);
  diceEls[0].classList.toggle("win", evt.iWin);
  diceEls[1].classList.toggle("win", !evt.iWin);

  if (evt.iAmChooser) {
    diceDesc.textContent = "你的点数更大：选择先手，或选择执子方向";
    renderChoices([
      { label: "我要先手", priority: "first", primary: true, onClick: () => S.net.session.choosePriority("first") },
      { label: "我要选边", priority: "side", onClick: () => S.net.session.choosePriority("side") },
    ]);
  } else {
    diceDesc.textContent = "对手点数更大，等待对方选择…";
    renderChoices([]);
  }
}

function showOnlinePriority(evt) {
  const session = S.net.session;
  if (evt.sideActor === session.me) {
    diceDesc.textContent = "请选择执子方向";
    renderChoices([
      { label: "执左（A-12）", side: 0, primary: true, onClick: () => session.chooseSide(0) },
      { label: "执右（J-12）", side: 1, onClick: () => session.chooseSide(1) },
    ]);
  } else {
    diceDesc.textContent = "等待对方选择执子方向…";
    renderChoices([]);
  }
}


function rollbackOnline() {
  if (S.history.length < 2) return;
  S.history.pop();
  const snap = S.history[S.history.length - 1];
  S.state = snap.state;
  clockRestore(S.clocks, snap.clocks);
  S.preview = null;
  S.turnStartedAt = performance.now();
  S.lastTs = performance.now();
  paint();
  toast("已撤销上一手");
}

function endLocalGame(winnerSeat) {
  S.state.winner = winnerSeat;
  S.gameOver = true;
  S.aiThinking = false;
  paint();
  setTimeout(showResult, 320);
}

function endOnlineGame(winnerSeat) {
  S.state.winner = winnerSeat;
  S.gameOver = true;
  S.aiThinking = false;
  paint();
  setTimeout(showResult, 320);
}

function startOnlineGame(firstSeat) {
  diceOverlay.hidden = true;
  renderChoices([]);
  S.firstSeat = firstSeat;
  S.mySeat = S.net.session.mySeat;
  newGame();
  S.mode = "online";
  S.aiSeat = null;
  S.mySeat = S.net.session.mySeat;
  S.started = true;
  S.turnStartedAt = performance.now();
  S.lastTs = performance.now();
  netOverlay.hidden = true;
  homeOverlay.hidden = true;
  paint();
  toast(S.mySeat === firstSeat ? "你先手" : "对手先手");
}


let manualCtx = null;

function showManualPanel() {
  netMain.hidden = true;
  netJoin.hidden = true;
  netRoom.hidden = true;
  netManual.hidden = false;
  manualHost.hidden = true;
  manualGuest.hidden = true;
  manualCtx = null;
}

async function manualBecomeHost() {
  manualHost.hidden = false;
  manualGuest.hidden = true;
  manualOfferOut.value = "正在生成邀请码…";
  try {
    const offer = await createManualOffer({
      onStatus: (st) => { if (st === "gathering") manualOfferOut.value = "正在收集网络候选…"; },
    });
    manualCtx = offer;
    manualOfferOut.value = offer.code;
    manualOfferOut.select();
    copyOffer.hidden = false;
    manualHint.textContent = "把邀请码发给对方；对方发回应答码后，粘贴到下面并点「完成连接」";
    toast("把邀请码发给对方");
  } catch (e) {
    manualOfferOut.value = "生成失败：" + e.message;
  }
}

async function manualFinishHost() {
  if (!manualCtx) return toast("请先生成邀请码", true);
  const answer = manualAnswerIn.value.trim();
  if (!answer) return toast("请粘贴对方的应答码", true);
  try {
    await manualCtx.complete(answer);
    attachSession(manualCtx.transport, "host", "手动");
    manualHint.textContent = "应答码已提交，正在建立连接…";
  } catch (e) {
    toast("应答码无效：" + e.message, true);
  }
}

async function manualMakeAnswer() {
  const offer = manualOfferIn.value.trim();
  if (!offer) return toast("请先粘贴对方的邀请码", true);
  try {
    const res = await answerManualOffer(offer);
    manualCtx = res;
    manualAnswerOut.hidden = false;
    manualAnswerOut.value = res.code;
    manualAnswerOut.select();
    copyAnswer.hidden = false;
    manualHint.textContent = "把下面的应答码发回给房主，等他点「完成连接」";
    attachSession(res.transport, "guest", "手动");
    toast("把应答码发回给房主");
  } catch (e) {
    toast("邀请码无效：" + e.message, true);
  }
}


/* ---------------------------------------------------------------- 掉线与存档 */

let dropTimer = null;


let reconnectSeq = 0;

async function tryReconnect() {
  const net = S.net;
  if (!net || S.gameOver) return;
  const mySeq = ++reconnectSeq;

  openDrop("正在重连…");
  dropEnd.hidden = true;
  dropSave.hidden = true;

  const deadline = Date.now() + 90000;

  while (Date.now() < deadline && S.net === net && mySeq === reconnectSeq) {
    try {
      let tr = null;
      if (net.role === "host" && net.hostTransport?.waitForReconnect) {
        tr = await net.hostTransport.waitForReconnect(Math.min(15000, deadline - Date.now()));
      } else if (net.role === "guest") {
        tr = await reconnectPeerRoom(net.code, { timeoutMs: 8000 });
      }
      if (tr && mySeq === reconnectSeq) {
        net.session.reattach(tr);
        return;
      }
    } catch {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  if (mySeq === reconnectSeq && S.net === net) {
    openDrop("重连失败");
    dropEnd.hidden = false;
    dropSave.hidden = false;
  }
}

function onResumed() {
  if (S.net?.role === "guest" && lastSnapshot) {
    applySnapshot(lastSnapshot);
  }
  lastSnapshot = null;
  closeDrop();
  S.lastTs = performance.now();
  S.turnStartedAt = performance.now();
  toast("已重连，对局继续");
}

let lastSnapshot = null;

function applySnapshot(snap) {
  try {
    S.firstSeat = snap.firstSeat;
    S.state = createState(snap.firstSeat);
    S.clocks = createClock({ perMove: S.settings.perMove, bank: S.settings.bank });
    clockRestore(S.clocks, snap.clocks);
    S.history = [{ state: S.state, clocks: clockSnapshot(S.clocks) }];
    for (const action of snap.actions ?? []) {
      const res = applyAction(S.state, action);
      if (!res.ok) break;
      S.state = res.state;
      S.history.push({ state: S.state, clocks: clockSnapshot(S.clocks), action });
    }
    S.undoLeft = snap.undoLeft ?? S.undoLeft;
    S.mySeat = S.net.session.mySeat;
    S.mode = "online";
    S.started = true;
    paint();
  } catch (e) {
    toast("恢复局面失败：" + e.message, true);
  }
}

function openDrop(title) {
  dropOverlay.hidden = false;
  const h = dropOverlay.querySelector("h2");
  if (h && title) h.textContent = title;
  let left = 90;
  dropCount.textContent = String(left);
  clearInterval(dropTimer);
  dropTimer = setInterval(() => {
    left -= 1;
    dropCount.textContent = String(Math.max(0, left));
    if (left <= 0) clearInterval(dropTimer);
  }, 1000);
}

function closeDrop() {
  clearInterval(dropTimer);
  dropOverlay.hidden = true;
}

function openSaveDialog() {
  closeDrop();
  saveName.value = defaultSlotName();
  saveOverlay.hidden = false;
  saveName.select();
}

function buildSlot() {
  const actions = S.history.slice(1).map((h) => h.action).filter(Boolean);
  return {
    name: saveName.value.trim() || defaultSlotName(),
    roomCode: S.net?.code ?? "",
    plies: S.state.plies,
    stateHash: stateHashOf(S.state),
    config: { perMove: S.settings.perMove, bank: S.settings.bank },
    state: S.state,
    actions,
    clocks: { banks: S.clocks.banks.slice(), moveLeft: S.clocks.moveLeft },
  };
}

function stateHashOf(state) {
  let h = 0x811c9dc5;
  const mix = (n) => { h ^= n & 0xff; h = Math.imul(h, 0x01000193); };
  for (const p of state.players) { mix(p.c); mix(p.r); }
  for (const v of state.vWall) mix(v);
  for (const v of state.hWall) mix(v);
  for (const v of state.topWall) mix(v);
  mix(state.turn); mix(state.wallsPlaced);
  return (h >>> 0).toString(16).padStart(8, "0");
}

function confirmSave() {
  const res = saveSlot(buildSlot());
  if (!res.ok) {
    toast(`存档位已满（${MAX_SLOTS} 个），请先在「对局记录」里删一个`, true);
    saveOverlay.hidden = true;
    openSlots();
    return;
  }
  saveOverlay.hidden = true;
  toast("已封存，可在「对局记录」中查看或导出");
  goHome();
}

function renderSlots() {
  const slots = loadSlots();
  slotList.innerHTML = "";
  if (slots.length === 0) {
    slotList.innerHTML = `<p class="sub">还没有存档。联机时对手掉线可以选择「封存对局」。</p>`;
    return;
  }
  for (const slot of slots) {
    const row = document.createElement("div");
    row.className = "slotRow";
    row.innerHTML = `<div class="slotMeta"><b></b><span></span></div>`;
    row.querySelector("b").textContent = slot.name;
    row.querySelector("span").textContent =
      `${slot.plies} 手 · ${new Date(slot.savedAt).toLocaleString("zh-CN")} · ${slot.roomCode || "本地"}`;

    const actions = document.createElement("div");
    actions.className = "slotActions";

    const exp = document.createElement("button");
    exp.className = "btn ghost";
    exp.textContent = "导出";
    exp.addEventListener("click", () => exportSlot(slot));
    actions.appendChild(exp);

    const del = document.createElement("button");
    del.className = "btn ghost";
    del.textContent = "删除";
    del.addEventListener("click", () => {
      if (!window.confirm(`删除存档「${slot.name}」？`)) return;
      deleteSlot(slot.id);
      renderSlots();
    });
    actions.appendChild(del);

    row.appendChild(actions);
    slotList.appendChild(row);
  }
}

function exportSlot(slot) {
  const blob = new Blob([JSON.stringify(slot, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = slotFileName(slot);
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast("已导出 JSON");
}

function openSlots() {
  renderSlots();
  slotsOverlay.hidden = false;
}

function copyRoomLink() {
  const url = `${location.origin}${location.pathname}?room=${netCode}`;
  navigator.clipboard?.writeText(url).then(
    () => toast("链接已复制"),
    () => toast("复制失败，请手动复制房间码", true),
  );
}

/* ---------------------------------------------------------------- 启动 */

buildBoard();
newGame();

// 调试：?demo=1 中盘；?demo=same 同格；?demo=win / ?demo=draw 看结算
const demo = new URLSearchParams(location.search).get("demo");
if (demo) {
  S.started = true;
  homeOverlay.hidden = true;
  const st = createState(0);
  st.hWall[0 * (ROWS - 1) + 9] = 1;
  st.hWall[3 * (ROWS - 1) + 6] = 1;
  st.vWall[4 * ROWS + 4] = 1;
  st.vWall[7 * ROWS + 8] = 1;
  st.topWall[9] = 1;
  st.players[0] = { c: 3, r: 5 };
  st.players[1] = { c: 6, r: 4 };
  st.plies = 24;
  st.wallsPlaced = 5;
  st.wallsUsed = [3, 2];
  S.state = st;

  if (demo === "win") {
    st.players[0] = { c: 0, r: 0 };
    st.players[1] = { c: 9, r: 4 };
    S.preview = { action: { type: "move", dir: "up" }, valid: true, label: "越线" };
    commit();
  } else if (demo === "draw") {
    st.players[0] = { c: 0, r: 0 };
    st.players[1] = { c: 8, r: 0 };
    S.preview = { action: { type: "move", dir: "up" }, valid: true, label: "越线" };
    commit();
  } else if (demo === "same") {
    st.players[0] = { c: 4, r: 6 };
    st.players[1] = { c: 4, r: 6 };
    paint();
  } else if (demo === "exit") {
    st.players[0] = { c: 4, r: 0 };
    st.players[1] = { c: 7, r: 5 };
    st.turn = 0;
    paint();
  } else if (demo === "ghost") {
    st.players[0] = { c: 4, r: 5 };
    st.players[1] = { c: 7, r: 8 };
    st.turn = 0;
    paint();
    S.preview = { action: { type: "move", dir: "up" }, valid: true, label: "移动" };
    paint();
  } else if (demo === "ghost1") {
    st.players[0] = { c: 4, r: 5 };
    st.players[1] = { c: 7, r: 8 };
    st.turn = 1;
    paint();
    S.preview = { action: { type: "move", dir: "up" }, valid: true, label: "移动" };
    paint();
  } else if (demo === "undo") {
    S.preview = { action: { type: "move", dir: "up" }, valid: true, label: "移动" };
    commit();
    undo();
  } else {
    S.preview = {
      action: { type: "wall", kind: "h", c: 5, r: 6 },
      valid: validateAction(st, { type: "wall", kind: "h", c: 5, r: 6 }).ok,
      label: "封墙 F-7-8",
    };
    paint();
  }
}

window.__danteng = S;
window.__ui = { cellEls, slotEls, pieceEls };

if (demo === "rules") openRules();
if (demo === "settings") openSettings();
if (demo === "home") goHome();
if (demo === "dice") {
  homeOverlay.hidden = true;
  S.started = false;
  startGame("local");
}
