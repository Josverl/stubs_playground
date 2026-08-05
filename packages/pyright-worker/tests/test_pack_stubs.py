"""
Unit tests for scripts/pack-stubs.py

Tests the get_installed_version helper and zip_directory functions.
"""

from __future__ import annotations

import importlib.util
import json
import sys
import zipfile
from pathlib import Path

import pytest

pytestmark = [pytest.mark.component, pytest.mark.unit]

# ---------------------------------------------------------------------------
# Load pack-stubs.py as a module (it has a hyphen in the filename so we use
# importlib rather than a plain import statement).
_spec = importlib.util.spec_from_file_location(
    "pack_stubs",
    Path(__file__).parents[3] / "scripts" / "pack-stubs.py",
)
_mod = importlib.util.module_from_spec(_spec)
sys.modules["pack_stubs"] = _mod
_spec.loader.exec_module(_mod)

get_installed_version = _mod.get_installed_version
get_zip_embedded_version = _mod.get_zip_embedded_version
get_cached_board = _mod.get_cached_board
zip_directory = _mod.zip_directory


def test_webassembly_port_is_packaged_as_a_board_target():
    board = _mod.BOARD_MAP["webassembly"]

    assert board.package == "micropython-webassembly-stubs"


def test_webassembly_archive_and_manifest_expose_micropython_modules():
    assets = Path(__file__).parents[1] / "assets"
    manifest = json.loads((assets / "stubs-manifest.json").read_text(encoding="utf-8"))
    board = next(item for item in manifest["boards"] if item["id"] == "webassembly")

    assert board["package"] == "micropython-webassembly-stubs"
    assert board["file"] == "stubs-webassembly.zip"

    with zipfile.ZipFile(assets / board["file"]) as archive:
        names = set(archive.namelist())

    assert {"micropython.pyi", "uasyncio.pyi", "umachine.pyi", "js.pyi"} <= names


def test_targeted_pack_preserves_cached_board_manifest_entries(tmp_path, monkeypatch):
    assets = tmp_path / "assets"
    source = tmp_path / "source"
    assets.mkdir()
    source.mkdir()
    cached = _mod.Board(id="esp32", package="micropython-esp32-stubs")
    zip_directory(
        source,
        assets / "stubs-esp32.zip",
        metadata={"package": cached.package, "version": "1.28.0.post1"},
    )

    monkeypatch.setattr(_mod, "ASSETS", assets)
    manifest_board = get_cached_board(cached)

    assert manifest_board.file == "stubs-esp32.zip"
    assert manifest_board.package_version == "1.28.0.post1"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def fake_target(tmp_path: Path) -> Path:
    """Create a fake --target directory that looks like uv pip install output."""
    pkg = "micropython-esp32-stubs"
    version = "1.28.0.post1"
    dist_info = tmp_path / f"micropython_esp32_stubs-{version}.dist-info"
    dist_info.mkdir()
    metadata = dist_info / "METADATA"
    metadata.write_text(
        f"Metadata-Version: 2.1\nName: {pkg}\nVersion: {version}\n",
        encoding="utf-8",
    )
    # Also create a stub file so zip_directory has something to zip
    stub = tmp_path / "machine.pyi"
    stub.write_text("def reset() -> None: ...\n")
    return tmp_path


# ---------------------------------------------------------------------------
# Tests for get_installed_version
# ---------------------------------------------------------------------------


class TestGetInstalledVersion:
    def test_returns_version_for_known_package(self, fake_target: Path):
        version = get_installed_version(fake_target, "micropython-esp32-stubs")
        assert version == "1.28.0.post1"

    def test_returns_empty_string_when_package_not_found(self, fake_target: Path):
        version = get_installed_version(fake_target, "micropython-rp2-stubs")
        assert version == ""

    def test_handles_hyphen_in_package_name(self, tmp_path: Path):
        """Dist-info dir uses underscores; package name uses hyphens — must match."""
        dist_info = tmp_path / "my_package-2.0.0.dist-info"
        dist_info.mkdir()
        (dist_info / "METADATA").write_text(
            "Metadata-Version: 2.1\nName: my-package\nVersion: 2.0.0\n",
            encoding="utf-8",
        )
        assert get_installed_version(tmp_path, "my-package") == "2.0.0"

    def test_empty_directory_returns_empty_string(self, tmp_path: Path):
        assert get_installed_version(tmp_path, "anything") == ""

    def test_post_release_version(self, tmp_path: Path):
        dist_info = tmp_path / "micropython_esp32_stubs-1.28.0.post2.dist-info"
        dist_info.mkdir()
        (dist_info / "METADATA").write_text(
            "Metadata-Version: 2.1\nName: micropython-esp32-stubs\nVersion: 1.28.0.post2\n",
            encoding="utf-8",
        )
        assert get_installed_version(tmp_path, "micropython-esp32-stubs") == "1.28.0.post2"


