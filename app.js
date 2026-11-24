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
import { WsClient, PROTOCOL_VERSION, RULES_VERSION } from "./src/net/ws-client.js";
import {
  loadSlots, saveSlot, deleteSlot, defaultSlotName, slotFileName, MAX_SLOTS,
} from "./src/storage.js";

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
const homeCommon = el("homeCommon");
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
const boardWrap = el("boardWrap");
const pauseBtn = el("pause");
const pauseOverlay = el("pauseOverlay");
const pauseDesc = el("pauseDesc");
const pauseMainActions = el("pauseMainActions");
const pauseAnswer = el("pauseAnswer");
const pauseResumeBtn = el("pauseResume");
const pauseSaveBtn = el("pauseSave");
const pauseExitBtn = el("pauseExit");
const pauseAcceptBtn = el("pauseAccept");
const pauseDeclineBtn = el("pauseDecline");
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
const diceOverlay = el("diceOverlay");
const diceEls = [el("dice0"), el("dice1")];
const diceNameEls = [el("diceName0"), el("diceName1")];
const diceDesc = el("diceDesc");
const diceChoices = el("diceChoices");
const startOpts = el("startOpts");
const optUntimed = el("optUntimed");
const optTimeoutAuto = el("optTimeoutAuto");
const optAutoRow = el("optAutoRow");
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
const turnBarEl = el("turnBar");
const turnBarFill = el("turnBarFill");
const resultFull = el("resultFull");
const rfLeft = el("rfLeft");
const rfRight = el("rfRight");
const rfLeftHalf = el("rfLeftHalf");
const rfRightHalf = el("rfRightHalf");
const thinkingEl = el("thinking");
const thinkingTextEl = el("thinkingText");
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
  paused: false,
  untimed: false,
  timeoutAutoMove: true,
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
    || (S.mode === "online" && (S.state.turn !== S.mySeat || !NET.client))
    || S.undoLeft[st.turn] <= 0 || S.history.length < 2;

  resignBtn.hidden = !S.started || S.gameOver;
  restartBtn.hidden = S.mode === "online";
  pauseBtn.hidden = !S.started || S.gameOver || S.paused;
  paintClocks();
}

function paintClocks() {
  if (!S.clocks || !S.state) return;
  const c = S.clocks;
  const turn = S.state.turn;
  if (S.untimed) {
    for (let p = 0; p < 2; p++) {
      const box = clockEls[p];
      clkEls[p].textContent = "∞";
      bankEls[p].textContent = "不限时";
      box.classList.toggle("active", p === turn && !S.gameOver);
      box.classList.toggle("p1", p === 1);
      box.classList.remove("warn", "inbank");
    }
    return;
  }
  for (let p = 0; p < 2; p++) {
    const box = clockEls[p];
    // 大数字：轮到自己时是真实倒计时；否则显示该玩家上一步结束时的剩余
    const main = p === turn ? displayTime(c, turn) : (c.lastLeft?.[p] ?? c.perMove);
    if (p === turn) c.lastLeft[p] = displayTime(c, turn);
    const mainSec = Math.max(0, Math.ceil(main));
    clkEls[p].textContent = String(mainSec);
    bankEls[p].textContent = `库 ${Math.ceil(c.banks[p])}`;
    box.classList.toggle("active", p === turn && !S.gameOver);
    box.classList.toggle("p1", p === 1);
    box.classList.toggle("warn", p === turn && mainSec <= 5 && !S.gameOver);
    box.classList.toggle("inbank", p === turn && c.inBank && !S.gameOver);
    box.classList.toggle("bankMode", p === turn && c.inBank && !S.gameOver);
  }

  // 顶部计时长条：正常按本步时间收缩；进入时间库后按库剩余比例，并变红描边
  const inBank = !S.gameOver && c.inBank;
  const remain = displayTime(c, turn);
  const ratio = S.gameOver
    ? 1
    : inBank
      ? Math.min(1, Math.max(0, c.banks[turn] / Math.max(1, c.bank)))
      : Math.min(1, Math.max(0, remain / Math.max(1, c.perMove)));
  turnBarFill.style.width = `${(ratio * 100).toFixed(1)}%`;
  turnBarEl.classList.toggle("p1", turn === 1);
  turnBarEl.classList.toggle("bank", inBank);
  turnBarEl.classList.toggle("warn", !S.gameOver && !inBank && remain <= 5);

  // 对方正在行动 / 电脑正在思考
  let hint = "";
  if (S.started && !S.gameOver && S.state) {
    if (S.mode === "online") {
      if (S.state.turn !== S.mySeat) hint = "对方正在操作…";
    } else if (S.aiSeat !== null && S.state.turn === S.aiSeat) {
      const secs = S.aiThinking && S.aiThinkStart
        ? Math.floor((performance.now() - S.aiThinkStart) / 1000)
        : 0;
      hint = secs > 0 ? `电脑正在思考… ${secs}s` : "电脑正在思考…";
    }
  }
  thinkingEl.hidden = hint === "";
  if (hint) thinkingTextEl.textContent = hint;
}


