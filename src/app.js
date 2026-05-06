/**
 * MicroPython-Stubs Playground
 * A simple MicroPython code editor with syntax highlighting and static type checking 
 * based on CodeMirror 6 and Pyright running in a Web Worker.
 */

import { python } from '@codemirror/lang-python';
import {
    autocompletion,
    closeBrackets,
    closeBracketsKeymap,
    completionKeymap,
    startCompletion
} from '@codemirror/autocomplete';
import {
    bracketMatching,
    defaultHighlightStyle,
    foldGutter,
    foldKeymap,
    indentOnInput,
    indentUnit,
    syntaxHighlighting
} from '@codemirror/language';
import { Compartment, EditorState, Prec } from '@codemirror/state';
import {
    crosshairCursor,
    drawSelection,
    dropCursor,
    EditorView,
    highlightActiveLine,
    highlightActiveLineGutter,
    highlightSpecialChars,
    keymap,
    lineNumbers,
    rectangularSelection
} from '@codemirror/view';
import { history, defaultKeymap, historyKeymap } from '@codemirror/commands';
import { lintKeymap, setDiagnostics } from '@codemirror/lint';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { createLSPClient, createLSPPlugin, switchBoard } from './lsp/client.js';
import { getWorkerUrlCached } from './lsp/worker-config.js';
import { restoreFromUrl } from './share-core.js';
import { initShareDropdown, initReportIssueButton } from './share-ui.js';
//import { notifyDocumentChange, notifyDocumentOpen, updateDiagnosticsStatus, lintKeymapExtension, getWorkspaceDiagnostics } from './lsp/diagnostics.js';
import { notifyDocumentChange, notifyDocumentOpen, lintKeymapExtension, removeWorkspaceDiagnosticsFor, getWorkspaceDiagnostics } from './lsp/diagnostics.js';
import { updateDiagnosticsStatus, refreshWorkspaceDiagnosticsStatus } from './diagnostics-status.js';
import { OPFSProject } from './storage/opfs-project.js';
import { DocumentManager } from './editor/document-manager.js';
import { TabBar } from './ui/tab-bar.js';
import { FileTree } from './ui/file-tree.js';
import { Events } from './events.js';

const basicSetup = [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    foldGutter(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    bracketMatching(),
    closeBrackets(),
    autocompletion(),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    keymap.of([
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
        ...foldKeymap,
        ...completionKeymap,
        ...lintKeymap,
    ]),
];

// Sample Python code - will be loaded from file
let sampleCode = '# Loading example...\n';

// Available example files (will be populated dynamically)
let exampleFiles = [];

// LSP client and related state
let lspClient = null;
let lspTransport = null;
let documentUri = 'file:///workspace/main.py'; // updated dynamically

// Per-URI document version tracker. Each tab maintains its own monotonically
// increasing version so that an in-flight didChange for the previously-active
// URI cannot be invalidated when the user switches tabs.
const documentVersions = new Map();
function bumpDocumentVersion(uri) {
    const next = (documentVersions.get(uri) || 0) + 1;
    documentVersions.set(uri, next);
    return next;
}
function resetDocumentVersion(uri) {
    documentVersions.set(uri, 1);
    return 1;
}
function forgetDocumentVersion(uri) {
    documentVersions.delete(uri);
}

// Board stub state
let currentBoardId = null;
let boardManifest = null;
let stubsCache = new Map(); // boardId → ArrayBuffer

// Pyright version (received from worker on init)
let pyrightVersion = "";

// Type checking mode
let currentTypeCheckMode = localStorage.getItem('mp_typeCheckMode') || 'standard';
const TYPESHED_PATH_MICROPYTHON = '/typeshed-micropython';
const TYPESHED_PATH_FALLBACK = '/typeshed-fallback';

function sanitizeTypeshedPath(pathValue) {
    return pathValue === TYPESHED_PATH_FALLBACK
        ? TYPESHED_PATH_FALLBACK
        : TYPESHED_PATH_MICROPYTHON;
}

function parseStdlibToTypeshedPath(stdlibValue) {
    const value = String(stdlibValue || '').toLowerCase();
    if (value === 'cpython' || value === TYPESHED_PATH_FALLBACK.toLowerCase()) {
        return TYPESHED_PATH_FALLBACK;
    }
    if (value === 'micropython' || value === TYPESHED_PATH_MICROPYTHON.toLowerCase()) {
        return TYPESHED_PATH_MICROPYTHON;
    }
    return null;
}

function sanitizePythonVersion(versionValue) {
    const match = /^3\.(\d+)$/.exec(String(versionValue || ''));
    const minor = match ? Number.parseInt(match[1], 10) : 10;
    const clamped = Number.isFinite(minor) ? Math.max(10, Math.min(14, minor)) : 10;
    return `3.${clamped}`;
}

function parseStoredBoolean(key, fallback = true) {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return raw === '1' || raw === 'true';
}

let currentTypeshedPath = sanitizeTypeshedPath(localStorage.getItem('mp_typeshedPath'));
let currentPythonVersion = sanitizePythonVersion(localStorage.getItem('mp_pythonVersion') || '3.10');
let currentVerboseOutput = parseStoredBoolean('mp_verboseOutput', true);

function updateVerboseOutputLabel() {
    const label = document.getElementById('verboseOutputLabel');
    if (!label) return;
    label.textContent = currentVerboseOutput ? 'On' : 'Off';
}

function initPythonVersionSelector() {
    const select = document.getElementById('pythonVersion');
    if (!select) return;
    select.innerHTML = '';
    for (let minor = 10; minor <= 14; minor += 1) {
        const value = `3.${minor}`;
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = value;
        select.appendChild(opt);
    }
    select.value = currentPythonVersion;
}

function setLSPControlsDisabled(disabled) {
    const ids = [
        'boardSelect',
        'typeCheckMode',
        'typeshedPathToggle',
        'pythonVersion',
        'verboseOutputToggle',
    ];
    for (const id of ids) {
        const el = document.getElementById(id);
        if (el) el.disabled = disabled;
    }
}

async function restartLSPWithCurrentSettings(boardId) {
    if (!lspClient || !lspTransport) return;

    const stubs = await fetchBoardStubs(boardId);
    const activePath = docManager?.activeFile || documentUri.replace('file:///workspace/', '');
    const activeContent = view ? view.state.doc.toString() : null;
    const workspaceFiles = await collectWorkspaceFiles(activePath, activeContent);

    const result = await switchBoard(
        { client: lspClient, transport: lspTransport },
        {
            workerUrl: getWorkerUrlCached(),
            timeout: 15000,
            boardStubs: stubs,
            workspaceFiles,
            typeCheckingMode: currentTypeCheckMode,
            typeshedPath: currentTypeshedPath,
            pythonVersion: currentPythonVersion,
            verboseOutput: currentVerboseOutput,
        }
    );

    lspClient = result.client;
    lspTransport = result.transport;

    if (docManager) {
        updateDiagnosticsStatus([], pyrightVersion, getSelectedStubsStatusLabel());
        documentVersions.clear();
        const activeUri = `file:///workspace/${docManager.activeFile}`;
        await syncWorkspaceToLSP({ openDocuments: false, activeUri, workspaceFiles });
        rebindLSPAllViews();
    }
}

function getSelectedStubsStatusLabel() {
    if (boardManifest?.boards && currentBoardId) {
        const board = boardManifest.boards.find((b) => b.id === currentBoardId);
        if (board) {
            if (board.package_version) return `${board.package} v${board.package_version}`;
            if (board.package) return board.package;
            return board.id;
        }
    }

    const select = document.getElementById('boardSelect');
    const text = select?.options?.[select.selectedIndex]?.textContent?.trim() || '';
    if (!text || /^loading\.{0,3}$/i.test(text)) return '';
    const parts = text.split(' — ').map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) return `${parts[0]} v${parts[1]}`;
    return text;
}

