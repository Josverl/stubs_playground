#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# ///
"""Pack Pyright's typeshed-fallback into a zip file for browser use.

Usage: uv run scripts/pack-typeshed.py
Output: packages/pyright-worker/assets/typeshed-fallback.zip
"""

import os
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TYPESHED_SRC = ROOT / "node_modules/pyright/packages/pyright-internal/typeshed-fallback"
ASSETS_DIR = ROOT / "packages" / "pyright-worker" / "assets"
OUT_FILE = ASSETS_DIR / "typeshed-fallback.zip"

# typeshed's third-party `stubs/` tree is 4043 of 4627 entries but only covers CPython
# packages (requests, PyYAML, ...) that cannot run on a microcontroller. Excluding it
# cuts the browser mount from ~409 ms to ~29 ms.
INCLUDE_DIRS = ["stdlib"]
INCLUDE_FILES = ["LICENSE"]


def add_file(zf: zipfile.ZipFile, full_path: Path, arcname: Path):
    """Add a deflated file to the zipfile with deterministic metadata."""
    # Read file contents
    data = full_path.read_bytes()

    # Create ZipInfo manually
    info = zipfile.ZipInfo.from_file(full_path, arcname.as_posix())

    # Strip metadata
    info.date_time = (2026, 1, 1, 0, 0, 0)
    info.create_system = 0  # MS-DOS (no UNIX perms)
    info.external_attr = 0  # remove UNIX permissions
    info.extra = b""  # remove extra fields
    info.comment = b""  # remove per-file comment
    info.compress_type = zipfile.ZIP_DEFLATED

    # Write file
    zf.writestr(info, data)


def main() -> None:
    if not TYPESHED_SRC.exists():
        print(f"Typeshed not found at: {TYPESHED_SRC}", file=sys.stderr)
        print("Run 'npm install --ignore-scripts' first.", file=sys.stderr)
        sys.exit(1)

    ASSETS_DIR.mkdir(parents=True, exist_ok=True)

    print(f"Packing typeshed from: {TYPESHED_SRC}")
    print(f"Output: {OUT_FILE}")

    with zipfile.ZipFile(
        OUT_FILE,
        "w",
        zipfile.ZIP_DEFLATED,
        allowZip64=False,
    ) as zf:
        for dir_name in INCLUDE_DIRS:
            src_dir = TYPESHED_SRC / dir_name
            if not src_dir.exists():
                continue
            for root_dir, dirs, files in os.walk(src_dir):
                dirs.sort()
                for f in sorted(files):
                    full = Path(root_dir) / f
                    arcname = full.relative_to(TYPESHED_SRC)
                    add_file(zf, full, arcname)

        for fname in INCLUDE_FILES:
            fpath = TYPESHED_SRC / fname
            if fpath.exists():
                add_file(zf, fpath, Path(fname))

    size_mb = OUT_FILE.stat().st_size / 1024 / 1024
    print(f"Done: {size_mb:.2f} MB")


if __name__ == "__main__":
    main()
