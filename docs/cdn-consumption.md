# Reusing these components (CDN)

This repository prepares two independently versioned, framework-agnostic building
blocks so standalone CodeMirror 6 editors can embed in-browser Python/MicroPython
type checking without npm, a bundler, or a server.

| Component | What it is | Served from |
|-----------|------------|-------------|
| `@mp-codemirror/lsp-client` | Reusable LSP bridge for CodeMirror 6 (client, transport, diagnostics, completion, hover, markdown renderer) | `packages/lsp-client/src/index.js` at tag `lsp-client-v<version>` |
| `@mp-codemirror/pyright-worker` | Pre-built Pyright Web Worker bundle (~9 MB) with typeshed + default MicroPython stubs inlined | `packages/pyright-worker/dist/pyright_worker.js` at tag `pyright-worker-v<version>` |

The currently published v0.2.1 artifacts follow **Option B — CDN-only** from the
[`component-reusability-plan.md`](https://github.com/Josverl/stubs_playground/blob/integrate/docs/component-reusability-plan.md):
consumers pin an
**immutable git tag** and load files through [jsDelivr](https://www.jsdelivr.com/).
No npm publishing is involved in that release.

> **Publication status:** `lsp-client-v0.2.1` and `pyright-worker-v0.2.1` are published
> and verified through jsDelivr. The tagged-CDN browser harness passes without local
> component fallbacks.

The canonical CDN repository is **`Josverl/stubs_playground`**. Consumer URLs should
continue to use that owner/repository segment.

---

## 1. Versioning and tags

The two components version **independently**:

- `lsp-client-v0.2.1`, `lsp-client-v0.3.0`, … — pure source, tagged directly on the
  commit; no build step.
- `pyright-worker-v0.2.1`, … — the tag's tree additionally carries the built
  `packages/pyright-worker/dist/pyright_worker.js` (which is git-ignored on `main`).

Tags are **immutable** — a published version is never moved. Consumers should always
pin an exact tag, never a branch:

```
https://cdn.jsdelivr.net/gh/Josverl/stubs_playground@lsp-client-v0.2.1/packages/lsp-client/src/index.js
https://cdn.jsdelivr.net/gh/Josverl/stubs_playground@pyright-worker-v0.2.1/packages/pyright-worker/dist/pyright_worker.js
```

### Cutting tags before merging

GitHub only permits `workflow_dispatch` after a workflow exists on the default branch.
For the first pre-merge release, check out the feature branch with a clean worktree and
run:

```bash
just release-cdn-lsp-client
just release-cdn-pyright-worker
```

Each recipe reads the version from the component manifest and pushes the current commit
directly as a temporary request tag without creating a local tag. Each request tag then
runs the workflow from that exact commit. On success, the workflow
creates the immutable tag matching the component manifest, then deletes its temporary
`cdn-release/...` request tag. If a run fails before cleanup, delete that request tag
from the remote before retrying it:

```bash
git push origin --delete cdn-release/<component>/<version>
```

Request-tag deletion events are ignored by the release job.

After this workflow reaches the default branch, future releases can instead use
**Actions → Release CDN component → Run workflow** and select any branch explicitly.

Both paths verify that the requested version matches the selected commit's component
manifest and record the source ref and commit in the run summary. The resulting
component tags are permanent releases: do not delete or move them after verification.
If verification fails, fix the branch, bump the affected component version, and cut a
new immutable component tag.

Verify the current tags before merging with:

```bash
curl -fI \
  https://cdn.jsdelivr.net/gh/Josverl/stubs_playground@lsp-client-v0.2.1/packages/lsp-client/src/index.js
curl -fI \
  https://cdn.jsdelivr.net/gh/Josverl/stubs_playground@pyright-worker-v0.2.1/packages/pyright-worker/dist/pyright_worker.js

MP_CODEMIRROR_CDN_CLIENT_TAG=lsp-client-v0.2.1 \
MP_CODEMIRROR_CDN_WORKER_TAG=pyright-worker-v0.2.1 \
uv run pytest \
  packages/lsp-client/tests/test_public_consumer.py::test_tagged_cdn_consumer_has_no_local_component_fallbacks \
  -v
```

The worker package's `assets/*.zip` stub/typeshed files are committed on every tag, so they are
CDN-servable from the same tag:

```
https://cdn.jsdelivr.net/gh/Josverl/stubs_playground@pyright-worker-v0.2.1/packages/pyright-worker/assets/stubs-manifest.json
https://cdn.jsdelivr.net/gh/Josverl/stubs_playground@pyright-worker-v0.2.1/packages/pyright-worker/assets/stubs-esp32.zip
```

### Why not GitHub Release assets?

jsDelivr's `/gh/` endpoint serves files from the **repository tree at a tag**, not
binary assets attached to a GitHub Release. Release-asset URLs
(`github.com/<owner>/<repo>/releases/download/…`) bypass jsDelivr entirely, losing its
CDN caching and versioned URL shape. That is why the worker bundle is committed onto a
dedicated tag rather than uploaded as a release asset.

---

## 2. `@mp-codemirror/lsp-client` — import map + peer dependencies

The library imports bare `@codemirror/*` specifiers and does **not** bundle them, so
the consuming page supplies them via an [import map](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/script/type/importmap).
Pin the same CodeMirror versions the host editor uses to avoid duplicate singletons of
`@codemirror/state` / `@codemirror/view`.

> **Bundled hosts such as ViperIDE:** do not use this browser import-map path alongside
> a separately bundled CodeMirror installation. Instead, have Rollup fetch the exact
> immutable client tag at build time. A restricted HTTPS-module loader resolves relative
> imports on that tag, while bare `@codemirror/*` imports fall through to
> `@rollup/plugin-node-resolve` and resolve from the host's lockfile. This produces one
> CodeMirror module graph without npm publication or vendoring. The pre-built worker
> continues to use the pinned CDN + Blob-shim flow below. See the ViperIDE review in
> [`component-reusability-plan.md`](https://github.com/Josverl/stubs_playground/blob/integrate/docs/component-reusability-plan.md#7-viperide-integration-review-2026-08-05).

The loader must restrict remote IDs to the configured jsDelivr repository and immutable
`lsp-client-v*` tag, fail on HTTP/content errors, and be covered by a production-build
test. Builds need network access unless CI supplies and verifies a cache of those exact
immutable responses.

The library's runtime peers are `@codemirror/state`, `@codemirror/view`, and
`@codemirror/lint`; `@codemirror/autocomplete` is used through the language-data facet.
The versions below mirror those used by this app (`apps/playground/index.html`) and are known to
work together:

```html
<script type="importmap">
{
  "imports": {
    "@mp-codemirror/lsp-client": "https://cdn.jsdelivr.net/gh/Josverl/stubs_playground@lsp-client-v0.2.1/packages/lsp-client/src/index.js",

    "@codemirror/state": "https://esm.sh/@codemirror/state@6.6.0",
    "@codemirror/view": "https://esm.sh/@codemirror/view@6.41.1?deps=@codemirror/state@6.6.0",
    "@codemirror/lint": "https://esm.sh/@codemirror/lint@6.9.5?deps=@codemirror/state@6.6.0,@codemirror/view@6.41.1",
    "@codemirror/autocomplete": "https://esm.sh/@codemirror/autocomplete@6.20.1?deps=@codemirror/language@6.12.3,@codemirror/state@6.6.0,@codemirror/view@6.41.1,@lezer/common@1.5.2",
    "@codemirror/language": "https://esm.sh/@codemirror/language@6.12.3?deps=@codemirror/state@6.6.0,@codemirror/view@6.41.1,@lezer/common@1.5.2"
  }
}
</script>
```

Public exports (see
[`packages/lsp-client/src/index.js`](../packages/lsp-client/src/index.js) for the full
surface):

- `SimpleLSPClient`, `WorkerTransport`, `createWorkerTransport`
- `WorkerTransport.syncWorkspaceFile`, `WorkerTransport.deleteWorkspaceFile`
- Stub packages: `WorkerTransport.listStubPackages`, `installStubPackage`,
  `listInstalledStubPackages`, `clearStubPackages`
- `createLSPClient`, `createLSPPlugin`, `switchBoard`, `isLSPReady`
- Diagnostics: `createLSPDiagnostics`, `notifyDocumentOpen`, `notifyDocumentChange`,
  `notifyDocumentClose`, `createWorkspaceDiagnosticsSubscription`,
  `removeWorkspaceDiagnosticsFor`, `getWorkspaceDiagnostics`, `requestDiagnostics`,
  `lintKeymapExtension`
- Completion: `createCompletionSource`, plus pure helpers from `completion-core.mjs`
- Hover: `createHoverTooltip`
- Markdown/RST rendering: `renderMarkdown`, `processInline`, `renderBlocks`

Consumers must pass an explicit `workerUrl` (see §3); package code does not infer an
application-specific directory layout.

`createLSPClient` checks opened files by default. To type-check every preloaded Python
file, request workspace mode and use the client-level callback, which also reports files
without a CodeMirror editor:

```js
const result = await createLSPClient({
  workerUrl,
  diagnosticMode: 'workspace',
  workspaceFiles: {
    'main.py': 'from lib.helpers import answer\n',
    'lib/helpers.py': 'answer: int = "invalid"\n',
  },
  onWorkspaceDiagnosticsChange: (diagnostics) => {
    console.log('workspace diagnostics', diagnostics);
  },
});
```

Keep `result.workspaceDiagnosticsSubscription` with the client result and destroy it
during custom teardown. `switchBoard` carries out that cleanup automatically when the
complete prior result is supplied.

---

## 3. `@mp-codemirror/pyright-worker` — cross-origin worker

The worker is a **classic** worker started with `new Worker(url)`. Browsers block
constructing a `Worker` from a **cross-origin** script URL, so a CDN-hosted worker
cannot be passed directly. Wrap it in a same-origin
[`Blob`](https://developer.mozilla.org/en-US/docs/Web/API/Blob) that `importScripts()`
the real CDN URL, then pass the resulting object URL to `createTransport`/`createLSPClient`:

```js
const WORKER_CDN_URL =
  'https://cdn.jsdelivr.net/gh/Josverl/stubs_playground@pyright-worker-v0.2.1/packages/pyright-worker/dist/pyright_worker.js';

// Same-origin shim so the browser allows constructing the Worker.
function makeSameOriginWorkerUrl(remoteUrl) {
  const shim = `importScripts(${JSON.stringify(remoteUrl)});`;
  return URL.createObjectURL(new Blob([shim], { type: 'application/javascript' }));
}

const workerUrl = makeSameOriginWorkerUrl(WORKER_CDN_URL);
```

Remember to `URL.revokeObjectURL(workerUrl)` when you tear the editor down.

The worker's main-thread ↔ worker control-plane protocol
(`serverLoaded` / `initServer` / `serverInitialized`, file sync, debug messages) is the
stable contract, defined in
[`packages/pyright-worker/src/messages.ts`](../packages/pyright-worker/src/messages.ts)
and published for consumers as
[`packages/pyright-worker/src/messages.d.ts`](../packages/pyright-worker/src/messages.d.ts).
Anyone implementing a custom
worker for a different language server can conform to that contract and remain
drop-in compatible with `WorkerTransport`.

Consumers synchronize project mutations through
`WorkerTransport.syncWorkspaceFile(path, content)` and
`WorkerTransport.deleteWorkspaceFile(path)`. Both accept workspace-relative forward-slash
paths and hide the worker control-plane `postMessage` details.

---

## 4. Stubs and typeshed

The worker bundle **inlines** Pyright's typeshed fallback and a set of  MicroPython stubs, so a minimal single-board setup needs **no extra network fetches** beyond the worker itself.

To offer port/board switching (ESP32, STM32, CircuitPython, SAMD, …):

1. Fetch the manifest to discover available boards and their zip filenames:
   ```
   https://cdn.jsdelivr.net/gh/Josverl/stubs_playground@pyright-worker-v0.2.1/packages/pyright-worker/assets/stubs-manifest.json
   ```
2. Fetch the selected board's zip as an `ArrayBuffer`:
   ```
   https://cdn.jsdelivr.net/gh/Josverl/stubs_playground@pyright-worker-v0.2.1/packages/pyright-worker/assets/stubs-<board>.zip
   ```
3. Supply it via `createTransport({ boardStubs })` / `createLSPClient({ boardStubs })`,
   or call `switchBoard(current, { …, boardStubs })` to rebuild the worker with the new
   stubs.

Pass `boardStubs: false` for a CPython-only (no MicroPython stubs) configuration.

### Runtime PyPI stub packages

The worker keeps discoverable MicroPython package identities in
`assets/stub-package-catalog.json`; versions are queried from PyPI at runtime:

```js
const packages = await transport.listStubPackages();
const esp32 = packages.find(pkg => pkg.id === 'esp32');
await transport.installStubPackage(
  esp32.packageName,
  `==${esp32.latestVersion}`,
);
```

Installs are validated as type-only universal wheels and persisted in IndexedDB.
Clients may also install an unlisted type-only wheel by package name and version. Unlisted
dependencies are not downloaded; bundled typeshed continues to supply standard dependency types.
Unlisted MicroPython board/port packages and CircuitPython are rejected because they require an
explicit board target rather than a global extra path.
Restart the worker after a cache change. To prefer the active cached version for a
board while keeping the bundled archive as an offline fallback, pass:

```js
{
  boardStubsUrl: 'https://cdn.example/stubs-esp32.zip',
  boardStubPackage: {
    packageName: 'micropython-esp32-stubs',
    fallbackToBundled: true,
  },
}
```

---

## 5. Minimal end-to-end example

```js
import { EditorView, basicSetup } from 'https://esm.sh/codemirror@6.0.1';
import { Compartment } from '@codemirror/state';
import { python } from '@codemirror/lang-python'; // add to the import map too
import { createLSPClient, createLSPPlugin } from '@mp-codemirror/lsp-client';

const workerUrl = makeSameOriginWorkerUrl(WORKER_CDN_URL); // from §3

const { client, pyrightVersion } = await createLSPClient({ workerUrl });

const lspCompartment = new Compartment();
const view = new EditorView({
  doc: 'import machine\nled = machine.Pin(2, machine.Pin.OUT)\n',
  parent: document.querySelector('#editor'),
  extensions: [basicSetup, python(), lspCompartment.of([])],
});

view.dispatch({
  effects: lspCompartment.reconfigure(
    createLSPPlugin(client, view, {
      fileUri: 'file:///workspace/main.py',
      initialContent: view.state.doc.toString(),
      diagnosticDelayMs: 750, // keep completion current while hiding transient typing errors
      onDiagnosticsChange: (diags) => console.log('diagnostics', diags),
    }),
  ),
});
```

See [`apps/playground/app.js`](../apps/playground/app.js) for a complete integration
(board switching, multi-file workspace, status bar),
[`apps/playground/component-source.js`](../apps/playground/component-source.js) for the
local/CDN boundary, and
[`packages/lsp-client/tests/consumer-harness.html`](../packages/lsp-client/tests/consumer-harness.html)
for a minimal standalone harness that loads only the public API. The playground pins both
component versions as exact dependencies in `apps/playground/package.json`. Run
`npm run generate:component-config` after changing those dependencies; CI rejects a
stale generated browser configuration.

---

## 6. Upgrade path

Immutable CDN tags are the sole selected distribution architecture. Unbundled consumers
load the client through an import map; bundled consumers fetch the same tagged source
during their build and resolve bare peer imports locally. The worker remains an
independently pinned CDN artifact.
The public surface (`packages/lsp-client/src/index.js`) and the worker protocol
(`packages/pyright-worker/src/messages.ts`) are designed to remain the contract in
either model.