function getSelectedStubMetadata() {
    if (boardManifest?.boards && currentBoardId) {
        const board = boardManifest.boards.find((b) => b.id === currentBoardId);
        if (board) {
            return {
                package: board.package || board.id || '',
                version: board.package_version || '',
            };
        }
    }

    const select = document.getElementById('boardSelect');
    const text = select?.options?.[select.selectedIndex]?.textContent?.trim() || '';
    const parts = text.split(' — ').map((p) => p.trim()).filter(Boolean);
    return {
        package: parts[0] || '',
        version: parts[1] || '',
    };
}

// Per-URI debounce timers for didChange notifications
const changeDebounceTimers = new Map();

function clearPendingDidChange(path) {
    const uri = `file:///workspace/${path}`;
    const timer = changeDebounceTimers.get(uri);
    if (!timer) return;
    clearTimeout(timer);
    changeDebounceTimers.delete(uri);
}

// Multi-file state
let docManager = null;
let tabBar = null;
let fileTree = null;

// Theme + LSP compartments are now created per-view in viewMeta (see below).

const CHANGE_DEBOUNCE_MS = 300; // Wait 300ms after user stops typing
const STARTUP_REANALYZE_DELAY_MS = 50;
const AUTO_DOT_COMPLETION_DELAY_MS = CHANGE_DEBOUNCE_MS + 80;

// Per-view timers used for auto completion trigger after typing a dot.
const dotCompletionTimers = new WeakMap();

function scheduleDotCompletion(view) {
    const prev = dotCompletionTimers.get(view);
    if (prev) {
        clearTimeout(prev);
    }

    const timer = setTimeout(() => {
        dotCompletionTimers.delete(view);
        if (view.isDestroyed) return;

        const { state } = view;
        const main = state.selection.main;
        if (!main.empty) return;

        const pos = main.head;
        if (pos <= 0) return;
        if (state.sliceDoc(pos - 1, pos) !== '.') return;

        startCompletion(view);
    }, AUTO_DOT_COMPLETION_DELAY_MS);

    dotCompletionTimers.set(view, timer);
}

// Cache for collectWorkspaceFiles — invalidated on file mutations.
let _workspaceFilesCache = null;

function invalidateWorkspaceFilesCache() { _workspaceFilesCache = null; }

// TODO: The worker already holds a copy in ZenFS. A future optimisation could
// pass only deltas on board-switch / type-check-mode change instead of
// re-reading every file from OPFS each time.
async function collectWorkspaceFiles(activePath = null, activeContentOverride = null) {
    if (!_workspaceFilesCache) {
        const workspaceFiles = {};
        const allFiles = await OPFSProject.listFiles();

        for (const entry of allFiles) {
            if (entry.type !== 'file') continue;
            try {
                workspaceFiles[entry.path] = await OPFSProject.readFile(entry.path);
            } catch {
                // Ignore files that disappear during collection.
            }
        }
        _workspaceFilesCache = workspaceFiles;
    }

    // Return a shallow copy with the active document's live content overlaid.
    const result = { ..._workspaceFilesCache };
    if (activePath && activeContentOverride !== null) {
        result[activePath] = activeContentOverride;
    }
    return result;
}

async function collectShareFiles() {
    const activePath = docManager?.activeFile || OPFSProject.getLastActiveFile() || 'main.py';
    const activeContent = view?.state.doc.toString() ?? null;
    const files = await collectWorkspaceFiles(activePath, activeContent);

    // Overlay all open tabs so unsaved edits are included for non-active files.
    if (docManager) {
        for (const path of docManager.openFiles) {
            files[path] = docManager.getCurrentContent(path);
        }
    }

    if (Object.keys(files).length === 0) {
        files[activePath || 'main.py'] = activeContent ?? '';
    }
    return files;
}

async function replaceProjectFiles(files) {
    const existingEntries = await OPFSProject.listFiles();
    for (const entry of existingEntries) {
        if (entry.type !== 'file') continue;
        try {
            await OPFSProject.deleteFile(entry.path);
        } catch {
            // Ignore races where a file disappears during cleanup.
        }
    }

    for (const [path, content] of Object.entries(files)) {
        await OPFSProject.writeFile(path, content ?? '');
    }
}

function pickInitialFile(sharedFiles) {
    if (!sharedFiles || Object.keys(sharedFiles).length === 0) return null;
    if (sharedFiles['main.py'] !== undefined) return 'main.py';
    return Object.keys(sharedFiles).sort()[0];
}

async function syncWorkspaceToLSP({ openDocuments = false, activeUri = documentUri, workspaceFiles = null } = {}) {
    if (!lspClient) return;

    try {
        const files = workspaceFiles || await collectWorkspaceFiles();
        for (const [filePath, content] of Object.entries(files)) {
            const fileUri = `file:///workspace/${filePath}`;

            if (!workspaceFiles && lspTransport?.worker) {
                lspTransport.worker.postMessage({ type: 'syncFile', path: filePath, content });
            }

            if (openDocuments && fileUri !== activeUri) {
                notifyDocumentOpen(lspClient, fileUri, 'python', content, 1);
            }
        }
    } catch (err) {
        console.warn('Workspace sync failed:', err);
    }
}

function scheduleActiveDocumentRefresh(activeUri, content) {
    if (!lspClient) return;

    window.setTimeout(() => {
        if (!lspClient || documentUri !== activeUri) return;
        const v = bumpDocumentVersion(activeUri);
        notifyDocumentChange(lspClient, activeUri, content, v);
    }, STARTUP_REANALYZE_DELAY_MS);
}