/* ---------------------------------------------------------------- AI 线程 */

const WORKER_LEVELS = new Set(["hard", "master", "grandmaster", "hell"]);
let aiWorker = null; // null=未初始化，false=不可用
let aiSeq = 0;
const aiPending = new Map();

function ensureAIWorker() {
  if (aiWorker !== null) return aiWorker || null;
  try {
    const src = globalThis.__DANTENG_WORKER_SRC__;
    if (src) {
      const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
      aiWorker = new Worker(url);
    } else {
      aiWorker = new Worker("src/ai-worker.js", { type: "module" });
    }
    aiWorker.onmessage = (e) => {
      const d = e.data || {};
      const resolve = aiPending.get(d.id);
      if (!resolve) return;
      aiPending.delete(d.id);
      resolve(d.ok ? d.action : null);
    };
    aiWorker.onerror = () => { aiWorker = false; };
  } catch {
    aiWorker = false;
  }
  return aiWorker || null;
}

/** 让 AI 在后台线程思考；没有 Worker 时退回同步计算。 */
function aiThink(level, state) {
  if (!WORKER_LEVELS.has(level)) return Promise.resolve(AI[level](state, Math.random));
  const w = ensureAIWorker();
  if (!w) return Promise.resolve(AI[level](state, Math.random));
  return new Promise((resolve) => {
    const id = ++aiSeq;
    aiPending.set(id, resolve);
    // 地狱档尽量用满每步时限，但至少给超时代走留出 2 秒
    const timeMs = level === "hell"
      ? Math.min(28000, Math.max(2000, (S.settings.perMove - 2) * 1000))
      : undefined;
    w.postMessage({ id, level, state, timeMs });
  });
}

function resetAIWorker() {
  if (aiWorker) aiWorker.postMessage({ type: "reset" });
}

/* ---------------------------------------------------------------- 交互 */

/** 进入暂停：封盘、遮罩、冻结计时。 */
function beginPause() {
  S.paused = true;
  S.aiThinking = false;
  S.preview = null;
  boardWrap.hidden = true;
  pauseOverlay.hidden = false;
  pauseMainActions.hidden = false;
  pauseAnswer.hidden = true;
  pauseDesc.textContent = "棋盘已封存，双方都看不到；暂停时长不限。";
  paint();
}

/** 结束暂停：重新显示棋盘。 */
function endPause() {
  S.paused = false;
  boardWrap.hidden = false;
  pauseOverlay.hidden = true;
  pauseAnswer.hidden = true;
  pauseMainActions.hidden = false;
  S.lastTs = performance.now();
  paint();
}

/** 暂停页「暂存对局」：写入本地存档。 */
function savePausedGame() {
  if (!S.state) return;
  const res = saveSlot({
    ...buildSlot(),
    name: defaultSlotName(),
  });
  if (!res.ok) {
    toast(`存档位已满（${MAX_SLOTS} 个），请先在「对局记录」里删一个`, true);
    return;
  }
  toast("已暂存，可从「对局记录」继续");
}

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
    if (!NET.client || !NET.client.isOpen) {
      toast("与服务器断开，正在重连…", true);
      return;
    }
    if (S.state.turn !== S.mySeat) {
      toast("还没轮到你", true);
      return;
    }
    // 交给服务器校验；本地等 event 回来再落子
    NET.client.send({ t: "action", ply: S.state.plies, action: pendingAction });
    S.preview = null;
    statusEl.textContent = "等待服务器确认…";
    paint();
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
  if (S.aiSeat === null || S.gameOver || S.paused || !S.started) return;
  if (S.state.turn !== S.aiSeat || S.aiThinking) return;

  S.aiThinking = true;
  S.aiThinkStart = performance.now();
  paint();
  const plies = S.state.plies;

  setTimeout(async () => {
    if (S.gameOver || !S.started || S.state.turn !== S.aiSeat || S.state.plies !== plies) {
      S.aiThinking = false;
      paint();
      return;
    }
    const before = S.state;
    const viaWorker = WORKER_LEVELS.has(S.mode) && !!ensureAIWorker();
    const thinkStart = performance.now();
    const action = await aiThink(S.mode, before);
    // 等待期间局面可能已变（悔棋 / 重开 / 认输）
    if (S.gameOver || !S.started || S.state !== before || S.state.plies !== plies) {
      S.aiThinking = false;
      paint();
      return;
    }
    // 没有 Worker 时是同步计算，需要手动补扣它思考期间的时间
    if (!viaWorker) {
      const spent = (performance.now() - thinkStart) / 1000;
      if (spent > 0) {
        tickClock(S.clocks, S.aiSeat, spent);
        S.clocks.lastLeft[S.aiSeat] = displayTime(S.clocks, S.aiSeat);
      }
    }
    const res = action ? applyAction(before, action) : { ok: false };
    S.aiThinking = false;
    S.aiThinkStart = 0;
    if (!res.ok) {
      paint();
      return;
    }
    advance(res.state, actionLabel(res.action ?? action, before));
  }, S.mode === "master" || S.mode === "grandmaster" || S.mode === "hell" ? 280 : GAME_CONFIG.aiDelay);
}

