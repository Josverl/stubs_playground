/**
 * Transport that adapts a classic Web Worker to the string-based interface
 * expected by {@link SimpleLSPClient}.
 */
export class WorkerTransport {
    /**
     * @param {string} workerUrl - Worker script or same-origin Blob URL.
     * @param {WorkerTransportOptions} [options={}] - Worker initialization options.
     * @throws {TypeError} If `workerUrl` is missing.
     */
    constructor(workerUrl: string, options?: WorkerTransportOptions);
    workerUrl: string;
    /** @type {Worker|null} */
    worker: Worker | null;
    /** @type {Array<(message: string) => void>} */
    messageHandlers: Array<(message: string) => void>;
    /** @type {Array<(error: Error|ErrorEvent) => void>} */
    errorHandlers: Array<(error: Error | ErrorEvent) => void>;
    connected: boolean;
    /** @type {string[]} */
    _messageQueue: string[];
    _connectReject: (reason?: any) => void;
    _boardStubs: false | ArrayBuffer;
    _boardStubsUrl: string;
    _boardStubPackage: {
        packageName: string;
        version?: string;
        fallbackToBundled?: boolean;
    };
    _typeCheckingMode: string;
    _typeshedPath: string;
    _pythonVersion: string;
    _verboseOutput: boolean;
    _extraStubPackages: {
        packageName: string;
        files: {
            [x: string]: string;
        };
    }[];
    _extraPaths: string[];
    _workspaceFiles: {
        [x: string]: string;
    };
    /** @type {Map<string, {resolve: (value: any) => void, reject: (reason?: unknown) => void, timeout?: ReturnType<typeof setTimeout>}>} */
    _debugRequests: Map<string, {
        resolve: (value: any) => void;
        reject: (reason?: unknown) => void;
        timeout?: ReturnType<typeof setTimeout>;
    }>;
    /** @type {Map<string, {resolve: (value: any) => void, reject: (reason?: unknown) => void, timeout?: ReturnType<typeof setTimeout>}>} */
    _generatedConfigRequests: Map<string, {
        resolve: (value: any) => void;
        reject: (reason?: unknown) => void;
        timeout?: ReturnType<typeof setTimeout>;
    }>;
    /** @type {Map<string, {resolve: (value: any) => void, reject: (reason?: unknown) => void, timeout?: ReturnType<typeof setTimeout>}>} */
    _stubPackageRequests: Map<string, {
        resolve: (value: any) => void;
        reject: (reason?: unknown) => void;
        timeout?: ReturnType<typeof setTimeout>;
    }>;
    pyrightVersion: string;
    /**
     * @param {WorkerResponseMessage} msg - Worker control message.
     * @returns {boolean} Whether the message was consumed.
     */
    _handleDebugResponse(msg: WorkerResponseMessage): boolean;
    /**
     * @param {WorkerResponseMessage} msg - Worker control message.
     * @returns {boolean} Whether the message was consumed.
     */
    _handleGeneratedConfigResponse(msg: WorkerResponseMessage): boolean;
    /**
     * @param {WorkerResponseMessage} msg - Worker control message.
     * @returns {boolean} Whether the message was consumed.
     */
    _handleStubPackageResponse(msg: WorkerResponseMessage): boolean;
    /**
     * Create the worker, run the handshake, resolve when ready for LSP.
     *
     * @returns {Promise<void>} Resolves after `serverInitialized`.
     * @throws {Error} If worker creation fails, initialization times out, or the
     *   worker reports a server error.
     */
    connect(): Promise<void>;
    /**
     * Steady-state message handler — separates control from LSP messages.
     *
     * @param {MessageEvent<WorkerResponseMessage>} e - Worker message event.
     * @returns {void}
     */
    _onSteadyStateMessage(e: MessageEvent<WorkerResponseMessage>): void;
    /**
     * Forward an LSP message object to subscribers as a JSON string.
     *
     * @param {unknown} msg - JSON-RPC message object.
     * @returns {void}
     */
    _dispatchLSP(msg: unknown): void;
    /**
     * Send a JSON-RPC string to the worker (parsed to object first).
     *
     * Invalid JSON and sends attempted while disconnected are logged and ignored.
     *
     * @param {string|Object} message - JSON-RPC message string or object.
     * @returns {void}
     */
    send(message: string | Object): void;
    /**
     * Subscribe to LSP messages (matches WebSocketTransport interface).
     *
     * @param {(message: string) => void} handler - Receives JSON-RPC strings.
     * @returns {void}
     */
    subscribe(handler: (message: string) => void): void;
    /**
     * Unsubscribe from messages.
     *
     * @param {(message: string) => void} handler - Previously subscribed handler.
     * @returns {void}
     */
    unsubscribe(handler: (message: string) => void): void;
    /**
     * Register a message handler (legacy interface).
     *
     * @param {(message: string) => void} handler - Receives JSON-RPC strings.
     * @returns {void}
     */
    onMessage(handler: (message: string) => void): void;
    /**
     * Register an error handler.
     *
     * @param {(error: Error|ErrorEvent) => void} handler - Worker error callback.
     * @returns {void}
     */
    onError(handler: (error: Error | ErrorEvent) => void): void;
    /**
     * Terminate the worker and reset state.
     *
     * Pending debug/config requests reject with an `Error`.
     *
     * @returns {void}
     */
    close(): void;
    _cleanup(): void;
    /**
     * Check if connected.
     *
     * @returns {boolean} Whether a worker exists and completed initialization.
     */
    isConnected(): boolean;
    /**
     * Write a text file into the worker's `/workspace` filesystem.
     *
     * @param {string} path - Workspace-relative path using forward slashes.
     * @param {string} content - Complete text file content.
     * @returns {void}
     * @throws {Error} If the transport is disconnected.
     * @throws {TypeError} If the path or content is invalid.
     */
    syncWorkspaceFile(path: string, content: string): void;
    /**
     * Delete a file from the worker's `/workspace` filesystem.
     *
     * @param {string} path - Workspace-relative path using forward slashes.
     * @returns {void}
     * @throws {Error} If the transport is disconnected.
     * @throws {TypeError} If the path is invalid.
     */
    deleteWorkspaceFile(path: string): void;
    /**
     * Debug helper: list worker virtual filesystem entries from a root path.
     *
     * @param {string} [root='/typings'] - Absolute worker-VFS root to inspect.
     * @param {number} [depth=2] - Maximum traversal depth.
     * @returns {Promise<{root: string, entries: WorkerFsEntry[]}>} Filesystem snapshot.
     * @throws {Error} If disconnected, the worker rejects the request, or the
     *   request exceeds its five-second timeout.
     */
    debugListFs(root?: string, depth?: number): Promise<{
        root: string;
        entries: WorkerFsEntry[];
    }>;
    /**
     * Read generated pyproject.toml content from worker VFS.
     *
     * @returns {Promise<string>} Generated configuration text.
     * @throws {Error} If disconnected, the worker rejects the request, or the
     *   request exceeds its five-second timeout.
     */
    readGeneratedConfig(): Promise<string>;
    /**
     * @param {string} type - Stub-package request message type.
     * @param {Object} [payload={}] - Request payload.
     * @param {number} [timeoutMs=30000] - Request timeout in milliseconds.
     * @returns {Promise<WorkerResponseMessage>} Resolves with the worker response.
     */
    _requestStubPackage(type: string, payload?: Object, timeoutMs?: number): Promise<WorkerResponseMessage>;
    /**
     * Query current installable releases for the worker's supported stub packages.
     *
     * Package identities are worker-defined, while release versions come from
     * PyPI at request time and are not pinned to the worker release.
     *
     * Discovery failures are reported in an entry's `error` property so one
     * unavailable PyPI project does not discard the rest of the catalog.
     *
    * @param {{family?: string, version?: string, port?: string, board?: string}} [filters={}] -
    *   Firmware metadata used to limit package and PyPI release discovery.
    * @returns {Promise<{packages: StubPackageCatalogEntry[], availableRuntimeVersions: string[], defaultRuntimeVersion: string}>} Catalog entries, installable runtime versions, and the default runtime version.
     * @throws {Error} If disconnected, the worker rejects the request, or it times out.
     */
    getStubPackageCatalog(filters?: {
        family?: string;
        version?: string;
        port?: string;
        board?: string;
    }): Promise<{
        packages: StubPackageCatalogEntry[];
        availableRuntimeVersions: string[];
        defaultRuntimeVersion: string;
    }>;
    /**
     * Query packages matching the supplied firmware filters. When family and
     * version are omitted, the worker uses MicroPython and its highest stable
     * available firmware version.
     *
     * @param {{family?: string, version?: string, port?: string, board?: string}} [filters={}]
     * @returns {Promise<StubPackageCatalogEntry[]>}
     */
    listStubPackages(filters?: {
        family?: string;
        version?: string;
        port?: string;
        board?: string;
    }): Promise<StubPackageCatalogEntry[]>;
    /**
     * Download, validate, and persist a type-stub wheel from PyPI.
     *
     * @param {string} packageName - PyPI package name.
     * @param {string} [versionSpecifier=''] - Exact or constrained PEP-440-like version.
     * The cache change becomes visible to Pyright only after the worker is
     * restarted. Higher-level integrations such as ViperIDE do this automatically.
     *
     * @returns {Promise<InstalledStubPackage>} Installed package metadata.
     * @throws {TypeError} If either argument is invalid.
     * @throws {Error} If no compatible type-only wheel is available, validation
     *   fails, the transport is disconnected, or the request times out.
     */
    installStubPackage(packageName: string, versionSpecifier?: string): Promise<InstalledStubPackage>;
    /**
     * List packages persisted by the worker in IndexedDB.
     *
     * @returns {Promise<InstalledStubPackage[]>} Cached package metadata.
     * @throws {Error} If disconnected, the worker rejects the request, or it times out.
     */
    listInstalledStubPackages(): Promise<InstalledStubPackage[]>;
    /**
     * Remove one version, all versions of a package, or the complete stub cache.
     *
     * @param {string} [packageName] - Optional normalized or display package name.
     * @param {string} [version] - Optional exact cached version.
     * @returns {Promise<{removed: number, restartRequired: boolean}>} Removal result.
     * @throws {TypeError} If a supplied package name or version is empty.
     * @throws {Error} If disconnected, the worker rejects the request, or it times out.
     */
    clearStubPackages(packageName?: string, version?: string): Promise<{
        removed: number;
        restartRequired: boolean;
    }>;
}
export type WorkerTransportOptions = {
    /**
     * - Board stubs zip. `false` or
     * omission disables board stubs unless `boardStubsUrl` or
     * `boardStubPackage` selects them explicitly.
     */
    boardStubs?: ArrayBuffer | false;
    /**
     * - Absolute fallback archive URL fetched
     * by the worker only when the preferred cached package is unavailable.
     */
    boardStubsUrl?: string;
    /**
     * -
     * Cached PyPI package to use as `/typings` instead of `boardStubs`.
     */
    boardStubPackage?: {
        packageName: string;
        version?: string;
        fallbackToBundled?: boolean;
    };
    /**
     * - Files to preload into
     * `/workspace`, keyed by workspace-relative path.
     */
    workspaceFiles?: {
        [x: string]: string;
    };
    /**
     * - Pyright type-checking mode.
     */
    typeCheckingMode?: string;
    /**
     * - Absolute worker-VFS typeshed path.
     */
    typeshedPath?: string;
    /**
     * - Python version in `X.Y` format.
     */
    pythonVersion?: string;
    /**
     * - Enable verbose Pyright output.
     */
    verboseOutput?: boolean;
    /**
     * - Additional type-only stub packages.
     */
    extraStubPackages?: Array<{
        packageName: string;
        files: {
            [x: string]: string;
        };
    }>;
    /**
     * - Absolute extra import search paths.
     */
    extraPaths?: string[];
};
export type WorkerFsEntry = {
    /**
     * - Absolute worker-VFS path.
     */
    path: string;
    /**
     * - Entry kind.
     */
    kind: "file" | "dir";
    /**
     * - Depth relative to the requested root.
     */
    depth: number;
    /**
     * - File size in bytes.
     */
    size?: number;
};
export type StubPackageRelease = {
    /**
     * - PyPI release version.
     */
    version: string;
    /**
     * - Selected universal wheel filename.
     */
    filename: string;
    /**
     * - Wheel size in bytes.
     */
    size: number;
    /**
     * - PyPI upload timestamp.
     */
    uploadTime: string;
};
export type StubPackageCatalogEntry = {
    /**
     * - Stable catalog identifier.
     */
    id: string;
    /**
     * - PyPI distribution name.
     */
    packageName: string;
    /**
     * - Human-readable package label.
     */
    label: string;
    /**
     * - Package role.
     */
    kind: "stdlib" | "firmware";
    /**
     * - Firmware family.
     */
    family: "micropython" | "circuitpython";
    /**
     * - Compatible firmware releases.
     */
    runtimeVersions: string[];
    /**
     * - MicroPython port, when applicable.
     */
    port: string;
    /**
     * - MicroPython board, when applicable.
     */
    board: string;
    /**
     * - Latest stable installable version.
     */
    latestVersion: string;
    /**
     * - Stable universal-wheel releases.
     */
    versions: StubPackageRelease[];
    /**
     * - Active cached version, when installed.
     */
    installedVersion?: string;
    /**
     * - Per-package discovery error; other entries remain usable.
     */
    error?: string;
};
export type InstalledStubPackage = {
    /**
     * - Normalized PyPI distribution name.
     */
    packageName: string;
    /**
     * - Installed release version.
     */
    version: string;
    /**
     * - Source wheel filename.
     */
    wheelFilename: string;
    /**
     * - Trusted files.pythonhosted.org source URL.
     */
    wheelUrl: string;
    /**
     * - Installation timestamp in milliseconds since epoch.
     */
    installedAt: number;
    /**
     * - Number of persisted files, including resolved dependencies.
     */
    fileCount: number;
    /**
     * - Whether this is the active cached version.
     */
    active: boolean;
};
export type WorkerResponseMessage = {
    /**
     * - Control message type.
     */
    type?: string;
    /**
     * - Correlates a response with its request.
     */
    requestId?: string;
    /**
     * - Whether the request succeeded.
     */
    ok?: boolean;
    /**
     * - Failure reason when `ok` is false.
     */
    error?: string;
    /**
     * - Listed filesystem root.
     */
    root?: string;
    /**
     * - Listed filesystem entries.
     */
    entries?: WorkerFsEntry[];
    /**
     * - Generated configuration content.
     */
    content?: string;
    /**
     * - Worker-reported Pyright version.
     */
    pyrightVersion?: string;
    /**
     * - Catalog or installed stub packages.
     */
    packages?: StubPackageCatalogEntry[] | InstalledStubPackage[];
    /**
     * - Firmware versions offered by the catalog.
     */
    availableRuntimeVersions?: string[];
    /**
     * - Default firmware version.
     */
    defaultRuntimeVersion?: string;
    /**
     * - Newly installed stub package.
     */
    package?: InstalledStubPackage;
    /**
     * - Number of cleared cache entries.
     */
    removed?: number;
    /**
     * - Whether the worker must restart.
     */
    restartRequired?: boolean;
    /**
     * - Present on forwarded LSP messages.
     */
    jsonrpc?: string;
};
