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
    ai: "简单 / 普通 / 困难 / 大师 / 宗师 / 地狱",
    net: "房间码 · 点对点直连",
    hard: "会预判你的应手",
    master: "六层搜索 + 锁路计划",
  },
  async: {
    sub: "异步 · 双方同时行动",
    ai: "简单 / 普通 / 困难 / 大师",
    net: "房间码 · 房主执左",
    hard: "会猜你这一步怎么走",
    master: "连你可能放的墙一起算",
  },
};

const turnBtn = document.getElementById("modeTurn");
const asyncBtn = document.getElementById("modeAsync");

function applyMode(next) {
  play = next;
  const copy = COPY[next];
  turnBtn.classList.toggle("active", next === "turn");
  asyncBtn.classList.toggle("active", next === "async");
  document.getElementById("rulesTurn").hidden = next !== "turn";
  document.getElementById("rulesAsync").hidden = next !== "async";
  document.getElementById("homeSub").textContent = copy.sub;
  document.getElementById("blurbHard").textContent = copy.hard;
  document.getElementById("blurbMaster").textContent = copy.master;
  const aiSpan = document.querySelector("#menuAI span");
  if (aiSpan) aiSpan.textContent = copy.ai;
  const netSpan = document.querySelector("#menuNet span");
  if (netSpan) netSpan.textContent = copy.net;
  for (const level of ["grandmaster", "hell"]) {
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

turnBtn.addEventListener("click", () => choose("turn"));
asyncBtn.addEventListener("click", () => choose("async"));

if (new URLSearchParams(location.search).get("play") !== play) {
  const url = new URL(location.href);
  url.searchParams.set("play", play);
  history.replaceState(null, "", url.href);
}
applyMode(play);

// 菜单上换了玩法之后，真正开局再进对应的那一套代码。
window.__dantengHandoff = function (loaded, action) {
  if (play === loaded) return false;
  sessionStorage.setItem("danteng.play", play);
  sessionStorage.setItem("danteng.autostart", action);
  const url = new URL(location.href);
  url.searchParams.set("play", play);
  location.assign(url.href);
  return true;
};

await import(play === "async" ? "./app-async.js" : "./app.js");
