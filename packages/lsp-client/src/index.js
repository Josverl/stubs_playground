/**
 * Public API surface for @mp-codemirror/lsp-client
 * 
 * This entry point consolidates all stable, reusable exports from the LSP library.
 * Consumers should import from this file, not from individual modules.
 * 
 * Example:
 *   import { createLSPClient, createLSPPlugin } from '@mp-codemirror/lsp-client';
 */

// Transport layer
export { SimpleLSPClient } from './simple-client.js';
export {
    CURRENT_WORKER_PROTOCOL_VERSION,
    MIN_SUPPORTED_WORKER_PROTOCOL_VERSION,
    WORKER_CAPABILITIES,
    WorkerTransport,
} from './worker-transport.js';
export { createTransport as createWorkerTransport } from './transport-factory.js';
export { startWorkerRuntime } from './runtime-loader.js';

// Client factories
export { createLSPClient, createLSPPlugin, switchBoard, isLSPReady } from './client.js';

// Diagnostics (pure data layer, no DOM)
export {
    createLSPDiagnostics,
    createWorkspaceDiagnosticsSubscription,
    notifyDocumentOpen,
    notifyDocumentChange,
    notifyDocumentClose,
    removeWorkspaceDiagnosticsFor,
    getWorkspaceDiagnostics,
    requestDiagnostics,
    lintKeymapExtension,
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

// Markdown/RST renderer (pure rendering utilities)
export { renderMarkdown, processInline, renderBlocks, PYRIGHT_SIG_RE } from './markdown-renderer.js';

// Public types re-exported for TypeScript consumers.
/**
 * @typedef {import('./client.js').LSPClientConfig} LSPClientConfig
 * @typedef {import('./client.js').LSPClientResult} LSPClientResult
 * @typedef {import('./client.js').LSPPluginOptions} LSPPluginOptions
 * @typedef {import('./diagnostics.js').WorkspaceDiagnostic} WorkspaceDiagnostic
 * @typedef {import('./simple-client.js').LSPTransport} LSPTransport
 * @typedef {import('./worker-transport.js').WorkerTransportOptions} WorkerTransportOptions
 * @typedef {import('./worker-transport.js').StubPackageCatalogEntry} StubPackageCatalogEntry
 * @typedef {import('./worker-transport.js').StubPackageRelease} StubPackageRelease
 * @typedef {import('./worker-transport.js').InstalledStubPackage} InstalledStubPackage
 * @typedef {import('./worker-transport.js').WorkerFsEntry} WorkerFsEntry
 * @typedef {import('./runtime-loader.js').WorkerRuntimeOptions} WorkerRuntimeOptions
 * @typedef {import('./runtime-loader.js').WorkerRuntimeCandidate} WorkerRuntimeCandidate
 * @typedef {import('./runtime-loader.js').RuntimeFallback} RuntimeFallback
 * @typedef {import('./completion-core.mjs').LSPCompletionItem} LSPCompletionItem
 * @typedef {import('./completion-core.mjs').CodeMirrorCompletionOption} CodeMirrorCompletionOption
 */
