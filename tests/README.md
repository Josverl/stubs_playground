# CodeMirror Editor Tests

This directory contains Playwright-based tests for the CodeMirror Python Editor.

## Quick Start

Run tests (the HTTP server is auto-started by test fixtures):
```bash
# Run fast completion unit tests (no browser, no page load)
npm run test:unit:completion

# Run real-time LSP tests
pytest tests/test_lsp_realtime.py -v

# Run focused LSP tests (fast - ~9 seconds)
pytest tests/test_lsp_diagnostics.py -v

# Run all tests
pytest tests/ -v

# Run browser tests with a specific browser
pytest -m editor -v --browser firefox
```

## Test Files

- **`test_lsp_diagnostics.py`** - Core LSP diagnostic tests (3 tests, ~9s)
  - Page loads with LSP
  - Diagnostic icon appears
  - Correct severity display
  
- **`test_editor.py`** - Full editor functionality tests
- **`conftest.py`** - Pytest configuration with optimized fixtures

## Performance Optimization

### Session-scoped Fixtures
```python
@pytest.fixture(scope="session")
def browser():  # Reused across all tests
    
@pytest.fixture(scope="function")  
def page(browser):  # Fast per-test pages
```

Benefits:
- Browser launches once per session
- Each test gets fresh page context
- Tests run ~3-4x faster

## Philosophy: Write One, Test One

❌ **DON'T:**
```python
# Write 10 tests, run once, find 5 failures
def test_1(): ...
def test_10(): ...
pytest  # 😱 Half fail!
```

✅ **DO:**
```python
# Write one test, verify it works
def test_basic():
    assert True
    
pytest  # ✅ Pass!

# Now add next test
def test_next():
    assert True
    
pytest  # ✅ Pass!
```

## LSP Diagnostic Tests

### Test Design
Each test is:
- **Focused** - Tests one thing
- **Fast** - Uses minimal waits
- **Reliable** - Waits for elements, not arbitrary timeouts

### Example
```python
def test_diagnostic_icon_appears(page, live_server):
    page.goto(f"{live_server}/index.html")
    page.wait_for_selector(".cm-editor", timeout=10000)
    
    # Wait for the actual diagnostic marker
    marker = page.locator(".cm-lint-marker-info")
    marker.wait_for(timeout=5000)
    
    assert marker.is_visible()
```

## Adding New Tests

1. **Start small** - One assertion
2. **Run immediately** - `pytest tests/test_lsp_diagnostics.py::test_new -v`
3. **Verify fast** - Should complete in <5 seconds
4. **Then expand** - Add more tests incrementally

## Troubleshooting

**Tests slow?**
- Check if browser fixture is session-scoped
- Use `wait_for_selector()` instead of `time.sleep()`
- Run focused tests: `pytest tests/test_lsp_diagnostics.py`

**Server already running?**
```bash
# Kill process on port 8888
lsof -ti:8888 | xargs kill -9
```