/** 超时：按开局选项决定由系统代走，或直接判负。 */
function onTimeout() {
  if (S.gameOver || !S.state || S.untimed) return;
  S.preview = null;
  if (S.timeoutAutoMove) {
    const mv = autoMove(S.state);
    if (!mv) return;
    const res = applyAction(S.state, mv);
    if (!res.ok) return;
    toast("超时，系统代走");
    advance(res.state, "超时代走");
    return;
  }
  S.endReason = "timeout";
  if (S.mode === "online" && S.net) {
    // 超时方是本地玩家；先通知对手，再在本地结算为败。
    S.net.session.resign();
    endOnlineGame(1 - S.mySeat);
    return;
  }
  endLocalGame(1 - S.state.turn);
  toast("超时判负", true);
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
    if (!NET.client) { toast("与服务器断开", true); return; }
    NET.client.send({ t: "undo", op: "request" });
    toast("已请求悔棋，等待对方同意");
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
  const localSplit = S.mode === "local" && st.winner !== "draw";
  if (localSplit) {
    const leftWon = st.winner === 0;
    rfLeft.textContent = leftWon ? "你赢了" : "你输了";
    rfRight.textContent = leftWon ? "你输了" : "你赢了";
    rfLeftHalf.classList.toggle("win", leftWon);
    rfLeftHalf.classList.toggle("lose", !leftWon);
    rfRightHalf.classList.toggle("win", !leftWon);
    rfRightHalf.classList.toggle("lose", leftWon);
    resultFull.hidden = false;
    overlay.hidden = true;
  } else {
    resultFull.hidden = true;
  }
  if (st.winner === "draw") {
    panelIcon.textContent = "🤝";
    panelTitle.textContent = "平局";
    panelDesc.textContent = "先手越线时，后手下一手同样可以越线，按规则判和。";
  } else {
    panelIcon.textContent = "🏁";
    if (S.mode === "online") {
      panelTitle.textContent = st.winner === S.mySeat ? "你赢了" : "你输了";
    } else if (S.aiSeat !== null) {
      panelTitle.textContent = st.winner === 1 - S.aiSeat ? "你赢了" : "你输了";
    } else {
      panelTitle.textContent = st.winner === 0 ? "左方获胜" : "右方获胜";
    }
    const loser = 1 - st.winner;
    if (S.endReason === "timeout") {
      panelDesc.textContent = `超时判负。共 ${st.plies} 手，封墙 ${st.wallsPlaced} 面。`;
    } else if (S.endReason === "resign") {
      panelDesc.textContent = `认输结束。共 ${st.plies} 手，封墙 ${st.wallsPlaced} 面。`;
    } else {
      panelDesc.textContent = `对手距终点还剩 ${distanceOf(st, loser)} 步。共 ${st.plies} 手，封墙 ${st.wallsPlaced} 面。`;
    }
  }
  if (!localSplit) overlay.hidden = false;
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

/** 重新开始 / 再来一局：不再掷骰，固定“先手执左”，人机时电脑执右。 */
function resetSeatsForNewGame() {
  S.firstSeat = 0;
  if (S.mode !== "local" && S.mode !== "online") S.aiSeat = 1;
}

function newGame(announce = false) {
  for (const k of Object.keys(AI)) AI[k]?.reset?.();
  resetAIWorker();
  S.state = createState(S.firstSeat);
  S.clocks = createClock({ perMove: S.settings.perMove, bank: S.settings.bank });
  S.history = [{ state: S.state, clocks: clockSnapshot(S.clocks) }];
  S.undoLeft = [S.settings.undoLimit, S.settings.undoLimit];
  S.preview = null;
  S.gameOver = false;
  S.aiThinking = false;
  S.paused = false;
  S.endReason = null;
  S.pendingUndo = null;
  S.undoOverlayOpen = false;
  S.lastTs = performance.now();
  overlay.hidden = true;
  undoOverlay.hidden = true;
  resultFull.hidden = true;
  paint();
  if (announce) toast("已重新开始");
}

/** 不限时与超时代走的联动。 */
function syncStartOptionUI() {
  const untimed = !!optUntimed.checked;
  optTimeoutAuto.disabled = untimed;
  optAutoRow.classList.toggle("disabled", untimed);
}

/** 从主菜单开局。 */
function startGame(mode) {
  if (window.__dantengHandoff?.("turn", mode)) return;
  resultFull.hidden = true;
  overlay.hidden = true;
  undoOverlay.hidden = true;
  S.pendingMode = mode;
  S.mode = mode;
  S.aiPerson = mode === "local" ? null : 1;

  // 每局开始默认：限时、超时代走开启；联机不提供本局选项。
  S.untimed = false;
  S.timeoutAutoMove = true;
  optUntimed.checked = false;
  optTimeoutAuto.checked = true;
  optUntimed.disabled = false;
  optUntimed.closest("label")?.classList.remove("disabled");
  optAutoRow.classList.remove("disabled");
  syncStartOptionUI();
  startOpts.hidden = mode === "online";

  if (NO_DICE) {
    finishDice(0, 0, 0);
    return;
  }

  // 先让玩家确认“不限时/超时代走”，再开始掷骰；否则电脑会自动选边，
  // 选项还没看清就开局了。
  diceOverlay.hidden = false;
  diceDesc.textContent = "选择开局选项，然后开始掷骰";
  renderChoices([{ label: "开始掷骰", primary: true, onClick: beginDice }]);
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

function beginDice() {
  if (diceOverlay.hidden) return;
  optUntimed.disabled = true;
  optTimeoutAuto.disabled = true;
  optUntimed.closest("label")?.classList.add("disabled");
  optAutoRow.classList.add("disabled");
  renderChoices([]);
  rollDice();
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
  if (S.mode !== "online") {
    S.untimed = !!optUntimed.checked;
    S.timeoutAutoMove = !!optTimeoutAuto.checked;
  }
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
  pauseOverlay.hidden = true;
  boardWrap.hidden = false;
  S.paused = false;
  rulesOverlay.hidden = true;
  settingsOverlay.hidden = true;
  diceOverlay.hidden = true;
  homeOverlay.hidden = false;
  homeMain.hidden = false;
  homeAI.hidden = true;
  homeCommon.hidden = false;
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

optUntimed.addEventListener("change", syncStartOptionUI);
confirmBtn.addEventListener("click", commit);
cancelBtn.addEventListener("click", clearPreview);
undoBtn.addEventListener("click", undo);
undoYes.addEventListener("click", () => {
  if (S.mode === "online") {
    undoOverlay.hidden = true;
    const op = S.prompt === "rematch" ? "rematch" : S.prompt === "pause" ? "pause" : "undo";
    NET.client?.send({ t: op, op: "accept" });
    S.prompt = null;
    return;
  }
  finishUndo(true);
});
undoNo.addEventListener("click", () => {
  if (S.mode === "online") {
    undoOverlay.hidden = true;
    const op = S.prompt === "rematch" ? "rematch" : S.prompt === "pause" ? "pause" : "undo";
    NET.client?.send({ t: op, op: "decline" });
    S.prompt = null;
    return;
  }
  finishUndo(false);
});

el("menuLocal").addEventListener("click", () => startGame("local"));
el("menuAI").addEventListener("click", () => {
  homeMain.hidden = true;
  homeAI.hidden = false;
  homeCommon.hidden = true;
});
el("aiBack").addEventListener("click", () => {
  homeAI.hidden = true;
  homeMain.hidden = false;
  homeCommon.hidden = false;
});
homeAI.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-level]");
  if (btn) startGame(btn.dataset.level);
});
el("menuNet").addEventListener("click", () => {
  if (window.__dantengHandoff?.("turn", "net")) return;
  homeOverlay.hidden = true;
  openNet();
});
el("netBack").addEventListener("click", () => { netOverlay.hidden = true; homeOverlay.hidden = false; });
el("netCreate").addEventListener("click", createRoom);
el("netJoinBtn").addEventListener("click", () => { netMain.hidden = true; netJoin.hidden = false; roomInput.focus(); });
el("joinGo").addEventListener("click", joinRoom);
el("joinBack").addEventListener("click", () => { netJoin.hidden = true; netMain.hidden = false; });
el("cancelRoom").addEventListener("click", () => { stopNet(); netOverlay.hidden = true; goHome(); });
el("copyRoom").addEventListener("click", copyRoomLink);
el("menuRules").addEventListener("click", openRules);
el("menuSlots").addEventListener("click", openSlots);
el("slotsClose").addEventListener("click", () => { slotsOverlay.hidden = true; });
el("saveCancel").addEventListener("click", () => { saveOverlay.hidden = true; });
el("saveConfirm").addEventListener("click", confirmSave);
el("dropSave").addEventListener("click", openSaveDialog);
el("dropEnd").addEventListener("click", () => { closeDrop(); endOnlineGame({ winner: S.mySeat }); });
el("menuSettings").addEventListener("click", openSettings);
rulesBtn.addEventListener("click", openRules);
el("homeBtn").addEventListener("click", () => {
  if (S.mode === "online" && S.started && !S.gameOver) {
    if (!window.confirm("联机对局中离开将判负，确定？")) return;
    NET.client?.send({ t: "resign" });
    setTimeout(() => { stopNet(); goHome(); }, 300);
    return;
  }
  if (S.state && S.state.plies > 0 && !S.gameOver && !window.confirm("返回主菜单将放弃当前对局，确定？")) return;
  goHome();
});
rulesClose.addEventListener("click", () => { rulesOverlay.hidden = true; });
settingsSave.addEventListener("click", saveSettings);
settingsCancel.addEventListener("click", () => { settingsOverlay.hidden = true; });
toHomeBtn.addEventListener("click", goHome);

