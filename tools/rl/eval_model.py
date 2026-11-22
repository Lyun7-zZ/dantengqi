"""对训练快照做独立棋力评估（对手：随机 / 最短路）。"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from sb3_contrib import MaskablePPO

from env import DantengEnv

ROOT = Path(__file__).resolve().parents[2]


def play(model, opponent: str, games: int, seed: int, save_games: int = 0, out_dir: Path | None = None):
    env = DantengEnv(seed=seed, opponent=opponent)
    rng = np.random.default_rng(seed)
    stats = {"W": 0, "D": 0, "L": 0, "T": 0, "seats": {0: [0, 0, 0, 0], 1: [0, 0, 0, 0]}}
    records = []
    try:
        for g in range(games):
            obs, _ = env.reset()
            done = False
            moves = []
            seat = env.learner
            while not done:
                mask = env.action_masks()
                action, _ = model.predict(obs, action_masks=mask, deterministic=True)
                a = int(action)
                moves.append({"ply": env.state["plies"], "seat": seat, "action": a})
                obs, r, term, trunc, info = env.step(a)
                done = term or trunc
            if term:
                if r > 0:
                    stats["W"] += 1
                elif r < 0:
                    stats["L"] += 1
                else:
                    stats["D"] += 1
            else:
                stats["T"] += 1
            idx = 0 if term and r > 0 else (1 if term and r < 0 else (2 if term else 3))
            stats["seats"][seat][idx] += 1
            if len(records) < save_games:
                records.append({
                    "game": g, "seat": seat, "winner": env.state["winner"],
                    "plies": env.state["plies"],
                    "moves": moves,
                })
    finally:
        env.close()
    if out_dir and records:
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / f"games-{opponent}-seed{seed}.json").write_text(
            json.dumps(records, ensure_ascii=False, indent=1), encoding="utf-8")
    return stats


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--games", type=int, default=20)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--opponents", default="random,path")
    ap.add_argument("--save-games", type=int, default=0)
    args = ap.parse_args()
    model = MaskablePPO.load(args.model, device="cpu")
    out_dir = ROOT / "_extract" / "rl2" / "eval"
    for opp in args.opponents.split(","):
        s = play(model, opp, args.games, args.seed, args.save_games, out_dir)
        total = s["W"] + s["D"] + s["L"] + s["T"]
        print(f"{opp:8s} W {s['W']:2d} D {s['D']:2d} L {s['L']:2d} T {s['T']:2d} "
              f"score {(s['W'] + 0.5 * s['D']) / max(total, 1):.3f} "
              f"seats {s['seats']}")


if __name__ == "__main__":
    main()
