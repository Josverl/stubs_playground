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
        const { setDiagnostics, closeLintPanel } = await import('@codemirror/lint');
        const dom = document.querySelector('.cm-editor');
        const view = EditorView.findFromDOM(dom);
        view.dispatch(setDiagnostics(view.state, []));
        closeLintPanel(view);
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


def _publish_lsp_diagnostics(page, file_uri, diagnostics):
    """Inject publishDiagnostics payload and return active CodeMirror diagnostics."""
    return page.evaluate(
        """async ({ fileUri, diagnostics }) => {
            const { EditorView } = await import('@codemirror/view');
            const {
                createLSPDiagnostics,
            } = await import('/src/lsp/diagnostics.js');
            const {
                diagnosticCount,
                forEachDiagnostic,
            } = await import('@codemirror/lint');

            const dom = document.querySelector('.cm-editor');
            const view = EditorView.findFromDOM(dom);

            let capturedHandler = null;
            const mockClient = {
                onNotification: (handler) => { capturedHandler = handler; }
            };

            createLSPDiagnostics(mockClient, fileUri, view);

            if (!capturedHandler) {
                throw new Error('createLSPDiagnostics did not register a notification handler');
            }

            capturedHandler('textDocument/publishDiagnostics', {
                uri: fileUri,
                diagnostics,
            });

            await new Promise((resolve) => requestAnimationFrame(() => resolve()));

            const activeDiagnostics = [];
            forEachDiagnostic(view.state, (diagnostic, from, to) => {
                activeDiagnostics.push({
                    from,
                    to,
                    severity: diagnostic.severity,
                    message: diagnostic.message,
                    source: diagnostic.source || null,
                });
            });

            return {
                count: diagnosticCount(view.state),
                diagnostics: activeDiagnostics,
            };
        }""",
        {"fileUri": file_uri, "diagnostics": diagnostics},
    )


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


def test_diagnostic_source_includes_code_when_present(editor_page):
    """convertLSPDiagnostic must append the LSP code to the source field."""
    result = _publish_lsp_diagnostics(
        editor_page,
        "file:///workspace/test.py",
        [
            {
                "range": {
                    "start": {"line": 0, "character": 0},
                    "end": {"line": 0, "character": 5},
                },
                "message": "Test message with code",
                "severity": 1,
                "code": "reportOptionalMemberAccess",
                "source": "Pyright",
            }
        ],
    )

    assert result["count"] == 1, f"Expected one active diagnostic. Got: {result!r}"
    assert result["diagnostics"], f"Expected active diagnostics. Got: {result!r}"

    source_text = result["diagnostics"][0]["source"]
    assert source_text == "Pyright: reportOptionalMemberAccess", (
        f"Diagnostic source must include the LSP code. Got: {source_text!r}"
    )


def test_diagnostic_source_without_code_is_unchanged(editor_page):
    """convertLSPDiagnostic must leave source unchanged when no code is present."""
    result = _publish_lsp_diagnostics(
        editor_page,
        "file:///workspace/test2.py",
        [
            {
                "range": {
                    "start": {"line": 0, "character": 0},
                    "end": {"line": 0, "character": 5},
                },
                "message": "Another test message",
                "severity": 2,
                "source": "Pyright",
            }
        ],
    )

    assert result["count"] == 1, f"Expected one active diagnostic. Got: {result!r}"
    assert result["diagnostics"], f"Expected active diagnostics. Got: {result!r}"

    source_text = result["diagnostics"][0]["source"]
    assert source_text == "Pyright", (
        f"Diagnostic source must be 'Pyright' when no code is present. Got: {source_text!r}"
    )
    assert "reportOptionalMemberAccess" not in source_text, (
        f"Diagnostic source must not include a code when none is provided. Got: {source_text!r}"
    )