# ---------------------------------------------------------------------------
# Tests for zip_directory
# ---------------------------------------------------------------------------


class TestZipDirectory:
    def test_creates_zip_with_stub_files(self, fake_target: Path, tmp_path: Path):
        out = tmp_path / "out.zip"
        size = zip_directory(fake_target, out)
        assert out.exists()
        assert size == out.stat().st_size
        with zipfile.ZipFile(out) as zf:
            names = zf.namelist()
        assert "machine.pyi" in names

    def test_skips_dist_info_directories(self, fake_target: Path, tmp_path: Path):
        out = tmp_path / "out.zip"
        zip_directory(fake_target, out)
        with zipfile.ZipFile(out) as zf:
            names = zf.namelist()
        assert not any(".dist-info" in n for n in names)

    def test_embeds_metadata_json_when_provided(self, fake_target: Path, tmp_path: Path):
        out = tmp_path / "out.zip"
        metadata = {"package": "micropython-esp32-stubs", "version": "1.28.0.post1"}
        zip_directory(fake_target, out, metadata=metadata)
        with zipfile.ZipFile(out) as zf:
            names = zf.namelist()
            assert "stubs-metadata.json" in names
            embedded = json.loads(zf.read("stubs-metadata.json"))
        assert embedded["version"] == "1.28.0.post1"
        assert embedded["package"] == "micropython-esp32-stubs"

    def test_no_metadata_json_when_not_provided(self, fake_target: Path, tmp_path: Path):
        out = tmp_path / "out.zip"
        zip_directory(fake_target, out)
        with zipfile.ZipFile(out) as zf:
            assert "stubs-metadata.json" not in zf.namelist()


# ---------------------------------------------------------------------------
# Tests for get_zip_embedded_version
# ---------------------------------------------------------------------------


class TestGetZipEmbeddedVersion:
    def _make_zip(self, tmp_path: Path, version: str) -> Path:
        out = tmp_path / "test.zip"
        with zipfile.ZipFile(out, "w") as zf:
            zf.writestr(
                "stubs-metadata.json",
                json.dumps({"package": "micropython-esp32-stubs", "version": version}),
            )
        return out

    def test_returns_version_from_embedded_metadata(self, tmp_path: Path):
        out = self._make_zip(tmp_path, "1.28.0.post2")
        assert get_zip_embedded_version(out) == "1.28.0.post2"

    def test_returns_empty_when_file_does_not_exist(self, tmp_path: Path):
        assert get_zip_embedded_version(tmp_path / "missing.zip") == ""

    def test_returns_empty_when_no_metadata_json_in_zip(self, tmp_path: Path):
        out = tmp_path / "no-meta.zip"
        with zipfile.ZipFile(out, "w") as zf:
            zf.writestr("machine.pyi", "def reset() -> None: ...\n")
        assert get_zip_embedded_version(out) == ""

    def test_returns_empty_for_corrupt_zip(self, tmp_path: Path):
        out = tmp_path / "bad.zip"
        out.write_bytes(b"not a zip file")
        assert get_zip_embedded_version(out) == ""

    def test_returns_empty_when_version_key_missing(self, tmp_path: Path):
        out = tmp_path / "no-ver.zip"
        with zipfile.ZipFile(out, "w") as zf:
            zf.writestr("stubs-metadata.json", json.dumps({"package": "x"}))
        assert get_zip_embedded_version(out) == ""
