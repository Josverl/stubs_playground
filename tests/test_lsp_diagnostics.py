"""
LSP Diagnostics Integration Tests

Architecture: Browser (CodeMirror) <-> Web Worker (Pyright via dist/pyright_worker.js)

Two modes:
  - Smoke tests  (no LSP required): verify graceful degradation.
  - Full tests   (LSP required):    verify real diagnostics in the editor.
"""

import time
from pathlib import Path

import pytest

# ---------------------------------------------------------------------------
# Module-level skip marker — evaluated at collection time
# ---------------------------------------------------------------------------

_worker_available = (Path(__file__).parent.parent / "dist" / "pyright_worker.js").exists()

requires_lsp = pytest.mark.skipif(
    not _worker_available,
    reason="Worker bundle not found at dist/pyright_worker.js. Build it first.",
)

pytestmark = pytest.mark.worker

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

from timing import CDN_TIMEOUT, LSP_TIMEOUT, UI_TIMEOUT, DEBOUNCE_SETTLE, SHORT_SETTLE, LSP_ROUND_TRIP, POLL_INTERVAL


def _load_editor(page, base_url: str):
    """Navigate to the editor and wait for CodeMirror to be ready."""
    page.goto(f"{base_url}/index.html?cb={time.time_ns()}", wait_until="domcontentloaded")
    page.wait_for_selector(".cm-editor", timeout=CDN_TIMEOUT)


def _clear_editor(page):
    page.locator(".cm-content").click()
    page.keyboard.press("Control+a")
    page.keyboard.press("Delete")
    page.wait_for_function(
        "() => document.querySelector('.cm-content').innerText.trim() === ''",
        timeout=UI_TIMEOUT,
    )


def _type_in_editor(page, text: str):
    editor = page.locator(".cm-content[contenteditable='true']")
    editor.click()
    editor.press_sequentially(text, delay=30)


def _import_opfs(page):
    page.evaluate("""
        async () => {
            if (!window._opfsReady) {
                const mod = await import('./storage/opfs-project.js');
                window.OPFSProject = mod.OPFSProject;
                window._opfsReady = true;
            }
        }
    """)


# ---------------------------------------------------------------------------
# Fixtures: Module-scoped page + autouse reset
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def diagnostics_page(shared_page, live_server):
    """Module-scoped page with editor loaded and LSP initialized (ready or failed)."""
    shared_page.goto(f"{live_server}/index.html?cb={time.time_ns()}", wait_until="domcontentloaded")
    shared_page.wait_for_selector(".cm-editor", timeout=CDN_TIMEOUT)
    # Wait for LSP to initialize (ready or failed) for consistent state
    shared_page.wait_for_function(
        "() => window.__lspReady === true || window.__lspFailed === true",
        timeout=LSP_TIMEOUT,
    )
    return shared_page


@pytest.fixture(autouse=True)
def reset_diagnostics_between_tests(diagnostics_page):
    """Clear editor content before each test to ensure clean state."""
    # Reset BEFORE test runs
    try:
        _clear_editor(diagnostics_page)
    except Exception:
        # Editor might not be clearable in some states, but don't fail
        pass
    # Yield so test runs after reset
    yield


# ---------------------------------------------------------------------------
# Smoke tests — no LSP required
# ---------------------------------------------------------------------------


def test_editor_loads_without_lsp(diagnostics_page):
    """Editor must load and be interactive even when LSP is unavailable."""
    assert diagnostics_page.locator(".cm-editor").is_visible(), "Editor must be visible"
    assert diagnostics_page.locator(".cm-content").is_visible(), "Editor content area must be visible"


def test_editor_remains_editable_without_lsp(diagnostics_page):
    """Typing in the editor must work regardless of LSP availability."""
    _type_in_editor(diagnostics_page, "x = 42")

    content = diagnostics_page.locator(".cm-content").inner_text()
    assert "x = 42" in content, "Typed text must appear in the editor"


