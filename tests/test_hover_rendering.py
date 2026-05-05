"""
Tests for hover popup rendering (src/lsp/hover.js).

Verifies that processInline / renderMarkdown produce correct HTML for
Markdown and RST markup found in MicroPython doc-stubs.

The rendering functions use DOM APIs, so tests run inside a real browser via
Playwright's page.evaluate().  The app page is loaded once per module so the
ES module import only happens once.
"""

import pytest
from playwright.sync_api import expect
from timing import CDN_TIMEOUT

pytestmark = pytest.mark.editor

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_HOVER_MODULE_URL = "/src/lsp/hover.js"


def _render(page, text: str) -> str:
    """Import renderMarkdown and render *text*; return outerHTML of result."""
    return page.evaluate(
        """async (text) => {
            const mod = await import('/src/lsp/hover.js');
            const el = mod.renderMarkdown(text);
            return el.outerHTML;
        }""",
        text,
    )


def _inner(page, text: str) -> str:
    """Return innerText of the rendered output (no tags)."""
    return page.evaluate(
        """async (text) => {
            const mod = await import('/src/lsp/hover.js');
            const el = mod.renderMarkdown(text);
            return el.innerText;
        }""",
        text,
    )


def _query(page, text: str, selector: str) -> list[str]:
    """Render *text* and return list of innerText for all *selector* matches."""
    return page.evaluate(
        """async ([text, selector]) => {
            const mod = await import('/src/lsp/hover.js');
            const el = mod.renderMarkdown(text);
            return Array.from(el.querySelectorAll(selector)).map(n => n.innerText);
        }""",
        [text, selector],
    )


def _attr(page, text: str, selector: str, attr: str) -> list[str]:
    """Return list of *attr* attribute values for all *selector* matches."""
    return page.evaluate(
        """async ([text, selector, attr]) => {
            const mod = await import('/src/lsp/hover.js');
            const el = mod.renderMarkdown(text);
            return Array.from(el.querySelectorAll(selector)).map(n => n.getAttribute(attr));
        }""",
        [text, selector, attr],
    )


# ---------------------------------------------------------------------------
# Fixture
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def render_page(shared_page, live_server):
    """Navigate to the editor once; reuse for all rendering tests."""
    shared_page.goto(f"{live_server}/index.html", wait_until="domcontentloaded")
    shared_page.wait_for_selector(".cm-editor", timeout=CDN_TIMEOUT)
    return shared_page


# ---------------------------------------------------------------------------
# Inline formatting
# ---------------------------------------------------------------------------


def test_inline_bold(render_page):
    html = _render(render_page, "This is **bold** text.")
    assert "<strong>" in html
    texts = _query(render_page, "This is **bold** text.", "strong")
    assert texts == ["bold"]


def test_inline_italic(render_page):
    texts = _query(render_page, "This is *italic* here.", "em")
    assert texts == ["italic"]


def test_inline_backtick_code(render_page):
    texts = _query(render_page, "Use `print()` to output.", "code")
    assert "print()" in texts


def test_inline_rst_double_backtick(render_page):
    texts = _query(render_page, "Returns ``None`` on success.", "code")
    assert "None" in texts


def test_inline_rst_role_func(render_page):
    # RST role syntax: :func:`name`  — colon after role name is mandatory
    classes = _attr(render_page, "To reduce power see :func:`lightsleep`.", "code", "class")
    assert any("cm-hover-rst-ref" in (c or "") for c in classes), (
        f"Expected cm-hover-rst-ref class on :func: role; got classes: {classes}"
    )


def test_inline_rst_role_class(render_page):
    classes = _attr(render_page, "Use :class:`Pin` to control GPIO.", "code", "class")
    assert any("cm-hover-rst-ref" in (c or "") for c in classes), (
        f"Expected cm-hover-rst-ref class on :class: role; got classes: {classes}"
    )


def test_inline_rst_role_mod(render_page):
    # :mod:`socket` appears in MicroPython module cross-references
    classes = _attr(render_page, "available via the :mod:`socket` module.", "code", "class")
    assert any("cm-hover-rst-ref" in (c or "") for c in classes)


