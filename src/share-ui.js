/**
 * Share UI wiring (app-specific DOM behavior)
 */

import {
    buildIssueUrl,
    buildShareableUrl,
    copyMarkdownWithLink,
    copyMarkdownWithLinkAndCode,
    copyShareableLink,
    getCompressedProjectByteLength,
    LARGE_SHARE_WARNING_BYTES,
    resolveFilesForScope,
    resolveReportIssueLabels,
    resolveShareSettings,
} from './share-core.js';

export const MARKDOWN_CODE_SNIPPET_MAX_LINES = 16;
const SHARE_COPY_FEEDBACK_MS = 1100;

/**
 * Build a centered line snippet around the active cursor line.
 * Returns at most maxLines lines.
 *
 * @param {string} text
 * @param {number} cursorLine One-based cursor line number
 * @param {number} maxLines
 * @returns {string}
 */
export function getCenteredCodeSnippet(text, cursorLine, maxLines = MARKDOWN_CODE_SNIPPET_MAX_LINES) {
    const lines = String(text ?? '').split('\n');
    if (!lines.length || maxLines <= 0) return '';
    if (lines.length <= maxLines) return lines.join('\n');

    const safeCursorLine = Number.isFinite(cursorLine)
        ? Math.max(1, Math.min(lines.length, Math.trunc(cursorLine)))
        : 1;
    const cursorIndex = safeCursorLine - 1;

    const before = Math.floor(maxLines / 2);
    let start = Math.max(0, cursorIndex - before);
    let end = start + maxLines;

    if (end > lines.length) {
        end = lines.length;
        start = Math.max(0, end - maxLines);
    }

    return lines.slice(start, end).join('\n');
}

/**
 * Show a brief "Copied!" flash next to the button that was clicked.
 * @param {HTMLElement} button
 */
function flashCopied(button) {
    if (!button) return;
    const original = button.textContent;
    button.textContent = '✓ Copied!';
    button.classList.add('share-copied');
    setTimeout(() => {
        button.textContent = original;
        button.classList.remove('share-copied');
    }, 1500);
}

/**
 * Initialise the "Report a stub issue" button and its confirmation dropdown.
 * Call once after the DOM is ready.
 *
 * @param {() => string} getCode          Returns current editor content
 * @param {() => string} getBoard         Returns current board ID
 * @param {() => ({ package: string, version: string })} getStubMetadata Returns selected stubs package metadata
 * @param {() => string} getTypeCheckMode Returns current typeCheckMode
 * @param {() => string} [getStdlib]      Returns stdlib selector: "micropython" | "cpython"
 * @param {() => string} [getPythonVersion] Returns python version
 * @param {() => Promise<Object<string,string>>} [getFiles] Returns full share file map
 * @param {() => string} [getActiveFileName] Returns active file path
 * @param {() => Array<{fileName: string, line: number, character: number, message: string, severity: string}>} [getDiagnostics]
 *   Returns all current workspace diagnostics (from getWorkspaceDiagnostics)
 */
export function initReportIssueButton(getCode, getBoard, getStubMetadata, getTypeCheckMode, getStdlib, getPythonVersion, getFiles, getActiveFileName, getDiagnostics) {
    const btn = document.getElementById('reportIssueBtn');
    const dropdown = document.getElementById('reportIssueDropdown');
    const backdrop = document.getElementById('reportIssueBackdrop');
    const confirmBtn = document.getElementById('reportIssueConfirm');
    if (!btn || !dropdown) return;

    const setOpen = (open) => {
        dropdown.hidden = !open;
        if (backdrop) backdrop.hidden = !open;
        if (!open && dropdown.contains(document.activeElement)) {
            btn.focus({ preventScroll: true });
        }
    };

    // Clicking the dim backdrop is the standard modal-close gesture.
    backdrop?.addEventListener('click', () => setOpen(false));

    const getScope = () => {
        const checked = dropdown.querySelector('input[name="reportScope"]:checked');
        return checked ? checked.value : 'current';
    };

    // Toggle dropdown
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        setOpen(dropdown.hidden);
    });

    // Close on outside click
    document.addEventListener('click', (e) => {
        if (!dropdown.contains(e.target) && e.target !== btn) {
            setOpen(false);
        }
    });

    // Close on Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            setOpen(false);
        }
    });

    // Open GitHub issue in a new tab
    confirmBtn?.addEventListener('click', async () => {
        setOpen(false);
        const scope = getScope();
        const shareSettings = resolveShareSettings(getBoard, getTypeCheckMode, getStdlib, getPythonVersion);
        const stubMetadata = typeof getStubMetadata === 'function'
            ? (getStubMetadata() || {})
            : {};
        const stubPackage = stubMetadata.package || shareSettings.board || '';
        const stubVersion = stubMetadata.version || '';
        const files = await resolveFilesForScope(scope, getCode, getActiveFileName, getFiles);
        const playgroundUrl = await buildShareableUrl(
            files,
            shareSettings.board,
            shareSettings.typeCheckMode,
            shareSettings.stdlib,
            shareSettings.pythonVersion,
        );
        const labels = await resolveReportIssueLabels();

        // Collect and scope-filter diagnostics
        const allDiagnostics = typeof getDiagnostics === 'function' ? getDiagnostics() : [];
        const activeFileName = typeof getActiveFileName === 'function' ? (getActiveFileName() || 'main.py') : 'main.py';
        const scopedDiagnostics = scope === 'current'
            ? allDiagnostics.filter(d => d.fileName === activeFileName)
            : allDiagnostics;

        const issueUrl = buildIssueUrl(stubPackage, stubVersion, shareSettings.typeCheckMode, playgroundUrl, labels, scopedDiagnostics);
        window.open(issueUrl, '_blank', 'noopener,noreferrer');
    });
}