// Resolve base path for assets (stubs, manifest)
function getAssetsBase() {
    return window.location.pathname.includes('/src/') ? '../assets' : './assets';
}

// Fetch board stubs manifest and populate the board selector
async function initBoardSelector() {
    const select = document.getElementById('boardSelect');
    try {
        const base = getAssetsBase();
        const resp = await fetch(`${base}/stubs-manifest.json`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        boardManifest = await resp.json();
        const selectableBoards = (boardManifest.boards || []).filter((b) => b.id !== 'stdlib');

        select.innerHTML = '';
        for (const board of selectableBoards) {
            const opt = document.createElement('option');
            opt.value = board.id;
            // Virtual boards (file === null) show their name; real boards show package — version
            if (board.file === null) {
                opt.textContent = board.package || board.id;
            } else {
                opt.textContent = board.package_version
                    ? `${board.package} — ${board.package_version}`
                    : board.package;
            }
            select.appendChild(opt);
        }

        // Restore saved selection or use manifest default
        const saved = localStorage.getItem('mp_board');
        const defaultBoardId = selectableBoards.some((b) => b.id === boardManifest.default)
            ? boardManifest.default
            : (selectableBoards[0]?.id || '');
        currentBoardId = saved && selectableBoards.some((b) => b.id === saved)
            ? saved
            : defaultBoardId;
        select.value = currentBoardId;

        // Ensure status line reflects selected stubs immediately.
        updateDiagnosticsStatus([], pyrightVersion, getSelectedStubsStatusLabel());

        select.addEventListener('change', handleBoardChange);
    } catch (err) {
        console.warn('Could not load board manifest:', err);
        select.innerHTML = '<option value="">Default (bundled)</option>';
    }
}

// Fetch board stub zip, using cache
async function fetchBoardStubs(boardId) {
    if (stubsCache.has(boardId)) return stubsCache.get(boardId);

    const board = boardManifest?.boards.find(b => b.id === boardId);
    if (!board) throw new Error(`Unknown board: ${boardId}`);

    // No stubs file means CPython-only — pass false to skip MicroPython stubs
    if (!board.file) {
        stubsCache.set(boardId, false);
        return false;
    }

    // Bundled board doesn't need fetching — pass undefined to use worker's default
    if (board.bundled) {
        stubsCache.set(boardId, undefined);
        return undefined;
    }

    const base = getAssetsBase();
    const resp = await fetch(`${base}/${board.file}`);
    if (!resp.ok) throw new Error(`Failed to fetch stubs for ${boardId}: HTTP ${resp.status}`);
    const data = await resp.arrayBuffer();
    stubsCache.set(boardId, data);
    return data;
}

// Handle board selector change
async function handleBoardChange(event) {
    const newBoardId = event.target.value;
    if (newBoardId === currentBoardId) return;

    const loading = document.getElementById('boardLoading');
    const select = document.getElementById('boardSelect');

    try {
        loading.hidden = false;
        setLSPControlsDisabled(true);

        await restartLSPWithCurrentSettings(newBoardId);
        currentBoardId = newBoardId;
        localStorage.setItem('mp_board', newBoardId);

        console.log(`Switched to board: ${newBoardId}`);
    } catch (err) {
        console.error(`Board switch failed:`, err);
        // Revert UI to current board
        select.value = currentBoardId;
    } finally {
        loading.hidden = true;
        setLSPControlsDisabled(false);
    }
}

// Handle type checking mode change — requires worker restart
async function handleTypeCheckModeChange(event) {
    const newMode = event.target.value;
    if (newMode === currentTypeCheckMode) return;

    const previousMode = currentTypeCheckMode;
    currentTypeCheckMode = newMode;
    localStorage.setItem('mp_typeCheckMode', newMode);

    if (!lspClient || !lspTransport) {
        return;
    }

    const loading = document.getElementById('boardLoading');
    const select = event.target;

    try {
        loading.hidden = false;
        setLSPControlsDisabled(true);
        await restartLSPWithCurrentSettings(currentBoardId);

        console.log(`Switched to type checking mode: ${newMode}`);
    } catch (err) {
        console.error('Type check mode switch failed:', err);
        currentTypeCheckMode = previousMode;
        localStorage.setItem('mp_typeCheckMode', previousMode);
        select.value = previousMode;
    } finally {
        loading.hidden = true;
        setLSPControlsDisabled(false);
    }
}

async function handleTypeshedPathToggleChange(event) {
    const nextPath = event.target.checked ? TYPESHED_PATH_MICROPYTHON : TYPESHED_PATH_FALLBACK;
    if (nextPath === currentTypeshedPath) return;

    const previousPath = currentTypeshedPath;
    currentTypeshedPath = nextPath;
    localStorage.setItem('mp_typeshedPath', currentTypeshedPath);

    if (!lspClient || !lspTransport) return;

    const loading = document.getElementById('boardLoading');
    try {
        loading.hidden = false;
        setLSPControlsDisabled(true);
        await restartLSPWithCurrentSettings(currentBoardId);
        console.log(`Switched to typeshed path: ${currentTypeshedPath}`);
    } catch (err) {
        console.error('Typeshed path switch failed:', err);
        currentTypeshedPath = previousPath;
        localStorage.setItem('mp_typeshedPath', previousPath);
        event.target.checked = previousPath === TYPESHED_PATH_MICROPYTHON;
    } finally {
        loading.hidden = true;
        setLSPControlsDisabled(false);
    }
}

async function handlePythonVersionChange(event) {
    const nextVersion = sanitizePythonVersion(event.target.value);
    if (nextVersion === currentPythonVersion) return;

    const previousVersion = currentPythonVersion;
    currentPythonVersion = nextVersion;
    localStorage.setItem('mp_pythonVersion', nextVersion);
    event.target.value = nextVersion;

    if (!lspClient || !lspTransport) return;

    const loading = document.getElementById('boardLoading');
    try {
        loading.hidden = false;
        setLSPControlsDisabled(true);
        await restartLSPWithCurrentSettings(currentBoardId);
        console.log(`Switched to pythonVersion: ${nextVersion}`);
    } catch (err) {
        console.error('Python version switch failed:', err);
        currentPythonVersion = previousVersion;
        localStorage.setItem('mp_pythonVersion', previousVersion);
        event.target.value = previousVersion;
    } finally {
        loading.hidden = true;
        setLSPControlsDisabled(false);
    }
}

async function handleVerboseOutputToggleChange(event) {
    const nextVerbose = !!event.target.checked;
    if (nextVerbose === currentVerboseOutput) return;

    const previousVerbose = currentVerboseOutput;
    currentVerboseOutput = nextVerbose;
    localStorage.setItem('mp_verboseOutput', nextVerbose ? '1' : '0');
    updateVerboseOutputLabel();

    if (!lspClient || !lspTransport) return;

    const loading = document.getElementById('boardLoading');
    try {
        loading.hidden = false;
        setLSPControlsDisabled(true);
        await restartLSPWithCurrentSettings(currentBoardId);
        console.log(`Switched verboseOutput: ${nextVerbose ? 'on' : 'off'}`);
    } catch (err) {
        console.error('Verbose output switch failed:', err);
        currentVerboseOutput = previousVerbose;
        localStorage.setItem('mp_verboseOutput', previousVerbose ? '1' : '0');
        event.target.checked = previousVerbose;
        updateVerboseOutputLabel();
    } finally {
        loading.hidden = true;
        setLSPControlsDisabled(false);
    }
}

// Fetch list of example files from the examples folder
async function fetchExampleFiles() {
    try {
        // Fetch the manifest file that lists all available examples
        const manifestResponse = await fetch('./examples/examples.json');
        if (!manifestResponse.ok) {
            throw new Error('Could not load examples manifest');
        }

        const filenames = await manifestResponse.json();

        // Fetch each file to get its first comment line as description
        for (const filename of filenames) {
            try {
                const contentResponse = await fetch(`./examples/${filename}`);
                if (contentResponse.ok) {
                    const content = await contentResponse.text();
                    const firstLine = content.split('\n')[0];

                    // Extract description from first comment line
                    const description = firstLine.startsWith('#')
                        ? firstLine.substring(1).trim()
                        : filename.replace('.py', '').replace(/_/g, ' ');

                    exampleFiles.push({ name: description, file: filename });
                }
            } catch (error) {
                console.warn(`Could not load ${filename}:`, error);
            }
        }

        if (exampleFiles.length === 0) {
            console.error('No example files could be loaded');
        }
    } catch (error) {
        console.error('Error fetching example files:', error);
    }
}

// Populate the example selector dropdown
function populateExampleSelector() {
    const select = document.getElementById('sampleSelect');
    exampleFiles.forEach(example => {
        const option = document.createElement('option');
        option.value = example.file;
        option.textContent = example.name;
        select.appendChild(option);
    });

    // Set default selection to first file if available
    if (exampleFiles.length > 0) {
        select.value = exampleFiles[0].file;
    }
}

// Load sample code from file
async function loadSampleFromFile(filename = 'blink_led.py') {
    try {
        const response = await fetch(`./examples/${filename}`);
        if (response.ok) {
            sampleCode = await response.text();
        } else {
            console.error('Failed to load sample file:', response.statusText);
            sampleCode = `# Error loading ${filename}\n# Please check console for details\n`;
        }
    } catch (error) {
        console.error('Error fetching sample file:', error);
        sampleCode = `# Error loading ${filename}\n# Please check console for details\n`;
    }
}

// Theme configuration
let isDarkTheme = false;  // Default to light theme

// Dark theme
const darkTheme = EditorView.theme({
    "&": {
        backgroundColor: "#1e1e1e",
        color: "#d4d4d4",
        height: "100%"
    },
    ".cm-content": {
        caretColor: "#528bff",
        fontFamily: "var(--code-font-family)",
        fontSize: "13px",
        lineHeight: "1.5",
        fontWeight: "400",
        fontVariationSettings: '"TXTH" 1'
    },
    ".cm-cursor, .cm-dropCursor": {
        borderLeftColor: "#528bff"
    },
    "&.cm-focused .cm-selectionBackground, ::selection": {
        backgroundColor: "#264f78"
    },
    ".cm-selectionBackground": {
        backgroundColor: "#264f7880"
    },
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": {
        backgroundColor: "#4477bb"
    },
    ".cm-activeLine": {
        backgroundColor: "transparent"
    },
    ".cm-selectionMatch": {
        backgroundColor: "#3a3d41"
    },
    ".cm-gutters": {
        backgroundColor: "#1e1e1e",
        color: "#858585",
        border: "none"
    },
    ".cm-activeLineGutter": {
        backgroundColor: "#2a2a2a"
    },
    ".cm-foldPlaceholder": {
        backgroundColor: "#3a3d41",
        border: "none",
        color: "#d4d4d4"
    }
}, { dark: true });

