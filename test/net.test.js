import test from "node:test";
import assert from "node:assert/strict";

import {
  PROTOCOL_VERSION, RULES_VERSION,
  stateHash, configHash, message, parseMessage, checkHandshake,
  makeRoomCode, normalizeRoomCode,
} from "../src/net/protocol.js";
import { memoryPair } from "../src/net/transport.js";
import { createState, applyAction } from "../src/rules.js";
import { packCode, unpackCode } from "../src/net/code.js";

const CONFIG = { perMove: 30, bank: 300 };

test("stateHash：相同局面一致，落子后变化", () => {
  const a = createState(0);
  const b = createState(0);
  assert.equal(stateHash(a), stateHash(b));

  const moved = applyAction(a, { type: "move", dir: "up" }).state;
  assert.notEqual(stateHash(moved), stateHash(a));
});

test("stateHash：墙位任何一位不同都会被检出", () => {
  const a = createState(0);
  const b = createState(0);
  b.vWall[4 * 12 + 3] = 1;
  assert.notEqual(stateHash(b), stateHash(a));
});

test("configHash：参数变化即变化", () => {
  assert.equal(configHash(CONFIG), configHash({ ...CONFIG }));
  assert.notEqual(configHash(CONFIG), configHash({ ...CONFIG, perMove: 15 }));
});

test("消息编解码：版本与类型校验", () => {
  const ok = parseMessage(JSON.stringify(message("hello", { config: configHash(CONFIG) })));
  assert.equal(ok.ok, true);
  assert.equal(ok.msg.t, "hello");

  assert.equal(parseMessage("{bad json").error, "bad-json");
  assert.equal(parseMessage(JSON.stringify({ v: 999, t: "hello" })).error, "version-mismatch");
  assert.equal(parseMessage(JSON.stringify({ v: PROTOCOL_VERSION })).error, "bad-type");
});

test("握手：规则/参数不一致会被拒绝", () => {
  const local = { config: configHash(CONFIG) };
  assert.equal(checkHandshake(local, { v: PROTOCOL_VERSION, rules: RULES_VERSION, config: local.config }).ok, true);
  assert.equal(checkHandshake(local, { v: PROTOCOL_VERSION, rules: "1.1", config: local.config }).error, "rules");
  assert.equal(checkHandshake(local, { v: PROTOCOL_VERSION, rules: RULES_VERSION, config: "deadbeef" }).error, "config");
});

test("房间码：长度与字符集", () => {
  for (let i = 0; i < 50; i++) {
    const code = makeRoomCode();
    assert.equal(code.length, 6);
    assert.match(code, /^[A-HJ-NP-Z2-9]{6}$/);
  }
});

test("房间码：输入规范化", () => {
  assert.equal(normalizeRoomCode(" ab-cd ef "), "ABCDEF");
  assert.equal(normalizeRoomCode("a1b2c3d4"), "A1B2C3");
});

test("内存传输：握手、收发、关闭传播", async () => {
  const [a, b] = memoryPair();
  const seen = [];
  b.onMessage = (m) => seen.push(m);
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(a.state, "open");
  assert.equal(b.state, "open");

  a.send(message("hello", { config: "x" }));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(seen.length, 1);
  assert.equal(seen[0].t, "hello");

  let closedAt = null;
  b.onClose = (r) => { closedAt = r; };
  a.cut("network");
  assert.equal(a.state, "closed");
  assert.equal(b.state, "closed");
  assert.equal(closedAt, "network");
});

test("内存传输：关闭后发送会抛错", async () => {
  const [a] = memoryPair();
  await new Promise((r) => setTimeout(r, 0));
  a.close();
  assert.throws(() => a.send(message("ping")));
});

test("完整握手：两端通过内存传输交换并校验", async () => {
  const [host, guest] = memoryPair();
  const cfg = configHash(CONFIG);
  const received = [];

  guest.onMessage = (m) => {
    received.push(m);
    if (m.t === "hello") {
      guest.send(message("hello", { config: cfg, rules: RULES_VERSION }));
    }
  };
  host.onMessage = (m) => {
    if (m.t !== "hello") return;
    const res = checkHandshake({ config: cfg }, m);
    received.push({ t: "handshake", ...res });
  };

  await new Promise((r) => setTimeout(r, 0));
  host.send(message("hello", { config: cfg, rules: RULES_VERSION }));
  await new Promise((r) => setTimeout(r, 10));

  const hello = received.find((m) => m.t === "hello");
  assert.equal(hello.config, cfg);
  const hs = received.find((m) => m.t === "handshake");
  assert.equal(hs.ok, true);
});


test("连接码：压缩往返", async () => {
  const payload = { k: "offer", sdp: "v=0\\r\\n" + "a=candidate:1 1 udp 2113937151 192.168.1.2 54321 typ host\\r\\n".repeat(40) };
  const code = await packCode(payload);
  assert.match(code, /^DTQ1-[ZP]/);
  const back = await unpackCode(code);
  assert.deepEqual(back, payload);
  assert.ok(code.length < 2000, "连接码应控制在 2000 字符内，实际 " + code.length);
});

test("连接码：错误前缀会报错", async () => {
  await assert.rejects(() => unpackCode("hello"), /连接码格式/);
});
