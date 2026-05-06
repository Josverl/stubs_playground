/**
 * Worker Transport for LSP Client
 *
 * Wraps a Pyright Web Worker behind the same interface as WebSocketTransport.
 * Handles the worker handshake (serverLoaded → initServer → serverInitialized)
 * internally so SimpleLSPClient only sees LSP JSON-RPC messages.
 */

import { getWorkerUrlCached } from './worker-config.js';

export class WorkerTransport {
    constructor(workerUrl = null, options = {}) {
        // Use centralized worker URL resolution if not explicitly provided
        this.workerUrl = workerUrl || getWorkerUrlCached();
        this.workerUrl = workerUrl;
        this.worker = null;
        this.messageHandlers = [];
        this.errorHandlers = [];
        this.connected = false;
        this._messageQueue = [];
        this._connectReject = null;
        this._boardStubs = options.boardStubs; // ArrayBuffer | false | undefined
        this._typeCheckingMode = options.typeCheckingMode; // string | undefined
        this._typeshedPath = options.typeshedPath; // string | undefined
        this._pythonVersion = options.pythonVersion; // string | undefined
        this._verboseOutput = options.verboseOutput; // boolean | undefined
        this._workspaceFiles = options.workspaceFiles || {};
        this.pyrightVersion = ""; // set when serverInitialized is received
    }

    /**
     * Create the worker, run the handshake, resolve when ready for LSP.
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
     */
    subscribe(handler) {
        this.messageHandlers.push(handler);
    }

    /**
     * Unsubscribe from messages.
     */
    unsubscribe(handler) {
        const idx = this.messageHandlers.indexOf(handler);
        if (idx > -1) this.messageHandlers.splice(idx, 1);
    }

    /**
     * Register a message handler (legacy interface).
     */
    onMessage(handler) {
        this.messageHandlers.push(handler);
    }

    /**
     * Register an error handler.
     */
    onError(handler) {
        this.errorHandlers.push(handler);
    }

    /**
     * Terminate the worker and reset state.
     */
    close() {
        this._cleanup();
        console.log('WorkerTransport: closed');
    }

    _cleanup() {
        this.connected = false;
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
     */
    isConnected() {
        return this.connected && this.worker !== null;
    }
}
