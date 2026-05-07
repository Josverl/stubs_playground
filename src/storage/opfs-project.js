/**
 * OPFS Project Storage
 *
 * Thin wrapper around the Origin Private File System (OPFS) API.
 * Falls back to a localStorage-based shim when OPFS is unavailable
 * (Firefox private mode, older Safari, non-secure origins).
 *
 * All paths are relative strings like "main.py" or "lib/helpers.py".
 * The OPFS root directory used is always named "mp_project".
 */

const PROJECT_DIR = 'mp_project';
const LAST_ACTIVE_KEY = 'mp_last_active_file';

const DEFAULT_MAIN = `# main.py — MicroPython hello-world
from machine import Pin
import time

led = Pin(2, Pin.OUT)

while True:
    led.toggle()
    time.sleep(0.5)
`;

// ---------------------------------------------------------------------------
// OPFS backend
// ---------------------------------------------------------------------------

class OPFSBackend {
    constructor(root) {
        /** @type {FileSystemDirectoryHandle} */
        this._root = root;
    }

    /** Resolve a path string to a {dirHandle, name} pair, creating dirs as needed. */
    async _resolve(path, create = false) {
        const parts = path.replace(/^\//, '').split('/');
        const name = parts.pop();
        let dir = this._root;
        for (const part of parts) {
            dir = await dir.getDirectoryHandle(part, { create });
        }
        return { dir, name };
    }

    async listFiles(path = '') {
        let dirHandle = this._root;
        if (path) {
            const parts = path.replace(/^\//, '').split('/').filter(Boolean);
            for (const part of parts) {
                dirHandle = await dirHandle.getDirectoryHandle(part);
            }
        }
        const entries = [];
        await this._collectEntries(dirHandle, path, entries);
        return entries;
    }

    async _collectEntries(dirHandle, prefix, out) {
        for await (const [name, handle] of dirHandle.entries()) {
            const entryPath = prefix ? `${prefix}/${name}` : name;
            if (handle.kind === 'directory') {
                out.push({ path: entryPath, name, type: 'directory' });
                await this._collectEntries(handle, entryPath, out);
            } else {
                out.push({ path: entryPath, name, type: 'file' });
            }
        }
    }

    async readFile(path) {
        const { dir, name } = await this._resolve(path);
        const fh = await dir.getFileHandle(name);
        const file = await fh.getFile();
        return file.text();
    }

    async writeFile(path, content) {
        const { dir, name } = await this._resolve(path, true);
        const fh = await dir.getFileHandle(name, { create: true });
        const writable = await fh.createWritable();
        await writable.write(content);
        await writable.close();
    }

    async deleteFile(path) {
        const { dir, name } = await this._resolve(path);
        await dir.removeEntry(name, { recursive: true });
    }

    async createDirectory(path) {
        const { dir, name } = await this._resolve(path, true);
        await dir.getDirectoryHandle(name, { create: true });
    }

    async renameFile(oldPath, newPath) {
        if (oldPath === newPath) return;

        // Non-atomic: read → write → delete. On partial failure the new copy
        // may exist alongside the old. Callers should close any open editor
        // tab for oldPath before calling rename to avoid stale state.
        let hadDestinationFile = false;
        let destinationContent = '';
        try {
            destinationContent = await this.readFile(newPath);
            hadDestinationFile = true;
        } catch {
            // Destination may not exist or may be a directory; both are fine.
        }

        const content = await this.readFile(oldPath);
        await this.writeFile(newPath, content);
        try {
            await this.deleteFile(oldPath);
        } catch (err) {
            // Best-effort rollback. If destination existed before rename,
            // restore it; otherwise remove the newly created copy.
            try {
                if (hadDestinationFile) {
                    await this.writeFile(newPath, destinationContent);
                } else {
                    await this.deleteFile(newPath);
                }
            } catch {
                // Ignore rollback failures and surface the original error.
            }
            throw err;
        }
    }

    async exists(path) {
        try {
            const { dir, name } = await this._resolve(path);
            await dir.getFileHandle(name);
            return true;
        } catch (err) {
            if (err.name !== 'NotFoundError' && err.name !== 'TypeMismatchError') throw err;
            try {
                const { dir, name } = await this._resolve(path);
                await dir.getDirectoryHandle(name);
                return true;
            } catch (err2) {
                if (err2.name !== 'NotFoundError') throw err2;
                return false;
            }
        }
    }
}

// ---------------------------------------------------------------------------
// localStorage fallback backend
// ---------------------------------------------------------------------------

const LS_PREFIX = 'opfs_fallback:';

class LocalStorageBackend {
    constructor() {
        /** @type {Array|null} Cached listFiles result; null = stale */
        this._listCache = null;
    }

    _key(path) { return `${LS_PREFIX}${path}`; }
    _invalidate() { this._listCache = null; }

    async listFiles(path = '') {
        // Return cached full listing when available; filter by path afterward.
        if (!this._listCache) {
            const entries = [];
            const seen = new Set();
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (!k.startsWith(LS_PREFIX)) continue;
                const filePath = k.slice(LS_PREFIX.length);
                const parts = filePath.split('/');
                for (let d = 1; d < parts.length; d++) {
                    const dirPath = parts.slice(0, d).join('/');
                    if (!seen.has(dirPath)) {
                        seen.add(dirPath);
                        entries.push({ path: dirPath, name: parts[d - 1], type: 'directory' });
                    }
                }
                entries.push({ path: filePath, name: parts[parts.length - 1], type: 'file' });
            }
            this._listCache = entries;
        }
        if (!path) return [...this._listCache];
        return this._listCache.filter(e =>
            e.path === path || e.path.startsWith(path + '/')
        );
    }

    async readFile(path) {
        const val = localStorage.getItem(this._key(path));
        if (val === null) throw new Error(`File not found: ${path}`);
        return val;
    }

    async writeFile(path, content) {
        localStorage.setItem(this._key(path), content);
        this._invalidate();
    }

    async deleteFile(path) {
        // Remove file and any children (directory removal)
        const prefix = this._key(path);
        const toRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k === prefix || k.startsWith(prefix + '/')) toRemove.push(k);
        }
        toRemove.forEach(k => localStorage.removeItem(k));
        this._invalidate();
    }

    async createDirectory(_path) { /* no-op — dirs are implicit */ }

    async renameFile(oldPath, newPath) {
        if (oldPath === newPath) return;

        // Non-atomic: read → write → delete. See OPFS backend for details.
        let hadDestinationFile = false;
        let destinationContent = '';
        try {
            destinationContent = await this.readFile(newPath);
            hadDestinationFile = true;
        } catch {
            // Destination missing is expected in most rename flows.
        }

        const content = await this.readFile(oldPath);
        await this.writeFile(newPath, content);
        try {
            await this.deleteFile(oldPath);
        } catch (err) {
            try {
                if (hadDestinationFile) {
                    await this.writeFile(newPath, destinationContent);
                } else {
                    await this.deleteFile(newPath);
                }
            } catch {
                // Ignore rollback failures and surface the original error.
            }
            throw err;
        }
    }

    async exists(path) {
        return localStorage.getItem(this._key(path)) !== null;
    }
}

