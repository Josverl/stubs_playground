#!/usr/bin/env python3
"""Steady-state mount matrix: one process per config, warmup + forced GC."""

import json
import statistics
import subprocess
import sys
from pathlib import Path

WARMUP = 3
MEASURED = int(sys.argv[1]) if len(sys.argv) > 1 else 15
REPEATS = int(sys.argv[2]) if len(sys.argv) > 2 else 3  # independent processes per config

STACKS = {
    "archives 1.0.5 + core 1.11.4": Path("/tmp/zbench-old"),
    "archives 1.4.3 + core 2.6.3": Path("/tmp/zbench"),
}
ARCHIVES = ["typeshed-full.zip", "typeshed-stdlib.zip"]

results = {}
print(f"warmup={WARMUP} measured={MEASURED} processes={REPEATS} (pooled)\n")
for stack, cwd in STACKS.items():
    modes = ["eager"] if "1.0.5" in stack else ["eager", "lazy"]
    for archive in ARCHIVES:
        for mode in modes:
            cmd = ["node", "--expose-gc", "bench-steady.mjs", archive, str(WARMUP), str(MEASURED)] + (
                ["--lazy"] if mode == "lazy" else []
            )
            pooled = []
            for _ in range(REPEATS):
                out = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, check=True)
                pooled.extend(json.loads(out.stdout.strip()))
            results[f"{stack}|{archive}|{mode}"] = pooled
            print(
                f"{stack:30} {archive:20} {mode:6} n={len(pooled):3} "
                f"min={min(pooled):7.1f}  median={statistics.median(pooled):7.1f}  "
                f"mean={statistics.mean(pooled):7.1f}  stdev={statistics.stdev(pooled):6.1f}"
            )

Path("/tmp/zbench/results-steady.json").write_text(json.dumps(results, indent=2))

print("\n=== Ratios (1.0.5 eager as baseline) ===")
for archive in ARCHIVES:
    base = statistics.median(results[f"archives 1.0.5 + core 1.11.4|{archive}|eager"])
    for mode in ["eager", "lazy"]:
        new = statistics.median(results[f"archives 1.4.3 + core 2.6.3|{archive}|{mode}"])
        verdict = "faster" if new < base else "SLOWER"
        print(f"{archive:20} 1.4.3 {mode:6}: {base:7.1f} -> {new:7.1f} ms  ({base / new:5.2f}x {verdict})")
