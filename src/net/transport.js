/**
 * 传输层抽象：游戏逻辑只认这一层，不关心底层是 WebRTC 还是内存。
 *
 * 约定：
 *   - send(msg) 接受普通对象，内部负责序列化；
 *   - onMessage/onOpen/onClose 由使用方赋值；
 *   - 关闭是幂等的。
 */

export class Transport {
  constructor(kind = "base") {
    this.kind = kind;
    this.state = "idle"; // idle | connecting | open | closed
    this.onMessage = null;
    this.onOpen = null;
    this.onClose = null;
    this.closeReason = null;
  }

  send() {
    throw new Error("send() 未实现");
  }

  close(reason = "local") {
    if (this.state === "closed") return;
    this.state = "closed";
    this.closeReason = reason;
    this.onClose?.(reason);
  }

  /** 子类在连接建立时调用。 */
  _open() {
    if (this.state === "closed") return;
    this.state = "open";
    this.onOpen?.();
  }

  /** 子类在收到消息时调用。 */
  _recv(msg) {
    if (this.state !== "open") return;
    this.onMessage?.(msg);
  }
}

/**
 * 内存传输：用于单元测试与本地演练。
 * 可配置延迟与丢包（丢包仅用于测试异常分支）。
 */
export class MemoryTransport extends Transport {
  constructor() {
    super("memory");
    this.target = null;
    this.latency = 0;
    this.dropRate = 0;
  }

  send(msg) {
    if (this.state !== "open") throw new Error("transport not open");
    const copy = JSON.parse(JSON.stringify(msg));
    const deliver = () => {
      if (this.target && this.target.state === "open") this.target._recv(copy);
    };
    if (this.latency > 0) setTimeout(deliver, this.latency);
    else queueMicrotask(deliver);
  }

  /** 模拟网络中断。 */
  cut(reason = "network") {
    this.close(reason);
    this.target?.close(reason);
  }
}

/** 生成一对已连通的内存传输。 */
export function memoryPair({ latency = 0 } = {}) {
  const a = new MemoryTransport();
  const b = new MemoryTransport();
  a.target = b;
  b.target = a;
  a.latency = latency;
  b.latency = latency;
  queueMicrotask(() => {
    a._open();
    b._open();
  });
  return [a, b];
}