// ---------------------------------------------------------------------------
// Public OPFSProject facade
// ---------------------------------------------------------------------------

let _backendPromise = null;

async function _getBackend() {
    if (_backendPromise) return _backendPromise;
    _backendPromise = (async () => {
        try {
            if (!navigator.storage?.getDirectory) throw new Error('OPFS unavailable');
            const root = await navigator.storage.getDirectory();
            const projectDir = await root.getDirectoryHandle(PROJECT_DIR, { create: true });
            console.log('[OPFSProject] Using OPFS backend');
            return new OPFSBackend(projectDir);
        } catch (err) {
            console.warn('[OPFSProject] Falling back to localStorage:', err.message);
            return new LocalStorageBackend();
        }
    })();
    return _backendPromise;
}

export const OPFSProject = {
    /**
     * Initialize: seed default files on first use.
     * @param {{ defaultMainContent?: string }} [options]
     * @returns {Promise<void>}
     */
    async init(options = {}) {
        const defaultMainContent = typeof options.defaultMainContent === 'string'
            ? options.defaultMainContent
            : DEFAULT_MAIN;
        const backend = await _getBackend();
        const hasMain = await backend.exists('main.py');
        if (!hasMain) {
            await backend.writeFile('main.py', defaultMainContent);
            console.log('[OPFSProject] Seeded default main.py');
        }
    },

    /** List all files (and directories) under path (default: root). */
    async listFiles(path = '') {
        return (await _getBackend()).listFiles(path);
    },

    /** Read a file, returning its text content. */
    async readFile(path) {
        return (await _getBackend()).readFile(path);
    },

    /** Write (create or overwrite) a file. */
    async writeFile(path, content) {
        return (await _getBackend()).writeFile(path, content);
    },

    /** Delete a file or directory (recursive). */
    async deleteFile(path) {
        return (await _getBackend()).deleteFile(path);
    },

    /** Create a directory. */
    async createDirectory(path) {
        return (await _getBackend()).createDirectory(path);
    },

    /** Rename / move a file. */
    async renameFile(oldPath, newPath) {
        return (await _getBackend()).renameFile(oldPath, newPath);
    },

    /** Check whether a path exists. */
    async exists(path) {
        return (await _getBackend()).exists(path);
    },

    // ---- Last active file persistence ----

    getLastActiveFile() {
        return localStorage.getItem(LAST_ACTIVE_KEY) || 'main.py';
    },

    setLastActiveFile(path) {
        localStorage.setItem(LAST_ACTIVE_KEY, path);
    },
};
