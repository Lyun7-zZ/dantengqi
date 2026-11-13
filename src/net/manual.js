/**
 * 手动连接码传输：完全零服务器。
 *
 * 流程（两步，靠微信/QQ 等任意渠道传递两段文本）：
 *   房主：生成「邀请码」→ 发给对方
 *   对方：粘贴邀请码 → 得到「应答码」→ 发回房主
 *   房主：粘贴应答码 → 连接建立
 *
 * 之后数据走 WebRTC DataChannel，与 PeerJS 方案完全一致。
 */

import { Transport } from "./transport.js";
import { packCode, unpackCode } from "./code.js";

const ICE_SERVERS = {
  iceServers: [
    { urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] },
  ],
};

const ICE_TIMEOUT = 3500;

class RtcTransport extends Transport {
  constructor(pc, role) {
    super("rtc");
    this.pc = pc;
    this.role = role;
    this.channel = null;

    pc.addEventListener("connectionstatechange", () => {
      const s = pc.connectionState;
      if (s === "failed") this.close("failed");
      else if (s === "disconnected") this.close("disconnected");
      else if (s === "closed") this.close("closed");
    });
  }

  attach(channel) {
    this.channel = channel;
    channel.addEventListener("open", () => this._open());
    channel.addEventListener("message", (e) => {
      let msg = e.data;
      if (typeof msg === "string") {
        try { msg = JSON.parse(msg); } catch { return; }
      }
      this._recv(msg);
    });
    channel.addEventListener("close", () => this.close("remote"));
    if (channel.readyState === "open") this._open();
  }

  send(msg) {
    if (!this.channel || this.channel.readyState !== "open") {
      throw new Error("数据通道未就绪");
    }
    this.channel.send(JSON.stringify(msg));
  }

  close(reason = "local") {
    if (this.state === "closed") return;
    try { this.channel?.close(); } catch { /* ignore */ }
    try { this.pc.close(); } catch { /* ignore */ }
    super.close(reason);
  }
}

/* ---------------------------------------------------------------- 连接 */

function waitForIce(pc) {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      pc.removeEventListener("icegatheringstatechange", onChange);
      resolve();
    };
    const onChange = () => {
      if (pc.iceGatheringState === "complete") done();
    };
    pc.addEventListener("icegatheringstatechange", onChange);
    setTimeout(done, ICE_TIMEOUT);
  });
}

/** 房主：生成邀请码。 */
export async function createManualOffer({ onStatus } = {}) {
  onStatus?.("gathering");

  const pc = new RTCPeerConnection(ICE_SERVERS);
  const transport = new RtcTransport(pc, "host");
  const channel = pc.createDataChannel("game", { ordered: true });
  transport.attach(channel);

  await pc.setLocalDescription(await pc.createOffer());
  await waitForIce(pc);
  onStatus?.("code-ready");

  const code = await packCode({ k: "offer", sdp: pc.localDescription.sdp });

  return {
    transport,
    code,
    /** 房主粘贴对方的应答码后调用。 */
    async complete(answerCode) {
      const ans = await unpackCode(answerCode);
      if (ans.k !== "answer") throw new Error("这不是应答码");
      await pc.setRemoteDescription({ type: "answer", sdp: ans.sdp });
    },
  };
}

/** 加入方：用邀请码换取应答码。 */
export async function answerManualOffer(offerCode, { onStatus } = {}) {
  onStatus?.("gathering");

  const offer = await unpackCode(offerCode);
  if (offer.k !== "offer") throw new Error("这不是邀请码");

  const pc = new RTCPeerConnection(ICE_SERVERS);
  const transport = new RtcTransport(pc, "guest");
  pc.addEventListener("datachannel", (e) => transport.attach(e.channel));

  await pc.setRemoteDescription({ type: "offer", sdp: offer.sdp });
  await pc.setLocalDescription(await pc.createAnswer());
  await waitForIce(pc);
  onStatus?.("code-ready");

  const code = await packCode({ k: "answer", sdp: pc.localDescription.sdp });
  return { transport, code };
}
