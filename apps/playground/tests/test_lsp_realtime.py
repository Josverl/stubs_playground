"""
LSP Real-Time Diagnostics Tests

These tests verify that the browser's CodeMirror editor receives live
diagnostics from the Pyright Web Worker as the user types, including:
  - didChange notifications being sent and debounced
  - version counter incrementing correctly
  - diagnostics being updated when code changes

All tests require the packaged Pyright worker bundle.
"""

import re
import time
from pathlib import Path

import pytest

from tests.timing import CDN_TIMEOUT, LSP_TIMEOUT, DEBOUNCE_MS, DEBOUNCE_SETTLE, SHORT_SETTLE, POLL_INTERVAL

# ---------------------------------------------------------------------------
# Module-level skip marker
# ---------------------------------------------------------------------------

_worker_available = (
    Path(__file__).parents[3]
    / "packages"
    / "pyright-worker"
    / "dist"
    / "pyright_worker.js"
).exists()

requires_lsp = pytest.mark.skipif(
    not _worker_available,
    reason="Worker bundle not found. Build it first.",
)

pytestmark = pytest.mark.worker

# ---------------------------------------------------------------------------
# Helpers
def _load_and_wait(page, base_url: str):
    """Navigate to editor and wait for LSP to initialise."""
    page.goto(f"{base_url}/index.html", wait_until="domcontentloaded")
    page.wait_for_selector(".cm-editor", timeout=CDN_TIMEOUT)
    page.wait_for_function("() => window.__lspReady === true || window.__lspFailed === true", timeout=15000)


def _clear_editor(page):
    page.locator(".editor-pane--active .cm-content").click()
    page.keyboard.press("Control+a")
    page.keyboard.press("Delete")
    page.wait_for_function(
        "() => document.querySelector('.editor-pane--active .cm-content')?.innerText.trim() === ''",
        timeout=5000,
    )
    # Wait for the 300ms debounce from the clear to fire and flush before
    # callers call console.clear() and start typing.  Without this, the
    # clear's debounce is cancelled by the first keystroke of the next
    # _type_in_editor call and "Sending didChange" is never logged.
    time.sleep(DEBOUNCE_SETTLE)


def _type_in_editor(page, text: str, delay: int = 50):
    editor = page.locator(".editor-pane--active .cm-content[contenteditable='true']")
    editor.click()
    editor.press_sequentially(text, delay=delay)


def _open_tree_file(page, file_name: str):
    items = page.locator(".file-tree__file")
    for i in range(items.count()):
        item = items.nth(i)
        if file_name in item.inner_text():
            item.locator(".file-tree__row").click()
            return True
    return False


# ---------------------------------------------------------------------------
# Fixtures: Module-scoped page + autouse reset
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def realtime_page(shared_page, live_server):
    """Module-scoped page with editor loaded and LSP initialized."""
    shared_page.goto(f"{live_server}/index.html", wait_until="domcontentloaded")
    shared_page.wait_for_selector(".cm-editor", timeout=CDN_TIMEOUT)
    shared_page.wait_for_function(
        "() => window.__lspReady === true || window.__lspFailed === true",
        timeout=15000,
    )
    return shared_page


@pytest.fixture(autouse=True)
def reset_editor_between_tests(realtime_page):
    """Clear editor with proper debounce settle before each test."""
    # Reset BEFORE test runs
    try:
        _clear_editor(realtime_page)
    except Exception:
        # If clear fails, continue anyway
        pass
    yield


# ---------------------------------------------------------------------------
# Real-time diagnostics tests
# ---------------------------------------------------------------------------


@requires_lsp
def test_lsp_server_connects_via_browser(page, live_server):
    """Browser must log a successful transport connection and LSP handshake."""
    console: list[str] = []
    page.on("console", lambda m: console.append(m.text))

    # Load fresh page to capture init messages
    page.goto(f"{live_server}/index.html", wait_until="domcontentloaded")
    page.wait_for_selector(".cm-editor", timeout=CDN_TIMEOUT)
    page.wait_for_function("() => window.__lspReady === true || window.__lspFailed === true", timeout=15000)

    transport_connected = any("Transport connected" in m for m in console)
    lsp_ready = any("LSP client ready" in m for m in console)

    assert transport_connected, f"Transport connection message not found. Console: {console[:15]}"
    assert lsp_ready, f"'LSP client ready' not found in console. Console: {console[:15]}"


