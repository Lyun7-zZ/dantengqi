import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createState, applyAction, legalActions, validateAction } from "../src/rules.js";
import { createGameRecord, recordAction, finalizeGame, createPositionRecord } from "../src/game-library.js";
import { startServer } from "../server/index.js";

test("GL4：上传校验、去重、管理读取与匿名删除", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "gl-data-"));
  const publicRoot = mkdtempSync(join(tmpdir(), "gl-public-"));
  process.env.GL_DATA_DIR = dataDir;
  const srv = await startServer({ port: 0, host: "127.0.0.1", publicRoot, adminToken: "secret" });
  const base = `http://127.0.0.1:${srv.port}`;
  try {

  let s = createState(0);
  const rec = createGameRecord({ mode: "local", seat: 0, firstPlayer: 0, state: s, source: "test" });
  for (let i = 0; i < 4; i++) {
    const acts = legalActions(s).filter((a) => validateAction(s, a).ok);
    const a = acts[0];
    const by = s.turn;
    const r = applyAction(s, a);
    recordAction(rec, a, by);
    s = r.state;
  }
  finalizeGame(rec, s);

  const post = await fetch(`${base}/api/v1/games`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(rec),
  });
  const pj = await post.json();
  assert.equal(post.status, 201);
  assert.ok(pj.id && pj.deleteToken);

  const dup = await fetch(`${base}/api/v1/games`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(rec),
  });
  assert.equal((await dup.json()).duplicate, true);

  const bad = JSON.parse(JSON.stringify(rec));
  bad.actions[0].action = { type: "move", dir: "nope" };
  const badRes = await fetch(`${base}/api/v1/games`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(bad),
  });
  assert.equal(badRes.status, 400);

  const forbidden = await fetch(`${base}/api/v1/admin/games`);
  assert.equal(forbidden.status, 403);

  const admin = await fetch(`${base}/api/v1/admin/games?token=secret`);
  const aj = await admin.json();
  assert.equal(admin.status, 200);
  assert.equal(aj.counts.games, 1);

  const pos = createPositionRecord({ state: s, name: "test" });
  const posRes = await fetch(`${base}/api/v1/positions`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(pos),
  });
  assert.equal(posRes.status, 201);

  const del = await fetch(`${base}/api/v1/games/${pj.id}`, {
    method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deleteToken: pj.deleteToken }),
  });
  assert.equal(del.status, 200);
  } finally {
    await srv.close();
  }
});
