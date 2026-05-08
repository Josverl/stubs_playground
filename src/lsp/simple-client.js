/**
 * Lightweight LSP Client for CodeMirror
 * 
 * This is a custom LSP client implementation since @codemirror/lsp-client
 * is not stable. This provides the core LSP functionality
 * needed for diagnostics, completion, and hover.
 */

/**
 * Simple LSP Client that handles the protocol
 */
export class SimpleLSPClient {
    constructor(config = {}) {
        this.config = config;
        this.transport = null;
        this.messageId = 0;
        this.pendingRequests = new Map();
        this.serverCapabilities = null;
        this.connected = false;
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
                        typeshedPaths: [this.config.typeshedPath || '/typeshed-fallback'],
                        stubPath: '/typings',
                        include: ['/workspace'],
                        extraPaths: analysisExtraPaths,
                        typeCheckingMode: mode,
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
     * Connect to the LSP server via a transport
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
     * Send initialize request to server
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
                    typeshedPaths: [this.config.typeshedPath || '/typeshed-fallback'],
                    stubPath: '/typings',
                    include: ['/workspace'],
                    extraPaths: this._getAnalysisExtraPaths(),
                    typeCheckingMode: this.config.typeCheckingMode || 'standard',
                    diagnosticSeverityOverrides: {
                        reportMissingModuleSource: 'none',
                    },
                },
                pythonVersion: this.config.pythonVersion || '3.11',
                pythonPlatform: 'Linux',
            }
        };
        this.notify('workspace/didChangeConfiguration', { settings: configSettings });

        console.log('LSP initialized, capabilities:', this.serverCapabilities);
    }

    /**
     * Send a request to the server
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
     * Send a notification to the server (no response expected)
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
     * Handle incoming messages from transport
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
     * Handle requests from the server (e.g., workspace/configuration)
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
     * Register a handler for server→client requests
     */
    onRequest(method, handler) {
        this.requestHandlers.set(method, handler);
    }

    /**
     * Handle notifications from server
     */
    handleNotification(method, params) {
        console.log(`LSP notification: ${method}`, params);

        // Call registered handlers
        this.messageHandlers.forEach(handler => {
            try {
                handler(method, params);
            } catch (error) {
                // A RangeError here means stale diagnostics referenced positions
                // that no longer exist after the user edited the document.
                // This is an expected race condition, not a programming error.
                if (error instanceof RangeError) {
                    console.info('Notification handler skipped (stale document positions):', error.message);
                } else {
                    console.error('Error in message handler:', error);
                }
            }
        });

        // Built-in handlers
        if (method === 'window/logMessage') {
            const types = ['', 'ERROR', 'WARNING', 'INFO', 'LOG'];
            console.log(`[LSP ${types[params.type]}]:`, params.message);
        } else if (method === 'window/showMessage') {
            console.log('[LSP Message]:', params.message);
        }
    }

    /**
     * Register a message handler
     * @param {Function} handler - Notification handler function
     * @returns {Function} Unsubscribe function that removes this handler
     */
    onNotification(handler) {
        this.messageHandlers.push(handler);
        return () => {
            const idx = this.messageHandlers.indexOf(handler);
            if (idx > -1) this.messageHandlers.splice(idx, 1);
        };
    }

    /**
     * Disconnect from server
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
