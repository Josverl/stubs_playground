# mp_codemirror - CodeMirror Python Editor with LSP support

# Set shell for Windows OSs:
set windows-shell := ["pwsh.exe", "-NoLogo", "-Command"]

set dotenv-load := false

# default recipe: list available recipes
default:
    @just --list

# initial project setup after cloning
setup:
    npm install --ignore-scripts
    uv sync --extra test
    uv run playwright install --with-deps chromium
    just build

# --- Build recipes ---

# build the Pyright web worker (production)
build:
    npm run generate:component-config
    just pack
    npx webpack --mode production
    npm run generate:runtime-manifest

# build the Pyright web worker (development, unminified); overwrites the tracked dist/ artifact
build-dev:
    npm run generate:component-config
    @just sync-stub-package-catalog
    npx webpack --mode development
    npm run generate:runtime-manifest
    @echo "NOTE: dist/pyright_worker.js is now an unminified DEVELOPMENT build."
    @echo "      Run 'just build' before committing or releasing."

# build Sphinx API documentation
docs:
    uv run --with-requirements docs/requirements.txt sphinx-build -W --keep-going -b html docs docs/_build/html

# check documentation links; external services may fail transiently
docs-linkcheck:
    uv run --with-requirements docs/requirements.txt sphinx-build -b linkcheck docs docs/_build/linkcheck

# pack Pyright's typeshed-fallback into a zip for browser use
pack-typeshed:
    uv run packages/pyright-worker/scripts/pack-typeshed.py

# pack MicroPython board stubs into zip files for each board
pack-stubs:
    uv run packages/pyright-worker/scripts/pack-stubs.py

# synchronize the installable stub package catalog
sync-stub-package-catalog:
    npm run sync:stub-package-catalog

# pack the package catalog, MicroPython board stubs, and typeshed-fallback
pack:
    @just sync-stub-package-catalog
    @just pack-typeshed
    @just pack-stubs

# rebuild everything from scratch
rebuild:
    npm install --ignore-scripts
    npx tsc packages/pyright-worker/src/messages.ts --declaration --emitDeclarationOnly --target ES2020 --module ESNext --moduleResolution Bundler --skipLibCheck --outDir ./temp_out
    cp ./temp_out/messages.d.ts packages/pyright-worker/src/messages.d.ts
    rm -rf ./temp_out
    npm run generate:component-config
    just pack
    npx webpack --mode production
    npm run generate:runtime-manifest

# stage the static GitHub Pages tree
[script("uv", "run", "python")]
stage-pages output="deploy":
    from __future__ import annotations

    import shutil
    import subprocess
    from pathlib import Path

    root = Path.cwd().resolve()
    destination = (root / {{quote(output)}}).resolve()
    if destination == root or root not in destination.parents:
        raise SystemExit("Output directory must be a child of the repository root.")

    subprocess.run(
        ["node", "scripts/generate-component-config.mjs", "--check"],
        check=True,
    )

    sources = (
        ("index.html", "index.html"),
        ("apps/playground", "apps/playground"),
        ("packages/lsp-client/package.json", "packages/lsp-client/package.json"),
        ("packages/lsp-client/src", "packages/lsp-client/src"),
        ("packages/lsp-client/types", "packages/lsp-client/types"),
        ("packages/pyright-worker/package.json", "packages/pyright-worker/package.json"),
        ("packages/pyright-worker/src", "packages/pyright-worker/src"),
        ("packages/pyright-worker/dist", "packages/pyright-worker/dist"),
        ("packages/pyright-worker/assets", "packages/pyright-worker/assets"),
    )

    missing = [source for source, _ in sources if not (root / source).exists()]
    if missing:
        raise SystemExit(f"Cannot stage Pages; missing: {', '.join(missing)}")

    if destination.exists():
        shutil.rmtree(destination)
    for source_name, target_name in sources:
        source = root / source_name
        target = destination / target_name
        target.parent.mkdir(parents=True, exist_ok=True)
        if source.is_dir():
            shutil.copytree(source, target)
        else:
            shutil.copy2(source, target)

    print(f"Staged GitHub Pages tree at {destination.relative_to(root)}")