restartBtn.addEventListener("click", () => {
  if (S.state && S.state.plies > 0 && !window.confirm("当前对局还没结束，确定重新开始？")) return;
  startGame(S.mode);
});
pauseBtn.addEventListener("click", () => {
  if (!S.started || S.gameOver || S.paused) return;
  if (S.mode === "online") {
    NET.client?.send({ t: "pause", op: "request" });
    toast("已请求暂停，等待对方同意");
    return;
  }
  beginPause();
});

pauseResumeBtn.addEventListener("click", () => {
  if (S.mode === "online") {
    NET.client?.send({ t: "pause", op: "resume" });
    pauseDesc.textContent = "已请求继续，等待对方同意…";
    return;
  }
  endPause();
});

pauseSaveBtn.addEventListener("click", savePausedGame);

pauseExitBtn.addEventListener("click", () => {
  if (!window.confirm("退出后本局结束，确定？")) return;
  if (S.mode === "online") {
    NET.client?.send({ t: "resign" });
    setTimeout(() => { stopNet(); goHome(); }, 300);
    return;
  }
  goHome();
});

pauseAcceptBtn.addEventListener("click", () => {
  NET.client?.send({ t: "pause", op: "resume-accept" });
  pauseAnswer.hidden = true;
});

pauseDeclineBtn.addEventListener("click", () => {
  NET.client?.send({ t: "pause", op: "resume-decline" });
  pauseAnswer.hidden = true;
  pauseMainActions.hidden = false;
  pauseDesc.textContent = "已拒绝对方继续，对局保持暂停。";
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

  if (S.mode === "online") {
    if (NET.client) NET.client.send({ t: "resign" });
    return;
  }

  // 人机：认输的是人类；本地：认输的是当前行棋方
  const loser = S.aiSeat !== null ? 1 - S.aiSeat : S.state.turn;
  endLocalGame(1 - loser);
});

