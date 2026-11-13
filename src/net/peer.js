/**
 * PeerJS 传输：零服务器的默认信令方案。
 *
 * 房间码映射为固定的 PeerJS id（danteng-XXXXXX），
 * 房主等待连接，加入方主动 dial。PeerJS 库按需从 CDN 加载，
 * 因此单文件版在“不联机”时不会引入任何网络依赖。
 */

import { Transport } from "./transport.js";

const CDNS = [
  "https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js",
  "https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/peerjs/1.5.4/peerjs.min.js",
];

let peerLoading = null;

/** 懒加载 PeerJS，返回 window.Peer。 */
export function loadPeerJS() {
  if (globalThis.Peer) return Promise.resolve(globalThis.Peer);
  if (peerLoading) return peerLoading;

  peerLoading = (async () => {
    for (const url of CDNS) {
      try {
        await new Promise((resolve, reject) => {
          const s = document.createElement("script");
          s.src = url;
          s.async = true;
          s.onload = resolve;
          s.onerror = () => reject(new Error("load failed: " + url));
          document.head.appendChild(s);
        });
        if (globalThis.Peer) return globalThis.Peer;
      } catch {
        /* 换下一个 CDN */
      }
    }
    throw new Error("PeerJS 加载失败，请检查网络或改用连接码");
  })();

  return peerLoading;
}

export function peerIdFor(roomCode) {
  return `danteng-${roomCode}`;
}

class PeerTransport extends Transport {
  constructor(peer, conn, role) {
    super("peer");
    this.peer = peer;
    this.conn = conn;
    this.role = role;

    conn.on("data", (data) => this._recv(data));
    conn.on("close", () => this.close("remote"));
    conn.on("error", (e) => this.close("error:" + (e?.type ?? "unknown")));
    peer.on("error", (e) => {
      if (e?.type === "peer-unavailable") this.close("peer-unavailable");
    });

    this._open();
  }

  send(msg) {
    if (this.state !== "open") throw new Error("transport not open");
    this.conn.send(msg);
  }

  close(reason = "local") {
    if (this.state === "closed") return;
    try { this.conn.close(); } catch { /* ignore */ }
    // 只有主动关闭才销毁 Peer；网络断开时房主要留着收重连
    if (reason === "local") {
      try { this.peer.destroy(); } catch { /* ignore */ }
    }
    super.close(reason);
  }
}

function once(target, event, timeoutMs, timeoutMsg) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(timeoutMsg));
    }, timeoutMs);
    const onOk = (v) => { cleanup(); resolve(v); };
    const onErr = (e) => { cleanup(); reject(e instanceof Error ? e : new Error(e?.type ?? "error")); };
    const cleanup = () => {
      clearTimeout(timer);
      target.off?.(event, onOk);
      target.off?.("error", onErr);
    };
    target.on(event, onOk);
    target.on("error", onErr);
  });
}

/** 建房等待对手加入。 */
export async function createPeerHost(roomCode, { onStatus, signal } = {}) {
  const Peer = await loadPeerJS();
  onStatus?.("signaling");

  const peer = new Peer(peerIdFor(roomCode), { debug: 0 });
  await once(peer, "open", 15000, "信令连接超时");
  onStatus?.("waiting");

  const conn = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("等待对手加入超时")), 120000);
    peer.on("connection", (c) => {
      clearTimeout(timer);
      resolve(c);
    });
    peer.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error("信令错误：" + (e?.type ?? "unknown")));
    });
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new Error("已取消"));
    }, { once: true });
  });

  await once(conn, "open", 20000, "数据通道建立失败");
  onStatus?.("connected");

  const transport = new PeerTransport(peer, conn, "host");
  transport.peer = peer;
  /** 等待加入方重连（返回新的 transport）。 */
  transport.waitForReconnect = (timeoutMs = 90000) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      peer.off("connection", onConn);
      reject(new Error("等待重连超时"));
    }, timeoutMs);
    const onConn = async (c) => {
      clearTimeout(timer);
      peer.off("connection", onConn);
      try {
        await once(c, "open", 15000, "重连通道建立失败");
        resolve(new PeerTransport(peer, c, "host"));
      } catch (e) {
        reject(e);
      }
    };
    peer.on("connection", onConn);
  });
  return transport;
}

/** 加入房间。 */
export async function joinPeerRoom(roomCode, { onStatus } = {}) {
  const Peer = await loadPeerJS();
  onStatus?.("signaling");

  const peer = new Peer({ debug: 0 });
  await once(peer, "open", 15000, "信令连接超时");

  onStatus?.("dialing");
  const conn = peer.connect(peerIdFor(roomCode), {
    reliable: true,
    serialization: "json",
  });

  await once(conn, "open", 20000, "连接超时，房间可能不存在");
  onStatus?.("connected");
  return new PeerTransport(peer, conn, "guest");
}


/** 加入方重连：重新 dial 同一个房间。 */
export async function reconnectPeerRoom(roomCode, { timeoutMs = 20000 } = {}) {
  const Peer = await loadPeerJS();
  const peer = new Peer({ debug: 0 });
  await once(peer, "open", 10000, "信令重连超时");

  const conn = peer.connect(peerIdFor(roomCode), {
    reliable: true,
    serialization: "json",
  });
  await once(conn, "open", timeoutMs, "重连超时");
  return new PeerTransport(peer, conn, "guest");
}
