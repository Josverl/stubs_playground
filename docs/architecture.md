# Architecture

This document describes the architecture of the MicroPython CodeMirror Editor — a static HTML5 page that runs Pyright as an LSP server entirely in the browser via a Web Worker, providing real-time diagnostics, autocompletion, and hover tooltips for MicroPython code. The page is deployable to GitHub Pages with zero server-side dependencies.

## Component Overview

Everything runs in the browser. CodeMirror handles the editing UI, an LSP client bridges it to Pyright running in a Web Worker, and Pyright uses bundled type stubs to understand MicroPython code.

```mermaid
graph LR
    subgraph Diagram["GitHub Pages | static site"]
        direction LR
        CDN["esm.sh CDN"] -->|ES modules| Editor
        
        subgraph Browser["Browser"]
            direction LR
            Editor["CodeMirror 6 Editor<br/>syntax, diagnostics,<br/>completions, hover"]
            LSP["LSP Client<br/>JSON-RPC 2.0<br/>over postMessage"]
            Worker["Pyright Web Worker<br/>+ typeshed<br/>+ MicroPython stubs"]
        end

        Editor <-->|"code changes,<br/>diagnostics,<br/>completions"| LSP
        LSP <-->|postMessage| Worker

        Stubs["Board Stubs<br/>(ESP32 · RP2 · STM32)"] -->|"loaded on<br/>board switch"| Worker
    end
    style Diagram fill:#4a9eff,stroke:#2d7ad6,color:#fff

    classDef component fill:#4a6fa5,stroke:#365880,color:#fff
    classDef external fill:#6a737d,stroke:#4a5056,color:#fff

    class Editor,LSP,Worker component
    class CDN,Stubs external

    style Browser fill:#e8e0d0,stroke:#999,stroke-width:2px,color:#333
```

For implementation details, see `packages/lsp-client/src/` (client layer),
`packages/pyright-worker/src/pyright-worker.ts` (worker entry), and
`apps/playground/app.js` (editor setup and board switching).

The playground imports reusable APIs only through
`apps/playground/component-source.js`. The `components=local|cdn` query parameter makes
that boundary resolve either workspace package files or immutable jsDelivr tags, so both
modes exercise the same application.

## LSP Communication Flow

When the user types code in the editor, changes are debounced and sent to Pyright via the LSP protocol over `postMessage`. Pyright analyzes the code against typeshed and board stubs, then pushes diagnostics back. The LSP client maps these to CodeMirror lint markers that appear as red squiggles.

```mermaid
sequenceDiagram
    participant User
    participant CM as CodeMirror Editor
    participant App as app.js
    participant Client as SimpleLSPClient
    participant WT as WorkerTransport
    participant Pyright as Pyright (Web Worker)
    participant VFS as ZenFS (typeshed + stubs)

    User->>CM: Types Python code
    CM->>App: Editor update event
    App->>App: Debounce timer (300ms)

    Note over App: Timer fires after<br/>user stops typing

    App->>Client: notifyDocumentChange(uri, content, version)
    Client->>WT: JSON-RPC notification:<br/>textDocument/didChange
    WT->>Pyright: postMessage(jsonrpc)

    Pyright->>VFS: Read typeshed builtins
    Pyright->>VFS: Read board stubs (/typings)
    Pyright->>Pyright: Analyze code

    Pyright->>WT: postMessage(jsonrpc)
    WT->>Client: JSON-RPC notification:<br/>textDocument/publishDiagnostics
    Client->>App: onNotification callback
    App->>App: convertLSPDiagnostic()<br/>(LSP positions → CM offsets,<br/>LSP severity → CM severity)
    App->>CM: setDiagnostics(state, diagnostics)
    CM->>User: Red squiggles + lint gutter markers

    Note over User,CM: Completion flow (on trigger)
    User->>CM: Types "machine."
    CM->>Client: request textDocument/completion
    Client->>WT: JSON-RPC request
    WT->>Pyright: postMessage
    Pyright->>VFS: Resolve "machine" module stubs
    Pyright->>WT: postMessage (completions)
    WT->>Client: JSON-RPC response
    Client->>CM: CompletionResult[]
    CM->>User: Autocomplete dropdown<br/>(Pin, PWM, I2C, SPI, ...)
```

## Board Switch Flow

When the user selects a different board (e.g., ESP32 → RP2040), the current worker is terminated and a new one is created with the target board's stubs. The LSP lifecycle restarts from scratch — initialize, open document, and diagnostics refresh.

