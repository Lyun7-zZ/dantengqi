/**
 * 232 个动作的固定编码（与 JS 规则内核一致）。
 *
 *   0–3     走子：up, down, left, right
 *   4–111   竖墙：c 0..8, r 0..11（c*12+r）
 *   112–221 横墙：c 0..9, r 0..10（c*11+r）
 *   222–231 顶部封口：c 0..9
 */

export const N_ACTIONS = 232;
export const MOVES = ["up", "down", "left", "right"];
export const V_BASE = 4;
export const V_COUNT = 9 * 12;      // 108
export const H_BASE = V_BASE + V_COUNT; // 112
export const H_COUNT = 10 * 11;     // 110
export const T_BASE = H_BASE + H_COUNT; // 222
export const T_COUNT = 10;          // 10

export function decode(index) {
  if (!Number.isInteger(index) || index < 0 || index >= N_ACTIONS) {
    throw new Error("bad action index: " + index);
  }
  if (index < V_BASE) return { type: "move", dir: MOVES[index] };
  if (index < H_BASE) {
    const k = index - V_BASE;
    return { type: "wall", kind: "v", c: Math.floor(k / 12), r: k % 12 };
  }
  if (index < T_BASE) {
    const k = index - H_BASE;
    return { type: "wall", kind: "h", c: Math.floor(k / 11), r: k % 11 };
  }
  return { type: "wall", kind: "top", c: index - T_BASE, r: 0 };
}

export function encode(action) {
  if (action.type === "move") {
    const i = MOVES.indexOf(action.dir);
    if (i < 0) throw new Error("bad dir: " + action.dir);
    return i;
  }
  if (action.kind === "v") return V_BASE + action.c * 12 + action.r;
  if (action.kind === "h") return H_BASE + action.c * 11 + action.r;
  if (action.kind === "top") return T_BASE + action.c;
  throw new Error("bad action: " + JSON.stringify(action));
}

/** 自测：编码/解码双射。 */
export function selfTest() {
  const errors = [];
  for (let i = 0; i < N_ACTIONS; i++) {
    const a = decode(i);
    const j = encode(a);
    if (i !== j) errors.push({ i, a, j });
  }
  return errors;
}
