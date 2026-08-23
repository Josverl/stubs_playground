/**
 * Remove diagnostics for a URI from the workspace cache.
 *
 * @param {string} fileUri - URI whose cached diagnostics should be removed.
 * @returns {void}
 */
export function removeWorkspaceDiagnosticsFor(fileUri: string): void;
/**
 * Return a flat snapshot of all currently-known workspace diagnostics,
 * suitable for embedding in a GitHub issue report.
 *
 * Each entry: `{ uri, fileName, line, character, endLine, endCharacter, message, severity }`
 * Line and character are 1-based.
 *
 * @returns {WorkspaceDiagnostic[]} New array containing cached diagnostics.
 */
export function getWorkspaceDiagnostics(): WorkspaceDiagnostic[];
/**
 * Subscribe to diagnostics for every file reported by the language server.
 *
 * Unlike the per-editor CodeMirror subscription, this includes files that have
 * no open editor when Pyright runs in `workspace` diagnostic mode.
 *
 * @param {import('./simple-client.js').SimpleLSPClient} client - Connected LSP client.
 * @param {(diagnostics: WorkspaceDiagnostic[]) => void} onDiagnosticsChange -
 *   Receives a complete workspace snapshot after each publication.
 * @returns {{destroy: () => void}} Disposable subscription.
 */
export function createWorkspaceDiagnosticsSubscription(client: import("./simple-client.js").SimpleLSPClient, onDiagnosticsChange: (diagnostics: WorkspaceDiagnostic[]) => void): {
    destroy: () => void;
};
/**
 * Create the disposable notification subscription owned by a diagnostics view plugin.
 *
 * @param {import('./simple-client.js').SimpleLSPClient} client - Connected LSP client.
 * @param {string} fileUri - Document URI.
 * @param {import('@codemirror/view').EditorView} view - Target editor view.
 * @param {(diagnostics: WorkspaceDiagnostic[]) => void} [onDiagnosticsChange] -
 *   Receives a fresh workspace-level snapshot after matching publications.
 * @param {(diagnostics: import('@codemirror/lint').Diagnostic[]) => void}
 *   [publishDiagnostics] - Merge-safe lint-source update callback.
 * @param {(diagnostics: import('vscode-languageserver-types').Diagnostic[]) => void}
 *   [publishLSPDiagnostics] - Raw diagnostic callback for deferred conversion.
 * @returns {{destroy: () => void}} Plugin value whose destroy method unsubscribes.
 */
export function createDiagnosticsSubscription(client: import("./simple-client.js").SimpleLSPClient, fileUri: string, view: import("@codemirror/view").EditorView, onDiagnosticsChange?: (diagnostics: WorkspaceDiagnostic[]) => void, publishDiagnostics?: (diagnostics: import("@codemirror/lint").Diagnostic[]) => void, publishLSPDiagnostics?: (diagnostics: import("vscode-languageserver-types").Diagnostic[]) => void): {
    destroy: () => void;
};
/**
 * Delay raw LSP diagnostics and map their positions against the document shown
 * when they are actually published.
 *
 * @param {import('@codemirror/view').EditorView} view - Target editor view.
 * @param {(diagnostics: import('@codemirror/lint').Diagnostic[]) => void} publishDiagnostics -
 *   Receives converted diagnostics.
 * @param {number} diagnosticDelayMs - Idle time before publishing.
 * @param {(callback: () => void, delay: number) => unknown} [schedule=setTimeout]
 * @param {(timer: unknown) => void} [cancelSchedule=clearTimeout]
 * @returns {{publish: (diagnostics: unknown) => void, cancel: () => void}} Debounced publisher.
 */
export function createDeferredDiagnosticsPublisher(view: import("@codemirror/view").EditorView, publishDiagnostics: (diagnostics: import("@codemirror/lint").Diagnostic[]) => void, diagnosticDelayMs: number, schedule?: (callback: () => void, delay: number) => unknown, cancelSchedule?: (timer: unknown) => void): {
    publish: (diagnostics: unknown) => void;
    cancel: () => void;
};
/**
 * Create CodeMirror diagnostics integration for one LSP document.
 *
 * The notification subscription belongs to the returned view plugin, so
 * destroying the view or reconfiguring the containing compartment releases it.
 *
 * @param {import('./simple-client.js').SimpleLSPClient} client - Connected LSP client.
 * @param {string} fileUri - Document URI.
 * @param {import('@codemirror/view').EditorView} view - Target editor view.
 * @param {(diagnostics: WorkspaceDiagnostic[]) => void} [onDiagnosticsChange] -
 *   Receives a fresh workspace-level snapshot after matching publications.
 * @param {number} [diagnosticDelayMs=0] - Idle time before displaying the latest
 *   Pyright diagnostics. Document synchronization remains immediate.
 * @returns {import('@codemirror/state').Extension[]} CodeMirror lint extensions.
 *   Pyright is registered as its own lint source so host sources remain active.
 */
