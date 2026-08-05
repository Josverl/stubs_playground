# Component Reusability Plan

This document analyses the current codebase from the perspective of re-use by other CodeMirror editor
projects, proposes a stable public API for the most portable components, explains the distribution
strategy, and lists the refactoring work needed inside this repository to support it.

The first CDN releases are published. This document now records both the original analysis and the
implemented workspace/package boundaries.

> **Revision history:**
> - *Initial version* — created after commit `7505f65`.
> - *May 2025 update* — reviewed against `HEAD` (post `9a35f9cc`). Updated tier
>   classifications (`hover.js` / `markdown-renderer.js` split, `diagnostics.js` scope increase,
>   `share.js` growth), revised API signatures (`createLSPPlugin` options, new diagnostic exports,
>   `isDunderLabel`, `renderMarkdown`), added tasks 4.8 (share.js decomposition) and 4.9
>   (extract markdown renderer from hover.js), and added status column to the summary checklist.
> - *August 2026 update* — moved the application to `apps/playground`, moved reusable
>   components to `packages/lsp-client` and `packages/pyright-worker`, and made the real
>   application switch between workspace and immutable CDN sources.
> - *August 2026 ViperIDE review* — reviewed ViperIDE commits through upstream
>   `3a5a331` (v0.6.2). Defined a single immutable-CDN distribution model: Rollup
>   consumes the tagged client source at build time and resolves CodeMirror imports from
>   ViperIDE, while the browser loads the tagged worker artifact at runtime. Also added
>   lifecycle and workspace-sync prerequisites for ViperIDE's multi-tab architecture.

---

## 1. Which components are most likely to be re-used?

The project can be split into three tiers:

### Tier 1 — Highly portable (language-agnostic LSP bridge)

These modules work with **any** LSP server (not just Pyright) and have **no DOM dependencies**
(or render-only DOM usage that does not query external elements).
They are the most attractive pieces for other editors.

| Module | What it does | DOM deps | LSP-server-specific |
|--------|-------------|----------|---------------------|
| `packages/lsp-client/src/simple-client.js` | JSON-RPC 2.0 LSP client, transport-agnostic | None | No |
| `packages/lsp-client/src/worker-transport.js` | Bridges a Web Worker behind a simple subscribe/send interface | None | Yes (Pyright handshake) |
| `packages/lsp-client/src/transport-factory.js` | One-liner factory for `WorkerTransport` | None | Yes |
| `packages/lsp-client/src/completion-core.mjs` | Pure LSP→CodeMirror completion conversion helpers (incl. `isDunderLabel`) | None | No |
| `packages/lsp-client/src/completion.js` | CodeMirror autocompletion source driven by LSP | None | No |
| `packages/lsp-client/src/hover.js` | CodeMirror hover-tooltip source driven by LSP | Render-only | No |
| `packages/lsp-client/src/markdown-renderer.js` | Markdown/RST→DOM renderer (`renderMarkdown`, `processInline`, `renderBlocks`) | Render-only | No |

> **`hover.js` / `markdown-renderer.js` split:** `hover.js` grew to ~530 lines because it
> contains both the CodeMirror tooltip integration *and* a full Markdown/RST renderer. These
> are independent concerns — the renderer is reusable anywhere that needs to display
> Markdown/RST content as DOM, while the tooltip source is CodeMirror-specific.
> Task 4.9 tracks extracting the renderer into `packages/lsp-client/src/markdown-renderer.js`.

### Tier 2 — Useful but have DOM coupling that needs refactoring

| Module | DOM coupling | Path to re-use |
|--------|-------------|----------------|
| `packages/lsp-client/src/diagnostics.js` | Formerly mixed reusable state with playground DOM updates. | Implemented as a reusable data layer; status rendering now lives in the application. |
| `packages/lsp-client/src/client.js` (`createLSPPlugin`) | Formerly wrote to `window.lspClients`. | Global removed; callers own returned state. |
| `apps/playground/events.js` | Dispatches `CustomEvent` on `document` | Thin application utility; low re-use value on its own |

### Tier 3 — Application-specific (low re-use value outside this app)

| Module | Reason |
|--------|--------|
| `apps/playground/ui/file-tree.js` | Tightly coupled to `OPFSProject`; very specific UI decisions |
| `apps/playground/ui/tab-bar.js` | App-level tab management; small and easy to copy |
| `apps/playground/storage/opfs-project.js` | OPFS wrapper useful as a standalone library but not CodeMirror-specific |
| `apps/playground/editor/document-manager.js` | Multi-doc state manager; re-usable in pattern but coupled to `OPFSProject` and `Events`. Positive note: `onActiveChange()` already returns an unsubscribe function, matching the CodeMirror convention. |
| `apps/playground/share.js` | Compatibility facade over `share-core.js` and `share-ui.js`; remains application-specific. |
| `apps/playground/app.js` | Application entry point; not re-usable |
| `packages/pyright-worker/src/pyright-worker.ts` | Pyright-specific; only changes with Pyright upstream |