// Light theme
const lightTheme = EditorView.theme({
    "&": {
        backgroundColor: "#ffffff",
        color: "#000000",
        height: "100%"
    },
    ".cm-content": {
        caretColor: "#0000ff",
        fontFamily: "var(--code-font-family)",
        fontSize: "13px",
        lineHeight: "1.5",
        fontWeight: "400",
        fontVariationSettings: '"TXTH" 1'
    },
    ".cm-cursor, .cm-dropCursor": {
        borderLeftColor: "#0000ff"
    },
    "&.cm-focused .cm-selectionBackground, ::selection": {
        backgroundColor: "#add6ff"
    },
    ".cm-selectionBackground": {
        backgroundColor: "#80b4fb80"
    },
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": {
        backgroundColor: "#80b4fb"
    },
    ".cm-activeLine": {
        backgroundColor: "transparent"
    },
    ".cm-selectionMatch": {
        backgroundColor: "#e8e8e8"
    },
    ".cm-gutters": {
        backgroundColor: "#f5f5f5",
        color: "#237893",
        border: "none"
    },
    ".cm-activeLineGutter": {
        backgroundColor: "#e8e8e8"
    },
    ".cm-foldPlaceholder": {
        backgroundColor: "#e8e8e8",
        border: "none",
        color: "#000000"
    }
}, { dark: false });

// Initialize the editor with basic setup and Python language support
let view;

// ---------------------------------------------------------------------------
// Editor helpers (module-level so board/type-check handlers can rebind views)
// ---------------------------------------------------------------------------

const INDENT = '    ';

function selectedLineNumbers(state) {
    const lineNumbers = new Set();
    for (const range of state.selection.ranges) {
        const startLine = state.doc.lineAt(range.from).number;
        let endLine = state.doc.lineAt(range.to).number;
        if (range.to > range.from && state.doc.lineAt(range.to).from === range.to) {
            endLine -= 1;
        }
        for (let lineNo = startLine; lineNo <= endLine; lineNo++) {
            lineNumbers.add(lineNo);
        }
    }
    return Array.from(lineNumbers).sort((a, b) => a - b);
}