# request an LSP client npm release from the current commit
release-lsp-client: (_release-npm "lsp-client" "packages/lsp-client/package.json")

# request a Pyright worker npm release from the current commit
release-pyright-worker: (_release-npm "pyright-worker" "packages/pyright-worker/package.json")

# bump the LSP client version and synchronize generated package metadata
bump-lsp-client bump="patch": (_bump-npm "lsp-client" "@mp-typing/lsp-client" bump)

# bump the Pyright worker version and synchronize generated package metadata
bump-pyright-worker bump="patch": (_bump-npm "pyright-worker" "@mp-typing/pyright-worker" bump)

[private]
[script("uv", "run", "python")]
_bump-npm component package_name bump:
    from __future__ import annotations

    import json
    import subprocess
    from pathlib import Path

    component = "{{component}}"
    package_name = "{{package_name}}"
    bump = "{{bump}}"
    if component not in {"lsp-client", "pyright-worker"}:
        raise SystemExit(f"Invalid npm component: {component}")
    if bump not in {"patch", "minor", "major"}:
        raise SystemExit("bump must be patch, minor, or major")

    package_manifest = Path("packages") / component / "package.json"
    app_manifest = Path("apps/playground/package.json")

    subprocess.run(
        [
            "npm",
            "version",
            bump,
            "--workspace",
            package_name,
            "--no-git-tag-version",
            "--ignore-scripts",
        ],
        check=True,
    )

    version = json.loads(package_manifest.read_text(encoding="utf-8"))["version"]
    app = json.loads(app_manifest.read_text(encoding="utf-8"))
    app["dependencies"][package_name] = version
    app_manifest.write_text(
        json.dumps(app, indent=2) + "\n",
        encoding="utf-8",
    )

    subprocess.run(
        ["npm", "install", "--package-lock-only", "--ignore-scripts"],
        check=True,
    )
    subprocess.run(
        ["npm", "run", "generate:component-config"],
        check=True,
    )
    print(f"Bumped {package_name} to {version} and synchronized the playground config.")

[private]
[script("uv", "run", "python")]
_release-npm component package_json:
    from __future__ import annotations

    import json
    import re
    import subprocess
    from pathlib import Path

    component = "{{component}}"
    manifest_name = "{{package_json}}"
    if component not in {"lsp-client", "pyright-worker"}:
        raise SystemExit(f"Invalid npm component: {component}")

    manifest = Path(manifest_name)
    if not manifest.is_file():
        raise SystemExit(f"Component manifest not found: {manifest}")

    def git(*args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["git", *args],
            check=check,
            text=True,
            capture_output=True,
        )

    if git("status", "--short").stdout:
        raise SystemExit("Refusing to release with uncommitted changes.")

    branch = git("branch", "--show-current").stdout.strip()
    if not branch:
        raise SystemExit("Refusing to release from a detached HEAD.")

    package = json.loads(manifest.read_text(encoding="utf-8"))
    package_name = package.get("name")
    expected_name = f"@mp-typing/{component}"
    if package_name != expected_name:
        raise SystemExit(
            f"Unexpected package name {package_name!r} in {manifest}; "
            f"expected {expected_name!r}."
        )

    version = package.get("version")
    if not isinstance(version, str) or not re.fullmatch(
        r"\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?", version
    ):
        raise SystemExit(f"Invalid version {version!r} in {manifest}.")

    registry = subprocess.run(
        ["npm", "view", package_name, "versions", "--json"],
        text=True,
        capture_output=True,
    )
    if registry.returncode != 0:
        if "E404" not in registry.stderr:
            raise SystemExit(
                registry.stderr.strip()
                or f"Unable to query published versions for {package_name}."
            )
        published_versions = []
    else:
        published_versions = json.loads(registry.stdout)
    if version in published_versions:
        raise SystemExit(f"{package_name}@{version} is already published and immutable.")

    request_tag = f"npm-release/{component}/{version}"
    result = git(
        "ls-remote",
        "--exit-code",
        "--tags",
        "origin",
        f"refs/tags/{request_tag}",
        check=False,
    )
    if result.returncode == 0:
        raise SystemExit(f"Request tag {request_tag} already exists.")
    if result.returncode != 2:
        raise SystemExit(
            result.stderr.strip() or f"Unable to query remote tag {request_tag}."
        )

    # The workflow tags the release as <component>-v<version> and those tags are immutable.
    version_tag = f"{component}-v{version}"
    existing = git(
        "ls-remote",
        "--exit-code",
        "--tags",
        "origin",
        f"refs/tags/{version_tag}",
        check=False,
    )
    if existing.returncode == 0:
        raise SystemExit(f"Version tag {version_tag} already exists; cut a new version.")

    short_sha = git("rev-parse", "--short", "HEAD").stdout.strip()
    print(
        f"Requesting npm release {package_name}@{version} "
        f"from {branch} at {short_sha}...",
        flush=True,
    )
    subprocess.run(
        ["git", "push", "origin", f"HEAD:refs/tags/{request_tag}"],
        check=True,
    )
    print("Release requested. Follow the 'Release npm package' workflow in GitHub Actions.")

