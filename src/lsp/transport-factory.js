/**
 * Transport Factory for LSP Client
 *
 * Creates a WorkerTransport for the in-browser Pyright Web Worker.
 */

import { WorkerTransport } from './worker-transport.js';

/**
 * Create an LSP transport.
 *
 * @param {Object} options - Worker initialization options.
 * @param {string} options.workerUrl - Worker script or Blob URL.
 * @param {ArrayBuffer|false} [options.boardStubs] - Board-specific stubs zip,
 *   `false` to disable board stubs, or `undefined` for the bundled default.
 * @param {Object.<string, string>} [options.workspaceFiles] - Project files to
 *   preload into `/workspace`, keyed by workspace-relative path.
 * @param {string} [options.typeCheckingMode] - Pyright type-checking mode.
 * @param {string} [options.typeshedPath] - Absolute worker-VFS typeshed path.
 * @param {string} [options.pythonVersion] - Python version in `X.Y` format.
 * @param {boolean} [options.verboseOutput] - Enable verbose Pyright output.
 * @param {Array<{packageName: string, files: Object.<string, string>}>}
 *   [options.extraStubPackages] - Additional type-only stub packages.
 * @param {string[]} [options.extraPaths] - Absolute extra import search paths.
 * @returns {WorkerTransport} Unconnected worker transport.
 * @throws {TypeError} If `options.workerUrl` is missing.
 */
export function createTransport(options) {
    const url = options?.workerUrl;
    if (!url) {
        throw new TypeError('createTransport requires options.workerUrl');
    }
    console.log(`Creating Worker transport → ${url}`);
    return new WorkerTransport(url, {
        boardStubs: options.boardStubs,
        workspaceFiles: options.workspaceFiles,
        typeCheckingMode: options.typeCheckingMode,
        typeshedPath: options.typeshedPath,
        pythonVersion: options.pythonVersion,
        verboseOutput: options.verboseOutput,
        extraStubPackages: options.extraStubPackages,
        extraPaths: options.extraPaths,
    });
}
