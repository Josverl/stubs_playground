# Test suites

Tests are owned by the code they verify:

```text
apps/playground/tests/          Playground behavior and component interface tests
packages/lsp-client/tests/      LSP client unit and standalone browser tests
packages/pyright-worker/tests/  Worker protocol and stub packaging tests
tests/                          Shared Pytest fixtures and timing constants only
```

Component tests must not import or load files from `apps/playground`. The
playground may verify public component exports, URLs, and rendered behavior, but
must not test package implementation details.

`npm run check:test-boundaries` enforces these dependency rules.

## Commands

```bash
# All JavaScript unit tests, grouped by owner
npm run test:unit

# One owner at a time
npm run test:app:unit
npm run test:lsp-client:unit
npm run test:pyright-worker:unit

# Browser suites
uv run pytest apps/playground/tests -v --browser chromium
uv run pytest packages/lsp-client/tests -v --browser chromium

# Worker packaging tests
uv run pytest packages/pyright-worker/tests -m unit -v

# All Pytest suites
uv run pytest -v
```

The Pytest fixtures start an ephemeral HTTP server automatically. Build the
worker with `npm run build:worker` before running browser tests that exercise
Pyright.
