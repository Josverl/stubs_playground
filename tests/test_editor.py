"""
Test suite for CodeMirror Python Editor
Tests the actual index.html page functionality using proper Playwright waits.

LSP-dependent tests are in test_lsp.py — this file only tests the editor UI.
"""

import pytest
from playwright.sync_api import expect

from timing import CDN_TIMEOUT, UI_TIMEOUT

pytestmark = pytest.mark.editor


def _goto_editor(page, live_server):
    """Navigate to the editor and wait for CodeMirror to initialise."""
    page.goto(f"{live_server}/index.html")
    page.wait_for_selector(".cm-editor", timeout=CDN_TIMEOUT)


def _open_options_panel(page):
    """Ensure the right-side Options panel is open (sample controls live inside it)."""
    is_open = page.evaluate("() => document.body.classList.contains('options-panel-open')")
    if is_open:
        return
    page.locator("#options-panel-handle").click()
    page.wait_for_timeout(50)
    assert page.evaluate("() => document.body.classList.contains('options-panel-open')")


def _reset_editor_state(page):
    """Restore the shared editor page to a light-theme sample-code baseline."""
    page.wait_for_selector(".cm-editor", timeout=CDN_TIMEOUT)
    page.wait_for_function(
        "() => document.getElementById('sampleSelect')?.options.length > 1",
        timeout=CDN_TIMEOUT,
    )
    if "dark-theme" in (page.locator("body").get_attribute("class") or ""):
        page.locator("#themeToggle").click()
        page.wait_for_function(
            "() => document.body.classList.contains('light-theme')",
            timeout=UI_TIMEOUT,
        )
    page.evaluate(
        """() => {
            const sampleSelect = document.getElementById('sampleSelect');
            if (sampleSelect && sampleSelect.options.length > 1) {
                sampleSelect.selectedIndex = 1;
            }
        }"""
    )
    _open_options_panel(page)
    page.locator("#loadSampleBtn").click()
    page.wait_for_function(
        "() => document.querySelector('.cm-content').innerText.trim().length > 0",
        timeout=CDN_TIMEOUT,
    )


@pytest.fixture(scope="module")
def _shared_editor_page(shared_page, live_server):
    """Module-scoped page with the editor loaded once."""
    shared_page.goto(f"{live_server}/index.html")
    shared_page.wait_for_selector(".cm-editor", timeout=CDN_TIMEOUT)
    return shared_page


@pytest.fixture
def editor_page(_shared_editor_page):
    """Return the shared editor page after restoring baseline state before the test."""
    _reset_editor_state(_shared_editor_page)
    return _shared_editor_page


# ---------------------------------------------------------------------------
# Page structure
# ---------------------------------------------------------------------------


def test_no_console_errors_on_load(page, live_server):
    """Page loads without JS errors, CSP violations, or failed resource loads."""
    errors = []
    page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
    page.on("pageerror", lambda exc: errors.append(str(exc)))

    page.goto(f"{live_server}/index.html")
    page.wait_for_selector(".cm-editor", timeout=CDN_TIMEOUT)

    # Filter out known non-issues:
    # - favicon 404 in dev
    # - LSP worker load failure (worker not built in Tier 1 editor tests)
    # - buttons.github.io 403s (star-count iframe requests blocked in headless)
    real_errors = [
        e
        for e in errors
        if "favicon" not in e.lower()
        and "Failed to initialize LSP client" not in e
        and "buttons.github.io" not in e
        and "403" not in e
    ]
    assert real_errors == [], f"Console errors on page load: {real_errors}"


def test_editor_container_exists(editor_page):
    """Editor container element is present in the DOM."""
    expect(editor_page.locator("#editor-container")).to_be_visible()


def test_extra_stubs_controls_exist(editor_page):
    """Options panel contains PyPI extra stubs install controls."""
    _open_options_panel(editor_page)
    expect(editor_page.locator("#extraStubSpecifier")).to_be_visible()
    expect(editor_page.locator("#installExtraStubBtn")).to_be_visible()
    expect(editor_page.locator("#clearExtraStubsBtn")).to_be_visible()


def test_generated_config_button_exists(editor_page):
    """Options panel contains the generated pyproject read-only action button."""
    _open_options_panel(editor_page)
    expect(editor_page.locator("#openGeneratedConfigBtn")).to_be_visible()