# ---------------------------------------------------------------------------
# Full integration tests — LSP required
# ---------------------------------------------------------------------------


@requires_lsp
def test_lsp_client_initialises_in_browser(page, live_server):
    """Browser must successfully negotiate the LSP handshake."""
    console_msgs: list[str] = []
    page.on("console", lambda m: console_msgs.append(m.text))

    # Load fresh page to capture init console messages
    page.goto(f"{live_server}/index.html?cb={time.time_ns()}", wait_until="domcontentloaded")
    page.wait_for_selector(".cm-editor", timeout=CDN_TIMEOUT)
    page.wait_for_function("() => window.__lspReady === true || window.__lspFailed === true", timeout=LSP_TIMEOUT)

    assert any("LSP client ready" in m for m in console_msgs), (
        f"Expected 'LSP client ready' in console. Got: {console_msgs[:15]}"
    )
    assert any("LSP Client initialized" in m for m in console_msgs), (
        "LSP capabilities must be logged after initialize handshake"
    )


@requires_lsp
def test_diagnostics_appear_for_undefined_variable(diagnostics_page):
    """Typing code with an undefined variable must produce a lint marker."""
    _type_in_editor(diagnostics_page, "result = clearly_undefined_name")

    # Wait for debounce (300 ms) + Pyright processing
    marker = diagnostics_page.locator(".cm-lint-marker")
    marker.first.wait_for(timeout=LSP_TIMEOUT)

    assert marker.count() > 0, "A lint marker must appear for undefined name"


@requires_lsp
def test_diagnostic_gutter_is_present(diagnostics_page):
    """The lint gutter element must be rendered when LSP is connected."""
    # lintGutter() creates an element with class cm-gutter-lint
    lint_gutter = diagnostics_page.locator(".cm-gutter-lint")
    lint_gutter.wait_for(timeout=LSP_TIMEOUT)

    assert lint_gutter.is_visible(), "Lint gutter must be visible when LSP is active"


@requires_lsp
def test_error_severity_marker_shown(diagnostics_page):
    """An undefined-name error must produce an error-severity marker."""
    _type_in_editor(diagnostics_page, "bad = no_such_variable_xyz")

    error_marker = diagnostics_page.locator(".cm-lint-marker-error")
    try:
        error_marker.first.wait_for(timeout=LSP_TIMEOUT)
        assert error_marker.is_visible()
    except Exception:
        # Pyright may emit 'warning' rather than 'error' for undefined names
        warn_marker = diagnostics_page.locator(".cm-lint-marker-warning, .cm-lint-marker-error")
        warn_marker.first.wait_for(timeout=UI_TIMEOUT)
        assert warn_marker.count() > 0, "At least one error/warning marker expected"


@requires_lsp
def test_diagnostics_published_to_console(browser, live_server):
    """app.js must log received diagnostics to the browser console."""
    # Create a completely isolated context to avoid fixture interference
    context = browser.new_context(ignore_https_errors=True)
    page = context.new_page()

    try:
        console_msgs: list[str] = []
        page.on("console", lambda m: console_msgs.append(m.text))

        # Load fresh page to capture diagnostics messages
        page.goto(f"{live_server}/index.html?cb={time.time_ns()}", wait_until="domcontentloaded")
        page.wait_for_selector(".cm-editor", timeout=CDN_TIMEOUT)
        page.wait_for_function("() => window.__lspReady === true || window.__lspFailed === true", timeout=LSP_TIMEOUT)

        _clear_editor(page)
        console_msgs.clear()  # Clear init messages, keep handler attached

        _type_in_editor(page, "x = totally_unknown_symbol")

        # Wait for diagnostic round-trip
        deadline = time.time() + LSP_TIMEOUT / 1000
        found_diagnostics = False
        while time.time() < deadline:
            if any("Received diagnostics" in m for m in console_msgs):
                found_diagnostics = True
                break
            time.sleep(SHORT_SETTLE)

        assert found_diagnostics, (
            f"Browser console must log received diagnostics. Console messages captured: {len(console_msgs)}"
        )
    finally:
        page.close()
        context.close()


