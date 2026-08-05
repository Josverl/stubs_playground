"""Application styling checks for the LSP hover component."""

import pytest

from tests.timing import CDN_TIMEOUT


pytestmark = pytest.mark.editor


@pytest.fixture(scope="module")
def editor_page(shared_page, live_server):
    shared_page.goto(f"{live_server}/index.html", wait_until="domcontentloaded")
    shared_page.wait_for_selector(".cm-editor", timeout=CDN_TIMEOUT)
    return shared_page


def test_hover_tooltip_stays_within_viewport(editor_page):
    result = editor_page.evaluate("""async () => {
        const tooltip = document.createElement('div');
        tooltip.className = 'cm-tooltip cm-tooltip-hover cm-tooltip-above';
        tooltip.style.position = 'fixed';
        tooltip.style.left = '100px';

        const inner = document.createElement('div');
        inner.className = 'cm-lsp-hover';
        for (let i = 0; i < 30; i++) {
            const p = document.createElement('p');
            p.textContent = `Line ${i + 1}: some documentation text here.`;
            inner.appendChild(p);
        }
        tooltip.appendChild(inner);
        tooltip.style.top = '40px';
        document.body.appendChild(tooltip);

        const rect = tooltip.getBoundingClientRect();
        document.body.removeChild(tooltip);
        return { top: rect.top, height: rect.height, vh: window.innerHeight };
    }""")

    assert result["top"] >= 0
    assert result["height"] <= result["vh"] * 0.5 + 5


def test_hover_tooltip_overflow_is_clipped(editor_page):
    overflow = editor_page.evaluate("""() => {
        const el = document.createElement('div');
        el.className = 'cm-tooltip cm-tooltip-hover';
        document.body.appendChild(el);
        const style = window.getComputedStyle(el);
        const result = { x: style.overflowX, y: style.overflowY };
        document.body.removeChild(el);
        return result;
    }""")

    assert overflow["x"] in ("hidden", "auto", "clip")
    assert overflow["y"] in ("hidden", "auto", "clip")
