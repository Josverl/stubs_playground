"""
Test suite for shareable links feature.

Tests URL encoding/decoding, share dropdown UI, and URL restoration.
"""

import pytest
from playwright.sync_api import expect
from timing import CDN_TIMEOUT

pytestmark = pytest.mark.editor


def _goto_editor(page, live_server):
    """Navigate to the editor and wait for CodeMirror to initialise."""
    page.goto(f"{live_server}/index.html", wait_until="domcontentloaded")
    page.wait_for_selector(".cm-editor", timeout=CDN_TIMEOUT)


def _reset_share_state(page):
    """Restore a clean in-page baseline before each shared-page test."""
    page.wait_for_selector(".cm-editor", timeout=CDN_TIMEOUT)
    page.evaluate("() => window.history.replaceState({}, '', window.location.pathname)")
    if page.locator("#shareDropdown").is_visible():
        page.keyboard.press("Escape")
    expect(page.locator("#shareDropdown")).to_be_hidden()


def _open_options_panel(page):
    """Ensure the right-side Options panel is open (Share lives inside it)."""
    is_open = page.evaluate("() => document.body.classList.contains('options-panel-open')")
    if is_open:
        return
    page.locator("#options-panel-handle").click()
    page.wait_for_timeout(50)
    assert page.evaluate("() => document.body.classList.contains('options-panel-open')")


@pytest.fixture(scope="module")
def _shared_share_page(shared_page, live_server):
    """Module-scoped page for share tests that do not require navigation isolation."""
    _goto_editor(shared_page, live_server)
    return shared_page


@pytest.fixture
def share_page(_shared_share_page):
    """Return the shared page after restoring baseline state before the test."""
    _reset_share_state(_shared_share_page)
    return _shared_share_page


# ---------------------------------------------------------------------------
# Share dropdown UI
# ---------------------------------------------------------------------------


def test_share_button_exists(share_page):
    """Share button is present in the header."""
    expect(share_page.locator("#shareBtn")).to_be_visible()


def test_share_dropdown_hidden_by_default(share_page):
    """Share dropdown is hidden on page load."""
    expect(share_page.locator("#shareDropdown")).to_be_hidden()


def test_share_dropdown_opens_on_click(share_page):
    """Clicking the Share button shows the dropdown."""
    _open_options_panel(share_page)
    share_page.locator("#shareBtn").click()
    expect(share_page.locator("#shareDropdown")).to_be_visible()


def test_share_dropdown_has_three_options(share_page):
    """Dropdown contains the three copy options."""
    _open_options_panel(share_page)
    share_page.locator("#shareBtn").click()
    expect(share_page.locator("#copyLink")).to_be_visible()
    expect(share_page.locator("#copyMdLink")).to_be_visible()
    expect(share_page.locator("#copyMdCode")).to_be_visible()


def test_share_warning_hidden_for_small_payload(share_page):
    """Small projects should not show the large payload warning."""
    _open_options_panel(share_page)
    share_page.locator("#shareBtn").click()
    expect(share_page.locator("#sharePayloadWarning")).to_be_hidden()


def test_share_warning_visible_for_large_payload(share_page):
    """Large projects should show a visible warning when Share is opened."""
    share_page.evaluate("""async () => {
        const { setEditorContent } = await import('./app.js');
        let seed = 0x12345678;
        const chars = [];
        for (let i = 0; i < 320000; i++) {
            seed = (1664525 * seed + 1013904223) >>> 0;
            chars.push(String.fromCharCode(33 + (seed % 90)));
        }
        setEditorContent(chars.join(''));
    }""")

    _open_options_panel(share_page)
    share_page.locator("#shareBtn").click()
    warning = share_page.locator("#sharePayloadWarning")
    expect(warning).to_be_visible()
    expect(warning).to_contain_text("Large share payload")


def test_share_dropdown_closes_on_outside_click(share_page):
    """Clicking outside the modal dialog (on the dim backdrop) closes it."""
    _open_options_panel(share_page)
    share_page.locator("#shareBtn").click()
    expect(share_page.locator("#shareDropdown")).to_be_visible()

    # The share modal is centered; click a viewport corner that is only backdrop.
    share_page.mouse.click(5, 5)
    expect(share_page.locator("#shareDropdown")).to_be_hidden()


def test_share_dropdown_closes_on_escape(share_page):
    """Pressing Escape closes the dropdown."""
    _open_options_panel(share_page)
    share_page.locator("#shareBtn").click()
    expect(share_page.locator("#shareDropdown")).to_be_visible()

    share_page.keyboard.press("Escape")
    expect(share_page.locator("#shareDropdown")).to_be_hidden()


def test_share_dropdown_toggles(share_page):
    """Opening then clicking outside the modal closes it (modal toggle behaviour)."""
    _open_options_panel(share_page)
    share_page.locator("#shareBtn").click()
    expect(share_page.locator("#shareDropdown")).to_be_visible()
    # The backdrop covers the share button while the modal is open.
    # Click the backdrop corner to dismiss.
    share_page.mouse.click(5, 5)
    expect(share_page.locator("#shareDropdown")).to_be_hidden()


