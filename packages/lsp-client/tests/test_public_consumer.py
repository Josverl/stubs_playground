"""Browser coverage for the standalone CDN consumer harness."""

import json
import os
import urllib.error
import urllib.request
from functools import lru_cache
from pathlib import Path
from urllib.parse import urlencode, urlparse

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


REGISTRY = "https://registry.npmjs.org"
REPO_ROOT = Path(__file__).parents[3]


def _local_version(package_dir: str) -> str:
    manifest = REPO_ROOT / "packages" / package_dir / "package.json"
    return json.loads(manifest.read_text(encoding="utf-8"))["version"]


@lru_cache(maxsize=None)
def _registry_metadata(package_name: str):
    """Return registry metadata, or None when the registry is unreachable."""
    url = f"{REGISTRY}/{package_name.replace('/', '%2f')}"
    try:
        with urllib.request.urlopen(url, timeout=30) as response:
            return json.load(response)
    except (urllib.error.URLError, TimeoutError, ValueError):
        return None


def _cdn_version(env_var: str, package_name: str, package_dir: str):
    """Resolve the published version to exercise over the CDN.

    Uses this repository's version so a release validates the artifact it just
    produced. There is deliberately no fallback to the newest published version,
    which would silently test something this checkout did not build.
    """
    version = os.getenv(env_var) or _local_version(package_dir)
    metadata = _registry_metadata(package_name)
    if metadata is None:
        return None
    return version if version in metadata.get("versions", {}) else None


@pytest.mark.published
def test_published_cdn_consumer_has_no_local_component_fallbacks(page: Page, project_server: str):
    """Published npm versions load the client, worker, and board stubs only from CDNs."""
    client_version = _cdn_version("MP_CODEMIRROR_CDN_CLIENT_VERSION", "@mp-codemirror/lsp-client", "lsp-client")
    worker_version = _cdn_version(
        "MP_CODEMIRROR_CDN_WORKER_VERSION",
        "@mp-codemirror/pyright-worker",
        "pyright-worker",
    )
    if not (client_version and worker_version):
        pytest.skip("component versions are not published yet, or npm is unreachable")

    local_component_requests: list[str] = []

    def record_request(request):
        url = request.url
        request_path = urlparse(url).path
        if url.startswith(project_server) and any(
            request_path.startswith(path)
            for path in (
                "/packages/lsp-client/src/",
                "/packages/pyright-worker/dist/",
                "/packages/pyright-worker/assets/",
            )
        ):
            local_component_requests.append(url)

    page.on("request", record_request)
    query = urlencode(
        {
            "client": "cdn",
            "clientVersion": client_version,
            "worker": "cdn",
            "workerVersion": worker_version,
            "board": "esp32",
        }
    )
    page.goto(
        f"{project_server}/packages/lsp-client/tests/consumer-harness.html?{query}",
        wait_until="domcontentloaded",
    )
    page.wait_for_function(
        "() => window.__lspFailed === true || window.__probesComplete === true",
        timeout=HARNESS_TIMEOUT,
    )
    state = page.evaluate(
        """() => ({
            failed: window.__lspFailed,
            error: window.__lspError,
            diagnostics: window.__diagnostics,
            completionLabels: window.__completionLabels,
            hover: window.__hover,
        })"""
    )

    assert state["failed"] is False, state["error"]
    assert state["diagnostics"]
    assert "Pin" in state["completionLabels"]
    assert state["hover"] is not None
    assert local_component_requests == []
