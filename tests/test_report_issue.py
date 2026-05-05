"""
Tests for the "Report a stub issue" button in the options panel.

Covers:
- Button presence in the options panel
- Dropdown visibility toggle
- Warning text is displayed
- Confirm button exists
- buildIssueUrl JavaScript helper (in-browser evaluation):
    - includes stubs package, stubs version, typeCheckMode, playground URL in the body
    - does not include a code snippet block
    - supports optional labels query parameter
- resolveReportIssueLabels helper:
    - returns Quality when the label exists
    - falls back to no labels on missing label or fetch failures
"""

import pytest
from playwright.sync_api import expect
from timing import CDN_TIMEOUT

pytestmark = pytest.mark.editor

REPORT_ISSUE_URL_PREFIX = "https://github.com/Josverl/micropython-stubs/issues/new"


def _goto_editor(page, live_server):
    page.goto(f"{live_server}/index.html", wait_until="domcontentloaded")
    page.wait_for_selector(".cm-editor", timeout=CDN_TIMEOUT)


def _open_options_panel(page):
    is_open = page.evaluate("() => document.body.classList.contains('options-panel-open')")
    if is_open:
        return
    page.locator("#options-panel-handle").click()
    page.wait_for_timeout(50)
    assert page.evaluate("() => document.body.classList.contains('options-panel-open')")


@pytest.fixture(scope="module")
def _shared_page(shared_page, live_server):
    _goto_editor(shared_page, live_server)
    return shared_page


@pytest.fixture
def ri_page(_shared_page):
    """Return the shared page with the options panel open and dropdown closed."""
    # Close the dropdown if it is somehow open
    if _shared_page.locator("#reportIssueDropdown").is_visible():
        _shared_page.keyboard.press("Escape")
    expect(_shared_page.locator("#reportIssueDropdown")).to_be_hidden()
    _open_options_panel(_shared_page)
    return _shared_page


# ---------------------------------------------------------------------------
# DOM / UI tests
# ---------------------------------------------------------------------------


def test_report_issue_button_exists(ri_page):
    """Report Issue button is present in the options panel."""
    expect(ri_page.locator("#reportIssueBtn")).to_be_visible()


def test_report_issue_dropdown_hidden_by_default(ri_page):
    """Confirmation dropdown is hidden on page load."""
    expect(ri_page.locator("#reportIssueDropdown")).to_be_hidden()


def test_report_issue_dropdown_opens_on_click(ri_page):
    """Clicking the button shows the confirmation dropdown."""
    ri_page.locator("#reportIssueBtn").click()
    expect(ri_page.locator("#reportIssueDropdown")).to_be_visible()
    # Clean up
    ri_page.keyboard.press("Escape")


def test_report_issue_dropdown_shows_warning(ri_page):
    """Dropdown contains a secrets-warning message."""
    ri_page.locator("#reportIssueBtn").click()
    warning = ri_page.locator(".report-issue-warning")
    expect(warning).to_be_visible()
    # Should mention passwords/secrets
    text = warning.inner_text().lower()
    assert any(word in text for word in ("password", "secret", "api key", "api keys")), (
        f"Warning text did not mention passwords/secrets: {text!r}"
    )
    ri_page.keyboard.press("Escape")


def test_report_issue_dropdown_has_confirm_button(ri_page):
    """Dropdown has a 'Continue to GitHub' confirm button."""
    ri_page.locator("#reportIssueBtn").click()
    expect(ri_page.locator("#reportIssueConfirm")).to_be_visible()
    ri_page.keyboard.press("Escape")


def test_report_issue_dropdown_closes_on_escape(ri_page):
    """Pressing Escape closes the dropdown."""
    ri_page.locator("#reportIssueBtn").click()
    expect(ri_page.locator("#reportIssueDropdown")).to_be_visible()
    ri_page.keyboard.press("Escape")
    expect(ri_page.locator("#reportIssueDropdown")).to_be_hidden()


