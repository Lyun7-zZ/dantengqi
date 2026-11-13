/**
 * 先选玩法，再加载对应的对局界面。
 * 回合制走 app.js（深搜大师），异步走 app-async.js。
 */

const play = sessionStorage.getItem("danteng.play") === "async" ? "async" : "turn";

const turnBtn = document.getElementById("modeTurn");
const asyncBtn = document.getElementById("modeAsync");
turnBtn.classList.toggle("active", play === "turn");
asyncBtn.classList.toggle("active", play === "async");

function choose(next) {
  if (next === play) return;
  sessionStorage.setItem("danteng.play", next);
  location.reload();
}
turnBtn.addEventListener("click", () => choose("turn"));
asyncBtn.addEventListener("click", () => choose("async"));

document.getElementById("rulesTurn").hidden = play !== "turn";
document.getElementById("rulesAsync").hidden = play !== "async";
document.getElementById("homeSub").textContent = play === "async"
  ? "异步 · 双方同时行动"
  : "回合制 · 轮流行动，大师会深搜";
document.getElementById("blurbHard").textContent = play === "async"
  ? "会猜你这一步怎么走"
  : "会预判你的应手";
document.getElementById("blurbMaster").textContent = play === "async"
  ? "连你可能放的墙一起算"
  : "六层搜索 + 锁路计划";

await import(play === "async" ? "./app-async.js" : "./app.js");
