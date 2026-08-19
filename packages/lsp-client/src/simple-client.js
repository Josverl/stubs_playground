/**
 * Lightweight LSP Client for CodeMirror
 * 
 * This is a custom LSP client implementation since @codemirror/lsp-client
 * is not stable. This provides the core LSP functionality
 * needed for diagnostics, completion, and hover.
 */

import { logVerbose } from './logging.js';

/**
 * @typedef {Object} LSPTransport
 * @property {(message: string) => void} send - Send a serialized JSON-RPC message.
 * @property {(handler: (message: string) => void) => void} subscribe - Add a message handler.
 * @property {(handler: (message: string) => void) => void} unsubscribe - Remove a message handler.
 * @property {() => void} close - Close the underlying connection.
 * @property {() => boolean} isConnected - Report connection state.
 */

/**
 * Simple LSP Client that handles the protocol.
 *
 * Transport-agnostic JSON-RPC 2.0 client. Pair it with any object that
 * satisfies the transport interface (see {@link WorkerTransport}):
 * `connect()`, `send(message)`, `subscribe(handler)`, `unsubscribe(handler)`,
 * `close()`, `isConnected()`.
 *
 * @property {object|null} serverCapabilities - Capabilities reported by the
 *   server after `initialize`, or `null` before initialization completes.
 * @property {boolean} connected - Whether the client is currently connected.
 */
export class SimpleLSPClient {
    /**
     * @param {Object} [config={}] - Client configuration.
     * @param {string} [config.rootUri='file:///workspace'] - Workspace root URI.
     * @param {number} [config.timeout=5000] - Request timeout in milliseconds.
     * @param {string} [config.typeCheckingMode] - Pyright type checking mode
     *   (`off`, `basic`, `standard`, `strict`).
     * @param {string} [config.diagnosticMode='openFilesOnly'] - Pyright diagnostic
     *   scope (`openFilesOnly` or `workspace`).
     * @param {string} [config.typeshedPath] - Pyright typeshed path.
     * @param {string} [config.pythonVersion] - Pyright python version in `X.Y` format.
    * @param {boolean} [config.verboseOutput=false] - Enable informational LSP logs.
     * @param {string[]} [config.extraPaths] - Absolute extra import search paths.
     */
    constructor(config = {}) {
        this.config = config;
        /** @type {LSPTransport|null} */
        this.transport = null;
        this.messageId = 0;
        this.pendingRequests = new Map();
        this.serverCapabilities = null;
        this.connected = false;
        this.verboseOutput = config.verboseOutput === true;
        this.initializing = null;
        this.messageHandlers = [];
        this.requestHandlers = new Map();

        // Default handler for workspace/configuration requests from Pyright
        // Pyright requests sections like 'python', 'python.analysis', 'pyright'
        // and expects the value for that specific section.
        this.onRequest('workspace/configuration', (params) => {
            const mode = this.config.typeCheckingMode || 'standard';
            const analysisExtraPaths = this._getAnalysisExtraPaths();
            const fullConfig = {
                python: {
                    analysis: {
                        typeshedPaths: [this.config.typeshedPath || '/typeshed-micropython'],
                        stubPath: '/typings',
                        include: ['/workspace'],
                        extraPaths: analysisExtraPaths,
                        typeCheckingMode: mode,
                        diagnosticMode: this.config.diagnosticMode || 'openFilesOnly',
                        diagnosticSeverityOverrides: {
                            reportMissingModuleSource: 'none',
                        },
                    },
                    pythonVersion: this.config.pythonVersion || '3.11',
                    pythonPlatform: 'Linux',
                },
                pyright: {
                    typeCheckingMode: mode,
                }
            };
            return (params.items || []).map((item) => {
                const section = item.section || '';
                // Navigate the config tree by section path (e.g., 'python.analysis')
                const parts = section.split('.');
                let value = fullConfig;
                for (const part of parts) {
                    if (part && value && typeof value === 'object') {
                        value = value[part];
                    }
                }
                return value || {};
            });
        });
    }

    _getAnalysisExtraPaths() {
        const fromConfig = Array.isArray(this.config.extraPaths)
            ? this.config.extraPaths.filter((p) => typeof p === 'string' && p.trim())
            : [];

        const extra = ['/workspace', ...fromConfig];
        return Array.from(new Set(extra));
    }

    /**
     * Connect to the LSP server via a transport and run the `initialize`
     * handshake. The transport must already be connected.
     *
     * @param {LSPTransport} transport - Already-connected transport.
     * @returns {Promise<SimpleLSPClient>} Resolves with this client once the
     *   server has been initialized.
     * @throws {Error} If initialization fails or times out.
     */
    async connect(transport) {
        this.transport = transport;
        this.connected = true;

        // Subscribe to messages from transport
        transport.subscribe(this.handleMessage.bind(this));

        // Initialize the connection
        this.initializing = this.initialize();
        await this.initializing;

        return this;
    }