function indentWithFourSpaces(targetView) {
    const { state } = targetView;
    const hasMultiline = state.selection.ranges.some((range) => (
        state.doc.lineAt(range.from).number < state.doc.lineAt(range.to).number
    ));

    if (!hasMultiline) {
        targetView.dispatch({
            ...state.replaceSelection(INDENT),
            scrollIntoView: true,
            userEvent: 'input.indent'
        });
        return true;
    }

    const changes = selectedLineNumbers(state).map((lineNo) => {
        const line = state.doc.line(lineNo);
        return { from: line.from, insert: INDENT };
    });

    targetView.dispatch({
        changes,
        scrollIntoView: true,
        userEvent: 'input.indent'
    });
    return true;
}

function dedentFourSpaces(targetView) {
    const { state } = targetView;
    const changes = [];

    for (const lineNo of selectedLineNumbers(state)) {
        const line = state.doc.line(lineNo);
        const text = line.text;
        let removeCount = 0;

        if (text.startsWith(INDENT)) {
            removeCount = 4;
        } else if (text.startsWith('\t')) {
            removeCount = 1;
        } else {
            const match = text.match(/^ {1,3}/);
            removeCount = match ? match[0].length : 0;
        }

        if (removeCount > 0) {
            changes.push({
                from: line.from,
                to: line.from + removeCount
            });
        }
    }

    if (!changes.length) {
        return true;
    }

    targetView.dispatch({
        changes,
        scrollIntoView: true,
        userEvent: 'input.indent'
    });
    return true;
}

/**
 * Per-view bookkeeping for theme/LSP compartments so we can reconfigure each
 * view independently on theme toggle / board switch.
 * @type {WeakMap<import('@codemirror/view').EditorView, {themeC: Compartment, lspC: Compartment, path: string}>}
 */
const viewMeta = new WeakMap();

function buildExtensions(path, themeC, lspC) {
    const uri = `file:///workspace/${path}`;
    const updateListener = EditorView.updateListener.of((update) => {
        if (!update.docChanged) return;
        docManager?.markDirty(path);
        // Only notify LSP for Python files
        if (!lspClient || !path.endsWith('.py')) return;
        const prev = changeDebounceTimers.get(uri);
        if (prev) clearTimeout(prev);
        changeDebounceTimers.set(uri, setTimeout(() => {
            changeDebounceTimers.delete(uri);
            const c = update.state.doc.toString();
            const v = bumpDocumentVersion(uri);
            console.log(`Sending didChange ${path} (version ${v})`);
            notifyDocumentChange(lspClient, uri, c, v);
            if (lspTransport?.worker) {
                lspTransport.worker.postMessage({ type: 'syncFile', path, content: c });
            }
        }, CHANGE_DEBOUNCE_MS));
    });

    return [
        basicSetup,
        indentUnit.of(INDENT),
        python(),
        Prec.high(keymap.of([
            { key: 'Tab', run: indentWithFourSpaces },
            { key: 'Shift-Tab', run: dedentFourSpaces },
            { key: 'Mod-s', run: () => { docManager?.saveFile(); return true; } },
            {
                key: '.',
                run(targetView) {
                    const tr = targetView.state.replaceSelection('.');
                    targetView.dispatch({
                        ...tr,
                        scrollIntoView: true,
                        userEvent: 'input.type',
                    });
                    scheduleDotCompletion(targetView);
                    return true;
                }
            },
        ])),
        themeC.of(isDarkTheme ? darkTheme : lightTheme),
        lintKeymapExtension,
        updateListener,
        lspC.of([]),
    ];
}

function createViewForPath(path, content, paneEl) {
    const themeC = new Compartment();
    const lspC = new Compartment();
    const v = new EditorView({
        doc: content,
        extensions: buildExtensions(path, themeC, lspC),
        parent: paneEl,
    });
    viewMeta.set(v, { themeC, lspC, path });
    if (lspClient) bindLSPToView(v);
    return v;
}

function bindLSPToView(v) {
    const meta = viewMeta.get(v);
    if (!meta || !lspClient) return;
    // Guard: skip if LSP is already bound (avoids duplicate didOpen)
    if (meta.lspBound) return;
    // Only type-check Python files
    if (!meta.path.endsWith('.py')) return;
    const uri = `file:///workspace/${meta.path}`;
    const content = v.state.doc.toString();
    resetDocumentVersion(uri);
    const ext = createLSPPlugin(lspClient, v, {
        fileUri: uri,
        languageId: 'python',
        initialContent: content,
        onDiagnosticsChange: () => refreshWorkspaceDiagnosticsStatus(pyrightVersion, getSelectedStubsStatusLabel())
    });
    v.dispatch({ effects: meta.lspC.reconfigure(ext) });
    meta.lspBound = true;
}

function clearLSPOnView(v) {
    const meta = viewMeta.get(v);
    if (!meta) return;
    v.dispatch(setDiagnostics(v.state, []));
    v.dispatch({ effects: meta.lspC.reconfigure([]) });
    meta.lspBound = false;
}

function reconfigureThemeOnAllViews() {
    const themeExt = isDarkTheme ? darkTheme : lightTheme;
    docManager?.forEachView((v) => {
        const meta = viewMeta.get(v);
        if (meta) v.dispatch({ effects: meta.themeC.reconfigure(themeExt) });
    });
}

function rebindLSPAllViews() {
    docManager?.forEachView((v) => {
        clearLSPOnView(v);
        bindLSPToView(v);
    });
    updateDiagnosticsStatus([], pyrightVersion, getSelectedStubsStatusLabel());
}

