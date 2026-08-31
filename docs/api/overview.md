# API overview

## Architecture

```{mermaid}
flowchart LR
    Host[Host application] --> Service[Optional lifecycle service]
    Service --> Client[LSP client]
    Host --> Client
    Client --> Manifest[Verified runtime manifest]
    Client <-->|Cache Storage| RuntimeCache[Last-known-good runtime]
    Client --> Transport[WorkerTransport]
    Transport <-->|postMessage| Worker[Pyright worker]
    Worker --> VFS[ZenFS workspace, typeshed, and stubs]
    Worker <-->|HTTPS| PyPI[PyPI package metadata and wheels]
    Worker <-->|IndexedDB| Cache[Persistent stub cache]
```

The host may use the LSP client directly, as the playground does, or place an
application service around it, as ViperIDE does.

## Published contracts

| Contract | Source of truth | Stability boundary |
|---|---|---|
| JavaScript package exports | [`packages/lsp-client/src/index.js`](../../packages/lsp-client/src/index.js) | Import only from this entry point. |
| Runtime selection | [`startWorkerRuntime`](../../packages/lsp-client/src/runtime-loader.js) | Host-selected manifest, digest cache, last-known-good, then bundled fallback. |
| Worker control messages | [`packages/pyright-worker/src/messages.d.ts`](../../packages/pyright-worker/src/messages.d.ts) | Correlated main-thread/worker protocol. |
| ViperIDE lifecycle adapter | [`TypecheckingService`](https://github.com/Josverl/ViperIDE/blob/typechecking_1/src/typechecking_service.js) | Reference integration; copied or imported by a host application. |
| Board asset metadata | `packages/pyright-worker/assets/stubs-manifest.json` | Runtime manifest, separate from package-release discovery. |
| Installable package identities | `packages/pyright-worker/assets/stub-package-catalog.json` | Package identities only; versions come from PyPI. |

## Lifecycle invariants

1. A `WorkerTransport` must finish `connect()` before LSP messages or control
   requests are sent.
2. A `SimpleLSPClient` connects to an already-connected transport.
   `createLSPClient()` performs both steps in the correct order.
3. Every open LSP document has a stable URI and monotonically increasing
   version.
4. Board changes, stub installation, and cache removal can change Pyright's
   filesystem. Restart the worker and reopen current documents after those
   operations.
5. Close editor subscriptions, the LSP client, the worker transport, and any
   worker Blob URL when the owning application is disposed.
6. A remote runtime becomes last-known-good only after worker and LSP startup
   succeeds; the worker never selects or updates its own runtime.

## Error model

- Programmer errors such as missing worker URLs or invalid workspace paths throw
  `TypeError`.
- Startup, request timeout, download, validation, and worker failures reject
  promises with `Error`.
- Package catalog discovery is partially tolerant: an unavailable PyPI project
  adds `error` to that catalog entry while other entries remain available.
- `requestDiagnostics()` is intentionally best-effort and returns an empty list
  when pull diagnostics are unsupported or fail. Push diagnostics remain the
  normal Pyright path.

## Browser requirements

- Web Workers and Blob URLs
- Cache Storage and localStorage for persistent last-known-good runtimes
- IndexedDB for persistent downloaded stubs
- `fetch`, streams, and `AbortSignal`
- ES modules and CodeMirror 6

Serve the application over HTTP(S); `file://` is not supported.