    /**
     * Send the LSP `initialize` request and publish client configuration.
     *
     * @returns {Promise<void>} Resolves after capabilities are stored and the
     *   `initialized` and configuration notifications are sent.
     * @throws {Error} If the initialize request fails or times out.
     */
    async initialize() {
        const rootUri = this.config.rootUri || 'file:///workspace';
        const response = await this.request('initialize', {
            processId: null,
            rootUri,
            rootPath: '/workspace',
            workspaceFolders: [{ uri: rootUri, name: 'workspace' }],
            capabilities: {
                workspace: {
                    configuration: true,
                    didChangeConfiguration: {
                        dynamicRegistration: false
                    }
                },
                textDocument: {
                    synchronization: {
                        dynamicRegistration: false,
                        willSave: false,
                        willSaveWaitUntil: false,
                        didSave: false
                    },
                    completion: {
                        dynamicRegistration: false,
                        completionItem: {
                            snippetSupport: false,
                            commitCharactersSupport: false,
                            documentationFormat: ['plaintext', 'markdown'],
                            deprecatedSupport: false,
                            preselectSupport: false
                        },
                        contextSupport: false
                    },
                    hover: {
                        dynamicRegistration: false,
                        contentFormat: ['plaintext', 'markdown']
                    },
                    diagnostic: {
                        dynamicRegistration: false
                    }
                }
            }
        });

        this.serverCapabilities = response.capabilities;

        // Send initialized notification
        this.notify('initialized', {});

        // Send settings to Pyright (typeshed paths, python config)
        // ref: https://micropython-stubs.readthedocs.io/en/main/22_vscode.html
        const configSettings = {
            python: {
                analysis: {
                    typeshedPaths: [this.config.typeshedPath || '/typeshed-micropython'],
                    stubPath: '/typings',
                    include: ['/workspace'],
                    extraPaths: this._getAnalysisExtraPaths(),
                    typeCheckingMode: this.config.typeCheckingMode || 'standard',
                    diagnosticMode: this.config.diagnosticMode || 'openFilesOnly',
                    diagnosticSeverityOverrides: {
                        reportMissingModuleSource: 'none',
                    },
                },
                pythonVersion: this.config.pythonVersion || '3.11',
                pythonPlatform: 'Linux',
            }
        };
        this.notify('workspace/didChangeConfiguration', { settings: configSettings });

        logVerbose(this.verboseOutput, 'LSP initialized, capabilities:', this.serverCapabilities);
    }

    /**
     * Send a request to the server and await its response.
     *
     * @param {string} method - LSP method name (e.g. `textDocument/hover`).
     * @param {unknown} params - Method parameters.
     * @returns {Promise<unknown>} Resolves with the server result, or rejects
     *   on server error or timeout.
     * @throws {Error} If the server returns an error, the timeout expires, or
     *   the client is disconnected while the request is pending.
     */
    request(method, params) {
        return new Promise((resolve, reject) => {
            const id = ++this.messageId;
            const message = {
                jsonrpc: '2.0',
                id,
                method,
                params
            };

            this.pendingRequests.set(id, { resolve, reject });

            // Set timeout
            const timeout = setTimeout(() => {
                if (this.pendingRequests.has(id)) {
                    this.pendingRequests.delete(id);
                    reject(new Error(`Request ${method} timed out`));
                }
            }, this.config.timeout || 5000);

            // Store timeout with request
            this.pendingRequests.get(id).timeout = timeout;

            this.transport.send(JSON.stringify(message));
        });
    }

    /**
     * Send a notification to the server (no response expected).
     *
     * @param {string} method - LSP method name (e.g. `textDocument/didChange`).
     * @param {unknown} params - Method parameters.
     * @returns {void}
     * @throws {TypeError} If no transport is attached.
     */
    notify(method, params) {
        const message = {
            jsonrpc: '2.0',
            method,
            params
        };
        this.transport.send(JSON.stringify(message));
    }

    /**
     * Handle an incoming JSON-RPC message from the transport.
     *
     * Parse and handler errors are logged rather than propagated.
     *
     * @param {string} messageStr - Serialized JSON-RPC message.
     * @returns {void}
     */
    handleMessage(messageStr) {
        try {
            const message = JSON.parse(messageStr);

            // Response to a request we sent
            if (message.id !== undefined && !message.method && this.pendingRequests.has(message.id)) {
                const pending = this.pendingRequests.get(message.id);
                this.pendingRequests.delete(message.id);

                if (pending.timeout) {
                    clearTimeout(pending.timeout);
                }

                if (message.error) {
                    pending.reject(new Error(message.error.message));
                } else {
                    pending.resolve(message.result);
                }
            }
            // Server→client request (has both id and method)
            else if (message.id !== undefined && message.method) {
                this.handleServerRequest(message);
            }
            // Notification from server (method but no id)
            else if (message.method) {
                this.handleNotification(message.method, message.params);
            }
        } catch (error) {
            console.error('Error handling LSP message:', error);
        }
    }