def test_report_issue_dropdown_closes_on_outside_click(ri_page):
    """Clicking outside the dropdown closes it."""
    ri_page.locator("#reportIssueBtn").click()
    expect(ri_page.locator("#reportIssueDropdown")).to_be_visible()
    ri_page.locator("main").click()
    expect(ri_page.locator("#reportIssueDropdown")).to_be_hidden()


def test_report_issue_dropdown_toggles(ri_page):
    """Clicking the button twice opens then closes the dropdown."""
    ri_page.locator("#reportIssueBtn").click()
    expect(ri_page.locator("#reportIssueDropdown")).to_be_visible()
    ri_page.locator("#reportIssueBtn").click()
    expect(ri_page.locator("#reportIssueDropdown")).to_be_hidden()


# ---------------------------------------------------------------------------
# buildIssueUrl unit tests (in-browser via evaluate)
# ---------------------------------------------------------------------------


def test_build_issue_url_targets_stubs_repo(ri_page):
    """buildIssueUrl returns a URL pointing to micropython-stubs issues."""
    result = ri_page.evaluate("""() => {
        // Import dynamically is async, so we call a quick synchronous path
        // by constructing manually via a re-export stored on window (not available),
        // so we use dynamic import instead.
        return import('./share.js').then(({ buildIssueUrl }) => {
            return buildIssueUrl('micropython-esp32-stubs', '1.28.0.post3', 'standard', 'https://example.com/playground');
        });
    }""")
    assert result.startswith("https://github.com/Josverl/micropython-stubs/issues/new"), (
        f"Unexpected URL prefix: {result[:80]}"
    )


def test_build_issue_url_contains_stub_package(ri_page):
    """buildIssueUrl embeds the selected stubs package in the issue body."""
    result = ri_page.evaluate("""() =>
        import('./share.js').then(({ buildIssueUrl }) =>
            buildIssueUrl('micropython-rp2-stubs', '1.28.0.post3', 'basic', 'https://example.com'))
    """)
    from urllib.parse import urlparse, parse_qs, unquote_plus
    params = parse_qs(urlparse(result).query)
    body = unquote_plus(params['body'][0])
    assert 'micropython-rp2-stubs' in body, f"Stub package not found in body: {body[:200]}"


def test_build_issue_url_contains_stub_version_with_v_prefix(ri_page):
    """buildIssueUrl embeds the stubs version prefixed with v."""
    result = ri_page.evaluate("""() =>
        import('./share.js').then(({ buildIssueUrl }) =>
            buildIssueUrl('micropython-esp32-stubs', '1.28.0.post3', 'standard', 'https://example.com'))
    """)
    from urllib.parse import urlparse, parse_qs, unquote_plus
    params = parse_qs(urlparse(result).query)
    body = unquote_plus(params['body'][0])
    assert '**Stub version:** v1.28.0.post3' in body, f"Stub version not found in body: {body[:250]}"


def test_build_issue_url_contains_typecheck_mode(ri_page):
    """buildIssueUrl embeds the type checking mode in the issue body."""
    result = ri_page.evaluate("""() =>
        import('./share.js').then(({ buildIssueUrl }) =>
            buildIssueUrl('micropython-esp32-stubs', '1.28.0.post3', 'strict', 'https://example.com'))
    """)
    from urllib.parse import urlparse, parse_qs, unquote_plus
    params = parse_qs(urlparse(result).query)
    body = unquote_plus(params['body'][0])
    assert 'strict' in body, f"typeCheckMode not found in body: {body[:200]}"


