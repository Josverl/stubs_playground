#!/usr/bin/env python3
"""Run mount-once.mjs in a fresh process N times; report min/median/mean."""

import json
import statistics
import subprocess
import sys
from pathlib import Path

RUNS = int(sys.argv[1]) if len(sys.argv) > 1 else 11

STACKS = {
    "archives 1.0.5 + core 1.11.4": Path("/tmp/zbench-old"),
    "archives 1.4.3 + core 2.6.3": Path("/tmp/zbench"),
}
ARCHIVES = ["typeshed-full.zip", "typeshed-stdlib.zip"]

results = {}
for stack, cwd in STACKS.items():
    modes = ["eager"] if "1.0.5" in stack else ["eager", "lazy"]
    for archive in ARCHIVES:
        for mode in modes:
            cmd = ["node", "mount-once.mjs", archive] + (["--lazy"] if mode == "lazy" else [])
            times = []
            for _ in range(RUNS):
                out = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, check=True)
                times.append(float(out.stdout.strip()))
            results[f"{stack}|{archive}|{mode}"] = times
            print(
                f"{stack:30} {archive:20} {mode:6} "
                f"min={min(times):7.1f}  median={statistics.median(times):7.1f}  "
                f"mean={statistics.mean(times):7.1f}  max={max(times):7.1f}"
            )

Path("/tmp/zbench/results.json").write_text(json.dumps(results, indent=2))
print("\nwrote /tmp/zbench/results.json")
