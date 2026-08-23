/**
 * Create LSP completion source for CodeMirror
 *
 * @param {import('./simple-client.js').SimpleLSPClient} lspClient - Connected LSP client.
 * @param {string} documentUri - The document URI (e.g., 'file:///workspace/document.py')
 * @param {Object} [options]
 * @param {number} [options.autoTriggerDelayMs=320] - Delay auto-triggered dotted completions to allow didChange debounce to flush
 * @returns {(context: import('@codemirror/autocomplete').CompletionContext) =>
 *   Promise<import('@codemirror/autocomplete').CompletionResult|null>}
 *   CodeMirror completion source. LSP request failures are logged and return `null`.
 */
export function createCompletionSource(lspClient: import("./simple-client.js").SimpleLSPClient, documentUri: string, options?: {
    autoTriggerDelayMs?: number;
}): (context: import("@codemirror/autocomplete").CompletionContext) => Promise<import("@codemirror/autocomplete").CompletionResult | null>;
