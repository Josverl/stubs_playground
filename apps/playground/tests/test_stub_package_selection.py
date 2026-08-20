import json
from pathlib import Path

from playwright.sync_api import Page, expect

from tests.timing import CDN_TIMEOUT, LSP_TIMEOUT


RESULTS = Path(__file__).parents[3] / "results"
CATALOG_PATH = Path(__file__).parents[3] / "packages" / "pyright-worker" / "assets" / "stub-package-catalog.json"
CATALOG = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
EXPECTED_VERSIONS = CATALOG["availableRuntimeVersions"][:3]
EXPECTED_DEFAULT_VERSION = CATALOG["defaultRuntimeVersion"]


def test_micropython_version_and_port_filters_narrow_stub_packages(
    page: Page,
    live_server: str,
):
    page.goto(f"{live_server}/index.html", wait_until="domcontentloaded")
    page.wait_for_selector(".cm-editor", timeout=CDN_TIMEOUT)
    page.wait_for_function(
        "() => document.querySelector('#stubVersion')?.options.length === 3",
        timeout=CDN_TIMEOUT,
    )
    if not page.locator("body").evaluate("element => element.classList.contains('options-panel-open')"):
        page.locator("#options-panel-handle").click()
    expect(page.locator("#stubVersion")).to_be_visible()

    assert page.locator("#stubVersion option").all_text_contents() == EXPECTED_VERSIONS
    expect(page.locator("#stubVersion")).to_have_value(EXPECTED_DEFAULT_VERSION)

    page.locator("#stubVersion").select_option("1.27.0")
    page.locator("#stubPort").select_option("rp2")
    page.wait_for_function(
        """() => window.__lspReady === true
            && document.querySelector('#boardSelect')?.value === 'rp2'
            && window.__activeLspBoard === 'rp2'""",
        timeout=CDN_TIMEOUT + LSP_TIMEOUT,
    )

    expect(page.locator("#stubBoard")).to_have_value("GENERIC")
    expect(page.locator("#boardSelect")).to_have_value("rp2")
    expect(page.locator("#boardSelect option:checked")).to_contain_text("rp2 / GENERIC")
    assert "RPI_PICO" in page.locator("#stubBoard option").all_text_contents()

    RESULTS.mkdir(exist_ok=True)
    page.screenshot(path=RESULTS / "stub-package-selection-desktop.png", full_page=True)
    page.set_viewport_size({"width": 390, "height": 844})
    expect(page.locator("#options-panel")).to_be_visible()
    assert page.evaluate("() => document.documentElement.scrollWidth <= document.documentElement.clientWidth")
    page.screenshot(path=RESULTS / "stub-package-selection-mobile.png", full_page=True)
