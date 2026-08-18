"""Application coverage for the public component integration boundary."""

import json
import re
from pathlib import Path
from urllib.error import URLError
from urllib.request import Request, urlopen

import pytest
from playwright.sync_api import Page, expect

from tests.timing import CDN_TIMEOUT, LSP_TIMEOUT


pytestmark = pytest.mark.worker
HARNESS_TIMEOUT = CDN_TIMEOUT + LSP_TIMEOUT
PROJECT_ROOT = Path(__file__).parents[3]


def _package_version(package_path: str) -> str:
    package = json.loads((PROJECT_ROOT / package_path).read_text())
    return package["version"]


CLIENT_VERSION = _package_version("packages/lsp-client/package.json")
WORKER_VERSION = _package_version("packages/pyright-worker/package.json")

requires_worker = pytest.mark.skipif(
    not (PROJECT_ROOT / "packages" / "pyright-worker" / "dist" / "pyright_worker.js").exists(),
    reason="Worker bundle not found. Build it first.",
)


def _published_component_available(url: str, timeout: float = 8.0) -> bool:
    for method in ("HEAD", "GET"):
        try:
            request = Request(url, method=method)
            with urlopen(request, timeout=timeout) as response:
                return response.status == 200
        except (URLError, TimeoutError, ValueError):
            continue
    return False


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
def test_local_mode_uses_workspace_component_interfaces(page: Page, project_server: str):
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
    assert not any("cdn.jsdelivr.net/npm/@mp-codemirror/" in url for url in requests)


def test_npm_mode_uses_published_component_interfaces(page: Page, project_server: str, tmp_path: Path):
    published_urls = (
        f"https://cdn.jsdelivr.net/npm/@mp-codemirror/lsp-client@{CLIENT_VERSION}/src/index.js",
        f"https://cdn.jsdelivr.net/npm/@mp-codemirror/pyright-worker@{WORKER_VERSION}/dist/pyright_worker.js",
        f"https://cdn.jsdelivr.net/npm/@mp-codemirror/pyright-worker@{WORKER_VERSION}/assets/stubs-manifest.json",
        f"https://cdn.jsdelivr.net/npm/@mp-codemirror/pyright-worker@{WORKER_VERSION}/assets/stubs-esp32.zip",
    )
    unavailable = [url for url in published_urls if not _published_component_available(url)]
    if unavailable:
        pytest.skip(
            "Published npm component artifacts are unavailable; skipping npm integration check: "
            + ", ".join(unavailable)
        )

    requests: list[str] = []
    responses: dict[str, int] = {}
    page.on("request", lambda request: requests.append(request.url))
    page.on("response", lambda response: responses.update({response.url: response.status}))

    page.goto(
        f"{project_server}/apps/playground/?components=npm",
        wait_until="domcontentloaded",
    )
    state = _wait_for_playground_lsp(page)

    assert state["ready"] is True
    assert state["failed"] is False
    assert state["activeBoard"] == "esp32"
    assert state["source"]["mode"] == "npm"
    assert state["source"]["clientVersion"] == CLIENT_VERSION
    assert state["source"]["workerVersion"] == WORKER_VERSION
    assert "Pyright" in state["status"]
    assert any("/apps/playground/app.js" in url for url in requests)

    published_paths = (
        f"/npm/@mp-codemirror/lsp-client@{CLIENT_VERSION}/src/index.js",
        f"/npm/@mp-codemirror/pyright-worker@{WORKER_VERSION}/dist/pyright_worker.js",
        f"/npm/@mp-codemirror/pyright-worker@{WORKER_VERSION}/assets/stubs-manifest.json",
        f"/npm/@mp-codemirror/pyright-worker@{WORKER_VERSION}/assets/stubs-esp32.zip",
    )
    for suffix in published_paths:
        matching = [status for url, status in responses.items() if suffix in url]
        assert matching and all(status == 200 for status in matching), (
            f"Expected successful npm package response for {suffix}: {matching}"
        )

    for archive in ("stubs-esp32.zip", "stubs-webassembly.zip"):
        archive_size = page.evaluate(
            """async (url) => {
                const response = await fetch(url);
                if (!response.ok) return -response.status;
                return (await response.arrayBuffer()).byteLength;
            }""",
            state["source"]["assetsBase"] + f"/{archive}",
        )
        assert archive_size > 0
    assert not any(
        url.startswith(project_server) and ("/packages/lsp-client/" in url or "/packages/pyright-worker/" in url)
        for url in requests
    )
    page.screenshot(
        path=tmp_path / "playground-latest-published-components.png",
        full_page=True,
    )


def test_root_redirect_preserves_component_source_and_fragment(page: Page, project_server: str):
    page.goto(
        f"{project_server}/?components=npm#shared-section",
        wait_until="domcontentloaded",
    )
    page.wait_for_url(
        f"{project_server}/apps/playground/?components=npm#shared-section",
        timeout=CDN_TIMEOUT,
    )
    assert page.url.endswith("/apps/playground/?components=npm#shared-section")


@requires_worker
def test_playground_uses_reusable_stub_catalog_and_persistent_cache(page: Page, project_server: str, tmp_path: Path):
    page.goto(
        f"{project_server}/apps/playground/?components=local",
        wait_until="domcontentloaded",
    )
    _wait_for_playground_lsp(page)

    page.wait_for_function(
        """() => document.querySelectorAll(
            '#stubPackageCatalog option[value^="micropython-esp32-stubs=="]'
        ).length > 0""",
        timeout=HARNESS_TIMEOUT,
    )
    catalog_values = page.locator("#stubPackageCatalog option").evaluate_all(
        "options => options.map(option => option.value)"
    )
    assert not any(value.startswith("micropython-stdlib-stubs==") for value in catalog_values)
    assert not any(re.search(r"\.post\d+", value, re.IGNORECASE) for value in catalog_values)
    specifier = next(
        value for value in catalog_values if value.startswith("micropython-esp32-stubs==") and value.endswith(".*")
    )

    package_input = page.locator("#extraStubSpecifier")
    package_input.fill(specifier)
    package_input.press("Enter")
    status = page.locator("#extraStubsStatus")
    expect(status).to_contain_text(
        "Installed: micropython-esp32-stubs@",
        timeout=HARNESS_TIMEOUT,
    )
    installed_version = status.inner_text().split("micropython-esp32-stubs@", 1)[1]
    expect(page.locator("#boardSelect option:checked")).to_contain_text(installed_version)

    requests_after_install: list[str] = []
    page.on("request", lambda request: requests_after_install.append(request.url))
    page.reload(wait_until="domcontentloaded")
    _wait_for_playground_lsp(page)
    expect(page.locator("#extraStubsStatus")).to_contain_text(
        f"micropython-esp32-stubs@{installed_version}",
        timeout=HARNESS_TIMEOUT,
    )
    assert not any(url.endswith("/stubs-esp32.zip") for url in requests_after_install)
    page.screenshot(path=tmp_path / "playground-persistent-stub-package.png", full_page=True)

    page.evaluate("document.querySelector('#clearExtraStubsBtn').click()")
    expect(page.locator("#extraStubsStatus")).to_have_text(
        "No extra stubs installed.",
        timeout=HARNESS_TIMEOUT,
    )
