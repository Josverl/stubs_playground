"""
Pytest configuration for CodeMirror Editor tests
"""

import socket
import subprocess
import time
import urllib.request
from pathlib import Path

import pytest
from playwright.sync_api import sync_playwright

def _free_port() -> int:
    """Return an ephemeral TCP port that is free right now."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _server_responds(base_url: str, timeout: float = 3.0) -> bool:
    """Return True if the repository-level package manifest is available."""
    try:
        resp = urllib.request.urlopen(f"{base_url}/package.json", timeout=timeout)
        return resp.status == 200
    except Exception:
        return False


@pytest.fixture(scope="session")
def project_server():
    """
    Start a fresh HTTP server on a dynamically chosen free port for this
    test session.  Using a unique port per session means concurrent pytest
    invocations (e.g. two terminals, CI matrix) never share or kill each
    other's server.

    The server serves from the project root so each owner can load only its own
    browser harnesses.
    """
    port = _free_port()
    project_root = Path(__file__).parent.parent
    server_script = Path(__file__).parent / "http_server.py"
    process = subprocess.Popen(
        ["python3", str(server_script), str(port), str(project_root)],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    base_url = f"http://localhost:{port}"
    # Wait until the server actually responds (up to 5 s)
    for _ in range(25):
        if _server_responds(base_url):
            break
        time.sleep(0.2)
    else:
        process.terminate()
        raise RuntimeError(f"HTTP server on :{port} did not respond in time")

    yield base_url
    process.terminate()
    process.wait()


@pytest.fixture(scope="session")
def browser(browser_name):
    """Single browser instance shared across the test session."""
    with sync_playwright() as p:
        if browser_name in {"chrome", "msedge"}:
            # Branded Chromium channels (Google Chrome / Microsoft Edge)
            browser = p.chromium.launch(channel=browser_name, headless=True)
        else:
            browser_launcher = getattr(p, browser_name)
            browser = browser_launcher.launch(headless=True)
        yield browser
        browser.close()


@pytest.fixture(scope="function")
def page(browser):
    """Fresh page (and context) for every test function."""
    # ignore_https_errors lets CDN resources load behind TLS interception proxies
    context = browser.new_context(ignore_https_errors=True)
    page = context.new_page()
    yield page
    page.close()
    context.close()


@pytest.fixture(scope="module")
def shared_page(browser):
    """Module-scoped page for read-only tests. Avoids CDN re-downloads."""
    context = browser.new_context(ignore_https_errors=True)
    page = context.new_page()
    yield page
    page.close()
    context.close()
