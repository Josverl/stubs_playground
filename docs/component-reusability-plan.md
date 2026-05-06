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
- Remaining: `createLSPPlugin` still uses positional params; fold diagnostics callback into
  the planned `LSPPluginOptions` object when task 4.2 is implemented.

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

### 4.5 Separate `package.json` for the client library (optional but clean)

Move the existing `package.json` (which today describes only the webpack worker build) into
`src/worker/package.json`, and create `src/lsp/package.json` for the library:

```
mp_codemirror/
  src/
    lsp/
      package.json          ← NEW (library metadata + peerDeps)
      index.js              ← NEW (re-export entry point)
      ...existing files...
    worker/
      package.json          ← MOVED from root
      ...existing files...
```

This keeps the two publishable units independent and avoids coupling the library's semver to the
worker's Pyright version.

### 4.6 Add JSDoc type annotations to public API functions

The existing JSDoc is good but incomplete (missing `@returns` on several functions, no `@throws`
where relevant). Full JSDoc enables automatic TypeScript `.d.ts` generation via `tsc --declaration
--emitDeclarationOnly`, so consumers of the library get IDE type hints without a TypeScript build
step in *their* project.

### 4.7 Document the worker control-plane protocol

`src/worker/messages.ts` is already a good TypeScript definition. It should be:
1. Mentioned in the library README as the stable contract for custom worker implementations.
2. Published alongside the `pyright-worker` package as `messages.d.ts`.

This lets a consumer write a custom worker (e.g., for a different language server) that is
drop-in compatible with `WorkerTransport`.

### 4.8 Consider decomposing `share.js` (new)

`share.js` grew from ~200 to ~670 lines with the addition of report-issue functionality, scope
selectors, and share-settings resolution. The pure utility functions (`compressCode`,
`decompressCode`, `buildShareableUrl`, `parseUrlParams`, `buildIssueUrl`, `resolveShareSettings`,
`resolveReportIssueLabels`) have no DOM dependencies and are independently useful. The UI wiring
(`initShareDropdown`, `initReportIssueButton`) is application-specific.

**Optional change:** Split into `share-core.js` (pure URL/compression/issue-URL helpers) and
`share-ui.js` (event wiring, modal management). This is only worthwhile if an external consumer
wants the share/issue-URL logic — otherwise leave as-is.

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

---

## 5. Summary checklist

| # | Task | Effort | Breaking? | Status |
|---|------|--------|-----------|--------|
| 4.1 | Decouple `diagnostics.js` from DOM (extract pure data layer) | Medium | No | ✅ Done |
| 4.2 | Remove `window.lspClients` global; refactor to options object | Small | No | ✅ Done |
| 4.3 | Add unsubscribe return to `onNotification` | Trivial | No | ✅ Done |
| 4.4 | Create `src/lsp/index.js` entry point | Trivial | No | In progress |
| 4.5 | Separate `package.json` files | Small | No | Not started |
| 4.6 | Complete JSDoc annotations | Medium | No | Not started |
| 4.7 | Document worker protocol in README | Small | No | Not started |
| 4.8 | Decompose `share.js` (optional) | Small | No | Not started |
| 4.9 | Extract `markdown-renderer.js` from `hover.js` | Small | No | Not started |
| — | Publish to npm (when ready) | One-off CI setup | n/a | Deferred |

None of the required changes alter existing behaviour; they are purely additive or internal
cleanups. The app can be refactored incrementally — each item above can be merged independently.
