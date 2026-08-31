/**
 * @typedef {Object} LSPClientConfig
 * @property {string} workerUrl - Worker script URL.
 * @property {number} [timeout=5000] - Request timeout in milliseconds.
 * @property {number} [shutdownTimeout=1000] - Maximum time to await the LSP
 *   shutdown response before sending `exit`.
 * @property {ArrayBuffer|false} [boardStubs] - Board stubs zip. `false` or
 *   omission disables board stubs unless another board source is selected.
 * @property {string} [boardStubsUrl] - Absolute fallback archive URL fetched
 *   only when the preferred cached package is unavailable.
 * @property {{packageName: string, version?: string, fallbackToBundled?: boolean}} [boardStubPackage] -
 *   Cached PyPI package to materialize as the active board stubs.
 * @property {Object.<string, string>} [workspaceFiles] - Project files to preload
 *   into `/workspace`, keyed by workspace-relative path.
 * @property {string} [typeCheckingMode] - Pyright type-checking mode.
 * @property {'openFilesOnly'|'workspace'} [diagnosticMode='openFilesOnly'] -
 *   Analyze opened files or every Python file in the workspace.
 * @property {string} [typeshedPath] - Absolute worker-VFS typeshed path.
 * @property {string} [pythonVersion] - Python version in `X.Y` format.
 * @property {boolean} [verboseOutput] - Enable verbose Pyright output.
 * @property {Array<{packageName: string, files: Object.<string, string>}>}
 *   [extraStubPackages] - Additional type-only stub packages.
 * @property {string[]} [extraPaths] - Absolute extra import search paths.
 * @property {(diagnostics: import('./diagnostics.js').WorkspaceDiagnostic[]) => void}
 *   [onWorkspaceDiagnosticsChange] - Receives diagnostics for all files reported
 *   by Pyright, including unopened files in workspace mode.
 */
/**
 * @typedef {Object} LSPClientResult
 * @property {SimpleLSPClient} client - Initialized LSP client.
 * @property {import('./worker-transport.js').WorkerTransport} transport -
 *   Connected worker transport.
 * @property {string} pyrightVersion - Detected Pyright version, or an empty
 *   string when the worker does not report one.
 * @property {{destroy: () => void}|null} workspaceDiagnosticsSubscription -
 *   Client-level diagnostics subscription, when requested.
 */
/**
 * @typedef {Object} LSPPluginOptions
 * @property {string} [fileUri='file:///workspace/document.py'] - Document URI.
 * @property {string} [languageId='python'] - LSP language identifier.
 * @property {string} [initialContent=''] - Initial document text.
 * @property {(diagnostics: Array<{uri: string, fileName: string, line: number,
 *   character: number, endLine: number, endCharacter: number, message: string,
 *   severity: string}>) => void}
 *   [onDiagnosticsChange] - Receives a snapshot of workspace diagnostics.
 * @property {number} [diagnosticDelayMs=0] - Idle time before displaying the
 *   latest Pyright diagnostics. Document changes remain immediate.
 * @property {number} [completionDelayMs=320] - Delay auto-triggered dotted
 *   completions when the consumer debounces document synchronization.
 */
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
     * - Absolute extra import search paths.
     */
    extraPaths?: string[];
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
import { SimpleLSPClient } from './simple-client.js';
