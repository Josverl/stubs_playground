# Component Reusability Plan

This document analyses the current codebase from the perspective of re-use by other CodeMirror editor
projects, proposes a stable public API for the most portable components, explains the distribution
strategy, and lists the refactoring work needed inside this repository to support it.

The decision to actually publish is deferred until there is concrete external demand (see the issue), so
this document covers the *what* and *how*, not a timeline.

> **Revision history:**
> - *Initial version* — created after commit `7505f65`.
> - *May 2025 update* — reviewed against `HEAD` (post `9a35f9cc`). Updated tier
>   classifications (`hover.js` / `markdown-renderer.js` split, `diagnostics.js` scope increase,
>   `share.js` growth), revised API signatures (`createLSPPlugin` options, new diagnostic exports,
>   `isDunderLabel`, `renderMarkdown`), added tasks 4.8 (share.js decomposition) and 4.9
>   (extract markdown renderer from hover.js), and added status column to the summary checklist.

---

## 1. Which components are most likely to be re-used?

The project can be split into three tiers:

### Tier 1 — Highly portable (language-agnostic LSP bridge)

These modules work with **any** LSP server (not just Pyright) and have **no DOM dependencies**
(or render-only DOM usage that does not query external elements).
They are the most attractive pieces for other editors.

| Module | What it does | DOM deps | LSP-server-specific |
|--------|-------------|----------|---------------------|
| `src/lsp/simple-client.js` | JSON-RPC 2.0 LSP client, transport-agnostic | None | No |
| `src/lsp/worker-transport.js` | Bridges a Web Worker behind a simple subscribe/send interface | None | Yes (Pyright handshake) |
| `src/lsp/transport-factory.js` | One-liner factory for `WorkerTransport` | None | Yes |
| `src/lsp/completion-core.mjs` | Pure LSP→CodeMirror completion conversion helpers (incl. `isDunderLabel`) | None | No |
| `src/lsp/completion.js` | CodeMirror autocompletion source driven by LSP | None | No |
| `src/lsp/hover.js` | CodeMirror hover-tooltip source driven by LSP | Render-only | No |
| `src/lsp/markdown-renderer.js` | Markdown/RST→DOM renderer (`renderMarkdown`, `processInline`, `renderBlocks`) | Render-only | No |

> **`hover.js` / `markdown-renderer.js` split:** `hover.js` grew to ~530 lines because it
> contains both the CodeMirror tooltip integration *and* a full Markdown/RST renderer. These
> are independent concerns — the renderer is reusable anywhere that needs to display
> Markdown/RST content as DOM, while the tooltip source is CodeMirror-specific.
> Task 4.9 tracks extracting the renderer into `src/lsp/markdown-renderer.js`.

### Tier 2 — Useful but have DOM coupling that needs refactoring

| Module | DOM coupling | Path to re-use |
|--------|-------------|----------------|
| `src/lsp/diagnostics.js` | `updateDiagnosticsStatus` reads `#diagnostics-status` and `#boardSelect` DOM elements; `getSelectedStubsLabelFromDom` reads a specific `<select>`. Now also manages a module-level `workspaceDiagnosticsMap` cache with workspace-wide aggregation via `refreshWorkspaceDiagnosticsStatus`. | Split into (a) a **pure diagnostics data layer** (workspace cache, conversion, document lifecycle) and (b) an **app-specific status-bar writer**. The split is harder than originally scoped because workspace-level state and DOM writing are interleaved — see §4.1 for updated guidance. |
| `src/lsp/client.js` (`createLSPPlugin`) | Writes to `window.lspClients` global map. Signature now includes a `stubsStatusSource` parameter. | Remove the global; return state from the factory instead |
| `src/events.js` | Dispatches `CustomEvent` on `document` | Thin and easily reimplemented; low re-use value on its own |

### Tier 3 — Application-specific (low re-use value outside this app)

