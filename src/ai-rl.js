// 实验难度：直接运行强化学习策略网络（CNN + 策略头）。
// 权重由 _extract/export_rl_weights.py 从 rl21-e1-final.zip 导出。

import { COLS, ROWS } from "./board.js";
import { distanceOf, validateAction, legalActions } from "./rules.js";
import { RL_WEIGHTS } from "./ai-rl-weights.js";

const MOVES = ["up", "down", "left", "right"];
const N_ACTIONS = 232;

let cache = null;

function decodeBase64(b64) {
  let bin;
  if (typeof atob === "function") bin = atob(b64);
  else bin = Buffer.from(b64, "base64").toString("binary");
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

function tensors() {
  if (cache) return cache;
  const t = {};
  for (const [name, v] of Object.entries(RL_WEIGHTS.tensors)) {
    t[name] = { data: decodeBase64(v.b64), shape: v.shape };
  }
  cache = t;
  return t;
}

function decodeAction(i) {
  if (i < 4) return { type: "move", dir: MOVES[i] };
  if (i < 112) {
    const k = i - 4;
    return { type: "wall", kind: "v", c: Math.floor(k / 12), r: k % 12 };
  }
  if (i < 222) {
    const k = i - 112;
    return { type: "wall", kind: "h", c: Math.floor(k / 11), r: k % 11 };
  }
  return { type: "wall", kind: "top", c: i - 222, r: 0 };
}

/** 与 Python 环境完全一致的观测：10 通道 12×10 + 4 标量。 */
function buildObservation(state, side) {
  const H = ROWS, W = COLS, C = 10;
  const board = new Float32Array(C * H * W);
  const me = state.players[side];
  const opp = state.players[1 - side];
  board[0 * H * W + me.r * W + me.c] = 1;
  board[1 * H * W + opp.r * W + opp.c] = 1;
  for (let c = 0; c < W; c++) if (state.topWall[c]) board[2 * H * W + 0 * W + c] = 1;
  for (let c = 0; c < 9; c++) {
    for (let r = 0; r < H; r++) {
      if (state.vWall[c * ROWS + r]) board[3 * H * W + r * W + c] = 1;
    }
  }
  for (let c = 0; c < W; c++) {
    for (let r = 0; r < 11; r++) {
      if (state.hWall[c * 11 + r]) board[4 * H * W + r * W + c] = 1;
    }
  }
  const dm = distanceOf(state, side);
  const dopp = distanceOf(state, 1 - side);
  const fill = (ch, v) => {
    const base = ch * H * W;
    for (let i = 0; i < H * W; i++) board[base + i] = v;
  };
  fill(5, Math.min(dm / 30, 1));
  fill(6, Math.min(dopp / 30, 1));
  fill(7, state.turn === side ? 1 : 0);
  const wl = Number.isFinite(state.wallLimit[side]) ? state.wallLimit[side] : 30;
  const left = Math.max(0, wl - state.wallsUsed[side]);
  fill(8, Math.min(left / 30, 1));
  const wl2 = Number.isFinite(state.wallLimit[1 - side]) ? state.wallLimit[1 - side] : 30;
  const left2 = Math.max(0, wl2 - state.wallsUsed[1 - side]);
  fill(9, Math.min(left2 / 30, 1));

  const scalars = [
    (dopp - dm) / 30,
    side === 0 ? 1 : 0,
    Math.min(state.plies / 240, 1),
    0,
  ];
  return { board, scalars };
}

function conv3x3(input, C, H, W, weight, bias, OC) {
  const out = new Float32Array(OC * H * W);
  for (let oc = 0; oc < OC; oc++) {
    const b = bias[oc];
    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        let sum = b;
        for (let ic = 0; ic < C; ic++) {
          for (let kh = 0; kh < 3; kh++) {
            const rr = r + kh - 1;
            if (rr < 0 || rr >= H) continue;
            for (let kw = 0; kw < 3; kw++) {
              const cc = c + kw - 1;
              if (cc < 0 || cc >= W) continue;
              const wi = ((oc * C + ic) * 3 + kh) * 3 + kw;
              sum += input[ic * H * W + rr * W + cc] * weight[wi];
            }
          }
        }
        out[oc * H * W + r * W + c] = sum > 0 ? sum : 0;
      }
    }
  }
  return out;
}

