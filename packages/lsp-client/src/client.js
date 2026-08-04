/**
 * LSP Client Setup for CodeMirror
 *
 * Creates and initializes an LSP client with either Worker or WebSocket transport.
 * Supports board switching by tearing down and rebuilding the worker.
 */

import { EditorState } from '@codemirror/state';
import { createCompletionSource } from './completion.js';
import { createLSPDiagnostics, notifyDocumentOpen } from './diagnostics.js';
import { createHoverTooltip } from './hover.js';
import { SimpleLSPClient } from './simple-client.js';
import { createTransport } from './transport-factory.js';

/**
 * @typedef {Object} LSPClientConfig
 * @property {string} workerUrl - Worker script URL.
 * @property {number} [timeout=5000] - Request timeout in milliseconds.
 * @property {ArrayBuffer|false} [boardStubs] - Board stubs zip; `false` disables
 *   board stubs and `undefined` uses the worker's bundled default.
 * @property {Object.<string, string>} [workspaceFiles] - Project files to preload
 *   into `/workspace`, keyed by workspace-relative path.
 * @property {string} [typeCheckingMode] - Pyright type-checking mode.
 * @property {string} [typeshedPath] - Absolute worker-VFS typeshed path.
 * @property {string} [pythonVersion] - Python version in `X.Y` format.
 * @property {boolean} [verboseOutput] - Enable verbose Pyright output.
 * @property {Array<{packageName: string, files: Object.<string, string>}>}
 *   [extraStubPackages] - Additional type-only stub packages.
 * @property {string[]} [extraPaths] - Absolute extra import search paths.
 */

/**
 * @typedef {Object} LSPClientResult
 * @property {SimpleLSPClient} client - Initialized LSP client.
 * @property {import('./worker-transport.js').WorkerTransport} transport -
 *   Connected worker transport.
 * @property {string} pyrightVersion - Detected Pyright version, or an empty
 *   string when the worker does not report one.
 */

/**
 * @typedef {Object} LSPPluginOptions
 * @property {string} [fileUri='file:///workspace/document.py'] - Document URI.
 * @property {string} [languageId='python'] - LSP language identifier.
 * @property {string} [initialContent=''] - Initial document text.
 * @property {(diagnostics: Array<{uri: string, fileName: string, line: number,
 *   character: number, message: string, severity: string}>) => void}
 *   [onDiagnosticsChange] - Receives a snapshot of workspace diagnostics.
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
        workspaceFiles: config.workspaceFiles,
        typeCheckingMode: config.typeCheckingMode,
        typeshedPath: config.typeshedPath,
        pythonVersion: config.pythonVersion,
        verboseOutput: config.verboseOutput,
        extraStubPackages: config.extraStubPackages,
        extraPaths: config.extraPaths,
    });

    console.log('Creating LSP client...');

    const client = new SimpleLSPClient({
        rootUri: 'file:///workspace',
        timeout: config.timeout || 5000,
        typeCheckingMode: config.typeCheckingMode,
        typeshedPath: config.typeshedPath,
        pythonVersion: config.pythonVersion,
        extraPaths: config.extraPaths,
    });

    await transport.connect();
    console.log('Transport connected');

    await client.connect(transport);
    console.log('LSP Client initialized:', client.serverCapabilities);

    return { client, transport, pyrightVersion: transport.pyrightVersion || "" };
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
        onDiagnosticsChange = null
    } = options;

    // Notify server that document is open
    notifyDocumentOpen(client, fileUri, languageId, initialContent, 1);

    // Create diagnostics extension with the view
    const diagnosticsExtensions = createLSPDiagnostics(client, fileUri, view, onDiagnosticsChange);

    // Create completion source
    const completionSource = createCompletionSource(client, fileUri);

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
 * @param {{client: SimpleLSPClient,
 *   transport: import('./worker-transport.js').WorkerTransport}} current -
 *   Current client and transport.
 * @param {LSPClientConfig} config - New worker configuration, including the
 *   replacement `boardStubs`.
 * @returns {Promise<{client: SimpleLSPClient,
 *   transport: import('./worker-transport.js').WorkerTransport}>} Replacement
 *   client and transport.
 * @throws {TypeError} If `config.workerUrl` is missing.
 * @throws {Error} If the replacement worker or LSP handshake fails.
 */
export async function switchBoard(current, config) {
    // Tear down old client and transport
    try {
        current.client.disconnect();
    } catch (e) { /* ignore shutdown errors */ }
    try {
        current.transport.close();
    } catch (e) { /* ignore close errors */ }

    // Create new client with new board stubs
    const { client, transport } = await createLSPClient(config);

    // Do NOT re-open documents here — the caller is responsible for
    // reconfiguring the CodeMirror LSP compartment (which calls
    // createLSPPlugin → notifyDocumentOpen with the actual content).

    return { client, transport };
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
