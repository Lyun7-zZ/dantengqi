"""合并多个自对弈 JSONL 分片。

用法：python tools/merge-selfplay.py 输出.jsonl 分片1.jsonl 分片2.jsonl ...
"""

import sys

if len(sys.argv) < 3:
    print("用法：merge-selfplay.py <输出> <分片...>")
    raise SystemExit(1)

out = sys.argv[1]
files = sys.argv[2:]
n = 0
with open(out, "w", encoding="utf-8") as f:
    for path in files:
        with open(path, encoding="utf-8") as src:
            for line in src:
                line = line.strip()
                if not line:
                    continue
                f.write(line + "\n")
                n += 1
print(f"写入 {out}：{n} 行，来自 {len(files)} 个分片")
