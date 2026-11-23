"""D0：快照指纹、参数差异、固定状态动作一致率与封墙概率。"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np
import torch
from sb3_contrib import MaskablePPO

from env import DantengEnv, N_ACTIONS

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "_extract" / "rl2" / "diag"
OUT.mkdir(parents=True, exist_ok=True)

PATHS = {
    "0h": ROOT / "_extract/rl2/rl2-0h.zip",
    "1h": ROOT / "_extract/rl2/rl2-1h.zip",
    "3h": ROOT / "_extract/rl2/rl2b-2h.zip",
    "6h": ROOT / "_extract/rl2/rl2b-5h.zip",
    "12h": ROOT / "_extract/rl2/rl2b-11h.zip",
}


def sha256(path: Path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def sample_states(n=200, seed=0):
    env = DantengEnv(seed=seed, opponent="random")
    rng = np.random.default_rng(seed)
    states = []
    try:
        for _ in range(n):
            obs, _ = env.reset()
            mask = env.action_masks()
            states.append((obs, mask))
    finally:
        env.close()
    return states


def wall_mass(model, obs, mask):
    obs_t, _ = model.policy.obs_to_tensor(obs)
    mask_t = torch.as_tensor(mask, dtype=torch.bool).unsqueeze(0)
    dist = model.policy.get_distribution(obs_t, action_masks=mask_t)
    probs = dist.distribution.probs.detach().cpu().numpy()[0]
    ent = float(-(probs * np.log(np.clip(probs, 1e-12, 1))).sum())
    return float(probs[4:].sum()), ent


def main():
    models = {k: MaskablePPO.load(str(v), device="cpu") for k, v in PATHS.items()}
    rows = []
    for name, path in PATHS.items():
        rows.append({"snapshot": name, "sha256": sha256(path)[:16], "size": path.stat().st_size})
    print("快照指纹：")
    for r in rows:
        print(r)

    params = {k: {n: p.detach().clone() for n, p in m.policy.named_parameters()} for k, m in models.items()}
    print("\n参数 L2 差异：")
    keys = sorted(params)
    for a, b in [("1h", "3h"), ("3h", "12h"), ("1h", "12h"), ("0h", "12h")]:
        total = 0.0
        for n in params[a]:
            total += float(((params[a][n] - params[b][n]) ** 2).sum())
        print(f"{a} vs {b}: {total ** 0.5:.4f}")

    states = sample_states(200)
    actions = {}
    masses = {}
    ents = {}
    for name, m in models.items():
        acts = []
        wm = []
        ent = []
        for obs, mask in states:
            a, _ = m.predict(obs, action_masks=mask, deterministic=True)
            acts.append(int(a))
            w, e = wall_mass(m, obs, mask)
            wm.append(w)
            ent.append(e)
        actions[name] = acts
        masses[name] = float(np.mean(wm))
        ents[name] = float(np.mean(ent))

    print("\n封墙概率质量 / 策略熵：")
    for name in keys:
        print(f"{name}: wall_mass={masses[name]:.4f} entropy={ents[name]:.3f}")

    print("\n贪心动作一致率：")
    for a, b in [("1h", "3h"), ("3h", "6h"), ("6h", "12h"), ("1h", "12h"), ("0h", "12h")]:
        agree = float(np.mean([x == y for x, y in zip(actions[a], actions[b])]))
        print(f"{a} vs {b}: {agree:.3f}")

    out = {"fingerprints": rows, "wall_mass": masses, "entropy": ents,
           "agreement": {f"{a}-{b}": float(np.mean([x == y for x, y in zip(actions[a], actions[b])]))
                         for a, b in [("1h", "3h"), ("3h", "6h"), ("6h", "12h"), ("1h", "12h"), ("0h", "12h")]}}
    (OUT / "d0-fingerprint.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
