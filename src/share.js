/**
 * Shareable Links Module
 *
 * Encodes editor project files + settings into compact URLs.
 *
 * New format: `project=<base64url(zip(files))>`
 * Legacy format (decode-only): `code=<base64url(deflate-raw(text))>`
 */

const PROJECT_PARAM = 'project';
const LEGACY_CODE_PARAM = 'code';
// Conservative warning threshold: many intermediaries reject URLs around 8 KiB.
// Base64url expands compressed bytes, so warn before that hard limit.
const LARGE_SHARE_WARNING_BYTES = 7 * 1024;

// ---- Compression helpers (native CompressionStream API) ----

/**
 * Compress a string to base64url using deflate-raw.
 * @param {string} text
 * @returns {Promise<string>} base64url-encoded compressed data
 */
export async function compressCode(text) {
    const bytes = new TextEncoder().encode(text);
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    const compressed = await new Response(stream).arrayBuffer();
    return arrayBufferToBase64url(new Uint8Array(compressed));
}

/**
 * Decompress a base64url string back to the original text.
 * @param {string} encoded base64url-encoded compressed data
 * @returns {Promise<string>}
 */
export async function decompressCode(encoded) {
    const bytes = base64urlToUint8Array(encoded);
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Response(stream).text();
}

// ---- Project zip helpers (new sharing format) ----

async function encodeProjectFiles(files) {
    const { strToU8, zipSync } = await import('https://esm.sh/fflate@0.8.2');
    const zipFiles = {};
    for (const [path, content] of Object.entries(files)) {
        if (!path) continue;
        zipFiles[path] = strToU8(content ?? '');
    }
    const zipped = zipSync(zipFiles);
    warnLargeSharePayload(zipped.length);
    return arrayBufferToBase64url(zipped);
}

async function decodeProjectFiles(encoded) {
    const { unzipSync, strFromU8 } = await import('https://esm.sh/fflate@0.8.2');
    const unzipped = unzipSync(base64urlToUint8Array(encoded));
    const files = {};
    for (const [path, data] of Object.entries(unzipped)) {
        if (path.endsWith('/')) continue;
        files[path] = strFromU8(data);
    }
    return files;
}

function warnLargeSharePayload(byteLength) {
    if (byteLength < LARGE_SHARE_WARNING_BYTES) return;
    const kib = Math.round(byteLength / 1024);
    console.warn(
        `Share payload is large (${kib} KiB compressed). ` +
        'Long URLs may fail through some proxies/CDNs. Consider exporting a zip file instead.'
    );
}

async function getCompressedProjectByteLength(files) {
    const { strToU8, zipSync } = await import('https://esm.sh/fflate@0.8.2');
    const zipFiles = {};
    for (const [path, content] of Object.entries(files)) {
        if (!path) continue;
        zipFiles[path] = strToU8(content ?? '');
    }
    return zipSync(zipFiles).length;
}

function normalizeShareFiles(codeOrFiles) {
    if (typeof codeOrFiles === 'string') {
        // Backward-compatible caller shape: single text buffer.
        return { 'main.py': codeOrFiles };
    }
    if (codeOrFiles && typeof codeOrFiles === 'object') {
        return codeOrFiles;
    }
    return { 'main.py': '' };
}

export function resolveShareSettings(getBoard, getTypeCheckMode, getStdlib, getPythonVersion) {
    return {
        board: typeof getBoard === 'function' ? (getBoard() || '') : '',
        typeCheckMode: typeof getTypeCheckMode === 'function' ? (getTypeCheckMode() || '') : '',
        stdlib: typeof getStdlib === 'function' ? getStdlib() : undefined,
        pythonVersion: typeof getPythonVersion === 'function' ? getPythonVersion() : undefined,
    };
}

// ---- Base64url helpers (URL-safe, no padding) ----