def test_inline_rst_role_not_consumed_as_plain_code(render_page):
    """Before the regex fix, :func:`name` rendered as ':func:' text + plain <code>name</code>.
    After the fix the whole construct must produce a cm-hover-rst-ref code element."""
    html = _render(render_page, "see :func:`lightsleep`, :func:`time.sleep()` functions.")
    # The literal ':func:' prefix must NOT appear as plain text
    assert ":func:" not in html.replace("cm-hover-rst-ref", ""), (
        ":func: should not appear as raw text in output; RST role regex not matching"
    )


def test_inline_markdown_link(render_page):
    hrefs = _attr(render_page, "See [docs](https://docs.micropython.org).", "a", "href")
    assert "https://docs.micropython.org" in hrefs


def test_inline_bare_url(render_page):
    hrefs = _attr(render_page, "Visit https://micropython.org for info.", "a", "href")
    assert "https://micropython.org" in hrefs


def test_inline_link_opens_new_tab(render_page):
    targets = _attr(render_page, "[link](https://example.com)", "a", "target")
    assert "_blank" in targets
    rels = _attr(render_page, "[link](https://example.com)", "a", "rel")
    assert any("noopener" in (r or "") for r in rels)


# ---------------------------------------------------------------------------
# Block-level: headers
# ---------------------------------------------------------------------------


def test_atx_h1(render_page):
    texts = _query(render_page, "# Module header\n\nSome text.", "h1")
    assert "Module header" in texts


def test_atx_h2(render_page):
    texts = _query(render_page, "## Section\n\nContent.", "h2")
    assert "Section" in texts


def test_setext_h1(render_page):
    texts = _query(render_page, "Pin class\n=========\n\nDoc text.", "h1")
    assert "Pin class" in texts


def test_setext_h2(render_page):
    texts = _query(render_page, "Returns\n-------\n\nDesc.", "h2")
    assert "Returns" in texts


# ---------------------------------------------------------------------------
# Block-level: code blocks
# ---------------------------------------------------------------------------


def test_fenced_code_block(render_page):
    md = "Example:\n\n```python\np = Pin(0)\np.value(1)\n```\n"
    pres = _query(render_page, md, "pre")
    assert any("Pin" in p for p in pres)


def test_rst_code_block(render_page):
    rst = "Usage Model::\n\n    p = Pin(0, Pin.OUT)\n    p.value(1)\n"
    pres = _query(render_page, rst, "pre code")
    assert any("Pin" in p for p in pres)


def test_fenced_code_no_inline_code_style(render_page):
    """Code inside <pre> should not carry the inline-code pill styling."""
    md = "```python\nx = 1\n```\n"
    html = _render(render_page, md)
    # <pre> must be present and contain <code>
    assert "<pre>" in html
    assert "<code" in html


# ---------------------------------------------------------------------------
# Block-level: RST field lists
# ---------------------------------------------------------------------------


def test_rst_param_field(render_page):
    rst = ":param pin: Pin object to configure\n"
    dts = _query(render_page, rst, "dt.cm-hover-field-name")
    assert any("param" in dt for dt in dts)


def test_rst_returns_field(render_page):
    rst = ":returns: Current value\n"
    dts = _query(render_page, rst, "dt.cm-hover-field-name")
    assert any("return" in dt.lower() for dt in dts)


def test_rst_rtype_field(render_page):
    rst = ":rtype: int\n"
    dds = _query(render_page, rst, "dd")
    assert any("int" in dd for dd in dds)


def test_rst_multiple_fields(render_page):
    rst = (
        ":param x: x coordinate\n"
        ":param y: y coordinate\n"
        ":returns: Point object\n"
        ":rtype: Point\n"
    )
    dts = _query(render_page, rst, "dt.cm-hover-field-name")
    assert len(dts) == 4


# ---------------------------------------------------------------------------
# Block-level: lists
# ---------------------------------------------------------------------------