def test_build_issue_url_contains_playground_link(ri_page):
    """buildIssueUrl embeds the playground link using markdown link format."""
    result = ri_page.evaluate("""() =>
        import('./share.js').then(({ buildIssueUrl }) =>
            buildIssueUrl('micropython-esp32-stubs', '1.28.0.post3', 'standard', 'https://example.com/playground?board=esp32'))
    """)
    from urllib.parse import urlparse, parse_qs, unquote_plus
    params = parse_qs(urlparse(result).query)
    body = unquote_plus(params['body'][0])
    assert '## Issue reproduction' in body, f"Issue reproduction heading missing in body: {body[:300]}"
    assert '[MicroPython-stubs Playground](' in body, f"Markdown link label missing in body: {body[:300]}"
    assert '](https://example.com/playground?board=esp32)' in body, (
        f"Markdown link URL missing in body: {body[:300]}"
    )


def test_build_issue_url_starts_with_describe_issue_block(ri_page):
    """Issue body starts with the Describe the issue section and guidance comment."""
    result = ri_page.evaluate("""() =>
        import('./share.js').then(({ buildIssueUrl }) =>
            buildIssueUrl('micropython-esp32-stubs', '1.28.0.post3', 'standard', 'https://example.com'))
    """)
    from urllib.parse import urlparse, parse_qs, unquote_plus
    params = parse_qs(urlparse(result).query)
    body = unquote_plus(params['body'][0])
    assert body.startswith(
        '## Describe the issue\n<!-- Please describe what is incorrect or missing in the stub. -->'
    ), f"Unexpected issue body prefix: {body[:200]}"


def test_build_issue_url_sets_labels_when_provided(ri_page):
    """buildIssueUrl adds labels query parameter when labels are supplied."""
    result = ri_page.evaluate("""() =>
        import('./share.js').then(({ buildIssueUrl }) =>
            buildIssueUrl('micropython-esp32-stubs', '1.28.0.post3', 'standard', 'https://example.com', ['Quality']))
    """)
    from urllib.parse import urlparse, parse_qs
    params = parse_qs(urlparse(result).query)
    assert params.get('labels') == ['Quality'], f"Expected labels=Quality, got: {params.get('labels')}"


def test_build_issue_url_has_no_labels_when_not_provided(ri_page):
    """buildIssueUrl omits labels query parameter when no labels are supplied."""
    result = ri_page.evaluate("""() =>
        import('./share.js').then(({ buildIssueUrl }) =>
            buildIssueUrl('micropython-esp32-stubs', '1.28.0.post3', 'standard', 'https://example.com'))
    """)
    from urllib.parse import urlparse, parse_qs
    params = parse_qs(urlparse(result).query)
    assert 'labels' not in params, f"labels should be absent, got: {params.get('labels')}"


def test_build_issue_url_does_not_include_code_sample_block(ri_page):
    """Issue body should not include a formatted code snippet block."""
    result = ri_page.evaluate("""() =>
        import('./share.js').then(({ buildIssueUrl }) =>
            buildIssueUrl('micropython-esp32-stubs', '1.28.0.post3', 'standard', 'https://example.com'))
    """)
    from urllib.parse import urlparse, parse_qs, unquote_plus
    params = parse_qs(urlparse(result).query)
    body = unquote_plus(params['body'][0])
    assert '## Code sample' not in body
    assert '```python' not in body


def test_resolve_report_issue_labels_returns_quality_when_exists(ri_page):
    """resolveReportIssueLabels returns Quality when API confirms the label exists."""
    result = ri_page.evaluate("""() =>
        import('./share.js').then(({ resolveReportIssueLabels }) =>
            resolveReportIssueLabels(async () => ({
                ok: true,
                json: async () => ({ name: 'Quality' }),
            })))
    """)
    assert result == ['Quality']


def test_resolve_report_issue_labels_returns_empty_when_missing(ri_page):
    """resolveReportIssueLabels falls back to empty labels when API responds non-OK."""
    result = ri_page.evaluate("""() =>
        import('./share.js').then(({ resolveReportIssueLabels }) =>
            resolveReportIssueLabels(async () => ({
                ok: false,
                json: async () => ({}),
            })))
    """)
    assert result == []