---

## 2. Proposed stable public API

The goal is to follow **CodeMirror 6's own plugin conventions**: factory functions return
`Extension` arrays or objects; the caller decides how to compose them.

### 2.1 Package boundary

Two logical packages emerge naturally:

```
@mp-codemirror/lsp-client    (Tier 1 + cleaned Tier 2 — reusable LSP bridge)
@mp-codemirror/pyright-worker (Pyright Web Worker bundle — built artefact)
```

The rest of the application (`app.js`, `ui/`, `storage/`, `share.js`) stays in this repo and is
**not** published.

---

### 2.2 `@mp-codemirror/lsp-client`

#### Transport interface (already stable)

Any transport must satisfy:

```ts
interface LSPTransport {
  connect(): Promise<void>;
  send(message: string): void;
  subscribe(handler: (message: string) => void): void;
  unsubscribe(handler: (message: string) => void): void;
  close(): void;
  isConnected(): boolean;
}
```

`WorkerTransport` already implements this. A future `WebSocketTransport` would implement the same
interface, letting callers swap transports without changing any other code.

#### `SimpleLSPClient` (already mostly stable)

Minor additions needed:

```ts
class SimpleLSPClient {
  constructor(config?: LSPClientConfig);
  connect(transport: LSPTransport): Promise<SimpleLSPClient>;
  disconnect(): void;
  request(method: string, params: unknown): Promise<unknown>;
  notify(method: string, params: unknown): void;
  onNotification(handler: (method: string, params: unknown) => void): () => void;
  onRequest(method: string, handler: (params: unknown) => unknown): void;
  readonly serverCapabilities: object | null;
  readonly connected: boolean;
}
```

The only missing piece is that `onNotification` currently does not return an unsubscribe function.
That is a small, non-breaking addition.

#### High-level factory functions

```ts
// Creates transport + client and returns them both.
async function createLSPClient(config: LSPClientConfig): Promise<{
  client: SimpleLSPClient;
  transport: LSPTransport;
  pyrightVersion: string;
}>;

// Returns a CodeMirror Extension array for one open document.
// No side-effects on window.* or DOM.
function createLSPPlugin(
  client: SimpleLSPClient,
  view: EditorView,
  options?: LSPPluginOptions,
): Extension[];

// Tears down the current LSP and creates a fresh one (e.g., board switch).
async function switchBoard(
  current: { client: SimpleLSPClient; transport: LSPTransport },
  config: LSPClientConfig,
): Promise<{ client: SimpleLSPClient; transport: LSPTransport }>;

function isLSPReady(client: SimpleLSPClient): boolean;
```

`LSPPluginOptions`:

```ts
interface LSPPluginOptions {
  fileUri?: string;          // default: 'file:///workspace/document.py'
  languageId?: string;       // default: 'python'
  initialContent?: string;   // default: ''
  pyrightVersion?: string;   // shown in status; optional
  stubsStatusSource?: string; // stub label source for diagnostics; optional
  // Called when diagnostics change; replaces the current DOM coupling.
  onDiagnosticsChange?: (diagnostics: CmDiagnostic[]) => void;
}
```

`onDiagnosticsChange` decouples the library from the application's status bar entirely.

#### Diagnostic utilities (pure)

```ts
// Document lifecycle — no DOM.
function notifyDocumentOpen(client, uri, languageId, content, version?): void;
function notifyDocumentChange(client, uri, content, version?): void;
function notifyDocumentClose(client, uri): void;

// Workspace-level diagnostic cache (pure data, no DOM).
function removeWorkspaceDiagnosticsFor(fileUri: string): void;
function getWorkspaceDiagnostics(): Diagnostic[];
function requestDiagnostics(client, fileUri, documentText): Promise<Diagnostic[]>;
```

#### Completion utilities (pure, already exported)

```ts
// Conversion helpers — no DOM, no LSP client dependency.
function kindToType(kind: number): string;
function isDunderLabel(label: string): boolean;
function convertCompletionItem(item: LSPCompletionItem): Completion;
function dedupeAndSortCompletionOptions(options: Completion[]): Completion[];
function computeCompletionFrom(word: { text: string; from: number }): number;

// CodeMirror extension factory.
function createCompletionSource(
  client: SimpleLSPClient,
  documentUri: string,
  options?: { autoTriggerDelayMs?: number },
): CompletionSource;
```

#### Markdown/RST renderer (render-only DOM)

Extracted into `packages/lsp-client/src/markdown-renderer.js` (see task 4.9):

```ts
// Renders Markdown/RST text (with Pyright signature detection) to a DOM element.
function renderMarkdown(text: string): HTMLElement;

// Lower-level helpers, also exported for direct use:
function processInline(text: string): DocumentFragment;
function renderBlocks(text: string, container: HTMLElement): void;
```