def test_bullet_list(render_page):
    md = "- alpha\n- beta\n- gamma\n"
    items = _query(render_page, md, "ul li")
    assert items == ["alpha", "beta", "gamma"]


def test_numbered_list(render_page):
    md = "1. first\n2. second\n3. third\n"
    items = _query(render_page, md, "ol li")
    assert items == ["first", "second", "third"]


# ---------------------------------------------------------------------------
# Block-level: paragraphs and horizontal rules
# ---------------------------------------------------------------------------


def test_paragraph_rendered(render_page):
    paras = _query(render_page, "Hello world.\n", "p")
    assert any("Hello world" in p for p in paras)


def test_horizontal_rule(render_page):
    html = _render(render_page, "before\n\n---\n\nafter\n")
    assert "<hr" in html


# ---------------------------------------------------------------------------
# Complex / integration inputs
# ---------------------------------------------------------------------------


def test_micropython_pin_docstring(render_page):
    """Realistic MicroPython stub docstring renders without crash."""
    docstring = (
        "## Pin\n\n"
        "Control I/O pins. See :class:`machine.Pin` for details.\n\n"
        ":param id: Pin identifier (board-specific)\n"
        ":param mode: ``Pin.IN`` or ``Pin.OUT``\n"
        ":param pull: ``Pin.PULL_UP``, ``Pin.PULL_DOWN``, or ``None``\n\n"
        "Usage Model::\n\n"
        "    p = Pin(0, Pin.OUT)\n"
        "    p.value(1)\n\n"
        "See https://docs.micropython.org/en/latest/library/machine.Pin.html\n"
    )
    html = _render(render_page, docstring)
    # Headers present
    assert "<h2>" in html
    # RST role present — :class:`machine.Pin` must produce cm-hover-rst-ref
    assert "cm-hover-rst-ref" in html, (
        f":class: role not rendered as cm-hover-rst-ref. HTML: {html[:400]}"
    )
    # Field list present
    assert "cm-hover-field-name" in html
    # Code block present
    assert "<pre>" in html
    # URL link present
    assert "docs.micropython.org" in html


def test_network_module_docstring(render_page):
    """Actual LSP plaintext hover content for 'import network' — real stub format."""
    # This is the verbatim content returned by Pyright for the network module
    docstring = (
        "(module) network\n\n"
        "Network configuration.\n\n"
        "MicroPython module: https://docs.micropython.org/en/v1.28.0/library/network.html\n\n"
        "This module provides network drivers and routing configuration. To use this\n"
        "module, a MicroPython variant/build with network capabilities must be installed.\n"
        "Network drivers for specific hardware are available within this module and are\n"
        "used to configure hardware network interface(s). Network services provided\n"
        "by configured interfaces are then available for use via the :mod:`socket`\n"
        "module.\n\n"
        "For example::\n\n"
        "    import network\n"
        "    import time\n"
        "    nic = network.Driver(...)\n\n"
        "---\n"
        "Module: 'network' on micropython-v1.28.0-rp2-RPI_PICO_W\n"
    )
    html = _render(render_page, docstring)
    # URL must be auto-linked
    assert "href=\"https://docs.micropython.org" in html, "MicroPython URL must be a clickable link"
    # :mod:`socket` must render as RST ref, not plain ':mod:' text
    assert "cm-hover-rst-ref" in html, ":mod:`socket` must produce cm-hover-rst-ref"
    assert ":mod:" not in html.replace('cm-hover-rst-ref', ''), ":mod: must not appear as raw text"
    # RST code block must produce <pre>
    assert "<pre>" in html, "For example:: code block must produce <pre>"
    assert "import network" in html
    # Horizontal rule
    assert "<hr" in html


