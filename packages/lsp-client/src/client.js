/**
 * LSP Client Setup for CodeMirror
 *
 * Creates and initializes an LSP client with either Worker or WebSocket transport.
 * Supports board switching by tearing down and rebuilding the worker.
 */

import { EditorState } from '@codemirror/state';
import { createCompletionSource } from './completion.js';
import {
    createLSPDiagnostics,
    createWorkspaceDiagnosticsSubscription,
    notifyDocumentOpen,
} from './diagnostics.js';
import { createHoverTooltip } from './hover.js';
import { logVerbose } from './logging.js';
import { SimpleLSPClient } from './simple-client.js';
import { createTransport } from './transport-factory.js';

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
export async function createLSPClient(config) {
    if (!config?.workerUrl) {
        throw new TypeError('createLSPClient requires config.workerUrl');
    }
    const transport = createTransport({
        workerUrl: config.workerUrl,
        boardStubs: config.boardStubs,
        boardStubsUrl: config.boardStubsUrl,
        boardStubPackage: config.boardStubPackage,
        workspaceFiles: config.workspaceFiles,
        typeCheckingMode: config.typeCheckingMode,
        typeshedPath: config.typeshedPath,
        pythonVersion: config.pythonVersion,
        verboseOutput: config.verboseOutput,
        extraStubPackages: config.extraStubPackages,
        extraPaths: config.extraPaths,
    });

    logVerbose(config.verboseOutput, 'Creating LSP client...');

    const client = new SimpleLSPClient({
        rootUri: 'file:///workspace',
        timeout: config.timeout || 5000,
        shutdownTimeout: config.shutdownTimeout,
        typeCheckingMode: config.typeCheckingMode,
        diagnosticMode: config.diagnosticMode,
        typeshedPath: config.typeshedPath,
        pythonVersion: config.pythonVersion,
        verboseOutput: config.verboseOutput,
        extraPaths: config.extraPaths,
    });
    const workspaceDiagnosticsSubscription =
        typeof config.onWorkspaceDiagnosticsChange === 'function'
            ? createWorkspaceDiagnosticsSubscription(client, config.onWorkspaceDiagnosticsChange)
            : null;

    try {
        await transport.connect();
        logVerbose(config.verboseOutput, 'Transport connected');

        await client.connect(transport);
        logVerbose(config.verboseOutput, 'LSP Client initialized:', client.serverCapabilities);
    } catch (error) {
        workspaceDiagnosticsSubscription?.destroy();
        throw error;
    }

    return {
        client,
        transport,
        pyrightVersion: transport.pyrightVersion || "",
        workspaceDiagnosticsSubscription,
    };
}

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
export function createLSPPlugin(client, view, options = {}) {
    const {
        fileUri = 'file:///workspace/document.py',
        languageId = 'python',
        initialContent = '',
        onDiagnosticsChange = null,
        diagnosticDelayMs = 0,
        completionDelayMs,
    } = options;

    // Notify server that document is open
    notifyDocumentOpen(client, fileUri, languageId, initialContent, 1);

    // Create diagnostics extension with the view
    const diagnosticsExtensions = createLSPDiagnostics(
        client,
        fileUri,
        view,
        onDiagnosticsChange,
        diagnosticDelayMs,
    );

    // Create completion source
    const completionSource = createCompletionSource(client, fileUri, {
        autoTriggerDelayMs: completionDelayMs,
    });

    // Provide LSP completions through the language data facet so they
    // integrate with the existing autocompletion() from basicSetup instead
    // of creating a competing second autocomplete instance.
    const completionExtension = EditorState.languageData.of(() => [{
        autocomplete: completionSource
    }]);

    // Create hover tooltip extension
    const hoverExtension = createHoverTooltip(client, fileUri);

    // Return extensions array
    return [
        ...diagnosticsExtensions,
        completionExtension,
        hoverExtension
    ];
}

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
export async function switchBoard(current, config) {
    // Tear down old client and transport
    current.workspaceDiagnosticsSubscription?.destroy();
    try {
        await current.client.disconnect();
    } finally {
        current.transport.close();
    }

    // Create new client with new board stubs
    const result = await createLSPClient(config);

    // Do NOT re-open documents here — the caller is responsible for
    // reconfiguring the CodeMirror LSP compartment (which calls
    // createLSPPlugin → notifyDocumentOpen with the actual content).

    return result;
}

/**
 * Check whether an LSP client is connected and initialized.
 *
 * @param {SimpleLSPClient|null|undefined} client - Client to inspect.
 * @returns {boolean} Whether server capabilities are available on a connected client.
 */
export function isLSPReady(client) {
    return Boolean(client && client.connected && client.serverCapabilities !== null);
}
