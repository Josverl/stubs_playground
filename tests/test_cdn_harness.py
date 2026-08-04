"""Browser coverage for the standalone CDN consumer harness."""

from pathlib import Path

import pytest
from playwright.sync_api import Page

from timing import LSP_TIMEOUT


pytestmark = pytest.mark.worker

requires_worker = pytest.mark.skipif(
    not (Path(__file__).parent.parent / "dist" / "pyright_worker.js").exists(),
    reason="Worker bundle not found at dist/pyright_worker.js. Build it first.",
)


@requires_worker
def test_local_consumer_harness_uses_public_lsp_api(page: Page, project_server: str):
    """The harness initializes through public exports and receives a diagnostic."""
    uncaught_errors: list[str] = []
    page.on("pageerror", lambda error: uncaught_errors.append(str(error)))

    page.goto(f"{project_server}/tests/cdn-harness.html", wait_until="domcontentloaded")
    page.wait_for_function(
        "() => window.__lspReady === true || window.__lspFailed === true",
        timeout=LSP_TIMEOUT,
    )
    page.wait_for_function(
        "() => window.__lspFailed === true || window.__diagnostics.length > 0",
        timeout=LSP_TIMEOUT,
    )
    state = page.evaluate(
        """() => ({
            ready: window.__lspReady,
            failed: window.__lspFailed,
            error: window.__lspError,
            exports: window.__publicExports,
            diagnostics: window.__diagnostics,
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
    assert state["diagnostics"][0]["severity"] == "error"
    assert "not assignable" in state["diagnostics"][0]["message"]
    assert uncaught_errors == []
