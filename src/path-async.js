/**
 * 寻路：到终点的最短路。
 *
 * 墙有主人。mover 只被对方的墙挡住，自己的墙可以穿过。
 * 终点是第 1 行再向上一步；该列上端若是对方的墙，则不能从这里越线。
 */

import { hIndex, vIndex } from "./board.js";

/** 墙值：0 空，1 只挡玩家 1，2 只挡玩家 0，3 谁都挡。 */
export function blocksMover(wallVal, mover) {
  return wallVal !== 0 && wallVal !== mover + 1;
}

/**
 * 从 (c0,r0) 出发，返回到达终点所需步数；无路可走时返回 Infinity。
 * mover 是正在走路的一方。
 */
export function distanceToGoal(state, c0, r0, mover = 0) {
  const { vWall, hWall, topWall } = state;
  const { cols, rows } = state;
  const size = cols * rows;
  const key = (c, r) => r * cols + c;
  const dist = new Int16Array(size).fill(-1);
  const q = new Int16Array(size * 2);
  let head = 0;
  let tail = 0;

  q[tail++] = c0;
  q[tail++] = r0;
  dist[key(c0, r0)] = 0;

  while (head < tail) {
    const c = q[head++];
    const r = q[head++];
    const d = dist[key(c, r)];

    if (r === 0 && !blocksMover(topWall[c], mover)) return d + 1;

    if (r > 0 && !blocksMover(hWall[hIndex(c, r - 1, rows)], mover)) {
      const k = key(c, r - 1);
      if (dist[k] < 0) {
        dist[k] = d + 1;
        q[tail++] = c;
        q[tail++] = r - 1;
      }
    }
    if (r < rows - 1 && !blocksMover(hWall[hIndex(c, r, rows)], mover)) {
      const k = key(c, r + 1);
      if (dist[k] < 0) {
        dist[k] = d + 1;
        q[tail++] = c;
        q[tail++] = r + 1;
      }
    }
    if (c > 0 && !blocksMover(vWall[vIndex(c - 1, r, rows)], mover)) {
      const k = key(c - 1, r);
      if (dist[k] < 0) {
        dist[k] = d + 1;
        q[tail++] = c - 1;
        q[tail++] = r;
      }
    }
    if (c < cols - 1 && !blocksMover(vWall[vIndex(c, r, rows)], mover)) {
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

export function hasPath(state, c, r, mover = 0) {
  return Number.isFinite(distanceToGoal(state, c, r, mover));
}

/**
 * 最短路经过的边（用于 AI 生成“堵路”候选）。
 * 返回 [{ kind, c, r }]，即路径上每一段可被封锁的墙位。
 */
export function shortestPathWalls(state, c0, r0, mover = 0) {
  const { vWall, hWall, topWall } = state;
  const { cols, rows } = state;
  const size = cols * rows;
  const key = (c, r) => r * cols + c;
  const dist = new Int16Array(size).fill(-1);
  const prev = new Int16Array(size).fill(-1);
  const q = new Int16Array(size * 2);
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
    if (r === 0 && !blocksMover(topWall[c], mover)) {
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
    if (r > 0 && !blocksMover(hWall[hIndex(c, r - 1, rows)], mover)) relax(c, r - 1);
    if (r < rows - 1 && !blocksMover(hWall[hIndex(c, r, rows)], mover)) relax(c, r + 1);
    if (c > 0 && !blocksMover(vWall[vIndex(c - 1, r, rows)], mover)) relax(c - 1, r);
    if (c < cols - 1 && !blocksMover(vWall[vIndex(c, r, rows)], mover)) relax(c + 1, r);
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
    const ac = a % cols;
    const ar = Math.floor(a / cols);
    const bc = b % cols;
    const br = Math.floor(b / cols);
    if (ar === br) {
      const left = Math.min(ac, bc);
      walls.push({ kind: "v", c: left, r: ar });
    } else {
      const top = Math.min(ar, br);
      walls.push({ kind: "h", c: ac, r: top });
    }
  }
  const last = cells[cells.length - 1];
  const lc = last % cols;
  walls.push({ kind: "top", c: lc, r: 0 });
  return walls;
}
