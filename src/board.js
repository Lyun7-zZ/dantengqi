/**
 * 棋盘常量与坐标编码（多规格核心）。
 *
 * 坐标系：列 c ∈ [0, cols-1]；行 r ∈ [0, rows-1]，r=0 最靠近终点线。
 * 每局状态携带 cols/rows；所有索引函数显式接收行数。
 * COLS/ROWS 仅作为 10×12 历史兼容默认值。
 */

export const COLS = 10;
export const ROWS = 12;
export const V_COUNT = COLS - 1;
export const H_COUNT = ROWS - 1;
export const TOP_COUNT = COLS;
export const WALL_SLOTS = V_COUNT * ROWS + H_COUNT * COLS + TOP_COUNT;

export const MIN_SIZE = 8;
export const MAX_SIZE = 18;
export const DEFAULT_COLS = 12;
export const DEFAULT_ROWS = 12;

export function validDims(cols, rows) {
  return Number.isInteger(cols) && Number.isInteger(rows)
    && cols >= MIN_SIZE && cols <= MAX_SIZE
    && rows >= MIN_SIZE && rows <= MAX_SIZE;
}
export function vCount(cols, rows) { return (cols - 1) * rows; }
export function hCount(cols, rows) { return cols * (rows - 1); }
export function topCount(cols) { return cols; }
export function wallSlots(cols, rows) { return vCount(cols, rows) + hCount(cols, rows) + cols; }

export const COL_NAMES = "ABCDEFGHIJKLMNOPQR";

/** 竖墙：位于第 c 与 c+1 列之间、第 r 行。c ∈ [0, cols-2]。 */
export function vIndex(c, r, rows = ROWS) {
  return c * rows + r;
}

/** 横墙：位于第 c 列、第 r 与 r+1 行之间。c ∈ [0, cols-1]。 */
export function hIndex(c, r, rows = ROWS) {
  return c * (rows - 1) + r;
}

/** 上端墙：封住第 c 列的出口。 */
export function topIndex(c) {
  return c;
}

export function colName(c) {
  return COL_NAMES[c] ?? "?";
}

export function rowName(r) {
  return String(r + 1);
}

/** 墙的名称（与规则书 1.3 一致）；坐标与尺寸无关。 */
export function wallName(kind, c, r) {
  if (kind === "v") return `${colName(c)}-${colName(c + 1)}-${rowName(r)}`;
  if (kind === "h") return `${colName(c)}-${rowName(r)}-${rowName(r + 1)}`;
  if (kind === "top") return `${colName(c)}-0`;
  throw new Error(`unknown wall kind: ${kind}`);
}

/** 把 (kind,c,r) 映射为全局序号；需提供该局 cols/rows。 */
export function wallSlot(kind, c, r, cols = COLS, rows = ROWS) {
  if (kind === "v") return vIndex(c, r, rows);
  if (kind === "h") return vCount(cols, rows) + hIndex(c, r, rows);
  if (kind === "top") return vCount(cols, rows) + hCount(cols, rows) + topIndex(c);
  throw new Error(`unknown wall kind: ${kind}`);
}

/** 枚举指定尺寸的全部墙位。 */
export function allWallSlots(cols = COLS, rows = ROWS) {
  const out = [];
  for (let c = 0; c < cols - 1; c++) for (let r = 0; r < rows; r++) out.push({ kind: "v", c, r });
  for (let c = 0; c < cols; c++) for (let r = 0; r < rows - 1; r++) out.push({ kind: "h", c, r });
  for (let c = 0; c < cols; c++) out.push({ kind: "top", c, r: 0 });
  return out;
}
