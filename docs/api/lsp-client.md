# LSP client API

`@mp-codemirror/lsp-client` is the public CodeMirror 6 bridge. Its source entry
point is `packages/lsp-client/src/index.js`.

## Import

Pin an immutable client version and provide the host's CodeMirror packages
through an import map or bundler:

```js
import {
  createLSPClient,
  createLSPPlugin,
  notifyDocumentChange,
  notifyDocumentClose,
  switchBoard,
} from "@mp-codemirror/lsp-client";
```

The packages are published on npm. Unbundled consumers can load the same files
from the npm CDN:

```text
https://cdn.jsdelivr.net/npm/@mp-codemirror/lsp-client@0.3.2/src/index.js
https://cdn.jsdelivr.net/npm/@mp-codemirror/pyright-worker@0.4.1/dist/pyright_worker.js
```

## TypeScript

The package is written in JavaScript with JSDoc types and ships generated
declarations in `packages/lsp-client/types/`. JavaScript consumers are
unaffected; TypeScript consumers get full typing without extra configuration
because `package.json` exposes a `types` condition:

```ts
import {
  createLSPClient,
  createLSPPlugin,
  type LSPClientConfig,
  type LSPClientResult,
  type WorkspaceDiagnostic,
} from "@mp-codemirror/lsp-client";

const config: LSPClientConfig = {
  workerUrl,
  typeCheckingMode: "standard",
  diagnosticMode: "workspace",
  onWorkspaceDiagnosticsChange(diagnostics: WorkspaceDiagnostic[]) {
    console.log(diagnostics.length);
  },
};

const runtime: LSPClientResult = await createLSPClient(config);
```

`moduleResolution` must be `bundler`, `node16`, or `nodenext` so the `types`
export condition is resolved. The npm CDN serves the same declarations beside
the source, so unbundled consumers can vendor them and map the path explicitly:

```json
{
  "compilerOptions": {
    "moduleResolution": "bundler",
    "paths": {
      "@mp-codemirror/lsp-client": ["./vendor/lsp-client/types/index.d.ts"]
    }
  }
}
```

The declarations are generated from the JSDoc and verified in CI, so they
cannot drift from the implementation. See
[Contributing](../contributing.md) for the check that enforces this.

## `createLSPClient(config)`

Starts the worker transport, performs the LSP `initialize` handshake, and
returns:

```ts
{
  client: SimpleLSPClient;
  transport: WorkerTransport;
  pyrightVersion: string;
  workspaceDiagnosticsSubscription: { destroy(): void } | null;
}
```

Important configuration:

| Property | Type | Default | Behavior |
|---|---|---|---|
| `workerUrl` | `string` | required | Worker script URL or same-origin Blob URL. |
| `timeout` | `number` | `5000` | LSP request timeout in milliseconds. |
| `workspaceFiles` | `Record<string,string>` | `{}` | Files created under `/workspace` before Pyright starts. |
| `boardStubs` | `ArrayBuffer \| false` | bundled default | Board archive override; `false` disables board stubs. |
| `boardStubsUrl` | `string` | none | Worker-fetched fallback archive. |
| `boardStubPackage` | `object` | none | Cached package preferred as `/typings`. |
| `typeCheckingMode` | `string` | `standard` | `off`, `basic`, `standard`, or `strict`. |
| `diagnosticMode` | `string` | `openFilesOnly` | `openFilesOnly` or `workspace`. |
| `typeshedPath` | `string` | `/typeshed-micropython` | Worker-VFS typeshed path. |
| `pythonVersion` | `string` | `3.11` | Python `X.Y` version exposed to Pyright. |
| `extraStubPackages` | `Array` | `[]` | In-memory type-only packages under `/extra`. |
| `extraPaths` | `string[]` | `[]` | Additional absolute worker-VFS import paths. |
| `onWorkspaceDiagnosticsChange` | `function` | none | Complete diagnostics snapshot, including unopened files. |

```js
const runtime = await createLSPClient({
  workerUrl,
  typeCheckingMode: "standard",
  diagnosticMode: "workspace",
  workspaceFiles: {
    "main.py": "from lib.answer import answer\n",
    "lib/answer.py": "answer: int = 42\n",
  },
  onWorkspaceDiagnosticsChange(diagnostics) {
    console.log(diagnostics);
  },
});
```

## `createLSPPlugin(client, view, options)`

