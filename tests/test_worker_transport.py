"""
Tests for the Worker Transport Layer (Phase 3).
Verifies that the WorkerTransport correctly wraps the Pyright Web Worker
and provides the same transport interface.
"""

from pathlib import Path

import pytest

_worker_js = Path(__file__).parent.parent / "dist" / "pyright_worker.js"
pytestmark = [
    pytest.mark.worker,
    pytest.mark.skipif(
        not _worker_js.exists(),
        reason="dist/pyright_worker.js not found. Run: npm run build:worker",
    ),
]


@pytest.fixture(scope="module")
def test_page_url(project_server):
    return f"{project_server}/src/tests/worker-transport-test.html"


@pytest.fixture(autouse=True)
def _set_page_timeout(page):
    """Worker tests need longer timeouts for init + diagnostics."""
    page.set_default_timeout(15000)


def test_worker_transport_connects(page, test_page_url):
    """WorkerTransport.connect() completes the handshake and resolves."""
    page.goto(test_page_url, wait_until="domcontentloaded")

    result = page.evaluate("""() => {
        return window.runTest('connect');
    }""")

    assert result["success"] is True
    assert result["connected"] is True


def test_worker_transport_lsp_initialize(page, test_page_url):
    """Full LSP initialize handshake through WorkerTransport."""
    page.goto(test_page_url, wait_until="domcontentloaded")

    result = page.evaluate("""() => {
        return window.runTest('lsp-init');
    }""")

    assert result["success"] is True
    assert len(result["capabilities"]) > 0


def test_worker_transport_diagnostics(page, test_page_url):
    """Diagnostics flow through WorkerTransport as JSON strings."""
    page.goto(test_page_url, wait_until="domcontentloaded")

    result = page.evaluate("""() => {
        return window.runTest('diagnostics');
    }""")

    assert result["success"] is True
    assert result["diagnosticCount"] >= 1
    assert len(result["message"]) > 0


def test_worker_transport_close(page, test_page_url):
    """close() terminates the worker and resets state."""
    page.goto(test_page_url, wait_until="domcontentloaded")

    result = page.evaluate("""() => {
        return window.runTest('close');
    }""")

    assert result["success"] is True
    assert result["connectedAfterClose"] is False


def test_worker_transport_messages_are_strings(page, test_page_url):
    """Subscribers receive JSON strings (not objects) matching WebSocket interface."""
    page.goto(test_page_url, wait_until="domcontentloaded")

    result = page.evaluate("""() => {
        return window.runTest('string-messages');
    }""")

    assert result["success"] is True
    assert result["allStrings"] is True
    assert result["messageCount"] > 0


def test_simple_client_with_worker_transport(page, test_page_url):
    """SimpleLSPClient works unchanged with WorkerTransport."""
    page.goto(test_page_url, wait_until="domcontentloaded")

    result = page.evaluate("""() => {
        return window.runTest('simple-client');
    }""")

    assert result["success"] is True
    assert result["hasCapabilities"] is True
    assert result["diagnosticCount"] >= 1


def test_worker_transport_reads_generated_config(page, test_page_url):
    """WorkerTransport can read generated pyproject.toml content from worker VFS."""
    page.goto(test_page_url, wait_until="domcontentloaded")

    result = page.evaluate("""() => {
        return window.runTest('generated-config');
    }""")

    assert result["success"] is True
    assert result["hasToolSection"] is True
    assert result["hasStubPath"] is True
