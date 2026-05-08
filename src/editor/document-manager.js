/**
 * Document Manager
 *
 * Manages multiple open files. Each open file gets its own EditorView mounted
 * inside its own pane element. Switching tabs simply toggles which pane is
 * visible — no state-swapping, no scroll/undo bookkeeping. This mirrors the
 * pattern used by ViperIDE and is the recommended CodeMirror 6 idiom for
 * multi-document editors.
 */

import { OPFSProject } from '../storage/opfs-project.js';
import { Events, dispatch } from '../events.js';

export class DocumentManager {
    /**
     * @param {HTMLElement} containerEl
     *   The DOM element that will host one editor pane per open file.
    * @param {(path: string, content: string, paneEl: HTMLElement, options?: { readOnly?: boolean, language?: string }) => import('@codemirror/view').EditorView} createView
     *   Factory that creates a fully-configured EditorView mounted into paneEl.
     */
    constructor(containerEl, createView) {
        this._container = containerEl;
        this._createView = createView;

        /** @type {Map<string, { view: import('@codemirror/view').EditorView, paneEl: HTMLElement, dirty: boolean, virtual: boolean, readOnly: boolean }>} */
        this._docs = new Map();

        /** @type {string|null} */
        this._activeFile = null;

        /** @type {Array<(path: string|null) => void>} */
        this._changeListeners = [];
    }

    /** Register a listener invoked whenever the active file changes. */
    onActiveChange(fn) {
        this._changeListeners.push(fn);
        return () => this.offActiveChange(fn);
    }

    /** Remove a previously registered active-file listener. */
    offActiveChange(fn) {
        this._changeListeners = this._changeListeners.filter((listener) => listener !== fn);
    }

    _notifyListeners(path) {
        for (const fn of this._changeListeners) {
            try { fn(path); } catch (e) { console.error('DocumentManager listener error', e); }
        }
    }

    /**
     * Open a file (creating a fresh EditorView if not yet open) and activate it.
     * @param {string} path
     */
    async openFile(path) {
        if (!this._docs.has(path)) {
            let content = '';
            try {
                content = await OPFSProject.readFile(path);
            } catch (err) {
                console.warn(`DocumentManager: could not read ${path}:`, err.message);
            }

            const paneEl = document.createElement('div');
            paneEl.className = 'editor-pane';
            paneEl.dataset.path = path;
            this._container.appendChild(paneEl);

            const view = this._createView(path, content, paneEl);
            this._docs.set(path, { view, paneEl, dirty: false, virtual: false, readOnly: false });
        }

        // Toggle visibility of all panes
        for (const [p, entry] of this._docs) {
            entry.paneEl.classList.toggle('editor-pane--active', p === path);
        }

        this._activeFile = path;
        const activeEntry = this._docs.get(path);
        if (!activeEntry?.virtual) {
            OPFSProject.setLastActiveFile(path);
        }

        // Focus the newly-active editor on the next frame so layout has settled
        const entry = this._docs.get(path);
        requestAnimationFrame(() => entry.view.focus());

        this._notifyListeners(path);
        dispatch(Events.ACTIVE_CHANGED, { path });
    }

    /**
     * Open a virtual file that should not persist to OPFS.
     * Existing open virtual files are updated with the latest content.
     * @param {string} path
     * @param {string} content
     * @param {{ readOnly?: boolean, language?: string }} [options]
     */
    async openVirtualFile(path, content, options = {}) {
        const readOnly = !!options.readOnly;
        if (!this._docs.has(path)) {
            const paneEl = document.createElement('div');
            paneEl.className = 'editor-pane';
            paneEl.dataset.path = path;
            this._container.appendChild(paneEl);

            const view = this._createView(path, content, paneEl, options);
            this._docs.set(path, { view, paneEl, dirty: false, virtual: true, readOnly });
        } else {
            const entry = this._docs.get(path);
            if (entry) {
                entry.view.dispatch({
                    changes: { from: 0, to: entry.view.state.doc.length, insert: content },
                });
                entry.dirty = false;
                entry.virtual = true;
                entry.readOnly = readOnly;
            }
        }

        await this.openFile(path);
    }

    /**
     * Persist a file's current in-memory content to OPFS.
     * @param {string} [path] — defaults to active file
     */
    async saveFile(path) {
        const target = path || this._activeFile;
        if (!target) return;
        const entry = this._docs.get(target);
        if (!entry) return;
        if (entry.virtual || entry.readOnly) {
            return;
        }

        const content = entry.view.state.doc.toString();
        await OPFSProject.writeFile(target, content);
        entry.dirty = false;
        this._notifyListeners(this._activeFile);
        dispatch(Events.FILE_SAVED, { path: target });
    }

    /**
     * Drop unsaved changes for a file so the next closeFile() won't persist
     * them. Disk content is left untouched.
     */
    discard(path) {
        const entry = this._docs.get(path);
        if (entry) entry.dirty = false;
    }

    /**
     * Close a file. Auto-saves first if dirty (unless discard() was called).
     */
    async closeFile(path) {
        const entry = this._docs.get(path);
        if (!entry) return;

        if (entry.dirty) {
            await this.saveFile(path);
        }

        entry.view.destroy();
        entry.paneEl.remove();
        this._docs.delete(path);
        dispatch(Events.FILE_CLOSED, { path });

        if (this._activeFile === path) {
            const remaining = [...this._docs.keys()];
            if (remaining.length > 0) {
                await this.openFile(remaining[remaining.length - 1]);
            } else {
                this._activeFile = null;
                this._notifyListeners(null);
            }
        }
    }

    /** Iterate every currently-open EditorView. */
    forEachView(fn) {
        for (const [path, entry] of this._docs) {
            fn(entry.view, path);
        }
    }

    /** Mark a file as dirty (unsaved changes). Defaults to the active file. */
    markDirty(path) {
        const target = path || this._activeFile;
        if (!target) return;
        const entry = this._docs.get(target);
        if (entry?.virtual || entry?.readOnly) return;
        if (entry && !entry.dirty) {
            entry.dirty = true;
            this._notifyListeners(this._activeFile);
        }
    }

    /** @returns {string|null} */
    get activeFile() { return this._activeFile; }

    /** @returns {import('@codemirror/view').EditorView|null} */
    get activeView() {
        return this._activeFile ? (this._docs.get(this._activeFile)?.view ?? null) : null;
    }

    /** @returns {string[]} All currently open file paths. */
    get openFiles() { return [...this._docs.keys()]; }

    /** @returns {boolean} */
    isDirty(path) {
        return this._docs.get(path)?.dirty ?? false;
    }

    /** Read the current text of a file (uses the live EditorView if open). */
    getCurrentContent(path) {
        const entry = this._docs.get(path);
        return entry ? entry.view.state.doc.toString() : '';
    }

    /**
     * Backward-compat shim used by older callers; per-tab views never need
     * an explicit sync because each view owns its own state.
     */
    syncFromView() { /* no-op */ }
}