```mermaid
sequenceDiagram
    participant User
    participant UI as Board Selector
    participant App as app.js
    participant OldWT as Old WorkerTransport
    participant OldW as Old Web Worker
    participant NewWT as New WorkerTransport
    participant NewW as New Web Worker
    participant Pyright as Pyright (new instance)

    User->>UI: Select "RP2040" from dropdown
    UI->>App: change event (boardId = "rp2")

    App->>App: Show loading indicator
    App->>App: fetchBoardStubs("rp2")<br/>(fetch stubs-rp2.zip or use cache)

    Note over App,OldW: Tear down old LSP

    App->>OldWT: client.disconnect()
    OldWT->>OldW: (cleanup)
    App->>OldWT: transport.close()
    OldWT->>OldW: worker.terminate()

    Note over App,NewW: Create new LSP with new stubs

    App->>NewWT: createTransport({mode: "worker",<br/>boardStubs: rp2ZipBuffer})
    App->>NewWT: transport.connect()
    NewWT->>NewW: new Worker("pyright_worker.js")
    NewW->>NewWT: {type: "serverLoaded"}
    NewWT->>NewW: {type: "initServer",<br/>boardStubs: rp2ZipBuffer}

    Note over NewW: ZenFS mounts:<br/>/typeshed-fallback (bundled zip)<br/>/typings (RP2040 stubs zip)

    NewW->>NewWT: {type: "serverInitialized"}

    NewWT->>Pyright: LSP initialize request
    Pyright->>NewWT: initialize response (capabilities)
    NewWT->>Pyright: initialized notification

    Note over App: Reconfigure CodeMirror<br/>LSP compartment

    App->>App: Clear old diagnostics
    App->>App: createLSPPlugin(newClient, view)
    App->>Pyright: textDocument/didOpen<br/>(current editor content)

    Pyright->>Pyright: Analyze with RP2040 stubs
    Pyright->>App: textDocument/publishDiagnostics
    App->>User: Updated diagnostics<br/>(RP2040-specific errors/completions)
    App->>App: Hide loading indicator
```

## Build Pipeline

The build process bundles Pyright, typeshed, and default board stubs into a single worker JS file. Board stub zips are also produced as separate files for on-demand loading.

```mermaid
flowchart LR
    subgraph Sources["Source Inputs"]
        PyrightSrc["Pyright source<br/>(node_modules/pyright)"]
        TypeshedSrc["typeshed-fallback/<br/>(bundled with Pyright)"]
        WorkerTS["packages/pyright-worker/src/<br/>pyright-worker.ts"]
        StubPkgs["micropython-*-stubs<br/>(pip packages)"]
    end

    subgraph Scripts["Build Scripts"]
        PackTS["scripts/<br/>pack-typeshed.mjs"]
        PackStubs["scripts/<br/>pack-stubs.mjs"]
        WP["webpack<br/>(webpack.config.cjs)"]
    end

    subgraph Intermediates["Intermediate Artifacts"]
        TSZip["packages/pyright-worker/assets/<br/>typeshed-fallback.zip"]
        ESP32Zip["packages/pyright-worker/assets/<br/>stubs-esp32.zip"]
        RP2Zip["packages/pyright-worker/assets/<br/>stubs-rp2.zip"]
        STM32Zip["packages/pyright-worker/assets/<br/>stubs-stm32.zip"]
        ManifestOut["packages/pyright-worker/assets/<br/>stubs-manifest.json"]
    end

    subgraph Output["Deployable Output (Static Files)"]
        WorkerJS["packages/pyright-worker/dist/<br/>pyright_worker.js"]
        StubFiles["packages/pyright-worker/assets/<br/>stubs-*.zip"]
        StaticHTML["apps/playground/<br/>index.html + styles.css + app.js"]
        ExamplesPy["apps/playground/examples/*.py"]
    end

    TypeshedSrc -->|"zip -r"| PackTS
    PackTS --> TSZip
    StubPkgs -->|"uv pip install<br/>--target tmp"| PackStubs
    PackStubs --> ESP32Zip
    PackStubs --> RP2Zip
    PackStubs --> STM32Zip
    PackStubs --> ManifestOut

    WorkerTS --> WP
    PyrightSrc --> WP
    TSZip -->|"arraybuffer-loader<br/>(inlined)"| WP
    ESP32Zip -->|"arraybuffer-loader<br/>(inlined as default)"| WP
    WP --> WorkerJS

    RP2Zip --> StubFiles
    STM32Zip --> StubFiles
    ManifestOut --> StubFiles
    WorkerJS --> Output
    StaticHTML --> Output
    ExamplesPy --> Output

    classDef source fill:#4a9eff,stroke:#2d7ad6,color:#fff
    classDef script fill:#6f42c1,stroke:#5a32a3,color:#fff
    classDef intermediate fill:#e36209,stroke:#c45508,color:#fff
    classDef output fill:#22863a,stroke:#1a6b2e,color:#fff

    class PyrightSrc,TypeshedSrc,WorkerTS,StubPkgs source
    class PackTS,PackStubs,WP script
    class TSZip,ESP32Zip,RP2Zip,STM32Zip,ManifestOut intermediate
    class WorkerJS,StubFiles,StaticHTML,ExamplesPy output
```

**Key details:**
- **typeshed-fallback.zip** and **stubs-esp32.zip** are inlined into the worker bundle via `arraybuffer-loader`, so the default board works with zero additional fetches.
- Non-default board stubs (RP2, STM32) are fetched on demand and cached in memory (`stubsCache` Map).
- The webpack config targets `webworker`, polyfills Node APIs (fs → ZenFS, path, crypto, etc.), and uses `ts-loader` in transpile-only mode.
- `fs` is aliased to `@zenfs/core` so Pyright's filesystem calls work against the in-browser virtual filesystem.
