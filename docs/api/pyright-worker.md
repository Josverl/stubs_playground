# Pyright worker API

`@mp-codemirror/pyright-worker` is a prebuilt classic Web Worker containing
Pyright, ZenFS, typeshed, and bundled MicroPython stubs. The stable control
contract is declared in
[`messages.d.ts`](../../packages/pyright-worker/src/messages.d.ts).

## Starting a CDN worker

A browser cannot construct a cross-origin worker directly. Create a same-origin
Blob shim:

```js
const remoteWorker =
  "https://cdn.jsdelivr.net/gh/Josverl/stubs_playground@" +
  "pyright-worker-v0.2.4/packages/pyright-worker/dist/pyright_worker.js";

const shim = `importScripts(${JSON.stringify(remoteWorker)});`;
const workerUrl = URL.createObjectURL(
  new Blob([shim], { type: "application/javascript" }),
);
```

Revoke `workerUrl` after terminating the worker.

## Startup protocol

```{mermaid}
sequenceDiagram
    participant Host
    participant Worker
    Host->>Worker: new Worker(workerUrl)
    Worker-->>Host: {type: "serverLoaded"}
    Host->>Worker: {type: "initServer", ...}
    Worker-->>Host: {type: "serverInitialized", pyrightVersion}
    Host->>Worker: LSP initialize request
    Worker-->>Host: LSP initialize response
```

The host must wait for `serverLoaded` before sending `initServer`, and wait for
`serverInitialized` before normal LSP traffic. `WorkerTransport.connect()`
implements this sequence.

Important `initServer` properties:

| Property | Behavior |
|---|---|
| `workspaceFiles` | Creates text files below `/workspace` before Pyright starts. |
| `boardStubs` | Archive buffer, `false` for none, or `undefined` for bundled default. |
| `boardStubsUrl` | HTTPS fallback fetched only when a preferred cached board package is unavailable. |
| `boardStubPackage` | Cached package mounted as `/typings`; may permit bundled fallback. |
| `typeCheckingMode` | Pyright checking mode. |
| `typeshedPath` | Worker-VFS typeshed path. |
| `pythonVersion` | Python `X.Y` version. |
| `extraStubPackages` | Host-supplied type-only files mounted under `/extra/<package>`. |
| `extraPaths` | Additional absolute import roots. |

## Raw control messages

Every request/response operation uses a caller-generated `requestId`.

| Request | Response | Purpose |
|---|---|---|
| `syncFile` | none | Write one complete workspace file. |
| `deleteFile` | none | Delete one workspace file. |
| `listStubPackages` | `listStubPackagesResult` | Discover catalog releases from PyPI. |
| `installStubPackage` | `installStubPackageResult` | Download, validate, extract, and persist a wheel. |
| `listInstalledStubPackages` | `listInstalledStubPackagesResult` | Read persistent cache metadata. |
| `clearStubPackages` | `clearStubPackagesResult` | Remove one version, one package, or all packages. |
| `readGeneratedConfig` | `readGeneratedConfigResult` | Inspect generated `pyproject.toml`. |
| `debugListFs` | `debugListFsResult` | Inspect the worker VFS. |

```js
worker.postMessage({
  type: "listInstalledStubPackages",
  requestId: crypto.randomUUID(),
});
```

Use `WorkerTransport` unless implementing another compatible transport; it
provides timeouts, correlation, validation, and teardown.

## Runtime stub packages

### Discovery

`listStubPackages(filters?)` reads package identities from the worker catalog
and asks PyPI for current releases. Filters may include `family`, `version`,
`port`, and `board`. MicroPython version matching compares major and minor
only, so `1.28.0` also selects package metadata for patch and post releases in
the `1.28` line. If family and version are omitted, the worker selects
MicroPython and the highest non-preview value in `availableRuntimeVersions`.
The worker prefers stable releases with compatible universal wheels. Versions
are not pinned to the worker release.

`getStubPackageCatalog(filters?)` returns `packages`,
`availableRuntimeVersions`, and `defaultRuntimeVersion`. `listStubPackages()`
is the package-array convenience wrapper.

Each catalog item includes:

- `id`, `packageName`, `label`, and `kind`
- `family`, `runtimeVersions`, `port`, and `board`
- `latestVersion`
- compatible `versions`, including filename, byte size, and upload timestamp
- `installedVersion` when an active cached version exists
- `error` when that package could not be discovered

### Installation

```js
const catalog = await transport.listStubPackages({
  family: "micropython",
  version: "1.28.0",
  port: "rp2",
});
const rp2 = catalog.find(item => item.id === "rp2");

const installed = await transport.installStubPackage(
  rp2.packageName,
  `==${rp2.latestVersion}`,
);
```

Supported constraints include exact and comparison forms such as `==`, `!=`,
`~=`, `>=`, `<=`, `>`, and `<`. Prereleases are ignored unless explicitly
requested.

The worker:

1. resolves a compatible universal wheel from PyPI;
2. restricts download origin and archive paths;
3. enforces download, file-count, and extracted-size limits;
4. accepts type-only content, with narrowly allowed MicroPython support modules;
5. stores one atomic package record in IndexedDB; and
6. marks only the newest installed version active.

Known board packages may resolve their declared stub dependencies. Arbitrary
unlisted type-only packages, such as `types-requests`, are accepted but their
dependencies are not recursively downloaded. Unlisted MicroPython/CircuitPython
board packages are rejected because board packages must be selected explicitly.

### Persistence and activation

The IndexedDB database is `mp-codemirror-stub-packages`, store `packages`.
Records are restored before Pyright configuration is generated on later worker
starts.

Installing or clearing the cache does not mutate the running Pyright
filesystem. Restart the worker and reopen documents. The raw result includes
`restartRequired`; ViperIDE's service performs that restart automatically.

### Clearing

```js
await transport.clearStubPackages("types-requests", "2.32.4.20260107");
await transport.clearStubPackages("types-requests");
await transport.clearStubPackages();
```

The three forms remove one version, all versions of one package, or the complete
cache respectively.

## Virtual filesystem

| Path | Contents |
|---|---|
| `/workspace` | Host project files. |
| `/typings` | Active board package or board archive. |
| `/extra/<package>` | Generic cached or supplied type packages. |
| `/typeshed-fallback` | Bundled CPython typeshed fallback. |
| `/typeshed-micropython` | Bundled MicroPython-oriented typeshed content. |

Board packages are excluded from generic `/extra` mounting to prevent
cross-board leakage.
