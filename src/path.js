/**
 * 寻路：到终点的最短路。
 *
 * “终点”定义为某种虚拟出口：棋子位于第 1 行（r=0），且该列上端没有墙，
 * 再向上走一步即越线。因此到终点的步数 = 到某个可出线格子的步数 + 1。
 */

import { COLS, ROWS, V_COUNT, H_COUNT } from "./board.js";

const SIZE = COLS * ROWS;
const key = (c, r) => r * COLS + c;

/**
 * 从 (c0,r0) 出发，返回到达终点所需步数；无路可走时返回 Infinity。
 */
export function distanceToGoal(state, c0, r0) {
  const { vWall, hWall, topWall } = state;
  const dist = new Int16Array(SIZE).fill(-1);
  const q = new Int16Array(SIZE * 2);
  let head = 0;
  let tail = 0;

  q[tail++] = c0;
  q[tail++] = r0;
  dist[key(c0, r0)] = 0;

  while (head < tail) {
    const c = q[head++];
    const r = q[head++];
    const d = dist[key(c, r)];

    if (r === 0 && topWall[c] === 0) return d + 1;

    if (r > 0 && hWall[c * H_COUNT + (r - 1)] === 0) {
      const k = key(c, r - 1);
      if (dist[k] < 0) {
        dist[k] = d + 1;
        q[tail++] = c;
        q[tail++] = r - 1;
      }
    }
    if (r < ROWS - 1 && hWall[c * H_COUNT + r] === 0) {
      const k = key(c, r + 1);
      if (dist[k] < 0) {
        dist[k] = d + 1;
        q[tail++] = c;
        q[tail++] = r + 1;
      }
    }
    if (c > 0 && vWall[(c - 1) * ROWS + r] === 0) {
      const k = key(c - 1, r);
      if (dist[k] < 0) {
        dist[k] = d + 1;
        q[tail++] = c - 1;
        q[tail++] = r;
      }
    }
    if (c < COLS - 1 && vWall[c * ROWS + r] === 0) {
      const k = key(c + 1, r);
      if (dist[k] < 0) {
        dist[k] = d + 1;
        q[tail++] = c + 1;
        q[tail++] = r;
      }
    }
  }
  return Infinity;
}

export function hasPath(state, c, r) {
  return Number.isFinite(distanceToGoal(state, c, r));
}

/**
 * 最短路经过的边（用于 AI 生成“堵路”候选）。
 * 返回 [{ kind, c, r }]，即路径上每一段可被封锁的墙位。
 */
export function shortestPathWalls(state, c0, r0) {
  const { vWall, hWall, topWall } = state;
  const dist = new Int16Array(SIZE).fill(-1);
  const prev = new Int16Array(SIZE).fill(-1);
  const q = new Int16Array(SIZE * 2);
  let head = 0;
  let tail = 0;
  q[tail++] = c0;
  q[tail++] = r0;
  dist[key(c0, r0)] = 0;

  let goalIdx = -1;
  while (head < tail) {
    const c = q[head++];
    const r = q[head++];
    const d = dist[key(c, r)];
    if (r === 0 && topWall[c] === 0) {
      goalIdx = key(c, r);
      break;
    }
    const relax = (nc, nr) => {
      const k = key(nc, nr);
      if (dist[k] < 0) {
        dist[k] = d + 1;
        prev[k] = key(c, r);
        q[tail++] = nc;
        q[tail++] = nr;
      }
    };
    if (r > 0 && hWall[c * H_COUNT + (r - 1)] === 0) relax(c, r - 1);
    if (r < ROWS - 1 && hWall[c * H_COUNT + r] === 0) relax(c, r + 1);
    if (c > 0 && vWall[(c - 1) * ROWS + r] === 0) relax(c - 1, r);
    if (c < COLS - 1 && vWall[c * ROWS + r] === 0) relax(c + 1, r);
  }

  if (goalIdx < 0) return [];

  const cells = [];
  let cur = goalIdx;
  while (cur >= 0) {
    cells.push(cur);
    cur = prev[cur];
  }
  cells.reverse();

  const walls = [];
  for (let i = 1; i < cells.length; i++) {
    const a = cells[i - 1];
    const b = cells[i];
    const ac = a % COLS, ar = Math.floor(a / COLS);
    const bc = b % COLS, br = Math.floor(b / COLS);
    if (ar === br) {
      const left = Math.min(ac, bc);
      walls.push({ kind: "v", c: left, r: ar });
    } else {
      const top = Math.min(ar, br);
      walls.push({ kind: "h", c: ac, r: top });
    }
  }
  // 终点线上方的那一段
  const last = cells[cells.length - 1];
  const lc = last % COLS;
  walls.push({ kind: "top", c: lc, r: 0 });
  return walls;
}