el("rfAgain").addEventListener("click", () => againBtn.click());
el("rfHome").addEventListener("click", () => { resultFull.hidden = true; goHome(); });

againBtn.addEventListener("click", () => {
  if (S.mode === "online") {
    if (NET.client) NET.client.send({ t: "rematch", op: "request" });
    toast("已请求再来一局，等待对方同意");
    return;
  }
  startGame(S.mode);
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
  if (!S.state || !S.clocks || !S.started || S.gameOver || S.paused || overlaysOpen() || document.hidden) return;
  if (S.untimed) return;
  if (S.mode === "online" && (S.state.turn !== S.mySeat || !S.net)) return;
  if (dt <= 0) return;
  const r = tickClock(S.clocks, S.state.turn, Math.min(dt, 0.5));
  paintClocks();
  if (r.timedOut) onTimeout();
}, 100);


/* ---------------------------------------------------------------- 联机（服务器） */

// 用 sessionStorage：同一浏览器的多个标签页各自保存令牌，互不覆盖
const RECONNECT_KEY = "danteng.reconnect.v2";

const NET = {
  client: null,
  room: null,
  seat: null,     // 连接座位 0/1
  token: null,
  side: null,     // 棋盘边 0=左 1=右
  reconnecting: false,
};

function wsEndpoint() {
  const q = new URLSearchParams(location.search).get("server");
  if (q) return q;
  if (!location.host) return "ws://127.0.0.1:6657/ws";
  return (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws";
}

function loadReconnect() {
  try { return JSON.parse(sessionStorage.getItem(RECONNECT_KEY) || "null"); } catch { return null; }
}
function saveReconnect(v) {
  try { sessionStorage.setItem(RECONNECT_KEY, JSON.stringify(v)); } catch { /* ignore */ }
}
function clearReconnect() {
  try { sessionStorage.removeItem(RECONNECT_KEY); } catch { /* ignore */ }
}

function setNetStatus(text) {
  netStatusEl.textContent = text;
}

/** 建立连接并完成握手；带 token 时尝试恢复房间。 */
async function ensureSocket() {
  if (NET.client && NET.client.isOpen) return NET.client;
  const saved = loadReconnect();
  const client = new WsClient({
    url: wsEndpoint(),
    onMessage: handleServerMessage,
    onOpen: () => {
      client.send({
        t: "hello",
        version: PROTOCOL_VERSION,
        rules: RULES_VERSION,
        ...(saved ? { room: saved.room, token: saved.token } : {}),
      });
    },
    onClose: () => {
      if (!NET.room) return;
      if (NET.reconnecting) return;
      NET.reconnecting = true;
      setNetStatus("连接断开，正在重连…");
      setTimeout(async () => {
        NET.reconnecting = false;
        try { await ensureSocket(); } catch { setNetStatus("重连失败，请重新创建房间"); }
      }, 1200);
    },
  });
  NET.client = client;
  await client.connect();
  return client;
}

function openNet() {
  netOverlay.hidden = false;
  netMain.hidden = false;
  netJoin.hidden = true;
  netRoom.hidden = true;
  roomInput.value = "";
}

function stopNet() {
  if (NET.client) {
    try { NET.client.close(); } catch { /* ignore */ }
  }
  NET.client = null;
  NET.room = null;
  NET.seat = null;
  NET.token = null;
  NET.side = null;
  NET.reconnecting = false;
  clearReconnect();
  S.net = null;
  S.mySeat = null;
  if (S.mode === "online") S.mode = "local";
}

async function createRoom() {
  netMain.hidden = true;
  netJoin.hidden = true;
  netRoom.hidden = false;
  roomCodeEl.textContent = "------";
  setNetStatus("正在连接服务器…");
  try {
    const c = await ensureSocket();
    c.send({ t: "create" });
  } catch (e) {
    setNetStatus("连不上服务器：" + e.message);
    toast("连不上服务器", true);
  }
}

async function joinRoom() {
  const code = String(roomInput.value || "").trim().toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 6);
  if (code.length !== 6) {
    toast("房间码是 6 位", true);
    return;
  }
  netMain.hidden = true;
  netJoin.hidden = true;
  netRoom.hidden = false;
  roomCodeEl.textContent = code;
  setNetStatus("正在连接服务器…");
  try {
    const c = await ensureSocket();
    c.send({ t: "join", room: code });
  } catch (e) {
    setNetStatus("连不上服务器：" + e.message);
    toast("连不上服务器", true);
  }
}

