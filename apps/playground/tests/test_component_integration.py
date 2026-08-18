"""Application coverage for the public component integration boundary."""

import json
import re
from pathlib import Path
from urllib.error import HTTPError, URLError
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