#### Hover tooltip (CodeMirror integration)

```ts
function createHoverTooltip(
  client: SimpleLSPClient,
  documentUri: string,
): Extension;
```

`hover.js` imports `renderMarkdown` from `markdown-renderer.js` and focuses solely on the
CodeMirror tooltip lifecycle (LSP request, range mapping, tooltip creation).

---

### 2.3 `@mp-codemirror/pyright-worker` (built artifact)

This is the compiled `packages/pyright-worker/dist/pyright_worker.js` published through
an immutable component tag, so consumers reference the built file directly:

```js
const workerUrl =
  'https://cdn.jsdelivr.net/gh/Josverl/stubs_playground@pyright-worker-v0.2.0/packages/pyright-worker/dist/pyright_worker.js';
```

The worker's internal control-plane protocol (`serverLoaded` / `initServer` / `serverInitialized`)
is documented in `packages/pyright-worker/src/messages.ts`; that file is the public contract and is
be published as TypeScript declarations.

---

## 3. How to share components with projects outside this repo's control

### Option A: npm (not selected)

Publishing these components to npm would add a second release workflow, registry metadata, and
consumer path for the same integration goal. The packages are not being presented as
production-ready npm packages, and ViperIDE will not depend on this option. No npm publication work
is planned.

### Option B: immutable CDN tags (selected)

Point consumers at `esm.sh` or `jsDelivr` directly from the GitHub repo (using a tag):

```html
<script type="importmap">
{
  "imports": {
    "@mp-codemirror/lsp-client": "https://cdn.jsdelivr.net/gh/Josverl/stubs_playground@lsp-client-v0.2.0/packages/lsp-client/src/index.js"
  }
}
</script>
```

For an unbundled browser app, import the URL through an import map as shown above. For a bundled
host such as ViperIDE, a small Rollup HTTPS-module loader fetches the same tagged source graph at
build time. Relative imports stay on the immutable tag; bare imports such as
`@codemirror/state`, `@codemirror/view`, and `@codemirror/lint` fall through to
`@rollup/plugin-node-resolve` and are resolved from the host's `node_modules`.

**Pros:**
- One release and distribution architecture for both bundled and unbundled consumers.
- No npm publication or package-registry maintenance.
- ViperIDE gets one CodeMirror module graph from its own lockfile.
- Exact immutable tags keep client and worker inputs reproducible.

**Cons:**
- ViperIDE's build needs network access to jsDelivr unless CI provides a validated cache.
- Rollup needs a small, tested HTTPS-module loader because it does not fetch remote modules itself.
- There is no semver resolver; upgrades are explicit tag changes.

### Option C: Copy-paste / vendoring (not selected)

Consumers copy the `packages/lsp-client/src/` directory directly. This works but offers no upgrade
path and no formal contract. ViperIDE will not use this option.

### Recommendation

Use **Option B only**. Keep publishing the client source, worker, and stub assets through immutable
component tags and jsDelivr.

ViperIDE's Rollup build must fetch the tagged client source graph and then resolve its bare
CodeMirror imports from ViperIDE's installed dependencies. This is different from dynamically
importing the client in the browser: build-time ingestion lets Rollup include the client and
ViperIDE's CodeMirror modules in one IIFE and therefore preserves one
`@codemirror/state` / `@codemirror/view` identity set. The worker remains a pinned CDN runtime
artifact loaded through the documented same-origin Blob shim.

This approach was probed against ViperIDE's current lockfile. The client resolved to ViperIDE's
`@codemirror/state@6.4.1`, `@codemirror/view@6.28.5`, and `@codemirror/lint@6.8.1`; Rollup produced
an IIFE with no remaining bare CodeMirror import. No npm publication or vendored client copy is
part of the plan.

> **Published:** Option B is implemented and the first two independently versioned
> components are served from jsDelivr at immutable tags (`lsp-client-v*`,
> `pyright-worker-v*`), cut by the
> [`Release CDN component`](../.github/workflows/release-cdn.yml) workflow. The consumer
> integration contract (import map, cross-origin worker Blob shim, pinned peer-dep versions,
> stub loading) lives in [`cdn-consumption.md`](./cdn-consumption.md).

---

## 4. Changes required to this project

All changes are non-breaking refinements to the existing code; no features need to be removed or
rearchitected.

### 4.1 Decouple `diagnostics.js` from the DOM

`updateDiagnosticsStatus`, `refreshWorkspaceDiagnosticsStatus`, and `getSelectedStubsLabelFromDom`
use hard-coded `getElementById` calls. Since the plan was written, the file grew from ~150 to ~330
lines and gained a module-level `workspaceDiagnosticsMap` cache with workspace-wide aggregation.

**Required change (updated scope):**