def test_generated_config_opens_read_only_tab_when_lsp_ready(editor_page):
    """Open Read-Only creates a pyproject.toml tab with non-editable editor content."""
    lsp_state = editor_page.evaluate(
        """() => ({
            ready: window.__lspReady === true,
            failed: window.__lspFailed === true,
        })"""
    )
    if lsp_state.get("failed") and not lsp_state.get("ready"):
        pytest.skip("LSP failed to initialize in this environment")

    _open_options_panel(editor_page)
    editor_page.locator("#openGeneratedConfigBtn").click()
    editor_page.wait_for_function(
        """() => Array.from(document.querySelectorAll('.tab-bar__label'))
            .some((el) => (el.textContent || '').includes('pyproject.toml'))""",
        timeout=CDN_TIMEOUT,
    )

    active_label = editor_page.locator(".tab-bar__tab--active .tab-bar__label").inner_text()
    assert "pyproject.toml" in active_label

    attrs = editor_page.evaluate(
        """() => {
            const el = document.querySelector('.editor-pane--active .cm-content');
            return {
                ariaReadonly: el?.getAttribute('aria-readonly') || null,
                contentEditable: el?.getAttribute('contenteditable') || null,
            };
        }"""
    )
    assert attrs["ariaReadonly"] == "true"
    assert attrs["contentEditable"] == "false"

    editor_page.locator(".tab-bar__tab", has_text="pyproject.toml").locator(".tab-bar__close").click()
    editor_page.wait_for_function(
        """() => !Array.from(document.querySelectorAll('.tab-bar__label'))
            .some((el) => (el.textContent || '').includes('pyproject.toml'))""",
        timeout=CDN_TIMEOUT,
    )


def test_footer_has_github_star_buttons_with_counts(editor_page):
    """Footer includes both GitHub star buttons configured to show star counts.

    buttons.github.io/buttons.js replaces the <a> tags in the live DOM.
    Fetch the raw HTML source to verify the static markup is correct.
    """
    raw_html = editor_page.evaluate("() => fetch(window.location.href).then(r => r.text())")
    assert 'aria-label="Star Josverl/micropython-stubs on GitHub"' in raw_html, (
        "micropython-stubs star button aria-label missing from source HTML"
    )
    assert 'aria-label="Star Josverl/mp_codemirror on GitHub"' in raw_html, (
        "mp_codemirror star button aria-label missing from source HTML"
    )
    assert 'data-show-count="true"' in raw_html, "data-show-count attribute missing from star button source HTML"


# ---------------------------------------------------------------------------
# CodeMirror initialisation
# ---------------------------------------------------------------------------


def test_codemirror_editor_initializes(editor_page):
    """CodeMirror editor, content area, and gutters are all rendered."""
    expect(editor_page.locator(".cm-editor")).to_be_visible()
    expect(editor_page.locator(".cm-content")).to_be_visible()
    expect(editor_page.locator(".cm-gutters")).to_be_visible()


def test_line_numbers_displayed(editor_page):
    """Line-number gutter is visible and contains gutter elements."""
    expect(editor_page.locator(".cm-lineNumbers")).to_be_visible()
    assert editor_page.locator(".cm-gutterElement").count() > 0, "Line number elements should exist"


def test_sample_code_loads(editor_page):
    """Initial sample code (MicroPython blink example) is loaded."""
    # Wait for real content — the placeholder is '# Loading example...'
    editor_page.wait_for_function(
        "() => document.querySelector('.cm-content').innerText.includes('machine')",
        timeout=CDN_TIMEOUT,
    )
    content = editor_page.locator(".cm-content").inner_text()
    assert "machine" in content, "Sample code should contain MicroPython imports"


def test_python_syntax_highlighting(editor_page):
    """Python syntax is highlighted — multiple .cm-line elements exist."""
    # Wait for sample content
    editor_page.wait_for_function(
        "() => document.querySelectorAll('.cm-line').length > 5",
        timeout=CDN_TIMEOUT,
    )
    expect(editor_page.locator(".cm-line").first).to_be_visible()
    assert editor_page.locator(".cm-line").count() > 5, "Sample code should produce multiple highlighted lines"


# ---------------------------------------------------------------------------
# Theme toggle
# ---------------------------------------------------------------------------


def test_initial_theme_is_light(editor_page):
    """Page starts with the light theme applied."""
    classes = editor_page.locator("body").get_attribute("class") or ""
    assert "light-theme" in classes, f"Expected light-theme on body, got: {classes!r}"


def test_theme_toggle_switches_to_dark(editor_page):
    """Clicking the theme toggle switches from light to dark."""
    body = editor_page.locator("body")
    assert "light-theme" in (body.get_attribute("class") or "")

    editor_page.locator("#themeToggle").click()
    editor_page.wait_for_function(
        "() => document.body.classList.contains('dark-theme')",
        timeout=UI_TIMEOUT,
    )
    classes = body.get_attribute("class") or ""
    assert "dark-theme" in classes, "Body should have dark-theme after toggle"


def test_theme_toggle_cycles_back_to_light(editor_page):
    """Two theme toggles return to the original light theme."""
    body = editor_page.locator("body")
    editor_page.locator("#themeToggle").click()
    editor_page.wait_for_function("() => document.body.classList.contains('dark-theme')", timeout=UI_TIMEOUT)
    editor_page.locator("#themeToggle").click()
    editor_page.wait_for_function("() => document.body.classList.contains('light-theme')", timeout=UI_TIMEOUT)
    assert "light-theme" in (body.get_attribute("class") or "")


# ---------------------------------------------------------------------------
# Editor interactions
# ---------------------------------------------------------------------------