@requires_lsp
def test_did_change_notification_sent_on_typing(page, live_server):
    """Editing the document must trigger a didChange notification to the LSP."""
    console: list[str] = []
    page.on("console", lambda m: console.append(m.text))

    # Load fresh page to capture console messages
    page.goto(f"{live_server}/index.html", wait_until="domcontentloaded")
    page.wait_for_selector(".cm-editor", timeout=CDN_TIMEOUT)
    page.wait_for_function(
        "() => window.__lspReady === true || window.__lspFailed === true",
        timeout=15000,
    )

    _clear_editor(page)
    console.clear()

    _type_in_editor(page, "import nonexistent_module")
    didchange_msgs = [m for m in console if "Sending didChange" in m]
    assert didchange_msgs, (
        f"Expected 'Sending didChange' in console after typing. Console: {[m for m in console if 'did' in m.lower()]}"
    )


@requires_lsp
def test_diagnostics_received_for_invalid_import(page, live_server):
    """Invalid import statement must result in diagnostics being received."""
    console: list[str] = []
    page.on("console", lambda m: console.append(m.text))

    # Load fresh page to capture console messages
    page.goto(f"{live_server}/index.html", wait_until="domcontentloaded")
    page.wait_for_selector(".cm-editor", timeout=CDN_TIMEOUT)
    page.wait_for_function(
        "() => window.__lspReady === true || window.__lspFailed === true",
        timeout=15000,
    )

    _clear_editor(page)
    console.clear()

    _type_in_editor(page, "import nonexistent_module_xyz")

    # Wait for debounce + Pyright round-trip
    deadline = time.time() + LSP_TIMEOUT / 1000
    while time.time() < deadline:
        if any("Received diagnostics" in m for m in console):
            break
        time.sleep(SHORT_SETTLE)

    assert any("Received diagnostics" in m for m in console), (
        "Pyright must push diagnostics after an invalid import. "
        f"Console: {[m for m in console if 'diagnostic' in m.lower()]}"
    )


@requires_lsp
def test_lint_marker_appears_in_gutter_on_typing(realtime_page):
    """Typing invalid code must cause a lint marker to appear in the gutter."""
    _type_in_editor(realtime_page, "result = undefined_var_abc")

    marker = realtime_page.locator(".cm-lint-marker")
    marker.first.wait_for(timeout=LSP_TIMEOUT)
    assert marker.count() > 0, "Lint marker must appear after typing invalid code"


@requires_lsp
def test_did_change_is_debounced(page, live_server):
    """Rapid typing must produce at most a few didChange notifications, not one per key."""
    console: list[str] = []
    page.on("console", lambda m: console.append(m.text))

    # Load fresh page to capture console messages
    page.goto(f"{live_server}/index.html", wait_until="domcontentloaded")
    page.wait_for_selector(".cm-editor", timeout=CDN_TIMEOUT)
    page.wait_for_function(
        "() => window.__lspReady === true || window.__lspFailed === true",
        timeout=15000,
    )

    _clear_editor(page)
    console.clear()

    # Type quickly (50 ms per key → 5 keys in ~250 ms, less than debounce window)
    _type_in_editor(page, "x = 1", delay=50)

    # Wait for the debounce window to flush
    time.sleep((DEBOUNCE_MS + 400) / 1000)

    didchange_count = sum(1 for m in console if "Sending didChange" in m)
    assert didchange_count <= 2, f"Debouncer must coalesce rapid keystrokes; got {didchange_count} notifications"


