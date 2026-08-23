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
    constructor(config?: {
        rootUri?: string;
        timeout?: number;
        typeCheckingMode?: string;
        diagnosticMode?: string;
        typeshedPath?: string;
        pythonVersion?: string;
        verboseOutput?: boolean;
        extraPaths?: string[];
    });
    config: {
        rootUri?: string;
        timeout?: number;
        typeCheckingMode?: string;
        diagnosticMode?: string;
        typeshedPath?: string;
        pythonVersion?: string;
        verboseOutput?: boolean;
        extraPaths?: string[];
    };
    /** @type {LSPTransport|null} */
    transport: LSPTransport | null;
    messageId: number;
    /** @type {Map<number, {resolve: (value: unknown) => void, reject: (reason?: unknown) => void, timeout?: ReturnType<typeof setTimeout>}>} */
    pendingRequests: Map<number, {
        resolve: (value: unknown) => void;
        reject: (reason?: unknown) => void;
        timeout?: ReturnType<typeof setTimeout>;
    }>;
    serverCapabilities: object;
    connected: boolean;
    verboseOutput: boolean;
    initializing: Promise<void>;
    /** @type {Array<(method: string, params: unknown) => void>} */
    messageHandlers: Array<(method: string, params: unknown) => void>;
    /** @type {Map<string, (params: unknown) => unknown>} */
    requestHandlers: Map<string, (params: unknown) => unknown>;
    _getAnalysisExtraPaths(): string[];
    /**
     * Connect to the LSP server via a transport and run the `initialize`
     * handshake. The transport must already be connected.
     *
     * @param {LSPTransport} transport - Already-connected transport.
     * @returns {Promise<SimpleLSPClient>} Resolves with this client once the
     *   server has been initialized.
     * @throws {Error} If initialization fails or times out.
     */
    connect(transport: LSPTransport): Promise<SimpleLSPClient>;
    /**
     * Send the LSP `initialize` request and publish client configuration.
     *
     * @returns {Promise<void>} Resolves after capabilities are stored and the
     *   `initialized` and configuration notifications are sent.
     * @throws {Error} If the initialize request fails or times out.
     */
    initialize(): Promise<void>;
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
    request(method: string, params: unknown): Promise<unknown>;
    /**
     * Send a notification to the server (no response expected).
     *
     * @param {string} method - LSP method name (e.g. `textDocument/didChange`).
     * @param {unknown} params - Method parameters.
     * @returns {void}
     * @throws {TypeError} If no transport is attached.
     */
    notify(method: string, params: unknown): void;
    /**
     * Handle an incoming JSON-RPC message from the transport.
     *
     * Parse and handler errors are logged rather than propagated.
     *
     * @param {string} messageStr - Serialized JSON-RPC message.
     * @returns {void}
     */
    handleMessage(messageStr: string): void;
    /**
     * Handle a request from the server, such as `workspace/configuration`.
     *
     * @param {{id: string|number, method: string, params: unknown}} message -
     *   Parsed JSON-RPC request.
     * @returns {void}
     */
    handleServerRequest(message: {
        id: string | number;
        method: string;
        params: unknown;
    }): void;
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
    onRequest(method: string, handler: (params: unknown) => unknown): void;
    /**
     * Dispatch a server notification to subscribers and built-in log handlers.
     *
     * Subscriber errors are logged rather than propagated.
     *
     * @param {string} method - LSP notification method.
     * @param {unknown} params - Notification parameters.
     * @returns {void}
     */
    handleNotification(method: string, params: unknown): void;
    /**
     * Register a server-notification handler.
     *
     * @param {(method: string, params: unknown) => void} handler - Notification handler.
     * @returns {() => void} Idempotent unsubscribe callback.
     */
    onNotification(handler: (method: string, params: unknown) => void): () => void;
    /**
     * Disconnect from the server and reject all pending requests.
     *
     * Shutdown transport errors are logged and suppressed. This method does not
     * close the transport; callers that own it should call `transport.close()`.
     *
     * @returns {void}
     */
    disconnect(): void;
}
export type LSPTransport = {
    /**
     * - Send a serialized JSON-RPC message.
     */
    send: (message: string) => void;
    /**
     * - Add a message handler.
     */
    subscribe: (handler: (message: string) => void) => void;
    /**
     * - Remove a message handler.
     */
    unsubscribe: (handler: (message: string) => void) => void;
    /**
     * - Close the underlying connection.
     */
    close: () => void;
    /**
     * - Report connection state.
     */
    isConnected: () => boolean;
};