# format Python code with ruff
format:
    ruff format tests/

# --- Server recipes ---

# start the threaded HTTP server (port 8888)
http:
    uv run tests/http_server.py 8888 .

# start the real playground with local or published npm components
[script("uv", "run", "python")]
serve source="local":
    from __future__ import annotations

    import subprocess
    import socket
    import sys
    import time
    import urllib.error
    import urllib.request
    import webbrowser

    source = {{quote(source)}}
    if source not in {"local", "npm"}:
        raise SystemExit("source must be either 'local' or 'npm'")

    subprocess.run(
        ["node", "scripts/generate-component-config.mjs"],
        check=True,
    )

    port = None
    for candidate in range(8888, 8988):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            try:
                probe.bind(("", candidate))
            except OSError:
                continue
            port = candidate
            break
    if port is None:
        raise SystemExit("No free HTTP port found in range 8888-8987.")

    base_url = f"http://localhost:{port}/apps/playground/"
    url = f"{base_url}?components={source}"
    process = subprocess.Popen(
        [sys.executable, "tests/http_server.py", str(port), "."],
        stderr=subprocess.PIPE,
        text=True,
    )
    try:
        server_url = f"{base_url}index.html"
        for _ in range(50):
            if process.poll() is not None:
                error = process.stderr.read().strip() if process.stderr else ""
                detail = error.rsplitlines()[-1] if error else "no error details"
                raise SystemExit(f"HTTP server failed to start on port {port}: {detail}")
            try:
                with urllib.request.urlopen(server_url, timeout=0.2) as response:
                    if response.status == 200:
                        break
            except (urllib.error.URLError, TimeoutError):
                time.sleep(0.1)
        else:
            raise SystemExit("HTTP server did not become ready within 5 seconds")

        print(f"Opening {source} source: {url}", flush=True)
        if not webbrowser.open(url):
            print(f"Open this URL in your browser: {url}", flush=True)
        print(f"Server running (PID {process.pid}). Press Ctrl+C to stop.", flush=True)
        process.wait()
    except KeyboardInterrupt:
        pass
    finally:
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()

# --- Test recipes ---

# run tests
test *args='':
    uv run pytest -v {{args}}

# run Python component unit tests only
test-unit-py:
    uv run pytest packages/pyright-worker/tests -m unit -v

# run all JavaScript unit tests
test-unit-js:
    npm run test:unit

# run all unit tests
test-unit:
    just test-unit-py
    just test-unit-js

# run the playground application tests
test-app *args='':
    uv run pytest apps/playground/tests -v {{args}}

# run the published LSP client tests without loading the application
test-lsp-client *args='':
    npm run test:lsp-client:unit
    uv run pytest packages/lsp-client/tests -v {{args}}

# run the published worker tests without loading the application
test-worker *args='':
    npm run test:pyright-worker:unit
    uv run pytest packages/pyright-worker/tests -v {{args}}

# --- Info recipes ---

