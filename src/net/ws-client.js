/**
 * 服务器联机客户端：一条 WebSocket，负责握手、重连、心跳。
 * 协议见 docs/蛋疼棋_联机服务器设计_v1.0.md
 */

export const PROTOCOL_VERSION = 2;
export const RULES_VERSION = "1.3";

export class WsClient {
  constructor({ url, onMessage, onStatus, onOpen, onClose }) {
    this.url = url;
    this.onMessage = onMessage || (() => {});
    this.onStatus = onStatus || (() => {});
    this.onOpen = onOpen || (() => {});
    this.onClose = onClose || (() => {});
    this.ws = null;
    this.isOpen = false;
    this.closedByUs = false;
  }

  connect(timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
      let ws;
      try {
        ws = new WebSocket(this.url);
      } catch (err) {
        reject(new Error("无法创建连接"));
        return;
      }
      this.ws = ws;
      const timer = setTimeout(() => {
        try { ws.close(); } catch { /* ignore */ }
        reject(new Error("连接超时"));
      }, timeoutMs);

      ws.onopen = () => {
        clearTimeout(timer);
        this.isOpen = true;
        this.onStatus("已连接服务器");
        this.onOpen();
        resolve(this);
      };
      ws.onmessage = (e) => {
        let msg;
        try { msg = JSON.parse(e.data); } catch { return; }
        try {
          this.onMessage(msg);
        } catch (err) {
          console.error("[net] 处理消息失败", err);
        }
      };
      ws.onerror = () => {
        clearTimeout(timer);
        if (!this.isOpen) reject(new Error("网络错误"));
      };
      ws.onclose = () => {
        clearTimeout(timer);
        const wasOpen = this.isOpen;
        this.isOpen = false;
        if (!wasOpen) reject(new Error("连接被关闭"));
        if (!this.closedByUs) this.onClose();
      };
    });
  }

  send(obj) {
    if (!this.ws || this.ws.readyState !== 1) return false;
    this.ws.send(JSON.stringify(obj));
    return true;
  }

  close() {
    this.closedByUs = true;
    try { this.ws?.close(); } catch { /* ignore */ }
  }
}
