/**
 * Worker Transport for LSP Client
 *
 * Wraps a Pyright Web Worker behind the same interface as WebSocketTransport.
 * Handles the worker handshake (serverLoaded → initServer → serverInitialized)
 * internally so SimpleLSPClient only sees LSP JSON-RPC messages.
 */

/**
 * @typedef {Object} WorkerTransportOptions
 * @property {ArrayBuffer|false} [boardStubs] - Board stubs zip, `false` to
 *   disable board stubs, or `undefined` to use the bundled default.
 * @property {Object.<string, string>} [workspaceFiles] - Files to preload into
 *   `/workspace`, keyed by workspace-relative path.
 * @property {string} [typeCheckingMode] - Pyright type-checking mode.
 * @property {string} [typeshedPath] - Absolute worker-VFS typeshed path.
 * @property {string} [pythonVersion] - Python version in `X.Y` format.
 * @property {boolean} [verboseOutput] - Enable verbose Pyright output.
 * @property {Array<{packageName: string, files: Object.<string, string>}>}
 *   [extraStubPackages] - Additional type-only stub packages.
 * @property {string[]} [extraPaths] - Absolute extra import search paths.
 */

/**
 * @typedef {Object} WorkerFsEntry
 * @property {string} path - Absolute worker-VFS path.
 * @property {'file'|'dir'} kind - Entry kind.
 * @property {number} depth - Depth relative to the requested root.
 * @property {number} [size] - File size in bytes.
 */

/**
 * Transport that adapts a classic Web Worker to the string-based interface
 * expected by {@link SimpleLSPClient}.
 */
export class WorkerTransport {
    /**
     * @param {string} workerUrl - Worker script or same-origin Blob URL.
     * @param {WorkerTransportOptions} [options={}] - Worker initialization options.
     * @throws {TypeError} If `workerUrl` is missing.
     */
    constructor(workerUrl, options = {}) {
        if (!workerUrl) {
            throw new TypeError('WorkerTransport requires a workerUrl');
        }
        this.workerUrl = workerUrl;
        /** @type {Worker|null} */
        this.worker = null;
        /** @type {Array<(message: string) => void>} */
        this.messageHandlers = [];
        /** @type {Array<(error: Error|ErrorEvent) => void>} */
        this.errorHandlers = [];
        this.connected = false;
        this._messageQueue = [];
        this._connectReject = null;
        this._boardStubs = options.boardStubs; // ArrayBuffer | false | undefined
        this._typeCheckingMode = options.typeCheckingMode; // string | undefined
        this._typeshedPath = options.typeshedPath; // string | undefined
        this._pythonVersion = options.pythonVersion; // string | undefined
        this._verboseOutput = options.verboseOutput; // boolean | undefined
        this._extraStubPackages = options.extraStubPackages || [];
        this._extraPaths = options.extraPaths || [];
        this._workspaceFiles = options.workspaceFiles || {};
        this._debugRequests = new Map(); // requestId -> {resolve,reject,timeout}
        this._generatedConfigRequests = new Map(); // requestId -> {resolve,reject,timeout}
        this.pyrightVersion = ""; // set when serverInitialized is received
    }

    _handleDebugResponse(msg) {
        if (!msg || msg.type !== 'debugListFsResult' || !msg.requestId) {
            return false;
        }

        const pending = this._debugRequests.get(msg.requestId);
        if (!pending) {
            return true;
        }

        this._debugRequests.delete(msg.requestId);
        if (pending.timeout) {
            clearTimeout(pending.timeout);
        }

        if (msg.ok) {
            pending.resolve({
                root: msg.root,
                entries: Array.isArray(msg.entries) ? msg.entries : [],
            });
        } else {
            pending.reject(new Error(msg.error || 'debugListFs failed'));
        }

        return true;
    }

    _handleGeneratedConfigResponse(msg) {
        if (!msg || msg.type !== 'readGeneratedConfigResult' || !msg.requestId) {
            return false;
        }

        const pending = this._generatedConfigRequests.get(msg.requestId);
        if (!pending) {
            return true;
        }

        this._generatedConfigRequests.delete(msg.requestId);
        if (pending.timeout) {
            clearTimeout(pending.timeout);
        }

        if (msg.ok) {
            pending.resolve(typeof msg.content === 'string' ? msg.content : '');
        } else {
            pending.reject(new Error(msg.error || 'readGeneratedConfig failed'));
        }

        return true;
    }