1. Extract a **pure diagnostics data layer** that owns `workspaceDiagnosticsMap`,
   `removeWorkspaceDiagnosticsFor`, `getWorkspaceDiagnostics`, and the LSP→CodeMirror diagnostic
   conversion logic. This layer has zero DOM deps and is fully reusable.
2. Move `updateDiagnosticsStatus`, `refreshWorkspaceDiagnosticsStatus`, and
   `getSelectedStubsLabelFromDom` into `app.js` (or a new `diagnostics-status-bar.js` in the
   app layer). These are application-specific DOM writers.
3. Pass an `onDiagnosticsChange` callback through `LSPPluginOptions` so the library notifies the
   app without touching the DOM itself.

This is now a **medium** effort task (was small) because the workspace cache and DOM writing are
interleaved and must be untangled.

**Implementation progress (current branch):**
- Done: DOM-coupled status rendering moved out of
  `packages/lsp-client/src/diagnostics.js` into
  `apps/playground/diagnostics-status.js` (`updateDiagnosticsStatus`,
  `refreshWorkspaceDiagnosticsStatus`).
- Done: `createLSPDiagnostics` now emits app-level updates through an
  `onDiagnosticsChange` callback instead of touching DOM directly.
- Done: workspace-cache shape bug fixed (report-ready snapshots are no longer overwritten by
  CodeMirror diagnostic objects).
- Done: `createLSPPlugin` accepts `onDiagnosticsChange` through its options object.

### 4.2 Remove `window.lspClients` global from `client.js`

`createLSPPlugin` stores per-URI client references on `window.lspClients`. This is an accidental
global that makes the library impossible to use in environments without `window` and prevents running
two editors on the same page.

Additionally, `createLSPPlugin`'s signature has grown to include a `stubsStatusSource` parameter
that is app-specific. The proposed `LSPPluginOptions` interface (§2.2) should absorb this.

**Required change:** Return the per-URI tracking state from `createLSPPlugin` (or drop it entirely —
the only current consumer is `app.js` and it already has the reference via closure). Refactor the
signature to use an options object instead of positional parameters.

**Implementation progress (current branch):**
- Done: `window.lspClients` global removed; callers now hold their own client references.
- Done: `createLSPPlugin` signature refactored to accept a single `options` parameter:
  `createLSPPlugin(client, view, options)` where options include `fileUri`, `languageId`,
  `initialContent`, and `onDiagnosticsChange`.
- Done: Call site in `app.js` updated to use the new options-based signature.

### 4.3 Add an unsubscribe return value to `onNotification`

```js
// Current
onNotification(handler) { this.messageHandlers.push(handler); }

// Proposed
onNotification(handler) {
    this.messageHandlers.push(handler);
    return () => {
        const idx = this.messageHandlers.indexOf(handler);
        if (idx > -1) this.messageHandlers.splice(idx, 1);
    };
}
```

This matches the CodeMirror convention (event subscriptions return their own unsubscribers) and
prevents memory leaks when views are destroyed and recreated.

**Implementation progress (current branch):**
- Done: `SimpleLSPClient.onNotification(handler)` returns an unsubscribe callback.
- Done: the callback removes only the registered handler and is safe to call more than once.
- Done: unit coverage verifies delivery before unsubscribe, no delivery afterward, and
  idempotent repeated unsubscribe calls.

### 4.4 Create a public entry point (`packages/lsp-client/src/index.js`)

A single re-export file defines the published surface and makes tree-shaking trivial:

```js
// packages/lsp-client/src/index.js
export { SimpleLSPClient } from './simple-client.js';
export { WorkerTransport } from './worker-transport.js';
export { createTransport as createWorkerTransport } from './transport-factory.js';
export { createLSPClient, createLSPPlugin, switchBoard, isLSPReady } from './client.js';
export { createLSPDiagnostics, notifyDocumentOpen, notifyDocumentChange,
         removeWorkspaceDiagnosticsFor, getWorkspaceDiagnostics,
         requestDiagnostics } from './diagnostics.js';
export { createCompletionSource } from './completion.js';
export { createHoverTooltip } from './hover.js';
export { renderMarkdown, processInline, renderBlocks } from './markdown-renderer.js';
export {
    kindToType, isDunderLabel, convertCompletionItem,
    dedupeAndSortCompletionOptions, computeCompletionFrom,
    CompletionItemKind,
} from './completion-core.mjs';
```

### 4.5 Separate component metadata (optional but clean)

Keep the root `package.json` as the private workspace and worker-build manifest, with
component-local metadata for the independently versioned CDN components:

```
mp_codemirror/
  apps/
    playground/
      package.json          ← application dependency versions + CDN repository
      component-source.js   ← runtime local/CDN selector
      component-config.generated.js
  packages/
    lsp-client/
      package.json          ← library metadata + peerDeps
      src/index.js          ← re-export entry point
    pyright-worker/
      package.json          ← worker component metadata
      src/                  ← worker source and protocol
      dist/                 ← built bundle
      assets/               ← typeshed and board stubs
```

