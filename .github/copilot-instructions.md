# Agent Instructions: CodeMirror MicroPython Playground

Be factual rather than overly optimistic, and use icons sparingly.

## Project and workflow

This npm workspace contains a static CodeMirror 6 playground and two reusable
browser packages. Pyright runs entirely in a classic Web Worker; no language
server or application backend is required. Keep the application deployable as
static files unless an accepted architecture decision explicitly changes that.

This repository uses Beads for durable work tracking:

```bash
bd prime
bd ready
bd show <id>
bd update <id> --claim
bd close <id>
```

Do not create markdown task lists or memory files. The default profile is
conservative: do not commit, push, or run `bd dolt push` without explicit
authorization.

## Setup, build, and serve

Use `uv` for Python environments and packages, npm workspaces for JavaScript,
and `just` for composed repository workflows.

```bash
just setup                         # npm + Python test deps, Chromium, assets, worker
just build                         # component config, typeshed/stubs, production worker
just build-dev                     # unminified worker; run just build before release
just docs                          # Sphinx HTML documentation
just stage-pages                   # validate and create deploy/ static tree

just serve local                   # workspace client/worker, port 8888-8987
just serve npm                     # exact published npm versions through jsDelivr
just http                          # plain repository server on port 8888
```

Useful focused build commands:

```bash
npm run build:worker
npm run build:typeshed
just pack-stubs
npm run generate:component-config
```

The generated worker bundle is tracked. `just build-dev` overwrites it with a
development build, so restore the production artifact with `just build`.

## Tests, types, and formatting

Tests live with their owner:

- `apps/playground/tests/`: application behavior and public package integration.
- `packages/lsp-client/tests/`: package unit and standalone browser tests; never
  import or load the playground.
- `packages/pyright-worker/tests/`: worker protocol, packaging, and startup tests.
- `tests/`: shared application-neutral Pytest fixtures, timing, and HTTP server.

Run the smallest owning suite:

```bash
npm run test:unit
npm run test:app:unit
npm run test:lsp-client:unit
npm run test:pyright-worker:unit

uv run pytest apps/playground/tests -v --browser chromium
uv run pytest packages/lsp-client/tests -v --browser chromium
uv run pytest packages/pyright-worker/tests -m unit -v
uv run pytest -v
```

Build `packages/pyright-worker/dist/pyright_worker.js` before browser tests that
exercise Pyright. CI runs application and component browser suites separately
on Chromium, Firefox, and WebKit.

Run a single test:

```bash
uv run pytest apps/playground/tests/test_editor.py::test_editor_container_exists -v --browser chromium
uv run pytest packages/pyright-worker/tests/test_pack_stubs.py::test_paths_resolve_from_worker_package -v
node --test apps/playground/tests/test_share_settings.unit.mjs
node --test --test-name-pattern="computeCompletionFrom starts after last dot" packages/lsp-client/tests/test_completion.unit.mjs
```

For browser failures and important successful UI scenarios, use Playwright and
retain the required screenshots under `results/`.

There is no aggregate lint recipe. Use the existing checks relevant to the
change:

```bash
uv run ruff check apps/playground/tests packages/pyright-worker tests
just format
npm run check:test-boundaries
npm run check:component-config
npm run check:worker-protocol-types
npm run build:types --workspace @mp-codemirror/lsp-client
```

`just format` currently formats only `tests/`; format package-owned Python tests
explicitly when changing them.

## Architecture

### Application boundary

`apps/playground/app.js` owns UI, editor/document lifecycle, OPFS persistence,
board selection, sharing, and application policy. It imports reusable behavior
only through `apps/playground/component-source.js`. That module selects local
workspace files or exact npm CDN versions while presenting one public package
API to the application.

`apps/playground/component-config.generated.js` is generated from the three
package manifests. The playground dependencies must use exact versions matching
the workspace package versions; change manifests and run
`npm run generate:component-config` rather than editing the generated file.

### LSP client boundary

`@mp-codemirror/lsp-client` is JavaScript with JSDoc types and generated
declarations. `src/index.js` is the supported public surface; consumers and
application tests must not import package internals. `SimpleLSPClient` handles
standard JSON-RPC/LSP, while `WorkerTransport` owns the Pyright worker-specific
control protocol. Diagnostics data is library-owned, but DOM status rendering
is application-owned.

When changing a public JSDoc signature, regenerate and commit
`packages/lsp-client/types/`. Its package test checks declaration drift and a
real TypeScript consumer import.

### Worker boundary

`@mp-codemirror/pyright-worker` bundles Pyright, ZenFS, compatible typeshed, and
worker glue. Webpack aliases Node filesystem APIs to ZenFS. The worker mounts
`/workspace`, `/typings`, `/extra`, `/typeshed-fallback`, and
`/typeshed-micropython`, then forwards standard LSP messages over `postMessage`.
Board switching replaces the worker and requires documents to be reopened.

`packages/pyright-worker/src/messages.ts` is the source of truth for the custom
main-thread/worker protocol. Keep the committed `messages.d.ts` byte-equivalent
to generated declarations; `npm run check:worker-protocol-types` enforces this.

Stub releases may be discovered and installed from PyPI into IndexedDB at
runtime. Catalog identity metadata and fallback ZIP assets are separate
concerns. Consult `docs/architecture.md` before changing runtime, catalog,
fallback, caching, integrity, or compatibility boundaries.

### Static distribution

GitHub Pages staging includes the playground plus both package source/type or
worker/asset trees. The client and worker are independently versioned npm
packages. Bundled consumers install exact package versions; unbundled consumers
use immutable npm CDN URLs. A cross-origin classic worker uses a same-origin
Blob shim containing `importScripts`.

## Repository-specific conventions

- Application tests exercise packages through the public application boundary;
  package tests must remain independent. Run `npm run check:test-boundaries`
  after moving imports or fixtures.
- Keep CodeMirror packages as peer dependencies of the LSP client so hosts use
  one CodeMirror module graph.
- LSP document URIs live below `file:///workspace`; worker file operations use
  validated workspace-relative paths and complete file contents.
- Synchronize document changes immediately when completion or hover correctness
  depends on them. Diagnostic presentation may be delayed separately and must
  reject stale document ranges.
- A worker replacement must replay mirrored workspace files and rebind every
  open document. Open unsaved editor text wins over persisted/device content.
- Stub board packages mount at `/typings`; generic type-only packages mount
  below `/extra` and must not leak across board selections.
- Validate remote package/archive origins, paths, counts, and byte limits before
  persistence or mounting. Surface failures; do not silently turn them into
  successful empty results.
- Keep package versions in package manifests and lockfiles, not duplicated in
  application source. Package release tags and published versions are immutable.
- Update API and architecture documentation when public contracts, worker
  messages, mount behavior, or distribution boundaries change.
