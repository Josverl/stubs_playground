"""Browser coverage for the standalone CDN consumer harness."""

import os
from pathlib import Path
from urllib.parse import urlencode

import pytest
from playwright.sync_api import Page

from timing import CDN_TIMEOUT, LSP_TIMEOUT


pytestmark = pytest.mark.worker
HARNESS_TIMEOUT = CDN_TIMEOUT + LSP_TIMEOUT

requires_worker = pytest.mark.skipif(
    not (
        Path(__file__).parent.parent
        / "packages"
        / "pyright-worker"
        / "dist"
        / "pyright_worker.js"
    ).exists(),
    reason="Worker bundle not found. Build it first.",
)


def _wait_for_playground_lsp(page: Page) -> dict:
    page.wait_for_selector(".cm-editor", timeout=CDN_TIMEOUT)
    page.wait_for_function(
        """() =>
            window.__lspFailed === true
            || (
                window.__lspReady === true
                && window.__activeLspBoard === document.querySelector('#boardSelect')?.value
            )""",
        timeout=HARNESS_TIMEOUT,
    )
    return page.evaluate(
        """() => ({
            source: window.__componentSource,
            ready: window.__lspReady,
            failed: window.__lspFailed,
            activeBoard: window.__activeLspBoard,
            status: document.querySelector('#diagnostics-status')?.innerText,
        })"""
    )


@requires_worker
def test_full_playground_local_mode_uses_workspace_components(
    page: Page, project_server: str
):
    """The real application uses workspace packages by default."""
    requests: list[str] = []
    page.on("request", lambda request: requests.append(request.url))

    page.goto(
        f"{project_server}/apps/playground/?components=local",
        wait_until="domcontentloaded",
    )
    state = _wait_for_playground_lsp(page)

    assert state["ready"] is True
    assert state["failed"] is False
    assert state["activeBoard"] == "esp32"
    assert state["source"]["mode"] == "local"
    assert "Pyright" in state["status"]
    assert any("/apps/playground/app.js" in url for url in requests)
    assert any("/packages/lsp-client/src/index.js" in url for url in requests)
    assert any("/packages/pyright-worker/dist/pyright_worker.js" in url for url in requests)
    assert not any(
        "cdn.jsdelivr.net/gh/Josverl/stubs_playground@" in url for url in requests
    )


def test_full_playground_cdn_mode_uses_published_components(
    page: Page, project_server: str
):
    """The real application remains local while all reusable components use CDN tags."""
    requests: list[str] = []
    responses: dict[str, int] = {}
    page.on("request", lambda request: requests.append(request.url))
    page.on("response", lambda response: responses.update({response.url: response.status}))

    page.goto(
        f"{project_server}/apps/playground/?components=cdn",
        wait_until="domcontentloaded",
    )
    state = _wait_for_playground_lsp(page)

    assert state["ready"] is True
    assert state["failed"] is False
    assert state["activeBoard"] == "esp32"
    assert state["source"]["mode"] == "cdn"
    assert state["source"]["clientVersion"] == "lsp-client-v0.2.0"
    assert state["source"]["workerVersion"] == "pyright-worker-v0.2.0"
    assert "Pyright" in state["status"]
    assert any("/apps/playground/app.js" in url for url in requests)
    assert any(
        "@lsp-client-v0.2.0/packages/lsp-client/src/index.js" in url
        for url in requests
    )
    assert any(
        "@pyright-worker-v0.2.0/packages/pyright-worker/dist/pyright_worker.js" in url
        for url in requests
    )
    assert any(
        "@pyright-worker-v0.2.0/packages/pyright-worker/assets/stubs-manifest.json" in url
        for url in requests
    )
    assert any(
        "@pyright-worker-v0.2.0/packages/pyright-worker/assets/stubs-esp32.zip" in url
        for url in requests
    )
    for suffix in (
        "@lsp-client-v0.2.0/packages/lsp-client/src/index.js",
        "@pyright-worker-v0.2.0/packages/pyright-worker/dist/pyright_worker.js",
        "@pyright-worker-v0.2.0/packages/pyright-worker/assets/stubs-manifest.json",
        "@pyright-worker-v0.2.0/packages/pyright-worker/assets/stubs-esp32.zip",
    ):
        matching = [status for url, status in responses.items() if suffix in url]
        assert matching and all(status == 200 for status in matching), (
            f"Expected successful CDN response for {suffix}: {matching}"
        )

    archive_size = page.evaluate(
        """async (url) => {
            const response = await fetch(url);
            if (!response.ok) return -response.status;
            return (await response.arrayBuffer()).byteLength;
        }""",
        state["source"]["assetsBase"] + "/stubs-esp32.zip",
    )
    assert archive_size > 0
    assert not any(
        url.startswith(project_server)
        and (
            "/packages/lsp-client/" in url
            or "/packages/pyright-worker/" in url
        )
        for url in requests
    )


