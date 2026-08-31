/**
 * Create and initialize an LSP client.
 *
 * @param {LSPClientConfig} config - Worker and Pyright configuration.
 * @returns {Promise<LSPClientResult>} Connected client, transport, and version.
 * @throws {TypeError} If `config.workerUrl` is missing.
 * @throws {Error} If worker creation, worker initialization, or the LSP
 *   initialization handshake fails.
 */
export function createLSPClient(config: LSPClientConfig): Promise<LSPClientResult>;
/**
 * Create CodeMirror extensions that connect an editor document to an LSP client.
 *
 * Calling this function sends `textDocument/didOpen` immediately. The caller is
 * responsible for installing the returned extensions and for managing their
 * lifecycle when a document or editor is replaced.
 *
 * @param {SimpleLSPClient} client - Connected LSP client.
 * @param {import('@codemirror/view').EditorView} view - Target editor view.
 * @param {LSPPluginOptions} [options={}] - Document and callback options.
 * @returns {import('@codemirror/state').Extension[]} CodeMirror extensions for
 *   diagnostics, completion, and hover.
 */
export function createLSPPlugin(client: SimpleLSPClient, view: import("@codemirror/view").EditorView, options?: LSPPluginOptions): import("@codemirror/state").Extension[];
/**
 * Switch board stubs by tearing down the current worker and creating a new one.
 *
 * The caller must reconfigure each editor's LSP extension after this resolves
 * so its documents are reopened with their current content.
 *
 * @param {LSPClientResult} current - Complete current client result, including
 *   its workspace diagnostics subscription when one was requested.
 * @param {LSPClientConfig} config - New worker configuration, including the
 *   replacement `boardStubs`.
 * @returns {Promise<LSPClientResult>} Complete replacement client result.
 * @throws {TypeError} If `config.workerUrl` is missing.
 * @throws {Error} If the replacement worker or LSP handshake fails.
 */
export function switchBoard(current: LSPClientResult, config: LSPClientConfig): Promise<LSPClientResult>;
/**
 * Check whether an LSP client is connected and initialized.
 *
 * @param {SimpleLSPClient|null|undefined} client - Client to inspect.
 * @returns {boolean} Whether server capabilities are available on a connected client.
 */
export function isLSPReady(client: SimpleLSPClient | null | undefined): boolean;
export type LSPClientConfig = {
    /**
     * - Worker script URL.
     */
    workerUrl: string;
    /**
     * - Request timeout in milliseconds.
     */
    timeout?: number;
    /**
     * - Maximum time to await the LSP
     * shutdown response before sending `exit`.
     */
    shutdownTimeout?: number;
    /**
     * - Board stubs zip. `false` or
     * omission disables board stubs unless another board source is selected.
     */
    boardStubs?: ArrayBuffer | false;
    /**
     * - Absolute fallback archive URL fetched
     * only when the preferred cached package is unavailable.
     */
    boardStubsUrl?: string;
    /**
     * - Verified board archive.
     */
    boardStubsArchive?: {
        url?: string;
        data?: ArrayBuffer;
        size: number;
        sha256: string;
        allowedOrigins?: string[];
    };
    /**
     * - Verified external catalog.
     */
    stubPackageCatalog?: {
        url?: string;
        data?: ArrayBuffer;
        size: number;
        sha256: string;
        allowedOrigins?: string[];
    };
    /**
     * -
     * Cached PyPI package to materialize as the active board stubs.
     */
    boardStubPackage?: {
        packageName: string;
        version?: string;
        fallbackToBundled?: boolean;
    };
    /**
     * - Project files to preload
     * into `/workspace`, keyed by workspace-relative path.
     */
    workspaceFiles?: {
        [x: string]: string;
    };
    /**
     * - Pyright type-checking mode.
     */
    typeCheckingMode?: string;
    /**
     * -
     * Analyze opened files or every Python file in the workspace.
     */
    diagnosticMode?: "openFilesOnly" | "workspace";
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
     * - Verified type-only ZIP archives.
     */
    extraStubArchives?: Array<{
        packageName: string;
        archive: {
            url?: string;
            data?: ArrayBuffer;
            size: number;
            sha256: string;
            allowedOrigins?: string[];
        };
    }>;
    /**
     * - Absolute extra import search paths.
     */
    extraPaths?: string[];
    /**
     * - Maximum worker
     * initialization time after the script loads.
     */
    initializationTimeout?: number;
    /**
     * - Optional host-selected runtime
     * manifest. `workerUrl` remains the deterministic bundled fallback.
     */
    runtimeManifestUrl?: string;
    /**
     * - Origins permitted for the
     * manifest and every runtime asset URL.
     */
    runtimeAllowedOrigins?: string[];
    /**
     * - Cache Storage namespace.
     */
    runtimeCacheName?: string;
    /**
     * - localStorage last-known-good key.
     */
    runtimeStorageKey?: string;
    /**
     * - Receives diagnostics for all files reported
     * by Pyright, including unopened files in workspace mode.
     */
    onWorkspaceDiagnosticsChange?: (diagnostics: import("./diagnostics.js").WorkspaceDiagnostic[]) => void;
};
export type LSPClientResult = {
    /**
     * - Initialized LSP client.
     */
    client: SimpleLSPClient;
    /**
     * -
     * Connected worker transport.
     */
    transport: import("./worker-transport.js").WorkerTransport;
    /**
     * - Detected Pyright version, or an empty
     * string when the worker does not report one.
     */
    pyrightVersion: string;
    /**
     * -
     * Client-level diagnostics subscription, when requested.
     */
    workspaceDiagnosticsSubscription: {
        destroy: () => void;
    } | null;
    /**
     * - Selected
     * worker runtime source.
     */
    runtimeSource: "remote" | "last-known-good" | "bundled";
    /**
     * - Immutable manifest runtime ID or `bundled`.
     */
    runtimeId: string;
    /**
     * -
     * Selected validated runtime manifest.
     */
    runtimeManifest: import("./runtime-loader.js").RuntimeManifest | null;
    /**
     * -
     * Runtime candidates rejected before the successful selection.
     */
    runtimeFallbacks: import("./runtime-loader.js").RuntimeFallback[];
};
export type LSPPluginOptions = {
    /**
     * - Document URI.
     */
    fileUri?: string;
    /**
     * - LSP language identifier.
     */
    languageId?: string;
    /**
     * - Initial document text.
     */
    initialContent?: string;
    /**
     * - Receives a snapshot of workspace diagnostics.
     */
    onDiagnosticsChange?: (diagnostics: Array<{
        uri: string;
        fileName: string;
        line: number;
        character: number;
        endLine: number;
        endCharacter: number;
        message: string;
        severity: string;
    }>) => void;
    /**
     * - Idle time before displaying the
     * latest Pyright diagnostics. Document changes remain immediate.
     */
    diagnosticDelayMs?: number;
    /**
     * - Delay auto-triggered dotted
     * completions when the consumer debounces document synchronization.
     */
    completionDelayMs?: number;
};
export type BaseLSPClientResult = {
    client: SimpleLSPClient;
    transport: import("./worker-transport.js").WorkerTransport;
    pyrightVersion: string;
    workspaceDiagnosticsSubscription: {
        destroy: () => void;
    } | null;
};
import { SimpleLSPClient } from './simple-client.js';
