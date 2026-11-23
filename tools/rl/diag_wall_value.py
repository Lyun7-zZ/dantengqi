"""D1：在有「墙更优」教师证据的局面上，检查各快照的实际封墙行为。"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import torch
from sb3_contrib import MaskablePPO

from env import DantengEnv, N_ACTIONS

ROOT = Path(__file__).resolve().parents[2]
ROWS = ROOT / "_extract/labels2-all.jsonl"

MOVES = ["up", "down", "left", "right"]


def encode(a):
    if a["type"] == "move":
        return MOVES.index(a["dir"])
    if a["kind"] == "v":
        return 4 + a["c"] * 12 + a["r"]
    if a["kind"] == "h":
        return 112 + a["c"] * 11 + a["r"]
    return 222 + a["c"]


def bfs_dist(state, side):
    rows, cols = 12, 10
    start = state["players"][side]
    dist = [[-1] * cols for _ in range(rows)]
    q = [(start["c"], start["r"])]
    dist[start["r"]][start["c"]] = 0
    head = 0
    while head < len(q):
        c, r = q[head]
        head += 1
        d = dist[r][c]
        if r == 0 and state["topWall"][c] == 0:
            return d + 1
        nbrs = []
        if r > 0 and state["hWall"][c * 11 + (r - 1)] == 0:
            nbrs.append((c, r - 1))
        if r < 11 and state["hWall"][c * 11 + r] == 0:
            nbrs.append((c, r + 1))
        if c > 0 and state["vWall"][(c - 1) * 12 + r] == 0:
            nbrs.append((c - 1, r))
        if c < 9 and state["vWall"][c * 12 + r] == 0:
            nbrs.append((c + 1, r))
        for nc, nr in nbrs:
            if dist[nr][nc] == -1:
                dist[nr][nc] = d + 1
                q.append((nc, nr))
    return 30


def load_positions(min_gap=50, limit=120):
    out = []
    for line in ROWS.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        items = sorted(row["items"], key=lambda x: -x["score"])
        best = items[0]
        if best["action"]["type"] == "move":
            continue
        best_move = max((i["score"] for i in items if i["action"]["type"] == "move"), default=None)
        if best_move is None or best["score"] - best_move < min_gap:
            continue
        out.append(row)
        if len(out) >= limit:
            break
    return out


def make_env_state(row):
    st = row["state"]
    return {
        "vWall": st["vWall"], "hWall": st["hWall"], "topWall": st["topWall"],
        "players": st["players"], "turn": st["turn"], "firstPlayer": st["firstPlayer"],
        "wallsPlaced": st["wallsPlaced"], "wallLimit": [9999, 9999], "wallsUsed": [0, 0],
        "tolerance": 1, "drawMode": "firstOnly", "winner": None, "plies": row["ply"],
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", required=True, help="name=path,...")
    ap.add_argument("--out", default="")
    args = ap.parse_args()
    rows = load_positions()
    print(f"D1 局面：{len(rows)} 个（最佳着法为墙，领先最佳走子 ≥50）")

    models = {}
    for part in args.models.split(","):
        name, path = part.split("=")
        models[name] = MaskablePPO.load(path, device="cpu")

    env = DantengEnv(seed=0, opponent="random")
    results = {}
    try:
        for name, model in models.items():
            wall_mass = []
            p_best = []
            rank_best = []
            greedy_wall = []
            match_best = []
            for row in rows:
                st = make_env_state(row)
                st["dist"] = [bfs_dist(st, 0), bfs_dist(st, 1)]
                env.state = st
                env.learner = st["turn"]
                obs = env._obs()
                mask = env.action_masks()
                obs_t, _ = model.policy.obs_to_tensor(obs)
                mask_t = torch.as_tensor(mask, dtype=torch.bool).unsqueeze(0)
                dist = model.policy.get_distribution(obs_t, action_masks=mask_t)
                probs = dist.distribution.probs.detach().cpu().numpy()[0]
                wall_mass.append(float(probs[4:].sum()))
                best_action = sorted(row["items"], key=lambda x: -x["score"])[0]["action"]
                bi = encode(best_action)
                p_best.append(float(probs[bi]))
                rank_best.append(int((probs > probs[bi]).sum()) + 1)
                g = int(np.argmax(probs))
                greedy_wall.append(1 if g >= 4 else 0)
                match_best.append(1 if g == bi else 0)
            results[name] = {
                "n": len(rows),
                "wall_mass": round(float(np.mean(wall_mass)), 4),
                "p_teacher_best_wall": round(float(np.mean(p_best)), 4),
                "mean_rank_best_wall": round(float(np.mean(rank_best)), 2),
                "greedy_wall_rate": round(float(np.mean(greedy_wall)), 3),
                "greedy_matches_teacher": round(float(np.mean(match_best)), 3),
            }
            print(name, json.dumps(results[name], ensure_ascii=False))
    finally:
        env.close()
    if args.out:
        Path(args.out).write_text(json.dumps(results, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