def test_root_redirect_preserves_component_source_and_fragment(
    page: Page, project_server: str
):
    """The Pages root redirect retains runtime options and share fragments."""
    page.goto(
        f"{project_server}/?components=cdn#shared-section",
        wait_until="domcontentloaded",
    )
    page.wait_for_url(
        f"{project_server}/apps/playground/?components=cdn#shared-section",
        timeout=CDN_TIMEOUT,
    )
    assert page.url.endswith("/apps/playground/?components=cdn#shared-section")


@requires_worker
def test_local_consumer_harness_uses_public_lsp_api(page: Page, project_server: str):
    """The harness initializes through public exports and receives a diagnostic."""
    uncaught_errors: list[str] = []
    page.on("pageerror", lambda error: uncaught_errors.append(str(error)))

    page.goto(f"{project_server}/tests/cdn-harness.html", wait_until="domcontentloaded")
    page.wait_for_function(
        "() => window.__lspReady === true || window.__lspFailed === true",
        timeout=HARNESS_TIMEOUT,
    )
    page.wait_for_function(
        "() => window.__lspFailed === true || window.__diagnostics.length > 0",
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
    assert state["diagnostics"][0]["severity"] == "error"
    assert "not assignable" in state["diagnostics"][0]["message"]
    assert "Pin" in state["completionLabels"]
    assert state["hover"] is not None
    assert "Pin" in str(state["hover"]["contents"])
    assert uncaught_errors == []


@pytest.mark.parametrize("board", ["esp32", "rp2"])
@requires_worker
def test_local_consumer_harness_loads_board_stubs(
    page: Page, project_server: str, board: str
):
    """The reusable worker accepts explicit stub bundles for multiple boards."""
    page.goto(
        f"{project_server}/tests/cdn-harness.html?{urlencode({'board': board})}",
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
    state = page.evaluate(
        "() => ({ failed: window.__lspFailed, error: window.__lspError, board: window.__board })"
    )

    assert state["failed"] is False, state["error"]
    assert state["board"] == board


CDN_CLIENT_TAG = os.getenv("MP_CODEMIRROR_CDN_CLIENT_TAG")
CDN_WORKER_TAG = os.getenv("MP_CODEMIRROR_CDN_WORKER_TAG")


@pytest.mark.skipif(
    not (CDN_CLIENT_TAG and CDN_WORKER_TAG),
    reason="Set MP_CODEMIRROR_CDN_CLIENT_TAG and MP_CODEMIRROR_CDN_WORKER_TAG",
)
def test_tagged_cdn_consumer_has_no_local_component_fallbacks(
    page: Page, project_server: str
):
    """Published tags load the client, worker, and board stubs only from CDNs."""
    local_component_requests: list[str] = []

    def record_request(request):
        url = request.url
        if url.startswith(project_server) and any(
            path in url
            for path in (
                "/packages/lsp-client/",
                "/packages/pyright-worker/",
            )
        ):
            local_component_requests.append(url)

    page.on("request", record_request)
    query = urlencode(
        {
            "client": "cdn",
            "clientTag": CDN_CLIENT_TAG,
            "worker": "cdn",
            "workerTag": CDN_WORKER_TAG,
            "board": "esp32",
        }
    )
    page.goto(
        f"{project_server}/tests/cdn-harness.html?{query}",
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
