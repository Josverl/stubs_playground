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
 * Create and initialize an LSP client
 * @param {Object} config - Configuration options
 * @param {string} [config.workerUrl] - Worker script URL
 * @param {number} [config.timeout=5000] - Request timeout in ms
 * @param {ArrayBuffer} [config.boardStubs] - Board stubs zip (undefined = use bundled default)
 * @param {Object.<string, string>} [config.workspaceFiles] - Project files to preload into /workspace
 * @param {string} [config.typeCheckingMode] - Pyright type checking mode
 * @param {string} [config.typeshedPath] - Pyright typeshedPath
 * @param {string} [config.pythonVersion] - Pyright pythonVersion
 * @param {boolean} [config.verboseOutput] - Pyright verboseOutput
 */
export async function createLSPClient(config = {}) {
    const transport = createTransport({
        workerUrl: config.workerUrl,
        boardStubs: config.boardStubs,
        workspaceFiles: config.workspaceFiles,
        typeCheckingMode: config.typeCheckingMode,
        typeshedPath: config.typeshedPath,
        pythonVersion: config.pythonVersion,
        verboseOutput: config.verboseOutput,
    });

    console.log('Creating LSP client...');

    const client = new SimpleLSPClient({
        rootUri: 'file:///workspace',
        timeout: config.timeout || 5000,
        typeCheckingMode: config.typeCheckingMode,
    });

    await transport.connect();
    console.log('Transport connected');

    await client.connect(transport);
    console.log('LSP Client initialized:', client.serverCapabilities);

    return { client, transport, pyrightVersion: transport.pyrightVersion || "" };
}

/**
 * Create an LSP plugin extension for an editor
 * @param {SimpleLSPClient} client - LSP client instance
 * @param {EditorView} view - CodeMirror editor view
 * @param {Object} [options={}] - Configuration options
 * @param {string} [options.fileUri='file:///workspace/document.py'] - Document URI
 * @param {string} [options.languageId='python'] - Document language ID
 * @param {string} [options.initialContent=''] - Initial document content
 * @param {(diagnostics: Array) => void} [options.onDiagnosticsChange] - Callback for diagnostics updates
 * @returns {Extension[]} CodeMirror extension array
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
 * Switch board stubs by tearing down and rebuilding the LSP worker.
 * Re-opens all tracked documents with fresh diagnostics.
 *
 * @param {Object} current - Current { client, transport } from createLSPClient
 * @param {Object} config - Same config as createLSPClient, with new boardStubs
 * @returns {Object} New { client, transport }
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
 * Helper to check if LSP is available and initialized
 */
export function isLSPReady(client) {
    return client && client.connected && client.serverCapabilities !== null;
}