    /**
     * Create the worker, run the handshake, resolve when ready for LSP.
     *
     * @returns {Promise<void>} Resolves after `serverInitialized`.
     * @throws {Error} If worker creation fails, initialization times out, or the
     *   worker reports a server error.
     */
    async connect() {
        return new Promise((resolve, reject) => {
            this._connectReject = reject;
            let phase = 'loading';

            const timeout = setTimeout(() => {
                this._cleanup();
                reject(new Error(`WorkerTransport: timeout in phase "${phase}" (30s)`));
            }, 30000);

            try {
                this.worker = new Worker(this.workerUrl);
            } catch (err) {
                clearTimeout(timeout);
                reject(new Error(`WorkerTransport: failed to create Worker: ${err.message}`));
                return;
            }

            this.worker.onerror = (e) => {
                clearTimeout(timeout);
                this._cleanup();
                reject(new Error(`WorkerTransport: worker error in phase "${phase}": ${e.message}`));
            };

            this.worker.onmessage = (e) => {
                const msg = e.data;

                if (this._handleDebugResponse(msg)) {
                    return;
                }

                if (this._handleGeneratedConfigResponse(msg)) {
                    return;
                }

                // --- Control-plane messages (handshake) ---
                if (msg.type === 'serverLoaded') {
                    phase = 'initializing';
                    this.worker.postMessage({
                        type: 'initServer',
                        userFiles: {},
                        workspaceFiles: this._workspaceFiles,
                        typeshedFallback: undefined, // use bundled typeshed
                        boardStubs: this._boardStubs, // use bundled default or override
                        typeCheckingMode: this._typeCheckingMode,
                        typeshedPath: this._typeshedPath,
                        pythonVersion: this._pythonVersion,
                        verboseOutput: this._verboseOutput,
                        extraStubPackages: this._extraStubPackages,
                        extraPaths: this._extraPaths,
                    });
                    return;
                }

                if (msg.type === 'serverInitialized') {
                    clearTimeout(timeout);
                    this.connected = true;
                    this._connectReject = null;
                    this.pyrightVersion = msg.pyrightVersion || "";

                    // Replace onmessage with the steady-state handler
                    this.worker.onmessage = this._onSteadyStateMessage.bind(this);
                    this.worker.onerror = (err) => {
                        console.error('WorkerTransport: worker error:', err.message);
                        this.errorHandlers.forEach(h => h(err));
                    };

                    // Flush any messages that arrived between init and now
                    for (const queued of this._messageQueue) {
                        this._dispatchLSP(queued);
                    }
                    this._messageQueue = [];

                    console.log('WorkerTransport: connected and ready');
                    resolve();
                    return;
                }

                if (msg.type === 'serverError') {
                    clearTimeout(timeout);
                    this._cleanup();
                    reject(new Error(`WorkerTransport: server error: ${msg.error}`));
                    return;
                }

                // LSP messages arriving during handshake — queue them
                if (msg.jsonrpc === '2.0') {
                    this._messageQueue.push(msg);
                    return;
                }

                console.warn('WorkerTransport: unexpected message during handshake:', msg);
            };
        });
    }

    /**
     * Steady-state message handler — separates control from LSP messages.
     */
    _onSteadyStateMessage(e) {
        const msg = e.data;

        if (this._handleDebugResponse(msg)) {
            return;
        }

        if (this._handleGeneratedConfigResponse(msg)) {
            return;
        }

        if (msg.jsonrpc === '2.0') {
            this._dispatchLSP(msg);
            return;
        }

        // Control messages after init (e.g. serverError on crash)
        if (msg.type === 'serverError') {
            console.error('WorkerTransport: server error:', msg.error);
            this.errorHandlers.forEach(h => h(new Error(msg.error)));
            return;
        }

        // Ignore other control messages silently
    }

    /**
     * Forward an LSP message object to subscribers as a JSON string.
     */
    _dispatchLSP(msg) {
        const str = JSON.stringify(msg);
        for (const handler of this.messageHandlers) {
            try {
                handler(str);
            } catch (err) {
                console.error('WorkerTransport: handler error:', err);
            }
        }
    }