function arrayBufferToBase64url(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlToUint8Array(str) {
    // Restore standard base64
    let b64 = str.replace(/-/g, '+').replace(/_/g, '/');
    // Re-pad
    while (b64.length % 4 !== 0) b64 += '=';
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

// ---- URL building / parsing ----

/**
 * Build a shareable URL from project files and settings.
 *
 * Accepts either a single string (encoded as `main.py`) or an object map
 * of `{ path: content }`.
 *
 * @param {string|Object<string,string>} codeOrFiles
 * @param {string} board  Board ID (e.g. "esp32")
 * @param {string} typeCheckMode  Pyright type checking mode
 * @param {string} [stdlib] stdlib selector: "micropython" | "cpython"
 * @param {string} [pythonVersion] Python version (e.g. "3.10")
 * @returns {Promise<string>} Full shareable URL
 */
export async function buildShareableUrl(codeOrFiles, board, typeCheckMode, stdlib, pythonVersion) {
    const url = new URL(window.location.href);
    // Remove any existing params we manage
    url.search = '';

    if (board) url.searchParams.set('board', board);
    if (typeCheckMode) url.searchParams.set('typeCheckMode', typeCheckMode);
    if (stdlib) url.searchParams.set('stdlib', stdlib);
    if (pythonVersion) url.searchParams.set('pythonVersion', pythonVersion);

    const projectEncoded = await encodeProjectFiles(normalizeShareFiles(codeOrFiles));
    url.searchParams.set(PROJECT_PARAM, projectEncoded);

    return url.toString();
}

/**
 * Parse shareable parameters from the current URL.
 * @returns {{ project: string|null, code: string|null, board: string|null, typeCheckMode: string|null, stdlib: string|null, pythonVersion: string|null }}
 */
export function parseUrlParams() {
    const params = new URLSearchParams(window.location.search);
    return {
        project: params.get(PROJECT_PARAM),
        code: params.get(LEGACY_CODE_PARAM),
        board: params.get('board'),
        typeCheckMode: params.get('typeCheckMode'),
        stdlib: params.get('stdlib'),
        pythonVersion: params.get('pythonVersion'),
    };
}

/**
 * Restore editor state from URL parameters if present.
 *
 * New-format links decode into `files`.
 * Legacy links decode into `code`.
 *
 * @returns {Promise<{ files: Object<string,string>|null, code: string|null, board: string|null, typeCheckMode: string|null, stdlib: string|null, pythonVersion: string|null }>}
 */
export async function restoreFromUrl() {
     const { project, code: encodedLegacy, board, typeCheckMode, stdlib, pythonVersion } = parseUrlParams();
    let files = null;
    let code = null;

    if (project) {
        try {
            files = await decodeProjectFiles(project);
        } catch (err) {
            console.warn('Failed to decode project from URL:', err);
        }
    }

    if (!files && encodedLegacy) {
        try {
            code = await decompressCode(encodedLegacy);
        } catch (err) {
            console.warn('Failed to decode legacy code from URL:', err);
        }
    }

    return { files, code, board, typeCheckMode, stdlib, pythonVersion };
}

// ---- Clipboard copy helpers ----

/**
 * Copy text to the clipboard.
 * @param {string} text
 * @returns {Promise<boolean>} true if copy succeeded
 */
async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        // Fallback for insecure contexts / older browsers
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
    }
}

/**
 * Copy the shareable link to the clipboard.
 * @param {string|Object<string,string>} codeOrFiles
 * @param {string} board
 * @param {string} typeCheckMode
 * @param {string} [stdlib]
 * @param {string} [pythonVersion]
 * @returns {Promise<boolean>}
 */
export async function copyShareableLink(codeOrFiles, board, typeCheckMode, stdlib, pythonVersion) {
    const url = await buildShareableUrl(codeOrFiles, board, typeCheckMode, stdlib, pythonVersion);
    return copyToClipboard(url);
}

/**
 * Copy markdown containing a shareable link.
 * @param {string|Object<string,string>} codeOrFiles
 * @param {string} board
 * @param {string} typeCheckMode
 * @param {string} [stdlib]
 * @param {string} [pythonVersion]
 * @returns {Promise<boolean>}
 */
export async function copyMarkdownWithLink(codeOrFiles, board, typeCheckMode, stdlib, pythonVersion) {
    const url = await buildShareableUrl(codeOrFiles, board, typeCheckMode, stdlib, pythonVersion);
    const md = `[MicroPython-stubs Playground](${url})`;
    return copyToClipboard(md);
}

/**
 * Copy markdown containing a shareable link and the code block.
 * The code block (from the current document) is placed before the link.
 * @param {string|Object<string,string>} codeOrFiles  Files to encode in the URL
 * @param {string} codeBlockText                      Current-document code for the code block
 * @param {string} board
 * @param {string} typeCheckMode
 * @param {string} [stdlib]
 * @param {string} [pythonVersion]
 * @returns {Promise<boolean>}
 */
