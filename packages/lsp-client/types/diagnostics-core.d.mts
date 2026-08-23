/**
 * Pure helpers for diagnostics conversion and lint navigation.
 *
 * Keep this file free of CodeMirror imports so it can be unit tested in Node.
 */
/**
 * Convert LSP severity number to CodeMirror severity string.
 * LSP: 1=Error, 2=Warning, 3=Information, 4=Hint.
 *
 * @param {number} [severity] - LSP `DiagnosticSeverity` value.
 * @returns {'error'|'warning'|'info'|'hint'} CodeMirror severity name.
 */
export function lspSeverityToString(severity?: number): "error" | "warning" | "info" | "hint";
/**
 * Convert LSP position (0-based line/character) to absolute doc offset.
 * Expects a doc-like object with { lines, length, line(n) -> { from, to } }.
 *
 * @param {{lines: number, length: number, line: (n: number) => {from: number, to: number}}} doc -
 *   CodeMirror-compatible document.
 * @param {{line: number, character: number}} position - Zero-based LSP position.
 * @returns {number} Absolute document offset.
 */
export function positionToOffset(doc: {
    lines: number;
    length: number;
    line: (n: number) => {
        from: number;
        to: number;
    };
}, position: {
    line: number;
    character: number;
}): number;
/**
 * Convert LSP diagnostic to CodeMirror diagnostic.
 *
 * @param {import('vscode-languageserver-types').Diagnostic} lspDiag - Published LSP diagnostic.
 * @param {{lines: number, length: number, line: (n: number) => {from: number, to: number}}} doc -
 *   CodeMirror-compatible document used to resolve offsets.
 * @returns {{from: number, to: number, severity: 'error'|'warning'|'info'|'hint',
 *   message: string, source: string}} CodeMirror diagnostic.
 */
export function convertLSPDiagnostic(lspDiag: import("vscode-languageserver-types").Diagnostic, doc: {
    lines: number;
    length: number;
    line: (n: number) => {
        from: number;
        to: number;
    };
}): {
    from: number;
    to: number;
    severity: "error" | "warning" | "info" | "hint";
    message: string;
    source: string;
};
/**
 * Coalesce diagnostic publications while preserving immediate document synchronization.
 *
 * @param {(diagnostics: unknown) => void} publish - Receives the latest diagnostics.
 * @param {number} delayMs - Idle time required before publishing.
 * @param {(callback: () => void, delay: number) => unknown} [schedule=setTimeout]
 * @param {(timer: unknown) => void} [cancelSchedule=clearTimeout]
 * @returns {{publish: (diagnostics: unknown) => void, cancel: () => void}}
 */
export function createDebouncedPublisher(publish: (diagnostics: unknown) => void, delayMs: number, schedule?: (callback: () => void, delay: number) => unknown, cancelSchedule?: (timer: unknown) => void): {
    publish: (diagnostics: unknown) => void;
    cancel: () => void;
};
/**
 * Shared behavior for F8: open panel, navigate, restore focus.
 *
 * @param {import('@codemirror/view').EditorView} view - Target editor view.
 * @param {(view: import('@codemirror/view').EditorView) => unknown} openLintPanel - Panel opener.
 * @param {(view: import('@codemirror/view').EditorView) => boolean} nextDiagnostic - Navigation command.
 * @returns {boolean} Result of the navigation command.
 */
export function runNextDiagnostic(view: import("@codemirror/view").EditorView, openLintPanel: (view: import("@codemirror/view").EditorView) => unknown, nextDiagnostic: (view: import("@codemirror/view").EditorView) => boolean): boolean;
/**
 * Shared behavior for Shift-F8: open panel, navigate, restore focus.
 *
 * @param {import('@codemirror/view').EditorView} view - Target editor view.
 * @param {(view: import('@codemirror/view').EditorView) => unknown} openLintPanel - Panel opener.
 * @param {(view: import('@codemirror/view').EditorView) => boolean} previousDiagnostic - Navigation command.
 * @returns {boolean} Result of the navigation command.
 */
export function runPreviousDiagnostic(view: import("@codemirror/view").EditorView, openLintPanel: (view: import("@codemirror/view").EditorView) => unknown, previousDiagnostic: (view: import("@codemirror/view").EditorView) => boolean): boolean;