@requires_lsp
def test_document_version_increments(page, live_server):
    """Each debounced change must increment the LSP document version."""
    console: list[str] = []
    page.on("console", lambda m: console.append(m.text))

    # Load fresh page to capture console messages
    page.goto(f"{live_server}/index.html", wait_until="domcontentloaded")
    page.wait_for_selector(".cm-editor", timeout=CDN_TIMEOUT)
    page.wait_for_function(
        "() => window.__lspReady === true || window.__lspFailed === true",
        timeout=15000,
    )

    _clear_editor(page)
    console.clear()

    version_re = re.compile(r"version\s+(\d+)", re.IGNORECASE)

    # First edit
    _type_in_editor(page, "x = 1")
    time.sleep((DEBOUNCE_MS + 400) / 1000)

    # Second edit
    page.locator(".cm-content").press("Enter")
    _type_in_editor(page, "y = 2")
    time.sleep((DEBOUNCE_MS + 400) / 1000)

    versions = [int(m.group(1)) for msg in console if "Sending didChange" in msg for m in [version_re.search(msg)] if m]

    assert len(versions) >= 1, (
        f"At least one version number must be logged. Console: {[m for m in console if 'didChange' in m]}"
    )
    if len(versions) > 1:
        assert versions[-1] > versions[0], f"Version must strictly increase: {versions}"


@requires_lsp
def test_diagnostics_update_when_code_fixed(page, live_server):
    """Replacing invalid code with valid code must trigger a new diagnostics push."""
    console: list[str] = []
    page.on("console", lambda m: console.append(m.text))

    # Load fresh page to capture console messages
    page.goto(f"{live_server}/index.html", wait_until="domcontentloaded")
    page.wait_for_selector(".cm-editor", timeout=CDN_TIMEOUT)
    page.wait_for_function(
        "() => window.__lspReady === true || window.__lspFailed === true",
        timeout=15000,
    )

    _clear_editor(page)
    console.clear()

    # Step 1: introduce an error
    _type_in_editor(page, "x = totally_undefined")
    deadline = time.time() + LSP_TIMEOUT / 1000
    while time.time() < deadline:
        if any("Received diagnostics" in m for m in console):
            break
        time.sleep(SHORT_SETTLE)

    assert any("Received diagnostics" in m for m in console), "Should receive diagnostics for invalid code first"
    console.clear()

    # Step 2: use the Clear button, then type valid code
    _clear_editor(page)
    _type_in_editor(page, "x: int = 42")

    deadline = time.time() + LSP_TIMEOUT / 1000
    while time.time() < deadline:
        if any("Received diagnostics" in m for m in console):
            break
        time.sleep(SHORT_SETTLE)

    assert any("Received diagnostics" in m for m in console), (
        "Pyright must push updated diagnostics after fixing the code"
    )


@requires_lsp
def test_close_tab_cancels_pending_did_change(page, live_server):
    """Closing a tab before debounce flush must cancel pending didChange for that file."""
    console: list[str] = []
    page.on("console", lambda m: console.append(m.text))
    page.on("dialog", lambda d: d.accept())

    # Load fresh page for this test which requires specific file state
    page.goto(f"{live_server}/index.html", wait_until="domcontentloaded")
    page.wait_for_selector(".cm-editor", timeout=CDN_TIMEOUT)
    page.wait_for_function("() => window.__lspReady === true || window.__lspFailed === true", timeout=15000)

    page.evaluate("""
        async () => {
            const mod = await import('./storage/opfs-project.js');
            await mod.OPFSProject.writeFile('debounce_close.py', '# debounce target');
            location.reload();
        }
    """)

    page.wait_for_selector(".cm-editor", timeout=CDN_TIMEOUT)
    page.wait_for_function("() => window.__lspReady === true || window.__lspFailed === true", timeout=15000)
    time.sleep(1.0)  # OPFS reload settle

    assert _open_tree_file(page, "debounce_close.py"), "debounce_close.py should be in the file tree"
    time.sleep(POLL_INTERVAL)

    console.clear()
    _type_in_editor(page, "\n# pending", delay=10)

    # Close the edited tab before debounce timer fires.
    tabs = page.locator(".tab-bar__tab")
    closed = False
    for i in range(tabs.count()):
        tab = tabs.nth(i)
        if "debounce_close.py" in tab.inner_text():
            tab.locator(".tab-bar__close").click()
            closed = True
            break
    assert closed, "Expected debounce_close.py tab to be closable"
    page.wait_for_function(
        """() => {
            const tabs = [...document.querySelectorAll('.tab-bar__tab')];
            return tabs.every((t) => !t.textContent.includes('debounce_close.py'));
        }""",
        timeout=5000,
    )

    time.sleep((DEBOUNCE_MS + 600) / 1000)

    stale_logs = [m for m in console if "Sending didChange debounce_close.py" in m]
    assert not stale_logs, f"No didChange should fire after closing tab: {stale_logs}"


