/**
 * 寻路：到终点的最短路（按状态 cols/rows 参数化）。
 */

import { vIndex, hIndex } from "./board.js";
import { M, now } from "./metrics.js";
import { PC, wallHash, cacheGet, cacheSet } from "./path-cache.js";

/**
 * 从 (c0,r0) 出发，返回到达终点所需步数；无路可走时返回 Infinity。
 */
function distanceToGoalImpl(state, c0, r0) {
  const { vWall, hWall, topWall } = state;
  const { cols, rows } = state;
  const size = cols * rows;
  const key = (c, r) => r * cols + c;
  const dist = new Int16Array(size).fill(-1);
  const q = new Int16Array(size * 2);
  let head = 0, tail = 0;
  q[tail++] = c0; q[tail++] = r0;
  dist[key(c0, r0)] = 0;
  while (head < tail) {
    const c = q[head++], r = q[head++];
    const d = dist[key(c, r)];
    if (r === 0 && topWall[c] === 0) return d + 1;
    if (r > 0 && hWall[hIndex(c, r - 1, rows)] === 0) {
      const k = key(c, r - 1);
      if (dist[k] < 0) { dist[k] = d + 1; q[tail++] = c; q[tail++] = r - 1; }
    }
    if (r < rows - 1 && hWall[hIndex(c, r, rows)] === 0) {
      const k = key(c, r + 1);
      if (dist[k] < 0) { dist[k] = d + 1; q[tail++] = c; q[tail++] = r + 1; }
    }
    if (c > 0 && vWall[vIndex(c - 1, r, rows)] === 0) {
      const k = key(c - 1, r);
      if (dist[k] < 0) { dist[k] = d + 1; q[tail++] = c - 1; q[tail++] = r; }
    }
    if (c < cols - 1 && vWall[vIndex(c, r, rows)] === 0) {
      const k = key(c + 1, r);
      if (dist[k] < 0) { dist[k] = d + 1; q[tail++] = c + 1; q[tail++] = r; }
    }
  }
  return Infinity;
}

function hasPathImpl(state, c, r) {
  return Number.isFinite(distanceToGoalImpl(state, c, r));
}

/** 最短路经过的边（用于 AI 生成“堵路”候选）。 */
export function shortestPathWalls(state, c0, r0) {
  const { vWall, hWall, topWall } = state;
  const { cols, rows } = state;
  const size = cols * rows;
  const key = (c, r) => r * cols + c;
  const dist = new Int16Array(size).fill(-1);
  const prev = new Int16Array(size).fill(-1);
  const q = new Int16Array(size * 2);
  let head = 0, tail = 0;
  q[tail++] = c0; q[tail++] = r0;
  dist[key(c0, r0)] = 0;
  let goalIdx = -1;
  while (head < tail) {
    const c = q[head++], r = q[head++];
    const d = dist[key(c, r)];
    if (r === 0 && topWall[c] === 0) { goalIdx = key(c, r); break; }
    const relax = (nc, nr) => {
      const k = key(nc, nr);
      if (dist[k] < 0) { dist[k] = d + 1; prev[k] = key(c, r); q[tail++] = nc; q[tail++] = nr; }
    };
    if (r > 0 && hWall[hIndex(c, r - 1, rows)] === 0) relax(c, r - 1);
    if (r < rows - 1 && hWall[hIndex(c, r, rows)] === 0) relax(c, r + 1);
    if (c > 0 && vWall[vIndex(c - 1, r, rows)] === 0) relax(c - 1, r);
    if (c < cols - 1 && vWall[vIndex(c, r, rows)] === 0) relax(c + 1, r);
  }
  if (goalIdx < 0) return [];
  const cells = [];
  let cur = goalIdx;
  while (cur >= 0) { cells.push(cur); cur = prev[cur]; }
  cells.reverse();
  const walls = [];
  for (let i = 1; i < cells.length; i++) {
    const a = cells[i - 1], b = cells[i];
    const ac = a % cols, ar = Math.floor(a / cols);
    const bc = b % cols, br = Math.floor(b / cols);
    if (ar === br) walls.push({ kind: "v", c: Math.min(ac, bc), r: ar });
    else walls.push({ kind: "h", c: ac, r: Math.min(ar, br) });
  }
  const last = cells[cells.length - 1];
  walls.push({ kind: "top", c: last % cols, r: 0 });
  return walls;
}

export function distanceToGoal(state, c0, r0) {
  const tracing = M.on;
  if (!PC.on && !tracing) return distanceToGoalImpl(state, c0, r0);
  const t = tracing ? now() : 0;
  if (tracing) M.pathCalls++;
  let out;
  if (PC.on) {
    const { h, sig } = wallHash(state);
    const pk = ((r0 * state.cols + c0) * 2);
    const hit = cacheGet(h, pk, sig);
    if (hit !== undefined) { PC.hits++; out = hit; }
    else { PC.misses++; out = distanceToGoalImpl(state, c0, r0); cacheSet(h, pk, sig, out); }
  } else out = distanceToGoalImpl(state, c0, r0);
  if (tracing) M.pathMs += now() - t;
  return out;
}

export function hasPath(state, c, r) {
  const tracing = M.on;
  if (!PC.on && !tracing) return hasPathImpl(state, c, r);
  const t = tracing ? now() : 0;
  if (tracing) M.pathCalls++;
  let out;
  if (PC.on) {
    const { h, sig } = wallHash(state);
    const pk = ((r * state.cols + c) * 2 + 1);
    const hit = cacheGet(h, pk, sig);
    if (hit !== undefined) { PC.hits++; out = hit; }
    else { PC.misses++; out = hasPathImpl(state, c, r); cacheSet(h, pk, sig, out); }
  } else out = hasPathImpl(state, c, r);
  if (tracing) M.pathMs += now() - t;
  return out;
}