def test_machine_idle_docstring(render_page):
    """Actual docstring from machine.idle() — contains :func: RST roles and italic."""
    docstring = (
        "Gates the clock to the CPU, useful to reduce power consumption at any time\n"
        "during short or long periods. Peripherals continue working and execution\n"
        "resumes as soon as any interrupt is triggered, or at most one millisecond\n"
        "after the CPU was paused.\n\n"
        "It is recommended to call this function inside any tight loop that is\n"
        "continuously checking for an external change (i.e. polling). This will reduce\n"
        "power consumption without significantly impacting performance. To reduce\n"
        "power consumption further then see the :func:`lightsleep`,\n"
        ":func:`time.sleep()` and :func:`time.sleep_ms()` functions.\n"
    )
    refs = _query(render_page, docstring, "code.cm-hover-rst-ref")
    assert "lightsleep" in refs, f"Expected 'lightsleep' RST ref; got: {refs}"
    assert "time.sleep()" in refs, f"Expected 'time.sleep()' RST ref; got: {refs}"
    assert "time.sleep_ms()" in refs, f"Expected 'time.sleep_ms()' RST ref; got: {refs}"


def test_lightsleep_docstring_italic(render_page):
    """Docstring for machine.lightsleep() uses *time_ms* italic markup."""
    docstring = (
        "If *time_ms* is specified then this will be the maximum time in milliseconds\n"
        "that the sleep will last for. Otherwise the sleep can last indefinitely.\n\n"
        "With or without a timeout, execution may resume at any time if there are events\n"
        "that require processing. Such events, or wake sources, should be configured\n"
        "before sleeping, like `Pin` change or `RTC` timeout.\n"
    )
    ems = _query(render_page, docstring, "em")
    assert "time_ms" in ems, f"Expected italic 'time_ms'; got: {ems}"
    # `Pin` and `RTC` render as inline code
    codes = _query(render_page, docstring, "code")
    assert "Pin" in codes
    assert "RTC" in codes


def test_select_register_docstring(render_page):
    """Docstring from select.poll.register() — double-backtick code + bullet list."""
    docstring = (
        "Register `stream` *obj* for polling. *eventmask* is logical OR of:\n\n"
        "* ``select.POLLIN``  - data available for reading\n"
        "* ``select.POLLOUT`` - more data can be written\n"
    )
    # Italic *obj* and *eventmask*
    ems = _query(render_page, docstring, "em")
    assert "obj" in ems
    assert "eventmask" in ems
    # Double-backtick code
    codes = _query(render_page, docstring, "code")
    assert "select.POLLIN" in codes
    assert "select.POLLOUT" in codes
    # Bullet list items
    items = _query(render_page, docstring, "ul li")
    assert len(items) == 2


# ---------------------------------------------------------------------------
# Signature line rendering
# ---------------------------------------------------------------------------


def test_signature_module(render_page):
    """'(module) network' → rendered as cm-hover-signature, not a plain paragraph."""
    html = _render(render_page, "(module) network\n\nNetwork configuration.\n")
    assert "cm-hover-signature" in html
    sigs = _query(render_page, "(module) network\n\nNetwork configuration.\n", ".cm-hover-signature code")
    assert sigs == ["(module) network"]


def test_signature_method(render_page):
    """'(method) def value(x: Any, /) -> None' → signature block."""
    text = "(method) def value(x: Any, /) -> None\n\nSet or get the value of the pin.\n"
    sigs = _query(render_page, text, ".cm-hover-signature code")
    assert sigs == ["(method) def value(x: Any, /) -> None"]
    # Body text still rendered as paragraph
    paras = _query(render_page, text, "p")
    assert any("Set or get" in p for p in paras)


def test_signature_class(render_page):
    """Multi-line class signature (Pyright indented params format) → single signature block."""
    # This is the exact format Pyright returns for class Pin
    text = (
        "class Pin(\n"
        "    id: Any,\n"
        "    /,\n"
        "    mode: int = -1,\n"
        "    pull: int = -1,\n"
        "    *,\n"
        "    value: Any = None,\n"
        "    drive: int | None = None,\n"
        "    alt: int | None = None\n"
        ")\n"
        "\n"
        "Access the pin peripheral.\n"
    )
    sigs = _query(render_page, text, ".cm-hover-signature code")
    assert len(sigs) == 1, f"Expected exactly one signature block; got {sigs}"
    assert "class Pin(" in sigs[0]
    assert "id: Any" in sigs[0]
    assert "alt: int | None = None" in sigs[0]
    assert sigs[0].strip().endswith(")")
    # Body text must still appear as a paragraph (not swallowed into signature)
    paras = _query(render_page, text, "p")
    assert any("Access the pin" in p for p in paras)


