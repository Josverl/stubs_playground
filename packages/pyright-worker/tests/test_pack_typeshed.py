from __future__ import annotations

import importlib.util
import sys
import zipfile
from pathlib import Path

import pytest

pytestmark = [pytest.mark.component, pytest.mark.unit]

_spec = importlib.util.spec_from_file_location(
    "pack_typeshed",
    Path(__file__).parents[1] / "scripts" / "pack-typeshed.py",
)
_mod = importlib.util.module_from_spec(_spec)
sys.modules["pack_typeshed"] = _mod
_spec.loader.exec_module(_mod)


def test_paths_resolve_from_worker_package():
    package_root = Path(__file__).parents[1]

    assert _mod.ROOT == package_root.parents[1]
    assert _mod.ASSETS_DIR == package_root / "assets"


def test_add_file_deflates_content_with_deterministic_metadata(tmp_path: Path):
    source = tmp_path / "module.pyi"
    source.write_text("value: str\n" * 100, encoding="utf-8")
    archive_path = tmp_path / "typeshed.zip"

    with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        _mod.add_file(archive, source, Path("stdlib/module.pyi"))

    with zipfile.ZipFile(archive_path) as archive:
        info = archive.getinfo("stdlib/module.pyi")
        assert info.compress_type == zipfile.ZIP_DEFLATED
        assert info.compress_size < info.file_size
        assert info.date_time == (2026, 1, 1, 0, 0, 0)
        assert info.create_system == 0
