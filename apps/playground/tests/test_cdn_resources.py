"""
Test CDN resource loading for CodeMirror editor.

Verifies that all CDN resources from esm.sh load successfully and the
CodeMirror editor initialises correctly with Python syntax highlighting.
"""

import pytest
from playwright.sync_api import Page, expect

pytestmark = pytest.mark.editor


@pytest.fixture(scope="module")
def editor_page(shared_page: Page, live_server):
    """Load the editor once for read-only CDN checks."""
    shared_page.goto(f"{live_server}/index.html", wait_until="domcontentloaded")
    shared_page.wait_for_selector(".cm-editor", timeout=30_000)
    return shared_page


def test_no_cdn_errors_on_load(page: Page, live_server):
    """
    CDN resources from esm.sh must load without errors.

    Specifically verifies that no ERR_BLOCKED_BY_CLIENT or HTTP-error
    console messages are produced for the CodeMirror CDN URLs.
    """
    cdn_errors: list[str] = []

    def handle_console(msg):
        if msg.type == "error" and "esm.sh" in msg.text:
            cdn_errors.append(msg.text)

    page.on("console", handle_console)
    page.goto(f"{live_server}/index.html")
    # Wait for editor to render rather than networkidle (worker keeps network busy)
    page.wait_for_selector(".cm-editor", timeout=30_000)

    assert cdn_errors == [], f"Found {len(cdn_errors)} CDN error(s):\n" + "\n".join(cdn_errors[:5])


def test_codemirror_editor_initialises(editor_page: Page):
    """
    The CodeMirror editor must be present and non-empty after load.

    Checks that the .cm-editor element is visible and that the
    editor content area contains text (the default example).
    """
    cm_editor = editor_page.locator(".cm-editor")
    expect(cm_editor).to_be_visible(timeout=15_000)

    cm_content = editor_page.locator(".cm-content")
    expect(cm_content).to_be_visible(timeout=5_000)

    # At least one line of code should be rendered
    first_line = editor_page.locator(".cm-content .cm-line").first
    expect(first_line).not_to_be_empty(timeout=5_000)


def test_python_syntax_highlighting(editor_page: Page):
    """
    Python syntax tokens must be highlighted by CodeMirror.

    Looks for the presence of token-span elements produced by the
    @codemirror/lang-python grammar (e.g. keywords, comments).
    """
    # CodeMirror wraps tokens in spans; at least one should exist
    token_spans = editor_page.locator(".cm-content span[class]")
    expect(token_spans.first).to_be_visible(timeout=5_000)


def test_example_files_populate_selector(editor_page: Page):
    """
    The example-file dropdown must contain at least one option beyond the placeholder.
    """
    select = editor_page.locator("#sampleSelect")
    # Wait until examples are populated (more than the placeholder option)
    editor_page.wait_for_function("document.getElementById('sampleSelect').options.length > 1", timeout=5_000)
    option_count = select.evaluate("el => el.options.length")
    assert option_count > 1, "Expected at least one example file option"


def test_importmap_uses_current_versions(editor_page: Page):
    """
    The HTML import map must reference esm.sh and include codemirror entries.
    """
    importmap = editor_page.locator('script[type="importmap"]')
    expect(importmap).to_be_attached()

    content = importmap.inner_text()
    assert "esm.sh" in content
    assert "codemirror" in content
    assert "@codemirror/lang-python" in content
