/**
 * LSP Diagnostics Integration for CodeMirror
 * 
 * This module integrates LSP diagnostics with CodeMirror's linting system
 * to show errors, warnings, and hints from the LSP server.
 */

import {
    forceLinting,
    linter,
    lintGutter,
    setDiagnostics,
    openLintPanel,
    nextDiagnostic,
    previousDiagnostic,
} from '@codemirror/lint';
import { keymap, ViewPlugin } from '@codemirror/view';
import { Prec, StateEffect } from '@codemirror/state';
import {
    createDebouncedPublisher,
    convertLSPDiagnostic,
    lspSeverityToString,
    runNextDiagnostic,
    runPreviousDiagnostic,
} from './diagnostics-core.mjs';
import { logVerbose } from './logging.js';

/**
 * @typedef {Object} PublishDiagnosticsParams
 * @property {string} [uri] - Document URI the diagnostics belong to.
 * @property {import('vscode-languageserver-types').Diagnostic[]} [diagnostics] -
 *   Diagnostics published for the document.
 */

/**
 * Workspace-level diagnostics cache: maps fileUri → CodeMirror diagnostics[].
 * Updated by createLSPDiagnostics whenever publishDiagnostics arrives.
 * Used to compute aggregate workspace counts for the status bar.
 */
const _workspaceDiagnostics = new Map();
const refreshLSPDiagnostics = StateEffect.define();

/**
 * @param {string} uri - Source document URI.
 * @param {import('vscode-languageserver-types').Diagnostic} diagnostic - Published diagnostic.
 * @returns {WorkspaceDiagnostic} Report-ready diagnostic with one-based positions.
 */
function workspaceDiagnostic(uri, diagnostic) {
    const sourceName = diagnostic.source || 'Pyright';
    return {
        uri,
        fileName: uri.replace('file:///workspace/', ''),
        line: (diagnostic.range?.start?.line ?? 0) + 1,
        character: (diagnostic.range?.start?.character ?? 0) + 1,
        endLine: (diagnostic.range?.end?.line ?? diagnostic.range?.start?.line ?? 0) + 1,
        endCharacter: (diagnostic.range?.end?.character ?? diagnostic.range?.start?.character ?? 0) + 1,
        message: diagnostic.message || '',
        severity: lspSeverityToString(diagnostic.severity),
        source: diagnostic.code ? `${sourceName}: ${diagnostic.code}` : sourceName,
    };
}

/**
 * @param {Map<string, WorkspaceDiagnostic[]>} diagnosticsByUri - Cached diagnostics per URI.
 * @returns {WorkspaceDiagnostic[]} Flattened snapshot.
 */
function flattenWorkspaceDiagnostics(diagnosticsByUri) {
    return [...diagnosticsByUri.values()].flat();
}

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
export const lintKeymapExtension = Prec.high(keymap.of([
    {
        key: 'F8',
        run(view) {
            return runNextDiagnostic(view, openLintPanel, nextDiagnostic);
        }
    },
    {
        key: 'Shift-F8',
        run(view) {
            return runPreviousDiagnostic(view, openLintPanel, previousDiagnostic);
        }
    }
]));

/**
 * Remove diagnostics for a URI from the workspace cache.
 *
 * @param {string} fileUri - URI whose cached diagnostics should be removed.
 * @returns {void}
 */
export function removeWorkspaceDiagnosticsFor(fileUri) {
    _workspaceDiagnostics.delete(fileUri);
}

/**
 * Return a flat snapshot of all currently-known workspace diagnostics,
 * suitable for embedding in a GitHub issue report.
 *
 * Each entry: `{ uri, fileName, line, character, endLine, endCharacter, message, severity }`
 * Line and character are 1-based.
 *
 * @returns {WorkspaceDiagnostic[]} New array containing cached diagnostics.
 */
