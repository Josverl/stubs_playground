#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# ///
"""Pack MicroPython board stubs into zip files for browser use.

For each board defined below:
  1. Install stubs via `uv pip install micropython-{board}-stubs --target ./tmp`
  2. Zip the .pyi files and packages (skip dist-info metadata)
  3. Write to assets/stubs-{board}.zip
  4. Generate assets/stubs-manifest.json

Usage: uv run scripts/pack-stubs.py [board...]
  No args -> pack all boards.  Pass board IDs to pack specific ones.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import zipfile
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
TMP = ROOT / "tmp_stubs"


@dataclass
class Board:
    id: str
    package: str
    file: str | None = None
    package_version: str = ""


DEFAULT_BOARD_ID = "esp32"


# Boards that have installable stub packages
BOARDS: list[Board] = [
    Board(id="stdlib",  package="micropython-stdlib-stubs"), # Used for stdlib only
    Board(id="esp32", package="micropython-esp32-stubs"),
    Board(id="rp2",   package="micropython-rp2-stubs"),
    Board(id="stm32", package="micropython-stm32-stubs"),
    Board(id="samd",  package="micropython-samd-stubs"),
    Board(id="circuitpython",  package="circuitpython-stubs"),
]

# Virtual boards (no stub package, included in manifest only)
VIRTUAL_BOARDS: list[Board] = [
    Board(id="cpython", package="No Stubs"),
]

BOARD_MAP = {b.id: b for b in BOARDS}


def get_installed_version(target_dir: Path, package: str) -> str:
    """Read the installed version from the .dist-info/METADATA file."""
    # dist-info directory names use underscores for the package part and a
    # literal hyphen as the separator before the version, e.g.:
    #   micropython_esp32_stubs-1.28.0.post1.dist-info
    # Normalise the *package name* only (replace hyphens with underscores).
    norm = package.replace("-", "_").lower()
    for entry in target_dir.iterdir():
        if not (entry.is_dir() and entry.name.endswith(".dist-info")):
            continue
        # Strip the ".dist-info" suffix and split on the first "-" that
        # separates the normalised package name from the version string.
        stem = entry.name[: -len(".dist-info")]
        if "-" not in stem:
            continue
        pkg_part, _version_part = stem.split("-", 1)
        if pkg_part.lower() != norm:
            continue
        metadata = entry / "METADATA"
        if metadata.exists():
            for line in metadata.read_text(encoding="utf-8").splitlines():
                if line.startswith("Version:"):
                    return line.split(":", 1)[1].strip()
    return ""


def zip_directory(source_dir: Path, out_path: Path, metadata: dict | None = None) -> int:
    """Zip a directory, skipping .dist-info folders. Returns size in bytes.

    If *metadata* is provided, a ``stubs-metadata.json`` entry is written
    into the archive so the browser worker can read the package provenance.
    """
    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        if metadata:
            zf.writestr("stubs-metadata.json", json.dumps(metadata, indent=2) + "\n")
        for entry in sorted(source_dir.iterdir()):
            if entry.name.endswith(".dist-info"):
                continue
            if entry.is_dir():
                for root_dir, _dirs, files in os.walk(entry):
                    for f in files:
                        full = Path(root_dir) / f
                        arcname = full.relative_to(source_dir)
                        zf.write(full, arcname)
            else:
                zf.write(entry, entry.name)
    return out_path.stat().st_size


def get_zip_embedded_version(zip_path: Path) -> str:
    """Return the version stored in stubs-metadata.json inside a zip, or ''."""
    if not zip_path.exists():
        return ""
    try:
        with zipfile.ZipFile(zip_path) as zf:
            if "stubs-metadata.json" not in zf.namelist():
                return ""
            data = json.loads(zf.read("stubs-metadata.json"))
            return data.get("version", "")
    except Exception:
        return ""


def pack_board(board: Board) -> Board:
    """Install stubs and pack them into a zip. Returns updated board."""
    target = TMP / board.id
    out_path = ASSETS / f"stubs-{board.id}.zip"

    # Install stubs to a temp dir so we can read the exact version.
    if target.exists():
        shutil.rmtree(target)
    target.mkdir(parents=True)

    print(f"  Installing {board.package}...")
    # hack for circuitpython-stubs that do not include stdlib
    if board.id == "circuitpython":
        # Add the micropython-stdlib-stubs as  circuitpython-stubs do not include stdlib stubs.
        subprocess.run(
            ["uv", "pip", "install", "micropython-stdlib-stubs", "--target", str(target), "--quiet"],
            check=True,
            capture_output=True,
            text=True,
        )
        # Add (rp2) time.pyi, as this is not in micropython-stdlib-stubs
        shutil.copyfile( ASSETS / "time.pyi", target / "time.pyi" )

    subprocess.run(
        ["uv", "pip", "install", board.package, "--target", str(target), "--quiet"],
        check=True,
        capture_output=True,
        text=True,
    )

    # Capture exact installed version
    board.package_version = get_installed_version(target, board.package)
    if board.package_version:
        print(f"  Version: {board.package_version}")

    # Skip re-zipping when the existing zip already contains the same version.
    cached_version = get_zip_embedded_version(out_path)
    if cached_version and cached_version == board.package_version and out_path.exists():
        print(f"  Up-to-date, skipping zip  ({out_path.stat().st_size / 1024:.0f} KB)")
        board.file = f"stubs-{board.id}.zip"
        return board

    # Zip (embed provenance metadata inside the archive)
    pkg_metadata = {
        "package": board.package,
        "version": board.package_version,
    }
    size = zip_directory(target, out_path, metadata=pkg_metadata)
    print(f"  → assets/stubs-{board.id}.zip  ({size / 1024:.0f} KB)")

    board.file = f"stubs-{board.id}.zip"
    return board


def main() -> None:
    requested_ids = sys.argv[1:]
    boards = (
        [b for b in BOARDS if b.id in requested_ids] if requested_ids else list(BOARDS)
    )

    if requested_ids and not boards:
        available = ", ".join(b.id for b in BOARDS)
        print(f"No matching boards. Available: {available}", file=sys.stderr)
        sys.exit(1)

    ASSETS.mkdir(parents=True, exist_ok=True)

    print(f"Packing stubs for {len(boards)} board(s)...")
    results: list[Board] = []
    for board in boards:
        print(f"\n[{board.id}]")
        results.append(pack_board(board))

    # Add virtual boards to the manifest
    for vb in VIRTUAL_BOARDS:
        results.append(vb)

    # Generate manifest
    default_id = DEFAULT_BOARD_ID if any(b.id == DEFAULT_BOARD_ID for b in BOARDS) else boards[0].id
    manifest = {
        "version": "1.0",
        "default": default_id,
        "boards": [
            {
                "id": b.id,
                "package": b.package,
                "package_version": b.package_version,
                "file": b.file,
            }
            for b in results
        ],
    }

    manifest_path = ASSETS / "stubs-manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    print("\nManifest → assets/stubs-manifest.json")

    # Clean up
    if TMP.exists():
        shutil.rmtree(TMP)
    print("Done.")


if __name__ == "__main__":
    main()
