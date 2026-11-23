"""固定学习方的蛋疼棋 RL 环境（R0-5）。

单智能体封装：reset 随机分配学习方；若学习方后手，对手先在 reset 内走一手。
step 接收学习方动作；未终局则由固定对手应手，返回下一次学习方可行动的观测。
"""

from __future__ import annotations

import json
import random
import subprocess
import sys
from pathlib import Path

import numpy as np
import gymnasium as gym
from gymnasium import spaces

ROWS, COLS = 12, 10
N_ACTIONS = 232
CHANNELS = 10


def _encode_move(direction: str) -> int:
    return {"up": 0, "down": 1, "left": 2, "right": 3}[direction]


def _decode(index: int):
    if index < 4:
        return {"type": "move", "dir": ["up", "down", "left", "right"][index]}
    if index < 112:
        k = index - 4
        return {"type": "wall", "kind": "v", "c": k // 12, "r": k % 12}
    if index < 222:
        k = index - 112
        return {"type": "wall", "kind": "h", "c": k // 11, "r": k % 11}
    return {"type": "wall", "kind": "top", "c": index - 222, "r": 0}


class DantengEnv(gym.Env):
    metadata = {"render_modes": []}

    def __init__(self, *, node: str = "node", server: str | None = None,
                 max_plies: int = 240, opponent: str = "random", seed: int | None = None,
                 start_mode: str = "normal", learner_side: int | None = None,
                 opponent_model=None, opening_plies: int = 0):
        super().__init__()
        root = Path(__file__).resolve().parents[2]
        self.server_path = str(server or root / "tools" / "rl" / "env-server.mjs")
        self.max_plies = max_plies
        self.opponent = opponent
        self.start_mode = start_mode
        self.learner_side = learner_side
        self.opponent_model = opponent_model
        self.opening_plies = opening_plies
        self.rng = random.Random(seed)
        self.proc = subprocess.Popen(
            [node, self.server_path],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            text=True, bufsize=1,
        )
        self._seq = 0
        self.learner = 0
        self.state = None
        self.episode_steps = 0

        self.observation_space = spaces.Dict({
            "board": spaces.Box(0.0, 1.0, shape=(CHANNELS, ROWS, COLS), dtype=np.float32),
            "scalars": spaces.Box(-1.0, 1.0, shape=(4,), dtype=np.float32),
        })
        self.action_space = spaces.Discrete(N_ACTIONS)

    # ---------- IPC ----------
    def _call(self, op: str, **payload):
        self._seq += 1
        req = {"id": self._seq, "op": op, **payload}
        self.proc.stdin.write(json.dumps(req) + "\n")
        self.proc.stdin.flush()
        line = self.proc.stdout.readline()
        if not line:
            raise RuntimeError("env-server exited")
        msg = json.loads(line)
        if msg.get("id") != self._seq:
            raise RuntimeError(f"id mismatch: {msg}")
        if not msg.get("ok"):
            raise RuntimeError(f"server error: {msg}")
        return msg

    def close(self):
        try:
            self.proc.stdin.close()
            self.proc.kill()
        except Exception:
            pass

    # ---------- 观测 ----------
    def _obs(self, side=None):
        side = self.learner if side is None else side
        st = self.state
        board = np.zeros((CHANNELS, ROWS, COLS), dtype=np.float32)
        me = st["players"][side]
        opp = st["players"][1 - side]
        board[0, me["r"], me["c"]] = 1.0
        board[1, opp["r"], opp["c"]] = 1.0
        for c in range(COLS):
            if st["topWall"][c]:
                board[2, 0, c] = 1.0
        for c in range(9):
            for r in range(ROWS):
                if st["vWall"][c * ROWS + r]:
                    board[3, r, c] = 1.0
        for c in range(COLS):
            for r in range(11):
                if st["hWall"][c * 11 + r]:
                    board[4, r, c] = 1.0
        d0, d1 = st["dist"]
        dm = d0 if side == 0 else d1
        do = d1 if side == 0 else d0
        board[5] = min(dm / 30.0, 1.0)
        board[6] = min(do / 30.0, 1.0)
        board[7] = 1.0 if st["turn"] == side else 0.0
        wl = st["wallLimit"][side]
        wl = 30.0 if (wl is None or not np.isfinite(wl)) else float(wl)
        left = max(0, wl - st["wallsUsed"][side])
        board[8] = min(left / 30.0, 1.0)
        wl2 = st["wallLimit"][1 - side]
        wl2 = 30.0 if (wl2 is None or not np.isfinite(wl2)) else float(wl2)
        left2 = max(0, wl2 - st["wallsUsed"][1 - side])
        board[9] = min(left2 / 30.0, 1.0)

        margin = (do - dm) / 30.0
        scalars = np.array([
            margin,
            1.0 if side == 0 else 0.0,
            min(st["plies"] / self.max_plies, 1.0),
            0.0,
        ], dtype=np.float32)
        return {"board": board, "scalars": scalars}

    def _mask(self):
        res = self._call("mask", state=self.state)
        return np.asarray(res["mask"], dtype=bool)

    def action_masks(self):
        return self._mask()

    # ---------- 对手 ----------
    def _opponent_action(self):
        mask = self._mask()
        legal = np.flatnonzero(mask)
        moves = [int(i) for i in legal if int(i) < 4]
        if self.opponent == "model" and self.opponent_model is not None:
            obs = self._obs(1 - self.learner)
            action, _ = self.opponent_model.predict(obs, action_masks=mask, deterministic=True)
            return int(action)
        if self.opponent == "move_bias" and moves and self.rng.random() < 0.8:
            return int(self.rng.choice(moves))
        if self.opponent == "waller":
            # 会封墙的脚本：抽样合法墙，选最能拉长对手距离的一面；否则走子
            target = 1 - self.state["turn"]
            base = self.state["dist"][target]
            my_d = self.state["dist"][self.state["turn"]]
            walls = [int(i) for i in legal if int(i) >= 4]
            self.rng.shuffle(walls)
            # 优先考虑对手出口附近与正前方的墙
            op = self.state["players"][target]
            targeted = []
            for dc in (-1, 0, 1):
                c = op["c"] + dc
                if 0 <= c < 10:
                    targeted.append(222 + c)          # 封口
                    hr = max(0, op["r"] - 1)
                    targeted.append(112 + c * 11 + hr)  # 前方横墙
            for dc in (-1, 0):
                c = op["c"] + dc
                if 0 <= c < 9:
                    targeted.append(4 + c * 12 + op["r"])
            legal_set = set(int(i) for i in legal)
            cand = [i for i in targeted if i in legal_set]
            cand += [i for i in walls if i not in cand][:max(0, 16 - len(cand))]
            best, best_gain = None, 0
            for i in cand[:16]:
                r = self._call("step", state=self.state, index=i)
                if not r.get("ok"):
                    continue
                gain = r["state"]["dist"][target] - base
                if gain > best_gain:
                    best, best_gain = i, gain
            prob = 0.9 if base <= 3 else (0.6 if base < my_d else 0.3)
            if best is not None and best_gain > 0 and self.rng.random() < prob:
                return best
            # 退化为朝出口走
            st = self.state
            side = st["turn"]
            bm, bd = None, 10 ** 9
            for i in legal:
                if int(i) >= 4:
                    continue
                r = self._call("step", state=st, index=int(i))
                dd = r["state"]["dist"][side]
                if dd < bd:
                    bm, bd = int(i), dd
            if bm is not None:
                return bm
        if self.opponent == "path":
            # 优先走子，选离出口最近的方向；否则随机放墙
            st = self.state
            side = st["turn"]
            best, best_d = None, 10 ** 9
            for i in legal:
                a = _decode(int(i))
                if a["type"] != "move":
                    continue
                r = self._call("step", state=st, index=int(i))
                d = r["state"]["dist"][side]
                if d < best_d:
                    best, best_d = int(i), d
            if best is not None:
                return best
        return int(self.rng.choice(legal))

    def _apply(self, index: int):
        res = self._call("step", state=self.state, index=int(index))
        self.state = res["state"]
        self.episode_steps += 1
        return res

    def _reward(self):
        w = self.state["winner"]
        if w is None:
            return 0.0
        if w == "draw":
            return 0.0
        return 1.0 if w == self.learner else -1.0

    # ---------- Gym API ----------
    def reset(self, *, seed=None, options=None):
        super().reset(seed=seed)
        if seed is not None:
            self.rng.seed(seed)
        self.learner = self.learner_side if self.learner_side is not None else self.rng.randint(0, 1)
        res = self._call("reset", firstPlayer=0)
        self.state = res["state"]
        self.episode_steps = 0
        if self.start_mode == "short":
            # 短残局起点：双方靠近出口，容易产生自然终局
            for i in range(2):
                self.state["players"][i] = {"c": self.rng.randrange(10), "r": 2 + i}
            self.state["turn"] = self.learner
            self.state["winner"] = None
            self.state["plies"] = 0
        elif self.start_mode == "short_varied":
            # 短残局：优势/劣势与座位随机
            cells = set()
            for i in range(2):
                while True:
                    c, r = self.rng.randrange(10), self.rng.randrange(1, 6)
                    if (c, r) not in cells:
                        cells.add((c, r))
                        break
                self.state["players"][i] = {"c": c, "r": r}
            self.state["turn"] = self.learner
            self.state["winner"] = None
            self.state["plies"] = 0
        # 随机开局：推进若干手，增加评估局面多样性
        for _ in range(self.opening_plies):
            if self.state["winner"] is not None:
                break
            m = self._mask()
            legal = np.flatnonzero(m)
            if not len(legal):
                break
            self._apply(int(self.rng.choice(legal)))
        # 学习方后手：对手先在 reset 内走一手
        if self.state["winner"] is None and self.state["turn"] != self.learner:
            self._apply(self._opponent_action())
        return self._obs(), {}

    def step(self, action):
        if not self.action_space.contains(action):
            raise ValueError(f"bad action: {action}")
        if not bool(self._mask()[int(action)]):
            raise ValueError(f"illegal action: {action}")
        self._apply(int(action))
        terminated = self.state["winner"] is not None
        truncated = False
        if not terminated and self.state["turn"] != self.learner:
            self._apply(self._opponent_action())
            terminated = self.state["winner"] is not None
        if not terminated and self.episode_steps >= self.max_plies:
            truncated = True
        info = {}
        if truncated:
            info["TimeLimit.truncated"] = True
            info["terminal_observation"] = self._obs()
        return self._obs(), self._reward(), terminated, truncated, info


def main():
    env = DantengEnv(seed=0, max_plies=40)
    obs, _ = env.reset()
    print("obs board", obs["board"].shape, "mask", env.action_masks().sum())
    done = False
    steps = 0
    while not done:
        mask = env.action_masks()
        legal = np.flatnonzero(mask)
        obs, r, term, trunc, info = env.step(int(legal[0]))
        steps += 1
        done = term or trunc
    print("steps", steps, "reward", r, "term", term, "trunc", trunc, "winner", env.state["winner"])
    env.close()


if __name__ == "__main__":
    main()