/** 服务器消息分发。 */
function handleServerMessage(msg) {
  switch (msg.t) {
    case "welcome": {
      if (!msg.room) { setNetStatus("已连接服务器"); return; }
      NET.room = msg.room;
      NET.seat = msg.seat;
      NET.token = msg.token;
      saveReconnect({ room: msg.room, token: msg.token });
      roomCodeEl.textContent = msg.room;
      netMain.hidden = true;
      netJoin.hidden = true;
      netRoom.hidden = false;
      setNetStatus(msg.resumed ? "已恢复对局" : "等待对手加入…");
      return;
    }
    case "room": {
      if (msg.phase === "closed") {
        toast("房主已离开，房间关闭", true);
        netOverlay.hidden = true;
        stopNet();
        goHome();
        return;
      }
      if (msg.phase === "waiting") setNetStatus("等待对手加入…");
      if (msg.phase === "ready") setNetStatus("对手已就位，准备掷骰");
      if (msg.phase === "paused") toast("对方掉线，等待重连（90 秒）", true);
      if (msg.phase === "resumed") toast("对方已重连");
      return;
    }
    case "dice":
      showServerDice(msg);
      return;
    case "state":
      startOnlineGame(msg, { silent: true });
      return;
    case "event":
      applyServerEvent(msg);
      return;
    case "clock":
      if (S.clocks) {
        clockRestore(S.clocks, {
          banks: msg.banks, moveLeft: msg.moveLeft, inBank: msg.inBank,
        });
        paintClocks();
      }
      return;
    case "undo": {
      if (msg.op === "request") {
        S.prompt = "undo";
        undoDesc.textContent = "对方请求悔棋，是否同意？";
        undoOverlay.hidden = false;
      } else if (msg.op === "done") {
        toast("悔棋完成");
      } else if (msg.op === "declined") {
        toast("对方拒绝了悔棋", true);
      } else if (msg.op === "expired") {
        toast("悔棋请求已超时", true);
      }
      return;
    }
    case "rematch": {
      if (msg.op === "request") {
        S.prompt = "rematch";
        undoDesc.textContent = "对方请求再来一局，是否同意？";
        undoOverlay.hidden = false;
      } else if (msg.op === "accepted") {
        toast("对方同意再来一局");
      } else if (msg.op === "declined") {
        toast("对方拒绝了再来一局", true);
      }
      return;
    }
    case "pause": {
      if (msg.op === "request") {
        S.prompt = "pause";
        undoDesc.textContent = "对方请求暂停，是否同意？";
        undoOverlay.hidden = false;
      } else if (msg.op === "paused") {
        beginPause();
      } else if (msg.op === "declined") {
        toast("对方拒绝了暂停", true);
      } else if (msg.op === "resume-request") {
        if (msg.seat === NET.seat) {
          pauseDesc.textContent = "已请求继续，等待对方同意…";
        } else {
          pauseAnswer.hidden = false;
          pauseMainActions.hidden = true;
          pauseDesc.textContent = "对方请求继续对局，是否同意？";
        }
      } else if (msg.op === "resumed") {
        endPause();
        toast("对局继续");
      } else if (msg.op === "resume-declined") {
        pauseDesc.textContent = "对方拒绝了继续，对局保持暂停。";
        pauseMainActions.hidden = false;
      }
      return;
    }
    case "result":
      endOnlineGame(msg);
      return;
    case "error":
      toast("服务器：" + msg.code + (msg.message ? " " + msg.message : ""), true);
      return;
    default:
      return;
  }
}

