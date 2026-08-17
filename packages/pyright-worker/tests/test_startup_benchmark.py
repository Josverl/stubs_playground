"""Startup cost benchmark for the published Pyright worker bundle.

Measures the four phases a consumer actually waits through on every worker
start, so regressions in bundle size, filesystem mounting, or first analysis
are visible instead of being hidden inside one opaque "ready" wait.
"""

from __future__ import annotations

import json
import os
import statistics
from pathlib import Path

import pytest

pytestmark = [pytest.mark.component, pytest.mark.worker]

_WORKER_JS = Path(__file__).parents[1] / "dist" / "pyright_worker.js"

requires_worker = pytest.mark.skipif(
    not _WORKER_JS.exists(),
    reason="Worker bundle not found. Run: npm run build:worker",
)

# Generous ceiling: this guards against gross regressions (for example a
# re-introduced synchronous decompression) without failing on slow CI hardware.
TOTAL_BUDGET_MS = 30_000

PHASES = ("workerLoad", "initServer", "lspInitialize", "firstAnalysis")


def _harness_url(project_server: str) -> str:
    return f"{project_server}/packages/pyright-worker/tests/startup-benchmark-harness.html"


def _measure(page, **options) -> dict:
    return page.evaluate("(options) => window.measureWorkerStartup(options)", options)


@pytest.fixture
def benchmark_page(page, project_server):
    page.goto(_harness_url(project_server))
    page.wait_for_function("() => window.__benchmarkReady === true")
    return page


@requires_worker
def test_worker_startup_cost_is_reported_per_phase(benchmark_page, record_property):
    """Report the startup breakdown and fail only on a gross regression."""
    runs = int(os.environ.get("WORKER_STARTUP_RUNS", "3"))
    samples = [_measure(benchmark_page, timeoutMs=TOTAL_BUDGET_MS * 4) for _ in range(runs)]

    for sample in samples:
        for phase in PHASES:
            assert phase in sample, f"missing phase {phase} in {sample}"

    summary = {phase: round(statistics.median(sample[phase] for sample in samples), 1) for phase in PHASES}
    summary["total"] = round(statistics.median(sample["total"] for sample in samples), 1)
    summary["runs"] = runs

    record_property("worker_startup_ms", json.dumps(summary))
    print(f"\nPyright worker startup (median ms over {runs} runs):")
    for phase in PHASES:
        share = 100 * summary[phase] / summary["total"]
        print(f"  {phase:<16}{summary[phase]:>9.1f} ms  ({share:4.1f}%)")
    print(f"  {'TOTAL':<16}{summary['total']:>9.1f} ms")

    worker_phases = samples[-1].get("startupTimings")
    if worker_phases:
        print("  initServer breakdown reported by the worker:")
        for name, value in worker_phases.items():
            print(f"    {name:<14}{value:>9.1f} ms")

    assert summary["total"] < TOTAL_BUDGET_MS, (
        f"worker startup regressed: {summary['total']:.0f} ms > {TOTAL_BUDGET_MS} ms ({summary})"
    )


@requires_worker
def test_worker_startup_does_not_depend_on_the_unused_typeshed_mount(benchmark_page):
    """A MicroPython-only typeshed path must not be slower than the full fallback."""
    fallback = _measure(benchmark_page, typeshedPath="/typeshed-fallback")
    micropython = _measure(benchmark_page, typeshedPath="/typeshed-micropython")

    print(
        f"\ntypeshed-fallback total={fallback['total']:.0f} ms "
        f"initServer={fallback['initServer']:.0f} ms\n"
        f"typeshed-micropython total={micropython['total']:.0f} ms "
        f"initServer={micropython['initServer']:.0f} ms"
    )

    assert micropython["initServer"] < TOTAL_BUDGET_MS
    assert fallback["initServer"] < TOTAL_BUDGET_MS


# The packaged typeshed ships only `stdlib/`; typeshed's third-party `stubs/` tree is
# excluded because it covers CPython-only packages and dominated the mount cost.
STDLIB_SOURCE = (
    "import json\n"
    "from dataclasses import dataclass\n"
    "from typing import Any\n"
    "\n"
    "\n"
    "@dataclass\n"
    "class Point:\n"
    "    x: int\n"
    "    y: int\n"
    "\n"
    "\n"
    "def encode(value: Any) -> str:\n"
    "    return json.dumps(value)\n"
    "\n"
    "\n"
    "point = Point(1, 2)\n"
    "text: str = encode({'x': point.x})\n"
)


@requires_worker
def test_packaged_typeshed_still_resolves_the_standard_library(benchmark_page):
    """Dropping typeshed's third-party stubs must not break stdlib type resolution."""
    result = _measure(benchmark_page, code=STDLIB_SOURCE)

    messages = [d["message"] for d in result["diagnostics"]]
    assert messages == [], f"stdlib source produced diagnostics: {messages}"


@requires_worker
def test_packaged_typeshed_still_reports_standard_library_type_errors(benchmark_page):
    """Stdlib stubs must be real types, not permissive stand-ins."""
    result = _measure(benchmark_page, code="import json\n\nvalue: int = json.dumps({})\n")

    messages = [d["message"] for d in result["diagnostics"]]
    assert any("not assignable" in message for message in messages), messages


# MicroPython's json.dump accepts `separators` as a third positional argument;
# CPython's signature makes everything after `fp` keyword-only.
MICROPYTHON_JSON_SOURCE = (
    "import json\n\nwith open('data.json', 'w') as file:\n    json.dump({'a': 1}, file, (',', ':'))\n"
)


@requires_worker
def test_micropython_stdlib_stubs_are_used_for_the_micropython_typeshed_path(benchmark_page):
    """`/typeshed-micropython` must resolve to micropython-stdlib-stubs, not CPython typeshed."""
    micropython = _measure(
        benchmark_page,
        code=MICROPYTHON_JSON_SOURCE,
        typeshedPath="/typeshed-micropython",
    )
    assert [d["message"] for d in micropython["diagnostics"]] == []

    cpython = _measure(
        benchmark_page,
        code=MICROPYTHON_JSON_SOURCE,
        typeshedPath="/typeshed-fallback",
    )
    assert any("positional" in d["message"] for d in cpython["diagnostics"]), cpython["diagnostics"]