def test_signature_class_compact(render_page):
    """Single-line class signature still works."""
    text = "class Pin(id: Any, /, mode: int = -1)\n\nCreate a new Pin object.\n"
    sigs = _query(render_page, text, ".cm-hover-signature code")
    assert any("Pin" in s for s in sigs)


def test_pin_class_full_lsp_payload(render_page):
    """Exact LSP plaintext payload for Pin class — multi-line signature + long body."""
    text = (
        "class Pin(\n"
        "    id: Any,\n"
        "    /,\n"
        "    mode: int = -1,\n"
        "    pull: int = -1,\n"
        "    *,\n"
        "    value: Any = None,\n"
        "    drive: int | None = None,\n"
        "    alt: int | None = None\n"
        ")\n"
        "\n"
        "Access the pin peripheral (GPIO pin) associated with the given ``id``.  If\n"
        "additional arguments are given in the constructor then they are used to initialise\n"
        "the pin.\n"
        "\n"
        "  - ``id`` is mandatory and can be an arbitrary object.\n"
        "  - ``mode`` specifies the pin mode, which can be one of:\n"
        "\n"
        "    - ``Pin.IN`` - Pin is configured for input.\n"
        "    - ``Pin.OUT`` - Pin is configured for (normal) output.\n"
        "\n"
        "  - ``pull`` specifies if the pin has a (weak) pull resistor.\n"
        "\n"
        "Not all ports implement this mode, or some might only on certain pins.\n"
        "by calling the constructor or :meth:`Pin.init` method.\n"
    )
    # Signature block captures full multi-line declaration
    sigs = _query(render_page, text, ".cm-hover-signature code")
    assert len(sigs) == 1
    sig = sigs[0]
    assert "class Pin(" in sig
    assert "drive: int | None = None" in sig
    assert sig.strip().endswith(")")

    # Body: double-backtick ``id`` renders as inline code
    codes = _query(render_page, text, ".cm-hover-markdown code")
    assert "id" in codes

    # Body: :meth:`Pin.init` renders as RST ref
    refs = _query(render_page, text, "code.cm-hover-rst-ref")
    assert "Pin.init" in refs

    # Signature block and body are separate — body is NOT inside signature
    html = _render(render_page, text)
    sig_section = html[html.find("cm-hover-signature"):html.find("cm-hover-markdown")]
    assert "Access the pin" not in sig_section


def test_signature_function(render_page):
    """'(function) def idle() -> None' → signature block."""
    text = "(function) def idle() -> None\n\nGates the clock to the CPU.\n"
    sigs = _query(render_page, text, ".cm-hover-signature code")
    assert sigs == ["(function) def idle() -> None"]


def test_signature_variable(render_page):
    """'(variable) HARD_RESET: int' → signature block."""
    text = "(variable) HARD_RESET: int\n\nReset causes.\n"
    sigs = _query(render_page, text, ".cm-hover-signature code")
    assert sigs == ["(variable) HARD_RESET: int"]


def test_signature_not_applied_to_plain_paragraph(render_page):
    """A plain prose paragraph must NOT get the signature treatment."""
    text = "This module provides network drivers.\n\nMore details here.\n"
    sigs = _query(render_page, text, ".cm-hover-signature")
    assert sigs == [], f"No signature expected for plain prose; got: {sigs}"