export async function copyMarkdownWithLinkAndCode(codeOrFiles, codeBlockText, board, typeCheckMode, stdlib, pythonVersion) {
    const url = await buildShareableUrl(codeOrFiles, board, typeCheckMode, stdlib, pythonVersion);
    const md = `\`\`\`python\n${codeBlockText}\n\`\`\`\n\n[MicroPython-stubs Playground](${url})`;
    return copyToClipboard(md);
}

// ---- Scope-aware file resolution ----

/**
 * Resolve the set of files to include in a share URL based on scope.
 *
 * @param {'current'|'all'} scope          'current' = active file only, 'all' = whole workspace
 * @param {() => string} getCode           Returns the current editor content
 * @param {() => string} getActiveFileName Returns the active file path (e.g. 'main.py')
 * @param {() => Promise<Object<string,string>>} [getFiles] Returns all workspace files
 * @returns {Promise<Object<string,string>>}
 */
async function resolveFilesForScope(scope, getCode, getActiveFileName, getFiles) {
    if (scope === 'all' && typeof getFiles === 'function') {
        return getFiles();
    }
    const fileName = typeof getActiveFileName === 'function'
        ? (getActiveFileName() || 'main.py')
        : 'main.py';
    return { [fileName]: getCode() };
}

// ---- Markdown helpers ----

/**
 * Escape text for use inside a Markdown table cell.
 * Escapes backslashes and pipe characters, then collapses newlines.
 * @param {string} text
 * @returns {string}
 */
function escapeMarkdownCell(text) {
    return String(text ?? '')
        .replace(/\\/g, '\\\\')
        .replace(/\|/g, '\\|')
        .replace(/\r?\n/g, ' ');
}

// ---- Report Issue helpers ----

const REPORT_ISSUE_REPO = 'https://github.com/Josverl/micropython-stubs/issues/new';
const REPORT_ISSUE_QUALITY_LABEL = 'Quality';
const REPORT_ISSUE_LABEL_API =
    `https://api.github.com/repos/Josverl/micropython-stubs/labels/${encodeURIComponent(REPORT_ISSUE_QUALITY_LABEL)}`;

/**
 * Resolve labels to prefill on the created GitHub issue.
 * Falls back to no labels if the lookup fails or the label does not exist.
 *
 * @param {(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>} [fetchImpl]
 * @returns {Promise<string[]>}
 */
export async function resolveReportIssueLabels(fetchImpl = globalThis.fetch) {
    if (typeof fetchImpl !== 'function') {
        return [];
    }

    try {
        const response = await fetchImpl(REPORT_ISSUE_LABEL_API, {
            method: 'GET',
            headers: { Accept: 'application/vnd.github+json' },
        });
        if (!response.ok) {
            return [];
        }

        const payload = await response.json();
        if (payload?.name === REPORT_ISSUE_QUALITY_LABEL) {
            return [REPORT_ISSUE_QUALITY_LABEL];
        }
    } catch {
        // Graceful fallback: if lookup is blocked or offline, create issue without labels.
    }

    return [];
}

/**
 * Build a pre-filled GitHub issue URL for the micropython-stubs repo.
 *
 * @param {string} stubPackage   Selected stubs package name (may be empty)
 * @param {string} stubVersion   Selected stubs package version (may be empty)
 * @param {string} typeCheckMode Current Pyright mode
 * @param {string} playgroundUrl Shareable playground link to embed in the issue
 * @param {string[]} [labels]    Optional labels to prefill on the issue
 * @param {Array<{fileName: string, line: number, character: number, message: string, severity: string}>} [diagnostics]
 *   Optional list of LSP diagnostics to embed as a table
 * @returns {string} GitHub new-issue URL with pre-filled title and body
 */