export function getWorkspaceDiagnostics() {
    const result = [];
    for (const diags of _workspaceDiagnostics.values()) {
        result.push(...diags);
    }
    return result;
}

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
export function createWorkspaceDiagnosticsSubscription(client, onDiagnosticsChange) {
    if (typeof onDiagnosticsChange !== 'function') {
        throw new TypeError('Workspace diagnostics subscription requires a callback');
    }
    const diagnosticsByUri = new Map();
    const unsubscribe = client.onNotification((method, rawParams) => {
        const params = /** @type {PublishDiagnosticsParams} */ (rawParams ?? {});
        if (method !== 'textDocument/publishDiagnostics' || typeof params?.uri !== 'string') {
            return;
        }
        const uri = params.uri;
        const diagnostics = params.diagnostics || [];
        if (diagnostics.length) {
            diagnosticsByUri.set(
                uri,
                diagnostics.map(diagnostic => workspaceDiagnostic(uri, diagnostic)),
            );
        } else {
            diagnosticsByUri.delete(uri);
        }
        onDiagnosticsChange(flattenWorkspaceDiagnostics(diagnosticsByUri));
    });
    return {
        destroy() {
            unsubscribe();
            diagnosticsByUri.clear();
        },
    };
}

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
export function createDiagnosticsSubscription(
    client,
    fileUri,
    view,
    onDiagnosticsChange = null,
    publishDiagnostics = null,
    publishLSPDiagnostics = null,
) {
    const unsubscribe = client.onNotification((method, rawParams) => {
        const params = /** @type {PublishDiagnosticsParams} */ (rawParams ?? {});
        if (method === 'textDocument/publishDiagnostics') {
            if (params.uri === fileUri) {
                const lspDiagnostics = params.diagnostics || [];
                logVerbose(client.verboseOutput, 'Received diagnostics:', lspDiagnostics);

                // Store report-ready snapshot in workspace map (1-based positions)
                const fileName = fileUri.replace('file:///workspace/', '');
                if (lspDiagnostics.length === 0) {
                    _workspaceDiagnostics.delete(fileUri);
                } else {
                    _workspaceDiagnostics.set(
                        fileUri,
                        lspDiagnostics.map(diagnostic => workspaceDiagnostic(fileUri, diagnostic)),
                    );
                }

                if (publishLSPDiagnostics) {
                    publishLSPDiagnostics(lspDiagnostics);
                } else {
                    // Convert immediately for consumers that do not defer presentation.
                    const cmDiagnostics = lspDiagnostics.map(diag =>
                        convertLSPDiagnostic(diag, view.state.doc));

                    logVerbose(client.verboseOutput, 'Converted diagnostics:', cmDiagnostics);

                    if (publishDiagnostics) {
                        // A linter source merges with Ruff and other host lint producers.
                        publishDiagnostics(cmDiagnostics);
                    } else {
                        // Preserve the direct-subscription API for existing consumers.
                        view.dispatch(setDiagnostics(view.state, cmDiagnostics));
                    }
                }

                if (typeof onDiagnosticsChange === 'function') {
                    onDiagnosticsChange(getWorkspaceDiagnostics());
                }
            }
        }
    });

    return { destroy: unsubscribe };
}

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
export function createDeferredDiagnosticsPublisher(
    view,
    publishDiagnostics,
    diagnosticDelayMs,
    schedule = setTimeout,
    cancelSchedule = clearTimeout,
) {
    return createDebouncedPublisher((lspDiagnostics) => {
        publishDiagnostics(
            /** @type {import('vscode-languageserver-types').Diagnostic[]} */ (lspDiagnostics)
                .map(diag => convertLSPDiagnostic(diag, view.state.doc)),
        );
    }, diagnosticDelayMs, schedule, cancelSchedule);
}

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
export function createLSPDiagnostics(
    client,
    fileUri,
    view,
    onDiagnosticsChange = null,
    diagnosticDelayMs = 0,
) {
    /** @type {import('@codemirror/lint').Diagnostic[]} */
    let currentDiagnostics = [];
    const diagnosticSource = linter(() => currentDiagnostics, {
        needsRefresh: update => update.transactions.some(transaction =>
            transaction.effects.some(effect => effect.is(refreshLSPDiagnostics))),
    });
    const subscriptionPlugin = ViewPlugin.define((pluginView) => {
        const publisher = createDeferredDiagnosticsPublisher(pluginView, (diagnostics) => {
            currentDiagnostics = diagnostics;
            pluginView.dispatch({ effects: refreshLSPDiagnostics.of(null) });
            forceLinting(pluginView);
        }, diagnosticDelayMs);
        const subscription = createDiagnosticsSubscription(
            client,
            fileUri,
            pluginView,
            onDiagnosticsChange,
            null,
            publisher.publish,
        );
        return {
            update(update) {
                if (!update.docChanged) {
                    return;
                }
                publisher.cancel();
                if (currentDiagnostics.length) {
                    currentDiagnostics = [];
                    forceLinting(pluginView);
                }
            },
            destroy() {
                publisher.cancel();
                subscription.destroy();
            },
        };
    });

    return [lintGutter(), diagnosticSource, subscriptionPlugin];
}

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
export async function requestDiagnostics(client, fileUri, documentText) {
    try {
        // Some servers support pull diagnostics via textDocument/diagnostic
        if (/** @type {{diagnosticProvider?: unknown}} */ (client.serverCapabilities ?? {}).diagnosticProvider) {
            const result = /** @type {{items?: Object[]}|null} */ (
                await client.request('textDocument/diagnostic', {
                    textDocument: {
                        uri: fileUri
                    }
                })
            );

            if (result && result.items) {
                return result.items;
            }
        }
    } catch (error) {
        console.error('Error requesting diagnostics:', error);
    }

    return [];
}

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
export function notifyDocumentChange(client, fileUri, content, version = 1) {
    client.notify('textDocument/didChange', {
        textDocument: {
            uri: fileUri,
            version
        },
        contentChanges: [{
            text: content
        }]
    });
}

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
export function notifyDocumentOpen(client, fileUri, languageId, content, version = 1) {
    client.notify('textDocument/didOpen', {
        textDocument: {
            uri: fileUri,
            languageId,
            version,
            text: content
        }
    });
}

/**
 * Send a `textDocument/didClose` notification and remove cached diagnostics
 * for the document.
 *
 * @param {import('./simple-client.js').SimpleLSPClient} client - Connected LSP client.
 * @param {string} fileUri - URI of the document being closed.
 * @returns {void}
 * @throws {TypeError} If the client has no attached transport.
 */
export function notifyDocumentClose(client, fileUri) {
    client.notify('textDocument/didClose', {
        textDocument: {
            uri: fileUri
        }
    });
    removeWorkspaceDiagnosticsFor(fileUri);
}
