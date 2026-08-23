/**
 * Create an LSP transport.
 *
 * @param {Object} options - Worker initialization options.
 * @param {string} options.workerUrl - Worker script or Blob URL.
 * @param {ArrayBuffer|false} [options.boardStubs] - Board-specific stubs zip,
 *   `false` to disable board stubs, or `undefined` for the bundled default.
 * @param {string} [options.boardStubsUrl] - Absolute fallback archive URL.
 * @param {{packageName: string, version?: string, fallbackToBundled?: boolean}} [options.boardStubPackage] -
 *   Cached PyPI package to use as `/typings`.
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
export function createTransport(options: {
    workerUrl: string;
    boardStubs?: ArrayBuffer | false;
    boardStubsUrl?: string;
    boardStubPackage?: {
        packageName: string;
        version?: string;
        fallbackToBundled?: boolean;
    };
    workspaceFiles?: {
        [x: string]: string;
    };
    typeCheckingMode?: string;
    typeshedPath?: string;
    pythonVersion?: string;
    verboseOutput?: boolean;
    extraStubPackages?: Array<{
        packageName: string;
        files: {
            [x: string]: string;
        };
    }>;
    extraPaths?: string[];
}): WorkerTransport;
import { WorkerTransport } from './worker-transport.js';
