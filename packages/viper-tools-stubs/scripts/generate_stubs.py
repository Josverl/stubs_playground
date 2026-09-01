#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "mypy==2.3.1",
# ]
# ///
"""Generate ViperIDE viper-tools stubs from a pinned upstream revision."""

from __future__ import annotations

import argparse
import hashlib
import shutil
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

UPSTREAM_REPOSITORY = "vshymanskyy/ViperIDE"
UPSTREAM_VERSION = "0.1.2"
UPSTREAM_COMMIT = "d8c78f1f61b92cb6e98788f6ae88cc93925db51f"
UPSTREAM_FILES = {
    "ble_nus.py": "a8239db1f11221e46e8f39cc77b70802aa546c42",
    "ble_repl.py": "c77ab7fb56c831e4117723c51bf7653dc6904461",
    "web_repl.py": "704c77b657c9035b46be7896354bfd6097d479ea",
    "ws_client.py": "bd1bacf6ad5a92d3822a5cac82009e07d8ba866c",
    "wss_repl.py": "df761cecc466e32f24a72d83b7affa873f85f491",
}

PACKAGE_ROOT = Path(__file__).resolve().parents[1]
STUBS_DIR = PACKAGE_ROOT / "stubs"


def git_blob_sha1(content: bytes) -> str:
    """Return the Git object ID for file content."""
    header = f"blob {len(content)}\0".encode()
    return hashlib.sha1(header + content).hexdigest()


def download_sources(destination: Path) -> list[Path]:
    """Download and verify the pinned upstream Python sources."""
    sources = []
    for filename, expected_sha in UPSTREAM_FILES.items():
        url = (
            f"https://raw.githubusercontent.com/{UPSTREAM_REPOSITORY}/"
            f"{UPSTREAM_COMMIT}/packages/viper-tools/{filename}"
        )
        try:
            with urllib.request.urlopen(url, timeout=30) as response:
                content = response.read()
        except OSError as error:
            raise RuntimeError(f"failed to download {url}: {error}") from error

        actual_sha = git_blob_sha1(content)
        if actual_sha != expected_sha:
            raise RuntimeError(f"{filename}: expected Git blob {expected_sha}, got {actual_sha}")

        source = destination / filename
        source.write_bytes(content)
        sources.append(source)
    return sources


def run_stubgen(sources: list[Path], destination: Path) -> None:
    """Generate draft stubs without importing MicroPython-only modules."""
    command = [
        str(Path(sys.executable).with_name("stubgen")),
        "--no-import",
        "--ignore-errors",
        "--include-private",
        "--include-docstrings",
        "--output",
        str(destination),
        *(str(source) for source in sources),
    ]
    subprocess.run(command, check=True)


def generated_stubs(directory: Path) -> dict[str, bytes]:
    """Read and validate the complete generated stub set."""
    expected = {Path(filename).with_suffix(".pyi").name for filename in UPSTREAM_FILES}
    actual = {path.name for path in directory.glob("*.pyi")}
    if actual != expected:
        raise RuntimeError(f"stubgen produced {sorted(actual)}; expected {sorted(expected)}")
    return {name: (directory / name).read_bytes() for name in sorted(actual)}


def update_stubs(stubs: dict[str, bytes], *, check: bool) -> bool:
    """Check or replace the committed generated stubs."""
    packaged = {}
    for filename, content in stubs.items():
        module = Path(filename).stem
        packaged[f"{module}/__init__.pyi"] = content
        packaged[f"{module}/py.typed"] = b""
    current = {
        path.relative_to(STUBS_DIR).as_posix(): path.read_bytes()
        for path in STUBS_DIR.rglob("*")
        if path.is_file()
    }
    if current == packaged:
        return False
    if check:
        return True

    if STUBS_DIR.exists():
        shutil.rmtree(STUBS_DIR)
    for name, content in packaged.items():
        destination = STUBS_DIR / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(content)
    return True


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="fail if regenerating would change the committed stubs",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    with tempfile.TemporaryDirectory(prefix="viper-tools-stubs-") as temp:
        temp_dir = Path(temp)
        sources_dir = temp_dir / "sources"
        output_dir = temp_dir / "stubs"
        sources_dir.mkdir()
        sources = download_sources(sources_dir)
        run_stubgen(sources, output_dir)
        changed = update_stubs(generated_stubs(output_dir), check=args.check)

    if args.check and changed:
        print("Generated stubs differ. Run scripts/generate_stubs.py.", file=sys.stderr)
        return 1
    print(f"{'Checked' if args.check else 'Generated'} stubs for viper-tools {UPSTREAM_VERSION}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
