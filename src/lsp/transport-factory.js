/**
 * Transport Factory for LSP Client
 *
 * Creates a WorkerTransport for the in-browser Pyright Web Worker.
 */

import { WorkerTransport } from './worker-transport.js';
import { getWorkerUrlCached } from './worker-config.js';

/**
 * Create an LSP transport.
 * @param {Object} options
 * @param {string} [options.workerUrl] - Worker script URL (auto-detected if omitted)
 * @param {ArrayBuffer} [options.boardStubs] - Board-specific stubs data
 * @param {Object.<string, string>} [options.workspaceFiles] - Project files to preload into /workspace
 * @param {string} [options.typeCheckingMode] - Pyright type checking mode
 * @param {string} [options.typeshedPath] - Pyright typeshedPath
 * @param {string} [options.pythonVersion] - Pyright pythonVersion
 * @param {boolean} [options.verboseOutput] - Pyright verboseOutput
 * @returns {WorkerTransport}
 */
export function createTransport(options = {}) {
    const url = options.workerUrl || getWorkerUrlCached();
    console.log(`Creating Worker transport → ${url}`);
    return new WorkerTransport(url, {
        boardStubs: options.boardStubs,
        workspaceFiles: options.workspaceFiles,
        typeCheckingMode: options.typeCheckingMode,
        typeshedPath: options.typeshedPath,
        pythonVersion: options.pythonVersion,
        verboseOutput: options.verboseOutput,
    });
}