@requires_lsp
def test_document_version_does_not_drift_across_tab_switches(page, live_server):
    """Each per-URI version must increment monotonically; switching tabs must not reset it."""
    console: list[str] = []
    page.on("console", lambda m: console.append(m.text))

    # Load fresh page for this test which requires specific file state
    page.goto(f"{live_server}/index.html", wait_until="domcontentloaded")
    page.wait_for_selector(".cm-editor", timeout=CDN_TIMEOUT)
    page.wait_for_function("() => window.__lspReady === true || window.__lspFailed === true", timeout=15000)

    page.evaluate("""
        async () => {
            const mod = await import('./storage/opfs-project.js');
            await mod.OPFSProject.writeFile('drift_a.py', '# a')
            await mod.OPFSProject.writeFile('drift_b.py', '# b')
            location.reload();
        }
    """)
    page.wait_for_selector(".cm-editor", timeout=CDN_TIMEOUT)
    page.wait_for_function("() => window.__lspReady === true || window.__lspFailed === true", timeout=15000)
    time.sleep(1.0)  # OPFS reload settle

    assert _open_tree_file(page, "drift_a.py"), "drift_a.py should be in tree"
    time.sleep(POLL_INTERVAL)

    # Edit A twice
    _type_in_editor(page, "\n# edit-a-1", delay=15)
    time.sleep((DEBOUNCE_MS + 400) / 1000)
    _type_in_editor(page, "\n# edit-a-2", delay=15)
    time.sleep((DEBOUNCE_MS + 400) / 1000)

    # Switch to B and edit
    assert _open_tree_file(page, "drift_b.py"), "drift_b.py should be in tree"
    time.sleep(DEBOUNCE_SETTLE)
    _type_in_editor(page, "\n# edit-b-1", delay=15)
    time.sleep((DEBOUNCE_MS + 400) / 1000)

    # Switch back to A and edit again
    tabs = page.locator(".tab-bar__tab")
    for i in range(tabs.count()):
        tab = tabs.nth(i)
        if "drift_a.py" in tab.inner_text():
            tab.click()
            break
    time.sleep(DEBOUNCE_SETTLE)
    _type_in_editor(page, "\n# edit-a-3", delay=15)
    time.sleep((DEBOUNCE_MS + 400) / 1000)

    # Collect versions per file from console logs
    version_re = re.compile(r"Sending didChange (\S+) \(version (\d+)\)")
    versions_a: list[int] = []
    versions_b: list[int] = []
    for msg in console:
        m = version_re.search(msg)
        if not m:
            continue
        path, ver = m.group(1), int(m.group(2))
        if path == "drift_a.py":
            versions_a.append(ver)
        elif path == "drift_b.py":
            versions_b.append(ver)

    assert len(versions_a) >= 2, f"Expected multiple didChange for drift_a.py, got {versions_a}"
    assert versions_a == sorted(versions_a) and len(set(versions_a)) == len(versions_a), (
        f"drift_a.py versions must strictly increase across tab switches: {versions_a}"
    )
    if versions_b:
        assert versions_b == sorted(versions_b) and len(set(versions_b)) == len(versions_b), (
            f"drift_b.py versions must strictly increase: {versions_b}"
        )