def test_copy_shows_brief_feedback_then_closes_dropdown(share_page):
    """Copy action should briefly show copied feedback and auto-close dropdown."""
    _open_options_panel(share_page)
    share_page.locator("#shareBtn").click()
    expect(share_page.locator("#shareDropdown")).to_be_visible()

    # Stub clipboard write so the copy path is deterministic in tests.
    share_page.evaluate("""() => {
        const original = navigator.clipboard;
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: {
                writeText: async () => {},
            },
        });
        window.__restoreClipboardWriteText = () => {
            Object.defineProperty(navigator, 'clipboard', {
                configurable: true,
                value: original,
            });
        };
    }""")

    option = share_page.locator("#copyMdLink")
    option.click()
    expect(option).to_contain_text("Copied")

    share_page.wait_for_timeout(1250)
    expect(share_page.locator("#shareDropdown")).to_be_hidden()

    share_page.evaluate("""() => {
        if (typeof window.__restoreClipboardWriteText === 'function') {
            window.__restoreClipboardWriteText();
        }
    }""")


# ---------------------------------------------------------------------------
# Compression roundtrip (tested in-browser via evaluate)
# ---------------------------------------------------------------------------


def test_compress_decompress_roundtrip(share_page):
    """Compressing and decompressing code yields the original text."""
    result = share_page.evaluate("""async () => {
        const { compressCode, decompressCode } = await import('./share.js');
        const original = 'from machine import Pin\\nled = Pin(2, Pin.OUT)\\nled.on()';
        const compressed = await compressCode(original);
        const restored = await decompressCode(compressed);
        return { ok: restored === original, compressed, original, restored };
    }""")
    assert result["ok"], f"Roundtrip failed: {result['original']!r} != {result['restored']!r}"


def test_compress_empty_string(share_page):
    """Empty string compresses and decompresses correctly."""
    result = share_page.evaluate("""async () => {
        const { compressCode, decompressCode } = await import('./share.js');
        const compressed = await compressCode('');
        const restored = await decompressCode(compressed);
        return restored === '';
    }""")
    assert result is True


def test_compress_unicode(share_page):
    """Unicode characters survive compression roundtrip."""
    result = share_page.evaluate("""async () => {
        const { compressCode, decompressCode } = await import('./share.js');
        const original = '# Ünïcödé: 日本語 🐍';
        const compressed = await compressCode(original);
        const restored = await decompressCode(compressed);
        return restored === original;
    }""")
    assert result is True


# ---------------------------------------------------------------------------
# URL building
# ---------------------------------------------------------------------------


def test_build_shareable_url_contains_params(share_page):
    """buildShareableUrl produces a URL with selected settings and project payload."""
    result = share_page.evaluate("""async () => {
        const { buildShareableUrl } = await import('./share.js');
        const url = await buildShareableUrl('x = 1', 'esp32', 'strict', 'micropython', '3.12');
        const parsed = new URL(url);
        return {
            board: parsed.searchParams.get('board'),
            typeCheckMode: parsed.searchParams.get('typeCheckMode'),
            stdlib: parsed.searchParams.get('stdlib'),
            pythonVersion: parsed.searchParams.get('pythonVersion'),
            hasProject: parsed.searchParams.has('project'),
            hasLegacyCode: parsed.searchParams.has('code'),
            hasVerbose: parsed.searchParams.has('verbose'),
            hasVerboseOutput: parsed.searchParams.has('verboseOutput'),
        };
    }""")
    assert result["board"] == "esp32"
    assert result["typeCheckMode"] == "strict"
    assert result["stdlib"] == "micropython"
    assert result["pythonVersion"] == "3.12"
    assert result["hasProject"] is True
    assert result["hasLegacyCode"] is False
    assert result["hasVerbose"] is False
    assert result["hasVerboseOutput"] is False


# ---------------------------------------------------------------------------
# URL restoration (shareable link loads code + settings)
# ---------------------------------------------------------------------------


def test_url_restores_code(page, live_server):
    """Loading a URL with project param restores the code in the editor."""
    _goto_editor(page, live_server)
    url = page.evaluate("""async () => {
        const { buildShareableUrl } = await import('./share.js');
        return await buildShareableUrl({ 'main.py': 'x = 42\\nprint(x)' }, '', 'standard');
    }""")

    # Navigate to that shareable URL
    page.goto(url, wait_until="domcontentloaded")
    page.wait_for_selector(".cm-editor", timeout=CDN_TIMEOUT)

    content = page.evaluate("() => document.querySelector('.cm-content').innerText")
    assert "x = 42" in content
    assert "print(x)" in content