// Initialize editor after loading sample
async function initializeEditor() {
    // Start LSP initialization early, in parallel with UI setup
    startEarlyLSPInit();

    // Check URL parameters first (shareable link)
    const urlState = await restoreFromUrl();
    const sharedFiles = urlState.files;
    const hasSharedPayload = Boolean(sharedFiles || urlState.code);

    // If URL specifies a board, apply it before board selector init
    if (urlState.board) {
        localStorage.setItem('mp_board', urlState.board);
    }

    // If URL specifies typeCheckMode, apply it
    if (urlState.typeCheckMode) {
        currentTypeCheckMode = urlState.typeCheckMode;
        localStorage.setItem('mp_typeCheckMode', urlState.typeCheckMode);
        document.getElementById('typeCheckMode').value = urlState.typeCheckMode;
    }

    if (urlState.stdlib) {
        const typeshedPath = parseStdlibToTypeshedPath(urlState.stdlib);
        if (typeshedPath) {
            currentTypeshedPath = typeshedPath;
            localStorage.setItem('mp_typeshedPath', currentTypeshedPath);
            const toggle = document.getElementById('typeshedPathToggle');
            if (toggle) {
                toggle.checked = currentTypeshedPath === TYPESHED_PATH_MICROPYTHON;
            }
        }
    }

    if (urlState.pythonVersion) {
        currentPythonVersion = sanitizePythonVersion(urlState.pythonVersion);
        localStorage.setItem('mp_pythonVersion', currentPythonVersion);
        const versionSelect = document.getElementById('pythonVersion');
        if (versionSelect) {
            versionSelect.value = currentPythonVersion;
        }
    }

    // Fetch available examples and board manifest in parallel
    await Promise.all([
        fetchExampleFiles(),
        initBoardSelector(),
    ]);

    // Use code from legacy URL if present, otherwise load first example.
    // New-format project URLs are restored directly into OPFS below.
    if (urlState.code) {
        sampleCode = urlState.code;
    } else {
        const defaultFile = exampleFiles.length > 0 ? exampleFiles[0].file : 'blink_led.py';
        await loadSampleFromFile(defaultFile);
    }

    // Initialize OPFS storage before starting LSP so the worker can preload the project.
    await OPFSProject.init();

    if (sharedFiles) {
        await replaceProjectFiles(sharedFiles);
    } else if (urlState.code) {
        // Legacy single-file links decode into main.py.
        await OPFSProject.writeFile('main.py', urlState.code);
    }

    // Determine the initial file and content before the worker starts.
    const initialFile = pickInitialFile(sharedFiles) || OPFSProject.getLastActiveFile();
    documentUri = `file:///workspace/${initialFile}`;

    let initialContent;
    try {
        initialContent = await OPFSProject.readFile(initialFile);
    } catch {
        initialContent = sampleCode;
    }

    const initialWorkspaceFiles = await collectWorkspaceFiles(initialFile, initialContent);

    // Wait for early LSP initialization to complete (started right after page load)
    // If it hasn't started yet, start it now.
    const lspInitResult = await (lspInitPromise || startEarlyLSPInit());
    if (!lspInitResult.success) {
        console.log('Editor will continue without LSP features');
    } else {
        try {
            // Early init prioritizes fast worker startup with bundled defaults.
            // Re-apply selected board/workspace settings once UI/OPFS is ready.
            if (currentBoardId) {
                await restartLSPWithCurrentSettings(currentBoardId);
            }
        } catch (error) {
            console.warn('Could not apply final board/workspace settings after early init:', error);
        }
    }

    // Per-view update listeners are wired inside buildExtensions(); no
    // module-level update listener is needed.

    // Create document manager rooted at the editor container
    const editorContainerEl = document.getElementById('editor-container');
    docManager = new DocumentManager(editorContainerEl, createViewForPath);
    docManager.onActiveChange((path) => {
        // Keep the module-level `view` and `documentUri` in sync with whichever
        // pane is active so existing callsites (share, export,
        // etc.) keep working unchanged.
        view = docManager.activeView;
        if (path) documentUri = `file:///workspace/${path}`;
        // Refresh the status bar so it always reflects workspace-level totals
        // regardless of which file is now active (including non-Python files).
        refreshWorkspaceDiagnosticsStatus(pyrightVersion, getSelectedStubsStatusLabel());
    });

    await docManager.openFile(initialFile);

    // Create tab bar
    const tabBarEl = document.getElementById('tab-bar');
    tabBar = new TabBar(tabBarEl, {
        onSelect: async (path) => {
            if (path === docManager.activeFile) return;
            await docManager.openFile(path);
            refreshTabBar();
        },
        onClose: async (path) => {
            if (docManager.isDirty(path)) {
                const filename = path.split('/').pop();
                if (!confirm(`${filename} has unsaved changes. Close without saving?`)) {
                    return;
                }
                // User chose to discard — drop the dirty flag so closeFile
                // doesn't auto-save the unwanted edits back to OPFS.
                docManager.discard(path);
            }
            clearPendingDidChange(path);
            await docManager.closeFile(path);
            forgetDocumentVersion(`file:///workspace/${path}`);
            removeWorkspaceDiagnosticsFor(`file:///workspace/${path}`);
            refreshWorkspaceDiagnosticsStatus(pyrightVersion, getSelectedStubsStatusLabel());
            refreshTabBar();
        },
    });

    // Create file tree
    const fileTreeEl = document.getElementById('file-tree');
    fileTree = new FileTree(fileTreeEl, {
        onOpen: async (path) => {
            if (path === docManager.activeFile) return;
            await docManager.openFile(path);
            refreshTabBar();
            fileTree.setActiveFile(path);
        },
        onDelete: async (path) => {
            // Cascade-close: if a directory is deleted, close all open files
            // whose paths fall under it (e.g. deleting "lib/" closes "lib/foo.py").
            const prefix = path.endsWith('/') ? path : path + '/';
            for (const openPath of docManager.openFiles) {
                if (openPath === path || openPath.startsWith(prefix)) {
                    clearPendingDidChange(openPath);
                    docManager.discard(openPath);
                    await docManager.closeFile(openPath);
                    forgetDocumentVersion(`file:///workspace/${openPath}`);
                    removeWorkspaceDiagnosticsFor(`file:///workspace/${openPath}`);
                }
            }
            refreshWorkspaceDiagnosticsStatus(pyrightVersion, getSelectedStubsStatusLabel());
            refreshTabBar();
        },
        onRename: async (oldPath, newPath) => {
            const oldUri = `file:///workspace/${oldPath}`;
            const newUri = `file:///workspace/${newPath}`;
            const wasOpen = docManager.openFiles.includes(oldPath);
            let content;
            if (wasOpen) {
                clearPendingDidChange(oldPath);
                clearPendingDidChange(newPath);
                content = docManager.getCurrentContent(oldPath);
                docManager.discard(oldPath);
                await docManager.closeFile(oldPath);
                forgetDocumentVersion(oldUri);
                removeWorkspaceDiagnosticsFor(oldUri);
                // Tell Pyright the old document is gone
                if (lspClient) lspClient.notify('textDocument/didClose', { textDocument: { uri: oldUri } });
                await OPFSProject.writeFile(newPath, content);
                await docManager.openFile(newPath);
            } else {
                // File wasn't open in editor — read content from OPFS for worker sync
                try { content = await OPFSProject.readFile(newPath); } catch { content = ''; }
            }
            // Update worker VFS: remove old path, write new path
            if (lspTransport?.worker) {
                lspTransport.worker.postMessage({ type: 'deleteFile', path: oldPath });
                lspTransport.worker.postMessage({ type: 'syncFile', path: newPath, content });
            }
            // Notify Pyright about the file-system change so it re-analyses importers
            if (lspClient) {
                lspClient.notify('workspace/didChangeWatchedFiles', {
                    changes: [
                        { uri: oldUri, type: 3 }, // 3 = Deleted
                        { uri: newUri, type: 1 },  // 1 = Created
                    ]
                });
                // Nudge the active document so Pyright re-checks import statements
                const activeUri = docManager.activeFile ? `file:///workspace/${docManager.activeFile}` : null;
                if (activeUri && activeUri !== newUri) {
                    const activeContent = docManager.activeView?.state.doc.toString() ?? '';
                    const v = bumpDocumentVersion(activeUri);
                    notifyDocumentChange(lspClient, activeUri, activeContent, v);
                }
            }
            refreshTabBar();
        },
        onRefresh: () => refreshTabBar(),
        onClearAll: async () => {
            for (const openPath of [...docManager.openFiles]) {
                clearPendingDidChange(openPath);
                docManager.discard(openPath);
                await docManager.closeFile(openPath);
                forgetDocumentVersion(`file:///workspace/${openPath}`);
            }
            refreshTabBar();
        },
    });
    await fileTree.refresh();
    fileTree.setActiveFile(initialFile);

    // Wire sidebar resize handle
    initSidebarResize();

    // Invalidate workspace-files cache on any file mutation
    for (const evt of [Events.FILE_CREATED, Events.FILE_RENAMED, Events.FILE_DELETED, Events.FILE_SAVED]) {
        document.addEventListener(evt, invalidateWorkspaceFilesCache);
    }

    // Helper: update tab bar display
    function refreshTabBar() {
        tabBar.update({
            openFiles: docManager.openFiles,
            activeFile: docManager.activeFile,
            isDirty: (p) => docManager.isDirty(p),
        });
        if (docManager.activeFile) fileTree.setActiveFile(docManager.activeFile);
    }
    refreshTabBar();

    // Bind LSP to any views that were opened before the LSP client was ready.
    if (lspClient) {
        try {
            await syncWorkspaceToLSP({
                openDocuments: false,
                activeUri: documentUri,
                workspaceFiles: initialWorkspaceFiles,
            });
            docManager.forEachView((v) => bindLSPToView(v));
            console.log('LSP plugin bound to all open views');
            scheduleActiveDocumentRefresh(documentUri, initialContent);
        } catch (error) {
            console.error('Failed to bind LSP plugin:', error);
        }
    }

    // Populate the example selector after editor is initialized
    populateExampleSelector();

    // Initialize share dropdown
    initShareDropdown(
        () => view.state.doc.toString(),
        () => currentBoardId,
        () => currentTypeCheckMode,
        () => currentTypeshedPath === TYPESHED_PATH_MICROPYTHON ? 'micropython' : 'cpython',
        () => currentPythonVersion,
        () => collectShareFiles(),
        () => docManager?.activeFile || OPFSProject.getLastActiveFile() || 'main.py',
    );

    // Initialize report issue button
    initReportIssueButton(
        () => view.state.doc.toString(),
        () => currentBoardId,
        () => getSelectedStubMetadata(),
        () => currentTypeCheckMode,
        () => currentTypeshedPath === TYPESHED_PATH_MICROPYTHON ? 'micropython' : 'cpython',
        () => currentPythonVersion,
        () => collectShareFiles(),
        () => docManager?.activeFile || OPFSProject.getLastActiveFile() || 'main.py',
        () => getWorkspaceDiagnostics(),
    );

    // Wire Export / Import buttons
    initExportImport();

    // If loaded from a shareable link, clear URL params
    if (hasSharedPayload) {
        const cleanUrl = window.location.pathname + window.location.hash;
        window.history.replaceState(null, '', cleanUrl);
    }

    console.log('CodeMirror Python Editor initialized successfully!');
}