def test_resolve_report_issue_labels_returns_empty_on_fetch_error(ri_page):
    """resolveReportIssueLabels falls back to empty labels when fetch throws."""
    result = ri_page.evaluate("""() =>
        import('./share.js').then(({ resolveReportIssueLabels }) =>
            resolveReportIssueLabels(async () => {
                throw new Error('network blocked');
            }))
    """)
    assert result == []


# ---------------------------------------------------------------------------
# buildIssueUrl diagnostics table tests (in-browser via evaluate)
# ---------------------------------------------------------------------------


def test_build_issue_url_includes_diagnostics_table(ri_page):
    """buildIssueUrl includes a Diagnostics section when diagnostics are provided."""
    result = ri_page.evaluate("""() =>
        import('./share.js').then(({ buildIssueUrl }) =>
            buildIssueUrl(
                'micropython-esp32-stubs', '1.28.0.post3', 'standard',
                'https://example.com', [],
                [{ fileName: 'main.py', line: 3, character: 5, message: 'Unknown member', severity: 'error' }]
            ))
    """)
    from urllib.parse import urlparse, parse_qs, unquote_plus
    params = parse_qs(urlparse(result).query)
    body = unquote_plus(params['body'][0])
    assert '## Diagnostics' in body, f"Diagnostics section missing: {body[:400]}"
    assert '| File | Position | Level | Message |' in body
    assert '| main.py | 3:5 | error | Unknown member |' in body


def test_build_issue_url_no_diagnostics_section_when_empty(ri_page):
    """buildIssueUrl omits the Diagnostics section when diagnostics list is empty."""
    result = ri_page.evaluate("""() =>
        import('./share.js').then(({ buildIssueUrl }) =>
            buildIssueUrl('micropython-esp32-stubs', '1.28.0.post3', 'standard', 'https://example.com'))
    """)
    from urllib.parse import urlparse, parse_qs, unquote_plus
    params = parse_qs(urlparse(result).query)
    body = unquote_plus(params['body'][0])
    assert '## Diagnostics' not in body


def test_build_issue_url_diagnostics_multiple_rows(ri_page):
    """buildIssueUrl renders all diagnostics as separate table rows."""
    result = ri_page.evaluate("""() =>
        import('./share.js').then(({ buildIssueUrl }) =>
            buildIssueUrl(
                'micropython-esp32-stubs', '1.28.0.post3', 'standard',
                'https://example.com', [],
                [
                    { fileName: 'main.py', line: 1, character: 1, message: 'Err A', severity: 'error' },
                    { fileName: 'lib/util.py', line: 7, character: 2, message: 'Warn B', severity: 'warning' },
                    { fileName: 'main.py', line: 12, character: 4, message: 'Info C', severity: 'info' },
                ]
            ))
    """)
    from urllib.parse import urlparse, parse_qs, unquote_plus
    params = parse_qs(urlparse(result).query)
    body = unquote_plus(params['body'][0])
    assert '| main.py | 1:1 | error | Err A |' in body
    assert '| lib/util.py | 7:2 | warning | Warn B |' in body
    assert '| main.py | 12:4 | info | Info C |' in body


def test_build_issue_url_diagnostics_escapes_pipe_in_message(ri_page):
    """buildIssueUrl escapes pipe characters inside diagnostic messages."""
    result = ri_page.evaluate(r"""() =>
        import('./share.js').then(({ buildIssueUrl }) =>
            buildIssueUrl(
                'pkg', '1.0', 'standard', 'https://example.com', [],
                [{ fileName: 'main.py', line: 1, character: 1, message: 'a | b', severity: 'error' }]
            ))
    """)
    from urllib.parse import urlparse, parse_qs, unquote_plus
    params = parse_qs(urlparse(result).query)
    body = unquote_plus(params['body'][0])
    assert r'a \| b' in body, f"Pipe not escaped in: {body}"