The root manifest remains necessary for `npm ci`, webpack, and local development. The release
workflow validates the version from each component manifest, keeping the client and worker version
streams independent without duplicating the root build dependency graph. The playground declares
exact component versions in its own manifest. `scripts/generate-component-config.mjs` combines
those dependencies with component-owned CDN paths into a checked browser configuration, leaving
the runtime source selector free of manually maintained release versions.

### 4.6 Add JSDoc type annotations to public API functions

Public exports now document configuration/result objects, callback payloads, parameters, return
values, and rejection/error behavior. The annotations have been validated by emitting declarations
from `packages/lsp-client/src/index.js` with
`tsc --allowJs --declaration --emitDeclarationOnly`.

For the CDN-only release, the annotated JavaScript remains the source of truth and generated client
`.d.ts` files are not committed. They can be added to a future npm package without maintaining a
second hand-written contract. This decision is separate from task 4.7, where the worker control-plane
protocol itself is a TypeScript contract that still needs a consumer-facing declaration artifact.

### 4.7 Document the worker control-plane protocol

`packages/pyright-worker/src/messages.ts` is the TypeScript protocol definition. It is:
1. Mentioned in the library README as the stable contract for custom worker implementations.
2. Published alongside the `pyright-worker` package as `messages.d.ts`.

This lets a consumer write a custom worker (e.g., for a different language server) that is
drop-in compatible with `WorkerTransport`.

**Implementation progress (current branch):**
- Done: `packages/pyright-worker/src/messages.d.ts` is generated from and published
  alongside `messages.ts`.
- Done: worker package metadata exposes the declaration contract at `./messages`.
- Done: CI and the CDN release workflow reject a stale declaration artifact.
- Done: the CDN consumer guide links both the source protocol and published declaration.

### 4.8 Consider decomposing `share.js` (new)

`share.js` grew from ~200 to ~670 lines with the addition of report-issue functionality, scope
selectors, and share-settings resolution. The pure utility functions (`compressCode`,
`decompressCode`, `buildShareableUrl`, `parseUrlParams`, `buildIssueUrl`, `resolveShareSettings`,
`resolveReportIssueLabels`) have no DOM dependencies and are independently useful. The UI wiring
(`initShareDropdown`, `initReportIssueButton`) is application-specific.

**Optional change:** Split into `share-core.js` (pure URL/compression/issue-URL helpers) and
`share-ui.js` (event wiring, modal management). This is only worthwhile if an external consumer
wants the share/issue-URL logic — otherwise leave as-is.

**Implementation progress (current branch):**
- Done: reusable utility functions live in `share-core.js`; app-specific event and modal wiring
  lives in `share-ui.js`.
- Done: `share.js` remains a compatibility facade, while `app.js` imports the two layers directly.
- Scope decision: do not split `share-core.js` further; no external reuse is expected.

### 4.9 Extract Markdown/RST renderer from `hover.js` (new)

`hover.js` is ~530 lines, roughly half of which is the Markdown/RST→DOM renderer
(`renderMarkdown`, `processInline`, `renderBlocks`, and the `PYRIGHT_SIG_RE` constant). The
tooltip integration (`createHoverTooltip`, `createHoverContent`) is a separate concern.

**Required change:** Create `packages/lsp-client/src/markdown-renderer.js` containing:
- `processInline(text)` — inline formatting (bold, italic, code, RST roles, links)
- `renderBlocks(text, container)` — block-level rendering (headers, lists, code blocks, field lists)
- `PYRIGHT_SIG_RE` — signature detection regex
- `renderMarkdown(text)` — top-level entry point (signature extraction + fenced code + block rendering)

`hover.js` then imports `renderMarkdown` from the new file and shrinks to ~130 lines
(tooltip lifecycle only). This makes both modules easier to understand, test, and reuse
independently.

**Implementation progress (current branch):**
- Done: `markdown-renderer.js` owns `processInline`, `renderBlocks`, `renderMarkdown`, and
  `PYRIGHT_SIG_RE`.
- Done: `hover.js` contains tooltip integration and delegates rendering to the extracted module.
- Done: browser renderer tests import `markdown-renderer.js` directly; `hover.js` retains a
  compatibility re-export of `renderMarkdown`.

### 4.10 Make diagnostics subscriptions follow the editor-view lifecycle

`SimpleLSPClient.onNotification()` now returns an unsubscribe callback, but
`createLSPDiagnostics()` currently discards it. Reconfiguring an LSP compartment or closing one of
ViperIDE's editor tabs therefore leaves a handler retaining the old `EditorView`; a later
`publishDiagnostics` can dispatch into a stale or destroyed view.

**Required before ViperIDE integration:** implement the diagnostics listener as a CodeMirror
view plugin (or equivalent disposable extension) whose `destroy()` calls the unsubscribe
function. Add coverage for tab/view destruction and repeated board/client rebinds.