// Early LSP Initialization (starts in parallel with UI setup)
// ============================================================
// This promise tracks whether the LSP client has been initialized early.
// We start loading the worker bundle as soon as possible, before waiting
// for UI setup, examples, board selector, etc.

let lspInitPromise = null;

/**
 * Start LSP initialization early, in parallel with UI setup.
 * Called right after document load to begin worker download/initialization.
 * Uses currently available settings; will be reinitialized with updated
 * board/type-check settings once full UI init completes.
 */
function startEarlyLSPInit() {
    if (lspInitPromise) return lspInitPromise;

    lspInitPromise = (async () => {
        try {
            console.log('Starting early LSP initialization...');

            // Start LSP client in the background with default/current settings
            // It will be restarted with proper board stubs once board selector is initialized
            window.__lspReady = false;
            window.__lspFailed = false;
            console.log('Creating LSP client in background...');

            const lspResult = await createLSPClient({
                workerUrl: getWorkerUrlCached(),
                timeout: 15000,
                boardStubs: undefined, // Use bundled stubs initially
                // Start with an empty workspace so worker creation is not
                // blocked by OPFS/project hydration.
                workspaceFiles: {},
                typeCheckingMode: currentTypeCheckMode,
                typeshedPath: currentTypeshedPath,
                pythonVersion: currentPythonVersion,
                verboseOutput: currentVerboseOutput,
            });

            lspClient = lspResult.client;
            lspTransport = lspResult.transport;
            pyrightVersion = lspResult.pyrightVersion || "";
            console.log('LSP client ready (early init).');
            window.__lspReady = true;

            return { success: true };
        } catch (error) {
            console.error('Early LSP initialization failed:', error);
            window.__lspFailed = true;
            return { success: false, error };
        }
    })();

    return lspInitPromise;
}

// Start initialization
initializeEditor().catch(err => {
    console.error('Editor initialization failed:', err);
    window.__lspFailed = true;
});