| Module | Reason |
|--------|--------|
| `src/ui/file-tree.js` | Tightly coupled to `OPFSProject`; very specific UI decisions |
| `src/ui/tab-bar.js` | App-level tab management; small and easy to copy |
| `src/storage/opfs-project.js` | OPFS wrapper useful as a standalone library but not CodeMirror-specific |
| `src/editor/document-manager.js` | Multi-doc state manager; re-usable in pattern but coupled to `OPFSProject` and `Events`. Positive note: `onActiveChange()` already returns an unsubscribe function, matching the CodeMirror convention. |
| `src/share.js` | ~670 lines. Pure URL/compression helpers (`compressCode`, `decompressCode`, `buildShareableUrl`, `parseUrlParams`, `buildIssueUrl`, `resolveReportIssueLabels`, `resolveShareSettings`) are reusable in isolation, but the UI wiring (`initShareDropdown`, `initReportIssueButton`) and the report-issue modal are application-specific. Consider splitting into a pure `share-core.js` and an app-level `share-ui.js` if external consumers want the URL/compression logic. |
| `src/app.js` | Application entry point; not re-usable |
| `src/worker/pyright-worker.ts` | Pyright-specific; only changes with Pyright upstream |

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

Extracted into `src/lsp/markdown-renderer.js` (see task 4.9):

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

This is the compiled `dist/pyright_worker.js` published as an npm package with a `main`/`exports`
pointing at the `.js` file, so consumers can reference it from their bundler or CDN:

```js
// Bundler (Vite / webpack)
import workerUrl from '@mp-codemirror/pyright-worker?url';

// CDN
const workerUrl = 'https://cdn.jsdelivr.net/npm/@mp-codemirror/pyright-worker@x.y.z/worker.js';
```

The worker's internal control-plane protocol (`serverLoaded` / `initServer` / `serverInitialized`)
is already documented in `src/worker/messages.ts`; that file becomes the public contract and should
be published as TypeScript declarations.

---

## 3. How to share components with projects outside this repo's control

### Option A: npm (recommended)

Publish `@mp-codemirror/lsp-client` and `@mp-codemirror/pyright-worker` to the public npm registry.

**Pros:**
- Standard toolchain (Vite, webpack, Rollup) picks them up automatically.
- Versioned with semver — callers pin exact versions, no surprise breakage.
- CDN consumption via `esm.sh` or `jsDelivr` is automatic once published.
- GitHub Actions CI can automate publishing on tag push.

**Cons:**
- Requires ongoing maintenance to keep versions aligned with Pyright upstream.
- Pyright worker bundle is ~4 MB uncompressed, ~1 MB gzipped — large but within npm norms; consumers who ship only this worker pay a one-time 1 MB download.

**Minimum viable publishing setup:**

```jsonc
// package.json (lsp-client)
{
  "name": "@mp-codemirror/lsp-client",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "exports": {
    ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" }
  },
  "peerDependencies": {
    "@codemirror/state": "^6",
    "@codemirror/view": "^6",
    "@codemirror/lint": "^6",
    "@codemirror/autocomplete": "^6"
  }
}
```

A single `src/lsp/index.js` re-exporting the public surface (see §4) is all that is needed; no
transpilation step is required since the code is already ES2020+ and uses only browser globals.

### Option B: CDN-only (zero-maintenance path)

Point consumers at `esm.sh` or `jsDelivr` directly from the GitHub repo (using a tag):

```html
<script type="importmap">
{
  "imports": {
    "@mp-codemirror/lsp-client": "https://esm.sh/gh/Josverl/mp_codemirror@v0.1.0/src/lsp/index.js"
  }
}
</script>
```

**Pros:** No npm account or CI needed to start.  
**Cons:** `esm.sh`'s GitHub transform is unofficial; no semver resolution; no npm toolchain integration.

### Option C: Copy-paste / vendoring (current implicit approach)

Consumers copy the `src/lsp/` directory directly. Works today but offers no upgrade path and no
formal contract.

### Recommendation