def _clear_active_editor(page):
    """Select all content in the active CodeMirror editor and delete it."""
    # Prefer the active pane to avoid reading hidden/inactive editors.
    active_content = page.locator(".editor-pane--active .cm-content")
    if active_content.count() > 0:
        active_content.click()
    else:
        page.locator(".cm-content").click()
    page.keyboard.press("Control+a")
    page.keyboard.press("Delete")
    page.wait_for_function(
        """() => {
            const active = document.querySelector('.editor-pane--active .cm-content');
            const el = active || document.querySelector('.cm-content');
            return Boolean(el) && el.innerText.trim() === '';
        }""",
        timeout=UI_TIMEOUT,
    )


def test_clear_button_empties_editor(editor_page):
    """Clearing editor content via keyboard select-all+delete leaves editor empty."""
    _clear_active_editor(editor_page)
    assert editor_page.locator(".cm-content").inner_text().strip() == "", "Editor should be empty after clear"


def test_editor_accepts_keyboard_input(editor_page):
    """Typed text appears in the editor content."""
    _clear_active_editor(editor_page)

    editor_page.locator(".cm-content").click()
    test_text = "print('Hello, MicroPython!')"
    editor_page.keyboard.type(test_text)

    editor_page.wait_for_function(
        "() => document.querySelector('.cm-content').innerText.includes(\"Hello, MicroPython!\")",
        timeout=UI_TIMEOUT * 2,
    )
    assert "Hello, MicroPython!" in editor_page.locator(".cm-content").inner_text()


def test_tab_inserts_4_spaces_and_keeps_focus(editor_page):
    """Tab inserts 4 spaces and keeps keyboard focus in the editor."""
    _clear_active_editor(editor_page)

    editor_page.locator(".cm-content").click()
    editor_page.keyboard.type("x=1")
    editor_page.keyboard.press("Tab")
    editor_page.keyboard.type("y=2")

    content = editor_page.locator(".cm-content").inner_text()
    assert "x=1    y=2" in content, "Tab should insert exactly 4 spaces"

    focused_in_editor = editor_page.evaluate(
        """() => {
            const active = document.activeElement;
            return Boolean(active && (active.classList.contains('cm-content') || active.closest('.cm-editor')));
        }"""
    )
    assert focused_in_editor, "Focus should remain inside CodeMirror after pressing Tab"


def test_tab_and_shift_tab_indent_dedent_multiline_selection(editor_page):
    """Tab indents selected lines by 4 spaces and Shift-Tab dedents them back."""
    _clear_active_editor(editor_page)

    editor_page.locator(".cm-content").click()
    editor_page.keyboard.type("a\nb")

    editor_page.keyboard.press("Control+a")
    editor_page.keyboard.press("Tab")

    indented = editor_page.evaluate(
        "() => Array.from(document.querySelectorAll('.cm-line')).map(line => line.textContent)"
    )
    assert indented[0].startswith("    a"), "First line should be indented by 4 spaces"
    assert indented[1].startswith("    b"), "Second line should be indented by 4 spaces"

    editor_page.keyboard.press("Shift+Tab")
    dedented = editor_page.evaluate(
        "() => Array.from(document.querySelectorAll('.cm-line')).map(line => line.textContent)"
    )
    assert dedented[0] == "a", "First line should dedent back with Shift-Tab"
    assert dedented[1] == "b", "Second line should dedent back with Shift-Tab"


def test_sample_selector_populated(editor_page):
    """Example select dropdown is populated with at least one option after init."""
    # Wait for JS to populate the select with example options
    editor_page.wait_for_function(
        "() => document.getElementById('sampleSelect').options.length > 1",
        timeout=CDN_TIMEOUT,
    )
    option_count = editor_page.evaluate("() => document.getElementById('sampleSelect').options.length")
    assert option_count > 1, "sampleSelect should have example options beyond the placeholder"


def test_load_sample_button_loads_code(editor_page):
    """Load button replaces editor content with the selected sample."""
    # Clear the editor first
    _clear_active_editor(editor_page)

    # Select the first real option (index 1 skips the placeholder)
    editor_page.evaluate("() => { const s = document.getElementById('sampleSelect'); s.selectedIndex = 1; }")

    editor_page.locator("#loadSampleBtn").click()

    editor_page.wait_for_function(
        "() => document.querySelector('.cm-content').innerText.trim().length > 0",
        timeout=CDN_TIMEOUT,
    )
    content = editor_page.locator(".cm-content").inner_text()
    assert len(content.strip()) > 0, "Editor should contain code after loading sample"
    assert any(kw in content for kw in ("def", "import", "from", "#")), "Loaded sample should contain Python code"


# ---------------------------------------------------------------------------
# Responsive layout
# ---------------------------------------------------------------------------


def test_responsive_layout_desktop(page, live_server):
    """Editor container is visible at desktop resolution."""
    page.set_viewport_size({"width": 1920, "height": 1080})
    _goto_editor(page, live_server)
    expect(page.locator("#editor-container")).to_be_visible()


def test_responsive_layout_mobile(page, live_server):
    """Editor container and header are visible at mobile resolution."""
    page.set_viewport_size({"width": 375, "height": 667})
    _goto_editor(page, live_server)
    expect(page.locator("#editor-container")).to_be_visible()
    expect(page.locator("header")).to_be_visible()
