import importlib.util
from pathlib import Path


SCRIPT = Path(__file__).parents[3] / "scripts" / "sync-stub-package-catalog.py"
SPEC = importlib.util.spec_from_file_location("sync_stub_package_catalog", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def test_build_catalog_groups_versions_and_normalizes_board_names():
    catalog = MODULE.build_catalog(
        {
            "packages": [
                ["micropython-rp2-rpi_pico-stubs", "1.28.0", "rp2", "rpi_pico", ""],
                ["micropython-rp2-rpi_pico-stubs", "1.27.0", "rp2", "RPI_PICO", ""],
                ["micropython-rp2-rpi_pico-stubs", "1.29.0-preview", "rp2", "RPI_PICO", ""],
                ["micropython-rp2-stubs", "1.18", "rp2", "", ""],
                ["micropython-rp2-stubs", "1.19", "rp2", "standard", ""],
                ["micropython-rp2-pimoroni_picolipo_16mb-stubs", "1.20.0", "rp2", "pimoroni_picolipo", ""],
                ["micropython-rp2-pimoroni_picolipo_16mb-stubs", "1.22.0", "rp2", "pimoroni_picolipo_16mb", ""],
            ]
        }
    )

    assert catalog["availableRuntimeVersions"] == ["1.28.0", "1.27.0", "1.22.0", "1.20.0", "1.19", "1.18"]
    assert catalog["defaultRuntimeVersion"] == "1.28.0"
    package = next(entry for entry in catalog["packages"] if entry["packageName"] == "micropython-rp2-rpi-pico-stubs")
    assert package["runtimeVersions"] == ["1.29.0-preview", "1.28.0", "1.27.0"]
    assert package["port"] == "rp2"
    assert package["board"] == "RPI_PICO"
    generic = next(entry for entry in catalog["packages"] if entry["packageName"] == "micropython-rp2-stubs")
    assert generic["board"] == "GENERIC"
    assert generic["id"] == "rp2"
    picolipo_targets = [
        entry for entry in catalog["packages"] if entry["packageName"] == "micropython-rp2-pimoroni-picolipo-16mb-stubs"
    ]
    assert [entry["runtimeVersions"] for entry in picolipo_targets] == [["1.20.0"], ["1.22.0"]]
    assert {entry["board"] for entry in picolipo_targets} == {
        "PIMORONI_PICOLIPO",
        "PIMORONI_PICOLIPO_16MB",
    }
    assert len({entry["id"] for entry in picolipo_targets}) == 2


def test_build_catalog_includes_circuitpython_placeholder():
    catalog = MODULE.build_catalog({"packages": [["micropython-rp2-stubs", "1.28.0", "rp2", "GENERIC", ""]]})

    assert catalog["packages"][0]["kind"] == "stdlib"
    circuitpython = catalog["packages"][-1]
    assert circuitpython == {
        "id": "circuitpython",
        "packageName": "circuitpython-stubs",
        "label": "CircuitPython",
        "kind": "firmware",
        "family": "circuitpython",
        "runtimeVersions": [],
        "port": "",
        "board": "",
    }


def test_build_catalog_maps_stdlib_source_row_without_duplicate():
    catalog = MODULE.build_catalog(
        {
            "packages": [
                ["micropython-rp2-stubs", "1.28.0", "rp2", "GENERIC", ""],
                ["micropython-stdlib-stubs", "1.26.0", "", "", ""],
            ]
        }
    )

    stdlib_entries = [entry for entry in catalog["packages"] if entry["packageName"] == "micropython-stdlib-stubs"]
    assert stdlib_entries == [
        {
            "id": "stdlib",
            "packageName": "micropython-stdlib-stubs",
            "label": "MicroPython standard library",
            "kind": "stdlib",
            "family": "micropython",
            "runtimeVersions": [],
            "port": "",
            "board": "",
        }
    ]