function showServerDice(msg) {
  diceOverlay.hidden = false;
  homeOverlay.hidden = true;

  // 点数与归属：pts 按连接座位排列（0 / 1），对到「你 / 对方」
  if (Array.isArray(msg.pts)) {
    const iAmZero = NET.seat === 0;
    diceNameEls[0].textContent = iAmZero ? "你" : "对方";
    diceNameEls[1].textContent = iAmZero ? "对方" : "你";
    diceEls[0].textContent = String(msg.pts[0]);
    diceEls[1].textContent = String(msg.pts[1]);
    diceEls[msg.chooser].classList.add("win");
    diceEls[1 - msg.chooser].classList.remove("win");
    const minePts = iAmZero ? msg.pts[0] : msg.pts[1];
    const oppPts = iAmZero ? msg.pts[1] : msg.pts[0];
    S.diceChooser = msg.chooser;
    if (msg.stage === "priority") {
      diceDesc.textContent = msg.chooser === NET.seat
        ? `你 ${minePts} 点，对方 ${oppPts} 点 —— 你先选`
        : `你 ${minePts} 点，对方 ${oppPts} 点 —— 对方先选`;
    }
  }

  if (msg.stage === "priority") {
    diceSub.textContent = "点数大者二选一：先手或选边，另一项归对方";
    const mine = msg.chooser === NET.seat;
    renderChoices(mine
      ? [
        { label: "我要先手", primary: true, priority: "first", onClick: () => NET.client.send({ t: "choice", priority: "first" }) },
        { label: "我要选边", priority: "side", onClick: () => NET.client.send({ t: "choice", priority: "side", side: 0 }) },
      ]
      : []);
    if (!mine) diceSub.textContent = "对方正在选择先手或选边…";
    return;
  }
  if (msg.stage === "side") {
    const mine = msg.picker === NET.seat;
    diceSub.textContent = mine ? "请选择你执哪一边" : "对方正在选择执边…";
    renderChoices(mine
      ? [
        { label: "执左（A-12）", primary: true, side: 0, onClick: () => NET.client.send({ t: "choice", side: 0 }) },
        { label: "执右（J-12）", side: 1, onClick: () => NET.client.send({ t: "choice", side: 1 }) },
      ]
      : []);
  }
}

