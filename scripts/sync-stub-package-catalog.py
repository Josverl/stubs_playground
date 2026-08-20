"""Build the browser stub-package catalog from the published package index."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from urllib.request import urlopen


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = "https://raw.githubusercontent.com/Josverl/micropython-stubs/main/data/stub-packages.json"
DEFAULT_OUTPUT = ROOT / "packages" / "pyright-worker" / "assets" / "stub-package-catalog.json"


def _read_source(source: str) -> dict:
    if source.startswith(("https://", "http://")):
        with urlopen(source, timeout=30) as response:  # noqa: S310 - explicit catalog source
            return json.load(response)
    return json.loads(Path(source).read_text(encoding="utf-8"))


def _normalized_name(value: str) -> str:
    return re.sub(r"[-_.]+", "-", value.strip().lower())


def _stable_runtime_versions(rows: list) -> list[str]:
    stable_versions: dict[tuple[int, int, int], str] = {}
    for row in rows:
        if not isinstance(row, list) or len(row) < 2 or not isinstance(row[1], str):
            continue
        match = re.fullmatch(r"(\d+)\.(\d+)(?:\.(\d+))?", row[1].strip())
        if not match:
            continue
        major, minor, patch = match.groups()
        key = (int(major), int(minor), int(patch or 0))
        stable_versions[key] = row[1].strip()
    return [stable_versions[key] for key in sorted(stable_versions, reverse=True)]


def _runtime_version_sort_key(value: str) -> tuple[int, int, int]:
    match = re.match(r"(\d+)\.(\d+)(?:\.(\d+))?", value)
    if not match:
        return (0, 0, 0)
    major, minor, patch = match.groups()
    return (int(major), int(minor), int(patch or 0))


def build_catalog(source_data: dict, source: str = DEFAULT_SOURCE) -> dict:
    source_packages = source_data.get("packages", [])
    available_runtime_versions = _stable_runtime_versions(source_packages)
    if not available_runtime_versions:
        raise ValueError("Package catalog does not contain a stable MicroPython runtime version")

    grouped: dict[tuple[str, str, str], dict[str, object]] = {}
    for index, row in enumerate(source_packages):
        if not isinstance(row, list) or len(row) < 4:
            raise ValueError(f"Package row {index} is invalid")
        package_name, runtime_version, port, board = row[:4]
        if not all(isinstance(value, str) for value in (package_name, runtime_version, port, board)):
            raise ValueError(f"Package row {index} contains non-string metadata")

        normalized_name = _normalized_name(package_name)
        is_stdlib = normalized_name == "micropython-stdlib-stubs"
        normalized_port = "" if is_stdlib else port.lower()
        is_generic_port_package = normalized_name == f"micropython-{normalized_port}-stubs"
        normalized_board = "" if is_stdlib else ("GENERIC" if is_generic_port_package else (board.upper() or "GENERIC"))
        entry = grouped.setdefault(
            (normalized_name, normalized_port, normalized_board),
            {
                "packageName": normalized_name,
                "label": "MicroPython standard library" if is_stdlib else package_name.removesuffix("-stubs"),
                "kind": "stdlib" if is_stdlib else "firmware",
                "family": "micropython",
                "runtimeVersions": set(),
                "port": normalized_port,
                "board": normalized_board,
            },
        )
        if not is_stdlib:
            entry["runtimeVersions"].add(runtime_version)  # type: ignore[union-attr]

    packages = []
    target_counts: dict[str, int] = {}
    for entry in grouped.values():
        package_name = str(entry["packageName"])
        target_counts[package_name] = target_counts.get(package_name, 0) + 1
    for entry in grouped.values():
        package_name = str(entry["packageName"])
        board = str(entry["board"])
        is_generic_port_package = package_name == f"micropython-{entry['port']}-stubs"
        if entry["kind"] == "stdlib":
            entry["id"] = "stdlib"
        elif is_generic_port_package:
            entry["id"] = entry["port"]
        else:
            entry["id"] = (
                package_name if target_counts[package_name] == 1 else (f"{package_name}--{_normalized_name(board)}")
            )
        entry["runtimeVersions"] = sorted(
            entry["runtimeVersions"],  # type: ignore[arg-type]
            key=_runtime_version_sort_key,
            reverse=True,
        )
        packages.append(entry)

    packages.sort(key=lambda entry: (entry["kind"] != "stdlib", entry["packageName"], entry["board"]))
    if not packages or packages[0]["kind"] != "stdlib":
        packages.insert(
            0,
            {
                "id": "stdlib",
                "packageName": "micropython-stdlib-stubs",
                "label": "MicroPython standard library",
                "kind": "stdlib",
                "family": "micropython",
                "runtimeVersions": [],
                "port": "",
                "board": "",
            },
        )
    packages.append(
        {
            "id": "circuitpython",
            "packageName": "circuitpython-stubs",
            "label": "CircuitPython",
            "kind": "firmware",
            "family": "circuitpython",
            "runtimeVersions": [],
            "port": "",
            "board": "",
        },
    )
    return {
        "version": "2.0",
        "source": source,
        "availableRuntimeVersions": available_runtime_versions,
        "defaultRuntimeVersion": available_runtime_versions[0],
        "packages": packages,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", default=DEFAULT_SOURCE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    catalog = build_catalog(_read_source(args.source))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(catalog, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(catalog['packages'])} packages to {args.output}")


if __name__ == "__main__":
    main()