def test_url_restores_multiple_files_with_names(page, live_server):
    """Project shares restore every file path, preserving original names."""
    _goto_editor(page, live_server)
    url = page.evaluate("""async () => {
        const { buildShareableUrl } = await import('./share.js');
        return await buildShareableUrl({
            'main.py': 'print(\"main\")',
            'lib/utils.py': 'VALUE = 7',
            'drivers/sensor.py': 'class Sensor: pass',
        }, 'esp32', 'standard');
    }""")

    page.goto(url, wait_until="domcontentloaded")
    page.wait_for_selector(".cm-editor", timeout=CDN_TIMEOUT)

    restored_files = page.evaluate("""async () => {
        const { OPFSProject } = await import('./storage/opfs-project.js');
        const entries = await OPFSProject.listFiles();
        return entries.filter(e => e.type === 'file').map(e => e.path).sort();
    }""")

    assert 'main.py' in restored_files
    assert 'lib/utils.py' in restored_files
    assert 'drivers/sensor.py' in restored_files


def test_url_restores_board(page, live_server):
    """Loading a URL with board param selects that board."""
    _goto_editor(page, live_server)
    url = page.evaluate("""async () => {
        const { buildShareableUrl } = await import('./share.js');
        return await buildShareableUrl({ 'main.py': 'pass' }, 'esp32', 'standard');
    }""")

    page.goto(url, wait_until="domcontentloaded")
    page.wait_for_selector(".cm-editor", timeout=CDN_TIMEOUT)

    board = page.evaluate("() => document.getElementById('boardSelect').value")
    assert board == "esp32"


def test_url_board_preloads_matching_stubs(page, live_server):
    """URL board selection must preload stubs for the same board before LSP init."""
    _goto_editor(page, live_server)
    url = page.evaluate("""async () => {
        const { buildShareableUrl } = await import('./share.js');
        return await buildShareableUrl({ 'main.py': 'from machine import CAN' }, 'stm32', 'standard');
    }""")

    page.goto(url, wait_until="domcontentloaded")
    page.wait_for_selector(".cm-editor", timeout=CDN_TIMEOUT)
    page.wait_for_function("() => document.getElementById('boardSelect').value === 'stm32'")

    page.wait_for_function(
        "() => performance.getEntriesByType('resource').some(e => e.name.includes('stubs-stm32.zip'))",
        timeout=5000,
    )
    fetched_resources = page.evaluate("() => performance.getEntriesByType('resource').map(e => e.name)")
    assert any("stubs-stm32.zip" in url for url in fetched_resources), (
        "Expected STM32 stubs to be fetched during URL-based board restore."
    )


def test_url_restores_typecheck_mode(page, live_server):
    """Loading a URL with typeCheckMode param selects that mode."""
    _goto_editor(page, live_server)
    url = page.evaluate("""async () => {
        const { buildShareableUrl } = await import('./share.js');
        return await buildShareableUrl({ 'main.py': 'pass' }, 'esp32', 'strict');
    }""")

    page.goto(url, wait_until="domcontentloaded")
    page.wait_for_selector(".cm-editor", timeout=CDN_TIMEOUT)

    mode = page.evaluate("() => document.getElementById('typeCheckMode').value")
    assert mode == "strict"


def test_url_restores_stdlib_and_python_version(page, live_server):
    """Loading a URL restores stdlib selector and pythonVersion selector values."""
    _goto_editor(page, live_server)
    url = page.evaluate("""async () => {
        const { buildShareableUrl } = await import('./share.js');
        return await buildShareableUrl({ 'main.py': 'pass' }, 'esp32', 'standard', 'cpython', '3.14');
    }""")

    page.goto(url, wait_until="domcontentloaded")
    page.wait_for_selector(".cm-editor", timeout=CDN_TIMEOUT)

    stdlib_toggle = page.evaluate("() => document.getElementById('typeshedPathToggle').checked")
    python_version = page.evaluate("() => document.getElementById('pythonVersion').value")

    assert stdlib_toggle is False  # Off = CPython
    assert python_version == "3.14"


def test_url_params_cleaned_after_restore(page, live_server):
    """After restoring from URL params, the address bar is cleaned up."""
    _goto_editor(page, live_server)
    url = page.evaluate("""async () => {
        const { buildShareableUrl } = await import('./share.js');
        return await buildShareableUrl({ 'main.py': 'pass' }, '', 'standard');
    }""")

    page.goto(url, wait_until="domcontentloaded")
    page.wait_for_selector(".cm-editor", timeout=CDN_TIMEOUT)

    # Wait for URL to be cleaned
    page.wait_for_function(
        "() => window.location.search === ''",
        timeout=5000,
    )
    current_url = page.evaluate("() => window.location.href")
    assert "project=" not in current_url


def test_legacy_code_param_still_decodes(page, live_server):
    """Legacy `code` share links remain decodable for backward compatibility."""
    _goto_editor(page, live_server)
    compressed = page.evaluate("""async () => {
        const { compressCode } = await import('./share.js');
        return await compressCode('legacy = True\\nprint(legacy)');
    }""")

    page.goto(f"{live_server}/index.html?code={compressed}", wait_until="domcontentloaded")
    page.wait_for_selector(".cm-editor", timeout=CDN_TIMEOUT)

    content = page.evaluate("() => document.querySelector('.cm-content').innerText")
    assert "legacy = True" in content
