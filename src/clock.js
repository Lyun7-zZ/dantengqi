/**
 * 计时规则（规则书第 7 节）：
 *   每步 15 秒；用完后从本人时间库（60 秒）扣除；
 *   时间库耗尽后，每步仍只有 15 秒，用尽即由系统代走。
 *
 * 纯逻辑，不依赖 DOM，按 dt 秒推进，便于单测。
 */

export function createClock({ perMove = 15, bank = 60 } = {}) {
  return {
    perMove,
    bank,
    banks: [bank, bank],
    moveLeft: perMove,
    inBank: false,
  };
}

export function clockSnapshot(c) {
  return { banks: c.banks.slice(), moveLeft: c.moveLeft, inBank: c.inBank };
}

export function clockRestore(c, s) {
  c.banks = s.banks.slice();
  c.moveLeft = s.moveLeft;
  c.inBank = s.inBank;
}

export function resetTurn(c) {
  c.moveLeft = c.perMove;
  c.inBank = false;
}

/**
 * 推进 dt 秒。返回 { timedOut }。
 * timedOut 表示该方本步时间（含时间库）已耗尽。
 */
export function tickClock(c, turn, dt) {
  if (dt <= 0) return { timedOut: false };

  let rest = dt;

  if (c.moveLeft > 0) {
    const used = Math.min(c.moveLeft, rest);
    c.moveLeft -= used;
    rest -= used;
    if (c.moveLeft > 1e-9) return { timedOut: false };
    c.moveLeft = 0;
  }

  if (rest <= 0) return { timedOut: false };

  if (c.banks[turn] <= 0) {
    c.banks[turn] = 0;
    return { timedOut: true };
  }

  c.inBank = true;
  const used = Math.min(c.banks[turn], rest);
  c.banks[turn] -= used;
  if (c.banks[turn] <= 1e-9) {
    c.banks[turn] = 0;
    return { timedOut: true };
  }
  return { timedOut: false };
}

/** 当前该方显示用的“主时间”。 */
export function displayTime(c, turn) {
  return c.moveLeft > 0 ? c.moveLeft : c.banks[turn];
}