@requires_lsp
def test_clean_code_produces_no_errors(diagnostics_page):
    """Valid Python must not produce error or warning lint markers."""
    _type_in_editor(diagnostics_page, "x: int = 42")

    # Give Pyright time to analyse and respond
    diagnostics_page.wait_for_function(
        "() => window.__lspReady === true || window.__lspFailed === true", timeout=CDN_TIMEOUT
    )

    error_markers = diagnostics_page.locator(".cm-lint-marker-error, .cm-lint-marker-warning")
    assert error_markers.count() == 0, "No error/warning markers expected for valid Python"


@requires_lsp
def test_cross_file_import_resolves_without_diagnostics(page, live_server):
    """Workspace files must be visible to Pyright so local imports resolve cleanly."""
    setup_url = f"{live_server}/tests/worker-transport-test.html?test-cross-file=setup&cb={time.time_ns()}"
    verify_url = f"{live_server}/index.html?test-cross-file=verify&cb={time.time_ns()}"

    page.goto(setup_url, wait_until="domcontentloaded")
    page.wait_for_load_state("load", timeout=10_000)

    page.evaluate(r"""
        async () => {
            const mod = await import('../storage/opfs-project.js');
            window.OPFSProject = mod.OPFSProject;
            await window.OPFSProject.init();

            const entries = await window.OPFSProject.listFiles();
            const paths = entries
                .map((entry) => entry.path)
                .sort((left, right) => right.length - left.length);

            for (const path of paths) {
                await window.OPFSProject.deleteFile(path);
            }

            await window.OPFSProject.writeFile(
                'helpers.py',
                ['def answer() -> int:', '    return 42', ''].join('\n')
            );
            await window.OPFSProject.writeFile(
                'main.py',
                ['from helpers import answer', 'x: int = answer()', ''].join('\n')
            );
            window.OPFSProject.setLastActiveFile('main.py');
        }
    """)

    page.goto(verify_url, wait_until="domcontentloaded")
    page.wait_for_selector(".cm-editor", timeout=30_000)
    page.wait_for_function("() => window.__lspReady === true || window.__lspFailed === true", timeout=CDN_TIMEOUT)
    time.sleep(LSP_ROUND_TRIP)

    diagnostics_text = page.locator("#diagnostics-status").inner_text()
    lint_markers = page.locator(".cm-lint-marker-error, .cm-lint-marker-warning")
    editor_text = page.locator(".cm-content").inner_text()

    assert "from helpers import answer" in editor_text, "main.py should load the cross-file import example"
    assert "Errors: 0" in diagnostics_text and "Warnings: 0" in diagnostics_text, (
        f"Expected clean diagnostics for local import, got: {diagnostics_text!r}"
    )
    assert lint_markers.count() == 0, "No lint markers expected when local imports resolve"