/**
 * Initialise the share dropdown and wire up its buttons.
 * Call once after the DOM is ready.
 * @param {() => string} getCode          Returns current editor content
 * @param {() => string} getBoard         Returns current board ID
 * @param {() => string} getTypeCheckMode Returns current typeCheckMode
 * @param {() => string} [getStdlib]      Returns stdlib selector: "micropython" | "cpython"
 * @param {() => string} [getPythonVersion] Returns python version
 * @param {() => Promise<Object<string,string>>} [getFiles] Returns full share file map
 * @param {() => string} [getActiveFileName] Returns active file path
 * @param {() => number} [getCursorLine] Returns active cursor line number (1-based)
 */
export function initShareDropdown(getCode, getBoard, getTypeCheckMode, getStdlib, getPythonVersion, getFiles, getActiveFileName, getCursorLine) {
    const shareBtn = document.getElementById('shareBtn');
    const dropdown = document.getElementById('shareDropdown');
    const backdrop = document.getElementById('shareBackdrop');
    const warningEl = document.getElementById('sharePayloadWarning');
    if (!shareBtn || !dropdown) return;

    let closeTimer = null;

    const setOpen = (open) => {
        if (closeTimer) {
            clearTimeout(closeTimer);
            closeTimer = null;
        }
        dropdown.hidden = !open;
        if (backdrop) backdrop.hidden = !open;
        if (!open && dropdown.contains(document.activeElement)) {
            shareBtn.focus({ preventScroll: true });
        }
    };

    const scheduleCloseAfterCopy = () => {
        if (closeTimer) clearTimeout(closeTimer);
        closeTimer = setTimeout(() => {
            setOpen(false);
            if (warningEl) warningEl.hidden = true;
        }, SHARE_COPY_FEEDBACK_MS);
    };

    const getScope = () => {
        const checked = dropdown.querySelector('input[name="shareScope"]:checked');
        return checked ? checked.value : 'current';
    };

    const resolveShareFiles = async () =>
        resolveFilesForScope(getScope(), getCode, getActiveFileName, getFiles);

    const updatePayloadWarning = async () => {
        if (!warningEl) return;
        warningEl.hidden = true;
        warningEl.textContent = '';

        try {
            const files = await resolveShareFiles();
            const byteLength = await getCompressedProjectByteLength(files);
            if (byteLength < LARGE_SHARE_WARNING_BYTES) return;

            const kib = Math.round(byteLength / 1024);
            warningEl.textContent =
                `Large share payload: ${kib} KiB compressed. ` +
                'Long links can fail in some proxies/CDNs. Prefer Export for big projects.';
            warningEl.hidden = false;
        } catch (err) {
            console.warn('Failed to measure share payload size:', err);
        }
    };

    // Toggle dropdown visibility
    shareBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const opening = dropdown.hidden;
        setOpen(opening);
        if (opening) {
            await updatePayloadWarning();
        }
    });

    // Close dropdown on outside click
    document.addEventListener('click', (e) => {
        if (!dropdown.contains(e.target) && e.target !== shareBtn) {
            setOpen(false);
            if (warningEl) warningEl.hidden = true;
        }
    });

    // Close dropdown on Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            setOpen(false);
            if (warningEl) warningEl.hidden = true;
        }
    });

    // Wire up copy buttons
    document.getElementById('copyLink')?.addEventListener('click', async (e) => {
        const button = e.currentTarget;
        const files = await resolveShareFiles();
        const shareSettings = resolveShareSettings(getBoard, getTypeCheckMode, getStdlib, getPythonVersion);
        const ok = await copyShareableLink(
            files,
            shareSettings.board,
            shareSettings.typeCheckMode,
            shareSettings.stdlib,
            shareSettings.pythonVersion,
        );
        if (ok) {
            flashCopied(button);
            scheduleCloseAfterCopy();
        }
    });

    document.getElementById('copyMdLink')?.addEventListener('click', async (e) => {
        const button = e.currentTarget;
        const files = await resolveShareFiles();
        const shareSettings = resolveShareSettings(getBoard, getTypeCheckMode, getStdlib, getPythonVersion);
        const ok = await copyMarkdownWithLink(
            files,
            shareSettings.board,
            shareSettings.typeCheckMode,
            shareSettings.stdlib,
            shareSettings.pythonVersion,
        );
        if (ok) {
            flashCopied(button);
            scheduleCloseAfterCopy();
        }
    });

    document.getElementById('copyMdCode')?.addEventListener('click', async (e) => {
        const button = e.currentTarget;
        const files = await resolveShareFiles();
        const shareSettings = resolveShareSettings(getBoard, getTypeCheckMode, getStdlib, getPythonVersion);
        const snippet = getCenteredCodeSnippet(
            getCode(),
            typeof getCursorLine === 'function' ? getCursorLine() : 1,
            MARKDOWN_CODE_SNIPPET_MAX_LINES,
        );
        const ok = await copyMarkdownWithLinkAndCode(
            files,
            snippet,
            shareSettings.board,
            shareSettings.typeCheckMode,
            shareSettings.stdlib,
            shareSettings.pythonVersion,
        );
        if (ok) {
            flashCopied(button);
            scheduleCloseAfterCopy();
        }
    });
}