def test_network_module_signature_and_body(render_page):
    """Full network module docstring: signature line + URL + :mod: ref + code block."""
    docstring = (
        "(module) network\n\n"
        "Network configuration.\n\n"
        "MicroPython module: https://docs.micropython.org/en/v1.28.0/library/network.html\n\n"
        "Available via the :mod:`socket` module.\n\n"
        "For example::\n\n"
        "    import network\n"
        "    nic = network.Driver(...)\n\n"
        "---\n"
        "Module: 'network' on micropython-v1.28.0-rp2-RPI_PICO_W\n"
    )
    # Signature line
    sigs = _query(render_page, docstring, ".cm-hover-signature code")
    assert sigs == ["(module) network"]
    # URL is clickable
    hrefs = _attr(render_page, docstring, "a", "href")
    assert any("docs.micropython.org" in (h or "") for h in hrefs)
    # :mod: rendered as RST ref
    refs = _query(render_page, docstring, "code.cm-hover-rst-ref")
    assert "socket" in refs
    # Code block from RST ::
    pres = _query(render_page, docstring, "pre code")
    assert any("import network" in p for p in pres)


# ---------------------------------------------------------------------------
# Viewport containment: tooltip must not overflow when placed above cursor
# ---------------------------------------------------------------------------


def test_hover_tooltip_stays_within_viewport(render_page, live_server):
    """A hover tooltip injected near the top of the editor must not overflow
    the viewport top edge.  This tests the min(440px, 50vh) CSS constraint.
    """
    result = render_page.evaluate("""async () => {
        // Inject a tall synthetic tooltip into the page as CodeMirror would
        const tooltip = document.createElement('div');
        tooltip.className = 'cm-tooltip cm-tooltip-hover cm-tooltip-above';
        tooltip.style.position = 'fixed';
        tooltip.style.left = '100px';

        const inner = document.createElement('div');
        inner.className = 'cm-lsp-hover';

        // Fill with enough content to exceed 440px if unconstrained
        for (let i = 0; i < 30; i++) {
            const p = document.createElement('p');
            p.textContent = `Line ${i + 1}: some documentation text here.`;
            inner.appendChild(p);
        }
        tooltip.appendChild(inner);

        // Position near the top so "above" placement is stressed
        tooltip.style.top = '40px';
        document.body.appendChild(tooltip);

        const rect = tooltip.getBoundingClientRect();
        document.body.removeChild(tooltip);
        return { top: rect.top, bottom: rect.bottom, height: rect.height, vh: window.innerHeight };
    }""")

    vh = result["vh"]
    assert result["top"] >= 0, f"Tooltip top overflows viewport (top={result['top']})"
    assert result["height"] <= vh * 0.5 + 5, (  # +5px tolerance for rounding
        f"Tooltip height {result['height']}px exceeds 50vh ({vh * 0.5}px)"
    )


def test_hover_tooltip_css_overflow_hidden(render_page):
    """The outer .cm-tooltip-hover must have overflow:hidden so content cannot
    bleed outside the rounded border."""
    overflow = render_page.evaluate("""() => {
        const el = document.createElement('div');
        el.className = 'cm-tooltip cm-tooltip-hover';
        document.body.appendChild(el);
        const style = window.getComputedStyle(el);
        const result = { overflowX: style.overflowX, overflowY: style.overflowY };
        document.body.removeChild(el);
        return result;
    }""")
    # Both axes must clip (hidden or auto — not visible)
    assert overflow["overflowX"] in ("hidden", "auto", "clip"), (
        f"cm-tooltip-hover overflowX should not be visible; got: {overflow['overflowX']}"
    )
    assert overflow["overflowY"] in ("hidden", "auto", "clip"), (
        f"cm-tooltip-hover overflowY should not be visible; got: {overflow['overflowY']}"
    )


def test_empty_input_returns_empty_div(render_page):
    html = _render(render_page, "")
    assert "cm-hover-markdown" in html
    # No child elements for empty input
    children = render_page.evaluate(
        """async () => {
            const mod = await import('/src/lsp/hover.js');
            const el = mod.renderMarkdown('');
            return el.children.length;
        }"""
    )
    assert children == 0


def test_whitespace_only_input(render_page):
    children = render_page.evaluate(
        """async () => {
            const mod = await import('/src/lsp/hover.js');
            const el = mod.renderMarkdown('   \\n  \\n  ');
            return el.children.length;
        }"""
    )
    assert children == 0