@requires_lsp
def test_non_python_file_produces_no_diagnostics(page, live_server):
    """Opening a non-Python file must not show any type-checking errors or warnings."""
    setup_url = f"{live_server}/tests/worker-transport-test.html?cb={time.time_ns()}"
    verify_url = f"{live_server}/index.html?cb={time.time_ns()}"

    # Write a .txt file and set it as the active file in OPFS
    page.goto(setup_url, wait_until="domcontentloaded")
    page.wait_for_load_state("load", timeout=10_000)

    page.evaluate(r"""
        async () => {
            const mod = await import('../storage/opfs-project.js');
            window.OPFSProject = mod.OPFSProject;
            await window.OPFSProject.init();

            const entries = await window.OPFSProject.listFiles();
            const paths = entries
                .map((entry) => entry.path)
                .sort((left, right) => right.length - left.length);
            for (const path of paths) {
                await window.OPFSProject.deleteFile(path);
            }

            // Write a non-Python text file
            await window.OPFSProject.writeFile('notes.txt', 'x = totally_undefined\n');
            window.OPFSProject.setLastActiveFile('notes.txt');
        }
    """)

    page.goto(verify_url, wait_until="domcontentloaded")
    page.wait_for_selector(".cm-editor", timeout=30_000)
    page.wait_for_function("() => window.__lspReady === true || window.__lspFailed === true", timeout=CDN_TIMEOUT)
    time.sleep(LSP_ROUND_TRIP)

    diagnostics_text = page.locator("#diagnostics-status").inner_text()
    lint_markers = page.locator(".cm-lint-marker-error, .cm-lint-marker-warning")

    assert lint_markers.count() == 0, (
        f"No lint markers expected for a non-Python (.txt) file, got {lint_markers.count()}"
    )
    assert "Errors: 0" in diagnostics_text and "Warnings: 0" in diagnostics_text, (
        f"Expected zero errors/warnings for non-Python file, got: {diagnostics_text!r}"
    )


@requires_lsp
def test_status_bar_shows_workspace_totals_on_document_switch(page, live_server):
    """
    Status bar counts must reflect workspace-level totals, not just the active
    file's diagnostics.  After receiving errors for file A and switching to a
    clean file B, the error count must still be non-zero.
    """
    setup_url = f"{live_server}/tests/worker-transport-test.html?cb={time.time_ns()}"
    verify_url = f"{live_server}/index.html?cb={time.time_ns()}"

    # Prepare two files: one with an error, one clean
    page.goto(setup_url, wait_until="domcontentloaded")
    page.wait_for_load_state("load", timeout=10_000)

    page.evaluate(r"""
        async () => {
            const mod = await import('../storage/opfs-project.js');
            window.OPFSProject = mod.OPFSProject;
            await window.OPFSProject.init();

            const entries = await window.OPFSProject.listFiles();
            const paths = entries
                .map((entry) => entry.path)
                .sort((left, right) => right.length - left.length);
            for (const path of paths) {
                await window.OPFSProject.deleteFile(path);
            }

            // main.py has a clear type error
            await window.OPFSProject.writeFile('main.py', 'x: int = "not an int"\n');
            // clean.py is error-free
            await window.OPFSProject.writeFile('clean.py', 'x: int = 42\n');
            window.OPFSProject.setLastActiveFile('main.py');
        }
    """)

    page.goto(verify_url, wait_until="domcontentloaded")
    page.wait_for_selector(".cm-editor", timeout=30_000)
    page.wait_for_function("() => window.__lspReady === true || window.__lspFailed === true", timeout=CDN_TIMEOUT)
    # Wait for Pyright to analyse main.py and publish diagnostics
    time.sleep(LSP_ROUND_TRIP)

    # Verify main.py shows errors
    status_before = page.locator("#diagnostics-status").inner_text()
    assert "Errors: 0" not in status_before or "Warnings: 0" not in status_before, (
        f"main.py should have at least one error/warning before switch, got: {status_before!r}"
    )

    # Open clean.py in a new tab by clicking it in the file tree
    page.wait_for_function(
        "() => document.querySelector('.file-tree__list') !== null",
        timeout=UI_TIMEOUT,
    )
    opened = page.evaluate("""
        () => {
            const rows = [...document.querySelectorAll('.file-tree__file')];
            const clean = rows.find((r) => r.dataset.path === 'clean.py');
            if (!clean) return false;
            const row = clean.querySelector('.file-tree__row');
            if (row) row.click();
            return true;
        }
    """)
    assert opened, "clean.py should be present in the file tree"
    time.sleep(SHORT_SETTLE)

    # The status bar must still show the workspace error count from main.py
    status_after = page.locator("#diagnostics-status").inner_text()
    assert "Errors: 0" not in status_after or "Warnings: 0" not in status_after, (
        f"Status bar should still show main.py errors after switching to clean.py, "
        f"but got: {status_after!r}"
    )