### 4.11 Add a public document-close helper

The proposed API in §2.2 includes `notifyDocumentClose`, but the current package only implements and
exports `notifyDocumentOpen` and `notifyDocumentChange`. ViperIDE now has explicit `tabClosed`,
`fileRemoved`, `dirRemoved`, and `fileRenamed` events, so leaving documents open in Pyright would
retain stale diagnostics and document contents.

**Required before ViperIDE integration:** implement and export
`notifyDocumentClose(client, fileUri)`, remove that URI from the workspace diagnostics cache, and
test close followed by reopen and rename (close old URI, open new URI).

### 4.12 Expose dynamic workspace file operations above the raw worker

The worker protocol supports `syncFile` and `deleteFile`, but consumers currently reach through
`lspTransport.worker.postMessage(...)`. ViperIDE's `fs_cache.js` now centralizes file content,
renames, removals, device refreshes, and unsaved drafts; keeping it synchronized requires both
operations without coupling ViperIDE to a transport implementation detail.

**Required before ViperIDE integration:** add typed public methods/helpers for syncing and deleting
workspace files. A rename is expressed as delete-old + sync-new. Keep the raw protocol declarations
as the source of truth and cover these helpers with worker transport tests.

---

## 5. Summary checklist

| # | Task | Effort | Breaking? | Status |
|---|------|--------|-----------|--------|
| 4.1 | Decouple `diagnostics.js` from DOM (extract pure data layer) | Medium | No | ✅ Done |
| 4.2 | Remove `window.lspClients` global; refactor to options object | Small | No | ✅ Done |
| 4.3 | Add unsubscribe return to `onNotification` | Trivial | No | ✅ Done |
| 4.4 | Create `packages/lsp-client/src/index.js` entry point | Trivial | No | ✅ Done |
| 4.5 | Separate component metadata | Small | No | ✅ Done — component manifests own release versions; root manifest remains the application build manifest |
| 4.6 | Complete JSDoc annotations | Medium | No | ✅ Done — all public exports documented; declaration emission validated |
| 4.7 | Document and publish worker protocol declarations | Small | No | ✅ Done — generated `messages.d.ts` is exposed and drift-checked |
| 4.8 | Decompose `share.js` utility/UI layers | Small | No | ✅ Done — no further `share-core.js` split planned |
| 4.9 | Extract `markdown-renderer.js` from `hover.js` | Small | No | ✅ Done — direct renderer browser coverage |
| 4.10 | Dispose diagnostic subscriptions with each editor view | Small | No | Required for ViperIDE |
| 4.11 | Implement/export `notifyDocumentClose` | Small | No | Required for ViperIDE |
| 4.12 | Expose worker workspace sync/delete helpers | Small | No | Required for ViperIDE |
| — | Prepare CDN publication (Option B) | Workflow + docs + harness | n/a | ✅ Implemented and locally validated |
| — | Cut and verify immutable CDN tags | Release operation | n/a | ✅ Done — both coherent `v0.2.0` package-layout tags are live and the tagged-CDN harness passes |
| — | Add a validated Rollup HTTPS loader for immutable client tags | Small build integration | n/a | Planned for ViperIDE |

The completed refactors are additive or internal cleanups. Remaining downstream integration
and ongoing post-publication validation can be completed independently.

---

## 6. CDN publication implementation and test status

Status reviewed against the live `copilot/publish-tier-1-components` branch on 2026-08-04.

| Phase | Implementation state | Verification state |
|---|---|---|
| 1. Artifact delivery and immutable tags | Release workflow creates independent tags and a tag-only worker artifact commit. Manual dispatch supports explicitly selected branches after the workflow reaches the default branch. Temporary `cdn-release/<component>/<version>` request tags bootstrap pre-merge releases directly from a PR commit and are removed after success. | `lsp-client-v0.2.0` and `pyright-worker-v0.2.0` are live through jsDelivr with the workspace package paths. |
| 2. Public `lsp-client` surface | Public entry point exists; app-specific worker URL detection has been removed from the reusable import graph; consumers must pass `workerUrl`; all public exports have complete JSDoc contracts. | JavaScript unit coverage verifies explicit URL validation and preservation. TypeScript declaration emission from the JSDoc succeeds. |
| 3. Consumer contract | Import map, Blob worker shim, explicit board-stub loading, protocol declarations, and executable editor wiring are documented. | Local standalone harness exercises public exports, diagnostics, completion, hover, and explicit ESP32/RP2 bundles. TypeScript resolves the worker protocol from both package root and `./messages`. The same public contract passes against the immutable CDN tags. |
| 4. Release automation | Manual workflow validates semver/package versions and worker protocol declaration freshness, builds and verifies the worker, commits artifacts only into the tagged tree, pushes an immutable tag, and warms jsDelivr. | Both first-release workflow runs succeeded and removed their temporary request tags. |
| 5. Documentation | README links to a detailed CDN consumer guide and this plan. Publication status now distinguishes release-ready code from live tags. `Josverl/stubs_playground` is the canonical CDN repository. | Examples are covered indirectly by the standalone harness. |
| 6. Real consumer validation | The real playground and standalone harness support local and tagged-CDN modes and detect local component fallback requests. Playground dependency versions are manifest-owned and its browser CDN configuration is generated and checked for drift. | Chromium CDN mode passed against `lsp-client-v0.2.0` and `pyright-worker-v0.2.0` using only `packages/...` paths. |