    /**
     * Send a JSON-RPC string to the worker (parsed to object first).
     *
     * Invalid JSON and sends attempted while disconnected are logged and ignored.
     *
     * @param {string|Object} message - JSON-RPC message string or object.
     * @returns {void}
     */
    send(message) {
        if (!this.connected || !this.worker) {
            console.error('WorkerTransport: not connected, cannot send');
            return;
        }

        let parsed;
        try {
            parsed = typeof message === 'string' ? JSON.parse(message) : message;
        } catch (err) {
            console.error('WorkerTransport: invalid JSON in send():', err.message);
            return;
        }

        this.worker.postMessage(parsed);
    }

    /**
     * Subscribe to LSP messages (matches WebSocketTransport interface).
     *
     * @param {(message: string) => void} handler - Receives JSON-RPC strings.
     * @returns {void}
     */
    subscribe(handler) {
        this.messageHandlers.push(handler);
    }

    /**
     * Unsubscribe from messages.
     *
     * @param {(message: string) => void} handler - Previously subscribed handler.
     * @returns {void}
     */
    unsubscribe(handler) {
        const idx = this.messageHandlers.indexOf(handler);
        if (idx > -1) this.messageHandlers.splice(idx, 1);
    }

    /**
     * Register a message handler (legacy interface).
     *
     * @param {(message: string) => void} handler - Receives JSON-RPC strings.
     * @returns {void}
     */
    onMessage(handler) {
        this.messageHandlers.push(handler);
    }

    /**
     * Register an error handler.
     *
     * @param {(error: Error|ErrorEvent) => void} handler - Worker error callback.
     * @returns {void}
     */
    onError(handler) {
        this.errorHandlers.push(handler);
    }

    /**
     * Terminate the worker and reset state.
     *
     * Pending debug/config requests reject with an `Error`.
     *
     * @returns {void}
     */
    close() {
        this._cleanup();
        console.log('WorkerTransport: closed');
    }

    _cleanup() {
        this.connected = false;
        for (const pending of this._debugRequests.values()) {
            if (pending.timeout) {
                clearTimeout(pending.timeout);
            }
            pending.reject(new Error('Worker transport closed'));
        }
        this._debugRequests.clear();
        for (const pending of this._generatedConfigRequests.values()) {
            if (pending.timeout) {
                clearTimeout(pending.timeout);
            }
            pending.reject(new Error('Worker transport closed'));
        }
        this._generatedConfigRequests.clear();
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }
        this._messageQueue = [];
        if (this._connectReject) {
            // Don't call reject here — caller already got an error or we're closing voluntarily
            this._connectReject = null;
        }
    }

    /**
     * Check if connected.
     *
     * @returns {boolean} Whether a worker exists and completed initialization.
     */
    isConnected() {
        return this.connected && this.worker !== null;
    }

    /**
     * Debug helper: list worker virtual filesystem entries from a root path.
     *
     * @param {string} [root='/typings'] - Absolute worker-VFS root to inspect.
     * @param {number} [depth=2] - Maximum traversal depth.
     * @returns {Promise<{root: string, entries: WorkerFsEntry[]}>} Filesystem snapshot.
     * @throws {Error} If disconnected, the worker rejects the request, or the
     *   request exceeds its five-second timeout.
     */
    debugListFs(root = '/typings', depth = 2) {
        if (!this.connected || !this.worker) {
            return Promise.reject(new Error('WorkerTransport: not connected'));
        }

        const requestId = `fs_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                if (!this._debugRequests.has(requestId)) {
                    return;
                }
                this._debugRequests.delete(requestId);
                reject(new Error('debugListFs timed out'));
            }, 5000);

            this._debugRequests.set(requestId, { resolve, reject, timeout });
            this.worker.postMessage({ type: 'debugListFs', requestId, root, depth });
        });
    }

    /**
     * Read generated pyproject.toml content from worker VFS.
     *
     * @returns {Promise<string>} Generated configuration text.
     * @throws {Error} If disconnected, the worker rejects the request, or the
     *   request exceeds its five-second timeout.
     */
    readGeneratedConfig() {
        if (!this.connected || !this.worker) {
            return Promise.reject(new Error('WorkerTransport: not connected'));
        }

        const requestId = `cfg_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                if (!this._generatedConfigRequests.has(requestId)) {
                    return;
                }
                this._generatedConfigRequests.delete(requestId);
                reject(new Error('readGeneratedConfig timed out'));
            }, 5000);

            this._generatedConfigRequests.set(requestId, { resolve, reject, timeout });
            this.worker.postMessage({ type: 'readGeneratedConfig', requestId });
        });
    }
}
