/**
 * 先选玩法，再加载对应的对局界面。
 * 回合制走 app.js（深搜大师），异步走 app-async.js。
 * 规则、记录、设置两套玩法共用，切换时只改上面的玩法入口，不整页重来。
 */

const urlPlay = new URLSearchParams(location.search).get("play");
let play = urlPlay === "async" || urlPlay === "turn"
  ? urlPlay
  : (sessionStorage.getItem("danteng.play") === "async" ? "async" : "turn");

const COPY = {
  turn: {
    sub: "回合制 · 轮流行动，大师会深搜",
    local: "同屏双人",
    ai: "下一步选难度",
    net: "房间码",
    hard: "会预判你的应手",
    master: "六层搜索 + 锁路计划",
  },
  async: {
    sub: "异步 · 双方同时行动",
    local: "一起结算",
    ai: "选边对战",
    net: "房主执左",
    hard: "会猜你这一步怎么走",
    master: "连你可能放的墙一起算",
  },
};

const DETAIL = {
  turn: "轮流走。开局掷骰，决定先手或选边。墙对双方都挡。",
  async: "同时行动。没有先后手。墙只挡对方。",
  "turn:local": "同一块屏幕，两人轮流走。",
  "turn:ai": "你和电脑轮流走，下一步选难度。",
  "turn:net": "用房间码连到朋友，掷骰决定先手。",
  "async:local": "左方先定这一步，右方再定，然后一起结算。",
  "async:ai": "你选执左或执右，电脑坐另一边。",
  "async:net": "房主执左，加入的人执右，两边一起计时。",
};

const turnBtn = document.getElementById("modeTurn");
const asyncBtn = document.getElementById("modeAsync");

function applyMode(next) {
  play = next;
  const copy = COPY[next];
  document.getElementById("rulesTurn").hidden = next !== "turn";
  document.getElementById("rulesAsync").hidden = next !== "async";
  document.documentElement.dataset.play = next;
  document.getElementById("blurbHard").textContent = copy.hard;
  document.getElementById("blurbMaster").textContent = copy.master;
  const localSpan = document.querySelector("#menuLocal .pickBody span");
  if (localSpan) localSpan.textContent = copy.local;
  const aiSpan = document.querySelector("#menuAI .pickBody span");
  if (aiSpan) aiSpan.textContent = copy.ai;
  const netSpan = document.querySelector("#menuNet .pickBody span");
  if (netSpan) netSpan.textContent = copy.net;
  for (const level of ["grandmaster", "hell", "experiment"]) {
    const btn = document.querySelector(`#homeAI [data-level="${level}"]`);
    if (btn) btn.hidden = next === "async";
  }
}

function choose(next) {
  if (next === play) return;
  sessionStorage.setItem("danteng.play", next);
  const url = new URL(location.href);
  url.searchParams.set("play", next);
  history.replaceState(null, "", url.href);
  applyMode(next);
}

if (new URLSearchParams(location.search).get("play") !== play) {
  const url = new URL(location.href);
  url.searchParams.set("play", play);
  history.replaceState(null, "", url.href);
}
applyMode(play);

const homeRoot = document.getElementById("homeRoot");
const homeMain = document.getElementById("homeMain");
const homeAI = document.getElementById("homeAI");
const homeTitle = document.getElementById("homeTitle");
const homeSub = document.getElementById("homeSub");
const pickModes = document.getElementById("pickModes");
const pickDetail = document.getElementById("pickDetail");
const pickBar = document.getElementById("pickBar");
const pickBack = document.getElementById("pickBack");
const pickConfirm = document.getElementById("pickConfirm");
const homeFine = document.getElementById("homeFine");

let step = "home";
let pickedMode = play;
let pickedQueue = null;
let pickedLevel = null;

function showHome() {
  step = "home";
  pickedQueue = null;
  pickedLevel = null;
  paintPicker();
}

