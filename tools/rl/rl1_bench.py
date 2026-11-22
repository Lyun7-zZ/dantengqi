"""RL1：Maskable PPO 端到端吞吐与冒烟训练。

用法：
  python rl1_bench.py --mode bench --workers 1 --seconds 60
  python rl1_bench.py --mode smoke --seconds 120
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from gymnasium import spaces
from stable_baselines3.common.callbacks import BaseCallback
from stable_baselines3.common.torch_layers import BaseFeaturesExtractor
from stable_baselines3.common.vec_env import DummyVecEnv, SubprocVecEnv, VecMonitor
from sb3_contrib import MaskablePPO

from env import DantengEnv, N_ACTIONS, CHANNELS

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "_extract"


class CNNExtractor(BaseFeaturesExtractor):
    def __init__(self, observation_space: spaces.Dict, features_dim: int = 128):
        super().__init__(observation_space, features_dim)
        c = observation_space["board"].shape[0]
        self.cnn = nn.Sequential(
            nn.Conv2d(c, 16, 3, padding=1), nn.ReLU(),
            nn.Conv2d(16, 32, 3, padding=1), nn.ReLU(),
            nn.Flatten(),
        )
        with torch.no_grad():
            n = self.cnn(torch.zeros(1, c, 12, 10)).shape[1]
        self.fc = nn.Sequential(nn.Linear(n + 4, features_dim), nn.ReLU())

    def forward(self, obs):
        return self.fc(torch.cat([self.cnn(obs["board"]), obs["scalars"]], dim=1))


class StopAtTime(BaseCallback):
    def __init__(self, seconds: float):
        super().__init__()
        self.seconds = seconds
        self.t0 = None

    def _on_training_start(self):
        self.t0 = time.time()

    def _on_step(self):
        return (time.time() - self.t0) < self.seconds


def make_env(seed: int, max_plies: int = 240, opponent: str = "random"):
    def thunk():
        return DantengEnv(seed=seed, max_plies=max_plies, opponent=opponent)
    return thunk


def build_vec(workers: int, seed: int = 0):
    fns = [make_env(seed + i) for i in range(workers)]
    if workers == 1:
        vec = DummyVecEnv(fns)
    else:
        vec = SubprocVecEnv(fns)
    return VecMonitor(vec)


def build_model(vec, *, seed=0, n_steps=512, batch_size=128, lr=3e-4, gamma=0.995, gae_lambda=0.95, clip=0.2):
    return MaskablePPO(
        "MultiInputPolicy",
        vec,
        verbose=0,
        seed=seed,
        n_steps=n_steps,
        batch_size=batch_size,
        learning_rate=lr,
        gamma=gamma,
        gae_lambda=gae_lambda,
        clip_range=clip,
        n_epochs=5,
        policy_kwargs=dict(
            features_extractor_class=CNNExtractor,
            features_extractor_kwargs=dict(features_dim=128),
            net_arch=dict(pi=[128], vf=[128]),
        ),
        device="cpu",
    )


def param_checksum(model) -> float:
    total = 0.0
    for p in model.policy.parameters():
        total += float(p.detach().abs().sum())
    return total


def run(mode: str, workers: int, seconds: float, seed: int):
    vec = build_vec(workers, seed)
    model = build_model(vec, seed=seed)
    before = param_checksum(model)
    cb = StopAtTime(seconds)
    t0 = time.time()
    model.learn(total_timesteps=10**9, callback=cb, progress_bar=False)
    elapsed = time.time() - t0
    steps = int(model.num_timesteps)
    after = param_checksum(model)
    result = {
        "mode": mode,
        "workers": workers,
        "seconds": round(elapsed, 1),
        "learner_steps": steps,
        "steps_per_sec": round(steps / elapsed, 1),
        "param_checksum_before": before,
        "param_checksum_after": after,
        "params_changed": abs(after - before) > 1e-6,
        "n_steps": model.n_steps,
        "batch_size": model.batch_size,
        "lr": model.learning_rate if isinstance(model.learning_rate, float) else float(model.learning_rate(1.0)),
        "gamma": model.gamma,
        "gae_lambda": model.gae_lambda,
    }
    vec.close()
    print(json.dumps(result, ensure_ascii=False))
    return result


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", choices=["bench", "smoke"], default="bench")
    ap.add_argument("--workers", type=int, default=1)
    ap.add_argument("--seconds", type=float, default=60)
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()
    OUT.mkdir(exist_ok=True)
    res = run(args.mode, args.workers, args.seconds, args.seed)
    tag = f"{args.mode}-w{args.workers}"
    (OUT / f"rl1-{tag}.json").write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
    if args.mode == "smoke":
        return
    print("RESULT", tag, res["steps_per_sec"])


if __name__ == "__main__":
    main()
