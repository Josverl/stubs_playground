"""
Tests for the Worker Transport Layer (Phase 3).
Verifies that the WorkerTransport correctly wraps the Pyright Web Worker
and provides the same transport interface.
"""

import json
from pathlib import Path

import pytest

_worker_js = Path(__file__).parents[3] / "packages" / "pyright-worker" / "dist" / "pyright_worker.js"
_catalog = json.loads(
    (Path(__file__).parents[3] / "packages" / "pyright-worker" / "assets" / "stub-package-catalog.json").read_text(
        encoding="utf-8"
    )
)
pytestmark = [
    pytest.mark.worker,
    pytest.mark.skipif(
        not _worker_js.exists(),
        reason="Worker bundle not found. Run: npm run build:worker",
    ),
]


@pytest.fixture(scope="module")
def test_page_url(project_server):
    return f"{project_server}/packages/lsp-client/tests/worker-transport-harness.html"


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


def test_current_client_starts_without_implicit_board_stubs(page, test_page_url):
    """Omitting board selection in the current client leaves /typings empty."""
    page.goto(test_page_url, wait_until="domcontentloaded")

    result = page.evaluate("""() => window.runTest('no-board-default')""")

    assert result == {"success": True, "fileCount": 0}


def test_legacy_client_retains_bundled_rp2_default(page, test_page_url):
    """Published clients that sent undefined still receive the RP2 fallback."""
    page.goto(test_page_url, wait_until="domcontentloaded")

    result = page.evaluate("""() => window.runTest('legacy-board-default')""")

    assert result == {"success": True, "hasMachineStubs": True}


def test_worker_transport_is_quiet_by_default(page, test_page_url):
    """Default component settings suppress informational console output."""
    messages = []
    page.on(
        "console",
        lambda message: messages.append(message.text) if message.type in {"log", "info"} else None,
    )
    page.goto(test_page_url, wait_until="domcontentloaded")

    result = page.evaluate("""() => window.runTest('connect')""")

    assert result["success"] is True
    assert messages == []


def test_worker_transport_verbose_output_is_opt_in(page, test_page_url):
    """The public option enables transport and worker informational logs."""
    messages = []
    page.on(
        "console",
        lambda message: messages.append(message.text) if message.type in {"log", "info"} else None,
    )
    page.goto(test_page_url, wait_until="domcontentloaded")

    result = page.evaluate("""() => window.runTest('verbose-logging')""")

    assert result["success"] is True
    assert any("WorkerTransport: connected and ready" in message for message in messages)
    assert any("[pyright-worker] Initializing filesystem" in message for message in messages)


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
    assert result["isQuietByDefault"] is True


def test_worker_transport_syncs_and_deletes_workspace_files(page, test_page_url):
    """Public workspace methods update the worker VFS without raw postMessage access."""
    page.goto(test_page_url, wait_until="domcontentloaded")

    result = page.evaluate("""() => {
        return window.runTest('workspace-files');
    }""")

    assert result["success"] is True
    assert result["foundAfterSync"] is True
    assert result["absentAfterDelete"] is True


def test_worker_transport_lists_current_pypi_stub_releases(page, test_page_url):
    """The worker groups post releases and omits dependency-only packages."""
    page.goto(test_page_url, wait_until="domcontentloaded")

    result = page.evaluate("""() => window.runTest('stub-package-catalog')""")

    assert result["success"] is True
    assert result["packageCount"] >= 6
    assert result["esp32LatestVersion"]
    assert result["esp32VersionCount"] >= 1
    assert result["allVersionsMatchRequestedRuntime"] is True
    assert result["includesStdlib"] is False
    assert result["postReleaseVersions"] == []
    assert result["wildcardVersionCount"] > 0
    assert result["errors"] == []


def test_worker_transport_defaults_to_highest_stable_runtime(page, test_page_url):
    """Unfiltered discovery uses the catalog's highest stable MicroPython release."""
    page.goto(test_page_url, wait_until="domcontentloaded")

    result = page.evaluate("""() => window.runTest('stub-package-default-firmware')""")

    assert result["success"] is True
    assert result["defaultRuntimeVersion"] == result["availableRuntimeVersions"][0]
    assert result["defaultRuntimeVersion"] == _catalog["defaultRuntimeVersion"]
    assert result["packageCount"] > 0
    assert result["allPackagesMatchDefault"] is True


def test_worker_transport_rejects_uncatalogued_stub_packages(page, test_page_url):
    """Direct install requests cannot bypass the worker's supported package catalog."""
    page.goto(test_page_url, wait_until="domcontentloaded")

    result = page.evaluate("""() => window.runTest('stub-package-rejects-uncatalogued')""")

    assert result["success"] is True
    assert result["message"] == "Stub package is not supported: micropython-not-a-real-port-stubs"


def test_worker_transport_installs_unlisted_type_only_packages(page, test_page_url):
    """Unlisted type-only PyPI wheels are available as global extra paths."""
    page.goto(test_page_url, wait_until="domcontentloaded")

    result = page.evaluate("""() => window.runTest('stub-package-installs-unlisted-extra')""")

    assert result["success"] is True
    assert result["version"]
    assert result["persisted"] is True


def test_worker_transport_installs_persists_and_mounts_stub_package(page, test_page_url, tmp_path):
    """A requested PyPI version survives worker replacement and becomes /typings."""
    page.goto(test_page_url, wait_until="domcontentloaded")

    result = page.evaluate("""() => window.runTest('stub-package-install')""")

    assert result["success"] is True
    assert result["version"]
    assert result["persisted"] is True
    assert result["mounted"] is True
    assert result["dependencyMounted"] is True
    assert result["otherBoardExcluded"] is True
    page.screenshot(path=tmp_path / "worker-stub-package-installed.png", full_page=True)
