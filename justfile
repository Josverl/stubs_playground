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
    just pack
    npx webpack --mode production

# build the Pyright web worker (development, with source maps)
build-dev:
    npx webpack --mode development

# pack Pyright's typeshed-fallback into a zip for browser use
pack-typeshed:
    uv run scripts/pack-typeshed.py

# pack MicroPython board stubs into zip files for each board
pack-stubs:
    uv run scripts/pack-stubs.py

# pack MicroPython board stubs and typeshed-fallback
pack:
    just pack-typeshed
    just pack-stubs

# rebuild everything from scratch
rebuild:
    npm install --ignore-scripts
    npx webpack --mode production

# format Python code with ruff
format:
    ruff format tests/

# --- Server recipes ---

# start the threaded HTTP server (port 8888)
http:
    uv run tests/http_server.py 8888 .

# start the HTTP server and open the browser (Unix)
serve:
    #!/usr/bin/env bash
    set -euo pipefail
    echo "Starting HTTP server on port 8888..."
    uv run tests/http_server.py 8888 . &
    HTTP_PID=$!
    sleep 2
    echo "Opening browser..."
    xdg-open http://localhost:8888/src/ 2>/dev/null || open http://localhost:8888/src/ 2>/dev/null || echo "Open http://localhost:8888/src/ in your browser"
    echo "Server running (HTTP: $HTTP_PID). Press Ctrl+C to stop."
    trap "kill $HTTP_PID 2>/dev/null" EXIT INT TERM
    wait

# --- Test recipes ---

# run tests
test *args='':
    pytest tests/ -v {{args}}

# run Tier 0 Python unit tests only
test-unit-py:
    uv run pytest -m unit -v || test $? -eq 5

# run Tier 0 JavaScript unit tests only
test-unit-js:
    node --test tests/*.unit.mjs

# run all Tier 0 unit tests (Python + JavaScript)
test-unit:
    just test-unit-py
    just test-unit-js

# run only the worker transport tests
test-worker *args='':
    pytest tests/test_worker_transport.py -v {{args}}

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
    echo "@mp-codemirror/pyright-worker"
    worker_gzip=0
    if [ -f dist/pyright_worker.js ]; then
        worker_size=$(file_size dist/pyright_worker.js)
        worker_gzip=$(gzip -c dist/pyright_worker.js | wc -c)
        printf "%-28s %8s (%s gzipped)\n" "dist/pyright_worker.js" \
            "$(human_size "$worker_size")" "$(human_size "$worker_gzip")"
    else
        printf "%-28s %8s\n" "dist/pyright_worker.js" "not built"
        echo "  Run 'just build' to create the production worker."
    fi
    print_file "src/worker/messages.d.ts" "src/worker/messages.d.ts"
    print_file "src/worker/package.json" "src/worker/package.json"

    echo
    echo "@mp-codemirror/lsp-client (CDN source modules)"
    lsp_size=0
    lsp_gzip=0
    lsp_count=0
    while IFS= read -r -d '' path; do
        size=$(file_size "$path")
        gzip_size=$(gzip -c "$path" | wc -c)
        lsp_size=$((lsp_size + size))
        lsp_gzip=$((lsp_gzip + gzip_size))
        lsp_count=$((lsp_count + 1))
    done < <(find src/lsp -maxdepth 1 -type f \
        \( -name '*.js' -o -name '*.mjs' -o -name 'package.json' \) \
        ! -name 'worker-config.js' -print0)
    printf "%-28s %8s (%s gzipped, %d files)\n" "src/lsp/" \
        "$(human_size "$lsp_size")" "$(human_size "$lsp_gzip")" "$lsp_count"

    echo
    echo "Worker-embedded inputs (already included in pyright_worker.js)"
    print_file "typeshed fallback" "assets/typeshed-fallback.zip"
    print_file "MicroPython stdlib" "assets/stubs-stdlib.zip"
    print_file "default RP2 board" "assets/stubs-rp2.zip"

    echo
    echo "On-demand board assets"
    board_size=0
    board_count=0
    for path in assets/stubs-*.zip; do
        case "$path" in
            assets/stubs-stdlib.zip|assets/stubs-rp2.zip) continue ;;
        esac
        print_file "$(basename "$path")" "$path"
        size=$(file_size "$path")
        board_size=$((board_size + size))
        board_count=$((board_count + 1))
    done
    printf "%-28s %8s (%d files)\n" "on-demand total" \
        "$(human_size "$board_size")" "$board_count"
    print_file "stubs-manifest.json" "assets/stubs-manifest.json"

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
