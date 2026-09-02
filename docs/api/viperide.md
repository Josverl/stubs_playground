# ViperIDE integration

ViperIDE demonstrates how a multi-editor, device-aware application can own the
reusable LSP client. 
Viper IDE is a stand-alone project.

Source:

- [`typechecking_service.js`](https://github.com/Josverl/ViperIDE/blob/typechecking_1/src/typechecking_service.js)
- [`typechecking_assets.js`](https://github.com/Josverl/ViperIDE/blob/typechecking_1/src/typechecking_assets.js)
- [`typechecking_settings.js`](https://github.com/Josverl/ViperIDE/blob/typechecking_1/src/typechecking_settings.js)
- [`typechecking_workspace.js`](https://github.com/Josverl/ViperIDE/blob/typechecking_1/src/typechecking_workspace.js)

## `TypecheckingService`

One service owns:

- worker and LSP client startup/teardown;
- all open CodeMirror document bindings;
- a mirror of unopened Python workspace files;
- board/stub switching;
- stub package installation and automatic restart; and
- lifecycle and diagnostics snapshots.

Dependencies are injected so the class has no direct DOM or device dependency:

```js
const service = new TypecheckingService({
  createLSPClient,
  createLSPPlugin,
  notifyDocumentChange,
  notifyDocumentClose,
  switchBoard,
  prepareRuntime: config => assets.prepare(config),
  configureEditor(view, extensions) {
    view.dispatch({
      effects: lspCompartment.reconfigure(extensions),
    });
    return true;
  },
  revokeObjectURL(url) {
    URL.revokeObjectURL(url);
    assets.releaseWorkerBlobUrl(url);
  },
});
```

### Lifecycle

```js
const unsubscribe = service.onStatusChange(snapshot => {
  console.log(snapshot.status, snapshot.error);
});

const config = {
  typeCheckingMode: "standard",
  diagnosticMode: "workspace",
  boardId: "esp32",
};
await service.initialize(config);

service.disable();       // retains bindings and mirrored files
await service.initialize(config);
service.dispose();       // permanent teardown
unsubscribe();
```

Status values are `idle`, `starting`, `ready`, `switching`, `disabled`,
`error`, and `disposed`. Concurrent `initialize()` calls share one promise.
Initialization while ready returns the current snapshot.

`dispose()` increments a generation guard so a late worker handshake cannot
resurrect a disposed service.

### Editor bindings

```js
await service.bindEditor(view, "/main.py");

// Call from the host's CodeMirror update listener.
service.changeEditor(view, view.state.doc.toString());

service.renamePath("/main.py", "/src/main.py");
service.unbindEditor(view);
```

Paths are normalized below `/workspace`; empty, `.` and `..` segments are
rejected. Binding before initialization is supported. During board switching,
new binding waits for the replacement runtime.

### Workspace mirroring

```js
service.hydrateWorkspace({
  "/main.py": "import helpers\n",
  "/helpers.py": "answer = 42\n",
});

service.replaceWorkspace(deviceFiles, {
  preservePaths: unreadableDevicePaths,
});
```

Only `.py` string entries are mirrored. Open unsaved editor content wins over a
device snapshot. `replaceWorkspace()` returns `{synced, deleted, total}`.

Use `syncDevicePythonWorkspace()` for ViperIDE-style device mirroring. It reads
files sequentially because raw-mode commands cannot overlap and preserves files
whose device read failed.

### Board selection

```js
await service.selectDevice(deviceInfo);   // infer from sys.platform
await service.selectStubBundle("rp2");    // explicit override
```

MicroPython uses `sys.platform` as the authoritative board target.
CircuitPython is detected from its identity text. Unsupported devices leave the
current target unchanged.

Switching creates a new worker, synchronizes the workspace, and rebinds every
editor with its current content.

### Stub package management

```js
const available = await service.listStubPackages();
const installed = await service.listInstalledStubPackages();

await service.installStubPackage("types-requests", ">=2.32,<3");
await service.clearStubPackages("types-requests");
```

Unlike the low-level transport, `installStubPackage()` restarts Pyright after a
successful installation. `clearStubPackages()` restarts only when the worker
reports `restartRequired`.

Read-only package queries wait for an active initialization, board switch, or
restart and retry when their transport was replaced. Mutating operations are
not automatically retried, avoiding duplicate side effects.

## `TypecheckingAssets`

`TypecheckingAssets` loads board metadata and returns config for
`createLSPClient()`. The production singleton selects the deployed
`runtime-manifest.json`, permits its exact origin, and keeps the copied npm
worker as the deterministic bundled fallback:

```js
const assets = new TypecheckingAssets();
const runtimeConfig = await assets.prepare({ boardId: "esp32" });
```

Custom hosts may override or explicitly disable `runtimeManifestUrl`,
`runtimeAllowedOrigins`, `runtimeCacheName`, and `runtimeStorageKey`. The
reusable client verifies and caches the selected runtime; ViperIDE exposes
`runtimeSource`, `runtimeId`, `runtimeManifest`, and `runtimeFallbacks` through
the service snapshot and status presentation. Runtime incompatibility and
fallback details are therefore actionable without making the worker
self-update.

`prepare()` prefers an active cached board package and configures the published
board archive as its fallback.

### Viper tools overlay

ViperIDE can enable its bundled tool-module stubs independently from the active
board package:

```js
const runtimeConfig = await assets.prepare({
  boardId: "esp32",
  viperToolsStubs: true,
});
```

The returned `extraStubArchives` entry references ViperIDE's pinned
`viper-tools-stubs` wheel with its exact size, SHA-256 digest, and allowed
origin. `createLSPClient()` forwards that public configuration unchanged. The
worker mounts the verified type-only archive under `/extra/viper-tools-stubs`
and adds it to Pyright automatically; hosts must not add that path manually.

Passing `viperToolsStubs: false` omits the bundled overlay without changing the
selected board stubs or deleting cached packages. Explicit caller-provided
`extraStubArchives` remain supported and may replace the bundled entry by
package name.

#### Ownership boundary

The overlay is a ViperIDE release asset, not a Pyright-worker asset. The
responsibilities are deliberately split:

| ViperIDE | Reusable packages |
|---|---|
| Chooses the `viper-tools-stubs` version. | Accept any host-provided type-only archive through `extraStubArchives`. |
| Obtains and bundles or publishes the wheel. | Forward the descriptor without client-specific policy. |
| Computes and supplies size, SHA-256, URL/data, and allowed origins. | Verify integrity and archive safety before use. |
| Owns the default-on setting, restart, errors, and update cadence. | Mount accepted stubs under a normalized `/extra/<package>` path. |

Neither `@mp-typing/lsp-client` nor `@mp-typing/pyright-worker` produces or
includes the Viper tools wheel. They contain no ViperIDE-specific package or
version knowledge. A different application can use the same API with its own
archive without requesting a backend release.

## Settings helpers

| Helper | Behavior |
|---|---|
| `normalizeTypecheckingMode()` | Allows `basic`, `standard`, or `strict`; defaults to `standard`. |
| `normalizeTypecheckingScope()` | Allows `openFilesOnly` or `workspace`; defaults to `workspace`. |
| `normalizeTypecheckingBoard()` | Allows supported board IDs or `auto`. |
| `resolveTypecheckingBoard()` | Resolves `auto` from connected-device metadata. |
| `parseStubPackageSpecifier()` | Splits and normalizes a package plus optional constraint. |
| `typecheckingBoardOptions()` | Adds manifest or active cached versions to selector labels. |
| `typecheckingRuntimeConfig()` | Maps persisted UI settings to LSP runtime config. |

```js
const request = parseStubPackageSpecifier(
  "micropython-rp2-stubs==1.28.0.post1",
);
// {packageName: "micropython-rp2-stubs", versionSpecifier: "==1.28.0.post1"}
```