function paintPicker() {
  homeRoot.hidden = step !== "home";
  pickModes.hidden = step !== "mode";
  homeMain.hidden = step !== "queue";
  homeAI.hidden = step !== "level";
  pickBar.hidden = step === "home";
  pickDetail.hidden = step === "home";
  homeFine.hidden = step !== "home";
  turnBtn.classList.toggle("is-selected", pickedMode === "turn");
  asyncBtn.classList.toggle("is-selected", pickedMode === "async");
  document.getElementById("menuLocal").classList.toggle("is-selected", pickedQueue === "local");
  document.getElementById("menuAI").classList.toggle("is-selected", pickedQueue === "ai");
  document.getElementById("menuNet").classList.toggle("is-selected", pickedQueue === "net");
  for (const btn of homeAI.querySelectorAll("[data-level]")) {
    btn.classList.toggle("is-selected", pickedLevel === btn.dataset.level && !btn.hidden);
  }

  if (step === "home") {
    homeTitle.textContent = "蛋疼棋";
    homeSub.textContent = "10 × 12 棋盘 · 越过终点线者胜";
    return;
  }
  if (step === "mode") {
    homeTitle.textContent = "选择游戏模式";
    homeSub.textContent = "选中一张卡片，再点确认";
    pickDetail.textContent = DETAIL[pickedMode] || "先选回合制或异步";
    pickConfirm.disabled = !pickedMode;
    pickConfirm.textContent = "确认";
    return;
  }
  if (step === "queue") {
    homeTitle.textContent = "选择对战方式";
    homeSub.textContent = COPY[play].sub;
    pickDetail.textContent = pickedQueue ? DETAIL[`${play}:${pickedQueue}`] : "选一种开局方式";
    pickConfirm.disabled = !pickedQueue;
    pickConfirm.textContent = pickedQueue === "ai" ? "下一步" : "开始";
    return;
  }
  const levelBtn = pickedLevel ? homeAI.querySelector(`[data-level="${pickedLevel}"]`) : null;
  const levelOk = levelBtn && !levelBtn.hidden;
  homeTitle.textContent = "选择难度";
  homeSub.textContent = play === "async" ? "异步人机，没有先后手" : "回合制人机";
  pickDetail.textContent = levelOk
    ? (levelBtn.querySelector(".pickBody span")?.textContent || "")
    : "选一个难度";
  pickConfirm.disabled = !levelOk;
  pickConfirm.textContent = "开始";
}

function confirmPick() {
  if (step === "mode") {
    if (!pickedMode) return;
    choose(pickedMode);
    pickedQueue = null;
    pickedLevel = null;
    step = "queue";
    paintPicker();
    return;
  }
  if (step === "queue") {
    if (!pickedQueue) return;
    if (pickedQueue === "ai") {
      pickedLevel = null;
      step = "level";
      paintPicker();
      return;
    }
    begin(pickedQueue);
    return;
  }
  if (pickedLevel) begin(pickedLevel);
}

function backPick() {
  if (step === "level") step = "queue";
  else if (step === "queue") step = "mode";
  else step = "home";
  paintPicker();
}

/** 开局入口只在确认后进入。玩法已经对上就直接开，否则进对应模块再开。 */
function begin(action) {
  if (window.__dantengLoaded === play && typeof window.__dantengStart === "function") {
    window.__dantengStart(action);
    return;
  }
  sessionStorage.setItem("danteng.play", play);
  sessionStorage.setItem("danteng.autostart", action);
  const url = new URL(location.href);
  url.searchParams.set("play", play);
  location.assign(url.href);
}

window.__dantengHandoff = function (loaded, action) {
  if (play === loaded) return false;
  begin(action);
  return true;
};

window.__dantengShowHome = showHome;
window.__dantengShowCoreMenu = showHome;

document.getElementById("menuStart").addEventListener("click", () => {
  step = "mode";
  paintPicker();
});
turnBtn.addEventListener("click", () => { pickedMode = "turn"; paintPicker(); });
asyncBtn.addEventListener("click", () => { pickedMode = "async"; paintPicker(); });
document.getElementById("menuLocal").addEventListener("click", () => { pickedQueue = "local"; paintPicker(); });
document.getElementById("menuAI").addEventListener("click", () => { pickedQueue = "ai"; paintPicker(); });
document.getElementById("menuNet").addEventListener("click", () => { pickedQueue = "net"; paintPicker(); });
homeAI.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-level]");
  if (!btn || btn.hidden) return;
  pickedLevel = btn.dataset.level;
  paintPicker();
});
pickBack.addEventListener("click", backPick);
pickConfirm.addEventListener("click", confirmPick);

applyMode(play);
showHome();

await import(play === "async" ? "./app-async.js" : "./app.js");
