from __future__ import annotations

import hashlib
import importlib.util
import json
import sys
import zipfile
from pathlib import Path

import pytest

pytestmark = [pytest.mark.component, pytest.mark.unit]

_spec = importlib.util.spec_from_file_location(
    "generate_runtime_manifest",
    Path(__file__).parents[1] / "scripts" / "generate-runtime-manifest.py",
)
_mod = importlib.util.module_from_spec(_spec)
sys.modules["generate_runtime_manifest"] = _mod
_spec.loader.exec_module(_mod)


def _write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value), encoding="utf-8")


def _write_zip(path: Path, metadata: dict | None = None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("module.pyi", "value: int\n")
        if metadata is not None:
            archive.writestr("stubs-metadata.json", json.dumps(metadata))


def _runtime_tree(tmp_path: Path) -> Path:
    root = tmp_path
    package_root = root / "packages" / "pyright-worker"
    assets = package_root / "assets"
    _write_json(
        root / "package.json",
        {"devDependencies": {"pyright": "git+https://example.test/pyright.git#1.2.3"}},
    )
    _write_json(package_root / "package.json", {"name": "@example/worker", "version": "4.5.6"})
    (package_root / "dist").mkdir(parents=True)
    (package_root / "dist" / "pyright_worker.js").write_bytes(b"worker")
    _write_zip(assets / "typeshed-fallback.zip")
    _write_zip(
        assets / "stubs-stdlib.zip",
        {"package": "micropython-stdlib-stubs", "version": "1.29.0.post2"},
    )
    _write_zip(assets / "stubs-esp32.zip")
    _write_json(
        assets / "micropython-stub-package-catalog.json",
        {"version": "2.0", "packages": []},
    )
    _write_json(
        assets / "stubs-manifest.json",
        {
            "version": "1.0",
            "default": "esp32",
            "boards": [
                {
                    "id": "esp32",
                    "package": "micropython-esp32-stubs",
                    "package_version": "1.29.0.post1",
                    "file": "stubs-esp32.zip",
                },
                {
                    "id": "cpython",
                    "package": "No Stubs",
                    "package_version": "",
                    "file": None,
                },
                {
                    "id": "circuitpython",
                    "package": "circuitpython-stubs",
                    "package_version": "10.2.1",
                    "file": "stubs-circuitpython.zip",
                },
            ],
        },
    )
    return root


def test_manifest_binds_one_runtime_and_verified_assets(tmp_path):
    root = _runtime_tree(tmp_path)

    first = _mod.build_runtime_manifest(root)
    second = _mod.build_runtime_manifest(root)

    assert first == second
    assert first["$schema"] == "runtime-manifest.schema.json"
    assert first["runtimeId"].startswith("@example/worker@4.5.6+sha256.")
    assert first["pyrightVersion"] == "1.2.3"
    assert first["typeshed"]["identity"] == "pyright@1.2.3/typeshed-fallback"
    assert first["controlProtocol"] == {
        "minimumVersion": 1,
        "maximumVersion": 2,
        "capabilities": [
            "runtimeStubPackages",
            "externalCatalog",
            "externalStubArchives",
        ],
    }
    assert first["catalog"]["schemaVersion"] == "2.0"
    assert [archive["id"] for archive in first["fallbackArchives"]] == ["stdlib", "esp32"]
    worker_bytes = b"worker"
    assert first["worker"] == {
        "url": "../dist/pyright_worker.js",
        "size": len(worker_bytes),
        "sha256": hashlib.sha256(worker_bytes).hexdigest(),
    }

    (root / "packages" / "pyright-worker" / "dist" / "pyright_worker.js").write_bytes(b"updated")
    assert _mod.build_runtime_manifest(root)["runtimeId"] != first["runtimeId"]


def test_manifest_rejects_missing_runtime_asset(tmp_path):
    root = _runtime_tree(tmp_path)
    (root / "packages" / "pyright-worker" / "assets" / "stubs-esp32.zip").unlink()

    with pytest.raises(FileNotFoundError, match="stubs-esp32.zip"):
        _mod.build_runtime_manifest(root)
