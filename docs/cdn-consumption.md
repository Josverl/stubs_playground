# Reusing these components (CDN)

This repository prepares two independently versioned, framework-agnostic building
blocks for publication so other CodeMirror 6 editors — starting with
[Josverl/ViperIDE](https://github.com/Josverl/ViperIDE) — can embed in-browser
Python/MicroPython type checking without npm, a bundler, or a server.

| Component | What it is | Served from |
|-----------|------------|-------------|
| `@mp-codemirror/lsp-client` | Reusable LSP bridge for CodeMirror 6 (client, transport, diagnostics, completion, hover, markdown renderer) | `src/lsp/index.js` at tag `lsp-client-v<version>` |
| `@mp-codemirror/pyright-worker` | Pre-built Pyright Web Worker bundle (~9 MB) with typeshed + default MicroPython stubs inlined | `dist/pyright_worker.js` at tag `pyright-worker-v<version>` |

Distribution follows **Option B — CDN-only** from
[`component-reusability-plan.md`](./component-reusability-plan.md): consumers pin an
**immutable git tag** and load files through [jsDelivr](https://www.jsdelivr.com/).
No npm publishing is involved.

> **Publication status:** `lsp-client-v0.1.0` and `pyright-worker-v0.1.0` are published
> and verified through jsDelivr. The tagged-CDN browser harness passes without local
> component fallbacks.

The canonical CDN repository is **`Josverl/stubs_playground`**. Consumer URLs should
continue to use that owner/repository segment.

---

## 1. Versioning and tags

The two components version **independently**:

- `lsp-client-v0.1.0`, `lsp-client-v0.2.0`, … — pure source, tagged directly on the
  commit; no build step.
- `pyright-worker-v0.1.0`, … — the tag's tree additionally carries the built
  `dist/pyright_worker.js` (which is git-ignored on `main`).

Tags are **immutable** — a published version is never moved. Consumers should always
pin an exact tag, never a branch:

```
https://cdn.jsdelivr.net/gh/Josverl/stubs_playground@lsp-client-v0.1.0/src/lsp/index.js
https://cdn.jsdelivr.net/gh/Josverl/stubs_playground@pyright-worker-v0.1.0/dist/pyright_worker.js
```

### Cutting the first tags before merging

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
creates `lsp-client-v0.1.0` or `pyright-worker-v0.1.0`, then deletes its temporary
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

Verify the first tags before merging:

```bash
curl -fI \
  https://cdn.jsdelivr.net/gh/Josverl/stubs_playground@lsp-client-v0.1.0/src/lsp/index.js
curl -fI \
  https://cdn.jsdelivr.net/gh/Josverl/stubs_playground@pyright-worker-v0.1.0/dist/pyright_worker.js

MP_CODEMIRROR_CDN_CLIENT_TAG=lsp-client-v0.1.0 \
MP_CODEMIRROR_CDN_WORKER_TAG=pyright-worker-v0.1.0 \
uv run pytest \
  tests/test_cdn_harness.py::test_tagged_cdn_consumer_has_no_local_component_fallbacks \
  -v
```

The `assets/*.zip` stub/typeshed files are already committed on every tag, so they are
CDN-servable from the same tag:

```
https://cdn.jsdelivr.net/gh/Josverl/stubs_playground@pyright-worker-v0.1.0/assets/stubs-manifest.json
https://cdn.jsdelivr.net/gh/Josverl/stubs_playground@pyright-worker-v0.1.0/assets/stubs-esp32.zip
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

The library's runtime peers are `@codemirror/state`, `@codemirror/view`, and
`@codemirror/lint`; `@codemirror/autocomplete` is used through the language-data facet.
The versions below mirror those used by this app (`src/index.html`) and are known to
work together:

```html
<script type="importmap">
{
  "imports": {
    "@mp-codemirror/lsp-client": "https://cdn.jsdelivr.net/gh/Josverl/stubs_playground@lsp-client-v0.1.0/src/lsp/index.js",

    "@codemirror/state": "https://esm.sh/@codemirror/state@6.6.0",
    "@codemirror/view": "https://esm.sh/@codemirror/view@6.41.1?deps=@codemirror/state@6.6.0",
    "@codemirror/lint": "https://esm.sh/@codemirror/lint@6.9.5?deps=@codemirror/state@6.6.0,@codemirror/view@6.41.1",
    "@codemirror/autocomplete": "https://esm.sh/@codemirror/autocomplete@6.20.1?deps=@codemirror/language@6.12.3,@codemirror/state@6.6.0,@codemirror/view@6.41.1,@lezer/common@1.5.2",
    "@codemirror/language": "https://esm.sh/@codemirror/language@6.12.3?deps=@codemirror/state@6.6.0,@codemirror/view@6.41.1,@lezer/common@1.5.2"
  }
}
</script>
```

Public exports (see [`src/lsp/index.js`](../src/lsp/index.js) for the full surface):

- `SimpleLSPClient`, `WorkerTransport`, `createWorkerTransport`
- `createLSPClient`, `createLSPPlugin`, `switchBoard`, `isLSPReady`
- Diagnostics: `createLSPDiagnostics`, `notifyDocumentOpen`, `notifyDocumentChange`,
  `removeWorkspaceDiagnosticsFor`, `getWorkspaceDiagnostics`, `requestDiagnostics`
- Completion: `createCompletionSource`, plus pure helpers from `completion-core.mjs`
- Hover: `createHoverTooltip`
- Markdown/RST rendering: `renderMarkdown`, `processInline`, `renderBlocks`

> `worker-config.js` is intentionally **not** part of the public module graph — its
> worker URL auto-detection is specific to this app's directory layout. Consumers
> must pass an explicit `workerUrl` (see §3).

---

## 3. `@mp-codemirror/pyright-worker` — cross-origin worker

The worker is a **classic** worker started with `new Worker(url)`. Browsers block
constructing a `Worker` from a **cross-origin** script URL, so a CDN-hosted worker
cannot be passed directly. Wrap it in a same-origin
[`Blob`](https://developer.mozilla.org/en-US/docs/Web/API/Blob) that `importScripts()`
the real CDN URL, then pass the resulting object URL to `createTransport`/`createLSPClient`:

```js
const WORKER_CDN_URL =
  'https://cdn.jsdelivr.net/gh/Josverl/stubs_playground@pyright-worker-v0.1.0/dist/pyright_worker.js';

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
[`src/worker/messages.ts`](../src/worker/messages.ts) and published for consumers as
[`src/worker/messages.d.ts`](../src/worker/messages.d.ts). Anyone implementing a custom
worker for a different language server can conform to that contract and remain
drop-in compatible with `WorkerTransport`.

---

## 4. Stubs and typeshed

The worker bundle **inlines** Pyright's typeshed fallback and the default MicroPython
stubs (RP2), so a minimal single-board setup needs **no extra network fetches** beyond
the worker itself.

To offer board switching (ESP32, STM32, CircuitPython, SAMD, …):

1. Fetch the manifest to discover available boards and their zip filenames:
   ```
   https://cdn.jsdelivr.net/gh/Josverl/stubs_playground@pyright-worker-v0.1.0/assets/stubs-manifest.json
   ```
2. Fetch the selected board's zip as an `ArrayBuffer`:
   ```
   https://cdn.jsdelivr.net/gh/Josverl/stubs_playground@pyright-worker-v0.1.0/assets/stubs-<board>.zip
   ```
3. Supply it via `createTransport({ boardStubs })` / `createLSPClient({ boardStubs })`,
   or call `switchBoard(current, { …, boardStubs })` to rebuild the worker with the new
   stubs.

Pass `boardStubs: false` for a CPython-only (no MicroPython stubs) configuration.

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
      onDiagnosticsChange: (diags) => console.log('diagnostics', diags),
    }),
  ),
});
```

See [`src/app.js`](../src/app.js) for a complete integration (board switching, multi-file
workspace, status bar) and [`tests/cdn-harness.html`](../tests/cdn-harness.html) for a
minimal standalone harness that loads only the public API.

---

## 6. Upgrade path

CDN-only is the zero-maintenance starting point. If external consumers later need
semver resolution and bundler/toolchain integration, publish the same two packages to
npm (**Option A** in [`component-reusability-plan.md`](./component-reusability-plan.md)).
The public surface (`src/lsp/index.js`) and the worker protocol
(`src/worker/messages.ts`) are designed to remain the contract in either model.