### Verified evidence

- Production worker build: succeeded locally;
  `packages/pyright-worker/dist/pyright_worker.js` is 9,018,033 bytes.
- JavaScript unit suite: 36/36 passed, including explicit worker URL contract coverage.
- Worker protocol declaration: generated artifact matches `messages.ts`; root and `./messages`
  package imports resolve under TypeScript `NodeNext`.
- Extracted Markdown/RST renderer: 58/58 Chromium tests passed, including the `hover.js`
  compatibility re-export.
- Share utility/UI split: 7/7 JavaScript unit tests and 22/22 Chromium tests passed.
- Python unit suite: 14/14 passed.
- Standalone Chromium harness: diagnostics, completion, hover, ESP32 stubs, and RP2 stubs passed.
- Immutable tagged-CDN Chromium harness: passed against both `v0.2.0` tags with diagnostics,
  completion, hover, ESP32 stubs, and zero local component fallbacks.
- jsDelivr responses for the client entry point and worker bundle return HTTP 200 with
  cross-origin access and immutable one-year caching.
- Full Chromium worker tier: 38 passed and 3 skipped. Two fresh-page tests initially timed out
  while loading esm.sh before the editor mounted, then both passed when rerun in isolation.
- PR #64 checks: unit tests, worker build, all worker browser jobs, Chromium/Firefox editor jobs,
  security audit, CodeQL, and all CodeQL language analyses passed.
- PR #64 has one unrelated editor/WebKit failure:
  `FileSystemDirectoryHandle` is unavailable in
  `test_rename_rollback_preserves_existing_destination`; 154 other editor tests passed.
- Exploratory Playwright MCP verification was attempted during the final audit, but the configured
  MCP server could not start locally (process exit 127). Pytest + Playwright browser coverage above
  completed against the same built worker.

### Remaining tasks and gaps

1. Merge PR #64 now that the tagged-CDN verification passes.
2. Wire the tagged-CDN harness into a scheduled/manual post-release CI job; the current test is
   present but skipped unless tag environment variables are supplied.
3. Complete tasks 4.10-4.12 and release the updated client before binding multiple ViperIDE tabs.
4. Add and test ViperIDE's Rollup HTTPS-module loader. It must accept only the configured immutable
   jsDelivr tag/base URL, resolve relative client imports on that tag, reject failed/non-JavaScript
   responses, and let bare CodeMirror imports resolve from ViperIDE's lockfile.
5. Rebase ViperIDE's `typechecking_1` branch onto upstream v0.6.2 before integration. At review time
   the branch was at `5799bb8`, three commits behind upstream `3a5a331`.
6. Follow the ViperIDE-specific phased integration plan in §7.
7. Resolve or explicitly waive the unrelated WebKit OPFS test failure before merging PR #64.

---

## 7. ViperIDE integration review (2026-08-05)

### 7.1 Relevant upstream changes

The local ViperIDE `typechecking_1` branch and local `main` were identical at `5799bb8`. Fetching
upstream showed v0.6.2 at `3a5a331`; the review below covers commits from 2026-03-08 through that
upstream tip.

| ViperIDE change | Integration consequence |
|---|---|
| v0.5.5 (`27fcfe3`): added `fs_cache.js`, expanded editor tabs/file events, split transports, and added Mocha integration tests | Treat ViperIDE as a multi-document workspace, not a single active editor. Use its cache and file events as the source of truth, and add tests to its existing runner rather than a separate harness. |
| Persistent settings (`986f4c0`) | Add type-checking enable/mode and board override controls through `settings.js`; do not create a second local-storage schema. |
| MCP control surface (`e67348c`) | Keep type checking behind a service/API boundary rather than DOM scraping. A later MCP diagnostic/status tool can consume that boundary, but MCP support is not required for the first integration. |
| Tool shortcuts (`ca0a14f`) | Do not add global shortcuts that collide with ViperIDE's Ctrl/Cmd, Alt+Shift, F5, or CodeMirror lint bindings. Prefer settings/menu controls first; reserve F8/Shift-F8 for diagnostic navigation inside CodeMirror. |
| Reconnection and session teardown (`1d27c20`, v0.6.0) | The LSP worker is independent of the serial/WebREPL transport. Keep it alive across transient reconnects, but re-evaluate stubs after a newly identified device and dispose it only on type-check disable, board change, or application teardown. |
| Device metadata and ABI-aware package work (`26e1032`, v0.6.0) | Reuse `devInfo` (`machine`, `sysname`, `release`, `version`, `mpy_arch`, `mpy_ver`) as input to board/stub selection. Because those fields do not uniquely identify every board, persist and expose a manual override. |
| Rollup/IIFE build and CodeMirror dependencies (current v0.6.2) | Fetch the immutable CDN client source during the Rollup build and let bare imports resolve from ViperIDE's `node_modules`. Keep the worker/stub assets as runtime CDN resources. This uses one distribution architecture and one CodeMirror module graph. |
| v0.6.2 editor cleanup (`8771484`, `3a5a331`) | No new type-checking API is introduced, but integration changes to `editor.js` must be based on v0.6.2 to avoid conflicting with the new syntax-tree-driven decoration code. |