/** 返回动作索引；mask 外不会被选中。 */
export function rlActionIndex(state, rng = Math.random) {
  if (!state || state.winner !== null) return null;
  const side = state.turn;
  const t = tensors();
  const H = ROWS, W = COLS;

  const conv1 = conv3x3(buildObservation(state, side).board, 10, H, W,
    t.conv1w.data, t.conv1b.data, 16);
  const conv2 = conv3x3(conv1, 16, H, W, t.conv2w.data, t.conv2b.data, 32);

  const flat = new Float32Array(32 * H * W + 4);
  for (let i = 0; i < 32 * H * W; i++) flat[i] = conv2[i];
  flat[32 * H * W] = (distanceOf(state, 1 - side) - distanceOf(state, side)) / 30;
  flat[32 * H * W + 1] = side === 0 ? 1 : 0;
  flat[32 * H * W + 2] = Math.min(state.plies / 240, 1);
  flat[32 * H * W + 3] = 0;

  const nIn = 32 * H * W + 4;
  const h = new Float32Array(128);
  for (let o = 0; o < 128; o++) {
    let sum = t.fcb.data[o];
    const base = o * nIn;
    for (let i = 0; i < nIn; i++) sum += flat[i] * t.fcw.data[base + i];
    h[o] = sum > 0 ? sum : 0;
  }
  const pi = new Float32Array(128);
  for (let o = 0; o < 128; o++) {
    let sum = t.pib.data[o];
    const base = o * 128;
    for (let i = 0; i < 128; i++) sum += h[i] * t.piw.data[base + i];
    pi[o] = Math.tanh(sum);
  }
  const logits = new Float32Array(N_ACTIONS);
  for (let o = 0; o < N_ACTIONS; o++) {
    let sum = t.ab.data[o];
    const base = o * 128;
    for (let i = 0; i < 128; i++) sum += pi[i] * t.aw.data[base + i];
    logits[o] = sum;
  }

  let best = -1;
  let bestV = -Infinity;
  for (let i = 0; i < N_ACTIONS; i++) {
    if (!validateAction(state, decodeAction(i)).ok) continue;
    if (logits[i] > bestV) {
      bestV = logits[i];
      best = i;
    }
  }
  if (best < 0) {
    const legal = legalActions(state);
    if (legal.length) return null; // 交给外层兜底
  }
  return best >= 0 ? best : null;
}

export function rlAI(state, rng = Math.random) {
  const idx = rlActionIndex(state, rng);
  if (idx === null) return null;
  return decodeAction(idx);
}

/** 调试：返回 logits 与合法动作，便于与 Python 对拍。 */
export function rlDebug(state) {
  const side = state.turn;
  const t = tensors();
  const H = ROWS, W = COLS;
  const conv1 = conv3x3(buildObservation(state, side).board, 10, H, W,
    t.conv1w.data, t.conv1b.data, 16);
  const conv2 = conv3x3(conv1, 16, H, W, t.conv2w.data, t.conv2b.data, 32);
  const flat = new Float32Array(32 * H * W + 4);
  for (let i = 0; i < 32 * H * W; i++) flat[i] = conv2[i];
  flat[32 * H * W] = (distanceOf(state, 1 - side) - distanceOf(state, side)) / 30;
  flat[32 * H * W + 1] = side === 0 ? 1 : 0;
  flat[32 * H * W + 2] = Math.min(state.plies / 240, 1);
  flat[32 * H * W + 3] = 0;
  const nIn = 32 * H * W + 4;
  const h = new Float32Array(128);
  for (let o = 0; o < 128; o++) {
    let sum = t.fcb.data[o];
    const base = o * nIn;
    for (let i = 0; i < nIn; i++) sum += flat[i] * t.fcw.data[base + i];
    h[o] = sum > 0 ? sum : 0;
  }
  const pi = new Float32Array(128);
  for (let o = 0; o < 128; o++) {
    let sum = t.pib.data[o];
    const base = o * 128;
    for (let i = 0; i < 128; i++) sum += h[i] * t.piw.data[base + i];
    pi[o] = Math.tanh(sum);
  }
  const logits = new Float32Array(N_ACTIONS);
  for (let o = 0; o < N_ACTIONS; o++) {
    let sum = t.ab.data[o];
    const base = o * 128;
    for (let i = 0; i < 128; i++) sum += pi[i] * t.aw.data[base + i];
    logits[o] = sum;
  }
  return { logits: Array.from(logits), side };
}
