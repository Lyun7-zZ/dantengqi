/**
 * 棋盘常量与坐标编码。
 *
 * 坐标系：列 c ∈ [0, 9] 对应 A–J；行 r ∈ [0, 11] 对应 1–12，r=0 是最靠近终点线的一行。
 * 墙位共 228 个：
 *   - 竖墙 9 × 12 = 108（分隔相邻两列，位于 c 与 c+1 之间）
 *   - 横墙 10 × 11 = 110（分隔相邻两行，位于 r 与 r+1 之间）
 *   - 上端 10 段（每列 1 段，封住该列的出口）
 */

export const COLS = 10;
export const ROWS = 12;

export const V_COUNT = COLS - 1; // 9  条内部竖线
export const H_COUNT = ROWS - 1; // 11 条内部横线
export const TOP_COUNT = COLS;   // 10 段终点线

export const WALL_SLOTS = V_COUNT * ROWS + H_COUNT * COLS + TOP_COUNT; // 228

export const COL_NAMES = "ABCDEFGHIJ";

/** 竖墙：位于第 c 列与第 c+1 列之间、第 r 行。c ∈ [0,8]，r ∈ [0,11]。 */
export function vIndex(c, r) {
  return c * ROWS + r;
}

/** 横墙：位于第 c 列、第 r 行与第 r+1 行之间。c ∈ [0,9]，r ∈ [0,10]。 */
export function hIndex(c, r) {
  return c * H_COUNT + r;
}

/** 上端墙：封住第 c 列的出口。 */
export function topIndex(c) {
  return c;
}

export function colName(c) {
  return COL_NAMES[c];
}

export function rowName(r) {
  return String(r + 1);
}

/**
 * 墙的名称（与规则书 1.3 一致）。
 * 竖墙 A-9-10；横墙 A-B-10；上端墙 A-0。
 */
export function wallName(kind, c, r) {
  if (kind === "v") return `${colName(c)}-${colName(c + 1)}-${rowName(r)}`;
  if (kind === "h") return `${colName(c)}-${rowName(r)}-${rowName(r + 1)}`;
  if (kind === "top") return `${colName(c)}-0`;
  throw new Error(`unknown wall kind: ${kind}`);
}

/** 把 (kind,c,r) 映射为 0..227 的全局序号，便于统计与快照。 */
export function wallSlot(kind, c, r) {
  if (kind === "v") return vIndex(c, r);
  if (kind === "h") return V_COUNT * ROWS + hIndex(c, r);
  if (kind === "top") return V_COUNT * ROWS + H_COUNT * COLS + topIndex(c);
  throw new Error(`unknown wall kind: ${kind}`);
}

/** 枚举全部 228 个墙位，用于生成候选与测试。 */
export function allWallSlots() {
  const out = [];
  for (let c = 0; c < V_COUNT; c++) {
    for (let r = 0; r < ROWS; r++) out.push({ kind: "v", c, r });
  }
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < H_COUNT; r++) out.push({ kind: "h", c, r });
  }
  for (let c = 0; c < TOP_COUNT; c++) out.push({ kind: "top", c, r: 0 });
  return out;
}
