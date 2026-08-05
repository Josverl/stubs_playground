"""Application coverage for the public component integration boundary."""

from pathlib import Path

import pytest
from playwright.sync_api import Page

from tests.timing import CDN_TIMEOUT, LSP_TIMEOUT


pytestmark = pytest.mark.worker
HARNESS_TIMEOUT = CDN_TIMEOUT + LSP_TIMEOUT

requires_worker = pytest.mark.skipif(
    not (
        Path(__file__).parents[3]
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
def test_local_mode_uses_workspace_component_interfaces(
    page: Page, project_server: str
):
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


def test_cdn_mode_uses_published_component_interfaces(
    page: Page, project_server: str
):
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
    assert state["source"]["clientVersion"] == "lsp-client-v0.2.1"
    assert state["source"]["workerVersion"] == "pyright-worker-v0.2.1"
    assert "Pyright" in state["status"]
    assert any("/apps/playground/app.js" in url for url in requests)

    published_paths = (
        "@lsp-client-v0.2.1/packages/lsp-client/src/index.js",
        "@pyright-worker-v0.2.1/packages/pyright-worker/dist/pyright_worker.js",
        "@pyright-worker-v0.2.1/packages/pyright-worker/assets/stubs-manifest.json",
        "@pyright-worker-v0.2.1/packages/pyright-worker/assets/stubs-esp32.zip",
    )
    for suffix in published_paths:
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
    page.goto(
        f"{project_server}/?components=cdn#shared-section",
        wait_until="domcontentloaded",
    )
    page.wait_for_url(
        f"{project_server}/apps/playground/?components=cdn#shared-section",
        timeout=CDN_TIMEOUT,
    )
    assert page.url.endswith("/apps/playground/?components=cdn#shared-section")
