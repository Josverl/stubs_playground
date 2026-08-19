/** Message types for main thread ↔ worker communication */
export interface UserFolder {
    [key: string]: UserFolder | string | ArrayBuffer;
}
export interface MsgServerLoaded {
    type: "serverLoaded";
}
export interface MsgInitServer {
    type: "initServer";
    /** User type stubs as nested folder structure */
    userFiles: UserFolder;
    /** Project files written into /workspace before Pyright starts */
    workspaceFiles?: Record<string, string>;
    /** Legacy custom typeshed override (unused by current worker implementation) */
    typeshedFallback?: ArrayBuffer | false | undefined;
    /** Board stubs zip (ArrayBuffer), or false to skip, or undefined to use bundled default */
    boardStubs: ArrayBuffer | false | undefined;
    /** Absolute fallback archive URL fetched only when no selected cached package exists */
    boardStubsUrl?: string;
    /** Cached PyPI package to materialize as /typings instead of boardStubs */
    boardStubPackage?: StubPackageSelection;
    /** Pyright type checking mode: off, basic, standard, strict */
    typeCheckingMode?: string;
    /** Pyright typeshedPath, e.g. /typeshed-micropython or /typeshed-fallback */
    typeshedPath?: string;
    /** Pyright pythonVersion in X.Y format */
    pythonVersion?: string;
    /** Pyright verboseOutput */
    verboseOutput?: boolean;
    /** Additional type-only stub packages materialized under /extra/<packageName> */
    extraStubPackages?: ExtraStubPackage[];
    /** Absolute extra search paths used for LSP workspace/configuration */
    extraPaths?: string[];
}
export interface ExtraStubPackage {
    packageName: string;
    files: Record<string, string>;
}
export interface StubPackageSelection {
    packageName: string;
    version?: string;
    /** Use boardStubs when the requested package is not cached */
    fallbackToBundled?: boolean;
}
export interface StubPackageCatalogEntry {
    id: string;
    packageName: string;
    label: string;
    kind: "stdlib" | "firmware";
    family: "micropython" | "circuitpython";
    runtimeVersions: string[];
    port: string;
    board: string;
}
export interface StubPackageFilters {
    family?: "micropython" | "circuitpython";
    version?: string;
    port?: string;
    board?: string;
}
export interface StubPackageRelease {
    version: string;
    filename: string;
    size: number;
    uploadTime: string;
}
export interface StubPackageCatalogResultEntry extends StubPackageCatalogEntry {
    latestVersion: string;
    versions: StubPackageRelease[];
    installedVersion?: string;
    error?: string;
}
export interface InstalledStubPackage {
    packageName: string;
    version: string;
    wheelFilename: string;
    wheelUrl: string;
    installedAt: number;
    fileCount: number;
    active: boolean;
}
export interface MsgListStubPackages {
    type: "listStubPackages";
    requestId: string;
    filters?: StubPackageFilters;
}
export interface MsgListStubPackagesResult {
    type: "listStubPackagesResult";
    requestId: string;
    ok: boolean;
    packages: StubPackageCatalogResultEntry[];
    availableRuntimeVersions: string[];
    defaultRuntimeVersion: string;
    error?: string;
}
export interface MsgInstallStubPackage {
    type: "installStubPackage";
    requestId: string;
    packageName: string;
    versionSpecifier?: string;
}
export interface MsgInstallStubPackageResult {
    type: "installStubPackageResult";
    requestId: string;
    ok: boolean;
    package?: InstalledStubPackage;
    restartRequired: boolean;
    error?: string;
}
export interface MsgListInstalledStubPackages {
    type: "listInstalledStubPackages";
    requestId: string;
}
export interface MsgListInstalledStubPackagesResult {
    type: "listInstalledStubPackagesResult";
    requestId: string;
    ok: boolean;
    packages: InstalledStubPackage[];
    error?: string;
}
export interface MsgClearStubPackages {
    type: "clearStubPackages";
    requestId: string;
    packageName?: string;
    version?: string;
}
export interface MsgClearStubPackagesResult {
    type: "clearStubPackagesResult";
    requestId: string;
    ok: boolean;
    removed: number;
    restartRequired: boolean;
    error?: string;
}
export interface MsgServerInitialized {
    type: "serverInitialized";
    pyrightVersion: string;
    /** Per-phase init timings in ms; only sent when `verboseOutput` is enabled */
    startupTimings?: Record<string, number>;
}
export interface MsgServerError {
    type: "serverError";
    error: string;
}
export interface MsgSyncFile {
    type: "syncFile";
    /** File path relative to /workspace (e.g. "helpers.py" or "lib/utils.py") */
    path: string;
    /** File text content */
    content: string;
}
export interface MsgDeleteFile {
    type: "deleteFile";
    /** File path relative to /workspace */
    path: string;
}
export interface MsgDebugListFs {
    type: "debugListFs";
    /** Correlation id for matching request/response */
    requestId: string;
    /** Root path to inspect, e.g. /typings or /workspace */
    root?: string;
    /** Max depth from root. 0 means root only. */
    depth?: number;
}
export interface MsgDebugListFsResult {
    type: "debugListFsResult";
    requestId: string;
    ok: boolean;
    root: string;
    entries: Array<{
        path: string;
        kind: "file" | "dir";
        depth: number;
        size?: number;
    }>;
    error?: string;
}
export interface MsgReadGeneratedConfig {
    type: "readGeneratedConfig";
    /** Correlation id for matching request/response */
    requestId: string;
}
export interface MsgReadGeneratedConfigResult {
    type: "readGeneratedConfigResult";
    requestId: string;
    ok: boolean;
    content: string;
    error?: string;
}
export type WorkerMessage = MsgServerLoaded | MsgInitServer | MsgServerInitialized | MsgServerError | MsgSyncFile | MsgDeleteFile | MsgDebugListFs | MsgDebugListFsResult | MsgReadGeneratedConfig | MsgReadGeneratedConfigResult | MsgListStubPackages | MsgListStubPackagesResult | MsgInstallStubPackage | MsgInstallStubPackageResult | MsgListInstalledStubPackages | MsgListInstalledStubPackagesResult | MsgClearStubPackages | MsgClearStubPackagesResult;