Start with **Option B** (CDN-only from a tagged release) to collect feedback with zero overhead.
Move to **Option A** (npm) only when there are real consumers who need semver + toolchain integration.

> **Release-ready:** Option B is implemented in the repository. Two independently versioned
> components will be served from jsDelivr at immutable tags (`lsp-client-v*`,
> `pyright-worker-v*`), cut by the
> [`Release CDN component`](../.github/workflows/release-cdn.yml) workflow. The consumer
> integration contract (import map, cross-origin worker Blob shim, pinned peer-dep versions,
> stub loading) lives in [`cdn-consumption.md`](./cdn-consumption.md). The first public tags
> still need to be cut before CDN publication is complete.

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
- Done: DOM-coupled status rendering moved out of `src/lsp/diagnostics.js` into
  `src/diagnostics-status.js` (`updateDiagnosticsStatus`, `refreshWorkspaceDiagnosticsStatus`).
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

### 4.4 Create a public entry point (`src/lsp/index.js`)

A single re-export file defines the published surface and makes tree-shaking trivial:

```js
// src/lsp/index.js  — proposed public API surface
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

Keep the root `package.json` as the application and worker-build manifest, and add
component-local metadata for the two independently versioned CDN components:

```
mp_codemirror/
  src/
    lsp/
      package.json          ← NEW (library metadata + peerDeps)
      index.js              ← NEW (re-export entry point)
      ...existing files...
    worker/
      package.json          ← worker component metadata
      ...existing files...