WebREPL speedups, QuickInstall, Markdown rendering, virtual-device examples, and the viper-tools
updates do not require changes to the type-checking architecture.

### 7.2 Revised integration architecture

1. Add a small ViperIDE-owned `typechecking.js` service. It owns the Pyright client/transport,
   worker Blob URL, selected stub bundle, document versions, and diagnostic status. `app.js` and
   `editor.js` should call this service rather than importing worker internals.
2. Import `@mp-codemirror/lsp-client` from its exact jsDelivr tag in ViperIDE's Rollup graph through
   a restricted HTTPS-module loader. The loader handles only remote/relative client modules; bare
   `@codemirror/*` imports fall through to `@rollup/plugin-node-resolve` and use ViperIDE's
   lockfile versions. Do not add an npm package or copy client source into ViperIDE.
3. Load the pinned `pyright-worker-v*` script and stub manifest/assets from jsDelivr. Create one
   same-origin Blob worker URL per application session and revoke it on final teardown.
4. Give each editable `.py` `EditorView` its own LSP `Compartment` and URI derived from the current
   tab path. Non-Python, rendered Markdown, hex, and `.mpy.dis` tabs receive no LSP extension.
5. Use ViperIDE's existing events and cache:
   - `editorLoaded` / `tabClosed` for open/close;
   - the existing editor update listener for debounced `didChange`;
   - `fileRenamed`, `fileRemoved`, and `dirRemoved` for close/delete/reopen operations;
   - `fsCache.peek()` for known device content and live editor drafts for unsaved content.
6. Do not fetch every device file during initial startup. Seed open Python tabs first, then sync
   cached/imported Python files. Add an explicit background hydration policy only if cross-file
   imports prove incomplete; avoid slowing device connection by reading the entire filesystem.
7. On `deviceConnected`, map `devInfo` to the best stub target and restart Pyright only if that
   target differs. On transient `deviceDisconnected`, retain the current worker and open documents.
8. Preserve Ruff and MicroPython compile diagnostics. Pyright diagnostics should share CodeMirror's
   lint UI and carry a source label so users can distinguish all three producers.

### 7.3 Phased implementation and acceptance gates

| Phase | Work | Acceptance gate |
|---|---|---|
| 0. Library readiness | Complete 4.10-4.12, publish a new immutable client version, and verify it with the existing standalone/CDN harnesses. | Destroy/rebind tests show no retained handlers; close/reopen and sync/delete tests pass. |
| 1. ViperIDE build integration | Rebase `typechecking_1` on v0.6.2; add the restricted Rollup HTTPS loader; import the exact tagged client; load the pinned worker URL; initialize one type-checking service. | Production IIFE contains the client and only ViperIDE's CodeMirror modules, has no unresolved bare imports, and starts the CDN worker without a vendored fallback. |
| 2. One-document vertical slice | Bind the active `.py` tab, display diagnostics/completion/hover, retain Ruff/mpy-cross linting, and add status/error UI. | Existing editor behavior remains intact; a MicroPython sample receives Pyright diagnostics, completion, and hover. |
| 3. Multi-tab/workspace lifecycle | Bind every open Python view; implement close, rename, delete, draft, and cached-file synchronization. | Tests cover two tabs importing each other, unsaved edits, close/reopen, file/folder rename, delete, and repeated board rebinds. |
| 4. Device-aware stubs and settings | Map `devInfo` to stubs, add a persistent manual override/type-check mode, and avoid restarts on transient reconnects. | ESP32/RP2 (plus VM) resolve correct APIs; override survives reload; reconnect does not duplicate workers or listeners. |
| 5. Consumer hardening | Add browser exploratory coverage, Pytest + Playwright integration tests under this repository's `tests/`, ViperIDE build/lint tests, and optional MCP diagnostic exposure. | Chromium and Firefox pass the end-to-end flows; failure/offline states are visible and type checking can be disabled without affecting editing/device operations. |
