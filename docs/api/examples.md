# Integration examples

## TypeScript editor setup

The package ships generated declarations, so the same API is fully typed. Only
the imports differ from the JavaScript examples below.

```ts
import { EditorView } from "@codemirror/view";
import {
  createLSPClient,
  createLSPPlugin,
  notifyDocumentChange,
  type LSPClientConfig,
  type LSPClientResult,
  type WorkspaceDiagnostic,
} from "@mp-codemirror/lsp-client";

const config: LSPClientConfig = {
  workerUrl,
  typeCheckingMode: "standard",
  diagnosticMode: "workspace",
  onWorkspaceDiagnosticsChange(diagnostics: WorkspaceDiagnostic[]) {
    for (const diagnostic of diagnostics) {
      console.log(`${diagnostic.fileName}:${diagnostic.line} ${diagnostic.message}`);
    }
  },
};

const runtime: LSPClientResult = await createLSPClient(config);

const fileUri = "file:///workspace/main.py";
let version = 1;

function attach(view: EditorView) {
  return createLSPPlugin(runtime.client, view, {
    fileUri,
    initialContent: view.state.doc.toString(),
  });
}

function onChange(view: EditorView): void {
  notifyDocumentChange(runtime.client, fileUri, view.state.doc.toString(), ++version);
}
```

## Complete CodeMirror lifecycle

```js
import { Compartment } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  createLSPClient,
  createLSPPlugin,
  notifyDocumentChange,
  notifyDocumentClose,
} from "@mp-codemirror/lsp-client";

const remoteWorker =
  "https://cdn.jsdelivr.net/npm/@mp-codemirror/pyright-worker@0.4.3" +
  "/dist/pyright_worker.js";
const workerUrl = URL.createObjectURL(new Blob(
  [`importScripts(${JSON.stringify(remoteWorker)});`],
  { type: "application/javascript" },
));

const lsp = new Compartment();
const uri = "file:///workspace/main.py";
let version = 1;

const view = new EditorView({
  parent: document.querySelector("#editor"),
  doc: "import machine\n",
  extensions: [lsp.of([])],
});

const runtime = await createLSPClient({
  workerUrl,
  typeCheckingMode: "standard",
});

view.dispatch({
  effects: lsp.reconfigure(createLSPPlugin(runtime.client, view, {
    fileUri: uri,
    initialContent: view.state.doc.toString(),
    diagnosticDelayMs: 300,
  })),
});

function publishChange() {
  notifyDocumentChange(
    runtime.client,
    uri,
    view.state.doc.toString(),
    ++version,
  );
}

async function dispose() {
  notifyDocumentClose(runtime.client, uri);
  runtime.workspaceDiagnosticsSubscription?.destroy();
  await runtime.client.disconnect();
  runtime.transport.close();
  view.destroy();
  URL.revokeObjectURL(workerUrl);
}
```

In a real editor, call `publishChange()` from a CodeMirror update listener only
when `update.docChanged` is true.

## Install a user-selected PyPI package

```js
const [packageName, versionSpecifier] = [
  "types-requests",
  "==2.32.4.20260107",
];

const metadata = await runtime.transport.installStubPackage(
  packageName,
  versionSpecifier,
);
console.log(`Cached ${metadata.packageName} ${metadata.version}`);

// Required: create a replacement worker so /extra contains the new package.
runtime.workspaceDiagnosticsSubscription?.destroy();
await runtime.client.disconnect();
runtime.transport.close();

const replacement = await createLSPClient({
  workerUrl,
  workspaceFiles: currentWorkspaceFiles,
});
rebindOpenEditors(replacement.client);
```

If the host uses `TypecheckingService`, call its `installStubPackage()` instead;
the restart and editor rebinding are automatic.

## Select the latest matching runtime stub package

```js
const catalog = await runtime.transport.getStubPackageCatalog({
  port: "esp32",
  board: "GENERIC",
});
const target = catalog.packages[0];

if (!target) throw new Error("ESP32 stubs are unavailable");
if (target.error) throw new Error(target.error);

console.log(`Using MicroPython ${catalog.defaultRuntimeVersion}`);

await runtime.transport.installStubPackage(
  target.packageName,
  `==${target.latestVersion}`,
);

// On the replacement runtime:
const config = {
  workerUrl,
  boardStubPackage: {
    packageName: board.packageName,
    version: board.latestVersion,
    fallbackToBundled: true,
  },
  boardStubsUrl: publishedEsp32ArchiveUrl,
};
```

The fallback URL keeps first-run/offline behavior available if the requested
cached package is absent.

## Multi-file workspace diagnostics

```js
const runtime = await createLSPClient({
  workerUrl,
  diagnosticMode: "workspace",
  workspaceFiles: {
    "main.py": "from lib.sensor import read\n",
    "lib/sensor.py": "def read() -> int:\n    return 'bad'\n",
  },
  onWorkspaceDiagnosticsChange(diagnostics) {
    diagnosticsPanel.replace(diagnostics);
  },
});

runtime.transport.syncWorkspaceFile(
  "lib/sensor.py",
  "def read() -> int:\n    return 42\n",
);
runtime.client.notify("workspace/didChangeWatchedFiles", {
  changes: [{
    uri: "file:///workspace/lib/sensor.py",
    type: 2,
  }],
});
```

Updating the VFS alone does not guarantee immediate analysis. Send
`workspace/didChangeWatchedFiles` for unopened files.

## Failure handling

```js
try {
  await service.initialize(config);
} catch (error) {
  showTypecheckingError(error.message);
}

const stopWatching = service.onStatusChange(snapshot => {
  setBusy(snapshot.status === "starting" || snapshot.status === "switching");
  if (snapshot.status === "error") {
    showTypecheckingError(snapshot.error?.message ?? String(snapshot.error));
  }
});
```

Do not convert startup or installation failures into success-shaped empty data.
Surface the failure and let the user retry.
