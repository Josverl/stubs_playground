/**
 * Public API surface for @mp-codemirror/lsp-client
 * 
 * This entry point consolidates all stable, reusable exports from the LSP library.
 * Consumers should import from this file, not from individual modules.
 * 
 * Example:
 *   import { createLSPClient, createLSPPlugin } from './lsp/index.js';
 */

// Transport layer
export { SimpleLSPClient } from './simple-client.js';
export { WorkerTransport } from './worker-transport.js';
export { createTransport as createWorkerTransport } from './transport-factory.js';

// Client factories
export { createLSPClient, createLSPPlugin, switchBoard, isLSPReady } from './client.js';

// Diagnostics (pure data layer, no DOM)
export {
    createLSPDiagnostics,
    notifyDocumentOpen,
    notifyDocumentChange,
    removeWorkspaceDiagnosticsFor,
    getWorkspaceDiagnostics,
    requestDiagnostics
} from './diagnostics.js';

// Completion
export { createCompletionSource } from './completion.js';
export {
    kindToType,
    isDunderLabel,
    convertCompletionItem,
    dedupeAndSortCompletionOptions,
    computeCompletionFrom,
    CompletionItemKind
} from './completion-core.mjs';

// Hover tooltip
export { createHoverTooltip } from './hover.js';

// Markdown/RST renderer (extracted in task 4.9)
// export { renderMarkdown, processInline, renderBlocks } from './markdown-renderer.js';
