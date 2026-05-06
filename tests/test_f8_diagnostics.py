"""
Tests for F8 / Shift-F8 diagnostic navigation (nextDiagnostic / previousDiagnostic).

These tests inject diagnostics via setDiagnostics() and verify that
F8 opens the lint panel. No LSP worker is required.
"""

import pytest
from playwright.sync_api import expect
from timing import CDN_TIMEOUT, UI_TIMEOUT

pytestmark = pytest.mark.editor


def _goto_editor(page, live_server):
    """Navigate to the editor and wait for CodeMirror to initialise."""
    page.goto(f"{live_server}/index.html", wait_until="domcontentloaded")
    page.wait_for_selector(".cm-editor", timeout=CDN_TIMEOUT)


def _disable_lsp_notification_updates(page):
    """Prevent background LSP notifications from overwriting injected diagnostics."""
    page.evaluate("""() => {
        if (!window.lspClients) return;
        for (const entry of window.lspClients.values()) {
            const client = entry?.client;
            if (!client) continue;
            // Diagnostics tests inject synthetic lint entries and should not race
            // with async publishDiagnostics notifications from the worker.
            client.messageHandlers = [];
            try { client.disconnect?.(); } catch (_) {}
        }
    }""")


@pytest.fixture(scope="module")
def editor_page(shared_page, live_server):
    _goto_editor(shared_page, live_server)
    _disable_lsp_notification_updates(shared_page)
    return shared_page


@pytest.fixture(autouse=True)
def reset_diagnostics(editor_page):
    """Ensure each test starts with no diagnostics and no open lint panel."""
    editor_page.evaluate("""async () => {
        const { EditorView } = await import('@codemirror/view');
        const { setDiagnostics } = await import('@codemirror/lint');
        const dom = document.querySelector('.cm-editor');
        const view = EditorView.findFromDOM(dom);
        view.dispatch(setDiagnostics(view.state, []));
    }""")
    return editor_page


def _inject_diagnostics(page):
    """Inject a synthetic diagnostic into the editor via setDiagnostics."""
    page.evaluate("""async () => {
        const { EditorView } = await import('@codemirror/view');
        const { setDiagnostics } = await import('@codemirror/lint');
        const dom = document.querySelector('.cm-editor');
        const view = EditorView.findFromDOM(dom);
        view.dispatch(setDiagnostics(view.state, [
            {
                from: 0,
                to: 5,
                severity: 'error',
                message: 'Test error: undefined variable',
                source: 'test'
            }
        ]));
        return true;
    }""")


def test_f8_opens_lint_panel(editor_page):
    """Pressing F8 with diagnostics present must open the lint panel."""
    _inject_diagnostics(editor_page)

    editor_page.locator(".cm-content").click()
    editor_page.keyboard.press("F8")

    panel = editor_page.locator(".cm-panel.cm-panel-lint")
    expect(panel).to_be_visible(timeout=UI_TIMEOUT)


def test_lint_panel_shows_diagnostic_message(editor_page):
    """The lint panel opened by F8 must display the diagnostic message."""
    _inject_diagnostics(editor_page)

    editor_page.locator(".cm-content").click()
    editor_page.keyboard.press("F8")

    panel = editor_page.locator(".cm-panel.cm-panel-lint")
    expect(panel).to_be_visible(timeout=UI_TIMEOUT)
    expect(panel).to_contain_text("Test error: undefined variable", timeout=UI_TIMEOUT)


def test_f8_without_diagnostics_does_not_crash(editor_page):
    """Pressing F8 without diagnostics must not cause errors."""
    errors = []
    handler = lambda exc: errors.append(str(exc))
    editor_page.on("pageerror", handler)

    editor_page.locator(".cm-content").click()
    editor_page.keyboard.press("F8")

    editor_page.remove_listener("pageerror", handler)

    assert not errors, f"Unexpected JS errors: {errors}"
