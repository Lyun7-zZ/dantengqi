"""RL2：12 小时限额训练（课程 A）。

- 3 个环境：短残局 + 走子偏置对手
- 1 个环境：正常起点 + 随机对手（保留多样性）
- 快照：0 / 1 / 3 / 6 / 12 小时
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np
from stable_baselines3.common.callbacks import BaseCallback
from stable_baselines3.common.vec_env import DummyVecEnv, SubprocVecEnv, VecMonitor
from sb3_contrib import MaskablePPO

from env import DantengEnv, N_ACTIONS
from rl1_bench import CNNExtractor

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "_extract" / "rl2"
OUT.mkdir(parents=True, exist_ok=True)


def make_env(seed: int, start_mode: str, opponent: str):
    def thunk():
        return DantengEnv(seed=seed, max_plies=240, opponent=opponent, start_mode=start_mode)
    return thunk


def build_vec(seed: int = 0, curriculum: str = "A"):
    if curriculum == "E1":
        configs = [
            ("normal", "waller"),
            ("normal", "waller"),
            ("normal", "path"),
            ("short_varied", "move_bias"),
        ]
    elif curriculum == "B":
        configs = [
            ("normal", "path"),
            ("normal", "path"),
            ("normal", "move_bias"),
            ("short_varied", "move_bias"),
        ]
    else:
        configs = [
            ("short", "move_bias"),
            ("short", "move_bias"),
            ("short", "move_bias"),
            ("normal", "random"),
        ]
    fns = [make_env(seed + i, mode, opp) for i, (mode, opp) in enumerate(configs)]
    return VecMonitor(SubprocVecEnv(fns))


class TrainLog(BaseCallback):
    def __init__(self, checkpoints_min: list[float], total_min: float, tag: str):
        super().__init__()
        self.checkpoints = sorted(checkpoints_min)
        self.total_sec = total_min * 60
        self.tag = tag
        self.t0 = None
        self.next_idx = 0
        self.term = 0
        self.trunc = 0
        self.nonzero = 0
        self.win = 0
        self.draw = 0
        self.loss = 0
        self.games = 0
        self.log_path = OUT / f"{tag}.jsonl"
        self.last_log = 0.0

    def _on_training_start(self):
        self.t0 = time.time()
        while self.next_idx < len(self.checkpoints) and self.checkpoints[self.next_idx] <= 0:
            self._save_snapshot("0h")
            self.next_idx += 1

    def _on_step(self):
        elapsed = time.time() - self.t0
        dones = self.locals.get("dones")
        infos = self.locals.get("infos")
        rewards = self.locals.get("rewards")
        if dones is not None:
            for i, done in enumerate(dones):
                if not done:
                    continue
                self.games += 1
                info = infos[i] if infos is not None else {}
                if info.get("TimeLimit.truncated"):
                    self.trunc += 1
                else:
                    self.term += 1
                    if rewards is not None:
                        r = float(rewards[i])
                        if r > 0:
                            self.win += 1
                        elif r < 0:
                            self.loss += 1
                        else:
                            self.draw += 1
                if rewards is not None and float(rewards[i]) != 0.0:
                    self.nonzero += 1
        while self.next_idx < len(self.checkpoints) and elapsed >= self.checkpoints[self.next_idx] * 60:
            mins = self.checkpoints[self.next_idx]
            label = f"{mins:g}min" if mins < 60 else f"{mins/60:g}h"
            self._save_snapshot(label)
            self.next_idx += 1
        if elapsed - self.last_log >= 300:  # 每 5 分钟落一行
            self.last_log = elapsed
            self._log(elapsed)
        if elapsed > 3600 and self.term == 0:
            self._save_snapshot("stall-1h")
            print("[stall] 首小时无自然终局，暂停", flush=True)
            return False
        return elapsed < self.total_sec

    def _log(self, elapsed):
        rec = {
            "t": round(elapsed, 1),
            "steps": int(self.model.num_timesteps),
            "steps_per_sec": round(self.model.num_timesteps / max(elapsed, 1), 1),
            "games": self.games,
            "terminal": self.term,
            "truncated": self.trunc,
            "nonzero_reward": self.nonzero,
            "wins": self.win,
            "draws": self.draw,
            "losses": self.loss,
            "terminal_rate": round(self.term / max(self.games, 1), 3),
            "nonzero_rate": round(self.nonzero / max(self.games, 1), 3),
            "entropy_loss": self._f("train/entropy_loss"),
            "approx_kl": self._f("train/approx_kl"),
            "value_loss": self._f("train/value_loss"),
        }
        with self.log_path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")

    def _f(self, key):
        v = self.logger.name_to_value.get(key)
        return None if v is None else float(v)

    def _save_snapshot(self, label: str):
        path = OUT / f"{self.tag}-{label}.zip"
        self.model.save(str(path))
        self._log(time.time() - self.t0)
        print(f"[snapshot] {path} steps={self.model.num_timesteps} games={self.games} "
              f"term={self.term} trunc={self.trunc} nonzero={self.nonzero}", flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--minutes", type=float, default=720)
    ap.add_argument("--checkpoints", default="0,60,180,360,720")
    ap.add_argument("--tag", default="rl2")
    ap.add_argument("--curriculum", choices=["A", "B", "E1"], default="A")
    ap.add_argument("--resume", default="")
    ap.add_argument("--ent-coef", type=float, default=0.0)
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()
    cps = [float(x) for x in args.checkpoints.split(",")]
    cps = [c for c in cps if c <= args.minutes]

    vec = build_vec(args.seed, args.curriculum)
    if args.resume:
        model = MaskablePPO.load(args.resume, env=vec, device="cpu")
        model.ent_coef = args.ent_coef
        print(f"resumed from {args.resume} ent_coef={model.ent_coef}", flush=True)
    else:
        model = MaskablePPO(
        "MultiInputPolicy",
        vec,
        verbose=0,
        seed=args.seed,
        n_steps=1024,
        batch_size=256,
        learning_rate=3e-4,
        gamma=0.995,
        gae_lambda=0.95,
        clip_range=0.2,
        ent_coef=args.ent_coef,
        n_epochs=5,
        policy_kwargs=dict(
            features_extractor_class=CNNExtractor,
            features_extractor_kwargs=dict(features_dim=128),
            net_arch=dict(pi=[128], vf=[128]),
        ),
        device="cpu",
        tensorboard_log=None,
        )
    cb = TrainLog(cps, args.minutes, args.tag)
    model.learn(total_timesteps=10**9, callback=cb, progress_bar=False)
    cb._save_snapshot("final")
    vec.close()
    print("done", model.num_timesteps, flush=True)


if __name__ == "__main__":
    main()
