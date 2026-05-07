/**
 * Pure helpers for diagnostics conversion and lint navigation.
 *
 * Keep this file free of CodeMirror imports so it can be unit tested in Node.
 */

/**
 * Convert LSP severity number to CodeMirror severity string.
 * LSP: 1=Error, 2=Warning, 3=Information, 4=Hint.
 */
export function lspSeverityToString(severity) {
    switch (severity) {
        case 1: return 'error';
        case 2: return 'warning';
        case 3: return 'info';
        case 4: return 'info';
        default: return 'error';
    }
}

/**
 * Convert LSP position (0-based line/character) to absolute doc offset.
 * Expects a doc-like object with { lines, length, line(n) -> { from, to } }.
 */
export function positionToOffset(doc, position) {
    try {
        if (position.line >= doc.lines) {
            return doc.length;
        }
        const line = doc.line(position.line + 1);
        return Math.min(line.from + position.character, line.to);
    } catch (error) {
        console.info('positionToOffset: could not map position (stale diagnostics):', error.message);
        return 0;
    }
}

/**
 * Convert LSP diagnostic to CodeMirror diagnostic.
 */
export function convertLSPDiagnostic(lspDiag, doc) {
    const from = positionToOffset(doc, lspDiag.range.start);
    const to = positionToOffset(doc, lspDiag.range.end);
    const severity = lspSeverityToString(lspDiag.severity);

    const source = lspDiag.code
        ? `${lspDiag.source || 'lsp'}: ${lspDiag.code}`
        : (lspDiag.source || 'lsp');

    return {
        from,
        to,
        severity,
        message: lspDiag.message,
        source
    };
}

/**
 * Shared behavior for F8: open panel, navigate, restore focus.
 */
export function runNextDiagnostic(view, openLintPanel, nextDiagnostic) {
    openLintPanel(view);
    const result = nextDiagnostic(view);
    view.focus();
    return result;
}

/**
 * Shared behavior for Shift-F8: open panel, navigate, restore focus.
 */
export function runPreviousDiagnostic(view, openLintPanel, previousDiagnostic) {
    openLintPanel(view);
    const result = previousDiagnostic(view);
    view.focus();
    return result;
}
