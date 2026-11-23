"""后台看守：训练快照出现后自动做独立评估（随机 / 最短路）。"""

import json
import time
from pathlib import Path

from sb3_contrib import MaskablePPO

from eval_model import play

OUT = Path(__file__).resolve().parents[2] / "_extract" / "rl2"
EVAL = OUT / "eval"
EVAL.mkdir(parents=True, exist_ok=True)

SNAPSHOTS = {
    "rl2b-2h.zip": "3h_total",
    "rl2b-5h.zip": "6h_total",
    "rl2b-11h.zip": "12h_total",
    "rl2b-final.zip": "final",
}

done = set()
deadline = time.time() + 12 * 3600
while time.time() < deadline:
    for name, label in SNAPSHOTS.items():
        if name in done:
            continue
        path = OUT / name
        if not path.exists():
            continue
        model = MaskablePPO.load(str(path), device="cpu")
        res = {}
        for opp in ("random", "path"):
            res[opp] = play(model, opp, 20, seed=123)
        (EVAL / f"{label}.json").write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"[eval] {label}: {json.dumps(res, ensure_ascii=False)}", flush=True)
        done.add(name)
    if len(done) == len(SNAPSHOTS):
        break
    time.sleep(60)
print("watcher done", flush=True)
