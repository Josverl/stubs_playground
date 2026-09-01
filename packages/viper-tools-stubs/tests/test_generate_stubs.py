from __future__ import annotations

import hashlib
import importlib.util
import subprocess
import sys
import zipfile
from pathlib import Path

PACKAGE_ROOT = Path(__file__).resolve().parents[1]
SCRIPT = PACKAGE_ROOT / "scripts" / "generate_stubs.py"


def load_generator():
    spec = importlib.util.spec_from_file_location("generate_stubs", SCRIPT)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_git_blob_sha1() -> None:
    generator = load_generator()
    content = b"test content\n"
    expected = hashlib.sha1(b"blob 13\0" + content).hexdigest()

    assert generator.git_blob_sha1(content) == expected


def test_committed_stub_set_matches_upstream_modules() -> None:
    generator = load_generator()
    expected = {Path(name).stem for name in generator.UPSTREAM_FILES}
    actual = {path.parent.name for path in (PACKAGE_ROOT / "stubs").glob("*/__init__.pyi")}

    assert actual == expected
    assert all((PACKAGE_ROOT / "stubs" / module / "py.typed").exists() for module in expected)


def test_package_version_tracks_upstream_version() -> None:
    generator = load_generator()
    pyproject = (PACKAGE_ROOT / "pyproject.toml").read_text(encoding="utf-8")

    assert f'version = "{generator.UPSTREAM_VERSION}.0"' in pyproject


def test_built_wheel_contains_only_expected_stub_modules(tmp_path: Path) -> None:
    subprocess.run(
        [
            sys.executable,
            "-m",
            "build",
            "--wheel",
            "--outdir",
            str(tmp_path),
            str(PACKAGE_ROOT),
        ],
        check=True,
    )
    wheels = list(tmp_path.glob("*.whl"))
    assert len(wheels) == 1

    with zipfile.ZipFile(wheels[0]) as wheel:
        stub_names = {name for name in wheel.namelist() if name.endswith(".pyi")}

    assert stub_names == {
        "ble_nus/__init__.pyi",
        "ble_repl/__init__.pyi",
        "web_repl/__init__.pyi",
        "ws_client/__init__.pyi",
        "wss_repl/__init__.pyi",
    }
