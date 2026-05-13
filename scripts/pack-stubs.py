#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# ///
"""Pack MicroPython board and extra stubs into zip files for browser use.

For each board defined below:
  1. Install stubs via `uv pip install micropython-{board}-stubs --target ./tmp`
  2. Zip the .pyi files and packages (skip dist-info metadata)
  3. Write to assets/stubs-{board}.zip
  4. Generate assets/stubs-manifest.json

Usage: uv run scripts/pack-stubs.py [id...]
    No args -> pack all boards and extras. Pass IDs to pack a specific subset.
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
class StubPackage:
    id: str
    package: str
    install_spec: str | None = None
    file: str | None = None
    package_version: str = ""


DEFAULT_BOARD_ID = "esp32"


# Boards that have installable stub packages
BOARDS: list[StubPackage] = [
    StubPackage(id="stdlib",  package="micropython-stdlib-stubs"),  # Used for stdlib only
    StubPackage(id="esp32", package="micropython-esp32-stubs"),
    StubPackage(id="rp2",   package="micropython-rp2-stubs"),
    StubPackage(id="stm32", package="micropython-stm32-stubs"),
    StubPackage(id="samd",  package="micropython-samd-stubs"),
    StubPackage(id="circuitpython", package="circuitpython-stubs"),
]

# Extra stub packages to bundle alongside board stubs.
# Conventions for adding new extras:
# - Use a stable, unique `id` (used in CLI selection and manifest keys).
# - Keep `package` as the canonical distribution name for metadata/version lookup.
# - Set `install_spec` when installation source differs from package name
#   (for example local path, VCS URL, or pinned ref).
# - Output zip name is derived as: assets/stubs-extra-<id>.zip
EXTRA_STUBS: list[StubPackage] = [
    StubPackage(
        id="emlearn",
        package="emlearn-micropython-stubs",
        # local source (fast)
        # install_spec=str(ROOT / "emlearn-micropython" / "stubs"),
        # Original Git source: (slow - big clone)
        install_spec="git+https://github.com/emlearn/emlearn-micropython.git@master#subdirectory=stubs"
    ),
]

# Virtual boards (no stub package, included in manifest only)
VIRTUAL_BOARDS: list[StubPackage] = [
    StubPackage(id="cpython", package="No Stubs"),
]

BOARD_MAP = {b.id: b for b in BOARDS}
EXTRA_MAP = {e.id: e for e in EXTRA_STUBS}


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


def pack_stub_package(pkg: StubPackage, *, archive_prefix: str = "stubs") -> StubPackage:
    """Install and pack one stub package. Returns updated package metadata."""
    target = TMP / f"{archive_prefix}-{pkg.id}"
    out_path = ASSETS / f"{archive_prefix}-{pkg.id}.zip"

    # Install stubs to a temp dir so we can read the exact version.
    if target.exists():
        shutil.rmtree(target)
    target.mkdir(parents=True)

    install_spec = pkg.install_spec or pkg.package
    print(f"  Installing {pkg.package}...")
    # hack for circuitpython-stubs that do not include stdlib
    if pkg.id == "circuitpython":
        # Add the micropython-stdlib-stubs as  circuitpython-stubs do not include stdlib stubs.
        subprocess.run(
            ["uv", "pip", "install", "micropython-stdlib-stubs", "--target", str(target), "--quiet"],
            check=True,
            capture_output=True,
            text=True,
        )
        # Add (rp2) time.pyi, as this is not in micropython-stdlib-stubs
        shutil.copyfile( ASSETS / "time.pyi", target / "time.pyi" )

    install_cmd = ["uv", "pip", "install", install_spec, "--target", str(target)]
    # Keep git installs verbose so users see progress (clone/build) rather than apparent hangs.
    if isinstance(install_spec, str) and install_spec.startswith("git+"):
        subprocess.run(
            install_cmd,
            check=True,
            text=True,
        )
    else:
        subprocess.run(
            [*install_cmd, "--quiet"],
            check=True,
            capture_output=True,
            text=True,
        )

    # Capture exact installed version
    pkg.package_version = get_installed_version(target, pkg.package)
    if pkg.package_version:
        print(f"  Version: {pkg.package_version}")

    # Skip re-zipping when the existing zip already contains the same version.
    cached_version = get_zip_embedded_version(out_path)
    if cached_version and cached_version == pkg.package_version and out_path.exists():
        print(f"  Up-to-date, skipping zip  ({out_path.stat().st_size / 1024:.0f} KB)")
        pkg.file = f"{archive_prefix}-{pkg.id}.zip"
        return pkg

    # Zip (embed provenance metadata inside the archive)
    pkg_metadata = {
        "package": pkg.package,
        "version": pkg.package_version,
    }
    size = zip_directory(target, out_path, metadata=pkg_metadata)
    print(f"  → assets/{archive_prefix}-{pkg.id}.zip  ({size / 1024:.0f} KB)")

    pkg.file = f"{archive_prefix}-{pkg.id}.zip"
    return pkg


def manifest_entry(pkg: StubPackage) -> dict[str, str | None]:
    return {
        "id": pkg.id,
        "package": pkg.package,
        "package_version": pkg.package_version,
        "file": pkg.file,
    }


def main() -> None:
    requested_ids = set(sys.argv[1:])
    boards = [b for b in BOARDS if (not requested_ids or b.id in requested_ids)]
    extras = [e for e in EXTRA_STUBS if (not requested_ids or e.id in requested_ids)]

    if requested_ids and not boards and not extras:
        available = ", ".join([*(b.id for b in BOARDS), *(e.id for e in EXTRA_STUBS)])
        print(f"No matching stub IDs. Available: {available}", file=sys.stderr)
        sys.exit(1)

    ASSETS.mkdir(parents=True, exist_ok=True)

    print(f"Packing stubs for {len(boards)} board(s) and {len(extras)} extra package(s)...")
    board_results: list[StubPackage] = []
    for board in boards:
        print(f"\n[{board.id}]")
        board_results.append(pack_stub_package(board, archive_prefix="stubs"))

    extra_results: list[StubPackage] = []
    for extra in extras:
        print(f"\n[extra:{extra.id}]")
        extra_results.append(pack_stub_package(extra, archive_prefix="stubs-extra"))

    # Add virtual boards to the manifest
    for vb in VIRTUAL_BOARDS:
        board_results.append(vb)

    # Generate manifest
    default_id = ""
    if any(b.id == DEFAULT_BOARD_ID for b in board_results):
        default_id = DEFAULT_BOARD_ID
    elif board_results:
        default_id = board_results[0].id

    manifest = {
        "version": "1.0",
        "default": default_id,
        "boards": [manifest_entry(b) for b in board_results],
        "extras": [manifest_entry(e) for e in extra_results],
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
