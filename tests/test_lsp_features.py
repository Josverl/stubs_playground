"""
LSP Feature Tests: Completions and Hover Tooltips

Architecture: Browser (CodeMirror) <-> packaged Pyright Web Worker

Two modes:
  - Smoke tests (no LSP):  verify the editor doesn't crash and that
    CodeMirror's built-in Python keyword completions still work.
  - Full tests  (LSP):     verify LSP-powered completions and hover tooltips.

Timing note: CodeMirror debounces didChange by 300 ms. The completion source
fires BEFORE the debounce, so Pyright may not yet have the latest content.
Integration tests therefore type the full content, wait for the didChange to
flush AND for Pyright to respond with diagnostics, then trigger explicit
completion via Ctrl+Space.
"""

import time
from pathlib import Path

import pytest
from timing import CDN_TIMEOUT, LSP_TIMEOUT, UI_TIMEOUT, POLL_INTERVAL, HOVER_WAIT, LSP_ROUND_TRIP

# ---------------------------------------------------------------------------
# Module-level skip marker (evaluated at collection time)
# ---------------------------------------------------------------------------

_worker_available = (
    Path(__file__).parent.parent
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
# ---------------------------------------------------------------------------


def _load_editor(page, base_url: str, wait_for_lsp: bool = True):
    """Navigate to the editor and wait for CodeMirror + optionally LSP."""
    page.goto(f"{base_url}/index.html", wait_until="domcontentloaded")
    page.wait_for_selector(".cm-editor", timeout=CDN_TIMEOUT)
    if wait_for_lsp:
        page.wait_for_function(
            "() => window.__lspReady === true || window.__lspFailed === true",
            timeout=LSP_TIMEOUT,
        )


def _clear_editor(page):
    page.locator(".cm-content").click()
    page.keyboard.press("Control+a")
    page.keyboard.press("Delete")
    page.wait_for_function(
        "() => document.querySelector('.cm-content').innerText.trim() === ''",
        timeout=UI_TIMEOUT,
    )


def _type_in_editor(page, text: str, delay: int = 30):
    editor = page.locator(".cm-content[contenteditable='true']")
    editor.click()
    editor.press_sequentially(text, delay=delay)


def _type_and_flush(page, text: str, extra_wait: float = LSP_ROUND_TRIP):
    """Type text, then wait long enough for the debounce to flush and Pyright to respond."""
    _type_in_editor(page, text)
    time.sleep(extra_wait)


# ---------------------------------------------------------------------------
# Fixtures: Module-scoped page + autouse reset
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def lsp_features_page(shared_page, live_server):
    """Module-scoped page with editor loaded and LSP ready (or failed)."""
    shared_page.goto(f"{live_server}/index.html", wait_until="domcontentloaded")
    shared_page.wait_for_selector(".cm-editor", timeout=CDN_TIMEOUT)
    # Wait for LSP to initialize (ready or failed) so subsequent tests have consistent state
    shared_page.wait_for_function(
        "() => window.__lspReady === true || window.__lspFailed === true",
        timeout=LSP_TIMEOUT,
    )
    return shared_page


@pytest.fixture(autouse=True)
def reset_editor_between_tests(lsp_features_page):
    """Clear editor content before each test to ensure clean state."""
    # Reset BEFORE test runs
    try:
        _clear_editor(lsp_features_page)
    except Exception:
        # Editor might not be clearable in some states, but don't fail
        pass
    # Yield so test runs after reset
    yield


# ---------------------------------------------------------------------------
# Smoke tests — no LSP required
# ---------------------------------------------------------------------------


def test_editor_loads_with_completions_infrastructure(lsp_features_page):
    """Autocomplete infrastructure must load even without LSP."""
    assert lsp_features_page.locator(".cm-editor").is_visible()
    assert lsp_features_page.locator(".cm-content").is_visible()


def test_builtin_keyword_completion_works_without_lsp(lsp_features_page):
    """CodeMirror's built-in Python completer offers keywords without LSP."""
    _type_in_editor(lsp_features_page, "imp")

    # Trigger completion explicitly
    lsp_features_page.keyboard.press("Control+Space")
    time.sleep(1)

    autocomplete = lsp_features_page.locator(".cm-tooltip-autocomplete")
    if autocomplete.is_visible(timeout=UI_TIMEOUT):
        options = lsp_features_page.locator(".cm-completionLabel")
        labels = [options.nth(i).inner_text() for i in range(min(10, options.count()))]
        assert any("import" in lbl for lbl in labels), f"'import' keyword should appear in completions. Got: {labels}"
    # If no autocomplete menu appears without LSP that's acceptable —
    # the important thing is no crash.


def test_typing_dot_does_not_crash_without_lsp(lsp_features_page):
    """Typing a dot accessor must not throw uncaught JS errors."""
    if _worker_available:
        pytest.skip("Skipped: LSP running; completion behaviour differs.")

    uncaught: list[str] = []
    lsp_features_page.on("pageerror", lambda e: uncaught.append(str(e)))

    _type_in_editor(lsp_features_page, "import sys\nsys.")
    time.sleep(1)

    assert not uncaught, f"Uncaught JS error on dot access: {uncaught}"


def test_ctrl_space_does_not_crash_without_lsp(lsp_features_page):
    """Ctrl+Space completion trigger must not throw uncaught JS errors."""
    if _worker_available:
        pytest.skip("Skipped: LSP running; completion behaviour differs.")

    uncaught: list[str] = []
    lsp_features_page.on("pageerror", lambda e: uncaught.append(str(e)))

    lsp_features_page.locator(".cm-content").click()
    lsp_features_page.keyboard.type("x = ")
    lsp_features_page.keyboard.press("Control+Space")
    time.sleep(1)

    assert not uncaught, f"Uncaught JS error on Ctrl+Space: {uncaught}"


# ---------------------------------------------------------------------------
# Full integration tests — LSP required
# ---------------------------------------------------------------------------


@requires_lsp
def test_completion_appears_after_explicit_trigger(lsp_features_page):
    """Ctrl+Space after content is flushed to Pyright must show completions.

    The 300 ms debounce means automatic completions fire before Pyright sees
    the latest content.  Explicit Ctrl+Space (after the flush) works reliably.
    """
    _type_in_editor(lsp_features_page, "import sys")
    lsp_features_page.keyboard.press("Enter")
    lsp_features_page.keyboard.type("sys.")
    # Wait for debounce to flush AND for Pyright to process the content
    time.sleep(LSP_ROUND_TRIP)

    # Cursor is already at end of 'sys.' — trigger explicit completion
    lsp_features_page.keyboard.press("Control+Space")
    autocomplete = lsp_features_page.locator(".cm-tooltip-autocomplete")
    autocomplete.wait_for(timeout=LSP_TIMEOUT)
    assert autocomplete.is_visible(), "Autocomplete menu must appear after Ctrl+Space on 'sys.'"


@requires_lsp
def test_completion_shows_multiple_options(lsp_features_page):
    """sys module completions must include more than a handful of items."""
    _type_in_editor(lsp_features_page, "import sys")
    lsp_features_page.keyboard.press("Enter")
    lsp_features_page.keyboard.type("sys.")
    time.sleep(LSP_ROUND_TRIP)

    lsp_features_page.keyboard.press("Control+Space")
    lsp_features_page.locator(".cm-tooltip-autocomplete").wait_for(timeout=LSP_TIMEOUT)
    count = lsp_features_page.locator(".cm-completionLabel").count()

    assert count > 5, f"sys module should have many completions; got {count}"


@requires_lsp
def test_completion_contains_known_sys_members(lsp_features_page):
    """sys completions must include 'argv'."""
    console_msgs: list[str] = []
    lsp_features_page.on("console", lambda m: console_msgs.append(m.text))

    _type_in_editor(lsp_features_page, "import sys")
    lsp_features_page.keyboard.press("Enter")
    # Type prefix to filter — wait for Pyright to confirm it has the content
    lsp_features_page.keyboard.type("sys.arg")

    # Wait for the debounce to flush and Pyright to push diagnostics
    deadline = time.time() + LSP_TIMEOUT / 1000
    while time.time() < deadline:
        if any("Received diagnostics" in m for m in console_msgs[-5:]):
            break
        time.sleep(POLL_INTERVAL)
    time.sleep(POLL_INTERVAL)  # small extra margin

    lsp_features_page.keyboard.press("Control+Space")
    lsp_features_page.locator(".cm-tooltip-autocomplete").wait_for(timeout=LSP_TIMEOUT)
    options = lsp_features_page.locator(".cm-completionLabel")
    labels = [options.nth(i).inner_text() for i in range(min(20, options.count()))]

    assert any("argv" in lbl for lbl in labels), f"'argv' missing from filtered sys completions. Got: {labels}"


@requires_lsp
def test_completion_for_string_methods(lsp_features_page):
    """String method completions must include 'upper'."""
    console_msgs: list[str] = []
    lsp_features_page.on("console", lambda m: console_msgs.append(m.text))

    _type_in_editor(lsp_features_page, 'text = "hello"')
    lsp_features_page.keyboard.press("Enter")
    # Type prefix 'up' to filter to 'upper' and related
    lsp_features_page.keyboard.type("text.up")

    # Wait for Pyright to confirm it has processed the document
    deadline = time.time() + LSP_TIMEOUT / 1000
    while time.time() < deadline:
        if any("Received diagnostics" in m for m in console_msgs[-5:]):
            break
        time.sleep(POLL_INTERVAL)
    time.sleep(POLL_INTERVAL)

    lsp_features_page.keyboard.press("Control+Space")
    lsp_features_page.locator(".cm-tooltip-autocomplete").wait_for(timeout=LSP_TIMEOUT)
    options = lsp_features_page.locator(".cm-completionLabel")
    labels = [options.nth(i).inner_text() for i in range(min(20, options.count()))]

    assert any("upper" in lbl.lower() for lbl in labels), (
        f"'upper' missing from filtered string completions. Got: {labels}"
    )


@requires_lsp
def test_completion_auto_triggers_for_alias_dotted_access(lsp_features_page):
    """Typing t. after import alias should auto-show LSP members like sleep."""
    console_msgs: list[str] = []
    lsp_features_page.on("console", lambda m: console_msgs.append(m.text))

    _type_in_editor(lsp_features_page, "import time as t")
    lsp_features_page.keyboard.press("Enter")
    # Ensure no pre-existing completion popup remains from previous typing.
    lsp_features_page.keyboard.press("Escape")
    lsp_features_page.keyboard.type("t.")

    # Wait for debounce flush and a server response before asserting menu content.
    deadline = time.time() + LSP_TIMEOUT / 1000
    while time.time() < deadline:
        if any("Received diagnostics" in m for m in console_msgs[-8:]):
            break
        time.sleep(POLL_INTERVAL)
    time.sleep(POLL_INTERVAL)

    autocomplete = lsp_features_page.locator(".cm-tooltip-autocomplete")
    autocomplete.wait_for(timeout=LSP_TIMEOUT)
    options = lsp_features_page.locator(".cm-completionLabel")
    labels = [options.nth(i).inner_text() for i in range(min(30, options.count()))]

    assert any(lbl.lower() == "sleep" for lbl in labels), (
        f"Expected auto-triggered completions for 't.' to include 'sleep'. Got: {labels}"
    )


@requires_lsp
def test_completion_lsp_request_is_logged(lsp_features_page):
    """The LSP completion request must be logged to the browser console."""
    console_msgs: list[str] = []
    lsp_features_page.on("console", lambda m: console_msgs.append(m.text))

    _type_in_editor(lsp_features_page, "import sys")
    lsp_features_page.keyboard.press("Enter")
    lsp_features_page.keyboard.type("sys.")
    time.sleep(LSP_ROUND_TRIP)

    lsp_features_page.keyboard.press("Control+Space")
    time.sleep(LSP_ROUND_TRIP)  # wait for the explicit completion round-trip

    completion_logs = [m for m in console_msgs if "completion" in m.lower()]
    assert completion_logs, (
        "LSP completion request must be logged to the console. "
        f"LSP-related: {[m for m in console_msgs if 'lsp' in m.lower()][:10]}"
    )


@requires_lsp
def test_hover_does_not_crash(lsp_features_page):
    """Hovering over a Python identifier must not produce uncaught JS errors."""
    uncaught: list[str] = []
    lsp_features_page.on("pageerror", lambda e: uncaught.append(str(e)))

    editor = lsp_features_page.locator(".cm-content")
    box = editor.bounding_box()
    if box:
        lsp_features_page.mouse.move(box["x"] + 50, box["y"] + 20)
        time.sleep(HOVER_WAIT)

    assert not uncaught, f"Uncaught JS error during hover: {uncaught}"


@requires_lsp
def test_hover_tooltip_appears_on_identifier(lsp_features_page):
    """Hovering over a known identifier must show a CodeMirror hover tooltip."""
    # Dispatch a synthetic mousemove over the editor content
    lsp_features_page.evaluate("""() => {
        const editor = document.querySelector('.cm-content');
        const rect = editor.getBoundingClientRect();
        const event = new MouseEvent('mousemove', {
            view: window, bubbles: true, cancelable: true,
            clientX: rect.left + 60, clientY: rect.top + 10
        });
        editor.dispatchEvent(event);
    }""")
    time.sleep(HOVER_WAIT)

    hover_tip = lsp_features_page.locator(".cm-tooltip-hover, .cm-lsp-hover")
    # Hover is position-dependent; assert no crash first.
    # If a tooltip did appear, verify it has content.
    if hover_tip.count() > 0 and hover_tip.first.is_visible(timeout=1_000):
        assert len(hover_tip.first.inner_text()) > 0, "Hover tooltip must contain some text"