function startOnlineGame(snap, opts = {}) {
  S.mode = "online";
  S.started = true;
  S.gameOver = false;
  S.aiThinking = false;
  S.aiSeat = null;
  S.state = snap.state;
  S.clocks = createClock({ perMove: snap.clocks.perMove, bank: snap.clocks.bank });
  clockRestore(S.clocks, {
    banks: snap.clocks.banks, moveLeft: snap.clocks.moveLeft, inBank: snap.clocks.inBank,
  });
  NET.side = snap.sides[NET.seat];
  S.mySeat = NET.side;
  S.history = [{ state: S.state, clocks: clockSnapshot(S.clocks) }];
  S.undoLeft = [S.settings.undoLimit, S.settings.undoLimit];
  S.preview = null;
  S.lastTs = performance.now();
  diceOverlay.hidden = true;
  netOverlay.hidden = true;
  homeOverlay.hidden = true;
  overlay.hidden = true;
  resultFull.hidden = true;
  paint();
  if (!opts.silent) toast(NET.seat === snap.firstSeat ? "你先手" : "对方先手");
}

function applyServerEvent(msg) {
  if (!S.state) return;
  if (msg.ply !== S.state.plies + 1) {
    toast("与服务器手数不一致，请刷新", true);
    return;
  }
  const res = applyAction(S.state, msg.action);
  if (!res.ok) {
    toast("局面不同步：" + res.error, true);
    return;
  }
  S.state = res.state;
  S.history.push({
    state: S.state, clocks: clockSnapshot(S.clocks), by: msg.by, label: msg.reason === "timeout" ? "超时代走" : "行动", action: msg.action,
  });
  if (msg.reason === "timeout") toast("对方（或你）超时，系统已代走");
  paint();
}

/** 本地 / 人机：直接判胜负。 */
function endLocalGame(winnerSeat) {
  S.state.winner = winnerSeat;
  S.gameOver = true;
  S.aiThinking = false;
  paint();
  setTimeout(showResult, 320);
}

function endOnlineGame(msg) {
  S.state = { ...S.state, winner: msg.winner };
  S.gameOver = true;
  paint();
  setTimeout(showResult, 200);
}

function copyRoomLink() {
  const code = NET.room || "";
  navigator.clipboard?.writeText(code).then(
    () => toast("房间码已复制"),
    () => toast("复制失败，请手动输入", true),
  );
}

let dropTimer = null;

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
    roomCode: NET.room ?? "",
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

    const resume = document.createElement("button");
    resume.className = "btn primary";
    resume.textContent = "继续";
    resume.addEventListener("click", () => resumeSlot(slot));
    actions.appendChild(resume);

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

/** 从存档继续对局（同屏双人恢复）。 */
function resumeSlot(slot) {
  if (!slot || !slot.state) { toast("这个存档没有可用局面", true); return; }
  stopNet();
  S.mode = "local";
  S.aiSeat = null;
  S.started = true;
  S.gameOver = false;
  S.paused = false;
  S.state = slot.state;
  const cfg = slot.config || {};
  S.clocks = createClock({
    perMove: cfg.perMove != null ? cfg.perMove : S.settings.perMove,
    bank: cfg.bank != null ? cfg.bank : S.settings.bank,
  });
  if (slot.clocks) {
    clockRestore(S.clocks, {
      banks: slot.clocks.banks || S.clocks.banks,
      moveLeft: slot.clocks.moveLeft != null ? slot.clocks.moveLeft : S.clocks.perMove,
      inBank: slot.clocks.inBank || false,
    });
  }
  S.history = [{ state: S.state, clocks: clockSnapshot(S.clocks) }];
  S.undoLeft = [S.settings.undoLimit, S.settings.undoLimit];
  S.preview = null;
  S.lastTs = performance.now();
  slotsOverlay.hidden = true;
  homeOverlay.hidden = true;
  overlay.hidden = true;
  pauseOverlay.hidden = true;
  boardWrap.hidden = false;
  paint();
  toast("已从存档继续");
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
window.__ui = { cellEls, slotEls, pieceEls, showResult };

if (demo === "rules") openRules();
if (demo === "settings") openSettings();
if (demo === "home") goHome();
if (demo === "dice") {
  homeOverlay.hidden = true;
  S.started = false;
  startGame("local");
}

const pendingStart = sessionStorage.getItem("danteng.autostart");
if (pendingStart && !demo) {
  sessionStorage.removeItem("danteng.autostart");
  if (pendingStart === "net") {
    homeOverlay.hidden = true;
    openNet();
  } else {
    startGame(pendingStart);
  }
}