# show sizes for all CDN-published components and assets
sizes:
    #!/usr/bin/env bash
    set -euo pipefail
    shopt -s nullglob

    file_size() {
        stat -c%s "$1" 2>/dev/null || stat -f%z "$1"
    }

    human_size() {
        numfmt --to=iec "$1" 2>/dev/null || printf "%sB" "$1"
    }

    print_file() {
        local label=$1
        local path=$2
        if [ -f "$path" ]; then
            local size
            size=$(file_size "$path")
            printf "%-28s %8s\n" "$label" "$(human_size "$size")"
        else
            printf "%-28s %8s\n" "$label" "missing"
        fi
    }

    echo "=== CDN Component Sizes ==="
    echo
    echo "@mp-typing/pyright-worker"
    worker_gzip=0
    if [ -f packages/pyright-worker/dist/pyright_worker.js ]; then
        worker_size=$(file_size packages/pyright-worker/dist/pyright_worker.js)
        worker_gzip=$(gzip -c packages/pyright-worker/dist/pyright_worker.js | wc -c)
        printf "%-28s %8s (%s gzipped)\n" "worker dist" \
            "$(human_size "$worker_size")" "$(human_size "$worker_gzip")"
    else
        printf "%-28s %8s\n" "worker dist" "not built"
        echo "  Run 'just build' to create the production worker."
    fi
    print_file "worker messages.d.ts" "packages/pyright-worker/src/messages.d.ts"
    print_file "worker package.json" "packages/pyright-worker/package.json"

    echo
    echo "@mp-typing/lsp-client (CDN source modules)"
    lsp_size=0
    lsp_gzip=0
    lsp_count=0
    while IFS= read -r -d '' path; do
        size=$(file_size "$path")
        gzip_size=$(gzip -c "$path" | wc -c)
        lsp_size=$((lsp_size + size))
        lsp_gzip=$((lsp_gzip + gzip_size))
        lsp_count=$((lsp_count + 1))
    done < <(find packages/lsp-client/src -maxdepth 1 -type f \
        \( -name '*.js' -o -name '*.mjs' \) -print0)
    printf "%-28s %8s (%s gzipped, %d files)\n" "lsp-client src" \
        "$(human_size "$lsp_size")" "$(human_size "$lsp_gzip")" "$lsp_count"

    echo
    echo "Worker-embedded inputs (already included in pyright_worker.js)"
    print_file "typeshed fallback" "packages/pyright-worker/assets/typeshed-fallback.zip"
    print_file "MicroPython stdlib" "packages/pyright-worker/assets/stubs-stdlib.zip"
    print_file "default RP2 board" "packages/pyright-worker/assets/stubs-rp2.zip"

    echo
    echo "On-demand board assets"
    board_size=0
    board_count=0
    for path in packages/pyright-worker/assets/stubs-*.zip; do
        case "$path" in
            */stubs-stdlib.zip|*/stubs-rp2.zip) continue ;;
        esac
        print_file "$(basename "$path")" "$path"
        size=$(file_size "$path")
        board_size=$((board_size + size))
        board_count=$((board_count + 1))
    done
    printf "%-28s %8s (%d files)\n" "on-demand total" \
        "$(human_size "$board_size")" "$board_count"
    print_file "stubs-manifest.json" "packages/pyright-worker/assets/stubs-manifest.json"
    print_file "stub package catalog" "packages/pyright-worker/assets/stub-package-catalog.json"

    echo
    echo "Transfer summary"
    if [ "$worker_gzip" -gt 0 ]; then
        initial_transfer=$((worker_gzip + lsp_gzip))
        printf "%-28s %8s\n" "initial runtime (compressed)" \
            "$(human_size "$initial_transfer")"
    else
        printf "%-28s %8s\n" "initial runtime (compressed)" "unavailable"
    fi
    printf "%-28s %8s\n" "all optional boards" "$(human_size "$board_size")"

    echo
    echo "Note: embedded input sizes are shown for transparency and must not be"
    echo "added to the worker size. Board archives are fetched only when selected."
    echo "Compressed transfer sizes are local gzip estimates; CDN encoding may differ."