    /**
     * Handle a request from the server, such as `workspace/configuration`.
     *
     * @param {{id: string|number, method: string, params: unknown}} message -
     *   Parsed JSON-RPC request.
     * @returns {void}
     */
    handleServerRequest(message) {
        const handler = this.requestHandlers.get(message.method);
        if (handler) {
            try {
                const result = handler(message.params);
                this.transport.send(JSON.stringify({
                    jsonrpc: '2.0',
                    id: message.id,
                    result: result
                }));
            } catch (error) {
                this.transport.send(JSON.stringify({
                    jsonrpc: '2.0',
                    id: message.id,
                    error: { code: -32603, message: error.message }
                }));
            }
        } else {
            // Respond with null for unhandled requests
            console.warn(`Unhandled server request: ${message.method}`);
            this.transport.send(JSON.stringify({
                jsonrpc: '2.0',
                id: message.id,
                result: null
            }));
        }
    }

    /**
     * Register a handler for server→client requests (e.g.
     * `workspace/configuration`). Only one handler per method; the last
     * registration wins.
     *
     * @param {string} method - LSP method name to handle.
     * @param {(params: unknown) => unknown} handler - Returns the result sent
     *   back to the server.
     * @returns {void}
     */
    onRequest(method, handler) {
        this.requestHandlers.set(method, handler);
    }

    /**
     * Dispatch a server notification to subscribers and built-in log handlers.
     *
     * Subscriber errors are logged rather than propagated.
     *
     * @param {string} method - LSP notification method.
     * @param {unknown} params - Notification parameters.
     * @returns {void}
     */
    handleNotification(method, params) {
        logVerbose(this.verboseOutput, `LSP notification: ${method}`, params);

        // Call registered handlers
        this.messageHandlers.forEach(handler => {
            try {
                handler(method, params);
            } catch (error) {
                // A RangeError here means stale diagnostics referenced positions
                // that no longer exist after the user edited the document.
                // This is an expected race condition, not a programming error.
                if (error instanceof RangeError) {
                    logVerbose(
                        this.verboseOutput,
                        'Notification handler skipped (stale document positions):',
                        error.message,
                    );
                } else {
                    console.error('Error in message handler:', error);
                }
            }
        });

        // Built-in handlers
        if (method === 'window/logMessage') {
            const types = ['', 'ERROR', 'WARNING', 'INFO', 'LOG'];
            if (params.type === 1) {
                console.error('[LSP ERROR]:', params.message);
            } else if (params.type === 2) {
                console.warn('[LSP WARNING]:', params.message);
            } else {
                logVerbose(this.verboseOutput, `[LSP ${types[params.type]}]:`, params.message);
            }
        } else if (method === 'window/showMessage') {
            if (params.type === 1) {
                console.error('[LSP ERROR]:', params.message);
            } else if (params.type === 2) {
                console.warn('[LSP WARNING]:', params.message);
            } else {
                logVerbose(this.verboseOutput, '[LSP Message]:', params.message);
            }
        }
    }

    /**
     * Register a server-notification handler.
     *
     * @param {(method: string, params: unknown) => void} handler - Notification handler.
     * @returns {() => void} Idempotent unsubscribe callback.
     */
    onNotification(handler) {
        this.messageHandlers.push(handler);
        return () => {
            const idx = this.messageHandlers.indexOf(handler);
            if (idx > -1) this.messageHandlers.splice(idx, 1);
        };
    }

    /**
     * Disconnect from the server and reject all pending requests.
     *
     * Shutdown transport errors are logged and suppressed. This method does not
     * close the transport; callers that own it should call `transport.close()`.
     *
     * @returns {void}
     */
    disconnect() {
        if (this.connected) {
            // Reject all pending requests before teardown
            for (const [id, pending] of this.pendingRequests.entries()) {
                clearTimeout(pending.timeout);
                pending.reject(new Error('Client disconnected'));
            }
            this.pendingRequests.clear();

            try {
                // LSP spec: shutdown is a request, exit is a notification.
                // Use notify for both since we're tearing down and won't
                // process the shutdown response anyway.
                this.notify('shutdown', {});
                this.notify('exit', {});
            } catch (error) {
                console.error('Error during shutdown:', error);
            }
            this.connected = false;
            this.serverCapabilities = null;
        }
    }
}