// Sidebar resize handle
function initSidebarResize() {
    const handle = document.getElementById('sidebar-resize-handle');
    const panel = document.getElementById('file-tree-panel');
    const workspace = document.getElementById('workspace');
    const editorColumn = document.getElementById('editor-column');
    const isCompactViewport = window.matchMedia('(max-width: 900px)');
    if (!handle || !panel || !workspace) return;

    let dragging = false;
    let startX = 0;
    let startWidth = 0;
    let swipeStartX = null;

    function closeMobileSidebar() {
        document.body.classList.remove('mobile-sidebar-open');
    }

    function toggleMobileSidebar() {
        document.body.classList.toggle('mobile-sidebar-open');
    }

    function syncSidebarMode() {
        if (isCompactViewport.matches) {
            panel.style.width = '';
            document.body.classList.remove('mobile-sidebar-open');
            return;
        }
        panel.style.transform = '';
        document.body.classList.remove('mobile-sidebar-open');
    }

    syncSidebarMode();
    isCompactViewport.addEventListener('change', syncSidebarMode);

    handle.addEventListener('mousedown', (e) => {
        if (isCompactViewport.matches) return;
        dragging = true;
        startX = e.clientX;
        startWidth = panel.offsetWidth;
        handle.classList.add('dragging');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        const delta = e.clientX - startX;
        const newWidth = Math.max(100, Math.min(600, startWidth + delta));
        panel.style.width = `${newWidth}px`;
    });

    document.addEventListener('mouseup', () => {
        if (!dragging) return;
        dragging = false;
        handle.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    });

    handle.addEventListener('click', (e) => {
        if (!isCompactViewport.matches) return;
        e.preventDefault();
        e.stopPropagation();
        toggleMobileSidebar();
    });

    workspace.addEventListener('touchstart', (e) => {
        if (!isCompactViewport.matches || !e.touches.length) return;
        swipeStartX = e.touches[0].clientX;
    }, { passive: true });

    workspace.addEventListener('touchmove', (e) => {
        if (!isCompactViewport.matches || !e.touches.length || swipeStartX === null) return;
        const currentX = e.touches[0].clientX;
        const delta = currentX - swipeStartX;

        // Swipe in from the edge to open, swipe left to close.
        if (!document.body.classList.contains('mobile-sidebar-open') && swipeStartX <= 24 && delta > 45) {
            document.body.classList.add('mobile-sidebar-open');
            swipeStartX = null;
        } else if (document.body.classList.contains('mobile-sidebar-open') && delta < -45) {
            document.body.classList.remove('mobile-sidebar-open');
            swipeStartX = null;
        }
    }, { passive: true });

    workspace.addEventListener('touchend', () => {
        swipeStartX = null;
    }, { passive: true });

    editorColumn?.addEventListener('click', () => {
        if (!isCompactViewport.matches) return;
        closeMobileSidebar();
    });
}

function initOptionsPanel() {
    const panel = document.getElementById('options-panel');
    const handle = document.getElementById('options-panel-handle');
    if (!panel || !handle) return;

    function syncState(open) {
        document.body.classList.toggle('options-panel-open', open);
        panel.setAttribute('aria-hidden', open ? 'false' : 'true');
    }

    function toggle() {
        syncState(!document.body.classList.contains('options-panel-open'));
    }

    syncState(false);
    handle.addEventListener('click', toggle);
    handle.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            toggle();
        }
    });
}

// Export/Import wiring
function initExportImport() {
    const exportBtn = document.getElementById('exportBtn');
    const importFile = document.getElementById('importFile');

    if (exportBtn) {
        exportBtn.addEventListener('click', exportProjectAsZip);
    }

    if (importFile) {
        importFile.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            if (file.name.endsWith('.zip')) {
                await importZip(file);
            } else if (file.name.endsWith('.py')) {
                await importPyFile(file);
            }
            e.target.value = '';
        });
    }
}

async function exportProjectAsZip() {
    // Use fflate loaded from CDN for zero-dependency zip
    const { strToU8, zipSync } = await import('https://esm.sh/fflate@0.8.2');
    const files = await OPFSProject.listFiles();
    const zipFiles = {};
    for (const entry of files) {
        if (entry.type === 'file') {
            const content = await OPFSProject.readFile(entry.path);
            zipFiles[entry.path] = strToU8(content);
        }
    }
    const zipped = zipSync(zipFiles);
    const blob = new Blob([zipped], { type: 'application/zip' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'mp_project.zip';
    a.click();
    URL.revokeObjectURL(a.href);
}

async function importZip(file) {
    const { unzipSync, strFromU8 } = await import('https://esm.sh/fflate@0.8.2');
    const buf = await file.arrayBuffer();
    const unzipped = unzipSync(new Uint8Array(buf));
    for (const [path, data] of Object.entries(unzipped)) {
        if (path.endsWith('/')) continue; // directory entry
        const content = strFromU8(data);
        await OPFSProject.writeFile(path, content);
    }
    if (fileTree) await fileTree.refresh();
    console.log('Imported ZIP:', file.name);
}

async function importPyFile(file) {
    const content = await file.text();
    await OPFSProject.writeFile(file.name, content);
    if (fileTree) await fileTree.refresh();
    if (docManager) await docManager.openFile(file.name);
}


function toggleTheme() {
    isDarkTheme = !isDarkTheme;
    document.body.classList.toggle('light-theme', !isDarkTheme);
    document.body.classList.toggle('dark-theme', isDarkTheme);

    // Reconfigure the editor theme on every open view
    reconfigureThemeOnAllViews();
}

// Load sample code from selected file
async function loadSample() {
    const select = document.getElementById('sampleSelect');
    const filename = select.value;

    if (!filename) {
        alert('Please select an example file first');
        return;
    }

    await loadSampleFromFile(filename);
    const transaction = view.state.update({
        changes: { from: 0, to: view.state.doc.length, insert: sampleCode }
    });
    view.dispatch(transaction);
    view.focus();
}

// Get editor content (useful for future integrations)
export function getEditorContent() {
    return view.state.doc.toString();
}

// Set editor content (useful for future integrations)
export function setEditorContent(content) {
    const transaction = view.state.update({
        changes: { from: 0, to: view.state.doc.length, insert: content }
    });
    view.dispatch(transaction);
}

// Event listeners
document.getElementById('themeToggle').addEventListener('click', toggleTheme);
document.getElementById('helpBtn').addEventListener('click', () => {
    const panel = document.getElementById('keyboard-help');
    panel.hidden = !panel.hidden;
});
document.getElementById('loadSampleBtn').addEventListener('click', loadSample);
document.getElementById('typeCheckMode').addEventListener('change', handleTypeCheckModeChange);
document.getElementById('typeshedPathToggle').addEventListener('change', handleTypeshedPathToggleChange);
document.getElementById('pythonVersion').addEventListener('change', handlePythonVersionChange);
document.getElementById('verboseOutputToggle').addEventListener('change', handleVerboseOutputToggleChange);

// Restore saved type checking mode
const savedTypeCheckMode = localStorage.getItem('mp_typeCheckMode');
if (savedTypeCheckMode) {
    document.getElementById('typeCheckMode').value = savedTypeCheckMode;
    currentTypeCheckMode = savedTypeCheckMode;
}

initPythonVersionSelector();
document.getElementById('pythonVersion').value = currentPythonVersion;

const typeshedToggle = document.getElementById('typeshedPathToggle');
typeshedToggle.checked = currentTypeshedPath === TYPESHED_PATH_MICROPYTHON;

const verboseOutputToggle = document.getElementById('verboseOutputToggle');
verboseOutputToggle.checked = currentVerboseOutput;
updateVerboseOutputLabel();

// Initialize with light theme
document.body.classList.add('light-theme');
initOptionsPanel();

// Set header icon src using the correct assets base path
const headerIcon = document.getElementById('headerIcon');
if (headerIcon) {
    headerIcon.src = `${getAssetsBase()}/colorstubs-xs.jpg`;
}

// Export the view for testing purposes
export { view };