Opens one LSP document and returns CodeMirror extensions for diagnostics,
completion, and hover.

```js
const extensions = createLSPPlugin(runtime.client, view, {
  fileUri: "file:///workspace/main.py",
  languageId: "python",
  initialContent: view.state.doc.toString(),
  diagnosticDelayMs: 300,
  completionDelayMs: 0,
  onDiagnosticsChange(diagnostics) {
    updateStatus(diagnostics);
  },
});
```

Install the result in a CodeMirror `Compartment` so it can be replaced after a
board switch. Destroying or reconfiguring the extension releases its diagnostic
subscription.

Set `completionDelayMs` to `0` when document changes are sent immediately. If
the host debounces `didChange`, set it to at least that debounce interval so
automatic dotted completions query the synchronized document.

## Document synchronization

```js
let version = 1;

notifyDocumentChange(
  runtime.client,
  "file:///workspace/main.py",
  view.state.doc.toString(),
  ++version,
);

notifyDocumentClose(runtime.client, "file:///workspace/main.py");
```

Use complete document text. Versions must increase for each URI. For files
without an open editor, synchronize the worker VFS separately:

```js
runtime.transport.syncWorkspaceFile("lib/answer.py", "answer: int = 43\n");
runtime.client.notify("workspace/didChangeWatchedFiles", {
  changes: [{
    uri: "file:///workspace/lib/answer.py",
    type: 2, // LSP FileChangeType.Changed
  }],
});
```

Workspace paths are relative, use forward slashes, and may not contain empty,
`.` or `..` segments.

## `switchBoard(current, config)`

Closes the current client, transport, and workspace diagnostic subscription,
then returns a replacement `createLSPClient()` result.

```js
runtime = await switchBoard(runtime, {
  workerUrl,
  boardStubs: rp2Archive,
  diagnosticMode: "workspace",
  workspaceFiles,
});

// Reconfigure every editor; this reopens each document with current content.
rebindEditors(runtime.client);
```

`switchBoard()` does not reopen documents because only the host owns current
editor buffers.

## `WorkerTransport`

Most consumers should use `createLSPClient()`. Direct transport methods are
useful for workspace and package management:

| Method | Result | Notes |
|---|---|---|
| `connect()` | `Promise<void>` | Resolves after worker initialization. |
| `syncWorkspaceFile(path, content)` | `void` | Writes complete text under `/workspace`. |
| `deleteWorkspaceFile(path)` | `void` | Removes one workspace file. |
| `getStubPackageCatalog(filters?)` | catalog result | Returns matching packages plus available/default runtime version metadata. |
| `listStubPackages(filters?)` | catalog array | Convenience wrapper returning only matching packages. |
| `installStubPackage(name, specifier)` | installed package | Persists a validated universal wheel. Restart afterward. |
| `listInstalledStubPackages()` | installed package array | Reads IndexedDB metadata. |
| `clearStubPackages(name?, version?)` | removal result | Restart when `restartRequired` is true. |
| `readGeneratedConfig()` | `Promise<string>` | Inspection/debug API. |
| `debugListFs(root?, depth?)` | filesystem snapshot | Inspection/debug API. |
| `close()` | `void` | Terminates worker and rejects pending control requests. |

When family and version are omitted, catalog discovery defaults to
MicroPython and the highest stable value in `availableRuntimeVersions`.

## `SimpleLSPClient`

`SimpleLSPClient` is transport-agnostic and exposes raw JSON-RPC operations:

```js
const hover = await runtime.client.request("textDocument/hover", {
  textDocument: { uri: "file:///workspace/main.py" },
  position: { line: 0, character: 5 },
});

const unsubscribe = runtime.client.onNotification((method, params) => {
  if (method === "window/logMessage") console.log(params.message);
});
unsubscribe();
```

Call `client.disconnect()` before `transport.close()`. Disconnect rejects
pending LSP requests but does not own or close the transport.

## Diagnostics helpers

- `createWorkspaceDiagnosticsSubscription()` includes unopened files in
  workspace mode.
- `getWorkspaceDiagnostics()` returns a new flat snapshot with one-based
  positions.
- `removeWorkspaceDiagnosticsFor()` clears cached results for a URI.
- `lintKeymapExtension` provides F8 and Shift-F8 navigation.
- `requestDiagnostics()` uses pull diagnostics only when advertised; Pyright
  normally publishes diagnostics.
