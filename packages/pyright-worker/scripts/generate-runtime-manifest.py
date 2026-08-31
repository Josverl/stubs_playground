#!/usr/bin/env python3
"""Generate the immutable Pyright worker runtime manifest."""

from __future__ import annotations

import argparse
import hashlib
import json
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
PACKAGE_ROOT = Path(__file__).resolve().parent.parent
OUTPUT = PACKAGE_ROOT / "assets" / "runtime-manifest.json"


def _read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _asset(path: Path, url: str) -> dict[str, object]:
    if not path.is_file():
        raise FileNotFoundError(f"Runtime asset is missing: {path}")
    data = path.read_bytes()
    if not data:
        raise ValueError(f"Runtime asset is empty: {path}")
    return {
        "url": url,
        "size": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
    }


def _pyright_version(root: Path) -> str:
    dependency = _read_json(root / "package.json").get("devDependencies", {}).get("pyright", "")
    _, separator, version = dependency.rpartition("#")
    if not separator or not version:
        raise ValueError("The root pyright dependency must contain an exact #version")
    return version


def _stdlib_identity(archive: Path) -> tuple[str, str]:
    with zipfile.ZipFile(archive) as bundle:
        metadata = json.loads(bundle.read("stubs-metadata.json"))
    package_name = metadata.get("package")
    package_version = metadata.get("version")
    if not isinstance(package_name, str) or not isinstance(package_version, str):
        raise ValueError("stubs-stdlib.zip has invalid identity metadata")
    return package_name, package_version


def build_runtime_manifest(root: Path = ROOT) -> dict:
    package_root = root / "packages" / "pyright-worker"
    assets = package_root / "assets"
    package = _read_json(package_root / "package.json")
    package_name = package["name"]
    package_version = package["version"]
    pyright_version = _pyright_version(root)

    worker = _asset(package_root / "dist" / "pyright_worker.js", "../dist/pyright_worker.js")
    typeshed = _asset(assets / "typeshed-fallback.zip", "typeshed-fallback.zip")
    catalog_path = assets / "micropython-stub-package-catalog.json"
    catalog_document = _read_json(catalog_path)
    catalog = _asset(catalog_path, catalog_path.name)
    catalog["schemaVersion"] = catalog_document["version"]

    board_manifest = _read_json(assets / "stubs-manifest.json")
    stdlib_archive = assets / "stubs-stdlib.zip"
    stdlib_package, stdlib_version = _stdlib_identity(stdlib_archive)
    fallback_archives = [
        {
            "id": "stdlib",
            "packageName": stdlib_package,
            "packageVersion": stdlib_version,
            **_asset(stdlib_archive, stdlib_archive.name),
        }
    ]
    for board in board_manifest["boards"]:
        filename = board.get("file")
        if not filename or not board["package"].startswith("micropython-"):
            continue
        fallback_archives.append(
            {
                "id": board["id"],
                "packageName": board["package"],
                "packageVersion": board["package_version"],
                **_asset(assets / filename, filename),
            }
        )

    runtime = {
        "schemaVersion": 1,
        "package": {
            "name": package_name,
            "version": package_version,
        },
        "worker": worker,
        "pyrightVersion": pyright_version,
        "typeshed": {
            "identity": f"pyright@{pyright_version}/typeshed-fallback",
            **typeshed,
        },
        "controlProtocol": {
            "minimumVersion": 1,
            "maximumVersion": 2,
            "capabilities": ["runtimeStubPackages"],
        },
        "catalog": catalog,
        "fallbackArchives": fallback_archives,
    }
    content_id = hashlib.sha256(
        json.dumps(runtime, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    return {
        "$schema": "runtime-manifest.schema.json",
        "runtimeId": f"{package_name}@{package_version}+sha256.{content_id}",
        **runtime,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="Fail if the committed manifest is stale")
    args = parser.parse_args()

    content = json.dumps(build_runtime_manifest(), indent=2) + "\n"
    if args.check:
        if not OUTPUT.is_file() or OUTPUT.read_text(encoding="utf-8") != content:
            raise SystemExit("runtime-manifest.json is stale; run npm run generate:runtime-manifest")
        print(f"Verified {OUTPUT.relative_to(ROOT)}")
        return

    OUTPUT.write_text(content, encoding="utf-8")
    print(f"Wrote {OUTPUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
