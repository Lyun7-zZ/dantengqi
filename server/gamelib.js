/**
 * GL4 中央棋谱库：自愿上传、服务端重放校验、去重、匿名删除、管理导出。
 * 仅使用本地 JSON 文件，不依赖数据库；原始数据不进入 Git。
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { createState, applyAction, normalizeState } from "../src/rules.js";

const MAX_BODY = 512 * 1024;
const MAX_ACTIONS = 600;
const RATE_WINDOW = 60_000;
const RATE_MAX = 30;

function hash(s) { return createHash("sha256").update(s).digest("hex"); }
function tokenHash(t) { return hash("gl-del:" + t); }
function canonical(obj) {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return "[" + obj.map(canonical).join(",") + "]";
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonical(obj[k])).join(",") + "}";
}

function readJson(p, fallback) {
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return fallback; }
}

export function createGameLibrary({ dataDir, adminToken = process.env.GL_ADMIN_TOKEN || "", log = () => {} } = {}) {
  mkdirSync(dataDir, { recursive: true });
  const gamesFile = join(dataDir, "games.jsonl");
  const posFile = join(dataDir, "positions.jsonl");
  const rate = new Map();

  function loadLines(file) {
    if (!existsSync(file)) return [];
    return readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  }
  function append(file, obj) {
    writeFileSync(file, JSON.stringify(obj) + "\n", { flag: "a" });
  }
  function writeLines(file, arr) {
    const tmp = file + ".tmp";
    writeFileSync(tmp, arr.map((x) => JSON.stringify(x)).join("\n") + (arr.length ? "\n" : ""));
    renameSync(tmp, file);
  }
  function readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on("data", (c) => {
        size += c.length;
        if (size > MAX_BODY) { reject(new Error("too-large")); req.destroy(); return; }
        chunks.push(c);
      });
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      req.on("error", reject);
    });
  }
  function json(res, code, obj) {
    res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(obj));
  }
  function allow(ip) {
    const now = Date.now();
    const e = rate.get(ip) || { start: now, n: 0 };
    if (now - e.start > RATE_WINDOW) { e.start = now; e.n = 0; }
    e.n++;
    rate.set(ip, e);
    return e.n <= RATE_MAX;
  }

  function validateGame(rec) {
    if (!rec || rec.kind !== "game" || rec.schemaVersion !== 2) return "bad-record";
    if (!Array.isArray(rec.actions) || rec.actions.length > MAX_ACTIONS) return "too-many-actions";
    if (!rec.result || typeof rec.result !== "object") return "missing-result";
    const reasons = new Set(["normal_terminal", "resign", "timeout", "disconnect", "ply_cap", "manual_stop", "unfinished"]);
    if (!reasons.has(rec.result.endReason)) return "bad-end-reason";
    if (rec.result.winner !== null && rec.result.winner !== 0 && rec.result.winner !== 1 && rec.result.winner !== "draw") return "bad-winner";
    let s;
    try { s = normalizeState(JSON.parse(JSON.stringify(rec.initialState))); } catch { return "bad-initial-state"; }
    if (!s || !Array.isArray(s.players) || s.winner !== null) return "bad-initial-state";
    for (let i = 0; i < rec.actions.length; i++) {
      const step = rec.actions[i];
      if (!step || step.ply !== i + 1) return `bad-ply@${i + 1}`;
      if (step.by !== s.turn) return `bad-acting-side@${step.ply}`;
      const r = applyAction(s, step.action);
      if (!r.ok) return `illegal-action@${step.ply}`;
      s = r.state;
    }
    if (rec.result.winner !== s.winner) return "result-mismatch";
    if (rec.result.plies !== undefined && rec.result.plies !== s.plies) return "plies-mismatch";
    if (rec.result.endReason === "normal_terminal" && s.winner === null) return "unfinished-terminal";
    return null;
  }
  function validatePosition(rec) {
    if (!rec || rec.kind !== "position" || rec.schemaVersion !== 2) return "bad-record";
    try {
      const s = normalizeState(JSON.parse(JSON.stringify(rec.state)));
      if (!s || !Array.isArray(s.players)) return "bad-state";
      if (s.winner !== null && s.winner !== 0 && s.winner !== 1 && s.winner !== "draw") return "bad-winner";
    } catch { return "bad-state"; }
    return null;
  }

  async function handle(req, res) {
    const url = new URL(req.url, "http://x");
    if (!url.pathname.startsWith("/api/v1/")) return false;
    const ip = req.socket.remoteAddress || "unknown";
    if (!allow(ip)) { json(res, 429, { ok: false, error: "rate-limited" }); return true; }

    if (req.method === "POST" && (url.pathname === "/api/v1/games" || url.pathname === "/api/v1/positions")) {
      let body;
      try { body = await readBody(req); } catch { json(res, 413, { ok: false, error: "too-large" }); return true; }
      let rec;
      try { rec = JSON.parse(body); } catch { json(res, 400, { ok: false, error: "bad-json" }); return true; }
      const kind = url.pathname.endsWith("games") ? "game" : "position";
      const err = kind === "game" ? validateGame(rec) : validatePosition(rec);
      if (err) { json(res, 400, { ok: false, error: err }); return true; }
      const payload = kind === "game"
        ? { kind, initialState: rec.initialState, actions: rec.actions }
        : { kind, state: rec.state };
      const h = hash(canonical(payload));
      const file = kind === "game" ? gamesFile : posFile;
      const existing = loadLines(file);
      if (existing.some((x) => x.contentHash === h)) {
        json(res, 200, { ok: true, duplicate: true, id: existing.find((x) => x.contentHash === h).id });
        return true;
      }
      const id = (kind === "game" ? "g" : "p") + Date.now().toString(36) + randomBytes(3).toString("hex");
      const delToken = randomBytes(16).toString("hex");
      const stored = {
        id, kind, contentHash: h, storedAt: new Date().toISOString(),
        deleteTokenHash: tokenHash(delToken),
        source: String(rec.source || "unknown").slice(0, 40),
        schemaVersion: 2,
        data: rec,
      };
      append(file, stored);
      log("GL4 stored", kind, id);
      json(res, 201, { ok: true, id, deleteToken: delToken, duplicate: false });
      return true;
    }

    if (req.method === "GET" && url.pathname === "/api/v1/admin/games") {
      const auth = req.headers.authorization || "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
      if (!adminToken || token !== adminToken) { json(res, 403, { ok: false, error: "forbidden" }); return true; }
      const games = loadLines(gamesFile).map((x) => ({ id: x.id, kind: x.kind, storedAt: x.storedAt, source: x.source, contentHash: x.contentHash }));
      const positions = loadLines(posFile).map((x) => ({ id: x.id, kind: x.kind, storedAt: x.storedAt, source: x.source, contentHash: x.contentHash }));
      json(res, 200, { ok: true, games, positions, counts: { games: games.length, positions: positions.length } });
      return true;
    }

    if (req.method === "GET" && url.pathname === "/api/v1/admin/export") {
      const auth = req.headers.authorization || "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
      if (!adminToken || token !== adminToken) { json(res, 403, { ok: false, error: "forbidden" }); return true; }
      json(res, 200, { ok: true, games: loadLines(gamesFile), positions: loadLines(posFile) });
      return true;
    }

    if (req.method === "DELETE" && url.pathname.startsWith("/api/v1/games/")) {
      const id = url.pathname.split("/").pop();
      let body = "";
      try { body = await readBody(req); } catch { /* ignore */ }
      let token = "";
      try { token = JSON.parse(body).deleteToken || ""; } catch { /* ignore */ }
      const all = loadLines(gamesFile);
      const idx = all.findIndex((x) => x.id === id);
      if (idx < 0) { json(res, 404, { ok: false, error: "not-found" }); return true; }
      if (all[idx].deleteTokenHash !== tokenHash(token)) { json(res, 403, { ok: false, error: "forbidden" }); return true; }
      all.splice(idx, 1);
      writeLines(gamesFile, all);
      json(res, 200, { ok: true });
      return true;
    }

    if (req.method === "DELETE" && url.pathname.startsWith("/api/v1/positions/")) {
      const id = url.pathname.split("/").pop();
      let body = "";
      try { body = await readBody(req); } catch { /* ignore */ }
      let token = "";
      try { token = JSON.parse(body).deleteToken || ""; } catch { /* ignore */ }
      const all = loadLines(posFile);
      const idx = all.findIndex((x) => x.id === id);
      if (idx < 0) { json(res, 404, { ok: false, error: "not-found" }); return true; }
      if (all[idx].deleteTokenHash !== tokenHash(token)) { json(res, 403, { ok: false, error: "forbidden" }); return true; }
      all.splice(idx, 1);
      writeLines(posFile, all);
      json(res, 200, { ok: true });
      return true;
    }

    json(res, 404, { ok: false, error: "not-found" });
    return true;
  }

  return { handle, gamesFile, posFile };
}
