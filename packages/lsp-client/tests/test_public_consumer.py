"""Browser coverage for the standalone CDN consumer harness."""

from pathlib import Path
from urllib.parse import urlencode

import pytest
from playwright.sync_api import Page

from tests.timing import CDN_TIMEOUT, LSP_TIMEOUT


pytestmark = [pytest.mark.component, pytest.mark.worker]
HARNESS_TIMEOUT = CDN_TIMEOUT + LSP_TIMEOUT

requires_worker = pytest.mark.skipif(
    not (Path(__file__).parents[3] / "packages" / "pyright-worker" / "dist" / "pyright_worker.js").exists(),
    reason="Worker bundle not found. Build it first.",
)


@requires_worker
def test_local_consumer_harness_uses_public_lsp_api(page: Page, project_server: str):
    """The harness initializes through public exports and receives a diagnostic."""
    uncaught_errors: list[str] = []
    page.on("pageerror", lambda error: uncaught_errors.append(str(error)))

    page.goto(
        f"{project_server}/packages/lsp-client/tests/consumer-harness.html",
        wait_until="domcontentloaded",
    )
    page.wait_for_function(
        "() => window.__lspReady === true || window.__lspFailed === true",
        timeout=HARNESS_TIMEOUT,
    )
    page.wait_for_function(
        "() => window.__lspFailed === true || window.__diagnostics.length > 0",
        timeout=HARNESS_TIMEOUT,
    )
    page.wait_for_function(
        "() => window.__lspFailed === true || window.__editorDiagnosticCount?.() > 0",
        timeout=HARNESS_TIMEOUT,
    )
    page.wait_for_function(
        "() => window.__lspFailed === true || window.__probesComplete === true",
        timeout=HARNESS_TIMEOUT,
    )
    state = page.evaluate(
        """() => ({
            ready: window.__lspReady,
            failed: window.__lspFailed,
            error: window.__lspError,
            exports: window.__publicExports,
            diagnostics: window.__diagnostics,
            editorDiagnosticCount: window.__editorDiagnosticCount?.() || 0,
            completionLabels: window.__completionLabels,
            hover: window.__hover,
        })"""
    )

    assert state["ready"] is True
    assert state["failed"] is False, state["error"]
    assert {
        "createLSPClient",
        "createLSPPlugin",
        "createWorkerTransport",
        "createLSPDiagnostics",
    } <= set(state["exports"])
    assert len(state["diagnostics"]) == 1
    assert state["editorDiagnosticCount"] == 1
    assert state["diagnostics"][0]["severity"] == "error"
    assert "not assignable" in state["diagnostics"][0]["message"]
    assert "Pin" in state["completionLabels"]
    assert state["hover"] is not None
    assert "Pin" in str(state["hover"]["contents"])
    assert uncaught_errors == []


@requires_worker
def test_workspace_mode_reports_diagnostics_for_unopened_files(page: Page, project_server: str):
    """Workspace mode publishes diagnostics without opening a CodeMirror editor."""
    page.goto(
        f"{project_server}/packages/lsp-client/tests/consumer-harness.html?scope=workspace",
        wait_until="domcontentloaded",
    )
    page.wait_for_function(
        """() => window.__lspFailed === true ||
            window.__workspaceDiagnostics.some(
                (diagnostic) => diagnostic.fileName === 'unopened.py'
            )""",
        timeout=HARNESS_TIMEOUT,
    )
    state = page.evaluate(
        """() => ({
            failed: window.__lspFailed,
            error: window.__lspError,
            diagnostics: window.__workspaceDiagnostics,
        })"""
    )

    assert state["failed"] is False, state["error"]
    unopened = [diagnostic for diagnostic in state["diagnostics"] if diagnostic["fileName"] == "unopened.py"]
    assert len(unopened) == 1
    assert unopened[0]["severity"] == "error"
    assert "not assignable" in unopened[0]["message"]


@pytest.mark.parametrize("board", ["esp32", "rp2"])
@requires_worker
def test_local_consumer_harness_loads_board_stubs(page: Page, project_server: str, board: str):
    """The reusable worker accepts explicit stub bundles for multiple boards."""
    page.goto(
        f"{project_server}/packages/lsp-client/tests/consumer-harness.html?{urlencode({'board': board})}",
        wait_until="domcontentloaded",
    )
    page.wait_for_function(
        "() => window.__lspReady === true || window.__lspFailed === true",
        timeout=HARNESS_TIMEOUT,
    )
    page.wait_for_function(
        "() => window.__lspFailed === true || window.__probesComplete === true",
        timeout=HARNESS_TIMEOUT,
    )
    state = page.evaluate("() => ({ failed: window.__lspFailed, error: window.__lspError, board: window.__board })")

    assert state["failed"] is False, state["error"]
    assert state["board"] == board