```

The root manifest remains necessary for `npm ci`, webpack, and local development. The release
workflow validates the version from each component manifest, keeping the client and worker version
streams independent without duplicating the root build dependency graph.

### 4.6 Add JSDoc type annotations to public API functions

Public exports now document configuration/result objects, callback payloads, parameters, return
values, and rejection/error behavior. The annotations have been validated by emitting declarations
from `src/lsp/index.js` with `tsc --allowJs --declaration --emitDeclarationOnly`.

For the CDN-only release, the annotated JavaScript remains the source of truth and generated client
`.d.ts` files are not committed. They can be added to a future npm package without maintaining a
second hand-written contract. This decision is separate from task 4.7, where the worker control-plane
protocol itself is a TypeScript contract that still needs a consumer-facing declaration artifact.

### 4.7 Document the worker control-plane protocol

`src/worker/messages.ts` is already a good TypeScript definition. It should be:
1. Mentioned in the library README as the stable contract for custom worker implementations.
2. Published alongside the `pyright-worker` package as `messages.d.ts`.

This lets a consumer write a custom worker (e.g., for a different language server) that is
drop-in compatible with `WorkerTransport`.

**Implementation progress (current branch):**
- Done: `src/worker/messages.d.ts` is generated from and published alongside `messages.ts`.
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

**Required change:** Create `src/lsp/markdown-renderer.js` containing:
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

---

## 5. Summary checklist

| # | Task | Effort | Breaking? | Status |
|---|------|--------|-----------|--------|
| 4.1 | Decouple `diagnostics.js` from DOM (extract pure data layer) | Medium | No | ✅ Done |
| 4.2 | Remove `window.lspClients` global; refactor to options object | Small | No | ✅ Done |
| 4.3 | Add unsubscribe return to `onNotification` | Trivial | No | ✅ Done |
| 4.4 | Create `src/lsp/index.js` entry point | Trivial | No | ✅ Done |
| 4.5 | Separate component metadata | Small | No | ✅ Done — component manifests own release versions; root manifest remains the application build manifest |
| 4.6 | Complete JSDoc annotations | Medium | No | ✅ Done — all public exports documented; declaration emission validated |
| 4.7 | Document and publish worker protocol declarations | Small | No | ✅ Done — generated `messages.d.ts` is exposed and drift-checked |
| 4.8 | Decompose `share.js` utility/UI layers | Small | No | ✅ Done — no further `share-core.js` split planned |
| 4.9 | Extract `markdown-renderer.js` from `hover.js` | Small | No | ✅ Done — direct renderer browser coverage |
| — | Prepare CDN publication (Option B) | Workflow + docs + harness | n/a | ✅ Implemented and locally validated |
| — | Cut and verify first immutable CDN tags | Release operation | n/a | Pending |
| — | Publish to npm (Option A, when ready) | One-off CI setup | n/a | Deferred |

The completed refactors are additive or internal cleanups. The remaining release and
post-publication validation tasks can be completed independently.

---

## 6. CDN publication implementation and test status

Status reviewed against the live `copilot/publish-tier-1-components` branch on 2026-08-04.

| Phase | Implementation state | Verification state |
|---|---|---|
| 1. Artifact delivery and immutable tags | Release workflow creates independent tags and a tag-only worker artifact commit. Dispatch input is passed through environment variables and releases are restricted to the default branch. | Workflow build commands match the deployed production path. No real release run or tag exists yet, so tag immutability and jsDelivr propagation remain unverified in production. |
| 2. Public `lsp-client` surface | Public entry point exists; app-specific worker URL detection has been removed from the reusable import graph; consumers must pass `workerUrl`; all public exports have complete JSDoc contracts. | JavaScript unit coverage verifies explicit URL validation and preservation. TypeScript declaration emission from the JSDoc succeeds. |
| 3. Consumer contract | Import map, Blob worker shim, explicit board-stub loading, protocol declarations, and executable editor wiring are documented. | Local standalone harness exercises public exports, diagnostics, completion, hover, and explicit ESP32/RP2 bundles. TypeScript resolves the worker protocol from both package root and `./messages`. Real CDN URLs remain untestable until tags exist. |
| 4. Release automation | Manual workflow validates semver/package versions and worker protocol declaration freshness, builds and verifies the worker, commits artifacts only into the tagged tree, pushes an immutable tag, and warms jsDelivr. | Production webpack build and declaration/package-resolution checks succeed locally. The workflow itself has not been dispatched because doing so publishes a tag. |
| 5. Documentation | README links to a detailed CDN consumer guide and this plan. Publication status now distinguishes release-ready code from live tags. `Josverl/stubs_playground` is the canonical CDN repository. | Examples are covered indirectly by the standalone harness. |
| 6. Real consumer validation | Harness supports local and tagged-CDN modes and detects local component fallback requests. | Tagged mode is opt-in through `MP_CODEMIRROR_CDN_CLIENT_TAG` and `MP_CODEMIRROR_CDN_WORKER_TAG`; no CI job supplies them yet, and no tags exist. |

### Verified evidence

- Production worker build: succeeded locally; `dist/pyright_worker.js` is 9,018,033 bytes.
- JavaScript unit suite: 36/36 passed, including explicit worker URL contract coverage.
- Worker protocol declaration: generated artifact matches `messages.ts`; root and `./messages`
  package imports resolve under TypeScript `NodeNext`.
- Extracted Markdown/RST renderer: 58/58 Chromium tests passed, including the `hover.js`
  compatibility re-export.
- Share utility/UI split: 7/7 JavaScript unit tests and 22/22 Chromium tests passed.
- Python unit suite: 14/14 passed.
- Standalone Chromium harness: diagnostics, completion, hover, ESP32 stubs, and RP2 stubs passed;
  the tagged-CDN case is correctly skipped until immutable tags exist.
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

1. Merge PR #64, then dispatch both `0.1.0` releases from `main`.
2. Verify jsDelivr response bodies, CORS behavior, Blob worker startup, two board bundles, and
   absence of local fallbacks using the immutable tags.
3. Wire the tagged-CDN harness into a scheduled/manual post-release CI job; the current test is
   present but skipped unless tag environment variables are supplied.
4. Integrate the verified pinned URLs into ViperIDE.
5. Resolve or explicitly waive the unrelated WebKit OPFS test failure before merging the PR.
