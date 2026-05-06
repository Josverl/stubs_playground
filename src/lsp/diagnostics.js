/**
 * LSP Diagnostics Integration for CodeMirror
 * 
 * This module integrates LSP diagnostics with CodeMirror's linting system
 * to show errors, warnings, and hints from the LSP server.
 */

import { lintGutter, setDiagnostics, openLintPanel, nextDiagnostic, previousDiagnostic } from '@codemirror/lint';
import { keymap } from '@codemirror/view';
import { Prec } from '@codemirror/state';

/**
 * Workspace-level diagnostics cache: maps fileUri → CodeMirror diagnostics[].
 * Updated by createLSPDiagnostics whenever publishDiagnostics arrives.
 * Used to compute aggregate workspace counts for the status bar.
 */
const _workspaceDiagnostics = new Map();

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
            openLintPanel(view);
            const result = nextDiagnostic(view);
            view.focus();
            return result;
        }
    },
    {
        key: 'Shift-F8',
        run(view) {
            openLintPanel(view);
            const result = previousDiagnostic(view);
            view.focus();
            return result;
        }
    }
]));

/**
 * Remove diagnostics for a URI from the workspace cache and optionally refresh
 * the status bar. Call this when a file is closed.
 * @param {string} fileUri
 */
export function removeWorkspaceDiagnosticsFor(fileUri) {
    _workspaceDiagnostics.delete(fileUri);
}

/**
 * Re-render the status bar using the current workspace-level diagnostics
 * totals. Call this whenever the active document changes so the counts
 * reflect all open files rather than just the file that last triggered an
 * LSP notification.
 * @param {string} [pyrightVersion]
 * @param {string} [stubsLabel]
 */
/**
 * Return a flat snapshot of all currently-known workspace diagnostics,
 * suitable for embedding in a GitHub issue report.
 *
 * Each entry: `{ uri, fileName, line, character, message, severity }`
 * Line and character are 1-based.
 *
 * @returns {Array<{uri: string, fileName: string, line: number, character: number, message: string, severity: string}>}
 */
export function getWorkspaceDiagnostics() {
    const result = [];
    for (const diags of _workspaceDiagnostics.values()) {
        result.push(...diags);
    }
    return result;
}

/**
 * Create a diagnostic linter that receives diagnostics from LSP
 * @param {Object} client - LSP client
 * @param {string} fileUri - Document URI
 * @param {Object} view - CodeMirror view
 * @param {(diagnostics: Array) => void} [onDiagnosticsChange] - Optional callback for app-level UI updates
 */
export function createLSPDiagnostics(client, fileUri, view, onDiagnosticsChange = null) {
    // Listen for diagnostic notifications from the server
    client.onNotification((method, params) => {
        if (method === 'textDocument/publishDiagnostics') {
            if (params.uri === fileUri) {
                const lspDiagnostics = params.diagnostics || [];
                console.log('Received diagnostics:', lspDiagnostics);

                // Convert LSP diagnostics to CodeMirror format
                const cmDiagnostics = lspDiagnostics.map(diag => {
                    const converted = convertLSPDiagnostic(diag, view.state.doc);
                    console.log('LSP diagnostic:', diag);
                    console.log('Converted to CM diagnostic:', converted);
                    return converted;
                });

                console.log('Converted diagnostics:', cmDiagnostics);

                // Store report-ready snapshot in workspace map (1-based positions)
                const fileName = fileUri.replace('file:///workspace/', '');
                if (lspDiagnostics.length === 0) {
                    _workspaceDiagnostics.delete(fileUri);
                } else {
                    _workspaceDiagnostics.set(fileUri, lspDiagnostics.map(d => ({
                        uri: fileUri,
                        fileName,
                        line: (d.range?.start?.line ?? 0) + 1,
                        character: (d.range?.start?.character ?? 0) + 1,
                        message: d.message || '',
                        severity: lspSeverityToString(d.severity),
                    })));
                }

                // Use setDiagnostics to update the editor
                view.dispatch(setDiagnostics(view.state, cmDiagnostics));
                console.log('Dispatched setDiagnostics');

                if (typeof onDiagnosticsChange === 'function') {
                    onDiagnosticsChange(getWorkspaceDiagnostics());
                }
            }
        }
    });

    // Return linter extension with gutter
    return [lintGutter()];
}

/**
 * Convert LSP diagnostic to CodeMirror diagnostic
 */
function convertLSPDiagnostic(lspDiag, doc) {
    // LSP uses line/character positions, CodeMirror uses absolute offsets
    const from = positionToOffset(doc, lspDiag.range.start);
    const to = positionToOffset(doc, lspDiag.range.end);

    // Map LSP severity to CodeMirror severity
    const severity = lspSeverityToString(lspDiag.severity);

    return {
        from,
        to,
        severity,
        message: lspDiag.message,
        source: lspDiag.source || 'lsp'
    };
}

/**
 * Convert LSP position (line, character) to CodeMirror offset.
 * Clamps the result to valid document bounds so that stale diagnostics
 * arriving after the user has edited the document never produce an
 * out-of-bounds position (which would otherwise throw a RangeError
 * inside CodeMirror). LSP line numbers are 0-based (valid range: 0 to
 * doc.lines-1); CodeMirror line numbers are 1-based.
 */
function positionToOffset(doc, position) {
    try {
        if (position.line >= doc.lines) {
            // Line no longer exists — stale diagnostics from a previous document version.
            return doc.length;
        }
        const line = doc.line(position.line + 1); // convert LSP 0-based to CodeMirror 1-based
        // Clamp to line.to (excludes newline) so a stale character offset that
        // exceeds the current line length doesn't push the marker onto the next line.
        return Math.min(line.from + position.character, line.to);
    } catch (error) {
        // Unexpected mapping failure; log at info level since stale positions are normal.
        console.info('positionToOffset: could not map position (stale diagnostics):', error.message);
        return 0;
    }
}

/**
 * Convert LSP severity number to CodeMirror severity string
 */
function lspSeverityToString(severity) {
    // LSP: 1 = Error, 2 = Warning, 3 = Information, 4 = Hint
    // CodeMirror: 'error', 'warning', 'info'
    switch (severity) {
        case 1: return 'error';
        case 2: return 'warning';
        case 3: return 'info';
        case 4: return 'info';
        default: return 'error';
    }
}

/**
 * Request diagnostics from the server (pull diagnostics)
 */
export async function requestDiagnostics(client, fileUri, documentText) {
    try {
        // Some servers support pull diagnostics via textDocument/diagnostic
        if (client.serverCapabilities?.diagnosticProvider) {
            const result = await client.request('textDocument/diagnostic', {
                textDocument: {
                    uri: fileUri
                }
            });

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
 * Send document change notification to trigger diagnostics
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
 * Send document open notification
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