export function buildIssueUrl(stubPackage, stubVersion, typeCheckMode, playgroundUrl, labels = [], diagnostics = []) {
    const normalizedVersion = stubVersion
        ? (stubVersion.startsWith('v') ? stubVersion : `v${stubVersion}`)
        : 'n/a';
    const title = 'Stub issue: ';

    let diagnosticsSection = '';
    if (diagnostics.length > 0) {
        const rows = diagnostics
            .map(d =>
                `| ${escapeMarkdownCell(d.fileName)} | ${d.line}:${d.character} | ${d.severity} | ${escapeMarkdownCell(d.message)} |`
            )
            .join('\n');
        diagnosticsSection =
            `\n## Diagnostics\n\n` +
            `| File | Position | Level | Message |\n` +
            `|------|----------|-------|---------|\n` +
            `${rows}\n`;
    }

    const body =
`## Describe the issue
<!-- Please describe what is incorrect or missing in the stub. -->

## Context
**Stub package:** ${stubPackage || 'unknown'}
**Stub version:** ${normalizedVersion}
**Type check mode:** ${typeCheckMode || 'standard'}

## Issue reproduction
[MicroPython-stubs Playground](${playgroundUrl})
${diagnosticsSection}`;

    const url = new URL(REPORT_ISSUE_REPO);
    url.searchParams.set('title', title);
    url.searchParams.set('body', body);
    if (labels.length > 0) {
        url.searchParams.set('labels', labels.join(','));
    }
    return url.toString();
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
    const confirmBtn = document.getElementById('reportIssueConfirm');
    if (!btn || !dropdown) return;

    const getScope = () => {
        const checked = dropdown.querySelector('input[name="reportScope"]:checked');
        return checked ? checked.value : 'current';
    };

    // Toggle dropdown
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdown.hidden = !dropdown.hidden;
    });

    // Close on outside click
    document.addEventListener('click', (e) => {
        if (!dropdown.contains(e.target) && e.target !== btn) {
            dropdown.hidden = true;
        }
    });

    // Close on Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            dropdown.hidden = true;
        }
    });

    // Open GitHub issue in a new tab
    confirmBtn?.addEventListener('click', async () => {
        dropdown.hidden = true;
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

// ---- Share dropdown UI ----

/**
 * Show a brief "Copied!" flash next to the button that was clicked.
 * @param {HTMLElement} button
 */
function flashCopied(button) {
    const original = button.textContent;
    button.textContent = '✓ Copied!';
    button.classList.add('share-copied');
    setTimeout(() => {
        button.textContent = original;
        button.classList.remove('share-copied');
    }, 1500);
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
 */
export function initShareDropdown(getCode, getBoard, getTypeCheckMode, getStdlib, getPythonVersion, getFiles, getActiveFileName) {
    const shareBtn = document.getElementById('shareBtn');
    const dropdown = document.getElementById('shareDropdown');
    const warningEl = document.getElementById('sharePayloadWarning');
    if (!shareBtn || !dropdown) return;

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
        dropdown.hidden = !dropdown.hidden;
        if (opening) {
            await updatePayloadWarning();
        }
    });

    // Close dropdown on outside click
    document.addEventListener('click', (e) => {
        if (!dropdown.contains(e.target) && e.target !== shareBtn) {
            dropdown.hidden = true;
            if (warningEl) warningEl.hidden = true;
        }
    });

    // Close dropdown on Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            dropdown.hidden = true;
            if (warningEl) warningEl.hidden = true;
        }
    });

    // Wire up copy buttons
    document.getElementById('copyLink')?.addEventListener('click', async (e) => {
        const files = await resolveShareFiles();
        const shareSettings = resolveShareSettings(getBoard, getTypeCheckMode, getStdlib, getPythonVersion);
        const ok = await copyShareableLink(
            files,
            shareSettings.board,
            shareSettings.typeCheckMode,
            shareSettings.stdlib,
            shareSettings.pythonVersion,
        );
        if (ok) flashCopied(e.currentTarget);
    });

    document.getElementById('copyMdLink')?.addEventListener('click', async (e) => {
        const files = await resolveShareFiles();
        const shareSettings = resolveShareSettings(getBoard, getTypeCheckMode, getStdlib, getPythonVersion);
        const ok = await copyMarkdownWithLink(
            files,
            shareSettings.board,
            shareSettings.typeCheckMode,
            shareSettings.stdlib,
            shareSettings.pythonVersion,
        );
        if (ok) flashCopied(e.currentTarget);
    });

    document.getElementById('copyMdCode')?.addEventListener('click', async (e) => {
        const files = await resolveShareFiles();
        const shareSettings = resolveShareSettings(getBoard, getTypeCheckMode, getStdlib, getPythonVersion);
        const ok = await copyMarkdownWithLinkAndCode(
            files,
            getCode(),
            shareSettings.board,
            shareSettings.typeCheckMode,
            shareSettings.stdlib,
            shareSettings.pythonVersion,
        );
        if (ok) flashCopied(e.currentTarget);
    });
}
