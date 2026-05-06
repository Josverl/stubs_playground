/**
 * Application-level diagnostics status bar rendering.
 *
 * This module is intentionally DOM-coupled and stays outside src/lsp/
 * so the LSP diagnostics core remains reusable.
 */

import { getWorkspaceDiagnostics } from './lsp/diagnostics.js';

function escapeHtml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

/**
 * Update the diagnostics status bar below the editor.
 * @param {Array<{severity: string}>} diagnostics - Diagnostics-like array with severity fields
 * @param {string} [pyrightVersion] - Optional pyright version to display
 * @param {string} [stubsLabel] - Optional stubs label, e.g. "micropython-rp2-stubs v1.28.0.post3"
 */
export function updateDiagnosticsStatus(diagnostics = [], pyrightVersion = '', stubsLabel = '') {
    const el = document.getElementById('diagnostics-status');
    if (!el) return;

    let errors = 0;
    let warnings = 0;
    let info = 0;
    for (const d of diagnostics) {
        if (d.severity === 'error') errors++;
        else if (d.severity === 'warning') warnings++;
        else info++;
    }

    const statusMain =
        `Errors: <span class="count-error">${errors}</span>` +
        ` | Warnings: <span class="count-warning">${warnings}</span>` +
        ` | Info: <span class="count-info">${info}</span>`;

    const statusMetaParts = [];
    if (stubsLabel) {
        statusMetaParts.push(`<span class="stubs-version">${escapeHtml(stubsLabel)}</span>`);
    }
    if (pyrightVersion) {
        statusMetaParts.push(`<span class="pyright-version">Pyright ${pyrightVersion}</span>`);
    }

    const statusMeta = statusMetaParts.length
        ? `<span class="status-meta-sep"> | </span><span class="status-meta">${statusMetaParts.join(' | ')}</span>`
        : '';

    el.innerHTML = `<span class="status-main">${statusMain}</span>${statusMeta}`;
}

/**
 * Re-render status bar using workspace-level diagnostics totals.
 * @param {string} [pyrightVersion]
 * @param {string} [stubsLabel]
 */
export function refreshWorkspaceDiagnosticsStatus(pyrightVersion = '', stubsLabel = '') {
    updateDiagnosticsStatus(getWorkspaceDiagnostics(), pyrightVersion, stubsLabel);
}