export function createLSPDiagnostics(client: import("./simple-client.js").SimpleLSPClient, fileUri: string, view: import("@codemirror/view").EditorView, onDiagnosticsChange?: (diagnostics: WorkspaceDiagnostic[]) => void, diagnosticDelayMs?: number): import("@codemirror/state").Extension[];
/**
 * Request pull diagnostics when supported by the server.
 *
 * Request errors are logged and converted to an empty result.
 *
 * @param {import('./simple-client.js').SimpleLSPClient} client - Connected LSP client.
 * @param {string} fileUri - Document URI.
 * @param {string} documentText - Current document text, reserved for servers
 *   that require content in future pull-diagnostic implementations.
 * @returns {Promise<Object[]>} LSP diagnostics, or an empty array when pull
 *   diagnostics are unsupported or fail.
 */
export function requestDiagnostics(client: import("./simple-client.js").SimpleLSPClient, fileUri: string, documentText: string): Promise<Object[]>;
/**
 * Send a full-document `textDocument/didChange` notification.
 *
 * @param {import('./simple-client.js').SimpleLSPClient} client - Connected LSP client.
 * @param {string} fileUri - Document URI.
 * @param {string} content - Complete current document text.
 * @param {number} [version=1] - Monotonically increasing document version.
 * @returns {void}
 * @throws {TypeError} If the client has no attached transport.
 */
export function notifyDocumentChange(client: import("./simple-client.js").SimpleLSPClient, fileUri: string, content: string, version?: number): void;
/**
 * Send a `textDocument/didOpen` notification.
 *
 * @param {import('./simple-client.js').SimpleLSPClient} client - Connected LSP client.
 * @param {string} fileUri - Document URI.
 * @param {string} languageId - LSP language identifier.
 * @param {string} content - Initial document text.
 * @param {number} [version=1] - Initial document version.
 * @returns {void}
 * @throws {TypeError} If the client has no attached transport.
 */
export function notifyDocumentOpen(client: import("./simple-client.js").SimpleLSPClient, fileUri: string, languageId: string, content: string, version?: number): void;
/**
 * Send a `textDocument/didClose` notification and remove cached diagnostics
 * for the document.
 *
 * @param {import('./simple-client.js').SimpleLSPClient} client - Connected LSP client.
 * @param {string} fileUri - URI of the document being closed.
 * @returns {void}
 * @throws {TypeError} If the client has no attached transport.
 */
export function notifyDocumentClose(client: import("./simple-client.js").SimpleLSPClient, fileUri: string): void;
/**
 * @typedef {Object} WorkspaceDiagnostic
 * @property {string} uri - Source document URI.
 * @property {string} fileName - Workspace-relative file name.
 * @property {number} line - One-based start line.
 * @property {number} character - One-based start character.
 * @property {number} endLine - One-based end line.
 * @property {number} endCharacter - One-based end character.
 * @property {string} message - Diagnostic message.
 * @property {string} severity - CodeMirror severity name.
 * @property {string} source - Diagnostic producer and optional diagnostic code.
 */
/**
 * Lint keyboard navigation extension (F8 / Shift-F8).
 * Opens the lint panel and navigates to next/previous diagnostic.
 * Uses high precedence to override basicSetup's default lintKeymap
 * (which only navigates without opening the panel).
 */
export const lintKeymapExtension: import("@codemirror/state").Extension;
export type PublishDiagnosticsParams = {
    /**
     * - Document URI the diagnostics belong to.
     */
    uri?: string;
    /**
     * -
     * Diagnostics published for the document.
     */
    diagnostics?: import("vscode-languageserver-types").Diagnostic[];
};
export type WorkspaceDiagnostic = {
    /**
     * - Source document URI.
     */
    uri: string;
    /**
     * - Workspace-relative file name.
     */
    fileName: string;
    /**
     * - One-based start line.
     */
    line: number;
    /**
     * - One-based start character.
     */
    character: number;
    /**
     * - One-based end line.
     */
    endLine: number;
    /**
     * - One-based end character.
     */
    endCharacter: number;
    /**
     * - Diagnostic message.
     */
    message: string;
    /**
     * - CodeMirror severity name.
     */
    severity: string;
    /**
     * - Diagnostic producer and optional diagnostic code.
     */
    source: string;
};
